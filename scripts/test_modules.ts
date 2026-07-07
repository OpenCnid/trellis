// Wrapper for scripts/test_modules.py: the Session 15 module-registry
// suite. The selection under test is built with the same Node-side
// helpers config uses and forwarded via TRELLIS_MODULES exactly as
// rlm_worker.ts forwards it to a production agent run, so the suite
// pins the cross-language registry contract along the real delivery
// path. Zero paid work, no databases, no network.
import { createHash } from 'node:crypto';
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../src/config/index';
import {
  loadModules,
  parseModuleSelection,
  serializeModuleSelection,
} from '../src/config/modules';

const script = path.resolve('scripts/test_modules.py');

// The default selection through the real validator (fail-fast at load),
// plus the Node-side addendum hash so the Python drill can pin that
// both loaders read byte-identical text (LF normalization included).
const selection = parseModuleSelection(undefined);
const [module0] = loadModules(selection);
const module0Sha = createHash('sha256').update(module0.addendumText, 'utf-8').digest('hex');

const child = spawn(config.python.executable, [script], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    TRELLIS_MODULES: serializeModuleSelection(selection),
    TRELLIS_TEST_MODULE0_SHA: module0Sha,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  },
});

child.on('error', err => {
  console.error(`Failed to spawn '${config.python.executable}': ${err.message}. Set PYTHON_EXECUTABLE to your interpreter path.`);
  process.exit(1);
});
child.on('close', code => process.exit(code ?? 1));
