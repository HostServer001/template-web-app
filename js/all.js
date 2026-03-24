const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let zones = [], selectedId = null;
let imgNatW = 0, imgNatH = 0, imgDisplayW = 0, imgDisplayH = 0;
let addMode = false, zoneCounter = 0;
let dragging = null, resizing = null, rotating = null;
let dragStart = {}, resizeStart = {}, rotateStart = {};
let currentImageHash = null;

const img        = document.getElementById('meme-img');
const container  = document.getElementById('canvas-container');
const canvasWrap = document.getElementById('canvas-wrap');
const appEl      = document.getElementById('app');

// ─────────────────────────────────────────
// VIEWPORT HEIGHT
// Telegram reports the real usable height via viewportStableHeight.
// We set it as an explicit px height on #app so the browser doesn't
// use its own (wrong) 100vh calculation.
// ─────────────────────────────────────────
function applyViewportHeight() {
  const h = (tg && tg.viewportStableHeight > 100) ? tg.viewportStableHeight
           : (tg && tg.viewportHeight       > 100) ? tg.viewportHeight
           : window.innerHeight;
  appEl.style.height = h + 'px';
}

applyViewportHeight();

if (tg) {
  tg.onEvent('viewportChanged', () => {
    applyViewportHeight();
    scheduleRefit();
  });
}
window.addEventListener('resize', () => {
  applyViewportHeight();
  scheduleRefit();
});

// ─────────────────────────────────────────
// REFIT — sizes the image to exactly fill canvas-wrap
// Debounced via rAF so layout has settled before we measure
// ─────────────────────────────────────────
let _refitFrame = null;
function scheduleRefit() {
  if (_refitFrame) cancelAnimationFrame(_refitFrame);
  _refitFrame = requestAnimationFrame(() => {
    _refitFrame = null;
    if (!imgNatW || !imgNatH) return;
    fitImage();
    zones.forEach(z => reRenderZone(z));
  });
}

function fitImage() {
  const wrapW = canvasWrap.clientWidth;
  const wrapH = canvasWrap.clientHeight;
  if (!wrapW || !wrapH || !imgNatW || !imgNatH) return;

  const scale = Math.min(wrapW / imgNatW, wrapH / imgNatH);
  imgDisplayW = Math.floor(imgNatW * scale);
  imgDisplayH = Math.floor(imgNatH * scale);

  img.style.width     = imgDisplayW + 'px';
  img.style.height    = imgDisplayH + 'px';
  img.style.maxWidth  = 'none';
  img.style.maxHeight = 'none';
}

// ─────────────────────────────────────────
// PRESETS
// ─────────────────────────────────────────
const PRESETS = [
  { label: '⬆ Top Caption',        zones: [{ name: 'top_text',    x: 0.05, y: 0.02, w: 0.90, h: 0.14 }] },
  { label: '⬇ Bottom Caption',     zones: [{ name: 'bottom_text', x: 0.05, y: 0.84, w: 0.90, h: 0.14 }] },
  { label: '↕ Top + Bottom',       zones: [{ name: 'top_text', x: 0.05, y: 0.02, w: 0.90, h: 0.14 }, { name: 'bottom_text', x: 0.05, y: 0.84, w: 0.90, h: 0.14 }] },
  { label: '🔲 2×2 Grid',          zones: [{ name: 'top_left', x: 0.02, y: 0.02, w: 0.46, h: 0.46 }, { name: 'top_right', x: 0.52, y: 0.02, w: 0.46, h: 0.46 }, { name: 'bottom_left', x: 0.02, y: 0.52, w: 0.46, h: 0.46 }, { name: 'bottom_right', x: 0.52, y: 0.52, w: 0.46, h: 0.46 }] },
  { label: '◼ Center Box',         zones: [{ name: 'center_text', x: 0.10, y: 0.35, w: 0.80, h: 0.30 }] },
  { label: '🔛 Full Width Strip',  zones: [{ name: 'strip_text',  x: 0.00, y: 0.42, w: 1.00, h: 0.16 }] },
  { label: '↔ Left + Right',       zones: [{ name: 'left_text',  x: 0.02, y: 0.10, w: 0.44, h: 0.80 }, { name: 'right_text', x: 0.54, y: 0.10, w: 0.44, h: 0.80 }] },
  { label: '🗨 Speech Bubble',     zones: [{ name: 'bubble_text', x: 0.30, y: 0.03, w: 0.65, h: 0.22 }] },
  { label: '🏷 Label Bottom-Left', zones: [{ name: 'label_text',  x: 0.03, y: 0.78, w: 0.45, h: 0.18 }] },
  { label: '📋 3 Rows',            zones: [{ name: 'row_1', x: 0.05, y: 0.02, w: 0.90, h: 0.14 }, { name: 'row_2', x: 0.05, y: 0.43, w: 0.90, h: 0.14 }, { name: 'row_3', x: 0.05, y: 0.84, w: 0.90, h: 0.14 }] }
];

