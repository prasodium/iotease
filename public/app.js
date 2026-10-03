'use strict';
// IoTEase front-end — vanilla JS, no build step.
const $app = document.getElementById('app');
const state = { user: null, devices: [], device: null, widgets: [], editing: false, es: null, history: {} };

// ---------- helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = r.status; throw e; }
  return data;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2200);
}
function modal(content) {
  const m = document.getElementById('modal'), c = document.getElementById('modal-card');
  c.replaceChildren(...[].concat(content));
  m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }
const num = (v, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
const fmt = n => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10);

// ---------- router ----------
async function route() {
  const hash = location.hash.slice(1);
  if (!state.user) {
    try { state.user = await api('/me'); } catch (_) { return renderAuth(); }
  }
  connectEvents();
  const m = hash.match(/^device\/(\w+)$/);
  if (m) return renderDevice(m[1]);
  return renderHome();
}
window.addEventListener('hashchange', route);

function connectEvents() {
  if (state.es) return;
  state.es = new EventSource('/api/events');
  state.es.addEventListener('pin', e => onPin(JSON.parse(e.data)));
  state.es.addEventListener('status', e => onStatus(JSON.parse(e.data)));
}
function topbar() {
  return h('div', { class: 'topbar' },
    h('div', { class: 'logo', onclick: () => (location.hash = '') }, h('img', { src: 'favicon.svg', alt: '' }), 'IoTEase'),
    h('div', { class: 'row' }, h('span', { class: 'muted small' }, state.user.name),
      h('button', { class: 'btn sm', onclick: logout }, 'Sign out')));
}
async function logout() {
  await api('/logout', 'POST');
  if (state.es) state.es.close();
  state.es = null; state.user = null; renderAuth();
}

// ---------- auth ----------
function renderAuth(mode = 'login') {
  const err = h('div', { class: 'err' });
  const name = h('input', { class: 'input', placeholder: 'Your name', autocomplete: 'name' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true });
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'At least 6 characters', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      try {
        state.user = await api(mode === 'login' ? '/login' : '/signup', 'POST', { name: name.value, email: email.value, password: pw.value });
        route();
      } catch (ex) { err.textContent = ex.message; }
    },
  },
    mode === 'signup' && h('label', { class: 'f' }, 'Name', name),
    h('label', { class: 'f' }, 'Email', email),
    h('label', { class: 'f' }, 'Password', pw),
    err,
    h('button', { class: 'btn primary', style: 'width:100%;margin-top:8px' }, mode === 'login' ? 'Sign in' : 'Create account'));
  $app.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'row', style: 'justify-content:center;margin-bottom:20px' }, h('img', { src: 'favicon.svg', width: 40, height: 40, alt: '' }), h('h1', {}, 'IoTEase')),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-bottom:4px' }, mode === 'login' ? 'Welcome back' : 'Create your account'),
      h('div', { class: 'muted small' }, 'Connect your devices and control them from anywhere.'),
      form),
    h('p', { class: 'muted', style: 'text-align:center' }, mode === 'login' ? 'New here? ' : 'Have an account? ',
      h('button', { class: 'btn link', onclick: () => renderAuth(mode === 'login' ? 'signup' : 'login') }, mode === 'login' ? 'Create an account' : 'Sign in'))));
}

// ---------- home ----------
async function renderHome() {
  state.device = null;
  state.devices = await api('/devices');
  const list = state.devices.length
    ? h('div', { class: 'grid-devices' }, state.devices.map(d => h('div', { class: 'card device-card', 'data-id': d.id, onclick: () => (location.hash = 'device/' + d.id) },
      h('h3', {}, d.name),
      h('div', { class: 'muted small', style: 'margin-top:8px' }, h('span', { class: 'dot' + (d.online ? ' on' : '') }), d.online ? 'Online' : 'Offline'))))
    : h('div', { class: 'card empty', style: 'margin-top:20px' }, h('div', { class: 'big' }, '💡'), h('h2', {}, 'Add your first device'),
      h('p', { class: 'muted' }, 'A device is anything you want to monitor or control — an ESP32, Arduino, Raspberry Pi or a script.'),
      h('button', { class: 'btn primary', onclick: addDevice }, '+ Add device'));
  $app.replaceChildren(topbar(), h('div', { class: 'wrap' },
    h('div', { class: 'row spread' }, h('h1', {}, 'My devices'), state.devices.length > 0 && h('button', { class: 'btn primary', onclick: addDevice }, '+ Add device')),
    list));
}
function addDevice() {
  const name = h('input', { class: 'input', value: 'My device', maxlength: 40 });
  modal([h('h2', {}, 'Add a device'), h('p', { class: 'muted' }, 'Give it a name you will recognise.'),
    h('label', { class: 'f' }, 'Device name', name),
    h('div', { class: 'row', style: 'margin-top:20px;justify-content:flex-end' },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const d = await api('/devices', 'POST', { name: name.value });
        closeModal(); location.hash = 'device/' + d.id; setTimeout(() => showConnect(), 300);
      } }, 'Create'))]);
  name.select();
}

