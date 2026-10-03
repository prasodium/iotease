// Smoke test: node test.js
const assert = require('assert');
process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/iotease-');
const { server } = require('./server');
server.listen(0, async () => {
  const base = 'http://localhost:' + server.address().port;
  const j = async (p, o = {}, cookie) => { const r = await fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) } }); return { r, d: await r.json() }; };
  try {
    let { r, d } = await j('/api/signup', { method: 'POST', body: JSON.stringify({ email: 'a@b.co', password: 'secret1' }) });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    assert.equal((await j('/api/devices')).r.status, 401);
    ({ d } = await j('/api/devices', { method: 'POST', body: JSON.stringify({ name: 'Test' }) }, cookie));
    const dev = d;
    assert.equal((await j(`/api/devices/${dev.id}/widgets`, {}, cookie)).d.length, 3);
    await j(`/device/update?token=${dev.token}&V1=42.5`);
    assert.equal((await j(`/device/get?token=${dev.token}&V1`)).d.V1, '42.5');
    await j(`/api/devices/${dev.id}/pins/V0`, { method: 'POST', body: JSON.stringify({ value: 1 }) }, cookie);
    assert.equal((await j(`/device/all?token=${dev.token}`)).d.V0, '1');
    assert.equal((await j('/device/get?token=bad')).r.status, 401);
    assert.equal((await j('/api/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.co', password: 'nope' }) })).r.status, 401);
    console.log('All tests passed ✓');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close(); process.exit();
});
