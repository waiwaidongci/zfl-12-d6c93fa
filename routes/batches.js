function sum(items, key) {
  return Number(
    items.reduce((total, item) => total + Number(item[key] || 0), 0).toFixed(2)
  );
}

function avg(items, key) {
  if (!items.length) return 0;
  return Number((sum(items, key) / items.length).toFixed(2));
}

export function batchTrace(db, batchId) {
  const batch = db.batches.find((item) => item.id === batchId);
  if (!batch) return null;
  const records = db.records
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const transfers = db.transfers
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const sales = db.sales
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const feedCost = records.reduce((sum, item) => sum + Number(item.feed || 0) * 7.8, 0);
  return {
    batch,
    records,
    transfers,
    sales,
    summary: {
      averageTemperature: avg(records, "temperature"),
      averageOxygen: avg(records, "oxygen"),
      totalFeed: sum(records, "feed"),
      averageMortality: avg(records, "mortality"),
      estimatedCost: Math.round((batch.cost || 0) + feedCost),
      soldCount: sum(sales, "count"),
    },
  };
}

export function createBatchesRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function batchesRouter(req, res, pathname, method) {
    const traceMatch = pathname.match(/^\/api\/batches\/([^/]+)\/trace$/);
    if (traceMatch && method === "GET") {
      const db = await loadDb();
      const trace = batchTrace(db, traceMatch[1]);
      return trace
        ? sendJson(res, 200, trace)
        : sendJson(res, 404, { error: "batch_not_found" });
    }

    if (method === "GET" && pathname === "/api/batches") {
      const db = await loadDb();
      return sendJson(res, 200, db.batches);
    }

    if (method === "POST" && pathname === "/api/batches") {
      const input = await body(req);
      const db = await loadDb();
      if (!input.id || !input.id.trim()) {
        return sendJson(res, 400, { error: "批次号不能为空" });
      }
      if (db.batches.some((b) => b.id === input.id.trim())) {
        return sendJson(res, 409, { error: "批次号已存在" });
      }
      const batch = {
        id: input.id.trim(),
        species: input.species || "",
        parentPoolId: input.parentPoolId || "",
        hatchDate: input.hatchDate || "",
        currentPool: input.currentPool || "",
        estimatedCount: Number(input.estimatedCount) || 0,
        status: "育苗中",
        cost: Number(input.cost || 0),
      };
      db.batches.push(batch);
      db.transfers.push({
        id: `TR-${Date.now()}`,
        batchId: batch.id,
        fromPool: "孵化桶",
        toPool: batch.currentPool,
        date: batch.hatchDate,
        count: batch.estimatedCount,
        reason: "新批次入池",
      });
      await saveDb(db);
      return sendJson(res, 201, batch);
    }

    return false;
  };
}
