import { writeLog } from "../utils/audit-log.js";

const DEFAULT_FARM_ID = "FARM-DEFAULT";

const HATCHERY_STAGES = [
  { key: "egg", label: "卵/孵化期", minDays: 0, maxDays: 2 },
  { key: "nauplius", label: "无节幼体", minDays: 3, maxDays: 5 },
  { key: "zoea", label: "蚤状幼体", minDays: 6, maxDays: 10 },
  { key: "mysis", label: "糠虾幼体", minDays: 11, maxDays: 15 },
  { key: "postlarva", label: "仔虾/仔鱼期", minDays: 16, maxDays: 30 },
  { key: "juvenile", label: "幼体期", minDays: 31, maxDays: null },
];

export function getHatcheryStage(hatchDate, recordDate) {
  if (!hatchDate || !recordDate) return null;
  const hatch = new Date(hatchDate);
  const record = new Date(recordDate);
  if (isNaN(hatch.getTime()) || isNaN(record.getTime())) return null;
  const days = Math.floor((record - hatch) / (1000 * 60 * 60 * 24));
  for (const stage of HATCHERY_STAGES) {
    if (days >= stage.minDays && (stage.maxDays === null || days <= stage.maxDays)) {
      return stage.key;
    }
  }
  return null;
}

export function getAllStages() {
  return HATCHERY_STAGES;
}

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

function getBatchInfo(db, batchId) {
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return { farmId: null, species: "", hatchDate: "" };
  return {
    farmId: batch.farmId || getDefaultFarmId(db),
    species: batch.species || "",
    hatchDate: batch.hatchDate || "",
  };
}

function getDefaultThresholds() {
  return {
    temperature: { yellowMin: 20, yellowMax: 32, redMin: 18, redMax: 35 },
    salinity: { yellowMin: 15, yellowMax: 30, redMin: 10, redMax: 35 },
    oxygen: { yellowMax: 4.5, redMax: 3 },
    mortality: { yellowMin: 2, redMin: 5 },
    abnormalKeywords: [
      "死苗", "变色", "发病", "浮头", "白斑", "红体",
      "溃烂", "停食", "狂游", "沉底",
    ],
  };
}

