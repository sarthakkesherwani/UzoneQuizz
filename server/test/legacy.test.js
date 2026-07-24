/* bcrypt verification and legacy-database migration/compatibility. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { verify, isBcryptHash } = require('../lib/bcrypt');
const { migrateLegacy, ensureDemoUsers } = require('../seed');
const { Router } = require('../lib/httpx');
const { verifyToken } = require('../lib/auth');
const { registerAuthRoutes } = require('../routes/auth');
const { registerContentRoutes } = require('../routes/content');
const { FakeDb, call } = require('./helpers');

// Vectors generated with python-bcrypt (cost 4 for test speed; $2b and $2a).
const VECTORS = [
  ['demopass', '$2b$04$tNFB8I6Bk.pK4lIcCHus.uS6.3PrawEnvO0lScvs3niby2WARMTsG'],
  ['s3cret!Pass', '$2b$04$45NwlNW989eEZ/GR/UHJMeuEmuEv9Z5Z2XvrAn62/7tzvTawfCkei'],
  ['पासवर्ड🔐', '$2b$04$fD08MMP3cwmD.5BXjj3oZeBchqjtD6e3S2KFuVdCVl89Dl9lSLCCa'],
  ['legacyPass1', '$2a$04$abcdefghijklmnopqrstuu5pCOrVi1ElkB7Jc6eMhXuTE7DIjfDTO'],
];

test('bcrypt verify matches python-bcrypt vectors and rejects wrong passwords', () => {
  for (const [pw, hash] of VECTORS) {
    assert.ok(verify(pw, hash), `should accept ${hash}`);
    assert.ok(!verify(pw + 'x', hash), `should reject wrong password for ${hash}`);
  }
  assert.ok(isBcryptHash('$2a$10$abc'));
  assert.ok(!isBcryptHash('s2$salt$hash'));
  assert.ok(!verify('x', 'not-a-hash'));
});

const legacyQuiz = () => ({
  _id: 'legacy-1', title: 'datatype', subject: 'java', batch: '', semester: '',
  topic: '', difficulty: 'easy', timerMinutes: 10, status: 'published',
  leaderboardEnabled: true, retryEnabled: true, scheduledAt: null, instructions: '',
  teacherId: 'old-teacher', __v: 0, createdAt: new Date('2026-07-15'),
  questions: [
    { _id: 'lq1', text: 'which are data type', options: ['ruto', 'int', 'output', 'data'], correctIndex: 1, explanation: 'int', marks: 2 },
    { _id: 'lq2', text: 'second q', options: ['a', 'b'], correctIndex: 0, explanation: '', marks: 3 },
  ],
});

test('migrateLegacy rewrites old-backend quizzes and backs up originals', async () => {
  const db = new FakeDb();
  await db.collection('quizzes').insertOne(legacyQuiz());
  await db.collection('users').insertOne({ _id: 'u1', name: 'Sarthak', email: 's@x.com', role: 'student', batch: 'Batch 5.0', passwordHash: VECTORS[0][1] });
  const n = await migrateLegacy(db);
  assert.strictEqual(n, 1);

  const q = await db.collection('quizzes').findOne({ _id: 'legacy-1' });
  assert.strictEqual(q.status, 'Published');
  assert.strictEqual(q.difficulty, 'Easy');
  assert.strictEqual(q.timer, 10);
  assert.strictEqual(q.marks, 5);
  assert.strictEqual(q.leaderboard, true);
  assert.strictEqual(q.retry, true);
  assert.strictEqual(q.ownerId, 'old-teacher');
  assert.deepStrictEqual(q.questions.map(x => x.question), ['which are data type', 'second q']);
  assert.deepStrictEqual(q.questions.map(x => x.correct), [1, 0]);
  assert.deepStrictEqual(q.questions.map(x => x.id), ['lq1', 'lq2']);

  const backup = await db.collection('quizzes_legacy_backup').findOne({ _id: 'legacy-1' });
  assert.ok(backup, 'original must be backed up');
  assert.strictEqual(backup.timerMinutes, 10);

  const u = await db.collection('users').findOne({ _id: 'u1' });
  assert.strictEqual(u.batch, '5.0');
  assert.deepStrictEqual(u.bookmarks, []);

  // idempotent: second run touches nothing
  assert.strictEqual(await migrateLegacy(db), 0);
});

test('legacy bcrypt account can log in and is migrated to scrypt', async () => {
  const db = new FakeDb();
  const router = new Router();
  registerAuthRoutes(router, { db, cfg: { jwtSecret: 'test-secret' }, verifyToken });
  await db.collection('users').insertOne({ _id: 'u1', name: 'Sarthak', email: 'sarthak@x.com', role: 'student', batch: '5.0', passwordHash: VECTORS[0][1] });

  let res = await call(router, { method: 'POST', path: '/api/auth/login', db, body: { email: 'sarthak@x.com', password: 'wrong' } });
  assert.strictEqual(res.status, 401);
  res = await call(router, { method: 'POST', path: '/api/auth/login', db, body: { email: 'sarthak@x.com', password: 'demopass' } });
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.token);
  assert.strictEqual(res.json.user.role, 'student');

  const u = await db.collection('users').findOne({ _id: 'u1' });
  assert.ok(u.passHash?.startsWith('s2$'), 'must be migrated to scrypt');
  res = await call(router, { method: 'POST', path: '/api/auth/login', db, body: { email: 'sarthak@x.com', password: 'demopass' } });
  assert.strictEqual(res.status, 200, 'scrypt path works after migration');
});

test('ensureDemoUsers creates missing demo accounts in a non-empty db', async () => {
  const db = new FakeDb();
  await db.collection('users').insertOne({ _id: 'u1', email: 'real@x.com', role: 'student' });
  const created = await ensureDemoUsers(db);
  assert.strictEqual(created.length, 2);
  assert.ok(await db.collection('users').findOne({ email: 'demo@uzonequiz.app' }));
  assert.ok(await db.collection('users').findOne({ email: 'teacher@uzonequiz.app' }));
  assert.strictEqual((await ensureDemoUsers(db)).length, 0, 'idempotent');
});

test('migrated legacy quiz is visible to students and scoreable', async () => {
  const db = new FakeDb();
  const router = new Router();
  const deps = { db, cfg: { jwtSecret: 'test-secret' }, verifyToken };
  registerContentRoutes(router, deps);
  await db.collection('quizzes').insertOne(legacyQuiz());
  await migrateLegacy(db);
  const student = { _id: 's1', name: 'S', role: 'student', batch: '5.0', bookmarks: [] };
  await db.collection('users').insertOne(student);

  let res = await call(router, { method: 'GET', path: '/api/quizzes', db, user: student, actingRole: 'student' });
  assert.deepStrictEqual(res.json.quizzes.map(q => q.id), ['legacy-1']);

  res = await call(router, { method: 'POST', path: '/api/attempts', db, user: student, body: { quizId: 'legacy-1', answers: { lq1: 1, lq2: 1 }, timeTakenSec: 60 } });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.score, 2);
  assert.strictEqual(res.json.correct, 1);
});
