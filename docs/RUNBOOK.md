# GroVastra Auto Campaigns — Operations & Recovery Runbook
**Document Version:** 1.0 (Milestone 5 Pilot Readiness)  
**Specification Source:** `docs/GroVastra_Auto_Campaigns_Developer_Handoff.pdf` (p.28, p.34)

---

## 1. System Overview & Core Invariants

The GroVastra Auto Campaigns engine operates as a durable modular monolith on Node.js/Express with MongoDB (Mongoose). It relies on zero Redis instances. All scheduling, leases, idempotency tokens, and delivery intents are durably backed by MongoDB replica set collections.

### Core Invariants
1. **Ambiguous Outcome Isolation**: An execution whose send outcome is unknown (`OUTCOME_UNKNOWN`) is **never** automatically resubmitted, requeued, or released from the contact cap. Only proven non-acceptance may retry.
2. **Lease & Revision Safety**: Scheduling state changes rely on Compare-And-Swap (CAS) on `planRevision`, `claimVersion`, and lease expiry (`lease.until > serverNow`). Stale workers make zero provider HTTP requests.
3. **Outage Recovery**: When the engine resumes after an outage, it strictly executes under `FUTURE_ONLY`. Missed historical steps beyond the 2-hour grace window are marked `SKIPPED_STEP_EXPIRED` to prevent message bursts.
4. **Data Protection**: Sensitive customer phone numbers are encrypted with AES-256-GCM at rest in `campaignDeliveryIntents`. Logs never contain raw phone numbers, secrets, or full message bodies.

---

## 2. Emergency Operations

### 2.1 Triggering Global Pause
If abnormal provider behavior, incorrect campaign content, or urgent store closure occurs, trigger the tenant global pause immediately:

```bash
# PATCH /api/v1/campaign-settings
curl -X PATCH http://localhost:5000/api/v1/campaign-settings \
  -H "Authorization: Bearer <OWNER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "expectedVersion": 1,
    "globalPause": true
  }'
```

**Expected Engine Behavior:**
- The `TenantControlGateModel` version increments atomically.
- All in-flight executions awaiting evaluation or dispatch fail the gate version check and abort with `SKIPPED_CAMPAIGN_PAUSED`.
- Already submitted messages with provider acceptance remain untouched.
- Future steps falling due during the pause are logged as skipped per `FUTURE_ONLY` policy.

### 2.2 Resuming from Pause
When the incident is resolved, disable the global pause:

```bash
curl -X PATCH http://localhost:5000/api/v1/campaign-settings \
  -H "Authorization: Bearer <OWNER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "expectedVersion": 2,
    "globalPause": false
  }'
```

**Post-Resume Verification:**
- Steps that expired during the pause remain `SKIPPED_CAMPAIGN_PAUSED`.
- Valid future steps execute on their scheduled `dueAt`. Zero catch-up bursts occur.

---

## 3. Incident Triage & Automated Alerts

Operational health can be inspected in real time via:
`GET /api/v1/campaigns/monitoring/alerts`

| Alert Code | Severity | Root Cause | Remediation Procedure |
| :--- | :--- | :--- | :--- |
| `PLANNER_LAG` | WARNING | Calendar planner worker has not run in >60 minutes. | 1. Check worker process logs (`workers/planner.ts`).<br>2. Restart worker container.<br>3. Inspect MongoDB replica set connection. |
| `DUE_STEP_BACKLOG` | CRITICAL | Steps overdue by >15 minutes remain in `SCHEDULED`. | 1. Check executor worker loop (`workers/executor.ts`).<br>2. Verify if contact cap or pause gate is holding steps.<br>3. Check database CPU/IOPS on MongoDB host. |
| `EVENT_BACKLOG` | WARNING | >10 events in `CampaignEventInboxModel` with `status: 'RECEIVED'`. | 1. Run event rescan worker.<br>2. Check for malformed JSON or unhandled event types in quarantine. |
| `UNKNOWN_OUTCOMES` | WARNING | Message deliveries marked `OUTCOME_UNKNOWN`. | 1. Run late webhook reconciliation script.<br>2. Correlate with Meta WhatsApp Cloud API status endpoint.<br>3. **Do not force resend.** |
| `TEMPLATE_BLOCKS` | WARNING | Executions blocked due to missing template or binding error. | 1. Verify approved template status in Meta Business Manager.<br>2. Check `templateCatalogue.ts` revision and variable bindings. |
| `STALLED_CHECKPOINTS`| CRITICAL | Worker checkpoint not updated in >30 minutes. | 1. Inspect worker heap/memory leak.<br>2. Restart affected worker process. Checkpoint cursor will resume safely. |

---

## 4. Crash Recovery & Stale Dispatching Sweeper

If the Node.js server crashes while an execution is in `DISPATCHING` (e.g. OOM or SIGKILL before provider HTTP completes):

1. The execution retains `state: 'DISPATCHING'` and a lease until `lease.until`.
2. The automatic sweeper (`sweepStaleDispatching`) runs every 60 seconds:
   - Queries `state: 'DISPATCHING'` where `lease.until < serverNow`.
   - Transitions state to `OUTCOME_UNKNOWN` with reason `SWEEP_DISPATCHING_LEASE_EXPIRED`.
   - Releases any lock so that subsequent steps can evaluate prerequisite rules accurately.
3. If Meta later delivers a webhook receipt matching the frozen attempt ID, the webhook ingress updates the state monotonically (`OUTCOME_UNKNOWN` -> `DELIVERED` / `READ`).

---

## 5. Staff Actions & Precedence

Staff members can resolve customer holds or mark offline occasion orders:
- **Resolve Hold**: `POST /api/v1/campaigns/enrollments/:id/resolve-hold`
  - Re-evaluates future steps only.
  - Does NOT regenerate or resend missed historical steps.
  - Reason precedence: deletion/suppression > pause > expiry > goal/reply stop > content/readiness > prerequisite > contact cap.
- **Mark Occasion Goal**: `POST /api/v1/campaigns/enrollments/:id/mark-goal`
  - Records manual goal tagging in `AuditLogModel`.
  - Halts promotional follow-ups with `stopOnGoal: true`.
  - Preserves greetings with `stopOnGoal: false`.

---

## 6. Single-Attribution Net Sales Auditing

Owner reporting applies strict single-attribution precedence:
1. **Explicit Occasion Match**: Order `occasionRef` matching enrollment `occurrenceId`.
2. **7-Day Conversion Window**: Delivered message within 7 days prior to order.
3. **No Multi-Counting**: Each order is attributed to at most ONE campaign.
4. **Refund Reduction**: Order refunds reduce net sales (`netPaise`) to 0 and recompute facts without creating duplicate enrollments.
5. **Unassigned Visibility**: Orders without campaign correlation are clearly audited under `unassignedOrders` and `unassignedNetSalesPaise`.
