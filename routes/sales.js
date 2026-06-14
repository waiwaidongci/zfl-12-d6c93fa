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

export function createSalesRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function salesRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/sales") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let sales = db.sales || [];
      if (farmId) {
        sales = sales.filter((s) => s.farmId === farmId);
      }
      const enriched = sales.map((s) => enrichSale(s, db));
      return sendJson(res, 200, enriched);
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

      const farmId = input.farmId || getFarmIdForBatch(db, input.batchId);

      const sale = {
        id: `SALE-${Date.now()}`,
        batchId: input.batchId,
        date: input.date,
        customerId: customerId || undefined,
        customer: customerName,
        count: Number(input.count),
        unitPrice: Number(input.unitPrice),
        farmId: farmId,
      };

      if (!sale.customerId) {
        delete sale.customerId;
      }

      if (!db.sales) db.sales = [];
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
