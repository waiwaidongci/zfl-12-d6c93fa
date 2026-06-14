const ORDER_STATUSES = ["pending", "partial", "completed", "cancelled"];

const ORDER_STATUS_LABELS = {
  pending: "待发货",
  partial: "部分发货",
  completed: "已完成",
  cancelled: "已取消",
};

function validateOrder(input, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    if (!input.batchId || typeof input.batchId !== "string" || !input.batchId.trim()) {
      errors.push("批次不能为空");
    }
    if (!input.orderQuantity || Number(input.orderQuantity) <= 0) {
      errors.push("订购数量必须大于0");
    }
    if (!input.unitPrice || Number(input.unitPrice) < 0) {
      errors.push("单价不能为负数");
    }
    if (!input.deliveryDate || typeof input.deliveryDate !== "string" || !input.deliveryDate.trim()) {
      errors.push("交付日期不能为空");
    }
  }

  if (isUpdate && input.orderQuantity !== undefined && Number(input.orderQuantity) <= 0) {
    errors.push("订购数量必须大于0");
  }
  if (isUpdate && input.unitPrice !== undefined && Number(input.unitPrice) < 0) {
    errors.push("单价不能为负数");
  }
  if (input.status !== undefined && !ORDER_STATUSES.includes(input.status)) {
    errors.push("无效的订单状态");
  }

  return errors;
}

function sanitizeOrder(input, existing = null) {
  const base = existing || {
    id: "",
    batchId: "",
    customerId: "",
    customerName: "",
    orderQuantity: 0,
    unitPrice: 0,
    deliveryDate: "",
    status: "pending",
    note: "",
    createdAt: "",
  };

  return {
    id: input.id !== undefined ? input.id.trim() : base.id,
    batchId: input.batchId !== undefined ? input.batchId.trim() : base.batchId,
    customerId: input.customerId !== undefined ? (input.customerId ? input.customerId.trim() : "") : base.customerId,
    customerName: input.customerName !== undefined ? (input.customerName ? input.customerName.trim() : "") : base.customerName,
    orderQuantity: input.orderQuantity !== undefined ? Number(input.orderQuantity) : base.orderQuantity,
    unitPrice: input.unitPrice !== undefined ? Number(input.unitPrice) : base.unitPrice,
    deliveryDate: input.deliveryDate !== undefined ? input.deliveryDate.trim() : base.deliveryDate,
    status: input.status !== undefined ? input.status : base.status,
    note: input.note !== undefined ? (input.note || "").trim() : base.note,
    createdAt: base.createdAt || new Date().toISOString(),
  };
}

