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
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(getInitialSeed(), null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
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
