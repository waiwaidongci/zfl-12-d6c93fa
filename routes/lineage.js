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
  const visitedAncestors = new Set();
  const visitedDescendants = new Set();
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

  function traverseAncestors(bid, depth) {
    if (depth > 20) return;
    const parentLineages = lineages.filter((l) =>
      l.targets.some((t) => t.batchId === bid) && !visitedAncestors.has(l.id)
    );
    for (const lin of parentLineages) {
      visitedAncestors.add(lin.id);
      for (const src of lin.sources) {
        if (src.batchId === bid) continue;
        addNode(src.batchId);
        addEdge(src.batchId, bid, {
          type: lin.type,
          lineageId: lin.id,
          contributionCount: src.contributionCount,
          ratio: src.ratio,
          date: lin.date,
          reason: lin.reason,
        });
        traverseAncestors(src.batchId, depth + 1);
      }
    }
  }

  function traverseDescendants(bid, depth) {
    if (depth > 20) return;
    const childLineages = lineages.filter((l) =>
      l.sources.some((s) => s.batchId === bid) && !visitedDescendants.has(l.id)
    );
    for (const lin of childLineages) {
      visitedDescendants.add(lin.id);
      for (const tgt of lin.targets) {
        if (tgt.batchId === bid) continue;
        addNode(tgt.batchId);
        addEdge(bid, tgt.batchId, {
          type: lin.type,
          lineageId: lin.id,
          contributionCount: tgt.receivedCount,
          ratio: tgt.ratio,
          date: lin.date,
          reason: lin.reason,
        });
        traverseDescendants(tgt.batchId, depth + 1);
      }
    }
  }

  addNode(batchId);
  traverseAncestors(batchId, 0);
  traverseDescendants(batchId, 0);

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

  const contributions = [];

  function trace(bid, ratio, path, visitedBatches) {
    if (visitedBatches.has(bid)) return;
    visitedBatches.add(bid);

    const parentLineages = lineages.filter((l) =>
      l.targets.some((t) => t.batchId === bid)
    );

    const hasRealParent = parentLineages.some((l) =>
      l.sources.some((s) => s.batchId !== bid && !visitedBatches.has(s.batchId))
    );

    if (!hasRealParent) {
      const existing = contributions.find((c) => c.batchId === bid);
      if (existing) {
        existing.ratio += ratio;
        existing.paths.push([...path]);
      } else {
        const batch = (db.batches || []).find((b) => b.id === bid);
        contributions.push({
          batchId: bid,
          species: batch ? batch.species : "",
          estimatedCount: batch ? batch.estimatedCount : 0,
          ratio: ratio,
          paths: [[...path]],
        });
      }
      return;
    }

    for (const lin of parentLineages) {
      const targetEntry = lin.targets.find((t) => t.batchId === bid);
      const targetRatio = targetEntry ? (targetEntry.ratio || 0) : 0;
      if (targetRatio <= 0) continue;

      for (const src of lin.sources) {
        if (src.batchId === bid) continue;
        if (visitedBatches.has(src.batchId)) continue;
        const srcRatio = src.ratio || 0;
        if (srcRatio <= 0) continue;
        const newPath = [...path, { lineageId: lin.id, type: lin.type, date: lin.date }];
        trace(src.batchId, ratio * srcRatio, newPath, new Set(visitedBatches));
      }
    }
  }

  trace(batchId, 1, [], new Set());

  let totalRatio = contributions.reduce((s, c) => s + c.ratio, 0);
  if (totalRatio > 0) {
    for (const c of contributions) {
      c.contributionCount = Math.round(c.ratio / totalRatio * ((db.batches || []).find(b => b.id === batchId)?.estimatedCount || 0));
      c.percentage = Number(((c.ratio / totalRatio) * 100).toFixed(2));
    }
  }

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

function validateNoCycle(db, sources, targets, type) {
  const targetIds = targets.map((t) => t.batchId);
  const sourceIds = sources.map((s) => s.batchId);
  const lineages = db.lineages || [];

  const onlySelf = sourceIds.length === 1 && targetIds.length === 1 && sourceIds[0] === targetIds[0];
  if (onlySelf && type !== "mix") {
    return `操作无效：来源和目标不能都是同一个批次`;
  }

  const visited = new Set();
  const queue = targetIds.filter(tid => !sourceIds.includes(tid));

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    if (sourceIds.includes(current)) {
      return `存在循环依赖：${current} 会形成闭环血缘链`;
    }

    const childLineages = lineages.filter((l) =>
      l.sources.some((s) => s.batchId === current)
    );

    for (const lin of childLineages) {
      for (const tgt of lin.targets) {
        const realTargets = lin.targets.filter(t => t.batchId !== current).map(t => t.batchId);
        for (const rt of realTargets) {
          if (!visited.has(rt) && !sourceIds.includes(rt)) {
            queue.push(rt);
          }
        }
      }
    }
  }

  const visitedAncestors = new Set();
  const ancestorQueue = sourceIds.filter(sid => !targetIds.includes(sid));

  while (ancestorQueue.length > 0) {
    const current = ancestorQueue.shift();
    if (visitedAncestors.has(current)) continue;
    visitedAncestors.add(current);

    if (targetIds.includes(current)) {
      return `存在循环依赖：${current} 会形成闭环血缘链`;
    }

    const parentLineages = lineages.filter((l) =>
      l.targets.some((t) => t.batchId === current)
    );

    for (const lin of parentLineages) {
      for (const src of lin.sources) {
        const realSources = lin.sources.filter(s => s.batchId !== current).map(s => s.batchId);
        for (const rs of realSources) {
          if (!visitedAncestors.has(rs) && !targetIds.includes(rs)) {
            ancestorQueue.push(rs);
          }
        }
      }
    }
  }

  return null;
}

function validateDateOrder(db, sources, targets, date) {
  const allBatchIds = [...sources.map((s) => s.batchId), ...targets.map((t) => t.batchId)];
  const lineages = db.lineages || [];

  for (const bid of allBatchIds) {
    const batch = db.batches.find((b) => b.id === bid);
    if (batch && batch.hatchDate && date < batch.hatchDate) {
      return `批次 ${bid} 的孵化日期为 ${batch.hatchDate}，血缘操作日期不能早于孵化日期`;
    }

    const futureLineages = lineages.filter((l) =>
      (l.sources.some((s) => s.batchId === bid) || l.targets.some((t) => t.batchId === bid)) &&
      l.date > date
    );

    if (futureLineages.length > 0) {
      return `批次 ${bid} 已有 ${futureLineages.length} 条血缘记录晚于当前操作日期 ${date}，请检查日期顺序`;
    }
  }

  return null;
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
      const cycleError = validateNoCycle(db, input.sources, input.targets, input.type);
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
