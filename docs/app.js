import { ARCHIVE_DUMPS } from './archive-catalog.js';
import { loadArchiveTrack } from './archive.js';
import { AudioTransport } from './audio.js';
import { RegisterRack, drawWordmark } from './register-rack.js';
import { Display } from './renderer.js';
import { CHAPTERS, EXTRA_DUMPS, MUSIC_RATES, decodeDump, makeManualImage } from './sequences.js';
import { INTERNAL_RATE } from './dsp.js';
import { registerView, soundControls } from './sound-controls.js';

const id = name => document.getElementById(name);
const display = new Display(id('display'));
const rack = new RegisterRack(id('voices'));
drawWordmark(id('wordmark'));
const chapterPicker = id('chapter');
const toggleButton = id('toggle');
const outputVolume = id('volume');
const muteButton = id('mute');
const audioError = id('audio-error');
const musicRate = id('music-rate');
const musicPrelude = id('music-prelude');
const fileInput = id('dump-file');
const rateInput = id('dump-rate');
const dumpMessage = id('dump-message');
const manualImage = makeManualImage();
const renderRegisters = registerView(id('register-view'));
const emptyRegisters = new Uint8Array(25);
let latestRegisters = emptyRegisters;
const chapterLabels = new Map(CHAPTERS.map(chapter => [chapter.id, chapter.label]));
const number = new Intl.NumberFormat('en-CA');

let chapter = 'music';
let demoChapter = 'music';
let dump;
let importedFile;
let importRequest = 0;
let rateChange;
let wanted = false;
let starting = false;
let loadingTrack = false;
let activeEpoch = -1;
let ended = false;
let muted = false;
let epoch = 0;
let seconds = 0;
let observationTime = 0;
let timerLabel = '';
let changed = true;
let lastDraw = 0;

const musicOptions = document.createElement('optgroup');
musicOptions.label = 'Music dumps';
const demoOptions = document.createElement('optgroup');
demoOptions.label = 'Demonstration';
for (const {id: value, label} of CHAPTERS) {
  const group = value === 'music' || EXTRA_DUMPS.some(dump => dump.id === value)
    ? musicOptions : demoOptions;
  group.append(new Option(label, value));
}
const archiveOptions = document.createElement('optgroup');
archiveOptions.label = 'SIDcog P2 collection';
for (const [value, {label}] of ARCHIVE_DUMPS) archiveOptions.append(new Option(label, value));
chapterPicker.append(musicOptions, demoOptions, archiveOptions);
for (const rate of MUSIC_RATES) musicRate.add(new Option(rate + ' Hz', String(rate)));

const audio = new AudioTransport(
  (data, pcm) => {
    if (data.epoch !== epoch) return;
    if (chapter !== data.id) {
      chapter = data.id;
      if (chapter !== 'manual') demoChapter = chapter;
      changeChapterLabel();
      display.clear();
      rack.reset();
    }
    if (data.ended && !ended && !starting) {
      ended = true;
      wanted = false;
      audio.send({type:'run', value:false});
      syncStatus();
    }
    seconds = data.seconds;
    observationTime = data.contextTime;
    display.setWave(pcm);
    latestRegisters = data.registers;
    rack.update(data.registers, data.levels, data.changedBits, data.frame, data.seconds);
    if (id('sound-options').open) renderRegisters(latestRegisters);
    changed = true;
  },
  () => syncStatus(),
  error => failAudio(error)
);

function failAudio(error) {
  wanted = false;
  starting = false;
  loadingTrack = false;
  audioError.textContent = error.message || 'Audio could not start. Try again.';
  audioError.hidden = false;
  syncStatus();
}

function syncStatus() {
  const context = audio.context;
  const playing = wanted && context?.state === 'running';
  let state = 'ready';
  let label = 'Ready';
  let action = 'Start audio';
  if (!audioError.hidden) {
    state = 'error';
    label = 'Audio error';
  } else if (starting || loadingTrack) {
    state = 'starting';
    label = 'Loading audio';
  } else if (ended) {
    state = 'complete';
    label = 'Complete';
    action = 'Play again';
  } else if (playing) {
    state = 'playing';
    label = 'Playing';
    action = 'Pause';
  } else if (context) {
    state = wanted ? 'interrupted' : 'paused';
    label = wanted ? 'Audio interrupted' : 'Paused';
    action = 'Resume audio';
  }
  id('status').dataset.state = state;
  if (id('status-text').textContent !== label) id('status-text').textContent = label;
  id('toggle-text').textContent = action;
  toggleButton.disabled = starting || loadingTrack;
  id('transport-icon').setAttribute('d', playing ? 'M6 5h4v14H6zm8 0h4v14h-4z' : 'M8 5v14l11-7z');
  const output = context ? number.format(context.sampleRate) + ' Hz' : 'pending';
  id('rates').value = 'Internal ' + INTERNAL_RATE.toLocaleString('en-CA', {maximumFractionDigits:3}) + ' Hz · Output ' + output;
}

