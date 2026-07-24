'use strict';

const http = require('http');
const crypto = require('crypto');
const { buildApp } = require('./server/index');
const { seedIfEmpty } = require('./server/seed');
const { FakeDb } = require('./server/test/helpers');

async function main() {
  const db = new FakeDb();
  await seedIfEmpty(db, { log: console.log });
  const cfg = { jwtSecret: crypto.randomBytes(32).toString('hex') };
  const server = http.createServer(buildApp({ db, cfg }));
  const port = Number(process.env.PORT) || 5050;
  server.listen(port, '0.0.0.0', () => {
    console.log(`UzoneQuiz preview running at http://127.0.0.1:${port}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
