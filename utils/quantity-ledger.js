const DEFAULT_FARM_ID = "FARM-DEFAULT";

const LEDGER_TYPES = {
  initial: "初始入池",
  lineage_in: "血缘转入",
  lineage_out: "血缘转出",
  inventory: "盘点校准",
  old_sale: "旧销售出库",
  order_reserve: "订单占用",
  order_release: "订单释放",
  shipment: "发货出库",
  other: "其他调整",
};

const LEDGER_CATEGORIES = {
  estimate: "估算数量类",
  sale: "销售出库类",
  reserve: "订单占用类",
};

function getLedgerTypeLabel(type) {
  return LEDGER_TYPES[type] || type;
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

function sortLedgersByDate(ledgers) {
  return ledgers.slice().sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    const typeOrder = ["initial", "lineage_in", "lineage_out", "inventory", "old_sale", "order_reserve", "order_release", "shipment", "other"];
    const aIdx = typeOrder.indexOf(a.type);
    const bIdx = typeOrder.indexOf(b.type);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (a.id || "").localeCompare(b.id || "");
  });
}

function buildLedgersForBatch(db, batchId) {
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return [];

  const farmId = batch.farmId || getDefaultFarmId(db);
  const ledgers = [];
  let runningEstimate = 0;

  const initialTransfer = (db.transfers || []).find(
    (t) => t.batchId === batchId && (t.reason === "新批次入池" || t.reason === "初次入池")
  );

  if (initialTransfer) {
    runningEstimate += Number(initialTransfer.count || 0);
    ledgers.push({
      id: `LEDGER-INIT-${batchId}`,
      batchId,
      type: "initial",
      date: initialTransfer.date || batch.hatchDate || "",
      change: Number(initialTransfer.count || 0),
      balance: runningEstimate,
      referenceType: "transfer",
      referenceId: initialTransfer.id,
      note: initialTransfer.reason || "初始入池",
      farmId,
    });
  } else {
    runningEstimate += Number(batch.estimatedCount || 0);
    ledgers.push({
      id: `LEDGER-INIT-${batchId}`,
      batchId,
      type: "initial",
      date: batch.hatchDate || "",
      change: Number(batch.estimatedCount || 0),
      balance: runningEstimate,
      referenceType: "batch",
      referenceId: batch.id,
      note: "初始估算数量",
      farmId,
    });
  }

  const allLineages = (db.lineages || []).filter((l) =>
    l.sources.some((s) => s.batchId === batchId) ||
    l.targets.some((t) => t.batchId === batchId)
  ).sort((a, b) => a.date.localeCompare(b.date));

  for (const lineage of allLineages) {
    const sourceEntry = lineage.sources.find((s) => s.batchId === batchId);
    const targetEntry = lineage.targets.find((t) => t.batchId === batchId);

    const isSource = sourceEntry && Number(sourceEntry.contributionCount || 0) > 0;
    const isTarget = targetEntry && Number(targetEntry.receivedCount || 0) > 0;

    if (isSource && isTarget) {
      const outQty = Number(sourceEntry.contributionCount || 0);
      const inQty = Number(targetEntry.receivedCount || 0);
      const netChange = inQty - outQty;

      runningEstimate += netChange;

      const otherSourceBatches = lineage.sources
        .filter((s) => s.batchId !== batchId)
        .map((s) => ({ batchId: s.batchId, count: s.contributionCount, role: "source" }));
      const otherTargetBatches = lineage.targets
        .filter((t) => t.batchId !== batchId)
        .map((t) => ({ batchId: t.batchId, count: t.receivedCount, role: "target" }));

      ledgers.push({
        id: `LEDGER-LIN-${lineage.id}`,
        batchId,
        type: netChange >= 0 ? "lineage_in" : "lineage_out",
        date: lineage.date,
        change: netChange,
        balance: runningEstimate,
        referenceType: "lineage",
        referenceId: lineage.id,
        note: `${lineage.type === "split" ? "批次拆分" : lineage.type === "merge" ? "批次合并" : "混养分配"}：${lineage.reason || ""}`,
        farmId: lineage.farmId || farmId,
        detail: {
          lineageType: lineage.type,
          contributionCount: outQty,
          receivedCount: inQty,
          netChange,
          otherBatches: [...otherSourceBatches, ...otherTargetBatches],
        },
      });
    } else if (isSource) {
      const outQty = Number(sourceEntry.contributionCount || 0);
      runningEstimate -= outQty;
      ledgers.push({
        id: `LEDGER-LIN-OUT-${lineage.id}`,
        batchId,
        type: "lineage_out",
        date: lineage.date,
        change: -outQty,
        balance: runningEstimate,
        referenceType: "lineage",
        referenceId: lineage.id,
        note: `${lineage.type === "split" ? "批次拆分" : lineage.type === "merge" ? "批次合并" : "混养分配"}：${lineage.reason || ""}`,
        farmId: lineage.farmId || farmId,
        detail: {
          lineageType: lineage.type,
          otherBatches: lineage.targets
            .filter((t) => t.batchId !== batchId)
            .map((t) => ({ batchId: t.batchId, count: t.receivedCount, role: "target" })),
        },
      });
    } else if (isTarget) {
      const inQty = Number(targetEntry.receivedCount || 0);
      runningEstimate += inQty;
      ledgers.push({
        id: `LEDGER-LIN-IN-${lineage.id}`,
        batchId,
        type: "lineage_in",
        date: lineage.date,
        change: inQty,
        balance: runningEstimate,
        referenceType: "lineage",
        referenceId: lineage.id,
        note: `${lineage.type === "split" ? "批次拆分" : lineage.type === "merge" ? "批次合并" : "混养分配"}：${lineage.reason || ""}`,
        farmId: lineage.farmId || farmId,
        detail: {
          lineageType: lineage.type,
          otherBatches: lineage.sources
            .filter((s) => s.batchId !== batchId)
            .map((s) => ({ batchId: s.batchId, count: s.contributionCount, role: "source" })),
        },
      });
    }
  }

  const inventories = (db.inventories || [])
    .filter((i) => i.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const inv of inventories) {
    const beforeEst = runningEstimate;
    const newEst = Number(inv.afterCount || inv.actualCount || 0);
    const diff = newEst - beforeEst;
    runningEstimate = newEst;
    ledgers.push({
      id: `LEDGER-INV-${inv.id}`,
      batchId,
      type: "inventory",
      date: inv.date,
      change: diff,
      balance: runningEstimate,
      referenceType: "inventory",
      referenceId: inv.id,
      note: `盘点校准（${inv.method === "full" ? "全量盘点" : "抽样估算"}）：${inv.note || ""}`,
      farmId: inv.farmId || farmId,
      detail: {
        method: inv.method,
        manualEstimate: inv.manualEstimate,
        actualCount: inv.actualCount,
        systemEstimate: inv.systemEstimate,
        difference: inv.difference,
        beforeCount: inv.beforeCount,
        afterCount: inv.afterCount,
        operator: inv.operator,
      },
    });
  }

  const sales = (db.sales || [])
    .filter((s) => s.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const sale of sales) {
    const saleQty = Number(sale.count || 0);
    ledgers.push({
      id: `LEDGER-SALE-${sale.id}`,
      batchId,
      type: "old_sale",
      date: sale.date,
      change: -saleQty,
      balance: runningEstimate,
      referenceType: "sale",
      referenceId: sale.id,
      note: `旧销售：${sale.customer || ""}`,
      farmId: sale.farmId || farmId,
      detail: {
        customer: sale.customer,
        customerId: sale.customerId,
        unitPrice: sale.unitPrice,
      },
    });
  }

  const orders = (db.orders || [])
    .filter((o) => o.batchId === batchId && o.status !== "cancelled")
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  for (const order of orders) {
    const orderQty = Number(order.orderQuantity || 0);
    const shipmentsForOrder = (db.shipments || [])
      .filter((s) => s.orderId === order.id);
    const shippedQty = shipmentsForOrder.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    const reservedQty = Math.max(0, orderQty - shippedQty);

    if (reservedQty > 0) {
      ledgers.push({
        id: `LEDGER-ORD-RES-${order.id}`,
        batchId,
        type: "order_reserve",
        date: order.deliveryDate || order.createdAt?.slice(0, 10) || "",
        change: -reservedQty,
        balance: runningEstimate,
        referenceType: "order",
        referenceId: order.id,
        note: `订单占用：${order.customerName || ""}`,
        farmId: order.farmId || farmId,
        detail: {
          orderQuantity: orderQty,
          shippedQuantity: shippedQty,
          reservedQuantity: reservedQty,
          customerName: order.customerName,
          customerId: order.customerId,
          unitPrice: order.unitPrice,
          status: order.status,
        },
      });
    }
  }

  const shipments = (db.shipments || [])
    .filter((s) => s.batchId === batchId)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const shipment of shipments) {
    const shipQty = Number(shipment.quantity || 0);
    ledgers.push({
      id: `LEDGER-SHP-${shipment.id}`,
      batchId,
      type: "shipment",
      date: shipment.date,
      change: -shipQty,
      balance: runningEstimate,
      referenceType: "shipment",
      referenceId: shipment.id,
      note: `发货出库`,
      farmId: shipment.farmId || farmId,
      detail: {
        orderId: shipment.orderId,
      },
    });
  }

  return sortLedgersByDate(ledgers);
}

