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

export function createTransfersRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function transfersRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/transfers") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let transfers = db.transfers;
      if (farmId) {
        transfers = transfers.filter((t) => t.farmId === farmId);
      }
      return sendJson(res, 200, transfers);
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
      const farmId = input.farmId || getFarmIdForBatch(db, input.batchId);
      const transfer = {
        id: `TR-${Date.now()}`,
        batchId: input.batchId,
        fromPool: input.fromPool,
        toPool: input.toPool,
        date: input.date,
        count: Number(input.count),
        reason: input.reason || "",
        farmId: farmId,
      };
      batch.currentPool = input.toPool;
      db.transfers.push(transfer);
      await saveDb(db);
      return sendJson(res, 201, transfer);
    }

    return false;
  };
}
