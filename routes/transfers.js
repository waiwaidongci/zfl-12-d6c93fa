export function createTransfersRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function transfersRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/transfers") {
      const db = await loadDb();
      return sendJson(res, 200, db.transfers);
    }

    if (method === "POST" && pathname === "/api/transfers") {
      const input = await body(req);
      const db = await loadDb();
      if (!input.batchId) {
        return sendJson(res, 400, { error: "批次不能为空" });
      }
      const batch = db.batches.find((item) => item.id === input.batchId);
      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      const transfer = {
        id: `TR-${Date.now()}`,
        batchId: input.batchId,
        fromPool: input.fromPool,
        toPool: input.toPool,
        date: input.date,
        count: Number(input.count),
        reason: input.reason || "",
      };
      batch.currentPool = input.toPool;
      db.transfers.push(transfer);
      await saveDb(db);
      return sendJson(res, 201, transfer);
    }

    return false;
  };
}
