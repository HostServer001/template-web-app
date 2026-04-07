# ─────────────────────────────────────────
# Meme Template Builder — PyScript version
# Drop this inside a <script type="py"> tag
# ─────────────────────────────────────────

import json
import math
from pyodide.ffi import create_proxy
from pyscript import document, window

# ── Telegram WebApp ──
tg = window.Telegram.WebApp if hasattr(window.Telegram, 'WebApp') else None
if tg:
    tg.ready()
    tg.expand()

# ── Global state ──
zones        = []
selected_id  = None
img_nat_w    = 0
img_nat_h    = 0
img_disp_w   = 0
img_disp_h   = 0
add_mode     = False
zone_counter = 0
dragging     = None
resizing     = None
rotating     = None
drag_start   = {}
resize_start = {}
rotate_start = {}
current_image_hash   = None
original_uploader    = None
_refit_scheduled     = False

# ── DOM references ──
img        = document.getElementById('meme-img')
container  = document.getElementById('canvas-container')
canvas_wrap = document.getElementById('canvas-wrap')
app_el     = document.getElementById('app')

# ─────────────────────────────────────────
# VIEWPORT HEIGHT
# ─────────────────────────────────────────
def apply_viewport_height():
    if tg and tg.viewportStableHeight > 100:
        h = tg.viewportStableHeight
    elif tg and tg.viewportHeight > 100:
        h = tg.viewportHeight
    else:
        h = window.innerHeight
    app_el.style.height = f"{h}px"

apply_viewport_height()

def on_viewport_changed(e):
    apply_viewport_height()
    schedule_refit()

def on_window_resize(e):
    apply_viewport_height()
    schedule_refit()

if tg:
    tg.onEvent('viewportChanged', create_proxy(on_viewport_changed))

window.addEventListener('resize', create_proxy(on_window_resize))

# ─────────────────────────────────────────
# REFIT
# ─────────────────────────────────────────
def schedule_refit():
    # Use JS setTimeout as a lightweight debounce (rAF not easily available in PyScript)
    def do_refit(e=None):
        global img_nat_w, img_nat_h
        if not img_nat_w or not img_nat_h:
            return
        fit_image()
        for z in zones:
            re_render_zone(z)
    window.setTimeout(create_proxy(do_refit), 16)  # ~1 frame

def fit_image():
    global img_disp_w, img_disp_h
    wrap_w = canvas_wrap.clientWidth
    wrap_h = canvas_wrap.clientHeight
    if not wrap_w or not wrap_h or not img_nat_w or not img_nat_h:
        return
    scale = min(wrap_w / img_nat_w, wrap_h / img_nat_h)
    img_disp_w = int(img_nat_w * scale)
    img_disp_h = int(img_nat_h * scale)
    img.style.width    = f"{img_disp_w}px"
    img.style.height   = f"{img_disp_h}px"
    img.style.maxWidth  = 'none'
    img.style.maxHeight = 'none'

# ─────────────────────────────────────────
# PRESETS
# ─────────────────────────────────────────
PRESETS = [
    {'label': '⬆ Top Caption',       'zones': [{'name': 'top_text',    'x': 0.05, 'y': 0.02, 'w': 0.90, 'h': 0.14}]},
    {'label': '⬇ Bottom Caption',    'zones': [{'name': 'bottom_text', 'x': 0.05, 'y': 0.84, 'w': 0.90, 'h': 0.14}]},
    {'label': '↕ Top + Bottom',      'zones': [{'name': 'top_text',    'x': 0.05, 'y': 0.02, 'w': 0.90, 'h': 0.14},
                                                {'name': 'bottom_text','x': 0.05, 'y': 0.84, 'w': 0.90, 'h': 0.14}]},
    {'label': '🔲 2×2 Grid',         'zones': [{'name': 'top_left',    'x': 0.02, 'y': 0.02, 'w': 0.46, 'h': 0.46},
                                                {'name': 'top_right',  'x': 0.52, 'y': 0.02, 'w': 0.46, 'h': 0.46},
                                                {'name': 'bottom_left','x': 0.02, 'y': 0.52, 'w': 0.46, 'h': 0.46},
                                                {'name': 'bottom_right','x': 0.52,'y': 0.52, 'w': 0.46, 'h': 0.46}]},
    {'label': '◼ Center Box',        'zones': [{'name': 'center_text', 'x': 0.10, 'y': 0.35, 'w': 0.80, 'h': 0.30}]},
    {'label': '🔛 Full Width Strip', 'zones': [{'name': 'strip_text',  'x': 0.00, 'y': 0.42, 'w': 1.00, 'h': 0.16}]},
    {'label': '↔ Left + Right',      'zones': [{'name': 'left_text',   'x': 0.02, 'y': 0.10, 'w': 0.44, 'h': 0.80},
                                                {'name': 'right_text', 'x': 0.54, 'y': 0.10, 'w': 0.44, 'h': 0.80}]},
    {'label': '🗨 Speech Bubble',    'zones': [{'name': 'bubble_text', 'x': 0.30, 'y': 0.03, 'w': 0.65, 'h': 0.22}]},
    {'label': '🏷 Label Bottom-Left','zones': [{'name': 'label_text',  'x': 0.03, 'y': 0.78, 'w': 0.45, 'h': 0.18}]},
    {'label': '📋 3 Rows',           'zones': [{'name': 'row_1',       'x': 0.05, 'y': 0.02, 'w': 0.90, 'h': 0.14},
                                                {'name': 'row_2',      'x': 0.05, 'y': 0.43, 'w': 0.90, 'h': 0.14},
                                                {'name': 'row_3',      'x': 0.05, 'y': 0.84, 'w': 0.90, 'h': 0.14}]},
]

