import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(toolRoot, 'dist', 'index.js');

test('libvmm help json is stable', () => {
  const result = spawnSync(process.execPath, [cli, '--json', 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.command, 'help');
  assert.equal(payload.status, 'success');
  assert.ok(payload.details.commands);
});

test('libvmm help exposes fetch and patch topics', () => {
  const result = spawnSync(process.execPath, [cli, '--json', 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  const names = payload.details.commands.map((command) => command.name);
  assert.ok(names.includes('fetch'));
  assert.ok(names.includes('patch'));
});
