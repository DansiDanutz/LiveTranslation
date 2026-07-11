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
  consumeAuthError,
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
  // Conversation mode
  modeTranslate: $("#mode-translate"),
  modeConversation: $("#mode-conversation"),
  personA: $("#person-a"),
  personB: $("#person-b"),
  convAb: $("#conv-ab"),
  convBa: $("#conv-ba"),
  mic: $("#mic"),
  micHint: $("#mic-hint"),
  welcomeCard: $("#welcome-card"),
  welcomeDismiss: $("#welcome-dismiss"),
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
  // Feature controls
  themeBtn: $("#theme-btn"),
  presentBtn: $("#present-btn"),
  fontInc: $("#font-inc"),
  fontDec: $("#font-dec"),
  micDevice: $("#mic-device"),
  stage: $("#stage"),
  // Left menu
  menuBtn: $("#menu-btn"),
  sideMenu: $("#side-menu"),
  menuClose: $("#menu-close"),
  menuBackdrop: $("#menu-backdrop"),
  historyClear: $("#history-clear"),
  historyList: $("#history-list"),
  // Owner access control
  adminSection: $("#admin-section"),
  allowForm: $("#allow-form"),
  allowInput: $("#allow-input"),
  allowList: $("#allow-list"),
  // Romanian transcript dialog
  roModal: $("#ro-modal"),
  roModalBackdrop: $("#ro-modal-backdrop"),
  roModalBody: $("#ro-modal-body"),
  roModalClose: $("#ro-modal-close"),
  roModalOk: $("#ro-modal-ok"),
  roModalCopy: $("#ro-modal-copy"),
  // Summaries
  summaryCard: $("#summary-card"),
  summaryBody: $("#summary-body"),
  summaryClose: $("#summary-close"),
  summaryCopy: $("#summary-copy"),
  summaryPdf: $("#summary-pdf"),
  summaryActions: $("#summary-actions"),
  summaryActionsBody: $("#summary-actions-body"),
  askForm: $("#ask-form"),
  askInput: $("#ask-input"),
  askAnswer: $("#ask-answer"),
  summarizeAll: $("#summarize-all"),
  overallSummary: $("#overall-summary"),
  summaryLang: $("#summary-lang"),
  // Live broadcast
  goLive: $("#go-live"),
  liveShare: $("#live-share"),
  liveLink: $("#live-link"),
  liveCopy: $("#live-copy"),
  liveView: $("#live-view"),
  liveStatus: $("#live-status"),
  liveSource: $("#live-source"),
  liveTarget: $("#live-target"),
  // Install (PWA)
  installSection: $("#install-section"),
  installBtn: $("#install-btn"),
  installIosHint: $("#install-ios-hint"),
  // Balance
  balRemaining: $("#bal-remaining"),
  balBar: $("#bal-bar"),
  balSpent: $("#bal-spent"),
  balCredit: $("#bal-credit"),
  balSet: $("#bal-set"),
};

const HISTORY_KEY = "lt-history";
const THEME_KEY = "lt-theme";
const FONT_KEY = "lt-font-scale";
const DEVICE_KEY = "lt-mic-device";
const BAL_KEY = "lt-balance";
const SPENT_KEY = "lt-spent-total";
const SUMMARY_LANG_KEY = "lt-summary-lang";
const VOLUME_KEY = "lt-volume";
const MUTED_KEY = "lt-muted";
const WELCOME_KEY = "lt-welcome-done";
const INSTALL_TIP_KEY = "lt-install-tip-shown";

// Summaries can be written in any language — defaults to Romanian (which isn't
// one of the 13 translation OUTPUT languages, so this is the way to get
// Romanian out of the app).
const SUMMARY_LANGUAGES = [
  "Romanian", "English", "Spanish", "French", "German", "Italian",
  "Portuguese", "Russian", "Chinese", "Japanese", "Arabic", "Hindi",
];

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
let sessionTarget = null; // target language code of the in-progress session
let activeDirection = null; // "AtoB" | "BtoA" in conversation mode
let currentUserId = null; // Supabase user id (for cloud sync)
let currentUserEmail = null;
let isOwner = false;
let cloudAvailable = true; // flips false if the sessions table isn't set up
let lastSession = null; // last completed/viewed session (for PDF export)

// ----- App install (PWA) ----------------------------------------------------
// Captured at module load — the browser fires beforeinstallprompt once, early;
// we stash it so the "Install" button can re-fire the native prompt on demand.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  els.installSection.hidden = false;
  els.installBtn.hidden = false;
  els.installIosHint.hidden = true;
  // Point people at the install button once — it lives inside the menu.
  if (!localStorage.getItem(INSTALL_TIP_KEY)) {
    localStorage.setItem(INSTALL_TIP_KEY, "1");
    showToast("Tip: install this as an app — Menu ☰ → Get the app 📲", true);
  }
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  els.installSection.hidden = true;
  showToast("App installed — find it on your home screen 🎉", true);
});

function setupInstall() {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return; // already running as an installed app
  // iOS Safari has no install prompt — show the Add to Home Screen steps.
  const ua = navigator.userAgent;
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (isIOS) {
    els.installSection.hidden = false;
    els.installBtn.hidden = true;
    els.installIosHint.hidden = false;
  }
}

