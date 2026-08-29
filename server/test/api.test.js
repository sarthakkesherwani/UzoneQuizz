/* API-level tests: routes exercised against an in-memory database. */
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { Router } = require('../lib/httpx');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../lib/auth');
const { validateQuiz } = require('../lib/util');
const { registerAuthRoutes } = require('../routes/auth');
const { registerContentRoutes } = require('../routes/content');
const { registerInsightRoutes } = require('../routes/insights');
const { FakeDb, call } = require('./helpers');

const quizPayload = (over = {}) => ({
  id: 'test-quiz', title: 'Test Quiz', subject: 'Java', batch: '5.0', semester: '4',
  topic: 'Basics', difficulty: 'Medium', marks: 20, timer: 10, instructions: 'Go',
  leaderboard: true, retry: true, status: 'Published',
  questions: [
    { id: 'q1', question: '1+1?', options: ['1', '2', '3', '4'], correct: 1, explanation: 'math', marks: 10 },
    { id: 'q2', question: '2+2?', options: ['2', '3', '4', '5'], correct: 2, explanation: 'math', marks: 10 },
  ],
  ...over,
});

let db, router, teacher, student;
beforeEach(async () => {
  db = new FakeDb();
  router = new Router();
  const deps = { db, cfg: { jwtSecret: 'test-secret' }, verifyToken };
  registerAuthRoutes(router, deps);
  registerContentRoutes(router, deps);
  registerInsightRoutes(router, deps);
  teacher = { _id: 't1', name: 'Teacher', email: 't@x.com', role: 'teacher', batch: '', bookmarks: [], quizBookmarks: [] };
  student = { _id: 's1', name: 'Student One', email: 's@x.com', role: 'student', batch: '5.0', bookmarks: [], quizBookmarks: [] };
  await db.collection('users').insertMany([teacher, student]);
});

test('password hashing verifies and rejects', () => {
  const stored = hashPassword('demopass');
  assert.ok(verifyPassword('demopass', stored));
  assert.ok(!verifyPassword('wrong', stored));
});

test('JWT roundtrip, tamper and expiry rejection', () => {
  const token = signToken({ uid: 'u1', role: 'student' }, 'secret');
  assert.strictEqual(verifyToken(token, 'secret').uid, 'u1');
  assert.strictEqual(verifyToken(token + 'x', 'secret'), null);
  assert.strictEqual(verifyToken(token, 'other'), null);
  const expired = signToken({ uid: 'u1' }, 'secret', -10);
  assert.strictEqual(verifyToken(expired, 'secret'), null);
});

test('validateQuiz rejects bad payloads, normalizes good ones', () => {
  assert.ok(validateQuiz({})[0]);
  assert.ok(validateQuiz(quizPayload({ questions: [] }))[0]);
  assert.ok(validateQuiz(quizPayload({ questions: [{ question: 'x', options: ['a'], correct: 0, marks: 1 }] }))[0]);
  assert.ok(validateQuiz(quizPayload({ questions: [{ question: 'x', options: ['a', 'b'], correct: 5, marks: 1 }] }))[0]);
  const [err, quiz] = validateQuiz(quizPayload({ color: 'javascript:alert(1)', status: 'Hacked' }));
  assert.strictEqual(err, null);
  assert.strictEqual(quiz.color, '#4d94ff');
  assert.strictEqual(quiz.status, 'Draft');
});