def build_preset_chips():
    scroll_el = document.getElementById('presets-scroll')
    scrolling = [False]  # use list so inner functions can mutate it

    def on_scroll(e):
        scrolling[0] = True
        def reset(e=None): scrolling[0] = False
        window.setTimeout(create_proxy(reset), 150)

    scroll_el.addEventListener('scroll', create_proxy(on_scroll))

    for i, preset in enumerate(PRESETS):
        chip = document.createElement('button')
        chip.className = 'preset-chip'
        chip.textContent = preset['label']

        # capture i in closure
        def make_click(idx):
            def on_click(e):
                if not scrolling[0]:
                    apply_preset(idx)
            return on_click

        chip.addEventListener('click', create_proxy(make_click(i)))
        scroll_el.appendChild(chip)

build_preset_chips()

def apply_preset(index):
    if not img_nat_w:
        show_toast('Image not loaded yet')
        return
    clear_all(silent=True)
    for z in PRESETS[index]['zones']:
        add_zone(
            z['x'] * img_disp_w, z['y'] * img_disp_h,
            z['w'] * img_disp_w, z['h'] * img_disp_h,
            z['name']
        )
    label = PRESETS[index]['label']
    # strip leading emoji + space
    show_toast('Applied: ' + label[2:] if len(label) > 2 else label)

# ─────────────────────────────────────────
# IMAGE LOADING
# ─────────────────────────────────────────
def wait_for_stable_height(cb):
    if not tg:
        window.setTimeout(create_proxy(cb), 50)
        return

    state = {'prev': 0, 'stable': 0}

    def check(e=None):
        h = tg.viewportStableHeight or tg.viewportHeight or window.innerHeight
        if h > 100 and h == state['prev']:
            state['stable'] += 1
            if state['stable'] >= 3:
                cb()
                return
        else:
            state['stable'] = 0
        state['prev'] = h
        window.setTimeout(create_proxy(check), 50)

    window.setTimeout(create_proxy(check), 100)

def load_image_from_url():
    global current_image_hash, original_uploader

    params  = window.URLSearchParams.new(window.location.search)
    temp_url = params.get('image_url')

    if not temp_url:
        document.getElementById('placeholder').innerHTML = (
            '<div class="placeholder-icon">⚠️</div><p>No image_url provided</p>'
        )
        return

    document.getElementById('placeholder').innerHTML = (
        '<div class="loader"></div><p>Loading image…</p>'
    )

    img.src = temp_url
    img.style.display = 'none'

    def on_load(e):
        global img_nat_w, img_nat_h, current_image_hash, original_uploader
        img_nat_w = img.naturalWidth
        img_nat_h = img.naturalHeight

        document.getElementById('top-actions').style.display = ''
        document.getElementById('presets-section').classList.add('visible')
        document.getElementById('actions').style.display = ''
        document.getElementById('hint').style.display = ''

        def after_layout(e=None):
            fit_image()
            img.style.display = 'block'
            document.getElementById('placeholder').style.display = 'none'
            h = params.get('image_hash')
            current_image_hash = h if h else simple_hash(temp_url)
            original_uploader  = params.get('uploader') or None

        # double delay to let layout settle (mimics double rAF)
        window.setTimeout(create_proxy(after_layout), 32)

    def on_error(e):
        document.getElementById('placeholder').innerHTML = (
            '<div class="placeholder-icon">⚠️</div><p>Failed to load image</p>'
        )
        show_toast('Failed to load image!')

    img.onload  = create_proxy(on_load)
    img.onerror = create_proxy(on_error)

