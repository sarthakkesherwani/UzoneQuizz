/* Minimal BSON codec (spec: bsonspec.org) — only the types UzoneQuiz needs.
   Zero dependencies: used by the wire-protocol Mongo client in mongo.js. */
'use strict';

const T = {
  DOUBLE: 0x01, STRING: 0x02, DOC: 0x03, ARRAY: 0x04, BINARY: 0x05,
  OBJECTID: 0x07, BOOL: 0x08, DATE: 0x09, NULL: 0x0a, REGEX: 0x0b,
  INT32: 0x10, TIMESTAMP: 0x11, INT64: 0x12, DECIMAL128: 0x13,
  MINKEY: 0xff, MAXKEY: 0x7f,
};

const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;

class ObjectId {
  constructor(bytes) {
    if (bytes instanceof ObjectId) { this.bytes = bytes.bytes; return; }
    if (typeof bytes === 'string') {
      if (!/^[0-9a-fA-F]{24}$/.test(bytes)) throw new Error('Invalid ObjectId hex string');
      this.bytes = Buffer.from(bytes, 'hex');
      return;
    }
    if (Buffer.isBuffer(bytes)) {
      if (bytes.length !== 12) throw new Error('ObjectId must be 12 bytes');
      this.bytes = Buffer.from(bytes);
      return;
    }
    this.bytes = ObjectId.generate();
  }
  static generate() {
    const b = Buffer.allocUnsafe(12);
    b.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
    require('crypto').randomFillSync(b, 4, 5);
    ObjectId._counter = ((ObjectId._counter ?? Math.floor(Math.random() * 0xffffff)) + 1) & 0xffffff;
    b.writeUIntBE(ObjectId._counter, 9, 3);
    return b;
  }
  toString() { return this.bytes.toString('hex'); }
  toJSON() { return this.toString(); }
  equals(other) { return other instanceof ObjectId && this.bytes.equals(other.bytes); }
}

class Binary {
  constructor(buffer, subtype = 0) { this.buffer = buffer; this.subtype = subtype; }
}

/* A value that must be encoded as int64 regardless of magnitude (e.g. cursor ids). */
class Long {
  constructor(value) { this.value = typeof value === 'bigint' ? value : BigInt(value); }
  toString() { return this.value.toString(); }
  toJSON() { return Number(this.value); }
}

function cstring(str) {
  const b = Buffer.from(String(str), 'utf8');
  if (b.includes(0)) throw new Error('BSON cstring cannot contain null bytes');
  return Buffer.concat([b, Buffer.from([0])]);
}

function encodeValue(name, value, chunks) {
  const push = (type, ...bufs) => { chunks.push(Buffer.from([type]), cstring(name), ...bufs); };
  if (value === null || value === undefined) { push(T.NULL); return; }
  switch (typeof value) {
    case 'number': {
      if (Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX) {
        const b = Buffer.allocUnsafe(4); b.writeInt32LE(value, 0); push(T.INT32, b);
      } else if (Number.isInteger(value) && Number.isSafeInteger(value)) {
        const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(BigInt(value), 0); push(T.INT64, b);
      } else {
        const b = Buffer.allocUnsafe(8); b.writeDoubleLE(value, 0); push(T.DOUBLE, b);
      }
      return;
    }
    case 'string': {
      const s = Buffer.from(value, 'utf8');
      const len = Buffer.allocUnsafe(4); len.writeInt32LE(s.length + 1, 0);
      push(T.STRING, len, s, Buffer.from([0]));
      return;
    }
    case 'boolean': push(T.BOOL, Buffer.from([value ? 1 : 0])); return;
    case 'bigint': {
      const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(BigInt.asIntN(64, value), 0); push(T.INT64, b);
      return;
    }
    case 'object': {
      if (value instanceof Date) {
        const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(BigInt(value.getTime()), 0); push(T.DATE, b);
      } else if (value instanceof ObjectId) {
        push(T.OBJECTID, value.bytes);
      } else if (value instanceof Long) {
        const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(BigInt.asIntN(64, value.value), 0); push(T.INT64, b);
      } else if (value instanceof Binary || Buffer.isBuffer(value)) {
        const buf = Buffer.isBuffer(value) ? value : value.buffer;
        const subtype = Buffer.isBuffer(value) ? 0 : value.subtype;
        const len = Buffer.allocUnsafe(4); len.writeInt32LE(buf.length, 0);
        push(T.BINARY, len, Buffer.from([subtype]), buf);
      } else if (Array.isArray(value)) {
        const doc = {}; value.forEach((v, i) => { doc[i] = v; });
        push(T.ARRAY, encode(doc));
      } else if (value instanceof RegExp) {
        let flags = ''; // BSON flag order must be alphabetical
        if (value.ignoreCase) flags += 'i'; if (value.multiline) flags += 'm'; if (value.dotAll) flags += 's';
        chunks.push(Buffer.from([T.REGEX]), cstring(name), cstring(value.source), cstring(flags));
      } else {
        push(T.DOC, encode(value));
      }
      return;
    }
    default:
      throw new Error(`BSON cannot encode type ${typeof value} for key "${name}"`);
  }
}

