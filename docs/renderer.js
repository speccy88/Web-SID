import { bitmapText, centerText } from './font.js';
import { EXTRA_DUMPS, INTRO_CUES, MAIN_CUES } from './sequences.js';

const WIDTH = 450;
const HEIGHT = 360;
const ACTIVE = { x: 59, y: 59, width: 335, height: 240 };
const COLOR = { border: '#8089e1', field: '#171969', white: '#f9f9fb', cyan: '#d9ffea' };
const musicLabels = {music: '013.DMP MUSIC', import: 'LOCAL DUMP', manual: 'MANUAL'};
for (const dump of EXTRA_DUMPS) musicLabels[dump.id] = dump.label.toUpperCase();

function makeTile() {
  const canvas = document.createElement('canvas');
  canvas.width = 288;
  canvas.height = 88;
  const tile = canvas.getContext('2d');
  for (let row = 0; row < 4; row++) {
    const run = row & 1 ? 'cog SID cog SID cog SID ' : 'SID cog SID cog SID cog ';
    tile.fillStyle = row & 1 ? '#33388f' : '#434aa9';
    bitmapText(tile, run, 1, 3 + row * 22, 2, 2);
    tile.fillStyle = row & 1 ? '#252674' : '#272b86';
    tile.globalCompositeOperation = 'destination-over';
    bitmapText(tile, run, 3, 5 + row * 22, 2, 2);
    tile.globalCompositeOperation = 'source-over';
  }
  return canvas;
}

function scrollText(ctx, cues, t, y, width, left, scale) {
  let cue = cues[0];
  for (const next of cues) if (t >= next[0]) cue = next;
  const travel = t - cue[0];
  const textWidth = cue[1].length * 6 * scale;
  const start = Math.round(left + width - Math.min(width * 0.77, width - 24));
  const x = start - Math.floor(travel * (scale === 4 ? 87 : 57));
  ctx.fillStyle = COLOR.white;
  bitmapText(ctx, cue[1], x, y, scale);
  if (x + textWidth < left + 28) bitmapText(ctx, cue[1], x + textWidth + width * 0.8, y, scale);
}

function plot(ctx, buffer, originX, y, width, maxHeight, alpha, color, ringOffset = 0) {
  // This uses successive PCM values from the worklet. Rising-edge triggering
  // makes stable pitches easier to read and leaves noise free-running.
  let start = 0;
  if (buffer) {
    const limit = Math.min(210, buffer.length - 300);
    for (let i = 10; i < limit; i++) {
      if (buffer[i - 1] < 0 && buffer[i] >= 0 && buffer[i + 6] > 0.002) {
        start = i;
        break;
      }
    }
  }

  let peak = 0;
  if (buffer) {
    for (let i = start; i < start + 290; i++) peak = Math.max(peak, Math.abs(buffer[i]));
  }
  const scale = peak > 0 ? Math.min(780, maxHeight / peak) : 0;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const sample = buffer ? buffer[start + Math.floor(x * 290 / width)] : 0;
    const height = sample * scale;
    const px = originX + x + 0.5;
    const py = Math.round(y - height + ringOffset) + 0.5;
    if (x === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export class Display {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d', {alpha: false});
    this.ctx.imageSmoothingEnabled = false;
    this.tile = makeTile();
    this.crt = false;
    this.wave = null;
    this.trail = null;
    this.older = null;
    this.scan = document.createElement('canvas');
    this.scan.width = WIDTH;
    this.scan.height = HEIGHT;
    const ctx = this.scan.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 16, 0.17)';
    for (let y = 1; y < HEIGHT; y += 3) ctx.fillRect(0, y, WIDTH, 1);
    const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 80, WIDTH / 2, HEIGHT / 2, 285);
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(0.7, 'transparent');
    vignette.addColorStop(1, 'rgba(0, 0, 18, 0.27)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  setWave(pcm) {
    this.older = this.trail;
    this.trail = this.wave;
    this.wave = pcm;
  }

  clear() {
    this.wave = this.trail = this.older = null;
  }

  tiles(t) {
    const {ctx, tile} = this;
    for (let y = 0; y < ACTIVE.height; y++) {
      const stretch = 0.82 + 0.20 * Math.sin(t * 0.66 + y * 0.017) + 0.18 * Math.sin(y * 0.042 - t * 0.97);
      const rowWidth = Math.max(130, Math.round(stretch * tile.width));
      const shift = 32 * Math.sin(y * 0.061 + t * 1.55) + 16 * Math.sin(y * 0.123 - t * 1.04) - t * 33;
      const start = ACTIVE.x + (Math.floor(shift) % rowWidth + rowWidth) % rowWidth - rowWidth;
      const sy = ((Math.floor(y * (0.9 + 0.16 * Math.sin(t * 0.72)) + 7 * Math.sin(t * 1.12 + y * 0.026) + t * 17) % tile.height) + tile.height) % tile.height;
      for (let x = start; x < ACTIVE.x + ACTIVE.width; x += rowWidth) {
        ctx.drawImage(tile, 0, sy, tile.width, 1, x, ACTIVE.y + y, rowWidth, 1);
      }
    }
  }

  waveform(x, y, width, maxHeight, color) {
    if (this.crt && this.trail) {
      if (this.older) plot(this.ctx, this.older, x, y, width, maxHeight, 0.13, color, 1);
      plot(this.ctx, this.trail, x, y, width, maxHeight, 0.27, color);
    }
    plot(this.ctx, this.wave, x, y, width, maxHeight, 1, color);
  }

  draw(id, t) {
    const {ctx} = this;
    if (id === 'intro') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      this.waveform(33, 132, 384, 50, COLOR.white);
      scrollText(ctx, INTRO_CUES, t, 217, WIDTH, 0, 4);
    } else {
      ctx.fillStyle = COLOR.border;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const {x, y, width, height} = ACTIVE;
      ctx.fillStyle = COLOR.field;
      ctx.fillRect(x, y, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      this.tiles(t);
      this.waveform(x + 7, y + 76, width - 14, 48, COLOR.cyan);

      if (id === 'main') {
        const red = Math.floor(48 + t * 0.55);
        const band = ctx.createLinearGradient(0, 211, 0, 267);
        band.addColorStop(0, `rgb(${red + 12}, 20, ${Math.round(90 - t)})`);
        band.addColorStop(1, `rgb(${red + 4}, 7, ${Math.round(49 - t * 0.62)})`);
        ctx.fillStyle = band;
        ctx.fillRect(x, 211, width, 56);
        scrollText(ctx, MAIN_CUES, t, 227, width, x, 3);
      } else {
        ctx.fillStyle = '#290f3b';
        ctx.fillRect(x, 221, width, 44);
        ctx.fillStyle = COLOR.white;
        centerText(ctx, musicLabels[id] || '', 234, 2);
      }
      ctx.restore();
    }

    if (this.crt) ctx.drawImage(this.scan, 0, 0);
  }
}