def simple_hash(s):
    # lightweight hash since SparkMD5 is a JS lib we can't call directly
    h = 0
    for c in s:
        h = (h * 31 + ord(c)) & 0xFFFFFFFF
    return hex(h)[2:]

def start(_=None):
    apply_viewport_height()
    load_image_from_url()

wait_for_stable_height(start)

# ─────────────────────────────────────────
# Core helpers
# ─────────────────────────────────────────
def get_scale():
    sx = img_nat_w / img_disp_w if img_disp_w else 1
    sy = img_nat_h / img_disp_h if img_disp_h else 1
    return sx, sy

def toggle_add_mode(e=None):
    global add_mode
    add_mode = not add_mode
    btn = document.getElementById('add-zone-btn')
    btn.textContent = '✕ Cancel' if add_mode else '＋ Add Zone'
    if add_mode:
        btn.classList.add('cancel-mode')
    else:
        btn.classList.remove('cancel-mode')
    container.style.cursor = 'crosshair' if add_mode else 'default'

# expose to HTML onclick=""
window.toggleAddMode = create_proxy(toggle_add_mode)

def get_event_pos(e, el):
    rect = el.getBoundingClientRect()
    src  = e.touches[0] if e.touches and e.touches.length > 0 else e
    return src.clientX - rect.left, src.clientY - rect.top

def get_client_pos(e):
    src = e.touches[0] if e.touches and e.touches.length > 0 else e
    return src.clientX, src.clientY

# ─────────────────────────────────────────
# Canvas click — add zone
# ─────────────────────────────────────────
def on_canvas_down(e):
    if not add_mode or not img.src:
        return
    if e.target != img and e.target != container:
        return
    e.preventDefault()
    px, py = get_event_pos(e, container)
    w = img_disp_w * 0.35
    h = img_disp_h * 0.12
    x = max(0, min(px - w / 2, img_disp_w - w))
    y = max(0, min(py - h / 2, img_disp_h - h))
    add_zone(x, y, w, h)
    if add_mode:
        toggle_add_mode()

container.addEventListener('mousedown',  create_proxy(on_canvas_down))
container.addEventListener('touchstart', create_proxy(on_canvas_down))

# ─────────────────────────────────────────
# Zone management
# ─────────────────────────────────────────
def add_zone(px, py, pw, ph, force_name=None):
    global zone_counter
    zone_counter += 1
    zone_id = f'z{zone_counter}'
    sx, sy  = get_scale()
    zone = {
        'id':       zone_id,
        'name':     force_name or f'text_{zone_counter}',
        'align':    'center',
        'rotation': 0,
        'x':        round(px * sx),
        'y':        round(py * sy),
        'w':        round(pw * sx),
        'h':        round(ph * sy),
    }
    zones.append(zone)
    render_zone(zone)
    select_zone(zone_id)
    update_count()

def apply_zone_style(el, zone, sx, sy):
    el.style.left      = f"{zone['x'] / sx}px"
    el.style.top       = f"{zone['y'] / sy}px"
    el.style.width     = f"{zone['w'] / sx}px"
    el.style.height    = f"{zone['h'] / sy}px"
    el.style.transform = f"rotate({zone['rotation']}deg)"
    el.style.transformOrigin = 'center center'

