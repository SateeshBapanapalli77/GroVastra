# GroVastra: Architectural Decisions & Implementation Blueprint
**Architecture Style:** Modular Monolith  
**Modules:** Auto Campaigns (WhatsApp) + Social Features (Bio & Storefront)  
**Status:** Approved Engineering Blueprint  
**Last Updated:** October 2026  

---

## 1. Executive Summary & Solo Developer Strategy

GroVastra is a specialized SaaS platform for handloom stores, apparel boutiques, and bespoke designers. This document serves as the single source of truth for architectural choices, system boundaries, design patterns, and the step-by-step implementation plan.

### System Boundaries & Zero-Cost Policy
As a solo developer, we do not have an upstream team provisioning external services. To remain 100% unblocked and avoid any cloud or Meta API billing:
1. **Decoupled WhatsApp Adapter Pattern**:
   - **Development & Automated Testing**: Driven by a local **Mock WhatsApp Adapter** with a pre-seeded, read-only approved template catalogue (Birthday, Anniversary, Restock, Festival, Enquiry, Boutique Alterations).
   - **Interactive Simulation**: Local test endpoints simulate provider delivery events (`sent`, `delivered`, `read`), inbound customer replies, and domain events (`order.completed`, `stock.published`).
   - **Production / Live Testing**: Restricted to Meta's free **WhatsApp Cloud API Developer Sandbox** (using test phone numbers and whitelisted recipient numbers). **Zero credit cards, zero paid conversations.**
2. **Strict Single-Backend Rule**:
   - Express 5 is the **sole backend API and worker runtime**. Next.js App Router is used exclusively for the presentation layer (Client Dashboard + Server-Rendered Bio pages). Next.js API routes and server actions are prohibited.

---

## 2. Architecture Style: Modular Monolith

To maximize development velocity for a solo developer while maintaining enterprise-grade maintainability, GroVastra is structured as a **Modular Monolith**.

### Modular Monolith Principles
1. **Module Encapsulation**: Each module (`campaigns`, `social`, `crm`, `orders`, `inventory`) owns its private models, services, and business rules. Modules must not directly import or mutate internal models of another module.
2. **Public Module Facades**: Cross-module communication happens strictly via typed public APIs (e.g. `crmModule.getCustomerSummary(id)` or `catalogModule.verifyStockAvailability(sku)`).
3. **In-Process Domain Event Bus**: When events occur (`order.completed`, `stock.published`, `customer.replied`), modules publish events to an asynchronous, durable event inbox without tight coupling.
4. **Extraction-Ready**: If any module (such as the execution worker or campaign scheduler) needs to scale independently in the future, its clean boundary allows it to be extracted into a standalone service with minimal refactoring.

---

## 3. Design Patterns & System Design Register

The following design patterns and system design principles are mandated across the codebase:

| Pattern / Concept | Where Applied | Purpose / Benefit |
| :--- | :--- | :--- |
| **Adapter Pattern** | `WhatsAppDeliveryAdapter` (`MockAdapter`, `MetaCloudApiAdapter`) | Decouples campaign logic from Meta's API; enables instant, zero-cost offline testing and call count assertions. |
| **Facade Pattern** | Module `index.ts` exports | Enforces clean encapsulation; exposes only public methods and hides internal Mongoose models. |
| **Strategy Pattern** | `TriggerStrategy` (`AnnualDate`, `DomainEvent`, `InactivityScan`) | Encapsulates distinct scheduling and discovery algorithms behind a uniform interface. |
| **Specification Pattern**| `AudienceEvaluator` (`all`, `any`, `none` predicates) | Composable, type-safe boolean rule evaluation over customer attributes without arbitrary code execution. |
| **Chain of Responsibility**| `PreflightSafeguardPipeline` (Due Step Dispatch) | Executes sequential gates (Pause -> Opt-out -> Reply/Goal Stop -> Contact Cap -> Live Stock) before message submission. |
| **Outbox / Inbox Pattern**| `campaignEventInbox` | Durable, idempotent domain event and webhook ingestion; protects against server crashes and duplicate replays. |
| **Two-Phase Intent** | Plan vs. Dispatch Lifecycle | Keeps planning decoupled from rendered content; freezes immutable delivery intent only at due time. |
| **Lease & CAS Concurrency**| `findOneAndUpdate` Worker Poller | Multi-worker distributed locking without Redis; atomic lease tokens and `planRevision` compare-and-swap prevent race conditions. |

---

## 4. Final Decided Tech Stack

