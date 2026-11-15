// Runs on the audio thread: collects input samples and hands them, in blocks of 1024, to the detector
// worker. Each block carries `frame`: the AudioContext frame (the `currentFrame` timeline, i.e.
// `currentTime * sampleRate`) of its FIRST sample. That is what aligns detector time with context time.
// The page transfers a MessagePort connected straight to the worker ({ port }); without one, blocks go
// to the node's own port.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
    this.start = 0;
    this.out = this.port;
    this.port.onmessage = (ev) => {
      if (ev.data && ev.data.port) this.out = ev.data.port;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.start = currentFrame + i;
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          const samples = this.buf;
          this.out.postMessage({ samples, frame: this.start }, [samples.buffer]);
          this.buf = new Float32Array(1024);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