def render_zone(zone):
    sx, sy = get_scale()
    el = document.createElement('div')
    el.className = 'text-zone'
    el.id = f"zone-{zone['id']}"
    apply_zone_style(el, zone, sx, sy)

    label = document.createElement('div')
    label.className = 'zone-label'
    label.textContent = zone['name']
    el.appendChild(label)

    del_btn = document.createElement('button')
    del_btn.className = 'zone-delete'
    del_btn.textContent = '×'

    def make_delete(zid):
        def on_del(e):
            e.stopPropagation()
            delete_zone(zid)
        return on_del

    del_btn.addEventListener('click',    create_proxy(make_delete(zone['id'])))
    del_btn.addEventListener('touchend', create_proxy(make_delete(zone['id'])))
    el.appendChild(del_btn)

    resize_handle = document.createElement('div')
    resize_handle.className = 'resize-handle'

    def make_resize(zid):
        def on_resize_down(e):
            e.stopPropagation()
            start_resize(e, zid)
        return on_resize_down

    resize_handle.addEventListener('mousedown',  create_proxy(make_resize(zone['id'])))
    resize_handle.addEventListener('touchstart', create_proxy(make_resize(zone['id'])))
    el.appendChild(resize_handle)

    rotate_handle = document.createElement('div')
    rotate_handle.className = 'rotate-handle'
    rotate_handle.textContent = '↻'

    def make_rotate(zid):
        def on_rotate_down(e):
            e.stopPropagation()
            start_rotate(e, zid)
        return on_rotate_down

    rotate_handle.addEventListener('mousedown',  create_proxy(make_rotate(zone['id'])))
    rotate_handle.addEventListener('touchstart', create_proxy(make_rotate(zone['id'])))
    el.appendChild(rotate_handle)

    def make_drag(zid):
        def on_drag_down(e):
            if e.target == resize_handle or e.target == rotate_handle or e.target == del_btn:
                return
            start_drag(e, zid)
        return on_drag_down

    el.addEventListener('mousedown',  create_proxy(make_drag(zone['id'])))
    el.addEventListener('touchstart', create_proxy(make_drag(zone['id'])))

    def make_select(zid):
        def on_click(e): select_zone(zid)
        return on_click

    el.addEventListener('click', create_proxy(make_select(zone['id'])))
    container.appendChild(el)

def re_render_zone(zone):
    el = document.getElementById(f"zone-{zone['id']}")
    if not el:
        return
    sx, sy = get_scale()
    apply_zone_style(el, zone, sx, sy)
    el.querySelector('.zone-label').textContent = zone['name']

def delete_zone(zone_id):
    global zones, selected_id
    zones = [z for z in zones if z['id'] != zone_id]
    el = document.getElementById(f'zone-{zone_id}')
    if el:
        el.remove()
    if selected_id == zone_id:
        selected_id = None
        hide_editor()
    update_count()

def select_zone(zone_id):
    global selected_id
    for el in document.querySelectorAll('.text-zone'):
        el.classList.remove('selected')
        lbl = el.querySelector('.zone-label')
        if lbl:
            lbl.classList.remove('selected')
    selected_id = zone_id
    el = document.getElementById(f'zone-{zone_id}')
    if el:
        el.classList.add('selected')
        lbl = el.querySelector('.zone-label')
        if lbl:
            lbl.classList.add('selected')
    zone = next((z for z in zones if z['id'] == zone_id), None)
    if zone:
        show_editor(zone)

def show_editor(zone):
    document.getElementById('zone-editor').classList.add('visible')
    document.getElementById('zone-name').value   = zone['name']
    document.getElementById('zone-rotate').value = zone['rotation']
    document.getElementById('rotate-val').textContent = f"{zone['rotation']}°"
    schedule_refit()

def hide_editor():
    document.getElementById('zone-editor').classList.remove('visible')
    schedule_refit()

# Zone name input
def on_name_input(e):
    if not selected_id:
        return
    zone = next((z for z in zones if z['id'] == selected_id), None)
    if zone:
        zone['name'] = e.target.value or f"zone_{selected_id}"
        re_render_zone(zone)

document.getElementById('zone-name').addEventListener('input', create_proxy(on_name_input))

# Zone rotate slider
def on_rotate_input(e):
    if not selected_id:
        return
    zone = next((z for z in zones if z['id'] == selected_id), None)
    if zone:
        zone['rotation'] = int(e.target.value)
        document.getElementById('rotate-val').textContent = f"{zone['rotation']}°"
        re_render_zone(zone)

document.getElementById('zone-rotate').addEventListener('input', create_proxy(on_rotate_input))

# ─────────────────────────────────────────
# Drag / Resize / Rotate
# ─────────────────────────────────────────
def start_drag(e, zone_id):
    global dragging, drag_start
    e.preventDefault()
    dragging = zone_id
    px, py   = get_event_pos(e, container)
    zone     = next((z for z in zones if z['id'] == zone_id), None)
    sx, sy   = get_scale()
    drag_start = {
        'mx': px, 'my': py,
        'zx': zone['x'] / sx,
        'zy': zone['y'] / sy,
    }
    select_zone(zone_id)

def start_resize(e, zone_id):
    global resizing, resize_start
    e.preventDefault()
    resizing = zone_id
    px, py   = get_event_pos(e, container)
    zone     = next((z for z in zones if z['id'] == zone_id), None)
    sx, sy   = get_scale()
    resize_start = {
        'mx': px, 'my': py,
        'zw': zone['w'] / sx,
        'zh': zone['h'] / sy,
    }
    select_zone(zone_id)

