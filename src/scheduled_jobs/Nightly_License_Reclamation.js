/**
 * Scheduled Script Execution: "Nightly License Reclamation" (daily, 02:00)
 * Evaluates each software model listed in the system property
 * x_demo_sam_reclaim.products (comma-separated sys_ids) with its own policy.
 * Policies are stored as JSON in x_demo_sam_reclaim.policy.<sys_id>.
 */
(function runReclamation() {
    var products = (gs.getProperty('x_demo_sam_reclaim.products', '') || '').split(',');
    var dao = new ReclamationCandidateDAO({ log: { info: function (m) { gs.info(m); }, error: function (m) { gs.error(m); } } });
    for (var i = 0; i < products.length; i++) {
        var productId = products[i].trim();
        if (!productId) { continue; }
        var policy = {};
        try {
            policy = JSON.parse(gs.getProperty('x_demo_sam_reclaim.policy.' + productId, '{}'));
        } catch (e) {
            gs.error('Invalid policy JSON for ' + productId + '; using defaults. ' + e);
        }
        dao.run(productId, policy, new GlideDateTime().getValue() /* UTC */);
    }
})();
