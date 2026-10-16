# GroVastra Auto Campaigns: Upstream Domain Event Contracts
**Specification Reference**: `docs/GroVastra_Auto_Campaigns_Developer_Handoff.pdf` (v2.0, Page 24)  
**Registry Reference**: `backend/src/shared/events/registry.ts`  
**Endpoint**: `POST /internal/campaign-events`  
**Authentication**: Mutual TLS / Scoped Internal Service Bearer Token scoped by producer, tenant, and eventFamily  
**Header**: `Authorization: Bearer <service_token>`  

---

## 1. Universal Event Envelope
Every event emitted by upstream CRM, POS/ERP, Inventory, and Courier systems must adhere to this standard JSON envelope:

```json
{
  "schemaVersion": 1,
  "producer": "inventory.wms",
  "eventId": "evt_01m4z_inv_982",
  "tenantId": "shop_padmavati",
  "type": "inventory.available",
  "entityId": "SKU-KANJEE-RED-001",
  "entityVersion": 4,
  "occurredAt": "2026-10-15T10:00:00.000Z",
  "data": { ... }
}
```

### Invariants:
1. **Durable Persistence**: Events are persisted to `campaignEventInbox` as `RECEIVED` before an HTTP `201 Created` acknowledgment is returned.
2. **Entity Versioning**: `entityVersion` must strictly increment. Any event where `entityVersion <= existingVersion` is rejected as stale (`REJECTED_STALE_VERSION`).
3. **Quarantine Handling**: Payloads with unknown event types or unparseable schemas are immediately redirected to a visible `QUARANTINE` status for operator inspection with a visible reason (`UNKNOWN_EVENT_TYPE` or `INCOMPATIBLE_SCHEMA`).
4. **Idempotence & Replay Safety**: Replaying an already-processed domain event creates 0 new enrollments and 0 new executions.

---

## 2. Event Registry & Evaluator Mapping

All domain event types are validated at ingestion and dispatched during worker runs through a unified registry defined in `backend/src/shared/events/registry.ts`.

| Event Type | Family | Required Data Schema | Evaluator(s) | Description |
| :--- | :--- | :--- | :--- | :--- |
| `inventory.arrival` | Merchandise | `sku`, `stockCount` | `evaluateInventoryArrivalEvent` | Saree or fabric shipment arrived at boutique |
| `inventory.available` | Merchandise | `sku`, `stockCount` | `evaluateInventoryArrivalEvent` | True-availability restock (recounts ignored) |
| `stock.published` | Merchandise | `sku` | `evaluateRestockEvent` | SKU published or restocked to catalog |
| `festival.launch` | Merchandise | `seasonId` | `evaluateFestivalEvent` | Seasonal/festive launch (e.g. Diwali festive sarees) |
| `collection.released` | Merchandise | `releaseId` | `evaluateCollectionReleaseEvent` | New bridal or heritage collection release |
| `stockoffer.active` | Merchandise | `offerId` | `evaluateSelectedStockOfferEvent` | Targeted discount or selected inventory promotion |
| `order.completed` | Lifecycle | `orderId`, `customerId` | `evaluateOrderCompletedGoal`<br>`updateCustomerPurchaseFact`<br>`evaluateCompleteTheOutfitEvent`<br>`evaluateFirstToSecondPurchaseEvent` | Purchase completed: updates goals, customer facts, outfit matches, and nurture sequences |
| `order.refunded` | Lifecycle | `orderId`, `customerId` | `handleOrderRefundFact` | Order returned/refunded; recomputes customer facts |
| `customer.vip_milestone` | Retention | `vipTier` | `evaluateVipMilestoneEvent` | Patron achieved VIP tier milestone |
| `credit.expiring` | Retention | `customerId` | `evaluateCreditExpiryEvent` | Store credit or gift voucher expiring soon |
| `exhibition.announced` | Retention | `showId` | `evaluateExhibitionInviteEvent` | Trunk show or private exhibition invitation |
| `appointment.scheduled` | Boutique Service | `customerId` | `evaluateFittingAppointmentEvent` | Bridal styling or blouse fitting appointment |
| `delivery.updated` | Boutique Service | `customerId`, `deliveryStatus` | `evaluateDeliveryUpdateEvent` | Out-for-delivery / courier package status |
| `alteration.completed` | Boutique Service | `customerId` | `evaluateAlterationReadyEvent` | Blouse tailoring / saree fall finishing ready |
| `enquiry.received` | Boutique Service | `customerId` | `evaluateEnquiryEvent` | Patron product enquiry / bridal consultation |
| `whatsapp.status.*` | Status | `providerMessageId`, `status` | `reconcileDeliveryStatus` | WhatsApp message delivery / read reconciliation |