// ---------- device page ----------
async function renderDevice(devId) {
  try {
    state.device = await api('/devices/' + devId);
    state.widgets = await api(`/devices/${devId}/widgets`);
  } catch (_) { location.hash = ''; return; }
  state.editing = false; state.history = {};
  await Promise.all([...new Set(state.widgets.filter(w => w.type === 'chart').map(w => w.pin))].map(async pin => {
    state.history[pin] = await api(`/devices/${devId}/history/${pin}`);
  }));
  drawDevice();
}
function drawDevice() {
  const d = state.device;
  const grid = h('div', { class: 'widgets' + (state.editing ? ' editing' : '') });
  grid.id = 'widgets';
  state.widgets.forEach(w => grid.append(widgetEl(w)));
  if (!state.widgets.length) grid.append(h('div', { class: 'card empty', style: 'grid-column:1/-1' }, h('div', { class: 'big' }, '🧩'), h('h2', {}, 'No widgets yet'), h('p', { class: 'muted' }, 'Add a switch, gauge or chart to get started.')));
  $app.replaceChildren(topbar(), h('div', { class: 'wrap' },
    h('button', { class: 'btn link', onclick: () => (location.hash = '') }, '← All devices'),
    h('div', { class: 'row spread' },
      h('div', {}, h('h1', {}, d.name), h('div', { class: 'muted small', id: 'status' }, h('span', { class: 'dot' + (d.online ? ' on' : '') }), d.online ? 'Online' : 'Offline — waiting for your device to connect')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: showConnect }, '🔌 Connect'),
        h('button', { class: 'btn', onclick: () => { state.editing = !state.editing; drawDevice(); } }, state.editing ? '✓ Done' : '✏️ Edit'),
        state.editing && h('button', { class: 'btn primary', onclick: () => widgetForm() }, '+ Add widget'),
        h('button', { class: 'btn', onclick: deviceSettings }, '⚙️'))),
    grid));
  state.widgets.filter(w => w.type === 'chart').forEach(drawChart);
}
function onStatus(e) {
  if (state.device && e.deviceId === state.device.id) {
    state.device.online = e.online;
    const s = document.getElementById('status');
    if (s) s.replaceChildren(h('span', { class: 'dot' + (e.online ? ' on' : '') }), e.online ? 'Online' : 'Offline — waiting for your device to connect');
  }
}
function onPin(e) {
  if (!state.device || e.deviceId !== state.device.id) return;
  state.device.pins[e.pin] = e.value;
  if (e.source === 'device') onStatus({ deviceId: e.deviceId, online: true });
  (state.history[e.pin] = state.history[e.pin] || []).push([Date.now(), e.value]);
  state.widgets.filter(w => w.pin === e.pin).forEach(w => {
    if (w.type === 'chart') drawChart(w);
    else { const old = document.querySelector(`[data-wid="${w.id}"]`); if (old && !old.contains(document.activeElement) && !old.dataset.busy) old.replaceWith(widgetEl(w)); }
  });
}
let sendTimers = {};
function sendPin(pin, value, throttle) {
  state.device.pins[pin] = String(value);
  const go = () => api(`/devices/${state.device.id}/pins/${pin}`, 'POST', { value: String(value) }).catch(e => toast(e.message));
  if (!throttle) return go();
  clearTimeout(sendTimers[pin]); sendTimers[pin] = setTimeout(go, 120);
}

