const POND_STATUS = {
  active: { label: "使用中", class: "status-active" },
  idle: { label: "空闲", class: "status-idle" },
  cleaning: { label: "消毒中", class: "status-cleaning" },
  maintenance: { label: "维修中", class: "status-maintenance" },
};

const POND_PURPOSES = ["虾苗培育", "蟹苗培育", "贝苗培育", "鱼种培育", "暂养池", "其他"];

const forms = {
  record:
    '<h2>每日水质和投喂</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>池号</label><select name="poolId"></select><label>水温</label><input name="temperature" type="number" step="0.1" required><label>盐度</label><input name="salinity" type="number" step="0.1" required><label>溶氧</label><input name="oxygen" type="number" step="0.1" required><label>投喂量kg</label><input name="feed" type="number" step="0.1" required><label>死亡率%</label><input name="mortality" type="number" step="0.1" required><label>异常情况</label><textarea name="abnormal"></textarea><button>保存记录</button>',
  transfer:
    '<h2>分池合池</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>来源池</label><select name="fromPool"></select><label>目标池</label><select name="toPool"></select><label>数量</label><input name="count" type="number" required><label>原因</label><textarea name="reason"></textarea><button>保存流转</button>',
  sale:
    '<h2>出苗销售</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>客户</label><input name="customer" required><label>数量</label><input name="count" type="number" required><label>单价</label><input name="unitPrice" type="number" step="0.0001" required><button>记录销售</button>',
  batch:
    '<h2>新建孵化批次</h2><label>批次号</label><input name="id" required><label>品种</label><input name="species" required><label>亲本池</label><select name="parentPoolId"></select><label>孵化日期</label><input name="hatchDate" type="date" required><label>当前池</label><select name="currentPool"></select><label>估算数量</label><input name="estimatedCount" type="number" required><label>初始成本</label><input name="cost" type="number" required><button>创建批次</button>',
  pond:
    '<h2>育苗池档案</h2><div class="pond-toolbar"><input id="pondSearch" placeholder="搜索池号或名称..."><select id="pondStatusFilter"><option value="">全部状态</option><option value="active">使用中</option><option value="idle">空闲</option><option value="cleaning">消毒中</option><option value="maintenance">维修中</option></select><div class="spacer"></div><button type="button" id="addPondBtn">+ 新增池子</button></div><div class="pond-stats" id="pondStats"></div><div class="grid" id="pondList"></div>',
};

let db = {};
let activeTab = "record";

const form = document.querySelector("#recordForm");
const tabs = document.querySelectorAll(".tabs button");
const batchSelect = document.querySelector("#batchSelect");
const statsEl = document.querySelector("#stats");
const timelineEl = document.querySelector("#timeline");
const batchInfo = document.querySelector("#batchInfo");

