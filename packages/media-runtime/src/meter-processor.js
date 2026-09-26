// AudioWorklet meter processor. Served as a same-origin file: the studio's Content-Security-Policy
// (script-src 'self') blocks worklet modules from blob: or data: URLs.
// Posts per-channel peak and RMS at ~30 Hz, plus a clip flag if any |sample| >= 0.999.
/* global AudioWorkletProcessor, registerProcessor, sampleRate -- AudioWorkletGlobalScope */
class RsMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peak = [0, 0];
    this.sum = [0, 0];
    this.n = 0;
    this.clip = false;
    this.every = Math.round(sampleRate / 30);
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      for (let c = 0; c < 2; c++) {
        const ch = input[Math.min(c, input.length - 1)];
        for (let i = 0; i < ch.length; i++) {
          const a = Math.abs(ch[i]);
          if (a > this.peak[c]) this.peak[c] = a;
          if (a >= 0.999) this.clip = true;
          this.sum[c] += ch[i] * ch[i];
        }
      }
      this.n += input[0].length;
    }
    if (this.n >= this.every) {
      this.port.postMessage({
        peak: this.peak,
        rms: [Math.sqrt(this.sum[0] / this.n), Math.sqrt(this.sum[1] / this.n)],
        clip: this.clip,
      });
      this.peak = [0, 0];
      this.sum = [0, 0];
      this.n = 0;
      this.clip = false;
    }
    return true;
  }
}
registerProcessor('rs-meter', RsMeter);
