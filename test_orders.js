import http from "node:http";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitialSeed } from "./seed/seed.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createBatchesRouter } from "./routes/batches.js";
import { createCustomersRouter } from "./routes/customers.js";
import { createShipmentsRouter } from "./routes/shipments.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3098;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_PATH = join(__dirname, "data", "hatchery_test_orders.json");

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
  const ordersRouter = createOrdersRouter(helpers);
  const batchesRouter = createBatchesRouter(helpers);
  const customersRouter = createCustomersRouter(helpers);
  const shipmentsRouter = createShipmentsRouter(helpers);

  async function routeApi(req, res, url, method) {
    const pathname = url.pathname;
    const db = await loadDb();

    if (method === "GET" && pathname === "/api/state") {
      return sendJson(res, 200, db);
    }

    const result1 = await ordersRouter(req, res, pathname, method);
    if (result1 !== false) return result1;

    const result2 = await batchesRouter(req, res, pathname, method);
    if (result2 !== false) return result2;

    const result3 = await customersRouter(req, res, pathname, method);
    if (result3 !== false) return result3;

    const result4 = await shipmentsRouter(req, res, pathname, method);
    if (result4 !== false) return result4;

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

function getDateString(daysFromToday) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split("T")[0];
}

async function test() {
  console.log("=== 开始测试订单交付日期与临期/逾期功能 ===\n");

  let passed = 0;
  let failed = 0;

  try {
    console.log("【初始化】启动测试服务器（端口 " + TEST_PORT + "）...");
    await startTestServer();
    console.log("   ✓ 测试服务器启动成功\n");

    const todayStr = getDateString(0);
    const approachingDate = getDateString(3);
    const farDate = getDateString(30);
    const overdueDate = getDateString(-5);

    console.log("1. 测试 GET /api/orders 初始状态");
    const { res: res1, data: data1 } = await api("/api/orders");
    assertEqual(res1.status, 200, "响应状态");
    assert(Array.isArray(data1), "返回数组");
    const initialCount = data1.length;
    passed++;

    console.log("\n2. 测试创建不同交付日期的订单");
    
    console.log("   2.1 创建远期交付订单（30天后）");
    const orderFar = {
      batchId: "B-260601",
      customerName: "远期客户",
      orderQuantity: 10000,
      unitPrice: 0.05,
      deliveryDate: farDate,
    };
    const { res: res2a, data: data2a } = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(orderFar),
    });
    assertEqual(res2a.status, 201, "创建成功");
    assert(data2a.daysRemaining !== undefined, "返回 daysRemaining 字段");
    assertEqual(data2a.isOverdue, false, "远期订单未逾期");
    assertEqual(data2a.isApproaching, false, "远期订单未临期");
    assertEqual(data2a.deliveryStatus, "normal", "deliveryStatus 为 normal");
    const farOrderId = data2a.id;

    console.log("   2.2 创建临期交付订单（3天后）");
    const orderApproaching = {
      batchId: "B-260601",
      customerName: "临期客户",
      orderQuantity: 20000,
      unitPrice: 0.06,
      deliveryDate: approachingDate,
    };
    const { res: res2b, data: data2b } = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(orderApproaching),
    });
    assertEqual(res2b.status, 201, "创建成功");
    assertEqual(data2b.isApproaching, true, "临期订单 isApproaching 为 true");
    assertEqual(data2b.isOverdue, false, "临期订单未逾期");
    assertEqual(data2b.deliveryStatus, "approaching", "deliveryStatus 为 approaching");
    assert(data2b.daysRemaining >= 0 && data2b.daysRemaining <= 7, "剩余天数在临期范围内");
    const approachingOrderId = data2b.id;

    console.log("   2.3 创建逾期交付订单（5天前）");
    const orderOverdue = {
      batchId: "B-260601",
      customerName: "逾期客户",
      orderQuantity: 15000,
      unitPrice: 0.07,
      deliveryDate: overdueDate,
    };
    const { res: res2c, data: data2c } = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(orderOverdue),
    });
    assertEqual(res2c.status, 201, "创建成功");
    assertEqual(data2c.isOverdue, true, "逾期订单 isOverdue 为 true");
    assertEqual(data2c.isApproaching, false, "逾期订单 isApproaching 为 false");
    assertEqual(data2c.deliveryStatus, "overdue", "deliveryStatus 为 overdue");
    assert(data2c.daysRemaining < 0, "逾期订单剩余天数为负数");
    const overdueOrderId = data2c.id;

    console.log("   2.4 创建已完成订单（验证已完成订单不计入临期/逾期）");
    const orderCompleted = {
      batchId: "B-260601",
      customerName: "已完成客户",
      orderQuantity: 5000,
      unitPrice: 0.08,
      deliveryDate: overdueDate,
    };
    const { res: res2d, data: data2d } = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(orderCompleted),
    });
    assertEqual(res2d.status, 201, "创建成功");
    const completedOrderId = data2d.id;

    const shipmentData = {
      batchId: "B-260601",
      orderId: completedOrderId,
      date: overdueDate,
      quantity: 5000,
      note: "测试发货",
    };
    const { res: res2e } = await api("/api/shipments", {
      method: "POST",
      body: JSON.stringify(shipmentData),
    });
    assertEqual(res2e.status, 201, "创建发货记录成功");

    const { res: res2f, data: data2f } = await api("/api/orders/" + completedOrderId);
    assertEqual(res2f.status, 200, "查询订单成功");
    assertEqual(data2f.status, "completed", "订单状态为已完成");
    assertEqual(data2f.isOverdue, false, "已完成订单 isOverdue 为 false");
    assertEqual(data2f.isApproaching, false, "已完成订单 isApproaching 为 false");
    assertEqual(data2f.deliveryStatus, "normal", "已完成订单 deliveryStatus 为 normal");
    assertEqual(data2f.daysRemaining, null, "已完成订单 daysRemaining 为 null");
    passed++;

    console.log("\n3. 测试交付日期范围筛选");
    
    console.log("   3.1 按交付日期起始筛选");
    const startDate = getDateString(-10);
    const { res: res3a, data: data3a } = await api(
      "/api/orders?deliveryDateStart=" + startDate
    );
    assertEqual(res3a.status, 200, "响应状态");
    assert(data3a.length >= 3, "筛选后至少包含3个订单（临期、逾期、已完成）");
    const hasFar = data3a.some((o) => o.id === farOrderId);
    const hasOverdue = data3a.some((o) => o.id === overdueOrderId);
    assert(hasFar, "包含远期订单");
    assert(hasOverdue, "包含逾期订单");

    console.log("   3.2 按交付日期结束筛选");
    const endDate = getDateString(10);
    const { res: res3b, data: data3b } = await api(
      "/api/orders?deliveryDateEnd=" + endDate
    );
    assertEqual(res3b.status, 200, "响应状态");
    const hasFar2 = data3b.some((o) => o.id === farOrderId);
    const hasApproaching = data3b.some((o) => o.id === approachingOrderId);
    assert(!hasFar2, "不包含远期订单");
    assert(hasApproaching, "包含临期订单");

    console.log("   3.3 按交付日期范围筛选（起止都有）");
    const { res: res3c, data: data3c } = await api(
      "/api/orders?deliveryDateStart=" + getDateString(-10) + "&deliveryDateEnd=" + getDateString(10)
    );
    assertEqual(res3c.status, 200, "响应状态");
    const hasFar3 = data3c.some((o) => o.id === farOrderId);
    const hasApproaching3 = data3c.some((o) => o.id === approachingOrderId);
    const hasOverdue3 = data3c.some((o) => o.id === overdueOrderId);
    assert(!hasFar3, "范围内不包含远期订单");
    assert(hasApproaching3, "范围内包含临期订单");
    assert(hasOverdue3, "范围内包含逾期订单");
    passed++;

    console.log("\n4. 测试批次追溯中的订单统计");
    const { res: res4, data: data4 } = await api("/api/batches/B-260601/trace");
    assertEqual(res4.status, 200, "响应状态");
    const orderStats = data4.summary.orderStats;
    assert(orderStats !== undefined, "orderStats 存在");
    assert(orderStats.approachingOrders !== undefined, "包含 approachingOrders 字段");
    assert(orderStats.overdueOrders !== undefined, "包含 overdueOrders 字段");
    assert(orderStats.approachingOrders >= 1, "临期订单数量 >= 1");
    assert(orderStats.overdueOrders >= 1, "逾期订单数量 >= 1");
    console.log(`      临期订单: ${orderStats.approachingOrders} 单`);
    console.log(`      逾期订单: ${orderStats.overdueOrders} 单`);
    passed++;

    console.log("\n5. 测试状态筛选与交付日期筛选组合");
    const { res: res5, data: data5 } = await api(
      "/api/orders?status=pending&deliveryDateStart=" + getDateString(-10) + "&deliveryDateEnd=" + getDateString(10)
    );
    assertEqual(res5.status, 200, "响应状态");
    const allPending = data5.every((o) => o.status === "pending");
    assert(allPending, "所有筛选结果都是待发货状态");
    passed++;

    console.log("\n6. 测试取消订单后不计入临期/逾期");
    const { res: res6a } = await api("/api/orders/" + approachingOrderId, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    assertEqual(res6a.status, 200, "取消订单成功");

    const { res: res6b, data: data6b } = await api("/api/orders/" + approachingOrderId);
    assertEqual(data6b.isOverdue, false, "已取消订单 isOverdue 为 false");
    assertEqual(data6b.isApproaching, false, "已取消订单 isApproaching 为 false");
    assertEqual(data6b.daysRemaining, null, "已取消订单 daysRemaining 为 null");
    passed++;

    console.log("\n7. 验证批次追溯中订单列表包含交付日期信息");
    const { res: res7, data: data7 } = await api("/api/batches/B-260601/trace");
    const ordersInTrace = data7.orders || [];
    assert(ordersInTrace.length > 0, "批次追溯包含订单");
    const firstOrder = ordersInTrace[0];
    assert(firstOrder.daysRemaining !== undefined, "订单包含 daysRemaining 字段");
    assert(firstOrder.isOverdue !== undefined, "订单包含 isOverdue 字段");
    assert(firstOrder.isApproaching !== undefined, "订单包含 isApproaching 字段");
    assert(firstOrder.deliveryStatus !== undefined, "订单包含 deliveryStatus 字段");
    passed++;

    console.log("\n8. 测试 GET /api/batches/:batchId/orders 接口");
    const { res: res8, data: data8 } = await api("/api/batches/B-260601/orders");
    assertEqual(res8.status, 200, "响应状态");
    assert(Array.isArray(data8), "返回数组");
    if (data8.length > 0) {
      assert(data8[0].daysRemaining !== undefined, "返回的订单包含 daysRemaining");
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