function buildPresetChips() {
  const scrollEl = document.getElementById('presets-scroll');
  let scrolling = false, scrollTimer = null;
  scrollEl.addEventListener('scroll', () => {
    scrolling = true;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { scrolling = false; }, 150);
  }, { passive: true });
  PRESETS.forEach((preset, i) => {
    const chip = document.createElement('button');
    chip.className = 'preset-chip';
    chip.textContent = preset.label;
    chip.addEventListener('touchend', e => { if (scrolling) { e.preventDefault(); return; } }, { passive: false });
    chip.addEventListener('click', () => { if (!scrolling) applyPreset(i); });
    scrollEl.appendChild(chip);
  });
}
buildPresetChips();

function applyPreset(index) {
  if (!imgNatW) { showToast('Image not loaded yet'); return; }
  clearAll(true);
  PRESETS[index].zones.forEach(z => {
    addZone(z.x * imgDisplayW, z.y * imgDisplayH, z.w * imgDisplayW, z.h * imgDisplayH, z.name);
  });
  showToast('Applied: ' + PRESETS[index].label.replace(/^.\s/, ''));
}

// ─────────────────────────────────────────
// IMAGE LOADING
// Poll until Telegram's stable height stops changing, then load.
// This prevents fitImage() from measuring a half-expanded viewport.
// ─────────────────────────────────────────
function waitForStableHeight(cb) {
  if (!tg) { setTimeout(cb, 50); return; }
  let prev = 0, stable = 0;
  const check = () => {
    const h = tg.viewportStableHeight || tg.viewportHeight || window.innerHeight;
    if (h > 100 && h === prev) {
      stable++;
      if (stable >= 3) { cb(); return; } // same height 3 checks in a row = stable
    } else {
      stable = 0;
    }
    prev = h;
    setTimeout(check, 50);
  };
  // Start checking after a brief initial delay
  setTimeout(check, 100);
}

function loadImageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tempUrl = params.get('image_url');

  if (!tempUrl) {
    document.getElementById('placeholder').innerHTML =
      '<div class="placeholder-icon">⚠️</div><p>No image_url provided</p>';
    return;
  }

  document.getElementById('placeholder').innerHTML =
    '<div class="loader"></div><p>Loading image…</p>';

  img.src = tempUrl;
  img.style.display = 'none';

  img.onload = () => {
    imgNatW = img.naturalWidth;
    imgNatH = img.naturalHeight;

    // Reveal bottom panel controls FIRST so they consume their space
    document.getElementById('top-actions').style.display = '';
    document.getElementById('presets-section').classList.add('visible');
    document.getElementById('actions').style.display = '';
    document.getElementById('hint').style.display = '';

    // Double rAF: first frame triggers layout, second frame measures result
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitImage();
      img.style.display = 'block';
      document.getElementById('placeholder').style.display = 'none';
      currentImageHash = params.get('image_hash') || SparkMD5.hash(tempUrl);
      window.originalUploader = params.get('uploader') || null;
    }));
  };

  img.onerror = () => {
    document.getElementById('placeholder').innerHTML =
      '<div class="placeholder-icon">⚠️</div><p>Failed to load image</p>';
    showToast('Failed to load image!');
  };
}

waitForStableHeight(() => {
  applyViewportHeight();
  loadImageFromUrl();
});

// ─────────────────────────────────────────
// Core helpers
// ─────────────────────────────────────────
function getScale() {
  return { sx: imgNatW / imgDisplayW, sy: imgNatH / imgDisplayH };
}

function toggleAddMode() {
  addMode = !addMode;
  const btn = document.getElementById('add-zone-btn');
  btn.textContent = addMode ? '✕ Cancel' : '＋ Add Zone';
  btn.classList.toggle('cancel-mode', addMode);
  container.style.cursor = addMode ? 'crosshair' : 'default';
}

function getEventPos(e, el) {
  const rect = el.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}
function getClientPos(e) {
  const src = e.touches ? e.touches[0] : e;
  return { x: src.clientX, y: src.clientY };
}

function onCanvasDown(e) {
  if (!addMode || !img.src) return;
  if (e.target !== img && e.target !== container) return;
  e.preventDefault();
  const pos = getEventPos(e, container);
  const w = imgDisplayW * 0.35, h = imgDisplayH * 0.12;
  const x = Math.max(0, Math.min(pos.x - w / 2, imgDisplayW - w));
  const y = Math.max(0, Math.min(pos.y - h / 2, imgDisplayH - h));
  addZone(x, y, w, h);
  if (addMode) toggleAddMode();
}
container.addEventListener('mousedown', onCanvasDown);
container.addEventListener('touchstart', onCanvasDown, { passive: false });

