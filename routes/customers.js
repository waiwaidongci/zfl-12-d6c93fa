import { writeLog } from "../utils/audit-log.js";

function validateCustomer(input, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    if (!input.id || typeof input.id !== "string" || !input.id.trim()) {
      errors.push("客户编号不能为空");
    } else if (!/^[A-Za-z0-9\-_]+$/.test(input.id.trim())) {
      errors.push("客户编号只能包含字母、数字、连字符和下划线");
    }

    if (!input.name || typeof input.name !== "string" || !input.name.trim()) {
      errors.push("客户名称不能为空");
    }
  }

  if (isUpdate && input.name !== undefined && (!input.name || typeof input.name !== "string" || !input.name.trim())) {
    errors.push("客户名称不能为空");
  }

  if (input.phone !== undefined && input.phone !== "" && typeof input.phone !== "string") {
    errors.push("电话格式无效");
  }

  return errors;
}

function sanitizeCustomer(input, existing = null) {
  const base = existing || {
    id: "",
    name: "",
    contact: "",
    phone: "",
    region: "",
    note: "",
  };

  return {
    id: input.id !== undefined ? input.id.trim() : base.id,
    name: input.name !== undefined ? input.name.trim() : base.name,
    contact: input.contact !== undefined ? input.contact.trim() : base.contact,
    phone: input.phone !== undefined ? input.phone.trim() : base.phone,
    region: input.region !== undefined ? input.region.trim() : base.region,
    note: input.note !== undefined ? input.note.trim() : base.note,
  };
}

function buildCustomerSummary(customer, sales, batches, orders = [], shipments = []) {
  const customerSales = sales.filter((s) => s.customerId === customer.id || s.customer === customer.name);
  const customerOrders = orders.filter(
    (o) => o.customerId === customer.id || o.customerName === customer.name
  );
  const customerShipments = shipments.filter((s) => {
    const order = orders.find((o) => o.id === s.orderId);
    if (!order) return false;
    return order.customerId === customer.id || order.customerName === customer.name;
  });

  const oldSalesCount = customerSales.reduce((sum, s) => sum + Number(s.count || 0), 0);
  const oldSalesAmount = customerSales.reduce(
    (sum, s) => sum + Number(s.count || 0) * Number(s.unitPrice || 0),
    0
  );

  const shipmentCount = customerShipments.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
  const shipmentAmount = customerShipments.reduce((sum, s) => {
    const order = orders.find((o) => o.id === s.orderId);
    const unitPrice = order?.unitPrice || 0;
    return sum + Number(s.quantity || 0) * Number(unitPrice || 0);
  }, 0);

  const totalCount = oldSalesCount + shipmentCount;
  const totalAmount = oldSalesAmount + shipmentAmount;

  const batchIdsFromSales = customerSales.map((s) => s.batchId);
  const batchIdsFromOrders = customerOrders.map((o) => o.batchId);
  const batchIdsFromShipments = customerShipments.map((s) => s.batchId);
  const batchIds = [...new Set([...batchIdsFromSales, ...batchIdsFromOrders, ...batchIdsFromShipments])];

  const batchSummaries = batchIds.map((batchId) => {
    const batch = batches.find((b) => b.id === batchId);
    const batchSales = customerSales.filter((s) => s.batchId === batchId);
    const batchSalesCount = batchSales.reduce((sum, s) => sum + Number(s.count || 0), 0);
    const batchSalesAmount = batchSales.reduce(
      (sum, s) => sum + Number(s.count || 0) * Number(s.unitPrice || 0),
      0
    );

    const batchOrders = customerOrders.filter((o) => o.batchId === batchId);
    const batchOrderQty = batchOrders
      .filter((o) => o.status !== "cancelled")
      .reduce((sum, o) => sum + Number(o.orderQuantity || 0), 0);

    const batchShipments = customerShipments.filter((s) => s.batchId === batchId);
    const batchShipmentCount = batchShipments.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    const batchShipmentAmount = batchShipments.reduce((sum, s) => {
      const order = orders.find((o) => o.id === s.orderId);
      const unitPrice = order?.unitPrice || 0;
      return sum + Number(s.quantity || 0) * Number(unitPrice || 0);
    }, 0);

    const batchCount = batchSalesCount + batchShipmentCount;
    const batchAmount = batchSalesAmount + batchShipmentAmount;

    const salesDates = batchSales.map((s) => s.date);
    const shipmentDates = batchShipments.map((s) => s.date);
    const orderDates = batchOrders.map((o) => o.deliveryDate).filter(Boolean);
    const allDates = [...salesDates, ...shipmentDates, ...orderDates];
    const lastDate = allDates.sort().reverse()[0] || "";

    return {
      batchId,
      species: batch?.species || "",
      count: batchCount,
      amount: Math.round(batchAmount),
      lastDate,
      orderCount: batchOrders.length,
      orderQuantity: batchOrderQty,
      shipmentCount: batchShipments.length,
      shipmentQuantity: batchShipmentCount,
      oldSalesCount: batchSalesCount,
    };
  }).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  const validOrders = customerOrders.filter((o) => o.status !== "cancelled");
  const totalOrderQty = validOrders.reduce((sum, o) => sum + Number(o.orderQuantity || 0), 0);
  const totalOrderAmount = validOrders.reduce(
    (sum, o) => sum + Number(o.orderQuantity || 0) * Number(o.unitPrice || 0),
    0
  );

  return {
    ...customer,
    purchaseSummary: {
      orderCount: customerSales.length + customerOrders.length,
      totalCount,
      totalAmount: Math.round(totalAmount),
      batches: batchSummaries,
      orderStats: {
        totalOrders: customerOrders.length,
        pendingOrders: customerOrders.filter((o) => o.status === "pending").length,
        partialOrders: customerOrders.filter((o) => o.status === "partial").length,
        completedOrders: customerOrders.filter((o) => o.status === "completed").length,
        cancelledOrders: customerOrders.filter((o) => o.status === "cancelled").length,
        totalOrderQuantity: totalOrderQty,
        totalOrderAmount: Math.round(totalOrderAmount),
        totalShippedQuantity: shipmentCount,
        totalShippedAmount: Math.round(shipmentAmount),
        totalRemainingQuantity: totalOrderQty - shipmentCount,
      },
      oldSales: {
        count: oldSalesCount,
        amount: Math.round(oldSalesAmount),
      },
    },
  };
}