function buildAllLedgers(db) {
  const allLedgers = [];
  const batches = db.batches || [];
  for (const batch of batches) {
    const ledgers = buildLedgersForBatch(db, batch.id);
    allLedgers.push(...ledgers);
  }
  return allLedgers;
}

function calculateBatchQuantity(db, batchId) {
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return null;

  const ledgers = buildLedgersForBatch(db, batchId);

  const estimateLedgers = ledgers.filter((l) =>
    l.type === "initial" || l.type === "lineage_in" || l.type === "lineage_out" || l.type === "inventory"
  );

  const estimatedCount = estimateLedgers.length > 0
    ? estimateLedgers[estimateLedgers.length - 1].balance
    : Number(batch.estimatedCount || 0);

  const oldSalesQty = ledgers
    .filter((l) => l.type === "old_sale")
    .reduce((sum, l) => sum + Math.abs(l.change), 0);

  const shippedQty = ledgers
    .filter((l) => l.type === "shipment")
    .reduce((sum, l) => sum + Math.abs(l.change), 0);

  const reservedQty = ledgers
    .filter((l) => l.type === "order_reserve")
    .reduce((sum, l) => sum + Math.abs(l.change), 0);

  const availableQty = Math.max(0, estimatedCount - oldSalesQty - shippedQty - reservedQty);

  const soldCount = oldSalesQty + shippedQty;

  return {
    batchId,
    estimatedCount,
    oldSalesQuantity: oldSalesQty,
    shippedQuantity: shippedQty,
    reservedQuantity: reservedQty,
    availableQuantity: availableQty,
    soldCount,
    ledgerCount: ledgers.length,
  };
}

