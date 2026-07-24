/* Seeds MongoDB with the same demo content the static prototype shipped with,
   so the app is fully usable on first boot. Idempotent: skips when users
   already exist. CLI: `node server/seed.js [--force]` (--force wipes first). */
'use strict';

const { hashPassword } = require('./lib/auth');
const { uid } = require('./lib/util');
const { topicQuestions, leetcodeQuizzes } = require('../question-bank');

const sampleQuestions = topicQuestions.Java.slice(0, 5);

const defaultQuizzes = [
  { _id: 'java-5', title: 'Java Quiz — Batch 5.0', subject: 'Java', batch: '5.0', semester: '4', topic: 'OOP & Collections', difficulty: 'Medium', marks: 100, timer: 35, questions: topicQuestions.Java, status: 'Published', retry: true, leaderboard: true, color: '#4d94ff', date: 'Today, 10:30 AM' },
  { _id: 'dsa-5', title: 'DSA Sprint — Batch 5.0', subject: 'DSA', batch: '5.0', semester: '4', topic: 'Trees & Graphs', difficulty: 'Hard', marks: 50, timer: 25, questions: topicQuestions.DSA, status: 'Published', retry: false, leaderboard: true, color: '#9c8cff', date: 'Yesterday' },
  { _id: 'dbms-3', title: 'DBMS Quiz — Batch 3.0', subject: 'DBMS', batch: '3.0', semester: '3', topic: 'Normalization', difficulty: 'Medium', marks: 50, timer: 20, questions: topicQuestions.DBMS, status: 'Scheduled', retry: true, leaderboard: false, color: '#55d9ff', date: 'Jul 22, 9:00 AM' },
  { _id: 'java-4', title: 'Java Quiz — Batch 4.0', subject: 'Java', batch: '4.0', semester: '3', topic: 'Core Java', difficulty: 'Easy', marks: 100, timer: 35, questions: topicQuestions.Java, status: 'Published', retry: true, leaderboard: true, color: '#4de3a3', date: 'Jul 15' },
  { _id: 'os-4', title: 'Operating Systems — Batch 4.0', subject: 'OS', batch: '4.0', semester: '5', topic: 'Processes & Threads', difficulty: 'Hard', marks: 50, timer: 25, questions: topicQuestions.OS, status: 'Draft', retry: false, leaderboard: false, color: '#ffbf62', date: 'Edited 2h ago' },
  { _id: 'cn-3', title: 'Computer Networks — Batch 3.0', subject: 'Networks', batch: '3.0', semester: '5', topic: 'OSI & TCP/IP', difficulty: 'Easy', marks: 50, timer: 20, questions: topicQuestions.Networks, status: 'Published', retry: true, leaderboard: true, color: '#ff7d91', date: 'Jul 10' },
  ...leetcodeQuizzes.map(q => ({ _id:q.id, ...q }))
];


const seedStudents = [
  { name: 'Aarav Mehta', email: 'aarav@uzonequiz.app', batch: '5.0', accuracy: 88, colors: ['#3b8eff', '#0d4baf'] },
  { name: 'Diya Sharma', email: 'diya@uzonequiz.app', batch: '5.0', accuracy: 86, colors: ['#a48fff', '#5840bd'] },
  { name: 'Kabir Singh', email: 'kabir@uzonequiz.app', batch: '4.0', accuracy: 82, colors: ['#42d8ad', '#168866'] },
  { name: 'Ananya Roy', email: 'ananya.roy@uzonequiz.app', batch: '5.0', accuracy: 84, colors: ['#ffad62', '#bd641d'] },
  { name: 'Ishaan Verma', email: 'ishaan@uzonequiz.app', batch: '3.0', accuracy: 77, colors: ['#ff7d91', '#b23551'] },
  { name: 'Meera Nair', email: 'meera@uzonequiz.app', batch: '4.0', accuracy: 84, colors: ['#55c9ff', '#126b9b'] },
];

