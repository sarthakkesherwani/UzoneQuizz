/* Exercises the OP_MSG framing without a real socket by injecting a fake
   transport into MongoClient. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { MongoClient, parseUri, resolveSrvHosts } = require('../lib/mongo');
const { encode, decode } = require('../lib/bson');

function fakeReply(responseTo, doc) {
  const body = encode(doc);
  const header = Buffer.allocUnsafe(16);
  header.writeInt32LE(16 + 4 + 1 + body.length, 0);
  header.writeInt32LE(999, 4);
  header.writeInt32LE(responseTo, 8);
  header.writeInt32LE(2013, 12);
  return Buffer.concat([header, Buffer.alloc(4), Buffer.from([0]), body]);
}

function clientWithFakeSocket() {
  const client = new MongoClient('mongodb://127.0.0.1:27017/testdb');
  const written = [];
  client.socket = {
    write(buf, cb) { written.push(Buffer.from(buf)); if (cb) cb(); },
    removeAllListeners() {}, destroy() {},
  };
  return { client, written };
}

test('parseUri handles hosts, credentials, db, and options', () => {
  const cfg = parseUri('mongodb://alice:s%40cret@db.example.com:27018/mydb?authSource=admin&tls=true');
  assert.strictEqual(cfg.hosts[0].host, 'db.example.com');
  assert.strictEqual(cfg.hosts[0].port, 27018);
  assert.strictEqual(cfg.user, 'alice');
  assert.strictEqual(cfg.password, 's@cret');
  assert.strictEqual(cfg.dbName, 'mydb');
  assert.strictEqual(cfg.authSource, 'admin');
  assert.strictEqual(cfg.tls, true);
  assert.strictEqual(parseUri('mongodb://127.0.0.1:27017').hosts[0].port, 27017);
  assert.throws(() => parseUri('mysql://nope'));
});

test('parseUri handles mongodb+srv (TLS on, single host) and multi-host lists', () => {
  const srv = parseUri('mongodb+srv://user:pw@cluster0.abc.mongodb.net/uzonequiz?retryWrites=true&w=majority');
  assert.strictEqual(srv.srv, true);
  assert.strictEqual(srv.tls, true, '+srv implies TLS');
  assert.strictEqual(srv.dbName, 'uzonequiz');
  assert.throws(() => parseUri('mongodb+srv://host:27017/db'), /single hostname without a port/);

  const multi = parseUri('mongodb://a.example.com:27017,b.example.com:27018/db?replicaSet=rs0');
  assert.strictEqual(multi.hosts.length, 2);
  assert.strictEqual(multi.hosts[1].port, 27018);
});

test('resolveSrvHosts expands SRV records and merges TXT options', async () => {
  const cfg = parseUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/uzonequiz');
  const fakeDns = {
    resolveSrv: async (name) => {
      assert.strictEqual(name, '_mongodb._tcp.cluster0.abc.mongodb.net');
      return [
        { name: 'shard-00.abc.mongodb.net', port: 27017 },
        { name: 'shard-01.abc.mongodb.net', port: 27017 },
      ];
    },
    resolveTxt: async () => [['authSource=admin&replicaSet=atlas-rs0']],
  };
  const hosts = await resolveSrvHosts(cfg, fakeDns);
  assert.strictEqual(hosts.length, 2);
  assert.strictEqual(hosts[0].host, 'shard-00.abc.mongodb.net');
  assert.strictEqual(cfg.authSource, 'admin');
  assert.strictEqual(cfg.options.replicaSet, 'atlas-rs0');
  assert.strictEqual(cfg.srvResolved, true);
});

test('command frames a valid OP_MSG and resolves on matching reply', async () => {
  const { client, written } = clientWithFakeSocket();
  const promise = client._command('testdb', { ping: 1 });
  assert.strictEqual(written.length, 1);
  const msg = written[0];
  assert.strictEqual(msg.readInt32LE(0), msg.length);        // messageLength
  const requestId = msg.readInt32LE(4);
  assert.strictEqual(msg.readInt32LE(8), 0);                 // responseTo
  assert.strictEqual(msg.readInt32LE(12), 2013);             // OP_MSG
  assert.strictEqual(msg.readUInt32LE(16), 0);               // flagBits
  assert.strictEqual(msg[20], 0);                            // section kind 0
  const body = decode(msg, 21);
  assert.strictEqual(body.ping, 1);
  assert.strictEqual(body.$db, 'testdb');

  client._onData(fakeReply(requestId, { ok: 1, n: 5 }));
  const reply = await promise;
  assert.strictEqual(reply.n, 5);
});

test('reassembles replies split across arbitrary chunk boundaries', async () => {
  const { client, written } = clientWithFakeSocket();
  const promise = client._command('testdb', { find: 'x', filter: {} });
  const requestId = written[0].readInt32LE(4);
  const reply = fakeReply(requestId, { ok: 1, cursor: { id: 0, firstBatch: [{ _id: 'a' }, { _id: 'b' }] } });
  for (let i = 0; i < reply.length; i += 3) client._onData(reply.subarray(i, Math.min(i + 3, reply.length)));
  const out = await promise;
  assert.deepStrictEqual(out.cursor.firstBatch.map(d => d._id), ['a', 'b']);
});

test('two pipelined commands resolve by responseTo, out of order', async () => {
  const { client, written } = clientWithFakeSocket();
  const p1 = client._command('testdb', { ping: 1 });
  const p2 = client._command('testdb', { hello: 1 });
  const id1 = written[0].readInt32LE(4);
  const id2 = written[1].readInt32LE(4);
  client._onData(fakeReply(id2, { ok: 1, which: 'second' }));
  client._onData(fakeReply(id1, { ok: 1, which: 'first' }));
  assert.strictEqual((await p1).which, 'first');
  assert.strictEqual((await p2).which, 'second');
});

test('command error replies reject with server message', async () => {
  const { client, written } = clientWithFakeSocket();
  const promise = client._command('testdb', { insert: 'x' });
  const requestId = written[0].readInt32LE(4);
  client._onData(fakeReply(requestId, { ok: 0, errmsg: 'duplicate key', code: 11000 }));
  await assert.rejects(promise, /duplicate key/);
});

test('connection failure rejects all in-flight commands', async () => {
  const { client } = clientWithFakeSocket();
  const promise = client._command('testdb', { ping: 1 });
  client._fail(new Error('boom'));
  await assert.rejects(promise, /boom/);
});
