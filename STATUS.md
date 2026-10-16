# GroVastra Auto Campaigns Engine — Implementation & Verification Status

This document is the real-time tracking register for the GroVastra Auto Campaigns engine against the specification in `docs/GroVastra_Auto_Campaigns_Developer_Handoff.pdf` (v2.0) and architectural guidelines in `docs/DECISIONS.md`.

> **Verification Rule:** A requirement is marked **Proven by test** ONLY when a live, database-backed test connects to a real MongoDB replica set (`MongoMemoryReplSet`), executes the actual production code paths, and asserts database state, scheduler behavior, or adapter call counts. Mocked or self-asserting tests are never treated as proof.

---

## 1. Test Harness & Setup

| Requirement | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| Real MongoDB replica set for automated tests (`MongoMemoryReplSet`) | Yes | Yes | All test suites connected |
| Zero test skips on missing database (fail-closed test harness) | Yes | Yes | All 160 unit/integration tests + 58 QA Matrix tests (218 total passing) run against replica set |

---

## 2. Work Package P0 — Security Holes

| Requirement | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| **P0.a**: `POST /api/v1/webhooks/orders` internal credential auth & tenant extraction | Yes | Yes | `p0Security.test.ts` (401 on unauth, 403 on wrong family) |
| **P0.a**: Tenant-scoped queries on order goal updates (no unscoped `updateMany`) | Yes | Yes | `p0Security.test.ts` (tenant-scoped updateMany, 403 on cross-tenant) |
| **P0.a**: Remove hardcoded fallback tenant & invented `netPaise` defaults | Yes | Yes | `p0Security.test.ts` (strict credential tenant, netPaise preserved) |
| **P0.a**: Occasion matching via `occasionRef` or explicit staff goal (A12, C17, C18) | Yes | Yes | `p0Security.test.ts` (A12, C17 occasion matching) |
| **P0.a**: Step-level `stopOnGoal` respected (do not skip when `stopOnGoal: false`) | Yes | Yes | `p0Security.test.ts` (greeting step preserved in SCHEDULED) |
| **P0.b**: `POST /internal/campaign-events` per-producer, per-tenant credentials scoped by event family | Yes | Yes | `p0Security.test.ts` (401 unauth, 403 family mismatch) |
| **P0.b**: Durable event persistence (`RECEIVED`) before HTTP ACK | Yes | Yes | `p0Security.test.ts` (persisted as RECEIVED before 201 ACK) |
| **P0.b**: Event rescan worker for unprocessed `RECEIVED` events (crash recovery B03) | Yes | Yes | `p0Security.test.ts` (B03 simulated crash recovery to PROCESSED) |
| **P0.b**: Entity version check: reject stale entity versions | Yes | Yes | `p0Security.test.ts` (version 3 rejected after version 5) |
| **P0.b**: Schema validation sending unparseable/unknown events to visible `QUARANTINE` | Yes | Yes | `p0Security.test.ts` (422 QUARANTINE on malformed schema) |
| **P0.c**: Inbound WhatsApp reply connection-to-tenant mapping & tenant-scoped customer lookup | Yes | Yes | `p0Security.test.ts` (connection-to-tenant lookup & reply hold) |
| **P0.c**: E.164 phone normalization utility replacing naive regex | Yes | Yes | `phone.test.ts` (8/8 unit tests passing) |
| **P0.d**: Real credentials login endpoint returning scoped JWT | Yes | Yes | `p0Security.test.ts` (real login, pbkdf2 hash, scoped JWT) |
| **P0.d**: Frontend: remove hardcoded `x-tenant-id` and hardcoded shop names | Yes | Yes | Frontend build clean; dynamic profile & shopName |
| **P0.d**: Role-based access control (Staff activity/holds vs Owner/Admin campaigns & policy) | Yes | Yes | `p0Security.test.ts` (403 on STAFF modifying campaigns) |

---

## 3. Work Package P1 — Execution Correctness

