// Browser port of P1 SIDcog v1.4. See assets/NOTICE.txt for authors and terms.
export const P1_CLOCK = 80_000_000;
export const SID_CLOCK = 985_248;
export const TICKS_PER_SAMPLE = Math.floor(P1_CLOCK / Math.floor(SID_CLOCK / 32));
export const INTERNAL_RATE = P1_CLOCK / TICKS_PER_SAMPLE;
export const REGISTER_COUNT = 25;
export const PHASE_UNITS = 0x1_0000_0000;
const MID = 0x8000_0000;
const CLIP = 0x0800_0000;
const NOISE_ADD = 0b10101010101 << 23;

// Spin DAT expressions are evaluated using single-precision floating point.
const envelopeRates = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126,
  3907, 11720, 19532, 31251].map(period =>
  Math.trunc(Math.fround(Math.fround(545014038.181330) * Math.fround(1 / period))));
const previous = [2, 0, 1];
const next = [1, 2, 0];

class Voice {
  reset() {
    this.phase = 0;
    this.noise = 0xffffff;
    this.level = 0;
    this.divide = 0;
    this.stage = 2;
    this.sample = 0;
  }

  decode(registers, offset) {
    this.step = (registers[offset] | (registers[offset + 1] << 8)) << 13;
    this.width = ((registers[offset + 2] | ((registers[offset + 3] & 15) << 8)) << 20) >>> 0;
    this.control = registers[offset + 4];
    this.shape = this.control >>> 4;
    if (this.stage === 2 && (this.control & 1)) this.stage = 0;
    if (!(this.control & 1)) this.stage = 2;
    const ad = registers[offset + 5];
    const sr = registers[offset + 6];
    this.attack = envelopeRates[ad >>> 4];
    this.decay = envelopeRates[ad & 15];
    this.sustain = ((sr >>> 4) * 17 * 0x1000000) >>> 0;
    this.release = envelopeRates[sr & 15];
  }

  envelope(wave) {
    const belowThreshold = this.level < (0x6c6c6c6c >>> (this.divide & 31));
    if (this.stage === 0) {
      if (!belowThreshold && this.divide) this.divide--;
      const level = this.level + this.attack;
      if (level >= PHASE_UNITS) {
        this.level = 0xffffffff;
        this.stage = 1;
      } else {
        this.level = level;
      }
    } else {
      if (belowThreshold) this.divide++;
      const shift = this.level <= 0x5d5d5d5d ? this.divide & 31 : 0;
      if (this.stage === 1) {
        // PASM SUB wraps before MIN applies the unsigned floor.
        this.level = Math.max((this.level - (this.decay >>> shift)) >>> 0, this.sustain);
      } else {
        const step = this.release >>> shift;
        if (this.level >= step) this.level -= step;
      }
    }
    this.sample = Math.imul((wave >>> 14) - 0x20000, this.level >>> 24);
  }
}

export class SIDcog {
  constructor(table) {
    if (!(table instanceof Uint8Array) || table.length !== 1024) {
      throw new RangeError('SIDcog needs its 1,024-byte combined waveform table.');
    }
    this.table = table;
    this.registers = new Uint8Array(REGISTER_COUNT);
    this.voices = [new Voice(), new Voice(), new Voice()];
    this.reset();
  }

  reset() {
    this.registers.fill(0);
    for (const voice of this.voices) voice.reset();
    this.low = this.band = this.high = 0;
    this.pwm = MID;
    this.dirty = true;
  }

