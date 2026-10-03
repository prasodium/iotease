# IoTEase

A simple, friendly IoT platform inspired by Blynk. Connect a device, drop in a few widgets, and monitor or control it from any browser — no jargon, no setup headaches.

- **Zero dependencies** — plain Node.js (v18+), nothing to `npm install`
- **Works offline / self-hosted** — your data stays in `data/db.json`
- **Live updates** — values and online status stream to the page instantly
- **Simple on purpose** — add a device → copy its key → paste into code → done

## Quick start

```bash
git clone https://github.com/prasodium/iotease.git
cd iotease
npm start            # http://localhost:3000
```

1. Create an account.
2. Click **+ Add device**. It comes with a starter switch, gauge and chart.
3. Click **🔌 Connect**, copy the device key and code snippet (ESP32/ESP8266, Python or curl).
4. No hardware? Run the simulator: `node examples/simulator.js <DEVICE_KEY>`

## Widgets

| Widget | Use it to |
|---|---|
| Switch | turn something on/off |
| Button | send a signal while pressed |
| Slider | set a level (brightness, speed) |
| Gauge / Number | show a reading |
| Chart | see readings over time |
| Light / Message | show status or text from the device |

Each widget is tied to a **data channel** (`V0`–`V9`). Devices write sensor data to a channel; widgets like switches write control data to a channel which the device reads.

## Device API

Use the device key as `token`. Works from anything that can make an HTTP request.

| Action | Request |
|---|---|
| Send data | `GET /device/update?token=KEY&V1=23.5&V2=61` |
| Send data (JSON) | `POST /device/update` `{"token":"KEY","V1":23.5}` |
| Read data | `GET /device/get?token=KEY&V0&V3` |
| Read everything | `GET /device/all?token=KEY` |

A device counts as **online** if it called the API in the last 30 seconds.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | where `db.json` is stored |

Tip: devices on your network must use your computer's LAN IP (e.g. `http://192.168.1.20:3000`), not `localhost`. For internet access, put it behind HTTPS (Caddy, nginx, Cloudflare Tunnel).

## Project layout

```
server.js            API, device API, live events, static hosting
public/              the app (index.html, style.css, app.js)
examples/simulator.js  fake device for testing
test.js              smoke tests  (npm test)
```

## License

MIT
