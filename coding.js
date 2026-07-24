/* Code practice — LeetCode-style problem list + split-pane workspace with an
   in-browser judge. JavaScript runs in a sandboxed Web Worker; Python runs via
   Pyodide (lazy-loaded in a worker). Judging happens on the main thread through
   the shared harness (coding-harness.js). All lc-* actions are delegated here
   from app.js. */
(() => {
  'use strict';

  const harness = window.UzoneCodingHarness;
  const problems = window.UzoneCodingProblems || [];
  const bridge = () => window.UzoneAppBridge;

  const LANGS = [['javascript', 'JavaScript'], ['python', 'Python 3']];
  const RUN_TIMEOUT_MS = 10000;
  const PY_TIMEOUT_MS = 30000;

  const ui = {
    problemId: null,
    language: localStorage.getItem('uzone-code-lang') || 'javascript',
    filter: 'All',
    search: '',
    leftTab: 'description',
    consoleTab: 'testcase',
    activeCase: 0,
    running: false,
    runKind: null,          // 'run' | 'submit'
    results: null,          // { verdict, cases:[{pass,status,value,logs,ms,error}], lang, totalMs }
    pyStatus: null,         // 'loading' | 'running'
    editor: null,           // CodeMirror instance or null (textarea fallback)
    saveTimer: null,
    pyWorker: null,
    jsWorker: null,
    runToken: 0,
  };

  /* ---------- persistence ---------- */
  const progressKey = 'uzone-coding-progress';
  const readProgress = () => { try { return JSON.parse(localStorage.getItem(progressKey) || '{}'); } catch (_) { return {}; } };
  const writeProgress = (p) => localStorage.setItem(progressKey, JSON.stringify(p));
  const markProgress = (id, status) => {
    const p = readProgress();
    if (p[id] === 'solved' && status !== 'solved') return;
    p[id] = status; writeProgress(p);
  };
  const codeKey = (id, lang) => `uzone-code:${id}:${lang}`;
  const savedCode = (id, lang) => localStorage.getItem(codeKey(id, lang));

  const current = () => problems.find(p => p.id === ui.problemId);
  const esc = (v) => bridge().escapeHTML(v);
  const icon = (n) => bridge().icon(n);

  /* ---------- list page ---------- */
  function listPage() {
    const progress = readProgress();
    const counts = { Easy: [0, 0], Medium: [0, 0], Hard: [0, 0] };
    problems.forEach(p => { counts[p.difficulty][1]++; if (progress[p.id] === 'solved') counts[p.difficulty][0]++; });
    const solvedTotal = Object.values(counts).reduce((s, c) => s + c[0], 0);

    if (!problems.length) {
      return `<section class="page"><div class="glass-card lc-empty">${icon('hammer')}<h3 style="margin:10px 0 6px">Problem set is being generated</h3><p>Run <code>node scripts/build-coding-problems.js</code> to build the problem data file.</p></div></section>`;
    }

    return `<section class="page">
      <div class="lc-list-head">
        <article class="glass-card panel"><div class="panel-head"><div class="panel-title"><h3>Code practice</h3><p>Solve real interview problems with an in-browser judge — pick a problem, write code, and run it against test cases.</p></div></div>
          <div class="lc-toolbar" style="margin-bottom:0">
            ${['All', 'Easy', 'Medium', 'Hard'].map(d => `<button class="lc-chip ${ui.filter === d ? 'active' : ''}" data-action="lc-filter" data-diff="${d}">${d}</button>`).join('')}
            <label class="lc-search">${icon('search')}<input id="lc-search" placeholder="Search problems or topics..." value="${esc(ui.search)}"></label>
          </div>
        </article>
        <article class="glass-card panel lc-progress-card">
          <div class="progress-ring" style="--value:${problems.length ? Math.round(solvedTotal / problems.length * 100) : 0}"><span>${solvedTotal}<small>/${problems.length}</small></span></div>
          <div class="lc-progress-bars">
            ${['Easy', 'Medium', 'Hard'].map(d => `<div class="lc-progress-row"><span>${d}</span><span class="lc-bar ${d.toLowerCase()}"><i style="width:${counts[d][1] ? counts[d][0] / counts[d][1] * 100 : 0}%"></i></span><strong>${counts[d][0]} / ${counts[d][1]}</strong></div>`).join('')}
          </div>
        </article>
      </div>
      <article class="glass-card panel"><div class="lc-table" id="lc-rows">${listRows()}</div></article>
    </section>`;
  }

  function filteredProblems() {
    const q = ui.search.trim().toLowerCase();
    return problems.filter(p =>
      (ui.filter === 'All' || p.difficulty === ui.filter) &&
      (!q || p.title.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q))));
  }

  function listRows() {
    const progress = readProgress();
    const rows = filteredProblems();
    if (!rows.length) return `<div class="lc-empty">No problems match — try a different search or filter.</div>`;
    return rows.map(p => {
      const idx = problems.indexOf(p) + 1;
      const st = progress[p.id];
      const dot = st === 'solved' ? `<span class="lc-status-dot solved">${icon('check')}</span>`
        : st === 'attempted' ? `<span class="lc-status-dot attempted">${icon('circle-dot')}</span>`
        : `<span class="lc-status-dot todo">${icon('circle')}</span>`;
      return `<div class="lc-row" data-action="lc-open" data-id="${p.id}">
        ${dot}<span class="lc-num">${idx}</span><h4>${esc(p.title)}</h4>
        <span class="lc-tags">${p.tags.slice(0, 2).map(t => `<span class="lc-tag">${esc(t)}</span>`).join('')}</span>
        <span class="lc-diff ${p.difficulty.toLowerCase()}">${p.difficulty}</span>
      </div>`;
    }).join('');
  }

  /* ---------- workspace ---------- */
  function renderWorkspace() {
    const p = current();
    const b = bridge();
    if (!p) { b.state.page = 'coding'; b.render(); return; }
    const progress = readProgress();
    const solved = progress[p.id] === 'solved';
    const savedSplit = localStorage.getItem('uzone-code-split');

    document.querySelector('#app').innerHTML = `<div class="lc-shell" ${savedSplit ? `style="--lc-left:${savedSplit}%"` : ''}>
      <header class="lc-top">
        <button class="btn btn-ghost btn-sm" data-action="lc-back">${icon('arrow-left')}<span class="hide-mobile">Problems</span></button>
        <div class="lc-title"><strong>${problems.indexOf(p) + 1}. ${esc(p.title)}</strong><span class="lc-diff ${p.difficulty.toLowerCase()}">${p.difficulty}</span>${solved ? `<span class="lc-status-dot solved" title="Solved">${icon('check')}</span>` : ''}</div>
        <button class="btn btn-ghost btn-icon btn-sm" data-action="lc-nav" data-dir="-1" aria-label="Previous problem">${icon('chevron-left')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-action="lc-nav" data-dir="1" aria-label="Next problem">${icon('chevron-right')}</button>
        <button class="btn btn-sm btn-run" data-action="lc-run" ${ui.running ? 'disabled' : ''}>${icon('play')}Run</button>
        <button class="btn btn-primary btn-sm" data-action="lc-submit" ${ui.running ? 'disabled' : ''}>${icon('cloud-upload')}<span class="hide-mobile">Submit</span></button>
      </header>
      <div class="lc-split">
        <section class="lc-pane lc-left">
          <div class="lc-pane-tabs">
            <button class="lc-pane-tab ${ui.leftTab === 'description' ? 'active' : ''}" data-action="lc-left-tab" data-tab="description">${icon('file-text')}Description</button>
            <button class="lc-pane-tab ${ui.leftTab === 'editorial' ? 'active' : ''}" data-action="lc-left-tab" data-tab="editorial">${icon('flask-conical')}Editorial</button>
          </div>
          <div class="lc-desc" id="lc-left-body">${ui.leftTab === 'description' ? descriptionPane(p) : editorialPane(p)}</div>
        </section>
        <div class="lc-gutter" id="lc-gutter" aria-hidden="true"></div>
        <section class="lc-right">
          <div class="lc-pane lc-editor-pane">
            <div class="lc-editor-head">
              <select class="lc-lang-select" id="lc-lang" aria-label="Language">${LANGS.map(([v, l]) => `<option value="${v}" ${ui.language === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <span class="spacer"></span>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="lc-reset" title="Reset to starter code">${icon('rotate-ccw')}</button>
            </div>
            <div class="lc-editor-body" id="lc-editor-mount"></div>
          </div>
          <div class="lc-pane lc-console">
            <div class="lc-pane-tabs">
              <button class="lc-pane-tab ${ui.consoleTab === 'testcase' ? 'active' : ''}" data-action="lc-console-tab" data-tab="testcase">${icon('list-checks')}Testcase</button>
              <button class="lc-pane-tab ${ui.consoleTab === 'result' ? 'active' : ''}" data-action="lc-console-tab" data-tab="result">${icon('terminal')}Test Result</button>
            </div>
            <div class="lc-console-body" id="lc-console-body">${consolePane(p)}</div>
          </div>
        </section>
      </div>
    </div>`;
    b.runIcons();
    mountEditor(p);
    bindGutter();
  }

  function descriptionPane(p) {
    return `<h2>${problems.indexOf(p) + 1}. ${esc(p.title)}</h2>
      <div class="lc-desc-meta"><span class="lc-diff ${p.difficulty.toLowerCase()}">${p.difficulty}</span>${p.tags.map(t => `<span class="lc-tag">${esc(t)}</span>`).join('')}</div>
      ${p.description.split(/\n\n+/).map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('')}
      ${p.examples.map((e, i) => `<div class="lc-example"><h5>Example ${i + 1}</h5><pre><b>Input:</b> ${esc(e.input)}\n<b>Output:</b> ${esc(e.output)}${e.explanation ? `\n<b>Explanation:</b> ${esc(e.explanation)}` : ''}</pre></div>`).join('')}
      <h4>Constraints</h4><ul class="lc-constraints">${p.constraints.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`;
  }

  function editorialPane(p) {
    return `<h2>Editorial</h2>
      <div class="lc-desc-meta"><span class="lc-diff ${p.difficulty.toLowerCase()}">${p.difficulty}</span></div>
      <div class="lc-editorial-block">${p.approach.split(/\n\n+/).map(par => `<p>${esc(par)}</p>`).join('')}</div>
      <div class="lc-complexity"><span>Time ${esc(p.complexity.time)}</span><span>Space ${esc(p.complexity.space)}</span></div>
      ${['javascript', 'python'].map(lang => `<details class="lc-solution-code"><summary>${icon('code-xml')}Reference solution — ${lang === 'javascript' ? 'JavaScript' : 'Python 3'}</summary><pre>${esc(p.solution[lang])}</pre></details>`).join('')}`;
  }

  /* ---------- console panel ---------- */
  function formatArgs(p, args) {
    if (p.judge === 'design') {
      return `ops  = ${JSON.stringify(args[0])}\nargs = ${JSON.stringify(args[1])}`;
    }
    return (p.params.length ? p.params : ['input']).map((name, i) => `${name} = ${JSON.stringify(args[i])}`).join('\n');
  }

  function consolePane(p) {
    if (ui.consoleTab === 'testcase') {
      const t = p.tests[ui.activeCase] || p.tests[0];
      return `${caseChips(p, null)}
        <div class="lc-io-label">Input</div><div class="lc-io">${esc(formatArgs(p, t.args))}</div>
        <div class="lc-io-label">Expected</div><div class="lc-io">${esc(JSON.stringify(t.expected))}</div>`;
    }
    // result tab
    if (ui.running) {
      const note = ui.pyStatus === 'loading'
        ? 'Loading the Python runtime (first run only — this can take ~20 seconds)…'
        : `Running your ${ui.language === 'python' ? 'Python' : 'JavaScript'} code against ${p.tests.length} test cases…`;
      return `<div class="lc-run-note"><span class="lc-spin"></span>${note}</div>`;
    }
    if (!ui.results) return `<div class="lc-run-note">${icon('info')}Run your code to see results for the ${p.tests.length} test cases.</div>`;

    const r = ui.results;
    const verdictClass = r.verdict === 'Accepted' ? 'ok' : 'bad';
    const c = r.cases[ui.activeCase] || r.cases[0];
    const t = p.tests[ui.activeCase] || p.tests[0];
    let detail = '';
    if (c) {
      detail = `<div class="lc-io-label">Input</div><div class="lc-io">${esc(formatArgs(p, t.args))}</div>`;
      if (c.status === 'ok') {
        detail += `<div class="lc-io-label">Your output</div><div class="lc-io ${c.pass ? 'good' : 'bad'}">${esc(JSON.stringify(c.value))}</div>
          <div class="lc-io-label">Expected</div><div class="lc-io">${esc(JSON.stringify(t.expected))}</div>`;
      } else {
        detail += `<div class="lc-io-label">Error</div><div class="lc-io bad">${esc(c.error || 'Unknown error')}</div>`;
      }
      if (c.logs && c.logs.length) detail += `<div class="lc-io-label">Stdout</div><div class="lc-io">${esc(c.logs.join('\n'))}</div>`;
    }
    return `<div class="lc-verdict ${verdictClass} lc-accepted-burst"><strong>${esc(r.verdict)}</strong><small>${r.lang === 'python' ? 'Python 3' : 'JavaScript'} · ${r.totalMs} ms${r.kind === 'submit' && r.verdict === 'Accepted' ? ' · solution saved' : ''}</small></div>
      ${caseChips(p, r.cases)}${detail}`;
  }

  function caseChips(p, cases) {
    return `<div class="lc-cases">${p.tests.map((_, i) => `<button class="lc-case-chip ${ui.activeCase === i ? 'active' : ''}" data-action="lc-case" data-index="${i}"><span class="dot ${cases && cases[i] ? (cases[i].pass ? 'pass' : 'fail') : ''}"></span>Case ${i + 1}</button>`).join('')}</div>`;
  }

  function refreshConsole() {
    const p = current(); if (!p) return;
    const body = document.querySelector('#lc-console-body');
    if (body) { body.innerHTML = consolePane(p); bridge().runIcons(); }
    document.querySelectorAll('.lc-console .lc-pane-tab').forEach(tab =>
      tab.classList.toggle('active', tab.dataset.tab === ui.consoleTab));
    document.querySelectorAll('[data-action="lc-run"],[data-action="lc-submit"]').forEach(btn => btn.disabled = ui.running);
  }

  /* ---------- editor ---------- */
  function starterFor(p, lang) { return savedCode(p.id, lang) ?? p.starter[lang]; }

  function mountEditor(p) {
    const mount = document.querySelector('#lc-editor-mount');
    if (!mount) return;
    const value = starterFor(p, ui.language);
    if (window.CodeMirror) {
      ui.editor = window.CodeMirror(mount, {
        value,
        mode: ui.language === 'python' ? 'python' : 'javascript',
        theme: document.documentElement.classList.contains('dark') ? 'material-darker' : 'default',
        lineNumbers: true, indentUnit: 4, tabSize: 4,
        matchBrackets: true, autoCloseBrackets: true, viewportMargin: 50,
      });
      ui.editor.on('change', scheduleSave);
    } else {
      ui.editor = null;
      mount.innerHTML = `<textarea class="lc-editor-fallback" id="lc-editor-fallback" spellcheck="false"></textarea>`;
      const ta = mount.firstChild;
      ta.value = value;
      ta.addEventListener('input', scheduleSave);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); scheduleSave(); }
      });
    }
  }

  function getCode() {
    if (ui.editor) return ui.editor.getValue();
    const ta = document.querySelector('#lc-editor-fallback');
    return ta ? ta.value : '';
  }
  function setCode(value) {
    if (ui.editor) ui.editor.setValue(value);
    else { const ta = document.querySelector('#lc-editor-fallback'); if (ta) ta.value = value; }
  }
  function scheduleSave() {
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(saveCode, 400);
  }
  function saveCode() {
    const p = current(); if (!p) return;
    const code = getCode();
    if (code && code !== p.starter[ui.language]) localStorage.setItem(codeKey(p.id, ui.language), code);
    else localStorage.removeItem(codeKey(p.id, ui.language));
  }

  /* ---------- runners ---------- */
  const JS_WORKER_SRC = `self.onmessage=function(e){var out;try{var f=new Function(e.data.program+"\\n;return __uzExecute;");out={results:f()(e.data.tests)}}catch(err){out={fatal:String(err&&err.message||err)}}self.postMessage(out);};`;

  const PY_WORKER_SRC = `
var pyodidePromise=null;
function ensurePyodide(){
  if(!pyodidePromise){
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
    pyodidePromise=loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'});
  }
  return pyodidePromise;
}
self.onmessage=function(e){
  self.postMessage({type:'status',value:'loading'});
  ensurePyodide().then(function(py){
    self.postMessage({type:'status',value:'running'});
    var json=py.runPython(e.data.program);
    self.postMessage({type:'done',results:JSON.parse(json)});
  }).catch(function(err){
    self.postMessage({type:'fatal',error:String(err&&err.message||err)});
  });
};`;

  function makeWorker(src) {
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  }

  function runJavascript(p, code, done) {
    let program;
    try { program = harness.composeJsProgram(p, code); }
    catch (err) { return done({ fatal: String(err.message || err) }); }
    const worker = makeWorker(JS_WORKER_SRC);
    const timer = setTimeout(() => { worker.terminate(); done({ fatal: 'Time Limit Exceeded — your code ran longer than 10 seconds. Check for infinite loops.' }); }, RUN_TIMEOUT_MS);
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); done(e.data); };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); done({ fatal: e.message || 'Worker error' }); };
    worker.postMessage({ program, tests: p.tests });
  }

  function runPython(p, code, done, onStatus) {
    let program;
    try { program = harness.composePyProgram(p, code, p.tests, { expression: true }); }
    catch (err) { return done({ fatal: String(err.message || err) }); }
    if (!ui.pyWorker) ui.pyWorker = makeWorker(PY_WORKER_SRC);
    const worker = ui.pyWorker;
    let timer = null;
    const fail = (msg) => { worker.terminate(); ui.pyWorker = null; done({ fatal: msg }); };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'status') {
        onStatus(m.value);
        clearTimeout(timer);
        // Only time-limit actual execution; the first-ever run also downloads the runtime.
        timer = setTimeout(() => fail(m.value === 'loading'
          ? 'Could not load the Python runtime — check your internet connection and try again.'
          : 'Time Limit Exceeded — your code ran longer than 30 seconds.'), m.value === 'loading' ? 120000 : PY_TIMEOUT_MS);
        return;
      }
      clearTimeout(timer);
      worker.onmessage = null;
      if (m.type === 'done') done({ results: m.results });
      else fail(m.error || 'Python runtime error');
    };
    worker.onerror = (e) => { clearTimeout(timer); fail(e.message || 'Python worker error'); };
    worker.postMessage({ program });
  }

  function startRun(kind) {
    const p = current();
    if (!p || ui.running) return;
    saveCode();
    const code = getCode();
    if (!code.trim()) { bridge().toast('Nothing to run', 'Write your solution in the editor first.', 'circle-alert'); return; }
    markProgress(p.id, 'attempted');
    ui.running = true; ui.runKind = kind; ui.results = null; ui.pyStatus = null;
    ui.consoleTab = 'result';
    const token = ++ui.runToken;
    refreshConsole();

    const finish = (payload) => {
      if (token !== ui.runToken) return; // stale run (user navigated / re-ran)
      ui.running = false; ui.pyStatus = null;
      ui.results = buildResults(p, payload, kind);
      if (kind === 'submit' && ui.results.verdict === 'Accepted') {
        markProgress(p.id, 'solved');
        bridge().toast('Accepted 🎉', `${p.title} solved in ${ui.results.lang === 'python' ? 'Python' : 'JavaScript'}.`, 'party-popper');
      }
      refreshConsole();
    };
    const onStatus = (value) => { if (token === ui.runToken) { ui.pyStatus = value; refreshConsole(); } };

    if (ui.language === 'python') runPython(p, code, finish, onStatus);
    else runJavascript(p, code, finish);
  }

  function buildResults(p, payload, kind) {
    const lang = ui.language;
    if (payload.fatal) {
      const tle = /Time Limit/i.test(payload.fatal);
      return { verdict: tle ? 'Time Limit Exceeded' : 'Runtime Error', lang, kind, totalMs: 0,
        cases: p.tests.map(() => ({ status: 'error', pass: false, error: payload.fatal, logs: [], ms: 0 })) };
    }
    const cases = p.tests.map((t, i) => {
      const r = payload.results[i] || { status: 'error', error: 'No result' };
      const pass = r.status === 'ok' && harness.judgeResult(p, t.expected, r.value);
      return { ...r, pass };
    });
    const firstFail = cases.findIndex(c => !c.pass);
    const anyError = cases.some(c => c.status === 'error');
    const verdict = firstFail === -1 ? 'Accepted' : (anyError ? 'Runtime Error' : 'Wrong Answer');
    if (firstFail !== -1) ui.activeCase = firstFail; else ui.activeCase = 0;
    return { verdict, lang, kind, cases, totalMs: cases.reduce((s, c) => s + (c.ms || 0), 0) };
  }

  /* ---------- split-pane drag ---------- */
  function bindGutter() {
    const gutter = document.querySelector('#lc-gutter');
    const shell = document.querySelector('.lc-shell');
    if (!gutter || !shell) return;
    gutter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      gutter.classList.add('dragging');
      gutter.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const rect = shell.getBoundingClientRect();
        const pct = Math.min(70, Math.max(24, (ev.clientX - rect.left) / rect.width * 100));
        shell.style.setProperty('--lc-left', pct + '%');
      };
      const up = () => {
        gutter.classList.remove('dragging');
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', up);
        const val = parseFloat(shell.style.getPropertyValue('--lc-left'));
        if (val) localStorage.setItem('uzone-code-split', val.toFixed(1));
        if (ui.editor) ui.editor.refresh();
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', up);
    });
  }

  /* ---------- actions (delegated from app.js) ---------- */
  function onAction(action, target) {
    const b = bridge();
    switch (action) {
      case 'lc-open': {
        ui.problemId = target.dataset.id;
        ui.leftTab = 'description'; ui.consoleTab = 'testcase'; ui.activeCase = 0;
        ui.results = null; ui.running = false; ui.runToken++;
        b.state.page = 'codingProblem'; b.render(); break;
      }
      case 'lc-back': saveCode(); ui.runToken++; ui.running = false; b.state.page = 'coding'; b.render(); break;
      case 'lc-nav': {
        const p = current(); if (!p) break;
        saveCode();
        const next = problems[problems.indexOf(p) + Number(target.dataset.dir)];
        if (!next) { b.toast('End of the list', 'No more problems in that direction.', 'circle-alert'); break; }
        ui.problemId = next.id; ui.leftTab = 'description'; ui.consoleTab = 'testcase'; ui.activeCase = 0;
        ui.results = null; ui.running = false; ui.runToken++;
        b.render(); break;
      }
      case 'lc-filter': ui.filter = target.dataset.diff; b.render(); break;
      case 'lc-left-tab': {
        ui.leftTab = target.dataset.tab;
        const body = document.querySelector('#lc-left-body');
        const p = current();
        if (body && p) { body.innerHTML = ui.leftTab === 'description' ? descriptionPane(p) : editorialPane(p); b.runIcons(); }
        document.querySelectorAll('.lc-left .lc-pane-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === ui.leftTab));
        break;
      }
      case 'lc-console-tab': ui.consoleTab = target.dataset.tab; refreshConsole(); break;
      case 'lc-case': ui.activeCase = Number(target.dataset.index); refreshConsole(); break;
      case 'lc-run': startRun('run'); break;
      case 'lc-submit': startRun('submit'); break;
      case 'lc-reset':
        b.showModal(`<div class="modal-head"><div><h3>Reset code?</h3><p>Your ${ui.language === 'python' ? 'Python' : 'JavaScript'} code for this problem returns to the starter template.</p></div><button class="modal-close" data-action="close-modal">${icon('x')}</button></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Keep my code</button><button class="btn btn-danger" data-action="lc-reset-confirm">Reset</button></div>`);
        break;
      case 'lc-reset-confirm': {
        const p = current(); if (!p) break;
        localStorage.removeItem(codeKey(p.id, ui.language));
        setCode(p.starter[ui.language]);
        b.closeModal(); b.toast('Code reset', 'Starter template restored.', 'rotate-ccw');
        break;
      }
    }
  }

  /* ---------- global listeners ---------- */
  document.addEventListener('input', (e) => {
    if (e.target.id === 'lc-search') {
      ui.search = e.target.value;
      const rows = document.querySelector('#lc-rows');
      if (rows) { rows.innerHTML = listRows(); bridge().runIcons(); }
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'lc-lang') {
      saveCode();
      ui.language = e.target.value;
      localStorage.setItem('uzone-code-lang', ui.language);
      const p = current(); if (!p) return;
      if (ui.editor) {
        ui.editor.setOption('mode', ui.language === 'python' ? 'python' : 'javascript');
        ui.editor.setValue(starterFor(p, ui.language));
      } else setCode(starterFor(p, ui.language));
      ui.results = null; refreshConsole();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && bridge()?.state.page === 'codingProblem') {
      e.preventDefault(); startRun('run');
    }
  });

  window.UzoneCoding = { listPage, renderWorkspace, onAction };
})();
