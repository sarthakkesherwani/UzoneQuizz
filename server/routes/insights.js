/* Aggregated views: students table, analytics, notifications, bookmarks,
   and the one-shot /api/bootstrap payload the frontend loads on boot. */
'use strict';

const { HttpError, sendJson } = require('../lib/httpx');
const { fmtTime } = require('../lib/util');
const { buildLeaderboard, toQuiz } = require('./content');
const { publicUser } = require('./auth');

const requireTeacher = (ctx) => {
  if (ctx.actingRole !== 'teacher') throw new HttpError(403, 'Teacher access required');
};

function timeAgo(date) {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const d = Math.floor(hr / 24);
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

async function buildStudentsTable(db) {
  const users = await db.collection('users').find({ role: 'student' }).toArray();
  const attempts = await db.collection('attempts')
    .find({})
    .toArray();
  const byUser = new Map();
  for (const a of attempts) {
    if (!byUser.has(a.userId)) byUser.set(a.userId, []);
    byUser.get(a.userId).push(a);
  }
  return users.map(u => {
    const mine = byUser.get(u._id) || [];
    const scored = mine.reduce((s, a) => s + a.score, 0);
    const possible = mine.reduce((s, a) => s + a.total, 0);
    const accuracy = mine.length ? Math.round(mine.reduce((s, a) => s + (a.totalQuestions ? a.correct / a.totalQuestions : 0), 0) / mine.length * 100) : 0;
    return {
      name: u.name, batch: u.batch || '—', attempts: mine.length,
      score: `${scored} / ${possible}`, accuracy,
      status: mine.length === 0 || accuracy < 80 ? 'At risk' : 'Active',
      color: u.avatarColors || ['#4d94ff', '#164a98'],
    };
  }).sort((a, b) => b.accuracy - a.accuracy);
}

async function buildAnalytics(db) {
  const quizzes = await db.collection('quizzes').find({}).toArray();
  const attempts = await db.collection('attempts').find({}).toArray();
  const scorePct = (a) => a.total ? a.score / a.total * 100 : 0;
  const avgScore = attempts.length ? attempts.reduce((s, a) => s + scorePct(a), 0) / attempts.length : 0;
  const accuracy = attempts.length ? attempts.reduce((s, a) => s + (a.totalQuestions ? a.correct / a.totalQuestions * 100 : 0), 0) / attempts.length : 0;
  const avgTimeSec = attempts.length ? attempts.reduce((s, a) => s + a.timeTakenSec, 0) / attempts.length : 0;
  const completion = attempts.length ? attempts.filter(a => !a.auto).length / attempts.length * 100 : 0;

  const quizAccuracy = quizzes
    .filter(q => (q.attempts || 0) > 0)
    .sort((a, b) => (b.attempts || 0) - (a.attempts || 0))
    .slice(0, 6)
    .map(q => [`${q.subject} ${q.batch}`, q.accuracy || 0]);

  const bySubject = new Map();
  for (const a of attempts) {
    const quiz = quizzes.find(q => q._id === a.quizId);
    const key = quiz ? quiz.subject : 'Other';
    bySubject.set(key, (bySubject.get(key) || 0) + 1);
  }
  const subjectDist = [...bySubject.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([label, count]) => ({ label, pct: Math.round(count / Math.max(1, attempts.length) * 100) }));

  // Per-question wrong rate — only meaningful for attempts with answer maps.
  const wrong = new Map();
  for (const a of attempts) {
    if (!a.answers || !Object.keys(a.answers).length) continue;
    const quiz = quizzes.find(q => q._id === a.quizId);
    if (!quiz) continue;
    for (const q of quiz.questions) {
      const stat = wrong.get(q.id) || { text: q.question, wrong: 0, total: 0 };
      stat.total += 1;
      if (Number(a.answers[q.id]) !== q.correct) stat.wrong += 1;
      wrong.set(q.id, stat);
    }
  }
  const hardestQuestions = [...wrong.values()]
    .filter(s => s.total >= 1)
    .map(s => ({ text: s.text, pctWrong: Math.round(s.wrong / s.total * 100) }))
    .sort((a, b) => b.pctWrong - a.pctWrong)
    .slice(0, 4);

  return {
    totalQuizzes: quizzes.length,
    totalAttempts: attempts.length,
    avgScorePct: Math.round(avgScore * 10) / 10,
    accuracyPct: Math.round(accuracy * 10) / 10,
    completionPct: Math.round(completion * 10) / 10,
    avgTime: fmtTime(avgTimeSec).replace(':', 'm ') + 's',
    quizAccuracy, subjectDist, hardestQuestions,
  };
}

async function buildStudentStats(db, userId) {
  const mine = await db.collection('attempts')
  .find({ userId })
  .toArray();
  const completed = mine.length;
  const avg = completed ? Math.round(mine.reduce((s, a) => s + (a.total ? a.score / a.total * 100 : 0), 0) / completed) : 0;
  const hours = mine.reduce((s, a) => s + a.timeTakenSec, 0) / 3600;
  return { completed, avgScorePct: avg, learningHours: Math.round(hours * 10) / 10 };
}

function registerInsightRoutes(router, { db }) {
  router.get('/api/students', async (ctx) => {
    requireTeacher(ctx);
    sendJson(ctx.res, 200, { students: await buildStudentsTable(db) });
  });

  router.get('/api/analytics', async (ctx) => {
    requireTeacher(ctx);
    sendJson(ctx.res, 200, { analytics: await buildAnalytics(db) });
  });

  router.get('/api/notifications', async (ctx) => {
    if (!ctx.user) { sendJson(ctx.res, 200, { notifications: [] }); return; }
    const docs = await db.collection('notifications')
  .find({ userId: ctx.user._id })
  .sort({ createdAt: -1 })
  .limit(30)
  .toArray();
    sendJson(ctx.res, 200, {
      notifications: docs.map(n => ({ icon: n.icon, title: n.title, body: n.body, time: timeAgo(n.createdAt), unread: !n.read })),
    });
  });

  router.post('/api/notifications/read-all', async (ctx) => {
    if (ctx.user) await db.collection('notifications').updateMany({ userId: ctx.user._id, read: false }, { $set: { read: true } });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.put('/api/me/bookmarks', async (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Sign in to sync bookmarks');
    const clean = (arr) => Array.isArray(arr) ? [...new Set(arr.filter(v => typeof v === 'string' && v.length <= 40))].slice(0, 500) : undefined;
    const set = {};
    const bookmarks = clean(ctx.body.bookmarks);
    const quizBookmarks = clean(ctx.body.quizBookmarks);
    if (bookmarks) set.bookmarks = bookmarks;
    if (quizBookmarks) set.quizBookmarks = quizBookmarks;
    if (Object.keys(set).length) await db.collection('users').updateOne({ _id: ctx.user._id }, { $set: set });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get('/api/bootstrap', async (ctx) => {
    const role = ctx.actingRole;
    const quizzes = await db.collection('quizzes')
  .find(role === 'teacher' ? {} : { status: 'Published' })
  .sort({ createdAt: -1 })
  .toArray();
    const notifications = ctx.user
  ? await db.collection('notifications')
      .find({ userId: ctx.user._id })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray()
  : [];
    const payload = {
      online: true, authed: ctx.authed, role,
      user: ctx.user ? { ...publicUser(ctx.user), role } : null,
      quizzes: quizzes.map(toQuiz),
      bookmarks: ctx.user?.bookmarks || [],
      quizBookmarks: ctx.user?.quizBookmarks || [],
      notifications: notifications.map(n => ({ icon: n.icon, title: n.title, body: n.body, time: timeAgo(n.createdAt), unread: !n.read })),
      leaderboard: [],
    };
    const boardQuiz = quizzes.filter(q => q.status === 'Published' && q.leaderboard).sort((a, b) => (b.attempts || 0) - (a.attempts || 0))[0];
    if (boardQuiz) payload.leaderboard = await buildLeaderboard(db, boardQuiz._id, ctx.user?._id);
    if (role === 'teacher') {
      payload.students = await buildStudentsTable(db);
      payload.analytics = await buildAnalytics(db);
      payload.stats = {
        totalQuizzes: quizzes.length,
        totalStudents: await db.collection('users').countDocuments({ role: 'student' }),
        totalAttempts: payload.analytics.totalAttempts,
        avgScorePct: payload.analytics.avgScorePct,
      };
    } else {
      payload.stats = await buildStudentStats(db, ctx.user?._id);
      const rank = payload.leaderboard.findIndex(r => r.me) + 1;
      payload.stats.rank = rank || null;
    }
    sendJson(ctx.res, 200, payload);
  });
}

module.exports = { registerInsightRoutes, buildStudentsTable, buildAnalytics };
