import {
  canRollbackLatest,
  executeRollback,
  getLatestRollbackable,
  getTxnLogs,
  getTxnFirstLog,
  canRollbackTxn,
  executeTxnRollback,
} from "../utils/audit-log.js";

const ACTION_LABELS = {
  batch_create: "新建批次",
  record_create: "新增每日记录",
  record_update: "修改每日记录",
  record_delete: "删除每日记录",
  transfer_create: "分池合池",
  sale_create: "出苗销售",
  cost_create: "新增成本",
  cost_update: "修改成本",
  cost_delete: "删除成本",
  warning_handle: "预警处理",
  warning_delete: "删除预警",
  threshold_update: "阈值配置",
  pond_create: "新增育苗池",
  pond_update: "修改育苗池",
  pond_delete: "删除育苗池",
  pond_status: "修改池状态",
  inventory_create: "盘点校准",
  inventory_delete: "删除盘点",
  order_create: "新增订单",
  order_update: "修改订单",
  order_delete: "删除订单",
  order_cancel: "取消订单",
  shipment_create: "新增发货",
  shipment_delete: "删除发货",
  customer_create: "新增客户",
  customer_update: "修改客户",
  customer_delete: "删除客户",
  farm_create: "新增场区",
  farm_update: "修改场区",
  farm_delete: "删除场区",
  farm_set_default: "设置默认场区",
  lineage_create: "创建血缘",
  lineage_delete: "删除血缘",
  batch_update: "更新批次",
  warning_create: "新增预警",
  import_draft_confirm: "确认导入草稿",
};

const TARGET_LABELS = {
  batch: "批次",
  record: "每日记录",
  transfer: "分池合池",
  sale: "销售记录",
  cost: "成本项目",
  warning: "预警",
  pond: "育苗池",
  inventory: "盘点记录",
  order: "订单",
  shipment: "发货记录",
  customer: "客户",
  farm: "场区",
  threshold: "预警阈值",
  lineage: "血缘关系",
  importDraft: "导入草稿",
};

export { ACTION_LABELS, TARGET_LABELS };

