import http from "node:http";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitialSeed } from "./seed/seed.js";
import { beginTxn, writeLogToTxn, commitTxn, canRollbackTxn } from "./utils/audit-log.js";
import { createAuditLogRouter } from "./routes/audit-log.js";
import { createLineageRouter } from "./routes/lineage.js";
import { createInventoriesRouter } from "./routes/inventories.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createShipmentsRouter } from "./routes/shipments.js";
import { createBatchesRouter } from "./routes/batches.js";
import { createDataIoRouter } from "./routes/data-io.js";
import { createRecordsRouter } from "./routes/records.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3098;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_PATH = join(__dirname, "data", "hatchery_test_txn.json");

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

async function test() {
  console.log("=== 开始测试事务日志与回滚功能 ===\n");

  let passed = 0;
  let failed = 0;

  try {
    console.log("【初始化】启动测试服务器（端口 " + TEST_PORT + "）...");
    await startTestServer();
    console.log("   ✓ 测试服务器启动成功\n");

    const initialDb = await loadDb();
    const firstBatch = initialDb.batches[0];
    const secondBatch = initialDb.batches[1] || initialDb.batches[0];
    console.log(`   初始数据库：${initialDb.batches.length} 个批次`);
    console.log(`   第一批：${firstBatch.id}，数量：${firstBatch.estimatedCount}`);
    if (secondBatch && secondBatch.id !== firstBatch.id) {
      console.log(`   第二批：${secondBatch.id}，数量：${secondBatch.estimatedCount}`);
    }
    console.log();

    console.log("【测试 1】事务 API - 列表与详情\n");

    console.log("1.1 测试空事务列表");
    const txnListEmpty = await api("/api/audit-transactions");
    assert(txnListEmpty.res.ok, "事务列表接口响应正常");
    assert(Array.isArray(txnListEmpty.data.items), "返回 items 数组");
    passed++;

    console.log("\n【测试 2】血缘操作事务\n");

    console.log("2.1 创建血缘关系（分池流转）");
    const transferQty = Math.floor(firstBatch.estimatedCount / 3);
    const lineageData = {
      type: "mix",
      date: "2026-08-15",
      sources: [
        {
          batchId: firstBatch.id,
          contributionCount: transferQty,
        },
      ],
      targets: [
        {
          batchId: firstBatch.id,
          receivedCount: transferQty,
          toPool: "P-02",
        },
      ],
      reason: "测试分池流转",
      operator: "测试员",
    };
    const lineageCreate = await api("/api/lineage", {
      method: "POST",
      body: JSON.stringify(lineageData),
    });
    assert(lineageCreate.res.ok, "创建血缘成功");
    assert(lineageCreate.data.id, "返回血缘ID");
    passed++;

    console.log("2.2 验证创建血缘生成事务日志");
    const logsAfterCreate = await api("/api/audit-logs?pageSize=10");
    const lineageLogs = logsAfterCreate.data.items.filter(
      (l) => l.action === "lineage_create" || l.action === "batch_update"
    );
    assert(lineageLogs.length >= 2, "至少生成2条日志（血缘+批次更新）");
    const txnId = lineageLogs[0].txnId;
    assert(txnId, "日志包含事务ID");
    const allSameTxn = lineageLogs.every((l) => l.txnId === txnId);
    assert(allSameTxn, "所有相关日志属于同一事务");
    passed++;

    console.log("2.3 验证事务列表包含新事务");
    const txnList = await api("/api/audit-transactions?pageSize=10");
    const txnItem = txnList.data.items.find((t) => t.txnId === txnId);
    assert(txnItem, "事务列表包含新事务");
    assert(txnItem.isTransaction === true, "标记为事务");
    assert(txnItem.totalEntries >= 2, "事务包含多条变更");
    assert(txnItem.affectedCollections, "包含影响集合信息");
    passed++;

    console.log("2.4 验证事务详情接口");
    const txnDetail = await api("/api/audit-transactions/" + encodeURIComponent(txnId));
    assert(txnDetail.res.ok, "事务详情接口响应正常");
    assertEqual(txnDetail.data.txnId, txnId, "事务ID匹配");
    assert(Array.isArray(txnDetail.data.logs), "包含日志列表");
    assert(txnDetail.data.logs.length >= 2, "包含至少2条日志");
    assert(txnDetail.data.affectedCollections, "包含影响集合");
    assert(Array.isArray(txnDetail.data.affectedBatchIds), "包含影响批次ID");
    assert(txnDetail.data.affectedBatchCount >= 1, "影响至少1个批次");
    passed++;

    console.log("2.5 验证事务可回滚");
    assert(txnDetail.data.rollbackable === true, "事务可回滚");
    passed++;

    console.log("2.6 执行事务回滚");
    const rollbackResult = await api(
      `/api/audit-transactions/${encodeURIComponent(txnId)}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试回滚员" }),
      }
    );
    assert(rollbackResult.res.ok, "事务回滚成功");
    assert(rollbackResult.data.success === true, "回滚结果成功");
    passed++;

    console.log("2.7 验证回滚后血缘记录被删除");
    const stateAfterRollback = await api("/api/state");
    const lineagesAfter = stateAfterRollback.data.lineages || [];
    const lineageStillExists = lineagesAfter.some((l) => l.id === lineageCreate.data.id);
    assert(lineageStillExists === false, "回滚后血缘记录被删除");
    passed++;

    console.log("2.8 验证回滚后事务不可再次回滚");
    const txnAfterRollback = await api("/api/audit-transactions/" + encodeURIComponent(txnId));
    assert(txnAfterRollback.data.rollbackable === false, "回滚后不可再次回滚");
    passed++;

    console.log("\n【测试 3】盘点操作事务\n");

    console.log("3.1 创建盘点记录");
    const inventoryData = {
      batchId: firstBatch.id,
      date: "2026-08-15",
      method: "sampling",
      manualEstimate: Math.floor(firstBatch.estimatedCount * 0.95),
      actualCount: Math.floor(firstBatch.estimatedCount * 0.9),
      note: "测试盘点",
      operator: "测试员",
    };
    const inventoryCreate = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify(inventoryData),
    });
    assert(inventoryCreate.res.ok, "创建盘点成功");
    assert(inventoryCreate.data.id, "返回盘点ID");
    passed++;

    console.log("3.2 验证盘点生成事务日志");
    const inventoryLogs = await api("/api/audit-logs?pageSize=10");
    const invLog = inventoryLogs.data.items.find((l) => l.action === "inventory_create");
    const invTxnId = invLog?.txnId;
    assert(invTxnId, "盘点日志包含事务ID");
    const txnLogs = inventoryLogs.data.items.filter((l) => l.txnId === invTxnId);
    assert(txnLogs.length >= 2, "同一事务包含至少2条日志");
    passed++;

    console.log("3.3 验证盘点事务回滚");
    const invRollback = await api(
      `/api/audit-transactions/${encodeURIComponent(invTxnId)}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试回滚员" }),
      }
    );
    assert(invRollback.res.ok, "盘点事务回滚成功");
    const stateAfterInvRollback = await api("/api/state");
    const batchAfterInvRollback = stateAfterInvRollback.data.batches.find(
      (b) => b.id === firstBatch.id
    );
    assertEqual(
      batchAfterInvRollback.estimatedCount,
      firstBatch.estimatedCount,
      "批次数量回滚到初始值"
    );
    passed++;

    console.log("\n【测试 4】订单操作事务\n");

    console.log("4.1 创建客户");
    const customerData = { name: "测试客户", phone: "13800138000" };
    // 直接创建客户到db
    const dbBeforeOrder = await loadDb();
    if (!dbBeforeOrder.customers || dbBeforeOrder.customers.length === 0) {
      dbBeforeOrder.customers = [{ id: "CUST-TEST", name: "测试客户", phone: "13800138000" }];
      await saveDb(dbBeforeOrder);
    }
    const customerId = (await loadDb()).customers[0].id;
    console.log(`   使用客户：${customerId}`);

    console.log("4.2 创建订单");
    const orderQty = Math.min(100, Math.floor(firstBatch.estimatedCount / 2));
    const orderData = {
      batchId: firstBatch.id,
      customerId,
      orderQuantity: orderQty,
      unitPrice: 5,
      orderDate: "2026-08-16",
      deliveryDate: "2026-08-20",
      operator: "测试员",
    };
    const orderCreate = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(orderData),
    });
    assert(orderCreate.res.ok, "创建订单成功");
    assert(orderCreate.data.id, "返回订单ID");
    passed++;

    console.log("4.3 验证订单生成事务日志");
    const orderLogs = await api("/api/audit-logs?pageSize=5");
    const orderLog = orderLogs.data.items.find((l) => l.action === "order_create");
    assert(orderLog, "找到订单创建日志");
    assert(orderLog.txnId, "订单日志包含事务ID");
    passed++;

    console.log("4.4 验证订单事务回滚");
    const orderTxnId = orderLog.txnId;
    const orderRollback = await api(
      `/api/audit-transactions/${encodeURIComponent(orderTxnId)}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试回滚员" }),
      }
    );
    assert(orderRollback.res.ok, "订单事务回滚成功");
    const stateAfterOrderRollback = await api("/api/state");
    const ordersAfterRollback = stateAfterOrderRollback.data.orders || [];
    const orderStillExists = ordersAfterRollback.some((o) => o.id === orderCreate.data.id);
    assert(orderStillExists === false, "回滚后订单被删除");
    passed++;

    console.log("\n【测试 5】旧日志兼容性\n");

    console.log("5.1 直接写入一条无事务ID的旧日志");
    const db5 = await loadDb();
    db5.opLogs.push({
      id: "LOG-OLD-TEST-001",
      operator: "旧系统",
      action: "record_create",
      targetType: "record",
      targetId: "REC-OLD-001",
      before: null,
      after: { id: "REC-OLD-001", batchId: firstBatch.id },
      farmId: firstBatch.farmId || "",
      meta: null,
      rolledBack: false,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    });
    await saveDb(db5);
    passed++;

    console.log("5.2 验证旧日志在列表中正常显示");
    const oldLogList = await api("/api/audit-logs?pageSize=20");
    const oldLog = oldLogList.data.items.find((l) => l.id === "LOG-OLD-TEST-001");
    assert(oldLog, "旧日志在列表中正常显示");
    assert(oldLog.txnId === undefined, "旧日志无事务ID");
    passed++;

    console.log("5.3 验证旧日志在事务列表中作为独立项显示");
    const oldTxnList = await api("/api/audit-transactions?pageSize=20");
    const oldStandalone = oldTxnList.data.items.find((i) => i.logId === "LOG-OLD-TEST-001");
    assert(oldStandalone, "旧日志在事务列表中作为独立项显示");
    assert(oldStandalone.isTransaction === false, "标记为非事务");
    passed++;

    console.log("5.4 验证旧日志详情正常");
    const oldLogDetail = await api("/api/audit-logs/LOG-OLD-TEST-001");
    assert(oldLogDetail.res.ok, "旧日志详情接口正常");
    assertEqual(oldLogDetail.data.id, "LOG-OLD-TEST-001", "旧日志ID正确");
    assert(oldLogDetail.data.txnLogs === undefined || oldLogDetail.data.txnLogs.length === 0, "旧日志无事务日志");
    passed++;

    console.log("\n【测试 6】数据覆盖检测（阻止被覆盖数据回滚）\n");

    console.log("6.1 创建第一个盘点");
    const inv1Data = {
      batchId: firstBatch.id,
      date: "2026-08-17",
      method: "sampling",
      manualEstimate: Math.floor(firstBatch.estimatedCount * 0.85),
      actualCount: Math.floor(firstBatch.estimatedCount * 0.8),
      note: "盘点1",
      operator: "测试员A",
    };
    const inv1 = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify(inv1Data),
    });
    assert(inv1.res.ok, "第一个盘点创建成功");
    passed++;

    console.log("6.2 获取第一个盘点的事务ID");
    const logs6a = await api("/api/audit-logs?pageSize=10");
    const inv1Log = logs6a.data.items.find((l) => l.action === "inventory_create");
    const inv1TxnId = inv1Log?.txnId;
    assert(inv1TxnId, "第一个盘点有事务ID");
    passed++;

    console.log("6.3 创建第二个盘点（覆盖第一个的批次数据）");
    const inv2Data = {
      batchId: firstBatch.id,
      date: "2026-08-18",
      method: "sampling",
      manualEstimate: Math.floor(firstBatch.estimatedCount * 0.75),
      actualCount: Math.floor(firstBatch.estimatedCount * 0.7),
      note: "盘点2",
      operator: "测试员B",
    };
    const inv2 = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify(inv2Data),
    });
    assert(inv2.res.ok, "第二个盘点创建成功");
    passed++;

    console.log("6.4 验证第一个盘点事务现在不可回滚（被覆盖）");
    const txn1Detail = await api("/api/audit-transactions/" + encodeURIComponent(inv1TxnId));
    assert(txn1Detail.data.rollbackable === false, "被后续操作覆盖的事务不可回滚");
    assert(txn1Detail.data.rollbackReason.includes("覆盖"), "不可回滚原因包含'覆盖'");
    passed++;

    console.log("6.5 验证第二个盘点事务可回滚");
    const logs6b = await api("/api/audit-logs?pageSize=10");
    const inv2Log = logs6b.data.items.find(
      (l) => l.action === "inventory_create" && l.id !== inv1Log.id
    );
    const inv2TxnId = inv2Log?.txnId;
    const txn2Detail = await api("/api/audit-transactions/" + encodeURIComponent(inv2TxnId));
    assert(txn2Detail.data.rollbackable === true, "最新事务可回滚");
    passed++;

    console.log("\n【测试 7】单条日志回滚自动使用事务回滚\n");

    console.log("7.1 通过单条日志端点触发事务回滚");
    const singleLogRollback = await api(
      `/api/audit-logs/${inv2Log.id}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({ operator: "测试回滚员" }),
      }
    );
    assert(singleLogRollback.res.ok, "通过单条日志端点回滚成功");
    passed++;

    console.log("7.2 验证事务整体被回滚");
    const txn2AfterRollback = await api("/api/audit-transactions/" + encodeURIComponent(inv2TxnId));
    assert(txn2AfterRollback.data.rollbackable === false, "回滚后事务不可再次回滚");
    passed++;

    console.log("\n【测试 8】跨场区事务回滚门禁\n");

    console.log("8.1 手动创建一个跨场区事务（包含两个场区的记录）");
    const db8 = await loadDb();
    const crossFarmTxn = beginTxn(db8, {
      operator: "测试员",
      farmId: "FARM-DEFAULT",
      description: "跨场区测试事务",
    });
    writeLogToTxn(crossFarmTxn, db8, {
      action: "record_create",
      targetType: "record",
      targetId: "REC-CROSS-1",
      before: null,
      after: [
        { id: "REC-CROSS-1", batchId: firstBatch.id, farmId: "FARM-DEFAULT", date: "2026-08-21" },
        { id: "REC-CROSS-2", batchId: firstBatch.id, farmId: "FARM-OTHER", date: "2026-08-22" },
      ],
      meta: null,
    });
    commitTxn(db8, crossFarmTxn);
    await saveDb(db8);
    passed++;

    console.log("8.2 验证事务标记为跨场区且不可回滚");
    const crossFarmCheck = canRollbackTxn(db8, crossFarmTxn.txnId);
    assert(crossFarmCheck.ok === false, "跨场区事务不可回滚");
    assert(crossFarmCheck.reason.includes("跨场区"), "原因包含'跨场区'");
    passed++;

    console.log("8.3 验证API返回事务为跨场区不可回滚");
    const crossFarmDetail = await api("/api/audit-transactions/" + encodeURIComponent(crossFarmTxn.txnId));
    assert(crossFarmDetail.data.crossFarm === true, "事务标记为跨场区");
    assert(crossFarmDetail.data.rollbackable === false, "跨场区事务API返回不可回滚");
    passed++;

    console.log("8.4 验证单场区事务正常可回滚");
    const db8b = await loadDb();
    const singleFarmTxn = beginTxn(db8b, {
      operator: "测试员",
      farmId: "FARM-DEFAULT",
      description: "单场区测试事务",
    });
    writeLogToTxn(singleFarmTxn, db8b, {
      action: "record_create",
      targetType: "record",
      targetId: "REC-SINGLE-1",
      before: null,
      after: [
        { id: "REC-SINGLE-1", batchId: firstBatch.id, farmId: "FARM-DEFAULT", date: "2026-08-23" },
        { id: "REC-SINGLE-2", batchId: firstBatch.id, farmId: "FARM-DEFAULT", date: "2026-08-24" },
      ],
      meta: null,
    });
    commitTxn(db8b, singleFarmTxn);
    await saveDb(db8b);
    const singleFarmCheck = canRollbackTxn(db8b, singleFarmTxn.txnId);
    assert(singleFarmCheck.ok === true, "单场区事务可回滚");
    passed++;

    console.log("\n【测试 9】导入事务摘要批次统计\n");

    console.log("9.1 快速导入多条记录（含不同批次模拟，使用同批次多日期）");
    const batchIdA = firstBatch.id;
    const importRecords = [
      { batchId: batchIdA, date: "2026-08-25", poolId: "P-01", temperature: 28, salinity: 22, oxygen: 6.0, feed: 20, mortality: 0.5, abnormal: "无" },
      { batchId: batchIdA, date: "2026-08-26", poolId: "P-01", temperature: 28.2, salinity: 22, oxygen: 6.1, feed: 21, mortality: 0.4, abnormal: "无" },
      { batchId: batchIdA, date: "2026-08-27", poolId: "P-01", temperature: 27.9, salinity: 21.5, oxygen: 6.0, feed: 20, mortality: 0.3, abnormal: "无" },
    ];
    const importResult = await api("/api/import/records/confirm", {
      method: "POST",
      body: JSON.stringify({ records: importRecords, operator: "测试员" }),
    });
    assert(importResult.res.ok, "快速导入成功");
    assert(importResult.data.importedCount === 3, "成功导入3条记录");
    passed++;

    console.log("9.2 验证导入事务摘要包含正确的批次数量");
    const logs9 = await api("/api/audit-logs?pageSize=10");
    const importLog = logs9.data.items.find((l) => l.action === "record_create");
    const importTxnId = importLog?.txnId;
    assert(importTxnId, "导入记录有事务ID");
    const importTxnDetail = await api("/api/audit-transactions/" + encodeURIComponent(importTxnId));
    assert(importTxnDetail.data.affectedBatchCount === 1, "影响1个批次");
    assert(Array.isArray(importTxnDetail.data.affectedBatchIds), "有影响批次ID列表");
    assert(importTxnDetail.data.affectedBatchIds.includes(batchIdA), "批次ID在列表中");
    assertEqual(importTxnDetail.data.affectedCollections.record, 3, "record集合变更数正确");
    passed++;

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
