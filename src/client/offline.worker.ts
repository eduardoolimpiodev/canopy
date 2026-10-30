import { byteLimit, parseOffline } from './offline.js';

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    if (file.size > byteLimit) throw new Error('Escolha um arquivo de até 20 MB.');
    let stream = file.stream();
    const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const gzip = signature[0] === 0x1f && signature[1] === 0x8b;
    if (gzip) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > byteLimit) throw new Error('O conteúdo descompactado excede 20 MB.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    self.postMessage({
      collections: parseOffline(bytes, gzip ? file.name.replace(/\.gz$/i, '') : file.name),
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Falha ao ler o arquivo.' });
  }
};
