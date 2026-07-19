# FRUITector 2.0

A static, dependency-free dashboard (HTML/CSS/JS only) for an ESP32-CAM based
AI food scanner. It's built to be hosted on GitHub Pages and to talk to the
device directly over your local Wi-Fi using plain HTTP REST calls.

The site works with **no hardware connected** — if it can't reach a device at
the address you enter, it automatically falls back to a demo/simulation mode
so every control is still fully interactive. Once your ESP32-CAM is on the
network and serving the routes below, "Connect" will use it for real.

## Project structure

```
fruitector/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── api.js      # FruitectorAPI — the only file that calls fetch()
│   └── app.js       # UI state, rendering, event wiring
└── README.md
```

## Running it

Just open `index.html` in a browser, or push the folder to a GitHub repo and
enable **Settings → Pages** for that branch. No build step, no npm install.

## Connecting to a real ESP32-CAM

1. Flash the ESP32-CAM with firmware that serves the routes in the table
   below on its local IP (e.g. `192.168.4.1` in AP mode, or whatever address
   your router assigns it in station mode — `fruitector.local` works too if
   you enable mDNS).
2. Type that address into the **ESP32-CAM address** field and click
   **Connect**.
3. The dashboard polls `/api/status` and `/api/wifi` to confirm the device is
   reachable, then starts pulling the camera stream and sensor readings.

### ⚠️ HTTPS + local HTTP device (mixed content)

GitHub Pages serves your site over **HTTPS**. Browsers block a page loaded
over HTTPS from making plain **HTTP** requests to a device on your LAN
("mixed content"). You'll see this in the browser console as a blocked
request, and the dashboard shows a warning banner when it detects this
combination. Workarounds:

- Serve the dashboard itself over HTTP too (e.g. run it from a local file,
  or host it on a local HTTP server on your network instead of Pages).
- Put a self-signed HTTPS certificate on the ESP32-CAM and accept the
  browser's certificate warning once.
- Use a browser flag/extension that allows insecure content for your Pages
  origin during development only — not recommended for a public deployment.

## API contract (what the firmware needs to implement)

All responses are JSON unless noted. CORS must be enabled on the device
(`Access-Control-Allow-Origin: *` is fine for a LAN device) since the
dashboard's origin (`github.io`) differs from the device's IP.

| Method | Path           | Purpose                         | Response body |
|--------|----------------|----------------------------------|----------------|
| GET    | `/api/status`  | Health check on Connect          | `{ "device": "FRUITector-2.0", "firmware": "1.0.0", "uptime_s": 12345, "connected": true }` |
| GET    | `/api/wifi`    | Wi-Fi info shown in header pill  | `{ "ssid": "MyWiFi", "rssi": -55, "ip": "192.168.4.23" }` |
| GET    | `/api/sensors` | Polled every ~6s while connected | `{ "temperature_c": 24.5, "humidity_pct": 58.2 }` |
| GET    | `/stream`      | Live camera feed                 | `multipart/x-mixed-replace` MJPEG stream |
| GET    | `/capture`     | Single-frame fallback if `/stream` isn't available | raw JPEG bytes |
| POST   | `/api/scan`    | Triggers a capture + AI inference | `{ "food_name": "Banana", "category": "fruit", "freshness": "ripe", "confidence": 0.94, "temperature_c": 24.5, "humidity_pct": 58.2 }` |
| POST   | `/api/led`     | Toggles the onboard LED          | Body: `{ "state": "on" }` → Response: `{ "led": "on" }` |

`freshness` is a free-form string; the UI colors these known values
specially: `fresh`, `good`, `ripe`, `overripe`, `spoiled`. Any other value
still displays, just without a themed color.

## Extending the frontend

- `js/api.js` exports `FruitectorAPI` (real device) and `FruitectorSimulator`
  (demo data) with identical method signatures, so `app.js` never needs to
  know which one it's talking to.
- Device address and scan history persist in `localStorage` so returning
  visitors don't have to re-enter anything.
- All colors, type, and spacing are CSS custom properties at the top of
  `css/styles.css` — change the palette or fonts there without touching
  markup.