// ─────────────────────────────────────────
// Zone management
// ─────────────────────────────────────────
function addZone(px, py, pw, ph, forceName) {
  zoneCounter++;
  const id = 'z' + zoneCounter;
  const { sx, sy } = getScale();
  const zone = {
    id, name: forceName || ('text_' + zoneCounter),
    align: 'center', rotation: 0,
    x: Math.round(px * sx), y: Math.round(py * sy),
    w: Math.round(pw * sx), h: Math.round(ph * sy)
  };
  zones.push(zone);
  renderZone(zone);
  selectZone(id);
  updateCount();
}

function applyZoneStyle(el, zone, sx, sy) {
  el.style.left   = (zone.x / sx) + 'px';
  el.style.top    = (zone.y / sy) + 'px';
  el.style.width  = (zone.w / sx) + 'px';
  el.style.height = (zone.h / sy) + 'px';
  el.style.transform = `rotate(${zone.rotation}deg)`;
  el.style.transformOrigin = 'center center';
}

function renderZone(zone) {
  const { sx, sy } = getScale();
  const el = document.createElement('div');
  el.className = 'text-zone';
  el.id = 'zone-' + zone.id;
  applyZoneStyle(el, zone, sx, sy);

  const label = document.createElement('div');
  label.className = 'zone-label';
  label.textContent = zone.name;
  el.appendChild(label);

  const delBtn = document.createElement('button');
  delBtn.className = 'zone-delete';
  delBtn.textContent = '×';
  delBtn.addEventListener('click',    e => { e.stopPropagation(); deleteZone(zone.id); });
  delBtn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); deleteZone(zone.id); });
  el.appendChild(delBtn);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resize-handle';
  resizeHandle.addEventListener('mousedown', e => { e.stopPropagation(); startResize(e, zone.id); });
  resizeHandle.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); startResize(e, zone.id); }, { passive: false });
  el.appendChild(resizeHandle);

  const rotateHandle = document.createElement('div');
  rotateHandle.className = 'rotate-handle';
  rotateHandle.textContent = '↻';
  rotateHandle.addEventListener('mousedown', e => { e.stopPropagation(); startRotate(e, zone.id); });
  rotateHandle.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); startRotate(e, zone.id); }, { passive: false });
  el.appendChild(rotateHandle);

  el.addEventListener('mousedown', e => {
    if (e.target === resizeHandle || e.target === rotateHandle || e.target === delBtn) return;
    startDrag(e, zone.id);
  });
  el.addEventListener('touchstart', e => {
    if (e.target === resizeHandle || e.target === rotateHandle || e.target === delBtn) return;
    startDrag(e, zone.id);
  }, { passive: false });

  el.addEventListener('click', () => selectZone(zone.id));
  container.appendChild(el);
}

function reRenderZone(zone) {
  const el = document.getElementById('zone-' + zone.id);
  if (!el) return;
  const { sx, sy } = getScale();
  applyZoneStyle(el, zone, sx, sy);
  el.querySelector('.zone-label').textContent = zone.name;
}

function deleteZone(id) {
  zones = zones.filter(z => z.id !== id);
  document.getElementById('zone-' + id)?.remove();
  if (selectedId === id) { selectedId = null; hideEditor(); }
  updateCount();
}

function selectZone(id) {
  document.querySelectorAll('.text-zone').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('.zone-label')?.classList.remove('selected');
  });
  selectedId = id;
  const el = document.getElementById('zone-' + id);
  if (el) { el.classList.add('selected'); el.querySelector('.zone-label')?.classList.add('selected'); }
  const zone = zones.find(z => z.id === id);
  if (zone) showEditor(zone);
}

function showEditor(zone) {
  document.getElementById('zone-editor').classList.add('visible');
  document.getElementById('zone-name').value = zone.name;
  document.getElementById('zone-rotate').value = zone.rotation;
  document.getElementById('rotate-val').textContent = zone.rotation + '°';
  scheduleRefit();
}

function hideEditor() {
  document.getElementById('zone-editor').classList.remove('visible');
  scheduleRefit();
}

document.getElementById('zone-name').addEventListener('input', e => {
  if (!selectedId) return;
  const zone = zones.find(z => z.id === selectedId);
  if (zone) { zone.name = e.target.value || 'zone_' + selectedId; reRenderZone(zone); }
});

