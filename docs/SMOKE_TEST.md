# GroVastra Auto Campaigns — Production Smoke Test Procedure
**Document Version:** 1.0 (Milestone 5 Pilot Readiness)  
**Specification Source:** `docs/GroVastra_Auto_Campaigns_Developer_Handoff.pdf` (p.32, p.34)

> [!WARNING]
> **Safety Notice:** Do NOT run this procedure against production recipient phone numbers or without valid, provisioned test credentials from the integration developer. Only test phone numbers registered in the Meta WhatsApp Developer Sandbox should be used.

---

## 1. Prerequisites Checklist

Before executing the smoke test, verify that the integration developer has supplied:
- [ ] Meta WABA ID (`wabaId`)
- [ ] Phone Number ID (`phoneNumberId`)
- [ ] System User Permanent Token (`accessToken`) stored securely in environment / secret manager
- [ ] App Secret (`appSecret`) for raw-byte HMAC-SHA256 signature verification
- [ ] Approved Template ID: `tpl_birthday_invite` (Category: `MARKETING`, Locale: `en`, Revision: `3`)
- [ ] Recipient Test Phone (e.g. `+919876500001` added to Sandbox recipient whitelist)

---

## 2. Step-by-Step Smoke Test Execution

### Step 1: Verify Connection & Template Readiness
Check that the tenant connection is active and the template catalogue includes the approved template:

```bash
# 1. Check template catalogue
curl -s http://localhost:5000/api/v1/approved-template-catalogue \
  -H "Authorization: Bearer <STAFF_JWT>" | jq '.templates[] | select(.id=="tpl_birthday_invite")'

# Expected Output:
# {
#   "id": "tpl_birthday_invite",
#   "name": "birthday_celebration_invite",
#   "category": "MARKETING",
#   "language": "en",
#   "status": "APPROVED",
#   "variableKeys": ["name", "shop"]
# }
```

### Step 2: Perform Preflight Dry Run
Execute a dry run for the test campaign draft. Verify that **zero** live provider HTTP requests and **zero** live execution records are generated:

```bash
curl -X POST http://localhost:5000/api/v1/campaigns/draft/dry-run \
  -H "Authorization: Bearer <OWNER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "trigger": { "type": "ANNUAL_DATE", "field": "customer.birthday", "advanceDays": 30 },
    "audience": { "mode": "ALL_ELIGIBLE" },
    "steps": [
      {
        "stepId": "invitation",
        "offsetDays": -14,
        "localTime": "10:00",
        "templateRef": { "id": "tpl_birthday_invite", "revision": 3, "language": "en" },
        "bindings": { "name": "customer.firstName", "shop": "shop.displayName" },
        "stopOnReply": true,
        "stopOnGoal": true
      }
    ]
  }'

# Expected:
# reviewFingerprint returned, projectedAudienceCount >= 1, zero executions in database.
```

### Step 3: Trigger Single Due-Step Dispatch
With the campaign active, trigger worker execution for the due step targeting the test patron:

1. Engine acquires atomic lease on `CampaignExecutionModel`.
2. Evaluates preflight safeguards (Tenant active, patron opted-in, not paused).
3. Prepares delivery intent and locks contact cap ledger.
4. Invokes Meta Cloud API adapter:
   ```
   POST https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>/messages
   ```
5. Asserts provider responds with HTTP 200:
   ```json
   {
     "messaging_product": "whatsapp",
     "contacts": [{ "input": "+919876500001", "wa_id": "919876500001" }],
     "messages": [{ "id": "wamid.HBgL..." }]
   }
   ```
6. Engine stores `state: 'PROVIDER_ACCEPTED'` with `providerMessageId: "wamid.HBgL..."`.

### Step 4: Webhook Receipt Ingress Assertion
Simulate or observe Meta message delivery receipts:

```bash
# Verify raw HMAC webhook delivery
curl -X POST http://localhost:5000/api/v1/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=<CALCULATED_RAW_HMAC>" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "waba_id",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "statuses": [{
            "id": "wamid.HBgL...",
            "status": "delivered",
            "timestamp": "1728892800",
            "recipient_id": "919876500001"
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Assertion:**
- Execution state moves monotonically to `DELIVERED`.
- A subsequent `read` status event moves state to `READ`.
- A late duplicate `sent` webhook does NOT regress state.

### Step 5: Inbound Customer Reply Verification
Send an inbound reply from the test phone:

```bash
curl -X POST http://localhost:5000/api/v1/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=<CALCULATED_RAW_HMAC>" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "waba_id",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "messages": [{
            "from": "919876500001",
            "id": "wamid.inbound_01",
            "timestamp": "1728893000",
            "text": { "body": "Can you hold the crimson Kanjeevaram for me?" },
            "type": "text"
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Assertion:**
- `CampaignEnrollmentModel.replyHoldAt` is set to timestamp.
- Remaining sales reminder steps are held with `SKIPPED_REPLY_HOLD`.
- Staff resolution action (`POST /api/v1/campaigns/enrollments/:id/resolve-hold`) permits future steps only.

---

## 3. Teardown & Clean State
After smoke test verification completes:
1. Deactivate test campaign: `POST /api/v1/campaigns/:id/archive`.
2. Clear test executions and test customer records from sandbox environment.
3. Review audit trail: `AuditLogModel` records all manual actions.
