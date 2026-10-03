// Fake device for trying IoTEase without hardware.
// Usage: node examples/simulator.js <DEVICE_KEY> [server-url]
const token = process.argv[2];
const server = process.argv[3] || 'http://localhost:3000';
if (!token) { console.error('Usage: node examples/simulator.js <DEVICE_KEY> [server-url]'); process.exit(1); }
let t = 0;
async function tick() {
  const temp = (24 + 5 * Math.sin(t / 8) + Math.random()).toFixed(1);
  try {
    await fetch(`${server}/device/update?token=${token}&V1=${temp}`);
    const sw = await (await fetch(`${server}/device/get?token=${token}&V0`)).json();
    console.log(`sent temp=${temp}  switch V0=${sw.V0}`);
  } catch (e) { console.error('Cannot reach server:', e.message); }
  t++;
}
setInterval(tick, 2000); tick();
