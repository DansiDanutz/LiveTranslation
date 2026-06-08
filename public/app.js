// app.js
// Orchestrates the LiveTranslation experience: auth gating, mic capture,
// streaming to the server relay, and rendering translated audio + captions.

import { OUTPUT_LANGUAGES, INPUT_LANGUAGES, outputLanguageName } from "./languages.js";
import {
  initAuth,
  isAuthRequired,
  getUser,
  getAccessToken,
  signInWithGoogle,
  signOut,
  onAuthChange,
} from "./auth.js";

const PLAYBACK_RATE = 24000; // model outputs 24 kHz PCM16

// ----- DOM -----------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const els = {
  authView: $("#auth-view"),
  appView: $("#app-view"),
  googleBtn: $("#google-signin"),
  userChip: $("#user-chip"),
  userName: $("#user-name"),
  userAvatar: $("#user-avatar"),
  signOutBtn: $("#sign-out"),
  sourceSelect: $("#source-lang"),
  targetSelect: $("#target-lang"),
  swapBtn: $("#swap-lang"),
  mic: $("#mic"),
  micHint: $("#mic-hint"),
  statusPill: $("#status-pill"),
  statusText: $("#status-text"),
  sourceCaption: $("#source-caption"),
  targetCaption: $("#target-caption"),
  level: $("#level-bar"),
  timer: $("#timer"),
  cost: $("#cost"),
  muteAudio: $("#mute-audio"),
  volume: $("#volume"),
  copyBtn: $("#copy-transcript"),
  downloadBtn: $("#download-transcript"),
  toast: $("#toast"),
  modelTag: $("#model-tag"),
  priceTag: $("#price-tag"),
};

// ----- State ---------------------------------------------------------------
let config = null;
let ws = null;
let audioCtx = null;
let captureNode = null;
let playbackNode = null;
let mediaStream = null;
let listening = false;
let startTime = 0;
let timerInterval = null;
let pricePerMinute = 0.034;
let sourceText = "";
let targetText = "";

// ----- Boot ----------------------------------------------------------------
(async function boot() {
  config = await initAuth();
  pricePerMinute = config.pricePerMinuteUsd ?? 0.034;
  els.modelTag.textContent = config.model;
  els.priceTag.textContent = `$${pricePerMinute.toFixed(3)}/min`;

  populateLanguages();
  restorePreferences();
  wireEvents();

  if (!config.keyConfigured) {
    showToast("Server is missing OPENAI_API_KEY — translation is disabled.");
  }

  if (isAuthRequired()) {
    onAuthChange(() => refreshAuthView());
    await refreshAuthView();
  } else {
    enterApp({ email: "Guest", user_metadata: {} });
  }
})();

// ----- Auth views ----------------------------------------------------------
async function refreshAuthView() {
  const user = await getUser();
  if (user) enterApp(user);
  else showAuthView();
}

function showAuthView() {
  els.authView.hidden = false;
  els.appView.hidden = true;
}

function enterApp(user) {
  els.authView.hidden = true;
  els.appView.hidden = false;
  const name = user.user_metadata?.full_name || user.email || "Guest";
  const avatar = user.user_metadata?.avatar_url;
  els.userName.textContent = name;
  if (avatar) {
    els.userAvatar.style.backgroundImage = `url(${avatar})`;
    els.userAvatar.textContent = "";
  } else {
    els.userAvatar.textContent = name.charAt(0).toUpperCase();
  }
  els.signOutBtn.hidden = !isAuthRequired();
}

// ----- Language selects ----------------------------------------------------
function populateLanguages() {
  for (const lang of INPUT_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = `${lang.flag}  ${lang.name}`;
    els.sourceSelect.append(opt);
  }
  for (const lang of OUTPUT_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = `${lang.flag}  ${lang.name}`;
    els.targetSelect.append(opt);
  }
  els.sourceSelect.value = "auto";
  els.targetSelect.value = "es";
}

function restorePreferences() {
  const saved = JSON.parse(localStorage.getItem("lt-prefs") || "{}");
  if (saved.source) els.sourceSelect.value = saved.source;
  if (saved.target) els.targetSelect.value = saved.target;
}

function savePreferences() {
  localStorage.setItem(
    "lt-prefs",
    JSON.stringify({ source: els.sourceSelect.value, target: els.targetSelect.value })
  );
}

