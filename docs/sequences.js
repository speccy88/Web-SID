import { INTERNAL_RATE, REGISTER_COUNT } from './dsp.js';

export const MUSIC_FILE = '013.dmp';
export const MUSIC_RATES = [50, 100, 150, 200];
// All three voices are held in test/reset at the start of the first music block.
export const MUSIC_START_FRAME = 2200;

export const EXTRA_DUMPS = [
  // Leave the complete release tail before skipping the archive's silent padding.
  { id: 'lost-friend', label: 'Lost Friend', file: 'Lost_Friend.dmp', rate: 50, endFrame: 6850 }
];

export const CHAPTERS = [
  { id: 'intro', label: 'Waveform introduction', scene: 'intro', rate: 50, seconds: 28 },
  { id: 'main', label: 'SIDcog features', scene: 'blue', rate: 50, seconds: 45 },
  { id: 'music', label: '013.dmp music', scene: 'music' },
  ...EXTRA_DUMPS
];

export const INTRO_CUES = [
  [0, 'SIDCOG   COMMODORE 64 SOUND'],
  [4, 'TRIANGLE WAVE'],
  [8, 'SAWTOOTH WAVE'],
  [12, 'VARIABLE WIDTH PULSE'],
  [17, 'NOISE WAVE'],
  [21, 'COMBINED WAVEFORMS'],
  [25, 'THREE INDEPENDENT VOICES']
];

export const MAIN_CUES = [
  [0, 'SIDCOG ON THE PARALLAX PROPELLER'],
  [6, 'THREE OSCILLATORS   THREE ENVELOPES'],
  [13, 'ATTACK   DECAY   SUSTAIN   RELEASE'],
  [21, 'RING MODULATION   OSCILLATOR SYNC'],
  [29, 'LOW PASS   BAND PASS   HIGH PASS'],
  [39, 'SID REGISTER PLAYBACK']
];

export function word(image, offset, value) {
  image[offset] = value & 255;
  image[offset + 1] = (value >>> 8) & 255;
}

export function frequencyWord(hertz) {
  return Math.max(0, Math.min(65535, Math.round(hertz * 524288 / INTERNAL_RATE)));
}

function midi(note) {
  return frequencyWord(440 * 2 ** ((note - 69) / 12));
}

function voice(image, index, hz, control, width = 2048, ad = 0x02, sr = 0xb3) {
  const offset = 7 * index;
  word(image, offset, frequencyWord(hz));
  word(image, offset + 2, width & 4095);
  image[offset + 4] = control;
  image[offset + 5] = ad;
  image[offset + 6] = sr;
}

function note(image, index, key, control, width, ad, sr) {
  voice(image, index, 0, control, width, ad, sr);
  word(image, 7 * index, midi(key));
}

function cutoff(image, value) {
  image[21] = value & 7;
  image[22] = value >>> 3;
}

function intro(image, t) {
  image[24] = 15;
  if (t < 4) voice(image, 0, 110, t < 3.65 ? 0x11 : 0x10);
  else if (t < 8) voice(image, 0, 130.81, t < 7.65 ? 0x11 : 0x10);
  else if (t < 12) voice(image, 0, 130.81, t < 11.65 ? 0x21 : 0x20);
  else if (t < 17) voice(image, 0, 146.83, t < 16.65 ? 0x41 : 0x40, 1740 + Math.round(1120 * Math.sin((t - 12) * 3.1)));
  else if (t < 21) voice(image, 0, 960, t % 0.64 < 0.14 ? 0x81 : 0x80, 2048, 0x03, 0x02);
  else if (t < 25) voice(image, 0, 130.81, t < 24.65 ? 0x71 : 0x70);
  else {
    note(image, 0, 48, t < 27.6 ? 0x41 : 0x40, 1228);
    note(image, 1, 55, t < 27.6 ? 0x11 : 0x10);
    note(image, 2, 64, t < 27.6 ? 0x21 : 0x20);
  }
}

