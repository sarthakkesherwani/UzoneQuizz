/* Quizzes CRUD, attempt submission with server-side scoring, and leaderboards. */
'use strict';

const { HttpError, sendJson } = require('../lib/httpx');
const { uid, fmtTime, validateQuiz } = require('../lib/util');

const toQuiz = (doc) => {
  if (!doc) return null;
  const { _id, ownerId, createdAt, updatedAt, ...rest } = doc;
  return { id: _id, ...rest };
};

const requireTeacher = (ctx) => {
  if (!ctx.authed || !ctx.user || ctx.user.role !== 'teacher') {
    throw new HttpError(403, 'Teacher access required');
  }
};

/* Best attempt per user for a quiz, ranked by marks then completion time. */
async function buildLeaderboard(db, quizId, meUserId) {
  const attempts = await db.collection('attempts')
  .find({ quizId })
  .toArray();
  const best = new Map();
  for (const a of attempts) {
    const prev = best.get(a.userId);
    if (!prev || a.score > prev.score || (a.score === prev.score && a.timeTakenSec < prev.timeTakenSec)) best.set(a.userId, a);
  }
  return [...best.values()]
    .sort((x, y) => y.score - x.score || x.timeTakenSec - y.timeTakenSec)
    .map(a => ({ name: a.userName, marks: a.score, time: fmtTime(a.timeTakenSec), batch: a.batch || '—', me: a.userId === meUserId }));
}

async function refreshQuizCounters(db, quizId) {
  const attempts = await db.collection('attempts')
  .find({ quizId })
  .toArray();
  const accuracy = attempts.length
    ? Math.round(attempts.reduce((s, a) => s + (a.totalQuestions ? a.correct / a.totalQuestions : 0), 0) / attempts.length * 100)
    : 0;
  await db.collection('quizzes').updateOne({ _id: quizId }, { $set: { attempts: attempts.length, accuracy } });
  return { attempts: attempts.length, accuracy };
}

async function notifyStudents(db, { icon, title, body }) {
  const students = await db.collection('users').find({ role: 'student' }, { projection: { _id: 1 } });
  if (!students.length) return;
  await db.collection('notifications').insertMany(students.map(s => ({
    _id: uid(), userId: s._id, icon, title, body, read: false, createdAt: new Date(),
  })));
}

