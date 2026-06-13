import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "hatchery.json");
const port = Number(process.env.PORT || 3012);

const seed = {
  parentPools: [{ id: "PP-01", species: "南美白对虾", count: 320, note: "春季亲本" }],
  batches: [
    { id: "B-260601", species: "南美白对虾", parentPoolId: "PP-01", hatchDate: "2026-06-01", currentPool: "P-03", estimatedCount: 850000, status: "育苗中", cost: 12600 }
  ],
  ponds: [{ id: "P-03", name: "育苗池3号", volume: "42m3" }, { id: "P-05", name: "育苗池5号", volume: "48m3" }],
  records: [
    { id: "REC-1", batchId: "B-260601", date: "2026-06-12", poolId: "P-03", temperature: 28.2, salinity: 22, oxygen: 6.1, feed: 18, mortality: 0.8, abnormal: "无" }
  ],
  transfers: [
    { id: "TR-1", batchId: "B-260601", fromPool: "孵化桶", toPool: "P-03", date: "2026-06-03", count: 900000, reason: "初次入池" }
  ],
  sales: []
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
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

function batchTrace(db, batchId) {
  const batch = db.batches.find((item) => item.id === batchId);
  if (!batch) return null;
  const records = db.records.filter((item) => item.batchId === batchId).sort((a, b) => a.date.localeCompare(b.date));
  const transfers = db.transfers.filter((item) => item.batchId === batchId).sort((a, b) => a.date.localeCompare(b.date));
  const sales = db.sales.filter((item) => item.batchId === batchId).sort((a, b) => a.date.localeCompare(b.date));
  const feedCost = records.reduce((sum, item) => sum + Number(item.feed || 0) * 7.8, 0);
  return { batch, records, transfers, sales, summary: { averageTemperature: avg(records, "temperature"), averageOxygen: avg(records, "oxygen"), totalFeed: sum(records, "feed"), averageMortality: avg(records, "mortality"), estimatedCost: Math.round((batch.cost || 0) + feedCost), soldCount: sum(sales, "count") } };
}

function sum(items, key) {
  return Number(items.reduce((total, item) => total + Number(item[key] || 0), 0).toFixed(2));
}

function avg(items, key) {
  if (!items.length) return 0;
  return Number((sum(items, key) / items.length).toFixed(2));
}

const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>海水养殖苗种场</title>
  <style>
    :root { --bg:#eef5f4; --panel:#fff; --ink:#1d2930; --muted:#60727a; --line:#ccdcdb; --blue:#216778; --green:#39735a; --warn:#a84e35; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { padding:22px 28px; display:grid; grid-template-columns:360px 1fr; gap:22px; }
    form, .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; } label { display:block; margin:10px 0 5px; font-size:13px; color:var(--muted); }
    input, select, textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; } textarea { min-height:66px; }
    button { border:0; border-radius:6px; padding:10px 13px; background:var(--blue); color:#fff; font-weight:700; cursor:pointer; }
    .tabs { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; } .tabs button { background:#d9e8e6; color:var(--ink); } .tabs button.active { background:var(--blue); color:#fff; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; } .stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px; } .stat strong { display:block; font-size:22px; }
    .timeline { display:grid; gap:10px; } .event { border:1px solid var(--line); border-radius:8px; background:#fff; padding:12px; }
    .meta { color:var(--muted); font-size:13px; } .batchbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; } .batchbar select { width:auto; min-width:220px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:10px; } .warning { color:var(--warn); font-weight:700; }
    @media (max-width:900px) { header { display:block; padding:18px 16px; } main { grid-template-columns:1fr; padding:16px; } .stats { grid-template-columns:1fr 1fr; } }
  </style>
</head>
<body>
  <header><div><h1>海水养殖苗种场追踪</h1><div class="meta">亲本、孵化批次、水质投喂、分池出苗</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <div class="tabs"><button data-tab="record" class="active">每日记录</button><button data-tab="transfer">分池合池</button><button data-tab="sale">出苗销售</button><button data-tab="batch">新建批次</button></div>
      <form id="recordForm">
        <h2>每日水质和投喂</h2>
        <label>批次</label><select name="batchId"></select>
        <label>日期</label><input name="date" type="date" required>
        <label>池号</label><select name="poolId"></select>
        <label>水温</label><input name="temperature" type="number" step="0.1" required>
        <label>盐度</label><input name="salinity" type="number" step="0.1" required>
        <label>溶氧</label><input name="oxygen" type="number" step="0.1" required>
        <label>投喂量kg</label><input name="feed" type="number" step="0.1" required>
        <label>死亡率%</label><input name="mortality" type="number" step="0.1" required>
        <label>异常情况</label><textarea name="abnormal"></textarea>
        <button>保存记录</button>
      </form>
    </section>
    <section>
      <div class="batchbar"><select id="batchSelect"></select><span class="meta" id="batchInfo"></span></div>
      <div class="stats" id="stats"></div>
      <div class="panel"><h2>批次追溯</h2><div class="timeline" id="timeline"></div></div>
    </section>
  </main>
  <script>
    const forms = {
      record: '<h2>每日水质和投喂</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>池号</label><select name="poolId"></select><label>水温</label><input name="temperature" type="number" step="0.1" required><label>盐度</label><input name="salinity" type="number" step="0.1" required><label>溶氧</label><input name="oxygen" type="number" step="0.1" required><label>投喂量kg</label><input name="feed" type="number" step="0.1" required><label>死亡率%</label><input name="mortality" type="number" step="0.1" required><label>异常情况</label><textarea name="abnormal"></textarea><button>保存记录</button>',
      transfer: '<h2>分池合池</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>来源池</label><input name="fromPool" required><label>目标池</label><select name="toPool"></select><label>数量</label><input name="count" type="number" required><label>原因</label><textarea name="reason"></textarea><button>保存流转</button>',
      sale: '<h2>出苗销售</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>客户</label><input name="customer" required><label>数量</label><input name="count" type="number" required><label>单价</label><input name="unitPrice" type="number" step="0.0001" required><button>记录销售</button>',
      batch: '<h2>新建孵化批次</h2><label>批次号</label><input name="id" required><label>品种</label><input name="species" required><label>亲本池</label><select name="parentPoolId"></select><label>孵化日期</label><input name="hatchDate" type="date" required><label>当前池</label><select name="currentPool"></select><label>估算数量</label><input name="estimatedCount" type="number" required><label>初始成本</label><input name="cost" type="number" required><button>创建批次</button>'
    };
    const form = document.querySelector("#recordForm");
    const tabs = document.querySelectorAll(".tabs button");
    const batchSelect = document.querySelector("#batchSelect");
    const statsEl = document.querySelector("#stats");
    const timelineEl = document.querySelector("#timeline");
    const batchInfo = document.querySelector("#batchInfo");
    let db = {};
    let activeTab = "record";
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function fillSelects() {
      if (!db.batches || !db.ponds || !db.parentPools) return;
      document.querySelectorAll('select[name="batchId"]').forEach(s => s.innerHTML = db.batches.map(b => '<option>'+b.id+'</option>').join(""));
      document.querySelectorAll('select[name="poolId"], select[name="toPool"], select[name="currentPool"]').forEach(s => s.innerHTML = db.ponds.map(p => '<option value="'+p.id+'">'+p.name+'</option>').join(""));
      document.querySelectorAll('select[name="parentPoolId"]').forEach(s => s.innerHTML = db.parentPools.map(p => '<option value="'+p.id+'">'+p.species+' · '+p.id+'</option>').join(""));
      batchSelect.innerHTML = db.batches.map(b => '<option>'+b.id+'</option>').join("");
      if (!batchSelect.value && db.batches[0]) batchSelect.value = db.batches[0].id;
    }
    async function renderTrace() {
      if (!batchSelect.value) return;
      const trace = await api('/api/batches/'+batchSelect.value+'/trace');
      batchInfo.textContent = trace.batch.species + " · " + trace.batch.status + " · 当前池 " + trace.batch.currentPool;
      statsEl.innerHTML = [
        ["均温", trace.summary.averageTemperature + "℃"],
        ["均溶氧", trace.summary.averageOxygen],
        ["总投喂", trace.summary.totalFeed + "kg"],
        ["估算成本", trace.summary.estimatedCost + "元"]
      ].map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join("");
      const events = [
        ...trace.transfers.map(e => ({ date:e.date, title:"池位流转", detail:e.fromPool+" → "+e.toPool+"，"+e.count+"尾，"+(e.reason||"") })),
        ...trace.records.map(e => ({ date:e.date, title:"每日记录", detail:"水温"+e.temperature+"℃，盐度"+e.salinity+"，溶氧"+e.oxygen+"，投喂"+e.feed+"kg，死亡率"+e.mortality+"%" + (Number(e.oxygen) < 4.5 ? "，溶氧偏低" : "") })),
        ...trace.sales.map(e => ({ date:e.date, title:"出苗销售", detail:e.customer+"，"+e.count+"尾，收入"+Math.round(e.count*e.unitPrice)+"元" }))
      ].sort((a,b) => b.date.localeCompare(a.date));
      timelineEl.innerHTML = events.map(e => '<div class="event"><b>'+e.date+' · '+e.title+'</b><div class="meta '+(e.detail.includes("偏低")?"warning":"")+'">'+e.detail+'</div></div>').join("");
    }
    function setTab(tab) {
      activeTab = tab;
      tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
      form.innerHTML = forms[tab];
      fillSelects();
    }
    async function load() {
      db = await api("/api/state");
      fillSelects();
      renderTrace();
    }
    tabs.forEach(btn => btn.onclick = () => setTab(btn.dataset.tab));
    batchSelect.onchange = renderTrace;
    document.querySelector("#reload").onclick = load;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const path = activeTab === "record" ? "/api/records" : activeTab === "transfer" ? "/api/transfers" : activeTab === "sale" ? "/api/sales" : "/api/batches";
      await api(path, { method:"POST", body: JSON.stringify(data) });
      form.reset();
      await load();
    };
    setTab("record");
    load();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, db);
    const traceMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/trace$/);
    if (traceMatch && req.method === "GET") {
      const trace = batchTrace(db, traceMatch[1]);
      return trace ? sendJson(res, 200, trace) : sendJson(res, 404, { error: "batch_not_found" });
    }
    if (req.method === "POST" && url.pathname === "/api/batches") {
      const input = await body(req);
      const batch = { id: input.id, species: input.species, parentPoolId: input.parentPoolId, hatchDate: input.hatchDate, currentPool: input.currentPool, estimatedCount: Number(input.estimatedCount), status: "育苗中", cost: Number(input.cost || 0) };
      db.batches.push(batch);
      db.transfers.push({ id: `TR-${Date.now()}`, batchId: batch.id, fromPool: "孵化桶", toPool: batch.currentPool, date: batch.hatchDate, count: batch.estimatedCount, reason: "新批次入池" });
      await saveDb(db);
      return sendJson(res, 201, batch);
    }
    if (req.method === "POST" && url.pathname === "/api/records") {
      const input = await body(req);
      const record = { id: `REC-${Date.now()}`, batchId: input.batchId, date: input.date, poolId: input.poolId, temperature: Number(input.temperature), salinity: Number(input.salinity), oxygen: Number(input.oxygen), feed: Number(input.feed), mortality: Number(input.mortality), abnormal: input.abnormal || "无" };
      db.records.push(record);
      await saveDb(db);
      return sendJson(res, 201, record);
    }
    if (req.method === "POST" && url.pathname === "/api/transfers") {
      const input = await body(req);
      const transfer = { id: `TR-${Date.now()}`, batchId: input.batchId, fromPool: input.fromPool, toPool: input.toPool, date: input.date, count: Number(input.count), reason: input.reason || "" };
      const batch = db.batches.find((item) => item.id === input.batchId);
      if (batch) batch.currentPool = input.toPool;
      db.transfers.push(transfer);
      await saveDb(db);
      return sendJson(res, 201, transfer);
    }
    if (req.method === "POST" && url.pathname === "/api/sales") {
      const input = await body(req);
      const sale = { id: `SALE-${Date.now()}`, batchId: input.batchId, date: input.date, customer: input.customer, count: Number(input.count), unitPrice: Number(input.unitPrice) };
      db.sales.push(sale);
      await saveDb(db);
      return sendJson(res, 201, sale);
    }
    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Aquaculture trace app listening on http://localhost:${port}`);
});
