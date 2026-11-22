import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SIDcog, INTERNAL_RATE, TICKS_PER_SAMPLE } from '../docs/dsp.js';
import { Playback } from '../docs/playback.js';
import { decodeDump, makeDemo, makeManualImage, MUSIC_START_FRAME } from '../docs/sequences.js';

const table = new Uint8Array(readFileSync(new URL('../docs/assets/CombinedWaveforms.bin', import.meta.url)));
const max32 = 0x1_0000_0000;
const nominal = 80_000_000 / Math.floor(80_000_000 / Math.floor(985_248 / 32));
const manual = makeManualImage();
const musicBuffer = new Uint8Array(readFileSync(new URL('../docs/assets/013.dmp', import.meta.url))).buffer;
const demo = makeDemo(musicBuffer);

function voice(regs, index, freq, shape, width = 2048, ad = 0, sr = 0xf0) {
  regs.set([freq & 255, freq >>> 8, width & 255, width >>> 8, shape, ad, sr], index * 7);
}

function sampleMany(port, count) {
  return Float32Array.from({length: count}, () => port.sample());
}

test('pinned binary table and exact source cadence', () => {
  assert.equal(createHash('sha256').update(table).digest('hex'),
    '9187013f04ba01d61af743460cc55feeacc8f5661c4d4245897ae6200b3bf3e2');
  assert.equal(TICKS_PER_SAMPLE, 2598);
  assert.equal(INTERNAL_RATE, nominal);
  assert.ok(Math.abs(INTERNAL_RATE - 30792.917629) < 1e-6);
});

test('25-byte external mapping, including width masks and routing-dependent source cutoff', () => {
  const fixture = Uint8Array.of(
    0x34,0x12,0x78,0xfa,0x21,0x08,0x9a,
    0x00,0x71,0x00,0x08,0x42,0x04,0x8b,
    0xba,0xdc,0xef,0xbe,0x14,0x32,0x74,
    0xff,0xfb,0x97,0x4c
  );
  const sid = new SIDcog(table);
  sid.load(fixture);
  let decoded = sid.diagnostic();
  assert.deepEqual(decoded.registers, [...fixture]);
  assert.deepEqual(decoded.voices.map(v => v.step / 8192), [0x1234, 0x7100, 0xdcba]);
  assert.deepEqual(decoded.voices.map(v => v.width), [0xa78, 0x800, 0xeef]);
  assert.equal(decoded.filter.cutoff, 0xfb * 8 + 7 + 12);
  sid.write(21, 0);
  assert.equal(sid.diagnostic().filter.cutoff, decoded.filter.cutoff);
  sid.write(23, 0x91);
  assert.equal(sid.diagnostic().filter.cutoff, 0xfb * 8 + 1 + 12);
  assert.throws(() => sid.write(25, 1));
  assert.throws(() => sid.load(fixture, 1));
  sid.reset();
  decoded = sid.diagnostic();
  assert.ok(decoded.registers.every(byte => byte === 0));
  assert.deepEqual(decoded.voices.map(v => [v.phase, v.noise, v.level]), [[0,0xffffff,0],[0,0xffffff,0],[0,0xffffff,0]]);
});

test('independent phase-wrap pitch and pulse proportions', () => {
  const regs = new Uint8Array(25);
  const word = 4096;
  const sourcePeriod = 524288 / word;
  const hertz = nominal / sourcePeriod;
  const sid = new SIDcog(table);
  voice(regs, 0, word, 0x41, 1024);
  regs[24] = 15;
  sid.load(regs);
  for (let i = 0; i < 1024; i++) sid.sample();
  let high = 0;
  let wraps = 0;
  let previous = sid.voices[0].phase;
  for (let i = 0; i < 128 * 100; i++) {
    if (sid.sample() > 0) high++;
    const phase = sid.voices[0].phase;
    if (phase < previous) wraps++;
    previous = phase;
  }
  assert.equal(hertz, 240.56966897613548);
  assert.equal(wraps, 100);
  // Phase landing exactly on pulse width stays low (PASM unsigned borrow).
  assert.equal(high / wraps, 95);
});

