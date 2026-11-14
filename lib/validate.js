'use strict';

const { norm } = require('./matcher');

// Returns a list of human-readable problems; empty means valid.
function validatePrompt(p, { minAnswers = 1 } = {}) {
  const errors = [];
  const where = `prompt "${p && p.id}"`;
  if (!p || typeof p !== 'object') return ['prompt is not an object'];
  for (const field of ['id', 'text', 'category']) {
    if (typeof p[field] !== 'string' || !p[field].trim()) errors.push(`${where}: missing ${field}`);
  }
  if (!Array.isArray(p.answers)) return [...errors, `${where}: answers must be an array`];
  if (p.answers.length < minAnswers) {
    errors.push(`${where}: has ${p.answers.length} answers, needs at least ${minAnswers}`);
  }

  const owners = new Map(); // normalized form -> canonical that owns it
  for (const a of p.answers) {
    if (!a || typeof a.canonical !== 'string' || !a.canonical.trim()) {
      errors.push(`${where}: answer without canonical`);
      continue;
    }
    if (!Number.isInteger(a.tier) || a.tier < 1 || a.tier > 6) {
      errors.push(`${where}: "${a.canonical}" has invalid tier ${a.tier}`);
    }
    if (!Array.isArray(a.aliases)) {
      errors.push(`${where}: "${a.canonical}" aliases must be an array`);
      continue;
    }
    for (const form of [a.canonical, ...a.aliases]) {
      const key = norm(form);
      if (!key) {
        errors.push(`${where}: "${form}" normalizes to nothing`);
        continue;
      }
      const owner = owners.get(key);
      if (owner && owner !== a.canonical) {
        errors.push(`${where}: "${form}" collides between "${owner}" and "${a.canonical}"`);
      } else {
        owners.set(key, a.canonical);
      }
    }
  }
  return errors;
}

function validateBank(bank, options) {
  const errors = [];
  const ids = new Set();
  for (const p of bank.prompts || []) {
    if (ids.has(p.id)) errors.push(`duplicate prompt id "${p.id}"`);
    ids.add(p.id);
    errors.push(...validatePrompt(p, options));
  }
  return errors;
}

module.exports = { validatePrompt, validateBank };
