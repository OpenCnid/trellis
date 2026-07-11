// Wrapper for scripts/test_answer_channel.py: the Session 22 zero-LLM
// by-reference final-answer channel suite (the 55->47 transcription
// regression and the trellis_answer surface). No databases, no network,
// no paid work — the subject is the answer path's tooling shape inside
// the real rlms LocalREPL.
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../src/config/index';

const script = path.resolve('scripts/test_answer_channel.py');

const child = spawn(config.python.executable, [script], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  },
});

child.on('error', err => {
  console.error(`Failed to spawn '${config.python.executable}': ${err.message}. Set PYTHON_EXECUTABLE to your interpreter path.`);
  process.exit(1);
});
child.on('close', code => process.exit(code ?? 1));
