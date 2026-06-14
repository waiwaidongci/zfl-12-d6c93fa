import http from "node:http";
import { mkdir, readFile, writeFile, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitialSeed } from "./seed/seed.js";
import { createPondsRouter } from "./routes/ponds.js";
import { createBatchesRouter } from "./routes/batches.js";
import { createRecordsRouter } from "./routes/records.js";
import { createTransfersRouter } from "./routes/transfers.js";
import { createSalesRouter } from "./routes/sales.js";
import { createCustomersRouter } from "./routes/customers.js";
import { createCostsRouter } from "./routes/costs.js";
import { createWarningsRouter } from "./routes/warnings.js";
import { createInventoriesRouter } from "./routes/inventories.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_PATH = join(__dirname, "data", "hatchery_test.json");

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
    await writeFile(dbPath, JSON.stringify(getInitialSeed(), null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function createTestServer() {
  const helpers = { loadDb, saveDb, sendJson, body };
  const pondsRouter = createPondsRouter(helpers);
  const batchesRouter = createBatchesRouter(helpers);
  const recordsRouter = createRecordsRouter(helpers);
  const transfersRouter = createTransfersRouter(helpers);
  const salesRouter = createSalesRouter(helpers);
  const customersRouter = createCustomersRouter(helpers);
  const costsRouter = createCostsRouter(helpers);
  const warningsRouter = createWarningsRouter(helpers);
  const inventoriesRouter = createInventoriesRouter(helpers);

  async function routeApi(req, res, url, method) {
    const pathname = url.pathname;
    const db = await loadDb();

    if (method === "GET" && pathname === "/api/state") {
      return sendJson(res, 200, db);
    }

    const result1 = await pondsRouter(req, res, pathname, method);
    if (result1 !== false) return result1;

    const result2 = await batchesRouter(req, res, pathname, method);
    if (result2 !== false) return result2;

    const result3 = await recordsRouter(req, res, pathname, method);
    if (result3 !== false) return result3;

    const result4 = await transfersRouter(req, res, pathname, method);
    if (result4 !== false) return result4;

    const result5 = await salesRouter(req, res, pathname, method);
    if (result5 !== false) return result5;

    const result6 = await customersRouter(req, res, pathname, method);
    if (result6 !== false) return result6;

    const result7 = await costsRouter(req, res, pathname, method);
    if (result7 !== false) return result7;

    const result8 = await warningsRouter(req, res, pathname, method);
    if (result8 !== false) return result8;

    const result9 = await inventoriesRouter(req, res, pathname, method);
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
    throw new Error(`断言失败: ${message} - 期望 ${expected}，实际 ${actual}`);
  }
  console.log(`   ✓ ${message}: ${actual}`);
}

async function test() {
  console.log("=== 开始测试盘点校准模块（隔离测试环境） ===\n");

  let passed = 0;
  let failed = 0;

  try {
    console.log("【初始化】启动测试服务器（端口 " + TEST_PORT + "）...");
    await startTestServer();
    console.log("   ✓ 测试服务器启动成功\n");

    console.log("1. 测试 GET /api/inventories（初始空状态）");
    const { res: res1, data: data1 } = await api("/api/inventories");
    assertEqual(res1.status, 200, "响应状态");
    assert(Array.isArray(data1), "返回数组");
    assertEqual(data1.length, 0, "初始盘点记录为空");
    passed++;

    console.log("\n2. 测试 GET /api/batches/B-260601/trace（查看初始状态）");
    const { res: res2, data: data2 } = await api("/api/batches/B-260601/trace");
    assertEqual(res2.status, 200, "响应状态");
    const originalCount = data2.batch.estimatedCount;
    assertEqual(originalCount, 850000, "初始估算数量");
    assertEqual((data2.inventories || []).length, 0, "初始盘点记录数为0");
    assertEqual(data2.summary.inventoryStats.totalAdjustments, 0, "inventoryStats 调整次数为0");
    assertEqual(data2.summary.inventoryStats.totalDifference, 0, "inventoryStats 累计差异为0");
    const initialTransfers = [...data2.transfers];
    const initialRecords = [...data2.records];
    const initialSales = [...data2.sales];
    passed++;

    console.log("\n3. 测试 POST /api/inventories 参数验证");
    console.log("   3.1 缺失批次号");
    const { res: res3a } = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify({ manualEstimate: 100, actualCount: 100 })
    });
    assertEqual(res3a.status, 400, "缺失批次号返回400");

    console.log("   3.2 批次不存在");
    const { res: res3b } = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify({ batchId: "NONEXIST", manualEstimate: 100, actualCount: 100 })
    });
    assertEqual(res3b.status, 404, "批次不存在返回404");

    console.log("   3.3 实际盘点数为负数");
    const { res: res3c } = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify({ batchId: "B-260601", manualEstimate: 100, actualCount: -1 })
    });
    assertEqual(res3c.status, 400, "负数返回400");
    passed++;

    console.log("\n4. 测试 POST /api/inventories 创建盘点校准记录");
    const newInventory = {
      batchId: "B-260601",
      date: "2026-06-14",
      poolId: "P-03",
      method: "sampling",
      manualEstimate: 820000,
      actualCount: 815000,
      operator: "李场长",
      note: "因前期死亡率偏高，实际数量低于系统估算"
    };
    const { res: res4, data: data4 } = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify(newInventory)
    });
    assertEqual(res4.status, 201, "响应状态");
    assert(!!data4.id, "返回记录ID");
    assertEqual(data4.batchId, "B-260601", "batchId 正确");
    assertEqual(data4.beforeCount, originalCount, "beforeCount 正确");
    assertEqual(data4.afterCount, 815000, "afterCount 正确");
    assertEqual(data4.difference, 815000 - originalCount, "difference 正确");
    assertEqual(data4.systemEstimate, originalCount, "systemEstimate 正确");
    assertEqual(data4.manualEstimate, 820000, "manualEstimate 正确");
    assertEqual(data4.actualCount, 815000, "actualCount 正确");
    assertEqual(data4.operator, "李场长", "operator 正确");
    assertEqual(data4.note, "因前期死亡率偏高，实际数量低于系统估算", "note 正确");
    const inventoryId = data4.id;
    passed++;

    console.log("\n5. 验证盘点后批次估算数量已更新");
    const { res: res5, data: data5 } = await api("/api/batches/B-260601/trace");
    assertEqual(res5.status, 200, "响应状态");
    assertEqual(data5.batch.estimatedCount, 815000, "估算数量已更新为815000");
    assertEqual((data5.inventories || []).length, 1, "盘点记录数为1");
    assertEqual(data5.summary.inventoryStats.totalAdjustments, 1, "调整次数为1");
    assertEqual(data5.summary.inventoryStats.lastInventoryDate, "2026-06-14", "最后盘点日期正确");
    assertEqual(data5.summary.inventoryStats.totalDifference, -35000, "累计差异为-35000");
    passed++;

    console.log("\n6. 验证历史数据未被修改");
    console.log("   6.1 分池记录");
    assertEqual(data5.transfers.length, initialTransfers.length, "分池记录数量不变");
    assertEqual(data5.transfers[0].count, initialTransfers[0].count, "分池记录数量值不变");
    console.log("   6.2 每日记录");
    assertEqual(data5.records.length, initialRecords.length, "每日记录数量不变");
    assertEqual(data5.records[0].mortality, initialRecords[0].mortality, "死亡率不变");
    console.log("   6.3 销售记录");
    assertEqual(data5.sales.length, initialSales.length, "销售记录数量不变");
    console.log("   ✓ 所有历史数据完整保留");
    passed++;

    console.log("\n7. 验证衍生指标使用新数量重算");
    const oldUnitCost = data2.summary.unitCost;
    const newUnitCost = data5.summary.unitCost;
    assert(newUnitCost > oldUnitCost, "单位苗成本因数量减少而上升（" + oldUnitCost + " → " + newUnitCost + "）");
    passed++;

    console.log("\n8. 测试 GET /api/batches/B-260601/inventories");
    const { res: res8, data: data8 } = await api("/api/batches/B-260601/inventories");
    assertEqual(res8.status, 200, "响应状态");
    assertEqual(data8.length, 1, "返回记录数");
    assertEqual(data8[0].id, inventoryId, "记录ID匹配");
    passed++;

    console.log("\n9. 测试 GET /api/inventories/:id");
    const { res: res9, data: data9 } = await api("/api/inventories/" + inventoryId);
    assertEqual(res9.status, 200, "响应状态");
    assertEqual(data9.id, inventoryId, "记录ID匹配");
    passed++;

    console.log("\n10. 测试第二次盘点校准");
    const secondInventory = {
      batchId: "B-260601",
      date: "2026-06-15",
      poolId: "P-03",
      method: "full",
      manualEstimate: 800000,
      actualCount: 805000,
      operator: "王技术员",
      note: "全池盘点，数量略有回升"
    };
    const { res: res10, data: data10 } = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify(secondInventory)
    });
    assertEqual(res10.status, 201, "响应状态");
    assertEqual(data10.beforeCount, 815000, "beforeCount 为上次盘点后的数量");
    assertEqual(data10.afterCount, 805000, "afterCount 正确");
    assertEqual(data10.difference, 805000 - 815000, "difference 基于当前系统估算");
    const secondInventoryId = data10.id;
    passed++;

    console.log("\n11. 验证两次盘点后的统计");
    const { res: res11, data: data11 } = await api("/api/batches/B-260601/trace");
    assertEqual(res11.status, 200, "响应状态");
    assertEqual(data11.batch.estimatedCount, 805000, "估算数量更新为805000");
    assertEqual(data11.inventories.length, 2, "盘点记录数为2");
    assertEqual(data11.summary.inventoryStats.totalAdjustments, 2, "调整次数为2");
    assertEqual(data11.summary.inventoryStats.totalDifference, -35000 + (805000 - 815000), "累计差异正确");
    passed++;

    console.log("\n12. 测试删除最近的盘点记录");
    const { res: res12, data: data12 } = await api("/api/inventories/" + secondInventoryId, {
      method: "DELETE"
    });
    assertEqual(res12.status, 200, "响应状态");
    assertEqual(data12.removed.id, secondInventoryId, "删除的记录ID正确");
    passed++;

    console.log("\n13. 验证删除后数量回退到上一次盘点后的值");
    const { res: res13, data: data13 } = await api("/api/batches/B-260601/trace");
    assertEqual(res13.status, 200, "响应状态");
    assertEqual(data13.batch.estimatedCount, 815000, "数量回退到815000");
    assertEqual(data13.inventories.length, 1, "盘点记录数回到1");
    passed++;

    console.log("\n14. 测试删除最后一条盘点记录");
    const { res: res14 } = await api("/api/inventories/" + inventoryId, {
      method: "DELETE"
    });
    assertEqual(res14.status, 200, "响应状态");
    passed++;

    console.log("\n15. 验证删除后数量回退到原始值");
    const { res: res15, data: data15 } = await api("/api/batches/B-260601/trace");
    assertEqual(res15.status, 200, "响应状态");
    assertEqual(data15.batch.estimatedCount, originalCount, "数量回退到原始值 " + originalCount);
    assertEqual(data15.inventories.length, 0, "盘点记录数为0");
    assertEqual(data15.summary.inventoryStats.totalAdjustments, 0, "调整次数为0");
    assertEqual(data15.summary.inventoryStats.totalDifference, 0, "累计差异为0");
    passed++;

    console.log("\n16. 测试盘点记录在批次追溯时间轴中的展示");
    const { res: res16a } = await api("/api/inventories", {
      method: "POST",
      body: JSON.stringify({
        batchId: "B-260601",
        date: "2026-06-16",
        method: "sampling",
        manualEstimate: 830000,
        actualCount: 825000,
      })
    });
    assertEqual(res16a.status, 201, "创建测试盘点记录成功");

    const { res: res16b, data: data16b } = await api("/api/batches/B-260601/trace");
    assertEqual(res16b.status, 200, "响应状态");
    const hasInventoryEvent = data16b.inventories.some(inv =>
      inv.beforeCount !== undefined && inv.afterCount !== undefined && inv.difference !== undefined
    );
    assert(hasInventoryEvent, "盘点记录包含校准前后快照");
    passed++;

    console.log("\n17. 验证测试数据库与生产数据库隔离");
    const prodDbPath = join(__dirname, "data", "hatchery.json");
    if (existsSync(prodDbPath)) {
      const prodDb = JSON.parse(await readFile(prodDbPath, "utf8"));
      const prodBatch = prodDb.batches.find(b => b.id === "B-260601");
      const testDb = await loadDb();
      const testBatch = testDb.batches.find(b => b.id === "B-260601");
      assert(prodBatch.estimatedCount !== testBatch.estimatedCount || prodDb.inventories.length !== testDb.inventories.length,
        "测试数据未污染生产数据库");
    } else {
      console.log("   （生产数据库不存在，跳过隔离验证）");
    }
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
