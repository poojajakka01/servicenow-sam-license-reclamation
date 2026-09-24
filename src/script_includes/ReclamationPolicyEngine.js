/**
 * ReclamationPolicyEngine (Script Include, scoped app x_demo_sam_reclaim)
 *
 * Pure decision logic for software license reclamation. It has no Glide
 * dependencies, so the same file runs on the platform (as a Script Include)
 * and under Node for unit tests. Data access lives in ReclamationCandidateDAO.
 *
 * Portfolio project: independently written, synthetic data only.
 * ES5 syntax is kept deliberately so the file also works on instances
 * where the scoped app has not opted into ECMAScript 2021 mode.
 */
var ReclamationPolicyEngine = (function () {
    'use strict';

    var DAY_MS = 24 * 60 * 60 * 1000;

    var DEFAULT_POLICY = {
        inactiveDays: 90,          // no activity for this long => candidate
        newAllocationGraceDays: 30, // never reclaim a seat allocated recently
        notifyBeforeReclaimDays: 7, // user gets this long to respond "keep"
        exemptGroups: []           // e.g. ['Executive Support']
    };

    function merge(base, override) {
        var out = {};
        var k;
        for (k in base) { if (base.hasOwnProperty(k)) { out[k] = base[k]; } }
        for (k in (override || {})) { if (override.hasOwnProperty(k)) { out[k] = override[k]; } }
        return out;
    }

    function toTime(value) {
        if (!value) { return null; }
        if (value instanceof Date) { return value.getTime(); }
        // Glide date/time values are UTC strings: 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss'.
        var s = String(value);
        var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(s);
        if (!m) { return null; }
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }

    /**
     * Latest activity across all usage sources (SaaS sign-in logs, desktop
     * metering, proxy logs, collaboration-tool activity...). Unknown dates
     * are ignored rather than treated as "active".
     */
    function lastActivity(usageRecords) {
        var latest = null;
        for (var i = 0; i < (usageRecords || []).length; i++) {
            var t = toTime(usageRecords[i].last_activity);
            if (t !== null && (latest === null || t > latest)) { latest = t; }
        }
        return latest;
    }

    function daysBetween(fromTime, toTimeValue) {
        return Math.floor((toTimeValue - fromTime) / DAY_MS);
    }

    /**
     * Evaluate one allocation.
     * @param {Object} allocation {sys_id, user, user_groups[], product, allocated_on, unit_cost, exempt}
     * @param {Array}  usage      [{source, last_activity}]
     * @param {Object} policy     overrides for DEFAULT_POLICY (per product)
     * @param {Date}   now
     * @returns {Object} {action: 'keep'|'reclaim_candidate', reason, idle_days, annual_savings}
     */
    function evaluate(allocation, usage, policy, now) {
        var p = merge(DEFAULT_POLICY, policy);
        var nowTime = toTime(now || new Date());
        var result = { allocation: allocation.sys_id, user: allocation.user, product: allocation.product,
            action: 'keep', reason: '', idle_days: null, annual_savings: 0 };

        if (allocation.exempt) { result.reason = 'Allocation flagged exempt'; return result; }

        var groups = allocation.user_groups || [];
        for (var g = 0; g < groups.length; g++) {
            if (p.exemptGroups.indexOf(groups[g]) !== -1) {
                result.reason = 'User in exempt group: ' + groups[g];
                return result;
            }
        }

        var allocatedOn = toTime(allocation.allocated_on);
        if (allocatedOn !== null && daysBetween(allocatedOn, nowTime) < p.newAllocationGraceDays) {
            result.reason = 'Within new-allocation grace period';
            return result;
        }

        var last = lastActivity(usage);
        if (last === null) {
            // No usage evidence from any source. Base idle time on allocation date.
            if (allocatedOn === null) {
                result.reason = 'No usage data and no allocation date; manual review';
                result.action = 'review';
                return result;
            }
            last = allocatedOn;
        }

        result.idle_days = daysBetween(last, nowTime);
        if (result.idle_days >= p.inactiveDays) {
            result.action = 'reclaim_candidate';
            result.reason = 'No activity for ' + result.idle_days + ' days (threshold ' + p.inactiveDays + ')';
            result.annual_savings = Number(allocation.unit_cost || 0);
        } else {
            result.reason = 'Active within threshold';
        }
        return result;
    }

    /**
     * Workflow state transition for a candidate after notification.
     * states: candidate -> notified -> (kept | reclaimed)
     */
    function nextState(candidate, now, policy) {
        var p = merge(DEFAULT_POLICY, policy);
        if (candidate.state === 'candidate') { return 'notified'; }
        if (candidate.state === 'notified') {
            if (candidate.user_response === 'keep') { return 'kept'; }
            var notifiedOn = toTime(candidate.notified_on);
            if (notifiedOn !== null && daysBetween(notifiedOn, toTime(now)) >= p.notifyBeforeReclaimDays) {
                return 'reclaimed';
            }
            return 'notified';
        }
        return candidate.state;
    }

    /** Aggregate results into a product-level summary for dashboards. */
    function summarize(results) {
        var byProduct = {};
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            if (!byProduct[r.product]) {
                byProduct[r.product] = { product: r.product, evaluated: 0, candidates: 0, review: 0, annual_savings: 0 };
            }
            var s = byProduct[r.product];
            s.evaluated++;
            if (r.action === 'reclaim_candidate') { s.candidates++; s.annual_savings += r.annual_savings; }
            if (r.action === 'review') { s.review++; }
        }
        var out = [];
        for (var k in byProduct) { if (byProduct.hasOwnProperty(k)) { out.push(byProduct[k]); } }
        out.sort(function (a, b) { return b.annual_savings - a.annual_savings; });
        return out;
    }

    return {
        DEFAULT_POLICY: DEFAULT_POLICY,
        evaluate: evaluate,
        lastActivity: lastActivity,
        nextState: nextState,
        summarize: summarize,
        type: 'ReclamationPolicyEngine'
    };
})();

// Node/test export shim; ignored on the ServiceNow platform.
if (typeof module !== 'undefined' && module.exports) { module.exports = ReclamationPolicyEngine; }
