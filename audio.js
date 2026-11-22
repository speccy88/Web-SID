import { decodeDump, EXTRA_DUMPS, makeDemo, MUSIC_FILE } from './sequences.js';

export class AudioTransport {
  constructor(onScope, onState, onError) {
    this.onScope = onScope;
    this.onState = onState;
    this.onError = onError;
    this.preload();
  }

  preload() {
    const load = async file => {
      const response = await fetch(new URL('./assets/' + file, import.meta.url));
      if (!response.ok) throw new Error('Could not load ' + file + '. Try starting audio again.');
      return response.arrayBuffer();
    };
    this.assets ??= Promise.all([load('CombinedWaveforms.bin'), load(MUSIC_FILE), ...EXTRA_DUMPS.map(dump => load(dump.file))])
      .catch(error => {
        this.assets = null;
        return error;
      });
    return this.assets;
  }

  async start(manualImage) {
    if (this.node && this.context?.state !== 'closed') {
      await this.context.resume();
      return false;
    }

    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('This browser does not provide Web Audio.');
    const context = new Context({latencyHint: 'interactive'});
    this.context = context;
    context.onstatechange = () => {
      if (this.context === context) this.onState();
    };

    try {
      if (!context.audioWorklet) throw new Error('AudioWorklet requires a supported browser and a secure page.');
      // Resume is requested in the button event before awaiting network I/O.
      const resumed = context.resume();
      const [assets] = await Promise.all([
        this.preload(), context.audioWorklet.addModule(new URL('./worklet.js', import.meta.url)), resumed
      ]);
      if (assets instanceof Error) throw assets;
      const [tableBuffer, musicBuffer, ...dumpBuffers] = assets;
      const table = new Uint8Array(tableBuffer);
      if (table.length !== 1024) throw new Error('The packaged waveform table has an invalid size.');
      const program = makeDemo(musicBuffer);
      for (const [index, dump] of EXTRA_DUMPS.entries()) {
        const track = decodeDump(dumpBuffers[index], dump.file, dump.rate);
        program.push({...track, id:dump.id, label:dump.label, endFrame:dump.endFrame});
      }
      const node = new AudioWorkletNode(context, 'sidcog-browser', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: {table, program, manualImage}
      });
      const gain = context.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(context.destination);
      this.node = node;
      this.gain = gain;
      node.onprocessorerror = () => {
        this.dispose();
        this.onError(new Error('The audio processor stopped. Select Start audio to reload it.'));
      };
      node.port.onmessage = ({data}) => {
        if (data.type === 'scope') {
          const copy = data.wave.slice();
          node.port.postMessage({type: 'recycle', wave: data.wave}, [data.wave.buffer]);
          this.onScope(data, copy);
        }
      };
      return true;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  send(data) {
    this.node?.port.postMessage(data);
  }

  setOutput(level) {
    if (!this.gain) return;
    const param = this.gain.gain;
    const time = this.context.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(time);
    else {
      const previous = param.value;
      param.cancelScheduledValues(time);
      param.setValueAtTime(previous, time);
    }
    param.linearRampToValueAtTime(level, time + 0.018);
  }

  dispose() {
    this.node?.disconnect();
    this.gain?.disconnect();
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.node = this.gain = this.context = null;
  }
}