function calculateSourceComposition(db, batchId) {
  const lineages = (db.lineages || []).filter((l) =>
    l.sources.some((s) => s.batchId === batchId) || l.targets.some((t) => t.batchId === batchId)
  ).sort((a, b) => a.date.localeCompare(b.date));

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

  const cache = new Map();

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
  const qtyResult = calculateBatchQuantity(db, batchId);
  const currentEstimate = qtyResult?.estimatedCount || 0;

  const contributions = [];
  for (const [sid, qty] of Object.entries(result.sources)) {
    const srcBatch = (db.batches || []).find((b) => b.id === sid);
    const percentage = result.total > 0 ? (qty / result.total) * 100 : 0;
    const currentContribution = currentEstimate > 0 && result.total > 0
      ? Math.round(qty * (currentEstimate / result.total))
      : Math.round(qty);
    contributions.push({
      batchId: sid,
      species: srcBatch ? srcBatch.species : "",
      hatchDate: srcBatch ? srcBatch.hatchDate : "",
      initialEstimatedCount: srcBatch ? Number(srcBatch.estimatedCount || 0) : 0,
      contributionCount: currentContribution,
      percentage: Number(percentage.toFixed(2)),
      ratio: result.total > 0 ? qty / result.total : 0,
      isSelf: sid === batchId,
    });
  }

  contributions.sort((a, b) => b.percentage - a.percentage);

  return {
    batchId,
    currentEstimatedCount: currentEstimate,
    sourceInitialTotal: result.total,
    sources: contributions,
  };
}

