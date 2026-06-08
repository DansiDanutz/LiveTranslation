// app.js
// LiveTranslation over WebRTC. The browser mints a short-lived token from our
// serverless /api/token endpoint, then connects directly to OpenAI's
// translation endpoint. Translated audio arrives as a media track; source and
// target transcripts arrive over the "oai-events" data channel.

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

const CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

// ----- DOM -----------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const els = {
  authView: $("#auth-view"),
  appView: $("#app-view"),
  googleBtn: $("#google-signin"),
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
  remoteAudio: $("#tts"),
};

// ----- State ---------------------------------------------------------------
let config = null;
let pc = null;
let dataChannel = null;
let localStream = null;
let analyser = null;
let levelCtx = null;
let levelRAF = null;
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
    const s = els.sourceSelect.value;
    const t = els.targetSelect.value;
    if (OUTPUT_LANGUAGES.some((l) => l.code === s)) els.targetSelect.value = s;
    if (INPUT_LANGUAGES.some((l) => l.code === t)) els.sourceSelect.value = t;
    savePreferences();
    if (listening) restartSession();
  });

  // Target language is fixed at token mint time, so changing it restarts the
  // session with a fresh token.
  els.targetSelect.addEventListener("change", () => {
    savePreferences();
    if (listening) restartSession();
  });
  els.sourceSelect.addEventListener("change", savePreferences);

  els.muteAudio.addEventListener("click", () => {
    const muted = els.muteAudio.getAttribute("data-muted") === "true";
    els.muteAudio.setAttribute("data-muted", String(!muted));
    els.muteAudio.textContent = !muted ? "🔇 Audio off" : "🔊 Audio on";
    els.remoteAudio.muted = !muted;
  });

  els.volume.addEventListener("input", () => {
    els.remoteAudio.volume = Number(els.volume.value);
  });

  els.copyBtn.addEventListener("click", copyTranscript);
  els.downloadBtn.addEventListener("click", downloadTranscript);

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !["SELECT", "INPUT", "BUTTON"].includes(e.target.tagName)) {
      e.preventDefault();
      listening ? stopListening() : startListening();
    }
  });
}

async function restartSession() {
  appendCaption(
    els.targetCaption,
    `\n— reconnecting to translate into ${outputLanguageName(els.targetSelect.value)} —\n`,
    true
  );
  await stopListening();
  await startListening();
}

// ----- Start / stop (WebRTC) -----------------------------------------------
async function startListening() {
  if (!config.keyConfigured) {
    showToast("Translation disabled: server has no OPENAI_API_KEY.");
    return;
  }
  try {
    setStatus("connecting", "Connecting…");

    // 1) Mint a short-lived token for this translation session.
    const token = await mintToken(els.targetSelect.value);

    // 2) Capture mic audio.
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    // 3) Establish the peer connection.
    pc = new RTCPeerConnection();

    // Translated audio arrives as a remote media track — play it directly.
    pc.ontrack = (e) => {
      els.remoteAudio.srcObject = e.streams[0];
    };

    pc.addTrack(localStream.getAudioTracks()[0], localStream);

    // Transcript events flow over this data channel.
    dataChannel = pc.createDataChannel("oai-events");
    dataChannel.onmessage = (e) => handleEvent(JSON.parse(e.data));
    dataChannel.onopen = () => setStatus("listening", "Listening");

    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState) && listening) {
        setStatus("error", "Disconnected");
      }
    };

    // 4) SDP offer / answer handshake with the documented calls endpoint.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch(CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (!sdpRes.ok) throw new Error(`Translation endpoint refused the call (${sdpRes.status}).`);
    const answer = { type: "answer", sdp: await sdpRes.text() };
    await pc.setRemoteDescription(answer);

    // 5) UI + mic level meter.
    startLevelMeter(localStream);
    listening = true;
    els.mic.setAttribute("data-active", "true");
    els.micHint.textContent = "Listening — speak naturally. Tap to stop.";
    els.remoteAudio.volume = Number(els.volume.value);
    startTimer();
    clearCaptions();
  } catch (err) {
    console.error(err);
    setStatus("error", "Error");
    showToast(
      err.name === "NotAllowedError"
        ? "Microphone permission denied. Allow mic access and try again."
        : err.message || "Could not start translation."
    );
    await stopListening();
  }
}

async function stopListening() {
  listening = false;
  els.mic.setAttribute("data-active", "false");
  els.micHint.textContent = "Tap to start translating";
  stopTimer();
  stopLevelMeter();
  updateLevel(0);

  try {
    dataChannel?.close();
  } catch {}
  try {
    pc?.close();
  } catch {}
  localStream?.getTracks().forEach((t) => t.stop());
  els.remoteAudio.srcObject = null;
  pc = dataChannel = localStream = null;
  setStatus("idle", "Idle");
}

async function mintToken(language) {
  const accessToken = await getAccessToken();
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, accessToken }),
  });
  const data = await res.json();
  if (!res.ok || !data.value) {
    throw new Error(data.error || "Could not start a translation session.");
  }
  return data.value;
}

// ----- Events --------------------------------------------------------------
function handleEvent(evt) {
  switch (evt.type) {
    case "session.input_transcript.delta":
      sourceText += evt.delta || "";
      appendCaption(els.sourceCaption, evt.delta || "");
      break;
    case "session.output_transcript.delta":
      targetText += evt.delta || "";
      appendCaption(els.targetCaption, evt.delta || "");
      break;
    case "error":
      showToast(evt.error?.message || "Translation error.");
      break;
  }
}

// ----- Mic level meter -----------------------------------------------------
function startLevelMeter(stream) {
  levelCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = levelCtx.createMediaStreamSource(stream);
  analyser = levelCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    updateLevel(Math.sqrt(sum / buf.length));
    levelRAF = requestAnimationFrame(tick);
  };
  tick();
}

function stopLevelMeter() {
  if (levelRAF) cancelAnimationFrame(levelRAF);
  levelRAF = null;
  if (levelCtx && levelCtx.state !== "closed") levelCtx.close();
  levelCtx = analyser = null;
}

// ----- UI helpers ----------------------------------------------------------
function setStatus(state, text) {
  els.statusPill.setAttribute("data-state", state);
  els.statusText.textContent = text;
}

function updateLevel(rms) {
  els.level.style.width = Math.min(100, Math.round(rms * 320)) + "%";
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