/* Best java-5 attempt per student, mirroring the prototype leaderboard. */
const javaLeaderboard = [
  ['Diya Sharma', 48, 522], ['Aarav Mehta', 46, 551], ['Meera Nair', 44, 536],
  ['Pragati', 42, 624], ['Kabir Singh', 40, 588], ['Ananya Roy', 38, 662], ['Ishaan Verma', 36, 646],
];

/* Rewrites documents created by this project's earlier (Mongoose-based)
   backend into the current schema: quizzes with questions[].text/correctIndex,
   timerMinutes, lowercase status, etc. Originals are backed up first. */
async function migrateLegacy(db, log = () => {}) {
  const quizzes = db.collection('quizzes');
  const cap = (s) => typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '';
  const legacy = (await quizzes.find({}).toArray()).filter(q =>
    (Array.isArray(q.questions) && q.questions.some(x => x && (x.text !== undefined || x.correctIndex !== undefined))) ||
    typeof q.timerMinutes === 'number' || /^[a-z]/.test(q.status || '') || q.leaderboardEnabled !== undefined);
  for (const q of legacy) {
    await db.collection('quizzes_legacy_backup').updateOne({ _id: q._id }, { $set: q }, { upsert: true });
    const questions = (q.questions || []).map(x => ({
      id: String(x.id || x._id || uid()),
      question: String(x.question ?? x.text ?? ''),
      options: Array.isArray(x.options) ? x.options.map(String) : [],
      correct: Number.isInteger(x.correct) ? x.correct : Number(x.correctIndex) || 0,
      explanation: String(x.explanation || ''),
      solution: String(x.solution || ''),
      title: String(x.title || ''),
      marks: Number(x.marks) || 10,
    }));
    await quizzes.updateOne({ _id: q._id }, { $set: {
      title: q.title || 'Untitled quiz',
      subject: q.subject || 'General',
      batch: String(q.batch || '').replace(/^Batch\s+/i, '') || '5.0',
      semester: String(q.semester || '') || '1',
      topic: q.topic || '',
      difficulty: ['Easy', 'Medium', 'Hard'].includes(cap(q.difficulty)) ? cap(q.difficulty) : 'Medium',
      marks: Number(q.marks) || questions.reduce((s, x) => s + x.marks, 0) || 10,
      timer: Number(q.timer) || Number(q.timerMinutes) || 10,
      instructions: q.instructions || '',
      leaderboard: (q.leaderboard ?? q.leaderboardEnabled) !== false,
      retry: (q.retry ?? q.retryEnabled) !== false,
      shuffle: q.shuffle === true,
      explanations: q.explanations !== false,
      color: q.color || '#4d94ff',
      date: q.date || 'Earlier',
      status: ['Published', 'Draft', 'Scheduled'].includes(cap(q.status)) ? cap(q.status) : 'Draft',
      questions,
      ownerId: q.ownerId || q.teacherId || null,
      attempts: Number(q.attempts) || 0,
      accuracy: Number(q.accuracy) || 0,
      updatedAt: new Date(),
    }, $unset: { timerMinutes: '', leaderboardEnabled: '', retryEnabled: '', scheduledAt: '', teacherId: '', __v: '' } });
  }
  if (legacy.length) log(`Migrated ${legacy.length} legacy quiz(es) — originals kept in quizzes_legacy_backup`);

  for (const u of await db.collection('users').find({}).toArray()) {
    const set = {};
    if (typeof u.batch === 'string' && /^Batch\s+/i.test(u.batch)) set.batch = u.batch.replace(/^Batch\s+/i, '');
    if (!Array.isArray(u.bookmarks)) set.bookmarks = [];
    if (!Array.isArray(u.quizBookmarks)) set.quizBookmarks = [];
    if (Object.keys(set).length) await db.collection('users').updateOne({ _id: u._id }, { $set: set });
  }
  return legacy.length;
}