async function api(path, options) {
  const res = await fetch(
    path,
    options && options.body
      ? { ...options, headers: { "Content-Type": "application/json" } }
      : options
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function fillSelects() {
  if (!db.batches || !db.ponds || !db.parentPools) return;
  document.querySelectorAll('select[name="batchId"]').forEach(
    (s) => (s.innerHTML = db.batches.map((b) => `<option>${b.id}</option>`).join(""))
  );

  const usablePonds = db.ponds.filter((p) => p.status !== "maintenance");
  const pondOptions = usablePonds
    .map(
      (p) =>
        `<option value="${p.id}">${p.name} (${p.id} · ${POND_STATUS[p.status]?.label || p.status})</option>`
    )
    .join("");
  document.querySelectorAll(
    'select[name="poolId"], select[name="toPool"], select[name="fromPool"], select[name="currentPool"]'
  ).forEach((s) => {
    s.innerHTML = pondOptions;
  });

  document.querySelectorAll('select[name="parentPoolId"]').forEach(
    (s) =>
      (s.innerHTML = db.parentPools
        .map((p) => `<option value="${p.id}">${p.species} · ${p.id}</option>`)
        .join(""))
  );

  batchSelect.innerHTML = db.batches.map((b) => `<option>${b.id}</option>`).join("");
  if (!batchSelect.value && db.batches[0]) batchSelect.value = db.batches[0].id;
}

async function renderTrace() {
  if (!batchSelect.value) return;
  const trace = await api("/api/batches/" + batchSelect.value + "/trace");
  batchInfo.textContent =
    trace.batch.species +
    " · " +
    trace.batch.status +
    " · 当前池 " +
    trace.batch.currentPool;
  statsEl.innerHTML = [
    ["均温", trace.summary.averageTemperature + "℃"],
    ["均溶氧", trace.summary.averageOxygen],
    ["总投喂", trace.summary.totalFeed + "kg"],
    ["估算成本", trace.summary.estimatedCost + "元"],
  ]
    .map(
      ([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`
    )
    .join("");
  const events = [
    ...trace.transfers.map((e) => ({
      date: e.date,
      title: "池位流转",
      detail: e.fromPool + " → " + e.toPool + "，" + e.count + "尾，" + (e.reason || ""),
    })),
    ...trace.records.map((e) => ({
      date: e.date,
      title: "每日记录",
      detail:
        "水温" +
        e.temperature +
        "℃，盐度" +
        e.salinity +
        "，溶氧" +
        e.oxygen +
        "，投喂" +
        e.feed +
        "kg，死亡率" +
        e.mortality +
        "%" +
        (Number(e.oxygen) < 4.5 ? "，溶氧偏低" : ""),
    })),
    ...trace.sales.map((e) => ({
      date: e.date,
      title: "出苗销售",
      detail:
        e.customer + "，" + e.count + "尾，收入" + Math.round(e.count * e.unitPrice) + "元",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  timelineEl.innerHTML = events
    .map(
      (e) =>
        `<div class="event"><b>${e.date} · ${e.title}</b><div class="meta ${
          e.detail.includes("偏低") ? "warning" : ""
        }">${e.detail}</div></div>`
    )
    .join("");
}

function statusBadge(status) {
  const s = POND_STATUS[status] || { label: status, class: "" };
  return `<span class="status-badge ${s.class}">${s.label}</span>`;
}

function renderPondStats() {
  const stats = {
    total: db.ponds.length,
    active: db.ponds.filter((p) => p.status === "active").length,
    idle: db.ponds.filter((p) => p.status === "idle").length,
    cleaning: db.ponds.filter((p) => p.status === "cleaning").length,
    maintenance: db.ponds.filter((p) => p.status === "maintenance").length,
  };
  document.getElementById("pondStats").innerHTML = [
    ["池子总数", stats.total],
    ["使用中", stats.active],
    ["空闲", stats.idle],
    ["消毒中", stats.cleaning],
    ["维修中", stats.maintenance],
  ]
    .map(
      ([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`
    )
    .join("");
}

function renderPondList() {
  const search = document.getElementById("pondSearch")?.value?.trim() || "";
  const statusFilter = document.getElementById("pondStatusFilter")?.value || "";
  let ponds = db.ponds;
  if (search) {
    const lower = search.toLowerCase();
    ponds = ponds.filter(
      (p) =>
        p.id.toLowerCase().includes(lower) ||
        p.name.toLowerCase().includes(lower)
    );
  }
  if (statusFilter) {
    ponds = ponds.filter((p) => p.status === statusFilter);
  }
  const list = document.getElementById("pondList");
  if (!ponds.length) {
    list.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:24px;text-align:center;">暂无池子数据，点击右上角「新增池子」添加</div>`;
    return;
  }
  list.innerHTML = ponds
    .map(
      (p) => `
    <div class="pond-card" data-id="${p.id}">
      <h3>${p.name}</h3>
      <div class="pond-id">${p.id}</div>
      ${statusBadge(p.status)}
      <div class="pond-info" style="margin-top:10px;">
        <div class="row"><span class="label">容量</span><span>${p.capacity || "-"}</span></div>
        <div class="row"><span class="label">用途</span><span>${p.purpose || "-"}</span></div>
        <div class="row"><span class="label">消毒日期</span><span>${p.disinfectionDate || "-"}</span></div>
      </div>
      ${
        p.note
          ? `<div class="meta" style="margin-top:8px;font-size:12px;">备注：${p.note}</div>`
          : ""
      }
      <div class="pond-actions">
        <button type="button" class="secondary" data-action="edit">编辑</button>
        <button type="button" data-action="status">修改状态</button>
      </div>
    </div>
  `
    )
    .join("");

  list.querySelectorAll(".pond-card").forEach((card) => {
    const id = card.dataset.id;
    const editBtn = card.querySelector('[data-action="edit"]');
    const statusBtn = card.querySelector('[data-action="status"]');
    editBtn.onclick = (e) => { e.preventDefault(); openPondModal(id); };
    statusBtn.onclick = (e) => { e.preventDefault(); openStatusModal(id); };
  });
}

function renderPonds() {
  renderPondStats();
  renderPondList();
}

function openPondModal(pondId = null) {
  const pond = pondId ? db.ponds.find((p) => p.id === pondId) : null;
  const isEdit = !!pond;
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>${isEdit ? "编辑育苗池" : "新增育苗池"}</h2>
      <form id="pondForm">
        <label>池号 (ID)</label>
        <input name="id" required value="${pond?.id || ""}" ${
    isEdit ? "readonly" : ""
  } placeholder="如 P-01">
        <label>名称</label>
        <input name="name" required value="${pond?.name || ""}" placeholder="如 育苗池1号">
        <label>容量</label>
        <input name="capacity" value="${pond?.capacity || ""}" placeholder="如 42m³ 或 50000L">
        <label>用途</label>
        <select name="purpose">
          <option value="">请选择</option>
          ${POND_PURPOSES.map(
            (p) => `<option value="${p}" ${pond?.purpose === p ? "selected" : ""}>${p}</option>`
          ).join("")}
        </select>
        <label>当前状态</label>
        <select name="status">
          ${Object.entries(POND_STATUS)
            .map(
              ([k, v]) =>
                `<option value="${k}" ${pond?.status === k ? "selected" : ""}>${v.label}</option>`
            )
            .join("")}
        </select>
        <label>最近消毒日期</label>
        <input name="disinfectionDate" type="date" value="${
          pond?.disinfectionDate || ""
        }">
        <label>备注</label>
        <textarea name="note">${pond?.note || ""}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">${isEdit ? "保存修改" : "新增池子"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  modal.querySelector("#pondForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    try {
      if (isEdit) {
        await api("/api/ponds/" + pondId, { method: "PUT", body: JSON.stringify(data) });
      } else {
        await api("/api/ponds", { method: "POST", body: JSON.stringify(data) });
      }
      modal.remove();
      await load();
    } catch (err) {
      alert(err.message);
    }
  };
}

function openStatusModal(pondId) {
  const pond = db.ponds.find((p) => p.id === pondId);
  if (!pond) return;
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>修改状态 - ${pond.name}</h2>
      <form id="statusForm">
        <label>当前状态</label>
        <select name="status">
          ${Object.entries(POND_STATUS)
            .map(
              ([k, v]) =>
                `<option value="${k}" ${pond.status === k ? "selected" : ""}>${v.label}</option>`
            )
            .join("")}
        </select>
        <label>消毒日期（选填，如状态改为消毒中）</label>
        <input name="disinfectionDate" type="date" value="${pond.disinfectionDate || ""}">
        <label>备注（选填）</label>
        <textarea name="note">${pond.note || ""}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">保存</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  modal.querySelector("#statusForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api("/api/ponds/" + pondId + "/status", {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      modal.remove();
      await load();
    } catch (err) {
      alert(err.message);
    }
  };
}

