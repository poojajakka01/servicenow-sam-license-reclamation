# ServiceNow SAM License Reclamation Engine

Policy-driven software license reclamation for a ServiceNow scoped application. It combines usage evidence from several sources (SSO sign-ins, desktop metering, proxy logs), applies per-product rules, and runs a notify → keep/reclaim workflow. The decision logic is unit-tested outside the platform.

> **Portfolio project.** This is an independently written, clean-room demonstration with synthetic data. Table names, products, and users are fictional. It is not code from any employer's or client's instance.

## Business problem

Organizations pay for software seats that nobody uses. SAM Pro's reclamation rules cover many cases, but real environments often need extra usage signals (for example, SaaS activity that only shows up in an identity provider or a proxy) and business rules: grace periods for new hires, exempt groups, a user notification window before a seat is removed. This project shows one way to structure that logic so it is **testable, idempotent, and safe to run nightly**.

## Design

```
 Usage sources                 Scoped app x_demo_sam_reclaim                         Outcome
┌───────────────┐   import   ┌────────────────────────┐    ┌─────────────────────────┐   ┌────────────────────┐
│ SSO sign-ins   │ ────────▶ │ x_demo_sam_reclaim_usage│ ─▶ │ ReclamationCandidateDAO │ ─▶│ candidate records   │
│ Desktop meter  │           └────────────────────────┘    │  (Glide data access)    │   │ state: candidate →  │
│ Proxy logs     │           ┌────────────────────────┐    │           │             │   │ notified → kept /   │
└───────────────┘           │ alm_entitlement_user    │ ─▶ │ ReclamationPolicyEngine │   │ reclaimed           │
                             └────────────────────────┘    │  (pure logic, no Glide) │   │ savings by product  │
                                                           └─────────────────────────┘   └────────────────────┘
```

| File | Role |
|---|---|
| `src/script_includes/ReclamationPolicyEngine.js` | Pure decision logic: idle-day calculation across sources, grace period, exemptions, state transitions, savings summary |
| `src/script_includes/ReclamationCandidateDAO.js` | GlideRecord reads/writes; idempotent candidate creation; per-record error isolation |
| `src/scheduled_jobs/Nightly_License_Reclamation.js` | Scheduled job; per-product policy loaded from system properties as JSON |
| `tests/glide_mocks.js` | In-memory GlideRecord test double |

### Decision rules

1. Exempt allocation or exempt group → **keep**
2. Allocated within the grace period (default 30 days) → **keep**
3. The latest activity across all sources is used. Unparseable dates are ignored, not treated as activity.
4. No usage evidence at all → idle time counts from the allocation date. No allocation date either → **review**.
5. Idle ≥ `inactiveDays` (default 90, overridable per product) → **reclaim_candidate**
6. After notification: the user responds "keep" → **kept**. No response within `notifyBeforeReclaimDays` (default 7) → **reclaimed**.

## Run it

```bash
npm test          # 11 unit tests, Node 20+, no dependencies
npm run demo      # evaluates data/sample_allocations.json
```

Sample output ([`docs/sample_output.txt`](docs/sample_output.txt)):

| allocation | product | action | idle_days | reason |
|---|---|---|---|---|
| al02 | DemoDesign Pro | reclaim_candidate | 143 | No activity for 143 days (threshold 60) |
| al03 | DemoDesign Pro | keep | – | Within new-allocation grace period |
| al04 | DemoIDE Enterprise | keep | – | User in exempt group |
| al07 | DemoChat Business | review | – | No usage data and no allocation date |

## Deploying to a personal developer instance (PDI)

1. Create scoped app `x_demo_sam_reclaim` in Studio. Create the tables `x_demo_sam_reclaim_usage` (user, product, source, last_activity) and `x_demo_sam_reclaim_candidate` (allocation, user, product, idle_days, reason, annual_savings, state).
2. Create two Script Includes with the contents of `src/script_includes/`. The Node export shim at the bottom of each file is ignored on the platform.
3. Add system properties `x_demo_sam_reclaim.products` and `x_demo_sam_reclaim.policy.<software_model sys_id>`.
4. Create the scheduled job from `src/scheduled_jobs/`.
5. Build a Flow Designer flow on candidate insert: notify the user and set state `notified`. A daily flow calls `nextState()` to close out candidates.

## Security considerations

- No credentials, endpoints, or instance names are in the repo.
- Candidate creation is idempotent, so reruns cannot flood users with notifications.
- In a real deployment, restrict the candidate table with ACLs to the SAM manager role and log every reclaim action for audit.

## Limitations and future work

- Doesn't read SAM Pro's native `samp_sw_usage` or subscription tables yet. The usage table here is a stand-in.
- `user_groups` isn't populated by the DAO. Next step: a `sys_user_grmember` lookup.
- Planned: ATF test for the flow, and a Performance Analytics indicator for savings realized.

## License

MIT
