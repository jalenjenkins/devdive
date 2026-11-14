'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../public/ui');
const { LAYERS, TIERS } = require('../lib/scoring');

test('depth position uses real meter thresholds and clamps at the ends', () => {
  assert.equal(UI.depthPercent(-10, LAYERS), 0);
  assert.equal(UI.depthPercent(1400, LAYERS), 20);
  assert.equal(UI.depthPercent(8400, LAYERS), 100);
  for (const [index, layer] of LAYERS.entries()) {
    assert.equal(UI.currentLayer(layer.from, LAYERS), index);
    if (index) assert.equal(UI.currentLayer(layer.from - 1, LAYERS), index - 1);
  }
});

test('countdown never shows negative time or truncates a partial second', () => {
  assert.equal(UI.secondsLeft(25000), 25);
  assert.equal(UI.secondsLeft(24001), 25);
  assert.equal(UI.secondsLeft(1), 1);
  assert.equal(UI.secondsLeft(0), 0);
  assert.equal(UI.secondsLeft(-10), 0);
});

test('six startup ranks retain scoring and expose plain rarity descriptions', () => {
  assert.deepEqual(TIERS.map((t) => t.name), ['Vibecoder', 'Indie Hacker', 'Bootstrapped', 'Breakout', 'Unicorn', 'Founder Lore']);
  assert.deepEqual(TIERS.map((t) => [t.points, t.depth]), [[10,50],[20,100],[35,200],[55,400],[75,700],[100,1200]]);
  assert.equal(UI.rankDescription(6), 'Legendary answer');
  assert.equal(UI.rankDescription(0), 'No match');
});