// ----- Event wiring --------------------------------------------------------
function wireEvents() {
  els.googleBtn.addEventListener("click", () => signInWithGoogle());
  els.signOutBtn.addEventListener("click", async () => {
    await stopListening();
    await signOut();
    showAuthView();
  });

  els.mic.addEventListener("click", () => (listening ? stopListening() : startListening()));

  els.swapBtn.addEventListener("click", () => {
    // Swap is only meaningful when source is a concrete output-capable language.
    const s = els.sourceSelect.value;
    const t = els.targetSelect.value;
    if (OUTPUT_LANGUAGES.some((l) => l.code === s)) {
      els.targetSelect.value = s;
    }
    if (INPUT_LANGUAGES.some((l) => l.code === t)) {
      els.sourceSelect.value = t;
    }
    savePreferences();
    if (listening) updateLanguage();
  });

  els.targetSelect.addEventListener("change", () => {
    savePreferences();
    if (listening) updateLanguage();
  });
  els.sourceSelect.addEventListener("change", savePreferences);

  els.muteAudio.addEventListener("click", () => {
    const muted = els.muteAudio.getAttribute("data-muted") === "true";
    els.muteAudio.setAttribute("data-muted", String(!muted));
    els.muteAudio.textContent = !muted ? "🔇 Audio off" : "🔊 Audio on";
    playbackNode?.port.postMessage({ type: "mute", value: !muted });
  });

  els.volume.addEventListener("input", () => {
    if (audioCtx && playbackGain) playbackGain.gain.value = Number(els.volume.value);
  });

  els.copyBtn.addEventListener("click", copyTranscript);
  els.downloadBtn.addEventListener("click", downloadTranscript);

  // Spacebar toggles listening (when not typing in a control).
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !["SELECT", "INPUT", "BUTTON"].includes(e.target.tagName)) {
      e.preventDefault();
      listening ? stopListening() : startListening();
    }
  });
}

function updateLanguage() {
  send({ type: "set_language", language: els.targetSelect.value });
  appendCaption(els.targetCaption, `\n— now translating to ${outputLanguageName(els.targetSelect.value)} —\n`, true);
}

// ----- Start / stop --------------------------------------------------------
let playbackGain = null;

async function startListening() {
  if (!config.keyConfigured) {
    showToast("Translation disabled: server has no OPENAI_API_KEY.");
    return;
  }
  try {
    setStatus("connecting", "Connecting…");
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    // Pin the context to 24 kHz so capture + playback match the model's
    // documented 24 kHz PCM16 format (no resampling artifacts).
    audioCtx = new AudioContext({ sampleRate: PLAYBACK_RATE });
    await audioCtx.audioWorklet.addModule("/capture-worklet.js");
    await audioCtx.audioWorklet.addModule("/playback-worklet.js");

    // Capture chain: mic -> capture-processor (-> WS)
    const micSource = audioCtx.createMediaStreamSource(mediaStream);
    captureNode = new AudioWorkletNode(audioCtx, "capture-processor");
    captureNode.port.onmessage = (e) => {
      if (e.data.type === "audio") {
        updateLevel(e.data.level);
        const b64 = base64FromBuffer(e.data.pcm);
        send({ type: "audio", audio: b64 });
      }
    };
    micSource.connect(captureNode);

    // Playback chain: playback-processor -> gain -> speakers
    playbackNode = new AudioWorkletNode(audioCtx, "playback-processor");
    playbackGain = audioCtx.createGain();
    playbackGain.gain.value = Number(els.volume.value);
    playbackNode.connect(playbackGain).connect(audioCtx.destination);

    await openSocket();

    listening = true;
    els.mic.setAttribute("data-active", "true");
    els.micHint.textContent = "Listening — speak naturally. Tap to stop.";
    startTimer();
    clearCaptions();
  } catch (err) {
    console.error(err);
    setStatus("error", "Mic blocked");
    showToast(
      err.name === "NotAllowedError"
        ? "Microphone permission denied. Allow mic access and try again."
        : "Could not start audio: " + err.message
    );
    await stopListening();
  }
}

async function stopListening() {
  if (ws && ws.readyState === WebSocket.OPEN) send({ type: "stop" });
  listening = false;
  els.mic.setAttribute("data-active", "false");
  els.micHint.textContent = "Tap to start translating";
  stopTimer();
  updateLevel(0);

  captureNode?.disconnect();
  playbackNode?.disconnect();
  mediaStream?.getTracks().forEach((t) => t.stop());
  if (audioCtx && audioCtx.state !== "closed") await audioCtx.close();
  audioCtx = null;
  captureNode = playbackNode = mediaStream = null;
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
}

