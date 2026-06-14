const DEFAULT_FARM_ID = "FARM-DEFAULT";

function getDefaultFarmId(db) {
  if (db.farms && db.farms.length > 0) {
    const def = db.farms.find((f) => f.isDefault);
    return def ? def.id : db.farms[0].id;
  }
  return DEFAULT_FARM_ID;
}

function getFarmIdForBatch(db, batchId) {
  const batch = db.batches.find((b) => b.id === batchId);
  return batch?.farmId || getDefaultFarmId(db);
}

function getFarmIdFromQuery(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("farmId");
}

export function createWarningsRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function warningsRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/warnings") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let warnings = db.warnings || [];
      if (farmId) {
        warnings = warnings.filter((w) => w.farmId === farmId);
      }
      return sendJson(res, 200, warnings);
    }

    if (method === "GET" && pathname === "/api/warnings/pending") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let pending = (db.warnings || []).filter(
        (w) => w.status === "pending" || w.status === "processing"
      );
      if (farmId) {
        pending = pending.filter((w) => w.farmId === farmId);
      }
      return sendJson(res, 200, pending);
    }

    if (method === "GET" && pathname === "/api/warnings/thresholds") {
      const db = await loadDb();
      return sendJson(res, 200, db.warningThresholds || {});
    }

    if (method === "PUT" && pathname === "/api/warnings/thresholds") {
      const input = await body(req);
      const db = await loadDb();
      db.warningThresholds = {
        ...db.warningThresholds,
        ...input,
      };
      const regenerated = regenerateAllWarnings(db);
      await saveDb(db);
      return sendJson(res, 200, { thresholds: db.warningThresholds, regeneratedCount: regenerated });
    }

    const detailMatch = pathname.match(/^\/api\/warnings\/([^/]+)$/);
    if (detailMatch && method === "GET") {
      const db = await loadDb();
      const warning = (db.warnings || []).find((w) => w.id === detailMatch[1]);
      if (!warning) {
        return sendJson(res, 404, { error: "预警不存在" });
      }
      const record = (db.records || []).find((r) => r.id === warning.recordId);
      const batch = (db.batches || []).find((b) => b.id === warning.batchId);
      const pool = (db.ponds || []).find((p) => p.id === warning.poolId);
      return sendJson(res, 200, {
        warning,
        relatedRecord: record || null,
        relatedBatch: batch || null,
        relatedPool: pool || null,
        handleHistory: warning.handleHistory || [],
      });
    }

    const handleMatch = pathname.match(/^\/api\/warnings\/([^/]+)\/handle$/);
    if (handleMatch && method === "PATCH") {
      const input = await body(req);
      const db = await loadDb();
      const warnings = db.warnings || [];
      const warningIndex = warnings.findIndex(
        (w) => w.id === handleMatch[1]
      );
      if (warningIndex === -1) {
        return sendJson(res, 404, { error: "预警不存在" });
      }
      const farmId = getFarmIdFromQuery(req);
      const warning = warnings[warningIndex];
      if (farmId && warning.farmId !== farmId) {
        return sendJson(res, 404, { error: "预警不存在" });
      }
      const validStatuses = ["pending", "processing", "resolved", "ignored"];
      if (!validStatuses.includes(input.status)) {
        return sendJson(res, 400, { error: "无效的处理状态" });
      }
      if (!warning.handleHistory) warning.handleHistory = [];
      warning.handleHistory.push({
        fromStatus: warning.status,
        toStatus: input.status,
        handler: input.handler || "",
        note: input.handleNote || "",
        at: new Date().toISOString(),
      });
      warning.status = input.status;
      warning.handler = input.handler || warning.handler || "";
      warning.handleNote = input.handleNote || warning.handleNote || "";
      warning.handleDate = new Date().toISOString().slice(0, 10);
      if (input.status === "processing") {
        warning.processingAt = new Date().toISOString();
      }
      if (input.status === "resolved" || input.status === "ignored") {
        warning.resolvedAt = new Date().toISOString();
      }
      await saveDb(db);
      return sendJson(res, 200, warning);
    }

    if (detailMatch && method === "DELETE") {
      const db = await loadDb();
      const warnings = db.warnings || [];
      const idx = warnings.findIndex(
        (w) => w.id === detailMatch[1]
      );
      if (idx === -1) {
        return sendJson(res, 404, { error: "预警不存在" });
      }
      const farmId = getFarmIdFromQuery(req);
      const existing = warnings[idx];
      if (farmId && existing.farmId !== farmId) {
        return sendJson(res, 404, { error: "预警不存在" });
      }
      db.warnings.splice(idx, 1);
      await saveDb(db);
      return sendJson(res, 200, { ok: true });
    }

    return false;
  };
}

