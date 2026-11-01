import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { SMOKE_QUERIES } from './db-smoke.queries';

/**
 * signal_evaluations has two foreign keys to signals (signal_id, duplicate_of), so
 * an embed between them without a foreign key hint is a PGRST201 at runtime: the
 * API returns HTTP 300 and the read fails. Only the _fkey name resolves that;
 * `signals!inner(` has a "!" but is still ambiguous.
 */
const EMBED = /(?<![\w.])(signals|signal_evaluations)\s*((?:!\s*\w+\s*)*)\(/g;

/** positions has one foreign key to signals, so this embed cannot be ambiguous. */
const SINGLE_FOREIGN_KEY = ['side, signals(timeframe)'];

const REPO = path.resolve(__dirname, '../../..');
const BACKEND_SRC = path.join(REPO, 'backend/src');
const SCANNED = ['backend/src', 'frontend/app', 'frontend/components', 'frontend/lib', 'frontend/utils', 'frontend/middleware.ts'];

/** Every string in the code, with `+` and template parts joined so a split select reads whole. */
function stringsIn(fileName: string, code: string): string[] {
  const file = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const textOf = (node: ts.Node): string => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return textOf(node.left) + textOf(node.right);
    if (ts.isTemplateExpression(node)) return node.getText(file).slice(1, -1);
    if (ts.isParenthesizedExpression(node)) return textOf(node.expression);
    return '${}';
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node)) out.push(textOf(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const embeds = (text: string) => [...text.matchAll(EMBED)];
const hinted = (match: RegExpMatchArray) => /!\s*\w+_fkey\b/.test(match[2]);
const unhinted = (text: string) => !SINGLE_FOREIGN_KEY.includes(text) && embeds(text).some((m) => !hinted(m));
const unhintedIn = (code: string) => stringsIn('sample.ts', code).filter(unhinted);

function sourceFiles(target: string): string[] {
  const full = path.join(REPO, target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(child);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.(spec|d)\.ts$/.test(entry.name) ? [path.join(REPO, child)] : [];
  });
}

const scan = () => SCANNED.flatMap(sourceFiles).map((file) => ({ file: path.relative(REPO, file), strings: stringsIn(file, fs.readFileSync(file, 'utf8')) }));

describe('PostgREST embeds between signals and signal_evaluations', () => {
  it.each([
    ['plain', `from('signal_evaluations').select('id,signals(status)')`],
    ['reverse', `from('signals').select('id,signal_evaluations(eligible)')`],
    ['inner only', `q.select('id,signals!inner(status)')`],
    ['reverse inner only', `q.select('id,signal_evaluations!inner(eligible)')`],
    ['alias', `q.select('id,signal:signals(status)')`],
    ['constant', `const COLUMNS = 'id,signals(status)';`],
    ['multi-line template', 'q.select(`\n  id,\n  signals (\n    status\n  )\n`)'],
    ['template with a value', 'q.select(`${COLUMNS},signals(status)`)'],
    ['concatenated', `q.select('id,signals' + '(status)')`],
  ])('flags %s', (_name, code) => {
    expect(unhintedIn(code)).toHaveLength(1);
  });

  it.each([
    ['signal_id hint', `q.select('id,signals!signal_evaluations_signal_id_fkey(status)')`],
    ['duplicate_of hint', `q.select('id,signals!signal_evaluations_duplicate_of_fkey(status)')`],
    ['hint and inner', `q.select('id,signals!signal_evaluations_signal_id_fkey!inner(status)')`],
    ['reverse hint', `q.select('id,signal_evaluations!signal_evaluations_signal_id_fkey(eligible)')`],
    ['aliased hint', `q.select('id,signal:signals!signal_evaluations_signal_id_fkey(status)')`],
    ['method call', `this.signals(status); signals(status); this.signals.evaluate(tf);`],
    ['table name', `from('signals').select('id')`],
    ['method-like text', `'foo.signals(x)'; 'my_signals(x)'`],
  ])('allows %s', (_name, code) => {
    expect(unhintedIn(code)).toEqual([]);
  });

  it('finds no embed without a foreign key hint in the backend or frontend', () => {
    const found = scan().flatMap(({ file, strings }) => strings.filter(unhinted).map((text) => `${file}: ${text}`));
    expect(found).toEqual([]);
  });

  it('actually reads the ledger embed, so an empty scan cannot pass', () => {
    const ledger = scan().find(({ file }) => file === 'backend/src/v1/ledger/forward-test.service.ts');
    expect(ledger?.strings.some((text) => embeds(text).some(hinted))).toBe(true);
  });

  it('keeps every embed in the smoke check', () => {
    const smoked = new Set(SMOKE_QUERIES.map((q) => q.select));
    const missing = scan()
      .filter(({ file }) => !file.endsWith('db-smoke.queries.ts'))
      .flatMap(({ strings }) => strings.filter((text) => embeds(text).length > 0 && !smoked.has(text)));
    expect(missing).toEqual([]);
  });

  it.each(SMOKE_QUERIES.map((q) => [q.name, q] as const))('smoke select matches its source: %s', (_name, query) => {
    const file = path.join(BACKEND_SRC, query.source);
    expect(stringsIn(file, fs.readFileSync(file, 'utf8'))).toContain(query.select);
  });
});