function registerContentRoutes(router, { db }) {
  router.get('/api/quizzes', async (ctx) => {
    const filter = ctx.actingRole === 'teacher' ? {} : { status: 'Published' };
    const docs = await db.collection('quizzes').find(filter, { sort: { createdAt: -1 } });
    sendJson(ctx.res, 200, { quizzes: docs.map(toQuiz) });
  });

  router.get('/api/quizzes/:id', async (ctx) => {
    const doc = await db.collection('quizzes').findOne({ _id: ctx.params.id });
    if (!doc) throw new HttpError(404, 'Quiz not found');
    if (ctx.actingRole !== 'teacher' && doc.status !== 'Published') throw new HttpError(403, 'This quiz is not published');
    sendJson(ctx.res, 200, { quiz: toQuiz(doc) });
  });

  // Upsert: the builder saves drafts and published quizzes through one path.
  const saveQuiz = async (ctx) => {
    requireTeacher(ctx);
    const [err, quiz] = validateQuiz(ctx.body);
    if (err) throw new HttpError(400, err);
    const id = typeof ctx.body.id === 'string' && /^[\w-]{1,40}$/.test(ctx.body.id) ? ctx.body.id : (ctx.params.id || uid());
    const quizzes = db.collection('quizzes');
    const existing = await quizzes.findOne({ _id: id });
    const wasPublished = existing?.status === 'Published';
    if (existing) {
      await quizzes.updateOne({ _id: id }, { $set: { ...quiz, updatedAt: new Date() } });
    } else {
      await quizzes.insertOne({ _id: id, ...quiz, ownerId: ctx.user?._id ?? null, attempts: 0, accuracy: 0, createdAt: new Date(), updatedAt: new Date() });
    }
    if (quiz.status === 'Published' && !wasPublished) {
      await notifyStudents(db, { icon: 'sparkles', title: 'New quiz published', body: `${quiz.title} is ready to attempt.` });
    } else if (quiz.status === 'Scheduled') {
      await notifyStudents(db, { icon: 'clock-3', title: 'Quiz scheduled', body: `${quiz.title} opens ${quiz.date}.` });
    }
    const saved = await quizzes.findOne({ _id: id });
    sendJson(ctx.res, existing ? 200 : 201, { quiz: toQuiz(saved) });
  };
  router.post('/api/quizzes', saveQuiz);
  router.put('/api/quizzes/:id', saveQuiz);

  router.delete('/api/quizzes/:id', async (ctx) => {
    requireTeacher(ctx);
    const { deletedCount } = await db.collection('quizzes').deleteOne({ _id: ctx.params.id });
    if (!deletedCount) throw new HttpError(404, 'Quiz not found');
    // Attempts are kept intentionally: analytics still reference past results.
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post('/api/attempts', async (ctx) => {
    const { quizId, answers, timeTakenSec, auto, bookmarked } = ctx.body;
    const quiz = await db.collection('quizzes').findOne({ _id: String(quizId || '') });
    if (!quiz) throw new HttpError(404, 'Quiz not found');
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, 'Invalid answers');
    if (!ctx.user) throw new HttpError(401, 'Sign in to submit attempts');

    let correct = 0, score = 0;
    for (const q of quiz.questions) {
      if (Number(answers[q.id]) === q.correct) { correct += 1; score += Number(q.marks) || 0; }
    }
    const attempt = {
      _id: uid(), quizId: quiz._id, userId: ctx.user._id, userName: ctx.user.name,
      batch: ctx.user.batch || '', answers: Object.fromEntries(Object.entries(answers).slice(0, 500).map(([k, v]) => [String(k).slice(0, 40), Number(v)])),
      score, total: quiz.marks, correct, totalQuestions: quiz.questions.length,
      timeTakenSec: Math.max(1, Math.min(Number(timeTakenSec) || 1, quiz.timer * 60 * 2)),
      auto: auto === true, createdAt: new Date(),
    };
    await db.collection('attempts').insertOne(attempt);
    await refreshQuizCounters(db, quiz._id);

    if (Array.isArray(bookmarked) && bookmarked.length) {
      const clean = bookmarked.filter(b => typeof b === 'string' && b.length <= 40).slice(0, 100);
      const merged = [...new Set([...(ctx.user.bookmarks || []), ...clean])];
      await db.collection('users').updateOne({ _id: ctx.user._id }, { $set: { bookmarks: merged } });
    }

    const board = await buildLeaderboard(db, quiz._id, ctx.user._id);
    const rank = board.findIndex(r => r.me) + 1;
    sendJson(ctx.res, 201, {
      score, correct, total: quiz.marks, totalQuestions: quiz.questions.length,
      accuracyPct: Math.round(correct / quiz.questions.length * 100),
      rank: rank || null, leaderboard: board,
    });
  });

  router.get('/api/attempts/mine', async (ctx) => {
    if (!ctx.user) { sendJson(ctx.res, 200, { attempts: [] }); return; }
    const docs = await db.collection('attempts').find({ userId: ctx.user._id }, { sort: { createdAt: -1 }, limit: 20 });
    sendJson(ctx.res, 200, {
      attempts: docs.map(a => ({ quizId: a.quizId, score: a.score, total: a.total, correct: a.correct, totalQuestions: a.totalQuestions, time: fmtTime(a.timeTakenSec), when: a.createdAt })),
    });
  });

  router.get('/api/leaderboard', async (ctx) => {
    let quizId = ctx.query.quizId;
    if (!quizId) {
      const published = await db.collection('quizzes').find({ status: 'Published', leaderboard: true });
      published.sort((a, b) => (b.attempts || 0) - (a.attempts || 0));
      quizId = published[0]?._id;
    }
    const entries = quizId ? await buildLeaderboard(db, quizId, ctx.user?._id) : [];
    sendJson(ctx.res, 200, { quizId: quizId || null, entries });
  });
}

module.exports = { registerContentRoutes, buildLeaderboard, toQuiz };
