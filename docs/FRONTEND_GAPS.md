# GroVastra Auto Campaigns — Frontend & Backend Gaps Audit

**Date:** 16 October 2026  
**Audited Against:** `docs/GroVastra_Auto_Campaigns_Developer_Handoff.pdf` (v2.0) and Express routes in `backend/src/modules/campaigns/routes/*.ts`.

---

## 1. Summary of Gaps Identified

### Gap 1: Dedicated Single-Recipient Simulator Send Endpoint
* **Spec Requirement:** Page 6 / 26 suggests a test preview send to an explicitly specified test phone without creating live campaign enrollments.
* **Current Backend State:** `backend/src/modules/campaigns/routes/campaign.routes.ts` only provides `POST /campaigns/:id/dry-runs` (which generates projections and the `reviewFingerprint`), and `POST /campaigns/:id/activate`. There is no dedicated `POST /campaigns/:id/test-send` or `/test-dispatch` route.
* **Frontend Handling:** Deleted the fake client-side "Send test payload" button and modal to comply with Non-negotiable 1 ("Zero static data. Delete fake test buttons and fake timers"). Rendered dry-run audit inspection instead.

---

### Gap 2: Dynamic Attribution Window in Tenant Settings Schema
* **Spec Requirement:** Page 28 notes configurable attribution windows (e.g. 7d, 14d, 30d) for crediting order conversions.
* **Current Backend State:** `TenantSettingsModel.ts` does not define `attributionWindowDays` in its Mongoose schema. The reporting engine (`backend/src/modules/campaigns/engine/ownerReporting.ts`) defaults the attribution window calculation internally to 30 days under rule `SINGLE_ATTRIBUTION_WINDOW`.
* **Frontend Handling:** Frontend displays the active rule and attribution assumption note honestly (`Rule: SINGLE_ATTRIBUTION_WINDOW`), and does not invent editable fields in settings that the backend schema cannot persist.

---

### Gap 3: Blackout Window CRUD Sub-routes
* **Spec Requirement:** Page 7 specifies calendar holiday and blackout management (e.g. store renovation, local festival blackout).
* **Current Backend State:** `PATCH /campaign-settings` accepts `blackouts: []` and `holidays: []` as full array replacements. There are no sub-routes (`POST /campaign-settings/blackouts`, `DELETE /campaign-settings/blackouts/:id`).
* **Frontend Handling:** Settings manages top-level settings and safeguards.

---

### Gap 4: Customer Contact Info Unmasking
* **Spec Requirement:** Non-negotiable 12 requires protecting customer privacy: "Do not expose phone numbers or message bodies beyond what the API returns (masked projections)."
* **Current Backend State:** All endpoints (`/customers`, `/campaign-activity`, `/reports/customer-timeline/:id`) return masked phone projections (`+91 98490 *****`).
* **Frontend Handling:** Masked phone projections are displayed everywhere with zero client-side unmasking assumptions.

---

### Gap 5: Filtered Search Parameters on `/campaign-activity`
* **Spec Requirement:** Spec p.28 describes filtering activity by date, campaign, and reason code category.
* **Current Backend State:** `GET /campaign-activity` currently performs `.find({ tenantId }).sort({ updatedAt: -1 }).limit(30)` without accepting query parameters (`campaignId`, `state`, `dateFrom`).
* **Frontend Handling:** Frontend renders the latest 30 audit activities from the API and allows instant client-side searching across campaign name, patron ID, and reason category.

---

### Gap 6: Affected Enrollment Counts on Resume
* **Spec Requirement:** Spec / Phase 3 states: "Resume must show affected counts before confirming; if the backend can't provide them, show the gap and require an explicit acknowledgement of FUTURE_ONLY behaviour."
* **Current Backend State:** `POST /campaigns/:id/resume` updates `CampaignControlGateModel` and marks overdue steps `SKIPPED_STEP_EXPIRED`, returning only `{ success: true, campaign }`. It does not pre-calculate or return the number of affected enrollments prior to confirming resume.
* **Frontend Handling:** The Resume confirmation dialog renders an honest notice explaining the backend gap and requires an explicit mandatory checkbox acknowledgement: *"I acknowledge that resuming follows the FUTURE_ONLY behaviour: missed past dates will not be sent."* The resume button is disabled until acknowledged.

---

### Gap 7: Old-Version Enrollment Counts Breakdown
* **Spec Requirement:** Spec / Phase 3 states: "CAMPAIGN DETAIL (/campaigns/[id]): status, active version vs draft, old-version enrollment counts (or Not available state)".
* **Current Backend State:** `GET /campaigns/:id` and `GET /campaigns` return `enrolledCount` which represents total active enrollments across the campaign. The backend routes do not provide an aggregated count breakdown partitioned by `campaignVersionId`.
* **Frontend Handling:** The Campaign Detail screen renders an honest "Not available yet" stat card explaining that the backend currently reports total active enrollments ({campaign.enrolledCount}) without a per-version breakdown.

---

### Gap 8: Dedicated CSV Export Endpoint
* **Spec Requirement:** Phase 5 requires: "CSV export only if the backend supports it; otherwise log a gap."
* **Current Backend State:** `backend/src/modules/campaigns/routes/campaign.routes.ts` provides JSON endpoints (`GET /campaigns/reports/owner-overview`, `GET /campaigns/monitoring/alerts`) but does not implement any CSV streaming route (e.g. `GET /campaigns/reports/export.csv`).
* **Frontend Handling:** Rendered an honest `Export CSV` button that opens an informative modal detailing the missing backend route and explaining that client-side fake generation was intentionally avoided per Non-negotiable 1 ("Zero static data. Never invent endpoints").

---

### Gap 9: Date-Range Query Parameters on Owner Overview Report
* **Spec Requirement:** Executive reporting by arbitrary billing cycles or custom date ranges (e.g. `?from=2026-10-01&to=2026-10-16`).
* **Current Backend State:** `GET /campaigns/reports/owner-overview` executes `generateOwnerOverviewReport(tenantId)` without parsing `req.query.from` or `req.query.to`. The report aggregates lifetime tenant records.
* **Frontend Handling:** Frontend honestly displays the lifetime verified audit facts with the server evaluation timestamp in `Asia/Kolkata` (with hover UTC instant), noting the lifetime scope.