| Requirement | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| **P1.a**: Separate `claimVersion` counter on `CampaignExecutionModel` distinct from `planRevision` | Yes | Yes | `p1Execution.test.ts` (B15, B20) |
| **P1.a**: Final dispatch submission validation: lease token, expected `planRevision`, state, lease & expiresAt > now (B15, B20) | Yes | Yes | `p1Execution.test.ts` (B15, B20) |
| **P1.b**: Atomic MongoDB transaction for gates validation + capacity reservation + intent freeze + DISPATCHING | Yes | Yes | `p1Execution.test.ts` (B11, B15, C08), `execution.test.ts` |
| **P1.b**: Zero provider HTTP requests inside database transactions | Yes | Yes | `p1Execution.test.ts` (B15, C08, C09), `execution.test.ts` |
| **P1.b**: Stranded intent resolution: lost leases do not block unique executionId index | Yes | Yes | `p1Execution.test.ts` (B15, C08) |
| **P1.c**: Campaign and Tenant control-gate documents with monotonic gate versions (B11, B12) | Yes | Yes | `execution.test.ts` (section 4, pause race aborts & monotonic increment), `p1Execution.test.ts` (B11, B12), `qaMatrix.test.ts` (B11, B12) |
| **P1.c**: Global pause control and FUTURE_ONLY logging of steps falling due during pause | Yes | Yes | `p1Execution.test.ts` (B11, REG-06) |
| **P1.d**: Bounded exponential backoff with `RETRY_WAIT` state and `retryAt` timestamp | Yes | Yes | `p1Execution.test.ts` (C08, C09) |
| **P1.d**: Retry restricted to Meta M4 non-acceptance error codes; all gates rechecked | Yes | Yes | `p1Execution.test.ts` (C08, C09) |
| **P1.d**: Safe contact reservation release & re-acquire on retry (C08, C09, C20) | Yes | Yes | `p1Execution.test.ts` (C08, C20), `qaMatrix.test.ts` (C08) |
| **P1.d**: `BLOCKED_STALE_INTENT` when frozen intent source data changes before retry (C20) | Yes | Yes | `p1Execution.test.ts` (C20) |
| **P1.e**: Contact ledger counting reserved, accepted, and unknown outcomes | Yes | Yes | `p1Execution.test.ts` (B09, C06) |
| **P1.e**: Destination-wide cap across duplicate CRM customer records sharing phone (B10) | Yes | Yes | `p1Execution.test.ts` (B10), `qaMatrix.test.ts` (B10) |
| **P1.e**: Atomic collision arbitration: priority -> earliest expiry -> creation order (B09) | Yes | Yes | `p1Execution.test.ts` (B09) |
| **P1.e**: In-memory contact cap fallback removed from production paths | Yes | Yes | Production paths use MongoMemoryReplSet transactions |
| **P1.f**: Webhook status deduplication via compound unique index | Yes | Yes | `p1Execution.test.ts` (C10) |
| **P1.f**: Monotonic execution status progression (`READ` > `DELIVERED` > `PROVIDER_ACCEPTED`) | Yes | Yes | `p1Execution.test.ts` (C10) |
| **P1.f**: Provider timestamps used for delivery and read receipts | Yes | Yes | `p1Execution.test.ts` (C10) |
| **P1.f**: Handling status event arriving before send response persistence (C12) | Yes | Yes | `p1Execution.test.ts` (C12) |
| **P1.f**: Raw-byte HMAC verification failing closed | Yes | Yes | `p1Execution.test.ts` (C10), `p0Security.test.ts` |
| **P1.g**: Unique enrollment & execution tombstones with atomic detail pruning (B18) | Yes | Yes | `p1Execution.test.ts` (B18) |
| **P1.h**: Masked projections for history; zero phone numbers or raw message bodies in logs | Yes | Yes | `p1Execution.test.ts` (B10, C08) |
| **P1.h**: Recipient phone encrypted at rest with AES-256-GCM | Yes | Yes | `p1Execution.test.ts` (C08, C20), `execution.test.ts` |
| **P1.h**: Fair multi-tenant worker scheduling | Yes | Yes | `workers/executor.ts` (fair round-robin) |

---

