const COST_CATEGORIES = ["饲料", "药品", "人工", "能源", "其他"];
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

function getFarmIdFromQuery(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("farmId");
}

function validateCostItem(input, db, isEdit = false) {
  const errors = [];

  if (!input.batchId || !input.batchId.trim()) {
    errors.push("批次不能为空");
  } else if (!db.batches.some((b) => b.id === input.batchId.trim())) {
    errors.push("批次不存在");
  }

  if (!input.category || !input.category.trim()) {
    errors.push("费用类别不能为空");
  } else if (!COST_CATEGORIES.includes(input.category.trim())) {
    errors.push("费用类别必须是：饲料、药品、人工、能源、其他");
  }

  if (!input.date || !input.date.trim()) {
    errors.push("日期不能为空");
  }

  const amount = Number(input.amount);
  if (isNaN(amount) || amount < 0) {
    errors.push("金额必须是非负数");
  }

  if (input.quantity !== undefined && input.quantity !== null && input.quantity !== "") {
    const qty = Number(input.quantity);
    if (isNaN(qty) || qty < 0) {
      errors.push("数量必须是非负数");
    }
  }

  return errors;
}

export function createCostsRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function costsRouter(req, res, pathname, method) {
    const idMatch = pathname.match(/^\/api\/costs\/([^/]+)$/);

    if (method === "GET" && pathname === "/api/costs") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const batchId = url.searchParams.get("batchId");
      const farmId = url.searchParams.get("farmId");
      let costItems = db.costItems || [];
      if (batchId) {
        costItems = costItems.filter((c) => c.batchId === batchId);
      }
      if (farmId) {
        costItems = costItems.filter((c) => c.farmId === farmId);
      }
      return sendJson(res, 200, costItems);
    }

    if (method === "GET" && idMatch) {
      const db = await loadDb();
      const costItems = db.costItems || [];
      const item = costItems.find((c) => c.id === idMatch[1]);
      return item
        ? sendJson(res, 200, item)
        : sendJson(res, 404, { error: "成本项目不存在" });
    }

    if (method === "POST" && pathname === "/api/costs") {
      const input = await body(req);
      const db = await loadDb();

      const errors = validateCostItem(input, db);
      if (errors.length > 0) {
        return sendJson(res, 400, { error: errors.join("；") });
      }

      const quantity = input.quantity !== undefined && input.quantity !== null && input.quantity !== ""
        ? Number(input.quantity)
        : undefined;

      const farmId = getFarmIdForBatch(db, input.batchId.trim());

      const costItem = {
        id: `COST-${Date.now()}`,
        batchId: input.batchId.trim(),
        category: input.category.trim(),
        date: input.date.trim(),
        amount: Number(input.amount),
        quantity,
        unit: input.unit?.trim() || undefined,
        description: input.description?.trim() || undefined,
        farmId: farmId,
      };

      if (!db.costItems) db.costItems = [];
      db.costItems.push(costItem);
      await saveDb(db);
      return sendJson(res, 201, costItem);
    }

    if (method === "PUT" && idMatch) {
      const input = await body(req);
      const db = await loadDb();
      const costItems = db.costItems || [];
      const index = costItems.findIndex((c) => c.id === idMatch[1]);

      if (index === -1) {
        return sendJson(res, 404, { error: "成本项目不存在" });
      }

      const farmId = getFarmIdFromQuery(req);
      const existing = costItems[index];
      if (farmId && existing.farmId !== farmId) {
        return sendJson(res, 404, { error: "成本项目不存在" });
      }

      const errors = validateCostItem(input, db, true);
      if (errors.length > 0) {
        return sendJson(res, 400, { error: errors.join("；") });
      }

      const quantity = input.quantity !== undefined && input.quantity !== null && input.quantity !== ""
        ? Number(input.quantity)
        : undefined;

      const updated = {
        ...existing,
        batchId: input.batchId.trim(),
        category: input.category.trim(),
        date: input.date.trim(),
        amount: Number(input.amount),
        quantity,
        unit: input.unit?.trim() || undefined,
        description: input.description?.trim() || undefined,
        farmId: existing.farmId,
      };

      costItems[index] = updated;
      db.costItems = costItems;
      await saveDb(db);
      return sendJson(res, 200, costItems[index]);
    }

    if (method === "DELETE" && idMatch) {
      const db = await loadDb();
      const costItems = db.costItems || [];
      const index = costItems.findIndex((c) => c.id === idMatch[1]);

      if (index === -1) {
        return sendJson(res, 404, { error: "成本项目不存在" });
      }

      const farmId = getFarmIdFromQuery(req);
      const existing = costItems[index];
      if (farmId && existing.farmId !== farmId) {
        return sendJson(res, 404, { error: "成本项目不存在" });
      }

      costItems.splice(index, 1);
      db.costItems = costItems;
      await saveDb(db);
      return sendJson(res, 200, { success: true });
    }

    return false;
  };
}