export function createCustomersRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function customersRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/customers") {
      const db = await loadDb();
      const customers = (db.customers || []).map((c) =>
        buildCustomerSummary(c, db.sales || [], db.batches || [], db.orders || [], db.shipments || [])
      );
      return sendJson(res, 200, customers);
    }

    const customersMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
    if (customersMatch) {
      const customerId = decodeURIComponent(customersMatch[1]);
      const db = await loadDb();
      const customers = db.customers || [];
      const customerIndex = customers.findIndex((c) => c.id === customerId);

      if (method === "GET") {
        if (customerIndex === -1) {
          return sendJson(res, 404, { error: "customer_not_found" });
        }
        const customer = buildCustomerSummary(
          customers[customerIndex],
          db.sales || [],
          db.batches || [],
          db.orders || [],
          db.shipments || []
        );
        return sendJson(res, 200, customer);
      }

      if (method === "PUT") {
        if (customerIndex === -1) {
          return sendJson(res, 404, { error: "customer_not_found" });
        }
        const input = await body(req);
        const errors = validateCustomer(input, true);
        if (errors.length) {
          return sendJson(res, 400, { error: "validation_failed", details: errors });
        }
        const updated = sanitizeCustomer(input, customers[customerIndex]);
        const beforeCustomer = JSON.parse(JSON.stringify(customers[customerIndex]));
        customers[customerIndex] = updated;
        db.customers = customers;
        writeLog(db, {
          operator: input.operator || "",
          action: "customer_update",
          targetType: "customer",
          targetId: customerId,
          before: beforeCustomer,
          after: updated,
          farmId: "",
        });
        await saveDb(db);
        return sendJson(res, 200, updated);
      }

      if (method === "DELETE") {
        if (customerIndex === -1) {
          return sendJson(res, 404, { error: "customer_not_found" });
        }
        const usedInSales = (db.sales || []).some((s) => s.customerId === customerId);
        if (usedInSales) {
          return sendJson(res, 400, {
            error: "customer_in_use",
            message: "该客户已有销售记录关联，无法删除",
          });
        }
        const existing = customers[customerIndex];
        existing._originalIndex = customerIndex;
        const [deleted] = customers.splice(customerIndex, 1);
        db.customers = customers;
        writeLog(db, {
          operator: "",
          action: "customer_delete",
          targetType: "customer",
          targetId: customerId,
          before: existing,
          after: null,
          farmId: "",
        });
        await saveDb(db);
        return sendJson(res, 200, deleted);
      }
    }

    if (method === "POST" && pathname === "/api/customers") {
      const input = await body(req);
      const errors = validateCustomer(input, false);
      if (errors.length) {
        return sendJson(res, 400, { error: "validation_failed", details: errors });
      }
      const db = await loadDb();
      const customers = db.customers || [];
      if (customers.some((c) => c.id === input.id.trim())) {
        return sendJson(res, 409, { error: "customer_exists", message: "客户编号已存在" });
      }
      const newCustomer = sanitizeCustomer({ ...input, id: input.id.trim() });
      customers.push(newCustomer);
      db.customers = customers;
      writeLog(db, {
        operator: input.operator || "",
        action: "customer_create",
        targetType: "customer",
        targetId: newCustomer.id,
        before: null,
        after: newCustomer,
        farmId: "",
      });
      await saveDb(db);
      return sendJson(res, 201, newCustomer);
    }

    return false;
  };
}

export { validateCustomer, sanitizeCustomer, buildCustomerSummary };
