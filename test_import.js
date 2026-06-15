import http from "node:http";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitialSeed } from "./seed/seed.js";
import { createDataIoRouter } from "./routes/data-io.js";
import { createRecordsRouter } from "./routes/records.js";
import { createBatchesRouter } from "./routes/batches.js";
import {
  parseCsv,
  validateRecordsCsv,
  revalidateSingleRow,
  RECORD_SCHEMA,
} from "./utils/csv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_PATH = join(__dirname, "data", "hatchery_test_import.json");

let testServer = null;
let dbPath = TEST_DB_PATH;

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    const seed = getInitialSeed();
    if (!seed.importDrafts) seed.importDrafts = [];
    if (!seed.warnings) seed.warnings = [];
    if (!seed.opLogs) seed.opLogs = [];
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (!db.importDrafts) db.importDrafts = [];
  if (!db.warnings) db.warnings = [];
  if (!db.opLogs) db.opLogs = [];
  return db;
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function createTestServer() {
  const helpers = { loadDb, saveDb, sendJson, body };
  const dataIoRouter = createDataIoRouter(helpers);
  const recordsRouter = createRecordsRouter(helpers);
  const batchesRouter = createBatchesRouter(helpers);

  async function routeApi(req, res, url, method) {
    const pathname = url.pathname;
    const db = await loadDb();

    if (method === "GET" && pathname === "/api/state") {
      return sendJson(res, 200, db);
    }

    const result1 = await dataIoRouter(req, res, pathname, method);
    if (result1 !== false) return result1;

    const result2 = await recordsRouter(req, res, pathname, method);
    if (result2 !== false) return result2;

    const result3 = await batchesRouter(req, res, pathname, method);
    if (result3 !== false) return result3;

    return false;
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      if (pathname.startsWith("/api/")) {
        const handled = await routeApi(req, res, url, req.method);
        if (handled !== false) return;
        return sendJson(res, 404, { error: "not_found" });
      }

      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("Not Found");
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
}

async function startTestServer() {
  if (existsSync(TEST_DB_PATH)) {
    await unlink(TEST_DB_PATH);
  }
  return new Promise((resolve, reject) => {
    testServer = createTestServer();
    testServer.listen(TEST_PORT, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function stopTestServer() {
  return new Promise((resolve) => {
    if (testServer) {
      testServer.close(() => {
        testServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

async function cleanupTestDb() {
  if (existsSync(TEST_DB_PATH)) {
    await unlink(TEST_DB_PATH);
  }
}

async function api(path, options) {
  const res = await fetch(
    BASE_URL + path,
    options && options.body
      ? { ...options, headers: { "Content-Type": "application/json" } }
      : options
  );
  const data = await res.json();
  return { res, data };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
  console.log(`   ✓ ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`断言失败: ${message} - 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
  console.log(`   ✓ ${message}: ${JSON.stringify(actual)}`);
}

function buildValidCsv() {
  const lines = [
    "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal",
    "B-260601,2026-08-10,P-03,28.0,22,6.2,20,0.5,无",
    "B-260601,2026-08-11,P-03,27.8,21.5,6.0,19,0.3,无",
    "B-260601,2026-08-12,P-03,27.5,22.5,5.8,21,0.4,无",
  ];
  return lines.join("\n");
}

function buildCsvWithErrors() {
  const lines = [
    "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal",
    "B-260601,2026-08-20,P-03,28.0,22,6.2,20,0.5,无",
    "INVALID-BATCH,2026-08-21,P-03,28.0,22,6.2,20,0.5,无",
    "B-260601,not-a-date,P-03,28.0,22,6.2,20,0.5,无",
    "B-260601,2026-08-24,P-03,abc,22,6.2,20,0.5,无",
    "B-260601,2026-08-20,P-03,28.0,22,6.2,20,0.5,无",
    ",2026-08-26,P-03,28.0,22,6.2,20,0.5,无",
  ];
  return lines.join("\n");
}

async function test() {
  console.log("=== 开始测试每日记录导入草稿功能 ===\n");

  let passed = 0;
  let failed = 0;

  try {
    console.log("【初始化】启动测试服务器（端口 " + TEST_PORT + "）...");
    await startTestServer();
    console.log("   ✓ 测试服务器启动成功\n");

    const initialDb = await loadDb();
    const initialRecordsCount = (initialDb.records || []).length;
    const existingBatchId = initialDb.batches[0].id;
    console.log(`   初始数据库：${initialRecordsCount} 条记录，第一个批次 ${existingBatchId}\n`);

    console.log("【单元测试】CSV 工具函数测试\n");

    console.log("1. 测试 parseCsv 解析 CSV");
    const csvText = buildValidCsv();
    const parsed = parseCsv(csvText);
    assertEqual(parsed.headers.length, 9, "解析得到表头数量");
    assertEqual(parsed.rows.length, 3, "解析得到数据行数量");
    assertEqual(parsed.headers[0], "batchId", "第一个表头为 batchId");
    assertEqual(parsed.rows[0].batchId, "B-260601", "第一行 batchId 正确");
    passed++;

    console.log("\n2. 测试 validateRecordsCsv 校验有效 CSV");
    const dbForValidation = await loadDb();
    const validCsv = parseCsv(buildValidCsv());
    const validationValid = validateRecordsCsv(validCsv, dbForValidation);
    assertEqual(validationValid.valid, true, "校验通过");
    assertEqual(validationValid.totalRows, 3, "总行数");
    assertEqual(validationValid.validCount, 3, "有效行数");
    assertEqual(validationValid.errorCount, 0, "错误行数");
    assert(Array.isArray(validationValid.allRowStatuses), "返回 allRowStatuses 数组");
    assertEqual(validationValid.allRowStatuses.length, 3, "allRowStatuses 包含所有行");
    validationValid.allRowStatuses.forEach((rs, i) => {
      assertEqual(rs.isValid, true, `第 ${i + 1} 行 isValid 为 true`);
      assert(rs.normalizedRow != null, `第 ${i + 1} 行有 normalizedRow`);
      assertEqual(rs.originalRow != null, true, `第 ${i + 1} 行有 originalRow`);
    });
    assert(validationValid.headers != null, "返回 headers 信息");
    passed++;

    console.log("\n3. 测试 validateRecordsCsv 校验含错误的 CSV");
    const errorCsv = parseCsv(buildCsvWithErrors());
    const validationError = validateRecordsCsv(errorCsv, dbForValidation);
    assertEqual(validationError.valid, true, "校验过程无致命错误");
    assertEqual(validationError.totalRows, 6, "总行数");
    assert(validationError.validCount < 6, "有效行数少于总数");
    assert(validationError.errorCount > 0, "存在错误");
    const errorTypes = new Set(validationError.errors.map((e) => e.type));
    assert(errorTypes.has("batch_not_found"), "包含 batch_not_found 错误");
    assert(errorTypes.has("invalid_format"), "包含 invalid_format 错误");
    assert(errorTypes.has("invalid_number"), "包含 invalid_number 错误");
    assert(errorTypes.has("duplicate_in_file"), "包含 duplicate_in_file 错误");
    assert(errorTypes.has("missing_field"), "包含 missing_field 错误");
    passed++;

    console.log("\n4. 测试 validateRecordsCsv 缺失必要列的致命错误");
    const badHeaderCsv = parseCsv("wrong,column,names\n1,2,3");
    const validationFatal = validateRecordsCsv(badHeaderCsv, dbForValidation);
    assertEqual(validationFatal.valid, false, "检测到致命错误");
    assert(validationFatal.fatalError != null, "返回 fatalError 信息");
    passed++;

    console.log("\n5. 测试 revalidateSingleRow 单行重新校验");
    const goodRow = {
      batchId: existingBatchId,
      date: "2026-09-01",
      poolId: "P-03",
      temperature: "28.0",
      salinity: "22",
      oxygen: "6.2",
      feed: "20",
      mortality: "0.5",
      abnormal: "无",
    };
    const goodResult = revalidateSingleRow(goodRow, 5, dbForValidation);
    assertEqual(goodResult.isValid, true, "正确的行校验通过");
    assertEqual(goodResult.errors.length, 0, "无错误");

    const badRow = { ...goodRow, temperature: "not-a-number" };
    const badResult = revalidateSingleRow(badRow, 6, dbForValidation);
    assertEqual(badResult.isValid, false, "错误的行校验失败");
    assert(badResult.errors.some((e) => e.type === "invalid_number"), "包含 invalid_number 错误");
    passed++;

    console.log("\n【接口测试】草稿模式 API 测试\n");

    console.log("6. 测试 POST /api/import/records/preview 预检接口");
    const { res: previewRes, data: previewData } = await api("/api/import/records/preview", {
      method: "POST",
      body: JSON.stringify({ csv: buildCsvWithErrors() }),
    });
    assertEqual(previewRes.status, 200, "响应状态 200");
    assert(previewData.allRowStatuses != null, "返回 allRowStatuses");
    assert(previewData.headers != null, "返回 headers");
    assert(previewData.validRows != null, "返回 validRows");
    passed++;

    console.log("\n7. 测试 POST /api/import/records/draft/create 创建草稿");
    const { res: createRes, data: createData } = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: buildCsvWithErrors(),
        fileName: "test_with_errors.csv",
        farmId: "FARM-DEFAULT",
        operator: "测试用户",
      }),
    });
    assertEqual(createRes.status, 201, "响应状态 201");
    assert(createData.id != null, "返回草稿 ID");
    assert(createData.id.startsWith("DRAFT-"), "草稿 ID 格式正确");
    assertEqual(createData.name != null, true, "返回草稿名称");
    assertEqual(createData.totalRows, 6, "草稿总行数");
    assert(createData.validCount < 6, "有效行数 < 总行数");
    assert(createData.errorCount > 0, "错误行数 > 0");
    assert(Array.isArray(createData.rows), "返回所有行数据");
    assertEqual(createData.rows.length, 6, "rows 包含所有 6 行");
    assertEqual(createData.status, "draft", "草稿状态为 draft");
    const draftId = createData.id;
    passed++;

    console.log("\n8. 测试 GET /api/import/records/draft/list 草稿列表");
    const { res: listRes, data: listData } = await api("/api/import/records/draft/list");
    assertEqual(listRes.status, 200, "响应状态 200");
    assert(Array.isArray(listData), "返回数组");
    assert(listData.some((d) => d.id === draftId), "列表中包含新创建的草稿");
    passed++;

    console.log("\n9. 测试 GET /api/import/records/draft/:id 获取草稿详情");
    const { res: detailRes, data: detailData } = await api(`/api/import/records/draft/${encodeURIComponent(draftId)}`);
    assertEqual(detailRes.status, 200, "响应状态 200");
    assertEqual(detailData.id, draftId, "草稿 ID 正确");
    assertEqual(detailData.rows.length, 6, "草稿包含 6 行");
    passed++;

    console.log("\n10. 测试 PUT /api/import/records/draft/:id/row/:rowNum 单行编辑并重新校验");
    const rowsInDraft = detailData.rows;
    const errorRow = rowsInDraft.find((r) => !r.isValid && r.errors.some((e) => e.type === "batch_not_found"));
    assert(errorRow != null, "找到包含 batch_not_found 错误的行");
    const errorRowNum = errorRow.rowNum;
    const fixedRowData = { ...errorRow.originalRow, batchId: existingBatchId };
    const { res: rowRes, data: rowData } = await api(
      `/api/import/records/draft/${encodeURIComponent(draftId)}/row/${errorRowNum}`,
      {
        method: "PUT",
        body: JSON.stringify({ row: fixedRowData }),
      }
    );
    assertEqual(rowRes.status, 200, "响应状态 200");
    assert(rowData.rowStatus != null, "返回更新后的行状态");
    assert(rowData.validCount != null, "返回新的 validCount");
    assert(rowData.errorCount != null, "返回新的 errorCount");
    if (rowData.rowStatus.errors.every((e) => e.type !== "batch_not_found")) {
      console.log("   ✓ 修正 batch_not_found 后该错误消除");
    }
    passed++;

    console.log("\n11. 测试 POST /api/import/records/draft/:id/revalidate 全部重新校验");
    const { res: revalAllRes, data: revalAllData } = await api(
      `/api/import/records/draft/${encodeURIComponent(draftId)}/revalidate`,
      {
        method: "POST",
      }
    );
    assertEqual(revalAllRes.status, 200, "响应状态 200");
    assertEqual(revalAllData.id, draftId, "返回草稿信息");
    assert(revalAllData.rows.length === 6, "所有行仍存在");
    passed++;

    console.log("\n12. 测试创建全有效行的草稿并确认导入");
    const { res: createValidRes, data: createValidData } = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: buildValidCsv(),
        fileName: "valid_records.csv",
        farmId: "FARM-DEFAULT",
        operator: "测试用户",
      }),
    });
    assertEqual(createValidRes.status, 201, "创建全有效草稿成功");
    assertEqual(createValidData.validCount, 3, "全部 3 行有效");
    assertEqual(createValidData.errorCount, 0, "无错误");
    const validDraftId = createValidData.id;

    const dbBeforeConfirm = await loadDb();
    const recordsBefore = (dbBeforeConfirm.records || []).length;
    const logsBefore = (dbBeforeConfirm.opLogs || []).length;
    const warningsBefore = (dbBeforeConfirm.warnings || []).length;
    const draftsBefore = (dbBeforeConfirm.importDrafts || []).length;

    const { res: confirmRes, data: confirmData } = await api(
      `/api/import/records/draft/${encodeURIComponent(validDraftId)}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试用户" }),
      }
    );
    assertEqual(confirmRes.status, 201, "确认导入成功");
    assertEqual(confirmData.importedCount, 3, "成功导入 3 条记录");
    assert(Array.isArray(confirmData.importedIds), "返回导入的记录 ID 列表");
    assertEqual(confirmData.importedIds.length, 3, "导入 ID 数量正确");

    const dbAfterConfirm = await loadDb();
    assertEqual(dbAfterConfirm.records.length, recordsBefore + 3, "正式记录数量增加 3 条");
    const draftsAfter = dbAfterConfirm.importDrafts.filter((d) => d.id === validDraftId);
    assertEqual(draftsAfter.length, 0, "确认导入后草稿已被删除");
    assert(dbAfterConfirm.importDrafts.length === draftsBefore - 1, "草稿总数减少 1 个");

    const warningsAfter = (dbAfterConfirm.warnings || []).length;
    const newWarnings = warningsAfter - warningsBefore;
    assertEqual(newWarnings, confirmData.warningsGenerated || 0, "预警不重复落库：实际新增预警数与响应一致");
    assert(newWarnings <= 3, "预警数量不超过记录数（不会重复）");

    const newLogs = dbAfterConfirm.opLogs.slice(logsBefore);
    assert(newLogs.length >= 2, "至少产生 2 条操作日志（record_create + import_draft_confirm）");
    const hasCreateLog = newLogs.some((l) => l.action === "record_create");
    const hasConfirmLog = newLogs.some((l) => l.action === "import_draft_confirm");
    assert(hasCreateLog, "存在 record_create 操作日志");
    assert(hasConfirmLog, "存在 import_draft_confirm 操作日志");
    passed++;

    console.log("\n13. 测试放弃草稿（不污染正式数据）");
    const { res: createAbandonRes, data: createAbandonData } = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: buildCsvWithErrors(),
        fileName: "to_be_abandoned.csv",
        farmId: "FARM-DEFAULT",
        operator: "测试用户",
      }),
    });
    const abandonDraftId = createAbandonData.id;
    const dbBeforeAbandon = await loadDb();
    const recordsBeforeAbandon = dbBeforeAbandon.records.length;
    const draftsBeforeAbandon = dbBeforeAbandon.importDrafts.length;

    const { res: abandonRes, data: abandonData } = await api(
      `/api/import/records/draft/${encodeURIComponent(abandonDraftId)}`,
      {
        method: "DELETE",
        body: JSON.stringify({ operator: "测试用户" }),
      }
    );
    assertEqual(abandonRes.status, 200, "放弃草稿成功");
    assertEqual(abandonData.ok, true, "返回 ok 为 true");

    const dbAfterAbandon = await loadDb();
    assertEqual(dbAfterAbandon.records.length, recordsBeforeAbandon, "放弃草稿后正式记录数量不变（无数据污染）");
    const remaining = dbAfterAbandon.importDrafts.filter((d) => d.id === abandonDraftId);
    assertEqual(remaining.length, 0, "草稿已被删除");
    assertEqual(dbAfterAbandon.importDrafts.length, draftsBeforeAbandon - 1, "草稿总数减少 1");

    const abandonLogs = dbAfterAbandon.opLogs.filter((l) => l.action === "import_draft_abandon");
    assert(abandonLogs.length > 0, "存在 import_draft_abandon 操作日志");
    passed++;

    console.log("\n14. 测试无有效行的草稿确认（应拒绝）");
    const emptyValidCsv = parseCsv(buildCsvWithErrors());
    const allErrorRows = emptyValidCsv.rows.map((row) => ({
      ...row,
      batchId: "NONEXISTENT",
    }));
    const onlyErrorCsvText = "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal\n" +
      allErrorRows.map((r) => `NONEXISTENT,${r.date},${r.poolId},${r.temperature},${r.salinity},${r.oxygen},${r.feed},${r.mortality},${r.abnormal}`).join("\n");
    const { res: createEmptyRes, data: createEmptyData } = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({ csv: onlyErrorCsvText, farmId: "FARM-DEFAULT" }),
    });
    const emptyDraftId = createEmptyData.id;
    if (createEmptyData.validCount === 0) {
      const { res: confirmEmptyRes } = await api(
        `/api/import/records/draft/${encodeURIComponent(emptyDraftId)}/confirm`,
        { method: "POST", body: JSON.stringify({ operator: "测试" }) }
      );
      assert(confirmEmptyRes.status >= 400, "无有效行时确认返回错误");
      console.log("   ✓ 无有效行的草稿确认被正确拒绝");
    }
    passed++;

    console.log("\n15. 测试快速模式（非草稿）直接导入");
    const quickUniqueDate1 = `2026-12-11`;
    const quickUniqueDate2 = `2026-12-12`;
    const { res: quickPreviewRes, data: quickPreviewData } = await api("/api/import/records/preview", {
      method: "POST",
      body: JSON.stringify({
        csv:
          "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal\n" +
          `${existingBatchId},${quickUniqueDate1},P-03,26.5,24,6.8,15,0.2,无\n` +
          `${existingBatchId},${quickUniqueDate2},P-03,26.8,24.5,6.5,16,0.3,无`,
      }),
    });
    assertEqual(quickPreviewRes.status, 200, "预检成功");
    if (quickPreviewData.errors && quickPreviewData.errors.length > 0) {
      console.log("   预检错误:", quickPreviewData.errors.slice(0, 3));
    }
    assert(quickPreviewData.validRows.length >= 2, "至少 2 条有效行");
    const quickRows = quickPreviewData.validRows;
    const dbBeforeQuick = await loadDb();
    const quickBeforeCount = dbBeforeQuick.records.length;

    const { res: quickConfirmRes, data: quickConfirmData } = await api("/api/import/records/confirm", {
      method: "POST",
      body: JSON.stringify({ records: quickRows }),
    });
    assertEqual(quickConfirmRes.status, 201, "快速模式导入成功");
    assert(quickConfirmData.importedCount >= 2, "至少导入 2 条记录");

    const dbAfterQuick = await loadDb();
    assert(dbAfterQuick.records.length >= quickBeforeCount + 2, "快速模式记录数量正确增加");
    passed++;

    console.log("\n16. 测试重复日期校验（确认导入时跳过）");
    const { res: dupRes, data: dupData } = await api("/api/import/records/confirm", {
      method: "POST",
      body: JSON.stringify({ records: quickRows }),
    });
    assertEqual(dupRes.status, 201, "重复日期请求仍返回 201");
    assertEqual(dupData.importedCount, 0, "重复日期被跳过（导入数量为 0）");
    assert(dupData.skippedCount >= 2, "跳过数量正确（至少 2 条）");
    passed++;

    console.log("\n17. 测试 GET 不存在草稿返回 404");
    const { res: notFoundRes } = await api("/api/import/records/draft/DRAFT-NONEXISTENT-12345");
    assertEqual(notFoundRes.status, 404, "不存在的草稿返回 404");
    passed++;

    console.log("\n18. 测试删除不存在草稿返回 404");
    const { res: deleteNotFoundRes } = await api("/api/import/records/draft/DRAFT-NONEXISTENT-12345", {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    assertEqual(deleteNotFoundRes.status, 404, "删除不存在的草稿返回 404");
    passed++;

    console.log("\n19. 验证 RECORD_SCHEMA 配置完整");
    assert(Array.isArray(RECORD_SCHEMA.required), "required 字段是数组");
    assert(Array.isArray(RECORD_SCHEMA.optional), "optional 字段是数组");
    assert(Array.isArray(RECORD_SCHEMA.numeric), "numeric 字段是数组");
    assert(typeof RECORD_SCHEMA.fieldLabels === "object", "fieldLabels 是对象");
    RECORD_SCHEMA.required.forEach((f) => {
      assert(RECORD_SCHEMA.fieldLabels[f] != null, `required 字段 ${f} 有 label`);
    });
    passed++;

    console.log("\n20. 验证 RECORD_SCHEMA 字段完整性（与实际导入列一致）");
    const expectedRequired = ["batchId", "date", "temperature", "salinity", "oxygen", "feed", "mortality"];
    expectedRequired.forEach((f) => {
      assert(RECORD_SCHEMA.required.includes(f), `required 包含 ${f}`);
    });
    passed++;

    console.log("\n21. 验证预警不重复落库（草稿确认 + 快速模式）");
    const warningCsv =
      "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal\n" +
      `${existingBatchId},2026-09-01,P-01,36,24,2,15,5,浮头\n` +
      `${existingBatchId},2026-09-02,P-01,37,25,1.5,16,6,死苗\n` +
      `${existingBatchId},2026-09-03,P-01,26.5,24,6.8,15,0.2,无`;
    const { res: createWarnRes, data: createWarnData } = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: warningCsv,
        fileName: "warning_test.csv",
        farmId: "FARM-DEFAULT",
        operator: "测试用户",
      }),
    });
    assertEqual(createWarnRes.status, 201, "创建预警测试草稿成功");
    const warnDraftId = createWarnData.id;

    const dbBeforeWarn = await loadDb();
    const warningsBeforeCount = (dbBeforeWarn.warnings || []).length;

    const { res: confirmWarnRes, data: confirmWarnData } = await api(
      `/api/import/records/draft/${encodeURIComponent(warnDraftId)}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试用户" }),
      }
    );
    assertEqual(confirmWarnRes.status, 201, "预警草稿确认成功");
    assert(confirmWarnData.warningsGenerated >= 2, "至少生成 2 条预警（前 2 条超限）");

    const dbAfterWarn = await loadDb();
    const warningsAfterCount = (dbAfterWarn.warnings || []).length;
    const newWarningCount = warningsAfterCount - warningsBeforeCount;
    assertEqual(newWarningCount, confirmWarnData.warningsGenerated, "草稿确认：实际新增预警数与响应一致，无重复落库");

    const quickWarnRows = [
      { batchId: existingBatchId, date: "2026-09-10", poolId: "P-01", temperature: 36.5, salinity: 24, oxygen: 1.8, feed: 15, mortality: 4, abnormal: "浮头" },
      { batchId: existingBatchId, date: "2026-09-11", poolId: "P-01", temperature: 27, salinity: 25, oxygen: 6.5, feed: 16, mortality: 0.3, abnormal: "无" },
    ];
    const warningsBeforeQuick = (await loadDb()).warnings?.length || 0;
    const { res: quickWarnRes, data: quickWarnData } = await api("/api/import/records/confirm", {
      method: "POST",
      body: JSON.stringify({ records: quickWarnRows, operator: "测试用户" }),
    });
    assertEqual(quickWarnRes.status, 201, "快速模式导入成功");
    const warningsAfterQuick = (await loadDb()).warnings?.length || 0;
    const quickNewWarnings = warningsAfterQuick - warningsBeforeQuick;
    assertEqual(quickNewWarnings, quickWarnData.warningsGenerated, "快速模式：实际新增预警数与响应一致，无重复落库");
    passed++;

    console.log("\n=== 测试完成 ===");
    console.log(`通过: ${passed} / ${passed + failed}`);
    console.log(`失败: ${failed}`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    failed++;
    console.error("\n✗ 测试失败:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    console.log("\n【清理】停止测试服务器...");
    await stopTestServer();
    console.log("   ✓ 测试服务器已停止");
    console.log("【清理】删除测试数据库...");
    await cleanupTestDb();
    console.log("   ✓ 测试数据库已清理");
    console.log("\n=== 所有资源已清理 ===");
  }
}

test();