test('gate attack and exponential release, test hold and cyclic sync', () => {
  const regs = new Uint8Array(25);
  voice(regs, 0, 4096, 0x21);
  voice(regs, 1, 971, 0x13);
  regs[24] = 15;
  const sid = new SIDcog(table);
  sid.load(regs);
  for (let i = 0; i < 127; i++) sid.sample();
  assert.ok(sid.voices[1].phase > 0);
  sid.sample();
  assert.equal(sid.voices[1].phase, 971 * 8192);
  assert.equal(sid.voices[0].stage, 1);
  sid.write(4, 0x28);
  sid.sample();
  assert.equal(sid.voices[0].phase, 0);
  assert.equal(sid.voices[0].stage, 2);
  let previous = sid.voices[0].level;
  for (let i = 0; i < 40000; i++) {
    sid.sample();
    assert.ok(sid.voices[0].level <= previous);
    previous = sid.voices[0].level;
  }
  assert.equal(sid.voices[0].level >>> 24, 0);
  assert.equal(sid.voices[0].sample, 0);
});

test('fixed-phase combined table and v1.4 ring indexing on all three voices', () => {
  const regs = new Uint8Array(25);
  const sid = new SIDcog(table);
  for (const index of [0, 1, 2]) {
    const sibling = (index + 2) % 3;
    for (const waveform of [3, 5, 6, 7]) {
      voice(regs, index, 0, (waveform << 4) | 5);
      sid.load(regs);
      sid.decode();
      sid.voices[index].phase = 0xe3000000;
      sid.voices[sibling].phase = 0x80000000;
      const bank = Math.max(0, waveform - 4);
      const shift = index === 2 ? 2 : 24;
      assert.equal(sid.waveform(index, sid.voices[index]) >>> 0,
        (table[bank * 256 + 0x63] << shift) >>> 0);
      sid.voices[sibling].phase = 0;
      assert.equal(sid.waveform(index, sid.voices[index]) >>> 0,
        (table[bank * 256 + 0xe3] << shift) >>> 0);
    }
    regs.fill(0);
  }
});

test('filter extremes, noise, mode combinations, volume and finite PCM', () => {
  const regs = new Uint8Array(25);
  voice(regs, 0, 65115, 0x81);
  voice(regs, 1, 51037, 0x71);
  voice(regs, 2, 9500, 0x41);
  const sid = new SIDcog(table);
  for (const cutoff of [0, 75, 1099, 2047]) {
    for (const resonance of [0, 15]) {
      for (let modes = 0; modes <= 7; modes++) {
        regs[21] = cutoff & 7;
        regs[22] = cutoff >>> 3;
        regs[23] = (resonance << 4) | 7;
        regs[24] = (modes << 4) | 15;
        sid.reset();
        sid.load(regs);
        for (let i = 0; i < 2000; i++) {
          const sample = sid.sample();
          assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 0.9375);
        }
        assert.notEqual(sid.voices[0].noise, 0xffffff);
        sid.write(24, modes << 4);
        assert.equal(sid.sampleDuty(), max32 / 2);
      }
    }
  }
});

test('deterministic restart at each fixed register sequence, including resampler and filter history', () => {
  const port = new Playback(table, 48000, demo, manual);
  for (const id of ['intro', 'main', 'music', 'manual']) {
    port.select(id, false);
    const first = sampleMany(port, id === 'music' ? 96000 : 16000);
    port.select(id, false);
    const restarted = sampleMany(port, id === 'music' ? 96000 : 16000);
    assert.deepEqual(first, restarted);
    assert.ok(first.some(value => Math.abs(value) > 0.01));
    assert.ok(first.every(value => Number.isFinite(value) && Math.abs(value) < 1));
  }
});