function updateGain() {
  audio.setOutput(muted ? 0 : Number(outputVolume.value) / 100);
}

function changeChapterLabel() {
  id('current-chapter').textContent = chapter === 'manual' ? 'Manual synthesis'
    : chapter === 'import' ? dump?.label ?? 'Local dump' : chapterLabels.get(chapter) ?? ARCHIVE_DUMPS.get(chapter)?.label;
  chapterPicker.value = chapter === 'manual' ? demoChapter : chapter;
}

async function requestChapter() {
  if (!audio.node) return;
  const selection = chapter;
  const requestEpoch = epoch;
  if (ARCHIVE_DUMPS.has(selection)) {
    loadingTrack = true;
    audio.send({type:'run', value:false});
    syncStatus();
    try {
      const track = await loadArchiveTrack(selection);
      if (requestEpoch !== epoch || !audio.node) return;
      audio.send({type:'track', track});
    } catch (error) {
      if (requestEpoch === epoch) {
        loadingTrack = false;
        failAudio(error);
      }
      return;
    }
  }
  loadingTrack = false;
  activeEpoch = requestEpoch;
  audio.send({type:'select', id:selection, advance:selection === 'intro' || selection === 'main', epoch:requestEpoch});
  audio.send({type:'run', value:wanted});
  syncStatus();
}

function selectChapter(value) {
  chapter = value;
  if (chapter !== 'manual') demoChapter = chapter;
  ended = false;
  seconds = 0;
  epoch++;
  loadingTrack = false;
  audioError.hidden = true;
  display.clear();
  const isManual = chapter === 'manual';
  id('mode').value = isManual ? 'manual' : 'demo';
  id('manual-voice').disabled = !isManual;
  id('manual-filter').disabled = !isManual;
  id('mode-note').textContent = isManual ? 'Automatic register updates are paused. Use Gate to start or release a voice.'
    : 'Select Manual to edit the SID registers and pause the demonstration sequence.';
  latestRegisters = isManual ? manualImage : emptyRegisters;
  renderRegisters(latestRegisters);
  rack.reset();
  rack.update(latestRegisters);
  changeChapterLabel();
  requestChapter();
  syncStatus();
  changed = true;
}

async function startOrPause() {
  if (wanted && audio.context?.state === 'running' && !ended) {
    wanted = false;
    audio.send({type:'run', value:false});
    syncStatus();
    return;
  }
  if (starting) return;
  if (ended) selectChapter(chapter);
  starting = true;
  audioError.hidden = true;
  syncStatus();
  try {
    const fresh = await audio.start(manualImage);
    if (fresh) {
      if (dump) audio.send({type:'dump', track:dump});
      sendMusicSettings();
      audio.send({type:'manual', image:manualImage});
      activeEpoch = -1;
    }
    updateGain();
    wanted = true;
    starting = false;
    if (activeEpoch !== epoch) await requestChapter();
    else audio.send({type:'run', value:true});
    syncStatus();
  } catch (error) {
    failAudio(error);
  }
}

function sendMusicSettings() {
  audio.send({type:'music-settings', rate:Number(musicRate.value), includePrelude:musicPrelude.checked});
}

function updateMusicSettings() {
  sendMusicSettings();
  if (chapter === 'music') selectChapter('music');
}

