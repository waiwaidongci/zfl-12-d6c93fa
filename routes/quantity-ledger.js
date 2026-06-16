import { writeLog } from "../utils/audit-log.js";
import {
  getLedgersForBatch,
  getAllQuantityLedgers,
  calculateBatchQuantity,
  calculateSourceComposition,
  validateBatchQuantityConsistency,
  validateAllBatches,
  migrateLedgersFromSnapshot,
  recalculateBatchEstimatesFromLedgers,
  getLedgerTypeLabel,
  LEDGER_TYPES,
} from "../utils/quantity-ledger.js";

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

function enrichLedger(ledger) {
  return {
    ...ledger,
    typeLabel: getLedgerTypeLabel(ledger.type),
    changeAbs: Math.abs(ledger.change),
    isIncrease: ledger.change > 0,
    isDecrease: ledger.change < 0,
  };
}

export function createQuantityLedgerRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function quantityLedgerRouter(req, res, pathname, method) {
    const batchLedgersMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ledgers$/);
    if (batchLedgersMatch && method === "GET") {
      const db = await loadDb();
      const batchId = batchLedgersMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);

      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      if (farmId && batch.farmId !== farmId) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      const ledgers = getLedgersForBatch(db, batchId);
      const quantity = calculateBatchQuantity(db, batchId);
      const enriched = ledgers.map(enrichLedger);

      return sendJson(res, 200, {
        batchId,
        quantity,
        ledgers: enriched,
        ledgerTypes: LEDGER_TYPES,
      });
    }

    const batchQuantityMatch = pathname.match(/^\/api\/batches\/([^/]+)\/quantity$/);
    if (batchQuantityMatch && method === "GET") {
      const db = await loadDb();
      const batchId = batchQuantityMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);

      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      if (farmId && batch.farmId !== farmId) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      const quantity = calculateBatchQuantity(db, batchId);
      return sendJson(res, 200, quantity);
    }

    const batchSourceMatch = pathname.match(/^\/api\/batches\/([^/]+)\/sources$/);
    if (batchSourceMatch && method === "GET") {
      const db = await loadDb();
      const batchId = batchSourceMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);

      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      if (farmId && batch.farmId !== farmId) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      const sources = calculateSourceComposition(db, batchId);
      return sendJson(res, 200, sources);
    }

    const batchValidateMatch = pathname.match(/^\/api\/batches\/([^/]+)\/validate-quantity$/);
    if (batchValidateMatch && method === "GET") {
      const db = await loadDb();
      const batchId = batchValidateMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);

      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      if (farmId && batch.farmId !== farmId) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      const validation = validateBatchQuantityConsistency(db, batchId);
      return sendJson(res, 200, validation);
    }

    if (method === "GET" && pathname === "/api/quantity-ledgers") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req);
      const allLedgers = getAllQuantityLedgers(db);

      let filtered = allLedgers;
      if (farmId) {
        filtered = allLedgers.filter((l) => l.farmId === farmId);
      }

      const url = new URL(req.url, `http://${req.headers.host}`);
      const type = url.searchParams.get("type");
      if (type) {
        filtered = filtered.filter((l) => l.type === type);
      }

      const enriched = filtered.map(enrichLedger);
      return sendJson(res, 200, {
        ledgers: enriched,
        totalCount: filtered.length,
        ledgerTypes: LEDGER_TYPES,
      });
    }

    if (method === "GET" && pathname === "/api/quantity/overview") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req);

      let batches = db.batches || [];
      if (farmId) {
        batches = batches.filter((b) => b.farmId === farmId);
      }

      const batchQuantities = [];
      let totalEstimate = 0;
      let totalAvailable = 0;
      let totalReserved = 0;
      let totalOldSales = 0;
      let totalShipped = 0;

      for (const batch of batches) {
        const qty = calculateBatchQuantity(db, batch.id);
        if (qty) {
          batchQuantities.push(qty);
          totalEstimate += qty.estimatedCount;
          totalAvailable += qty.availableQuantity;
          totalReserved += qty.reservedQuantity;
          totalOldSales += qty.oldSalesQuantity;
          totalShipped += qty.shippedQuantity;
        }
      }

      return sendJson(res, 200, {
        farmId: farmId || "",
        batchCount: batches.length,
        totalEstimatedCount: totalEstimate,
        totalAvailableQuantity: totalAvailable,
        totalReservedQuantity: totalReserved,
        totalOldSalesQuantity: totalOldSales,
        totalShippedQuantity: totalShipped,
        totalSoldCount: totalOldSales + totalShipped,
        batchQuantities,
      });
    }

    if (method === "POST" && pathname === "/api/quantity-ledgers/migrate") {
      const db = await loadDb();
      const input = await body(req);

      const result = migrateLedgersFromSnapshot(db);

      writeLog(db, {
        operator: input.operator || "",
        action: "quantity_ledger_migrate",
        targetType: "quantityLedger",
        targetId: "",
        before: null,
        after: result,
        farmId: input.farmId || "",
      });

      await saveDb(db);
      return sendJson(res, 200, result);
    }

    if (method === "POST" && pathname === "/api/quantity/recalculate") {
      const db = await loadDb();
      const input = await body(req);

      const result = recalculateBatchEstimatesFromLedgers(db);

      writeLog(db, {
        operator: input.operator || "",
        action: "quantity_recalculate",
        targetType: "batch",
        targetId: "",
        before: null,
        after: result,
        farmId: input.farmId || "",
      });

      await saveDb(db);
      return sendJson(res, 200, result);
    }

    if (method === "GET" && pathname === "/api/quantity/validate") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req);

      let validation = validateAllBatches(db);

      if (farmId) {
        const filteredResults = {};
        const batches = (db.batches || []).filter((b) => b.farmId === farmId);
        let errors = 0;
        let warnings = 0;
        for (const batch of batches) {
          filteredResults[batch.id] = validation.results[batch.id];
          if (filteredResults[batch.id]) {
            errors += filteredResults[batch.id].errorCount;
            warnings += filteredResults[batch.id].warningCount;
          }
        }
        validation = {
          batchCount: batches.length,
          totalErrors: errors,
          totalWarnings: warnings,
          results: filteredResults,
          hasIssues: errors > 0 || warnings > 0,
        };
      }

      return sendJson(res, 200, validation);
    }

    const traceMatch = pathname.match(/^\/api\/batches\/([^/]+)\/quantity-trace$/);
    if (traceMatch && method === "GET") {
      const db = await loadDb();
      const batchId = traceMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);

      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      if (farmId && batch.farmId !== farmId) {
        return sendJson(res, 404, { error: "批次不存在" });
      }

      const ledgers = getLedgersForBatch(db, batchId);
      const quantity = calculateBatchQuantity(db, batchId);
      const sources = calculateSourceComposition(db, batchId);
      const validation = validateBatchQuantityConsistency(db, batchId);

      const estimateEvents = [];
      let runningEstimate = 0;

      for (const ledger of ledgers) {
        if (ledger.type === "initial" || ledger.type === "lineage_in" ||
            ledger.type === "lineage_out" || ledger.type === "inventory") {
          runningEstimate += ledger.change;
          estimateEvents.push({
            date: ledger.date,
            type: ledger.type,
            typeLabel: getLedgerTypeLabel(ledger.type),
            change: ledger.change,
            balance: runningEstimate,
            referenceType: ledger.referenceType,
            referenceId: ledger.referenceId,
            note: ledger.note,
            detail: ledger.detail,
          });
        }
      }

      return sendJson(res, 200, {
        batchId,
        currentQuantity: quantity,
        estimateTimeline: estimateEvents,
        ledgers: ledgers.map(enrichLedger),
        sourceComposition: sources,
        validation,
      });
    }

    return false;
  };
}

export {
  getLedgersForBatch,
  getAllQuantityLedgers,
  calculateBatchQuantity,
  calculateSourceComposition,
  validateBatchQuantityConsistency,
  validateAllBatches,
  migrateLedgersFromSnapshot,
  recalculateBatchEstimatesFromLedgers,
};