function bindPondEvents() {
  const addBtn = document.getElementById("addPondBtn");
  const search = document.getElementById("pondSearch");
  const statusFilter = document.getElementById("pondStatusFilter");
  if (addBtn) addBtn.onclick = (e) => { e.preventDefault(); openPondModal(); };
  if (search) search.oninput = renderPondList;
  if (statusFilter) statusFilter.onchange = renderPondList;
}

function setTab(tab) {
  activeTab = tab;
  tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "pond") {
    form.innerHTML = "";
    form.classList.add("hidden");
    const pondContainer = document.getElementById("pondContainer");
    pondContainer.classList.remove("hidden");
    pondContainer.innerHTML = forms[tab];
    fillSelects();
    renderPonds();
    bindPondEvents();
  } else {
    form.classList.remove("hidden");
    form.innerHTML = forms[tab];
    document.getElementById("pondContainer").classList.add("hidden");
    fillSelects();
    renderTrace();
  }
}

async function load() {
  db = await api("/api/state");
  fillSelects();
  if (activeTab === "pond") {
    renderPonds();
    bindPondEvents();
  } else {
    renderTrace();
  }
}

tabs.forEach((btn) => (btn.onclick = () => setTab(btn.dataset.tab)));
batchSelect.onchange = renderTrace;
document.querySelector("#reload").onclick = load;
form.onsubmit = async (event) => {
  event.preventDefault();
  if (activeTab === "pond") return;
  const data = Object.fromEntries(new FormData(form).entries());
  const path =
    activeTab === "record"
      ? "/api/records"
      : activeTab === "transfer"
      ? "/api/transfers"
      : activeTab === "sale"
      ? "/api/sales"
      : "/api/batches";
  try {
    await api(path, { method: "POST", body: JSON.stringify(data) });
    form.reset();
    await load();
  } catch (err) {
    alert(err.message);
  }
};

setTab("record");
load();
