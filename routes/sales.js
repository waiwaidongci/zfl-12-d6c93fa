export function createSalesRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function salesRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/sales") {
      const db = await loadDb();
      const sales = (db.sales || []).map((s) => enrichSale(s, db));
      return sendJson(res, 200, sales);
    }

    if (method === "POST" && pathname === "/api/sales") {
      const input = await body(req);
      const db = await loadDb();
      if (!input.batchId) {
        return sendJson(res, 400, { error: "批次不能为空" });
      }
      if (!db.batches.some((b) => b.id === input.batchId)) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      let customerId = input.customerId || "";
      let customerName = input.customer || "";

      if (customerId) {
        const customer = (db.customers || []).find((c) => c.id === customerId);
        if (!customer) {
          return sendJson(res, 400, { error: "客户不存在" });
        }
        customerName = customer.name;
      } else if (!customerName) {
        return sendJson(res, 400, { error: "客户不能为空" });
      }

      const sale = {
        id: `SALE-${Date.now()}`,
        batchId: input.batchId,
        date: input.date,
        customerId: customerId || undefined,
        customer: customerName,
        count: Number(input.count),
        unitPrice: Number(input.unitPrice),
      };

      if (!sale.customerId) {
        delete sale.customerId;
      }

      db.sales.push(sale);
      await saveDb(db);
      return sendJson(res, 201, enrichSale(sale, db));
    }

    return false;
  };
}

function enrichSale(sale, db) {
  const customers = db.customers || [];
  let customerInfo = null;
  if (sale.customerId) {
    const c = customers.find((cu) => cu.id === sale.customerId);
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
  return {
    ...sale,
    customerInfo,
  };
}
