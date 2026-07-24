'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { encode, decode, ObjectId, Binary, Long } = require('../lib/bson');

test('encodes the bsonspec.org "hello world" vector exactly', () => {
  const buf = encode({ hello: 'world' });
  assert.strictEqual(buf.toString('hex'), '16000000 02 68656c6c6f00 06000000 776f726c6400 00'.replaceAll(' ', ''));
});

test('encodes the bsonspec.org mixed-array vector exactly', () => {
  const buf = encode({ BSON: ['awesome', 5.05, 1986] });
  // Reference bytes from the spec: "1\x00\x00\x00\x04BSON\x00&\x00\x00\x00\x020\x00\x08\x00\x00\x00awesome\x00\x011\x00333333\x14@\x102\x00\xc2\x07\x00\x00\x00\x00"
  const spec = Buffer.concat([
    Buffer.from([0x31, 0, 0, 0, 0x04]), Buffer.from('BSON\0'),
    Buffer.from([0x26, 0, 0, 0, 0x02]), Buffer.from('0\0'), Buffer.from([8, 0, 0, 0]), Buffer.from('awesome\0'),
    Buffer.from([0x01]), Buffer.from('1\0'), Buffer.from([0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x14, 0x40]),
    Buffer.from([0x10]), Buffer.from('2\0'), Buffer.from([0xc2, 0x07, 0, 0]),
    Buffer.from([0, 0]),
  ]);
  assert.deepStrictEqual(buf, spec, `got ${buf.toString('hex')} expected ${spec.toString('hex')}`);
});

test('roundtrips a nested document with every supported type', () => {
  const oid = new ObjectId();
  const doc = {
    str: 'héllo — unicode ✓',
    int: 42,
    negInt: -7,
    big: 4294967296,
    dbl: 3.14159,
    bool: true,
    off: false,
    nothing: null,
    when: new Date('2026-07-19T00:00:00Z'),
    id: oid,
    bin: new Binary(Buffer.from([1, 2, 3]), 0),
    arr: [1, 'two', { three: 3 }, [4]],
    nested: { a: { b: { c: 'deep' } } },
    long: new Long(9007199254740993n),
  };
  const out = decode(encode(doc));
  assert.strictEqual(out.str, doc.str);
  assert.strictEqual(out.int, 42);
  assert.strictEqual(out.negInt, -7);
  assert.strictEqual(out.big, 4294967296);
  assert.ok(Math.abs(out.dbl - 3.14159) < 1e-12);
  assert.strictEqual(out.bool, true);
  assert.strictEqual(out.off, false);
  assert.strictEqual(out.nothing, null);
  assert.strictEqual(out.when.getTime(), doc.when.getTime());
  assert.ok(out.id.equals(oid));
  assert.deepStrictEqual([...out.bin.buffer], [1, 2, 3]);
  assert.deepStrictEqual(out.arr, [1, 'two', { three: 3 }, [4]]);
  assert.strictEqual(out.nested.a.b.c, 'deep');
  assert.strictEqual(out.long.value, 9007199254740993n);
});

test('int32 boundaries encode as int32, beyond as int64', () => {
  const out = decode(encode({ min: -2147483648, max: 2147483647, over: 2147483648, under: -2147483649 }));
  assert.strictEqual(out.min, -2147483648);
  assert.strictEqual(out.max, 2147483647);
  assert.strictEqual(out.over, 2147483648);
  assert.strictEqual(out.under, -2147483649);
});

test('empty document and empty array', () => {
  assert.strictEqual(encode({}).toString('hex'), '0500000000');
  const out = decode(encode({ arr: [], doc: {} }));
  assert.deepStrictEqual(out.arr, []);
  assert.deepStrictEqual(out.doc, {});
});

test('rejects keys containing null bytes', () => {
  assert.throws(() => encode({ ['bad\0key']: 1 }));
});
