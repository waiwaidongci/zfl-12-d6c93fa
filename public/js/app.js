const POND_STATUS = {
  active: { label: "使用中", class: "status-active" },
  idle: { label: "空闲", class: "status-idle" },
  cleaning: { label: "消毒中", class: "status-cleaning" },
  maintenance: { label: "维修中", class: "status-maintenance" },
};

const POND_PURPOSES = ["虾苗培育", "蟹苗培育", "贝苗培育", "鱼种培育", "暂养池", "其他"];
const COST_CATEGORIES = ["饲料", "药品", "人工", "能源", "其他"];

const WARNING_LEVELS = {
  red: { label: "红色预警", class: "warning-red" },
  yellow: { label: "黄色预警", class: "warning-yellow" },
};

const WARNING_STATUS = {
  pending: { label: "待处理", class: "status-maintenance" },
  processing: { label: "处理中", class: "status-cleaning" },
  resolved: { label: "已解决", class: "status-active" },
  ignored: { label: "已忽略", class: "status-idle" },
};

const INVENTORY_METHODS = {
  sampling: { label: "抽样估算" },
  full: { label: "实际盘点" },
};

const ORDER_STATUSES = {
  pending: { label: "待发货", class: "status-idle" },
  partial: { label: "部分发货", class: "status-cleaning" },
  completed: { label: "已完成", class: "status-active" },
  cancelled: { label: "已取消", class: "status-maintenance" },
};

const forms = {
  record:
    '<h2>每日水质和投喂</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>池号</label><select name="poolId"></select><label>水温</label><input name="temperature" type="number" step="0.1" required><label>盐度</label><input name="salinity" type="number" step="0.1" required><label>溶氧</label><input name="oxygen" type="number" step="0.1" required><label>投喂量kg</label><input name="feed" type="number" step="0.1" required><label>死亡率%</label><input name="mortality" type="number" step="0.1" required><label>异常情况</label><textarea name="abnormal"></textarea><button>保存记录</button>',
  transfer:
    '<h2>分池合池</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>来源池</label><select name="fromPool"></select><label>目标池</label><select name="toPool"></select><label>数量</label><input name="count" type="number" required><label>原因</label><textarea name="reason"></textarea><button>保存流转</button>',
  sale:
    '<h2>出苗销售</h2><label>批次</label><select name="batchId"></select><label>日期</label><input name="date" type="date" required><label>客户</label><div class="sale-customer-row"><select name="customerId" id="saleCustomerSelect"><option value="">请选择客户（选填）</option></select><button type="button" class="secondary" id="quickAddCustomerBtn">+ 新客户</button></div><div id="saleCustomerNameWrap"><label>或直接输入客户名称</label><input name="customer" id="saleCustomerName" placeholder="手动输入客户名称"></div><label>数量</label><input name="count" type="number" required><label>单价</label><input name="unitPrice" type="number" step="0.0001" required><button>记录销售</button>',
  inventory:
    '<h2>批次盘点校准</h2><div class="inventory-toolbar"><select id="inventoryBatchFilter"><option value="">全部批次</option></select><div class="spacer"></div><button type="button" id="addInventoryBtn">+ 新增盘点</button></div><div class="inventory-stats" id="inventoryStats"></div><div class="grid" id="inventoryList"></div>',
  cost:
    '<h2>成本项目录入</h2><div class="cost-toolbar"><select id="costBatchFilter"><option value="">全部批次</option></select><div class="spacer"></div><button type="button" id="addCostBtn">+ 新增成本</button></div><div class="cost-stats" id="costStats"></div><div class="grid" id="costList"></div>',
  batch:
    '<h2>新建孵化批次</h2><label>批次号</label><input name="id" required><label>品种</label><input name="species" required><label>亲本池</label><select name="parentPoolId"></select><label>孵化日期</label><input name="hatchDate" type="date" required><label>当前池</label><select name="currentPool"></select><label>估算数量</label><input name="estimatedCount" type="number" required><label>初始成本</label><input name="cost" type="number" required><button>创建批次</button>',
  pond:
    '<h2>育苗池档案</h2><div class="pond-toolbar"><input id="pondSearch" placeholder="搜索池号或名称..."><select id="pondStatusFilter"><option value="">全部状态</option><option value="active">使用中</option><option value="idle">空闲</option><option value="cleaning">消毒中</option><option value="maintenance">维修中</option></select><div class="spacer"></div><button type="button" id="addPondBtn">+ 新增池子</button></div><div class="pond-stats" id="pondStats"></div><div class="grid" id="pondList"></div>',
  customer:
    '<h2>客户档案</h2><div class="customer-toolbar"><input id="customerSearch" placeholder="搜索客户名称、联系人或地区..."><div class="spacer"></div><button type="button" id="addCustomerBtn">+ 新增客户</button></div><div class="customer-stats" id="customerStats"></div><div class="grid" id="customerList"></div>',
  warning:
    '<h2>水质预警中心</h2><div class="warning-toolbar"><select id="warningLevelFilter"><option value="">全部等级</option><option value="red">红色预警</option><option value="yellow">黄色预警</option></select><select id="warningStatusFilter"><option value="">全部状态</option><option value="pending">待处理</option><option value="processing">处理中</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select><select id="warningBatchFilter"><option value="">全部批次</option></select><div class="spacer"></div><button type="button" class="secondary" id="thresholdConfigBtn">阈值配置</button></div><div class="warning-stats" id="warningStats"></div><div class="grid" id="warningList"></div>',
  order:
    '<h2>订单管理</h2><div class="order-toolbar"><select id="orderBatchFilter"><option value="">全部批次</option></select><select id="orderStatusFilter"><option value="">全部状态</option><option value="pending">待发货</option><option value="partial">部分发货</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select><div class="spacer"></div><button type="button" class="secondary" id="quickSaleBtn">快速销售（旧模式）</button><button type="button" id="addOrderBtn">+ 新增订单</button></div><div class="order-stats" id="orderStats"></div><div class="grid" id="orderList"></div>',
  shipment:
    '<h2>发货管理</h2><div class="shipment-toolbar"><select id="shipmentBatchFilter"><option value="">全部批次</option></select><select id="shipmentStatusFilter"><option value="">全部订单</option></select><div class="spacer"></div><button type="button" id="addShipmentBtn">+ 新增发货</button></div><div class="shipment-stats" id="shipmentStats"></div><div class="grid" id="shipmentList"></div>',
  dataio:
    '<h2>数据导入导出</h2><div class="dataio-section"><h3>导出数据</h3><p class="meta">将系统数据导出为 CSV 文件下载，可用于备份或离线处理</p><div class="dataio-export-btns"><button type="button" class="dataio-export-btn" data-export="batches">导出批次</button><button type="button" class="dataio-export-btn" data-export="records">导出每日记录</button><button type="button" class="dataio-export-btn" data-export="transfers">导出分池合池</button><button type="button" class="dataio-export-btn" data-export="sales">导出销售记录</button></div></div><div class="dataio-section"><h3>导入每日水质投喂记录</h3><div class="dataio-field-info" style="margin-top:8px;padding:10px;background:#f8faf9;border:1px solid var(--line);border-radius:6px;"><p class="meta" style="margin:0 0 6px;"><strong>必填列：</strong>batchId（批次号）、date（日期 YYYY-MM-DD）、temperature（水温℃）、salinity（盐度）、oxygen（溶氧mg/L）、feed（投喂量kg）、mortality（死亡率%）</p><p class="meta" style="margin:0 0 6px;"><strong>选填列：</strong>poolId（池号）、abnormal（异常情况，默认为"无"）</p><p class="meta" style="margin:0;"><strong>说明：</strong>系统会在导入前校验字段缺失、批次不存在、数值非法和重复日期，确认后才会写入 data/hatchery.json。可点击下方「下载模板」获取包含示例的 CSV 模板文件。</p></div><div class="dataio-import-area" style="margin-top:10px;"><input type="file" id="dataioFileInput" accept=".csv" /><button type="button" id="dataioPreviewBtn" disabled>预检导入</button><button type="button" id="dataioDownloadTemplate">下载模板</button><a href="/examples/records_template.csv" download target="_blank" style="margin-left:8px;font-size:13px;color:var(--blue);">查看示例文件 ↗</a></div><div id="dataioPreviewResult" class="hidden"></div></div>',
};

let db = {};
let activeTab = "record";

