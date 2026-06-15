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
import { createSalesRouter } from "./routes/sales.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3097;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_PATH = join(__dirname, "data", "hatchery_test_stock.json");

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
  const salesRouter = createSalesRouter(helpers);

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

    const result5 = await salesRouter(req, res, pathname, method);
    if (result5 !== false) return result5;

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
  console.log("=== 开始测试库存占用机制 ===\n");

  let passed = 0;
  let failed = 0;

  try {
    console.log("【初始化】启动测试服务器（端口 " + TEST_PORT + "）...");
    await startTestServer();
    console.log("   ✓ 测试服务器启动成功\n");

    const TEST_BATCH = "B-260601";
    const farDate = getDateString(30);

    console.log("1. 测试初始库存状态");
    {
      const { res, data } = await api(`/api/batches/${TEST_BATCH}/available`);
      assertEqual(res.status, 200, "接口响应状态");
      assert(data.estimatedCount > 0, "估算数量大于0");
      assertEqual(data.reservedQuantity, 0, "初始占用数量为0");
      const initialAvailable = data.availableQuantity;
      assert(initialAvailable > 0, "初始可售数量大于0");
      console.log(`      初始状态：估算 ${data.estimatedCount}，旧销售 ${data.oldSalesQuantity}，已发货 ${data.shippedQuantity}，占用 ${data.reservedQuantity}，可售 ${data.availableQuantity}`);
      passed++;
    }

    console.log("\n2. 测试创建订单 - 库存占用生效");
    {
      const beforeAvailable = (await api(`/api/batches/${TEST_BATCH}/available`)).data.availableQuantity;
      const orderQty = 50000;

      const { res: orderRes, data: orderData } = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          batchId: TEST_BATCH,
          customerName: "测试客户A",
          orderQuantity: orderQty,
          unitPrice: 0.05,
          deliveryDate: farDate,
        }),
      });
      assertEqual(orderRes.status, 201, "订单创建成功");
      assertEqual(orderData.orderQuantity, orderQty, "订单数量正确");
      assertEqual(orderData.status, "pending", "订单状态为待发货");
      const orderId = orderData.id;

      const { data: afterData } = await api(`/api/batches/${TEST_BATCH}/available`);
      assertEqual(afterData.reservedQuantity, orderQty, "占用数量增加到订单数量");
      assertEqual(afterData.availableQuantity, beforeAvailable - orderQty, "可售数量减少");
      console.log(`      创建订单后：占用 ${afterData.reservedQuantity}，可售 ${afterData.availableQuantity}`);
      passed++;
    }

    console.log("\n3. 测试超卖防护 - 订单数量超过可售数量应拒绝");
    {
      const { data: availableData } = await api(`/api/batches/${TEST_BATCH}/available`);
      const availableQty = availableData.availableQuantity;
      const oversellQty = availableQty + 1000;

      const { res } = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          batchId: TEST_BATCH,
          customerName: "超卖测试客户",
          orderQuantity: oversellQty,
          unitPrice: 0.05,
          deliveryDate: farDate,
        }),
      });
      assertEqual(res.status, 400, "超卖订单被拒绝（400）");

      const { data: afterData } = await api(`/api/batches/${TEST_BATCH}/available`);
      assertEqual(afterData.reservedQuantity, availableData.reservedQuantity, "占用数量未变化");
      assertEqual(afterData.availableQuantity, availableQty, "可售数量未变化");
      console.log(`      超卖 ${oversellQty} 尾被正确拒绝，可售仍为 ${availableQty}`);
      passed++;
    }

    console.log("\n4. 测试创建第二个订单 - 可售数量再次减少");
    {
      const beforeAvailable = (await api(`/api/batches/${TEST_BATCH}/available`)).data.availableQuantity;
      const beforeReserved = (await api(`/api/batches/${TEST_BATCH}/available`)).data.reservedQuantity;
      const orderQty = 30000;

      const { res: orderRes, data: orderData } = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          batchId: TEST_BATCH,
          customerName: "测试客户B",
          orderQuantity: orderQty,
          unitPrice: 0.06,
          deliveryDate: farDate,
        }),
      });
      assertEqual(orderRes.status, 201, "第二个订单创建成功");
      const orderBId = orderData.id;

      const { data: afterData } = await api(`/api/batches/${TEST_BATCH}/available`);
      assertEqual(afterData.reservedQuantity, beforeReserved + orderQty, "占用数量累计增加");
      assertEqual(afterData.availableQuantity, beforeAvailable - orderQty, "可售数量再次减少");
      console.log(`      第二个订单：占用 ${afterData.reservedQuantity}，可售 ${afterData.availableQuantity}`);
      passed++;
    }

    console.log("\n5. 测试取消订单 - 占用释放");
    {
      const orders = (await api("/api/orders")).data;
      const firstOrder = orders.find((o) => o.customerName === "测试客户A");
      assert(!!firstOrder, "找到测试客户A的订单");
      const firstOrderRemaining = firstOrder.remainingQuantity;

      const beforeReserved = (await api(`/api/batches/${TEST_BATCH}/available`)).data.reservedQuantity;
      const beforeAvailable = (await api(`/api/batches/${TEST_BATCH}/available`)).data.availableQuantity;

      const { res: cancelRes } = await api(`/api/orders/${firstOrder.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      });
      assertEqual(cancelRes.status, 200, "取消订单成功");

      const { data: afterData } = await api(`/api/batches/${TEST_BATCH}/available`);
      assertEqual(afterData.reservedQuantity, beforeReserved - firstOrderRemaining, "占用数量释放");
      assertEqual(afterData.availableQuantity, beforeAvailable + firstOrderRemaining, "可售数量恢复");
      console.log(`      取消后：占用 ${afterData.reservedQuantity}，可售 ${afterData.availableQuantity}`);
      passed++;
    }

    console.log("\n6. 测试部分发货 - 占用量随剩余数量减少");
    {
      const orders = (await api("/api/orders")).data;
      const orderB = orders.find((o) => o.customerName === "测试客户B" && o.status !== "cancelled");
      assert(!!orderB, "找到测试客户B的订单");
      const orderBId = orderB.id;
      const originalRemaining = orderB.remainingQuantity;
      const shipQty = 10000;

      const beforeReserved = (await api(`/api/batches/${TEST_BATCH}/available`)).data.reservedQuantity;
      const beforeShipped = (await api(`/api/batches/${TEST_BATCH}/available`)).data.shippedQuantity;

      const { res: shipRes } = await api("/api/shipments", {
        method: "POST",
        body: JSON.stringify({
          orderId: orderBId,
          date: getDateString(0),
          quantity: shipQty,
        }),
      });
      assertEqual(shipRes.status, 201, "部分发货成功");

      const { data: afterData } = await api(`/api/batches/${TEST_BATCH}/available`);
      const expectedReserved = beforeReserved - shipQty;
      const expectedShipped = beforeShipped + shipQty;
      assertEqual(afterData.reservedQuantity, expectedReserved, `占用量减少 ${shipQty}`);
      assertEqual(afterData.shippedQuantity, expectedShipped, `已发货增加 ${shipQty}`);

      const updatedOrder = (await api(`/api/orders/${orderBId}`)).data;
      assertEqual(updatedOrder.remainingQuantity, originalRemaining - shipQty, "订单剩余数量减少");
      assertEqual(updatedOrder.status, "partial", "订单状态为部分发货");
      console.log(`      部分发货 ${shipQty} 后：占用 ${afterData.reservedQuantity}，已发货 ${afterData.shippedQuantity}，可售 ${afterData.availableQuantity}`);
      passed++;
    }

    console.log("\n7. 测试全部发货 - 占用完全释放，订单完成");
    {
      const orders = (await api("/api/orders")).data;
      const orderB = orders.find((o) => o.customerName === "测试客户B" && o.status !== "cancelled");
      assert(!!orderB, "找到测试客户B的订单");
      const orderBId = orderB.id;
      const remaining = orderB.remainingQuantity;

      const beforeReserved = (await api(`/api/batches/${TEST_BATCH}/available`)).data.reservedQuantity;

      const { res: shipRes } = await api("/api/shipments", {
        method: "POST",
        body: JSON.stringify({
          orderId: orderBId,
          date: getDateString(0),
          quantity: remaining,
        }),
      });
      assertEqual(shipRes.status, 201, "全部发货成功");

      const { data: afterData } = await api(`/api/batches/${TEST_BATCH}/available`);
      assertEqual(afterData.reservedQuantity, beforeReserved - remaining, "占用量完全释放");

      const updatedOrder = (await api(`/api/orders/${orderBId}`)).data;
      assertEqual(updatedOrder.remainingQuantity, 0, "订单剩余为0");
      assertEqual(updatedOrder.status, "completed", "订单状态为已完成");
      console.log(`      全部发货 ${remaining} 后：占用 ${afterData.reservedQuantity}，可售 ${afterData.availableQuantity}`);
      passed++;
    }

    console.log("\n8. 测试旧模式销售也参与可售数量计算");
    {
      const beforeData = (await api(`/api/batches/${TEST_BATCH}/available`)).data;
      const saleQty = 20000;

      const { res: saleRes } = await api("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          batchId: TEST_BATCH,
          date: getDateString(0),
          customer: "旧模式销售客户",
          count: saleQty,
          unitPrice: 0.04,
        }),
      });
      assertEqual(saleRes.status, 201, "旧模式销售创建成功");

      const afterData = (await api(`/api/batches/${TEST_BATCH}/available`)).data;
      assertEqual(afterData.oldSalesQuantity, beforeData.oldSalesQuantity + saleQty, "旧模式销量增加");
      assertEqual(afterData.availableQuantity, beforeData.availableQuantity - saleQty, "可售数量因旧销售减少");
      console.log(`      旧模式销售 ${saleQty} 后：旧销售 ${afterData.oldSalesQuantity}，可售 ${afterData.availableQuantity}`);
      passed++;
    }

    console.log("\n9. 测试批次追溯包含占用数据");
    {
      const { res, data } = await api(`/api/batches/${TEST_BATCH}/trace`);
      assertEqual(res.status, 200, "批次追溯响应状态");
      const orderStats = data.summary.orderStats;
      assert(orderStats.reservedQuantity !== undefined, "orderStats 包含 reservedQuantity 字段");
      assert(orderStats.availableQuantity !== undefined, "orderStats 包含 availableQuantity 字段");
      const availableData = (await api(`/api/batches/${TEST_BATCH}/available`)).data;
      assertEqual(orderStats.reservedQuantity, availableData.reservedQuantity, "追溯占用数量与 available 接口一致");
      assertEqual(orderStats.availableQuantity, availableData.availableQuantity, "追溯可售数量与 available 接口一致");
      console.log(`      批次追溯：占用 ${orderStats.reservedQuantity}，可售 ${orderStats.availableQuantity}`);
      passed++;
    }

    console.log("\n10. 测试删除订单释放占用");
    {
      const orderQty = 15000;
      const { data: newOrder } = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          batchId: TEST_BATCH,
          customerName: "待删除客户",
          orderQuantity: orderQty,
          unitPrice: 0.05,
          deliveryDate: farDate,
        }),
      });
      assertEqual(newOrder.status, "pending", "新订单为待发货状态");
      const orderId = newOrder.id;

      const beforeData = (await api(`/api/batches/${TEST_BATCH}/available`)).data;
      assert(beforeData.reservedQuantity >= orderQty, "删除前占用已生效");

      const { res: deleteRes } = await api(`/api/orders/${orderId}`, { method: "DELETE" });
      assertEqual(deleteRes.status, 200, "删除订单成功");

      const afterData = (await api(`/api/batches/${TEST_BATCH}/available`)).data;
      assertEqual(afterData.reservedQuantity, beforeData.reservedQuantity - orderQty, "删除后占用释放");
      console.log(`      删除订单后：占用 ${afterData.reservedQuantity}，可售 ${afterData.availableQuantity}`);
      passed++;
    }

    console.log("\n11. 测试库存口径一致性：估算 - 旧销售 - 已发货 - 占用 = 可售");
    {
      const { data } = await api(`/api/batches/${TEST_BATCH}/available`);
      const calculated = data.estimatedCount - data.oldSalesQuantity - data.shippedQuantity - data.reservedQuantity;
      assertEqual(data.availableQuantity, Math.max(0, calculated), "库存公式正确：估算 - 旧销售 - 已发货 - 占用 = 可售");
      console.log(`      公式验证：${data.estimatedCount} - ${data.oldSalesQuantity} - ${data.shippedQuantity} - ${data.reservedQuantity} = ${data.availableQuantity}`);
      passed++;
    }

    console.log("\n12. 测试编辑订单增加数量时的库存校验");
    {
      const orderQty = 10000;
      const { data: newOrder } = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          batchId: TEST_BATCH,
          customerName: "编辑测试客户",
          orderQuantity: orderQty,
          unitPrice: 0.05,
          deliveryDate: farDate,
        }),
      });
      const orderId = newOrder.id;
      const availableBefore = (await api(`/api/batches/${TEST_BATCH}/available`)).data.availableQuantity;
      const availableExcludingCurrent = availableBefore + orderQty;
      const newQty = orderQty + availableExcludingCurrent + 1000;

      const { res } = await api(`/api/orders/${orderId}`, {
        method: "PUT",
        body: JSON.stringify({ orderQuantity: newQty }),
      });
      assertEqual(res.status, 400, "增加数量超过可售时被拒绝");

      const afterAvailable = (await api(`/api/batches/${TEST_BATCH}/available`)).data.availableQuantity;
      assertEqual(afterAvailable, availableBefore, "可售数量未变化（校验拒绝）");
      console.log(`      编辑增加超量被正确拒绝（当前可用 ${availableBefore}，排除当前订单可用 ${availableExcludingCurrent}，尝试增加到 ${newQty}）`);
      passed++;
    }

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