// ---------- widgets ----------
const TYPES = {
  switch: { icon: '🔘', name: 'Switch', desc: 'Turn something on or off' },
  button: { icon: '⏺️', name: 'Button', desc: 'Press and hold to send a signal' },
  slider: { icon: '🎚️', name: 'Slider', desc: 'Set a level, like brightness' },
  gauge: { icon: '🌡️', name: 'Gauge', desc: 'Show a reading on a dial' },
  value: { icon: '🔢', name: 'Number', desc: 'Show the latest reading' },
  chart: { icon: '📈', name: 'Chart', desc: 'See readings over time' },
  led: { icon: '💡', name: 'Light', desc: 'Shows on/off status from device' },
  text: { icon: '💬', name: 'Message', desc: 'Show text sent by the device' },
};
function widgetEl(w) {
  const val = state.device.pins[w.pin];
  const body = h('div', { class: 'body' });
  const c = `--c:${w.color}`;
  switch (w.type) {
    case 'switch': {
      const on = val === '1' || val === 'true';
      body.append(h('button', { class: 'switch' + (on ? ' on' : ''), style: c, 'aria-label': w.label, 'aria-pressed': on, onclick: e => {
        const now = !e.currentTarget.classList.contains('on');
        e.currentTarget.classList.toggle('on', now); e.currentTarget.setAttribute('aria-pressed', now); sendPin(w.pin, now ? 1 : 0);
      } }));
      break;
    }
    case 'button': {
      const b = h('button', { class: 'pushbtn', style: c }, 'Press');
      const down = v => e => { e.preventDefault(); b.classList.toggle('down', v === 1); sendPin(w.pin, v); };
      b.addEventListener('pointerdown', down(1)); b.addEventListener('pointerup', down(0)); b.addEventListener('pointerleave', e => { if (b.classList.contains('down')) down(0)(e); });
      body.append(b);
      break;
    }
    case 'slider': {
      const out = h('div', { class: 'bigval' }, String(fmt(num(val, w.min))), h('small', {}, ' ' + w.unit));
      const r = h('input', { type: 'range', min: w.min, max: w.max, step: (w.max - w.min) > 20 ? 1 : 0.1, value: num(val, w.min), 'aria-label': w.label, style: c });
      r.addEventListener('input', () => { out.firstChild.nodeValue = String(fmt(+r.value)); sendPin(w.pin, r.value, true); });
      body.style.flexDirection = 'column'; body.append(out, r);
      break;
    }
    case 'gauge': body.append(gaugeSvg(w, val)); break;
    case 'value': body.append(h('div', { class: 'bigval', style: `color:${w.color}` }, val == null ? '—' : String(fmt(num(val))), h('small', {}, ' ' + w.unit))); break;
    case 'led': body.append(h('div', { class: 'led' + (num(val) > 0 ? ' on' : ''), style: c })); break;
    case 'text': body.append(h('div', { style: 'font-size:20px;text-align:center;word-break:break-word' }, val == null ? '—' : val)); break;
    case 'chart': body.append(h('canvas', { class: 'chart', 'data-chart': w.id })); break;
  }
  return h('div', { class: 'card widget' + (w.type === 'chart' ? ' wide' : ''), 'data-wid': w.id },
    h('h3', {}, w.label),
    h('div', { class: 'tools' },
      h('button', { class: 'btn sm', 'aria-label': 'Edit widget', onclick: () => widgetForm(w) }, '✏️'),
      h('button', { class: 'btn sm danger', 'aria-label': 'Delete widget', onclick: async () => {
        if (!confirm(`Delete "${w.label}"?`)) return;
        await api(`/devices/${state.device.id}/widgets/${w.id}`, 'DELETE');
        state.widgets = state.widgets.filter(x => x.id !== w.id); drawDevice();
      } }, '🗑️')),
    body);
}
function gaugeSvg(w, val) {
  const NS = 'http://www.w3.org/2000/svg';
  const v = num(val, w.min), t = Math.max(0, Math.min(1, (v - w.min) / (w.max - w.min)));
  const R = 70, cx = 90, cy = 90, pt = a => [cx + R * Math.cos(Math.PI * (1 - a)), cy - R * Math.sin(Math.PI * (1 - a))];
  const arc = (a) => { const [x, y] = pt(a); return `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${x} ${y}`; };
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 180 110'); svg.setAttribute('class', 'gauge'); svg.style.width = '100%'; svg.style.maxWidth = '200px';
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
  mk('path', { d: arc(1), fill: 'none', stroke: '#cbd5e1', 'stroke-width': 14, 'stroke-linecap': 'round' });
  if (t > 0) mk('path', { d: arc(t), fill: 'none', stroke: w.color, 'stroke-width': 14, 'stroke-linecap': 'round' });
  const tx = mk('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 700 }); tx.textContent = val == null ? '—' : fmt(v) + w.unit;
  const a = mk('text', { x: cx - R, y: cy + 16, 'text-anchor': 'middle', 'font-size': 11, opacity: .6 }); a.textContent = w.min;
  const b = mk('text', { x: cx + R, y: cy + 16, 'text-anchor': 'middle', 'font-size': 11, opacity: .6 }); b.textContent = w.max;
  return svg;
}
function drawChart(w) {
  const cv = document.querySelector(`canvas[data-chart="${w.id}"]`);
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.body);
  const data = (state.history[w.pin] || []).map(([t, v]) => [t, parseFloat(v)]).filter(p => Number.isFinite(p[1])).slice(-120);
  g.font = '11px system-ui'; g.fillStyle = css.getPropertyValue('--muted');
  if (data.length < 2) { g.textAlign = 'center'; g.fillText('Waiting for data…', W / 2, H / 2); return; }
  let lo = Math.min(...data.map(p => p[1])), hi = Math.max(...data.map(p => p[1]));
  if (lo === hi) { lo -= 1; hi += 1; }
  const padL = 34, padB = 16, t0 = data[0][0], t1 = data[data.length - 1][0] || t0 + 1;
  const X = t => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - 6), Y = v => 6 + (1 - (v - lo) / (hi - lo)) * (H - padB - 10);
  g.strokeStyle = css.getPropertyValue('--line'); g.textAlign = 'right';
  for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3, y = Y(v); g.beginPath(); g.moveTo(padL, y); g.lineTo(W, y); g.stroke(); g.fillText(String(fmt(v)), padL - 4, y + 4); }
  g.strokeStyle = w.color; g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath();
  data.forEach(([t, v], i) => (i ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v)))); g.stroke();
  g.fillStyle = css.getPropertyValue('--muted'); g.textAlign = 'left';
  g.fillText(new Date(t0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), padL, H - 2);
  g.textAlign = 'right'; g.fillText('now', W - 4, H - 2);
}
window.addEventListener('resize', () => state.widgets.filter(w => w.type === 'chart').forEach(drawChart));