const form = document.querySelector("#recordForm");
const tabs = document.querySelectorAll(".tabs button");
const batchSelect = document.querySelector("#batchSelect");
const statsEl = document.querySelector("#stats");
const timelineEl = document.querySelector("#timeline");
const batchInfo = document.querySelector("#batchInfo");
const inventoryContainer = document.querySelector("#inventoryContainer");

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

  const customers = db.customers || [];
  const customerOptions = customers
    .map((c) => `<option value="${c.id}">${c.name} (${c.contact || "-"} · ${c.phone || "-"})</option>`)
    .join("");
  document.querySelectorAll("#saleCustomerSelect").forEach((s) => {
    s.innerHTML = '<option value="">请选择客户...</option>' + customerOptions;
  });

  batchSelect.innerHTML = db.batches.map((b) => `<option>${b.id}</option>`).join("");
  if (!batchSelect.value && db.batches[0]) batchSelect.value = db.batches[0].id;

  const batchFilterOptions = db.batches.map((b) => `<option value="${b.id}">${b.id}</option>`).join("");
  document.querySelectorAll("#inventoryBatchFilter, #costBatchFilter, #warningBatchFilter").forEach((s) => {
    const currentValue = s.value;
    s.innerHTML = '<option value="">全部批次</option>' + batchFilterOptions;
    if (currentValue) s.value = currentValue;
  });
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

  const s = trace.summary;
  const profitClass = s.grossProfit >= 0 ? "" : "warning";

  const costBreakdown = COST_CATEGORIES.map(
    (cat) => `<div class="row"><span class="label">${cat}</span><span>${(s.costByCategory?.[cat] || 0).toFixed(2)} 元</span></div>`
  ).join("");

  const invStats = s.inventoryStats || {};
  const diffClass = invStats.totalDifference >= 0 ? "" : "warning";

  const orderStats = s.orderStats || {};
  const oldSales = s.oldSales || { count: 0, revenue: 0 };
  const newSales = s.newSales || { shippedCount: 0, revenue: 0 };

  statsEl.innerHTML = `
    <div class="stat"><span>均温</span><strong>${s.averageTemperature}℃</strong></div>
    <div class="stat"><span>均溶氧</span><strong>${s.averageOxygen}</strong></div>
    <div class="stat"><span>总投喂</span><strong>${s.totalFeed}kg</strong></div>
    <div class="stat"><span>初始成本</span><strong>${s.initialCost.toFixed(2)} 元</strong></div>
    <div class="stat"><span>成本项目合计</span><strong>${s.costItemsTotal.toFixed(2)} 元</strong></div>
    <div class="stat"><span>总成本</span><strong>${s.totalCost.toFixed(2)} 元</strong></div>
    <div class="stat"><span>估算数量</span><strong>${s.estimatedCount.toLocaleString()} 尾</strong></div>
    <div class="stat"><span>单位苗成本</span><strong>${s.unitCost.toFixed(6)} 元/尾</strong></div>
    <div class="stat"><span>可售数量</span><strong>${(orderStats.availableQuantity || 0).toLocaleString()} 尾</strong></div>
    <div class="stat"><span>订单总数</span><strong>${orderStats.totalOrders || 0} 单</strong></div>
    <div class="stat"><span>待发货</span><strong>${orderStats.pendingOrders || 0} 单</strong></div>
    <div class="stat"><span>部分发货</span><strong>${orderStats.partialOrders || 0} 单</strong></div>
    <div class="stat"><span>已完成</span><strong>${orderStats.completedOrders || 0} 单</strong></div>
    <div class="stat"><span>订单总量</span><strong>${(orderStats.totalOrderQuantity || 0).toLocaleString()} 尾</strong></div>
    <div class="stat"><span>订单金额</span><strong>${(orderStats.totalOrderAmount || 0).toFixed(2)} 元</strong></div>
    <div class="stat"><span>已发货</span><strong>${(orderStats.totalShippedQuantity || 0).toLocaleString()} 尾</strong></div>
    <div class="stat"><span>待发货量</span><strong>${(orderStats.totalRemainingQuantity || 0).toLocaleString()} 尾</strong></div>
    <div class="stat"><span>旧模式销售</span><strong>${oldSales.count.toLocaleString()} 尾 / ¥${oldSales.revenue.toFixed(2)}</strong></div>
    <div class="stat"><span>新模式发货</span><strong>${newSales.shippedCount.toLocaleString()} 尾 / ¥${newSales.revenue.toFixed(2)}</strong></div>
    <div class="stat"><span>总计已售</span><strong>${s.soldCount.toLocaleString()} 尾</strong></div>
    <div class="stat"><span>总销售收入</span><strong>${s.salesRevenue.toFixed(2)} 元</strong></div>
    <div class="stat"><span>售出成本</span><strong>${s.soldCost.toFixed(2)} 元</strong></div>
    <div class="stat"><span>销售毛利</span><strong class="${profitClass}">${s.grossProfit.toFixed(2)} 元</strong></div>
    <div class="stat"><span>毛利率</span><strong class="${profitClass}">${s.grossMargin.toFixed(2)}%</strong></div>
    <div class="stat"><span>盘点校准次数</span><strong>${invStats.totalAdjustments || 0} 次</strong></div>
    ${invStats.lastInventoryDate ? `<div class="stat"><span>最后盘点日期</span><strong>${invStats.lastInventoryDate}</strong></div>` : ""}
    ${invStats.totalAdjustments > 0 ? `<div class="stat"><span>累计校准差异</span><strong class="${diffClass}">${invStats.totalDifference >= 0 ? "+" : ""}${invStats.totalDifference.toLocaleString()} 尾</strong></div>` : ""}
  `;

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
    ...(trace.costItems || []).map((e) => ({
      date: e.date,
      title: "成本支出",
      detail: `[${e.category}] ${e.description || ""}，金额 ${e.amount.toFixed(2)} 元${e.quantity ? `，数量 ${e.quantity}${e.unit || ""}` : ""}`,
    })),
    ...(trace.orders || []).map((e) => {
      const customerName = e.customerInfo?.name || e.customerName || "未知客户";
      const statusLabel = ORDER_STATUSES[e.status]?.label || e.status;
      return {
        date: e.createdAt.split("T")[0],
        title: "销售订单",
        detail: `${customerName} 订购 ${e.orderQuantity.toLocaleString()} 尾，单价 ${Number(e.unitPrice).toFixed(4)} 元/尾，金额 ¥${e.totalAmount.toFixed(2)}，交付日期 ${e.deliveryDate || "-"}，状态：${statusLabel}`,
        orderId: e.id,
        orderStatus: e.status,
        orderQuantity: e.orderQuantity,
        orderShipped: e.shippedQuantity,
        orderRemaining: e.remainingQuantity,
      };
    }),
    ...(trace.shipments || []).map((e) => {
      const customerName = e.customerInfo?.name || e.customerName || "未知客户";
      return {
        date: e.date,
        title: "批次发货",
        detail: `${customerName}，订单 ${e.orderId}，发货 ${e.quantity.toLocaleString()} 尾，收入 ¥${e.amount.toFixed(2)}`,
        shipmentId: e.id,
        shipmentOrderId: e.orderId,
        shipmentQuantity: e.quantity,
        shipmentAmount: e.amount,
      };
    }),
    ...trace.sales.map((e) => {
      let customerText = e.customer;
      if (e.customerInfo) {
        customerText = e.customerInfo.name;
        if (e.customerInfo.phone) {
          customerText += "（" + e.customerInfo.phone + "）";
        }
      }
      const revenue = Number(e.count || 0) * Number(e.unitPrice || 0);
      return {
        date: e.date,
        title: "出苗销售（旧）",
        detail: customerText + "，" + e.count + "尾，收入" + revenue.toFixed(2) + "元，单价" + Number(e.unitPrice).toFixed(4) + "元/尾",
        isOldSale: true,
      };
    }),
    ...(trace.warnings || []).map((e) => ({
      date: e.date,
      title: "水质预警",
      detail:
        (WARNING_LEVELS[e.level]?.label || e.level) +
        "：" +
        (e.reasons || []).join("；") +
        "（" + (WARNING_STATUS[e.status]?.label || e.status) + "）",
      warningLevel: e.level,
      warningId: e.id,
      warningStatus: e.status,
      warningHandler: e.handler,
      warningNote: e.handleNote,
    })),
    ...(trace.inventories || []).map((e) => ({
      date: e.date,
      title: "盘点校准",
      detail:
        "方式：" + (INVENTORY_METHODS[e.method]?.label || e.method) +
        "，抽样估算：" + e.manualEstimate.toLocaleString() + "尾" +
        "，实际盘点：" + e.actualCount.toLocaleString() + "尾" +
        "，系统估算：" + e.systemEstimate.toLocaleString() + "尾" +
        "，差异：" + (e.difference >= 0 ? "+" : "") + e.difference.toLocaleString() + "尾" +
        (e.operator ? "，盘点人：" + e.operator : "") +
        (e.note ? "，备注：" + e.note : ""),
      inventoryId: e.id,
      inventoryBefore: e.beforeCount,
      inventoryAfter: e.afterCount,
      inventoryDiff: e.difference,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  timelineEl.innerHTML = events
    .map(
      (e) => {
        let extraHtml = "";
        if (e.warningId) {
          const extraParts = [];
          if (e.warningHandler) extraParts.push(`处理人：${e.warningHandler}`);
          if (e.warningNote) extraParts.push(`备注：${e.warningNote}`);
          if (extraParts.length) extraHtml = `<div class="event-warning-extra">${extraParts.join(" · ")}</div>`;
          return `
            <div class="event event-warning event-warning-${e.warningLevel} event-warning-status-${e.warningStatus}" data-warning-id="${e.warningId}">
              <div class="event-warning-header">
                <b>${e.date} · ${e.title}</b>
                <span class="status-badge ${WARNING_STATUS[e.warningStatus]?.class || ""}">${WARNING_STATUS[e.warningStatus]?.label || e.warningStatus}</span>
              </div>
              <div class="meta ${e.detail.includes("偏低") ? "warning" : ""}">${e.detail}</div>
              ${extraHtml}
              <div class="event-warning-actions">
                ${e.warningStatus === "pending" || e.warningStatus === "processing" ? `<button type="button" class="secondary tiny" data-action="handle-warning">处理预警</button>` : ""}
              </div>
            </div>`;
        }
        if (e.inventoryId) {
          const diffClass = e.inventoryDiff >= 0 ? "" : "warning";
          const arrow = e.inventoryDiff >= 0 ? "↑" : "↓";
          return `
            <div class="event event-inventory" data-inventory-id="${e.inventoryId}">
              <b>${e.date} · ${e.title}</b>
              <div class="meta">${e.detail}</div>
              <div class="inventory-change-row">
                <div class="inventory-change-item">
                  <span class="label">校准前</span>
                  <strong>${e.inventoryBefore.toLocaleString()} 尾</strong>
                </div>
                <div class="inventory-change-arrow ${diffClass}">${arrow}</div>
                <div class="inventory-change-item">
                  <span class="label">校准后</span>
                  <strong>${e.inventoryAfter.toLocaleString()} 尾</strong>
                </div>
                <div class="inventory-change-item">
                  <span class="label">差异</span>
                  <strong class="${diffClass}">${e.inventoryDiff >= 0 ? "+" : ""}${e.inventoryDiff.toLocaleString()} 尾</strong>
                </div>
              </div>
            </div>`;
        }
        if (e.orderId) {
          const statusInfo = ORDER_STATUSES[e.orderStatus] || { label: e.orderStatus, class: "" };
          const progress = e.orderQuantity > 0 ? Math.round((e.orderShipped / e.orderQuantity) * 100) : 0;
          return `
            <div class="event event-order" data-order-id="${e.orderId}" style="cursor:pointer;">
              <div class="event-order-header">
                <b>${e.date} · ${e.title}</b>
                <span class="status-badge ${statusInfo.class}">${statusInfo.label}</span>
              </div>
              <div class="meta">${e.detail}</div>
              <div class="order-progress" style="margin-top:8px;">
                <div class="order-progress-bar" style="width:${progress}%;"></div>
              </div>
              <div class="meta" style="font-size:11px;margin-top:4px;">已发 ${e.orderShipped.toLocaleString()} / ${e.orderQuantity.toLocaleString()} 尾（${progress}%），剩余 ${e.orderRemaining.toLocaleString()} 尾</div>
            </div>`;
        }
        if (e.shipmentId) {
          return `
            <div class="event event-shipment" data-shipment-id="${e.shipmentId}" style="cursor:pointer;">
              <div class="event-shipment-header">
                <b>${e.date} · ${e.title}</b>
                <span class="status-badge status-active">✓ 已发货</span>
              </div>
              <div class="meta">${e.detail}</div>
            </div>`;
        }
        if (e.isOldSale) {
          return `<div class="event event-old-sale"><b>${e.date} · ${e.title}</b><div class="meta" style="color:#999;">${e.detail}</div></div>`;
        }
        return `<div class="event"><b>${e.date} · ${e.title}</b><div class="meta ${e.detail.includes("偏低") ? "warning" : ""}">${e.detail}</div></div>`;
      }
    )
    .join("");

  timelineEl.querySelectorAll('[data-action="handle-warning"]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const warnId = btn.closest(".event-warning").dataset.warningId;
      const warning = (db.warnings || []).find((w) => w.id === warnId);
      if (!warning) return;
      const targetStatus = warning.status === "pending" ? "processing" : "resolved";
      openWarningHandleModal(warnId, targetStatus);
    };
  });

  timelineEl.querySelectorAll(".event-warning").forEach((evt) => {
    const warnId = evt.dataset.warningId;
    if (!warnId) return;
    evt.style.cursor = "pointer";
    evt.onclick = () => {
      document.querySelector('[data-tab="warning"]').click();
      setTimeout(() => {
        const card = document.querySelector(`.warning-card[data-id="${warnId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.style.boxShadow = "0 0 0 3px #f0c9a0, 0 4px 14px rgba(0,0,0,0.08)";
          setTimeout(() => { card.style.boxShadow = ""; }, 2500);
        }
      }, 200);
    };
  });

  timelineEl.querySelectorAll(".event-order").forEach((evt) => {
    const orderId = evt.dataset.orderId;
    if (!orderId) return;
    evt.onclick = () => {
      document.querySelector('[data-tab="order"]').click();
      setTimeout(() => {
        const card = document.querySelector(`.order-card[data-id="${orderId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.style.boxShadow = "0 0 0 3px #f0c9a0, 0 4px 14px rgba(0,0,0,0.08)";
          setTimeout(() => { card.style.boxShadow = ""; }, 2500);
        }
      }, 200);
    };
  });

  timelineEl.querySelectorAll(".event-shipment").forEach((evt) => {
    const shipmentId = evt.dataset.shipmentId;
    if (!shipmentId) return;
    evt.onclick = () => {
      document.querySelector('[data-tab="shipment"]').click();
      setTimeout(() => {
        const card = document.querySelector(`.shipment-card[data-id="${shipmentId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.style.boxShadow = "0 0 0 3px #f0c9a0, 0 4px 14px rgba(0,0,0,0.08)";
          setTimeout(() => { card.style.boxShadow = ""; }, 2500);
        }
      }, 200);
    };
  });
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

function renderCustomerStats() {
  const customers = db.customers || [];
  const totalCustomers = customers.length;
  const totalOrders = customers.reduce(
    (sum, c) => sum + (c.purchaseSummary?.orderCount || 0),
    0
  );
  const totalAmount = customers.reduce(
    (sum, c) => sum + (c.purchaseSummary?.totalAmount || 0),
    0
  );
  const regions = [...new Set(customers.map((c) => c.region).filter(Boolean))];

  document.getElementById("customerStats").innerHTML = [
    ["客户总数", totalCustomers],
    ["订单总数", totalOrders],
    ["累计金额", totalAmount + "元"],
    ["覆盖地区", regions.length + "个"],
  ]
    .map(
      ([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`
    )
    .join("");
}

function renderCustomerList() {
  const search = document.getElementById("customerSearch")?.value?.trim() || "";
  let customers = db.customers || [];
  if (search) {
    const lower = search.toLowerCase();
    customers = customers.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        (c.contact && c.contact.toLowerCase().includes(lower)) ||
        (c.region && c.region.toLowerCase().includes(lower)) ||
        (c.phone && c.phone.includes(search))
    );
  }
  const list = document.getElementById("customerList");
  if (!customers.length) {
    list.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:24px;text-align:center;">暂无客户数据，点击右上角「新增客户」添加</div>`;
    return;
  }
  list.innerHTML = customers
    .map(
      (c) => {
        const summary = c.purchaseSummary || {};
        const batchList = (summary.batches || [])
          .slice(0, 3)
          .map(
            (b) =>
              `<span class="customer-batch-tag">${b.batchId}${
                b.species ? " · " + b.species : ""
              }</span>`
          )
          .join("");
        return `
    <div class="customer-card" data-id="${c.id}">
      <h3>${c.name}</h3>
      <div class="customer-id">${c.id}</div>
      <div class="customer-info">
        ${c.contact ? `<div class="row"><span class="label">联系人</span><span>${c.contact}</span></div>` : ""}
        ${c.phone ? `<div class="row"><span class="label">电话</span><span>${c.phone}</span></div>` : ""}
        ${c.region ? `<div class="row"><span class="label">地区</span><span>${c.region}</span></div>` : ""}
      </div>
      ${
        summary.orderCount > 0
          ? `<div class="customer-purchase">
              <div class="purchase-header">
                <span>历史采购</span>
                <span class="purchase-count">${summary.orderCount} 单 / ${summary.totalAmount} 元</span>
              </div>
              <div class="purchase-batches">${batchList || '<span class="meta">暂无批次记录</span>'}</div>
             </div>`
          : `<div class="meta" style="margin-top:8px;font-size:12px;">暂无采购记录</div>`
      }
      ${
        c.note
          ? `<div class="meta" style="margin-top:8px;font-size:12px;">备注：${c.note}</div>`
          : ""
      }
      <div class="customer-actions">
        <button type="button" class="secondary" data-action="edit">编辑</button>
        <button type="button" class="danger" data-action="delete">删除</button>
      </div>
    </div>
  `;
      }
    )
    .join("");

  list.querySelectorAll(".customer-card").forEach((card) => {
    const id = card.dataset.id;
    const editBtn = card.querySelector('[data-action="edit"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    editBtn.onclick = (e) => { e.preventDefault(); openCustomerModal(id); };
    deleteBtn.onclick = (e) => { e.preventDefault(); deleteCustomer(id); };
  });
}

function renderCustomers() {
  renderCustomerStats();
  renderCustomerList();
}

function openCustomerModal(customerId = null, quickCreate = false, prefillName = "") {
  const customers = db.customers || [];
  const customer = customerId ? customers.find((c) => c.id === customerId) : null;
  const isEdit = !!customer;
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>${isEdit ? "编辑客户" : quickCreate ? "快速新增客户" : "新增客户"}</h2>
      <form id="customerForm">
        <label>客户编号 (ID)</label>
        <input name="id" required value="${customer?.id || ""}" ${
    isEdit ? "readonly" : ""
  } placeholder="如 C-001">
        <label>客户名称</label>
        <input name="name" required value="${customer?.name || prefillName}" placeholder="公司或个人名称">
        <label>联系人</label>
        <input name="contact" value="${customer?.contact || ""}" placeholder="如 张经理">
        <label>电话</label>
        <input name="phone" value="${customer?.phone || ""}" placeholder="手机号码">
        <label>地区</label>
        <input name="region" value="${customer?.region || ""}" placeholder="如 山东青岛">
        <label>备注</label>
        <textarea name="note">${customer?.note || ""}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">${isEdit ? "保存修改" : "新增客户"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  modal.querySelector("#customerForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    try {
      let result;
      if (isEdit) {
        result = await api("/api/customers/" + customerId, {
          method: "PUT",
          body: JSON.stringify(data),
        });
      } else {
        result = await api("/api/customers", {
          method: "POST",
          body: JSON.stringify(data),
        });
      }
      modal.remove();
      await load();

      if (quickCreate && result && result.id) {
        const select = document.getElementById("saleCustomerSelect");
        if (select) {
          select.value = result.id;
          select.dispatchEvent(new Event("change"));
        }
      }
    } catch (err) {
      alert(err.message);
    }
  };

  if (!isEdit && !customerId) {
    setTimeout(() => {
      const idInput = modal.querySelector('input[name="id"]');
      if (idInput && !idInput.value) {
        const nextNum = (customers.length + 1).toString().padStart(3, "0");
        idInput.value = "C-" + nextNum;
      }
    }, 50);
  }
}

async function deleteCustomer(customerId) {
  const customer = (db.customers || []).find((c) => c.id === customerId);
  if (!customer) return;
  if (!confirm("确定要删除客户「" + customer.name + "」吗？")) return;
  try {
    await api("/api/customers/" + customerId, { method: "DELETE" });
    await load();
  } catch (err) {
    alert(err.message);
  }
}

function bindCustomerEvents() {
  const addBtn = document.getElementById("addCustomerBtn");
  const search = document.getElementById("customerSearch");
  if (addBtn) addBtn.onclick = (e) => { e.preventDefault(); openCustomerModal(); };
  if (search) search.oninput = renderCustomerList;
}

function renderInventoryStats() {
  const inventories = db.inventories || [];
  const batchFilter = document.getElementById("inventoryBatchFilter")?.value || "";
  let filtered = inventories;
  if (batchFilter) {
    filtered = inventories.filter((i) => i.batchId === batchFilter);
  }

  const totalRecords = filtered.length;
  const totalDifference = filtered.reduce((sum, i) => sum + Number(i.difference || 0), 0);
  const avgDiffPercent = totalRecords > 0
    ? (filtered.reduce((sum, i) => {
        const sysEst = Number(i.systemEstimate || 0);
        const diff = Number(i.difference || 0);
        return sum + (sysEst > 0 ? (diff / sysEst) * 100 : 0);
      }, 0) / totalRecords).toFixed(2)
    : 0;

  const stats = [
    ["盘点记录数", totalRecords + " 次"],
    ["累计差异", (totalDifference >= 0 ? "+" : "") + totalDifference.toLocaleString() + " 尾"],
    ["平均差异率", avgDiffPercent + "%"],
  ];

  document.getElementById("inventoryStats").innerHTML = stats
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");
}

function renderInventoryList() {
  const inventories = db.inventories || [];
  const batchFilter = document.getElementById("inventoryBatchFilter")?.value || "";
  let filtered = inventories;
  if (batchFilter) {
    filtered = inventories.filter((i) => i.batchId === batchFilter);
  }
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  const list = document.getElementById("inventoryList");
  if (!filtered.length) {
    list.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:24px;text-align:center;">暂无盘点记录，点击右上角「新增盘点」添加</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((inv) => {
      const diffClass = inv.difference >= 0 ? "" : "warning";
      const methodLabel = INVENTORY_METHODS[inv.method]?.label || inv.method;
      const batch = db.batches?.find((b) => b.id === inv.batchId);
      const species = batch?.species || "";
      return `
    <div class="inventory-card" data-id="${inv.id}">
      <div class="inventory-header">
        <span class="status-badge ${inv.method === "full" ? "status-active" : "status-cleaning"}">${methodLabel}</span>
        <span class="inventory-batch">${inv.batchId}${species ? " · " + species : ""}</span>
      </div>
      <div class="inventory-id">${inv.id}${inv.poolId ? " · 池号 " + inv.poolId : ""}</div>
      <div class="inventory-info">
        ${inv.date ? `<div class="row"><span class="label">日期</span><span>${inv.date}</span></div>` : ""}
        <div class="row"><span class="label">系统估算</span><span>${inv.systemEstimate.toLocaleString()} 尾</span></div>
        <div class="row"><span class="label">抽样估算</span><span>${inv.manualEstimate.toLocaleString()} 尾</span></div>
        <div class="row"><span class="label">实际盘点</span><span><strong>${inv.actualCount.toLocaleString()} 尾</strong></span></div>
        <div class="row"><span class="label">差异</span><span><strong class="${diffClass}">${inv.difference >= 0 ? "+" : ""}${inv.difference.toLocaleString()} 尾</strong></span></div>
      </div>
      ${
        inv.operator || inv.note
          ? `<div class="meta" style="margin-top:8px;font-size:12px;">${inv.operator ? "盘点人：" + inv.operator : ""}${inv.note ? (inv.operator ? " · " : "") + "备注：" + inv.note : ""}</div>`
          : ""
      }
      <div class="inventory-change-row">
        <div class="inventory-change-item">
          <span class="label">校准前</span>
          <strong>${inv.beforeCount.toLocaleString()}</strong>
        </div>
        <div class="inventory-change-arrow ${diffClass}">${inv.difference >= 0 ? "↑" : "↓"}</div>
        <div class="inventory-change-item">
          <span class="label">校准后</span>
          <strong>${inv.afterCount.toLocaleString()}</strong>
        </div>
      </div>
      <div class="inventory-actions">
        <button type="button" class="danger" data-action="delete">删除</button>
      </div>
    </div>
  `;
    })
    .join("");

  list.querySelectorAll(".inventory-card").forEach((card) => {
    const id = card.dataset.id;
    const deleteBtn = card.querySelector('[data-action="delete"]');
    deleteBtn.onclick = (e) => { e.preventDefault(); deleteInventory(id); };
  });
}

function renderInventories() {
  const batchFilter = document.getElementById("inventoryBatchFilter");
  if (batchFilter && db.batches) {
    const currentVal = batchFilter.value;
    batchFilter.innerHTML =
      '<option value="">全部批次</option>' +
      db.batches.map((b) => `<option value="${b.id}">${b.id} · ${b.species}</option>`).join("");
    batchFilter.value = currentVal;
  }
  renderInventoryStats();
  renderInventoryList();
}

function openInventoryModal(prefillBatchId = null) {
  const batches = db.batches || [];
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>新增盘点校准</h2>
      <form id="inventoryForm">
        <label>批次</label>
        <select name="batchId" id="invBatchSelect" required>
          ${batches
            .map(
              (b) =>
                `<option value="${b.id}" ${prefillBatchId === b.id ? "selected" : ""}>${b.id} · ${b.species} · 当前估算 ${b.estimatedCount.toLocaleString()} 尾</option>`
            )
            .join("")}
        </select>
        <label>日期</label>
        <input name="date" type="date" required value="${new Date().toISOString().split("T")[0]}">
        <label>池号</label>
        <select name="poolId" id="invPoolSelect">
          ${db.ponds
            .filter((p) => p.status !== "maintenance")
            .map((p) => `<option value="${p.id}">${p.name} (${p.id})</option>`)
            .join("")}
        </select>
        <label>盘点方式</label>
        <select name="method">
          <option value="sampling">抽样估算</option>
          <option value="full">实际盘点</option>
        </select>
        <label>人工抽样估算数（尾）</label>
        <input name="manualEstimate" type="number" required placeholder="通过抽样估算的数量">
        <label>实际盘点数（尾）</label>
        <input name="actualCount" type="number" required placeholder="实际点数或称重换算的数量">
        <label>盘点人</label>
        <input name="operator" placeholder="选填">
        <label>备注</label>
        <textarea name="note" placeholder="盘点过程说明、差异原因分析等"></textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">保存盘点</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const updatePoolSelect = () => {
    const batchSelect = modal.querySelector("#invBatchSelect");
    const poolSelect = modal.querySelector("#invPoolSelect");
    const selectedBatch = batches.find((b) => b.id === batchSelect.value);
    if (selectedBatch && selectedBatch.currentPool) {
      poolSelect.value = selectedBatch.currentPool;
    }
  };

  modal.querySelector("#invBatchSelect").onchange = updatePoolSelect;
  updatePoolSelect();

  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  modal.querySelector("#inventoryForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api("/api/inventories", { method: "POST", body: JSON.stringify(data) });
      modal.remove();
      await load();
      alert("盘点校准已保存，批次估算数量已更新");
    } catch (err) {
      alert(err.message);
    }
  };
}

async function deleteInventory(inventoryId) {
  const inventory = (db.inventories || []).find((i) => i.id === inventoryId);
  if (!inventory) return;
  if (!confirm("确定要删除这条盘点记录吗？删除后批次估算数量将回退到上一次盘点校准后的值。")) return;
  try {
    await api("/api/inventories/" + inventoryId, { method: "DELETE" });
    await load();
  } catch (err) {
    alert(err.message);
  }
}

function bindInventoryEvents() {
  const addBtn = document.getElementById("addInventoryBtn");
  const batchFilter = document.getElementById("inventoryBatchFilter");
  if (addBtn) addBtn.onclick = (e) => { e.preventDefault(); openInventoryModal(batchSelect.value); };
  if (batchFilter) batchFilter.onchange = () => { renderInventoryStats(); renderInventoryList(); };
}

function renderCostStats() {
  const costItems = db.costItems || [];
  const batchFilter = document.getElementById("costBatchFilter")?.value || "";
  let filtered = costItems;
  if (batchFilter) {
    filtered = costItems.filter((c) => c.batchId === batchFilter);
  }

  const byCategory = {};
  COST_CATEGORIES.forEach((cat) => {
    byCategory[cat] = filtered
      .filter((c) => c.category === cat)
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  });
  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);

  const stats = [
    ["成本项目数", filtered.length + " 项"],
    ["总成本", total.toFixed(2) + " 元"],
  ];
  COST_CATEGORIES.forEach((cat) => {
    stats.push([cat, byCategory[cat].toFixed(2) + " 元"]);
  });

  document.getElementById("costStats").innerHTML = stats
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");
}

