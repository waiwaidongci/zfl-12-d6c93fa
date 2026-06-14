import { canRollbackLatest, executeRollback, getLatestRollbackable } from "../utils/audit-log.js";

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
      }));

      return sendJson(res, 200, {
        items,
        total,
        page,
        pageSize,
        totalPages,
        latestRollbackable: latest
          ? { id: latest.id, action: latest.action, actionLabel: ACTION_LABELS[latest.action] || latest.action, targetId: latest.targetId, operator: latest.operator, createdAt: latest.createdAt }
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
      return sendJson(res, 200, {
        ...log,
        actionLabel: ACTION_LABELS[log.action] || log.action,
        targetLabel: TARGET_LABELS[log.targetType] || log.targetType,
        rollbackable: rollbackCheck.ok,
        rollbackReason: rollbackCheck.ok ? "" : rollbackCheck.reason,
      });
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

      const result = executeRollback(db, log);
      if (!result.success) {
        return sendJson(res, 400, { error: result.error });
      }

      if (!db.opLogs) db.opLogs = [];
      db.opLogs.push({
        id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        operator: confirmOperator,
        action: "rollback",
        targetType: "auditLog",
        targetId: logId,
        before: null,
        after: null,
        farmId: log.farmId || "",
        meta: { rolledBackAction: log.action, rolledBackTargetId: log.targetId },
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