function widgetForm(w) {
  if (!w) { // step 1: pick a type
    return modal([h('h2', {}, 'Add a widget'), h('p', { class: 'muted' }, 'What would you like to add?'),
      h('div', { class: 'pick' }, Object.entries(TYPES).map(([k, t]) => h('button', { onclick: () => widgetForm({ type: k, label: t.name, pin: 'V0', min: 0, max: 100, unit: '', color: '#2563eb', _new: true }) },
        h('div', { class: 'ic' }, t.icon), h('b', {}, t.name), h('span', {}, t.desc))))]);
  }
  const f = {};
  const field = (key, label, input, hint) => { f[key] = input; return h('label', { class: 'f' }, label, input, hint && h('div', { class: 'muted small' }, hint)); };
  const needsRange = ['slider', 'gauge'].includes(w.type);
  const needsUnit = ['slider', 'gauge', 'value', 'chart'].includes(w.type);
  const pinSel = h('select', { class: 'input' }, Array.from({ length: 10 }, (_, i) => h('option', { value: 'V' + i, selected: w.pin === 'V' + i }, `Channel V${i}`)));
  modal([h('h2', {}, (w._new ? 'New ' : 'Edit ') + TYPES[w.type].name.toLowerCase()),
    field('label', 'Name', h('input', { class: 'input', value: w.label, maxlength: 40 })),
    field('pin', 'Data channel', pinSel, 'Your device sends or reads data on this channel (V0–V9).'),
    needsRange && h('div', { class: 'row', style: 'gap:12px' }, h('div', { style: 'flex:1' }, field('min', 'Minimum', h('input', { class: 'input', type: 'number', value: w.min }))), h('div', { style: 'flex:1' }, field('max', 'Maximum', h('input', { class: 'input', type: 'number', value: w.max })))),
    needsUnit && field('unit', 'Unit (optional)', h('input', { class: 'input', value: w.unit, placeholder: '°C, %, V…', maxlength: 8 })),
    field('color', 'Colour', h('input', { class: 'input', type: 'color', value: w.color, style: 'padding:4px;height:44px' })),
    h('div', { class: 'row', style: 'margin-top:20px;justify-content:flex-end' },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const body = { type: w.type };
        for (const k in f) body[k] = f[k].value;
        const base = `/devices/${state.device.id}/widgets`;
        if (w._new) { const nw = await api(base, 'POST', body); state.widgets.push(nw); if (nw.type === 'chart') state.history[nw.pin] = await api(`/devices/${state.device.id}/history/${nw.pin}`); }
        else { const u = await api(`${base}/${w.id}`, 'PUT', body); state.widgets = state.widgets.map(x => (x.id === u.id ? u : x)); if (u.type === 'chart') state.history[u.pin] = await api(`/devices/${state.device.id}/history/${u.pin}`); }
        closeModal(); drawDevice();
      } }, w._new ? 'Add' : 'Save'))]);
}

