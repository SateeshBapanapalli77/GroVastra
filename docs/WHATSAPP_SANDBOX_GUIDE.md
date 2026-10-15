# GroVastra: Zero-Cost Meta WhatsApp Cloud API Sandbox Guide

> [!IMPORTANT]
> **Zero-Cost & Solo Developer Strategy**:
> This setup uses Meta's official **Developer Test Sandbox**. It is **100% free**, does **not require a credit card**, and does **not require a registered WhatsApp Business Account or payment setup**.
>
> By default, the GroVastra system runs with `WHATSAPP_ADAPTER_MODE=mock`. Follow this guide only when you wish to smoke-test live WhatsApp messages to your personal phone.

---

## 1. Prerequisites (Free Meta Developer Account)

1. A personal Facebook account.
2. A personal mobile number registered with regular WhatsApp (to receive test messages).
3. Access to [developers.facebook.com](https://developers.facebook.com/).

---

## 2. Step-by-Step Meta App Setup

### Step 1: Create a Developer App
1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and click **Create App**.
2. Select **Other** as the use case, then click **Next**.
3. Select **Business** as the app type, then click **Next**.
4. Enter an App Name (e.g., `GroVastra Dev Sandbox`) and your email.
5. Click **Create App** (no credit card or billing details required).

### Step 2: Add WhatsApp Product
1. On the app dashboard, scroll down to **Add products to your app**.
2. Find **WhatsApp** and click **Set up**.
3. You will immediately be taken to the **WhatsApp > API Setup** screen. Meta automatically assigns a free **Test Business Phone Number** (e.g., `+1 555-xxx-xxxx`).

### Step 3: Whitelist Your Test Recipient Phone Number
> [!NOTE]
> In Sandbox / Developer mode, Meta restricts outbound sends strictly to up to 5 whitelisted test numbers. This guarantees that you can never accidentally send messages to real patrons or incur charges.

1. Under **Step 1: Select phone numbers**, locate the **To** field.
2. Select **Manage phone number list**.
3. Enter your personal mobile phone number with country code (e.g., `+91 98765 43210`).
4. Meta will send a 6-digit OTP code to your WhatsApp app.
5. Enter the OTP code on the Meta portal to verify your number.

---

## 3. Retrieving Sandbox Credentials

On the **WhatsApp > API Setup** page, copy the following values:

| Field on Meta Portal | GroVastra Environment Variable | Description |
| :--- | :--- | :--- |
| **Temporary Access Token** | `WHATSAPP_ACCESS_TOKEN` | 24-hour test token for sandbox API calls |
| **Phone Number ID** | `WHATSAPP_PHONE_NUMBER_ID` | Meta's test sender ID (e.g. `1089234857...`) |
| **WhatsApp Business Account ID** | `WHATSAPP_WABA_ID` | Sandbox WABA ID |
| **App Secret** (from *App Settings > Basic*) | `WHATSAPP_APP_SECRET` | Used for HMAC SHA-256 webhook signature validation |

---

## 4. Configuring GroVastra Backend

In `backend/.env`, set the adapter mode and credentials:

```ini
# ==========================================
# WhatsApp Multi-Tier Delivery Adapter Config
# ==========================================
# Options: 'mock' (default, offline unit-tested) or 'sandbox' (live Meta test number)
WHATSAPP_ADAPTER_MODE=sandbox

# Meta Cloud API Test Credentials
WHATSAPP_PHONE_NUMBER_ID=your_test_phone_number_id_here
WHATSAPP_ACCESS_TOKEN=your_temporary_access_token_here
WHATSAPP_APP_SECRET=your_app_secret_here

# Webhook Verification Secret (choose any secure string)
WHATSAPP_WEBHOOK_VERIFY_TOKEN=grovastra_handloom_secure_verify_token_2026
```

---

## 5. Webhook Setup (Local Development)

To receive live delivery receipts (`DELIVERED`, `READ`) and patron replies (triggering `stopOnReply` weaver holds) on your local machine:

### Option A: Local Direct Smoke Testing (Recommended)
You do not need to expose your machine to test webhooks. The GroVastra test suite (`npm test`) already includes automated tests for all webhook payloads, HMAC validation, and state transitions.

### Option B: Live Webhook Relay via Free ngrok
1. Start a free ngrok tunnel:
   ```bash
   npx ngrok http 4000
   ```
2. Copy the HTTPS forwarding URL (e.g., `https://abcd-1234.ngrok-free.app`).
3. In Meta Developer Portal, go to **WhatsApp > Configuration**:
   - **Callback URL**: `https://abcd-1234.ngrok-free.app/api/v1/webhooks/whatsapp`
   - **Verify Token**: `grovastra_handloom_secure_verify_token_2026`
4. Click **Verify and Save**.
5. Under **Webhook fields**, subscribe to `messages`.

---

## 6. Zero-Cost Rules & Guardrails Summary

1. **Never add a credit card**: Meta's developer sandbox functions indefinitely without any payment method.
2. **5 Whitelisted Numbers**: All recipients must be explicitly whitelisted in the developer portal.
3. **No Blind Re-sends**: Network timeouts always resolve to `OUTCOME_UNKNOWN`. The system will never re-send blindly.
4. **Mock Adapter as Primary**: Keep `WHATSAPP_ADAPTER_MODE=mock` for daily development and CI/CD tests. Switch to `sandbox` only when you want to feel the live WhatsApp message ding on your personal phone.
