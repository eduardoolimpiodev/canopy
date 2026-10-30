import { deserialize, EJSON } from 'bson';

export interface OfflineCollection {
  name: string;
  documents: Record<string, unknown>[];
}
export const byteLimit = 20 * 1024 * 1024;
const documentLimit = 20000;
const mask = (1n << 64n) - 1n;
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = BigInt(index);
  for (let bit = 0; bit < 8; bit++)
    value = value & 1n ? (value >> 1n) ^ 0xc96c5795d7870f42n : value >> 1n;
  return value;
});
export function archiveChecksum(bytes: Uint8Array, previous = 0n) {
  let value = previous ^ mask;
  for (const byte of bytes) value = crcTable[Number((value ^ BigInt(byte)) & 255n)] ^ (value >> 8n);
  return value ^ mask;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Cada documento deve ser um objeto JSON.');
  return value as Record<string, unknown>;
}
function parseJson(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
    )
      throw new Error(
        'Número JSON fora da precisão segura. Exporte usando Extended JSON, por exemplo $numberLong.',
      );
    return value;
  });
}

export function parseOffline(bytes: Uint8Array, filename: string): OfflineCollection[] {
  if (bytes.length > byteLimit) throw new Error('O conteúdo descompactado excede 20 MB.');
  let total = 0;
  const add = (collection: OfflineCollection, value: unknown) => {
    if (++total > documentLimit) throw new Error('O arquivo excede 20.000 documentos.');
    collection.documents.push(object(value));
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const size = () => {
    if (offset + 4 > bytes.length) throw new Error('Arquivo BSON truncado.');
    return view.getInt32(offset, true);
  };
  const read = () => {
    const length = size();
    if (length < 5 || offset + length > bytes.length)
      throw new Error('Documento BSON inválido ou truncado.');
    const raw = bytes.subarray(offset, offset + length);
    const value = deserialize(raw, { promoteValues: false, promoteLongs: false });
    offset += length;
    return { value, raw };
  };
  const canonical = (value: unknown) => EJSON.serialize(value, { relaxed: false });
  if (bytes.length >= 4 && view.getUint32(0, true) === 0x8199e26d) {
    offset = 4;
    const header = read().value;
    if (header.version !== '0.1') throw new Error('Versão de archive não suportada.');
    const collections = new Map<string, OfflineCollection>();
    const ended = new Set<string>();
    const checksums = new Map<string, bigint>();
    const namespace = (value: Record<string, unknown>) => {
      if (typeof value.db !== 'string' || typeof value.collection !== 'string')
        throw new Error('Namespace inválido no archive.');
      return `${value.db}.${value.collection}`;
    };
    while (size() !== -1) {
      const name = namespace(read().value);
      if (collections.has(name) || collections.size >= 200)
        throw new Error('Metadados duplicados ou mais de 200 coleções.');
      collections.set(name, { name, documents: [] });
    }
    offset += 4;
    while (offset < bytes.length) {
      const segment = read().value;
      const name = namespace(segment);
      const collection = collections.get(name);
      if (!collection || ended.has(name)) throw new Error('Segmento desconhecido ou já encerrado.');
      if (segment.EOF === true) {
        if (String(segment.CRC) !== BigInt.asIntN(64, checksums.get(name) ?? 0n).toString())
          throw new Error('A verificação de integridade do archive falhou.');
        ended.add(name);
      } else if (segment.EOF === false) {
        while (size() !== -1) {
          const document = read();
          checksums.set(name, archiveChecksum(document.raw, checksums.get(name)));
          add(collection, canonical(document.value));
        }
      } else throw new Error('Cabeçalho de segmento inválido.');
      if (size() !== -1) throw new Error('Terminador de segmento ausente.');
      offset += 4;
    }
    if (ended.size !== collections.size)
      throw new Error('Archive incompleto: faltam encerramentos de coleção.');
    return [...collections.values()];
  }
  const collection: OfflineCollection = {
    name: filename.replace(/\.(?:jsonl|ndjson|json|bson)$/i, ''),
    documents: [],
  };
  if (/\.bson$/i.test(filename)) {
    while (offset < bytes.length) add(collection, canonical(read().value));
  } else if (/\.(?:json|jsonl|ndjson)$/i.test(filename)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    if (!text) throw new Error('O arquivo está vazio.');
    if (text.startsWith('[')) {
      const values: unknown = parseJson(text);
      if (!Array.isArray(values)) throw new Error('Esperado um array JSON.');
      for (const value of values) add(collection, value);
    } else {
      try {
        add(collection, parseJson(text));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          if (!line.trim()) continue;
          try {
            add(collection, parseJson(line));
          } catch (failure) {
            if (!(failure instanceof SyntaxError)) throw failure;
            throw new Error(`JSON inválido na linha ${index + 1}.`, { cause: failure });
          }
        }
      }
    }
  } else throw new Error('Escolha JSON, JSON Lines, BSON ou um archive do mongodump.');
  return [collection];
}
