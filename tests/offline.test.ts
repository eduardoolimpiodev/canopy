import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, Long, ObjectId } from 'bson';
import { archiveChecksum, parseOffline } from '../src/client/offline.js';

test('JSON, JSON Lines and BSON preserve documents and BSON types', () => {
  assert.equal(
    parseOffline(new TextEncoder().encode('[{"nome":"Ana"}]'), 'clientes.json')[0].documents[0]
      .nome,
    'Ana',
  );
  assert.equal(
    parseOffline(new TextEncoder().encode('{"a":1}\n{"a":2}'), 'dados.jsonl')[0].documents.length,
    2,
  );
  const result = parseOffline(
    serialize({
      _id: new ObjectId('671000000000000000000001'),
      n: Long.fromString('9007199254740993'),
    }),
    'dados.bson',
  );
  assert.deepEqual(result[0].documents[0].n, { $numberLong: '9007199254740993' });
  assert.deepEqual(result[0].documents[0]._id, { $oid: '671000000000000000000001' });
  assert.throws(() => parseOffline(new Uint8Array([10, 0, 0, 0]), 'dados.bson'), /truncado/);
  assert.throws(
    () => parseOffline(new TextEncoder().encode('{"a":1}\ninvalid'), 'dados.jsonl'),
    /linha 2/,
  );
});

test('archive validates CRC, namespace endings and truncation', () => {
  assert.equal(archiveChecksum(new TextEncoder().encode('123456789')), 0x995dc9bbdf1939fan);
  const data = serialize({ nome: 'Ana' });
  const end = new Uint8Array([255, 255, 255, 255]);
  const make = (crc: bigint) =>
    Buffer.concat([
      Buffer.from([0x6d, 0xe2, 0x99, 0x81]),
      serialize({ version: '0.1' }),
      serialize({ db: 'loja', collection: 'clientes', metadata: '{}' }),
      end,
      serialize({ db: 'loja', collection: 'clientes', EOF: false, CRC: Long.ZERO }),
      data,
      end,
      serialize({
        db: 'loja',
        collection: 'clientes',
        EOF: true,
        CRC: Long.fromBigInt(BigInt.asIntN(64, crc)),
      }),
      end,
    ]);
  const archive = make(archiveChecksum(data));
  assert.equal(parseOffline(archive, 'dump.archive')[0].documents[0].nome, 'Ana');
  assert.throws(() => parseOffline(make(0n), 'dump.archive'), /integridade/);
  assert.throws(
    () => parseOffline(archive.subarray(0, archive.length - 2), 'dump.archive'),
    /truncado/,
  );
});
test('JSON refuses unsafe integers and preserves limit errors', () => {
  assert.throws(
    () => parseOffline(new TextEncoder().encode('[{"n":9007199254740993}]'), 'dados.json'),
    /precisão segura/,
  );
  assert.throws(
    () => parseOffline(new TextEncoder().encode(Array(20001).fill('{}').join('\n')), 'dados.jsonl'),
    /20.000 documentos/,
  );
});