function renderCostList() {
  const costItems = db.costItems || [];
  const batchFilter = document.getElementById("costBatchFilter")?.value || "";
  let filtered = costItems;
  if (batchFilter) {
    filtered = costItems.filter((c) => c.batchId === batchFilter);
  }
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  const list = document.getElementById("costList");
  if (!filtered.length) {
    list.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:24px;text-align:center;">暂无成本数据，点击右上角「新增成本」添加</div>`;
    return;
  }

  const categoryColors = {
    "饲料": "status-active",
    "药品": "status-cleaning",
    "人工": "status-idle",
    "能源": "status-maintenance",
    "其他": "",
  };

  list.innerHTML = filtered
    .map((c) => `
    <div class="cost-card" data-id="${c.id}">
      <div class="cost-header">
        <span class="status-badge ${categoryColors[c.category] || ""}">${c.category}</span>
        <span class="cost-amount">¥${Number(c.amount).toFixed(2)}</span>
      </div>
      <div class="cost-id">${c.id} · ${c.batchId}</div>
      <div class="cost-info">
        ${c.date ? `<div class="row"><span class="label">日期</span><span>${c.date}</span></div>` : ""}
        ${c.quantity !== undefined && c.quantity !== null ? `<div class="row"><span class="label">数量</span><span>${c.quantity}${c.unit || ""}</span></div>` : ""}
      </div>
      ${
        c.description
          ? `<div class="meta" style="margin-top:8px;font-size:12px;">${c.description}</div>`
          : ""
      }
      <div class="cost-actions">
        <button type="button" class="secondary" data-action="edit">编辑</button>
        <button type="button" class="danger" data-action="delete">删除</button>
      </div>
    </div>
  `)
    .join("");

  list.querySelectorAll(".cost-card").forEach((card) => {
    const id = card.dataset.id;
    const editBtn = card.querySelector('[data-action="edit"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    editBtn.onclick = (e) => { e.preventDefault(); openCostModal(id); };
    deleteBtn.onclick = (e) => { e.preventDefault(); deleteCost(id); };
  });
}

function renderCosts() {
  const batchFilter = document.getElementById("costBatchFilter");
  if (batchFilter && db.batches) {
    const currentVal = batchFilter.value;
    batchFilter.innerHTML =
      '<option value="">全部批次</option>' +
      db.batches.map((b) => `<option value="${b.id}">${b.id} · ${b.species}</option>`).join("");
    batchFilter.value = currentVal;
  }
  renderCostStats();
  renderCostList();
}

function openCostModal(costId = null, prefillBatchId = null) {
  const costItems = db.costItems || [];
  const cost = costId ? costItems.find((c) => c.id === costId) : null;
  const isEdit = !!cost;
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>${isEdit ? "编辑成本项目" : "新增成本项目"}</h2>
      <form id="costForm">
        <label>批次</label>
        <select name="batchId" required>
          ${db.batches
            .map(
              (b) =>
                `<option value="${b.id}" ${
                  (cost?.batchId || prefillBatchId) === b.id ? "selected" : ""
                }>${b.id} · ${b.species}</option>`
            )
            .join("")}
        </select>
        <label>费用类别</label>
        <select name="category" required>
          ${COST_CATEGORIES.map(
            (c) => `<option value="${c}" ${cost?.category === c ? "selected" : ""}>${c}</option>`
          ).join("")}
        </select>
        <label>日期</label>
        <input name="date" type="date" required value="${cost?.date || ""}">
        <label>金额（元）</label>
        <input name="amount" type="number" step="0.01" min="0" required value="${cost?.amount || ""}">
        <label>数量（选填）</label>
        <input name="quantity" type="number" step="0.01" min="0" value="${cost?.quantity ?? ""}" placeholder="如 350">
        <label>单位（选填）</label>
        <input name="unit" value="${cost?.unit || ""}" placeholder="如 kg、L、工日">
        <label>说明（选填）</label>
        <textarea name="description" placeholder="费用详细说明">${cost?.description || ""}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">${isEdit ? "保存修改" : "新增成本"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  modal.querySelector("#costForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    try {
      if (isEdit) {
        await api("/api/costs/" + costId, { method: "PUT", body: JSON.stringify(data) });
      } else {
        await api("/api/costs", { method: "POST", body: JSON.stringify(data) });
      }
      modal.remove();
      await load();
    } catch (err) {
      alert(err.message);
    }
  };
}

