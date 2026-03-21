
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let zones = [], selectedId = null;
let imgNatW = 0, imgNatH = 0, imgDisplayW = 0, imgDisplayH = 0;
let addMode = false, zoneCounter = 0;
let dragging = null, resizing = null, rotating = null;
let dragStart = {}, resizeStart = {}, rotateStart = {};
let currentImageHash = null;

const img = document.getElementById('meme-img');
const container = document.getElementById('canvas-container');

// const select = document.getElementById("zone-align");

// Object.entries(alignOptions).forEach(([label, value]) => {
//   const option = document.createElement("option");
//   option.value = value;
//   option.textContent = label;
//   select.appendChild(option);
//   });

document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  // MD5 runs separately, doesn't touch img.onload at all
  getMD5(file).then(hash => { currentImageHash = hash; });

  const reader = new FileReader();
  reader.onload = ev => {
    img.src = ev.target.result;
    img.style.display = 'block';
    document.getElementById('placeholder').style.display = 'none';
    img.onload = () => {   // stays sync, no async
      imgNatW = img.naturalWidth; imgNatH = img.naturalHeight;
      imgDisplayW = img.clientWidth; imgDisplayH = img.clientHeight;
      document.getElementById('add-zone-btn').style.display = '';
      document.getElementById('actions').style.display = '';
      document.getElementById('hint').style.display = '';
      document.getElementById('upload-section').querySelector('.btn-primary').textContent = '📁 Change';
    };
  };
  reader.readAsDataURL(file);
});

function getScale() {
  imgDisplayW = img.clientWidth; imgDisplayH = img.clientHeight;
  return { sx: imgNatW / imgDisplayW, sy: imgNatH / imgDisplayH };
}

function toggleAddMode() {
  addMode = !addMode;
  const btn = document.getElementById('add-zone-btn');
  btn.textContent = addMode ? '✕ Cancel' : '＋ Add Zone';
  btn.style.background = addMode ? 'var(--accent2)' : '';
  btn.style.color = addMode ? '#fff' : '';
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
  const x = Math.max(0, Math.min(pos.x - w/2, imgDisplayW - w));
  const y = Math.max(0, Math.min(pos.y - h/2, imgDisplayH - h));
  addZone(x, y, w, h);
  if (addMode) toggleAddMode();
}
container.addEventListener('mousedown', onCanvasDown);
container.addEventListener('touchstart', onCanvasDown, { passive: false });

function addZone(px, py, pw, ph) {
  zoneCounter++;
  const id = 'z' + zoneCounter;
  const { sx, sy } = getScale();
  const zone = {
    id, name: 'text_' + zoneCounter, align: 'center', rotation: 0,
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
  delBtn.addEventListener('click', e => { e.stopPropagation(); deleteZone(zone.id); });
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
  const alignEl = document.getElementById('zone-align');
  if (alignEl) alignEl.value = zone.align;   // won't crash if element missing
  document.getElementById('zone-rotate').value = zone.rotation;
  document.getElementById('rotate-val').textContent = zone.rotation + '°';
}


function hideEditor() { document.getElementById('zone-editor').classList.remove('visible'); }

document.getElementById('zone-name').addEventListener('input', e => {
  if (!selectedId) return;
  const zone = zones.find(z => z.id === selectedId);
  if (zone) { zone.name = e.target.value || 'zone_' + selectedId; reRenderZone(zone); }
});
document.getElementById('zone-align')?.addEventListener('change', e => {
  if (!selectedId) return;
  const zone = zones.find(z => z.id === selectedId);
  if (zone) zone.align = e.target.value;
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
  rotateStart = {
    cx, cy,
    startAngle: Math.atan2(cp.y - cy, cp.x - cx) * 180 / Math.PI,
    initRotation: zone.rotation
  };
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
    // Normalize to -180..180
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

function clearAll() {
  zones = []; zoneCounter = 0; selectedId = null; hideEditor();
  document.querySelectorAll('.text-zone').forEach(el => el.remove());
  updateCount(); showToast('All zones cleared');
}

function updateCount() {
  document.getElementById('zone-count').textContent =
    zones.length + (zones.length === 1 ? ' zone' : ' zones');
}

function getMD5(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(SparkMD5.ArrayBuffer.hash(e.target.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function exportTemplate() {
  if (zones.length === 0) { showToast('Add at least one text zone!'); return; }
  const output = {
    template_name: 'template_' + Date.now(),
    image_hash: currentImageHash,
    image_width: imgNatW,
    image_height: imgNatH,
    text_zones: zones.map((z, i) => ({
      id: i + 1,
      name: z.name,
      x: z.x, y: z.y,
      w: z.w, h: z.h,
      rotation: z.rotation,
      align: z.align
    }))
  };
  const json = JSON.stringify(output);
  if (tg && tg.sendData) {
    tg.sendData(json);
    tg.close();
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

window.addEventListener('resize', () => { if (img.src) zones.forEach(z => reRenderZone(z)); });