function validateBatchQuantityConsistency(db, batchId) {
  const issues = [];
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) {
    return { valid: false, issues: ["批次不存在"] };
  }

  const qtyCalc = calculateBatchQuantity(db, batchId);
  const snapshotEstimate = Number(batch.estimatedCount || 0);
  const ledgerEstimate = qtyCalc.estimatedCount;

  if (Math.abs(snapshotEstimate - ledgerEstimate) > 0.5) {
    issues.push({
      type: "estimate_mismatch",
      level: "warning",
      message: `估算数量不一致：快照值 ${snapshotEstimate.toLocaleString()} 尾，流水账推导值 ${ledgerEstimate.toLocaleString()} 尾，差异 ${(snapshotEstimate - ledgerEstimate).toLocaleString()} 尾`,
      snapshotValue: snapshotEstimate,
      ledgerValue: ledgerEstimate,
      diff: snapshotEstimate - ledgerEstimate,
    });
  }

  if (qtyCalc.availableQuantity < 0) {
    issues.push({
      type: "negative_available",
      level: "error",
      message: `可售数量为负：${qtyCalc.availableQuantity.toLocaleString()} 尾，请检查订单和发货记录`,
      availableQuantity: qtyCalc.availableQuantity,
    });
  }

  if (qtyCalc.reservedQuantity > qtyCalc.estimatedCount) {
    issues.push({
      type: "over_reserved",
      level: "error",
      message: `订单占用超过估算数量：占用 ${qtyCalc.reservedQuantity.toLocaleString()} 尾，估算 ${qtyCalc.estimatedCount.toLocaleString()} 尾`,
      reserved: qtyCalc.reservedQuantity,
      estimated: qtyCalc.estimatedCount,
    });
  }

  const ledgers = buildLedgersForBatch(db, batchId);
  let runningBalance = 0;
  for (const ledger of ledgers) {
    runningBalance += ledger.change;
    if (Math.abs(runningBalance - ledger.balance) > 0.5) {
      issues.push({
        type: "ledger_balance_error",
        level: "error",
        message: `流水账余额错误：${ledger.id} 记录后余额应为 ${runningBalance.toLocaleString()}，实际记录 ${ledger.balance.toLocaleString()}`,
        ledgerId: ledger.id,
        expectedBalance: runningBalance,
        actualBalance: ledger.balance,
      });
      break;
    }
  }

  const lineages = (db.lineages || []).filter((l) =>
    l.sources.some((s) => s.batchId === batchId) || l.targets.some((t) => t.batchId === batchId)
  );
  for (const lineage of lineages) {
    const totalSource = lineage.sources.reduce((s, src) => s + Number(src.contributionCount || 0), 0);
    const totalTarget = lineage.targets.reduce((s, tgt) => s + Number(tgt.receivedCount || 0), 0);
    if (totalSource > 0 && totalTarget > 0) {
      const diffPct = Math.abs(totalTarget - totalSource) / totalSource;
      if (diffPct > 0.05) {
        issues.push({
          type: "lineage_imbalance",
          level: "warning",
          message: `血缘记录 ${lineage.id} 数量不平衡：来源 ${totalSource.toLocaleString()} 尾，目标 ${totalTarget.toLocaleString()} 尾`,
          lineageId: lineage.id,
          totalSource,
          totalTarget,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    errorCount: issues.filter((i) => i.level === "error").length,
    warningCount: issues.filter((i) => i.level === "warning").length,
  };
}

function validateAllBatches(db) {
  const results = {};
  const batches = db.batches || [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const batch of batches) {
    const result = validateBatchQuantityConsistency(db, batch.id);
    results[batch.id] = result;
    totalErrors += result.errorCount;
    totalWarnings += result.warningCount;
  }

  return {
    batchCount: batches.length,
    totalErrors,
    totalWarnings,
    results,
    hasIssues: totalErrors > 0 || totalWarnings > 0,
  };
}

function migrateLedgersFromSnapshot(db) {
  if (!db.quantityLedgers) {
    db.quantityLedgers = [];
  }

  const existingLedgerIds = new Set(db.quantityLedgers.map((l) => l.id));
  const ledgers = buildAllLedgers(db);
  let addedCount = 0;

  for (const ledger of ledgers) {
    if (!existingLedgerIds.has(ledger.id)) {
      db.quantityLedgers.push(ledger);
      addedCount++;
    }
  }

  return {
    addedCount,
    totalCount: db.quantityLedgers.length,
  };
}

function recalculateBatchEstimatesFromLedgers(db) {
  const batches = db.batches || [];
  let updatedCount = 0;

  for (const batch of batches) {
    const qty = calculateBatchQuantity(db, batch.id);
    if (qty && Math.abs(Number(batch.estimatedCount || 0) - qty.estimatedCount) > 0.5) {
      batch.estimatedCount = qty.estimatedCount;
      updatedCount++;
    }
  }

  return {
    updatedCount,
    totalBatches: batches.length,
  };
}

export {
  LEDGER_TYPES,
  LEDGER_CATEGORIES,
  getLedgerTypeLabel,
  buildLedgersForBatch,
  buildAllLedgers,
  calculateBatchQuantity,
  calculateSourceComposition,
  validateBatchQuantityConsistency,
  validateAllBatches,
  migrateLedgersFromSnapshot,
  recalculateBatchEstimatesFromLedgers,
  sortLedgersByDate,
};
