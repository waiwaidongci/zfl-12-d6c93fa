import { writeLog } from "../utils/audit-log.js";

const DEFAULT_FARM_ID = "FARM-DEFAULT";

function getDefaultFarmId(db) {
  if (db.farms && db.farms.length > 0) {
    const def = db.farms.find((f) => f.isDefault);
    return def ? def.id : db.farms[0].id;
  }
  return DEFAULT_FARM_ID;
}

function getFarmIdFromQuery(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("farmId");
}

const LINEAGE_TYPES = {
  split: "批次拆分",
  merge: "批次合并",
  mix: "混养分配",
};

function validateLineageInput(input) {
  const errors = [];
  if (!input.type || !LINEAGE_TYPES[input.type]) {
    errors.push("血缘类型必须是 split、merge 或 mix");
  }
  if (!input.date) {
    errors.push("日期不能为空");
  }
  if (!input.sources || !Array.isArray(input.sources) || input.sources.length === 0) {
    errors.push("至少需要一个来源批次");
  }
  if (!input.targets || !Array.isArray(input.targets) || input.targets.length === 0) {
    errors.push("至少需要一个目标批次");
  }
  if (input.sources) {
    for (const src of input.sources) {
      if (!src.batchId) errors.push("来源批次ID不能为空");
      if (src.contributionCount == null || src.contributionCount < 0) {
        errors.push(`来源批次 ${src.batchId || "?"} 的贡献数量必须≥0`);
      }
    }
  }
  if (input.targets) {
    for (const tgt of input.targets) {
      if (!tgt.batchId) errors.push("目标批次ID不能为空");
      if (tgt.receivedCount == null || tgt.receivedCount < 0) {
        errors.push(`目标批次 ${tgt.batchId || "?"} 的接收数量必须≥0`);
      }
    }
  }
  if (input.type === "split" && input.sources && input.sources.length > 1) {
    errors.push("拆分操作只能有一个来源批次");
  }
  if (input.type === "merge" && input.targets && input.targets.length > 1) {
    errors.push("合并操作只能有一个目标批次");
  }
  return errors;
}

