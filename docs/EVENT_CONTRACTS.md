# GroVastra Auto Campaigns: Upstream Domain Event Contracts
**Specification Reference**: `docs/GroVastra_Auto_Campaigns_Developer_Handoff.pdf` (v2.0, Page 24)  
**Endpoint**: `POST /internal/campaign-events`  
**Authentication**: Mutual TLS / Shared Service Bearer Token scoped by producer and tenant  
**Header**: `Authorization: Bearer <producer_token>`  

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
3. **Quarantine Handling**: Payloads with unknown event types or unparseable schemas are immediately redirected to a visible `QUARANTINE` status for operator inspection.

---

## 2. Event Family Contracts

### A. Merchandise Family (`inventory.*`, `stock.*`)
Emitted by the Warehouse Management System (WMS) or Inventory service when sellable stock transitions occur.

#### `inventory.available` (True Availability Event)
```json
{
  "schemaVersion": 1,
  "producer": "inventory",
  "eventId": "evt_inv_9801",
  "tenantId": "shop_padmavati",
  "type": "inventory.available",
  "entityId": "SKU-KANJEE-RED-001",
  "entityVersion": 2,
  "occurredAt": "2026-10-15T11:00:00.000Z",
  "data": {
    "sku": "SKU-KANJEE-RED-001",
    "title": "Kanjeevaram Bridal Silk Saree in Crimson Gold",
    "stockCount": 3,
    "isStockRecount": false,
    "arrivalEventId": "arr_diwali_2026"
  }
}
```
> [!IMPORTANT]
> `isStockRecount: true` or routine physical audit adjustments must be flagged as recounts; the auto-campaigns engine ignores recounts to prevent false restock alerts.

---

### B. Customer Lifecycle Family (`order.*`, `customer.*`)
Emitted by the POS / Billing register when purchases or refunds take place.

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

### C. Boutique Service Family (`appointment.*`, `alteration.*`, `delivery.*`)
Operational notifications for boutique patrons. Categorized as `ORDER_SERVICE` (exempt from marketing frequency caps).

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

#### `delivery.updated`
```json
{
  "schemaVersion": 1,
  "producer": "logistics.courier",
  "eventId": "evt_courier_771",
  "tenantId": "shop_padmavati",
  "type": "delivery.updated",
  "entityId": "del_ord_88291",
  "entityVersion": 1,
  "occurredAt": "2026-10-15T16:00:00.000Z",
  "data": {
    "orderId": "ord_88291",
    "customerId": "cus_lakshmi_01",
    "deliveryStatus": "OUT_FOR_DELIVERY"
  }
}
```
