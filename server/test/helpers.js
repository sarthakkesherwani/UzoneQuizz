/* In-memory stand-ins for the Mongo client and HTTP response, so route
   handlers can be exercised without sockets (the sandbox forbids binding). */
'use strict';

function matches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => doc[k] === v);
}

const applyProjection = (doc, projection) =>
  Object.fromEntries(Object.keys(projection).filter(k => projection[k]).map(k => [k, doc[k]]));

/* Mirrors the real driver's FindCursor chain: sort/limit/project/toArray. */
class FakeCursor {
  constructor(docs, { sort, limit, projection } = {}) {
    this._docs = docs;
    this._sort = sort || null;
    this._limit = limit || 0;
    this._projection = projection || null;
  }
  sort(spec) { this._sort = spec; return this; }
  limit(n) { this._limit = n; return this; }
  project(projection) { this._projection = projection; return this; }
  async toArray() {
    let out = this._docs;
    if (this._sort) {
      const entries = Object.entries(this._sort);
      out = [...out].sort((a, b) => {
        for (const [key, dir] of entries) {
          if (a[key] > b[key]) return dir;
          if (a[key] < b[key]) return -dir;
        }
        return 0;
      });
    }
    if (this._limit) out = out.slice(0, this._limit);
    if (this._projection) out = out.map(d => applyProjection(d, this._projection));
    return out;
  }
}

class FakeCollection {
  constructor() { this.docs = []; }
  find(filter = {}, opts = {}) {
    return new FakeCursor(this.docs.filter(d => matches(d, filter)).map(d => ({ ...d })), opts);
  }
  async findOne(filter, opts = {}) { return (await this.find(filter, { ...opts, limit: 1 }).toArray())[0] || null; }
  async insertOne(doc) { this.docs.push({ ...doc }); return { insertedId: doc._id }; }
  async insertMany(docs) { docs.forEach(d => this.docs.push({ ...d })); return {}; }
  async updateOne(filter, update, { upsert = false } = {}) {
    const doc = this.docs.find(d => matches(d, filter));
    if (doc && update.$set) Object.assign(doc, update.$set);
    if (doc && update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
    if (!doc && upsert) this.docs.push({ ...filter, ...(update.$set || {}) });
    return { matchedCount: doc ? 1 : 0 };
  }
  async updateMany(filter, update) {
    let n = 0;
    for (const doc of this.docs.filter(d => matches(d, filter))) { Object.assign(doc, update.$set || {}); n++; }
    return { matchedCount: n };
  }
  async deleteOne(filter) {
    const i = this.docs.findIndex(d => matches(d, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter(d => !matches(d, filter));
    return { deletedCount: before - this.docs.length };
  }
  async countDocuments(filter = {}) { return this.docs.filter(d => matches(d, filter)).length; }
  async createIndex() { return 'fake'; }
}

class FakeDb {
  constructor() { this.collections = new Map(); }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name);
  }
  async command() { return { ok: 1 }; }
}

class FakeRes {
  constructor() { this.status = null; this.headers = null; this.body = ''; }
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  setHeader() {}
  end(body) { this.body = body || ''; }
  get json() { return this.body ? JSON.parse(this.body) : null; }
}

/* Dispatches a request through a Router the way server/index.js does. */
async function call(router, { method, path, body = {}, user = null, actingRole = 'student', authed = false, db, query = {} }) {
  const match = router.match(method, path.split('?')[0]);
  if (!match) throw new Error(`No route for ${method} ${path}`);
  const res = new FakeRes();
  try {
    await match.handler({ req: {}, res, params: match.params, query, body, db, user, actingRole, authed, cfg: { jwtSecret: 'test-secret' } });
  } catch (err) {
    if (err.status) { res.writeHead(err.status, {}); res.end(JSON.stringify({ error: err.message })); }
    else throw err;
  }
  return res;
}

module.exports = { FakeDb, FakeCollection, FakeRes, call };
