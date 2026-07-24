#!/usr/bin/env node
/* Verifies a Code-practice problem spec (scripts/lc-data/<id>.json).
   Checks the schema, then runs BOTH reference solutions (JavaScript in-process,
   Python via python3) against all 3 tests through the shared harness, and
   ensures the starter code does NOT already pass. Exits non-zero on failure.

   Usage: node scripts/verify-coding-problem.js scripts/lc-data/<id>.json [...more] */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const harness = require(path.join(__dirname, '..', 'coding-harness.js'));

function runJs(spec, code) {
  const program = harness.composeJsProgram(spec, code);
  const factory = new Function(program + '\n;return __uzExecute;');
  return factory()(spec.tests);
}

function runPy(spec, code) {
  const program = harness.composePyProgram(spec, code, spec.tests, { expression: false });
  const stdout = execFileSync('python3', ['-c', program], { timeout: 60000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const lines = stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

function judgeAll(spec, results) {
  return spec.tests.map((test, i) => {
    const r = results[i];
    if (!r || r.status !== 'ok') return { pass: false, detail: r ? r.error : 'no result' };
    const pass = harness.judgeResult(spec, test.expected, r.value);
    return { pass, detail: pass ? '' : `expected ${JSON.stringify(test.expected)} got ${JSON.stringify(r.value)}` };
  });
}

function verify(file) {
  const problems = [];
  let spec;
  try { spec = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { return [`cannot read/parse JSON: ${err.message}`]; }

  problems.push(...harness.validateSpec(spec));
  if (problems.length) return problems;

  const expectedId = path.basename(file, '.json');
  if (spec.id !== expectedId) problems.push(`id "${spec.id}" must match filename "${expectedId}"`);

  for (const [lang, runner] of [['javascript', runJs], ['python', runPy]]) {
    let results;
    try { results = runner(spec, spec.solution[lang]); }
    catch (err) { problems.push(`${lang} solution crashed the runner: ${err.message}`); continue; }
    judgeAll(spec, results).forEach((v, i) => {
      if (!v.pass) problems.push(`${lang} solution FAILS test ${i + 1}: ${v.detail}`);
    });

    let starterResults;
    try { starterResults = runner(spec, spec.starter[lang]); }
    catch (err) { starterResults = spec.tests.map(() => ({ status: 'error', error: err.message })); }
    if (judgeAll(spec, starterResults).every(v => v.pass)) {
      problems.push(`${lang} starter code already passes all tests — starter must be an empty template and tests must require real work`);
    }
  }
  return problems;
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node scripts/verify-coding-problem.js <spec.json> [...more]'); process.exit(2); }

let failed = 0;
for (const file of files) {
  const problems = verify(file);
  if (problems.length) {
    failed++;
    console.log(`FAIL ${file}`);
    problems.forEach(p => console.log(`  - ${p}`));
  } else {
    console.log(`PASS ${file}`);
  }
}
console.log(failed ? `\n${failed}/${files.length} spec(s) failed` : `\nALL PASS (${files.length} spec(s))`);
process.exit(failed ? 1 : 0);