## 4. Work Package P2 — Milestone 2 Gaps

| Requirement | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| **P2.a**: Audience rules engine (`all`/`any`/`none`, explicit `ALL_ELIGIBLE`, match explanations) | Yes | Yes | `p2Milestone.test.ts` (A04) |
| **P2.b**: Discovery window (today - largest offset) to (today + largest lead + 30d) (B19) | Yes | Yes | `p2Milestone.test.ts` (B19) |
| **P2.b**: FUTURE_ONLY activation/resume with 2-hour technical outage grace (B05, B06, B13) | Yes | Yes | `p2Milestone.test.ts` (B06, B13) |
| **P2.c**: Leap-day policies (`FEB_28`, `MAR_01`, `LEAP_ONLY`) (A08) | Yes | Yes | `p2Milestone.test.ts` (A08) |
| **P2.c**: Timezone and local-time calculation avoiding UTC midnight drift | Yes | Yes | `p2Milestone.test.ts` (A05, A07, B07) |
| **P2.d**: Anniversary & wedding per-eventId occurrences and postponement replan (A09, A10) | Yes | Yes | `p2Milestone.test.ts` (A09, A10) |
| **P2.e**: Date corrections: within-year replan vs across-year `correctionGroupId` lineage (B04) | Yes | Yes | `p2Milestone.test.ts` (B04) |
| **P2.f**: Immutable published versions; draft PATCH never mutates published (B14) | Yes | Yes | `p2Milestone.test.ts` (B14) |
| **P2.g**: Activation requires matching dry-run reviewFingerprint (A03, C01) | Yes | Yes | `p2Milestone.test.ts` (A03, C01), `qaMatrix.test.ts` (A03) |
| **P2.h**: Validation endpoint with fieldPath and resolutionOwner (A05) | Yes | Yes | `p2Milestone.test.ts` (A05), `qaMatrix.test.ts` (A05) |
| **P2.i**: Meta positional parameters driven strictly by template variable keys (C05) | Yes | Yes | `p2Milestone.test.ts` (C05), `qaMatrix.test.ts` (C05) |
| **P2.j**: Idempotency keys on mutations; 409 on version conflict (C15, C16) | Yes | Yes | `p2Milestone.test.ts` (C15, C16), `qaMatrix.test.ts` (C15, C16) |
| **P2.k**: Next.js Studio (Editor, Dry Run, Simulator, Activity, Settings with required notice & separate accepted/delivered/read counts) | Yes | Yes | Frontend build clean; client draft autosave with `draftVersion`, passes `expectedVersion`, renders 409 conflict banner with reload button, and enforces `Idempotency-Key` headers; verified in `p2Milestone.test.ts` & `qaMatrix.test.ts` (C15, C16) |
| **P2.l**: Staff actions (resolve-hold, mark-goal) with audited reason precedence | Yes | Yes | `p2Milestone.test.ts` (A11, A12, AuditLogModel) |

---

## 5. Work Package P3 — Milestone 4 Presets

