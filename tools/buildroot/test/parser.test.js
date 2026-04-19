import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv } from '../dist/parser.js';
import { parseSshTarget } from '../dist/ssh.js';

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

test('parses ssh targets with ports', () => {
  assert.deepEqual(parseSshTarget('alice@example.com:2222'), {
    original: 'alice@example.com:2222',
    user: 'alice',
    host: 'example.com',
    port: 2222,
  });
  assert.deepEqual(parseSshTarget('ssh://alice@example.com:2200'), {
    original: 'ssh://alice@example.com:2200',
    user: 'alice',
    host: 'example.com',
    port: 2200,
  });
});

test('remote-fetch requires explicit paths', () => {
  assert.throws(() => parseArgv(['remote-fetch', '--ssh', 'host:22', '--workspace', 'workflow-workspace', '--id', 'br-1', '--dest', './artifacts']), /remote-fetch requires at least one --path/);
});
