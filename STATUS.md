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
| **P0.a**: `POST /api/v1/webhooks/orders` internal credential auth & tenant extraction | In Progress | No | Pending P0.a commit |
| **P0.a**: Tenant-scoped queries on order goal updates (no unscoped `updateMany`) | In Progress | No | Pending P0.a commit |
| **P0.a**: Remove hardcoded fallback tenant & invented `netPaise` defaults | In Progress | No | Pending P0.a commit |
| **P0.a**: Occasion matching via `occasionRef` or explicit staff goal (A12, C17, C18) | In Progress | No | Pending P0.a commit |
| **P0.a**: Step-level `stopOnGoal` respected (do not skip when `stopOnGoal: false`) | In Progress | No | Pending P0.a commit |
| **P0.b**: `POST /internal/campaign-events` per-producer, per-tenant credentials scoped by event family | Partial | Partial | Pending P0.b commit |
| **P0.b**: Durable event persistence (`RECEIVED`) before HTTP ACK | Yes | Yes | Pending B03 test |
| **P0.b**: Event rescan worker for unprocessed `RECEIVED` events (crash recovery B03) | Partial | Partial | Pending B03 test |
| **P0.b**: Entity version check: reject stale entity versions | Partial | Partial | Pending P0.b commit |
| **P0.b**: Schema validation sending unparseable/unknown events to visible `QUARANTINE` | Partial | Partial | Pending P0.b commit |
| **P0.c**: Inbound WhatsApp reply connection-to-tenant mapping & tenant-scoped customer lookup | Partial | Partial | Pending P0.c commit |
| **P0.c**: E.164 phone normalization utility replacing naive regex | No | No | Pending P0.c commit |
| **P0.d**: Real credentials login endpoint returning scoped JWT | No | No | Pending P0.d commit |
| **P0.d**: Frontend: remove hardcoded `x-tenant-id` and hardcoded shop names | No | No | Pending P0.d commit |
| **P0.d**: Role-based access control (Staff activity/holds vs Owner/Admin campaigns & policy) | No | No | Pending P0.d commit |

---

## 3. Work Package P1 — Execution Correctness

| Requirement | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| **P1.a**: Separate `claimVersion` counter on `CampaignExecutionModel` distinct from `planRevision` | Partial | Partial | Pending P1.a commit |
| **P1.a**: Final dispatch submission validation: lease token, expected `planRevision`, state, lease & expiresAt > now (B15, B20) | Partial | Partial | B15 |
| **P1.b**: Atomic MongoDB transaction for gates validation + capacity reservation + intent freeze + DISPATCHING | Partial | Partial | Pending P1.b commit |
| **P1.b**: Zero provider HTTP requests inside database transactions | Yes | Yes | C09 |
| **P1.b**: Stranded intent resolution: lost leases do not block unique executionId index | Partial | Partial | Pending P1.b commit |
| **P1.c**: Campaign and Tenant control-gate documents with monotonic gate versions (B11, B12) | Partial | Partial | B11 |
| **P1.c**: Global pause control and FUTURE_ONLY logging of steps falling due during pause | Partial | Partial | REG-06 |
| **P1.d**: Bounded exponential backoff with `RETRY_WAIT` state and `retryAt` timestamp | Partial | Partial | C05 |
| **P1.d**: Retry restricted to Meta M4 non-acceptance error codes; all gates rechecked | Partial | Partial | Pending P1.d commit |
| **P1.d**: Safe contact reservation release & re-acquire on retry (C08, C09, C20) | Partial | Partial | Pending P1.d commit |
| **P1.d**: `BLOCKED_STALE_INTENT` when frozen intent source data changes before retry (C20) | Partial | Partial | Pending C20 |
| **P1.e**: Contact ledger counting reserved, accepted, and unknown outcomes | Yes | Yes | B03, B04 |
| **P1.e**: Destination-wide cap across duplicate CRM customer records sharing phone (B10) | Partial | Partial | Pending B10 |
| **P1.e**: Atomic collision arbitration: priority -> earliest expiry -> creation order (B09) | Yes | Yes | B06 |
| **P1.e**: In-memory contact cap fallback removed from production paths | Partial | Partial | Pending P1.e commit |
| **P1.f**: Webhook status deduplication via compound unique index | Yes | Yes | C08, REG-04 |
| **P1.f**: Monotonic execution status progression (`READ` > `DELIVERED` > `PROVIDER_ACCEPTED`) | Yes | Yes | REG-02 |
| **P1.f**: Provider timestamps used for delivery and read receipts | Yes | Yes | C03, C04 |
| **P1.f**: Handling status event arriving before send response persistence (C12) | Partial | Partial | Pending C12 |
| **P1.f**: Raw-byte HMAC verification failing closed | Yes | Yes | REG-03 |
| **P1.g**: Unique enrollment & execution tombstones with atomic detail pruning (B18) | Partial | Partial | Pending B18 |
| **P1.h**: Masked projections for history; zero phone numbers or raw message bodies in logs | Partial | Partial | Pending P1.h commit |
| **P1.h**: Recipient phone encrypted at rest with AES-256-GCM | Yes | Yes | B07 |
| **P1.h**: Fair multi-tenant worker scheduling | Partial | Partial | Pending P1.h commit |

---

## 4. Work Package P2 — Milestone 2 Gaps

| Requirement | Exists | Wired and running | Proven by test (test ID) |
| :--- | :--- | :--- | :--- |
| **P2.a**: Audience rules engine (`all`/`any`/`none`, explicit `ALL_ELIGIBLE`, match explanations) | Partial | Partial | A04 |
| **P2.b**: Discovery window (today - largest offset) to (today + largest lead + 30d) (B19) | Partial | Partial | Pending B19 |
| **P2.b**: FUTURE_ONLY activation/resume with 2-hour technical outage grace (B05, B06, B13) | Partial | Partial | Pending B06, B13 |
| **P2.c**: Leap-day policies (`FEB_28`, `MAR_01`, `LEAP_ONLY`) (A08) | Yes | Yes | A08 |
| **P2.c**: Timezone and local-time calculation avoiding UTC midnight drift | Yes | Yes | A05 |
| **P2.d**: Anniversary & wedding per-eventId occurrences and postponement replan (A09, A10) | Partial | Partial | Pending A09, A10 |
| **P2.e**: Date corrections: within-year replan vs across-year `correctionGroupId` lineage (B04) | Partial | Partial | Pending B04 |
| **P2.f**: Immutable published versions; draft PATCH never mutates published (B14) | Partial | Partial | Pending B14 |
| **P2.g**: Activation requires matching dry-run reviewFingerprint (A03, C01) | Yes | Yes | A03, C01 |
| **P2.h**: Validation endpoint with fieldPath and resolutionOwner (A05) | Partial | Partial | Pending A05 |
| **P2.i**: Meta positional parameters driven strictly by template variable keys (C05) | Yes | Yes | REG-08 |
| **P2.j**: Idempotency keys on mutations; 409 on version conflict (C15, C16) | Partial | Partial | Pending C15, C16 |
| **P2.k**: Next.js Studio (Editor, Dry Run, Simulator, Activity, Settings) | Yes | Yes | UI build clean |
| **P2.l**: Staff actions (resolve-hold, mark-goal) with audited reason precedence | Partial | Partial | A11, A12 |

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
