import { writeLog, beginTxn, writeLogToTxn, commitTxn } from "../utils/audit-log.js";
import { calculateBatchQuantity, updateBatchLedgers } from "../utils/quantity-ledger.js";
const DEFAULT_FARM_ID = "FARM-DEFAULT";

function getDefaultFarmId(db) {
  if (db.farms && db.farms.length > 0) {
    const def = db.farms.find((f) => f.isDefault);
    return def ? def.id : db.farms[0].id;
  }
  return DEFAULT_FARM_ID;
}

function getFarmIdForBatch(db, batchId) {
  const batch = db.batches.find((b) => b.id === batchId);
  return batch?.farmId || getDefaultFarmId(db);
}

function getFarmIdFromQuery(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("farmId");
}

function validateShipment(input, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    if (!input.orderId || typeof input.orderId !== "string" || !input.orderId.trim()) {
      errors.push("订单不能为空");
    }
    if (!input.quantity || Number(input.quantity) <= 0) {
      errors.push("发货数量必须大于0");
    }
    if (!input.date || typeof input.date !== "string" || !input.date.trim()) {
      errors.push("发货日期不能为空");
    }
  }

  if (isUpdate && input.quantity !== undefined && Number(input.quantity) <= 0) {
    errors.push("发货数量必须大于0");
  }

  return errors;
}

function sanitizeShipment(input, existing = null) {
  const base = existing || {
    id: "",
    orderId: "",
    batchId: "",
    date: "",
    quantity: 0,
    note: "",
    createdAt: "",
    farmId: "",
  };

  return {
    id: input.id !== undefined ? input.id.trim() : base.id,
    orderId: input.orderId !== undefined ? input.orderId.trim() : base.orderId,
    batchId: input.batchId !== undefined ? input.batchId.trim() : base.batchId,
    date: input.date !== undefined ? input.date.trim() : base.date,
    quantity: input.quantity !== undefined ? Number(input.quantity) : base.quantity,
    note: input.note !== undefined ? (input.note || "").trim() : base.note,
    createdAt: base.createdAt || new Date().toISOString(),
    farmId: input.farmId !== undefined ? input.farmId.trim() : base.farmId,
  };
}

function getBatchReservedQuantity(batch, db) {
  const qty = calculateBatchQuantity(db, batch.id);
  return qty ? qty.reservedQuantity : 0;
}

function getBatchAvailableQuantity(batch, db) {
  const qty = calculateBatchQuantity(db, batch.id);
  return qty ? qty.availableQuantity : 0;
}

function enrichShipment(shipment, db) {
  const orders = db.orders || [];
  const order = orders.find((o) => o.id === shipment.orderId);

  let orderInfo = null;
  if (order) {
    const orderShipments = (db.shipments || [])
      .filter((s) => s.orderId === order.id);
    const orderShippedQty = orderShipments.reduce((sum, s) => sum + Number(s.quantity || 0), 0);

    orderInfo = {
      id: order.id,
      batchId: order.batchId,
      orderQuantity: order.orderQuantity,
      unitPrice: order.unitPrice,
      customerId: order.customerId,
      customerName: order.customerName,
      deliveryDate: order.deliveryDate,
      status: order.status,
      shippedQuantity: orderShippedQty,
      remainingQuantity: Math.max(0, Number(order.orderQuantity) - orderShippedQty),
    };
  }

  const customers = db.customers || [];
  let customerInfo = null;
  if (order?.customerId) {
    const c = customers.find((cu) => cu.id === order.customerId);
    if (c) {
      customerInfo = {
        id: c.id,
        name: c.name,
        contact: c.contact,
        phone: c.phone,
        region: c.region,
      };
    }
  }

  const amount = Number(shipment.quantity) * Number(order?.unitPrice || 0);

  return {
    ...shipment,
    orderInfo,
    customerInfo,
    customerName: order?.customerName || shipment.customerName || "",
    amount: Number(amount.toFixed(2)),
  };
}

