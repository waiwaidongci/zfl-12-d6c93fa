import { getBatchAvailableQuantity, getBatchReservedQuantity } from "./shipments.js";

const DEFAULT_FARM_ID = "FARM-DEFAULT";

function getDefaultFarmId(db) {
  if (db.farms && db.farms.length > 0) {
    const def = db.farms.find((f) => f.isDefault);
    return def ? def.id : db.farms[0].id;
  }
  return DEFAULT_FARM_ID;
}

function calcFarmStats(db, farmId) {
  const batches = (db.batches || []).filter((b) => b.farmId === farmId);
  const ponds = (db.ponds || []).filter((p) => p.farmId === farmId);
  const orders = (db.orders || []).filter((o) => o.farmId === farmId);
  const shipments = (db.shipments || []).filter((s) => s.farmId === farmId);
  const warnings = (db.warnings || []).filter((w) => w.farmId === farmId);
  const sales = (db.sales || []).filter((s) => s.farmId === farmId);

  const batchCount = batches.length;

  const breedingCount = batches
    .filter((b) => b.status === "育苗中" || b.status === "培育中" || b.status === "在养")
    .reduce((sum, b) => sum + Number(b.estimatedCount || 0), 0);

  const availableCount = batches.reduce((sum, b) => {
    return sum + getBatchAvailableQuantity(b, db);
  }, 0);

  const validOrders = orders.filter((o) => o.status !== "cancelled");
  const totalOrderAmount = validOrders.reduce((sum, o) => {
    return sum + Number(o.orderQuantity || 0) * Number(o.unitPrice || 0);
  }, 0);

  const oldSalesRevenue = sales.reduce((sum, s) => {
    return sum + Number(s.count || 0) * Number(s.unitPrice || 0);
  }, 0);

  const shipmentRevenue = shipments.reduce((sum, s) => {
    const order = (db.orders || []).find((o) => o.id === s.orderId);
    const unitPrice = order?.unitPrice || 0;
    return sum + Number(s.quantity || 0) * Number(unitPrice || 0);
  }, 0);

  const shippedRevenue = oldSalesRevenue + shipmentRevenue;

  const pendingWarnings = warnings.filter(
    (w) => w.status === "pending" || w.status === "processing"
  ).length;

  const totalPonds = ponds.length;
  const activePonds = ponds.filter((p) => {
    if (p.status === "active") return true;
    return batches.some((b) => b.currentPool === p.id);
  }).length;
  const pondUsageRate = totalPonds > 0 ? Number(((activePonds / totalPonds) * 100).toFixed(1)) : 0;

  const farm = (db.farms || []).find((f) => f.id === farmId);

  return {
    farmId,
    farmName: farm?.name || farmId,
    isDefault: farm?.isDefault || false,
    batchCount,
    breedingCount,
    availableCount,
    totalOrderAmount: Number(totalOrderAmount.toFixed(2)),
    shippedRevenue: Number(shippedRevenue.toFixed(2)),
    pendingWarnings,
    totalPonds,
    activePonds,
    pondUsageRate,
    orderCount: validOrders.length,
    shipmentCount: shipments.length,
    warningCount: warnings.length,
  };
}

function calcOverviewSummary(db) {
  const farms = db.farms || [];
  const farmStats = farms.map((f) => calcFarmStats(db, f.id));

  const total = {
    batchCount: farmStats.reduce((sum, f) => sum + f.batchCount, 0),
    breedingCount: farmStats.reduce((sum, f) => sum + f.breedingCount, 0),
    availableCount: farmStats.reduce((sum, f) => sum + f.availableCount, 0),
    totalOrderAmount: Number(farmStats.reduce((sum, f) => sum + f.totalOrderAmount, 0).toFixed(2)),
    shippedRevenue: Number(farmStats.reduce((sum, f) => sum + f.shippedRevenue, 0).toFixed(2)),
    pendingWarnings: farmStats.reduce((sum, f) => sum + f.pendingWarnings, 0),
    totalPonds: farmStats.reduce((sum, f) => sum + f.totalPonds, 0),
    activePonds: farmStats.reduce((sum, f) => sum + f.activePonds, 0),
    pondUsageRate: 0,
    farmCount: farmStats.length,
    orderCount: farmStats.reduce((sum, f) => sum + f.orderCount, 0),
    shipmentCount: farmStats.reduce((sum, f) => sum + f.shipmentCount, 0),
    warningCount: farmStats.reduce((sum, f) => sum + f.warningCount, 0),
  };

  total.pondUsageRate = total.totalPonds > 0
    ? Number(((total.activePonds / total.totalPonds) * 100).toFixed(1))
    : 0;

  return {
    total,
    farms: farmStats,
  };
}

export function createOverviewRouter(helpers) {
  const { loadDb, sendJson } = helpers;

  return async function overviewRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/overview") {
      const db = await loadDb();
      const overview = calcOverviewSummary(db);
      return sendJson(res, 200, overview);
    }

    const farmOverviewMatch = pathname.match(/^\/api\/farms\/([^/]+)\/overview$/);
    if (farmOverviewMatch && method === "GET") {
      const farmId = decodeURIComponent(farmOverviewMatch[1]);
      const db = await loadDb();
      const farm = (db.farms || []).find((f) => f.id === farmId);
      if (!farm) {
        return sendJson(res, 404, { error: "场区不存在" });
      }
      const stats = calcFarmStats(db, farmId);
      return sendJson(res, 200, stats);
    }

    return false;
  };
}

export { calcFarmStats, calcOverviewSummary };