function checkThresholds(record, thresholds) {
  const reasons = [];
  let maxLevel = "";

  const t = thresholds.temperature || {};
  if (record.temperature != null) {
    const temp = Number(record.temperature);
    if (temp <= (t.redMin || -Infinity) || temp >= (t.redMax || Infinity)) {
      reasons.push("水温" + temp + "℃（红色阈值）");
      maxLevel = "red";
    } else if (temp <= (t.yellowMin || -Infinity) || temp >= (t.yellowMax || Infinity)) {
      if (maxLevel !== "red") maxLevel = "yellow";
      reasons.push("水温" + temp + "℃（黄色阈值）");
    }
  }

  const s = thresholds.salinity || {};
  if (record.salinity != null) {
    const sal = Number(record.salinity);
    if (sal <= (s.redMin || -Infinity) || sal >= (s.redMax || Infinity)) {
      reasons.push("盐度" + sal + "（红色阈值）");
      maxLevel = "red";
    } else if (sal <= (s.yellowMin || -Infinity) || sal >= (s.yellowMax || Infinity)) {
      if (maxLevel !== "red") maxLevel = "yellow";
      reasons.push("盐度" + sal + "（黄色阈值）");
    }
  }

  const o = thresholds.oxygen || {};
  if (record.oxygen != null) {
    const oxy = Number(record.oxygen);
    if (oxy <= (o.redMax || -Infinity)) {
      reasons.push("溶氧" + oxy + "（红色阈值）");
      maxLevel = "red";
    } else if (oxy <= (o.yellowMax || -Infinity)) {
      if (maxLevel !== "red") maxLevel = "yellow";
      reasons.push("溶氧" + oxy + "（黄色阈值）");
    }
  }

  const m = thresholds.mortality || {};
  if (record.mortality != null) {
    const mort = Number(record.mortality);
    if (mort >= (m.redMin || Infinity)) {
      reasons.push("死亡率" + mort + "%（红色阈值）");
      maxLevel = "red";
    } else if (mort >= (m.yellowMin || Infinity)) {
      if (maxLevel !== "red") maxLevel = "yellow";
      reasons.push("死亡率" + mort + "%（黄色阈值）");
    }
  }

  const keywords = thresholds.abnormalKeywords || [];
  if (record.abnormal && record.abnormal !== "无") {
    const matched = keywords.filter((kw) => record.abnormal.includes(kw));
    if (matched.length > 0) {
      if (maxLevel !== "red") maxLevel = "yellow";
      reasons.push("异常文本含关键词：" + matched.join("、"));
    }
  }

  return { reasons, level: maxLevel };
}

export function generateWarningsFromRecord(record, db, regenerateAllStatuses = false) {
  const thresholds = db.warningThresholds || {};
  const { reasons, level } = checkThresholds(record, thresholds);
  if (!db.warnings) db.warnings = [];

  const matchStatuses = regenerateAllStatuses
    ? ["pending", "processing"]
    : ["pending"];

  const existings = db.warnings.filter(
    (w) => w.recordId === record.id && matchStatuses.includes(w.status)
  );

  if (!level || reasons.length === 0) {
    if (existings.length > 0 && regenerateAllStatuses) {
      existings.forEach((w) => {
        w.level = "";
        w.reasons = ["数据已更新，原触发条件不再满足"];
        w.autoResolved = true;
        w.status = "resolved";
        w.resolvedAt = new Date().toISOString();
        w.handleDate = new Date().toISOString().slice(0, 10);
        if (!w.handleHistory) w.handleHistory = [];
        w.handleHistory.push({
          fromStatus: w.status,
          toStatus: "resolved",
          handler: "系统自动",
          note: "数据更新后阈值不再触发，自动解除预警",
          at: new Date().toISOString(),
        });
      });
    }
    return [];
  }

  if (existings.length > 0) {
    existings.forEach((existing) => {
      existing.level = level;
      existing.reasons = reasons;
      existing.date = record.date;
      existing.batchId = record.batchId;
      existing.poolId = record.poolId || existing.poolId || "";
    });
    return existings;
  }

  const warning = {
    id: "WARN-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    batchId: record.batchId,
    recordId: record.id,
    poolId: record.poolId || "",
    date: record.date,
    level: level,
    reasons: reasons,
    status: "pending",
    handler: "",
    handleNote: "",
    handleDate: "",
    processingAt: "",
    resolvedAt: "",
    autoResolved: false,
    handleHistory: [],
    createdAt: new Date().toISOString(),
    farmId: record.farmId || getFarmIdForBatch(db, record.batchId),
  };

  db.warnings.push(warning);
  return [warning];
}

export function removeWarningsForRecord(recordId, db) {
  if (!db.warnings) return 0;
  const before = db.warnings.length;
  db.warnings = db.warnings.filter((w) => w.recordId !== recordId);
  return before - db.warnings.length;
}

export function regenerateAllWarnings(db) {
  if (!db.records || !db.records.length) return 0;
  if (!db.warnings) db.warnings = [];
  let count = 0;
  for (const record of db.records) {
    const result = generateWarningsFromRecord(record, db, true);
    count += result.length;
  }
  return count;
}