/* The demo accounts back both the login prefill and anonymous browsing, so
   they must exist even in a database that already has real data. */
async function ensureDemoUsers(db, log = () => {}) {
  const users = db.collection('users');
  const wanted = [
    { name: 'Pragati', email: 'teacher@uzonequiz.app', pass: 'teachpass', role: 'teacher', batch: '', colors: ['#4d94ff', '#17427e'] },
    { name: 'Pragati', email: 'demo@uzonequiz.app', pass: 'demopass', role: 'student', batch: '5.0', colors: ['#4d94ff', '#164a98'] },
  ];
  const created = [];
  for (const w of wanted) {
    if (await users.findOne({ email: w.email })) continue;
    const user = { _id: uid(), name: w.name, email: w.email, passHash: hashPassword(w.pass), role: w.role, batch: w.batch, isDemo: true, avatarColors: w.colors, bookmarks: [], quizBookmarks: [], createdAt: new Date() };
    await users.insertOne(user);
    created.push(user);
  }
  if (created.length) log(`Created demo account(s): ${created.map(u => u.email).join(', ')}`);
  return created;
}

async function seedIfEmpty(db, { force = false, log = () => {} } = {}) {
  const users = db.collection('users');
  if (force) {
    for (const c of ['users', 'quizzes', 'attempts', 'notifications']) await db.collection(c).deleteMany({});
    log('Cleared existing collections');
  }
  await migrateLegacy(db, log);
  if (await users.countDocuments() > 0) {
    await ensureDemoUsers(db, log);
    await users.createIndex({ email: 1 }, { unique: true }).catch(() => {});
    return false;
  }
  log('Empty database — seeding demo data...');

  const now = Date.now();
  const day = 86400000;
  const teacher = { _id: uid(), name: 'Pragati', email: 'teacher@uzonequiz.app', passHash: hashPassword('teachpass'), role: 'teacher', batch: '', isDemo: true, avatarColors: ['#4d94ff', '#17427e'], bookmarks: [], quizBookmarks: [], createdAt: new Date(now - 30 * day) };
  const demoStudent = { _id: uid(), name: 'Pragati', email: 'demo@uzonequiz.app', passHash: hashPassword('demopass'), role: 'student', batch: '5.0', isDemo: true, avatarColors: ['#4d94ff', '#164a98'], bookmarks: ['java-q3'], quizBookmarks: [], createdAt: new Date(now - 28 * day) };
  const studentDocs = seedStudents.map(s => ({
    _id: uid(), name: s.name, email: s.email, passHash: hashPassword('student123'), role: 'student',
    batch: s.batch, isDemo: false, avatarColors: s.colors, bookmarks: [], quizBookmarks: [], createdAt: new Date(now - 25 * day),
    targetAccuracy: s.accuracy,
  }));
  await users.insertMany([teacher, demoStudent, ...studentDocs]);
  await users.createIndex({ email: 1 }, { unique: true }).catch(() => {});

  // createdAt is staggered so `sort createdAt desc` reproduces the original
  // card order, with quizzes created later in the app appearing first.
  const quizzes = defaultQuizzes.map((q, i) => ({ ...q, instructions: 'Read each question carefully. Select the best answer before the timer ends.', shuffle: false, explanations: true, ownerId: teacher._id, attempts: 0, accuracy: 0, createdAt: new Date(now - 20 * day - i * 3600000), updatedAt: new Date(now - day) }));
  await db.collection('quizzes').insertMany(quizzes);

  // Attempts: java-5 leaderboard rows + a spread across other published quizzes
  // so the students table, analytics, and charts have real aggregates behind them.
  const byName = new Map([demoStudent, ...studentDocs].map(u => [u.name, u]));
  const attempts = [];
  for (const [name, score, seconds] of javaLeaderboard) {
    const u = byName.get(name);
    const quiz = quizzes[0];
    const correct = Math.min(quiz.questions.length, Math.round((score / 50) * quiz.questions.length));
    attempts.push({ _id: uid(), quizId: quiz._id, userId: u._id, userName: u.name, batch: u.batch, answers: {}, score, total: quiz.marks, correct, totalQuestions: quiz.questions.length, timeTakenSec: seconds, auto: false, createdAt: new Date(now - 2 * day + attempts.length * 60000) });
  }
  const others = quizzes.filter(q => q.status === 'Published' && q._id !== 'java-5');
  studentDocs.forEach((u, ui) => {
    others.forEach((quiz, qi) => {
      for (let i = 0; i < 2; i++) {
        const acc = Math.min(100, Math.max(30, u.targetAccuracy + ((ui + qi + i) % 3 - 1) * 6));
        const correct = Math.round((acc / 100) * quiz.questions.length);
        const perQ = quiz.marks / quiz.questions.length;
        attempts.push({ _id: uid(), quizId: quiz._id, userId: u._id, userName: u.name, batch: u.batch, answers: {}, score: Math.round(correct * perQ), total: quiz.marks, correct, totalQuestions: quiz.questions.length, timeTakenSec: 300 + ((ui * 97 + qi * 53 + i * 31) % 500), auto: false, createdAt: new Date(now - (3 + qi + i * 2) * day + ui * 3600000) });
      }
    });
  });
  await db.collection('attempts').insertMany(attempts);

  // Denormalized quiz counters used by the teacher cards.
  for (const quiz of quizzes) {
    const mine = attempts.filter(a => a.quizId === quiz._id);
    const accuracy = mine.length ? Math.round(mine.reduce((s, a) => s + a.correct / a.totalQuestions, 0) / mine.length * 100) : 0;
    await db.collection('quizzes').updateOne({ _id: quiz._id }, { $set: { attempts: mine.length, accuracy } });
  }

  const notifs = [
    { userId: demoStudent._id, icon: 'sparkles', title: 'New quiz published', body: 'Java Quiz — Batch 5.0 is ready to attempt.', read: false, createdAt: new Date(now - 2 * 60000) },
    { userId: demoStudent._id, icon: 'clock-3', title: 'Quiz reminder', body: 'Your scheduled DBMS quiz begins tomorrow at 9:00 AM.', read: false, createdAt: new Date(now - 3600000) },
    { userId: demoStudent._id, icon: 'trophy', title: 'You moved up 3 places', body: 'Your latest Java score puts you at rank #4.', read: true, createdAt: new Date(now - day) },
    { userId: demoStudent._id, icon: 'message-square-more', title: 'New teacher explanation', body: 'An explanation was added to a bookmarked DSA question.', read: true, createdAt: new Date(now - 2 * day) },
    { userId: teacher._id, icon: 'user-check', title: 'Aarav completed Java Quiz', body: 'Scored 46/50 · Batch 5.0', read: false, createdAt: new Date(now - 2 * 60000) },
    { userId: teacher._id, icon: 'send', title: 'DSA Sprint was published', body: '196 students notified', read: false, createdAt: new Date(now - 18 * 60000) },
  ];
  await db.collection('notifications').insertMany(notifs.map(n => ({ _id: uid(), ...n })));

  log(`Seeded ${2 + studentDocs.length} users, ${quizzes.length} quizzes, ${attempts.length} attempts`);
  return true;
}

module.exports = { seedIfEmpty, migrateLegacy, ensureDemoUsers, sampleQuestions };

if (require.main === module) {
  const { MongoClient } = require('./lib/mongo');
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/uzonequiz';
  const client = new MongoClient(uri);
  client.connect()
    .then(() => seedIfEmpty(client.db(), { force: process.argv.includes('--force'), log: console.log }))
    .then((seeded) => { console.log(seeded ? 'Seed complete.' : 'Database already has data — nothing to do (use --force to reseed).'); return client.close(); })
    .then(() => process.exit(0))
    .catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
}
