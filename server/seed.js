'use strict';

const { MongoClient } = require('mongodb');
const { uid } = require('./lib/util');

/*
 * UzoneQuiz intentionally starts without demo accounts or sample attempts.
 * Setup keeps the unique email index in place and upgrades any data left
 * behind by the project's earlier backend, so every user shown in the app
 * comes from an account created in the target database.
 */

const LEGACY_QUIZ_FIELDS = ['timerMinutes', 'leaderboardEnabled', 'retryEnabled', 'scheduledAt', 'teacherId', '__v'];

const isLegacyQuiz = (doc) =>
  doc.timerMinutes !== undefined ||
  (Array.isArray(doc.questions) && doc.questions.some(q => q && (q.correctIndex !== undefined || q.text !== undefined)));

const capitalize = (value) => {
  const s = String(value || '').trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '';
};

/* Rewrites quizzes/users written by the old backend into the current schema.
   Originals are backed up to quizzes_legacy_backup. Returns the number of
   quizzes migrated; a second run is a no-op. */
async function migrateLegacy(db) {
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true }).catch(() => {});

  for (const u of await users.find({}).toArray()) {
    const set = {};
    if (typeof u.batch === 'string' && /^batch\s+/i.test(u.batch)) set.batch = u.batch.replace(/^batch\s+/i, '');
    if (!Array.isArray(u.bookmarks)) set.bookmarks = [];
    if (!Array.isArray(u.quizBookmarks)) set.quizBookmarks = [];
    if (Object.keys(set).length) await users.updateOne({ _id: u._id }, { $set: set });
  }

  const quizzes = db.collection('quizzes');
  const backup = db.collection('quizzes_legacy_backup');
  let migrated = 0;
  for (const doc of await quizzes.find({}).toArray()) {
    if (!isLegacyQuiz(doc)) continue;
    await backup.insertOne({ ...doc });
    const questions = (doc.questions || []).map(q => ({
      id: q._id != null ? String(q._id) : (q.id != null ? String(q.id) : uid()),
      question: String(q.text ?? q.question ?? ''),
      options: (q.options || []).map(String),
      correct: Number(q.correctIndex ?? q.correct) || 0,
      explanation: String(q.explanation || ''),
      solution: String(q.solution || ''),
      title: String(q.title || ''),
      marks: Number(q.marks) || 0,
    }));
    const marks = questions.reduce((sum, q) => sum + q.marks, 0);
    const set = {
      title: String(doc.title || 'Untitled'),
      subject: String(doc.subject || 'General'),
      batch: String(doc.batch || '5.0'),
      semester: String(doc.semester || '1'),
      topic: String(doc.topic || ''),
      difficulty: ['easy', 'medium', 'hard'].includes(String(doc.difficulty).toLowerCase()) ? capitalize(doc.difficulty) : 'Medium',
      marks: marks || Number(doc.marks) || 0,
      timer: Number(doc.timerMinutes ?? doc.timer) || 10,
      instructions: String(doc.instructions || ''),
      leaderboard: doc.leaderboardEnabled !== undefined ? !!doc.leaderboardEnabled : doc.leaderboard !== false,
      retry: doc.retryEnabled !== undefined ? !!doc.retryEnabled : doc.retry !== false,
      shuffle: !!doc.shuffle,
      explanations: doc.explanations !== false,
      color: typeof doc.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(doc.color) ? doc.color : '#4d94ff',
      date: typeof doc.date === 'string' && doc.date ? doc.date : 'Just now',
      status: ['published', 'draft', 'scheduled'].includes(String(doc.status).toLowerCase()) ? capitalize(doc.status) : 'Draft',
      questions,
      ownerId: doc.teacherId ?? doc.ownerId ?? null,
      attempts: Number(doc.attempts) || 0,
      accuracy: Number(doc.accuracy) || 0,
      createdAt: doc.createdAt || new Date(),
      updatedAt: new Date(),
    };
    const unset = {};
    for (const key of LEGACY_QUIZ_FIELDS) if (key in doc) unset[key] = '';
    const update = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    await quizzes.updateOne({ _id: doc._id }, update);
    migrated += 1;
  }
  return migrated;
}

async function seedIfEmpty(db, { log = () => {} } = {}) {
  const migrated = await migrateLegacy(db);
  if (migrated) log(`Migrated ${migrated} legacy ${migrated === 1 ? 'quiz' : 'quizzes'} to the current schema.`);
  log('No demo users or sample attempts were created.');
  return false;
}

module.exports = { seedIfEmpty, migrateLegacy };

if (require.main === module) {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/uzonequiz';
  const client = new MongoClient(uri);
  client.connect()
    .then(() => seedIfEmpty(client.db(), { log: console.log }))
    .then(() => client.close())
    .catch((err) => { console.error('Setup failed:', err.message); process.exit(1); });
}
