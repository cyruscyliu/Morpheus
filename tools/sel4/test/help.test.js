import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHelp, getHelp } from '../dist/help.js';

test('main help stays flat', () => {
  const help = renderHelp();
  assert.match(help, /inspect/);
  assert.match(help, /build/);
});

test('command help renders usage', () => {
  const help = renderHelp('build');
  assert.match(help, /--archive-url URL/);
});

test('help metadata is discoverable', () => {
  const command = getHelp('inspect');
  assert.equal(command?.name, 'inspect');
});
