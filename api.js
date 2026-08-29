/* UzoneQuiz data layer — talks to the Node/MongoDB backend (/api).
   Purely additive: app.js renders exactly as before; this module only supplies
   real data. When the page is opened without the server (e.g. file://), every
   call resolves harmlessly and the app falls back to its local demo state. */
(() => {
  'use strict';

  const TOKEN_KEY = 'uzonequiz-token';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let roleHint = 'student';
  let online = false;

  const hasServer = location.protocol.startsWith('http');

  async function req(method, path, body) {
    if (!hasServer) throw new Error('offline');
    const headers = { 'X-Role': roleHint };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    online = true;
    return data;
  }

  const quiet = (promise) => promise.catch(() => null);

  function setToken(next) {
    token = next || '';
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  window.UzoneAPI = {
    online: () => online,
    hasServer: () => hasServer,
    authed: () => !!token,
    setRoleHint(role) { roleHint = role === 'teacher' ? 'teacher' : 'student'; },

    bootstrap() { return quiet(req('GET', '/api/bootstrap')); },

    async login(email, password, role) {
      const data = await req('POST', '/api/auth/login', { email, password, role });
      setToken(data.token);
      return data;
    },
    async register(name, email, password, role) {
      const data = await req('POST', '/api/auth/register', { name, email, password, role });
      setToken(data.token);
      return data;
    },
    async logout() {
      try {
        if (token) await req('POST', '/api/auth/logout', {});
      } finally {
        setToken('');
      }
    },
    async switchRole(role) {
      this.setRoleHint(role);
      if (!token) return null;
      const data = await quiet(req('POST', '/api/auth/role', { role }));
      if (data && data.token) setToken(data.token);
      return data;
    },

    saveQuiz(quiz) { return quiet(req('POST', '/api/quizzes', quiz)); },
    deleteQuiz(id) { return quiet(req('DELETE', `/api/quizzes/${encodeURIComponent(id)}`)); },

    submitAttempt(payload) { return quiet(req('POST', '/api/attempts', payload)); },
    myAttempts() { return quiet(req('GET', '/api/attempts/mine')); },
    leaderboard(quizId) {
      const qs = quizId ? `?quizId=${encodeURIComponent(quizId)}` : '';
      return quiet(req('GET', `/api/leaderboard${qs}`));
    },
    students() { return quiet(req('GET', '/api/students')); },
    analytics() { return quiet(req('GET', '/api/analytics')); },
    notifications() { return quiet(req('GET', '/api/notifications')); },
    markNotificationsRead() { return quiet(req('POST', '/api/notifications/read-all', {})); },
    syncBookmarks(bookmarks, quizBookmarks) {
      return quiet(req('PUT', '/api/me/bookmarks', { bookmarks, quizBookmarks }));
    },
  };
})();
