import { generateWarningsFromRecord, removeWarningsForRecord } from "./warnings.js";
import { writeLog } from "../utils/audit-log.js";

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

export function createRecordsRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function recordsRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/records") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let records = db.records;
      if (farmId) {
        records = records.filter((r) => r.farmId === farmId);
      }
      return sendJson(res, 200, records);
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
      const farmId = getFarmIdForBatch(db, input.batchId);
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
        farmId: farmId,
      };
      db.records.push(record);
      writeLog(db, {
        operator: input.operator || "",
        action: "record_create",
        targetType: "record",
        targetId: record.id,
        before: null,
        after: record,
        farmId: farmId,
      });

      const generatedWarnings = generateWarningsFromRecord(record, db);
      for (const w of generatedWarnings) {
        w.farmId = farmId;
      }

      await saveDb(db);
      return sendJson(res, 201, { record, warnings: generatedWarnings });
    }

    const recordMatch = pathname.match(/^\/api\/records\/([^/]+)$/);
    if (recordMatch) {
      const recordId = decodeURIComponent(recordMatch[1]);
      const db = await loadDb();
      const recordIndex = db.records.findIndex((r) => r.id === recordId);

      if (method === "GET") {
        if (recordIndex === -1) {
          return sendJson(res, 404, { error: "记录不存在" });
        }
        const record = db.records[recordIndex];
        const relatedWarnings = (db.warnings || []).filter((w) => w.recordId === recordId);
        return sendJson(res, 200, { record, relatedWarnings });
      }

      if (method === "PUT") {
        if (recordIndex === -1) {
          return sendJson(res, 404, { error: "记录不存在" });
        }
        const farmId = getFarmIdFromQuery(req);
        const existing = db.records[recordIndex];
        if (farmId && existing.farmId !== farmId) {
          return sendJson(res, 404, { error: "记录不存在" });
        }
        const input = await body(req);
        if (input.batchId && !db.batches.some((b) => b.id === input.batchId)) {
          return sendJson(res, 404, { error: "批次不存在" });
        }
        const updated = {
          id: existing.id,
          batchId: input.batchId !== undefined ? input.batchId : existing.batchId,
          date: input.date !== undefined ? input.date : existing.date,
          poolId: input.poolId !== undefined ? input.poolId || "" : existing.poolId,
          temperature: input.temperature !== undefined ? Number(input.temperature) : existing.temperature,
          salinity: input.salinity !== undefined ? Number(input.salinity) : existing.salinity,
          oxygen: input.oxygen !== undefined ? Number(input.oxygen) : existing.oxygen,
          feed: input.feed !== undefined ? Number(input.feed) : existing.feed,
          mortality: input.mortality !== undefined ? Number(input.mortality) : existing.mortality,
          abnormal: input.abnormal !== undefined ? (input.abnormal || "无") : existing.abnormal,
          farmId: existing.farmId,
        };
        db.records[recordIndex] = updated;
        writeLog(db, {
          operator: input.operator || "",
          action: "record_update",
          targetType: "record",
          targetId: existing.id,
          before: existing,
          after: updated,
          farmId: existing.farmId,
        });

        const updatedWarnings = generateWarningsFromRecord(updated, db, true);

        await saveDb(db);
        return sendJson(res, 200, { record: updated, warnings: updatedWarnings });
      }

      if (method === "DELETE") {
        if (recordIndex === -1) {
          return sendJson(res, 404, { error: "记录不存在" });
        }
        const farmId = getFarmIdFromQuery(req);
        const existing = db.records[recordIndex];
        if (farmId && existing.farmId !== farmId) {
          return sendJson(res, 404, { error: "记录不存在" });
        }
        existing._originalIndex = recordIndex;
        const removedCount = removeWarningsForRecord(recordId, db);
        db.records.splice(recordIndex, 1);
        writeLog(db, {
          operator: "",
          action: "record_delete",
          targetType: "record",
          targetId: recordId,
          before: existing,
          after: null,
          farmId: existing.farmId,
        });
        await saveDb(db);
        return sendJson(res, 200, { ok: true, removedWarningsCount: removedCount });
      }
    }

    return false;
  };
}