async function deleteCost(costId) {
  const costItems = db.costItems || [];
  const cost = costItems.find((c) => c.id === costId);
  if (!cost) return;
  if (!confirm("确定要删除该成本项目吗？")) return;
  try {
    await api("/api/costs/" + costId, { method: "DELETE" });
    await load();
  } catch (err) {
    alert(err.message);
  }
}

function bindCostEvents() {
  const addBtn = document.getElementById("addCostBtn");
  const batchFilter = document.getElementById("costBatchFilter");
  if (addBtn) addBtn.onclick = (e) => { e.preventDefault(); openCostModal(null, batchSelect.value); };
  if (batchFilter) batchFilter.onchange = () => { renderCostStats(); renderCostList(); };
}

function bindSaleEvents() {
  const customerSelect = document.getElementById("saleCustomerSelect");
  const quickAddBtn = document.getElementById("quickAddCustomerBtn");
  const nameWrap = document.getElementById("saleCustomerNameWrap");
  const nameInput = document.getElementById("saleCustomerName");

  function updateCustomerInputVisibility() {
    if (customerSelect && customerSelect.value) {
      nameWrap.classList.add("hidden");
      if (nameInput) nameInput.value = "";
    } else {
      nameWrap.classList.remove("hidden");
    }
  }

  if (customerSelect) {
    customerSelect.onchange = updateCustomerInputVisibility;
    updateCustomerInputVisibility();
  }

  if (quickAddBtn) {
    quickAddBtn.onclick = (e) => {
      e.preventDefault();
      openCustomerModal(null, true);
    };
  }
}

