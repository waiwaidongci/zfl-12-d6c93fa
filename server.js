import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
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
import { createQuantityLedgerRouter, migrateLedgersFromSnapshot, validateAllBatches } from "./routes/quantity-ledger.js";
import {
  DbStorageError,
  safeLoadAndPrepare,
  safeSave,
  runMigration,
  validateStructure,
  listBackups,
  restoreFromBackup,
  findLatestValidBackup,
  DEFAULT_BACKUP_COUNT,
} from "./utils/db-storage.js";

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

async function runAllMigrations(db) {
  const results = [];

  const m1 = await runMigration(dbPath, db, (d) => {
    if (!d.lineages) d.lineages = [];
    return { initialized: !d.lineages };
  }, { migrationName: "init_lineages" });
  results.push(m1);

  const m2 = await runMigration(dbPath, db, (d) => {
    return migrateTransfersToLineage(d);
  }, { migrationName: "transfers_to_lineage" });
  if (m2.changed && m2.migrationResult > 0) {
    console.log(`[migration] 迁移了 ${m2.migrationResult} 条 transfer 记录为 lineage 记录`);
  }
  results.push(m2);

  const m3 = await runMigration(dbPath, db, (d) => {
    const farm = ensureDefaultFarm(d);
    const migrated = migrateDataToFarm(d, farm);
    if (!d.farms || d.farms.length === 0) {
      ensureDefaultFarm(d);
      migrateDataToFarm(d, d.farms[0]);
    }
    return { defaultFarmCreated: !!farm, dataMigratedCount: migrated };
  }, { migrationName: "ensure_farms_and_migrate" });
  results.push(m3);

  const m4 = await runMigration(dbPath, db, (d) => {
    return migrateFarmCostCategories(d);
  }, { migrationName: "farm_cost_categories" });
  if (m4.changed && m4.migrationResult > 0) {
    console.log(`[migration] 迁移了 ${m4.migrationResult} 个场区的成本分类`);
  }
  results.push(m4);

  const m5 = await runMigration(dbPath, db, (d) => {
    const changed = !d.importDrafts;
    if (!d.importDrafts) d.importDrafts = [];
    return { initialized: changed };
  }, { migrationName: "init_import_drafts" });
  results.push(m5);

  const m6 = await runMigration(dbPath, db, (d) => {
    const changed = !d.warnings;
    if (!d.warnings) d.warnings = [];
    return { initialized: changed };
  }, { migrationName: "init_warnings" });
  results.push(m6);

  const m7 = await runMigration(dbPath, db, (d) => {
    return migrateLedgersFromSnapshot(d);
  }, { migrationName: "quantity_ledgers" });
  if (m7.changed) {
    console.log(`[migration] 数量流水账迁移完成，当前 ${m7.migrationResult?.totalCount ?? 0} 条记录`);
  }
  results.push(m7);

  const quantityValidation = validateAllBatches(db);
  if (quantityValidation.hasIssues) {
    console.log(`[validation] 数量一致性校验发现 ${quantityValidation.totalErrors} 个错误和 ${quantityValidation.totalWarnings} 个警告`);
  }

  const hasChanges = results.some((r) => r.changed);
  return { results, hasChanges, quantityValidation };
}

async function loadDb() {
  const loadResult = await safeLoadAndPrepare(dbPath, {
    autoCreate: true,
    seedFn: getInitialSeed,
  });

  const db = loadResult.db;

  if (loadResult.recoveryUsed) {
    console.warn(`[db-storage] 警告：从备份恢复数据 (来源: ${loadResult.loadedFrom})`);
  }

  if (loadResult.preValidation && !loadResult.preValidation.valid) {
    console.warn(`[db-storage] 加载后结构有 ${loadResult.preValidation.stats.errorCount} 个错误，将在迁移时尝试修复`);
  }

  const migrationResult = await runAllMigrations(db);

  if (migrationResult.hasChanges) {
    try {
      await saveDb(db);
    } catch (e) {
      if (e instanceof DbStorageError) {
        console.error(`[db-storage] 迁移后保存失败: ${e.message} (code=${e.code})`);
      } else {
        console.error(`[db-storage] 迁移后保存失败:`, e);
      }
      throw e;
    }
  }

  const postCheck = validateStructure(db);
  if (!postCheck.valid) {
    console.error(`[db-storage] 致命错误：迁移后结构仍有 ${postCheck.stats.errorCount} 个错误`);
    for (const err of postCheck.errors) {
      console.error(`  - ${err.field}: ${err.message} [${err.code}]`);
    }
  }

  return db;
}

async function saveDb(db) {
  try {
    const result = await safeSave(dbPath, db, {
      preValidate: true,
      postValidate: true,
      createBackup: true,
      backupCount: DEFAULT_BACKUP_COUNT,
    });
    return result;
  } catch (e) {
    if (e instanceof DbStorageError) {
      console.error(`[db-storage] 保存失败: ${e.message} (code=${e.code})`);
      if (e.details) {
        console.error(`  details:`, JSON.stringify(e.details, null, 2).slice(0, 500));
      }
    } else {
      console.error(`[db-storage] 保存失败:`, e);
    }
    throw e;
  }
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
    "importDrafts",
    "quantityLedgers",
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
const quantityLedgerRouter = createQuantityLedgerRouter(helpers);

async function routeApi(req, res, url, method) {
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/admin/backups") {
    try {
      const backups = await listBackups(dbPath);
      return sendJson(res, 200, {
        total: backups.length,
        backups: backups.map((b) => ({
          name: b.name,
          size: b.size,
          createdAt: b.createdAt,
          createdAtStr: new Date(b.createdAt).toLocaleString("zh-CN"),
        })),
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (method === "POST" && pathname === "/api/admin/backups/create") {
    try {
      const db = await loadDb();
      await saveDb(db);
      const backups = await listBackups(dbPath);
      return sendJson(res, 201, {
        ok: true,
        message: "备份已创建",
        latestBackup: backups[0]
          ? { name: backups[0].name, size: backups[0].size, createdAt: backups[0].createdAt }
          : null,
      });
    } catch (e) {
      if (e instanceof DbStorageError) {
        return sendJson(res, 500, { error: e.message, code: e.code });
      }
      return sendJson(res, 500, { error: e.message });
    }
  }

  const restoreMatch = pathname.match(/^\/api\/admin\/backups\/restore\/([^/]+)$/);
  if (restoreMatch && method === "POST") {
    const backupName = decodeURIComponent(restoreMatch[1]);
    try {
      const backups = await listBackups(dbPath);
      const target = backups.find((b) => b.name === backupName);
      if (!target) {
        return sendJson(res, 404, { error: `备份不存在: ${backupName}` });
      }
      const result = await restoreFromBackup(dbPath, target.path);
      return sendJson(res, 200, {
        ok: true,
        message: "已从备份恢复，数据将在下次加载时生效",
        restoredFrom: target.name,
        hash: result.hash,
        size: result.size,
      });
    } catch (e) {
      if (e instanceof DbStorageError) {
        return sendJson(res, 500, { error: e.message, code: e.code });
      }
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (method === "GET" && pathname === "/api/admin/db/validate") {
    try {
      const db = await loadDb();
      const result = validateStructure(db);
      return sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof DbStorageError) {
        return sendJson(res, 500, { error: e.message, code: e.code });
      }
      return sendJson(res, 500, { error: e.message });
    }
  }

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

  const result17 = await quantityLedgerRouter(req, res, pathname, method);
  if (result17 !== false) return result17;

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
