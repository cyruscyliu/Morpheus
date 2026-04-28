import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHelp, getHelp } from '../dist/help.js';

test('main help stays local-focused', () => {
  const help = renderHelp();
  assert.doesNotMatch(help, /remote-build/);
  assert.doesNotMatch(help, /remote-fetch/);
});

test('command help renders usage', () => {
  const help = renderHelp('build');
  assert.match(help, /--source DIR/);
  assert.match(help, /--output DIR/);
});

test('help metadata is discoverable', () => {
  const command = getHelp('build');
  assert.equal(command?.name, 'build');
});

test('patch help metadata is discoverable', () => {
  const command = getHelp('patch');
  assert.equal(command?.name, 'patch');
  assert.match(command?.usage?.[0] || '', /--patch-dir DIR/);
});
