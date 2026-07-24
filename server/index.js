/* UzoneQuiz server — zero-dependency Node.js API + static host backed by
   MongoDB. Run with: node server/index.js (MongoDB must be reachable at
   MONGODB_URI, default mongodb://127.0.0.1:27017/uzonequiz). */
'use strict';
require("dotenv").config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { verifyToken } = require('./lib/auth');
const { Router, HttpError, readJsonBody, sendJson, serveStatic } = require('./lib/httpx');
const { registerAuthRoutes, resolveUser } = require('./routes/auth');
const { registerContentRoutes } = require('./routes/content');
const { registerInsightRoutes } = require('./routes/insights');
const { seedIfEmpty } = require('./seed');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.data');

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, 'jwt-secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, secret, { mode: 0o600 }); } catch {}
  return secret;
}

function buildApp({ db, cfg }) {
  const router = new Router();
  const deps = { db, cfg, verifyToken };
  registerAuthRoutes(router, deps);
  registerContentRoutes(router, deps);
  registerInsightRoutes(router, deps);

  router.get('/api/health', async (ctx) => {
    let dbOk = false;
    try { await db.command({ ping: 1 }); dbOk = true; } catch {}
    sendJson(ctx.res, dbOk ? 200 : 503, { ok: dbOk, db: dbOk ? 'connected' : 'unreachable' });
  });

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Role');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (!url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && serveStatic(ROOT, url.pathname, res)) return;
      if (req.method === 'GET') { serveStatic(ROOT, '/index.html', res); return; }
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const match = router.match(req.method, url.pathname);
    if (!match) { sendJson(res, 404, { error: 'Not found' }); return; }
    try {
      const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readJsonBody(req) : {};
      const { user, actingRole, authed } = await resolveUser(req, db, cfg, verifyToken);
      const query = Object.fromEntries(url.searchParams);
      await match.handler({ req, res, params: match.params, query, body, db, user, actingRole, authed, cfg });
    } catch (err) {
      if (err instanceof HttpError) { sendJson(res, err.status, { error: err.message }); return; }
      console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname} failed:`, err);
      sendJson(res, 500, { error: 'Something went wrong on the server' });
    }
  };
}

async function connectWithRetry(uri, { attempts = 30, delayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const client = new MongoClient(uri);
    try {
  console.log("Trying MongoDB connection...");
  await client.connect();
  console.log("MongoDB connected successfully");
  return client;
} catch (err) {
  console.error("MongoDB connect failed:", err.message);
  lastErr = err;
  await client.close();
  await new Promise(r => setTimeout(r, delayMs));
}
    catch (err) { lastErr = err; await client.close(); await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw lastErr;
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/uzonequiz';
  const port = Number(process.env.PORT) || 5050;
  const cfg = { jwtSecret: loadJwtSecret() };

  console.log(`Connecting to MongoDB at ${uri.replace(/\/\/[^@]*@/, '//<credentials>@')} ...`);
  let client;
  try {
    client = await connectWithRetry(uri, { attempts: Number(process.env.MONGO_CONNECT_ATTEMPTS) || 30 });
  } catch (err) {
    console.error('\nCould not reach MongoDB:', err.message);
    console.error('Start it first, e.g.:  brew services start mongodb-community');
    process.exit(1);
  }
  const db = client.db();
   console.log("MongoDB connected");
  await seedIfEmpty(db, { log: console.log });
   console.log("Seed completed");

  const handle = buildApp({ db, cfg });
  const server = http.createServer(handle);
  server.listen(port, () => {
    console.log(`\nUzoneQuiz is running:  http://localhost:${port}`);
    console.log('API base:              /api  (health: /api/health)');
    console.log('Demo logins:           demo@uzonequiz.app / demopass (student)');
    console.log('                       teacher@uzonequiz.app / teachpass (teacher)');
  });
  server.on('error', (err) => { console.error('HTTP server error:', err.message); process.exit(1); });

  const shutdown = async () => { server.close(); await client.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { buildApp, connectWithRetry };

if (require.main === module) main();
