'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { norm, distance, match } = require('../lib/matcher');

const answers = [
  { canonical: 'cherry-pick', aliases: ['cherrypick'], tier: 3 },
  { canonical: 'rebase', aliases: [], tier: 2 },
  { canonical: 'reset', aliases: [], tier: 2 },
  { canonical: 'ls', aliases: [], tier: 1 },
  { canonical: 'cd', aliases: [], tier: 1 },
  { canonical: '404 Not Found', aliases: ['404', 'Not Found'], tier: 1 },
  { canonical: 'C', aliases: [], tier: 1 },
  { canonical: 'C++', aliases: ['cpp'], tier: 1 },
  { canonical: 'child_process', aliases: [], tier: 2 },
];

test('norm ignores case, spacing, separators and a leading git/node: prefix', () => {
  assert.equal(norm('  Git Cherry-Pick '), 'cherrypick');
  assert.equal(norm('git-commit'), 'commit');
  assert.equal(norm('node:fs'), 'fs');
  assert.equal(norm('Child_Process'), 'childprocess');
});

test('norm keeps + and # so C and C++ stay different', () => {
  assert.notEqual(norm('C'), norm('C++'));
  assert.equal(norm('F#'), 'f#');
});

test('exact matches via canonical, alias and prefix', () => {
  assert.equal(match('cherry pick', answers).answer.canonical, 'cherry-pick');
  assert.equal(match('git cherrypick', answers).answer.canonical, 'cherry-pick');
  assert.equal(match('404', answers).answer.canonical, '404 Not Found');
  assert.equal(match('not found', answers).answer.canonical, '404 Not Found');
  assert.equal(match('c', answers).answer.canonical, 'C');
  assert.equal(match('CPP', answers).answer.canonical, 'C++');
  assert.equal(match('child process', answers).answer.canonical, 'child_process');
});

test('one typo is tolerated on longer inputs, including transpositions', () => {
  const hit = match('rebsae', answers);
  assert.equal(hit.answer.canonical, 'rebase');
  assert.equal(hit.fuzzy, true);
  assert.equal(match('chery-pick', answers).answer.canonical, 'cherry-pick');
});

test('short inputs and numbers never match fuzzily', () => {
  assert.equal(match('lz', answers), null); // would be 1 edit from "ls"
  assert.equal(match('405', answers), null); // 1 edit from 404
});

test('ambiguous typos score nothing', () => {
  // "rebest" is equally close to rebase and reset-adjacent forms only if tied;
  // build an explicit tie to prove the rule.
  const tie = [
    { canonical: 'branch', aliases: [], tier: 1 },
    { canonical: 'bronch', aliases: [], tier: 2 },
  ];
  assert.equal(match('brunch', tie), null);
});

test('empty, whitespace and oversized input are rejected', () => {
  assert.equal(match('', answers), null);
  assert.equal(match('   ', answers), null);
  assert.equal(match('a'.repeat(200), answers), null);
  assert.equal(match(null, answers), null);
});

test('distance counts a transposition as one edit', () => {
  assert.equal(distance('ab', 'ba'), 1);
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(distance('', 'abc'), 3);
});
