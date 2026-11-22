import { ARCHIVE_DUMPS } from './archive-catalog.js';
import { decodeDump } from './sequences.js';

let pack;

async function loadPack() {
  const response = await fetch(new URL('./assets/sidcog-p2-dumps.bin', import.meta.url));
  if (!response.ok) throw new Error('Could not load the SIDcog P2 dump collection. Try again.');
  return response.arrayBuffer();
}

export async function loadArchiveTrack(id) {
  const {file, label, offset, length, bytes} = ARCHIVE_DUMPS.get(id);
  pack ??= loadPack().catch(error => {
    pack = undefined;
    throw error;
  });
  const data = await pack;
  const member = new Blob([data.slice(offset, offset + length)]);
  const stream = member.stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  if (buffer.byteLength !== bytes) throw new Error('The archived dump is incomplete.');
  return {...decodeDump(buffer, file, 50), id, label};
}
