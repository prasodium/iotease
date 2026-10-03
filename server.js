'use strict';
// IoTEase server — zero dependencies. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const ONLINE_MS = 30000;
const HISTORY_MAX = 500;
const PIN_RE = /^V\d{1,2}$/;

// ---------- storage (JSON file, atomic writes) ----------
let db = { users: [], sessions: {}, devices: [], widgets: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (_) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}
process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });

const id = (n = 8) => crypto.randomBytes(n).toString('hex');
const newToken = () => crypto.randomBytes(18).toString('base64url');

// ---------- auth ----------
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPw(pw, u) {
  const a = Buffer.from(hashPw(pw, u.salt).hash, 'hex');
  const b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function userOf(req) {
  const sid = cookies(req).sid;
  const s = sid && db.sessions[sid];
  return s ? db.users.find(u => u.id === s.userId) : null;
}
const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

// ---------- realtime (Server-Sent Events) ----------
const clients = new Set(); // {res, userId}
function emit(userId, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (c.userId === userId) c.res.write(msg);
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);
// notify when devices go offline
const wasOnline = new Map();
setInterval(() => {
  for (const d of db.devices) {
    const on = isOnline(d);
    if (wasOnline.get(d.id) !== on) { wasOnline.set(d.id, on); emit(d.userId, 'status', { deviceId: d.id, online: on }); }
  }
}, 5000);
const isOnline = d => d.lastSeen && Date.now() - d.lastSeen < ONLINE_MS;

function setPin(device, pin, value, source) {
  value = String(value).slice(0, 200);
  device.pins = device.pins || {};
  device.pins[pin] = value;
  device.history = device.history || {};
  const h = (device.history[pin] = device.history[pin] || []);
  h.push([Date.now(), value]);
  if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
  emit(device.userId, 'pin', { deviceId: device.id, pin, value, source });
  save();
}
function deviceView(d) {
  return { id: d.id, name: d.name, token: d.token, online: !!isOnline(d), lastSeen: d.lastSeen || null, pins: d.pins || {}, createdAt: d.createdAt };
}

// ---------- helpers ----------
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && body !== null;
  res.writeHead(code, Object.assign({ 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8' }, headers));
  res.end(isObj ? JSON.stringify(body) : String(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100000) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
const WIDGET_TYPES = ['switch', 'button', 'slider', 'gauge', 'value', 'chart', 'led', 'text'];
function cleanWidget(w) {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
  const out = {
    type: WIDGET_TYPES.includes(w.type) ? w.type : 'value',
    label: String(w.label || 'Untitled').slice(0, 40),
    pin: PIN_RE.test(w.pin) ? w.pin : 'V0',
    min: num(w.min, 0), max: num(w.max, 100),
    unit: String(w.unit || '').slice(0, 8),
    color: /^#[0-9a-fA-F]{6}$/.test(w.color) ? w.color : '#2563eb',
  };
  if (out.max <= out.min) out.max = out.min + 1;
  return out;
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  let body = {};
  if (m === 'POST' || m === 'PUT') body = await readBody(req);

  // --- public auth routes
  if (p === '/api/signup' && m === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 40) || email.split('@')[0];
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Please enter a valid email.' });
    if (String(body.password || '').length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });
    if (db.users.some(u => u.email === email)) return send(res, 409, { error: 'That email is already registered.' });
    const user = { id: id(), email, name, ...hashPw(body.password) };
    db.users.push(user); save();
    return startSession(res, user);
  }
  if (p === '/api/login' && m === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const user = db.users.find(u => u.email === email);
    if (!user || !checkPw(String(body.password || ''), user)) return send(res, 401, { error: 'Wrong email or password.' });
    return startSession(res, user);
  }
  if (p === '/api/logout' && m === 'POST') {
    delete db.sessions[cookies(req).sid]; save();
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
  }

  const user = userOf(req);
  if (!user) return send(res, 401, { error: 'Please sign in.' });

  if (p === '/api/me' && m === 'GET') return send(res, 200, publicUser(user));

  if (p === '/api/events' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const c = { res, userId: user.id };
    clients.add(c);
    req.on('close', () => clients.delete(c));
    return;
  }

  const mine = db.devices.filter(d => d.userId === user.id);
  if (p === '/api/devices' && m === 'GET') return send(res, 200, mine.map(deviceView));
  if (p === '/api/devices' && m === 'POST') {
    if (mine.length >= 50) return send(res, 400, { error: 'Device limit reached.' });
    const d = { id: id(), userId: user.id, name: String(body.name || 'My device').slice(0, 40), token: newToken(), createdAt: Date.now(), pins: {}, history: {} };
    db.devices.push(d);
    // starter widgets so a new device is never an empty page
    db.widgets.push(
      { id: id(), deviceId: d.id, ...cleanWidget({ type: 'switch', label: 'Light', pin: 'V0' }) },
      { id: id(), deviceId: d.id, ...cleanWidget({ type: 'gauge', label: 'Temperature', pin: 'V1', min: 0, max: 50, unit: '°C', color: '#ef4444' }) },
      { id: id(), deviceId: d.id, ...cleanWidget({ type: 'chart', label: 'Temperature history', pin: 'V1', color: '#ef4444' }) },
    );
    save();
    return send(res, 201, deviceView(d));
  }

  let mm = p.match(/^\/api\/devices\/(\w+)(?:\/(.*))?$/);
  if (mm) {
    const d = mine.find(x => x.id === mm[1]);
    if (!d) return send(res, 404, { error: 'Device not found.' });
    const rest = mm[2] || '';
    if (rest === '' && m === 'GET') return send(res, 200, deviceView(d));
    if (rest === '' && m === 'PUT') { if (body.name) d.name = String(body.name).slice(0, 40); save(); return send(res, 200, deviceView(d)); }
    if (rest === '' && m === 'DELETE') {
      db.devices = db.devices.filter(x => x !== d);
      db.widgets = db.widgets.filter(w => w.deviceId !== d.id); save();
      return send(res, 200, { ok: true });
    }
    if (rest === 'token' && m === 'POST') { d.token = newToken(); save(); return send(res, 200, deviceView(d)); }
    if (rest === 'widgets' && m === 'GET') return send(res, 200, db.widgets.filter(w => w.deviceId === d.id));
    if (rest === 'widgets' && m === 'POST') {
      const w = { id: id(), deviceId: d.id, ...cleanWidget(body) };
      db.widgets.push(w); save(); return send(res, 201, w);
    }
    let wm = rest.match(/^widgets\/(\w+)$/);
    if (wm) {
      const w = db.widgets.find(x => x.id === wm[1] && x.deviceId === d.id);
      if (!w) return send(res, 404, { error: 'Widget not found.' });
      if (m === 'PUT') { Object.assign(w, cleanWidget({ ...w, ...body })); save(); return send(res, 200, w); }
      if (m === 'DELETE') { db.widgets = db.widgets.filter(x => x !== w); save(); return send(res, 200, { ok: true }); }
    }
    let pm = rest.match(/^pins\/(V\d{1,2})$/);
    if (pm && m === 'POST') {
      if (body.value === undefined) return send(res, 400, { error: 'Missing value.' });
      setPin(d, pm[1], body.value, 'app');
      return send(res, 200, { ok: true });
    }
    let hm = rest.match(/^history\/(V\d{1,2})$/);
    if (hm && m === 'GET') return send(res, 200, (d.history && d.history[hm[1]]) || []);
  }
  return send(res, 404, { error: 'Not found.' });
}
function startSession(res, user) {
  const sid = crypto.randomBytes(24).toString('base64url');
  db.sessions[sid] = { userId: user.id, at: Date.now() }; save();
  send(res, 200, publicUser(user), { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` });
}

// ---------- device API (token based, easy for Arduino / ESP / Python / curl) ----------
//   GET  /device/update?token=T&V1=23.5&V2=1     -> save values from the device
//   GET  /device/get?token=T&V0&V3               -> read values (e.g. a switch pressed in the app)
//   GET  /device/all?token=T                     -> read every value
//   POST /device/update  {"token":"T","V1":23.5}
async function deviceApi(req, res, url) {
  let body = {};
  if (req.method === 'POST') body = await readBody(req);
  const q = Object.fromEntries(url.searchParams);
  const token = q.token || body.token;
  const d = token && db.devices.find(x => x.token === token);
  if (!d) return send(res, 401, { error: 'Invalid token.' });
  d.lastSeen = Date.now();
  if (wasOnline.get(d.id) !== true) { wasOnline.set(d.id, true); emit(d.userId, 'status', { deviceId: d.id, online: true }); }
  const src = req.method === 'POST' ? body : q;
  if (url.pathname === '/device/update') {
    let n = 0;
    for (const k of Object.keys(src)) if (PIN_RE.test(k)) { setPin(d, k, src[k], 'device'); n++; }
    return send(res, 200, { ok: true, updated: n });
  }
  if (url.pathname === '/device/get') {
    const out = {};
    for (const k of url.searchParams.keys()) if (PIN_RE.test(k)) out[k] = (d.pins || {})[k] ?? null;
    return send(res, 200, out);
  }
  if (url.pathname === '/device/all') return send(res, 200, d.pins || {});
  if (url.pathname === '/device/ping') return send(res, 200, { ok: true });
  return send(res, 404, { error: 'Not found.' });
}

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/device/')) return await deviceApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: e.message });
  }
});
if (require.main === module) {
  server.listen(PORT, () => console.log(`IoTEase running → http://localhost:${PORT}`));
}
module.exports = { server };