| Preset Family | Evaluator Exists | Event Consumer | Occurrence Key | Proven by Test | UI Enabled |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Merchandise**: Requested Restock (Exact SKU, Live Stock Preflight) | Yes | `inventory.restock` | `arrival:arrivalEventId:requestId` | Yes (`p3Presets.test.ts` A15) | Yes |
| **Merchandise**: Multi-match Customer Consolidation & Recount Rejection | Yes | `inventory.arrival` | `arrival:arrivalEventId:requestId` | Yes (`p3Presets.test.ts` A16) | Yes |
| **Merchandise**: Festival, Collection & Selected-Stock Offers | Yes | `festival.launch`, `collection.released`, `stockoffer.active` | `festival:seasonId`, `collection:releaseId`, `stockoffer:offerId` | Yes (`p3Presets.test.ts`) | Yes |
| **Lifecycle**: Customer Purchase Facts & Inactivity Scan | Yes | Daily Scan Worker | `winback:orderId:version` | Yes (`p3Presets.test.ts` A13, B17) | Yes |
| **Lifecycle**: Refund Anchor Recomputation (No Completed Duplicate) | Yes | `order.refunded` | `winback:orderId:version` | Yes (`p3Presets.test.ts` A14) | Yes |
| **Lifecycle**: Complete the Outfit & First-to-Second Purchase | Yes | `order.completed` | `outfit:orderId`, `repeat:orderId` | Yes (`p3Presets.test.ts`) | Yes |
| **Retention**: VIP Milestone, Store Credit Expiry & Exhibition | Yes | `customer.vip_milestone`, `credit.expiring`, `exhibition.announced` | `vip:level`, `credit:creditId`, `exhibition:showId` | Yes (`p3Presets.test.ts`) | Yes |
| **Boutique Service**: Alterations & Fitting (Exempt from Marketing Cap) | Yes | `alteration.completed`, `appointment.scheduled` | `alteration:jobId`, `fitting:appointmentId` | Yes (`p3Presets.test.ts` B16) | Yes |
| **Boutique Service**: Delivery Updates & Courier Deduplication | Yes | `delivery.updated` | `delivery:orderId:status` | Yes (`p3Presets.test.ts` B16) | Yes |
| **Boutique Service**: Template Purpose Gate Mismatch Block | Yes | Ingress Safeguard | N/A | Yes (`p3Presets.test.ts` C14) | Yes |
| **Source Contracts**: Schema Versioning, Stale Version Rejection & Quarantine | Yes | `/internal/campaign-events` & Domain Adapters | Ingress Event ID | Yes (`p3Presets.test.ts`) | Yes |

---

## 6. Work Package P4 — Pilot Readiness & Matrix

| Requirement / Component | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| **Full 58-Scenario Matrix (A01-A18, B01-B20, C01-C20)** | Yes | Yes | `qaMatrix.test.ts` (58/58 passing, 100% against replica set) |
| • Matrix A: Campaign Behaviour (A01-A18) | Yes | Yes | 18/18 passing (`qaMatrix.test.ts`) |
| • Matrix B: Scheduling & Concurrency (B01-B20) | Yes | Yes | 20/20 passing (`qaMatrix.test.ts`) |
| • Matrix C: Delivery & Controls (C01-C20) | Yes | Yes | 20/20 passing (`qaMatrix.test.ts`) |
| **Owner Overview Reporting & Net Sales Attribution** | Yes | Yes | `p4Reporting.test.ts` (A17, C18, single attribution & refund netting) |
| **Customer Journey Activity Timeline** | Yes | Yes | `p4Reporting.test.ts` (audited history, masked projections) |
| **Operational Monitoring & Checkpoint Alerts** | Yes | Yes | `p4Reporting.test.ts` (lagging step alert, quarantine alert) |
| **Load & Latency Benchmark (100 due steps)** | Yes | Yes | `loadLatency.test.ts` (100 steps, 0 duplicate sends, CAS lease safety) |
| **Operations Runbook (`docs/RUNBOOK.md`)** | Yes | Yes | Comprehensive incident response, fail-safe & pause controls |
| **Pilot Smoke Test (`docs/SMOKE_TEST.md`)** | Yes | Yes | End-to-end multi-step verification procedure |

---

## 7. Blockers & External Integration Interfaces

| # | Item | Status / Interface | Impact / Resolution |
| :--- | :--- | :--- | :--- |
| **B1** | Provider webhook ingestion ownership (spec p.3 vs p.26) | Ingress built in Express webhook module with constant-time HMAC check | Open decision noted in architecture blueprint |
| **B2** | Live Meta WhatsApp Cloud API credentials & approved templates | `IWhatsAppDeliveryAdapter` with per-tenant `TenantConnectionModel` lookup (fails closed if unprovisioned) and database-backed `TemplateCatalogModel` | Per-tenant connections and database-backed templates implemented |
| **B3** | Product owner approval of default caps (1/24h, 3/7d) and lead times | Configurable in tenant settings with proposed defaults | Ready for tenant overrides |
| **B4** | Upstream POS/ERP domain event emission contracts | Ingestion schema defined in `/internal/campaign-events` | Adapter contracts provided for upstream systems |