---

## 3. Detailed Event Contracts

### A. Merchandise Family (`inventory.*`, `stock.*`, `festival.*`, `collection.*`, `stockoffer.*`)

#### `inventory.arrival`
```json
{
  "schemaVersion": 1,
  "producer": "inventory",
  "eventId": "evt_inv_9801",
  "tenantId": "shop_padmavati",
  "type": "inventory.arrival",
  "entityId": "SKU-KANJEE-RED-001",
  "entityVersion": 2,
  "occurredAt": "2026-10-15T11:00:00.000Z",
  "data": {
    "sku": "SKU-KANJEE-RED-001",
    "stockCount": 3,
    "title": "Kanjeevaram Bridal Silk Saree in Crimson Gold",
    "isStockRecount": false,
    "arrivalEventId": "arr_diwali_2026"
  }
}
```

#### `festival.launch`
```json
{
  "schemaVersion": 1,
  "producer": "inventory",
  "eventId": "evt_fest_01",
  "tenantId": "shop_padmavati",
  "type": "festival.launch",
  "entityId": "diwali_2026",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T11:00:00.000Z",
  "data": {
    "seasonId": "diwali_2026",
    "title": "Deepavali Festive Silk Saree Launch"
  }
}
```

#### `collection.released`
```json
{
  "schemaVersion": 1,
  "producer": "inventory",
  "eventId": "evt_coll_01",
  "tenantId": "shop_padmavati",
  "type": "collection.released",
  "entityId": "bridal_kanjee_2026",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T11:00:00.000Z",
  "data": {
    "releaseId": "bridal_kanjee_2026",
    "title": "Royal Kanjeevaram Bridal Weaves"
  }
}
```

#### `stockoffer.active`
```json
{
  "schemaVersion": 1,
  "producer": "inventory",
  "eventId": "evt_offer_01",
  "tenantId": "shop_padmavati",
  "type": "stockoffer.active",
  "entityId": "offer_silk_fest",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T11:00:00.000Z",
  "data": {
    "offerId": "offer_silk_fest",
    "discountPercent": 15
  }
}
```

---

### B. Customer Lifecycle Family (`order.*`)

#### `order.completed`
```json
{
  "schemaVersion": 1,
  "producer": "pos.billing",
  "eventId": "evt_ord_4421",
  "tenantId": "shop_padmavati",
  "type": "order.completed",
  "entityId": "ord_88291",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T12:30:00.000Z",
  "data": {
    "orderId": "ord_88291",
    "customerId": "cus_lakshmi_01",
    "netPaise": 4500000,
    "occasionRef": "birthday:2026",
    "items": [
      { "sku": "SKU-KANJEE-RED-001", "title": "Kanjeevaram Silk" }
    ]
  }
}
```

#### `order.refunded`
```json
{
  "schemaVersion": 1,
  "producer": "pos.billing",
  "eventId": "evt_ref_1120",
  "tenantId": "shop_padmavati",
  "type": "order.refunded",
  "entityId": "ord_88291",
  "entityVersion": 2,
  "occurredAt": "2026-10-15T14:00:00.000Z",
  "data": {
    "orderId": "ord_88291",
    "customerId": "cus_lakshmi_01",
    "netPaise": 4500000
  }
}
```