test('register/login lifecycle with duplicate rejection', async () => {
  let res = await call(router, { method: 'POST', path: '/api/auth/register', db, body: { name: 'New', email: 'new@x.com', password: 'secret1', role: 'student' } });
  assert.strictEqual(res.status, 201);
  assert.ok(res.json.token);
  res = await call(router, { method: 'POST', path: '/api/auth/register', db, body: { name: 'New', email: 'new@x.com', password: 'secret1', role: 'student' } });
  assert.strictEqual(res.status, 409);
  res = await call(router, { method: 'POST', path: '/api/auth/login', db, body: { email: 'new@x.com', password: 'secret1' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.user.name, 'New');
  res = await call(router, { method: 'POST', path: '/api/auth/login', db, body: { email: 'new@x.com', password: 'nope' } });
  assert.strictEqual(res.status, 401);
});

test('registration ignores a client-supplied teacher role unless server policy approves it', async () => {
  const previousWhitelist = process.env.TEACHER_EMAIL_WHITELIST;
  const previousInviteHash = process.env.TEACHER_INVITE_CODE_HASH;
  delete process.env.TEACHER_EMAIL_WHITELIST;
  delete process.env.TEACHER_INVITE_CODE_HASH;

  try {
    let res = await call(router, {
      method: 'POST', path: '/api/auth/register', db,
      body: { name: 'Student', email: 'student@x.com', password: 'secret1', role: 'teacher' },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.user.role, 'student');
    assert.strictEqual(verifyToken(res.json.token, 'test-secret').role, 'student');

    process.env.TEACHER_EMAIL_WHITELIST = 'approved@school.edu';
    res = await call(router, {
      method: 'POST', path: '/api/auth/register', db,
      body: { name: 'Approved', email: 'APPROVED@SCHOOL.EDU', password: 'secret1', role: 'student' },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.user.role, 'teacher');

    process.env.TEACHER_INVITE_CODE_HASH = '$2b$04$tNFB8I6Bk.pK4lIcCHus.uS6.3PrawEnvO0lScvs3niby2WARMTsG';
    res = await call(router, {
      method: 'POST', path: '/api/auth/register', db,
      body: { name: 'Invited', email: 'invited@school.edu', password: 'secret1', teacherInviteCode: 'demopass' },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.user.role, 'teacher');
  } finally {
    if (previousWhitelist === undefined) delete process.env.TEACHER_EMAIL_WHITELIST;
    else process.env.TEACHER_EMAIL_WHITELIST = previousWhitelist;
    if (previousInviteHash === undefined) delete process.env.TEACHER_INVITE_CODE_HASH;
    else process.env.TEACHER_INVITE_CODE_HASH = previousInviteHash;
  }
});

test('quiz create requires teacher role', async () => {
  const res = await call(router, { method: 'POST', path: '/api/quizzes', db, user: student, actingRole: 'student', body: quizPayload() });
  assert.strictEqual(res.status, 403);
});

test('quiz upsert, student visibility, and delete', async () => {
  let res = await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload() });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.quiz.id, 'test-quiz');

  // students only see Published
  await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload({ id: 'draft-1', title: 'Draft', status: 'Draft' }) });
  res = await call(router, { method: 'GET', path: '/api/quizzes', db, user: student, actingRole: 'student' });
  assert.deepStrictEqual(res.json.quizzes.map(q => q.id), ['test-quiz']);
  res = await call(router, { method: 'GET', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher' });
  assert.strictEqual(res.json.quizzes.length, 2);

  // upsert edits in place
  res = await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload({ title: 'Renamed' }) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.quiz.title, 'Renamed');

  res = await call(router, { method: 'DELETE', path: '/api/quizzes/draft-1', db, user: teacher, actingRole: 'teacher' });
  assert.strictEqual(res.json.ok, true);
  res = await call(router, { method: 'DELETE', path: '/api/quizzes/draft-1', db, user: teacher, actingRole: 'teacher' });
  assert.strictEqual(res.status, 404);
});

test('publishing notifies students', async () => {
  await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload() });
  const notes = await db.collection('notifications').find({ userId: 's1' }).toArray();
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0].body, /Test Quiz/);
});

test('attempt is scored server-side and ranked', async () => {
  await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload() });

  // student answers one of two correctly; client-claimed score is ignored
  let res = await call(router, {
    method: 'POST', path: '/api/attempts', db, user: student, actingRole: 'student',
    body: { quizId: 'test-quiz', answers: { q1: 1, q2: 0 }, timeTakenSec: 120, score: 999 },
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.score, 10);
  assert.strictEqual(res.json.correct, 1);
  assert.strictEqual(res.json.accuracyPct, 50);
  assert.strictEqual(res.json.rank, 1);

  // a faster perfect score takes rank 1
  const other = { _id: 's2', name: 'Student Two', role: 'student', batch: '5.0', bookmarks: [] };
  await db.collection('users').insertOne(other);
  res = await call(router, {
    method: 'POST', path: '/api/attempts', db, user: other, actingRole: 'student',
    body: { quizId: 'test-quiz', answers: { q1: 1, q2: 2 }, timeTakenSec: 60 },
  });
  assert.strictEqual(res.json.score, 20);
  assert.strictEqual(res.json.rank, 1);
  assert.deepStrictEqual(res.json.leaderboard.map(r => r.name), ['Student Two', 'Student One']);

  // quiz counters were denormalized
  const quiz = await db.collection('quizzes').findOne({ _id: 'test-quiz' });
  assert.strictEqual(quiz.attempts, 2);
  assert.strictEqual(quiz.accuracy, 75);

  // bookmarks merged from attempt
  res = await call(router, {
    method: 'POST', path: '/api/attempts', db, user: student, actingRole: 'student',
    body: { quizId: 'test-quiz', answers: {}, timeTakenSec: 30, bookmarked: ['q2'] },
  });
  const updated = await db.collection('users').findOne({ _id: 's1' });
  assert.deepStrictEqual(updated.bookmarks, ['q2']);
});