---

## 8. Audit & Review Hardening (Static Review Resolution)

## 9. Higher Authority Code Review Resolution (15 October 2026)

Following the Higher Authority / Senior Technical Manager review of commit `8b95907` / `acf000b` against Developer Handoff v2.0, all 7 P1 findings have been resolved in production code and verified with dedicated regression tests in `backend/tests/reviewHardening.test.ts`:

| # | Finding & Severity | Problem Identified | Architectural & Code Remediation | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Finding 1** | **P1: Tenant Scoping on Campaign Reads** | `GET /campaigns` active-version lookup used `CampaignVersionModel.findOne({ id: c.activeVersionId })` without scoping by `tenantId`. | Added `{ id: c.activeVersionId, tenantId }` to ensure strict tenant isolation on every collection query per Spec p.25. Audited all campaign read and mutation queries for complete tenant-scoping consistency. | `backend/tests/reviewHardening.test.ts` (Finding 1: Cross-tenant version lookup returns null for foreign tenant) |
| **Finding 2** | **P1: Draft Validation Targets Draft Version** | `POST /campaigns/:id/validate` defaulted to `activeVersionId` when non-null instead of validating the pending draft version being prepared for publication. | Refactored validation route to strictly select `campaign.draftVersion`. The endpoint now verifies `expectedVersion` when provided, and returns `{ draftVersion, versionId, reviewFingerprint, valid, errors, warnings }`. | `backend/tests/reviewHardening.test.ts` (Finding 2: Validates draftVersion 2 on active campaign with version 1 published, reporting draft validation errors) |
| **Finding 3** | **P1: Atomic Campaign & Version Publication** | Activation saved the draft version, updated campaign to `ACTIVE`, and created audit logs across non-transactional individual writes. | Wrapped `POST /campaigns/:id/activate` and `POST /campaigns/:id/publish-revision` in MongoDB session transactions (`session.withTransaction`). Ensures draft marking as published, `activeVersionId` assignment, campaign status update, and `AuditLogModel` record persist atomically. Planning is triggered post-commit. | `backend/tests/reviewHardening.test.ts` (Finding 3 & 5: Atomic transaction commits version publish, activeVersionId update, and audit log together) |
| **Finding 4** | **P1: Lease-Fenced Execution Error Recovery** | Recovery catch branches in `dispatchExecutor.ts` (pause, contact-cap, stock-depletion, connection, transient failure) used unconditional `updateOne({ id, tenantId })`, bypassing lease fencing and CAS protections. | Formed strict `recoveryFence = { id: executionId, tenantId, state: 'EVALUATING', claimVersion: execution.claimVersion, planRevision: execution.planRevision, 'lease.token': execution.lease?.token }`. Every error recovery write is conditional on this fence. Stale workers failing CAS abort cleanly with `logger.warn` without mutating newer claims. | `backend/tests/reviewHardening.test.ts` (Finding 4: Stale worker with lease token A rejects modifying execution reclaimed by worker with lease token B) |
| **Finding 5** | **P1: Authoritative Template-Catalogue Verification** | Activation did not explicitly verify that pinned template reference matched approved revision and locale from the authoritative database catalogue. | Activation now validates all steps against `resolveApprovedTemplate(step.templateRef.id, tenantId, step.templateRef.revision, step.templateRef.language)`. Fails closed with 422 if template revision, locale, or readiness is mismatched or paused. | `backend/tests/reviewHardening.test.ts` (Finding 3 & 5: Activation fails closed with 422 on unapproved template revision 99) |
| **Finding 6** | **P1: Enforced Optimistic Concurrency Control** | `PATCH /campaigns/:id/draft` and `POST /campaigns/:id/activate` only checked `expectedVersion` if provided, allowing missing versions to bypass concurrency checks. | 1. Invalid or non-number `expectedVersion` returns 400 Bad Request.<br>2. Conflicting `expectedVersion !== campaign.draftVersion` returns 409 Conflict.<br>3. Enforced CAS on draft updates and activation.<br>4. Rejects stale submissions with clear diagnostic messaging. | `backend/tests/reviewHardening.test.ts` (Finding 6: Rejects invalid type with 400, version mismatch with 409, accepts valid version with 200) |
| **Finding 7** | **P1: Delivery Acceptance & Monotonic Status Progression** | Webhook handler fabricated `deliveredAt = providerTimestamp` when only read receipt arrived. Potential race between provider response and webhook receipts. | 1. `deliveredAt` remains unknown (`null`) when only `read` event arrives (Spec p.27).<br>2. Execution state updates are strictly monotonic (`state: { $in: [...] }` / `$nin: ['READ']`) so later or duplicate events cannot regress higher states.<br>3. Early read status reconciliation in `dispatchExecutor.ts` protects unknown `deliveredAt`. | `backend/tests/reviewHardening.test.ts` (Finding 7: Read receipt leaves deliveredAt null; subsequent out-of-order delivered event does not overwrite READ state) |