function buildLineageGraph(db, batchId, farmId) {
  const lineages = farmId
    ? (db.lineages || []).filter((l) => l.farmId === farmId)
    : (db.lineages || []);

  const nodes = new Map();
  const edges = [];
  const edgeSet = new Set();

  function addNode(bid) {
    if (nodes.has(bid)) return;
    const batch = (db.batches || []).find((b) => b.id === bid);
    nodes.set(bid, {
      id: bid,
      species: batch ? batch.species : "",
      status: batch ? batch.status : "",
      currentPool: batch ? batch.currentPool : "",
      estimatedCount: batch ? batch.estimatedCount : 0,
    });
  }

  function addEdge(from, to, edgeData) {
    const key = `${from}->${to}:${edgeData.lineageId}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to, ...edgeData });
  }

  function traverseAncestors(bid, depth, beforeDate, visitedLineagePath) {
    if (depth > 20) return;
    const parentLineages = lineages.filter((l) =>
      l.targets.some((t) => t.batchId === bid) &&
      !visitedLineagePath.has(l.id) &&
      (!beforeDate || l.date <= beforeDate)
    );
    for (const lin of parentLineages) {
      visitedLineagePath.add(lin.id);
      const currentTgt = lin.targets.find((t) => t.batchId === bid);
      const currentReceivedRatio = currentTgt ? currentTgt.ratio : 1;
      for (const src of lin.sources) {
        if (src.batchId === bid) continue;
        addNode(src.batchId);
        const edgeCount = currentTgt
          ? Math.round(src.contributionCount * currentReceivedRatio)
          : src.contributionCount;
        addEdge(src.batchId, bid, {
          type: lin.type,
          lineageId: lin.id,
          contributionCount: edgeCount,
          ratio: src.ratio,
          date: lin.date,
          reason: lin.reason,
        });
        traverseAncestors(src.batchId, depth + 1, lin.date, new Set(visitedLineagePath));
      }
    }
  }

  function traverseDescendants(bid, depth, afterDate, visitedLineagePath) {
    if (depth > 20) return;
    const childLineages = lineages.filter((l) =>
      l.sources.some((s) => s.batchId === bid) &&
      !visitedLineagePath.has(l.id) &&
      (!afterDate || l.date >= afterDate)
    );
    for (const lin of childLineages) {
      visitedLineagePath.add(lin.id);
      const currentSrc = lin.sources.find((s) => s.batchId === bid);
      const currentContributionRatio = currentSrc ? currentSrc.ratio : 1;
      for (const tgt of lin.targets) {
        if (tgt.batchId === bid) continue;
        addNode(tgt.batchId);
        const edgeCount = currentSrc
          ? Math.round(tgt.receivedCount * currentContributionRatio)
          : tgt.receivedCount;
        addEdge(bid, tgt.batchId, {
          type: lin.type,
          lineageId: lin.id,
          contributionCount: edgeCount,
          ratio: tgt.ratio,
          date: lin.date,
          reason: lin.reason,
        });
        traverseDescendants(tgt.batchId, depth + 1, lin.date, new Set(visitedLineagePath));
      }
    }
  }

  addNode(batchId);
  traverseAncestors(batchId, 0, null, new Set());
  traverseDescendants(batchId, 0, null, new Set());

  return {
    rootBatchId: batchId,
    nodes: Array.from(nodes.values()),
    edges,
  };
}

function computeContribution(db, batchId, farmId) {
  const lineages = farmId
    ? (db.lineages || []).filter((l) => l.farmId === farmId)
    : (db.lineages || []);

  const cache = new Map();

  function calcInitialQty(bid) {
    const batch = (db.batches || []).find((b) => b.id === bid);
    if (!batch) return 0;

    const allRelated = lineages.filter((l) =>
      l.sources.some((s) => s.batchId === bid) || l.targets.some((t) => t.batchId === bid)
    );

    let runningQty = Number(batch.estimatedCount || 0);
    for (let i = allRelated.length - 1; i >= 0; i--) {
      const lin = allRelated[i];
      const sourceEntry = lin.sources.find((s) => s.batchId === bid);
      const targetEntry = lin.targets.find((t) => t.batchId === bid);
      let change = 0;
      if (sourceEntry) change -= Number(sourceEntry.contributionCount || 0);
      if (targetEntry) change += Number(targetEntry.receivedCount || 0);
      runningQty -= change;
    }
    return Math.max(0, runningQty);
  }

  function calcSources(bid, beforeDate) {
    const key = `${bid}_${beforeDate || "now"}`;
    if (cache.has(key)) return cache.get(key);

    const batch = (db.batches || []).find((b) => b.id === bid);
    if (!batch) {
      const result = { sources: {}, total: 0 };
      cache.set(key, result);
      return result;
    }

    const related = lineages.filter((l) =>
      (l.sources.some((s) => s.batchId === bid) || l.targets.some((t) => t.batchId === bid)) &&
      (!beforeDate || l.date < beforeDate)
    ).sort((a, b) => a.date.localeCompare(b.date));

    const initialQty = calcInitialQty(bid);

    const sources = {};
    if (initialQty > 0) {
      sources[bid] = initialQty;
    }
    let totalQty = initialQty;

    for (const lin of related) {
      const sourceEntry = lin.sources.find((s) => s.batchId === bid);
      const targetEntry = lin.targets.find((t) => t.batchId === bid);

      if (sourceEntry) {
        const outQty = Number(sourceEntry.contributionCount || 0);
        if (totalQty > 0 && outQty > 0) {
          const outRatio = outQty / totalQty;
          for (const sid of Object.keys(sources)) {
            sources[sid] = Math.max(0, sources[sid] - sources[sid] * outRatio);
          }
          totalQty -= outQty;
        }
      }

      if (targetEntry) {
        const inQty = Number(targetEntry.receivedCount || 0);
        if (inQty > 0) {
          const totalSource = lin.sources.reduce((s, src) => s + Number(src.contributionCount || 0), 0);
          const inSources = {};

          for (const src of lin.sources) {
            const srcQty = Number(src.contributionCount || 0);
            if (srcQty <= 0 || totalSource <= 0) continue;

            const srcContribToTarget = inQty * (srcQty / totalSource);

            const srcResult = calcSources(src.batchId, lin.date);
            const srcTotal = srcResult.total || 1;

            for (const sid of Object.keys(srcResult.sources)) {
              const scaled = srcResult.sources[sid] * (srcContribToTarget / srcTotal);
              inSources[sid] = (inSources[sid] || 0) + scaled;
            }
          }

          for (const sid of Object.keys(inSources)) {
            sources[sid] = (sources[sid] || 0) + inSources[sid];
          }
          totalQty += inQty;
        }
      }
    }

    const result = { sources, total: totalQty };
    cache.set(key, result);
    return result;
  }

  const result = calcSources(batchId, null);

  const contributions = [];
  for (const [sid, qty] of Object.entries(result.sources)) {
    const batch = (db.batches || []).find((b) => b.id === sid);
    const percentage = result.total > 0 ? (qty / result.total) * 100 : 0;
    contributions.push({
      batchId: sid,
      species: batch ? batch.species : "",
      estimatedCount: batch ? batch.estimatedCount : 0,
      contributionCount: Math.round(qty),
      percentage: Number(percentage.toFixed(2)),
      ratio: result.total > 0 ? qty / result.total : 0,
      paths: [],
    });
  }

  contributions.sort((a, b) => b.percentage - a.percentage);

  return contributions;
}

export function migrateTransfersToLineage(db) {
  if (!db.transfers || db.transfers.length === 0) return 0;
  if (!db.lineages) db.lineages = [];

  const existingLineageTransferIds = new Set(
    db.transfers
      .filter((t) => t.lineageId)
      .map((t) => t.lineageId)
  );

  const transfersToMigrate = db.transfers.filter(
    (t) => !t.lineageId && t.reason !== "新批次入池" && t.reason !== "初次入池"
  );

  let migratedCount = 0;
  for (const transfer of transfersToMigrate) {
    const lineage = {
      id: `LIN-MIG-${transfer.id}`,
      type: "mix",
      sources: [
        {
          batchId: transfer.batchId,
          contributionCount: Number(transfer.count || 0),
          ratio: 1,
        },
      ],
      targets: [
        {
          batchId: transfer.batchId,
          receivedCount: Number(transfer.count || 0),
          ratio: 1,
          toPool: transfer.toPool,
        },
      ],
      date: transfer.date,
      reason: `${transfer.reason || "历史分池流转"}（数据迁移）`,
      operator: "系统迁移",
      farmId: transfer.farmId || getDefaultFarmId(db),
      createdAt: new Date().toISOString(),
      migratedFromTransferId: transfer.id,
    };

    transfer.lineageId = lineage.id;
    db.lineages.push(lineage);
    migratedCount++;
  }

  return migratedCount;
}

function validateNoCycle(db, sources, targets, type, date) {
  const targetIds = targets.map((t) => t.batchId);
  const sourceIds = sources.map((s) => s.batchId);

  const onlySelf = sourceIds.length === 1 && targetIds.length === 1 && sourceIds[0] === targetIds[0];
  if (onlySelf && type !== "mix") {
    return `操作无效：来源和目标不能都是同一个批次`;
  }

  const allEmpty = sources.every((s) => !s.contributionCount || Number(s.contributionCount) <= 0) &&
                   targets.every((t) => !t.receivedCount || Number(t.receivedCount) <= 0);
  if (allEmpty) {
    return `操作无效：来源和目标数量都为0`;
  }

  return null;
}

function validateDateOrder(db, sources, targets, date) {
  const allBatchIds = [...sources.map((s) => s.batchId), ...targets.map((t) => t.batchId)];

  for (const bid of allBatchIds) {
    const batch = db.batches.find((b) => b.id === bid);
    if (batch && batch.hatchDate && date < batch.hatchDate) {
      return `批次 ${bid} 的孵化日期为 ${batch.hatchDate}，血缘操作日期不能早于孵化日期`;
    }

    const sourceBatches = sources.map((s) => s.batchId);
    if (sourceBatches.includes(bid)) {
      const createdAfter = (db.lineages || []).filter((l) =>
        l.targets.some((t) => t.batchId === bid) &&
        l.date > date
      );
      if (createdAfter.length > 0) {
        return `来源批次 ${bid} 在 ${date} 之后还有 ${createdAfter.length} 次接收血缘的记录，时间顺序矛盾（批次还没完全形成就被拿来作为来源）`;
      }
    }

    const targetBatches = targets.map((t) => t.batchId);
    if (targetBatches.includes(bid)) {
      const contributedBefore = (db.lineages || []).filter((l) =>
        l.sources.some((s) => s.batchId === bid) &&
        l.date < date
      );
      if (contributedBefore.length > 0) {
        return `目标批次 ${bid} 在 ${date} 之前已有 ${contributedBefore.length} 次作为来源贡献的记录，时间顺序矛盾（批次还没形成就已经贡献了）`;
      }
    }
  }

  return null;
}

function validateFarmIsolation(db, sources, targets, farmId) {
  const sourceFarmIds = new Set();
  const targetFarmIds = new Set();

  for (const src of sources) {
    const batch = db.batches.find((b) => b.id === src.batchId);
    if (batch) {
      sourceFarmIds.add(batch.farmId || getDefaultFarmId(db));
    }
  }

  for (const tgt of targets) {
    const batch = db.batches.find((b) => b.id === tgt.batchId);
    if (batch) {
      targetFarmIds.add(batch.farmId || getDefaultFarmId(db));
    }
  }

  const allFarmIds = new Set([...sourceFarmIds, ...targetFarmIds]);
  if (allFarmIds.size > 1) {
    return {
      hasRisk: true,
      message: `跨场区血缘操作：涉及 ${allFarmIds.size} 个场区（${[...allFarmIds].join("、")}），请确认是否允许跨场区混养`,
      farmIds: [...allFarmIds],
    };
  }

  return { hasRisk: false, message: null, farmIds: [] };
}

function validateCountBalance(sources, targets) {
  const totalSource = sources.reduce((sum, s) => sum + Number(s.contributionCount || 0), 0);
  const totalTarget = targets.reduce((sum, t) => sum + Number(t.receivedCount || 0), 0);
  const diff = totalTarget - totalSource;
  const diffPercent = totalSource > 0 ? (diff / totalSource) * 100 : 0;

  if (totalSource > 0 && totalTarget > 0 && Math.abs(diffPercent) > 0.01) {
    return {
      hasRisk: true,
      message: `数量不平衡：来源总量 ${totalSource.toLocaleString()} 尾，目标总量 ${totalTarget.toLocaleString()} 尾，差异 ${diff >= 0 ? "+" : ""}${diff.toLocaleString()} 尾（${diffPercent.toFixed(2)}%）`,
      totalSource,
      totalTarget,
      diff,
      diffPercent,
    };
  }

  return {
    hasRisk: false,
    totalSource,
    totalTarget,
    diff,
    diffPercent,
  };
}

function detectLineageRisks(db, lineage) {
  const risks = [];

  const countBalance = validateCountBalance(lineage.sources, lineage.targets);
  if (countBalance.hasRisk) {
    risks.push({
      type: "count_imbalance",
      level: "warning",
      message: countBalance.message,
      detail: {
        totalSource: countBalance.totalSource,
        totalTarget: countBalance.totalTarget,
        diff: countBalance.diff,
        diffPercent: countBalance.diffPercent,
      },
    });
  }

  const farmIsolation = validateFarmIsolation(db, lineage.sources, lineage.targets, lineage.farmId);
  if (farmIsolation.hasRisk) {
    risks.push({
      type: "cross_farm",
      level: "warning",
      message: farmIsolation.message,
      detail: { farmIds: farmIsolation.farmIds },
    });
  }

  for (const src of lineage.sources) {
    const batch = db.batches.find((b) => b.id === src.batchId);
    if (batch && lineage.date < batch.hatchDate) {
      risks.push({
        type: "date_inversion",
        level: "error",
        message: `日期倒挂：来源批次 ${src.batchId} 孵化日期 ${batch.hatchDate} 晚于血缘操作日期 ${lineage.date}`,
        detail: { batchId: src.batchId, hatchDate: batch.hatchDate, lineageDate: lineage.date },
      });
    }
  }

  for (const tgt of lineage.targets) {
    const batch = db.batches.find((b) => b.id === tgt.batchId);
    if (batch && lineage.date < batch.hatchDate) {
      risks.push({
        type: "date_inversion",
        level: "error",
        message: `日期倒挂：目标批次 ${tgt.batchId} 孵化日期 ${batch.hatchDate} 晚于血缘操作日期 ${lineage.date}`,
        detail: { batchId: tgt.batchId, hatchDate: batch.hatchDate, lineageDate: lineage.date },
      });
    }
  }

  return risks;
}

function buildFlowAudit(db, batchId, farmId) {
  const lineages = farmId
    ? (db.lineages || []).filter((l) => l.farmId === farmId)
    : (db.lineages || []);

  const batch = (db.batches || []).find((b) => b.id === batchId);
  if (!batch) {
    return null;
  }

  const batchLineages = lineages.filter((l) =>
    l.sources.some((s) => s.batchId === batchId) ||
    l.targets.some((t) => t.batchId === batchId)
  ).sort((a, b) => a.date.localeCompare(b.date));

  let totalChange = 0;
  for (const lin of batchLineages) {
    const sourceEntry = lin.sources.find((s) => s.batchId === batchId);
    const targetEntry = lin.targets.find((t) => t.batchId === batchId);
    if (sourceEntry) totalChange -= Number(sourceEntry.contributionCount || 0);
    if (targetEntry) totalChange += Number(targetEntry.receivedCount || 0);
  }

  const initialCount = Number(batch.estimatedCount || 0) - totalChange;
  const events = [];
  let runningCount = initialCount;
  let poolAfter = "";

  for (const lin of batchLineages) {
    const isSource = lin.sources.some((s) => s.batchId === batchId);
    const isTarget = lin.targets.some((t) => t.batchId === batchId);
    const sourceEntry = lin.sources.find((s) => s.batchId === batchId);
    const targetEntry = lin.targets.find((t) => t.batchId === batchId);

    const countBefore = runningCount;
    let countChange = 0;
    if (isSource && sourceEntry) {
      countChange -= Number(sourceEntry.contributionCount || 0);
    }
    if (isTarget && targetEntry) {
      countChange += Number(targetEntry.receivedCount || 0);
    }
    const countAfter = countBefore + countChange;
    runningCount = countAfter;

    let poolChange = null;
    if (isTarget && targetEntry && targetEntry.toPool) {
      poolChange = targetEntry.toPool;
      poolAfter = targetEntry.toPool;
    }

    const otherBatches = [];
    if (lin.sources.length > 1 || lin.targets.length > 1 ||
        (lin.sources.length === 1 && lin.targets.length === 1 && lin.sources[0].batchId !== lin.targets[0].batchId)) {
      for (const src of lin.sources) {
        if (src.batchId !== batchId) {
          const srcBatch = (db.batches || []).find((b) => b.id === src.batchId);
          otherBatches.push({
            id: src.batchId,
            role: "source",
            species: srcBatch ? srcBatch.species : "",
            count: src.contributionCount,
            ratio: src.ratio,
            farmId: srcBatch ? srcBatch.farmId : "",
          });
        }
      }
      for (const tgt of lin.targets) {
        if (tgt.batchId !== batchId) {
          const tgtBatch = (db.batches || []).find((b) => b.id === tgt.batchId);
          otherBatches.push({
            id: tgt.batchId,
            role: "target",
            species: tgtBatch ? tgtBatch.species : "",
            count: tgt.receivedCount,
            ratio: tgt.ratio,
            farmId: tgtBatch ? tgtBatch.farmId : "",
          });
        }
      }
    }

    const risks = detectLineageRisks(db, lin);

    events.push({
      lineageId: lin.id,
      type: lin.type,
      typeLabel: LINEAGE_TYPES[lin.type] || lin.type,
      date: lin.date,
      reason: lin.reason || "",
      operator: lin.operator || "",
      isSource,
      isTarget,
      countBefore,
      countAfter,
      countChange,
      poolAfter: poolAfter || (batch.currentPool || ""),
      poolChange,
      otherBatches,
      risks,
      sources: lin.sources,
      targets: lin.targets,
    });
  }

  const allRisks = [];
  for (const evt of events) {
    for (const risk of evt.risks) {
      allRisks.push({
        ...risk,
        lineageId: evt.lineageId,
        date: evt.date,
        type: evt.type,
      });
    }
  }

  const contribution = computeContribution(db, batchId, farmId);
  const sourceComposition = contribution.map((c) => ({
    batchId: c.batchId,
    species: c.species,
    estimatedCount: c.estimatedCount,
    percentage: c.percentage || 0,
    contributionCount: c.contributionCount || 0,
  }));

  return {
    batchId,
    currentEstimatedCount: Number(batch.estimatedCount || 0),
    currentPool: batch.currentPool || "",
    hatchDate: batch.hatchDate || "",
    species: batch.species || "",
    initialCount,
    totalChange,
    events,
    risks: allRisks,
    riskSummary: {
      total: allRisks.length,
      errors: allRisks.filter((r) => r.level === "error").length,
      warnings: allRisks.filter((r) => r.level === "warning").length,
      byType: allRisks.reduce((acc, r) => {
        acc[r.type] = (acc[r.type] || 0) + 1;
        return acc;
      }, {}),
    },
    sourceComposition,
  };
}

export function createLineageRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function lineageRouter(req, res, pathname, method) {
    const graphMatch = pathname.match(/^\/api\/lineage\/([^/]+)\/graph$/);
    if (graphMatch && method === "GET") {
      const db = await loadDb();
      const batchId = graphMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);
      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      const graph = buildLineageGraph(db, batchId, farmId);
      return sendJson(res, 200, graph);
    }

    const contribMatch = pathname.match(/^\/api\/lineage\/([^/]+)\/contributions$/);
    if (contribMatch && method === "GET") {
      const db = await loadDb();
      const batchId = contribMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);
      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      const contributions = computeContribution(db, batchId, farmId);
      return sendJson(res, 200, { batchId, contributions });
    }

    const auditMatch = pathname.match(/^\/api\/lineage\/([^/]+)\/flow-audit$/);
    if (auditMatch && method === "GET") {
      const db = await loadDb();
      const batchId = auditMatch[1];
      const farmId = getFarmIdFromQuery(req);
      const batch = db.batches.find((b) => b.id === batchId);
      if (!batch) {
        return sendJson(res, 404, { error: "批次不存在" });
      }
      const audit = buildFlowAudit(db, batchId, farmId);
      if (!audit) {
        return sendJson(res, 404, { error: "无法生成数量流向审计" });
      }
      return sendJson(res, 200, audit);
    }

    const validateMatch = pathname.match(/^\/api\/lineage\/([^/]+)\/validate$/);
    if (validateMatch && method === "POST") {
      const db = await loadDb();
      const lineageId = validateMatch[1];
      const lineage = (db.lineages || []).find((l) => l.id === lineageId);
      if (!lineage) {
        return sendJson(res, 404, { error: "血缘记录不存在" });
      }
      const risks = detectLineageRisks(db, lineage);
      return sendJson(res, 200, { lineageId, risks });
    }

    if (method === "GET" && pathname === "/api/lineage") {
      const db = await loadDb();
      const farmId = getFarmIdFromQuery(req);
      let lineages = db.lineages || [];
      if (farmId) {
        lineages = lineages.filter((l) => l.farmId === farmId);
      }
      return sendJson(res, 200, lineages);
    }

    if (method === "POST" && pathname === "/api/lineage") {
      const input = await body(req);
      const errors = validateLineageInput(input);
      if (errors.length > 0) {
        return sendJson(res, 400, { error: errors.join("；") });
      }

      const db = await loadDb();
      if (!db.lineages) db.lineages = [];

      const allBatchIds = [
        ...input.sources.map((s) => s.batchId),
        ...input.targets.map((t) => t.batchId),
      ];
      for (const bid of allBatchIds) {
        if (!db.batches.find((b) => b.id === bid)) {
          return sendJson(res, 404, { error: `批次 ${bid} 不存在` });
        }
      }

      for (const src of input.sources) {
        const srcBatch = db.batches.find((b) => b.id === src.batchId);
        if (srcBatch && src.contributionCount > srcBatch.estimatedCount) {
          return sendJson(res, 400, {
            error: `来源批次 ${src.batchId} 的贡献数量(${src.contributionCount})超过估算数量(${srcBatch.estimatedCount})`,
          });
        }
      }

      const totalSourceCount = input.sources.reduce((s, src) => s + Number(src.contributionCount || 0), 0);
      const totalTargetCount = input.targets.reduce((s, tgt) => s + Number(tgt.receivedCount || 0), 0);
      const cycleError = validateNoCycle(db, input.sources, input.targets, input.type, input.date);
      if (cycleError) {
        return sendJson(res, 400, { error: cycleError });
      }

      const dateError = validateDateOrder(db, input.sources, input.targets, input.date);
      if (dateError) {
        return sendJson(res, 400, { error: dateError });
      }

      if (totalSourceCount > 0 && totalTargetCount > 0 && Math.abs(totalSourceCount - totalTargetCount) > totalSourceCount * 0.05) {
        return sendJson(res, 400, {
          error: `来源总量(${totalSourceCount})与目标总量(${totalTargetCount})差异超过5%，请检查数量分配`,
        });
      }

      const sources = input.sources.map((s) => {
        const ratio = totalSourceCount > 0 ? Number((Number(s.contributionCount || 0) / totalSourceCount).toFixed(6)) : 0;
        return {
          batchId: s.batchId,
          contributionCount: Number(s.contributionCount || 0),
          ratio,
        };
      });

      const targets = input.targets.map((t) => {
        const ratio = totalTargetCount > 0 ? Number((Number(t.receivedCount || 0) / totalTargetCount).toFixed(6)) : 0;
        return {
          batchId: t.batchId,
          receivedCount: Number(t.receivedCount || 0),
          ratio,
          toPool: t.toPool || "",
        };
      });

      const farmId = input.farmId || getDefaultFarmId(db);
      const lineage = {
        id: `LIN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: input.type,
        sources,
        targets,
        date: input.date,
        reason: input.reason || "",
        operator: input.operator || "",
        farmId,
        createdAt: new Date().toISOString(),
      };

      db.lineages.push(lineage);

      for (const tgt of targets) {
        const tgtBatch = db.batches.find((b) => b.id === tgt.batchId);
        for (const src of sources) {
          const srcBatch = db.batches.find((b) => b.id === src.batchId);
          if (srcBatch && tgtBatch && src.contributionCount > 0 && tgt.receivedCount > 0 && src.batchId !== tgt.batchId) {
            const transferCount = Math.round(src.contributionCount * tgt.ratio);
            if (transferCount > 0) {
              const transfer = {
                id: `TR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                batchId: tgt.batchId,
                fromPool: srcBatch.currentPool || "",
                toPool: tgt.toPool || tgtBatch.currentPool || "",
                date: input.date,
                count: transferCount,
                reason: `${LINEAGE_TYPES[input.type]}：${input.reason || "血缘流转"}`,
                farmId: farmId,
                lineageId: lineage.id,
              };
              db.transfers.push(transfer);
            }
          }
        }
      }

      if (input.type === "split") {
        const srcBatch = db.batches.find((b) => b.id === input.sources[0].batchId);
        if (srcBatch && input.sources[0].contributionCount > 0) {
          srcBatch.estimatedCount = Math.max(0, srcBatch.estimatedCount - Number(input.sources[0].contributionCount));
        }
        for (const tgt of input.targets) {
          const tgtBatch = db.batches.find((b) => b.id === tgt.batchId);
          if (tgtBatch && tgt.receivedCount > 0) {
            tgtBatch.estimatedCount += Number(tgt.receivedCount);
            if (tgt.toPool) tgtBatch.currentPool = tgt.toPool;
          }
        }
      } else if (input.type === "merge") {
        for (const src of input.sources) {
          const srcBatch = db.batches.find((b) => b.id === src.batchId);
          if (srcBatch && src.contributionCount > 0) {
            srcBatch.estimatedCount = Math.max(0, srcBatch.estimatedCount - Number(src.contributionCount));
          }
        }
        const tgtBatch = db.batches.find((b) => b.id === input.targets[0].batchId);
        if (tgtBatch) {
          tgtBatch.estimatedCount += totalTargetCount;
        }
      } else if (input.type === "mix") {
        for (const src of input.sources) {
          const srcBatch = db.batches.find((b) => b.id === src.batchId);
          if (srcBatch && src.contributionCount > 0) {
            srcBatch.estimatedCount = Math.max(0, srcBatch.estimatedCount - Number(src.contributionCount));
          }
        }
        for (const tgt of input.targets) {
          const tgtBatch = db.batches.find((b) => b.id === tgt.batchId);
          if (tgtBatch && tgt.receivedCount > 0) {
            tgtBatch.estimatedCount += Number(tgt.receivedCount);
            if (tgt.toPool) tgtBatch.currentPool = tgt.toPool;
          }
        }
      }

      writeLog(db, {
        operator: input.operator || "",
        action: "lineage_create",
        targetType: "lineage",
        targetId: lineage.id,
        before: null,
        after: lineage,
        farmId,
        meta: {
          type: input.type,
          sourceBatchIds: input.sources.map((s) => s.batchId),
          targetBatchIds: input.targets.map((t) => t.batchId),
        },
      });

      await saveDb(db);
      return sendJson(res, 201, lineage);
    }

    const deleteMatch = pathname.match(/^\/api\/lineage\/(LIN-[^/]+)$/);
    if (deleteMatch && method === "DELETE") {
      const lineageId = deleteMatch[1];
      const db = await loadDb();
      if (!db.lineages) db.lineages = [];

      const idx = db.lineages.findIndex((l) => l.id === lineageId);
      if (idx === -1) {
        return sendJson(res, 404, { error: "血缘记录不存在" });
      }

      const lineage = db.lineages[idx];
      db.lineages.splice(idx, 1);

      writeLog(db, {
        operator: "",
        action: "lineage_delete",
        targetType: "lineage",
        targetId: lineageId,
        before: lineage,
        after: null,
        farmId: lineage.farmId,
      });

      await saveDb(db);
      return sendJson(res, 200, { success: true, message: "血缘记录已删除" });
    }

    return false;
  };
}
