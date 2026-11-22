import { Playback } from './playback.js';
import { MUSIC_RATES, MUSIC_START_FRAME } from './sequences.js';

class SIDcogProcessor extends AudioWorkletProcessor {
  constructor({processorOptions}) {
    super();
    const {table, program, manualImage} = processorOptions;
    this.player = new Playback(table, sampleRate, program, manualImage);
    this.requested = false;
    this.envelope = 0;
    this.slope = 1 / (0.012 * sampleRate);
    this.pending = null;
    this.scope = new Float32Array(512);
    this.pool = [new Float32Array(512), new Float32Array(512)];
    this.write = 0;
    this.elapsed = 0;
    this.epoch = 0;
    this.dirty = true;
    this.packet = {
      type: 'scope', registers: new Uint8Array(25), changedBits: this.player.changedBits,
      levels: new Uint8Array(3), wave: null
    };
    this.port.onmessage = ({data}) => {
      switch (data.type) {
        case 'run':
          this.requested = data.value;
          break;
        case 'select':
          this.pending = data;
          break;
        case 'manual':
          this.player.setManual(data.image);
          this.dirty = true;
          break;
        case 'track':
          if (this.archiveId && this.archiveId !== data.track.id) this.player.program.delete(this.archiveId);
          this.archiveId = data.track.id;
          this.player.program.set(data.track.id, data.track);
          break;
        case 'dump':
          this.player.program.set('import', data.track);
          break;
        case 'music-settings': {
          const music = this.player.program.get('music');
          if (music && MUSIC_RATES.includes(data.rate)) {
            const startFrame = data.includePrelude ? 0 : MUSIC_START_FRAME;
            this.player.program.set('music', {...music, rate:data.rate, startFrame});
          }
          break;
        }
        case 'recycle':
          if (this.pool.length < 2) this.pool.push(data.wave);
          break;
      }
    };
  }

  publishScope() {
    const buffer = this.pool.pop();
    if (!buffer) return;
    for (let i = 0; i < buffer.length; i++) buffer[i] = this.scope[(this.write + i) & 511];
    const packet = this.packet;
    packet.epoch = this.epoch;
    packet.id = this.player.id;
    packet.seconds = this.player.seconds;
    packet.ended = this.player.ended;
    packet.contextTime = currentTime;
    packet.registers.set(this.player.sid.registers);
    for (let i = 0; i < 3; i++) packet.levels[i] = this.player.sid.voices[i].level >>> 24;
    packet.frame = this.player.sequenceIndex ? (this.player.track?.startFrame ?? 0) + this.player.sequenceIndex - 1 : -1;
    packet.wave = buffer;
    this.port.postMessage(packet, [buffer.buffer]);
    this.player.changedBits.fill(0);
    this.dirty = false;
    packet.wave = null;
  }

  process(_input, outputs) {
    const mono = outputs[0][0];
    if (!mono) return true;
    for (let i = 0; i < mono.length; i++) {
      if (this.pending && this.envelope === 0) {
        const {id, advance, epoch} = this.pending;
        this.player.select(id, advance);
        this.scope.fill(0);
        this.write = 0;
        this.epoch = epoch;
        this.dirty = true;
        this.elapsed = sampleRate / 30;
        this.pending = null;
      }
      const running = this.requested && !this.pending && !this.player.ended;
      if (running) this.envelope = Math.min(1, this.envelope + this.slope);
      else this.envelope = Math.max(0, this.envelope - this.slope);

      const wasEnded = this.player.ended;
      const pcm = this.envelope > 0 ? this.player.sample() * this.envelope : 0;
      if (this.envelope > 0 || this.player.ended !== wasEnded) this.dirty = true;
      mono[i] = pcm;
      if (this.envelope > 0 || this.player.ended) {
        this.scope[this.write] = pcm;
        this.write = (this.write + 1) & 511;
      }
    }
    this.elapsed += mono.length;
    if (this.elapsed >= sampleRate / 30) {
      this.elapsed = 0;
      if (this.dirty) this.publishScope();
    }
    return true;
  }
}

registerProcessor('sidcog-browser', SIDcogProcessor);