function migrateOldThresholds(db) {
  if (!db.warningThresholdRules) db.warningThresholdRules = [];
  if (db.warningThresholdRules.length === 0 && db.warningThresholds) {
    db.warningThresholdRules.push({
      id: "RULE-DEFAULT",
      name: "默认规则",
      farmId: "",
      species: "",
      stage: "",
      isDefault: true,
      thresholds: JSON.parse(JSON.stringify(db.warningThresholds)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    delete db.warningThresholds;
    return true;
  }
  if (db.warningThresholdRules.length === 0) {
    db.warningThresholdRules.push({
      id: "RULE-DEFAULT",
      name: "默认规则",
      farmId: "",
      species: "",
      stage: "",
      isDefault: true,
      thresholds: getDefaultThresholds(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
  return false;
}

function ruleMatchScore(rule, farmId, species, stage) {
  let score = 0;
  if (rule.farmId && farmId && rule.farmId === farmId) score += 100;
  if (rule.species && species && rule.species === species) score += 10;
  if (rule.stage && stage && rule.stage === stage) score += 1;
  return score;
}

export function getThresholdsForRecord(db, record) {
  migrateOldThresholds(db);
  const rules = db.warningThresholdRules || [];
  const { farmId, species, hatchDate } = getBatchInfo(db, record.batchId);
  const actualFarmId = record.farmId || farmId;
  const stage = getHatcheryStage(hatchDate, record.date);

  let bestRule = null;
  let bestScore = -1;
  let defaultRule = null;

  for (const rule of rules) {
    if (rule.isDefault) {
      defaultRule = rule;
      continue;
    }
    if (rule.farmId && actualFarmId && rule.farmId !== actualFarmId) continue;
    if (rule.species && species && rule.species !== species) continue;
    if (rule.stage && stage && rule.stage !== stage) continue;
    const score = ruleMatchScore(rule, actualFarmId, species, stage);
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  const matchedRule = bestRule || defaultRule;
  if (!matchedRule) {
    return { thresholds: getDefaultThresholds(), matchedRuleId: null, matchedRuleName: "系统内置默认" };
  }
  return {
    thresholds: matchedRule.thresholds,
    matchedRuleId: matchedRule.id,
    matchedRuleName: matchedRule.name,
  };
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
      migrateOldThresholds(db);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const compat = url.searchParams.get("format") === "legacy";
      if (compat) {
        const defaultRule = (db.warningThresholdRules || []).find((r) => r.isDefault);
        return sendJson(res, 200, defaultRule?.thresholds || getDefaultThresholds());
      }
      return sendJson(res, 200, {
        rules: db.warningThresholdRules || [],
        stages: getAllStages(),
      });
    }

    if (method === "GET" && pathname === "/api/warnings/thresholds/stages") {
      return sendJson(res, 200, getAllStages());
    }

    if (method === "POST" && pathname === "/api/warnings/thresholds") {
      const input = await body(req);
      const db = await loadDb();
      migrateOldThresholds(db);
      if (!db.warningThresholdRules) db.warningThresholdRules = [];

      if (input.isDefault) {
        db.warningThresholdRules.forEach((r) => (r.isDefault = false));
      }

      const newRule = {
        id: input.id || "RULE-" + Date.now(),
        name: input.name || "未命名规则",
        farmId: input.farmId || "",
        species: input.species || "",
        stage: input.stage || "",
        isDefault: !!input.isDefault,
        thresholds: input.thresholds || getDefaultThresholds(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.warningThresholdRules.push(newRule);

      writeLog(db, {
        operator: input.operator || "",
        action: "threshold_rule_create",
        targetType: "thresholdRule",
        targetId: newRule.id,
        before: null,
        after: newRule,
        farmId: newRule.farmId || "",
      });
      await saveDb(db);
      return sendJson(res, 201, newRule);
    }

    const ruleMatch = pathname.match(/^\/api\/warnings\/thresholds\/([^/]+)$/);
    if (ruleMatch) {
      const ruleId = ruleMatch[1];
      const db = await loadDb();
      migrateOldThresholds(db);
      const ruleIndex = (db.warningThresholdRules || []).findIndex((r) => r.id === ruleId);

      if (method === "GET") {
        if (ruleIndex === -1) return sendJson(res, 404, { error: "规则不存在" });
        return sendJson(res, 200, db.warningThresholdRules[ruleIndex]);
      }

      if (method === "PUT") {
        if (ruleIndex === -1) return sendJson(res, 404, { error: "规则不存在" });
        const input = await body(req);
        const oldRule = JSON.parse(JSON.stringify(db.warningThresholdRules[ruleIndex]));

        if (input.isDefault) {
          db.warningThresholdRules.forEach((r) => (r.isDefault = false));
        }

        db.warningThresholdRules[ruleIndex] = {
          ...db.warningThresholdRules[ruleIndex],
          name: input.name !== undefined ? input.name : db.warningThresholdRules[ruleIndex].name,
          farmId: input.farmId !== undefined ? input.farmId : db.warningThresholdRules[ruleIndex].farmId,
          species: input.species !== undefined ? input.species : db.warningThresholdRules[ruleIndex].species,
          stage: input.stage !== undefined ? input.stage : db.warningThresholdRules[ruleIndex].stage,
          isDefault: input.isDefault !== undefined ? !!input.isDefault : db.warningThresholdRules[ruleIndex].isDefault,
          thresholds: input.thresholds || db.warningThresholdRules[ruleIndex].thresholds,
          updatedAt: new Date().toISOString(),
        };

        writeLog(db, {
          operator: input.operator || "",
          action: "threshold_rule_update",
          targetType: "thresholdRule",
          targetId: ruleId,
          before: oldRule,
          after: db.warningThresholdRules[ruleIndex],
          farmId: db.warningThresholdRules[ruleIndex].farmId || "",
        });
        await saveDb(db);
        return sendJson(res, 200, db.warningThresholdRules[ruleIndex]);
      }

      if (method === "DELETE") {
        if (ruleIndex === -1) return sendJson(res, 404, { error: "规则不存在" });
        const existing = db.warningThresholdRules[ruleIndex];
        if (existing.isDefault) {
          return sendJson(res, 400, { error: "不能删除默认规则，请先设置其他规则为默认" });
        }
        db.warningThresholdRules.splice(ruleIndex, 1);
        writeLog(db, {
          operator: "",
          action: "threshold_rule_delete",
          targetType: "thresholdRule",
          targetId: existing.id,
          before: existing,
          after: null,
          farmId: existing.farmId || "",
        });
        await saveDb(db);
        return sendJson(res, 200, { ok: true });
      }
    }

    if (method === "POST" && pathname === "/api/warnings/rescan") {
      const input = await body(req);
      const db = await loadDb();
      migrateOldThresholds(db);
      const regenerated = regenerateAllWarnings(db);
      writeLog(db, {
        operator: input.operator || "",
        action: "warning_rescan",
        targetType: "warning",
        targetId: "",
        before: null,
        after: { regeneratedCount: regenerated },
        farmId: "",
      });
      await saveDb(db);
      return sendJson(res, 200, { regeneratedCount: regenerated });
    }

    if (method === "PUT" && pathname === "/api/warnings/thresholds") {
      const input = await body(req);
      const db = await loadDb();
      migrateOldThresholds(db);
      if (!db.warningThresholdRules) db.warningThresholdRules = [];

      let defaultRule = db.warningThresholdRules.find((r) => r.isDefault);
      const oldThresholds = defaultRule ? JSON.parse(JSON.stringify(defaultRule.thresholds)) : null;

      if (!defaultRule) {
        defaultRule = {
          id: "RULE-DEFAULT",
          name: "默认规则",
          farmId: "",
          species: "",
          stage: "",
          isDefault: true,
          thresholds: getDefaultThresholds(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        db.warningThresholdRules.push(defaultRule);
      }

      defaultRule.thresholds = {
        ...defaultRule.thresholds,
        ...input,
      };
      defaultRule.updatedAt = new Date().toISOString();

      const regenerated = regenerateAllWarnings(db);
      writeLog(db, {
        operator: input.operator || "",
        action: "threshold_update",
        targetType: "threshold",
        targetId: defaultRule.id,
        before: oldThresholds,
        after: defaultRule.thresholds,
        farmId: "",
      });
      await saveDb(db);
      return sendJson(res, 200, { thresholds: defaultRule.thresholds, regeneratedCount: regenerated });
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
      const beforeHandle = { status: warning.status, handler: warning.handler, handleNote: warning.handleNote };
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
      writeLog(db, {
        operator: input.handler || "",
        action: "warning_handle",
        targetType: "warning",
        targetId: warning.id,
        before: beforeHandle,
        after: { status: warning.status, handler: warning.handler, handleNote: warning.handleNote },
        farmId: warning.farmId || "",
      });
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
      existing._originalIndex = idx;
      db.warnings.splice(idx, 1);
      writeLog(db, {
        operator: "",
        action: "warning_delete",
        targetType: "warning",
        targetId: existing.id,
        before: existing,
        after: null,
        farmId: existing.farmId || "",
      });
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
  const { thresholds, matchedRuleId, matchedRuleName } = getThresholdsForRecord(db, record);
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
      existing.ruleId = matchedRuleId;
      existing.ruleName = matchedRuleName;
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
    ruleId: matchedRuleId,
    ruleName: matchedRuleName,
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
  migrateOldThresholds(db);
  if (!db.records || !db.records.length) return 0;
  if (!db.warnings) db.warnings = [];
  let count = 0;
  for (const record of db.records) {
    const result = generateWarningsFromRecord(record, db, true);
    count += result.length;
  }
  return count;
}