function renderWarningStats() {
  const warnings = db.warnings || [];
  const total = warnings.length;
  const pending = warnings.filter((w) => w.status === "pending").length;
  const processing = warnings.filter((w) => w.status === "processing").length;
  const redCount = warnings.filter((w) => w.level === "red" && w.status === "pending").length;
  const yellowCount = warnings.filter((w) => w.level === "yellow" && w.status === "pending").length;
  document.getElementById("warningStats").innerHTML = [
    ["预警总数", total],
    ["待处理", pending],
    ["处理中", processing],
    ["红色待处理", redCount],
    ["黄色待处理", yellowCount],
  ]
    .map(
      ([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`
    )
    .join("");
}

function renderWarningList() {
  const warnings = db.warnings || [];
  const levelFilter = document.getElementById("warningLevelFilter")?.value || "";
  const statusFilter = document.getElementById("warningStatusFilter")?.value || "";
  const batchFilter = document.getElementById("warningBatchFilter")?.value || "";
  let filtered = [...warnings].sort((a, b) => b.date.localeCompare(a.date));
  if (levelFilter) filtered = filtered.filter((w) => w.level === levelFilter);
  if (statusFilter) filtered = filtered.filter((w) => w.status === statusFilter);
  if (batchFilter) filtered = filtered.filter((w) => w.batchId === batchFilter);

  const list = document.getElementById("warningList");
  if (!filtered.length) {
    list.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:24px;text-align:center;">暂无预警数据，系统会根据每日记录自动生成预警</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((w) => {
      const levelInfo = WARNING_LEVELS[w.level] || { label: w.level, class: "" };
      const statusInfo = WARNING_STATUS[w.status] || { label: w.status, class: "" };
      const reasonsHtml = (w.reasons || []).map((r) => `<div class="warning-reason-item">· ${r}</div>`).join("");
      const hasHistory = w.handleHistory && w.handleHistory.length > 0;
      return `
    <div class="warning-card ${w.level}" data-id="${w.id}">
      <div class="warning-header">
        <span class="status-badge ${levelInfo.class}">${levelInfo.label}</span>
        <span class="status-badge ${statusInfo.class}">${statusInfo.label}</span>
        <span class="spacer"></span>
        <button type="button" class="tiny-btn" data-action="detail" title="查看详情">ⓘ 详情${hasHistory ? `（${w.handleHistory.length}）` : ""}</button>
      </div>
      <div class="warning-id">${w.id} · ${w.batchId}${w.poolId ? " · " + w.poolId : ""}</div>
      <div class="warning-date">${w.date}</div>
      <div class="warning-reasons">${reasonsHtml}</div>
      ${w.handler ? `<div class="warning-handle-info"><span class="label">处理人</span><span>${w.handler}</span></div>` : ""}
      ${w.handleNote ? `<div class="warning-handle-info"><span class="label">处理备注</span><span>${w.handleNote}</span></div>` : ""}
      ${w.handleDate ? `<div class="warning-handle-info"><span class="label">处理日期</span><span>${w.handleDate}</span></div>` : ""}
      ${w.autoResolved ? `<div class="warning-handle-info auto-resolved"><span class="label">状态</span><span>系统自动解除</span></div>` : ""}
      <div class="warning-actions">
        ${w.status === "pending" ? `<button type="button" data-action="process">开始处理</button>` : ""}
        ${w.status === "pending" || w.status === "processing" ? `<button type="button" class="secondary" data-action="resolve">标记解决</button>` : ""}
        ${w.status === "pending" ? `<button type="button" class="danger" data-action="ignore">忽略</button>` : ""}
        <button type="button" class="secondary" data-action="delete">删除</button>
      </div>
    </div>
  `;
    })
    .join("");

  list.querySelectorAll(".warning-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll("[data-action]").forEach((btn) => {
      btn.onclick = async (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        if (action === "process") {
          openWarningHandleModal(id, "processing");
        } else if (action === "resolve") {
          openWarningHandleModal(id, "resolved");
        } else if (action === "ignore") {
          openWarningHandleModal(id, "ignored");
        } else if (action === "detail") {
          openWarningDetailModal(id);
        } else if (action === "delete") {
          if (!confirm("确定要删除此预警吗？")) return;
          try {
            await api("/api/warnings/" + id, { method: "DELETE" });
            await load();
            renderWarnings();
          } catch (err) {
            alert(err.message);
          }
        }
      };
    });
  });
}

async function openWarningDetailModal(warningId) {
  let detail;
  try {
    detail = await api("/api/warnings/" + warningId);
  } catch (err) {
    alert(err.message);
    return;
  }
  const w = detail.warning;
  const levelInfo = WARNING_LEVELS[w.level] || { label: w.level || "-", class: "" };
  const statusInfo = WARNING_STATUS[w.status] || { label: w.status, class: "" };
  const history = detail.handleHistory || w.handleHistory || [];
  const historyHtml = history.length
    ? history
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .map((h, idx) => {
          const fromLabel = WARNING_STATUS[h.fromStatus]?.label || h.fromStatus || "-";
          const toLabel = WARNING_STATUS[h.toStatus]?.label || h.toStatus;
          return `
            <div class="history-item">
              <div class="history-dot"></div>
              <div class="history-body">
                <div class="history-title">
                  <span class="status-badge" style="background:#e6eef0;color:#60727a;font-size:10px;padding:1px 6px;">${fromLabel}</span>
                  <span class="history-arrow">→</span>
                  <span class="status-badge ${WARNING_STATUS[h.toStatus]?.class || ""}">${toLabel}</span>
                  <span class="history-time">${new Date(h.at).toLocaleString("zh-CN")}</span>
                </div>
                ${h.handler ? `<div class="history-meta"><strong>操作人：</strong>${h.handler}</div>` : ""}
                ${h.note ? `<div class="history-meta"><strong>备注：</strong>${h.note}</div>` : ""}
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="meta" style="padding:12px;text-align:center;">暂无处理历史</div>`;

  const batch = detail.relatedBatch;
  const pool = detail.relatedPool;
  const rec = detail.relatedRecord;

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal modal-wide">
      <h2>预警详情 - ${w.id}</h2>
      <div class="detail-grid">
        <div class="detail-section">
          <h3>基本信息</h3>
          <div class="detail-row"><span class="label">预警等级</span><span class="status-badge ${levelInfo.class}">${levelInfo.label}</span></div>
          <div class="detail-row"><span class="label">处理状态</span><span class="status-badge ${statusInfo.class}">${statusInfo.label}</span></div>
          <div class="detail-row"><span class="label">触发日期</span><span>${w.date}</span></div>
          <div class="detail-row"><span class="label">创建时间</span><span>${w.createdAt ? new Date(w.createdAt).toLocaleString("zh-CN") : "-"}</span></div>
          ${w.processingAt ? `<div class="detail-row"><span class="label">开始处理</span><span>${new Date(w.processingAt).toLocaleString("zh-CN")}</span></div>` : ""}
          ${w.resolvedAt ? `<div class="detail-row"><span class="label">解决时间</span><span>${new Date(w.resolvedAt).toLocaleString("zh-CN")}</span></div>` : ""}
          ${w.autoResolved ? `<div class="detail-row auto-resolved"><span class="label">解除方式</span><span>系统自动解除（数据更新后阈值不再触发）</span></div>` : ""}
        </div>
        <div class="detail-section">
          <h3>关联信息</h3>
          <div class="detail-row"><span class="label">关联批次</span><span>${w.batchId}${batch ? "（" + batch.species + " · " + batch.status + "）" : ""}</span></div>
          <div class="detail-row"><span class="label">关联池号</span><span>${w.poolId || "-"}${pool ? "（" + pool.name + "）" : ""}</span></div>
          <div class="detail-row"><span class="label">关联记录</span><span>${w.recordId || "-"}</span></div>
        </div>
      </div>
      <div class="detail-section">
        <h3>触发原因</h3>
        <div class="warning-reasons">
          ${(w.reasons || []).map((r) => `<div class="warning-reason-item">· ${r}</div>`).join("")}
        </div>
      </div>
      ${rec ? `
      <div class="detail-section">
        <h3>关联每日记录数据</h3>
        <div class="related-record-grid">
          <div class="detail-row"><span class="label">水温</span><span>${rec.temperature}℃</span></div>
          <div class="detail-row"><span class="label">盐度</span><span>${rec.salinity}</span></div>
          <div class="detail-row"><span class="label">溶氧</span><span>${rec.oxygen}</span></div>
          <div class="detail-row"><span class="label">投喂量</span><span>${rec.feed}kg</span></div>
          <div class="detail-row"><span class="label">死亡率</span><span>${rec.mortality}%</span></div>
          <div class="detail-row"><span class="label">异常情况</span><span>${rec.abnormal || "-"}</span></div>
        </div>
      </div>
      ` : ""}
      ${w.handler || w.handleNote ? `
      <div class="detail-section">
        <h3>当前处理信息</h3>
        ${w.handler ? `<div class="detail-row"><span class="label">处理人</span><span>${w.handler}</span></div>` : ""}
        ${w.handleNote ? `<div class="detail-row"><span class="label">处理备注</span><span>${w.handleNote}</span></div>` : ""}
        ${w.handleDate ? `<div class="detail-row"><span class="label">处理日期</span><span>${w.handleDate}</span></div>` : ""}
      </div>
      ` : ""}
      <div class="detail-section">
        <h3>处理历史时间线</h3>
        <div class="history-timeline">${historyHtml}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" id="closeDetailBtn">关闭</button>
        ${w.status === "pending" ? `<button type="button" id="startProcessBtn">开始处理</button>` : ""}
        ${w.status === "pending" || w.status === "processing" ? `<button type="button" class="secondary" id="markResolveBtn">标记解决</button>` : ""}
        ${w.status === "pending" ? `<button type="button" class="danger" id="ignoreBtn">忽略</button>` : ""}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#closeDetailBtn").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  if (modal.querySelector("#startProcessBtn")) {
    modal.querySelector("#startProcessBtn").onclick = () => {
      modal.remove();
      openWarningHandleModal(warningId, "processing");
    };
  }
  if (modal.querySelector("#markResolveBtn")) {
    modal.querySelector("#markResolveBtn").onclick = () => {
      modal.remove();
      openWarningHandleModal(warningId, "resolved");
    };
  }
  if (modal.querySelector("#ignoreBtn")) {
    modal.querySelector("#ignoreBtn").onclick = () => {
      modal.remove();
      openWarningHandleModal(warningId, "ignored");
    };
  }
}

function renderWarnings() {
  const batchFilter = document.getElementById("warningBatchFilter");
  if (batchFilter && db.batches) {
    const currentVal = batchFilter.value;
    batchFilter.innerHTML =
      '<option value="">全部批次</option>' +
      db.batches.map((b) => `<option value="${b.id}">${b.id} · ${b.species}</option>`).join("");
    batchFilter.value = currentVal;
  }
  renderWarningStats();
  renderWarningList();
}

function openWarningHandleModal(warningId, targetStatus) {
  const warning = (db.warnings || []).find((w) => w.id === warningId);
  if (!warning) return;
  const statusLabel = WARNING_STATUS[targetStatus]?.label || targetStatus;
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>${statusLabel} - ${warning.id}</h2>
      <div class="warning-handle-summary">
        <div class="row"><span class="label">预警等级</span><span class="status-badge ${WARNING_LEVELS[warning.level]?.class || ""}">${WARNING_LEVELS[warning.level]?.label || warning.level}</span></div>
        <div class="row"><span class="label">关联批次</span><span>${warning.batchId}</span></div>
        <div class="row"><span class="label">触发日期</span><span>${warning.date}</span></div>
        <div class="row"><span class="label">触发原因</span><span>${(warning.reasons || []).join("；")}</span></div>
      </div>
      <form id="warningHandleForm">
        <label>处理人</label>
        <input name="handler" required placeholder="输入处理人姓名">
        <label>处理备注</label>
        <textarea name="handleNote" placeholder="详细描述处理措施和结果">${warning.handleNote || ""}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">确认${statusLabel}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.querySelector("#warningHandleForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api("/api/warnings/" + warningId + "/handle", {
        method: "PATCH",
        body: JSON.stringify({ status: targetStatus, handler: data.handler, handleNote: data.handleNote }),
      });
      modal.remove();
      await load();
      renderWarnings();
    } catch (err) {
      alert(err.message);
    }
  };
}

function openThresholdConfigModal() {
  const thresholds = db.warningThresholds || {};
  const t = thresholds.temperature || {};
  const s = thresholds.salinity || {};
  const o = thresholds.oxygen || {};
  const m = thresholds.mortality || {};
  const keywords = (thresholds.abnormalKeywords || []).join("、");
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>预警阈值配置</h2>
      <form id="thresholdForm">
        <h3 style="font-size:15px;margin:12px 0 6px;color:var(--blue);">水温阈值（℃）</h3>
        <label>黄色预警下限</label><input name="temperature.yellowMin" type="number" step="0.1" value="${t.yellowMin ?? 20}">
        <label>黄色预警上限</label><input name="temperature.yellowMax" type="number" step="0.1" value="${t.yellowMax ?? 32}">
        <label>红色预警下限</label><input name="temperature.redMin" type="number" step="0.1" value="${t.redMin ?? 18}">
        <label>红色预警上限</label><input name="temperature.redMax" type="number" step="0.1" value="${t.redMax ?? 35}">
        <h3 style="font-size:15px;margin:12px 0 6px;color:var(--blue);">盐度阈值</h3>
        <label>黄色预警下限</label><input name="salinity.yellowMin" type="number" step="0.1" value="${s.yellowMin ?? 15}">
        <label>黄色预警上限</label><input name="salinity.yellowMax" type="number" step="0.1" value="${s.yellowMax ?? 30}">
        <label>红色预警下限</label><input name="salinity.redMin" type="number" step="0.1" value="${s.redMin ?? 10}">
        <label>红色预警上限</label><input name="salinity.redMax" type="number" step="0.1" value="${s.redMax ?? 35}">
        <h3 style="font-size:15px;margin:12px 0 6px;color:var(--blue);">溶氧阈值（mg/L）</h3>
        <label>黄色预警上限（低于此值）</label><input name="oxygen.yellowMax" type="number" step="0.1" value="${o.yellowMax ?? 4.5}">
        <label>红色预警上限（低于此值）</label><input name="oxygen.redMax" type="number" step="0.1" value="${o.redMax ?? 3}">
        <h3 style="font-size:15px;margin:12px 0 6px;color:var(--blue);">死亡率阈值（%）</h3>
        <label>黄色预警下限</label><input name="mortality.yellowMin" type="number" step="0.1" value="${m.yellowMin ?? 2}">
        <label>红色预警下限</label><input name="mortality.redMin" type="number" step="0.1" value="${m.redMin ?? 5}">
        <h3 style="font-size:15px;margin:12px 0 6px;color:var(--blue);">异常文本关键词</h3>
        <label>关键词（用中文顿号「、」分隔）</label><textarea name="abnormalKeywords">${keywords}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">保存配置</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.querySelector("#thresholdForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    const parseNum = (v) => (v !== "" && v != null ? Number(v) : undefined);
    const payload = {
      temperature: {
        yellowMin: parseNum(data["temperature.yellowMin"]),
        yellowMax: parseNum(data["temperature.yellowMax"]),
        redMin: parseNum(data["temperature.redMin"]),
        redMax: parseNum(data["temperature.redMax"]),
      },
      salinity: {
        yellowMin: parseNum(data["salinity.yellowMin"]),
        yellowMax: parseNum(data["salinity.yellowMax"]),
        redMin: parseNum(data["salinity.redMin"]),
        redMax: parseNum(data["salinity.redMax"]),
      },
      oxygen: {
        yellowMax: parseNum(data["oxygen.yellowMax"]),
        redMax: parseNum(data["oxygen.redMax"]),
      },
      mortality: {
        yellowMin: parseNum(data["mortality.yellowMin"]),
        redMin: parseNum(data["mortality.redMin"]),
      },
      abnormalKeywords: data.abnormalKeywords
        ? data.abnormalKeywords.split("、").map((s) => s.trim()).filter(Boolean)
        : [],
    };
    try {
      await api("/api/warnings/thresholds", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      modal.remove();
      await load();
      renderWarnings();
    } catch (err) {
      alert(err.message);
    }
  };
}

function bindWarningEvents() {
  const levelFilter = document.getElementById("warningLevelFilter");
  const statusFilter = document.getElementById("warningStatusFilter");
  const batchFilter = document.getElementById("warningBatchFilter");
  const thresholdBtn = document.getElementById("thresholdConfigBtn");
  if (levelFilter) levelFilter.onchange = renderWarningList;
  if (statusFilter) statusFilter.onchange = renderWarningList;
  if (batchFilter) batchFilter.onchange = renderWarningList;
  if (thresholdBtn) thresholdBtn.onclick = (e) => { e.preventDefault(); openThresholdConfigModal(); };
}

function renderOrderStats() {
  const orders = db.orders || [];
  const batchFilter = document.getElementById("orderBatchFilter")?.value || "";
  const statusFilter = document.getElementById("orderStatusFilter")?.value || "";
  let filtered = orders;
  if (batchFilter) filtered = filtered.filter((o) => o.batchId === batchFilter);
  if (statusFilter) filtered = filtered.filter((o) => o.status === statusFilter);

  const total = filtered.length;
  const pending = filtered.filter((o) => o.status === "pending").length;
  const partial = filtered.filter((o) => o.status === "partial").length;
  const completed = filtered.filter((o) => o.status === "completed").length;
  const cancelled = filtered.filter((o) => o.status === "cancelled").length;
  const totalQty = filtered
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + Number(o.orderQuantity || 0), 0);
  const totalAmount = filtered
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  const stats = [
    ["订单总数", total + " 单"],
    ["待发货", pending + " 单"],
    ["部分发货", partial + " 单"],
    ["已完成", completed + " 单"],
    ["已取消", cancelled + " 单"],
    ["订购总量", totalQty.toLocaleString() + " 尾"],
    ["订单总额", totalAmount.toFixed(2) + " 元"],
  ];

  document.getElementById("orderStats").innerHTML = stats
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");
}

function renderOrderList() {
  const orders = db.orders || [];
  const batchFilter = document.getElementById("orderBatchFilter")?.value || "";
  const statusFilter = document.getElementById("orderStatusFilter")?.value || "";
  let filtered = orders;
  if (batchFilter) filtered = filtered.filter((o) => o.batchId === batchFilter);
  if (statusFilter) filtered = filtered.filter((o) => o.status === statusFilter);
  filtered = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const list = document.getElementById("orderList");
  if (!filtered.length) {
    list.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:24px;text-align:center;">暂无订单数据，点击右上角「新增订单」添加</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((o) => {
      const statusInfo = ORDER_STATUSES[o.status] || { label: o.status, class: "" };
      const customerName = o.customerInfo?.name || o.customerName || "未知客户";
      const batch = db.batches?.find((b) => b.id === o.batchId);
      const species = batch?.species || "";
      return `
    <div class="order-card" data-id="${o.id}">
      <div class="order-header">
        <span class="status-badge ${statusInfo.class}">${statusInfo.label}</span>
        <span class="order-batch">${o.batchId}${species ? " · " + species : ""}</span>
      </div>
      <div class="order-id">${o.id}</div>
      <div class="order-customer"><strong>${customerName}</strong></div>
      ${o.customerInfo?.phone ? `<div class="order-contact">${o.customerInfo.contact || ""} · ${o.customerInfo.phone}</div>` : ""}
      <div class="order-info" style="margin-top:10px;">
        <div class="row"><span class="label">订购数量</span><span>${o.orderQuantity.toLocaleString()} 尾</span></div>
        <div class="row"><span class="label">已发货</span><span>${o.shippedQuantity.toLocaleString()} 尾</span></div>
        <div class="row"><span class="label">剩余</span><span class="${o.remainingQuantity > 0 ? "" : "meta"}">${o.remainingQuantity.toLocaleString()} 尾</span></div>
        <div class="row"><span class="label">单价</span><span>${Number(o.unitPrice).toFixed(4)} 元/尾</span></div>
        <div class="row"><span class="label">订单金额</span><strong>¥${o.totalAmount.toFixed(2)}</strong></div>
        <div class="row"><span class="label">已发金额</span><span>¥${o.shippedAmount.toFixed(2)}</span></div>
        <div class="row"><span class="label">交付日期</span><span>${o.deliveryDate || "-"}</span></div>
        <div class="row"><span class="label">创建时间</span><span>${new Date(o.createdAt).toLocaleString("zh-CN")}</span></div>
      </div>
      ${o.note ? `<div class="meta" style="margin-top:8px;font-size:12px;">备注：${o.note}</div>` : ""}
      ${o.shipmentCount > 0 ? `<div class="meta" style="margin-top:8px;font-size:12px;color:var(--blue);">已发货 ${o.shipmentCount} 次</div>` : ""}
      <div class="order-actions">
        ${o.status !== "cancelled" && o.status !== "completed" ? `<button type="button" data-action="ship">发货</button>` : ""}
        ${o.status !== "cancelled" && o.shipmentCount === 0 ? `<button type="button" class="secondary" data-action="edit">编辑</button>` : ""}
        ${o.status !== "cancelled" && o.shipmentCount === 0 ? `<button type="button" class="danger" data-action="cancel">取消</button>` : ""}
        ${o.shipmentCount === 0 ? `<button type="button" class="danger" data-action="delete">删除</button>` : ""}
      </div>
    </div>
  `;
    })
    .join("");

  list.querySelectorAll(".order-card").forEach((card) => {
    const id = card.dataset.id;
    const shipBtn = card.querySelector('[data-action="ship"]');
    const editBtn = card.querySelector('[data-action="edit"]');
    const cancelBtn = card.querySelector('[data-action="cancel"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (shipBtn) shipBtn.onclick = (e) => { e.preventDefault(); openShipmentModal(null, id); };
    if (editBtn) editBtn.onclick = (e) => { e.preventDefault(); openOrderModal(id); };
    if (cancelBtn) cancelBtn.onclick = (e) => { e.preventDefault(); cancelOrder(id); };
    if (deleteBtn) deleteBtn.onclick = (e) => { e.preventDefault(); deleteOrder(id); };
  });
}

function renderOrders() {
  const batchFilter = document.getElementById("orderBatchFilter");
  if (batchFilter && db.batches) {
    const currentVal = batchFilter.value;
    batchFilter.innerHTML =
      '<option value="">全部批次</option>' +
      db.batches.map((b) => `<option value="${b.id}">${b.id} · ${b.species}</option>`).join("");
    batchFilter.value = currentVal;
  }
  renderOrderStats();
  renderOrderList();
}

function openOrderModal(orderId = null, prefillBatchId = null) {
  const orders = db.orders || [];
  const order = orderId ? orders.find((o) => o.id === orderId) : null;
  const isEdit = !!order;
  const batches = db.batches || [];
  const customers = db.customers || [];

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>${isEdit ? "编辑订单" : "新增订单"}</h2>
      <form id="orderForm">
        <label>批次</label>
        <select name="batchId" id="orderBatchSelect" required>
          ${batches
            .map(
              (b) =>
                `<option value="${b.id}" ${(order?.batchId || prefillBatchId) === b.id ? "selected" : ""}>${b.id} · ${b.species} · 可售 ${b.estimatedCount.toLocaleString()} 尾</option>`
            )
            .join("")}
        </select>
        <label>客户</label>
        <div class="order-customer-row">
          <select name="customerId" id="orderCustomerSelect">
            <option value="">请选择客户（选填）</option>
            ${customers
              .map(
                (c) =>
                  `<option value="${c.id}" ${order?.customerId === c.id ? "selected" : ""}>${c.name} (${c.contact || "-"} · ${c.phone || "-"})</option>`
              )
              .join("")}
          </select>
          <button type="button" class="secondary" id="orderQuickAddCustomerBtn">+ 新客户</button>
        </div>
        <div id="orderCustomerNameWrap">
          <label>或直接输入客户名称</label>
          <input name="customerName" id="orderCustomerName" placeholder="手动输入客户名称" value="${order?.customerName || ""}">
        </div>
        <label>订购数量（尾）</label>
        <input name="orderQuantity" type="number" min="1" required value="${order?.orderQuantity || ""}" placeholder="输入订购数量">
        <label>单价（元/尾）</label>
        <input name="unitPrice" type="number" step="0.0001" min="0" required value="${order?.unitPrice || ""}" placeholder="如 0.05">
        <label>交付日期</label>
        <input name="deliveryDate" type="date" required value="${order?.deliveryDate || ""}">
        <label>备注（选填）</label>
        <textarea name="note" placeholder="订单备注信息">${order?.note || ""}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">${isEdit ? "保存修改" : "创建订单"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const updateCustomerInputVisibility = () => {
    const customerSelect = modal.querySelector("#orderCustomerSelect");
    const nameWrap = modal.querySelector("#orderCustomerNameWrap");
    const nameInput = modal.querySelector("#orderCustomerName");
    if (customerSelect && customerSelect.value) {
      nameWrap.classList.add("hidden");
      if (nameInput) nameInput.value = "";
    } else {
      nameWrap.classList.remove("hidden");
    }
  };

  modal.querySelector("#orderCustomerSelect").onchange = updateCustomerInputVisibility;
  updateCustomerInputVisibility();

  modal.querySelector("#orderQuickAddCustomerBtn").onclick = (e) => {
    e.preventDefault();
    openCustomerModal(null, true);
  };

  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.querySelector("#orderForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    if (!data.customerId && !data.customerName) {
      alert("请选择客户或输入客户名称");
      return;
    }
    if (!data.customerName) delete data.customerName;
    if (!data.customerId) delete data.customerId;
    try {
      if (isEdit) {
        await api("/api/orders/" + orderId, { method: "PUT", body: JSON.stringify(data) });
      } else {
        await api("/api/orders", { method: "POST", body: JSON.stringify(data) });
      }
      modal.remove();
      await load();
    } catch (err) {
      alert(err.message);
    }
  };
}

async function cancelOrder(orderId) {
  const order = (db.orders || []).find((o) => o.id === orderId);
  if (!order) return;
  if (!confirm("确定要取消订单「" + order.id + "」吗？")) return;
  try {
    await api("/api/orders/" + orderId, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    await load();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteOrder(orderId) {
  const order = (db.orders || []).find((o) => o.id === orderId);
  if (!order) return;
  if (!confirm("确定要删除订单「" + order.id + "」吗？删除后不可恢复。")) return;
  try {
    await api("/api/orders/" + orderId, { method: "DELETE" });
    await load();
  } catch (err) {
    alert(err.message);
  }
}

function bindOrderEvents() {
  const addBtn = document.getElementById("addOrderBtn");
  const quickSaleBtn = document.getElementById("quickSaleBtn");
  const batchFilter = document.getElementById("orderBatchFilter");
  const statusFilter = document.getElementById("orderStatusFilter");
  if (addBtn) addBtn.onclick = (e) => { e.preventDefault(); openOrderModal(null, batchSelect.value); };
  if (quickSaleBtn) quickSaleBtn.onclick = (e) => { e.preventDefault(); setTab("sale"); };
  if (batchFilter) batchFilter.onchange = () => { renderOrderStats(); renderOrderList(); };
  if (statusFilter) statusFilter.onchange = () => { renderOrderStats(); renderOrderList(); };
}

function renderShipmentStats() {
  const shipments = db.shipments || [];
  const batchFilter = document.getElementById("shipmentBatchFilter")?.value || "";
  let filtered = shipments;
  if (batchFilter) filtered = filtered.filter((s) => s.batchId === batchFilter);

  const total = filtered.length;
  const totalQty = filtered.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
  const totalAmount = filtered.reduce((sum, s) => sum + Number(s.amount || 0), 0);

  const stats = [
    ["发货记录", total + " 次"],
    ["发货总量", totalQty.toLocaleString() + " 尾"],
    ["发货总额", totalAmount.toFixed(2) + " 元"],
  ];

  document.getElementById("shipmentStats").innerHTML = stats
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");
}

function renderShipmentList() {
  const shipments = db.shipments || [];
  const batchFilter = document.getElementById("shipmentBatchFilter")?.value || "";
  const orderFilter = document.getElementById("shipmentStatusFilter")?.value || "";
  let filtered = shipments;
  if (batchFilter) filtered = filtered.filter((s) => s.batchId === batchFilter);
  if (orderFilter) filtered = filtered.filter((s) => s.orderId === orderFilter);
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  const list = document.getElementById("shipmentList");
  if (!filtered.length) {
    list.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:24px;text-align:center;">暂无发货记录，点击右上角「新增发货」添加</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((s) => {
      const customerName = s.customerInfo?.name || s.customerName || "未知客户";
      const batch = db.batches?.find((b) => b.id === s.batchId);
      const species = batch?.species || "";
      const order = s.orderInfo;
      return `
    <div class="shipment-card" data-id="${s.id}">
      <div class="shipment-header">
        <span class="shipment-batch">${s.batchId}${species ? " · " + species : ""}</span>
        <span class="shipment-amount">¥${s.amount.toFixed(2)}</span>
      </div>
      <div class="shipment-id">${s.id}</div>
      <div class="shipment-customer"><strong>${customerName}</strong></div>
      <div class="shipment-info" style="margin-top:10px;">
        <div class="row"><span class="label">关联订单</span><span>${s.orderId}</span></div>
        ${order ? `<div class="row"><span class="label">订单总量</span><span>${order.orderQuantity.toLocaleString()} 尾</span></div>` : ""}
        ${order ? `<div class="row"><span class="label">订单已发</span><span>${order.shippedQuantity.toLocaleString()} 尾</span></div>` : ""}
        ${order ? `<div class="row"><span class="label">订单剩余</span><span>${order.remainingQuantity.toLocaleString()} 尾</span></div>` : ""}
        <div class="row"><span class="label">本次发货</span><strong>${s.quantity.toLocaleString()} 尾</strong></div>
        <div class="row"><span class="label">发货日期</span><span>${s.date}</span></div>
        ${order ? `<div class="row"><span class="label">单价</span><span>${Number(order.unitPrice).toFixed(4)} 元/尾</span></div>` : ""}
      </div>
      ${s.note ? `<div class="meta" style="margin-top:8px;font-size:12px;">备注：${s.note}</div>` : ""}
      <div class="shipment-actions">
        <button type="button" class="danger" data-action="delete">删除</button>
      </div>
    </div>
  `;
    })
    .join("");

  list.querySelectorAll(".shipment-card").forEach((card) => {
    const id = card.dataset.id;
    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (deleteBtn) deleteBtn.onclick = (e) => { e.preventDefault(); deleteShipment(id); };
  });
}

function renderShipments() {
  const batchFilter = document.getElementById("shipmentBatchFilter");
  const orderFilter = document.getElementById("shipmentStatusFilter");
  if (batchFilter && db.batches) {
    const currentVal = batchFilter.value;
    batchFilter.innerHTML =
      '<option value="">全部批次</option>' +
      db.batches.map((b) => `<option value="${b.id}">${b.id} · ${b.species}</option>`).join("");
    batchFilter.value = currentVal;
  }
  if (orderFilter && db.orders) {
    const currentVal = orderFilter.value;
    const validOrders = (db.orders || []).filter(
      (o) => o.status !== "cancelled" && o.remainingQuantity > 0
    );
    orderFilter.innerHTML =
      '<option value="">全部订单</option>' +
      validOrders
        .map((o) => {
          const customerName = o.customerInfo?.name || o.customerName || "未知客户";
          return `<option value="${o.id}">${o.id} · ${customerName} · 剩余 ${o.remainingQuantity.toLocaleString()} 尾</option>`;
        })
        .join("");
    orderFilter.value = currentVal;
  }
  renderShipmentStats();
  renderShipmentList();
}

function openShipmentModal(shipmentId = null, prefillOrderId = null) {
  const orders = (db.orders || []).filter(
    (o) => o.status !== "cancelled" && o.remainingQuantity > 0
  );
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <h2>新增发货</h2>
      <form id="shipmentForm">
        <label>选择订单</label>
        <select name="orderId" id="shipmentOrderSelect" required>
          <option value="">请选择订单</option>
          ${orders
            .map((o) => {
              const customerName = o.customerInfo?.name || o.customerName || "未知客户";
              const batch = db.batches?.find((b) => b.id === o.batchId);
              const species = batch?.species || "";
              return `<option value="${o.id}" ${prefillOrderId === o.id ? "selected" : ""}>${o.id} · ${customerName} · ${o.batchId}${species ? " · " + species : ""} · 剩余 ${o.remainingQuantity.toLocaleString()} 尾</option>`;
            })
            .join("")}
        </select>
        <div id="shipmentOrderInfo" style="margin-top:10px;padding:12px;background:#f8f9fa;border-radius:6px;"></div>
        <label>发货数量（尾）</label>
        <input name="quantity" id="shipmentQuantity" type="number" min="1" required placeholder="输入发货数量">
        <div id="shipmentAvailableInfo" class="meta" style="font-size:12px;margin-top:4px;"></div>
        <label>发货日期</label>
        <input name="date" type="date" required value="${new Date().toISOString().split("T")[0]}">
        <label>备注（选填）</label>
        <textarea name="note" placeholder="发货备注信息"></textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit">确认发货</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const updateOrderInfo = async () => {
    const orderSelect = modal.querySelector("#shipmentOrderSelect");
    const orderInfo = modal.querySelector("#shipmentOrderInfo");
    const availableInfo = modal.querySelector("#shipmentAvailableInfo");
    const quantityInput = modal.querySelector("#shipmentQuantity");
    const orderId = orderSelect.value;
    if (!orderId) {
      orderInfo.innerHTML = "";
      availableInfo.innerHTML = "";
      return;
    }
    try {
      const order = await api("/api/orders/" + orderId);
      const availableRes = await api("/api/batches/" + order.batchId + "/available");
      const customerName = order.customerInfo?.name || order.customerName || "未知客户";
      orderInfo.innerHTML = `
        <div class="row"><span class="label">客户</span><span>${customerName}</span></div>
        <div class="row"><span class="label">订购数量</span><span>${order.orderQuantity.toLocaleString()} 尾</span></div>
        <div class="row"><span class="label">已发货</span><span>${order.shippedQuantity.toLocaleString()} 尾</span></div>
        <div class="row"><span class="label">订单剩余</span><strong>${order.remainingQuantity.toLocaleString()} 尾</strong></div>
        <div class="row"><span class="label">批次可售</span><strong>${availableRes.availableQuantity.toLocaleString()} 尾</strong></div>
        <div class="row"><span class="label">单价</span><span>${Number(order.unitPrice).toFixed(4)} 元/尾</span></div>
      `;
      availableInfo.innerHTML = `最多可发 ${Math.min(order.remainingQuantity, availableRes.availableQuantity).toLocaleString()} 尾（订单剩余 ${order.remainingQuantity.toLocaleString()} 尾，批次可售 ${availableRes.availableQuantity.toLocaleString()} 尾）`;
      quantityInput.max = Math.min(order.remainingQuantity, availableRes.availableQuantity);
    } catch (err) {
      orderInfo.innerHTML = `<span class="warning">${err.message}</span>`;
    }
  };

  modal.querySelector("#shipmentOrderSelect").onchange = updateOrderInfo;
  if (prefillOrderId) updateOrderInfo();

  modal.querySelector("#cancelBtn").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.querySelector("#shipmentForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api("/api/shipments", { method: "POST", body: JSON.stringify(data) });
      modal.remove();
      await load();
      alert("发货记录已保存");
    } catch (err) {
      alert(err.message);
    }
  };
}

async function deleteShipment(shipmentId) {
  const shipment = (db.shipments || []).find((s) => s.id === shipmentId);
  if (!shipment) return;
  if (!confirm("确定要删除这条发货记录吗？删除后订单状态会自动更新。")) return;
  try {
    await api("/api/shipments/" + shipmentId, { method: "DELETE" });
    await load();
  } catch (err) {
    alert(err.message);
  }
}

function bindShipmentEvents() {
  const addBtn = document.getElementById("addShipmentBtn");
  const batchFilter = document.getElementById("shipmentBatchFilter");
  const orderFilter = document.getElementById("shipmentStatusFilter");
  if (addBtn) addBtn.onclick = (e) => { e.preventDefault(); openShipmentModal(); };
  if (batchFilter) batchFilter.onchange = () => { renderShipmentStats(); renderShipmentList(); };
  if (orderFilter) orderFilter.onchange = () => { renderShipmentStats(); renderShipmentList(); };
}

function renderWarningBanner() {
  const warnings = db.warnings || [];
  const pending = warnings.filter((w) => w.status === "pending" || w.status === "processing");
  const banner = document.getElementById("warningBanner");
  if (!pending.length) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return;
  }
  const redPending = pending.filter((w) => w.level === "red");
  const yellowPending = pending.filter((w) => w.level === "yellow");
  const processingCount = pending.filter((w) => w.status === "processing").length;
  banner.classList.remove("hidden");

  const quickList = pending
    .sort((a, b) => {
      if (a.level === "red" && b.level !== "red") return -1;
      if (a.level !== "red" && b.level === "red") return 1;
      return b.date.localeCompare(a.date);
    })
    .slice(0, 3)
    .map((w) => {
      const levelInfo = WARNING_LEVELS[w.level] || { label: w.level, class: "" };
      const statusInfo = WARNING_STATUS[w.status] || { label: w.status, class: "" };
      return `
        <div class="warning-banner-item" data-warn-id="${w.id}">
          <span class="status-badge ${levelInfo.class}">${levelInfo.label}</span>
          <span class="status-badge ${statusInfo.class}" style="font-size:10px;padding:1px 6px;">${statusInfo.label}</span>
          <span class="warning-banner-item-batch">${w.batchId}</span>
          <span class="warning-banner-item-text">${(w.reasons || [])[0] || ""}</span>
        </div>
      `;
    })
    .join("");

  banner.innerHTML = `
    <div class="warning-banner-main" onclick="document.querySelector('[data-tab=warning]').click()">
      <span class="warning-banner-icon">⚠</span>
      <span class="warning-banner-title">
        水质预警：<strong class="warn-red">${redPending.length}</strong> 条红色、
        <strong class="warn-yellow">${yellowPending.length}</strong> 条黄色待处理
        ${processingCount > 0 ? `，${processingCount} 条处理中` : ""}
      </span>
      <span class="warning-banner-link">预警中心 →</span>
    </div>
    <div class="warning-banner-list">
      ${quickList}
    </div>
  `;

  banner.querySelectorAll(".warning-banner-item").forEach((item) => {
    item.onclick = (e) => {
      e.stopPropagation();
      const warnId = item.dataset.warnId;
      document.querySelector('[data-tab="warning"]').click();
      setTimeout(() => {
        const card = document.querySelector(`.warning-card[data-id="${warnId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.style.boxShadow = "0 0 0 3px #f0c9a0, 0 4px 14px rgba(0,0,0,0.08)";
          setTimeout(() => { card.style.boxShadow = ""; }, 2500);
        }
      }, 200);
    };
  });
}

