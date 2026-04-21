import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHelp, getHelp } from '../dist/help.js';

test('main help stays flat', () => {
  const help = renderHelp();
  assert.match(help, /doctor/);
  assert.match(help, /prepare/);
  assert.doesNotMatch(help, /run\s+show/);
});

test('command help renders usage', () => {
  const help = renderHelp('run');
  assert.match(help, /--kernel PATH/);
  assert.match(help, /--initrd PATH/);
});

test('help metadata is discoverable', () => {
  const command = getHelp('prepare');
  assert.equal(command?.name, 'prepare');
});