// ----- WebSocket relay -----------------------------------------------------
function openSocket() {
  return new Promise(async (resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/translate`);

    ws.onopen = async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        showToast("Please sign in again.");
        reject(new Error("no token"));
        return;
      }
      send({
        type: "start",
        accessToken,
        language: els.targetSelect.value,
        transcribeSource: true,
      });
      resolve();
    };

    ws.onmessage = (e) => handleServerEvent(JSON.parse(e.data));
    ws.onerror = () => setStatus("error", "Connection error");
    ws.onclose = () => {
      if (listening) setStatus("closed", "Disconnected");
    };
  });
}

function handleServerEvent(evt) {
  switch (evt.type) {
    case "status":
      if (evt.state === "connected") setStatus("listening", "Listening");
      else if (evt.state === "closed") setStatus("idle", "Idle");
      break;
    case "error":
      setStatus("error", "Error");
      showToast(evt.message);
      break;
    // ---- Documented translation events --------------------------------
    case "session.input_transcript.delta":
      sourceText += evt.delta || "";
      appendCaption(els.sourceCaption, evt.delta || "");
      break;
    case "session.output_transcript.delta":
      targetText += evt.delta || "";
      appendCaption(els.targetCaption, evt.delta || "");
      break;
    case "session.output_audio.delta":
      enqueueAudio(evt.delta);
      break;
    case "session.closed":
      setStatus("idle", "Idle");
      break;
  }
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

// ----- Audio helpers -------------------------------------------------------
function enqueueAudio(base64Pcm16) {
  if (!playbackNode || !base64Pcm16) return;
  const bytes = base64ToBytes(base64Pcm16);
  const pcm16 = new Int16Array(bytes.buffer);
  let float = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float[i] = pcm16[i] / 32768;

  // If the browser didn't honor the 24 kHz context hint, resample so audio
  // plays at the correct pitch/speed on every browser.
  const ctxRate = audioCtx?.sampleRate || PLAYBACK_RATE;
  if (ctxRate !== PLAYBACK_RATE) float = resample(float, PLAYBACK_RATE, ctxRate);

  playbackNode.port.postMessage({ type: "samples", samples: float.buffer }, [float.buffer]);
}

function resample(input, fromRate, toRate) {
  const ratio = toRate / fromRate;
  const outLength = Math.round(input.length * ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = input[idx] || 0;
    const b = input[idx + 1] !== undefined ? input[idx + 1] : a;
    out[i] = a + (b - a) * frac; // linear interpolation
  }
  return out;
}

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ----- UI helpers ----------------------------------------------------------
function setStatus(state, text) {
  els.statusPill.setAttribute("data-state", state);
  els.statusText.textContent = text;
}

function updateLevel(rms) {
  const pct = Math.min(100, Math.round(rms * 280));
  els.level.style.width = pct + "%";
}

function appendCaption(node, text, system = false) {
  const placeholder = node.querySelector(".caption__placeholder");
  if (placeholder) placeholder.remove();
  if (system) {
    const span = document.createElement("span");
    span.className = "caption__system";
    span.textContent = text;
    node.append(span);
  } else {
    node.append(document.createTextNode(text));
  }
  node.scrollTop = node.scrollHeight;
}

function clearCaptions() {
  sourceText = "";
  targetText = "";
  els.sourceCaption.innerHTML = '<span class="caption__placeholder">Your speech appears here…</span>';
  els.targetCaption.innerHTML = '<span class="caption__placeholder">Translation appears here…</span>';
}

// ----- Timer + cost --------------------------------------------------------
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const secs = (Date.now() - startTime) / 1000;
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(Math.floor(secs % 60)).padStart(2, "0");
    els.timer.textContent = `${m}:${s}`;
    els.cost.textContent = `$${((secs / 60) * pricePerMinute).toFixed(3)}`;
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ----- Transcript export ---------------------------------------------------
function transcriptText() {
  return `LiveTranslation session\nTarget language: ${outputLanguageName(
    els.targetSelect.value
  )}\n\n--- Source ---\n${sourceText.trim()}\n\n--- Translation ---\n${targetText.trim()}\n`;
}

async function copyTranscript() {
  try {
    await navigator.clipboard.writeText(transcriptText());
    showToast("Transcript copied", true);
  } catch {
    showToast("Could not copy transcript");
  }
}

function downloadTranscript() {
  const blob = new Blob([transcriptText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `livetranslation-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ----- Toast ---------------------------------------------------------------
let toastTimer = null;
function showToast(message, ok = false) {
  els.toast.textContent = message;
  els.toast.style.background = ok ? "var(--c-success)" : "var(--c-danger)";
  els.toast.setAttribute("data-show", "true");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.setAttribute("data-show", "false"), 3500);
}
