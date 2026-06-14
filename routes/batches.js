function sum(items, key) {
  return Number(
    items.reduce((total, item) => total + Number(item[key] || 0), 0).toFixed(2)
  );
}

function avg(items, key) {
  if (!items.length) return 0;
  return Number((sum(items, key) / items.length).toFixed(2));
}

function calcCostSummary(costItems) {
  const categories = ["饲料", "药品", "人工", "能源", "其他"];
  const byCategory = {};
  categories.forEach((cat) => {
    byCategory[cat] = costItems
      .filter((c) => c.category === cat)
      .reduce((total, c) => total + Number(c.amount || 0), 0);
  });
  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  return { byCategory, total };
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
    .map((s) => enrichSale(s, db))
    .sort((a, b) => a.date.localeCompare(b.date));
  const costItems = (db.costItems || [])
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const warnings = (db.warnings || [])
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const inventories = (db.inventories || [])
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));

  const initialCost = Number(batch.cost || 0);
  const costSummary = calcCostSummary(costItems);
  const totalCost = initialCost + costSummary.total;
  const estimatedCount = Number(batch.estimatedCount || 0);
  const unitCost = estimatedCount > 0 ? Number((totalCost / estimatedCount).toFixed(6)) : 0;

  const soldCount = sum(sales, "count");
  const salesRevenue = sales.reduce((total, s) => total + Number(s.count || 0) * Number(s.unitPrice || 0), 0);
  const soldCost = soldCount * unitCost;
  const grossProfit = salesRevenue - soldCost;
  const grossMargin = salesRevenue > 0 ? Number(((grossProfit / salesRevenue) * 100).toFixed(2)) : 0;

  const inventoryStats = inventories.length > 0 ? {
    totalAdjustments: inventories.length,
    lastInventoryDate: inventories[inventories.length - 1].date,
    totalDifference: sum(inventories, "difference"),
  } : {
    totalAdjustments: 0,
    lastInventoryDate: null,
    totalDifference: 0,
  };

  return {
    batch,
    records,
    transfers,
    sales,
    costItems,
    warnings,
    inventories,
    summary: {
      averageTemperature: avg(records, "temperature"),
      averageOxygen: avg(records, "oxygen"),
      totalFeed: sum(records, "feed"),
      averageMortality: avg(records, "mortality"),
      initialCost,
      costByCategory: costSummary.byCategory,
      costItemsTotal: costSummary.total,
      totalCost,
      estimatedCount,
      unitCost,
      soldCount,
      salesRevenue: Number(salesRevenue.toFixed(2)),
      soldCost: Number(soldCost.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossMargin,
      inventoryStats,
    },
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
