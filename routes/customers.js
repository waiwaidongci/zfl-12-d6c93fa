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

function buildCustomerSummary(customer, sales, batches) {
  const customerSales = sales.filter((s) => s.customerId === customer.id || s.customer === customer.name);
  const totalCount = customerSales.reduce((sum, s) => sum + Number(s.count || 0), 0);
  const totalAmount = customerSales.reduce(
    (sum, s) => sum + Number(s.count || 0) * Number(s.unitPrice || 0),
    0
  );
  const batchIds = [...new Set(customerSales.map((s) => s.batchId))];
  const batchSummaries = batchIds.map((batchId) => {
    const batch = batches.find((b) => b.id === batchId);
    const batchSales = customerSales.filter((s) => s.batchId === batchId);
    const batchCount = batchSales.reduce((sum, s) => sum + Number(s.count || 0), 0);
    const batchAmount = batchSales.reduce(
      (sum, s) => sum + Number(s.count || 0) * Number(s.unitPrice || 0),
      0
    );
    const lastDate = batchSales.map((s) => s.date).sort().reverse()[0] || "";
    return {
      batchId,
      species: batch?.species || "",
      count: batchCount,
      amount: Math.round(batchAmount),
      lastDate,
    };
  }).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  return {
    ...customer,
    purchaseSummary: {
      orderCount: customerSales.length,
      totalCount,
      totalAmount: Math.round(totalAmount),
      batches: batchSummaries,
    },
  };
}

export function createCustomersRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function customersRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/customers") {
      const db = await loadDb();
      const customers = (db.customers || []).map((c) =>
        buildCustomerSummary(c, db.sales || [], db.batches || [])
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
          db.batches || []
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
        customers[customerIndex] = updated;
        db.customers = customers;
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
        const [deleted] = customers.splice(customerIndex, 1);
        db.customers = customers;
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
      await saveDb(db);
      return sendJson(res, 201, newCustomer);
    }

    return false;
  };
}

export { validateCustomer, sanitizeCustomer, buildCustomerSummary };
