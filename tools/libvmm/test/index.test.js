import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(toolRoot, 'dist', 'index.js');

test('libvmm inspect returns libvmm-dir artifact', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'morpheus-libvmm-inspect-'));
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'VERSION'), '0.0.0\n', 'utf8');

  const result = spawnSync(process.execPath, [cli, '--json', 'inspect', '--path', tmp], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.command, 'inspect');
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.artifact.path, 'libvmm-dir');

  fs.rmSync(tmp, { recursive: true, force: true });
});
