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

function generateTxnId() {
  return `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function beginTxn(db, { operator, farmId, description } = {}) {
  return {
    txnId: generateTxnId(),
    operator: operator || "系统",
    farmId: farmId || "",
    description: description || "",
    logs: [],
    collections: new Map(),
    batchIds: new Set(),
    farmIds: new Set(),
  };
}

export function writeLog(db, { operator, action, targetType, targetId, before, after, farmId, meta, txnId, txnIndex, txnTotal }) {
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
  if (txnId) {
    entry.txnId = txnId;
    if (txnIndex != null) entry.txnIndex = txnIndex;
    if (txnTotal != null) entry.txnTotal = txnTotal;
  }
  db.opLogs.push(entry);
  return entry;
}

export function writeLogToTxn(txn, db, { action, targetType, targetId, before, after, farmId, meta }) {
  const logEntry = writeLog(db, {
    operator: txn.operator,
    action,
    targetType,
    targetId,
    before,
    after,
    farmId: farmId || txn.farmId,
    meta,
    txnId: txn.txnId,
  });
  txn.logs.push(logEntry);
  if (farmId) txn.farmIds.add(farmId);
  else if (txn.farmId) txn.farmIds.add(txn.farmId);
  const key = targetType;
  if (!txn.collections.has(key)) txn.collections.set(key, 0);
  txn.collections.set(key, txn.collections.get(key) + 1);
  if (meta && meta.batchId) txn.batchIds.add(meta.batchId);
  if (before && before.batchId) txn.batchIds.add(before.batchId);
  if (after && after.batchId) txn.batchIds.add(after.batchId);
  if (targetType === "batch" && targetId) txn.batchIds.add(targetId);
  return logEntry;
}

export function commitTxn(db, txn, { description } = {}) {
  if (!txn || !txn.logs || txn.logs.length === 0) return null;
  const total = txn.logs.length;
  txn.logs.forEach((log, i) => {
    log.txnIndex = i;
    log.txnTotal = total;
  });
  const collections = {};
  for (const [k, v] of txn.collections.entries()) collections[k] = v;
  const firstLog = txn.logs[0];
  firstLog.txnSummary = {
    txnId: txn.txnId,
    description: description || txn.description || "",
    affectedCollections: collections,
    affectedBatchIds: Array.from(txn.batchIds),
    farmIds: Array.from(txn.farmIds),
    crossFarm: txn.farmIds.size > 1,
    totalEntries: total,
  };
  return firstLog.txnSummary;
}

export function getTxnLogs(db, txnId) {
  if (!db.opLogs || !txnId) return [];
  return db.opLogs
    .filter((l) => l.txnId === txnId)
    .sort((a, b) => (a.txnIndex ?? 0) - (b.txnIndex ?? 0));
}

export function getTxnFirstLog(db, txnId) {
  const logs = getTxnLogs(db, txnId);
  return logs.find((l) => l.txnSummary) || logs[0] || null;
}

export function canRollback(logEntry) {
  if (!logEntry) return { ok: false, reason: "日志不存在" };
  if (logEntry.rolledBack) return { ok: false, reason: "该操作已被撤销" };
  if (ROLLBACK_BLACKLIST.has(logEntry.action)) return { ok: false, reason: "该操作类型不支持回滚" };
  const elapsed = Date.now() - new Date(logEntry.createdAt).getTime();
  if (elapsed > ROLLBACK_WINDOW_MS) return { ok: false, reason: "超过24小时回滚窗口" };
  return { ok: true, reason: "" };
}

function isSameTarget(a, b) {
  if (!a || !b) return false;
  if (a.targetType !== b.targetType) return false;
  if (!a.targetId || !b.targetId) return false;
  const aIds = String(a.targetId).split(",").map((s) => s.trim()).filter(Boolean);
  const bIds = String(b.targetId).split(",").map((s) => s.trim()).filter(Boolean);
  for (const aid of aIds) {
    if (bIds.includes(aid)) return true;
  }
  return false;
}

function extractTargetIds(logEntry) {
  const ids = new Set();
  if (logEntry.targetId) {
    String(logEntry.targetId).split(",").forEach((s) => s.trim() && ids.add(s.trim()));
  }
  const examine = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(examine);
      return;
    }
    if (obj.id && logEntry.targetType && typeof obj.id === "string") {
      ids.add(obj.id);
    }
    if (obj.batchId) ids.add(obj.batchId);
  };
  examine(logEntry.before);
  examine(logEntry.after);
  return ids;
}

export function isDataOverwritten(db, logEntry, afterLogId = null) {
  if (!db.opLogs || !logEntry) return { overwritten: false, by: null };
  const logIdx = db.opLogs.findIndex((l) => l.id === logEntry.id);
  if (logIdx === -1) return { overwritten: false, by: null };
  const startIdx = afterLogId ? db.opLogs.findIndex((l) => l.id === afterLogId) : logIdx + 1;
  const effectiveStart = startIdx === -1 ? logIdx + 1 : startIdx;
  const targetType = logEntry.targetType;
  const targetIds = extractTargetIds(logEntry);
  for (let i = effectiveStart; i < db.opLogs.length; i++) {
    const later = db.opLogs[i];
    if (later.rolledBack) continue;
    if (later.action === "rollback") continue;
    if (later.targetType !== targetType) continue;
    const laterIds = extractTargetIds(later);
    for (const tid of targetIds) {
      if (laterIds.has(tid)) {
        return { overwritten: true, by: later };
      }
    }
  }
  return { overwritten: false, by: null };
}

export function canRollbackTxn(db, txnId) {
  const txnLogs = getTxnLogs(db, txnId);
  if (txnLogs.length === 0) return { ok: false, reason: "事务不存在" };
  const firstLog = txnLogs[0];
  const summary = firstLog.txnSummary;
  if (summary && summary.crossFarm) {
    return { ok: false, reason: `跨场区事务（涉及 ${summary.farmIds.length} 个场区）禁止回滚` };
  }
  for (const log of txnLogs) {
    const check = canRollback(log);
    if (!check.ok) return { ok: false, reason: `${log.action}: ${check.reason}` };
  }
  const txnLastCreatedAt = txnLogs[txnLogs.length - 1].createdAt;
  for (const log of txnLogs) {
    const overwrite = isDataOverwritten(db, log);
    if (overwrite.overwritten && overwrite.by) {
      if (overwrite.by.txnId === txnId) continue;
      if (overwrite.by.createdAt <= txnLastCreatedAt) continue;
      return {
        ok: false,
        reason: `数据已被后续操作覆盖：${overwrite.by.action} @ ${new Date(overwrite.by.createdAt).toLocaleString("zh-CN")}`,
      };
    }
  }
  return { ok: true, reason: "" };
}

export function canRollbackLatest(db, logEntry, farmId) {
  if (logEntry && logEntry.txnId) {
    const txnCheck = canRollbackTxn(db, logEntry.txnId);
    if (!txnCheck.ok) return txnCheck;
    const latest = getLatestRollbackable(db, farmId ?? logEntry.farmId);
    const latestTxnId = latest?.txnId;
    if (!latestTxnId || latestTxnId !== logEntry.txnId) {
      return { ok: false, reason: "只能撤销最近一次可回滚操作事务" };
    }
    return { ok: true, reason: "" };
  }
  const check = canRollback(logEntry);
  if (!check.ok) return check;
  const latest = getLatestRollbackable(db, farmId ?? logEntry.farmId);
  if (!latest || latest.id !== logEntry.id) {
    return { ok: false, reason: "只能撤销最近一次可回滚操作" };
  }
  return { ok: true, reason: "" };
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
    lineage: "lineages",
  };
  return map[targetType] || targetType;
}

function rollbackCreate(db, targetType, after, logEntry) {
  const collection = getCollection(db, targetType);
  if (collection === "warningThresholds") return { success: false, error: "阈值创建不可回滚" };

  const arr = db[collection];
  if (!Array.isArray(arr)) return { success: false, error: `集合 ${collection} 不存在` };

  const createdItems = Array.isArray(after) ? after : [after];
  for (const createdItem of createdItems) {
    if (!createdItem || !createdItem.id) continue;
    const idx = arr.findIndex((item) => item.id === createdItem.id);
    if (idx !== -1) arr.splice(idx, 1);
  }

  if (targetType === "batch" && Array.isArray(db.transfers)) {
    for (const createdItem of createdItems) {
      if (!createdItem || !createdItem.id) continue;
      db.transfers = db.transfers.filter((t) => !(t.batchId === createdItem.id && t.reason === "新批次入池"));
    }
  }

  if (targetType === "record" && Array.isArray(db.warnings)) {
    for (const createdItem of createdItems) {
      if (!createdItem || !createdItem.id) continue;
      db.warnings = db.warnings.filter((w) => w.recordId !== createdItem.id);
    }
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

  if (targetType === "lineage" && Array.isArray(db.transfers) && logEntry.meta) {
    if (logEntry.meta.lineageId) {
      db.transfers = db.transfers.filter((t) => t.lineageId !== logEntry.meta.lineageId);
    }
    if (logEntry.meta.sourceBatchIds && Array.isArray(logEntry.meta.sourceBatchIds) && logEntry.meta.sourceBatchBeforeCounts) {
      logEntry.meta.sourceBatchIds.forEach((bid, i) => {
        const batch = (db.batches || []).find((b) => b.id === bid);
        if (batch && logEntry.meta.sourceBatchBeforeCounts[i] != null) {
          batch.estimatedCount = logEntry.meta.sourceBatchBeforeCounts[i];
        }
      });
    }
    if (logEntry.meta.targetBatchIds && Array.isArray(logEntry.meta.targetBatchIds) && logEntry.meta.targetBatchBeforeCounts) {
      logEntry.meta.targetBatchIds.forEach((bid, i) => {
        const batch = (db.batches || []).find((b) => b.id === bid);
        if (batch && logEntry.meta.targetBatchBeforeCounts[i] != null) {
          batch.estimatedCount = logEntry.meta.targetBatchBeforeCounts[i];
          if (logEntry.meta.targetBatchBeforePools && logEntry.meta.targetBatchBeforePools[i]) {
            batch.currentPool = logEntry.meta.targetBatchBeforePools[i];
          }
        }
      });
    }
  }

  logEntry.rolledBack = true;
  const firstItem = createdItems[0];
  return { success: true, message: `已撤销创建 ${targetType}(${firstItem?.id || ""})${createdItems.length > 1 ? ` 等${createdItems.length}条` : ""}` };
}

function rollbackDelete(db, targetType, before, logEntry) {
  const collection = getCollection(db, targetType);
  if (collection === "warningThresholds") return { success: false, error: "阈值删除不可回滚" };

  const arr = db[collection];
  if (!Array.isArray(arr)) return { success: false, error: `集合 ${collection} 不存在` };

  const deletedItems = Array.isArray(before) ? before : [before];
  for (const deletedItem of deletedItems) {
    if (!deletedItem) continue;
    if (deletedItem.id && arr.some((item) => item.id === deletedItem.id)) continue;
    const originalIndex = deletedItem._originalIndex;
    if (originalIndex != null && originalIndex >= 0 && originalIndex <= arr.length) {
      arr.splice(originalIndex, 0, deletedItem);
    } else {
      arr.push(deletedItem);
    }
  }

  if (targetType === "inventory") {
    for (const deletedItem of deletedItems) {
      if (!deletedItem || !deletedItem.batchId) continue;
      const batch = (db.batches || []).find((b) => b.id === deletedItem.batchId);
      if (batch) {
        const remainingInventories = (db.inventories || [])
          .filter((i) => i.batchId === batch.id)
          .sort((a, b) => a.date.localeCompare(b.date));
        if (remainingInventories.length > 0) {
          batch.estimatedCount = remainingInventories[remainingInventories.length - 1].afterCount;
        } else if (deletedItem.beforeCount != null) {
          batch.estimatedCount = deletedItem.beforeCount;
        }
      }
    }
  }

  logEntry.rolledBack = true;
  const firstItem = deletedItems[0];
  return { success: true, message: `已恢复删除的 ${targetType}(${firstItem?.id || ""})${deletedItems.length > 1 ? ` 等${deletedItems.length}条` : ""}` };
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

  const beforeItems = Array.isArray(before) ? before : [before];
  for (const beforeItem of beforeItems) {
    if (!beforeItem || !beforeItem.id) continue;
    const idx = arr.findIndex((item) => item.id === beforeItem.id);
    if (idx !== -1) arr[idx] = { ...beforeItem };
  }

  if (targetType === "inventory") {
    for (const beforeItem of beforeItems) {
      if (!beforeItem || !beforeItem.batchId) continue;
      const batch = (db.batches || []).find((b) => b.id === beforeItem.batchId);
      if (batch) {
        batch.estimatedCount = beforeItem.beforeCount != null ? beforeItem.beforeCount : beforeItem.systemEstimate;
      }
    }
  }

  logEntry.rolledBack = true;
  const firstItem = beforeItems[0];
  return { success: true, message: `已恢复 ${targetType}(${firstItem?.id || ""})${beforeItems.length > 1 ? ` 等${beforeItems.length}条` : ""} 的变更` };
}

export function executeRollback(db, logEntry, farmId) {
  if (logEntry && logEntry.txnId) {
    return executeTxnRollback(db, logEntry.txnId, farmId);
  }
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

export function executeTxnRollback(db, txnId, farmId) {
  const check = canRollbackTxn(db, txnId);
  if (!check.ok) return { success: false, error: check.reason };
  const txnLogs = getTxnLogs(db, txnId);
  const reversedLogs = [...txnLogs].reverse();
  const results = [];
  for (const log of reversedLogs) {
    if (log.rolledBack) continue;
    const { action, targetType, before, after } = log;
    let res;
    if (action.endsWith("_create")) {
      res = rollbackCreate(db, targetType, after, log);
    } else if (action.endsWith("_delete")) {
      res = rollbackDelete(db, targetType, before, log);
    } else if (action.endsWith("_update") || action.endsWith("_handle") || action.endsWith("_status")) {
      res = rollbackUpdate(db, targetType, before, after, log);
    } else {
      continue;
    }
    results.push(res);
  }
  const successCount = results.filter((r) => r?.success).length;
  if (successCount === 0 && results.length > 0) {
    return { success: false, error: results[results.length - 1]?.error || "事务回滚失败" };
  }
  return {
    success: true,
    message: `事务回滚成功：共处理 ${txnLogs.length} 条变更，成功 ${successCount} 条`,
    details: results,
  };
}

export function getLatestRollbackable(db, farmId) {
  if (!db.opLogs || !db.opLogs.length) return null;
  const logs = farmId ? db.opLogs.filter((l) => l.farmId === farmId) : db.opLogs;
  const seenTxns = new Set();
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (log.txnId) {
      if (seenTxns.has(log.txnId)) continue;
      seenTxns.add(log.txnId);
      const txnCheck = canRollbackTxn(db, log.txnId);
      if (txnCheck.ok) return log;
    } else {
      const check = canRollback(log);
      if (check.ok) return log;
    }
  }
  return null;
}