def start_rotate(e, zone_id):
    global rotating, rotate_start
    e.preventDefault()
    rotating = zone_id
    el   = document.getElementById(f'zone-{zone_id}')
    rect = el.getBoundingClientRect()
    cx   = rect.left + rect.width  / 2
    cy   = rect.top  + rect.height / 2
    cpx, cpy = get_client_pos(e)
    zone = next((z for z in zones if z['id'] == zone_id), None)
    rotate_start = {
        'cx': cx, 'cy': cy,
        'start_angle':   math.atan2(cpy - cy, cpx - cx) * 180 / math.pi,
        'init_rotation': zone['rotation'],
    }
    select_zone(zone_id)

def on_move(e):
    if not dragging and not resizing and not rotating:
        return
    e.preventDefault()
    sx, sy = get_scale()

    if dragging:
        px, py = get_event_pos(e, container)
        zone   = next((z for z in zones if z['id'] == dragging), None)
        zone['x'] = max(0, min(round((drag_start['zx'] + px - drag_start['mx']) * sx), img_nat_w - zone['w']))
        zone['y'] = max(0, min(round((drag_start['zy'] + py - drag_start['my']) * sy), img_nat_h - zone['h']))
        re_render_zone(zone)

    if resizing:
        px, py = get_event_pos(e, container)
        zone   = next((z for z in zones if z['id'] == resizing), None)
        zone['w'] = max(30, min(round((resize_start['zw'] + px - resize_start['mx']) * sx), img_nat_w - zone['x']))
        zone['h'] = max(20, min(round((resize_start['zh'] + py - resize_start['my']) * sy), img_nat_h - zone['y']))
        re_render_zone(zone)

    if rotating:
        cpx, cpy = get_client_pos(e)
        angle    = math.atan2(cpy - rotate_start['cy'], cpx - rotate_start['cx']) * 180 / math.pi
        zone     = next((z for z in zones if z['id'] == rotating), None)
        new_rot  = rotate_start['init_rotation'] + (angle - rotate_start['start_angle'])
        new_rot  = ((new_rot + 180) % 360 + 360) % 360 - 180
        zone['rotation'] = round(new_rot)
        re_render_zone(zone)
        if selected_id == rotating:
            document.getElementById('zone-rotate').value = zone['rotation']
            document.getElementById('rotate-val').textContent = f"{zone['rotation']}°"

def on_up(e):
    global dragging, resizing, rotating
    dragging = resizing = rotating = None

document.addEventListener('mousemove', create_proxy(on_move))
document.addEventListener('touchmove', create_proxy(on_move))
document.addEventListener('mouseup',   create_proxy(on_up))
document.addEventListener('touchend',  create_proxy(on_up))

# ─────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────
def clear_all(e=None, silent=False):
    global zones, zone_counter, selected_id
    # handle being called from HTML onclick (e will be the event)
    if isinstance(e, bool):   # called as clear_all(silent=True)
        silent = e
        e = None
    zones        = []
    zone_counter = 0
    selected_id  = None
    hide_editor()
    for el in document.querySelectorAll('.text-zone'):
        el.remove()
    update_count()
    if not silent:
        show_toast('All zones cleared')

window.clearAll = create_proxy(clear_all)

def update_count():
    n = len(zones)
    document.getElementById('zone-count').textContent = (
        f"{n} zone" if n == 1 else f"{n} zones"
    )

def export_template(e=None):
    if not zones:
        show_toast('Add at least one text zone!')
        return
    import time
    output = {
        'template_name': f'template_{int(window.Date.now())}',
        'image_hash':    current_image_hash,
        'uploader':      original_uploader,
        'image_width':   img_nat_w,
        'image_height':  img_nat_h,
        'text_zones': [
            {
                'id':       i + 1,
                'name':     z['name'],
                'x':        z['x'],
                'y':        z['y'],
                'w':        z['w'],
                'h':        z['h'],
                'rotation': z['rotation'],
                'align':    z['align'],
            }
            for i, z in enumerate(zones)
        ],
    }
    json_str = json.dumps(output)
    if tg and hasattr(tg, 'sendData'):
        tg.sendData(json_str)
        tg.close()
    else:
        # fallback: copy to clipboard via JS
        window.navigator.clipboard.writeText(
            json.dumps(output, indent=2)
        ).then(
            create_proxy(lambda _: show_toast('JSON copied!'))
        )

window.exportTemplate = create_proxy(export_template)

def show_toast(msg):
    t = document.getElementById('toast')
    t.textContent = msg
    t.classList.add('show')
    def hide(e=None): t.classList.remove('show')
    window.setTimeout(create_proxy(hide), 2200)