export function createShipmentsRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function shipmentsRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/shipments") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let shipments = db.shipments || [];
      if (farmId) {
        shipments = shipments.filter((s) => s.farmId === farmId);
      }
      const enriched = shipments.map((s) => enrichShipment(s, db));
      return sendJson(res, 200, enriched);
    }

    if (method === "POST" && pathname === "/api/shipments") {
      const input = await body(req);
      const errors = validateShipment(input, false);
      if (errors.length) {
        return sendJson(res, 400, { error: "validation_failed", details: errors });
      }

      const db = await loadDb();
      const orders = db.orders || [];
      const order = orders.find((o) => o.id === input.orderId);

      if (!order) {
        return sendJson(res, 404, { error: "订单不存在" });
      }

      if (order.status === "cancelled") {
        return sendJson(res, 400, { error: "订单已取消，无法发货" });
      }

      const batch = db.batches.find((b) => b.id === order.batchId);
      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      const orderShipments = (db.shipments || [])
        .filter((s) => s.orderId === order.id);
      const orderShippedQty = orderShipments.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
      const orderRemaining = Math.max(0, Number(order.orderQuantity) - orderShippedQty);

      const shipmentQty = Number(input.quantity);
      if (shipmentQty > orderRemaining) {
        return sendJson(res, 400, {
          error: "exceeds_order_quantity",
          message: `发货数量超过订单剩余数量，剩余 ${orderRemaining} 尾`,
          remaining: orderRemaining,
        });
      }

      const availableQty = getBatchAvailableQuantity(batch, db);
      const effectiveAvailable = availableQty + orderRemaining;
      if (shipmentQty > effectiveAvailable) {
        return sendJson(res, 400, {
          error: "insufficient_stock",
          message: `批次可售数量不足，含当前订单占用可用 ${effectiveAvailable} 尾`,
          available: effectiveAvailable,
        });
      }

      const farmId = getFarmIdForBatch(db, order.batchId);

      const shipment = sanitizeShipment({
        ...input,
        id: `SHP-${Date.now()}`,
        batchId: order.batchId,
        farmId,
      });

      db.shipments = db.shipments || [];
      db.shipments.push(shipment);

      const txn = beginTxn(db, {
        operator: input.operator || "",
        farmId,
        description: `新增发货：订单 ${order.id} - ${shipment.quantity}尾`,
      });

      writeLogToTxn(txn, db, {
        action: "shipment_create",
        targetType: "shipment",
        targetId: shipment.id,
        before: null,
        after: shipment,
        farmId,
        meta: { batchId: shipment.batchId, orderId: order.id },
      });

      commitTxn(db, txn);

      updateBatchLedgers(db, shipment.batchId);

      await saveDb(db);

      return sendJson(res, 201, enrichShipment(shipment, db));
    }

    const shipmentMatch = pathname.match(/^\/api\/shipments\/([^/]+)$/);
    if (shipmentMatch) {
      const shipmentId = decodeURIComponent(shipmentMatch[1]);
      const db = await loadDb();
      const shipments = db.shipments || [];
      const shipmentIndex = shipments.findIndex((s) => s.id === shipmentId);

      if (shipmentIndex === -1) {
        return sendJson(res, 404, { error: "shipment_not_found" });
      }

      if (method === "GET") {
        return sendJson(res, 200, enrichShipment(shipments[shipmentIndex], db));
      }

      if (method === "DELETE") {
        const farmId = getFarmIdFromQuery(req);
        const shipment = shipments[shipmentIndex];
        if (farmId && shipment.farmId !== farmId) {
          return sendJson(res, 404, { error: "shipment_not_found" });
        }
        shipment._originalIndex = shipmentIndex;
        const [deleted] = shipments.splice(shipmentIndex, 1);
        db.shipments = shipments;

        const txn = beginTxn(db, {
          operator: "",
          farmId: shipment.farmId,
          description: `删除发货记录：${shipment.id}`,
        });

        writeLogToTxn(txn, db, {
          action: "shipment_delete",
          targetType: "shipment",
          targetId: shipmentId,
          before: shipment,
          after: null,
          farmId: shipment.farmId,
          meta: { batchId: shipment.batchId, orderId: shipment.orderId },
        });

        commitTxn(db, txn);

        updateBatchLedgers(db, shipment.batchId);

        await saveDb(db);
        return sendJson(res, 200, { removed: deleted });
      }
    }

    const batchShipmentsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/shipments$/);
    if (batchShipmentsMatch && method === "GET") {
      const batchId = decodeURIComponent(batchShipmentsMatch[1]);
      const db = await loadDb();

      if (!db.batches.some((b) => b.id === batchId)) {
        return sendJson(res, 404, { error: "batch_not_found" });
      }

      const shipments = (db.shipments || [])
        .filter((s) => s.batchId === batchId)
        .map((s) => enrichShipment(s, db))
        .sort((a, b) => a.date.localeCompare(b.date));

      return sendJson(res, 200, shipments);
    }

    const availableMatch = pathname.match(/^\/api\/batches\/([^/]+)\/available$/);
    if (availableMatch && method === "GET") {
      const batchId = decodeURIComponent(availableMatch[1]);
      const db = await loadDb();
      const batch = db.batches.find((b) => b.id === batchId);

      if (!batch) {
        return sendJson(res, 404, { error: "batch_not_found" });
      }

      const oldSales = (db.sales || [])
        .filter((s) => s.batchId === batchId);
      const oldSalesQuantity = oldSales.reduce((sum, s) => sum + Number(s.count || 0), 0);

      const shippedQuantity = (db.shipments || [])
        .filter((s) => s.batchId === batchId)
        .reduce((sum, s) => sum + Number(s.quantity || 0), 0);

      const reservedQuantity = getBatchReservedQuantity(batch, db);
      const availableQuantity = getBatchAvailableQuantity(batch, db);
      const qtyCalc = calculateBatchQuantity(db, batchId);

      return sendJson(res, 200, {
        batchId,
        estimatedCount: qtyCalc ? qtyCalc.estimatedCount : Number(batch.estimatedCount),
        oldSalesQuantity: qtyCalc ? qtyCalc.oldSalesQuantity : oldSalesQuantity,
        shippedQuantity: qtyCalc ? qtyCalc.shippedQuantity : shippedQuantity,
        reservedQuantity,
        availableQuantity,
      });
    }

    return false;
  };
}

export {
  validateShipment,
  sanitizeShipment,
  enrichShipment,
  getBatchAvailableQuantity,
  getBatchReservedQuantity,
};