---

### C. Retention Family (`customer.vip_milestone`, `credit.expiring`, `exhibition.announced`)

#### `customer.vip_milestone`
```json
{
  "schemaVersion": 1,
  "producer": "crm",
  "eventId": "evt_vip_01",
  "tenantId": "shop_padmavati",
  "type": "customer.vip_milestone",
  "entityId": "cus_lakshmi_01",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T14:30:00.000Z",
  "data": {
    "customerId": "cus_lakshmi_01",
    "vipTier": "PLATINUM"
  }
}
```

#### `credit.expiring`
```json
{
  "schemaVersion": 1,
  "producer": "crm",
  "eventId": "evt_cred_01",
  "tenantId": "shop_padmavati",
  "type": "credit.expiring",
  "entityId": "crd_881",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T14:30:00.000Z",
  "data": {
    "customerId": "cus_lakshmi_01",
    "creditId": "crd_881",
    "amountPaise": 250000,
    "expiryDate": "2026-10-25T00:00:00.000Z"
  }
}
```

#### `exhibition.announced`
```json
{
  "schemaVersion": 1,
  "producer": "crm",
  "eventId": "evt_exhib_01",
  "tenantId": "shop_padmavati",
  "type": "exhibition.announced",
  "entityId": "show_blr_2026",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T14:30:00.000Z",
  "data": {
    "showId": "show_blr_2026",
    "title": "Heritage Kanjeevaram Bangalore Exhibition",
    "city": "Bengaluru"
  }
}
```

---

### D. Boutique Service Family (`appointment.*`, `alteration.*`, `delivery.*`, `enquiry.*`)

#### `appointment.scheduled`
```json
{
  "schemaVersion": 1,
  "producer": "boutique.appointments",
  "eventId": "evt_app_01",
  "tenantId": "shop_padmavati",
  "type": "appointment.scheduled",
  "entityId": "apt_bridal_99",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T15:00:00.000Z",
  "data": {
    "appointmentId": "apt_bridal_99",
    "customerId": "cus_lakshmi_01",
    "serviceType": "BRIDAL_FITTING"
  }
}
```

#### `delivery.updated`
```json
{
  "schemaVersion": 1,
  "producer": "logistics.courier",
  "eventId": "evt_courier_771",
  "tenantId": "shop_padmavati",
  "type": "delivery.updated",
  "entityId": "ord_88291",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T16:00:00.000Z",
  "data": {
    "orderId": "ord_88291",
    "customerId": "cus_lakshmi_01",
    "deliveryStatus": "OUT_FOR_DELIVERY"
  }
}
```

#### `alteration.completed`
```json
{
  "schemaVersion": 1,
  "producer": "boutique.tailoring",
  "eventId": "evt_tailor_501",
  "tenantId": "shop_padmavati",
  "type": "alteration.completed",
  "entityId": "job_blouse_stitching_99",
  "entityVersion": 3,
  "occurredAt": "2026-10-15T15:00:00.000Z",
  "data": {
    "jobId": "job_blouse_stitching_99",
    "customerId": "cus_lakshmi_01",
    "itemTitle": "Custom Zari Embroidered Blouse"
  }
}
```

#### `enquiry.received`
```json
{
  "schemaVersion": 1,
  "producer": "crm.enquiry",
  "eventId": "evt_enq_01",
  "tenantId": "shop_padmavati",
  "type": "enquiry.received",
  "entityId": "enq_1001",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T16:30:00.000Z",
  "data": {
    "customerId": "cus_lakshmi_01",
    "enquiryId": "enq_1001",
    "channel": "WHATSAPP",
    "message": "Interested in pure mulberry silk sarees"
  }
}
```
