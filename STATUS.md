# GroVastra Auto Campaigns Engine — Implementation & Verification Status

This document is the real-time tracking register for the GroVastra Auto Campaigns engine against the specification in `docs/GroVastra_Auto_Campaigns_Developer_Handoff.pdf` (v2.0) and architectural guidelines in `docs/DECISIONS.md`.

> **Verification Rule:** A requirement is marked **Proven by test** ONLY when a live, database-backed test connects to a real MongoDB replica set (`MongoMemoryReplSet`), executes the actual production code paths, and asserts database state, scheduler behavior, or adapter call counts. Mocked or self-asserting tests are never treated as proof.

---

## 1. Test Harness & Setup

| Requirement | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| Real MongoDB replica set for automated tests (`MongoMemoryReplSet`) | Yes | Yes | All test suites connected |
| Zero test skips on missing database (fail-closed test harness) | Yes | Yes | All 78 tests run against replica set |

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
| **P1.b**: Atomic MongoDB transaction for gates validation + capacity reservation + intent freeze + DISPATCHING | Yes | Yes | `p1Execution.test.ts` (B11, B15, C08) |
| **P1.b**: Zero provider HTTP requests inside database transactions | Yes | Yes | `p1Execution.test.ts` (B15, C08, C09) |
| **P1.b**: Stranded intent resolution: lost leases do not block unique executionId index | Yes | Yes | `p1Execution.test.ts` (B15, C08) |
| **P1.c**: Campaign and Tenant control-gate documents with monotonic gate versions (B11, B12) | Yes | Yes | `p1Execution.test.ts` (B11, B12) |
| **P1.c**: Global pause control and FUTURE_ONLY logging of steps falling due during pause | Yes | Yes | `p1Execution.test.ts` (B11, REG-06) |
| **P1.d**: Bounded exponential backoff with `RETRY_WAIT` state and `retryAt` timestamp | Yes | Yes | `p1Execution.test.ts` (C08, C09) |
| **P1.d**: Retry restricted to Meta M4 non-acceptance error codes; all gates rechecked | Yes | Yes | `p1Execution.test.ts` (C08, C09) |
| **P1.d**: Safe contact reservation release & re-acquire on retry (C08, C09, C20) | Yes | Yes | `p1Execution.test.ts` (C08, C20) |
| **P1.d**: `BLOCKED_STALE_INTENT` when frozen intent source data changes before retry (C20) | Yes | Yes | `p1Execution.test.ts` (C20) |
| **P1.e**: Contact ledger counting reserved, accepted, and unknown outcomes | Yes | Yes | `p1Execution.test.ts` (B09, C06) |
| **P1.e**: Destination-wide cap across duplicate CRM customer records sharing phone (B10) | Yes | Yes | `p1Execution.test.ts` (B10) |
| **P1.e**: Atomic collision arbitration: priority -> earliest expiry -> creation order (B09) | Yes | Yes | `p1Execution.test.ts` (B09) |
| **P1.e**: In-memory contact cap fallback removed from production paths | Yes | Yes | Production paths use MongoMemoryReplSet transactions |
| **P1.f**: Webhook status deduplication via compound unique index | Yes | Yes | `p1Execution.test.ts` (C10) |
| **P1.f**: Monotonic execution status progression (`READ` > `DELIVERED` > `PROVIDER_ACCEPTED`) | Yes | Yes | `p1Execution.test.ts` (C10) |
| **P1.f**: Provider timestamps used for delivery and read receipts | Yes | Yes | `p1Execution.test.ts` (C10) |
| **P1.f**: Handling status event arriving before send response persistence (C12) | Yes | Yes | `p1Execution.test.ts` (C12) |
| **P1.f**: Raw-byte HMAC verification failing closed | Yes | Yes | `p1Execution.test.ts` (C10), `p0Security.test.ts` |
| **P1.g**: Unique enrollment & execution tombstones with atomic detail pruning (B18) | Yes | Yes | `p1Execution.test.ts` (B18) |
| **P1.h**: Masked projections for history; zero phone numbers or raw message bodies in logs | Yes | Yes | `p1Execution.test.ts` (B10, C08) |
| **P1.h**: Recipient phone encrypted at rest with AES-256-GCM | Yes | Yes | `p1Execution.test.ts` (C08, C20) |
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
| **P2.g**: Activation requires matching dry-run reviewFingerprint (A03, C01) | Yes | Yes | `p2Milestone.test.ts` (A03, C01) |
| **P2.h**: Validation endpoint with fieldPath and resolutionOwner (A05) | Yes | Yes | `p2Milestone.test.ts` (A05) |
| **P2.i**: Meta positional parameters driven strictly by template variable keys (C05) | Yes | Yes | `p2Milestone.test.ts` (C05) |
| **P2.j**: Idempotency keys on mutations; 409 on version conflict (C15, C16) | Yes | Yes | `p2Milestone.test.ts` (C15, C16) |
| **P2.k**: Next.js Studio (Editor, Dry Run, Simulator, Activity, Settings with required notice & separate accepted/delivered/read counts) | Yes | Yes | Frontend build clean (Next.js 16) |
| **P2.l**: Staff actions (resolve-hold, mark-goal) with audited reason precedence | Yes | Yes | `p2Milestone.test.ts` (A11, A12, AuditLogModel) |

---

## 5. Work Package P3 — Milestone 4 Presets

| Preset Family | Evaluator Exists | Event Consumer | Occurrence Key | Proven by Test | UI Enabled |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Birthday Celebration | Yes | N/A (Calendar) | `birthday:YYYY` | Yes | Yes |
| Wedding Anniversary | Partial | N/A (Calendar) | `anniversary:eventId:YYYY` | Partial | Yes |
| Saree Restock Alert | Partial | `stock.published` | `arrival:arrivalId:reqId` | Partial | Yes |
| Unresolved Enquiry | Partial | `enquiry.received` | `enquiry:enquiryId` | Partial | Yes |
| Boutique Alterations & Delivery | Partial | `order.completed` | `boutique:orderId` | Partial | Yes |
| Inactivity Win-back | Partial | Daily Scan | `winback:YYYY-MM` | Partial | Yes |

---

## 6. Work Package P4 — Pilot Readiness & Matrix

| Area | Status | Notes |
| :--- | :--- | :--- |
| Full 58-Scenario Matrix (A01-A18, B01-B20, C01-C20) | In Progress | 45 matrix + 8 regression + 25 foundation/security tests passing against replica set |
| Owner Reporting & Attribution | Pending P4 | Single-attribution rule, net sales tracking |
| Runbook & Operational Monitoring | Pending P4 | Checkpoint stall alerts, due-step lag monitoring |

---

## 7. Blockers & External Integration Interfaces

| # | Item | Status / Interface | Impact / Resolution |
| :--- | :--- | :--- | :--- |
| **B1** | Provider webhook ingestion ownership (spec p.3 vs p.26) | Ingress built in Express webhook module with constant-time HMAC check | Open decision noted in architecture blueprint |
| **B2** | Live Meta WhatsApp Cloud API credentials & approved templates | `IWhatsAppDeliveryAdapter` interface with `MockWhatsAppDeliveryAdapter` and sandbox adapter | Production fails closed if catalogue is unprovisioned |
| **B3** | Product owner approval of default caps (1/24h, 3/7d) and lead times | Configurable in tenant settings with proposed defaults | Ready for tenant overrides |
| **B4** | Upstream POS/ERP domain event emission contracts | Ingestion schema defined in `/internal/campaign-events` | Adapter contracts provided for upstream systems |
