import { INTERNAL_RATE, P1_CLOCK, REGISTER_COUNT, SIDcog, TICKS_PER_SAMPLE } from './dsp.js';

export class Playback {
  constructor(table, outputRate, program, manualImage) {
    this.sid = new SIDcog(table);
    this.program = new Map(program.map(track => [track.id, track]));
    this.outputRate = outputRate;
    this.resamplingDenominator = TICKS_PER_SAMPLE * outputRate;
    this.dcCoefficient = Math.exp(-2 * Math.PI * 12 / outputRate);
    this.manualImage = manualImage;
    this.changedBits = new Uint8Array(REGISTER_COUNT);
    this.select('music', true);
  }

  select(id, advance) {
    this.id = id;
    this.advance = advance;
    this.track = this.program.get(id);
    const firstFrame = this.track?.startFrame ?? 0;
    this.startOffset = firstFrame * REGISTER_COUNT;
    const lastFrame = this.track
      ? Math.min(this.track.data.length / REGISTER_COUNT, this.track.endFrame ?? Infinity) : 0;
    this.endOffset = lastFrame * REGISTER_COUNT;
    this.duration = this.track ? (lastFrame - firstFrame) / this.track.rate : Infinity;
    this.outputLength = Math.ceil(this.duration * this.outputRate);
    this.sid.reset();
    this.changedBits.fill(0);
    this.sourceIndex = 0;
    this.outputIndex = 0;
    this.sequenceIndex = 0;
    this.phase = 0;
    this.nextImage = 0;
    this.dcInput = this.dcOutput = 0;
    this.x0 = this.x1 = 0;
    this.primed = false;
    this.ended = false;
    if (id === 'manual') this.sid.load(this.manualImage);
  }

  setManual(image) {
    this.manualImage = image;
    if (this.id === 'manual') this.loadImage(image, 0);
  }

  get seconds() {
    return this.outputIndex / this.outputRate;
  }

  nextChapter() {
    if (!this.advance) return;
    if (this.id === 'intro') return 'main';
    if (this.id === 'main') return 'music';
  }

  // Accumulate every changed bit between scope packets, including short gate pulses.
  loadImage(data, offset) {
    const previous = this.sid.registers;
    for (let i = 0; i < REGISTER_COUNT; i++) {
      this.changedBits[i] |= previous[i] ^ data[offset + i];
    }
    this.sid.load(data, offset);
  }

  readSource() {
    if (this.sourceIndex >= this.nextImage && this.track) {
      const position = this.startOffset + this.sequenceIndex * REGISTER_COUNT;
      if (position < this.endOffset) {
        this.loadImage(this.track.data, position);
        this.sequenceIndex++;
        this.nextImage = Math.ceil(this.sequenceIndex * INTERNAL_RATE / this.track.rate);
      }
    }
    this.sourceIndex++;
    return this.sid.sample();
  }

  sample() {
    if (this.outputIndex >= this.outputLength) {
      const next = this.nextChapter();
      if (!next) {
        this.ended = true;
        return 0;
      }
      this.select(next, true);
    }
    if (!this.primed) {
      this.x0 = this.readSource();
      this.x1 = this.readSource();
      this.primed = true;
    }
    const value = this.x0 + (this.x1 - this.x0) * (this.phase / this.resamplingDenominator);
    this.phase += P1_CLOCK;
    while (this.phase >= this.resamplingDenominator) {
      this.phase -= this.resamplingDenominator;
      this.x0 = this.x1;
      this.x1 = this.readSource();
    }

    // Remove residual DC from asymmetric waves and preserve headroom after the
    // source's own mixer clipping. This gain is independent of SID volume.
    this.dcOutput = value - this.dcInput + this.dcCoefficient * this.dcOutput;
    this.dcInput = value;
    const fade = Math.min(1, this.seconds / 0.012, (this.duration - this.seconds) / 0.02);
    this.outputIndex++;
    return this.dcOutput * fade * 0.5;
  }
}