function encode(doc) {
  const chunks = [];
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === 'function') continue;
    encodeValue(key, value, chunks);
  }
  const body = Buffer.concat(chunks);
  const out = Buffer.allocUnsafe(4 + body.length + 1);
  out.writeInt32LE(out.length, 0);
  body.copy(out, 4);
  out[out.length - 1] = 0;
  return out;
}

function readCString(buf, pos) {
  const end = buf.indexOf(0, pos);
  if (end < 0) throw new Error('BSON: unterminated cstring');
  return [buf.toString('utf8', pos, end), end + 1];
}

function decode(buf, offset = 0) {
  const size = buf.readInt32LE(offset);
  if (size < 5 || offset + size > buf.length) throw new Error('BSON: invalid document size');
  const doc = {};
  let pos = offset + 4;
  const end = offset + size - 1;
  while (pos < end) {
    const type = buf[pos]; pos += 1;
    let key; [key, pos] = readCString(buf, pos);
    switch (type) {
      case T.DOUBLE: doc[key] = buf.readDoubleLE(pos); pos += 8; break;
      case T.STRING: {
        const len = buf.readInt32LE(pos); pos += 4;
        doc[key] = buf.toString('utf8', pos, pos + len - 1); pos += len;
        break;
      }
      case T.DOC: {
        const dlen = buf.readInt32LE(pos);
        doc[key] = decode(buf, pos); pos += dlen;
        break;
      }
      case T.ARRAY: {
        const dlen = buf.readInt32LE(pos);
        const inner = decode(buf, pos); pos += dlen;
        doc[key] = Object.keys(inner).map(k => inner[k]);
        break;
      }
      case T.BINARY: {
        const len = buf.readInt32LE(pos); pos += 4;
        const subtype = buf[pos]; pos += 1;
        doc[key] = new Binary(Buffer.from(buf.subarray(pos, pos + len)), subtype); pos += len;
        break;
      }
      case T.OBJECTID: doc[key] = new ObjectId(Buffer.from(buf.subarray(pos, pos + 12))); pos += 12; break;
      case T.BOOL: doc[key] = buf[pos] === 1; pos += 1; break;
      case T.DATE: doc[key] = new Date(Number(buf.readBigInt64LE(pos))); pos += 8; break;
      case T.NULL: doc[key] = null; break;
      case T.REGEX: {
        let source, flags;
        [source, pos] = readCString(buf, pos);
        [flags, pos] = readCString(buf, pos);
        doc[key] = new RegExp(source, flags.replace(/[^gims]/g, ''));
        break;
      }
      case T.INT32: doc[key] = buf.readInt32LE(pos); pos += 4; break;
      case T.TIMESTAMP: doc[key] = new Long(buf.readBigUInt64LE(pos)); pos += 8; break;
      case T.INT64: {
        const v = buf.readBigInt64LE(pos); pos += 8;
        doc[key] = (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : new Long(v);
        break;
      }
      case T.DECIMAL128: doc[key] = new Binary(Buffer.from(buf.subarray(pos, pos + 16)), 0x13); pos += 16; break;
      case T.MINKEY: case T.MAXKEY: doc[key] = null; break;
      default:
        throw new Error(`BSON: unsupported element type 0x${type.toString(16)} for key "${key}"`);
    }
  }
  return doc;
}

module.exports = { encode, decode, ObjectId, Binary, Long };
