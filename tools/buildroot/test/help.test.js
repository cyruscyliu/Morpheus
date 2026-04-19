import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHelp, getHelp } from '../dist/help.js';

test('main help lists remote commands', () => {
  const help = renderHelp();
  assert.match(help, /remote-build/);
  assert.match(help, /remote-fetch/);
});

test('command help renders usage', () => {
  const help = renderHelp('build');
  assert.match(help, /--source DIR/);
  assert.match(help, /--output DIR/);
});

test('help metadata is discoverable', () => {
  const command = getHelp('remote-build');
  assert.equal(command?.name, 'remote-build');
});