document.getElementById('zone-rotate').addEventListener('input', e => {
  if (!selectedId) return;
  const zone = zones.find(z => z.id === selectedId);
  if (zone) {
    zone.rotation = parseInt(e.target.value);
    document.getElementById('rotate-val').textContent = zone.rotation + '°';
    reRenderZone(zone);
  }
});

// ─────────────────────────────────────────
// Drag / Resize / Rotate
// ─────────────────────────────────────────
function startDrag(e, id) {
  e.preventDefault(); dragging = id;
  const pos = getEventPos(e, container);
  const zone = zones.find(z => z.id === id);
  const { sx, sy } = getScale();
  dragStart = { mx: pos.x, my: pos.y, zx: zone.x / sx, zy: zone.y / sy };
  selectZone(id);
}

function startResize(e, id) {
  e.preventDefault(); resizing = id;
  const pos = getEventPos(e, container);
  const zone = zones.find(z => z.id === id);
  const { sx, sy } = getScale();
  resizeStart = { mx: pos.x, my: pos.y, zw: zone.w / sx, zh: zone.h / sy };
  selectZone(id);
}

function startRotate(e, id) {
  e.preventDefault(); rotating = id;
  const el = document.getElementById('zone-' + id);
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const cp = getClientPos(e);
  const zone = zones.find(z => z.id === id);
  rotateStart = { cx, cy, startAngle: Math.atan2(cp.y - cy, cp.x - cx) * 180 / Math.PI, initRotation: zone.rotation };
  selectZone(id);
}

document.addEventListener('mousemove', onMove);
document.addEventListener('touchmove', onMove, { passive: false });
document.addEventListener('mouseup', onUp);
document.addEventListener('touchend', onUp);

function onMove(e) {
  if (!dragging && !resizing && !rotating) return;
  e.preventDefault();
  const { sx, sy } = getScale();

  if (dragging) {
    const pos = getEventPos(e, container);
    const zone = zones.find(z => z.id === dragging);
    zone.x = Math.max(0, Math.min(Math.round((dragStart.zx + pos.x - dragStart.mx) * sx), imgNatW - zone.w));
    zone.y = Math.max(0, Math.min(Math.round((dragStart.zy + pos.y - dragStart.my) * sy), imgNatH - zone.h));
    reRenderZone(zone);
  }
  if (resizing) {
    const pos = getEventPos(e, container);
    const zone = zones.find(z => z.id === resizing);
    zone.w = Math.max(30, Math.min(Math.round((resizeStart.zw + pos.x - resizeStart.mx) * sx), imgNatW - zone.x));
    zone.h = Math.max(20, Math.min(Math.round((resizeStart.zh + pos.y - resizeStart.my) * sy), imgNatH - zone.y));
    reRenderZone(zone);
  }
  if (rotating) {
    const cp = getClientPos(e);
    const angle = Math.atan2(cp.y - rotateStart.cy, cp.x - rotateStart.cx) * 180 / Math.PI;
    const zone = zones.find(z => z.id === rotating);
    let newRot = rotateStart.initRotation + (angle - rotateStart.startAngle);
    newRot = ((newRot + 180) % 360 + 360) % 360 - 180;
    zone.rotation = Math.round(newRot);
    reRenderZone(zone);
    if (selectedId === rotating) {
      document.getElementById('zone-rotate').value = zone.rotation;
      document.getElementById('rotate-val').textContent = zone.rotation + '°';
    }
  }
}

function onUp() { dragging = null; resizing = null; rotating = null; }

// ─────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────
function clearAll(silent) {
  zones = []; zoneCounter = 0; selectedId = null; hideEditor();
  document.querySelectorAll('.text-zone').forEach(el => el.remove());
  updateCount();
  if (!silent) showToast('All zones cleared');
}

function updateCount() {
  document.getElementById('zone-count').textContent =
    zones.length + (zones.length === 1 ? ' zone' : ' zones');
}

function exportTemplate() {
  if (zones.length === 0) { showToast('Add at least one text zone!'); return; }
  const output = {
    template_name: 'template_' + Date.now(),
    image_hash: currentImageHash,
    uploader: window.originalUploader,   // add this
    image_width: imgNatW,
    image_height: imgNatH,
    text_zones: zones.map((z, i) => ({
      id: i + 1, name: z.name,
      x: z.x, y: z.y, w: z.w, h: z.h,
      rotation: z.rotation, align: z.align
    }))
  };
  const json = JSON.stringify(output);
  if (tg && tg.sendData) {
    tg.sendData(json); tg.close();
  } else {
    navigator.clipboard.writeText(JSON.stringify(output, null, 2))
      .then(() => showToast('JSON copied!'))
      .catch(() => prompt('Copy JSON:', JSON.stringify(output, null, 2)));
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