async function promptInstall() {
  if (!deferredInstallPrompt) {
    showToast("Use your browser menu → “Install app” / “Add to Home screen”.");
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => {});
  deferredInstallPrompt = null;
}

// ----- Screen wake lock ------------------------------------------------------
// Phones dim and lock the screen mid-conversation, which suspends the mic and
// kills the session. Hold a wake lock while listening; re-acquire when the tab
// becomes visible again (the OS silently releases it on tab switch).
let wakeLock = null;
async function acquireWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    /* unsupported or denied — not critical */
  }
}
function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {}
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (listening && document.visibilityState === "visible") acquireWakeLock();
});

// ----- Boot ----------------------------------------------------------------
(async function boot() {
  // Listener mode: anyone with a ?live=ROOM link follows a session read-only.
  const liveRoom = new URLSearchParams(location.search).get("live");
  if (liveRoom) {
    config = await initAuth();
    startListenerMode(liveRoom);
    return;
  }

  config = await initAuth();
  pricePerMinute = config.pricePerMinuteUsd ?? 0.034;
  els.modelTag.textContent = config.model;
  els.priceTag.textContent = `$${pricePerMinute.toFixed(3)}/min`;

  populateLanguages();
  restorePreferences();
  restoreTheme();
  restoreFontScale();
  restoreAudioPrefs();
  wireEvents();
  if (!localStorage.getItem(WELCOME_KEY)) els.welcomeCard.hidden = false;
  refreshMicDevices();
  renderBalance();
  populateSummaryLanguages();
  setupInstall();

  if (!config.keyConfigured) {
    showToast("Server is missing OPENAI_API_KEY — translation is disabled.");
  }
  const authErr = consumeAuthError();
  if (authErr) showToast("Sign-in error: " + authErr);

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
  currentUserId = user.id && user.id !== "demo" ? user.id : null;
  currentUserEmail = (user.email || "").toLowerCase();
  isOwner = Boolean(config?.ownerEmail) && currentUserEmail === config.ownerEmail;
  els.adminSection.hidden = !isOwner;
  cloudSyncDown(); // pull any sessions saved on other devices
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
  // Default flow: speak Turkish → hear English (saved preferences override).
  els.sourceSelect.value = "tr";
  els.targetSelect.value = "en";

  // Conversation: both sides must be output-capable languages.
  for (const sel of [els.personA, els.personB]) {
    for (const lang of OUTPUT_LANGUAGES) {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = `${lang.flag}  ${lang.name}`;
      sel.append(opt);
    }
  }
  els.personA.value = "en";
  els.personB.value = "es";
}

// The target language for the next/in-progress session, per current mode.
function currentTarget() {
  if (els.appView.getAttribute("data-mode") === "conversation") {
    return activeDirection === "BtoA" ? els.personA.value : els.personB.value;
  }
  return els.targetSelect.value;
}

function restorePreferences() {
  const saved = JSON.parse(localStorage.getItem("lt-prefs") || "{}");
  if (saved.source) els.sourceSelect.value = saved.source;
  if (saved.target) els.targetSelect.value = saved.target;
  if (saved.personA) els.personA.value = saved.personA;
  if (saved.personB) els.personB.value = saved.personB;
  els.appView.setAttribute("data-mode", saved.mode === "conversation" ? "conversation" : "translate");
  if (saved.mode === "conversation") {
    els.modeConversation.classList.add("is-active");
    els.modeTranslate.classList.remove("is-active");
  }
}

function savePreferences() {
  localStorage.setItem(
    "lt-prefs",
    JSON.stringify({
      source: els.sourceSelect.value,
      target: els.targetSelect.value,
      personA: els.personA.value,
      personB: els.personB.value,
      mode: els.appView.getAttribute("data-mode"),
    })
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

  // Mode toggle
  els.modeTranslate.addEventListener("click", () => setMode("translate"));
  els.modeConversation.addEventListener("click", () => setMode("conversation"));

  // Conversation direction buttons (push-to-talk per person)
  els.personA.addEventListener("change", savePreferences);
  els.personB.addEventListener("change", savePreferences);
  els.convAb.addEventListener("click", () => toggleDirection("AtoB"));
  els.convBa.addEventListener("click", () => toggleDirection("BtoA"));

  els.muteAudio.addEventListener("click", () => {
    const muted = els.muteAudio.getAttribute("data-muted") === "true";
    els.muteAudio.setAttribute("data-muted", String(!muted));
    els.muteAudio.textContent = !muted ? "🔇 Audio off" : "🔊 Audio on";
    els.remoteAudio.muted = !muted;
    localStorage.setItem(MUTED_KEY, String(!muted));
  });

  els.volume.addEventListener("input", () => {
    els.remoteAudio.volume = Number(els.volume.value);
    localStorage.setItem(VOLUME_KEY, els.volume.value);
  });

  // Romanian transcript dialog
  els.roModalClose.addEventListener("click", closeRoModal);
  els.roModalOk.addEventListener("click", closeRoModal);
  els.roModalBackdrop.addEventListener("click", closeRoModal);
  els.roModalCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(els.roModalBody.textContent || "").then(
      () => showToast("Romanian text copied", true),
      () => showToast("Could not copy")
    );
  });

  // First-run welcome
  els.welcomeDismiss.addEventListener("click", () => {
    localStorage.setItem(WELCOME_KEY, "1");
    els.welcomeCard.hidden = true;
  });

  els.copyBtn.addEventListener("click", copyTranscript);
  els.downloadBtn.addEventListener("click", downloadTranscript);

  // Theme
  els.themeBtn.addEventListener("click", toggleTheme);

  // Caption font size
  els.fontInc.addEventListener("click", () => bumpFontScale(0.15));
  els.fontDec.addEventListener("click", () => bumpFontScale(-0.15));

  // Presentation (fullscreen) mode
  els.presentBtn.addEventListener("click", togglePresent);

  // Microphone device
  els.micDevice.addEventListener("change", () => {
    localStorage.setItem(DEVICE_KEY, els.micDevice.value);
    if (listening) restartSession();
  });
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener?.("devicechange", refreshMicDevices);
  }

  // Left menu
  els.menuBtn.addEventListener("click", openMenu);
  els.menuClose.addEventListener("click", closeMenu);
  els.menuBackdrop.addEventListener("click", closeMenu);
  els.historyClear.addEventListener("click", clearHistory);

  // Summaries
  els.summaryClose.addEventListener("click", () => (els.summaryCard.hidden = true));
  els.summaryCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(els.summaryBody.textContent || "").then(
      () => showToast("Summary copied", true),
      () => showToast("Could not copy")
    );
  });
  els.summaryPdf.addEventListener("click", () =>
    exportPdf(
      lastSession || {
        target: sessionTarget || els.targetSelect.value,
        sourceText,
        targetText,
        summary: els.summaryBody.textContent,
        ts: Date.now(),
      }
    )
  );
  els.summaryActions.addEventListener("click", generateActionItems);
  els.askForm.addEventListener("submit", (e) => {
    e.preventDefault();
    askAboutSession();
  });
  els.summarizeAll.addEventListener("click", summarizeAllSessions);

  // Go live (broadcast captions)
  els.goLive.addEventListener("click", toggleGoLive);
  els.liveCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(els.liveLink.value).then(
      () => showToast("Live link copied", true),
      () => showToast("Could not copy")
    );
  });

  els.summaryLang.addEventListener("change", () =>
    localStorage.setItem(SUMMARY_LANG_KEY, els.summaryLang.value)
  );

  // Owner access control
  els.allowForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addAllowedEmail();
  });

  // Install app
  els.installBtn.addEventListener("click", promptInstall);

  // Balance
  els.balSet.addEventListener("click", promptSetBalance);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.roModal.hidden) return closeRoModal();
    if (e.key === "Escape" && !els.sideMenu.hidden) closeMenu();
    if (e.code === "Space" && !["SELECT", "INPUT", "BUTTON"].includes(e.target.tagName)) {
      e.preventDefault();
      if (els.appView.getAttribute("data-mode") === "conversation") {
        toggleDirection(activeDirection || "AtoB");
      } else {
        listening ? stopListening() : startListening();
      }
    }
  });
}

