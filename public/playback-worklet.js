// playback-worklet.js
// Plays back translated audio. The main thread posts Float32 PCM frames
// (already decoded from the model's 24 kHz PCM16 output) into a ring buffer;
// this processor streams them to the speakers without gaps.

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._current = null;
    this._offset = 0;
    this._muted = false;
    this.port.onmessage = (e) => {
      const { type } = e.data;
      if (type === "samples") this._queue.push(new Float32Array(e.data.samples));
      else if (type === "mute") this._muted = e.data.value;
      else if (type === "clear") {
        this._queue = [];
        this._current = null;
        this._offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const channel = output[0];

    for (let i = 0; i < channel.length; i++) {
      if (this._muted) {
        channel[i] = 0;
        continue;
      }
      if (!this._current || this._offset >= this._current.length) {
        this._current = this._queue.shift() || null;
        this._offset = 0;
      }
      channel[i] = this._current ? this._current[this._offset++] : 0;
    }

    // Mirror to any additional channels (stereo).
    for (let c = 1; c < output.length; c++) output[c].set(channel);
    return true;
  }
}

registerProcessor("playback-processor", PlaybackProcessor);
