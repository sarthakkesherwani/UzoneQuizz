'use strict';

const { hashPassword, verifyPassword, signToken } = require('../lib/auth');
const { verify: bcryptVerify, isBcryptHash } = require('../lib/bcrypt');
const { HttpError, sendJson } = require('../lib/httpx');
const { uid, isEmail, reqStr } = require('../lib/util');

/* New registrations are students by default. The browser must never be able
   to grant teacher access by submitting a role field. Teacher accounts can be
   provisioned only through server-owned configuration. */
function canRegisterAsTeacher(email, teacherInviteCode) {
  const approvedEmails = String(process.env.TEACHER_EMAIL_WHITELIST || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const inviteHash = process.env.TEACHER_INVITE_CODE_HASH;

  return approvedEmails.includes(email)
    || !!(teacherInviteCode && inviteHash && bcryptVerify(String(teacherInviteCode), inviteHash));
}

const publicUser = (u) => u && ({
  id: u._id, name: u.name, email: u.email, role: u.role, batch: u.batch || '',
  isDemo: !!u.isDemo, avatarColors: u.avatarColors || ['#4d94ff', '#164a98'],
  bookmarks: u.bookmarks || [], quizBookmarks: u.quizBookmarks || [],
});

/* Resolves the authenticated identity. Unauthenticated requests are guests. */
async function resolveUser(req, db, cfg, verifyToken) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const users = db.collection('users');
  if (token) {
    const payload = verifyToken(token, cfg.jwtSecret);
    if (payload && payload.uid) {
      const user = await users.findOne({ _id: payload.uid });
      const sessionVersion = Number(user && user.sessionVersion) || 0;
      if (user && Number(payload.sv || 0) === sessionVersion) {
        const actingRole = user.isDemo
          ? (payload.role === 'teacher' ? 'teacher' : 'student')
          : user.role;
        return { user, actingRole, authed: true };
      }
    }
  }
  const actingRole = req.headers['x-role'] === 'teacher' ? 'teacher' : 'student';
  return { user: null, actingRole, authed: false };
}

function registerAuthRoutes(router, { db, cfg, verifyToken: verify }) {
  const users = () => db.collection('users');

  const issue = (user, actingRole) => ({
    token: signToken({
      uid: user._id,
      role: actingRole,
      name: user.name,
      sv: Number(user.sessionVersion) || 0,
    }, cfg.jwtSecret),
    user: { ...publicUser(user), role: actingRole },
  });

  router.post('/api/auth/register', async (ctx) => {
    const { name, email, password, teacherInviteCode } = ctx.body;
    if (!reqStr(name, 80)) throw new HttpError(400, 'Please enter your full name');
    if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address');
    if (!reqStr(password, 128) || String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await users().findOne({ email: normalizedEmail });
    if (existing) throw new HttpError(409, 'An account with this email already exists');
    const role = canRegisterAsTeacher(normalizedEmail, teacherInviteCode) ? 'teacher' : 'student';
    const user = {
      _id: uid(), name: String(name).trim(), email: normalizedEmail,
      passHash: hashPassword(password), role, batch: '5.0', isDemo: false,
      avatarColors: ['#4d94ff', '#164a98'], bookmarks: [], quizBookmarks: [], createdAt: new Date(),
    };
    await users().insertOne(user);
    sendJson(ctx.res, 201, issue(user, role));
  });

  router.post('/api/auth/login', async (ctx) => {
    const { email, password, role } = ctx.body;
    if (!isEmail(email) || !reqStr(password, 128)) throw new HttpError(400, 'Enter your email and password');
    const user = await users().findOne({ email: String(email).toLowerCase() });
    let ok = false;
    if (user && user.passHash) {
      ok = verifyPassword(password, user.passHash);
    } else if (user && isBcryptHash(user.passwordHash)) {
      // Account from the project's earlier backend — verify its bcrypt hash,
      // then migrate to the current scrypt format for future logins.
      ok = bcryptVerify(password, user.passwordHash);
      if (ok) await users().updateOne({ _id: user._id }, { $set: { passHash: hashPassword(password) } });
    }
    if (!ok) throw new HttpError(401, 'Incorrect email or password');
    const wantedRole = role === 'teacher' ? 'teacher' : 'student';
    // Demo accounts may act in either role (the UI has a role switcher);
    // real accounts keep the role they registered with.
    const actingRole = user.isDemo ? wantedRole : user.role;
    sendJson(ctx.res, 200, issue(user, actingRole));
  });

  router.post('/api/auth/role', async (ctx) => {
    const wantedRole = ctx.body.role === 'teacher' ? 'teacher' : 'student';
    if (!ctx.authed) throw new HttpError(401, 'Authentication required');
    const actingRole = ctx.user.role;
    sendJson(ctx.res, 200, issue(ctx.user, actingRole));
  });

  router.post('/api/auth/logout', async (ctx) => {
    if (!ctx.authed) throw new HttpError(401, 'Authentication required');
    const nextVersion = (Number(ctx.user.sessionVersion) || 0) + 1;
    await users().updateOne(
      { _id: ctx.user._id },
      { $set: { sessionVersion: nextVersion, loggedOutAt: new Date() } },
    );
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get('/api/auth/me', async (ctx) => {
    sendJson(ctx.res, 200, { user: { ...publicUser(ctx.user), role: ctx.actingRole }, authed: ctx.authed });
  });
}

module.exports = { registerAuthRoutes, resolveUser, publicUser };
