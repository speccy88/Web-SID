import { INTERNAL_RATE } from './dsp.js';
import { bitmapText } from './font.js';

const colors = ['#77e4c4', '#d4acff', '#ffb386'];
const labels = ['F.lo', 'F.hi', 'PW.lo', 'PW.hi', 'Ctrl', 'A/D', 'S/R'];
const descriptions = ['Frequency low', 'Frequency high', 'Pulse width low', 'Pulse width high',
  'Control', 'Attack and decay', 'Sustain and release'];
const shapes = ['Triangle', 'Saw', 'Pulse', 'Noise'];
const waveNames = Array.from({length: 16}, (_, bits) =>
  shapes.filter((_, i) => bits & (1 << i)).join(' + ') || 'Off');
const hex = Array.from({length: 256}, (_, n) => n.toString(16).toUpperCase().padStart(2, '0'));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const element = (tag, name) => Object.assign(document.createElement(tag), {className: name});
const setText = (el, value) => { if (el.textContent !== value) el.textContent = value; };

export function drawWordmark(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = 62;
  canvas.height = 9;
  ctx.fillStyle = '#524574';
  bitmapText(ctx, 'SIDcog', 1, 2, 1);
  bitmapText(ctx, 'DEMO', 39, 2, 1);
  ctx.fillStyle = '#f6eee1';
  bitmapText(ctx, 'SIDcog', 0, 0, 1);
  ctx.fillStyle = '#a0efcf';
  bitmapText(ctx, 'DEMO', 38, 0, 1);
}

class VoiceStrip {
  constructor(parent, index) {
    this.offset = index * 7;
    this.color = colors[index];
    this.miniMeter = document.querySelectorAll('.mobile-levels i')[index];
    this.miniMeter.style.setProperty('--voice', this.color);
    this.history = new Uint8Array(80);
    this.trails = new Uint8Array(56);
    this.index = 0;
    this.row = element('section', 'voice-strip');
    this.row.style.setProperty('--voice', this.color);
    this.row.innerHTML = `
      <div class="voice-head">
        <div class="voice-info">
          <div class="voice-title"><h3>Voice ${index + 1}</h3><span class="gate">Gate</span></div>
          <div class="pitch"></div>
        </div>
        <div class="envelope" title="Amplitude envelope from the synthesis engine">
          <canvas width="80" height="15" aria-hidden="true"></canvas>
          <div><span>Envelope</span> <span class="level-value">0%</span></div>
        </div>
      </div>
      <div class="byte-list"></div>`;
    parent.append(this.row);
    this.gate = this.row.querySelector('.gate');
    this.pitch = this.row.querySelector('.pitch');
    this.scope = this.row.querySelector('.envelope canvas').getContext('2d');
    this.levelText = this.row.querySelector('.level-value');
    const list = this.row.querySelector('.byte-list');
    this.cells = labels.map((label, i) => {
      const box = element('div', 'byte');
      box.title = '$' + hex[this.offset + i] + ' · ' + descriptions[i] + ' (high bit at left)';
      box.innerHTML = '<span>' + label + '</span><strong>00</strong><canvas width="23" height="2" aria-hidden="true"></canvas>';
      list.append(box);
      return {number: box.querySelector('strong'), bits: box.querySelector('canvas').getContext('2d')};
    });
  }

  reset() {
    this.index = 0;
    this.history.fill(0);
    this.trails.fill(0);
  }

  envelope(level, advance) {
    if (advance) {
      this.history[this.index] = level;
      this.index = (this.index + 1) % this.history.length;
    }
    const {scope, history} = this;
    scope.clearRect(0, 0, 80, 15);
    scope.fillStyle = '#34374d';
    for (let x = 0; x < 80; x += 4) scope.fillRect(x, 14, 1, 1);
    scope.fillStyle = this.color;
    if (reducedMotion.matches) {
      scope.fillRect(0, 9, Math.round(80 * level / 255), 3);
    } else {
      let previous = null;
      for (let x = 0; x < history.length; x++) {
        const y = 14 - Math.round(14 * history[(this.index + x) % history.length] / 255);
        scope.fillRect(x, previous === null ? y : Math.min(y, previous), 1, previous === null ? 1 : Math.abs(y - previous) + 1);
        previous = y;
      }
    }
    const percent = Math.round(level * 100 / 255) + '%';
    setText(this.levelText, percent);
    this.miniMeter.style.setProperty('--level', percent);
  }