// ---------- connect & settings ----------
function snippets(token) {
  const base = location.origin;
  return {
    'ESP32 / ESP8266': `// Arduino IDE · ESP32 (for ESP8266 use ESP8266WiFi.h + ESP8266HTTPClient.h)
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_NAME = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const String SERVER = "${base}";   // use your computer's LAN IP, not localhost
const String TOKEN  = "${token}";

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  WiFi.begin(WIFI_NAME, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
}

String call(String path) {
  HTTPClient http;
  http.begin(SERVER + path);
  http.GET();
  String body = http.getString();
  http.end();
  return body;
}

void loop() {
  float temperature = 24.5;                       // replace with your sensor reading
  call("/device/update?token=" + TOKEN + "&V1=" + String(temperature));

  String v = call("/device/get?token=" + TOKEN + "&V0");   // {"V0":"1"}
  digitalWrite(2, v.indexOf("\\"1\\"") >= 0 ? HIGH : LOW);
  delay(2000);
}`,
    Python: `# pip install requests   (works on Raspberry Pi too)
import time, random, requests

SERVER = "${base}"
TOKEN = "${token}"

while True:
    temperature = 20 + random.random() * 10          # replace with a real sensor
    requests.get(f"{SERVER}/device/update", params={"token": TOKEN, "V1": round(temperature, 1)})
    switch = requests.get(f"{SERVER}/device/get", params={"token": TOKEN, "V0": ""}).json()
    print("Switch V0 is", switch.get("V0"))
    time.sleep(2)`,
    curl: `# Send a value
curl "${base}/device/update?token=${token}&V1=23.5"

# Read a value
curl "${base}/device/get?token=${token}&V0"

# Send several at once (JSON)
curl -X POST ${base}/device/update -H "Content-Type: application/json" \\
  -d '{"token":"${token}","V1":23.5,"V2":61}'`,
  };
}
function showConnect() {
  if (!state.device) return;
  const s = snippets(state.device.token);
  const code = h('pre', {}); const tabs = h('div', { class: 'tabs' });
  const pick = k => { code.textContent = s[k]; [...tabs.children].forEach(b => b.classList.toggle('active', b.textContent === k)); };
  Object.keys(s).forEach(k => tabs.append(h('button', { onclick: () => pick(k) }, k)));
  modal([h('h2', {}, 'Connect your device'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Copy your device key below.'),
      h('li', {}, 'Paste it into the code for your device.'),
      h('li', {}, 'Run it — this page will show "Online" within seconds.')),
    h('div', { class: 'muted small' }, 'Device key'),
    h('div', { class: 'row', style: 'margin:6px 0 10px' }, h('div', { class: 'token', style: 'flex:1' }, state.device.token),
      h('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText(state.device.token).then(() => toast('Key copied')); } }, 'Copy')),
    tabs, code,
    h('div', { class: 'row', style: 'margin-top:16px;justify-content:space-between' },
      h('button', { class: 'btn sm', onclick: () => navigator.clipboard.writeText(code.textContent).then(() => toast('Code copied')) }, 'Copy code'),
      h('button', { class: 'btn primary', onclick: closeModal }, 'Done'))]);
  pick('ESP32 / ESP8266');
}
function deviceSettings() {
  const name = h('input', { class: 'input', value: state.device.name, maxlength: 40 });
  modal([h('h2', {}, 'Device settings'), h('label', { class: 'f' }, 'Name', name),
    h('div', { class: 'row', style: 'margin-top:20px' },
      h('button', { class: 'btn primary', onclick: async () => { state.device = { ...state.device, ...(await api('/devices/' + state.device.id, 'PUT', { name: name.value })) }; closeModal(); drawDevice(); } }, 'Save name'),
      h('button', { class: 'btn', onclick: async () => { if (!confirm('Make a new key? Your device must be updated with it.')) return; state.device = await api(`/devices/${state.device.id}/token`, 'POST'); closeModal(); showConnect(); } }, 'New device key'),
      h('button', { class: 'btn danger', onclick: async () => { if (!confirm('Delete this device and all its data?')) return; await api('/devices/' + state.device.id, 'DELETE'); closeModal(); location.hash = ''; } }, 'Delete device'))]);
}

route();
