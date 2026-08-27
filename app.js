/* UzoneQuiz interactive product prototype */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const initials = (name) => name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
  const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const bank = window.UzoneQuestionBank || { topicQuestions: {}, leetcodeQuizzes: [] };
  const sampleQuestions = (bank.topicQuestions.Java || []).slice(0, 5);
  const topicBank = bank.topicQuestions;
  const leetcodeQuizzes = (bank.leetcodeQuizzes || []).map(q => ({ ...q, id:q.id, questions:q.questions.map(x=>({...x, options:[...x.options]})) }));

  const defaultQuizzes = [
    { id:'java-5', title:'Java Quiz — Batch 5.0', subject:'Java', batch:'5.0', semester:'4', topic:'OOP & Collections', difficulty:'Medium', marks:100, timer:35, questions:topicBank.Java || sampleQuestions, status:'Published', attempts:284, accuracy:78, retry:true, leaderboard:true, color:'#4d94ff', date:'Today, 10:30 AM' },
    { id:'dsa-5', title:'DSA Sprint — Batch 5.0', subject:'DSA', batch:'5.0', semester:'4', topic:'Trees & Graphs', difficulty:'Hard', marks:50, timer:25, questions:topicBank.DSA || sampleQuestions, status:'Published', attempts:196, accuracy:64, retry:false, leaderboard:true, color:'#9c8cff', date:'Yesterday' },
    { id:'dbms-3', title:'DBMS Quiz — Batch 3.0', subject:'DBMS', batch:'3.0', semester:'3', topic:'Normalization', difficulty:'Medium', marks:50, timer:20, questions:topicBank.DBMS || sampleQuestions, status:'Scheduled', attempts:0, accuracy:0, retry:true, leaderboard:false, color:'#55d9ff', date:'Jul 22, 9:00 AM' },
    { id:'java-4', title:'Java Quiz — Batch 4.0', subject:'Java', batch:'4.0', semester:'3', topic:'Core Java', difficulty:'Easy', marks:100, timer:35, questions:topicBank.Java || sampleQuestions, status:'Published', attempts:412, accuracy:82, retry:true, leaderboard:true, color:'#4de3a3', date:'Jul 15' },
    { id:'os-4', title:'Operating Systems — Batch 4.0', subject:'OS', batch:'4.0', semester:'5', topic:'Processes & Threads', difficulty:'Hard', marks:50, timer:25, questions:topicBank.OS || sampleQuestions, status:'Draft', attempts:0, accuracy:0, retry:false, leaderboard:false, color:'#ffbf62', date:'Edited 2h ago' },
    { id:'cn-3', title:'Computer Networks — Batch 3.0', subject:'Networks', batch:'3.0', semester:'5', topic:'OSI & TCP/IP', difficulty:'Easy', marks:50, timer:20, questions:topicBank.Networks || sampleQuestions, status:'Published', attempts:318, accuracy:86, retry:true, leaderboard:true, color:'#ff7d91', date:'Jul 10' },
    ...leetcodeQuizzes
  ];


  let students = [];
  let leaderboard = [];
  let notifications = [];

  function freshDraft() {
    return {
      id:null, title:'', subject:'Java', batch:'5.0', semester:'4', topic:'', difficulty:'Medium', marks:50, timer:20,
      instructions:'Read each question carefully. Select the best answer before the timer ends.', leaderboard:true, retry:true,
      questions:[{ id:uid(), question:'', options:['','','',''], correct:0, explanation:'', solution:'', marks:10 }]
    };
  }

  let persisted = {};
  try { persisted = JSON.parse(localStorage.getItem('uzonequiz-session') || '{}'); } catch (_) {}

  const state = {
    role: persisted.role || 'teacher',
    page: 'dashboard',
    quizzes: Array.isArray(persisted.quizzes) && persisted.quizzes.length ? persisted.quizzes : defaultQuizzes,
    bookmarks: new Set(persisted.bookmarks || ['java-q3']),
    quizBookmarks: new Set(persisted.quizBookmarks || []),
    draft: freshDraft(),
    sidebarOpen:false,
    authMode:'login',
    authRole:persisted.role || 'teacher',
    teacherSearch:'',
    librarySearch:'',
    filters:{ subject:'All', batch:'All', semester:'All', difficulty:'All' },
    attempt:null,
    lastResult:null,
    timerHandle:null,
    profileOpen:false,
    user:null,
    authed:false
  };

  function persist() {
    const serialQuizzes = state.quizzes.map(q => ({...q, questions:q.questions || []}));
    localStorage.setItem('uzonequiz-session', JSON.stringify({
      role:state.role,
      quizzes:serialQuizzes,
      bookmarks:[...state.bookmarks],
      quizBookmarks:[...state.quizBookmarks]
    }));
    api?.syncBookmarks([...state.bookmarks], [...state.quizBookmarks]);
  }

  /* --- Server data layer (UzoneAPI). The UI renders identically; when the
         backend is reachable it becomes the source of truth for data. --- */
  const api = window.UzoneAPI;

  function applyServerData(data) {
    if (!data) return;
    if (data.user) state.user = data.user;
    state.authed = !!data.authed;
    if (Array.isArray(data.quizzes)) state.quizzes = data.quizzes.length ? data.quizzes : state.quizzes;
    if (Array.isArray(data.students)) students = data.students;
    if (Array.isArray(data.leaderboard)) leaderboard = data.leaderboard;
    if (Array.isArray(data.notifications)) notifications = data.notifications;
    if (Array.isArray(data.bookmarks)) state.bookmarks = new Set(data.bookmarks);
    if (Array.isArray(data.quizBookmarks)) state.quizBookmarks = new Set(data.quizBookmarks);
    if (data.stats) state.serverStats = data.stats;
    if (data.analytics) state.serverAnalytics = data.analytics;
  }

  const dataSnapshot = () => JSON.stringify([state.quizzes, students, leaderboard, notifications, state.serverStats, state.serverAnalytics, [...state.bookmarks], [...state.quizBookmarks], state.user, state.authed]);

  function loadFromServer(rerender = true) {
    if (!api) return;
    api.setRoleHint(state.role);
    api.bootstrap().then(data => {
      if (!data) return;
      const before = dataSnapshot();
      applyServerData(data);
      // Re-render only when data actually changed, so animations never restart needlessly.
      if (rerender && state.page !== 'attempt' && dataSnapshot() !== before) render();
    });
  }

  function refreshPageData(page) {
    if (!api || !api.online()) return;
    if (page === 'leaderboard') {
      api.leaderboard().then(d => {
        if (d && Array.isArray(d.entries) && d.entries.length) { leaderboard = d.entries; if (state.page === 'leaderboard') render(); }
      });
    } else if (['dashboard', 'students', 'analytics', 'performance'].includes(page)) {
      loadFromServer();
    }
  }

  const teacherNav = [
    ['dashboard','layout-dashboard','Overview'],
    ['quizzes','files','My quizzes'],
    ['coding','square-code','Code practice'],
    ['create','circle-plus','Create quiz'],
    ['students','users','Students'],
    ['analytics','chart-no-axes-combined','Analytics']
  ];
  const studentNav = [
    ['dashboard','layout-dashboard','Overview'],
    ['library','library-big','Quiz library'],
    ['coding','square-code','Code practice'],
    ['performance','chart-spline','Performance'],
    ['leaderboard','trophy','Leaderboard'],
    ['bookmarks','bookmark','Practice later']
  ];

  function currentNav() { return state.role === 'teacher' ? teacherNav : studentNav; }
  function pageMeta() {
    const labels = {
      dashboard: state.role === 'teacher' ? ['Teacher dashboard','Your classroom at a glance'] : ['Student dashboard','Keep learning, keep growing'],
      quizzes:['My quizzes','Create, publish, and manage assessments'], create:['Quiz builder','Craft a focused learning experience'],
      students:['Students','Track every learner’s progress'], analytics:['Analytics','Insights that make teaching smarter'],
      library:['Quiz library','Explore every batch and revise freely'], performance:['Performance','Your learning journey, visualized'],
      leaderboard:['Leaderboard','Challenge friends and climb the ranks'], bookmarks:['Practice later','Your saved questions in one place'],
      result:['Quiz result','Review your performance and explanations'],
      coding:['Code practice','LeetCode-style problems with an in-browser judge']
    };
    return labels[state.page] || ['UzoneQuiz','Learn. Test. Level up.'];
  }

  function runIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs:{ 'stroke-width':1.8 } });
  }

  /* Identity shown in the topbar/sidebar/heroes. */
  function currentPerson() {
    if (state.authed && state.user) {
      const first = state.user.name.split(' ')[0];
      return {
        name: state.user.name, first,
        role: state.role === 'teacher' ? 'Teacher · Computer Science' : `Student · Batch ${state.user.batch || '5.0'}`,
        ini: initials(state.user.name)
      };
    }
    return state.role === 'teacher'
      ? { name:'Guest', first:'Guest', role:'Sign in to manage quizzes', ini:'G' }
      : { name:'Guest', first:'Guest', role:'Sign in to track your progress', ini:'G' };
  }

  function render() {
    if (state.page === 'attempt' && state.attempt) {
      renderAttempt();
      return;
    }
    if (state.page === 'codingProblem' && window.UzoneCoding) {
      stopTimer();
      window.UzoneCoding.renderWorkspace();
      return;
    }
    stopTimer();
    const [title, subtitle] = pageMeta();
    const app = $('#app');
    app.innerHTML = `
      <div class="app-shell">
        ${state.sidebarOpen ? '<div class="sidebar-overlay" data-action="close-sidebar"></div>' : ''}
        ${renderSidebar()}
        <div class="main-wrap">
          <header class="topbar">
            <button class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="Open navigation">${icon('menu')}</button>
            <div class="top-title"><h1>${title}</h1><p>${subtitle}</p></div>
            <label class="top-search">
              ${icon('search')}
              <input id="global-search" placeholder="Search quizzes, students, topics..." aria-label="Global search">
              <kbd>⌘ K</kbd>
            </label>
            <div class="top-actions">
              <button class="icon-btn" data-action="toggle-theme" aria-label="Toggle color mode">${icon(document.documentElement.classList.contains('dark') ? 'sun' : 'moon')}</button>
              <button class="icon-btn" data-action="open-notifications" aria-label="Open notifications">${icon('bell')}<span class="notification-dot"></span></button>
              ${state.authed ? `<button class="icon-btn" data-action="logout" aria-label="Log out">${icon('log-out')}</button>` : ''}
              <button class="top-avatar" data-action="open-auth" aria-label="Open profile">${currentPerson().ini}</button>
            </div>
          </header>
          <main>${renderPage()}</main>
        </div>
        ${renderMobileNav()}
      </div>`;
    runIcons();
  }

  function renderSidebar() {
    const nav = currentNav();
    const person = currentPerson();
    return `
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}">
        <div class="brand"><div class="brand-mark">U</div><div class="brand-copy">Uzone<span>Quiz</span><small>Learn · Test · Grow</small></div></div>
        <div class="role-switcher" aria-label="Switch workspace role">
          <button class="role-btn ${state.role === 'teacher' ? 'active' : ''}" data-action="switch-role" data-role="teacher">Teacher</button>
          <button class="role-btn ${state.role === 'student' ? 'active' : ''}" data-action="switch-role" data-role="student">Student</button>
        </div>
        <div class="nav-label">Workspace</div>
        <nav class="nav">
          ${nav.map(([page, navIcon, label]) => `<button class="nav-item ${state.page === page ? 'active' : ''}" data-page="${page}">${icon(navIcon)}<span>${label}</span>${page === 'bookmarks' && state.bookmarks.size ? `<span class="nav-count">${state.bookmarks.size}</span>` : ''}</button>`).join('')}
        </nav>
        <div class="sidebar-bottom">
          <div class="sync-card">
            <div class="sync-row"><span class="sync-icon">${icon('cloud-check')}</span><span class="sync-copy"><strong>Offline ready</strong><span>Changes synced just now</span></span></div>
          </div>
          <button class="sidebar-profile" data-action="open-auth">
            <span class="avatar">${person.ini}</span>
            <span class="profile-copy"><strong>${escapeHTML(person.name)}</strong><span>${escapeHTML(person.role)}</span></span>
            ${icon('chevrons-up-down')}
          </button>
        </div>
      </aside>`;
  }

  function renderMobileNav() {
    const nav = currentNav().slice(0,5);
    const activeIndex = nav.findIndex(([page]) => page === state.page);
    return `<nav class="mobile-bottom-nav liquid-dock" style="--dock-count:${nav.length};--active-index:${Math.max(0, activeIndex)};--liquid-offset:${Math.max(0, activeIndex) * 100}%" aria-label="Quick navigation">
      <span class="liquid-glass-indicator ${activeIndex < 0 ? 'is-hidden' : ''}" aria-hidden="true"><i class="liquid-glass-core"></i></span>
      ${nav.map(([page, navIcon, label], index) => `<button class="mobile-nav-item liquid-dock-item ${state.page === page ? 'active' : ''}" data-page="${page}" data-dock-index="${index}" aria-label="${label}" ${state.page === page ? 'aria-current="page"' : ''}>${icon(navIcon)}<span>${label.split(' ')[0]}</span><i class="dock-tooltip">${label}</i></button>`).join('')}
    </nav>`;
  }

  function renderPage() {
    const codingPage = () => window.UzoneCoding ? window.UzoneCoding.listPage() : '<section class="page"></section>';
    const routes = state.role === 'teacher'
      ? { dashboard:teacherDashboard, quizzes:teacherQuizzes, create:quizBuilder, students:studentsPage, analytics:analyticsPage, result:resultPage, coding:codingPage }
      : { dashboard:studentDashboard, library:quizLibrary, performance:performancePage, leaderboard:leaderboardPage, bookmarks:bookmarksPage, result:resultPage, coding:codingPage };
    return (routes[state.page] || routes.dashboard)();
  }

  function mascot() {
    return `<div class="stationery-scene" aria-hidden="true">
      <div class="studio-glow"></div>
      <div class="notebook-3d">
        <div class="notebook-edge"></div>
        <div class="notebook-page">
          <div class="notebook-rings"><i></i><i></i><i></i><i></i></div>
          <span class="paper-kicker">UZONE NOTES</span>
          <strong>Quiz smart.</strong>
          <span class="paper-highlight">Learn better.</span>
          <i class="paper-rule one"></i><i class="paper-rule two"></i>
          <span class="paper-check">✓</span>
        </div>
      </div>
      <div class="pen-float"><div class="pen-3d"><span class="pen-nib"></span><span class="pen-body"><i></i><b>UZONE</b></span><span class="pen-clip"></span><span class="pen-end"></span></div></div>
      <div class="marker-float"><div class="marker-3d"><span class="marker-cap"></span><span class="marker-body"><b>MARK</b></span><span class="marker-tip"></span></div></div>
      <span class="scene-spark spark-one">✦</span><span class="scene-spark spark-two">✦</span>
    </div>`;
  }

  function statCard(label, value, statIcon, trend, color, down=false) {
    return `<article class="glass-card stat-card" style="--stat-color:${color}"><div class="stat-head"><span class="stat-icon">${icon(statIcon)}</span><span class="stat-trend ${down ? 'down' : ''}">${icon(down?'trending-down':'trending-up')}${trend}</span></div><div class="stat-number">${value}</div><div class="stat-label">${label}</div></article>`;
  }

  function lineChart() {
    return `<div class="chart-wrap"><svg class="line-chart" viewBox="0 0 700 190" preserveAspectRatio="none" role="img" aria-label="Attempts trend chart">
      <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d57d6" stop-opacity=".28"/><stop offset="1" stop-color="#3d57d6" stop-opacity="0"/></linearGradient></defs>
      <line class="gridline" x1="0" y1="28" x2="700" y2="28"/><line class="gridline" x1="0" y1="78" x2="700" y2="78"/><line class="gridline" x1="0" y1="128" x2="700" y2="128"/><line class="gridline" x1="0" y1="178" x2="700" y2="178"/>
      <path class="area" d="M0,155 C55,150 65,128 118,132 S188,151 235,113 S320,86 352,104 S425,119 470,75 S548,52 586,69 S655,48 700,30 L700,190 L0,190 Z"/>
      <path class="line" d="M0,155 C55,150 65,128 118,132 S188,151 235,113 S320,86 352,104 S425,119 470,75 S548,52 586,69 S655,48 700,30"/>
      <circle class="point" cx="118" cy="132" r="4"/><circle class="point" cx="235" cy="113" r="4"/><circle class="point" cx="352" cy="104" r="4"/><circle class="point" cx="470" cy="75" r="4"/><circle class="point" cx="586" cy="69" r="4"/><circle class="point" cx="700" cy="30" r="4"/>
    </svg><div class="chart-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div>`;
  }

  const fmtCount = (n) => n >= 1000 ? `${(n/1000).toFixed(1).replace(/\.0$/,'')}k` : String(n);

  function teacherDashboard() {
    const s = state.serverStats || {};
    const topQuizzes = state.quizzes.filter(q => q.status === 'Published');
    const mq = (q) => q ? miniQuiz(q, `${q.attempts ?? 0} attempts`, `${q.accuracy ?? 0}%`) : '';
    return `<section class="page dashboard-stack">
      <article class="hero-card">
        <div class="hero-copy"><span class="hero-kicker"><i></i>Live classroom</span><h2>Good afternoon, ${escapeHTML(currentPerson().first)}. <span>Let’s spark curiosity.</span></h2><p>Your students completed 48 attempts this week. Create a new challenge or see where the class needs a little more help.</p><div class="hero-actions"><button class="btn btn-primary" data-page="create">${icon('plus')}Create a quiz</button><button class="btn btn-secondary" data-page="analytics">${icon('chart-no-axes-combined')}View insights</button></div></div>${mascot()}
      </article>
      <div class="stats-grid">
        ${statCard('Total quizzes', s.totalQuizzes != null ? String(s.totalQuizzes) : '24','files','12.5%','#4d94ff')}
        ${statCard('Total students', s.totalStudents != null ? fmtCount(s.totalStudents) : '1,248','users','8.2%','#55d9ff')}
        ${statCard('Total attempts', s.totalAttempts != null ? fmtCount(s.totalAttempts) : '8,492','mouse-pointer-click','18.4%','#4de3a3')}
        ${statCard('Average score', s.avgScorePct != null ? `${s.avgScorePct}%` : '76.8%','gauge','2.1%','#ffbf62')}
      </div>
      <div class="two-column">
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Attempts this week</h3><p>Daily submission activity across all quizzes</p></div><div class="chart-legend"><span class="legend-item"><i class="legend-dot"></i>Attempts</span><button class="btn btn-ghost btn-sm">Last 7 days ${icon('chevron-down')}</button></div></div>${lineChart()}</article>
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Recent activity</h3><p>What’s happening now</p></div><button class="btn btn-ghost btn-sm">View all</button></div><div class="activity-list">
          ${activity('user-check','green','Aarav completed Java Quiz','Scored 46/50 · Batch 5.0','2m')}
          ${activity('send','','DSA Sprint was published','196 students notified','18m')}
          ${activity('calendar-clock','amber','DBMS quiz scheduled','Tomorrow · 9:00 AM','1h')}
          ${activity('message-circle-more','','New question discussion','8 replies on Question #4','2h')}
        </div></article>
      </div>
      <div class="two-column">
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Active quizzes</h3><p>Live performance snapshot</p></div><button class="btn btn-secondary btn-sm" data-page="quizzes">Manage all ${icon('arrow-up-right')}</button></div><div class="mini-quiz-list">
          ${mq(topQuizzes[0])}${mq(topQuizzes[1])}${mq(topQuizzes[2])}
        </div></article>
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Class pulse</h3><p>Across published assessments</p></div>${icon('ellipsis')}</div><div style="display:flex;align-items:center;justify-content:center;gap:24px;padding:13px 0 8px"><div class="progress-ring" style="--value:76"><span>76<small>%</small></span></div><div style="display:grid;gap:10px"><div><strong style="font-family:'DM Mono';font-size:12px">+4.8%</strong><span style="display:block;color:var(--muted);font-size:7px;margin-top:3px">vs. last month</span></div><div><strong style="font-family:'DM Mono';font-size:12px;color:var(--green)">Healthy</strong><span style="display:block;color:var(--muted);font-size:7px;margin-top:3px">learning velocity</span></div></div></div></article>
      </div>
    </section>`;
  }

  function activity(activityIcon, tone, title, body, time) {
    return `<div class="activity-item"><span class="activity-icon ${tone}">${icon(activityIcon)}</span><span class="activity-copy"><strong>${title}</strong><span>${body}</span></span><time class="activity-time">${time}</time></div>`;
  }

  function miniQuiz(q, sub, score) {
    return `<div class="mini-quiz"><span class="subject-icon" style="--sub1:${q.color};--sub2:#17427e">${q.subject.slice(0,2).toUpperCase()}</span><span class="mini-quiz-copy"><strong>${q.title}</strong><span>${sub} · ${q.questions.length} questions</span></span><span class="score-chip">${score}</span></div>`;
  }

  function teacherQuizzes() {
    return `<section class="page">
      <div class="page-head"><div><span class="eyebrow">Quiz management</span><h2>Build once. Inspire many.</h2><p>Manage drafts, schedules, and published assessments.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="export-results">${icon('download')}Export results</button><button class="btn btn-primary" data-page="create">${icon('plus')}New quiz</button></div></div>
      <div class="glass-card filters-bar"><label class="search-field">${icon('search')}<input class="form-control" data-teacher-search placeholder="Search quiz name or topic..." value="${escapeHTML(state.teacherSearch)}"></label><select class="form-select filter-select" data-teacher-status><option>All status</option><option>Published</option><option>Draft</option><option>Scheduled</option></select><select class="form-select filter-select" data-teacher-subject><option>All subjects</option>${[...new Set(state.quizzes.map(q=>q.subject))].map(s=>`<option>${s}</option>`).join('')}</select><button class="btn btn-secondary btn-icon" aria-label="Sort quizzes">${icon('arrow-up-down')}</button></div>
      <div class="quiz-grid" id="teacher-quiz-grid">${state.quizzes.map(q => quizCard(q,false)).join('')}</div>
      <div id="teacher-empty" class="glass-card empty-state" style="display:none;margin-top:14px">${emptyToy()}<h3>No quizzes found</h3><p>Try a different search or create a fresh assessment for your class.</p><button class="btn btn-primary" data-page="create">${icon('plus')}Create quiz</button></div>
    </section>`;
  }

  function quizCard(q, student=true) {
    const statusClass = q.status.toLowerCase();
    return `<article class="glass-card quiz-card" data-quiz-card data-title="${escapeHTML(q.title.toLowerCase())}" data-subject="${escapeHTML(q.subject)}" data-batch="${escapeHTML(q.batch)}" data-semester="${escapeHTML(q.semester)}" data-difficulty="${escapeHTML(q.difficulty)}" data-status="${escapeHTML(q.status)}" style="--card-color:${q.color || '#4d94ff'}">
      <div class="quiz-top"><span class="subject-badge">${q.subject.slice(0,2).toUpperCase()}</span>${student ? `<button class="card-menu" data-action="toggle-quiz-bookmark" data-id="${q.id}" aria-label="Bookmark quiz">${icon(state.quizBookmarks.has(q.id)?'bookmark-check':'bookmark')}</button>` : `<button class="card-menu" data-action="quiz-menu" data-id="${q.id}" aria-label="Quiz options">${icon('ellipsis')}</button>`}</div>
      <h3>${escapeHTML(q.title)}</h3><p>${escapeHTML(q.topic)} · Semester ${escapeHTML(q.semester)}</p>
      <div class="quiz-meta"><span>${icon('list-checks')}${q.questions.length} questions</span><span>${icon('clock-3')}${q.timer} min</span><span>${icon('award')}${q.marks} marks</span></div>
      <div class="quiz-footer">${student ? `<span class="difficulty ${q.difficulty.toLowerCase()}">${q.difficulty}</span><button class="btn btn-primary btn-sm" data-action="start-quiz" data-id="${q.id}">${icon('play')}Attempt</button>` : `<span class="chip ${statusClass}">${q.status}</span><button class="btn btn-ghost btn-sm" data-action="view-results" data-id="${q.id}">Results ${icon('arrow-up-right')}</button>`}</div>
    </article>`;
  }

  function quizBuilder() {
    const d = state.draft;
    const total = d.questions.reduce((sum,q) => sum + Number(q.marks || 0), 0);
    return `<section class="page">
      <div class="page-head"><div><span class="eyebrow">${d.id ? 'Editing assessment' : 'New assessment'}</span><h2>${d.id ? 'Refine your quiz.' : 'Turn a topic into a challenge.'}</h2><p>Set the details, add questions, and choose how students participate.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="preview-quiz">${icon('eye')}Preview</button><button class="btn btn-secondary" data-action="save-draft">${icon('save')}Save draft</button><button class="btn btn-primary" data-action="publish-quiz">${icon('send')}Publish quiz</button></div></div>
      <div class="stepper"><span class="step done"><i class="step-number">${icon('check')}</i>Details</span><i class="step-line"></i><span class="step active"><i class="step-number">2</i>Questions</span><i class="step-line"></i><span class="step"><i class="step-number">3</i>Settings</span></div>
      <div class="builder-layout">
        <div class="builder-main">
          <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Quiz details</h3><p>Help students know what they’re about to learn</p></div><span class="chip">Autosaved</span></div><div class="form-grid">
            ${field('Quiz title',`<input class="form-control" data-draft-field="title" placeholder="e.g. Java Quiz — Batch 5.0" value="${escapeHTML(d.title)}">`,true)}
            ${field('Subject',`<input class="form-control" data-draft-field="subject" placeholder="Java" value="${escapeHTML(d.subject)}">`)}
            ${field('Batch',`<select class="form-select" data-draft-field="batch">${['5.0','4.0','3.0','2.0'].map(v=>`<option ${d.batch===v?'selected':''}>${v}</option>`).join('')}</select>`)}
            ${field('Semester',`<select class="form-select" data-draft-field="semester">${['1','2','3','4','5','6','7','8'].map(v=>`<option ${d.semester===v?'selected':''}>${v}</option>`).join('')}</select>`)}
            ${field('Topic',`<input class="form-control" data-draft-field="topic" placeholder="e.g. OOP & Collections" value="${escapeHTML(d.topic)}">`)}
            ${field('Difficulty',`<select class="form-select" data-draft-field="difficulty">${['Easy','Medium','Hard'].map(v=>`<option ${d.difficulty===v?'selected':''}>${v}</option>`).join('')}</select>`)}
            ${field('Total marks',`<input class="form-control" data-draft-field="marks" type="number" min="1" value="${escapeHTML(d.marks)}">`)}
            ${field('Timer (minutes)',`<input class="form-control" data-draft-field="timer" type="number" min="1" value="${escapeHTML(d.timer)}">`)}
            ${field('Instructions',`<textarea class="form-textarea" data-draft-field="instructions" placeholder="Add clear attempt instructions...">${escapeHTML(d.instructions)}</textarea>`,true)}
          </div></article>
          <div class="panel-head" style="margin:5px 2px 0"><div class="panel-title"><h3>Questions <span style="color:var(--muted);font-weight:500">(${d.questions.length})</span></h3><p>Choose one correct answer for each MCQ</p></div><button class="btn btn-secondary btn-sm" data-action="open-ai">${icon('sparkles')}Generate with AI</button></div>
          ${d.questions.map((q,index)=>questionEditor(q,index)).join('')}
          <button class="builder-add" data-action="add-question">${icon('plus-circle')}Add another question</button>
        </div>
        <aside class="builder-side">
          <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Quiz settings</h3><p>Control the student experience</p></div>${icon('sliders-horizontal')}</div><div class="setting-list">
            ${setting('Leaderboard','Show rank after submission','leaderboard',d.leaderboard)}
            ${setting('Retry mode','Allow another attempt','retry',d.retry)}
            ${setting('Shuffle questions','Different order per student','shuffle',d.shuffle || false)}
            ${setting('Show explanations','Reveal after submission','explanations',d.explanations !== false)}
          </div></article>
          <div class="quiz-health"><div class="health-head">Quiz readiness <span>${d.questions.length && d.title ? '82%' : '48%'}</span></div><div class="health-track"><i style="width:${d.questions.length && d.title ? '82' : '48'}%"></i></div><p>${d.title ? 'Looking good. Add two more questions for stronger topic coverage.' : 'Add a clear title and complete your first question.'}</p></div>
          <article class="glass-card panel"><div class="panel-title"><h3>Quick summary</h3><p>Updates as you build</p></div><div style="display:grid;gap:11px;margin-top:15px">${summaryRow('Questions',d.questions.length)}${summaryRow('Assigned marks',total)}${summaryRow('Timer',`${d.timer} min`)}${summaryRow('Difficulty',d.difficulty)}</div><button class="btn btn-secondary" style="width:100%;margin-top:16px" data-action="schedule-quiz">${icon('calendar-clock')}Schedule instead</button></article>
        </aside>
      </div>
    </section>`;
  }

  function field(label, control, wide=false) { return `<div class="field ${wide?'wide':''}"><label>${label}</label>${control}</div>`; }
  function setting(title, copy, key, active) { return `<div class="setting-row"><span class="setting-copy"><strong>${title}</strong><span>${copy}</span></span><button class="toggle ${active?'active':''}" data-action="toggle-setting" data-key="${key}" aria-label="Toggle ${title}"><i></i></button></div>`; }
  function summaryRow(label,value) { return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:9px"><span style="color:var(--muted)">${label}</span><strong style="font-family:'DM Mono'">${value}</strong></div>`; }

  function questionEditor(q,index) {
    return `<article class="glass-card question-card">
      <div class="question-head"><div class="question-num"><span>${String(index+1).padStart(2,'0')}</span>Question ${index+1}</div><div class="question-actions"><button class="btn btn-ghost btn-icon btn-sm" data-action="duplicate-question" data-index="${index}" aria-label="Duplicate question">${icon('copy')}</button><button class="btn btn-ghost btn-icon btn-sm" data-action="delete-question" data-index="${index}" aria-label="Delete question">${icon('trash-2')}</button></div></div>
      <div class="field"><label>Question</label><textarea class="form-textarea" data-q-field="question" data-index="${index}" placeholder="Type your question here...">${escapeHTML(q.question)}</textarea></div>
      <div class="option-grid">${q.options.map((option,oi)=>`<label class="option-input ${q.correct===oi?'correct':''}"><button type="button" class="option-radio" data-action="correct-option" data-index="${index}" data-option="${oi}" aria-label="Mark option ${oi+1} correct"></button><span class="option-letter">${String.fromCharCode(65+oi)}</span><input data-q-option data-index="${index}" data-option="${oi}" placeholder="Option ${oi+1}" value="${escapeHTML(option)}"></label>`).join('')}</div>
      <div class="form-grid" style="margin-top:12px"><div class="field"><label>Teacher explanation <span>Shown after submission</span></label><textarea class="form-textarea" data-q-field="explanation" data-index="${index}" placeholder="Explain why this answer is correct...">${escapeHTML(q.explanation)}</textarea></div><div class="field"><label>Reference solution <span>Optional Python / JavaScript solution</span></label><textarea class="form-textarea solution-editor" data-q-field="solution" data-index="${index}" placeholder="Paste a reference solution...">${escapeHTML(q.solution || '')}</textarea></div><div class="field"><label>Marks</label><input class="form-control" data-q-field="marks" data-index="${index}" type="number" min="1" value="${escapeHTML(q.marks)}"></div></div>
    </article>`;
  }

  function studentsPage() {
    return `<section class="page">
      <div class="page-head"><div><span class="eyebrow">Learner directory</span><h2>Every student, in focus.</h2><p>Review participation, scores, and learners who need support.</p></div><div class="page-actions"><button class="btn btn-secondary">${icon('upload')}Import list</button><button class="btn btn-primary" data-action="invite-students">${icon('user-plus')}Invite students</button></div></div>
      <div class="stats-grid">${statCard('Active students','1,186','user-check','7.2%','#4de3a3')}${statCard('Need attention','62','circle-alert','1.4%','#ff7d91',true)}${statCard('Avg. participation','91%','activity','3.8%','#4d94ff')}${statCard('Top batch','Batch 5.0','medal','4.1%','#ffbf62')}</div>
      <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Student performance</h3><p>All enrolled learners · updated live</p></div><div class="page-actions"><button class="btn btn-secondary btn-sm">All batches ${icon('chevron-down')}</button><button class="btn btn-secondary btn-sm">${icon('sliders-horizontal')}Filter</button></div></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Student</th><th>Batch</th><th>Attempts</th><th>Total score</th><th>Accuracy</th><th>Status</th><th></th></tr></thead><tbody>${students.map(s=>`<tr><td><div class="table-user"><span class="mini-avatar" style="--av1:${s.color[0]};--av2:${s.color[1]}">${initials(s.name)}</span>${s.name}</div></td><td>Batch ${s.batch}</td><td>${s.attempts}</td><td class="table-score">${s.score}</td><td><div class="accuracy-bar"><span>${s.accuracy}%</span><i class="accuracy-track"><i style="width:${s.accuracy}%"></i></i></div></td><td><span class="chip ${s.status==='Active'?'published':'draft'}">${s.status}</span></td><td><button class="card-menu" data-action="student-detail" data-name="${escapeHTML(s.name)}">${icon('arrow-up-right')}</button></td></tr>`).join('')}</tbody></table></div></article>
    </section>`;
  }

  function analyticsPage() {
    const a = state.serverAnalytics || {};
    const bars = Array.isArray(a.quizAccuracy) && a.quizAccuracy.length ? a.quizAccuracy : [['Java 5.0',78],['DSA 5.0',64],['DBMS 3.0',73],['Java 4.0',82],['OS 4.0',58],['Networks',86]];
    const distColors = ['var(--blue)','var(--cyan)','var(--amber)','var(--red)'];
    const dist = Array.isArray(a.subjectDist) && a.subjectDist.length
      ? a.subjectDist.slice(0,4).map((d,i)=>({label:`${d.label} · ${d.pct}%`, color:distColors[i]}))
      : [{label:'Java · 72%',color:'var(--blue)'},{label:'DSA · 12%',color:'var(--cyan)'},{label:'DBMS · 9%',color:'var(--amber)'},{label:'Other · 7%',color:'var(--red)'}];
    const hardest = Array.isArray(a.hardestQuestions) && a.hardestQuestions.length
      ? a.hardestQuestions.map((h,i)=>activity('circle-help','amber',escapeHTML(h.text.length>44?h.text.slice(0,41)+'...':h.text),`${h.pctWrong}% answered incorrectly`,`#${String(i+1).padStart(2,'0')}`))
      : [activity('circle-help','amber','Graph traversal complexity','68% answered incorrectly','#12'),activity('circle-help','amber','Third normal form dependency','54% answered incorrectly','#08'),activity('circle-help','amber','Java method dispatch','47% answered incorrectly','#04'),activity('circle-help','amber','Deadlock prevention','41% answered incorrectly','#15')];
    return `<section class="page">
      <div class="page-head"><div><span class="eyebrow">Learning intelligence</span><h2>See what the scores don’t say.</h2><p>Spot trends, misconceptions, and opportunities to improve.</p></div><div class="page-actions"><button class="btn btn-secondary">${icon('calendar-days')}Last 30 days</button><button class="btn btn-primary" data-action="export-results">${icon('download')}Export report</button></div></div>
      <div class="stats-grid">${statCard('Average score', a.avgScorePct != null ? `${a.avgScorePct}%` : '76.8%','gauge','2.1%','#4d94ff')}${statCard('Completion rate', a.completionPct != null ? `${a.completionPct}%` : '92.4%','circle-check-big','3.8%','#4de3a3')}${statCard('Avg. time', a.avgTime || '14m 32s','timer','1.2%','#ffbf62',true)}${statCard('Quiz accuracy', a.accuracyPct != null ? `${a.accuracyPct}%` : '79.1%','crosshair','4.6%','#55d9ff')}</div>
      <div class="two-column">
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Quiz-wise accuracy</h3><p>Average correct answers by assessment</p></div><div class="chart-legend"><span class="legend-item"><i class="legend-dot"></i>Accuracy</span></div></div><div class="bar-chart">${bars.map(([l,v],i)=>`<div class="bar-group"><span class="bar-value">${v}%</span><i class="bar" style="height:${v}%;animation-delay:${i*.07}s"></i><span class="bar-label">${escapeHTML(l)}</span></div>`).join('')}</div></article>
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Subject distribution</h3><p>Attempt share this month</p></div>${icon('ellipsis')}</div><div class="donut-layout"><div class="donut"><strong>${a.totalAttempts != null ? fmtCount(a.totalAttempts) : '8.4k'}</strong><span>attempts</span></div><div class="donut-legend">${dist.map(d=>`<span><i style="background:${d.color}"></i>${escapeHTML(d.label)}</span>`).join('')}</div></div></article>
      </div>
      <div class="two-column" style="margin-top:14px">
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Most incorrect questions</h3><p>Concepts students are struggling with</p></div><button class="btn btn-ghost btn-sm">View question bank</button></div><div class="activity-list">${hardest.join('')}</div></article>
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Top performers</h3><p>Across all quizzes this month</p></div><button class="btn btn-ghost btn-sm">Full ranking</button></div><div class="rank-list">${leaderboard.slice(0,4).map((r,i)=>rankRow(r,i)).join('')}</div></article>
      </div>
    </section>`;
  }

  function studentDashboard() {
    const s = state.serverStats || {};
    const heroQuiz = state.quizzes.find(q => q.status === 'Published') || state.quizzes[0];
    const smq = (q, a, b) => q ? miniQuiz(q, a, b) : '';
    return `<section class="page dashboard-stack">
      <article class="hero-card"><div class="hero-copy"><span class="hero-kicker"><i></i>7 day streak</span><h2>Hey ${escapeHTML(currentPerson().first)}, ready to <span>level up?</span></h2><p>A fresh Java challenge is waiting. You’re only 8 points away from entering today’s top three.</p><div class="hero-actions"><button class="btn btn-primary" data-action="start-quiz" data-id="${heroQuiz ? heroQuiz.id : 'java-5'}">${icon('play')}Continue learning</button><button class="btn btn-secondary" data-page="library">${icon('library-big')}Explore library</button></div></div>${mascot()}</article>
      <div class="stats-grid">${statCard('Quizzes completed', s.completed != null ? String(s.completed) : '32','circle-check-big','12.5%','#4d94ff')}${statCard('Average score', s.avgScorePct != null ? `${s.avgScorePct}%` : '84%','gauge','4.2%','#4de3a3')}${statCard('Current rank', s.rank ? `#${s.rank}` : '#4','trophy','3 spots','#ffbf62')}${statCard('Learning time', s.learningHours != null ? `${s.learningHours}h` : '14.2h','clock-3','2.8h','#55d9ff')}</div>
      <div class="two-column">
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Recommended for you</h3><p>Based on your recent practice</p></div><button class="btn btn-ghost btn-sm" data-page="library">See all ${icon('arrow-right')}</button></div><div class="quiz-grid">${state.quizzes.filter(q=>q.status==='Published').slice(0,2).map(q=>quizCard(q,true)).join('')}</div></article>
        <div class="dashboard-stack"><article class="glass-card streak-card"><span class="streak-flame">${icon('flame')}</span><span class="streak-copy"><strong>7 days</strong><span>Your longest streak is 12 days</span></span><div class="week-dots">${['M','T','W','T','F','S','S'].map((d,i)=>`<span class="day-dot done"><i>${i<6?icon('check'):''}</i>${d}</span>`).join('')}</div></article><article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Quick performance</h3><p>Your last five attempts</p></div><div class="progress-ring" style="--value:${s.avgScorePct != null ? s.avgScorePct : 84};width:64px"><span style="font-size:13px">${s.avgScorePct != null ? s.avgScorePct : 84}<small>%</small></span></div></div><div class="mini-quiz-list">${smq(state.quizzes[0],'Yesterday','46/50')}${smq(state.quizzes[3],'Jul 15','42/50')}${smq(state.quizzes[5],'Jul 10','27/30')}</div></article></div>
      </div>
      <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Your weekly momentum</h3><p>Accuracy across this week’s practice</p></div><button class="btn btn-secondary btn-sm" data-page="performance">Full report ${icon('arrow-up-right')}</button></div>${lineChart()}</article>
    </section>`;
  }

  function quizLibrary() {
    const published = state.quizzes.filter(q=>q.status==='Published');
    return `<section class="page">
      <div class="page-head"><div><span class="eyebrow">All batches, one library</span><h2>Revise without limits.</h2><p>Attempt current or older batch quizzes whenever you need practice.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="show-bookmarked-quizzes">${icon('bookmark')}Saved quizzes</button></div></div>
      <div class="glass-card filters-bar"><label class="search-field">${icon('search')}<input class="form-control" data-library-search placeholder="Search quiz name, topic..." value="${escapeHTML(state.librarySearch)}"></label>${libraryFilter('subject',['All',...new Set(published.map(q=>q.subject))])}${libraryFilter('batch',['All',...new Set(published.map(q=>q.batch))])}${libraryFilter('semester',['All',...new Set(published.map(q=>q.semester))])}${libraryFilter('difficulty',['All','Easy','Medium','Hard'])}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin:0 2px 13px"><span style="font-size:9px;color:var(--muted)"><strong id="quiz-count" style="color:var(--text)">${published.length}</strong> quizzes available</span><button class="btn btn-ghost btn-sm">Newest first ${icon('chevron-down')}</button></div>
      <div class="quiz-grid" id="library-grid">${published.map(q=>quizCard(q,true)).join('')}</div>
      <div id="library-empty" class="glass-card empty-state" style="display:none">${emptyToy()}<h3>No quiz matches yet</h3><p>Clear a filter or search another topic. There’s always something new to practice.</p><button class="btn btn-secondary" data-action="clear-library-filters">Clear filters</button></div>
    </section>`;
  }

  function libraryFilter(key, values) {
    return `<select class="form-select filter-select" data-library-filter="${key}" aria-label="Filter by ${key}">${values.map(v=>`<option value="${v}" ${state.filters[key]===v?'selected':''}>${v==='All'?'All '+key:v}</option>`).join('')}</select>`;
  }

  function performancePage() {
    return `<section class="page">
      <div class="page-head"><div><span class="eyebrow">My progress</span><h2>Small wins, visible growth.</h2><p>Understand your strengths and decide what to practice next.</p></div><div class="page-actions"><button class="btn btn-secondary">${icon('calendar-days')}Last 6 months</button><button class="btn btn-primary" data-action="share-progress">${icon('share-2')}Share report</button></div></div>
      <div class="stats-grid">${statCard('Overall accuracy','84%','crosshair','4.2%','#4d94ff')}${statCard('Questions solved','486','list-checks','38','#4de3a3')}${statCard('Best subject','Java','code-2','91%','#ffbf62')}${statCard('Study streak','7 days','flame','2 days','#ff7d91')}</div>
      <div class="two-column">
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Performance history</h3><p>Monthly average accuracy</p></div><div class="chart-legend"><span class="legend-item"><i class="legend-dot"></i>Your accuracy</span></div></div>${lineChart()}</article>
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Subject-wise progress</h3><p>Accuracy by learning area</p></div>${icon('ellipsis')}</div><div style="display:grid;gap:17px">${progressRow('Java',91,'#4d94ff')}${progressRow('DSA',78,'#9c8cff')}${progressRow('DBMS',85,'#55d9ff')}${progressRow('Networks',76,'#4de3a3')}${progressRow('Operating Systems',69,'#ffbf62')}</div></article>
      </div>
      <div class="two-column" style="margin-top:14px"><article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Weekly practice</h3><p>Questions completed per day</p></div><span class="chip published">Goal on track</span></div><div class="bar-chart">${[['Mon',12],['Tue',21],['Wed',16],['Thu',28],['Fri',24],['Sat',34],['Sun',19]].map(([l,v],i)=>`<div class="bar-group"><span class="bar-value">${v}</span><i class="bar" style="height:${v*2.5}%;animation-delay:${i*.06}s"></i><span class="bar-label">${l}</span></div>`).join('')}</div></article><article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Learning goal</h3><p>July · 120 questions</p></div><strong style="font-family:'DM Mono';font-size:11px">92 / 120</strong></div><div style="display:flex;align-items:center;justify-content:center;padding:13px"><div class="progress-ring" style="--value:77;width:130px"><span style="font-size:23px">77<small>%</small></span></div></div><p style="margin:4px 0 0;text-align:center;color:var(--muted);font-size:8px">28 more questions to complete your monthly goal.</p></article></div>
    </section>`;
  }

  function progressRow(label,value,color) { return `<div><div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:7px"><strong>${label}</strong><span style="font-family:'DM Mono';color:var(--muted)">${value}%</span></div><div class="accuracy-track" style="width:100%;height:6px"><i style="width:${value}%;background:${color}"></i></div></div>`; }

  function leaderboardPage() {
    return `<section class="page">
      <div class="page-head"><div><span class="eyebrow">Live rankings</span><h2>Skill speaks louder than luck.</h2><p>Ranked by marks first, then fastest completion time.</p></div><div class="page-actions"><button class="btn btn-secondary">Java Quiz — Batch 5.0 ${icon('chevron-down')}</button></div></div>
      <div class="three-column" style="margin-bottom:14px">${leaderPodium(leaderboard[1],2,'🥈')}${leaderPodium(leaderboard[0],1,'👑')}${leaderPodium(leaderboard[2],3,'🥉')}</div>
      <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Full leaderboard</h3><p>284 students · updated just now</p></div><span class="chip published">Live</span></div><div class="rank-list">${leaderboard.map((r,i)=>rankRow(r,i)).join('')}</div></article>
    </section>`;
  }

  function leaderPodium(r,rank,medal) { return `<article class="glass-card panel" style="text-align:center;${rank===1?'border-color:rgba(255,191,98,.23);transform:translateY(-5px)':''}"><div style="font-size:${rank===1?28:22}px;margin-bottom:8px">${medal}</div><span class="mini-avatar" style="width:43px;height:43px;margin:0 auto 9px;--av1:${rank===1?'#ffbf62':'#4d94ff'};--av2:${rank===1?'#a96112':'#164a98'}">${initials(r.name)}</span><strong style="display:block;font-size:11px">${r.name}</strong><span style="display:block;color:var(--muted);font-size:8px;margin-top:4px">${r.marks}/50 · ${r.time}</span></article>`; }
  function rankRow(r,i) { const medal = ['🥇','🥈','🥉'][i]; return `<div class="rank-item ${r.me?'me':''}"><span class="rank-num ${medal?'medal':''}">${medal || i+1}</span><span class="mini-avatar">${initials(r.name)}</span><span class="rank-copy"><strong>${r.name}${r.me?' · You':''}</strong><span>Batch ${r.batch}</span></span><span class="rank-score"><strong>${r.marks}/50</strong><span>${r.time}</span></span></div>`; }

  function bookmarksPage() {
    const questions = sampleQuestions.filter(q=>state.bookmarks.has(q.id));
    if (!questions.length) return `<section class="page"><div class="page-head"><div><span class="eyebrow">Saved practice</span><h2>Practice later.</h2><p>Difficult questions you save will appear here.</p></div></div><div class="glass-card empty-state">${emptyToy()}<h3>Your practice list is empty</h3><p>Bookmark a difficult question during a quiz and it’ll wait here for your next focused study session.</p><button class="btn btn-primary" data-page="library">${icon('library-big')}Explore quizzes</button></div></section>`;
    return `<section class="page"><div class="page-head"><div><span class="eyebrow">Saved practice</span><h2>Your tricky questions, tamed.</h2><p>${questions.length} bookmarked question${questions.length===1?'':'s'} ready for focused revision.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="practice-bookmarks">${icon('play')}Practice all</button></div></div><div class="review-list">${questions.map((q,i)=>`<article class="glass-card review-item"><div class="review-head"><span class="review-status" style="color:var(--amber);background:rgba(255,191,98,.08)">${icon('bookmark-check')}</span><div class="review-copy" style="flex:1"><h4>${i+1}. ${escapeHTML(q.question)}</h4><div class="review-answer">Correct answer: <b>${escapeHTML(q.options[q.correct])}</b></div><div class="explanation"><strong>Explanation:</strong> ${escapeHTML(q.explanation)}</div>${q.solution ? `<details class="solution-details"><summary>View reference solution</summary><pre class="solution-code">${escapeHTML(q.solution)}</pre></details>` : ''}</div><button class="btn btn-ghost btn-icon btn-sm" data-action="remove-bookmark" data-id="${q.id}" aria-label="Remove bookmark">${icon('x')}</button></div></article>`).join('')}</div></section>`;
  }

  function emptyToy() { return `<div class="empty-toy" aria-hidden="true"><div class="empty-box"></div><div class="empty-face"></div><span class="empty-spark one">✦</span><span class="empty-spark two">✧</span></div>`; }

  function openQuizIntro(id) {
    const q = state.quizzes.find(item=>item.id===id);
    if (!q) return;
    showModal(`<div class="modal-head"><div><h3>${escapeHTML(q.title)}</h3><p>${escapeHTML(q.topic)} · Batch ${q.batch}</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin:0 0 18px">${compactStat('Questions',q.questions.length,'list-checks')}${compactStat('Time',`${q.timer} min`,'clock-3')}${compactStat('Marks',q.marks,'award')}</div><div class="quiz-health"><div class="health-head">Before you begin <span>${q.difficulty}</span></div><p style="margin-top:10px">Read every question carefully. Your timer starts immediately, answers are autosaved, and you can navigate between questions before submitting.</p></div><div class="setting-list" style="margin-top:17px">${introSetting('Leaderboard',q.leaderboard?'Enabled':'Hidden',q.leaderboard?'trophy':'eye-off')}${introSetting('Retry mode',q.retry?'One retry allowed':'Single attempt only',q.retry?'rotate-ccw':'shield-check')}${introSetting('Explanations','Available after submission','message-circle-more')}</div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Maybe later</button><button class="btn btn-primary" data-action="begin-quiz" data-id="${q.id}">${icon('play')}Start quiz</button></div>`);
  }

  function compactStat(label,value,ic) { return `<div class="result-stat" style="text-align:center">${icon(ic)}<strong style="margin-top:6px">${value}</strong><span>${label}</span></div>`; }
  function introSetting(label,value,ic) { return `<div class="setting-row"><span class="setting-copy"><strong>${label}</strong><span>${value}</span></span><span class="stat-icon" style="width:28px;height:28px">${icon(ic)}</span></div>`; }

  function beginQuiz(id) {
    const quiz = state.quizzes.find(q=>q.id===id);
    if (!quiz) return;
    closeModal();
    state.attempt = { quizId:id, current:0, answers:{}, bookmarked:new Set(), remaining:quiz.timer*60, startedAt:Date.now() };
    state.page = 'attempt';
    render();
  }

  function renderAttempt() {
    const quiz = state.quizzes.find(q=>q.id===state.attempt.quizId);
    if (!quiz) { state.page='library'; state.attempt=null; render(); return; }
    const q = quiz.questions[state.attempt.current];
    const total = quiz.questions.length;
    const answered = Object.keys(state.attempt.answers).length;
    $('#app').innerHTML = `<div class="attempt-shell">
      <header class="attempt-top"><div class="attempt-brand"><span class="brand-mark">U</span><span>Uzone<span style="color:var(--blue-2)">Quiz</span></span></div><div class="attempt-info"><strong>${escapeHTML(quiz.title)}</strong><span>${escapeHTML(quiz.topic)} · ${total} questions</span></div><div class="attempt-progress"><div class="attempt-progress-track"><i style="width:${(answered/total)*100}%"></i></div><small>${answered} of ${total} answered</small></div><div class="timer-pill">${icon('timer')}<span id="timer-value">${formatTime(state.attempt.remaining)}</span></div><button class="btn btn-secondary btn-sm" data-action="confirm-exit">${icon('log-out')}<span class="hide-mobile">Exit</span></button></header>
      <div class="attempt-layout"><main class="question-stage"><div class="question-stage-inner"><div class="question-tag"><span>Question ${state.attempt.current+1} of ${total}</span>${q.title ? `<span class="chip">${escapeHTML(q.title)}</span>` : ''}<span class="marks">${q.marks} marks</span></div><h1 class="question-title">${escapeHTML(q.question)}</h1><div class="answer-list">${q.options.map((opt,i)=>`<button class="answer-option ${state.attempt.answers[q.id]===i?'selected':''}" data-action="answer" data-option="${i}"><span class="answer-letter">${String.fromCharCode(65+i)}</span><span>${escapeHTML(opt)}</span></button>`).join('')}</div><div class="question-bottom"><button class="btn ${state.attempt.bookmarked.has(q.id)?'btn-secondary':'btn-ghost'}" data-action="bookmark-attempt">${icon(state.attempt.bookmarked.has(q.id)?'bookmark-check':'bookmark')} ${state.attempt.bookmarked.has(q.id)?'Bookmarked':'Bookmark'}</button><div class="page-actions"><button class="btn btn-secondary" data-action="prev-question" ${state.attempt.current===0?'disabled':''}>${icon('arrow-left')}Previous</button>${state.attempt.current===total-1?`<button class="btn btn-primary" data-action="confirm-submit">Submit quiz ${icon('send')}</button>`:`<button class="btn btn-primary" data-action="next-question">Next ${icon('arrow-right')}</button>`}</div></div></div></main>
      <aside class="attempt-nav"><h3>Question navigator</h3><p>Jump to any question before submitting.</p><div class="number-grid">${quiz.questions.map((item,i)=>`<button class="q-number ${i===state.attempt.current?'current':''} ${state.attempt.answers[item.id]!==undefined?'answered':''} ${state.attempt.bookmarked.has(item.id)?'bookmarked':''}" data-action="goto-question" data-index="${i}">${i+1}</button>`).join('')}</div><div class="attempt-legend"><span><i class="blue"></i>Current question</span><span><i class="soft"></i>Answered</span><span><i></i>Not answered</span></div><div class="quiz-health" style="margin-top:22px"><div class="health-head">Autosave <span>${icon('cloud-check')}</span></div><p style="margin-top:8px">Every answer is saved on this device, even if your connection drops.</p></div></aside></div>
    </div>`;
    runIcons();
    startTimer();
  }

  function startTimer() {
    stopTimer();
    state.timerHandle = setInterval(() => {
      if (!state.attempt) return stopTimer();
      state.attempt.remaining = Math.max(0, state.attempt.remaining - 1);
      const target = $('#timer-value');
      if (target) target.textContent = formatTime(state.attempt.remaining);
      if (state.attempt.remaining === 0) { stopTimer(); submitQuiz(true); }
    }, 1000);
  }
  function stopTimer() { if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle=null; } }
  function formatTime(sec) { return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }

  function confirmSubmit() {
    const quiz = state.quizzes.find(q=>q.id===state.attempt.quizId);
    const unanswered = quiz.questions.length - Object.keys(state.attempt.answers).length;
    showModal(`<div class="modal-head"><div><h3>Submit this quiz?</h3><p>Your answers will be evaluated immediately.</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="quiz-health"><div class="health-head">Attempt summary <span>${quiz.questions.length-unanswered}/${quiz.questions.length} answered</span></div><div class="health-track"><i style="width:${((quiz.questions.length-unanswered)/quiz.questions.length)*100}%"></i></div><p>${unanswered ? `You still have ${unanswered} unanswered question${unanswered===1?'':'s'}. You can go back before submitting.` : 'Everything is answered. Nice work — you’re ready to submit.'}</p></div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Review answers</button><button class="btn btn-primary" data-action="submit-quiz">${icon('send')}Submit now</button></div>`);
  }

  function submitQuiz(auto=false) {
    if (!state.attempt) return;
    const quiz = state.quizzes.find(q=>q.id===state.attempt.quizId);
    let correct = 0, score = 0;
    quiz.questions.forEach(q => { if (state.attempt.answers[q.id] === q.correct) { correct++; score += Number(q.marks); } });
    state.attempt.bookmarked.forEach(id => state.bookmarks.add(id));
    const elapsed = Math.max(1, Math.round((Date.now()-state.attempt.startedAt)/1000));
    state.lastResult = { quiz, answers:{...state.attempt.answers}, correct, score, total:quiz.marks, time:elapsed, auto };
    const attemptBookmarks = [...state.attempt.bookmarked];
    state.attempt = null;
    stopTimer(); closeModal(); persist();
    state.page='result';
    render();
    // Server is the system of record: it re-scores the attempt, stores it, and
    // returns the real leaderboard position.
    api?.submitAttempt({ quizId:quiz.id, answers:state.lastResult.answers, timeTakenSec:elapsed, auto, bookmarked:attemptBookmarks }).then(res => {
      if (!res) return;
      if (Array.isArray(res.leaderboard) && res.leaderboard.length) leaderboard = res.leaderboard;
      if (res.rank && state.lastResult) { state.lastResult.rank = res.rank; if (state.page === 'result') render(); }
      loadFromServer(false);
    });
    if (auto) toast('Time is up','Your saved answers were submitted automatically.','clock-3');
  }

  function resultPage() {
    const r = state.lastResult;
    if (!r) return `<section class="page"><div class="glass-card empty-state">${emptyToy()}<h3>No recent result</h3><p>Complete a quiz to see your score, accuracy, time, and teacher explanations here.</p><button class="btn btn-primary" data-page="library">Browse quizzes</button></div></section>`;
    const pct = Math.round(r.correct/r.quiz.questions.length*100);
    return `<section class="page"><div class="page-head"><div><span class="eyebrow">Attempt complete</span><h2>Here’s how you did.</h2><p>Review every answer and turn mistakes into progress.</p></div><div class="page-actions"><button class="btn btn-secondary" data-action="share-result">${icon('share-2')}Share result</button>${r.quiz.retry?`<button class="btn btn-primary" data-action="start-quiz" data-id="${r.quiz.id}">${icon('rotate-ccw')}Retry quiz</button>`:''}</div></div>
      <div class="two-column"><article class="glass-card result-hero"><div class="result-crown">${icon(pct>=80?'crown':'star')}</div><h2>${pct>=80?'Excellent work!':pct>=60?'Nice progress!':'Keep practicing!'}</h2><p>${pct>=80?'You’ve mastered most of this topic.':pct>=60?'A quick review will make this topic even stronger.':'Review the explanations and try again when ready.'}</p><div class="result-score" style="--score:${pct}%"><strong>${pct}%</strong><span>accuracy</span></div><div class="result-stat-grid"><div class="result-stat"><strong>${r.score}/${r.total}</strong><span>Score</span></div><div class="result-stat"><strong>${r.correct}/${r.quiz.questions.length}</strong><span>Correct</span></div><div class="result-stat"><strong>${formatTime(r.time)}</strong><span>Time taken</span></div><div class="result-stat"><strong>${r.rank ? `#${r.rank}` : '#4'}</strong><span>Leaderboard</span></div></div></article>
      <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Performance snapshot</h3><p>Compared with other learners</p></div><span class="chip published">Top 12%</span></div><div style="display:grid;gap:18px;margin-top:15px">${progressRow('Your accuracy',pct,'#4d94ff')}${progressRow('Class average',76,'#55d9ff')}${progressRow('Top scorer',96,'#4de3a3')}</div><div class="quiz-health" style="margin-top:21px"><div class="health-head">Learning tip <span>✦</span></div><p style="margin-top:8px">Review Question ${r.quiz.questions.findIndex(q=>r.answers[q.id]!==q.correct)+1 || 1} first — it covers a concept that appears often in advanced quizzes.</p></div></article></div>
      <div class="panel-head" style="margin:24px 2px 12px"><div class="panel-title"><h3>Answer review</h3><p>Teacher explanations are shown for every question</p></div><button class="btn btn-secondary btn-sm" data-page="bookmarks">${icon('bookmark')}Practice saved</button></div><div class="review-list">${r.quiz.questions.map((q,i)=>reviewQuestion(q,i,r.answers[q.id])).join('')}</div>
    </section>`;
  }

  function reviewQuestion(q,i,answer) {
    const right = answer === q.correct;
    return `<article class="glass-card review-item"><div class="review-head"><span class="review-status ${right?'correct':'wrong'}">${icon(right?'check':'x')}</span><div class="review-copy" style="flex:1"><h4>${i+1}. ${escapeHTML(q.question)}</h4><div class="review-answer">Your answer: <b style="color:${right?'var(--green)':'var(--red)'}">${answer===undefined?'Not answered':escapeHTML(q.options[answer])}</b><br>Correct answer: <b>${escapeHTML(q.options[q.correct])}</b></div><div class="explanation"><strong>Explanation:</strong> ${escapeHTML(q.explanation)}</div>${q.solution ? `<details class="solution-details"><summary>View reference solution</summary><pre class="solution-code">${escapeHTML(q.solution)}</pre></details>` : ''}</div><button class="btn btn-ghost btn-icon btn-sm" data-action="toggle-review-bookmark" data-id="${q.id}" aria-label="Bookmark question">${icon(state.bookmarks.has(q.id)?'bookmark-check':'bookmark')}</button></div></article>`;
  }

  function showModal(content, classes='') {
    $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><div class="modal ${classes}">${content}</div></div>`;
    runIcons();
  }
  function closeModal() { $('#modal-root').innerHTML=''; }

  function openAuth() {
    showModal(`<div class="auth-modal"><section class="auth-art"><div class="brand"><div class="brand-mark">U</div><div class="brand-copy">Uzone<span>Quiz</span><small>Learn · Test · Grow</small></div></div><div class="auth-quote"><div class="mini-doodle">✦ 〰 ✎</div><h3>Turn every question into a little win.</h3><p>One focused space for teaching, assessment, insight, and joyful learning.</p></div></section><section class="auth-form"><div class="auth-tabs"><button class="auth-tab ${state.authMode==='login'?'active':''}" data-action="auth-tab" data-mode="login">Log in</button><button class="auth-tab ${state.authMode==='signup'?'active':''}" data-action="auth-tab" data-mode="signup">Create account</button></div><h2>${state.authMode==='login'?'Welcome back.':'Join UzoneQuiz.'}</h2><p>${state.authMode==='login'?'Pick up right where you left off.':'Start creating or practicing in seconds.'}</p>${state.authMode==='signup'?`<div class="field" style="margin-bottom:12px"><label>Full name</label><input id="auth-name" class="form-control" placeholder="Your full name"></div>`:''}<div class="field" style="margin-bottom:12px"><label>Email address</label><input id="auth-email" class="form-control" type="email" value="${state.authMode==='login'?'demo@uzonequiz.app':''}" placeholder="name@example.com"></div><div class="field"><label>Password <span>${state.authMode==='login'?'Forgot password?':'8+ characters'}</span></label><input id="auth-password" class="form-control" type="password" value="${state.authMode==='login'?'demopass':''}" placeholder="••••••••"></div><div class="field" style="margin-top:14px"><label>Continue as</label><div class="role-cards"><button class="role-card ${state.authRole==='teacher'?'active':''}" data-action="auth-role" data-role="teacher"><span class="role-card-icon">${icon('presentation')}</span><span><strong>Teacher</strong><span>Create & analyze</span></span></button><button class="role-card ${state.authRole==='student'?'active':''}" data-action="auth-role" data-role="student"><span class="role-card-icon">${icon('graduation-cap')}</span><span><strong>Student</strong><span>Practice & grow</span></span></button></div></div><button class="btn btn-primary" style="width:100%;margin-top:4px" data-action="auth-submit">${state.authMode==='login'?'Log in':'Create account'} ${icon('arrow-right')}</button><p style="text-align:center;margin:14px 0 0;color:var(--muted-2);font-size:7px">Demo mode · No real account is created</p></section></div>`, 'wide');
  }

  function openNotifications() {
    $('#drawer-root').innerHTML = `<div class="drawer-backdrop" data-action="close-drawer"></div><aside class="drawer"><div class="drawer-head"><div><h3>Notifications</h3><span style="color:var(--muted);font-size:8px">2 new updates</span></div><button class="modal-close" data-action="close-drawer">${icon('x')}</button></div><button class="btn btn-ghost btn-sm" style="margin:0 0 11px auto;display:flex" data-action="mark-read">${icon('check-check')}Mark all read</button><div class="notification-list">${notifications.map(n=>`<div class="notification-item ${n.unread?'unread':''}"><span class="notification-icon">${icon(n.icon)}</span><span class="notification-copy"><strong>${n.title}</strong><p>${n.body}</p><span>${n.time}</span></span></div>`).join('')}</div></aside>`;
    runIcons();
  }
  function closeDrawer() { $('#drawer-root').innerHTML=''; }

  function toast(title, message='', ic='circle-check') {
    const node = document.createElement('div');
    node.className='toast';
    node.innerHTML=`<span class="toast-icon">${icon(ic)}</span><span><strong>${title}</strong>${message?`<span>${message}</span>`:''}</span>`;
    $('#toast-root').appendChild(node); runIcons();
    setTimeout(()=>{ node.classList.add('out'); setTimeout(()=>node.remove(),260); },3000);
  }

  function showQuizMenu(id, event) {
    $('.context-menu')?.remove();
    const menu=document.createElement('div'); menu.className='context-menu';
    const x=Math.min(event.clientX,window.innerWidth-165), y=Math.min(event.clientY,window.innerHeight-180);
    menu.style.left=`${x}px`; menu.style.top=`${y}px`;
    menu.innerHTML=`<button data-action="edit-quiz" data-id="${id}">${icon('pencil')}Edit quiz</button><button data-action="duplicate-quiz" data-id="${id}">${icon('copy')}Duplicate</button><button data-action="view-results" data-id="${id}">${icon('chart-no-axes-combined')}View analytics</button><button class="danger" data-action="delete-quiz" data-id="${id}">${icon('trash-2')}Delete quiz</button>`;
    document.body.appendChild(menu); runIcons();
  }

  function showAiGenerator() {
    showModal(`<div class="modal-head"><div><h3>Generate questions with AI</h3><p>Create editable MCQs from your topic.</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="form-grid">${field('Subject',`<input id="ai-subject" class="form-control" value="${escapeHTML(state.draft.subject)}">`)}${field('Topic',`<input id="ai-topic" class="form-control" value="${escapeHTML(state.draft.topic || 'Object-oriented programming')}">`)}${field('Number of questions',`<select id="ai-count" class="form-select"><option>3</option><option>5</option><option>10</option></select>`)}${field('Difficulty',`<select id="ai-difficulty" class="form-select"><option>Easy</option><option selected>Medium</option><option>Hard</option></select>`)}</div><div class="quiz-health" style="margin-top:16px"><div class="health-head">AI co-pilot <span>${icon('sparkles')}</span></div><p style="margin-top:8px">Generated questions are always editable. Review answers and explanations before publishing.</p></div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="generate-ai">${icon('sparkles')}Generate questions</button></div>`);
  }

  function generateAI() {
    const topic = $('#ai-topic')?.value || 'Object-oriented programming';
    const count = Number($('#ai-count')?.value || 3);
    showModal(`<div class="modal-body" style="padding:38px;text-align:center"><div class="loader-logo" style="margin:0 auto"><span>✦</span></div><h3 style="margin:18px 0 6px">Crafting thoughtful questions...</h3><p style="color:var(--muted);font-size:9px">Balancing concepts, options, and explanations for ${escapeHTML(topic)}.</p><div class="loader-track" style="margin:18px auto 0"><i></i></div></div>`);
    setTimeout(()=>{
      const generated = sampleQuestions.slice(0,count).map((q,i)=>({...q,id:uid(),question:q.question.replace('Java',state.draft.subject||'Java'),marks:10}));
      state.draft.questions = [...state.draft.questions.filter(q=>q.question.trim()),...generated];
      if (!state.draft.questions.length) state.draft.questions=generated;
      closeModal(); render(); toast(`${generated.length} questions generated`,'Review and edit them before publishing.','sparkles');
    },1100);
  }

  function previewQuiz() {
    const d=state.draft, first=d.questions[0];
    showModal(`<div class="modal-head"><div><h3>Student preview</h3><p>This is how your first question will appear.</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><span class="chip scheduled">${escapeHTML(d.difficulty)} · ${d.timer} min</span><h2 style="font-size:18px;line-height:1.4;margin:16px 0">${escapeHTML(first.question || 'Your question will appear here.')}</h2><div class="answer-list">${first.options.map((o,i)=>`<div class="answer-option"><span class="answer-letter">${String.fromCharCode(65+i)}</span><span>${escapeHTML(o || `Option ${i+1}`)}</span></div>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Looks good</button></div>`,'wide');
  }

  function saveQuiz(status='Draft', scheduledDate='') {
    const d=state.draft;
    if (!d.title.trim()) { toast('Quiz title is missing','Add a clear title before saving.','circle-alert'); $('#modal-root').innerHTML=''; return; }
    const quiz = { ...d, id:d.id||uid(), status, attempts:d.attempts||0, accuracy:d.accuracy||0, color:d.color||'#4d94ff', date:scheduledDate||'Just now', questions:d.questions.map(q=>({...q})) };
    const idx=state.quizzes.findIndex(q=>q.id===d.id);
    if (idx>=0) state.quizzes[idx]=quiz; else state.quizzes.unshift(quiz);
    api?.saveQuiz(quiz).then(res => { if (res?.quiz) { const i=state.quizzes.findIndex(q=>q.id===quiz.id); if (i>=0) state.quizzes[i]=res.quiz; persist(); } });
    persist(); state.draft=freshDraft(); state.page='quizzes'; closeModal(); render();
    toast(status==='Published'?'Quiz published':'Quiz saved',status==='Published'?'Students have been notified.':status==='Scheduled'?`Scheduled for ${scheduledDate}.`:'Your draft is safe and editable.',status==='Published'?'send':'save');
  }

  function scheduleModal() {
    const tomorrow = new Date(Date.now()+86400000); tomorrow.setMinutes(tomorrow.getMinutes()-tomorrow.getTimezoneOffset());
    showModal(`<div class="modal-head"><div><h3>Schedule quiz</h3><p>Choose when this quiz becomes available.</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="field"><label>Publish date & time</label><input id="schedule-date" class="form-control" type="datetime-local" value="${tomorrow.toISOString().slice(0,16)}"></div><div class="setting-row" style="margin-top:16px"><span class="setting-copy"><strong>Send reminder</strong><span>Notify students 30 minutes before</span></span><button class="toggle active"><i></i></button></div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="confirm-schedule">${icon('calendar-check')}Schedule</button></div>`);
  }

  function confirmDelete(id) {
    const q=state.quizzes.find(item=>item.id===id); if(!q)return;
    showModal(`<div class="modal-head"><div><h3>Delete this quiz?</h3><p>${escapeHTML(q.title)}</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="quiz-health" style="border-color:rgba(255,108,130,.18);background:rgba(255,108,130,.05)"><div class="health-head">This can’t be undone <span style="color:var(--red)">${icon('triangle-alert')}</span></div><p style="margin-top:8px">The quiz and its draft questions will be removed. Existing result records remain available in analytics.</p></div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Keep quiz</button><button class="btn btn-danger" data-action="confirm-delete" data-id="${id}">${icon('trash-2')}Delete</button></div>`);
  }

  function filterTeacherCards() {
    const term=($('[data-teacher-search]')?.value||'').toLowerCase();
    const status=$('[data-teacher-status]')?.value||'All status';
    const subject=$('[data-teacher-subject]')?.value||'All subjects'; let count=0;
    $$('[data-quiz-card]','#teacher-quiz-grid').forEach(card=>{ const ok=card.dataset.title.includes(term)&&(status==='All status'||card.dataset.status===status)&&(subject==='All subjects'||card.dataset.subject===subject); card.style.display=ok?'':'none'; if(ok)count++; });
    $('#teacher-empty').style.display=count?'none':'grid';
  }

  function filterLibraryCards() {
    const term=($('[data-library-search]')?.value||'').toLowerCase(); let count=0;
    $$('#library-grid [data-quiz-card]').forEach(card=>{ const ok=card.dataset.title.includes(term)&&Object.entries(state.filters).every(([k,v])=>v==='All'||card.dataset[k]===v); card.style.display=ok?'':'none'; if(ok)count++; });
    if($('#quiz-count')) $('#quiz-count').textContent=count;
    if($('#library-empty')) $('#library-empty').style.display=count?'none':'grid';
  }

  function switchRole(role) {
    state.role=role; state.authRole=role; state.page='dashboard'; state.sidebarOpen=false; state.lastResult=null;
    state.serverStats=null; state.serverAnalytics=null;
    if (api) Promise.resolve(api.switchRole(role)).then(()=>loadFromServer());
    persist(); render();
    toast(`${role==='teacher'?'Teacher':'Student'} workspace active`,role==='teacher'?'Quiz creation and analytics unlocked.':'Library and learning tools unlocked.','refresh-cw');
  }

  function logout() {
    const clearSession = () => {
      state.user = null;
      state.authed = false;
      state.role = 'student';
      state.authRole = 'student';
      state.page = 'dashboard';
      state.lastResult = null;
      state.serverStats = null;
      state.serverAnalytics = null;
      state.sidebarOpen = false;
      closeModal();
      persist();
      render();
      loadFromServer(false);
      toast('Signed out', 'Your session has been ended safely.', 'log-out');
    };

    if (!api || !api.authed()) { clearSession(); return; }
    api.logout().catch(() => null).finally(clearSession);
  }

  function animateDockNavigation(target) {
    const dock = target.closest('.liquid-dock');
    if (!dock || target.classList.contains('active') || dock.dataset.animating === 'true') return;
    const targetIndex = Number(target.dataset.dockIndex || 0);
    const indicator = dock.querySelector('.liquid-glass-indicator');
    const currentItem = dock.querySelector('.liquid-dock-item.active');
    const currentIndex = Number(currentItem?.dataset.dockIndex || 0);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dock.dataset.animating = 'true';
    indicator?.classList.remove('is-hidden');
    dock.style.setProperty('--liquid-offset', `${targetIndex * 100}%`);
    if (indicator && !reducedMotion) {
      indicator.getAnimations().forEach(animation => animation.cancel());
      indicator.animate([
        { transform: `translate3d(${currentIndex * 100}%, 0, 0)` },
        { transform: `translate3d(${targetIndex * 100}%, 0, 0)` }
      ], {
        duration: 430,
        easing: 'cubic-bezier(.22, .92, .28, 1)',
        fill: 'forwards'
      });
    }
    dock.classList.add('is-moving');
    $$('.liquid-dock-item', dock).forEach(item => item.classList.toggle('pending', item === target));
    window.setTimeout(() => {
      state.page = target.dataset.page;
      state.sidebarOpen = false;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      refreshPageData(state.page);
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 430);
  }

  document.addEventListener('click', event => {
    const pageTarget=event.target.closest('[data-page]');
    if (pageTarget) {
      if (pageTarget.classList.contains('liquid-dock-item')) { animateDockNavigation(pageTarget); return; }
      state.page=pageTarget.dataset.page; state.sidebarOpen=false; render(); window.scrollTo({top:0,behavior:'smooth'}); refreshPageData(state.page); return;
    }
    const target=event.target.closest('[data-action]');
    if (!target) { if (!event.target.closest('.context-menu')) $('.context-menu')?.remove(); return; }
    const action=target.dataset.action;
    if (action.startsWith('lc-')) { window.UzoneCoding?.onAction(action, target, event); return; }
    switch(action) {
      case 'toggle-sidebar': state.sidebarOpen=!state.sidebarOpen; render(); break;
      case 'close-sidebar': state.sidebarOpen=false; render(); break;
      case 'switch-role': switchRole(target.dataset.role); break;
      case 'toggle-theme': {
        const dark=!document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark',dark); localStorage.setItem('uzone-studio-theme',dark?'dark':'light'); render(); toast(`${dark?'Ink':'Paper'} mode enabled`,'Your preference has been saved.',dark?'moon':'sun'); break;
      }
      case 'open-notifications': openNotifications(); break;
      case 'close-drawer': closeDrawer(); break;
      case 'mark-read': notifications=notifications.map(n=>({...n,unread:false})); api?.markNotificationsRead(); closeDrawer(); toast('All caught up','Notifications marked as read.','check-check'); break;
      case 'open-auth': openAuth(); break;
      case 'logout': logout(); break;
      case 'close-modal': closeModal(); break;
      case 'backdrop-close': if (event.target === target) closeModal(); break;
      case 'auth-tab': state.authMode=target.dataset.mode; openAuth(); break;
      case 'auth-role': state.authRole=target.dataset.role; openAuth(); break;
      case 'auth-submit': {
        const email=($('#auth-email')?.value||'').trim(), password=$('#auth-password')?.value||'', name=($('#auth-name')?.value||'').trim();
        if (api && api.hasServer()) {
          const call = state.authMode==='login' ? api.login(email,password,state.authRole) : api.register(name,email,password,state.authRole);
          call.then(res => { closeModal(); switchRole(res.user?.role||state.authRole); toast(state.authMode==='login'?'Welcome back':'Account ready',`You’re signed in as a ${res.user?.role||state.authRole}.`,'log-in'); })
              .catch(err => toast(state.authMode==='login'?'Could not log in':'Could not create account', err.message||'Please try again.','circle-alert'));
        } else { switchRole(state.authRole); closeModal(); toast(state.authMode==='login'?'Welcome back':'Account ready',`You’re signed in as a ${state.authRole}.`,'log-in'); }
        break;
      }
      case 'quiz-menu': showQuizMenu(target.dataset.id,event); break;
      case 'edit-quiz': {
        const q=state.quizzes.find(item=>item.id===target.dataset.id); if(q){ state.draft={...q,questions:(q.questions||sampleQuestions).map(x=>({...x,options:[...x.options]}))}; state.page='create'; $('.context-menu')?.remove(); render(); } break;
      }
      case 'duplicate-quiz': {
        const q=state.quizzes.find(item=>item.id===target.dataset.id); if(q){ const copy={...q,id:uid(),title:`${q.title} — Copy`,status:'Draft',date:'Just now',attempts:0,accuracy:0}; state.quizzes.unshift(copy); api?.saveQuiz(copy); persist(); render(); toast('Quiz duplicated','A new draft copy is ready.','copy'); } break;
      }
      case 'delete-quiz': $('.context-menu')?.remove(); confirmDelete(target.dataset.id); break;
      case 'confirm-delete': state.quizzes=state.quizzes.filter(q=>q.id!==target.dataset.id); api?.deleteQuiz(target.dataset.id); persist(); closeModal(); render(); toast('Quiz deleted','Result history remains in analytics.','trash-2'); break;
      case 'view-results': state.page='analytics'; $('.context-menu')?.remove(); render(); toast('Analytics opened','Showing performance across recent attempts.','chart-no-axes-combined'); break;
      case 'toggle-quiz-bookmark': {
        const id=target.dataset.id; state.quizBookmarks.has(id)?state.quizBookmarks.delete(id):state.quizBookmarks.add(id); persist(); render(); toast(state.quizBookmarks.has(id)?'Quiz saved':'Quiz removed',state.quizBookmarks.has(id)?'Find it quickly in saved quizzes.':'Removed from your saved list.','bookmark'); break;
      }
      case 'show-bookmarked-quizzes': {
        if(!state.quizBookmarks.size){toast('No saved quizzes yet','Tap the bookmark on a quiz card to save it.','bookmark');break;} $$('#library-grid [data-quiz-card]').forEach(c=>c.style.display=state.quizBookmarks.has(c.querySelector('[data-id]')?.dataset.id)?'':'none'); break;
      }
      case 'start-quiz': openQuizIntro(target.dataset.id); break;
      case 'begin-quiz': beginQuiz(target.dataset.id); break;
      case 'answer': {
        const quiz=state.quizzes.find(q=>q.id===state.attempt.quizId); const q=quiz.questions[state.attempt.current]; state.attempt.answers[q.id]=Number(target.dataset.option); renderAttempt(); break;
      }
      case 'goto-question': state.attempt.current=Number(target.dataset.index); renderAttempt(); break;
      case 'prev-question': if(state.attempt.current>0){state.attempt.current--;renderAttempt();} break;
      case 'next-question': {
        const quiz=state.quizzes.find(q=>q.id===state.attempt.quizId); if(state.attempt.current<quiz.questions.length-1){state.attempt.current++;renderAttempt();} break;
      }
      case 'bookmark-attempt': {
        const quiz=state.quizzes.find(q=>q.id===state.attempt.quizId), id=quiz.questions[state.attempt.current].id; state.attempt.bookmarked.has(id)?state.attempt.bookmarked.delete(id):state.attempt.bookmarked.add(id); renderAttempt(); break;
      }
      case 'confirm-submit': confirmSubmit(); break;
      case 'submit-quiz': submitQuiz(false); break;
      case 'confirm-exit': showModal(`<div class="modal-head"><div><h3>Leave this attempt?</h3><p>Your current answers are saved only for this session.</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><p style="color:var(--muted);font-size:9px;line-height:1.7">The timer will stop and this attempt won’t be counted. You can start again from the quiz library.</p></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Keep going</button><button class="btn btn-danger" data-action="exit-attempt">Exit quiz</button></div>`); break;
      case 'exit-attempt': stopTimer(); state.attempt=null; state.page='library'; closeModal(); render(); break;
      case 'toggle-review-bookmark': case 'remove-bookmark': {
        const id=target.dataset.id; state.bookmarks.has(id)?state.bookmarks.delete(id):state.bookmarks.add(id); persist(); render(); toast(state.bookmarks.has(id)?'Question bookmarked':'Bookmark removed',state.bookmarks.has(id)?'Added to Practice later.':'Your practice list was updated.','bookmark'); break;
      }
      case 'practice-bookmarks': beginQuiz('java-5'); break;
      case 'add-question': state.draft.questions.push({id:uid(),question:'',options:['','','',''],correct:0,explanation:'',solution:'',marks:10}); render(); break;
      case 'duplicate-question': {
        const q=state.draft.questions[Number(target.dataset.index)]; state.draft.questions.splice(Number(target.dataset.index)+1,0,{...q,id:uid(),options:[...q.options]}); render(); break;
      }
      case 'delete-question': if(state.draft.questions.length===1) toast('Keep at least one question','A quiz needs something to ask.','circle-alert'); else {state.draft.questions.splice(Number(target.dataset.index),1);render();} break;
      case 'correct-option': state.draft.questions[Number(target.dataset.index)].correct=Number(target.dataset.option); render(); break;
      case 'toggle-setting': { const key=target.dataset.key; state.draft[key]=!state.draft[key]; render(); break; }
      case 'open-ai': showAiGenerator(); break;
      case 'generate-ai': generateAI(); break;
      case 'preview-quiz': previewQuiz(); break;
      case 'save-draft': saveQuiz('Draft'); break;
      case 'publish-quiz': saveQuiz('Published'); break;
      case 'schedule-quiz': scheduleModal(); break;
      case 'confirm-schedule': { const date=$('#schedule-date')?.value; if(!date){toast('Choose a date and time','','circle-alert');break;} saveQuiz('Scheduled',new Date(date).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})); break; }
      case 'clear-library-filters': state.filters={subject:'All',batch:'All',semester:'All',difficulty:'All'}; state.librarySearch=''; render(); break;
      case 'export-results': toast('Report prepared','Demo export is ready for your analytics workflow.','download'); break;
      case 'invite-students': showModal(`<div class="modal-head"><div><h3>Invite students</h3><p>Share a secure classroom invitation.</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="field"><label>Email addresses <span>Separate with commas</span></label><textarea class="form-textarea" placeholder="student@example.com, learner@example.com"></textarea></div><div class="quiz-health" style="margin-top:14px"><div class="health-head">Class code <span>UZQ-5A8K</span></div><p style="margin-top:8px">Students can also join using this reusable batch code.</p></div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="send-invites">${icon('send')}Send invites</button></div>`); break;
      case 'send-invites': closeModal(); toast('Invitations sent','Students will receive a secure join link.','send'); break;
      case 'student-detail': toast(`${target.dataset.name} selected`,'Opening individual performance view.','user-round'); break;
      case 'share-progress': case 'share-result': toast('Share link copied','Anyone with the link can view this snapshot.','link'); break;
    }
  });

  document.addEventListener('input', event => {
    const el=event.target;
    if(el.matches('[data-draft-field]')) state.draft[el.dataset.draftField]=el.type==='number'?Number(el.value):el.value;
    if(el.matches('[data-q-field]')) state.draft.questions[Number(el.dataset.index)][el.dataset.qField]=el.type==='number'?Number(el.value):el.value;
    if(el.matches('[data-q-option]')) state.draft.questions[Number(el.dataset.index)].options[Number(el.dataset.option)]=el.value;
    if(el.matches('[data-teacher-search]')) { state.teacherSearch=el.value; filterTeacherCards(); }
    if(el.matches('[data-library-search]')) { state.librarySearch=el.value; filterLibraryCards(); }
  });

  document.addEventListener('change', event => {
    const el=event.target;
    if(el.matches('[data-draft-field]')) state.draft[el.dataset.draftField]=el.type==='number'?Number(el.value):el.value;
    if(el.matches('[data-library-filter]')) { state.filters[el.dataset.libraryFilter]=el.value; filterLibraryCards(); }
    if(el.matches('[data-teacher-status], [data-teacher-subject]')) filterTeacherCards();
  });

  document.addEventListener('keydown', event => {
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#global-search')?.focus();}
    if(event.key==='Escape'){closeModal();closeDrawer();$('.context-menu')?.remove();}
    if(event.key==='Enter'&&event.target.id==='global-search'){
      const value=event.target.value.trim();
      if(state.role==='teacher'){state.teacherSearch=value;state.page='quizzes';}else{state.librarySearch=value;state.page='library';}
      render();
    }
  });

  document.addEventListener('pointermove', event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const hero = event.target.closest('.hero-card');
    const scene = hero?.querySelector('.stationery-scene');
    if (!scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $$('.stationery-scene').forEach(item => {
        item.style.setProperty('--scene-rx', '-2deg');
        item.style.setProperty('--scene-ry', '-7deg');
      });
      return;
    }
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    scene.style.setProperty('--scene-ry', `${-7 + x * 12}deg`);
    scene.style.setProperty('--scene-rx', `${-2 - y * 9}deg`);
  });

  window.addEventListener('error', () => toast('Something went wrong','Your work is safe. Please try that action again.','triangle-alert'));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});

  // Bridge for feature modules loaded after app.js (coding.js).
  window.UzoneAppBridge = { state, render, icon, escapeHTML, toast, showModal, closeModal, runIcons };

  render();
  loadFromServer();
  setTimeout(()=>$('#boot-loader')?.classList.add('hidden'),650);
})();
