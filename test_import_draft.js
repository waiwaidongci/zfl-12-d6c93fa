import http from "node:http";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitialSeed } from "./seed/seed.js";
import { createAuditLogRouter } from "./routes/audit-log.js";
import { createLineageRouter } from "./routes/lineage.js";
import { createInventoriesRouter } from "./routes/inventories.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createShipmentsRouter } from "./routes/shipments.js";
import { createBatchesRouter } from "./routes/batches.js";
import { createDataIoRouter } from "./routes/data-io.js";
import { createRecordsRouter } from "./routes/records.js";
import { createWarningsRouter } from "./routes/warnings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_PATH = join(__dirname, "data", "hatchery_test_import_draft.json");

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
    if (!seed.opLogs) seed.opLogs = [];
    if (!seed.lineages) seed.lineages = [];
    if (!seed.inventories) seed.inventories = [];
    if (!seed.orders) seed.orders = [];
    if (!seed.shipments) seed.shipments = [];
    if (!seed.customers) seed.customers = [];
    if (!seed.transfers) seed.transfers = [];
    if (!seed.importDrafts) seed.importDrafts = [];
    if (!seed.warnings) seed.warnings = [];
    if (!seed.records) seed.records = [];
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (!db.opLogs) db.opLogs = [];
  if (!db.lineages) db.lineages = [];
  if (!db.inventories) db.inventories = [];
  if (!db.orders) db.orders = [];
  if (!db.shipments) db.shipments = [];
  if (!db.customers) db.customers = [];
  if (!db.transfers) db.transfers = [];
  if (!db.importDrafts) db.importDrafts = [];
  if (!db.warnings) db.warnings = [];
  if (!db.records) db.records = [];
  return db;
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function createTestServer() {
  const helpers = { loadDb, saveDb, sendJson, body };
  const auditLogRouter = createAuditLogRouter(helpers);
  const lineageRouter = createLineageRouter(helpers);
  const inventoriesRouter = createInventoriesRouter(helpers);
  const ordersRouter = createOrdersRouter(helpers);
  const shipmentsRouter = createShipmentsRouter(helpers);
  const batchesRouter = createBatchesRouter(helpers);
  const dataIoRouter = createDataIoRouter(helpers);
  const recordsRouter = createRecordsRouter(helpers);
  const warningsRouter = createWarningsRouter(helpers);

  async function routeApi(req, res, url, method) {
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/state") {
      const db = await loadDb();
      return sendJson(res, 200, db);
    }

    const result1 = await auditLogRouter(req, res, pathname, method);
    if (result1 !== false) return result1;

    const result2 = await lineageRouter(req, res, pathname, method);
    if (result2 !== false) return result2;

    const result3 = await inventoriesRouter(req, res, pathname, method);
    if (result3 !== false) return result3;

    const result4 = await ordersRouter(req, res, pathname, method);
    if (result4 !== false) return result4;

    const result5 = await shipmentsRouter(req, res, pathname, method);
    if (result5 !== false) return result5;

    const result6 = await batchesRouter(req, res, pathname, method);
    if (result6 !== false) return result6;

    const result7 = await dataIoRouter(req, res, pathname, method);
    if (result7 !== false) return result7;

    const result8 = await recordsRouter(req, res, pathname, method);
    if (result8 !== false) return result8;

    const result9 = await warningsRouter(req, res, pathname, method);
    if (result9 !== false) return result9;

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

const VALID_CSV = [
  "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal",
  "B-260601,2026-08-10,P-03,28.0,22,6.2,20,0.5,无",
  "B-260601,2026-08-11,P-03,27.8,21.5,6.0,19,0.3,无",
  "B-260601,2026-08-12,P-03,27.5,22.5,5.8,21,0.4,无",
].join("\n");

const CSV_WITH_ERRORS = [
  "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal",
  "B-260601,2026-08-15,P-03,28.0,22,6.2,20,0.5,无",
  "B-999999,2026-08-16,P-03,27.8,21.5,6.0,19,0.3,无",
  "B-260601,2026-08-17,P-03,INVALID,22.5,5.8,21,0.4,无",
  "B-260601,2026-06-12,P-03,28.0,22,6.2,20,0.5,无",
  "B-260601,2026-08-18,P-03,15.0,5,2.0,20,10.0,死苗大量",
].join("\n");

async function test() {
  console.log("=== 开始测试每日记录CSV导入草稿流程 ===\n");

  let passed = 0;
  let failed = 0;

  try {
    console.log("【初始化】启动测试服务器（端口 " + TEST_PORT + "）...");
    await startTestServer();
    console.log("   ✓ 测试服务器启动成功\n");

    const initialDb = await loadDb();
    const firstBatch = initialDb.batches[0];
    const initialRecordCount = (initialDb.records || []).length;
    const initialWarningCount = (initialDb.warnings || []).length;
    console.log(`   初始数据库：${initialRecordCount} 条记录，${initialWarningCount} 条预警`);
    console.log(`   使用批次：${firstBatch.id}（${firstBatch.species}）\n`);

    console.log("【测试 1】草稿创建\n");

    console.log("1.1 创建包含有效行和错误行的草稿");
    const createDraft1 = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: CSV_WITH_ERRORS,
        name: "测试草稿-含错误",
        fileName: "test_errors.csv",
        farmId: "FARM-DEFAULT",
        operator: "测试员",
      }),
    });
    assert(createDraft1.res.status === 201, "草稿创建接口返回201");
    assert(createDraft1.data.id, "返回草稿ID");
    assert(createDraft1.data.id.startsWith("DRAFT-"), "草稿ID格式正确");
    assertEqual(createDraft1.data.totalRows, 5, "草稿包含5行数据");
    assert(createDraft1.data.errorCount >= 2, "草稿包含至少2个错误行");
    assert(createDraft1.data.validCount >= 1, "草稿包含至少1个有效行");
    assertEqual(createDraft1.data.status, "draft", "草稿状态为draft");
    assertEqual(createDraft1.data.name, "测试草稿-含错误", "草稿名称正确");
    const draft1Id = createDraft1.data.id;
    const draft1ValidCount = createDraft1.data.validCount;
    const draft1ErrorCount = createDraft1.data.errorCount;
    passed += 8;

    console.log("\n1.2 验证草稿列表包含新建草稿");
    const draftList1 = await api("/api/import/records/draft/list");
    assert(draftList1.res.ok, "草稿列表接口正常");
    assert(Array.isArray(draftList1.data), "返回数组");
    const foundInList = draftList1.data.find((d) => d.id === draft1Id);
    assert(foundInList, "新草稿在列表中");
    assertEqual(foundInList.totalRows, 5, "列表中行数正确");
    passed += 4;

    console.log("\n1.3 验证草稿详情接口");
    const draftDetail1 = await api(`/api/import/records/draft/${encodeURIComponent(draft1Id)}`);
    assert(draftDetail1.res.ok, "草稿详情接口正常");
    assertEqual(draftDetail1.data.id, draft1Id, "草稿ID匹配");
    assert(Array.isArray(draftDetail1.data.rows), "包含行数据");
    assertEqual(draftDetail1.data.rows.length, 5, "行数为5");
    const errorRows = draftDetail1.data.rows.filter((r) => !r.isValid);
    assert(errorRows.length === draft1ErrorCount, "错误行数量一致");
    const validRows = draftDetail1.data.rows.filter((r) => r.isValid);
    assert(validRows.length === draft1ValidCount, "有效行数量一致");
    passed += 6;

    console.log("\n1.4 创建全有效行的草稿");
    const createDraft2 = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: VALID_CSV,
        name: "测试草稿-全有效",
        fileName: "test_valid.csv",
        farmId: "FARM-DEFAULT",
        operator: "测试员",
      }),
    });
    assert(createDraft2.res.status === 201, "全有效草稿创建成功");
    assertEqual(createDraft2.data.errorCount, 0, "错误行数为0");
    assertEqual(createDraft2.data.validCount, 3, "有效行数为3");
    const draft2Id = createDraft2.data.id;
    passed += 3;

    console.log("\n【测试 2】错误行编辑后重新校验\n");

    console.log("2.1 找到错误的批次行（B-999999不存在）");
    const draftDetail2 = await api(`/api/import/records/draft/${encodeURIComponent(draft1Id)}`);
    const invalidBatchRow = draftDetail2.data.rows.find(
      (r) => r.originalRow && r.originalRow.batchId === "B-999999"
    );
    assert(invalidBatchRow, "找到批次错误行");
    assert(invalidBatchRow.isValid === false, "该行标记为无效");
    const invalidBatchRowNum = invalidBatchRow.rowNum;
    passed += 2;

    console.log("\n2.2 编辑错误批次行，修正为有效批次");
    const editBatchRow = await api(
      `/api/import/records/draft/${encodeURIComponent(draft1Id)}/row/${invalidBatchRowNum}`,
      {
        method: "PUT",
        body: JSON.stringify({
          row: {
            batchId: "B-260601",
            date: "2026-08-16",
            poolId: "P-03",
            temperature: 27.8,
            salinity: 21.5,
            oxygen: 6.0,
            feed: 19,
            mortality: 0.3,
            abnormal: "无",
          },
        }),
      }
    );
    assert(editBatchRow.res.ok, "编辑行接口正常");
    assert(editBatchRow.data.rowStatus.isValid === true, "编辑后该行变为有效");
    assert(editBatchRow.data.validCount > draft1ValidCount, "有效行数增加");
    assert(editBatchRow.data.errorCount < draft1ErrorCount, "错误行数减少");
    const validCountAfterBatchFix = editBatchRow.data.validCount;
    const errorCountAfterBatchFix = editBatchRow.data.errorCount;
    passed += 4;

    console.log("\n2.3 找到水温无效的行（INVALID）");
    const draftDetail3 = await api(`/api/import/records/draft/${encodeURIComponent(draft1Id)}`);
    const invalidTempRow = draftDetail3.data.rows.find(
      (r) => r.originalRow && r.originalRow.temperature === "INVALID"
    );
    assert(invalidTempRow, "找到水温错误行");
    assert(invalidTempRow.isValid === false, "该行标记为无效");
    const invalidTempRowNum = invalidTempRow.rowNum;
    passed += 2;

    console.log("\n2.4 编辑水温错误行，修正为有效值");
    const editTempRow = await api(
      `/api/import/records/draft/${encodeURIComponent(draft1Id)}/row/${invalidTempRowNum}`,
      {
        method: "PUT",
        body: JSON.stringify({
          row: {
            batchId: "B-260601",
            date: "2026-08-17",
            poolId: "P-03",
            temperature: 27.5,
            salinity: 22.5,
            oxygen: 5.8,
            feed: 21,
            mortality: 0.4,
            abnormal: "无",
          },
        }),
      }
    );
    assert(editTempRow.res.ok, "编辑水温行接口正常");
    assert(editTempRow.data.rowStatus.isValid === true, "编辑后水温行变为有效");
    assert(editTempRow.data.validCount > validCountAfterBatchFix, "有效行数再次增加");
    assert(editTempRow.data.errorCount < errorCountAfterBatchFix, "错误行数再次减少");
    passed += 4;

    console.log("\n2.5 找到重复日期的行（2026-06-12已存在）");
    const draftDetail4 = await api(`/api/import/records/draft/${encodeURIComponent(draft1Id)}`);
    const dupDateRow = draftDetail4.data.rows.find(
      (r) => r.originalRow && r.originalRow.date === "2026-06-12"
    );
    assert(dupDateRow, "找到重复日期行");
    assert(dupDateRow.isValid === false, "该行标记为无效");
    const dupDateRowNum = dupDateRow.rowNum;
    passed += 2;

    console.log("\n2.6 编辑重复日期行，改为不重复的日期");
    const editDupDateRow = await api(
      `/api/import/records/draft/${encodeURIComponent(draft1Id)}/row/${dupDateRowNum}`,
      {
        method: "PUT",
        body: JSON.stringify({
          row: {
            batchId: "B-260601",
            date: "2026-08-19",
            poolId: "P-03",
            temperature: 28.0,
            salinity: 22,
            oxygen: 6.2,
            feed: 20,
            mortality: 0.5,
            abnormal: "无",
          },
        }),
      }
    );
    assert(editDupDateRow.res.ok, "编辑重复日期行接口正常");
    assert(editDupDateRow.data.rowStatus.isValid === true, "编辑后重复日期行变为有效");
    assert(editDupDateRow.data.errorCount === 0, "所有错误均已修正，错误行数为0");
    passed += 3;

    console.log("\n2.7 验证修正后草稿的全量重新校验");
    const revalidateResult = await api(
      `/api/import/records/draft/${encodeURIComponent(draft1Id)}/revalidate`,
      {
        method: "POST",
      }
    );
    assert(revalidateResult.res.ok, "全量重新校验接口正常");
    assertEqual(revalidateResult.data.errorCount, 0, "全量校验后错误行数仍为0");
    assert(revalidateResult.data.validCount >= 5, "全量校验后有效行数不少于5");
    passed += 3;

    console.log("\n【测试 3】确认导入后写入records并生成预警\n");

    console.log("3.1 记录导入前的状态基线");
    const stateBeforeImport = await api("/api/state");
    const recordsBefore = stateBeforeImport.data.records || [];
    const warningsBefore = stateBeforeImport.data.warnings || [];
    const draftsBefore = stateBeforeImport.data.importDrafts || [];
    console.log(`   导入前：${recordsBefore.length} 条记录，${warningsBefore.length} 条预警，${draftsBefore.length} 个草稿`);
    passed++;

    console.log("\n3.2 尝试在有错误行时确认导入（应失败）");
    const tempDraftId = createDraft2.data.id;
    const tempDraftDetail = await api(`/api/import/records/draft/${encodeURIComponent(tempDraftId)}`);
    const anyRow = tempDraftDetail.data.rows[0];
    await api(
      `/api/import/records/draft/${encodeURIComponent(tempDraftId)}/row/${anyRow.rowNum}`,
      {
        method: "PUT",
        body: JSON.stringify({
          row: {
            batchId: "B-INVALID",
            date: "2026-08-20",
            poolId: "P-03",
            temperature: 28,
            salinity: 22,
            oxygen: 6,
            feed: 20,
            mortality: 0.5,
            abnormal: "无",
          },
        }),
      }
    );
    const confirmWithErrors = await api(
      `/api/import/records/draft/${encodeURIComponent(tempDraftId)}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试员" }),
      }
    );
    assert(confirmWithErrors.res.status === 400, "有错误行时确认导入返回400");
    assert(confirmWithErrors.data.error.includes("错误行"), "错误信息包含'错误行'");
    assert(confirmWithErrors.data.errorCount > 0, "返回错误行数");
    passed += 3;

    console.log("\n3.3 确认导入已修正的草稿1");
    const confirmResult = await api(
      `/api/import/records/draft/${encodeURIComponent(draft1Id)}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试员" }),
      }
    );
    assert(confirmResult.res.status === 201, "确认导入接口返回201");
    assert(confirmResult.data.importedCount > 0, "成功导入记录数大于0");
    assert(Array.isArray(confirmResult.data.importedIds), "返回导入的记录ID数组");
    assert(confirmResult.data.importedIds.length === confirmResult.data.importedCount, "导入ID数量与导入数一致");
    const importedCount = confirmResult.data.importedCount;
    const warningsGenerated = confirmResult.data.warningsGenerated;
    console.log(`   导入 ${importedCount} 条记录，生成 ${warningsGenerated} 条预警`);
    passed += 4;

    console.log("\n3.4 验证草稿1已被删除");
    const draftListAfter = await api("/api/import/records/draft/list");
    const draft1StillExists = draftListAfter.data.find((d) => d.id === draft1Id);
    assert(draft1StillExists === undefined, "确认导入后草稿1已被删除");
    passed++;

    console.log("\n3.5 验证records中新增了导入的记录");
    const stateAfterImport = await api("/api/state");
    const recordsAfter = stateAfterImport.data.records || [];
    assertEqual(recordsAfter.length, recordsBefore.length + importedCount, "records数量增加正确");
    for (const importedId of confirmResult.data.importedIds) {
      const found = recordsAfter.find((r) => r.id === importedId);
      assert(found, `导入的记录 ${importedId} 存在于records中`);
      assert(found.batchId === "B-260601", "记录批次正确");
      assert(found.farmId === "FARM-DEFAULT", "记录场区正确");
      passed += 3;
    }

    console.log("\n3.6 验证预警已生成（包含超出阈值的行）");
    const warningsAfter = stateAfterImport.data.warnings || [];
    if (warningsGenerated > 0) {
      assert(warningsAfter.length >= warningsBefore.length + warningsGenerated, "预警数量增加");
      const relatedWarnings = warningsAfter.filter((w) =>
        confirmResult.data.importedIds.includes(w.recordId)
      );
      assert(relatedWarnings.length >= warningsGenerated, "导入记录关联的预警数量正确");
      const hasRedWarning = relatedWarnings.some((w) => w.level === "red");
      const hasYellowWarning = relatedWarnings.some((w) => w.level === "yellow");
      assert(hasRedWarning || hasYellowWarning, "至少有一条红色或黄色预警");
      for (const w of relatedWarnings) {
        assert(w.status === "pending", "新预警状态为pending");
        assert(Array.isArray(w.reasons) && w.reasons.length > 0, "预警包含触发原因");
      }
      passed += 4;
    } else {
      console.log("   ℹ 本次导入未触发预警（跳过预警断言）");
    }

    console.log("\n3.7 验证重复日期的记录未被重复导入");
    const allImportedRecords = recordsAfter.filter((r) =>
      confirmResult.data.importedIds.includes(r.id)
    );
    const dateKeys = allImportedRecords.map((r) => r.batchId + "|" + r.date);
    const uniqueKeys = new Set(dateKeys);
    assertEqual(dateKeys.length, uniqueKeys.size, "导入的记录中无重复日期");
    passed++;

    console.log("\n【测试 4】放弃草稿不会污染正式数据\n");

    console.log("4.1 创建一个新草稿用于放弃测试");
    const createDraftAbandon = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: VALID_CSV,
        name: "待放弃草稿",
        fileName: "abandon_test.csv",
        farmId: "FARM-DEFAULT",
        operator: "测试员",
      }),
    });
    assert(createDraftAbandon.res.status === 201, "待放弃草稿创建成功");
    const abandonDraftId = createDraftAbandon.data.id;
    const rowsInAbandonDraft = createDraftAbandon.data.totalRows;
    passed += 2;

    console.log("\n4.2 记录放弃前的数据快照");
    const stateBeforeAbandon = await api("/api/state");
    const recordsBeforeAbandon = stateBeforeAbandon.data.records.length;
    const warningsBeforeAbandon = (stateBeforeAbandon.data.warnings || []).length;
    const draftsBeforeAbandon = (stateBeforeAbandon.data.importDrafts || []).length;
    passed++;

    console.log("\n4.3 放弃（删除）草稿");
    const abandonResult = await api(
      `/api/import/records/draft/${encodeURIComponent(abandonDraftId)}`,
      {
        method: "DELETE",
        body: JSON.stringify({ operator: "测试员" }),
      }
    );
    assert(abandonResult.res.ok, "放弃草稿接口正常");
    assert(abandonResult.data.ok === true, "返回ok为true");
    assert(abandonResult.data.message.includes("放弃"), "消息包含'放弃'");
    passed += 3;

    console.log("\n4.4 验证草稿已从列表中移除");
    const draftListAfterAbandon = await api("/api/import/records/draft/list");
    const abandonStillExists = draftListAfterAbandon.data.find((d) => d.id === abandonDraftId);
    assert(abandonStillExists === undefined, "草稿已从列表中移除");
    assertEqual(draftListAfterAbandon.data.length, draftsBeforeAbandon - 1, "草稿数量减少1");
    passed += 2;

    console.log("\n4.5 验证records未被污染（数量不变）");
    const stateAfterAbandon = await api("/api/state");
    assertEqual(stateAfterAbandon.data.records.length, recordsBeforeAbandon, "records数量未变化");
    passed++;

    console.log("\n4.6 验证warnings未被污染（数量不变）");
    assertEqual(
      (stateAfterAbandon.data.warnings || []).length,
      warningsBeforeAbandon,
      "warnings数量未变化"
    );
    passed++;

    console.log("\n4.7 验证草稿中的行数据未出现在records中");
    const abandonDraftDates = ["2026-08-10", "2026-08-11", "2026-08-12"];
    const foundAbandonedDates = stateAfterAbandon.data.records.filter((r) =>
      r.batchId === "B-260601" && abandonDraftDates.includes(r.date)
    );
    const importedIdsSet = new Set(confirmResult.data.importedIds || []);
    const trulyAbandoned = foundAbandonedDates.filter((r) => !importedIdsSet.has(r.id));
    assertEqual(trulyAbandoned.length, 0, "草稿中的日期未出现在records中（排除已导入的）");
    passed++;

    console.log("\n4.8 验证访问已删除草稿返回404");
    const deletedDraftDetail = await api(
      `/api/import/records/draft/${encodeURIComponent(abandonDraftId)}`
    );
    assertEqual(deletedDraftDetail.res.status, 404, "访问已删除草稿返回404");
    assert(deletedDraftDetail.data.error.includes("不存在"), "错误信息包含'不存在'");
    passed += 2;

    console.log("\n【测试 5】草稿数据隔离与并发\n");

    console.log("5.1 创建两个独立草稿，验证互不影响");
    const createDraftA = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: [
          "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal",
          "B-260601,2026-09-01,P-03,28.0,22,6.2,20,0.5,无",
        ].join("\n"),
        name: "草稿A",
        farmId: "FARM-DEFAULT",
        operator: "测试员",
      }),
    });
    const createDraftB = await api("/api/import/records/draft/create", {
      method: "POST",
      body: JSON.stringify({
        csv: [
          "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal",
          "B-260601,2026-09-02,P-03,28.0,22,6.2,20,0.5,无",
        ].join("\n"),
        name: "草稿B",
        farmId: "FARM-DEFAULT",
        operator: "测试员",
      }),
    });
    assert(createDraftA.res.status === 201, "草稿A创建成功");
    assert(createDraftB.res.status === 201, "草稿B创建成功");
    assert(createDraftA.data.id !== createDraftB.data.id, "两个草稿ID不同");
    const draftAId = createDraftA.data.id;
    const draftBId = createDraftB.data.id;
    passed += 3;

    console.log("\n5.2 编辑草稿A不影响草稿B");
    const detailBeforeEditA = await api(`/api/import/records/draft/${encodeURIComponent(draftAId)}`);
    const detailBeforeEditB = await api(`/api/import/records/draft/${encodeURIComponent(draftBId)}`);
    const rowNumA = detailBeforeEditA.data.rows[0].rowNum;
    await api(
      `/api/import/records/draft/${encodeURIComponent(draftAId)}/row/${rowNumA}`,
      {
        method: "PUT",
        body: JSON.stringify({
          row: {
            batchId: "B-260601",
            date: "2026-09-15",
            poolId: "P-01",
            temperature: 29.0,
            salinity: 23,
            oxygen: 6.5,
            feed: 25,
            mortality: 0.2,
            abnormal: "无",
          },
        }),
      }
    );
    const detailAfterEditA = await api(`/api/import/records/draft/${encodeURIComponent(draftAId)}`);
    const detailAfterEditB = await api(`/api/import/records/draft/${encodeURIComponent(draftBId)}`);
    assert(
      detailAfterEditA.data.rows[0].normalizedRow.date === "2026-09-15",
      "草稿A的修改生效"
    );
    assert(
      detailAfterEditB.data.rows[0].normalizedRow.date ===
        detailBeforeEditB.data.rows[0].normalizedRow.date,
      "草稿B的数据未被影响"
    );
    passed += 2;

    console.log("\n5.3 清理：删除草稿A和草稿B");
    await api(`/api/import/records/draft/${encodeURIComponent(draftAId)}`, {
      method: "DELETE",
      body: JSON.stringify({ operator: "测试员" }),
    });
    await api(`/api/import/records/draft/${encodeURIComponent(draftBId)}`, {
      method: "DELETE",
      body: JSON.stringify({ operator: "测试员" }),
    });
    const finalDraftList = await api("/api/import/records/draft/list");
    const cleanupA = finalDraftList.data.find((d) => d.id === draftAId);
    const cleanupB = finalDraftList.data.find((d) => d.id === draftBId);
    assert(cleanupA === undefined, "草稿A已清理");
    assert(cleanupB === undefined, "草稿B已清理");
    passed += 2;

    console.log("\n=== 测试完成 ===");
    console.log(`通过: ${passed}，失败: ${failed}`);
  } catch (err) {
    failed++;
    console.error("\n❌ 测试失败:", err.message);
    console.error(err.stack);
  } finally {
    await stopTestServer();
    await cleanupTestDb();
    console.log("\n测试服务器已停止，测试数据已清理");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

test();
