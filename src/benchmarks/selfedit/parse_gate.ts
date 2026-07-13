// Session 37 (REPOSITORY_INGESTION_REPORT.md §5f): the stage-2 parse
// gate — a POST-RUN mechanical check that the named files still parse
// after a self-edit run, never a write gate (guardrail 5's mold). The
// Session 36 run 1 shipped a syntax-broken trellis_tools.py that the
// checker's recorded scope (consultation + diff scope, §5e.2) could
// not see; a parse failure is mechanically decidable and belongs here.
//
// Language-aware by extension: .py spawns the operator-configured
// interpreter (the config.python.executable seam) running the builtin
// compile() over the file bytes — the same syntax check `python -m
// py_compile` performs, WITHOUT py_compile's bytecode write into
// __pycache__ (the checker is read-only everywhere; writing .pyc into
// the edit root would violate that and dirty the reviewed tree).
// .ts/.js parse through the TypeScript compiler's single-file source
// parse (parse diagnostics only — no project resolution, no type
// check, no emit). Extensions with no parser wired are recorded as
// language null and never produce a finding: the gate is honest about
// what it checks.
//
// The pure evaluation (checkParseResults) lives in check.ts with the
// other finding logic; this module holds the gatherers, whose only
// I/O is reading the named files and spawning the interpreter.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import util from 'util';
import ts from 'typescript';
import { FileParseResult, parseGateLanguage } from './check';

const execFileAsync = util.promisify(execFile);

/** Bound carried into finding details; keep refusal-style short. */
const ERROR_DETAIL_MAX_CHARS = 200;

function bounded(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > ERROR_DETAIL_MAX_CHARS
    ? `${oneLine.slice(0, ERROR_DETAIL_MAX_CHARS)}…`
    : oneLine;
}

// The builtin compile() is exactly the syntax check py_compile runs
// (py_compile.compile calls it, then writes bytecode — the write is
// what we must not do). Reads bytes so the interpreter honors PEP 263
// encoding declarations the way an import would.
const PYTHON_PARSE_DRIVER =
  'import sys\n' +
  "with open(sys.argv[1], 'rb') as f:\n" +
  '    source = f.read()\n' +
  "compile(source, sys.argv[1], 'exec')\n";

/**
 * Syntax-parses one Python file with the configured interpreter.
 * Returns null when the file parses; otherwise a bounded one-line
 * description built from the interpreter's traceback (the SyntaxError
 * line plus its `line N` location when present).
 */
export async function parsePythonFile(
  pythonExecutable: string,
  filePath: string
): Promise<string | null> {
  try {
    await execFileAsync(pythonExecutable, ['-c', PYTHON_PARSE_DRIVER, filePath], {
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    return null;
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    const lines = stderr
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '');
    const errorLine = [...lines].reverse().find(l => /^\w*Error\b/.test(l));
    const locationLine = lines.find(l => /, line \d+/.test(l));
    if (errorLine) {
      const location = locationLine?.match(/line \d+/)?.[0];
      return bounded(location ? `${errorLine} (${location})` : errorLine);
    }
    // Interpreter failed for a non-syntax reason (missing binary is an
    // execFile error with no stderr): surface it rather than pass.
    const message = err instanceof Error ? err.message : String(err);
    return bounded(lines[lines.length - 1] ?? message);
  }
}

/**
 * Syntax-parses TypeScript/JavaScript source text. Pure: text in,
 * first parse diagnostic out (null = parses). Single-file parse only —
 * ts.createSourceFile records syntactic diagnostics as it parses; no
 * program, no module resolution, no type check, no emit.
 */
export function parseTypeScriptSource(fileName: string, text: string): string | null {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const diagnostics =
    (source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length === 0) return null;
  const first = diagnostics[0];
  const message = ts.flattenDiagnosticMessageText(first.messageText, ' ');
  if (first.start !== undefined) {
    const { line } = source.getLineAndCharacterOfPosition(first.start);
    return bounded(`${message} (line ${line + 1})`);
  }
  return bounded(message);
}

/**
 * Gathers per-named-file parse results under the edit root. A named
 * file with a wired parser that is missing on disk is unparseable (a
 * deleted named file cannot be reviewed as working code); a file whose
 * extension has no parser wired reports language null and parseable —
 * checkParseResults never flags it.
 */
export async function gatherParseResults(
  editRoot: string,
  namedFiles: string[],
  pythonExecutable: string
): Promise<FileParseResult[]> {
  const results: FileParseResult[] = [];
  for (const file of namedFiles) {
    const language = parseGateLanguage(file);
    if (language === null) {
      results.push({ file, language, parseable: true });
      continue;
    }
    const resolved = path.resolve(editRoot, file);
    if (!fs.existsSync(resolved)) {
      results.push({ file, language, parseable: false, error: 'named file missing under the edit root' });
      continue;
    }
    if (language === 'python') {
      const error = await parsePythonFile(pythonExecutable, resolved);
      results.push(error === null ? { file, language, parseable: true } : { file, language, parseable: false, error });
    } else {
      const text = await fs.promises.readFile(resolved, 'utf-8');
      const error = parseTypeScriptSource(file, text);
      results.push(error === null ? { file, language, parseable: true } : { file, language, parseable: false, error });
    }
  }
  return results;
}
