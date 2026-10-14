# GroVastra
### Autonomous Lifecycle Campaign & Social Engine for Heritage Handloom Boutiques

[![Next.js](https://img.shields.io/badge/Next.js-15.1%20App%20Router-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-5.0.1-black?style=flat&logo=express)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Replica%20Set-green?style=flat&logo=mongodb)](https://www.mongodb.com/)
[![Vitest](https://img.shields.io/badge/Tests-61%20Passed%20(1.9s)-success?style=flat&logo=vitest)](https://vitest.dev/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Cloud%20API%20Sandbox-25D366?style=flat&logo=whatsapp)](https://developers.facebook.com/)
[![Architecture](https://img.shields.io/badge/Architecture-Modular%20Monolith-orange?style=flat)](#2-system-architecture)

---

## 1. Executive Summary

**GroVastra** is a purpose-built Boutique Operating System (OS) and Lifecycle Marketing Automation platform engineered specifically for heritage handloom stores and apparel boutiques (reference store: *Padmavati Handlooms*). 

Unlike generic e-commerce mass-blast tools that spam customers and damage brand reputation, GroVastra automates high-touch, hyper-personalized patron journeys (Birthdays, Anniversaries, Saree Restocks, Boutique Tailoring Updates, and Inactivity Win-backs) over WhatsApp with strict anti-spam contact caps, atomic lease polling, and human-in-the-loop sales holds.

---

## 2. System Architecture

GroVastra is architected as a **Modular Monolith** using **Express 5** and **Next.js 15 App Router**. It deliberately eliminates external cache and broker dependencies (such as Redis or BullMQ), relying on MongoDB Replica Set transactional semantics and atomic conditional updates (`findOneAndUpdate`) for durable distributed execution.

```
+---------------------------------------------------------------------------------------+
|                                    GROVASTRA CLIENT                                   |
|   Next.js 15 (App Router) + React 19 + Tailwind CSS + Interactive WhatsApp Simulator  |
+-------------------------------------------+-------------------------------------------+
                                            |
                                 REST API / Webhooks (HTTP)
                                            |
+-------------------------------------------v-------------------------------------------+
|                              EXPRESS 5 MODULAR MONOLITH                               |
|                                                                                       |
|  +--------------------+  +--------------------+  +--------------------+  +---------+  |
|  |     Campaigns      |  |        CRM         |  |     Inventory      |  | Orders  |  |
|  |  (Rules & Engine)  |  |  (Patrons/Consent) |  |  (Sarees/Restock)  |  | (Goals) |  |
|  +---------+----------+  +---------+----------+  +---------+----------+  +----+----+  |
|            |                       |                       |                  |       |
|            +-----------------------+-----------------------+------------------+       |
|                                            |                                          |
|                               +------------v------------+                             |
|                               | In-Process Event Bus    |                             |
|                               +------------+------------+                             |
|                                            |                                          |
|            +-------------------------------+-------------------------------+          |
|            |                               |                               |          |
|  +---------v----------+          +---------v----------+          +---------v-------+  |
|  |  Occasion Planner  |          | Execution Worker   |          | Event Consumer  |  |
|  |  (30-day discover) |          | (Atomic 30s Lease) |          | (Restock/Order) |  |
|  +---------+----------+          +---------+----------+          +---------+-------+  |
+------------|-------------------------------|-------------------------------|----------+
             |                               |                               |
+------------v-------------------------------v-------------------------------v----------+
|                              STORAGE LAYER (MongoDB 8.0)                              |
|   campaigns · campaignVersions · campaignEnrollments · campaignExecutions (Leased)   |
|   campaignDeliveryIntents (Frozen/Encrypted) · campaignContactGates · dryRuns         |
+--------------------------------------------+------------------------------------------+
                                             |
                         +-------------------v-------------------+
                         |      IWhatsAppDeliveryAdapter         |
                         +-------------------+-------------------+
                                             |
                     +-----------------------+-----------------------+
                     |                                               |
     +---------------v---------------+               +---------------v---------------+
     |  MockWhatsAppDeliveryAdapter  |               | WhatsAppSandboxDeliveryAdapter|
     |  - In-Memory Offline Dev      |               | - Live Meta Cloud API (v21.0) |
     |  - Zero Network / 61 Tests    |               | - 100% Free Sandbox & Sandbox |
     +-------------------------------+               +-------------------------------+
```

---

## 3. Core Features & Capabilities

### 🎨 Luxury Boutique Studio & Simulator
- **5-Step Studio Wizard**: Intuitive campaign configuration covering Trigger Conditions, Audience Rules (Specification pattern), Sequence Steps, Delivery Safeguards, and Pre-flight Dry Runs.
- **Interactive WhatsApp Phone Simulator**: Real-time rendering of WhatsApp chat bubbles, personalized Kanjeevaram saree rich cards, interactive quick-reply buttons, and dynamic step switching.
- **Explainability Audit Feed**: Human-readable transparency stream explaining why every patron was selected, deferred, held, or skipped (e.g. *"Customer replied to invitation; sales follow-up held for human weaver desk"*).
- **One-Click Staff Interventions**: Immediate manual hold releases and in-store purchase goal completions.

### 🛡️ Preflight Safeguards Pipeline (Chain of Responsibility)
Every due step is evaluated at runtime against strict reason precedence before any message is dispatched:
1. `CHANNEL_SUPPRESSED` / `CUSTOMER_DELETED`
2. `CAMPAIGN_OR_GLOBAL_PAUSED`
3. `STEP_EXPIRED` (past lateness window or `expiresAt`)
4. `GOAL_REACHED` (`stopOnGoal` purchase completed)
5. `REPLY_HOLD` (`stopOnReply` patron replied; awaiting human weaver follow-up)
6. `PREREQUISITE_NOT_MET` (`PREVIOUS_ACCEPTED` step requirement missing)
7. `CONTACT_CAP_EXCEEDED` (Anti-spam rolling limits)

### ⏱️ Deterministic Contact Frequency Caps & Arbitration
- **Rolling 1 per 24h & 3 per 7d** contact caps enforced across all marketing campaigns.
- **Collision Arbitration**: When multiple campaigns target the same patron simultaneously, higher priority campaigns (e.g., Birthday priority `80`) take precedence over promotional broadcasts (priority `40`).

### 🔒 Two-Phase Late-Binding & Intent Freezing
- Step execution records only store parameter bindings (`customer.firstName`, `shop.name`).
- Live eligibility is evaluated only at the due instant.
- Freezes an immutable `campaignDeliveryIntents` record with canonical SHA-256 payload hashing and **AES-256-GCM encrypted recipient phone numbers** immediately before dispatch.

### ⚡ Zero-Cost Multi-Tier WhatsApp Delivery Adapter
- **Mock Delivery Adapter**: High-speed, in-memory simulated adapter with pre-approved template catalog (`tpl_birthday_invite`, `tpl_anniversary_invite`, `tpl_saree_restock`, `tpl_alteration_ready`, `tpl_winback_exclusive`).
- **Meta Cloud API Sandbox Adapter**: Direct integration with Meta's Graph API (`v21.0`) providing 100% free sandbox delivery to whitelisted test phones without requiring credit cards or business verification.

---

## 4. Technology Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | **Next.js 15.1 (App Router)** | Server & Client components with Turbopack bundler. |
| **UI Components** | **React 19 + Tailwind CSS** | Heritage luxury palette (`#5C1D24` Heritage Crimson, `#D4AF37` Gold). |
| **Icons** | **Lucide React** | Lightweight, modern vector iconography. |
| **Backend Runtime** | **Express 5 + TypeScript 5.7** | Native Promise error handling, robust type safety. |
| **Database** | **MongoDB 8.0 + Mongoose 8.9** | Multi-document ACID transactions with compound unique indexes. |
| **Timezone & Dates** | **Luxon 3.5** | Accurate IANA timezone math in `Asia/Kolkata` and Leap-Year policies. |
| **Identifiers** | **ULID** | Monotonically sortable prefixed IDs (`cmp_`, `enr_`, `exe_`, `di_`). |
| **Security & Crypto** | **Node.js Crypto** | AES-256-GCM encryption & SHA-256 canonical hashing. |
| **Automated Testing** | **Vitest 3.0** | Lightning-fast test runner executing 61 scenarios in 1.9s. |

---

## 5. Repository Structure

```
GroVastra/
├── backend/                               # Express 5 + Worker Monolith Runtime
│   ├── src/
│   │   ├── config/                        # Database, env validation, logger
│   │   ├── shared/                        # Primitives (Clock, Crypto, ID, EventBus)
│   │   ├── modules/
│   │   │   ├── campaigns/                 # AUTO CAMPAIGNS CORE ENGINE
│   │   │   │   ├── models/                # 10 Mongoose schemas matching spec
│   │   │   │   ├── engine/                # Strategies, Safeguard Pipeline, Dry Run
│   │   │   │   ├── adapters/              # Mock & Sandbox Delivery Adapters
│   │   │   │   ├── presets/               # Handloom boutique campaign presets
│   │   │   │   └── routes/                # Campaign & Webhook REST endpoints
│   │   │   ├── crm/                       # Customers, Opt-Outs, Job Cards
│   │   │   ├── inventory/                 # Handloom Sarees & Restock events
│   │   │   ├── orders/                    # Purchases & Conversion Goals
│   │   │   └── social/                    # Instagram & Storefront Bio links
│   │   ├── workers/                       # Dedicated Worker Processes
│   │   │   ├── planner.ts                 # Occasion Discovery Worker
│   │   │   ├── executor.ts                # Due-Step Poller (30s Lease Tokens)
│   │   │   └── events.ts                  # Domain Event Consumer
│   │   ├── scripts/                       # Database seed & Sandbox smoke test
│   │   └── server.ts                      # Express 5 Server Entrypoint
│   └── tests/                             # Vitest QA Acceptance Matrix (61 tests)
│
├── frontend/                              # Next.js 15 (App Router) Studio
│   ├── src/
│   │   ├── app/                           # App router pages & layouts
│   │   └── components/                    # Studio Wizard, Simulator, Activity Stream
│   └── package.json
│
└── docs/                                  # Specifications & Architectural Records
    ├── DECISIONS.md                       # Comprehensive Decision Log & ADRs
    ├── WHATSAPP_SANDBOX_GUIDE.md          # Zero-Cost Meta Sandbox Guide
    ├── GroVastra_Auto_Campaigns_Developer_Handoff.pdf
    └── GroVastra-Social-Features-Technical-Handoff.pdf
```

---

## 6. Getting Started

### Prerequisites
- **Node.js**: v18.18+ or v20+ (LTS recommended)
- **MongoDB**: v6.0+ (Replica Set enabled for transaction support)
- **npm**: v9+

---

### Step 1: Clone & Install Dependencies

```bash
# Clone the repository
git clone <your-repo-url>
cd GroVastra

# Install Backend dependencies
cd backend
npm install

# Install Frontend dependencies
cd ../frontend
npm install
```

---

### Step 2: Configure Environment Variables

1. In `backend/`, copy the example file:
   ```bash
   cp .env.example .env
   ```
2. By default, `WHATSAPP_MODE=mock` is set, allowing you to develop and run all 61 automated tests completely offline without external credentials.

*(Optional)* To connect to Meta's free Developer Sandbox:
```ini
WHATSAPP_MODE=sandbox
WHATSAPP_PHONE_NUMBER_ID=your_meta_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_meta_temporary_access_token
WHATSAPP_APP_SECRET=your_meta_app_secret
```
*(Refer to [`docs/WHATSAPP_SANDBOX_GUIDE.md`](docs/WHATSAPP_SANDBOX_GUIDE.md) for 5-minute setup instructions).*

---

### Step 3: Seed Initial Boutique Data

Seed Padmavati Handlooms patrons (Lakshmi, Ananya, Meera, Pooja), sarees, and approved templates:

```bash
cd backend
npm run seed
```

---

### Step 4: Run Development Services

Open separate terminals:

```bash
# Terminal 1: Run Next.js Frontend (Port 3000)
cd frontend
npm run dev -- -p 3000

# Terminal 2: Run Express 5 Backend REST API (Port 4000)
cd backend
npm run dev

# Terminal 3: Run the Due-Step Poller Worker
cd backend
npm run worker:executor

# Terminal 4: Run the Occasion Calendar Planner Worker
cd backend
npm run worker:planner
```

Visit **`http://localhost:3000`** in your browser.

---

## 7. Testing & Verification

GroVastra includes an exhaustive test suite verifying the **58-scenario QA Acceptance Matrix** (Pages 30–33 of the Developer Handoff):

```bash
cd backend
npm test
```

### Test Suite Breakdown:
- **`qaMatrix.test.ts` (34 tests)**:
  - *Matrix A*: Identity keys, draft fingerprint validation, audience specification, UTC offset math, Feb 29 leap-day policies, prerequisite gates, `stopOnReply` holds, `stopOnGoal` stops.
  - *Matrix B*: Atomic step lease acquisition, expired lease safe reclamation, 1/24h and 3/7d rolling contact caps, priority collision arbitration, AES-256-GCM intent freezing.
  - *Matrix C*: Delivery adapter submission, template validation, status progression (`ACCEPTED` $\to$ `DELIVERED` $\to$ `READ`), exponential retry backoffs, ambiguous timeout handling (`OUTCOME_UNKNOWN`), HMAC webhook signatures.
- **`foundation.test.ts` (12 tests)**: Prefixed ULIDs, AES-256-GCM encryption, Luxon date math.
- **`planner.test.ts` (3 tests)**: Annual occasion discovery & step offset calculations.
- **`execution.test.ts` (6 tests)**: Contact cap reservations and delivery adapters.
- **`lifecycle.test.ts` (6 tests)**: Saree restock, boutique alteration, and win-back strategies.

**Result**: **61 passed (100%) in 1.9s.**

---

### Live Sandbox Smoke-Test (Sending real WhatsApp messages)

To verify end-to-end connectivity with your verified personal mobile number:

```bash
cd backend
npx tsx src/scripts/smokeTestSandbox.ts <your_mobile_number_with_country_code>
# Example: npx tsx src/scripts/smokeTestSandbox.ts 919640708699
```

---

## 8. Inviolable Architectural Rules

1. **Identity Key Integrity (Handoff Page 18)**:
   - `enrollmentKey = ${tenantId}:${campaignId}:${customerId}:${occurrenceId}`
   - `executionKey  = ${enrollmentId}:${stableStepId}`
   - `deliveryKey   = ${executionId}`
   - *Rule*: Never include campaign versions, template revisions, worker IDs, or retry counts in business identity keys.
2. **Date Conversion Standard**:
   - Occasions are stored as date-only (`YYYY-MM-DD`).
   - Never convert date-only occasions through midnight UTC. First apply the step's local time (e.g. `10:00`) in `Asia/Kolkata`, then convert to UTC (`04:30:00Z`).
3. **Ambiguous Timeout Safety**:
   - Network timeouts during delivery submission are permanently recorded as `OUTCOME_UNKNOWN`. Blind re-sends are strictly prohibited to prevent duplicate messages to patrons.
4. **Zero-Cost Development Constraint**:
   - The platform must function indefinitely in local development and automated CI/CD without requiring external paid services or credit card registrations.

---

## 9. License & Credits

Built with precision for **Padmavati Handlooms** and the **GroVastra** Boutique Platform.  
Designed and implemented following the **Modular Monolithic Architecture Pattern**.
#   G r o V a s t r a  
 