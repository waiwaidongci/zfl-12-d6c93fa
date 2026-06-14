const ROLLBACK_BLACKLIST = new Set(["farm_create", "farm_update", "farm_delete", "farm_set_default", "threshold_update", "rollback"]);
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

function summarize(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) return obj.map(summarizeItem);
  return summarizeItem(obj);
}

function summarizeItem(item) {
  if (!item || typeof item !== "object") return item;
  const s = { ...item };
  if (s.handleHistory && Array.isArray(s.handleHistory) && s.handleHistory.length > 2) {
    s.handleHistory = s.handleHistory.slice(0, 2).concat([`...共${s.handleHistory.length}条`]);
  }
  return s;
}

export function writeLog(db, { operator, action, targetType, targetId, before, after, farmId, meta }) {
  if (!db.opLogs) db.opLogs = [];
  const entry = {
    id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    operator: operator || "系统",
    action: action || "unknown",
    targetType: targetType || "",
    targetId: targetId || "",
    before: summarize(before),
    after: summarize(after),
    farmId: farmId || "",
    meta: meta || null,
    rolledBack: false,
    createdAt: new Date().toISOString(),
  };
  db.opLogs.push(entry);
  return entry;
}

export function canRollback(logEntry) {
  if (!logEntry) return { ok: false, reason: "日志不存在" };
  if (logEntry.rolledBack) return { ok: false, reason: "该操作已被撤销" };
  if (ROLLBACK_BLACKLIST.has(logEntry.action)) return { ok: false, reason: "该操作类型不支持回滚" };
  const elapsed = Date.now() - new Date(logEntry.createdAt).getTime();
  if (elapsed > ROLLBACK_WINDOW_MS) return { ok: false, reason: "超过24小时回滚窗口" };
  return { ok: true, reason: "" };
}

export function canRollbackLatest(db, logEntry, farmId) {
  const check = canRollback(logEntry);
  if (!check.ok) return check;
  const latest = getLatestRollbackable(db, farmId ?? logEntry.farmId);
  if (!latest || latest.id !== logEntry.id) {
    return { ok: false, reason: "只能撤销最近一次可回滚操作" };
  }
  return { ok: true, reason: "" };
}

export function executeRollback(db, logEntry, farmId) {
  const check = canRollbackLatest(db, logEntry, farmId);
  if (!check.ok) return { success: false, error: check.reason };

  const { action, targetType, before, after, meta } = logEntry;

  if (action.endsWith("_create")) {
    return rollbackCreate(db, targetType, after, logEntry);
  }

  if (action.endsWith("_delete")) {
    return rollbackDelete(db, targetType, before, logEntry);
  }

  if (action.endsWith("_update") || action.endsWith("_handle") || action.endsWith("_status")) {
    return rollbackUpdate(db, targetType, before, after, logEntry);
  }

  return { success: false, error: `不支持回滚操作类型: ${action}` };
}

function getCollection(db, targetType) {
  const map = {
    batch: "batches",
    record: "records",
    transfer: "transfers",
    sale: "sales",
    cost: "costItems",
    warning: "warnings",
    pond: "ponds",
    inventory: "inventories",
    order: "orders",
    shipment: "shipments",
    customer: "customers",
    farm: "farms",
    threshold: "warningThresholds",
  };
  return map[targetType] || targetType;
}

