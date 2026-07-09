// Wrapper for scripts/test_textedit.py: the Session 20 zero-LLM editing
// toolkit suite. The edit root under test is a token-scoped temp
// directory created HERE and forwarded through the SAME validated-config
// path buildAgentEnv uses in production: the wrapper sets
// TRELLIS_EDIT_ROOT before importing config, so the Zod
// existence/directory validation is exercised end-to-end, and the drill
// receives only operator-validated values. No network, no paid work, no
// databases; every file the drill edits lives in throwaway temp roots.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

const editRoot = mkdtempSync(path.join(os.tmpdir(), 'trellis-textedit-root-'));
process.env.TRELLIS_EDIT_ROOT = editRoot;

void (async () => {
  const { config } = await import('../src/config/index');
  if (config.textedit.editRoot !== editRoot) {
    console.error('Config did not validate the drill edit root — aborting.');
    rmSync(editRoot, { recursive: true, force: true });
    process.exit(1);
  }

  const script = path.resolve('scripts/test_textedit.py');
  const child = spawn(config.python.executable, [script], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
      TRELLIS_EDIT_ROOT: config.textedit.editRoot,
      TRELLIS_TEXTEDIT_MAX_FILE_BYTES: String(config.textedit.maxFileBytes),
      TRELLIS_TEXTEDIT_MAX_FILES: String(config.textedit.maxFiles),
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

  child.on('error', err => {
    console.error(`Failed to spawn '${config.python.executable}': ${err.message}. Set PYTHON_EXECUTABLE to your interpreter path.`);
    rmSync(editRoot, { recursive: true, force: true });
    process.exit(1);
  });
  child.on('close', code => {
    rmSync(editRoot, { recursive: true, force: true });
    process.exit(code ?? 1);
  });
})();
