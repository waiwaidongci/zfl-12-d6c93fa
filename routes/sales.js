export function createSalesRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function salesRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/sales") {
      const db = await loadDb();
      return sendJson(res, 200, db.sales);
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
      const sale = {
        id: `SALE-${Date.now()}`,
        batchId: input.batchId,
        date: input.date,
        customer: input.customer,
        count: Number(input.count),
        unitPrice: Number(input.unitPrice),
      };
      db.sales.push(sale);
      await saveDb(db);
      return sendJson(res, 201, sale);
    }

    return false;
  };
}