function rollbackCreate(db, targetType, after, logEntry) {
  const collection = getCollection(db, targetType);
  if (collection === "warningThresholds") return { success: false, error: "阈值创建不可回滚" };

  const arr = db[collection];
  if (!Array.isArray(arr)) return { success: false, error: `集合 ${collection} 不存在` };

  const createdItem = Array.isArray(after) ? after[0] : after;
  if (!createdItem || !createdItem.id) return { success: false, error: "无法定位被创建的记录" };

  const idx = arr.findIndex((item) => item.id === createdItem.id);
  if (idx === -1) return { success: false, error: "被创建的记录已不存在" };

  arr.splice(idx, 1);

  if (targetType === "batch" && Array.isArray(db.transfers)) {
    db.transfers = db.transfers.filter((t) => !(t.batchId === createdItem.id && t.reason === "新批次入池"));
  }

  if (targetType === "record" && Array.isArray(db.warnings)) {
    db.warnings = db.warnings.filter((w) => w.recordId !== createdItem.id);
  }

  if (targetType === "transfer" && logEntry.meta && logEntry.meta.batchId) {
    const batch = (db.batches || []).find((b) => b.id === logEntry.meta.batchId);
    if (batch && logEntry.meta.previousPool !== undefined) {
      batch.currentPool = logEntry.meta.previousPool;
    }
  }

  if (targetType === "inventory" && logEntry.meta && logEntry.meta.batchId) {
    const batch = (db.batches || []).find((b) => b.id === logEntry.meta.batchId);
    if (batch && logEntry.meta.previousEstimatedCount != null) {
      batch.estimatedCount = logEntry.meta.previousEstimatedCount;
    }
  }

  logEntry.rolledBack = true;
  return { success: true, message: `已撤销创建 ${targetType}(${createdItem.id})` };
}

function rollbackDelete(db, targetType, before, logEntry) {
  const collection = getCollection(db, targetType);
  if (collection === "warningThresholds") return { success: false, error: "阈值删除不可回滚" };

  const arr = db[collection];
  if (!Array.isArray(arr)) return { success: false, error: `集合 ${collection} 不存在` };

  const deletedItem = Array.isArray(before) ? before[0] : before;
  if (!deletedItem) return { success: false, error: "无删除前快照" };

  if (deletedItem.id && arr.some((item) => item.id === deletedItem.id)) {
    return { success: false, error: "同ID记录已存在，无法恢复" };
  }

  const originalIndex = deletedItem._originalIndex;
  if (originalIndex != null && originalIndex >= 0 && originalIndex <= arr.length) {
    arr.splice(originalIndex, 0, deletedItem);
  } else {
    arr.push(deletedItem);
  }

  if (targetType === "inventory" && deletedItem.batchId) {
    const batch = (db.batches || []).find((b) => b.id === deletedItem.batchId);
    if (batch) {
      batch.estimatedCount = deletedItem.beforeCount;
    }
  }

  logEntry.rolledBack = true;
  return { success: true, message: `已恢复删除的 ${targetType}(${deletedItem.id})` };
}

function rollbackUpdate(db, targetType, before, after, logEntry) {
  const collection = getCollection(db, targetType);

  if (collection === "warningThresholds") {
    if (before && typeof before === "object" && !Array.isArray(before)) {
      db.warningThresholds = { ...before };
      logEntry.rolledBack = true;
      return { success: true, message: "已恢复预警阈值配置" };
    }
    return { success: false, error: "无阈值变更前快照" };
  }

  const arr = db[collection];
  if (!Array.isArray(arr)) return { success: false, error: `集合 ${collection} 不存在` };

  const beforeItem = Array.isArray(before) ? before[0] : before;
  const afterItem = Array.isArray(after) ? after[0] : after;
  if (!beforeItem || !beforeItem.id) return { success: false, error: "无变更前快照或缺少ID" };

  const idx = arr.findIndex((item) => item.id === beforeItem.id);
  if (idx === -1) return { success: false, error: "目标记录已不存在" };

  arr[idx] = { ...beforeItem };

  if (targetType === "inventory" && beforeItem.batchId) {
    const batch = (db.batches || []).find((b) => b.id === beforeItem.batchId);
    if (batch) {
      batch.estimatedCount = beforeItem.beforeCount != null ? beforeItem.beforeCount : beforeItem.systemEstimate;
    }
  }

  logEntry.rolledBack = true;
  return { success: true, message: `已恢复 ${targetType}(${beforeItem.id}) 的变更` };
}

export function getLatestRollbackable(db, farmId) {
  if (!db.opLogs || !db.opLogs.length) return null;
  const logs = farmId ? db.opLogs.filter((l) => l.farmId === farmId) : db.opLogs;
  for (let i = logs.length - 1; i >= 0; i--) {
    const check = canRollback(logs[i]);
    if (check.ok) {
      return logs[i];
    }
  }
  return null;
}
