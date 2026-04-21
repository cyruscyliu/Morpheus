import { spawnSync } from 'node:child_process';
import path from 'node:path';

const bin = path.resolve(process.cwd(), 'dist/index.js');
const result = spawnSync(process.execPath, [bin, '--json', '--help'], {
  encoding: 'utf8',
  cwd: process.cwd(),
});

if (result.status !== 0) {
  process.stderr.write(result.stdout || result.stderr);
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout.trim());
if (payload.command !== 'help') {
  process.stderr.write('unexpected nvirsh help payload\n');
  process.exit(1);
}

process.stdout.write('nvirsh smoke passed\n');