// ----- Theme ---------------------------------------------------------------
function restoreTheme() {
  const theme = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(theme);
}
function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f3f5fb" : "#0b0f1a");
}
function toggleTheme() {
  const next = document.body.getAttribute("data-theme") === "light" ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
}

// ----- Caption font size ---------------------------------------------------
function restoreAudioPrefs() {
  const vol = parseFloat(localStorage.getItem(VOLUME_KEY));
  if (Number.isFinite(vol)) {
    els.volume.value = String(vol);
    els.remoteAudio.volume = vol;
  }
  if (localStorage.getItem(MUTED_KEY) === "true") {
    els.muteAudio.setAttribute("data-muted", "true");
    els.muteAudio.textContent = "🔇 Audio off";
    els.remoteAudio.muted = true;
  }
}

function restoreFontScale() {
  const scale = parseFloat(localStorage.getItem(FONT_KEY) || "1");
  document.documentElement.style.setProperty("--caption-scale", String(scale));
}
function bumpFontScale(delta) {
  const cur = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--caption-scale") || "1"
  );
  const next = Math.min(2.2, Math.max(0.7, cur + delta));
  document.documentElement.style.setProperty("--caption-scale", String(next));
  localStorage.setItem(FONT_KEY, String(next));
}

// ----- Presentation mode ---------------------------------------------------
function togglePresent() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    els.stage.requestFullscreen?.().catch(() => showToast("Fullscreen not available."));
  }
}