| Layer / Concern | Technology | Technical Rationale |
| :--- | :--- | :--- |
| **Language** | **TypeScript (Strict)** | Unified type contracts across Zod schemas, MongoDB documents, and UI props. |
| **Frontend Framework** | **Next.js 15 (App Router) + React 19** | Sub-2.5s LCP for public `/bio` links via SSR/ISR; rich, responsive client components for campaign dashboards. |
| **Styling & Design** | **Tailwind CSS + shadcn/ui** | Clean, premium boutique aesthetic (luxurious handloom theme) with zero CSS bloat. |
| **Frontend State & Forms**| **TanStack Query v5 + React Hook Form + Zod** | Server-state caching without Redux bloat; declarative form validation for multi-step wizards. |
| **Backend Runtime** | **Node.js (LTS) + Express 5** | Modular monolith housing the REST API and lightweight background worker loops. |
| **Database** | **MongoDB (Replica Set required)** | Native multi-document ACID transactions, lease locking (`findOneAndUpdate`), and unique compound indexes. (Atlas M0 Free Tier). |
| **ODM / Persistence** | **Mongoose (Strict)** | Strict schema typing, explicit session propagation, and atomic compare-and-swap operations. |
| **Validation** | **Zod** | Runtime boundary validation for rule operators, predicates, and inbound webhooks. |
| **Dates & Timezones** | **Luxon** | Robust IANA timezone management (`Asia/Kolkata`), leap-day policies (`FEB_28`/`MAR_01`), signed day offsets. |
| **Logging & Security** | **Pino + Node `crypto` (AES-256-GCM)** | Sensitive customer data encrypted at rest; phone numbers and raw message bodies redacted in logs. |
| **Testing** | **Vitest + In-Memory Replica Set** | Fast test execution with realistic MongoDB transactional semantics and mock adapter assertions. |

---

## 5. Core Architectural Decisions (ADRs)

### ADR 01: MongoDB-Backed Durable Scheduler (No Redis / No BullMQ)
* **Context**: The specification explicitly mandates: *"A MongoDB replica set supports the specified transactions. Redis is not required."*
* **Decision**: All scheduling state lives in `campaignExecutions`. Workers poll using atomic `findOneAndUpdate` with expiring lease tokens (`lease.until > now`, `planRevision` match).
* **Rule**: Process timers only wake workers; they never hold schedules in memory. Server restarts must survive gracefully.

### ADR 02: Late Binding & Two-Phase Delivery Intent
* **Context**: Campaigns are scheduled weeks ahead, but customer state, stock, or opt-out status can change in the interim.
* **Decision**: Scheduled steps only store bindings (e.g., `customer.firstName`, `shop.name`). 
* **Rule**: Only when `dueAt <= now` does the worker evaluate live eligibility, reserve contact caps, and freeze an immutable `campaignDeliveryIntents` record immediately prior to provider submission.

### ADR 03: Deterministic Collision Resolution & Contact Caps
* **Context**: Multiple campaigns (e.g. Birthday + Festival + Restock) can compete for the same customer.
* **Decision**:
  - **Global Marketing Caps**: Strict maximum of **1 marketing message per rolling 24 hours** and **3 per rolling 7 days** per canonical phone number.
  - **Priority Arbitration**: `Birthday (80) > Wedding (70) > Restock (60) > Festival (50) > Win-back (30)`.
  - Losing steps are safely deferred to the next valid slot if still within `usefulUntil`, or marked `SKIPPED_CONTACT_CAP`.
* **Rule**: Service/operational updates (order pickup, fitting ready) have separate limits and never bypass caps under the guise of marketing.

### ADR 04: Immutable Campaign Versions & Safe Outage Recovery
* **Context**: Edits to an active campaign must not corrupt active customer sequences or send duplicate messages.
* **Decision**:
  - Published versions are frozen. Editing an active campaign creates version `N+1`. Existing enrollments retain version `N`.
  - **Resume & Outage Policy**: Defaults to `FUTURE_ONLY` with a maximum technical outage grace period of 2 hours. Missed historical steps are marked `SKIPPED_OUTAGE_EXPIRED` to prevent message bursts.

### ADR 05: Smart Stop Rules (`stopOnReply` & `stopOnGoal`)
* **Decision**:
  - `stopOnReply = true`: If a customer replies on WhatsApp, subsequent promotional steps are held (`replyHoldAt != null`) for manual staff takeover.
  - `stopOnGoal = true`: If an order or goal event is completed, future sales steps are skipped with reason `SKIPPED_GOAL_REACHED`.

---

## 6. Specification Identity, Precedence & Date Rules (Handoff v2.0 Standards)