function enrichOrder(order, db) {
  const customers = db.customers || [];
  let customerInfo = null;

  if (order.customerId) {
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

  const shipments = (db.shipments || [])
    .filter((s) => s.orderId === order.id);
  const shippedQuantity = shipments.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
  const remainingQuantity = Math.max(0, Number(order.orderQuantity) - shippedQuantity);
  const totalAmount = Number(order.orderQuantity) * Number(order.unitPrice);
  const shippedAmount = shippedQuantity * Number(order.unitPrice);

  let status = order.status;
  if (status !== "cancelled") {
    if (shippedQuantity === 0) {
      status = "pending";
    } else if (shippedQuantity < Number(order.orderQuantity)) {
      status = "partial";
    } else {
      status = "completed";
    }
  }

  return {
    ...order,
    status,
    customerInfo,
    shippedQuantity,
    remainingQuantity,
    totalAmount: Number(totalAmount.toFixed(2)),
    shippedAmount: Number(shippedAmount.toFixed(2)),
    shipmentCount: shipments.length,
    statusLabel: ORDER_STATUS_LABELS[status] || status,
  };
}

export function createOrdersRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function ordersRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/orders") {
      const db = await loadDb();
      const orders = (db.orders || []).map((o) => enrichOrder(o, db));
      return sendJson(res, 200, orders);
    }

    if (method === "POST" && pathname === "/api/orders") {
      const input = await body(req);
      const errors = validateOrder(input, false);
      if (errors.length) {
        return sendJson(res, 400, { error: "validation_failed", details: errors });
      }

      const db = await loadDb();

      if (!db.batches.some((b) => b.id === input.batchId.trim())) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      let customerId = input.customerId || "";
      let customerName = input.customerName || "";

      if (customerId) {
        const customer = (db.customers || []).find((c) => c.id === customerId);
        if (!customer) {
          return sendJson(res, 400, { error: "客户不存在" });
        }
        customerName = customer.name;
      } else if (!customerName) {
        return sendJson(res, 400, { error: "客户不能为空" });
      }

      const order = sanitizeOrder({
        ...input,
        id: `ORD-${Date.now()}`,
        customerId,
        customerName,
        status: "pending",
      });

      if (!order.customerId) {
        delete order.customerId;
      }

      db.orders = db.orders || [];
      db.orders.push(order);
      await saveDb(db);

      return sendJson(res, 201, enrichOrder(order, db));
    }

    const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (orderMatch) {
      const orderId = decodeURIComponent(orderMatch[1]);
      const db = await loadDb();
      const orders = db.orders || [];
      const orderIndex = orders.findIndex((o) => o.id === orderId);

      if (orderIndex === -1) {
        return sendJson(res, 404, { error: "order_not_found" });
      }

      if (method === "GET") {
        return sendJson(res, 200, enrichOrder(orders[orderIndex], db));
      }

      if (method === "PUT") {
        const input = await body(req);
        const errors = validateOrder(input, true);
        if (errors.length) {
          return sendJson(res, 400, { error: "validation_failed", details: errors });
        }

        const existing = orders[orderIndex];
        const updated = sanitizeOrder(input, existing);

        if (input.customerId || input.customerName) {
          let customerId = input.customerId !== undefined ? input.customerId : existing.customerId || "";
          let customerName = input.customerName !== undefined ? input.customerName : existing.customerName || "";

          if (customerId) {
            const customer = (db.customers || []).find((c) => c.id === customerId);
            if (!customer) {
              return sendJson(res, 400, { error: "客户不存在" });
            }
            customerName = customer.name;
          } else if (!customerName) {
            return sendJson(res, 400, { error: "客户不能为空" });
          }

          updated.customerId = customerId || undefined;
          updated.customerName = customerName;
          if (!updated.customerId) {
            delete updated.customerId;
          }
        }

        orders[orderIndex] = updated;
        db.orders = orders;
        await saveDb(db);
        return sendJson(res, 200, enrichOrder(updated, db));
      }

      if (method === "DELETE") {
        const order = orders[orderIndex];
        const shipments = (db.shipments || []).filter((s) => s.orderId === orderId);
        if (shipments.length > 0) {
          return sendJson(res, 400, {
            error: "order_has_shipments",
            message: "该订单已有发货记录，无法删除",
          });
        }

        const [deleted] = orders.splice(orderIndex, 1);
        db.orders = orders;
        await saveDb(db);
        return sendJson(res, 200, { removed: deleted });
      }
    }

    const batchOrdersMatch = pathname.match(/^\/api\/batches\/([^/]+)\/orders$/);
    if (batchOrdersMatch && method === "GET") {
      const batchId = decodeURIComponent(batchOrdersMatch[1]);
      const db = await loadDb();

      if (!db.batches.some((b) => b.id === batchId)) {
        return sendJson(res, 404, { error: "batch_not_found" });
      }

      const orders = (db.orders || [])
        .filter((o) => o.batchId === batchId)
        .map((o) => enrichOrder(o, db))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return sendJson(res, 200, orders);
    }

    const orderShipmentsMatch = pathname.match(/^\/api\/orders\/([^/]+)\/shipments$/);
    if (orderShipmentsMatch && method === "GET") {
      const orderId = decodeURIComponent(orderShipmentsMatch[1]);
      const db = await loadDb();
      const orders = db.orders || [];

      if (!orders.some((o) => o.id === orderId)) {
        return sendJson(res, 404, { error: "order_not_found" });
      }

      const shipments = (db.shipments || [])
        .filter((s) => s.orderId === orderId)
        .sort((a, b) => a.date.localeCompare(b.date));

      return sendJson(res, 200, shipments);
    }

    return false;
  };
}

export {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  validateOrder,
  sanitizeOrder,
  enrichOrder,
};
