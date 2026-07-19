/**
 * FRUITector 2.0 — ESP32‑CAM REST client
 * ------------------------------------------------------------------
 * This file is the ONLY place that knows how to talk to the device.
 * The rest of the app (app.js) calls these methods and never touches
 * fetch() directly, so swapping the transport later (websockets,
 * mDNS discovery, BLE bridge, etc.) only means editing this file.
 *
 * Expected firmware routes (see README.md for full payload examples):
 *
 *   GET  /api/status   -> { device, firmware, uptime_s, connected }
 *   GET  /api/wifi     -> { ssid, rssi, ip }
 *   GET  /api/sensors  -> { temperature_c, humidity_pct }
 *   GET  /stream        -> MJPEG live video (multipart/x-mixed-replace)
 *   GET  /capture        -> single JPEG snapshot
 *   POST /api/scan     -> { food_name, category, freshness, confidence,
 *                            temperature_c, humidity_pct }
 *   POST /api/led      -> body { state: "on" | "off" }
 * ------------------------------------------------------------------
 */

const FRUITECTOR_STORAGE_KEYS = {
  deviceAddress: "fruitector.deviceAddress",
  history: "fruitector.history",
};

class FruitectorAPI {
  constructor(address, { timeoutMs = 6000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.setAddress(address);
  }

  /** Normalize whatever the user typed into a full base URL. */
  setAddress(address) {
    let value = (address || "").trim();
    if (value && !/^https?:\/\//i.test(value)) {
      value = `http://${value}`;
    }
    value = value.replace(/\/+$/, "");
    this.baseUrl = value;
  }

  get isConfigured() {
    return Boolean(this.baseUrl);
  }

  get streamUrl() {
    return `${this.baseUrl}/stream`;
  }

  get captureUrl() {
    return `${this.baseUrl}/capture?_=${Date.now()}`;
  }

  async _request(path, options = {}) {
    if (!this.isConfigured) {
      throw new Error("No device address configured.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Device responded with HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  getStatus() {
    return this._request("/api/status");
  }

  getWifi() {
    return this._request("/api/wifi");
  }

  getSensors() {
    return this._request("/api/sensors");
  }

  triggerScan() {
    return this._request("/api/scan", { method: "POST" });
  }

  setLed(state) {
    return this._request("/api/led", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
  }
}

/**
 * FruitectorSimulator mirrors FruitectorAPI's method names so the UI
 * works end to end on GitHub Pages even with no hardware nearby. It
 * is only ever used as a fallback when a real device can't be reached,
 * and the UI always marks results that came from it as "Demo".
 */
class FruitectorSimulator {
  constructor() {
    this.baseUrl = "demo";
    this.isConfigured = true;
    this._temp = 22.5;
    this._humidity = 55;
    this._foods = [
      { food_name: "Banana", category: "fruit", levels: ["fresh", "ripe", "overripe"] },
      { food_name: "Apple", category: "fruit", levels: ["fresh", "good", "overripe"] },
      { food_name: "Tomato", category: "vegetable", levels: ["fresh", "good", "spoiled"] },
      { food_name: "Strawberry", category: "fruit", levels: ["fresh", "spoiled"] },
      { food_name: "Avocado", category: "fruit", levels: ["ripe", "overripe", "spoiled"] },
      { food_name: "Bread", category: "bakery", levels: ["fresh", "spoiled"] },
    ];
  }

  async _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getStatus() {
    await this._delay(300);
    return { device: "FRUITector-2.0 (demo)", firmware: "sim-1.0.0", uptime_s: Math.floor(performance.now() / 1000), connected: true };
  }

  async getWifi() {
    await this._delay(250);
    return { ssid: "Demo-Network", rssi: -52, ip: "203.0.113.42" };
  }

  async getSensors() {
    await this._delay(300);
    this._temp += (Math.random() - 0.5) * 0.4;
    this._humidity += (Math.random() - 0.5) * 1.5;
    this._humidity = Math.min(80, Math.max(35, this._humidity));
    return {
      temperature_c: Math.round(this._temp * 10) / 10,
      humidity_pct: Math.round(this._humidity * 10) / 10,
    };
  }

  async triggerScan() {
    await this._delay(1400);
    const pick = this._foods[Math.floor(Math.random() * this._foods.length)];
    const freshness = pick.levels[Math.floor(Math.random() * pick.levels.length)];
    const sensors = await this.getSensors();
    return {
      food_name: pick.food_name,
      category: pick.category,
      freshness,
      confidence: Math.round((0.72 + Math.random() * 0.27) * 100) / 100,
      ...sensors,
    };
  }

  async setLed(state) {
    await this._delay(150);
    return { led: state };
  }
}
