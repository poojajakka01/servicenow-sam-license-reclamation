/**
 * ReclamationCandidateDAO (Script Include, scoped app x_demo_sam_reclaim)
 *
 * Glide data access for the reclamation job. Reads software allocations and
 * usage evidence, calls ReclamationPolicyEngine, and writes candidate records
 * to x_demo_sam_reclaim_candidate. Table and field names are for a demo scoped
 * app on a personal developer instance and are illustrative.
 *
 * Unit-tested under Node with the Glide test doubles in tests/glide_mocks.js.
 */
var ReclamationCandidateDAO = function (deps) {
    'use strict';
    deps = deps || {};
    var GR = deps.GlideRecord || (typeof GlideRecord !== 'undefined' ? GlideRecord : null);
    var engine = deps.engine || (typeof ReclamationPolicyEngine !== 'undefined' ? ReclamationPolicyEngine : null);
    var log = deps.log || { info: function () {}, error: function () {} };

    function usageFor(userId, productId) {
        var usage = [];
        var u = new GR('x_demo_sam_reclaim_usage');
        u.addQuery('user', userId);
        u.addQuery('product', productId);
        u.query();
        while (u.next()) {
            usage.push({ source: String(u.getValue('source')), last_activity: String(u.getValue('last_activity')) });
        }
        return usage;
    }

    function candidateExists(allocationId) {
        var c = new GR('x_demo_sam_reclaim_candidate');
        c.addQuery('allocation', allocationId);
        c.addQuery('state', 'IN', 'candidate,notified');
        c.setLimit(1);
        c.query();
        return c.hasNext();
    }

    /**
     * Evaluate every active allocation for one product and create candidates.
     * Idempotent: an allocation that already has an open candidate is skipped.
     */
    function run(productId, policy, now) {
        var created = 0;
        var results = [];
        var a = new GR('alm_entitlement_user');
        a.addQuery('licensed_by.software_model', productId);
        a.query();
        while (a.next()) {
            try {
                var allocation = {
                    sys_id: String(a.getUniqueValue()),
                    user: String(a.getValue('assigned_to')),
                    user_groups: [],
                    product: productId,
                    allocated_on: String(a.getValue('sys_created_on')),
                    unit_cost: parseFloat(a.getValue('u_annual_unit_cost')) || 0,
                    exempt: String(a.getValue('u_reclaim_exempt')) === 'true'
                };
                var result = engine.evaluate(allocation, usageFor(allocation.user, productId), policy, now);
                results.push(result);
                if (result.action === 'reclaim_candidate' && !candidateExists(allocation.sys_id)) {
                    var c = new GR('x_demo_sam_reclaim_candidate');
                    c.initialize();
                    c.setValue('allocation', allocation.sys_id);
                    c.setValue('user', allocation.user);
                    c.setValue('product', productId);
                    c.setValue('idle_days', result.idle_days);
                    c.setValue('reason', result.reason);
                    c.setValue('annual_savings', result.annual_savings);
                    c.setValue('state', 'candidate');
                    c.insert();
                    created++;
                }
            } catch (e) {
                // One bad record must not stop the batch.
                log.error('Reclamation evaluation failed for ' + a.getUniqueValue() + ': ' + e);
            }
        }
        log.info('Reclamation run for ' + productId + ': ' + results.length + ' evaluated, ' + created + ' candidates created');
        return { evaluated: results.length, created: created, summary: engine.summarize(results) };
    }

    return { run: run, type: 'ReclamationCandidateDAO' };
};

if (typeof module !== 'undefined' && module.exports) { module.exports = ReclamationCandidateDAO; }