  write(offset, value) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= REGISTER_COUNT) {
      throw new RangeError('SID register offset must be between 0 and 24.');
    }
    this.registers[offset] = value;
    this.dirty = true;
  }

  load(image, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || image.length < offset + REGISTER_COUNT) {
      throw new RangeError('A SID register image requires 25 consecutive bytes.');
    }
    for (let i = 0; i < REGISTER_COUNT; i++) this.registers[i] = image[offset + i];
    this.dirty = true;
  }

  decode() {
    const bytes = this.registers;
    for (let i = 0; i < 3; i++) this.voices[i].decode(bytes, i * 7);
    this.routing = bytes[23] & 7;
    this.resonance = (bytes[23] >>> 4) + 6;
    this.mode = bytes[24];
    // P1 getRegisters uses the low bits of filter control in place of FC_LO.
    this.cutoff = (bytes[22] << 3) + this.routing + 12;
    this.bandCutoff = Math.min(1100, this.cutoff);
    this.dirty = false;
  }

  waveform(index, voice) {
    const {phase, shape, control, step, noise} = voice;
    const ring = (control & 4) && (this.voices[previous[index]].phase & MID);
    switch (shape) {
      case 0: return MID;
      case 1: {
        const triangle = (phase << 1) ^ (phase & MID ? -1 : 0);
        return ring ? ~triangle : triangle;
      }
      case 2: return phase;
      case 4: return phase > voice.width ? -1 : 0;
      case 8: {
        const lowPhase = phase & 0x0fff_ffff;
        if (lowPhase < step) {
          // P1 TEST WC computes parity; RCR injects it at bit 31.
          const feedback = ((noise >>> 8) ^ (noise >>> 13)) & 1;
          voice.noise = ((noise >>> 1) | (feedback << 31)) >>> 0;
        }
        return (((noise & 0x1ff) << 23) | ((lowPhase - step) & 0x7fffff)) + NOISE_ADD | 0;
      }
      default: {
        if (shape & 8) return MID;
        const phaseIndex = (phase >>> 24) ^ (ring ? 0x80 : 0);
        const sample = this.table[(Math.max(0, shape - 4) << 8) + phaseIndex];
        // Combined3 in the January 2021 file shifts by 2. Voices 1 and 2 use 24.
        return sample << (index === 2 ? 2 : 24);
      }
    }
  }

  sampleDuty() {
    if (this.dirty) this.decode();
    const voices = this.voices;
    for (let i = 0; i < 3; i++) {
      const voice = voices[i];
      const target = voices[next[i]];
      const sum = voice.phase + voice.step;
      voice.phase = sum >>> 0;
      if ((target.control & 8) || (sum >= PHASE_UNITS && (target.control & 2))) target.phase = 0;
    }

    // Combined1 branches to Envelope3 for noise plus another waveform.
    if (voices[0].shape > 8) {
      voices[2].envelope(MID);
    } else {
      for (let i = 0; i < 3; i++) voices[i].envelope(this.waveform(i, voices[i]));
    }

    let routed = 0;
    let direct = 0;
    for (let i = 0; i < 3; i++) {
      if (this.routing & (1 << i)) routed += voices[i].sample;
      else direct += voices[i].sample;
    }
    this.high = (routed - this.band + Math.imul(this.band >> 5, this.resonance) - this.low) | 0;
    this.band = (this.band + Math.imul(this.high >> 10, this.bandCutoff)) | 0;
    this.low = (this.low + Math.imul(this.band >> 11, this.cutoff)) | 0;
    if (this.mode & 0x10) direct += this.low;
    if (this.mode & 0x20) direct += this.band;
    if (this.mode & 0x40) direct += this.high;
    const mixed = Math.max(-CLIP, Math.min(CLIP, direct | 0));
    this.pwm = (Math.imul(mixed, this.mode & 15) + MID) >>> 0;
    return this.pwm;
  }

  sample() {
    return (this.sampleDuty() - MID) / MID;
  }

  diagnostic() {
    if (this.dirty) this.decode();
    return {
      registers: Array.from(this.registers),
      voices: this.voices.map(v => ({
        phase: v.phase, step: v.step, width: v.width >>> 20,
        noise: v.noise, stage: v.stage, level: v.level, divider: v.divide, output: v.sample
      })),
      filter: {cutoff: this.cutoff, routing: this.routing, low: this.low, band: this.band, high: this.high},
      pwm: this.pwm,
      internalRate: INTERNAL_RATE
    };
  }
}
