import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHelp, getHelp } from '../dist/help.js';

test('main help stays flat', () => {
  const help = renderHelp();
  assert.match(help, /doctor/);
  assert.doesNotMatch(help, /nvirsh prepare/);
  assert.match(help, /remove/);
  assert.doesNotMatch(help, /clean/);
  assert.doesNotMatch(help, /run\s+show/);
});

test('command help renders usage', () => {
  const help = renderHelp('run');
  assert.match(help, /Morpheus-internal/);
  assert.match(help, /morpheus workflow execution/);
});

test('help metadata is discoverable', () => {
  const command = getHelp('run');
  assert.equal(command?.name, 'run');
});
