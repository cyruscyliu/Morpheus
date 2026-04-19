import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv } from '../dist/parser.js';

test('parses help with json', () => {
  const parsed = parseArgv(['--json', '--help']);
  assert.equal(parsed.json, true);
  assert.equal(parsed.help, true);
  assert.equal(parsed.command, 'help');
});

test('parses local build flags and passthrough', () => {
  const parsed = parseArgv(['build', '--source', './src', '--output', './out', '--defconfig', 'qemu_x86_64_defconfig', '--make-arg', 'BR2_JLEVEL=8', '--env', 'CC=clang', '--', 'V=1']);
  assert.equal(parsed.command, 'build');
  assert.equal(parsed.options.source, './src');
  assert.equal(parsed.options.output, './out');
  assert.deepEqual(parsed.options.makeArgs, ['BR2_JLEVEL=8']);
  assert.deepEqual(parsed.options.forwarded, ['V=1']);
  assert.deepEqual(parsed.options.env, { CC: 'clang' });
});

test('remote commands are no longer accepted', () => {
  assert.throws(() => parseArgv(['remote-build', '--ssh', 'host:22']), /Unknown command: remote-build/);
});