// ----- Microphone devices --------------------------------------------------
async function refreshMicDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === "audioinput");
    const saved = localStorage.getItem(DEVICE_KEY) || "";
    els.micDevice.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Default microphone";
    els.micDevice.append(def);
    mics.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${i + 1}`;
      els.micDevice.append(opt);
    });
    if (saved && mics.some((m) => m.deviceId === saved)) els.micDevice.value = saved;
  } catch {
    /* ignore */
  }
}

async function setMode(mode) {
  if (listening) await stopListening();
  els.appView.setAttribute("data-mode", mode);
  els.modeTranslate.classList.toggle("is-active", mode === "translate");
  els.modeConversation.classList.toggle("is-active", mode === "conversation");
  els.micHint.textContent =
    mode === "conversation" ? "Tap a person to translate what they say" : "Tap to start translating";
  savePreferences();
}

async function toggleDirection(dir) {
  // Tapping the active direction stops; tapping the other switches.
  if (listening && activeDirection === dir) {
    await stopListening();
    return;
  }
  if (listening) await stopListening();
  activeDirection = dir;
  await startListening();
}

function updateConvButtons() {
  const a = listening && activeDirection === "AtoB";
  const b = listening && activeDirection === "BtoA";
  els.convAb.setAttribute("data-active", String(a));
  els.convBa.setAttribute("data-active", String(b));
  els.convAb.querySelector(".conv-mic__label").textContent = a ? "Listening… tap to stop" : "Tap & speak";
  els.convBa.querySelector(".conv-mic__label").textContent = b ? "Listening… tap to stop" : "Tap & speak";
}

let keepCaptions = false; // set for restarts so the transcript isn't wiped

async function restartSession() {
  const dir = activeDirection; // stopListening resets it; keep the direction
  keepCaptions = true;
  await stopListening(false); // don't fragment history on a language change
  activeDirection = dir;
  appendCaption(
    els.targetCaption,
    `\n— reconnecting to translate into ${outputLanguageName(currentTarget())} —\n`,
    true
  );
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
    sessionTarget = currentTarget();

    // 1) Mint a short-lived token for this translation session.
    const token = await mintToken(sessionTarget);

    // 2) Capture mic audio (from the chosen input device, if any).
    const deviceId = localStorage.getItem(DEVICE_KEY) || "";
    const audioConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };
    localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    // Device labels are only exposed once permission is granted — refresh now.
    refreshMicDevices();

    // 3) Establish the peer connection.
    pc = new RTCPeerConnection();

    // Translated audio arrives as a remote media track — play it directly.
    pc.ontrack = (e) => {
      els.remoteAudio.srcObject = e.streams[0];
    };

    pc.addTrack(localStream.getAudioTracks()[0], localStream);

    // Transcript events flow over this data channel.
    dataChannel = pc.createDataChannel("oai-events");
    dataChannel.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    dataChannel.onopen = () => setStatus("listening", "Listening");

    pc.onconnectionstatechange = () => {
      if (!listening || !pc) return;
      if (pc.connectionState === "disconnected") {
        // WebRTC can recover from "disconnected" on its own — don't kill it.
        setStatus("connecting", "Reconnecting…");
      } else if (pc.connectionState === "connected") {
        setStatus("listening", "Listening");
      } else if (["failed", "closed"].includes(pc.connectionState)) {
        // Dead for real: stop cleanly so the mic doesn't LOOK live while
        // nothing is being translated; the transcript is saved as usual.
        showToast("Connection lost — your transcript was saved. Tap the mic to reconnect.");
        stopListening();
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
    acquireWakeLock(); // keep the phone screen on during the session
    if (!els.welcomeCard.hidden) {
      els.welcomeCard.hidden = true;
      localStorage.setItem(WELCOME_KEY, "1");
    }
    els.mic.setAttribute("data-active", "true");
    els.micHint.textContent =
      els.appView.getAttribute("data-mode") === "conversation"
        ? `Listening — translating into ${outputLanguageName(sessionTarget)}. Tap to stop.`
        : "Listening — speak naturally. Tap to stop.";
    els.remoteAudio.volume = Number(els.volume.value);
    updateConvButtons();
    startTimer();
    // On a mid-session restart (language/device change) keep the transcript
    // accumulated so far; a fresh session starts with clean captions.
    if (keepCaptions) keepCaptions = false;
    else clearCaptions();
  } catch (err) {
    console.error(err);
    keepCaptions = false;
    setStatus("error", "Error");
    showToast(
      err.name === "NotAllowedError"
        ? "Microphone permission denied. Allow mic access and try again."
        : err.message || "Could not start translation."
    );
    await stopListening();
  }
}

async function stopListening(save = true) {
  let savedEntry = null;
  // Only account for time if a session was actually running — stopListening is
  // also called from startListening's error path, where a stale startTime from
  // a PREVIOUS session would otherwise charge phantom minutes and re-save a
  // duplicate history entry.
  if (listening && startTime) {
    const seconds = Math.round((Date.now() - startTime) / 1000);
    // Account for spend (drives the balance estimate) — including on
    // language-change restarts (save=false), which are still billed time.
    if (seconds > 0) chargeUsage((seconds / 60) * pricePerMinute);
    // Persist a completed session (skip on language-swap restarts handled by save=false).
    if (save && (sourceText.trim() || targetText.trim())) {
      savedEntry = saveHistory({
        ts: Date.now(),
        target: sessionTarget || els.targetSelect.value,
        seconds,
        sourceText: sourceText.trim(),
        targetText: targetText.trim(),
      });
    }
  }
  startTime = 0;
  listening = false;
  releaseWakeLock();
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
  activeDirection = null;
  updateConvButtons();

  if (savedEntry) {
    lastSession = savedEntry;
    cloudSyncUp(savedEntry);
    generateSessionSummary(savedEntry); // auto-summarize the session that just ended
    generateRomanianTranscript(savedEntry); // auto-translate the session into Romanian
  }
}

// ----- Romanian transcript dialog -------------------------------------------
// After every session, the translated (English) transcript is also translated
// into Romanian and shown in a dialog; the text is stored on the history entry
// so it can be reopened any time from the 🇷🇴 button in History.
async function generateRomanianTranscript(entry) {
  if (!config.keyConfigured) return;
  const text = (entry.targetText || entry.sourceText || "").trim();
  if (!text) return;
  openRoModal("Se traduce în română…"); // "Translating into Romanian…"
  try {
    const romanian = await summarize(text, "translate", "Romanian");
    patchHistory(entry.id, { romanian });
    if (lastSession && lastSession.id === entry.id) lastSession = { ...lastSession, romanian };
    openRoModal(romanian);
  } catch (err) {
    openRoModal("Could not translate into Romanian: " + err.message);
  }
}

function openRoModal(text) {
  els.roModalBody.textContent = text;
  els.roModal.hidden = false;
}

function closeRoModal() {
  els.roModal.hidden = true;
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
      broadcastCaption("source", evt.delta || "");
      break;
    case "session.output_transcript.delta":
      targetText += evt.delta || "";
      appendCaption(els.targetCaption, evt.delta || "");
      broadcastCaption("target", evt.delta || "");
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

// ----- Local session history ----------------------------------------------
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(entry) {
  const items = loadHistory();
  const full = { id: String(entry.ts), ...entry };
  items.unshift(full);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50))); // cap at 50
  return full;
}

function patchHistory(id, fields) {
  const items = loadHistory().map((i) => (i.id === id ? { ...i, ...fields } : i));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

// ----- Left menu -----------------------------------------------------------
function openMenu() {
  renderHistory();
  renderBalance();
  if (isOwner) renderAllowlist();
  els.sideMenu.hidden = false;
  cloudSyncDown(); // refresh from cloud if available
}

// ----- Owner access control (allowlist management) -------------------------
async function renderAllowlist() {
  els.allowList.innerHTML = '<div class="menu__empty">Loading…</div>';
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/app_allowlist?select=email&order=created_at.desc`, {
      headers: { apikey: config.supabaseAnonKey },
    });
    if (res.status === 404) {
      els.allowList.innerHTML =
        '<div class="menu__empty">Run <code>supabase/allowlist.sql</code> once to enable.</div>';
      return;
    }
    const rows = res.ok ? await res.json() : [];
    els.allowList.innerHTML = "";
    const owner = document.createElement("div");
    owner.className = "history-item";
    owner.innerHTML = `<div class="history-item__top"><span class="history-item__lang">${escapeHtml(
      config.ownerEmail
    )}</span><span class="history-item__meta">owner</span></div>`;
    els.allowList.append(owner);
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "history-item";
      row.innerHTML = `<div class="history-item__top"><span class="history-item__lang">${escapeHtml(
        r.email
      )}</span><span class="history-item__meta"><button class="history-item__del" title="Remove">✕</button></span></div>`;
      row.querySelector(".history-item__del").addEventListener("click", () => removeAllowedEmail(r.email));
      els.allowList.append(row);
    }
  } catch {
    els.allowList.innerHTML = '<div class="menu__empty">Could not load the list.</div>';
  }
}