test('pitch and event timing at 44.1 and 48 kHz with 21 Hz and 50 Hz frames', () => {
  const image = new Uint8Array(25);
  voice(image, 0, 7492, 0x21);
  image[24] = 15;
  const expectedHz = nominal * 7492 / 524288;
  const pitches = [];
  for (const rate of [44100, 48000]) {
    const port = new Playback(table, rate, demo, image);
    port.select('manual', false);
    const samples = sampleMany(port, rate * 2);
    const crossings = [];
    for (let i = Math.floor(rate * 0.2); i < samples.length; i++) {
      if (samples[i - 1] < 0 && samples[i] >= 0) crossings.push(i);
    }
    const pitch = (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0]);
    assert.ok(Math.abs(pitch - expectedHz) < 0.02);
    pitches.push(pitch);
    for (const frameRate of [21, 50]) {
      const frames = new Uint8Array(25 * frameRate * 2);
      for (let tick = 0; tick < frameRate * 2; tick++) {
        frames.set(image, tick * 25);
        frames[25 * tick] = tick;
      }
      port.program.set('import', {data:frames, rate:frameRate});
      port.select('import', false);
      let last = -1;
      for (let i = 0; i < rate * 2; i++) {
        port.sample();
        const current = port.sid.registers[0];
        if (current !== last) {
          assert.equal(last + 1, current);
          assert.ok(Math.abs(i / rate - current / frameRate) < 0.00009);
          last = current;
        }
      }
      assert.equal(last, frameRate * 2 - 1);
      assert.equal(port.sample(), 0);
      assert.equal(port.seconds, 2);
      assert.equal(port.ended, true);
    }
  }
  assert.ok(Math.abs(pitches[0] - pitches[1]) < 0.02);
});

test('local dump validation and metadata', () => {
  const track = decodeDump(new ArrayBuffer(1250), 'fixture.dmp');
  assert.equal(track.count, 50);
  assert.equal(track.seconds, 1);
  assert.equal(decodeDump(track.data.buffer, 'fixture.dmp', 25).seconds, 2);
  assert.throws(() => decodeDump(new ArrayBuffer(0), 'empty.dmp'), /complete/);
  assert.throws(() => decodeDump(new ArrayBuffer(24), 'truncated.dmp'), /complete/);
  assert.throws(() => decodeDump(new ArrayBuffer(25), 'tune.sid'), /PSID and RSID/);
  assert.throws(() => decodeDump(new ArrayBuffer(25), 'fixture.dmp', 0), /frame rate/);
});

test('complete presentation advances into the actual dump and fades to silence at its end', () => {
  const rate = 48000;
  const music = demo.at(-1);
  const excerpt = {...music, data:music.data.subarray(0, (music.startFrame + 100) * 25)};
  const program = [...demo.slice(0, -1), excerpt];
  const port = new Playback(table, rate, program, manual);
  port.select('intro', true);
  const order = [];
  let peak = 0;
  const total = program.reduce((samples, track) => samples + Math.ceil((track.data.length / 25 - (track.startFrame ?? 0)) / track.rate * rate), 0);
  for (let i = 0; i < total; i++) {
    const pcm = port.sample();
    if (order.at(-1) !== port.id) order.push(port.id);
    peak = Math.max(peak, Math.abs(pcm));
  }
  assert.deepEqual(order, ['intro', 'main', 'music']);
  assert.ok(peak > 0.07 && peak < 1);
  assert.equal(port.sample(), 0);
  assert.equal(port.ended, true);
});

test('bundled dump matches the upload and preserves its two-beep prelude and first music setup', () => {
  const music = demo.at(-1);
  assert.equal(music.data.length / 25, 229692);
  assert.equal(createHash('sha256').update(music.data).digest('hex'),
    '4cdfb06b1f3cc8c3d97cc5c0c438135a60cd52b416c56632633e964662f735b8');
  assert.equal(music.startFrame, MUSIC_START_FRAME);
  const frame = n => music.data.subarray(n * 25, (n + 1) * 25);
  assert.deepEqual(frame(759), frame(1100));
  assert.ok(frame(2199).every(byte => byte === 0));
  assert.deepEqual([frame(2200)[4], frame(2200)[11], frame(2200)[18]], [8, 8, 8]);
  const port = new Playback(table, 48000, demo, manual);
  assert.equal(port.id, 'music');
  port.sample();
  assert.deepEqual(port.sid.registers, frame(2200));
  assert.equal(port.duration, 4549.84);
});

test('short register pulses remain visible between display snapshots', () => {
  const port = new Playback(table, 48000, demo, manual);
  port.select('manual', false);
  const changes = manual.slice();
  const control = changes[4];
  changes[4] ^= 1;
  port.setManual(changes);
  changes[4] = control;
  port.setManual(changes);
  assert.equal(port.sid.registers[4], control);
  assert.equal(port.changedBits[4], 1);
  assert.deepEqual([...port.changedBits].filter(Boolean), [1]);
  port.select('music', false);
  assert.ok(port.changedBits.every(n => n === 0));
});