export function createAuditLogRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function auditLogRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/audit-logs") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      const action = url.searchParams.get("action");
      const targetType = url.searchParams.get("targetType");
      const operator = url.searchParams.get("operator");
      const startDate = url.searchParams.get("startDate");
      const endDate = url.searchParams.get("endDate");
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 30)));

      let logs = db.opLogs || [];
      if (farmId) logs = logs.filter((l) => l.farmId === farmId);
      if (action) logs = logs.filter((l) => l.action === action);
      if (targetType) logs = logs.filter((l) => l.targetType === targetType);
      if (operator) logs = logs.filter((l) => l.operator && l.operator.includes(operator));
      if (startDate) logs = logs.filter((l) => l.createdAt >= startDate);
      if (endDate) logs = logs.filter((l) => l.createdAt <= endDate + "T23:59:59.999Z");

      logs = [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const total = logs.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = (page - 1) * pageSize;
      const latest = getLatestRollbackable(db, farmId);
      const items = logs.slice(start, start + pageSize).map((l) => ({
        ...l,
        actionLabel: ACTION_LABELS[l.action] || l.action,
        targetLabel: TARGET_LABELS[l.targetType] || l.targetType,
        rollbackable: latest ? l.id === latest.id : false,
        isTxnFirst: !!l.txnSummary,
      }));

      return sendJson(res, 200, {
        items,
        total,
        page,
        pageSize,
        totalPages,
        latestRollbackable: latest
          ? {
              id: latest.id,
              txnId: latest.txnId || null,
              action: latest.action,
              actionLabel: ACTION_LABELS[latest.action] || latest.action,
              targetId: latest.targetId,
              operator: latest.operator,
              createdAt: latest.createdAt,
            }
          : null,
      });
    }

    if (method === "GET" && pathname === "/api/audit-transactions") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      const action = url.searchParams.get("action");
      const operator = url.searchParams.get("operator");
      const startDate = url.searchParams.get("startDate");
      const endDate = url.searchParams.get("endDate");
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));

      let logs = db.opLogs || [];
      if (farmId) logs = logs.filter((l) => l.farmId === farmId);
      if (operator) logs = logs.filter((l) => l.operator && l.operator.includes(operator));
      if (startDate) logs = logs.filter((l) => l.createdAt >= startDate);
      if (endDate) logs = logs.filter((l) => l.createdAt <= endDate + "T23:59:59.999Z");

      const txnMap = new Map();
      const nonTxnLogs = [];

      for (const log of logs) {
        if (log.txnId) {
          if (!txnMap.has(log.txnId)) {
            txnMap.set(log.txnId, {
              txnId: log.txnId,
              logs: [],
              firstLog: null,
              summary: log.txnSummary || null,
            });
          }
          const txn = txnMap.get(log.txnId);
          txn.logs.push(log);
          if (log.txnSummary || !txn.firstLog) {
            txn.firstLog = log;
          }
        } else {
          nonTxnLogs.push(log);
        }
      }

      let transactions = [];
      for (const txn of txnMap.values()) {
        const logsSorted = [...txn.logs].sort((a, b) => a.txnIndex - b.txnIndex);
        const first = logsSorted[0];
        const last = logsSorted[logsSorted.length - 1];
        const summary = first.txnSummary || {
          affectedCollections: { [first.targetType]: 1 },
          affectedBatchIds: [],
          totalEntries: logsSorted.length,
        };

        if (action && !logsSorted.some((l) => l.action === action)) {
          continue;
        }

        transactions.push({
          txnId: txn.txnId,
          description: summary.description || first.action,
          operator: first.operator,
          farmId: first.farmId,
          createdAt: first.createdAt,
          lastUpdatedAt: last.createdAt,
          affectedCollections: summary.affectedCollections || {},
          affectedBatchCount: (summary.affectedBatchIds || []).length,
          affectedBatchIds: summary.affectedBatchIds || [],
          totalEntries: summary.totalEntries || logsSorted.length,
          crossFarm: summary.crossFarm || false,
          firstAction: first.action,
          firstActionLabel: ACTION_LABELS[first.action] || first.action,
          isTransaction: true,
        });
      }

      const standaloneItems = nonTxnLogs.map((log) => ({
        txnId: null,
        logId: log.id,
        description: log.action,
        operator: log.operator,
        farmId: log.farmId,
        createdAt: log.createdAt,
        lastUpdatedAt: log.createdAt,
        affectedCollections: { [log.targetType]: 1 },
        affectedBatchCount: 0,
        affectedBatchIds: [],
        totalEntries: 1,
        crossFarm: false,
        firstAction: log.action,
        firstActionLabel: ACTION_LABELS[log.action] || log.action,
        isTransaction: false,
        _standaloneLog: log,
      }));

      const allItems = [...transactions, ...standaloneItems].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );

      const total = allItems.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = (page - 1) * pageSize;
      const latest = getLatestRollbackable(db, farmId);
      const latestTxnId = latest?.txnId;

      const items = allItems.slice(start, start + pageSize).map((item) => {
        if (item.isTransaction) {
          return {
            ...item,
            rollbackable: latestTxnId ? item.txnId === latestTxnId : false,
          };
        } else {
          const log = item._standaloneLog;
          return {
            ...item,
            rollbackable: latest ? log.id === latest.id : false,
            logId: log.id,
            action: log.action,
            actionLabel: ACTION_LABELS[log.action] || log.action,
            targetType: log.targetType,
            targetLabel: TARGET_LABELS[log.targetType] || log.targetType,
            targetId: log.targetId,
          };
        }
      });

      return sendJson(res, 200, {
        items,
        total,
        page,
        pageSize,
        totalPages,
        latestRollbackable: latest
          ? {
              id: latest.id,
              txnId: latest.txnId || null,
              action: latest.action,
              actionLabel: ACTION_LABELS[latest.action] || latest.action,
              targetId: latest.targetId,
              operator: latest.operator,
              createdAt: latest.createdAt,
            }
          : null,
      });
    }

    if (method === "GET" && pathname === "/api/audit-logs/latest-rollbackable") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      const latest = getLatestRollbackable(db, farmId);
      if (!latest) {
        return sendJson(res, 200, { log: null });
      }
      return sendJson(res, 200, {
        log: {
          ...latest,
          actionLabel: ACTION_LABELS[latest.action] || latest.action,
          targetLabel: TARGET_LABELS[latest.targetType] || latest.targetType,
          rollbackable: true,
        },
      });
    }

    const logMatch = pathname.match(/^\/api\/audit-logs\/([^/]+)$/);
    if (logMatch && method === "GET") {
      const db = await loadDb();
      const logId = logMatch[1];
      const log = (db.opLogs || []).find((l) => l.id === logId);
      if (!log) return sendJson(res, 404, { error: "日志不存在" });
      const rollbackCheck = canRollbackLatest(db, log);
      const txnLogs = log.txnId ? getTxnLogs(db, log.txnId) : [];
      return sendJson(res, 200, {
        ...log,
        actionLabel: ACTION_LABELS[log.action] || log.action,
        targetLabel: TARGET_LABELS[log.targetType] || log.targetType,
        rollbackable: rollbackCheck.ok,
        rollbackReason: rollbackCheck.ok ? "" : rollbackCheck.reason,
        txnLogs: txnLogs.map((l) => ({
          ...l,
          actionLabel: ACTION_LABELS[l.action] || l.action,
          targetLabel: TARGET_LABELS[l.targetType] || l.targetType,
        })),
        txnSummary: log.txnSummary || null,
      });
    }

    const txnMatch = pathname.match(/^\/api\/audit-transactions\/([^/]+)$/);
    if (txnMatch && method === "GET") {
      const db = await loadDb();
      const txnId = decodeURIComponent(txnMatch[1]);
      const txnLogs = getTxnLogs(db, txnId);
      if (txnLogs.length === 0) {
        return sendJson(res, 404, { error: "事务不存在" });
      }
      const firstLog = getTxnFirstLog(db, txnId);
      const summary = firstLog?.txnSummary || {
        affectedCollections: { [firstLog?.targetType || "unknown"]: txnLogs.length },
        affectedBatchIds: [],
        totalEntries: txnLogs.length,
        description: firstLog?.action || "",
      };
      const rollbackCheck = canRollbackTxn(db, txnId);
      return sendJson(res, 200, {
        txnId,
        description: summary.description || firstLog?.action || "",
        operator: firstLog?.operator || "",
        farmId: firstLog?.farmId || "",
        createdAt: firstLog?.createdAt,
        affectedCollections: summary.affectedCollections || {},
        affectedBatchIds: summary.affectedBatchIds || [],
        affectedBatchCount: (summary.affectedBatchIds || []).length,
        totalEntries: summary.totalEntries || txnLogs.length,
        crossFarm: summary.crossFarm || false,
        rollbackable: rollbackCheck.ok,
        rollbackReason: rollbackCheck.ok ? "" : rollbackCheck.reason,
        logs: txnLogs.map((l) => ({
          ...l,
          actionLabel: ACTION_LABELS[l.action] || l.action,
          targetLabel: TARGET_LABELS[l.targetType] || l.targetType,
        })),
      });
    }

    const txnRollbackMatch = pathname.match(/^\/api\/audit-transactions\/([^/]+)\/rollback$/);
    if (txnRollbackMatch && method === "POST") {
      const db = await loadDb();
      const txnId = decodeURIComponent(txnRollbackMatch[1]);
      const txnLogs = getTxnLogs(db, txnId);
      if (txnLogs.length === 0) {
        return sendJson(res, 404, { error: "事务不存在" });
      }

      const input = await body(req);
      const confirmOperator = input.operator || "";
      if (!confirmOperator.trim()) {
        return sendJson(res, 400, { error: "请输入操作者姓名以确认撤销" });
      }

      const result = executeTxnRollback(db, txnId);
      if (!result.success) {
        return sendJson(res, 400, { error: result.error });
      }

      if (!db.opLogs) db.opLogs = [];
      const firstLog = txnLogs[0];
      db.opLogs.push({
        id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        operator: confirmOperator,
        action: "rollback",
        targetType: "transaction",
        targetId: txnId,
        before: null,
        after: null,
        farmId: firstLog.farmId || "",
        meta: {
          rolledBackTxnId: txnId,
          rolledBackActions: txnLogs.map((l) => l.action),
          rolledBackCount: txnLogs.length,
        },
        rolledBack: false,
        createdAt: new Date().toISOString(),
      });

      await saveDb(db);
      return sendJson(res, 200, { success: true, message: result.message });
    }

    const rollbackMatch = pathname.match(/^\/api\/audit-logs\/([^/]+)\/rollback$/);
    if (rollbackMatch && method === "POST") {
      const db = await loadDb();
      const logId = rollbackMatch[1];
      const log = (db.opLogs || []).find((l) => l.id === logId);
      if (!log) return sendJson(res, 404, { error: "日志不存在" });

      const input = await body(req);
      const confirmOperator = input.operator || "";
      if (!confirmOperator.trim()) {
        return sendJson(res, 400, { error: "请输入操作者姓名以确认撤销" });
      }

      let result;
      if (log.txnId) {
        result = executeTxnRollback(db, log.txnId);
      } else {
        result = executeRollback(db, log);
      }
      if (!result.success) {
        return sendJson(res, 400, { error: result.error });
      }

      if (!db.opLogs) db.opLogs = [];
      db.opLogs.push({
        id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        operator: confirmOperator,
        action: "rollback",
        targetType: log.txnId ? "transaction" : "auditLog",
        targetId: log.txnId || logId,
        before: null,
        after: null,
        farmId: log.farmId || "",
        meta: log.txnId
          ? { rolledBackTxnId: log.txnId, rolledBackActions: getTxnLogs(db, log.txnId).map((l) => l.action) }
          : { rolledBackAction: log.action, rolledBackTargetId: log.targetId },
        rolledBack: false,
        createdAt: new Date().toISOString(),
      });

      await saveDb(db);
      return sendJson(res, 200, { success: true, message: result.message });
    }

    const actionsMatch = pathname === "/api/audit-logs/actions" && method === "GET";
    if (actionsMatch) {
      return sendJson(res, 200, {
        actions: Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label })),
        targetTypes: Object.entries(TARGET_LABELS).map(([key, label]) => ({ key, label })),
      });
    }

    return false;
  };
}