async function addAllowedEmail() {
  const email = els.allowInput.value.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    showToast("Enter a valid email.");
    return;
  }
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/app_allowlist`, {
      method: "POST",
      headers: { ...(await cloudHeaders()), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ email, added_by: currentUserEmail }),
    });
    if (res.status === 404) return showToast("Run supabase/allowlist.sql first.");
    if (!res.ok) throw new Error("HTTP " + res.status);
    els.allowInput.value = "";
    showToast("Allowed " + email, true);
    renderAllowlist();
  } catch (err) {
    showToast("Could not add: " + err.message);
  }
}

async function removeAllowedEmail(email) {
  try {
    const res = await fetch(
      `${config.supabaseUrl}/rest/v1/app_allowlist?email=eq.${encodeURIComponent(email)}`,
      { method: "DELETE", headers: await cloudHeaders() }
    );
    if (!res.ok && res.status !== 404) throw new Error("HTTP " + res.status);
    showToast("Removed " + email, true);
    renderAllowlist();
  } catch (err) {
    showToast("Could not remove: " + err.message);
  }
}
function closeMenu() {
  els.sideMenu.hidden = true;
}

function clearHistory() {
  if (!loadHistory().length) return;
  if (!confirm("Delete all saved sessions on this device?")) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function deleteHistoryItem(id) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory().filter((i) => i.id !== id)));
  renderHistory();
}

function renderHistory() {
  const items = loadHistory();
  els.historyList.innerHTML = "";
  if (!items.length) {
    els.historyList.innerHTML = '<div class="menu__empty">No saved sessions yet.</div>';
    return;
  }
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "history-item";
    const date = new Date(item.ts).toLocaleString();
    const dur = `${Math.floor(item.seconds / 60)}:${String(item.seconds % 60).padStart(2, "0")}`;
    const summaryHtml = item.summary
      ? `<div class="history-item__summary">${escapeHtml(item.summary)}</div>`
      : "";
    const roBtn = item.romanian
      ? '<button class="history-item__ro chip chip--mini" title="Romanian transcript">🇷🇴 RO</button> · '
      : "";
    card.innerHTML = `
      <div class="history-item__top">
        <span class="history-item__lang">→ ${escapeHtml(outputLanguageName(item.target))}</span>
        <span class="history-item__meta">${roBtn}${dur} · <button class="history-item__del" title="Delete">✕</button></span>
      </div>
      <div class="history-item__meta">${escapeHtml(date)}</div>
      <div class="history-item__preview">${escapeHtml(item.targetText || item.sourceText || "")}</div>
      ${summaryHtml}`;
    card.querySelector(".history-item__del").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteHistoryItem(item.id);
    });
    card.querySelector(".history-item__ro")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openRoModal(item.romanian);
    });
    card.addEventListener("click", () => viewHistoryItem(item));
    els.historyList.append(card);
  }
}

function viewHistoryItem(item) {
  closeMenu();
  lastSession = item;
  els.targetSelect.value = item.target;
  els.sourceCaption.innerHTML = "";
  els.targetCaption.innerHTML = "";
  appendCaption(els.sourceCaption, item.sourceText || "(no source transcript)");
  appendCaption(els.targetCaption, item.targetText || "(no translation)");
  sourceText = item.sourceText || "";
  targetText = item.targetText || "";
  if (item.summary) showSummary(item.summary);
  showToast("Loaded a saved session", true);
}

// ----- Summaries -----------------------------------------------------------
function populateSummaryLanguages() {
  const saved = localStorage.getItem(SUMMARY_LANG_KEY) || "Romanian";
  for (const lang of SUMMARY_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    els.summaryLang.append(opt);
  }
  els.summaryLang.value = SUMMARY_LANGUAGES.includes(saved) ? saved : "Romanian";
}

function summaryLanguage() {
  return els.summaryLang?.value || "Romanian";
}

async function summarize(text, mode, language) {
  const accessToken = await getAccessToken();
  const res = await fetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mode, language, accessToken }),
  });
  const data = await res.json();
  if (!res.ok || !data.summary) throw new Error(data.error || "Summary failed.");
  return data.summary;
}

function showSummary(text) {
  els.summaryBody.textContent = text;
  els.summaryCard.hidden = false;
  // Reset the per-session tools for the newly shown session.
  els.summaryActionsBody.hidden = true;
  els.summaryActionsBody.textContent = "";
  els.askAnswer.hidden = true;
  els.askAnswer.textContent = "";
  els.askInput.value = "";
  els.summaryCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Transcript text of the session currently shown in the summary card.
function currentSessionText() {
  const s = lastSession || { target: sessionTarget || els.targetSelect.value, sourceText, targetText };
  const src = (s.sourceText || "").trim();
  const tgt = (s.targetText || "").trim();
  if (!src && !tgt) return "";
  return `Spoken (source):\n${src || "(none)"}\n\nTranslation (${outputLanguageName(s.target)}):\n${tgt || "(none)"}`;
}

async function generateActionItems() {
  const text = currentSessionText();
  if (!text) {
    showToast("No session to analyze yet.");
    return;
  }
  els.summaryActionsBody.hidden = false;
  els.summaryActionsBody.textContent = "Finding action items…";
  try {
    els.summaryActionsBody.textContent = await summarize(text, "actions", summaryLanguage());
  } catch (err) {
    els.summaryActionsBody.textContent = "Could not extract action items: " + err.message;
  }
}

async function askAboutSession() {
  const question = els.askInput.value.trim();
  if (!question) return;
  const text = currentSessionText();
  if (!text) {
    showToast("No session to ask about yet.");
    return;
  }
  els.askAnswer.hidden = false;
  els.askAnswer.textContent = "Thinking…";
  try {
    const accessToken = await getAccessToken();
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, text, language: summaryLanguage(), accessToken }),
    });
    const data = await res.json();
    if (!res.ok || data.answer === undefined) throw new Error(data.error || "Ask failed.");
    els.askAnswer.textContent = data.answer || "(no answer)";
  } catch (err) {
    els.askAnswer.textContent = "Could not answer: " + err.message;
  }
}

async function generateSessionSummary(entry) {
  if (!config.keyConfigured) return;
  const text =
    `Spoken (source):\n${entry.sourceText || "(none)"}\n\n` +
    `Translation (${outputLanguageName(entry.target)}):\n${entry.targetText || "(none)"}`;
  els.summaryBody.textContent = "Summarizing this session…";
  els.summaryCard.hidden = false;
  try {
    const summary = await summarize(text, "session", summaryLanguage());
    patchHistory(entry.id, { summary });
    lastSession = { ...entry, summary };
    cloudSyncUp(lastSession);
    showSummary(summary);
  } catch (err) {
    els.summaryBody.textContent = "Could not summarize: " + err.message;
  }
}

async function summarizeAllSessions() {
  const items = loadHistory();
  if (!items.length) {
    showToast("No sessions to summarize yet.");
    return;
  }
  els.overallSummary.hidden = false;
  els.overallSummary.textContent = "Summarizing all sessions…";
  // Prefer existing per-session summaries; fall back to translated text.
  const parts = items
    .slice()
    .reverse()
    .map((it, i) => {
      const when = new Date(it.ts).toLocaleString();
      const body = it.summary || (it.targetText || "").slice(0, 600);
      return `Session ${i + 1} (${outputLanguageName(it.target)}, ${when}):\n${body}`;
    });
  try {
    const summary = await summarize(parts.join("\n\n"), "overall", summaryLanguage());
    els.overallSummary.textContent = summary;
  } catch (err) {
    els.overallSummary.textContent = "Could not summarize: " + err.message;
  }
}

// ----- OpenAI balance (client-side estimate) -------------------------------
function getBalance() {
  const v = parseFloat(localStorage.getItem(BAL_KEY));
  return Number.isFinite(v) ? v : null;
}
function getSpentTotal() {
  return parseFloat(localStorage.getItem(SPENT_KEY) || "0") || 0;
}

function chargeUsage(amount) {
  if (amount <= 0) return;
  localStorage.setItem(SPENT_KEY, String(getSpentTotal() + amount));
  const bal = getBalance();
  if (bal !== null) {
    const next = Math.max(0, bal - amount);
    localStorage.setItem(BAL_KEY, String(next));
    if (bal > 1 && next <= 1) showToast("⚠️ OpenAI balance low (≈ $1 left) — consider topping up.");
    else if (bal > 0 && next <= 0) showToast("⚠️ Estimated OpenAI balance is $0 — top up to keep translating.");
  }
  renderBalance();
}

function promptSetBalance() {
  const cur = getBalance();
  const input = prompt(
    "Enter your current OpenAI credit balance in USD (check it on the billing page):",
    cur !== null ? String(cur) : "20"
  );
  if (input === null) return;
  const val = parseFloat(input);
  if (!Number.isFinite(val) || val < 0) {
    showToast("Please enter a valid amount.");
    return;
  }
  localStorage.setItem(BAL_KEY, String(val));
  localStorage.setItem("lt-balance-initial", String(val));
  renderBalance();
  showToast("Balance set to $" + val.toFixed(2), true);
}

function renderBalance() {
  const bal = getBalance();
  const spent = getSpentTotal();
  els.balSpent.textContent = `$${spent.toFixed(3)} used`;
  if (bal === null) {
    els.balRemaining.textContent = "Set your balance →";
    els.balRemaining.className = "balance__remaining";
    els.balBar.style.width = "0%";
    els.balCredit.textContent = "";
    return;
  }
  const initial = parseFloat(localStorage.getItem("lt-balance-initial") || String(bal)) || bal;
  els.balRemaining.textContent = `≈ $${bal.toFixed(2)} left`;
  els.balCredit.textContent = `of $${initial.toFixed(2)}`;
  const pct = initial > 0 ? Math.max(0, Math.min(100, (bal / initial) * 100)) : 0;
  els.balBar.style.width = pct + "%";
  const level = bal <= 1 ? "low" : bal <= initial * 0.2 ? "warn" : "ok";
  els.balRemaining.className = "balance__remaining balance__remaining--" + level;
  els.balBar.dataset.level = level;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ----- Cloud sync (optional; activates once the sessions table exists) -----
function cloudReady() {
  return cloudAvailable && currentUserId && config?.supabaseUrl && config?.supabaseAnonKey;
}

async function cloudHeaders() {
  const token = await getAccessToken();
  return {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function cloudSyncUp(entry) {
  if (!cloudReady()) return;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/sessions?on_conflict=user_id,client_id`, {
      method: "POST",
      headers: { ...(await cloudHeaders()), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: currentUserId,
        client_id: entry.id,
        source_text: entry.sourceText || "",
        target_text: entry.targetText || "",
        summary: entry.summary || null,
        target_language: entry.target,
        duration_seconds: entry.seconds || 0,
        created_at: new Date(entry.ts).toISOString(),
      }),
    });
    if (res.status === 404) cloudAvailable = false;
  } catch {
    /* offline — local history still holds it */
  }
}

