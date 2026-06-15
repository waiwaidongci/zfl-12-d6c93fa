import {
  parseCsv,
  generateCsv,
  validateRecordsCsv,
  revalidateSingleRow,
  buildBatchExportHeaders,
  buildRecordExportHeaders,
  buildTransferExportHeaders,
  buildSalesExportHeaders,
  buildOrderExportHeaders,
  buildShipmentExportHeaders,
  enrichOrdersForExport,
  enrichShipmentsForExport,
  RECORD_SCHEMA,
} from "../utils/csv.js";
import { generateWarningsFromRecord } from "./warnings.js";
import { DEFAULT_FARM_ID, getDefaultFarm } from "./farms.js";
import { writeLog } from "../utils/audit-log.js";

function getFarmIdFromQuery(url) {
  if (!url) return null;
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return null;
  const params = new URLSearchParams(url.slice(queryIndex + 1));
  return params.get("farmId") || null;
}

function getFarmIdForBatch(db, batchId) {
  const batch = db.batches?.find((b) => b.id === batchId);
  if (batch?.farmId) return batch.farmId;
  return getDefaultFarm(db.farms || [])?.id || DEFAULT_FARM_ID;
}

function generateDraftId() {
  return `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildDraftResponse(draft) {
  if (!draft) return null;
  const validCount = draft.rows.filter((r) => r.isValid).length;
  const errorCount = draft.rows.length - validCount;
  return {
    id: draft.id,
    name: draft.name,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    farmId: draft.farmId,
    source: draft.source,
    status: draft.status,
    totalRows: draft.rows.length,
    validCount,
    errorCount,
    rows: draft.rows,
    headers: draft.headers,
    meta: draft.meta || {},
  };
}

export function createDataIoRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  function sendCsvResponse(res, filename, csvContent) {
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
    });
    res.end("\uFEFF" + csvContent);
  }

  function ensureImportDrafts(db) {
    if (!db.importDrafts) db.importDrafts = [];
    return db.importDrafts;
  }

  return async function dataIoRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/export/batches") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req.url);
      let data = db.batches || [];
      if (farmId) data = data.filter((b) => b.farmId === farmId);
      const headers = buildBatchExportHeaders();
      const csv = generateCsv(headers, data);
      sendCsvResponse(res, "batches.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/records") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req.url);
      let data = db.records || [];
      if (farmId) data = data.filter((r) => r.farmId === farmId);
      const headers = buildRecordExportHeaders();
      const csv = generateCsv(headers, data);
      sendCsvResponse(res, "records.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/transfers") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req.url);
      let data = db.transfers || [];
      if (farmId) data = data.filter((t) => t.farmId === farmId);
      const headers = buildTransferExportHeaders();
      const csv = generateCsv(headers, data);
      sendCsvResponse(res, "transfers.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/sales") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req.url);
      let data = db.sales || [];
      if (farmId) data = data.filter((s) => s.farmId === farmId);
      const headers = buildSalesExportHeaders();
      const csv = generateCsv(headers, data);
      sendCsvResponse(res, "sales.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/orders") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req.url);
      let data = db.orders || [];
      if (farmId) data = data.filter((o) => o.farmId === farmId);
      const enriched = enrichOrdersForExport(data, db);
      const headers = buildOrderExportHeaders();
      const csv = generateCsv(headers, enriched);
      sendCsvResponse(res, "orders.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/shipments") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req.url);
      let data = db.shipments || [];
      if (farmId) data = data.filter((s) => s.farmId === farmId);
      const enriched = enrichShipmentsForExport(data, db);
      const headers = buildShipmentExportHeaders();
      const csv = generateCsv(headers, enriched);
      sendCsvResponse(res, "shipments.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/schema") {
      return sendJson(res, 200, {
        records: {
          schema: RECORD_SCHEMA,
        },
      });
    }

    if (method === "POST" && pathname === "/api/import/records/preview") {
      const input = await body(req);
      const csvText = input.csv;
      if (!csvText || !csvText.trim()) {
        return sendJson(res, 400, { error: "CSV内容不能为空" });
      }
      const db = await loadDb();
      const parsed = parseCsv(csvText);

      if (parsed.headers.length === 0) {
        return sendJson(res, 400, { error: "CSV文件为空或格式不正确" });
      }

      const validation = validateRecordsCsv(parsed, db);

      if (!validation.valid) {
        return sendJson(res, 400, { error: validation.fatalError });
      }

      return sendJson(res, 200, {
        totalRows: validation.totalRows,
        validCount: validation.validCount,
        errorCount: validation.errorCount,
        warningCount: validation.warningCount,
        errors: validation.errors,
        warnings: validation.warnings,
        preview: validation.preview,
        validRows: validation.validRows,
        allRowStatuses: validation.allRowStatuses,
        headers: validation.headers,
      });
    }

    if (method === "POST" && pathname === "/api/import/records/draft/create") {
      const input = await body(req);
      const csvText = input.csv;
      const farmId = input.farmId || getFarmIdFromQuery(req.url) || "";
      const operator = input.operator || "";
      if (!csvText || !csvText.trim()) {
        return sendJson(res, 400, { error: "CSV内容不能为空" });
      }
      const db = await loadDb();
      const drafts = ensureImportDrafts(db);
      const parsed = parseCsv(csvText);

      if (parsed.headers.length === 0) {
        return sendJson(res, 400, { error: "CSV文件为空或格式不正确" });
      }

      const validation = validateRecordsCsv(parsed, db);

      if (!validation.valid) {
        return sendJson(res, 400, { error: validation.fatalError });
      }

      const now = new Date().toISOString();
      const draft = {
        id: generateDraftId(),
        name: input.name || `导入草稿-${new Date().toLocaleString("zh-CN")}`,
        createdAt: now,
        updatedAt: now,
        farmId,
        source: "csv_upload",
        status: "draft",
        rows: validation.allRowStatuses,
        headers: validation.headers,
        meta: {
          originalFileName: input.fileName || "",
          totalRows: validation.totalRows,
        },
      };

      drafts.push(draft);

      writeLog(db, {
        operator,
        action: "import_draft_create",
        targetType: "import_draft",
        targetId: draft.id,
        before: null,
        after: {
          id: draft.id,
          name: draft.name,
          totalRows: draft.rows.length,
          validCount: validation.validCount,
          errorCount: validation.errorCount,
        },
        farmId,
        meta: { source: "csv_import_draft", fileName: input.fileName || "" },
      });

      await saveDb(db);

      return sendJson(res, 201, buildDraftResponse(draft));
    }

    if (method === "GET" && pathname === "/api/import/records/draft/list") {
      const db = await loadDb();
      const drafts = ensureImportDrafts(db);
      const farmId = getFarmIdFromQuery(req.url);
      let list = drafts;
      if (farmId) {
        list = list.filter((d) => !d.farmId === farmId);
      }
      const response = list.map(buildDraftResponse);
      return sendJson(res, 200, response);
    }

    const draftMatch = pathname.match(/^\/api\/import\/records\/draft\/([^/]+)$/);
    if (draftMatch) {
      const draftId = decodeURIComponent(draftMatch[1]);
      const db = await loadDb();
      const drafts = ensureImportDrafts(db);
      const draftIdx = drafts.findIndex((d) => d.id === draftId);
      if (draftIdx === -1) {
        return sendJson(res, 404, { error: "导入草稿不存在" });
      }
      const draft = drafts[draftIdx];

      if (method === "GET") {
        return sendJson(res, 200, buildDraftResponse(draft));
      }

      if (method === "DELETE") {
        const input = await body(req);
        const operator = input?.operator || "";
        const deletedDraft = drafts.splice(draftIdx, 1)[0];
        writeLog(db, {
          operator,
          action: "import_draft_abandon",
          targetType: "import_draft",
          targetId: deletedDraft.id,
          before: {
            id: deletedDraft.id,
            name: deletedDraft.name,
            totalRows: deletedDraft.rows.length,
            validCount: deletedDraft.rows.filter((r) => r.isValid).length,
            errorCount: deletedDraft.rows.filter((r) => !r.isValid).length,
          },
          after: null,
          farmId: deletedDraft.farmId,
          meta: { source: "csv_import_draft_abandon" },
        });
        await saveDb(db);
        return sendJson(res, 200, { ok: true, message: "草稿已放弃" });
      }
    }

    const draftRowMatch = pathname.match(/^\/api\/import\/records\/draft\/([^/]+)\/row\/(\d+)$/);
    if (draftRowMatch && method === "PUT") {
      const draftId = decodeURIComponent(draftRowMatch[1]);
      const rowNum = parseInt(draftRowMatch[2], 10);
      const db = await loadDb();
      const drafts = ensureImportDrafts(db);
      const draft = drafts.find((d) => d.id === draftId);
      if (!draft) {
        return sendJson(res, 404, { error: "导入草稿不存在" });
      }
      const input = await body(req);
      const updatedRowData = input.row;
      if (!updatedRowData || typeof updatedRowData !== "object") {
        return sendJson(res, 400, { error: "行数据格式不正确" });
      }
      const rowIdx = draft.rows.findIndex((r) => r.rowNum === rowNum);
      if (rowIdx === -1) {
        return sendJson(res, 404, { error: "行不存在" });
      }

      const existingValidKeys = draft.rows
        .filter((r, i) => r.isValid && i !== rowIdx)
        .map((r) => r.normalizedRow.batchId + "|" + r.normalizedRow.date);

      const revalidation = revalidateSingleRow(updatedRowData, rowNum, db, existingValidKeys);
      draft.rows[rowIdx] = revalidation;
      draft.updatedAt = new Date().toISOString();

      await saveDb(db);
      return sendJson(res, 200, {
        rowStatus: revalidation,
        validCount: draft.rows.filter((r) => r.isValid).length,
        errorCount: draft.rows.filter((r) => !r.isValid).length,
      });
    }

    const draftRevalidateAllMatch = pathname.match(/^\/api\/import\/records\/draft\/([^/]+)\/revalidate$/);
    if (draftRevalidateAllMatch && method === "POST") {
      const draftId = decodeURIComponent(draftRevalidateAllMatch[1]);
      const db = await loadDb();
      const drafts = ensureImportDrafts(db);
      const draft = drafts.find((d) => d.id === draftId);
      if (!draft) {
        return sendJson(res, 404, { error: "导入草稿不存在" });
      }

      const parsedForValidation = {
        headers: draft.headers,
        rows: draft.rows.map((r) => r.originalRow),
      };
      const validation = validateRecordsCsv(parsedForValidation, db);
      if (!validation.valid) {
        return sendJson(res, 400, { error: validation.fatalError });
      }
      draft.rows = validation.allRowStatuses;
      draft.updatedAt = new Date().toISOString();
      await saveDb(db);
      return sendJson(res, 200, buildDraftResponse(draft));
    }

    const draftConfirmMatch = pathname.match(/^\/api\/import\/records\/draft\/([^/]+)\/confirm$/);
    if (draftConfirmMatch && method === "POST") {
      const draftId = decodeURIComponent(draftConfirmMatch[1]);
      const db = await loadDb();
      const drafts = ensureImportDrafts(db);
      const draftIdx = drafts.findIndex((d) => d.id === draftId);
      if (draftIdx === -1) {
        return sendJson(res, 404, { error: "导入草稿不存在" });
      }
      const draft = drafts[draftIdx];
      const input = await body(req);
      const operator = input?.operator || "";

      const validRows = draft.rows.filter((r) => r.isValid);
      if (validRows.length === 0) {
        return sendJson(res, 400, { error: "草稿中无有效记录可导入" });
      }

      const batchIds = new Set((db.batches || []).map((b) => b.id));
      const existingRecordKeys = new Set(
        (db.records || []).map((r) => r.batchId + "|" + r.date)
      );

      const imported = [];
      const allWarnings = [];
      const skipped = [];

      for (const rowStatus of validRows) {
        const rec = rowStatus.normalizedRow;
        if (!batchIds.has(rec.batchId)) {
          skipped.push({ ...rec, reason: "批次不存在" });
          continue;
        }
        if (existingRecordKeys.has(rec.batchId + "|" + rec.date)) {
          skipped.push({ ...rec, reason: "日期重复" });
          continue;
        }

        const farmIdForRecord = getFarmIdForBatch(db, rec.batchId);
        const record = {
          id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          farmId: farmIdForRecord,
          batchId: rec.batchId,
          date: rec.date,
          poolId: rec.poolId || "",
          temperature: Number(rec.temperature),
          salinity: Number(rec.salinity),
          oxygen: Number(rec.oxygen),
          feed: Number(rec.feed),
          mortality: Number(rec.mortality),
          abnormal: rec.abnormal || "无",
        };
        db.records.push(record);
        existingRecordKeys.add(record.batchId + "|" + record.date);

        const generatedWarnings = generateWarningsFromRecord(record, db);
        for (const w of generatedWarnings) {
          w.farmId = farmIdForRecord;
        }
        allWarnings.push(...generatedWarnings);
        imported.push(record);
      }

      if (imported.length > 0) {
        writeLog(db, {
          operator,
          action: "record_create",
          targetType: "record",
          targetId: imported.map((r) => r.id).join(","),
          before: null,
          after: imported,
          farmId: imported[0]?.farmId || "",
          meta: { source: "csv_import_draft", count: imported.length, draftId: draft.id },
        });

        writeLog(db, {
          operator,
          action: "import_draft_confirm",
          targetType: "import_draft",
          targetId: draft.id,
          before: {
            id: draft.id,
            name: draft.name,
            totalRows: draft.rows.length,
            validCount: validRows.length,
            errorCount: draft.rows.length - validRows.length,
          },
          after: {
            importedCount: imported.length,
            skippedCount: skipped.length,
            warningsGenerated: allWarnings.length,
          },
          farmId: draft.farmId,
          meta: { source: "csv_import_draft_confirm" },
        });

        db.warnings = db.warnings || [];
        db.warnings.push(...allWarnings);
        drafts.splice(draftIdx, 1);
        await saveDb(db);
      }

      return sendJson(res, 201, {
        importedCount: imported.length,
        skippedCount: skipped.length,
        skipped,
        warningsGenerated: allWarnings.length,
        importedIds: imported.map((r) => r.id),
        draftId: draft.id,
      });
    }

    if (method === "POST" && pathname === "/api/import/records/confirm") {
      const input = await body(req);
      const records = input.records;
      if (!Array.isArray(records) || records.length === 0) {
        return sendJson(res, 400, { error: "无有效记录可导入" });
      }
      const db = await loadDb();
      const batchIds = new Set(db.batches.map((b) => b.id));
      const existingRecordKeys = new Set(
        db.records.map((r) => r.batchId + "|" + r.date)
      );

      const imported = [];
      const allWarnings = [];
      const skipped = [];

      for (const rec of records) {
        if (!batchIds.has(rec.batchId)) {
          skipped.push({ ...rec, reason: "批次不存在" });
          continue;
        }
        if (existingRecordKeys.has(rec.batchId + "|" + rec.date)) {
          skipped.push({ ...rec, reason: "日期重复" });
          continue;
        }

        const farmId = getFarmIdForBatch(db, rec.batchId);
        const record = {
          id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          farmId,
          batchId: rec.batchId,
          date: rec.date,
          poolId: rec.poolId || "",
          temperature: Number(rec.temperature),
          salinity: Number(rec.salinity),
          oxygen: Number(rec.oxygen),
          feed: Number(rec.feed),
          mortality: Number(rec.mortality),
          abnormal: rec.abnormal || "无",
        };
        db.records.push(record);
        existingRecordKeys.add(record.batchId + "|" + record.date);

        const generatedWarnings = generateWarningsFromRecord(record, db);
        for (const w of generatedWarnings) {
          w.farmId = farmId;
        }
        allWarnings.push(...generatedWarnings);
        imported.push(record);
      }

      if (imported.length > 0) {
        writeLog(db, {
          operator: input.operator || "",
          action: "record_create",
          targetType: "record",
          targetId: imported.map((r) => r.id).join(","),
          before: null,
          after: imported,
          farmId: imported[0]?.farmId || "",
          meta: { source: "csv_import", count: imported.length },
        });
        db.warnings = db.warnings || [];
        db.warnings.push(...allWarnings);
        await saveDb(db);
      }

      return sendJson(res, 201, {
        importedCount: imported.length,
        skippedCount: skipped.length,
        skipped,
        warningsGenerated: allWarnings.length,
        importedIds: imported.map((r) => r.id),
      });
    }

    return false;
  };
}