### A. Business Identity Keys (Page 18)
To prevent duplicates, the engine uses strictly calculated business identity keys backed by MongoDB unique indexes:
```ts
enrollmentKey = `${tenantId}:${campaignId}:${customerId}:${occurrenceId}`
executionKey  = `${enrollmentId}:${stableStepId}`
deliveryKey   = `${executionId}`
```
> [!IMPORTANT]
> **Strict Rule (Page 18)**: Do **not** include campaign version, template revision, retry count, worker ID, or schedule time in these business-identity keys.

### B. Standard Reason Precedence for Explanations (Page 33)
When evaluating why a message was skipped, deferred, or held, the engine evaluates in this exact precedence order:
1. `CUSTOMER_DELETED` or `CHANNEL_SUPPRESSED`
2. `CAMPAIGN_OR_GLOBAL_PAUSED`
3. `INVALID_SOURCE_OR_DATE`
4. `STEP_EXPIRED` (past `expiresAt` or lateness cutoff)
5. `GOAL_REACHED` (`stopOnGoal`)
6. `REPLY_HOLD` (`stopOnReply`)
7. `CONTENT_OR_TEMPLATE_BLOCKED`
8. `PREREQUISITE_NOT_MET` (`PREVIOUS_ACCEPTED` missing)
9. `CONTACT_CAP_EXCEEDED` (24h or 7d limit hit)

### C. Date Conversion & Leap-Day Rules (Page 7 & 17)
- **Timezone**: Store timezone as IANA identifier (default: `Asia/Kolkata`).
- **Date-Only Occasions**: Date-only birthdays and anniversaries must **never** be converted through midnight UTC. First apply the step's local time (e.g. `10:00`), then convert to UTC.
- **Leap Day Policy**: Explicitly configurable per campaign:
  - `FEB_28`: Send on February 28th during non-leap years.
  - `MAR_01`: Send on March 1st during non-leap years.
  - `LEAP_ONLY`: Skip completely during non-leap years.

### D. Standard Prefixed Identifiers
To ensure traceability across logs and MongoDB Compass:
- Campaigns: `cmp_`
- Campaign Versions: `cv_`
- Enrollments: `enr_`
- Executions: `exe_`
- Delivery Intents: `di_`
- Events: `evt_`

---

## 7. Repository Layout (Modular Monolith)

```
GroVastra/
├── backend/                        # Express 5 + Worker Runtime
│   ├── src/
│   │   ├── config/                 # Database, env, security, and logger configs
│   │   ├── shared/                 # Cross-cutting primitives (EventBus, Clock, Errors)
│   │   ├── modules/
│   │   │   ├── campaigns/          # AUTO CAMPAIGNS MODULE (Encapsulated)
│   │   │   │   ├── index.ts        # Module Public Facade
│   │   │   │   ├── models/         # 10 MongoDB collections (Mongoose)
│   │   │   │   ├── engine/         # Strategies, Audience Specification, Pipeline
│   │   │   │   ├── adapters/       # IWhatsAppDeliveryAdapter (Mock & Sandbox)
│   │   │   │   ├── presets/        # Standard Handloom & Boutique campaign presets
│   │   │   │   └── routes/         # /api/v1/campaigns routes
│   │   │   ├── crm/                # Customers, opt-outs, preferences facade
│   │   │   ├── inventory/          # Handloom sarees, variants, restock events
│   │   │   ├── orders/             # Order completions, refunds, goal matching
│   │   │   └── social/             # Social features (bio, store links)
│   │   ├── workers/                # Dedicated Worker Process Entrypoints
│   │   │   ├── planner.ts          # Calendar & Occasion Discovery Worker
│   │   │   ├── executor.ts         # Due-Step Lease Poller & Dispatch Pipeline
│   │   │   └── events.ts           # Durable Domain Event Consumer
│   │   └── server.ts               # HTTP REST API Server
│   └── package.json
│
├── frontend/                       # Next.js 15 (App Router) + shadcn/ui
│   ├── src/
│   │   ├── app/
│   │   │   ├── (dashboard)/        # Campaign studio, activity feed, settings
│   │   │   └── bio/                # Public boutique storefront link (SSR)
│   │   ├── components/
│   │   │   ├── ui/                 # shadcn/ui primitives
│   │   │   └── campaigns/          # Wizard steps, dry-run card, timeline
│   │   └── lib/                    # TanStack Query hooks, API client
│   └── package.json
│
└── docs/                           # Technical Specifications & Architecture
    ├── DECISIONS.md                # This file
    ├── GroVastra_Auto_Campaigns_Developer_Handoff.pdf
    └── GroVastra-Social-Features-Technical-Handoff.pdf
```

