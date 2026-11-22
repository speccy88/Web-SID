import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EXTRA_DUMPS, makeDemo, makeManualImage } from '../docs/sequences.js';
import { AudioTransport } from '../docs/audio.js';

const table = new Uint8Array(readFileSync(new URL('../docs/assets/CombinedWaveforms.bin', import.meta.url)));
const musicBuffer = new Uint8Array(readFileSync(new URL('../docs/assets/013.dmp', import.meta.url))).buffer;
const exampleBuffer = new Uint8Array(readFileSync(new URL('../docs/assets/Lost_Friend.dmp', import.meta.url))).buffer;

test('worklet renders actual buffers, publishes matching PCM and freezes transport', async () => {
  let Processor;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { pack: [], postMessage: (packet, transfer) => {
        this.port.pack.push(structuredClone(packet, {transfer}));
      }};
    }
  };
  globalThis.sampleRate = 48000;
  globalThis.currentTime = 0;
  globalThis.registerProcessor = (name, type) => {
    assert.equal(name, 'sidcog-browser');
    Processor = type;
  };
  await import('../docs/worklet.js');
  const worklet = new Processor({processorOptions:{table, program: makeDemo(musicBuffer), manualImage: makeManualImage()}});
  const message = data => worklet.port.onmessage({data});
  function render(length) {
    const result = new Float32Array(length);
    assert.equal(worklet.process([], [[result]]), true);
    globalThis.currentTime += length / globalThis.sampleRate;
    return result;
  }
  message({type:'select', id:'main', advance:true, epoch:1});
  message({type:'run', value:true});
  for (let i = 0; i < 10; i++) render(128);
  const samples = render(512);
  assert.ok(samples.some(sample => Math.abs(sample) > 0.01));
  const plot = worklet.port.pack.at(-1);
  assert.equal(plot.id, 'main');
  assert.equal(plot.epoch, 1);
  assert.deepEqual(plot.wave, samples);
  assert.deepEqual([...plot.levels], worklet.player.sid.voices.map(v => v.level >>> 24));
  assert.equal(plot.frame, worklet.player.sequenceIndex - 1);
  assert.deepEqual(plot.registers, worklet.player.sid.registers);
  assert.ok(worklet.port.pack.some(packet => packet.changedBits.some(Boolean)));
  for (const packet of worklet.port.pack) message({type:'recycle', wave:packet.wave});
  const elapsed = worklet.player.outputIndex;
  message({type:'run', value:false});
  for (let i = 0; i < 30; i++) render(64);
  const frozen = worklet.player.outputIndex;
  assert.ok(frozen > elapsed && frozen - elapsed <= 576);
  assert.ok(render(256).every(sample => sample === 0));
  assert.equal(worklet.player.outputIndex, frozen);
  message({type:'run', value:true});
  assert.ok(render(256).some(sample => sample !== 0));
  assert.equal(worklet.player.outputIndex, frozen + 256);
  message({type:'select', id:'manual', advance:false, epoch:2});
  for (let i = 0; i < 25; i++) render(96);
  assert.equal(worklet.player.id, 'manual');
  const manual = makeManualImage();
  manual[4] = 0x49;
  message({type:'manual', image:manual});
  render(256);
  assert.equal(worklet.player.sid.diagnostic().registers[4], 0x49);
  assert.equal(worklet.player.sid.diagnostic().voices[0].phase, 0);

  message({type:'music-settings', rate:200, includePrelude:true});
  message({type:'select', id:'music', advance:true, epoch:3});
  for (let i = 0; i < 10; i++) render(96);
  assert.equal(worklet.player.track.rate, 200);
  assert.equal(worklet.player.startOffset, 0);
  assert.ok(worklet.player.sid.registers.every(byte => byte === 0));
  message({type:'music-settings', rate:100, includePrelude:false});
  message({type:'select', id:'music', advance:true, epoch:4});
  for (let i = 0; i < 10; i++) render(96);
  assert.equal(worklet.player.track.rate, 100);
  assert.equal(worklet.player.startOffset, 2200 * 25);
  assert.equal(worklet.player.sid.registers[4], 8);
});

test('repeated Start resumes the same AudioContext and graph', async () => {
  let contexts = 0;
  let nodes = 0;
  let edges = 0;
  let modules = 0;
  const originalFetch = globalThis.fetch;
  try {
    const buffers = new Map([
      ['CombinedWaveforms.bin', table.buffer], ['013.dmp', musicBuffer], ['Lost_Friend.dmp', exampleBuffer]
    ]);
    globalThis.fetch = async url => {
      const data = buffers.get(url.pathname.split('/').at(-1));
      return {ok: Boolean(data), arrayBuffer: async () => data};
    };
    globalThis.window = {AudioContext: class {
      constructor() {
        contexts++;
        this.currentTime = 0;
        this.audioWorklet = {addModule: async () => { modules++; }};
      }
      async resume() { this.state = 'running'; }
      createGain() { return {gain:{value:0}, connect:() => { edges++; }}; }
    }};
    globalThis.AudioWorkletNode = class {
      constructor(_context, _id, {processorOptions}) {
        nodes++;
        this.port = {};
        const example = processorOptions.program.find(track => track.id === EXTRA_DUMPS[0].id);
        assert.equal(example.rate, 50);
        assert.equal(example.seconds, 359);
        assert.equal(example.endFrame, 6850);
        assert.equal(example.data.buffer, exampleBuffer);
      }
      connect() { edges++; }
    };
    const transport = new AudioTransport(() => {}, () => {}, () => {});
    assert.equal(await transport.start(makeManualImage()), true);
    for (let i = 0; i < 3; i++) {
      assert.equal(await transport.start(makeManualImage()), false);
    }
    assert.deepEqual([contexts, nodes, edges, modules], [1, 1, 2, 1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
