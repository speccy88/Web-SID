import { INTERNAL_RATE } from './dsp.js';
import { word } from './sequences.js';

const voiceFlags = [
  ['Gate', 1], ['Sync', 2], ['Ring modulation', 4], ['Test/reset', 8],
  ['Triangle', 16], ['Sawtooth', 32], ['Pulse', 64], ['Noise', 128]
];
const filterFlags = [
  ['Route voice 1', 23, 1], ['Route voice 2', 23, 2], ['Route voice 3', 23, 4],
  ['Low-pass', 24, 16], ['Band-pass', 24, 32], ['High-pass', 24, 64]
];

export function soundControls(image, change) {
  const voice = document.getElementById('voice');
  const byId = id => document.getElementById(id);
  const fields = [];
  const register = () => Number(voice.value) * 7;
  const readWord = offset => image[offset] | image[offset + 1] << 8;
  const nibble = (offset, upper) => (image[offset] >>> (upper ? 4 : 0)) & 15;

  function flag(container, title, offset, mask) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, title);
    container.append(label);
    fields.push(() => { input.checked = Boolean(image[offset()] & mask); });
    input.addEventListener('change', () => {
      const index = offset();
      image[index] = input.checked ? image[index] | mask : image[index] & ~mask;
      change();
    });
  }

  function slider(container, title, max, get, set, format = String) {
    const label = document.createElement('label');
    const output = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = 0;
    input.max = max;
    input.setAttribute('aria-label', title);
    label.append(title, output, input);
    container.append(label);
    function render() {
      input.value = get();
      output.value = format(Number(input.value));
      input.setAttribute('aria-valuetext', output.value);
    }
    fields.push(render);
    input.addEventListener('input', () => {
      set(Number(input.value));
      render();
      change();
    });
  }

  function writeNibble(offset, upper, value) {
    image[offset] = upper ? (image[offset] & 15) | value << 4 : (image[offset] & 240) | value;
  }

  for (const [title, bit] of voiceFlags) flag(byId('voice-bits'), title, () => register() + 4, bit);
  for (const [title, offset, bit] of filterFlags) flag(byId('filter-bits'), title, () => offset, bit);

  const voiceValues = byId('voice-values');
  slider(voiceValues, 'Frequency', 65535, () => readWord(register()),
    val => word(image, register(), val), val => (val * INTERNAL_RATE / 524288).toFixed(1) + ' Hz');
  slider(voiceValues, 'Pulse width', 4095, () => readWord(register() + 2) & 4095,
    val => word(image, register() + 2, val), val => (val / 40.96).toFixed(1) + '%');
  for (const [title, delta, upper] of [['Attack', 5, true], ['Decay', 5, false],
    ['Sustain', 6, true], ['Release', 6, false]]) {
    slider(voiceValues, title, 15, () => nibble(register() + delta, upper),
      val => writeNibble(register() + delta, upper, val));
  }

  const filterValues = byId('filter-values');
  slider(filterValues, 'Cutoff', 2047, () => (image[21] & 7) | image[22] << 3,
    val => { image[21] = val & 7; image[22] = val >>> 3; });
  slider(filterValues, 'Resonance', 15, () => nibble(23, true), val => writeNibble(23, true, val));
  slider(filterValues, 'SID volume', 15, () => nibble(24, false), val => writeNibble(24, false, val));
  const render = () => { for (const update of fields) update(); };
  voice.addEventListener('change', render);
  render();
}

export function registerView(container) {
  const groups = [['$00–$06 · Voice 1', 0, 7], ['$07–$0D · Voice 2', 7, 14],
    ['$0E–$14 · Voice 3', 14, 21], ['$15–$18 · Filter and volume', 21, 25]];
  const rows = groups.map(([label, start, end]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    row.append(dt, dd);
    container.append(row);
    return {dd, start, end};
  });
  const hex = Array.from({length: 256}, (_, i) => i.toString(16).toUpperCase().padStart(2, '0'));
  return bytes => {
    for (const {dd, start, end} of rows) {
      let text = '';
      for (let i = start; i < end; i++) text += (i === start ? '' : ' ') + hex[bytes[i]];
      if (dd.textContent !== text) dd.textContent = text;
    }
  };
}
