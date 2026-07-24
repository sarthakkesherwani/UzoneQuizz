/* Shared judge harness for the Code practice feature.
   One source of truth used in three places:
     - the browser main thread (composing programs + judging results)
     - the execution Web Worker (runs the composed program)
     - Node verification scripts (scripts/verify-coding-problem.js)

   Problem spec contract (scripts/lc-data/*.json):
     judge: "exact" | "float" | "unordered" | "unordered_inner"
          | "inplace" | "design" | "tree_roundtrip"
     argStructures: { paramName: "list" | "tree" | "list_cycle" }
     resultStructure: "list" | "tree"
     tests: [{ args: [...], expected: <JSON> }]  (exactly 3)

   Conventions (LeetCode style):
     JS   — `var twoSum = function (nums, target) {}`; design problems use
            `class LRUCache {}`; tree_roundtrip uses `var serialize` +
            `var deserialize` functions.
     Py   — `class Solution:` with the method named by functionName; design
            problems define the class named by functionName; tree_roundtrip
            defines `class Codec:` with serialize/deserialize methods.
     design tests — args: [opsArray, argsArray] in LeetCode ops format,
            expected: outputs array (first entry null for the constructor).
     list_cycle arg value — { "values": [...], "pos": <int> }.
     Trees/lists cross the boundary as LeetCode-style arrays (level order
     with nulls, trailing nulls trimmed / plain value arrays). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UzoneCodingHarness = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- Data-structure helpers, kept as source so the exact same code runs
         inside the sandboxed worker program. --- */
  const STRUCT_SRC = `
function ListNode(val, next) { this.val = (val === undefined ? 0 : val); this.next = (next === undefined ? null : next); }
function TreeNode(val, left, right) { this.val = (val === undefined ? 0 : val); this.left = (left === undefined ? null : left); this.right = (right === undefined ? null : right); }
function __uzArrayToList(values) {
  var dummy = new ListNode(0), tail = dummy;
  (values || []).forEach(function (v) { tail.next = new ListNode(v); tail = tail.next; });
  return dummy.next;
}
function __uzListToArray(head) {
  var out = [], seen = 0;
  while (head) { out.push(head.val); head = head.next; if (++seen > 100000) throw new Error('List too long (possible cycle in returned list)'); }
  return out;
}
function __uzBuildCycleList(desc) {
  var head = __uzArrayToList(desc.values);
  if (desc.pos == null || desc.pos < 0) return head;
  var tail = head, target = head, i;
  if (!head) return head;
  while (tail.next) tail = tail.next;
  for (i = 0; i < desc.pos; i++) target = target.next;
  tail.next = target;
  return head;
}
function __uzArrayToTree(values) {
  if (!values || !values.length || values[0] == null) return null;
  var rootNode = new TreeNode(values[0]), queue = [rootNode], i = 1;
  while (queue.length && i < values.length) {
    var node = queue.shift();
    if (i < values.length) { if (values[i] != null) { node.left = new TreeNode(values[i]); queue.push(node.left); } i++; }
    if (i < values.length) { if (values[i] != null) { node.right = new TreeNode(values[i]); queue.push(node.right); } i++; }
  }
  return rootNode;
}
function __uzTreeToArray(rootNode) {
  if (!rootNode) return [];
  var out = [], queue = [rootNode];
  while (queue.length) {
    var node = queue.shift();
    if (node) { out.push(node.val); queue.push(node.left); queue.push(node.right); }
    else out.push(null);
    if (out.length > 100000) throw new Error('Tree too large');
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}
function __uzConvertArg(value, kind) {
  if (kind === 'list') return __uzArrayToList(value);
  if (kind === 'tree') return __uzArrayToTree(value);
  if (kind === 'list_cycle') return __uzBuildCycleList(value);
  if (kind === 'list_array') return (value || []).map(__uzArrayToList);
  return value;
}
function __uzConvertResult(value, kind) {
  if (kind === 'list') return __uzListToArray(value);
  if (kind === 'tree') return __uzTreeToArray(value);
  return value;
}
`;

  const structs = new Function(STRUCT_SRC + `
return { ListNode: ListNode, TreeNode: TreeNode, arrayToList: __uzArrayToList, listToArray: __uzListToArray,
         buildCycleList: __uzBuildCycleList, arrayToTree: __uzArrayToTree, treeToArray: __uzTreeToArray };`)();

  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const JUDGES = ['exact', 'float', 'unordered', 'unordered_inner', 'inplace', 'design', 'tree_roundtrip'];
  const STRUCTURES = ['list', 'tree', 'list_cycle', 'list_array'];

  /* --- Composing the sandboxed JS program. The returned source defines
         __uzExecute(tests) -> [{status:'ok', value, logs, ms} | {status:'error', error, logs, ms}] --- */
  function composeJsProgram(spec, userCode) {
    const fname = spec.functionName;
    if (!IDENT.test(fname)) throw new Error('Invalid functionName: ' + fname);
    const params = JSON.stringify(spec.params || []);
    const argStructures = JSON.stringify(spec.argStructures || {});
    const resultStructure = JSON.stringify(spec.resultStructure || null);
    const judge = JSON.stringify(spec.judge);
    const inplaceArg = JSON.stringify(spec.inplaceArg == null ? null : spec.inplaceArg);

    let invoke;
    if (spec.judge === 'design') {
      invoke = `
      var __Cls = (typeof ${fname} !== 'undefined') ? ${fname} : undefined;
      if (typeof __Cls !== 'function') throw new Error('Expected a class named ${fname}');
      var __ops = __args[0], __opArgs = __args[1], __inst = null, __out = [];
      for (var __i = 0; __i < __ops.length; __i++) {
        if (__i === 0) { __inst = new __Cls(...(__opArgs[0] || [])); __out.push(null); }
        else {
          if (!__inst || typeof __inst[__ops[__i]] !== 'function') throw new Error('Unknown operation: ' + __ops[__i]);
          var __r = __inst[__ops[__i]](...(__opArgs[__i] || []));
          __out.push(__r === undefined ? null : __r);
        }
      }
      var __value = __out;`;
    } else if (spec.judge === 'tree_roundtrip') {
      invoke = `
      var __ser = (typeof serialize !== 'undefined') ? serialize : undefined;
      var __des = (typeof deserialize !== 'undefined') ? deserialize : undefined;
      if (typeof __ser !== 'function' || typeof __des !== 'function') throw new Error('Expected functions named serialize and deserialize');
      var __root = __uzArrayToTree(__args[0]);
      var __value = __uzTreeToArray(__des(__ser(__root)));`;
    } else {
      invoke = `
      var __fn = (typeof ${fname} !== 'undefined') ? ${fname} : undefined;
      if (typeof __fn !== 'function') throw new Error('Expected a function named ${fname}');
      var __conv = __args.map(function (a, i) { return __uzConvertArg(a, __argStructures[__params[i]]); });
      var __ret = __fn.apply(null, __conv);
      var __value;
      if (__judge === 'inplace') {
        var __target = __conv[__inplaceArg == null ? 0 : __inplaceArg];
        var __kind = __argStructures[__params[__inplaceArg == null ? 0 : __inplaceArg]];
        __value = __uzConvertResult(__target, __kind);
      } else {
        __value = __uzConvertResult(__ret, __resultStructure);
      }`;
    }

    return `"use strict";
${STRUCT_SRC}
var __logs = [];
function __uzFmt(v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (_) { return String(v); } }
var console = { log: __uzLog, info: __uzLog, warn: __uzLog, error: __uzLog, debug: __uzLog };
function __uzLog() { if (__logs.length < 200) __logs.push(Array.prototype.slice.call(arguments).map(__uzFmt).join(' ')); }
${userCode}
function __uzExecute(__tests) {
  var __params = ${params}, __argStructures = ${argStructures}, __resultStructure = ${resultStructure};
  var __judge = ${judge}, __inplaceArg = ${inplaceArg};
  var __results = [];
  for (var __t = 0; __t < __tests.length; __t++) {
    __logs = [];
    var __start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      var __args = JSON.parse(JSON.stringify(__tests[__t].args));
      ${invoke}
      var __safe = (__value === undefined) ? null : JSON.parse(JSON.stringify(__value));
      __results.push({ status: 'ok', value: __safe, logs: __logs.slice(),
        ms: Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - __start) });
    } catch (__err) {
      __results.push({ status: 'error', error: String(__err && __err.message ? __err.message : __err), logs: __logs.slice(),
        ms: Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - __start) });
    }
  }
  return __results;
}`;
  }

  /* --- Python mirror. composePyProgram returns a full program; when
         opts.expression is true the program's last statement evaluates to the
         JSON results string (for Pyodide), otherwise it prints it (for the
         python3 subprocess used by verification). --- */
  const PY_PRELUDE = `
import json, sys, io, time, contextlib
sys.setrecursionlimit(20000)

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def _uz_array_to_list(values):
    dummy = ListNode(0); tail = dummy
    for v in (values or []):
        tail.next = ListNode(v); tail = tail.next
    return dummy.next

def _uz_list_to_array(head):
    out = []; seen = 0
    while head is not None:
        out.append(head.val); head = head.next; seen += 1
        if seen > 100000: raise RuntimeError('List too long (possible cycle in returned list)')
    return out

def _uz_build_cycle_list(desc):
    head = _uz_array_to_list(desc.get('values'))
    pos = desc.get('pos', -1)
    if head is None or pos is None or pos < 0: return head
    tail = head; target = head
    while tail.next is not None: tail = tail.next
    for _ in range(pos): target = target.next
    tail.next = target
    return head

def _uz_array_to_tree(values):
    if not values or values[0] is None: return None
    root = TreeNode(values[0]); queue = [root]; i = 1
    while queue and i < len(values):
        node = queue.pop(0)
        if i < len(values):
            if values[i] is not None:
                node.left = TreeNode(values[i]); queue.append(node.left)
            i += 1
        if i < len(values):
            if values[i] is not None:
                node.right = TreeNode(values[i]); queue.append(node.right)
            i += 1
    return root

def _uz_tree_to_array(root):
    if root is None: return []
    out = []; queue = [root]
    while queue:
        node = queue.pop(0)
        if node is not None:
            out.append(node.val); queue.append(node.left); queue.append(node.right)
        else:
            out.append(None)
        if len(out) > 100000: raise RuntimeError('Tree too large')
    while out and out[-1] is None: out.pop()
    return out

def _uz_convert_arg(value, kind):
    if kind == 'list': return _uz_array_to_list(value)
    if kind == 'tree': return _uz_array_to_tree(value)
    if kind == 'list_cycle': return _uz_build_cycle_list(value)
    if kind == 'list_array': return [_uz_array_to_list(v) for v in (value or [])]
    return value

def _uz_convert_result(value, kind):
    if kind == 'list': return _uz_list_to_array(value)
    if kind == 'tree': return _uz_tree_to_array(value)
    return value

def _uz_run_tests(_uz_spec, _uz_tests, _uz_ns):
    results = []
    fname = _uz_spec['functionName']
    params = _uz_spec.get('params') or []
    arg_structs = _uz_spec.get('argStructures') or {}
    res_struct = _uz_spec.get('resultStructure')
    judge = _uz_spec['judge']
    inplace_arg = _uz_spec.get('inplaceArg') or 0
    for test in _uz_tests:
        buf = io.StringIO()
        _uz_t0 = time.perf_counter()
        try:
            args = json.loads(json.dumps(test['args']))
            with contextlib.redirect_stdout(buf):
                if judge == 'design':
                    cls = _uz_ns.get(fname)
                    if cls is None: raise RuntimeError('Expected a class named ' + fname)
                    ops, op_args = args[0], args[1]
                    inst = None; out = []
                    for i, op in enumerate(ops):
                        if i == 0:
                            inst = cls(*(op_args[0] or [])); out.append(None)
                        else:
                            r = getattr(inst, op)(*(op_args[i] or []))
                            out.append(None if r is None else r)
                    value = out
                elif judge == 'tree_roundtrip':
                    cls = _uz_ns.get(fname)
                    if cls is None: raise RuntimeError('Expected a class named ' + fname)
                    codec = cls()
                    root = _uz_array_to_tree(args[0])
                    value = _uz_tree_to_array(codec.deserialize(codec.serialize(root)))
                else:
                    sol_cls = _uz_ns.get('Solution')
                    if sol_cls is None: raise RuntimeError('Expected a class named Solution')
                    method = getattr(sol_cls(), fname)
                    conv = [_uz_convert_arg(a, arg_structs.get(params[i]) if i < len(params) else None) for i, a in enumerate(args)]
                    ret = method(*conv)
                    if judge == 'inplace':
                        value = _uz_convert_result(conv[inplace_arg], arg_structs.get(params[inplace_arg]) if inplace_arg < len(params) else None)
                    else:
                        value = _uz_convert_result(ret, res_struct)
            logs = [line for line in buf.getvalue().splitlines() if line][:200]
            results.append({'status': 'ok', 'value': json.loads(json.dumps(value)), 'logs': logs,
                            'ms': round((time.perf_counter() - _uz_t0) * 1000)})
        except BaseException as exc:
            logs = [line for line in buf.getvalue().splitlines() if line][:200]
            results.append({'status': 'error', 'error': type(exc).__name__ + ': ' + str(exc), 'logs': logs,
                            'ms': round((time.perf_counter() - _uz_t0) * 1000)})
    return results
`;

  function pyLiteral(value) {
    // Double-encoding produces a JSON string literal, which is also a valid
    // Python string literal for json.loads.
    return 'json.loads(' + JSON.stringify(JSON.stringify(value)) + ')';
  }

  function composePyProgram(spec, userCode, tests, opts) {
    const runtimeSpec = {
      functionName: spec.functionName, params: spec.params || [],
      argStructures: spec.argStructures || {}, resultStructure: spec.resultStructure || null,
      judge: spec.judge, inplaceArg: spec.inplaceArg == null ? 0 : spec.inplaceArg
    };
    const tail = (opts && opts.expression)
      ? '_uz_result_json'
      : 'print(_uz_result_json)';
    return PY_PRELUDE + `
_uz_user_ns = dict(globals())
_uz_user_code = ${pyLiteral(userCode)}
exec(_uz_user_code, _uz_user_ns)
_uz_results = _uz_run_tests(${pyLiteral(runtimeSpec)}, ${pyLiteral(tests)}, _uz_user_ns)
_uz_result_json = json.dumps(_uz_results)
${tail}
`;
  }

  /* --- Judging (always on plain JSON values). --- */
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'number' && Object.is(value, -0)) return '0';
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }

  function numbersClose(a, b, eps) {
    if (a === b) return true;
    return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
  }

  function deepEqual(a, b, eps) {
    if (typeof a === 'number' && typeof b === 'number') return numbersClose(a, b, eps);
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => deepEqual(item, b[i], eps));
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k], eps));
  }

  function canonicalizeUnordered(arr, sortInner) {
    return arr
      .map(item => (sortInner && Array.isArray(item)) ? [...item].sort((x, y) => (stableStringify(x) < stableStringify(y) ? -1 : 1)) : item)
      .map(stableStringify)
      .sort();
  }

  function judgeResult(spec, expected, actual) {
    switch (spec.judge) {
      case 'float':
        return typeof actual === 'number' && typeof expected === 'number' && numbersClose(actual, expected, 1e-5);
      case 'unordered':
      case 'unordered_inner': {
        if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false;
        const inner = spec.judge === 'unordered_inner';
        const ce = canonicalizeUnordered(expected, inner), ca = canonicalizeUnordered(actual, inner);
        return ce.every((item, i) => item === ca[i]);
      }
      case 'exact':
      case 'inplace':
      case 'design':
      case 'tree_roundtrip':
      default:
        return deepEqual(expected, actual, 1e-6);
    }
  }

  /* --- Spec validation shared by the verify + build scripts. --- */
  function validateSpec(spec) {
    const errors = [];
    const need = (cond, msg) => { if (!cond) errors.push(msg); };
    need(spec && typeof spec === 'object', 'spec must be an object');
    if (!spec || typeof spec !== 'object') return errors;
    need(typeof spec.id === 'string' && /^lc-[a-z0-9-]+$/.test(spec.id), 'id must match ^lc-[a-z0-9-]+$');
    need(typeof spec.title === 'string' && spec.title.length >= 3, 'title required');
    need(['Easy', 'Medium', 'Hard'].includes(spec.difficulty), 'difficulty must be Easy|Medium|Hard');
    need(Array.isArray(spec.tags) && spec.tags.length >= 1 && spec.tags.every(t => typeof t === 'string'), 'tags required');
    need(typeof spec.description === 'string' && spec.description.length >= 80, 'description must be a substantial problem statement');
    need(Array.isArray(spec.examples) && spec.examples.length >= 1 && spec.examples.length <= 4
      && spec.examples.every(e => e && typeof e.input === 'string' && typeof e.output === 'string'), 'examples: 1-4 of {input, output, explanation?}');
    need(Array.isArray(spec.constraints) && spec.constraints.length >= 1 && spec.constraints.every(c => typeof c === 'string'), 'constraints required');
    need(typeof spec.functionName === 'string' && IDENT.test(spec.functionName), 'functionName must be a valid identifier');
    need(Array.isArray(spec.params) && spec.params.every(p => typeof p === 'string' && IDENT.test(p)), 'params must be identifiers');
    need(JUDGES.includes(spec.judge), 'judge must be one of ' + JUDGES.join('|'));
    if (spec.judge === 'inplace') need(Number.isInteger(spec.inplaceArg) && spec.inplaceArg >= 0 && spec.inplaceArg < (spec.params || []).length, 'inplace judge needs a valid inplaceArg');
    if (spec.argStructures) {
      need(typeof spec.argStructures === 'object' && !Array.isArray(spec.argStructures), 'argStructures must be an object');
      for (const [k, v] of Object.entries(spec.argStructures)) {
        need((spec.params || []).includes(k), 'argStructures key not in params: ' + k);
        need(STRUCTURES.includes(v), 'argStructures value must be list|tree|list_cycle, got ' + v);
      }
    }
    if (spec.resultStructure != null) need(['list', 'tree'].includes(spec.resultStructure), 'resultStructure must be list|tree');
    for (const lang of ['javascript', 'python']) {
      need(spec.starter && typeof spec.starter[lang] === 'string' && spec.starter[lang].length >= 10, 'starter.' + lang + ' required');
      need(spec.solution && typeof spec.solution[lang] === 'string' && spec.solution[lang].length >= 20, 'solution.' + lang + ' required');
    }
    if (spec.starter && spec.solution && spec.starter.javascript === spec.solution.javascript) errors.push('JS starter must differ from solution');
    need(typeof spec.approach === 'string' && spec.approach.length >= 40, 'approach (editorial text) required');
    need(spec.complexity && typeof spec.complexity.time === 'string' && typeof spec.complexity.space === 'string', 'complexity {time, space} required');
    need(Array.isArray(spec.tests) && spec.tests.length === 3, 'exactly 3 tests required');
    (spec.tests || []).forEach((t, i) => {
      need(t && Array.isArray(t.args), 'tests[' + i + '].args must be an array');
      need(t && 'expected' in t, 'tests[' + i + '].expected required');
      try { JSON.parse(JSON.stringify(t)); } catch (_) { errors.push('tests[' + i + '] must be JSON-safe'); }
    });
    return errors;
  }

  return {
    STRUCT_SRC, PY_PRELUDE, structs,
    composeJsProgram, composePyProgram,
    judgeResult, deepEqual, stableStringify, validateSpec,
    JUDGES, STRUCTURES
  };
});