test('attempt against unknown quiz 404s and bad answers 400', async () => {
  let res = await call(router, { method: 'POST', path: '/api/attempts', db, user: student, body: { quizId: 'nope', answers: {} } });
  assert.strictEqual(res.status, 404);
  await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload() });
  res = await call(router, { method: 'POST', path: '/api/attempts', db, user: student, body: { quizId: 'test-quiz', answers: [1, 2] } });
  assert.strictEqual(res.status, 400);
});

test('students table aggregates attempts and flags risk', async () => {
  await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload() });
  await call(router, { method: 'POST', path: '/api/attempts', db, user: student, body: { quizId: 'test-quiz', answers: { q1: 1, q2: 2 }, timeTakenSec: 60 } });
  const res = await call(router, { method: 'GET', path: '/api/students', db, user: teacher, actingRole: 'teacher' });
  const row = res.json.students.find(s => s.name === 'Student One');
  assert.strictEqual(row.attempts, 1);
  assert.strictEqual(row.score, '20 / 20');
  assert.strictEqual(row.accuracy, 100);
  assert.strictEqual(row.status, 'Active');
  const idle = res.json.students.find(s => s.name !== 'Student One');
  assert.strictEqual(idle, undefined); // only seeded student exists
});

test('bootstrap returns role-appropriate payload', async () => {
  await call(router, { method: 'POST', path: '/api/quizzes', db, user: teacher, actingRole: 'teacher', body: quizPayload() });
  let res = await call(router, { method: 'GET', path: '/api/bootstrap', db, user: teacher, actingRole: 'teacher', authed: true });
  assert.ok(res.json.stats.totalQuizzes >= 1);
  assert.ok(Array.isArray(res.json.students));
  assert.ok(res.json.analytics);
  res = await call(router, { method: 'GET', path: '/api/bootstrap', db, user: student, actingRole: 'student', authed: true });
  assert.strictEqual(res.json.students, undefined);
  assert.strictEqual(res.json.quizzes.length, 1);
  assert.ok(res.json.stats);
});

test('bookmark sync sanitizes input', async () => {
  const res = await call(router, {
    method: 'PUT', path: '/api/me/bookmarks', db, user: student,
    body: { bookmarks: ['q1', 'q1', 42, 'x'.repeat(50)], quizBookmarks: ['java-5'] },
  });
  assert.strictEqual(res.json.ok, true);
  const updated = await db.collection('users').findOne({ _id: 's1' });
  assert.deepStrictEqual(updated.bookmarks, ['q1']);
  assert.deepStrictEqual(updated.quizBookmarks, ['java-5']);
});

test('notifications list and read-all', async () => {
  await db.collection('notifications').insertMany([
    { _id: 'n1', userId: 's1', icon: 'sparkles', title: 'Hi', body: 'B', read: false, createdAt: new Date() },
    { _id: 'n2', userId: 't1', icon: 'sparkles', title: 'Other', body: 'B', read: false, createdAt: new Date() },
  ]);
  let res = await call(router, { method: 'GET', path: '/api/notifications', db, user: student });
  assert.strictEqual(res.json.notifications.length, 1);
  assert.strictEqual(res.json.notifications[0].unread, true);
  await call(router, { method: 'POST', path: '/api/notifications/read-all', db, user: student });
  res = await call(router, { method: 'GET', path: '/api/notifications', db, user: student });
  assert.strictEqual(res.json.notifications[0].unread, false);
});


test('logout revokes existing sessions', async () => {
  student.sessionVersion = 0;
  await db.collection('users').updateOne({ _id: student._id }, { $set: { sessionVersion: 0 } });
  const res = await call(router, {
    method: 'POST', path: '/api/auth/logout', db,
    user: student, actingRole: 'student', authed: true, body: {},
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.ok, true);
  const updated = await db.collection('users').findOne({ _id: student._id });
  assert.strictEqual(updated.sessionVersion, 1);
});

test('real accounts cannot escalate role through role switch', async () => {
  const res = await call(router, {
    method: 'POST', path: '/api/auth/role', db,
    user: student, actingRole: 'student', authed: true, body: { role: 'teacher' },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.user.role, 'student');
  assert.strictEqual(verifyToken(res.json.token, 'test-secret').role, 'student');
});
