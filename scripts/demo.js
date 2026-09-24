'use strict';
// Runs the policy engine against synthetic data and prints a reclamation summary.
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../src/script_includes/ReclamationPolicyEngine');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sample_allocations.json'), 'utf8'));
const now = new Date(process.argv[2] || '2026-09-01T00:00:00Z');
const results = data.allocations.map((a) => engine.evaluate(
    a,
    data.usage.filter((u) => u.user === a.user && u.product === a.product),
    data.policy[a.product] || {},
    now
));
console.table(results.map(({ allocation, product, action, idle_days, reason }) => ({ allocation, product, action, idle_days, reason })));
console.table(engine.summarize(results));