async function cloudSyncDown() {
  if (!cloudReady()) return;
  try {
    const res = await fetch(
      `${config.supabaseUrl}/rest/v1/sessions?select=*&order=created_at.desc&limit=100`,
      { headers: await cloudHeaders() }
    );
    if (res.status === 404) {
      cloudAvailable = false;
      return;
    }
    if (!res.ok) return;
    mergeCloudRows(await res.json());
  } catch {
    /* ignore */
  }
}

function mergeCloudRows(rows) {
  const byId = new Map(loadHistory().map((i) => [i.id, i]));
  for (const r of rows) {
    const id = r.client_id || String(new Date(r.created_at).getTime());
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        ts: new Date(r.created_at).getTime(),
        target: r.target_language,
        seconds: r.duration_seconds || 0,
        sourceText: r.source_text || "",
        targetText: r.target_text || "",
        summary: r.summary || undefined,
      });
    } else if (r.summary && !byId.get(id).summary) {
      byId.get(id).summary = r.summary;
    }
  }
  const merged = Array.from(byId.values()).sort((a, b) => b.ts - a.ts).slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
  if (!els.sideMenu.hidden) renderHistory();
}

// ----- PDF export (via the browser's print-to-PDF) -------------------------
function exportPdf(s) {
  if (!s || (!s.targetText && !s.sourceText && !s.summary)) {
    showToast("Nothing to export yet.");
    return;
  }
  const w = window.open("", "_blank");
  if (!w) {
    showToast("Allow pop-ups to export a PDF.");
    return;
  }
  const esc = (x) => escapeHtml(x || "");
  const when = s.ts ? new Date(s.ts).toLocaleString() : new Date().toLocaleString();
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>LiveTranslation — ${esc(
      outputLanguageName(s.target)
    )}</title><style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#1a2238;line-height:1.6}
      h1{font-size:22px;margin:0 0 2px}.meta{color:#666;font-size:13px;margin-bottom:22px}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#6d7cff;margin:22px 0 6px}
      .box{white-space:pre-wrap;background:#f5f6fb;border:1px solid #e3e7f3;border-radius:10px;padding:14px}
      .sum{white-space:pre-wrap;background:#eef7f4;border:1px solid #cfe8df;border-radius:10px;padding:14px}
      footer{margin-top:30px;color:#999;font-size:12px}
    </style></head><body>
      <h1>🎙️ LiveTranslation</h1>
      <div class="meta">Translation language: ${esc(outputLanguageName(s.target))} · ${esc(when)}</div>
      ${s.summary ? `<h2>Summary</h2><div class="sum">${esc(s.summary)}</div>` : ""}
      <h2>Spoken</h2><div class="box">${esc(s.sourceText) || "—"}</div>
      <h2>Translation</h2><div class="box">${esc(s.targetText) || "—"}</div>
      ${s.romanian ? `<h2>Romanian</h2><div class="sum">${esc(s.romanian)}</div>` : ""}
      <footer>Generated by LiveTranslation</footer>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
    </body></html>`
  );
  w.document.close();
}

// ----- Live broadcast (Supabase Realtime; SDK loaded lazily) ---------------
let _sbClient = null;
let liveChannel = null;
let liveRoomId = null;

async function getSupabaseClient() {
  if (_sbClient) return _sbClient;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  _sbClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return _sbClient;
}

async function toggleGoLive() {
  if (liveChannel) return stopLive();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    showToast("Live sharing needs Supabase configured.");
    return;
  }
  try {
    els.goLive.textContent = "📡 Starting…";
    liveRoomId = Math.random().toString(36).slice(2, 8);
    const sb = await getSupabaseClient();
    liveChannel = sb.channel(`lt-live-${liveRoomId}`, { config: { broadcast: { self: false } } });
    await liveChannel.subscribe();
    els.liveLink.value = `${location.origin}/?live=${liveRoomId}`;
    els.liveShare.hidden = false;
    els.goLive.textContent = "📡 Stop live";
    els.goLive.dataset.on = "true";
    showToast("You're live — share the link so others can follow.", true);
  } catch (err) {
    showToast("Could not start live: " + err.message);
    stopLive();
  }
}

function stopLive() {
  try {
    liveChannel?.unsubscribe();
  } catch {}
  liveChannel = null;
  liveRoomId = null;
  els.liveShare.hidden = true;
  els.goLive.textContent = "📡 Go live";
  els.goLive.dataset.on = "false";
}

function broadcastCaption(kind, delta) {
  if (!liveChannel || !delta) return;
  liveChannel.send({ type: "broadcast", event: "cap", payload: { kind, delta } });
}

async function startListenerMode(room) {
  // Show only the read-only live view.
  els.authView.hidden = true;
  els.appView.hidden = true;
  els.liveView.hidden = false;
  const setStatus = (t) => {
    els.liveStatus.querySelector("span:last-child").textContent = t;
  };
  if (!config?.supabaseUrl) {
    setStatus("Live unavailable");
    return;
  }
  try {
    const sb = await getSupabaseClient();
    const ch = sb.channel(`lt-live-${room}`, { config: { broadcast: { self: true } } });
    ch.on("broadcast", { event: "cap" }, ({ payload }) => {
      const node = payload.kind === "source" ? els.liveSource : els.liveTarget;
      const ph = node.querySelector(".caption__placeholder");
      if (ph) ph.remove();
      node.append(document.createTextNode(payload.delta || ""));
      node.scrollTop = node.scrollHeight;
      els.liveStatus.setAttribute("data-state", "listening");
      setStatus("Live");
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") setStatus("Connected — waiting for speaker…");
    });
  } catch (err) {
    setStatus("Could not connect");
  }
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
