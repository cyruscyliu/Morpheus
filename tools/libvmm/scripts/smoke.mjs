import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd());
const cli = path.join(root, 'tools', 'libvmm', 'dist', 'index.js');

const result = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'smoke failed\n');
  process.exitCode = 1;
} else {
  process.stdout.write('ok\n');
}

