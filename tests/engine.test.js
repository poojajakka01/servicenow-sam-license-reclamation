'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/script_includes/ReclamationPolicyEngine');
const makeDAO = require('../src/script_includes/ReclamationCandidateDAO');
const { makeGlideRecord } = require('./glide_mocks');

const NOW = new Date('2026-09-01T00:00:00Z');
const base = { sys_id: 'a1', user: 'u1', product: 'DemoDesign Pro', allocated_on: '2026-01-01 00:00:00', unit_cost: 600 };

test('recently active user is kept', () => {
    const r = engine.evaluate(base, [{ source: 'sso', last_activity: '2026-08-20 10:00:00' }], {}, NOW);
    assert.equal(r.action, 'keep');
    assert.equal(r.idle_days, 11);
});

test('latest activity across multiple sources wins', () => {
    const usage = [
        { source: 'desktop_metering', last_activity: '2026-03-01 00:00:00' },
        { source: 'proxy', last_activity: '2026-08-30 00:00:00' },
        { source: 'broken', last_activity: 'not-a-date' }
    ];
    assert.equal(engine.evaluate(base, usage, {}, NOW).action, 'keep');
});

test('idle beyond threshold becomes candidate with savings', () => {
    const r = engine.evaluate(base, [{ source: 'sso', last_activity: '2026-04-01 00:00:00' }], {}, NOW);
    assert.equal(r.action, 'reclaim_candidate');
    assert.equal(r.annual_savings, 600);
});

test('per-product threshold override', () => {
    const r = engine.evaluate(base, [{ source: 'sso', last_activity: '2026-07-15 00:00:00' }], { inactiveDays: 30 }, NOW);
    assert.equal(r.action, 'reclaim_candidate');
});

test('new allocations are protected by grace period', () => {
    const r = engine.evaluate({ ...base, allocated_on: '2026-08-20 00:00:00' }, [], {}, NOW);
    assert.equal(r.action, 'keep');
    assert.match(r.reason, /grace/);
});

test('exempt groups and flags are respected', () => {
    assert.equal(engine.evaluate({ ...base, exempt: true }, [], {}, NOW).action, 'keep');
    const r = engine.evaluate({ ...base, user_groups: ['Executive Support'] }, [], { exemptGroups: ['Executive Support'] }, NOW);
    assert.equal(r.action, 'keep');
});

test('no usage evidence falls back to allocation date', () => {
    assert.equal(engine.evaluate(base, [], {}, NOW).action, 'reclaim_candidate');
    assert.equal(engine.evaluate({ ...base, allocated_on: '' }, [], {}, NOW).action, 'review');
});

test('state machine: notify, keep, reclaim after window', () => {
    assert.equal(engine.nextState({ state: 'candidate' }, NOW), 'notified');
    assert.equal(engine.nextState({ state: 'notified', user_response: 'keep', notified_on: '2026-08-01' }, NOW), 'kept');
    assert.equal(engine.nextState({ state: 'notified', notified_on: '2026-08-30' }, NOW), 'notified');
    assert.equal(engine.nextState({ state: 'notified', notified_on: '2026-08-20' }, NOW), 'reclaimed');
});

test('summarize totals by product sorted by savings', () => {
    const s = engine.summarize([
        { product: 'A', action: 'reclaim_candidate', annual_savings: 100 },
        { product: 'B', action: 'reclaim_candidate', annual_savings: 500 },
        { product: 'B', action: 'keep', annual_savings: 0 },
        { product: 'A', action: 'review', annual_savings: 0 }
    ]);
    assert.deepEqual(s.map((x) => x.product), ['B', 'A']);
    assert.equal(s[1].review, 1);
});

test('DAO creates candidates idempotently', () => {
    const db = {
        alm_entitlement_user: [
            { sys_id: 'e1', 'licensed_by.software_model': 'P1', assigned_to: 'u1', sys_created_on: '2026-01-01 00:00:00', u_annual_unit_cost: '250' },
            { sys_id: 'e2', 'licensed_by.software_model': 'P1', assigned_to: 'u2', sys_created_on: '2026-01-01 00:00:00', u_annual_unit_cost: '250' }
        ],
        x_demo_sam_reclaim_usage: [
            { user: 'u2', product: 'P1', source: 'sso', last_activity: '2026-08-28 00:00:00' }
        ],
        x_demo_sam_reclaim_candidate: []
    };
    const dao = makeDAO({ GlideRecord: makeGlideRecord(db), engine });
    const first = dao.run('P1', {}, NOW);
    assert.equal(first.evaluated, 2);
    assert.equal(first.created, 1);
    assert.equal(db.x_demo_sam_reclaim_candidate[0].user, 'u1');
    assert.equal(dao.run('P1', {}, NOW).created, 0, 'second run must not duplicate');
});

test('DAO logs and continues when one record fails', () => {
    const db = { alm_entitlement_user: [{ sys_id: 'e1', 'licensed_by.software_model': 'P1' }], x_demo_sam_reclaim_usage: [], x_demo_sam_reclaim_candidate: [] };
    const errors = [];
    const badEngine = { ...engine, evaluate: () => { throw new Error('boom'); } };
    const dao = makeDAO({ GlideRecord: makeGlideRecord(db), engine: badEngine, log: { info() {}, error: (m) => errors.push(m) } });
    assert.equal(dao.run('P1', {}, NOW).evaluated, 0);
    assert.equal(errors.length, 1);
});