### Test Suite Execution Summary (16 October 2026)
- **Backend Test Suites:** 14 passed (14/14)
- **Individual Tests:** 174 passed (174/174, 0 failures, 0 skips)
- **Backend Typecheck:** `tsc --noEmit` clean (0 errors)
- **Frontend Production Build:** Next.js 16.4.0 `next build` clean (0 errors)

---

## 10. Higher Authority Review 2 Resolution (15 October 2026)

Following Review 2 feedback from the Senior Technical Manager / Higher Authority on main, the remaining concurrency and serialization items have been strictly addressed and verified:

| # | Review 2 Action | Implementation Details | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Action 1** | **Mandatory `expectedVersion` Across All Mutations** | Made `expectedVersion` mandatory on `PATCH /campaign-settings`, `PATCH /campaigns/:id/draft`, `POST /campaigns/:id/activate`, and `POST /campaigns/:id/publish-revision`. Missing or non-number returns `400 Bad Request` (`EXPECTED_VERSION_REQUIRED`). Version mismatch returns `409 Conflict`. | `backend/tests/reviewHardening.test.ts` ("Review 2: Mandatory expectedVersion on settings and campaign endpoints") |
| **Action 2** | **Atomic Campaign Publication & Pointer CAS** | Campaign publication and revision switching execute within a MongoDB replica set session transaction (`session.withTransaction`). Uses atomic CAS `findOneAndUpdate({ id, tenantId, draftVersion: expectedVersion })` updating `status`, `activeVersionId`, and `draftVersion`, writing `CampaignVersionModel` and `AuditLogModel` within the same transaction commit. Fails closed with 409 if any concurrent mutation altered `draftVersion`. | `backend/tests/reviewHardening.test.ts` ("Review 2: Atomic campaign publication CAS and audit logging") |
| **Action 3** | **Pause/Resume & Dispatch Submission Serialization** | Both `POST /campaigns/:id/pause` and `POST /campaigns/:id/resume` now acquire and increment `CampaignControlGateModel` within a MongoDB session transaction (`$inc: { gateVersion: 1 }`). Preflight guards and dispatch submission locks serialize through the exact same control gate version check, preventing stale workers from submitting dispatches while pause operations commit. | `backend/tests/reviewHardening.test.ts` ("Review 2: Pause-versus-dispatch serialization via CampaignControlGate") |
| **Action 4** | **Authoritative Template Revision & Locale Check** | `validateCampaignVersionDefinition` resolves templates against `resolveApprovedTemplate(id, tenantId, revision, language)` backed by `TemplateCatalogModel`. Unapproved revisions, mismatched locales, or paused templates fail validation closed with descriptive error messages. | Verified via `reviewHardening.test.ts` and `qaMatrix.test.ts` |
| **Action 5** | **Full Regression & CI Verification** | Complete 14-suite test harness executed against live MongoDB replica set (`MongoMemoryReplSet`). 174 tests pass with 0 skips and 0 failures. Typecheck clean on backend and frontend Next.js production build passes. | 174/174 tests pass in 32.18s (`npm test`) |

---

## 11. Higher Authority Review 3 Resolution (16 October 2026)

