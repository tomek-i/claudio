// A node:test reporter for CI (.github/workflows/test.yml): one line per test file, and only the failures in full, in
// red, each with its error and where it happened. On GitHub Actions each failure is also an annotation (::error), shown
// on the pull request's checks page without opening the log.
//   node --test --test-reporter=./test/ci-reporter.mjs --test-reporter-destination=stdout test/*.test.mjs
import path from 'node:path';
import { inspect } from 'node:util';

const GH = !!process.env.GITHUB_ACTIONS;
const red = (s) => `\x1b[31m${s}\x1b[0m`, green = (s) => `\x1b[32m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const rel = (f) => (f ? path.relative(process.cwd(), f.startsWith('file:') ? new URL(f).pathname : f).replaceAll('\\', '/') : '?');
// the workflow command's own escaping: a message keeps its line breaks
const esc = (s) => String(s).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export default async function* ciReporter(source) {
  const files = new Map(); // file → { pass, fail, skip }
  const failures = [];
  let pass = 0, fail = 0, skip = 0;
  const count = (file) => files.get(file) || (files.set(file, { pass: 0, fail: 0, skip: 0 }), files.get(file));
  for await (const { type, data } of source) {
    if (type === 'test:pass' && data.details?.type !== 'suite') {
      const c = count(rel(data.file));
      if (data.skip || data.todo) { c.skip++; skip++; } else { c.pass++; pass++; }
    } else if (type === 'test:fail') {
      const err = data.details?.error;
      if (err?.failureType === 'subtestsFailed') continue; // a suite or a file whose tests failed: those are reported
      const file = rel(data.file);
      count(file).fail++; fail++;
      const cause = err?.cause ?? err;
      // the runner's own frames (node:internal, async_hooks, …) say nothing about the test
      const msg = cause instanceof Error ? (cause.stack || cause.message).split('\n').filter((l) => !/^\s+at (.*\()?(node:|new Promise|Array\.map)/.test(l)).join('\n') : inspect(cause, { depth: 4 });
      failures.push({ file, line: data.line, name: data.name, msg });
      yield `${red('✖ FAIL')} ${file}:${data.line ?? '?'}  ${data.name}\n${msg.replace(/^/gm, '    ')}\n\n`;
      if (GH) yield `::error file=${file},line=${data.line ?? 1},title=${esc(data.name)}::${esc(msg)}\n`;
    } // everything else (the tests' own output, the runner's diagnostics) is left out
  }
  let out = '\n';
  for (const [file, c] of [...files].sort()) {
    const mark = c.fail ? red('✖') : green('✔');
    out += `${mark} ${file}  ${c.pass} passed${c.fail ? red(`, ${c.fail} failed`) : ''}${c.skip ? dim(`, ${c.skip} skipped`) : ''}\n`;
  }
  out += `\n${fail ? red(`${fail} failed`) : green('all passed')}, ${pass} passed, ${skip} skipped\n`;
  if (failures.length) out += `\n${red('Failed:')}\n${failures.map((f) => `  ${f.file}:${f.line ?? '?'}  ${f.name}`).join('\n')}\n`;
  yield out;
}
