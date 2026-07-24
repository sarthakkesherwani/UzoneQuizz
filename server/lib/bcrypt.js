/* Pure-JS bcrypt *verification* (no deps) — needed because accounts created by
   the project's earlier backend store bcrypt "$2a/b/y$" password hashes.
   The Blowfish P/S tables are the fractional hex digits of π; rather than
   embedding 4 KiB of constants they are computed once at load time with a
   BigInt Machin-formula evaluation and sanity-checked against the well-known
   leading digits. Verified in tests against python-bcrypt/htpasswd vectors. */
'use strict';

const crypto = require('crypto');

const TABLE_BYTES = 18 * 4 + 4 * 256 * 4; // P-array + four S-boxes

function piFractionBytes(nBytes) {
  const bits = nBytes * 8;
  const prec = BigInt(bits + 128); // guard bits cover series truncation error
  const one = 1n << prec;
  const atanInv = (x) => {
    const x2 = BigInt(x * x);
    let xpow = one / BigInt(x);
    let sum = 0n;
    let k = 0n;
    while (xpow !== 0n) {
      const t = xpow / (2n * k + 1n);
      sum += k % 2n === 0n ? t : -t;
      xpow /= x2;
      k += 1n;
    }
    return sum;
  };
  const pi = 16n * atanInv(5) - 4n * atanInv(239); // Machin's formula
  const frac = pi - 3n * one;
  const top = frac >> (prec - BigInt(bits));
  const hex = top.toString(16).padStart(nBytes * 2, '0');
  return Buffer.from(hex, 'hex');
}

let INITIAL = null;
function initialState() {
  if (!INITIAL) {
    const bytes = piFractionBytes(TABLE_BYTES);
    if (bytes.readUInt32BE(0) !== 0x243f6a88 || bytes.readUInt32BE(4) !== 0x85a308d3) {
      throw new Error('bcrypt: pi table self-check failed');
    }
    const words = new Uint32Array(TABLE_BYTES / 4);
    for (let i = 0; i < words.length; i++) words[i] = bytes.readUInt32BE(i * 4);
    INITIAL = words;
  }
  return INITIAL;
}

function encipher(P, S, lr) {
  let l = lr[0] ^ P[0];
  let r = lr[1];
  for (let i = 1; i <= 16; i += 2) {
    r ^= ((((S[l >>> 24] + S[256 + ((l >>> 16) & 0xff)]) >>> 0) ^ S[512 + ((l >>> 8) & 0xff)]) + S[768 + (l & 0xff)]) >>> 0;
    r = (r ^ P[i]) >>> 0;
    l ^= ((((S[r >>> 24] + S[256 + ((r >>> 16) & 0xff)]) >>> 0) ^ S[512 + ((r >>> 8) & 0xff)]) + S[768 + (r & 0xff)]) >>> 0;
    l = (l ^ P[i + 1]) >>> 0;
  }
  lr[0] = (r ^ P[17]) >>> 0;
  lr[1] = l >>> 0;
}

const cyclic = (buf, state) => {
  let w = 0;
  for (let i = 0; i < 4; i++) { w = ((w << 8) | buf[state.off]) >>> 0; state.off = (state.off + 1) % buf.length; }
  return w;
};

/* EksBlowfish ExpandKey. `salt` of null means the all-zero salt variant. */
function expandKey(P, S, salt, key) {
  const ks = { off: 0 };
  for (let i = 0; i < 18; i++) P[i] = (P[i] ^ cyclic(key, ks)) >>> 0;
  const lr = new Uint32Array(2);
  const ss = { off: 0 };
  for (let i = 0; i < 18; i += 2) {
    if (salt) { lr[0] = (lr[0] ^ cyclic(salt, ss)) >>> 0; lr[1] = (lr[1] ^ cyclic(salt, ss)) >>> 0; }
    encipher(P, S, lr);
    P[i] = lr[0]; P[i + 1] = lr[1];
  }
  for (let i = 0; i < 1024; i += 2) {
    if (salt) { lr[0] = (lr[0] ^ cyclic(salt, ss)) >>> 0; lr[1] = (lr[1] ^ cyclic(salt, ss)) >>> 0; }
    encipher(P, S, lr);
    S[i] = lr[0]; S[i + 1] = lr[1];
  }
}

const B64 = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function b64Decode(str, nBytes) {
  const out = Buffer.alloc(nBytes);
  let bits = 0, acc = 0, o = 0;
  for (const ch of str) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bcrypt: bad base64');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >>> bits) & 0xff; if (o === nBytes) break; }
  }
  return out;
}

function b64Encode(buf) {
  let out = '', bits = 0, acc = 0;
  for (const byte of buf) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 6) { bits -= 6; out += B64[(acc >>> bits) & 0x3f]; }
  }
  if (bits) out += B64[(acc << (6 - bits)) & 0x3f];
  return out;
}

function bcryptRaw(password, cost, salt) {
  const state = initialState();
  const P = new Uint32Array(state.subarray(0, 18));
  const S = new Uint32Array(state.subarray(18));
  let key = Buffer.concat([Buffer.from(password, 'utf8'), Buffer.from([0])]);
  if (key.length > 72) key = key.subarray(0, 72);
  expandKey(P, S, salt, key);
  const rounds = 2 ** cost;
  for (let i = 0; i < rounds; i++) {
    expandKey(P, S, null, key);
    expandKey(P, S, null, salt);
  }
  const words = new Uint32Array(6);
  const text = Buffer.from('OrpheanBeholderScryDoubt', 'latin1');
  for (let i = 0; i < 6; i++) words[i] = text.readUInt32BE(i * 4);
  for (let i = 0; i < 64; i++) {
    for (let b = 0; b < 3; b++) {
      const lr = words.subarray(b * 2, b * 2 + 2);
      encipher(P, S, lr);
    }
  }
  const out = Buffer.alloc(24);
  for (let i = 0; i < 6; i++) out.writeUInt32BE(words[i], i * 4);
  return out.subarray(0, 23);
}

function verify(password, hash) {
  const m = /^\$2[abxy]?\$(\d\d)\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/.exec(String(hash));
  if (!m) return false;
  const cost = Number(m[1]);
  if (cost < 4 || cost > 16) return false;
  const salt = b64Decode(m[2], 16);
  const digest = b64Encode(bcryptRaw(String(password), cost, salt));
  const a = Buffer.from(digest);
  const b = Buffer.from(m[3]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isBcryptHash = (hash) => /^\$2[abxy]?\$\d\d\$/.test(String(hash || ''));

module.exports = { verify, isBcryptHash };
