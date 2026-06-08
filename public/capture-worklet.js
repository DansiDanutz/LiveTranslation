// capture-worklet.js
// Runs on the audio thread. Receives mic audio at the AudioContext sample rate
// (commonly 48 kHz), downsamples to the documented 24 kHz, converts Float32 ->
// PCM16, and posts base64-encoded chunks back to the main thread.

const TARGET_RATE = 24000;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._ratio = sampleRate / TARGET_RATE; // sampleRate is a global in worklets
    this._muted = false;
    this.port.onmessage = (e) => {
      if (e.data?.type === "mute") this._muted = e.data.value;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    if (this._muted) return true;

    // Accumulate, then emit in ~chunks for steady streaming.
    for (let i = 0; i < channel.length; i++) this._buffer.push(channel[i]);

    // Emit roughly every 100ms of source audio.
    const framesNeeded = Math.floor(sampleRate * 0.1);
    if (this._buffer.length >= framesNeeded) {
      const pcm = this._downsampleToPCM16(this._buffer);
      this._buffer = [];
      // Compute a simple RMS level for the UI meter.
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      const rms = Math.sqrt(sum / Math.max(pcm.length, 1)) / 32768;
      this.port.postMessage({ type: "audio", pcm: pcm.buffer, level: rms }, [
        pcm.buffer,
      ]);
    }
    return true;
  }

  _downsampleToPCM16(samples) {
    const outLength = Math.floor(samples.length / this._ratio);
    const out = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const s = samples[Math.floor(i * this._ratio)];
      const clamped = Math.max(-1, Math.min(1, s));
      out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return out;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