  update(registers, levels, changes) {
    const base = this.offset;
    const control = registers[base + 4];
    const freq = (registers[base] | (registers[base + 1] << 8)) * INTERNAL_RATE / 524288;
    this.gate.classList.toggle('on', Boolean(control & 1));
    this.gate.setAttribute('aria-label', control & 1 ? 'Gate on' : 'Gate off');
    setText(this.pitch, waveNames[control >>> 4] + ' · ' + Math.round(freq) + ' Hz');
    const latest = this.history[(this.index + this.history.length - 1) % this.history.length];
    this.envelope(levels ? levels[base / 7] : latest, Boolean(levels));
    for (let i = 0; i < 7; i++) {
      const {number, bits} = this.cells[i];
      const byte = registers[base + i];
      setText(number, hex[byte]);
      const changed = changes?.[base + i] || 0;
      for (let b = 0; b < 8; b++) {
        const mask = 128 >>> b;
        const at = i * 8 + b;
        if (changed & mask) this.trails[at] = 4;
        else if (this.trails[at]) this.trails[at]--;
        const lit = (byte & mask) !== 0;
        const trail = reducedMotion.matches ? 0 : this.trails[at];
        bits.fillStyle = lit ? this.color : '#38374a';
        bits.fillRect(b * 3, 0, 2, 2);
        if (trail) {
          bits.globalAlpha = trail * 0.16;
          bits.fillStyle = '#fff4df';
          bits.fillRect(b * 3, 0, 2, 1);
          bits.globalAlpha = 1;
        }
      }
    }
  }
}

export class RegisterRack {
  constructor(container) {
    this.voices = colors.map((_, index) => new VoiceStrip(container, index));
    this.plot = document.getElementById('activity').getContext('2d');
    this.activity = new Uint8Array(25 * 120);
    this.lastTick = -1;
    this.frame = document.getElementById('frame-readout');
    this.cutoff = document.getElementById('cutoff-readout');
    this.res = document.getElementById('res-readout');
    this.volume = document.getElementById('vol-readout');
  }

  reset() {
    for (const voice of this.voices) voice.reset();
    this.activity.fill(0);
    this.lastTick = -1;
    this.drawActivity(0);
  }

  drawActivity(tick) {
    const ctx = this.plot;
    ctx.fillStyle = '#13121b';
    ctx.fillRect(0, 0, 240, 59);
    for (let x = 0; x < 120; x++) {
      const time = tick - 119 + x;
      if (time % 30 === 0) {
        ctx.fillStyle = '#343042';
        ctx.fillRect(x * 2, 0, 1, 59);
      }
    }
    for (let reg = 0; reg < 25; reg++) {
      const group = Math.floor(reg / 7);
      const y = reg * 2 + group * 3;
      if (reg % 7 === 0 && group) {
        ctx.fillStyle = '#393343';
        ctx.fillRect(0, y - 2, 240, 1);
      }
      ctx.fillStyle = colors[group] || '#aabfe7';
      for (let x = 0; x < 120; x++) {
        const time = tick - 119 + x;
        if (time >= 0 && this.activity[(time % 120) * 25 + reg]) ctx.fillRect(x * 2, y, 2, 2);
      }
    }
  }

  recordActivity(seconds, changes) {
    const tick = Math.floor(seconds * 30);
    if (this.lastTick > tick || tick - this.lastTick >= 120) this.activity.fill(0);
    else {
      for (let n = this.lastTick + 1; n <= tick; n++) {
        const base = (n % 120) * 25;
        this.activity.fill(0, base, base + 25);
      }
    }
    this.lastTick = tick;
    const offset = (tick % 120) * 25;
    for (let i = 0; i < 25; i++) this.activity[offset + i] |= changes[i];
    // Reduce screen movement by updating the raster in quarter-second batches.
    if (!reducedMotion.matches || tick % 8 === 0) this.drawActivity(tick);
  }

  update(registers, levels, changes, frame = -1, seconds = 0) {
    if (changes) this.recordActivity(seconds, changes);
    for (const voice of this.voices) voice.update(registers, levels, changes);
    setText(this.frame, frame >= 0 ? 'FRAME ' + String(frame).padStart(6, '0') : 'FRAME —');
    setText(this.cutoff, String((registers[22] << 3) | (registers[21] & 7)));
    setText(this.res, String(registers[23] >>> 4));
    setText(this.volume, String(registers[24] & 15));
  }
}