let dataioPendingRecords = [];

function bindDataIoEvents() {
  dataioPendingRecords = [];
  const fileInput = document.getElementById("dataioFileInput");
  const previewBtn = document.getElementById("dataioPreviewBtn");
  const templateBtn = document.getElementById("dataioDownloadTemplate");
  const previewResult = document.getElementById("dataioPreviewResult");

  document.querySelectorAll(".dataio-export-btn").forEach((btn) => {
    btn.onclick = () => {
      const type = btn.dataset.export;
      window.open("/api/export/" + type, "_blank");
    };
  });

  fileInput.onchange = () => {
    previewBtn.disabled = !fileInput.files.length;
    previewResult.classList.add("hidden");
    dataioPendingRecords = [];
  };

  templateBtn.onclick = () => {
    const lines = [
      "batchId,date,poolId,temperature,salinity,oxygen,feed,mortality,abnormal",
      "# 必填字段说明：batchId=批次号, date=日期(YYYY-MM-DD), temperature=水温(℃), salinity=盐度, oxygen=溶氧(mg/L), feed=投喂量(kg), mortality=死亡率(%)",
      "# 选填字段说明：poolId=池号, abnormal=异常情况(默认为'无')",
      "B-260601,2026-06-14,P-03,28.0,22,6.2,20,0.5,无",
      "B-260601,2026-06-15,P-03,27.8,21.5,6.0,19,0.3,无",
      "B-260601,2026-06-16,P-03,27.5,22.5,5.8,21,0.4,无",
      "B-260601,2026-06-17,P-03,28.1,22.0,5.9,20.5,0.3,少量浮头",
      "B-260601,2026-06-18,P-03,27.9,21.8,6.1,20,0.2,无",
    ];
    const csv = lines.join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "records_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  previewBtn.onclick = async () => {
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    const csv = await file.text();
    try {
      const result = await api("/api/import/records/preview", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      dataioPendingRecords = result.validRows || [];
      renderDataIoPreview(result);
    } catch (err) {
      previewResult.classList.remove("hidden");
      previewResult.innerHTML = `<div class="dataio-error">预检失败：${err.message}</div>`;
    }
  };
}

function renderDataIoPreview(result) {
  const previewResult = document.getElementById("dataioPreviewResult");
  previewResult.classList.remove("hidden");

  const errorTypeLabels = {
    missing_field: "字段缺失",
    batch_not_found: "批次不存在",
    invalid_number: "数值非法",
    invalid_format: "格式错误",
    duplicate_existing: "重复日期",
    duplicate_in_file: "文件内重复",
  };

  let html = '<div class="dataio-preview-summary">';
  html += `<div class="dataio-stat"><span>总行数</span><strong>${result.totalRows}</strong></div>`;
  html += `<div class="dataio-stat dataio-stat-success"><span>有效行</span><strong>${result.validCount}</strong></div>`;
  html += `<div class="dataio-stat dataio-stat-error"><span>错误行</span><strong>${result.errorCount}</strong></div>`;
  html += `<div class="dataio-stat dataio-stat-warn"><span>警告</span><strong>${result.warningCount}</strong></div>`;
  html += "</div>";

  if (result.errors.length > 0) {
    html += '<div class="dataio-errors-section"><h4>错误详情</h4><div class="dataio-error-list">';
    result.errors.forEach((e) => {
      const typeLabel = errorTypeLabels[e.type] || e.type;
      html += `<div class="dataio-error-item dataio-error-type-${e.type}"><span class="dataio-error-type">${typeLabel}</span><span class="dataio-error-msg">${e.message}</span></div>`;
    });
    html += "</div></div>";
  }

  if (result.warnings.length > 0) {
    html += '<div class="dataio-warnings-section"><h4>警告详情</h4><div class="dataio-warning-list">';
    result.warnings.forEach((w) => {
      const typeLabel = errorTypeLabels[w.type] || w.type;
      html += `<div class="dataio-warning-item"><span class="dataio-error-type">${typeLabel}</span><span class="dataio-error-msg">${w.message}</span></div>`;
    });
    html += "</div></div>";
  }

  if (result.preview.length > 0) {
    html += '<div class="dataio-preview-section"><h4>有效数据预览（最多20行）</h4>';
    html += '<div class="dataio-preview-table-wrap"><table class="dataio-preview-table"><thead><tr>';
    const cols = ["batchId", "date", "poolId", "temperature", "salinity", "oxygen", "feed", "mortality", "abnormal"];
    const colLabels = ["批次", "日期", "池号", "水温", "盐度", "溶氧", "投喂kg", "死亡率%", "异常"];
    cols.forEach((_, i) => { html += `<th>${colLabels[i]}</th>`; });
    html += "</tr></thead><tbody>";
    result.preview.forEach((row) => {
      html += "<tr>";
      cols.forEach((c) => { html += `<td>${row[c] != null ? row[c] : ""}</td>`; });
      html += "</tr>";
    });
    html += "</tbody></table></div></div>";
  }

  if (result.validCount > 0) {
    html += '<div class="dataio-confirm-area">';
    html += `<button type="button" id="dataioConfirmBtn" class="dataio-confirm-btn">确认导入 ${result.validCount} 条记录</button>`;
    html += '<button type="button" id="dataioCancelBtn" class="dataio-cancel-btn">取消</button>';
    html += "</div>";
  }

  previewResult.innerHTML = html;

  const confirmBtn = document.getElementById("dataioConfirmBtn");
  const cancelBtn = document.getElementById("dataioCancelBtn");

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "导入中...";
      try {
        const importResult = await api("/api/import/records/confirm", {
          method: "POST",
          body: JSON.stringify({ records: dataioPendingRecords }),
        });
        dataioPendingRecords = [];
        let msg = `<div class="dataio-success">导入完成：成功 <strong>${importResult.importedCount}</strong> 条，跳过 <strong>${importResult.skippedCount}</strong> 条${importResult.warningsGenerated > 0 ? "，自动生成预警 <strong>" + importResult.warningsGenerated + "</strong> 条" : ""}`;
        if (importResult.skippedCount > 0) {
          msg += "<div style='margin-top:8px;font-size:12px;'>跳过详情：" + importResult.skipped.map((s) => s.batchId + " " + s.date + "（" + s.reason + "）").join("；") + "</div>";
        }
        msg += `<div style='margin-top:10px;'><button type="button" id="dataioGoRecordBtn" class="dataio-cancel-btn">去「每日记录」查看 →</button></div></div>`;
        previewResult.innerHTML = msg;
        document.getElementById("dataioFileInput").value = "";
        document.getElementById("dataioPreviewBtn").disabled = true;
        await load();
        const goBtn = document.getElementById("dataioGoRecordBtn");
        if (goBtn) goBtn.onclick = () => setTab("record");
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "确认导入";
        alert("导入失败：" + err.message);
      }
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      previewResult.classList.add("hidden");
      dataioPendingRecords = [];
      document.getElementById("dataioFileInput").value = "";
      document.getElementById("dataioPreviewBtn").disabled = true;
    };
  }
}

