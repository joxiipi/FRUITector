/**
 * FRUITector 2.0 — dashboard controller
 * Wires the DOM up to FruitectorAPI (js/api.js). No framework, no build
 * step — safe to open straight from a GitHub Pages URL.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const el = {
    deviceAddress: $("deviceAddress"),
    connectBtn: $("connectBtn"),
    mixedContentWarning: $("mixedContentWarning"),

    wifiStatus: $("wifiStatus"),
    wifiValue: $("wifiValue"),
    deviceStatus: $("deviceStatus"),
    deviceValue: $("deviceValue"),

    viewfinder: $("viewfinder"),
    cameraFeed: $("cameraFeed"),
    viewfinderPlaceholder: $("viewfinderPlaceholder"),
    liveIndicator: $("liveIndicator"),
    scanLine: $("scanLine"),

    scanBtn: $("scanBtn"),
    refreshBtn: $("refreshBtn"),
    ledBtn: $("ledBtn"),

    resultTimestamp: $("resultTimestamp"),
    resultEmpty: $("resultEmpty"),
    resultData: $("resultData"),
    foodName: $("foodName"),
    foodCategory: $("foodCategory"),
    freshnessBadge: $("freshnessBadge"),
    confidenceValue: $("confidenceValue"),
    confidenceFill: $("confidenceFill"),

    tempValue: $("tempValue"),
    humidityValue: $("humidityValue"),
    rssiValue: $("rssiValue"),
    uptimeValue: $("uptimeValue"),

    historyBody: $("historyBody"),
    clearHistoryBtn: $("clearHistoryBtn"),

    toastStack: $("toastStack"),
  };

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let api = null;
  let simulator = new FruitectorSimulator();
  let usingDemo = false;
  let connected = false;
  let ledState = "off";
  let sensorTimer = null;
  let captureTimer = null;
  let history = loadHistory();

  const SENSOR_POLL_MS = 6000;
  const CAPTURE_POLL_MS = 4000;

  // ---------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " toast-error" : ""}${type === "warn" ? " toast-warn" : ""}`;
    toast.textContent = message;
    el.toastStack.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("toast-out");
      setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  function formatClockTime(date) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatUptime(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
    return `${s}s`;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(FRUITECTOR_STORAGE_KEYS.history);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(FRUITECTOR_STORAGE_KEYS.history, JSON.stringify(history.slice(0, 50)));
    } catch {
      /* storage unavailable — history just won't persist across reloads */
    }
  }

  // ---------------------------------------------------------------
  // Connection status UI
  // ---------------------------------------------------------------
  function setPill(pillEl, valueEl, state, label) {
    pillEl.dataset.state = state;
    valueEl.textContent = label;
  }

  function updateMixedContentWarning() {
    const isHttps = location.protocol === "https:";
    const targetIsHttp = /^http:\/\//i.test(el.deviceAddress.value.trim()) || (!/^https?:\/\//i.test(el.deviceAddress.value.trim()) && el.deviceAddress.value.trim());
    el.mixedContentWarning.hidden = !(isHttps && targetIsHttp);
  }

  function setControlsEnabled(enabled) {
    el.scanBtn.disabled = !enabled;
    el.refreshBtn.disabled = !enabled;
    el.ledBtn.disabled = !enabled;
  }

  function enterDisconnectedState() {
    connected = false;
    usingDemo = false;
    setPill(el.wifiStatus, el.wifiValue, "offline", "Not connected");
    setPill(el.deviceStatus, el.deviceValue, "offline", "Disconnected");
    setControlsEnabled(false);
    stopSensorPolling();
    stopCameraFeed();
    el.liveIndicator.hidden = true;
    el.viewfinder.dataset.state = "idle";
  }

  // ---------------------------------------------------------------
  // Camera feed
  // ---------------------------------------------------------------
  function startCameraFeed() {
    stopCameraFeed();
    if (usingDemo) {
      el.viewfinderPlaceholder.hidden = false;
      el.viewfinderPlaceholder.querySelector("p").textContent =
        "Demo mode — connect a real ESP32‑CAM for a live preview.";
      el.cameraFeed.hidden = true;
      return;
    }

    // Try the MJPEG stream first.
    el.cameraFeed.onload = () => {
      el.viewfinderPlaceholder.hidden = true;
      el.cameraFeed.hidden = false;
      el.liveIndicator.hidden = false;
    };
    el.cameraFeed.onerror = () => {
      // Stream endpoint not available — fall back to polling single frames.
      el.liveIndicator.hidden = true;
      startCapturePolling();
    };
    el.cameraFeed.src = api.streamUrl;
  }

  function startCapturePolling() {
    stopCapturePolling();
    const tick = () => {
      const testImg = new Image();
      testImg.onload = () => {
        el.cameraFeed.src = testImg.src;
        el.cameraFeed.hidden = false;
        el.viewfinderPlaceholder.hidden = true;
      };
      testImg.onerror = () => {
        el.cameraFeed.hidden = true;
        el.viewfinderPlaceholder.hidden = false;
        el.viewfinderPlaceholder.querySelector("p").textContent =
          "Camera feed unavailable. Check the device and try Refresh.";
      };
      testImg.src = api.captureUrl;
    };
    tick();
    captureTimer = setInterval(tick, CAPTURE_POLL_MS);
  }

  function stopCapturePolling() {
    if (captureTimer) clearInterval(captureTimer);
    captureTimer = null;
  }

  function stopCameraFeed() {
    stopCapturePolling();
    el.cameraFeed.onload = null;
    el.cameraFeed.onerror = null;
    el.cameraFeed.removeAttribute("src");
    el.cameraFeed.hidden = true;
    el.viewfinderPlaceholder.hidden = false;
    el.viewfinderPlaceholder.querySelector("p").textContent = "No camera feed yet. Connect your device to begin.";
  }

  // ---------------------------------------------------------------
  // Sensors
  // ---------------------------------------------------------------
  async function pollSensors() {
    const client = usingDemo ? simulator : api;
    try {
      const data = await client.getSensors();
      el.tempValue.textContent = data.temperature_c ?? "—";
      el.humidityValue.textContent = data.humidity_pct ?? "—";
    } catch (err) {
      // Silent — a single missed poll isn't worth interrupting the user.
      console.warn("Sensor poll failed:", err);
    }

    if (!usingDemo) {
      try {
        const status = await api.getStatus();
        el.uptimeValue.textContent = formatUptime(status.uptime_s);
      } catch {
        /* status endpoint optional beyond initial connect */
      }
      try {
        const wifi = await api.getWifi();
        el.rssiValue.textContent = wifi.rssi ?? "—";
      } catch {
        /* wifi endpoint optional beyond initial connect */
      }
    } else {
      el.uptimeValue.textContent = formatUptime(performance.now() / 1000);
      el.rssiValue.textContent = "-52";
    }
  }

  function startSensorPolling() {
    stopSensorPolling();
    pollSensors();
    sensorTimer = setInterval(pollSensors, SENSOR_POLL_MS);
  }

  function stopSensorPolling() {
    if (sensorTimer) clearInterval(sensorTimer);
    sensorTimer = null;
  }

  // ---------------------------------------------------------------
  // Result + history rendering
  // ---------------------------------------------------------------
  function renderResult(data, { demo }) {
    el.resultEmpty.hidden = true;
    el.resultData.hidden = false;
    el.resultTimestamp.textContent = `${formatClockTime(new Date())}${demo ? " · demo" : ""}`;

    el.foodName.textContent = data.food_name || "Unknown";
    el.foodCategory.textContent = data.category || "—";

    const level = (data.freshness || "unknown").toLowerCase();
    el.freshnessBadge.dataset.level = level;
    el.freshnessBadge.textContent = level;

    const pct = Math.round((data.confidence || 0) * 100);
    el.confidenceValue.textContent = `${pct}%`;
    requestAnimationFrame(() => {
      el.confidenceFill.style.width = `${pct}%`;
    });

    if (data.temperature_c != null) el.tempValue.textContent = data.temperature_c;
    if (data.humidity_pct != null) el.humidityValue.textContent = data.humidity_pct;
  }

  function renderHistory() {
    if (history.length === 0) {
      el.historyBody.innerHTML = `<tr class="history-empty-row"><td colspan="5">No scans yet — your history will appear here.</td></tr>`;
      return;
    }
    el.historyBody.innerHTML = history
      .map(
        (entry) => `
        <tr>
          <td>${entry.time}</td>
          <td>${escapeHtml(entry.food_name)}</td>
          <td>${escapeHtml(entry.category)}</td>
          <td><span class="pill-mini" data-level="${entry.freshness}">${entry.freshness}</span></td>
          <td>${Math.round(entry.confidence * 100)}%</td>
        </tr>`
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function addHistoryEntry(data) {
    history.unshift({
      time: formatClockTime(new Date()),
      food_name: data.food_name || "Unknown",
      category: data.category || "—",
      freshness: (data.freshness || "unknown").toLowerCase(),
      confidence: data.confidence || 0,
    });
    history = history.slice(0, 50);
    saveHistory();
    renderHistory();
  }

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  async function handleConnect() {
    const address = el.deviceAddress.value.trim();
    updateMixedContentWarning();

    if (!address) {
      showToast("Enter your ESP32‑CAM's address first.", "warn");
      return;
    }

    localStorage.setItem(FRUITECTOR_STORAGE_KEYS.deviceAddress, address);
    api = new FruitectorAPI(address);

    setPill(el.deviceStatus, el.deviceValue, "connecting", "Connecting…");
    el.connectBtn.disabled = true;

    try {
      const status = await api.getStatus();
      const wifi = await api.getWifi().catch(() => null);

      usingDemo = false;
      connected = true;
      setPill(el.deviceStatus, el.deviceValue, "online", status.device || "Connected");
      setPill(el.wifiStatus, el.wifiValue, "online", wifi?.ssid || "Connected");
      showToast("Connected to your FRUITector device.");
      setControlsEnabled(true);
      startCameraFeed();
      startSensorPolling();
    } catch (err) {
      console.warn("Real device unreachable, falling back to demo mode:", err);
      usingDemo = true;
      connected = true;
      setPill(el.deviceStatus, el.deviceValue, "demo", "Demo mode");
      setPill(el.wifiStatus, el.wifiValue, "demo", "Simulated");
      showToast("Couldn't reach a device at that address — showing demo data instead.", "warn");
      setControlsEnabled(true);
      startCameraFeed();
      startSensorPolling();
    } finally {
      el.connectBtn.disabled = false;
    }
  }

  async function handleScan() {
    if (!connected) return;
    const client = usingDemo ? simulator : api;

    el.scanBtn.disabled = true;
    el.scanBtn.classList.add("is-scanning");
    el.viewfinder.dataset.state = "scanning";

    try {
      const data = await client.triggerScan();
      renderResult(data, { demo: usingDemo });
      addHistoryEntry(data);
    } catch (err) {
      console.warn("Scan failed:", err);
      showToast("Scan failed — check the device connection and try again.", "error");
    } finally {
      el.scanBtn.disabled = false;
      el.scanBtn.classList.remove("is-scanning");
      el.viewfinder.dataset.state = "ready";
    }
  }

  async function handleRefresh() {
    if (!connected) return;
    el.refreshBtn.disabled = true;
    try {
      await pollSensors();
      if (!usingDemo) startCameraFeed();
      showToast("Readings refreshed.");
    } catch (err) {
      showToast("Refresh failed.", "error");
    } finally {
      el.refreshBtn.disabled = false;
    }
  }

  async function handleLedToggle() {
    if (!connected) return;
    const nextState = ledState === "on" ? "off" : "on";
    const client = usingDemo ? simulator : api;
    el.ledBtn.disabled = true;
    try {
      await client.setLed(nextState);
      ledState = nextState;
      el.ledBtn.dataset.led = ledState;
      el.ledBtn.innerHTML = ledState === "on" ? "LED&nbsp;On" : "LED&nbsp;Off";
    } catch (err) {
      showToast("Couldn't reach the device's LED control.", "error");
    } finally {
      el.ledBtn.disabled = false;
    }
  }

  function handleClearHistory() {
    if (history.length === 0) return;
    history = [];
    saveHistory();
    renderHistory();
    showToast("Scan history cleared.");
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  function init() {
    const savedAddress = localStorage.getItem(FRUITECTOR_STORAGE_KEYS.deviceAddress) || "";
    el.deviceAddress.value = savedAddress;
    updateMixedContentWarning();
    renderHistory();
    enterDisconnectedState();

    el.deviceAddress.addEventListener("input", updateMixedContentWarning);
    el.connectBtn.addEventListener("click", handleConnect);
    el.scanBtn.addEventListener("click", handleScan);
    el.refreshBtn.addEventListener("click", handleRefresh);
    el.ledBtn.addEventListener("click", handleLedToggle);
    el.clearHistoryBtn.addEventListener("click", handleClearHistory);

    el.deviceAddress.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleConnect();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
