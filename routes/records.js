export function createRecordsRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function recordsRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/records") {
      const db = await loadDb();
      return sendJson(res, 200, db.records);
    }

    if (method === "POST" && pathname === "/api/records") {
      const input = await body(req);
      const db = await loadDb();
      if (!input.batchId) {
        return sendJson(res, 400, { error: "批次不能为空" });
      }
      if (!db.batches.some((b) => b.id === input.batchId)) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      const record = {
        id: `REC-${Date.now()}`,
        batchId: input.batchId,
        date: input.date,
        poolId: input.poolId || "",
        temperature: Number(input.temperature),
        salinity: Number(input.salinity),
        oxygen: Number(input.oxygen),
        feed: Number(input.feed),
        mortality: Number(input.mortality),
        abnormal: input.abnormal || "无",
      };
      db.records.push(record);
      await saveDb(db);
      return sendJson(res, 201, record);
    }

    return false;
  };
}