---

## 8. Implementation Roadmap (Plan of Action)

### Milestone 1: Foundation, Schemas & Modular Core
- [x] Initialize `backend/` with Express 5, TypeScript, Mongoose, and Zod.
- [x] Implement `shared/` core primitives: In-Process Domain Event Bus and Timezone Clock.
- [x] Implement the 10 core MongoDB Mongoose schemas with compound unique indexes in `modules/campaigns/models/`:
  - `campaigns`, `campaignVersions`, `campaignEnrollments`, `campaignExecutions`, `campaignDeliveryIntents`, `campaignContactGates`, `campaignEventInbox`, `campaignCheckpoints`, `campaignCustomerFacts`, `campaignDryRuns`.
- [x] Implement `modules/campaigns/adapters/`:
  - `IWhatsAppDeliveryAdapter` interface.
  - `MockWhatsAppDeliveryAdapter` (tracks sends, status events, call-counter assertions).
  - Pre-seeded **Approved Template Catalogue** (Birthday, Anniversary, Restock, Alterations, Win-back).
- [x] Implement seed CRM & Inventory data for realistic handloom boutique scenarios.

### Milestone 2: Reference Campaign (Birthday & Anniversary) End-to-End
- [x] Initialize `frontend/` with Next.js 15 (App Router), Tailwind CSS, and shadcn/ui.
- [x] Build the Next.js Campaign Studio Wizard:
  - Preset selector -> Trigger config -> Audience builder (`all`/`any`/`none` via Specification Pattern) -> Step mapper -> Sending rules.
  - Interactive WhatsApp Phone Simulator with live step switching and boutique saree preview.
- [x] Build the **Dry Run Evaluator** (`modules/campaigns/engine/dryRun.ts` / `DryRunModal.tsx`):
  - Deterministic review fingerprinting, projected audience counts, and sample rendered preview (zero live sends).
- [x] Build the **Calendar Planner** (`workers/planner.ts` + `AnnualDateTriggerStrategy`):
  - Luxon-based occasion discovery; creates durable `campaignEnrollments` and `campaignExecutions`.

### Milestone 3: Durable Execution Engine & Safeguards
- [x] Build the **Execution Worker** (`workers/executor.ts` & `dispatchExecutor.ts`):
  - Periodic polling using atomic `findOneAndUpdate` with lease tokens.
  - CAS validation on `planRevision` and lease expiry.
- [x] Implement the **Preflight Safeguard Pipeline** (Chain of Responsibility in `safeguardPipeline.ts`):
  - Pause gate, Customer permission gate, Stop rules gate (`stopOnReply`, `stopOnGoal`), Contact cap gate (1/24h, 3/7d), Live data check.
- [x] Implement late-binding delivery intent freezing (`campaignDeliveryIntents` with AES-256-GCM encryption & payload hashing).
- [x] Dispatch via `WhatsAppDeliveryAdapter` and process delivery status transitions (`ACCEPTED`, `DELIVERED`, `READ`, `OUTCOME_UNKNOWN`).

### Milestone 4: Merchandise & Lifecycle Scenarios
- [x] Build the **Domain Event Consumer** (`workers/events.ts`):
  - Ingestion for `stock.published`, `order.completed`, `enquiry.received`, `alteration.completed`.
- [x] Implement merchandise & boutique strategies:
  - Requested restock matching (exact SKU/variant requests in `restockStrategy.ts`).
  - Festival & seasonal collection launches (dated owner events).
  - Unresolved enquiry follow-ups (+24h, +72h in `enquiryStrategy.ts`).
  - Boutique alteration & fitting readiness notices in `boutiqueServiceStrategy.ts`.
  - Inactivity scanner (win-back strategy for 90/180-day lapses in `inactivityScanner.ts`).

### Milestone 5: Activity Log, Explainability & QA Matrix
- [x] Build the Campaign Activity UI with plain-English explanation reasons:
  - *"Selected: birthday in 14 days"*
  - *"Skipped: 24h contact cap reached"*
  - *"Held: customer replied to previous message"*
- [x] Provide staff actions: manual hold resolution and manual goal tagging (`POST /enrollments/:id/resolve-hold`, `POST /enrollments/:id/mark-goal`).
- [x] Validate implementation against the 58-scenario QA Acceptance Matrix (`backend/tests/qaMatrix.test.ts` covering Matrix A, B, and C with 61 passing unit tests).
- [x] Provide optional setup instructions for the zero-cost Meta Developer Sandbox (`docs/WHATSAPP_SANDBOX_GUIDE.md`).