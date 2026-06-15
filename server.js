import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
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
import { createOrdersRouter } from "./routes/orders.js";
import { createShipmentsRouter } from "./routes/shipments.js";
import { createDataIoRouter } from "./routes/data-io.js";
import { createFarmsRouter, ensureDefaultFarm, migrateDataToFarm, migrateFarmCostCategories } from "./routes/farms.js";
import { createAuditLogRouter } from "./routes/audit-log.js";
import { createLineageRouter, migrateTransfersToLineage } from "./routes/lineage.js";
import { createOverviewRouter } from "./routes/overview.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "hatchery.json");
const publicPath = join(__dirname, "public");
const port = Number(process.env.PORT || 3012);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function loadDb() {
  let dbNeedsSave = false;
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(getInitialSeed(), null, 2));
    dbNeedsSave = false;
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));

  if (!db.lineages) {
    db.lineages = [];
    dbNeedsSave = true;
  }

  const migratedLineageCount = migrateTransfersToLineage(db);
  if (migratedLineageCount > 0) {
    console.log(`迁移了 ${migratedLineageCount} 条 transfer 记录为 lineage 记录`);
    dbNeedsSave = true;
  }

  const defaultFarm = ensureDefaultFarm(db);
  if (defaultFarm) {
    const migratedCount = migrateDataToFarm(db, defaultFarm);
    if (migratedCount > 0 || !db.farms || db.farms.length === 0) {
      dbNeedsSave = true;
    }
  }

  if (!db.farms || db.farms.length === 0) {
    ensureDefaultFarm(db);
    migrateDataToFarm(db, db.farms[0]);
    dbNeedsSave = true;
  }

  const migratedCostCategories = migrateFarmCostCategories(db);
  if (migratedCostCategories > 0) {
    console.log(`迁移了 ${migratedCostCategories} 个场区的成本分类`);
    dbNeedsSave = true;
  }

  if (dbNeedsSave) {
    await writeFile(dbPath, JSON.stringify(db, null, 2));
  }
  return db;
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? join(publicPath, "index.html") : join(publicPath, pathname);
  if (!filePath.startsWith(publicPath)) return false;
  if (!existsSync(filePath)) return false;
  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function filterStateByFarm(db, farmId) {
  if (!farmId) return db;
  const scopedCollections = [
    "parentPools",
    "ponds",
    "batches",
    "records",
    "transfers",
    "sales",
    "costItems",
    "orders",
    "shipments",
    "warnings",
    "inventories",
    "lineages",
    "opLogs",
  ];
  const scopedDb = { ...db };
  for (const collection of scopedCollections) {
    if (Array.isArray(db[collection])) {
      scopedDb[collection] = db[collection].filter((item) => item.farmId === farmId);
    }
  }
  return scopedDb;
}

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
const ordersRouter = createOrdersRouter(helpers);
const shipmentsRouter = createShipmentsRouter(helpers);
const dataIoRouter = createDataIoRouter(helpers);
const farmsRouter = createFarmsRouter(helpers);
const auditLogRouter = createAuditLogRouter(helpers);
const lineageRouter = createLineageRouter(helpers);
const overviewRouter = createOverviewRouter(helpers);

async function routeApi(req, res, url, method) {
  const pathname = url.pathname;
  const db = await loadDb();

  if (method === "GET" && pathname === "/api/state") {
    const farmId = url.searchParams.get("farmId");
    return sendJson(res, 200, filterStateByFarm(db, farmId));
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

  const result10 = await ordersRouter(req, res, pathname, method);
  if (result10 !== false) return result10;

  const result11 = await shipmentsRouter(req, res, pathname, method);
  if (result11 !== false) return result11;

  const result12 = await dataIoRouter(req, res, pathname, method);
  if (result12 !== false) return result12;

  const result13 = await farmsRouter(req, res, pathname, method);
  if (result13 !== false) return result13;

  const result14 = await auditLogRouter(req, res, pathname, method);
  if (result14 !== false) return result14;

  const result15 = await lineageRouter(req, res, pathname, method);
  if (result15 !== false) return result15;

  const result16 = await overviewRouter(req, res, pathname, method);
  if (result16 !== false) return result16;

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      const handled = await routeApi(req, res, url, req.method);
      if (handled !== false) return;
      return sendJson(res, 404, { error: "not_found" });
    }

    const served = await serveStatic(req, res, pathname);
    if (served) return;

    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("Not Found");
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Aquaculture trace app listening on http://localhost:${port}`);
});