function main(image, t) {
  image[24] = 15;
  if (t < 13) {
    const bars = [48, 51, 55, 46];
    const root = bars[Math.floor(t / 1.6) % 4];
    const lead = [12, 19, 15, 22, 19, 15, 24, 22];
    note(image, 0, root, t % 0.4 < 0.35 ? 0x41 : 0x40, 1536, 0x03, 0x92);
    note(image, 1, root + lead[Math.floor(t / 0.2) % 8], t % 0.2 < 0.16 ? 0x11 : 0x10, 2048, 0x12, 0x53);
    note(image, 2, root - 12, t % 0.8 < 0.13 ? 0x81 : 0x80, 2048, 0x03, 0x02);
  } else if (t < 21) {
    const row = Math.floor((t - 13) / 2);
    note(image, 0, 57 + row * 2, (t - 13) % 2 < 1.25 ? 0x21 : 0x20,
      2048, [0x12, 0x51, 0x97, 0x28][row], [0x26, 0x74, 0xc4, 0x96][row]);
  } else if (t < 29) {
    voice(image, 2, 53.5 + (t - 21) * 4, 0x10);
    voice(image, 0, 160 + (t - 21) * 58, t < 28.65 ? (t < 25 ? 0x15 : 0x23) : 0x22);
  } else if (t < 39) {
    image[23] = 0xd1;
    image[24] = 15 | (t < 32.4 ? 0x10 : t < 35.8 ? 0x20 : 0x40);
    cutoff(image, Math.round(440 + 400 * Math.sin((t - 29) * 3.0)));
    voice(image, 0, 108, t < 38.6 ? 0x21 : 0x20);
  } else {
    const root = [45, 48, 43, 46][Math.floor((t - 39) / 1.5)];
    note(image, 0, root, t < 44.6 ? 0x41 : 0x40, 1700);
    note(image, 1, root + 12 + [0, 7, 10, 15][Math.floor(t / 0.18) % 4], t < 44.6 && t % 0.36 < 0.3 ? 0x31 : 0x30);
    note(image, 2, root + 7, t < 44.6 && t % 0.48 < 0.35 ? 0x11 : 0x10);
  }
}

export function makeDemo(musicBuffer) {
  const music = decodeDump(musicBuffer, MUSIC_FILE, MUSIC_RATES[0]);
  if (music.count <= MUSIC_START_FRAME) throw new Error('The bundled 013.dmp music is incomplete.');
  const generators = [intro, main];
  const program = generators.map((generate, index) => {
    const chapter = CHAPTERS[index];
    const count = chapter.seconds * chapter.rate;
    const data = new Uint8Array(count * REGISTER_COUNT);
    for (let i = 0; i < count; i++) {
      const offset = i * REGISTER_COUNT;
      generate(data.subarray(offset, offset + REGISTER_COUNT), i / chapter.rate);
    }
    return { id: chapter.id, rate: chapter.rate, data };
  });
  program.push({id:'music', rate:music.rate, data:music.data, startFrame:MUSIC_START_FRAME});
  return program;
}

export function makeManualImage() {
  const image = new Uint8Array(REGISTER_COUNT);
  voice(image, 0, 220, 0x21);
  voice(image, 1, 165, 0x40);
  voice(image, 2, 110, 0x10);
  cutoff(image, 650);
  image[24] = 0x1f;
  return image;
}

export function decodeDump(buffer, name, rate = 50) {
  if (!Number.isFinite(rate) || rate < 1 || rate > 300) {
    throw new RangeError('Enter a frame rate from 1 to 300 Hz.');
  }
  const data = new Uint8Array(buffer);
  const isSID = data.length >= 4 && (data[0] === 0x50 || data[0] === 0x52) &&
    data[1] === 0x53 && data[2] === 0x49 && data[3] === 0x44;
  if (isSID || /\.sid$/i.test(name)) {
    throw new Error('Choose a raw .dmp register stream. PSID and RSID files contain C64 player data.');
  }
  if (!data.length || data.length % REGISTER_COUNT !== 0) {
    throw new Error('A dump must contain one or more complete 25-byte register images.');
  }
  const count = data.length / REGISTER_COUNT;
  return {id: 'import', label: name, rate, data, count, seconds: count / rate};
}
