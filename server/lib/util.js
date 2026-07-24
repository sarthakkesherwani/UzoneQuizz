'use strict';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

const fmtTime = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.round(sec) % 60).padStart(2, '0')}`;

const isStr = (v, max = 2000) => typeof v === 'string' && v.length <= max;
const reqStr = (v, max = 2000) => isStr(v, max) && v.trim().length > 0;
const isEmail = (v) => isStr(v, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const numIn = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/* Validates and normalizes a quiz payload from the client. Returns [error, quiz]. */
function validateQuiz(body) {
  if (!reqStr(body.title, 160)) return ['Quiz title is required'];
  if (!isStr(body.subject, 60) || !isStr(body.topic, 160)) return ['Invalid subject or topic'];
  if (!['Easy', 'Medium', 'Hard'].includes(body.difficulty)) return ['Invalid difficulty'];
  if (!numIn(Number(body.marks), 1, 10000)) return ['Invalid total marks'];
  if (!numIn(Number(body.timer), 1, 600)) return ['Invalid timer'];
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 200) return ['A quiz needs 1–200 questions'];
  const questions = [];
  for (const q of body.questions) {
    if (!isStr(q.question, 2000)) return ['Invalid question text'];
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6 || !q.options.every(o => isStr(o, 500))) return ['Each question needs 2–6 text options'];
    const correct = Number(q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct >= q.options.length) return ['Invalid correct option index'];
    if (!numIn(Number(q.marks), 0, 1000)) return ['Invalid question marks'];
    questions.push({
      id: isStr(q.id, 40) && q.id ? q.id : uid(),
      question: String(q.question),
      options: q.options.map(String),
      correct,
      explanation: isStr(q.explanation, 4000) ? String(q.explanation) : '',
      solution: isStr(q.solution, 12000) ? String(q.solution) : '',
      title: isStr(q.title, 200) ? String(q.title) : '',
      marks: Number(q.marks),
    });
  }
  const status = ['Draft', 'Published', 'Scheduled'].includes(body.status) ? body.status : 'Draft';
  return [null, {
    title: body.title.trim(),
    subject: isStr(body.subject) && body.subject.trim() ? body.subject.trim() : 'General',
    batch: isStr(body.batch, 20) && body.batch ? String(body.batch) : '5.0',
    semester: isStr(body.semester, 4) && body.semester ? String(body.semester) : '1',
    topic: String(body.topic || '').trim(),
    difficulty: body.difficulty,
    marks: Number(body.marks),
    timer: Number(body.timer),
    instructions: isStr(body.instructions, 4000) ? String(body.instructions) : '',
    leaderboard: body.leaderboard !== false,
    retry: body.retry !== false,
    shuffle: body.shuffle === true,
    explanations: body.explanations !== false,
    color: isStr(body.color, 24) && /^#[0-9a-fA-F]{3,8}$/.test(body.color) ? body.color : '#4d94ff',
    date: isStr(body.date, 60) && body.date ? String(body.date) : 'Just now',
    status,
    questions,
  }];
}

module.exports = { uid, pick, fmtTime, isStr, reqStr, isEmail, numIn, validateQuiz };
