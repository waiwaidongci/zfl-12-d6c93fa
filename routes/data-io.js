import {
  parseCsv,
  generateCsv,
  validateRecordsCsv,
  buildBatchExportHeaders,
  buildRecordExportHeaders,
  buildTransferExportHeaders,
  buildSalesExportHeaders,
  RECORD_SCHEMA,
} from "../utils/csv.js";
import { generateWarningsFromRecord } from "./warnings.js";

export function createDataIoRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  function sendCsvResponse(res, filename, csvContent) {
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
    });
    res.end("\uFEFF" + csvContent);
  }

  return async function dataIoRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/export/batches") {
      const db = await loadDb();
      const headers = buildBatchExportHeaders();
      const csv = generateCsv(headers, db.batches);
      sendCsvResponse(res, "batches.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/records") {
      const db = await loadDb();
      const headers = buildRecordExportHeaders();
      const csv = generateCsv(headers, db.records);
      sendCsvResponse(res, "records.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/transfers") {
      const db = await loadDb();
      const headers = buildTransferExportHeaders();
      const csv = generateCsv(headers, db.transfers);
      sendCsvResponse(res, "transfers.csv", csv);
      return true;
    }

    if (method === "GET" && pathname === "/api/export/sales") {
      const db = await loadDb();
      const headers = buildSalesExportHeaders();
      const csv = generateCsv(headers, db.sales);
      sendCsvResponse(res, "sales.csv", csv);
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

        const record = {
          id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        allWarnings.push(...generatedWarnings);
        imported.push(record);
      }

      if (imported.length > 0) {
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
