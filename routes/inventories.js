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

export function createInventoriesRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function inventoriesRouter(req, res, pathname, method) {
    const batchInventoriesMatch = pathname.match(/^\/api\/batches\/([^/]+)\/inventories$/);
    if (batchInventoriesMatch && method === "GET") {
      const db = await loadDb();
      const batchId = batchInventoriesMatch[1];
      if (!db.batches.some((b) => b.id === batchId)) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      const inventories = (db.inventories || [])
        .filter((item) => item.batchId === batchId)
        .sort((a, b) => b.date.localeCompare(a.date));
      return sendJson(res, 200, inventories);
    }

    if (method === "GET" && pathname === "/api/inventories") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let inventories = (db.inventories || [])
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date));
      if (farmId) {
        inventories = inventories.filter((i) => i.farmId === farmId);
      }
      return sendJson(res, 200, inventories);
    }

    if (method === "POST" && pathname === "/api/inventories") {
      const input = await body(req);
      const db = await loadDb();

      if (!input.batchId) {
        return sendJson(res, 400, { error: "批次不能为空" });
      }
      const batch = db.batches.find((item) => item.id === input.batchId);
      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      const manualEstimate = Number(input.manualEstimate);
      const actualCount = Number(input.actualCount);

      if (isNaN(manualEstimate) || manualEstimate < 0) {
        return sendJson(res, 400, { error: "人工抽样估算数必须为非负数字" });
      }
      if (isNaN(actualCount) || actualCount < 0) {
        return sendJson(res, 400, { error: "实际盘点数必须为非负数字" });
      }

      const method = input.method === "full" ? "full" : "sampling";
      const systemEstimate = Number(batch.estimatedCount || 0);
      const difference = actualCount - systemEstimate;
      const farmId = input.farmId || getFarmIdForBatch(db, input.batchId);

      const inventory = {
        id: `INV-${Date.now()}`,
        batchId: input.batchId,
        date: input.date || new Date().toISOString().split("T")[0],
        poolId: input.poolId || batch.currentPool || "",
        method: method,
        manualEstimate: manualEstimate,
        actualCount: actualCount,
        systemEstimate: systemEstimate,
        beforeCount: systemEstimate,
        afterCount: actualCount,
        difference: difference,
        operator: input.operator || "",
        note: input.note || "",
        farmId: farmId,
      };

      if (!db.inventories) db.inventories = [];
      db.inventories.push(inventory);

      batch.estimatedCount = actualCount;

      await saveDb(db);
      return sendJson(res, 201, inventory);
    }

    const inventoryMatch = pathname.match(/^\/api\/inventories\/([^/]+)$/);
    if (inventoryMatch) {
      const inventoryId = decodeURIComponent(inventoryMatch[1]);
      const db = await loadDb();
      const inventoryIndex = (db.inventories || []).findIndex((i) => i.id === inventoryId);

      if (method === "GET") {
        if (inventoryIndex === -1) {
          return sendJson(res, 404, { error: "盘点记录不存在" });
        }
        return sendJson(res, 200, db.inventories[inventoryIndex]);
      }

      if (method === "DELETE") {
        if (inventoryIndex === -1) {
          return sendJson(res, 404, { error: "盘点记录不存在" });
        }
        const removed = db.inventories[inventoryIndex];
        db.inventories.splice(inventoryIndex, 1);

        const batch = db.batches.find((b) => b.id === removed.batchId);
        if (batch) {
          const remainingInventories = (db.inventories || [])
            .filter((i) => i.batchId === batch.id)
            .sort((a, b) => a.date.localeCompare(b.date));
          if (remainingInventories.length > 0) {
            const lastInventory = remainingInventories[remainingInventories.length - 1];
            batch.estimatedCount = lastInventory.afterCount;
          } else {
            batch.estimatedCount = removed.beforeCount;
          }
        }

        await saveDb(db);
        return sendJson(res, 200, { ok: true, removed });
      }
    }

    return false;
  };
}