musicRate.addEventListener('change', updateMusicSettings);
musicPrelude.addEventListener('change', updateMusicSettings);
id('toggle').addEventListener('click', startOrPause);
id('restart').addEventListener('click', () => selectChapter(chapter));
chapterPicker.addEventListener('change', () => selectChapter(chapterPicker.value));
id('mode').addEventListener('change', event => selectChapter(event.target.value === 'manual' ? 'manual' : demoChapter));
id('about-open').addEventListener('click', () => id('about').showModal());
id('crt').addEventListener('click', event => {
  display.crt = !display.crt;
  event.currentTarget.setAttribute('aria-pressed', String(display.crt));
  changed = true;
});
outputVolume.addEventListener('input', updateGain);
muteButton.addEventListener('click', () => {
  muted = !muted;
  muteButton.setAttribute('aria-pressed', String(muted));
  muteButton.setAttribute('aria-label', muted ? 'Unmute output' : 'Mute output');
  muteButton.title = muted ? 'Unmute output' : 'Mute output';
  id('mute-icon').setAttribute('d', muted ? 'm15 9 6 6m0-6-6 6' : 'M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12');
  updateGain();
});

const screen = id('screen');
const fullExit = id('full-exit');
const fullButton = id('fullscreen');
function fullscreenChanged() {
  const active = document.fullscreenElement === screen || screen.classList.contains('simulated-full');
  fullButton.setAttribute('aria-pressed', String(active));
  if (!active && document.activeElement === fullExit) fullButton.focus();
}
async function exitFullscreen() {
  if (document.fullscreenElement === screen) await document.exitFullscreen().catch(() => {});
  screen.classList.remove('simulated-full');
  fullscreenChanged();
  fullButton.focus();
}
fullExit.addEventListener('click', exitFullscreen);
fullButton.addEventListener('click', async () => {
  if (document.fullscreenElement === screen || screen.classList.contains('simulated-full')) {
    await exitFullscreen();
    return;
  }
  try {
    await screen.requestFullscreen();
  } catch {
    screen.classList.add('simulated-full');
  }
  fullscreenChanged();
  fullExit.focus();
});
document.addEventListener('fullscreenchange', fullscreenChanged);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && screen.classList.contains('simulated-full')) exitFullscreen();
});
window.addEventListener('pagehide', () => {
  wanted = false;
  audio.send({type:'run', value:false});
  syncStatus();
});

async function loadDump(source, select) {
  const request = ++importRequest;
  if (!source) return;
  try {
    const rate = rateInput.valueAsNumber;
    const buffer = await source.buffer;
    if (request !== importRequest) return;
    const track = decodeDump(buffer, source.name, rate);
    dump = track;
    audio.send({type:'dump', track});
    const option = Array.from(chapterPicker.options).find(item => item.value === 'import');
    if (option) option.text = 'Local dump';
    else musicOptions.append(new Option('Local dump', 'import'));
    dumpMessage.classList.remove('error');
    dumpMessage.textContent = `${track.label} · ${number.format(track.count)} frames · ${track.seconds.toFixed(2)} s at ${track.rate} Hz`;
    if (select || chapter === 'import') selectChapter('import');
  } catch (error) {
    if (request !== importRequest) return;
    dumpMessage.classList.add('error');
    dumpMessage.textContent = error.message;
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) {
    clearTimeout(rateChange);
    importedFile = {name: file.name, buffer: file.arrayBuffer()};
    loadDump(importedFile, true);
    fileInput.value = '';
  }
});
rateInput.addEventListener('input', () => {
  clearTimeout(rateChange);
  rateChange = setTimeout(() => loadDump(importedFile, false), 180);
});

soundControls(manualImage, () => {
  audio.send({type:'manual', image:manualImage});
  latestRegisters = manualImage;
  renderRegisters(manualImage);
  rack.update(manualImage);
});
selectChapter(chapter);
id('sound-options').addEventListener('toggle', () => {
  if (id('sound-options').open) renderRegisters(latestRegisters);
});

function render(now) {
  requestAnimationFrame(render);
  if (now - lastDraw < 1000 / 35) return;
  const playing = wanted && audio.context?.state === 'running';
  if (!changed && !playing) return;
  lastDraw = now;
  changed = false;
  const extrapolated = playing && seconds > 0
    ? Math.max(0, Math.min(0.045, audio.context.currentTime - observationTime)) : 0;
  display.draw(chapter, seconds + extrapolated);
  const wholeSeconds = Math.floor(seconds);
  const label = String(Math.floor(wholeSeconds / 60)).padStart(2, '0') + ':' +
    String(wholeSeconds % 60).padStart(2, '0');
  if (label !== timerLabel) {
    timerLabel = label;
    id('time').textContent = label;
    id('time').dateTime = 'PT' + wholeSeconds + 'S';
  }
}
requestAnimationFrame(render);