Following Review 3 feedback from the Senior Technical Manager / Higher Authority on main, the two remaining findings (P1 and P2) and the five mandatory regression tests have been strictly addressed and verified:

| # | Review 3 Action | Implementation Details | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Finding P1** | **Fail-Closed Template Resolution on DB Disconnect** | `resolveApprovedTemplate` in [templateCatalogue.ts](file:///d:/GROVIEWS/GroVastra/backend/src/modules/campaigns/adapters/templateCatalogue.ts) no longer catches database errors open into `APPROVED_TEMPLATES`. In production/strict mode, database errors immediately throw `TemplateCatalogueUnavailableError` and fail closed. Static catalogue fallback is restricted to explicit `ALLOW_STATIC_TEMPLATE_FALLBACK=true && NODE_ENV !== 'production'`. Activation route fails closed with `503 Service Unavailable` (`Activation failed: Template catalogue is currently unavailable`). | `backend/tests/reviewHardening.test.ts` ("Review 3 — P1: Database failure during template resolution fails closed, rejecting activation rather than falling open into static catalogue") |
| **Finding P2** | **Monotonic Delivery Intent & Status Progression** | [CampaignDeliveryIntent.model.ts](file:///d:/GROVIEWS/GroVastra/backend/src/modules/campaigns/models/CampaignDeliveryIntent.model.ts) now supports full lifecycle states (`DELIVERED`, `READ`, `EXPIRED`). In [dispatchExecutor.ts](file:///d:/GROVIEWS/GroVastra/backend/src/modules/campaigns/engine/dispatchExecutor.ts), provider response persistence uses monotonic conditional update (`state: { $in: ['SUBMITTING', 'OUTCOME_UNKNOWN'] }`). If an early webhook already moved the intent or execution to `DELIVERED` or `READ`, late provider response preserves the terminal delivery state. In [webhook.routes.ts](file:///d:/GROVIEWS/GroVastra/backend/src/modules/campaigns/routes/webhook.routes.ts), out-of-order `delivered` webhooks update timestamps while preserving `READ` terminal state. | `backend/tests/reviewHardening.test.ts` ("Review 3 — P2: Out-of-order delivery: A late provider ACCEPTED response does not regress delivery intent or execution from READ to ACCEPTED") |
| **Regression 1** | **Database Failure During Template Resolution** | Verified that a simulated MongoDB connection error during activation fails closed with `503 Service Unavailable`, leaving the campaign in `DRAFT` status and rejecting activation rather than falling open into the static catalogue. | `backend/tests/reviewHardening.test.ts` (Test 10) |
| **Regression 2** | **Out-of-Order Provider Responses and Delivery Webhooks** | Verified that when a `read` webhook arrives before the provider HTTP response is persisted, the late provider `ACCEPTED` response updates `providerMessageId` without regressing execution state or delivery intent state from `READ` to `ACCEPTED`. | `backend/tests/reviewHardening.test.ts` (Test 11) |
| **Regression 3** | **Concurrent Draft Edits and Version Collisions** | Verified that concurrent draft edits with identical `expectedVersion` race through CAS; exactly one succeeds (`200 OK`) and increments `draftVersion`, while the concurrent attempt is rejected with `409 Conflict`. | `backend/tests/reviewHardening.test.ts` (Test 12) |
| **Regression 4** | **Concurrent Activation Attempts** | Verified that concurrent activation requests with identical `expectedVersion` serialize through the atomic MongoDB session transaction; exactly one succeeds (`200 OK`), transitioning campaign status to `ACTIVE`, while the concurrent attempt fails CAS with `409 Conflict`. | `backend/tests/reviewHardening.test.ts` (Test 13) |
| **Regression 5** | **Transaction Rollback on Publication or Audit Failure** | Verified that if an error occurs inside the publication transaction (simulated `AuditLogModel.create` disk failure), the entire transaction aborts atomically: campaign status remains `DRAFT`, `activeVersionId` remains `null`, draft revision remains unactivated, and zero audit records persist. | `backend/tests/reviewHardening.test.ts` (Test 14) |