function setTab(tab) {
  activeTab = tab;
  tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "pond") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    const pondContainer = document.getElementById("pondContainer");
    pondContainer.classList.remove("hidden");
    pondContainer.innerHTML = forms[tab];
    fillSelects();
    renderPonds();
    bindPondEvents();
  } else if (tab === "customer") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    const customerContainer = document.getElementById("customerContainer");
    customerContainer.classList.remove("hidden");
    customerContainer.innerHTML = forms[tab];
    fillSelects();
    renderCustomers();
    bindCustomerEvents();
  } else if (tab === "inventory") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.remove("hidden");
    inventoryContainer.innerHTML = forms[tab];
    fillSelects();
    renderInventories();
    bindInventoryEvents();
  } else if (tab === "cost") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    const costContainer = document.getElementById("costContainer");
    costContainer.classList.remove("hidden");
    costContainer.innerHTML = forms[tab];
    fillSelects();
    renderCosts();
    bindCostEvents();
  } else if (tab === "warning") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    const warningContainer = document.getElementById("warningContainer");
    warningContainer.classList.remove("hidden");
    warningContainer.innerHTML = forms[tab];
    fillSelects();
    renderWarnings();
    bindWarningEvents();
  } else if (tab === "order") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("shipmentContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    const orderContainer = document.getElementById("orderContainer");
    orderContainer.classList.remove("hidden");
    orderContainer.innerHTML = forms[tab];
    fillSelects();
    renderOrders();
    bindOrderEvents();
  } else if (tab === "shipment") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("orderContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    const shipmentContainer = document.getElementById("shipmentContainer");
    shipmentContainer.classList.remove("hidden");
    shipmentContainer.innerHTML = forms[tab];
    fillSelects();
    renderShipments();
    bindShipmentEvents();
  } else if (tab === "dataio") {
    form.innerHTML = "";
    form.classList.add("hidden");
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("orderContainer").classList.add("hidden");
    document.getElementById("shipmentContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    const dataioContainer = document.getElementById("dataioContainer");
    dataioContainer.classList.remove("hidden");
    dataioContainer.innerHTML = forms[tab];
    fillSelects();
    bindDataIoEvents();
  } else {
    form.classList.remove("hidden");
    form.innerHTML = forms[tab];
    document.getElementById("pondContainer").classList.add("hidden");
    document.getElementById("customerContainer").classList.add("hidden");
    document.getElementById("costContainer").classList.add("hidden");
    document.getElementById("warningContainer").classList.add("hidden");
    document.getElementById("orderContainer").classList.add("hidden");
    document.getElementById("shipmentContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    document.getElementById("dataioContainer").classList.add("hidden");
    inventoryContainer.classList.add("hidden");
    fillSelects();
    if (tab === "sale") {
      bindSaleEvents();
    }
    renderTrace();
  }
}

async function load() {
  db = await api("/api/state");
  if (!db.customers) db.customers = [];
  if (!db.costItems) db.costItems = [];
  if (!db.warnings) db.warnings = [];
  if (!db.warningThresholds) db.warningThresholds = {};
  if (!db.inventories) db.inventories = [];
  if (!db.orders) db.orders = [];
  if (!db.shipments) db.shipments = [];
  try {
    const enrichedCustomers = await api("/api/customers");
    db.customers = enrichedCustomers;
  } catch (e) {
  }
  try {
    const enrichedOrders = await api("/api/orders");
    db.orders = enrichedOrders;
  } catch (e) {
  }
  try {
    const enrichedShipments = await api("/api/shipments");
    db.shipments = enrichedShipments;
  } catch (e) {
  }
  fillSelects();
  renderWarningBanner();
  if (activeTab === "pond") {
    renderPonds();
    bindPondEvents();
  } else if (activeTab === "customer") {
    renderCustomers();
    bindCustomerEvents();
  } else if (activeTab === "inventory") {
    renderInventories();
    bindInventoryEvents();
  } else if (activeTab === "cost") {
    renderCosts();
    bindCostEvents();
  } else if (activeTab === "warning") {
    renderWarnings();
    bindWarningEvents();
  } else if (activeTab === "order") {
    renderOrders();
    bindOrderEvents();
  } else if (activeTab === "shipment") {
    renderShipments();
    bindShipmentEvents();
  } else if (activeTab === "dataio") {
    bindDataIoEvents();
  } else {
    renderTrace();
    if (activeTab === "sale") {
      bindSaleEvents();
    }
  }
}

tabs.forEach((btn) => (btn.onclick = () => setTab(btn.dataset.tab)));
batchSelect.onchange = renderTrace;
document.querySelector("#reload").onclick = load;
form.onsubmit = async (event) => {
  event.preventDefault();
  if (activeTab === "pond" || activeTab === "customer" || activeTab === "cost" || activeTab === "warning" || activeTab === "dataio") return;
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
    if (activeTab === "sale" && !data.customerId && !data.customer) {
      alert("请选择客户或输入客户名称");
      return;
    }
    if (activeTab === "sale" && !data.customer) {
      delete data.customer;
    }
    if (activeTab === "sale" && !data.customerId) {
      delete data.customerId;
    }
    const result = await api(path, { method: "POST", body: JSON.stringify(data) });
    form.reset();
    await load();
    if (activeTab === "record" && result.warnings && result.warnings.length > 0) {
      const count = result.warnings.length;
      const levels = result.warnings.map((w) => WARNING_LEVELS[w.level]?.label || w.level).join("、");
      alert("已自动生成 " + count + " 条预警：" + levels);
    }
  } catch (err) {
    alert(err.message);
  }
};

setTab("record");
load();
