import { writeLog } from "../utils/audit-log.js";

const DEFAULT_FARM_ID = "FARM-DEFAULT";
const DEFAULT_COST_CATEGORIES = ["饲料", "药品", "人工", "能源", "其他"];

function getDefaultCostCategories() {
  return [...DEFAULT_COST_CATEGORIES];
}

function validateFarm(input, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    if (!input.id || typeof input.id !== "string" || !input.id.trim()) {
      errors.push("场区编号不能为空");
    } else if (!/^[A-Za-z0-9\-_]+$/.test(input.id.trim())) {
      errors.push("场区编号只能包含字母、数字、连字符和下划线");
    }
  }

  if (input.name !== undefined && (!input.name || typeof input.name !== "string" || !input.name.trim())) {
    errors.push("场区名称不能为空");
  }

  return errors;
}

function sanitizeFarm(input, existing = null) {
  const base = existing || {
    id: "",
    name: "",
    location: "",
    address: "",
    contact: "",
    phone: "",
    note: "",
    isDefault: false,
    createdAt: "",
    costCategories: getDefaultCostCategories(),
  };

  let costCategories = base.costCategories || getDefaultCostCategories();
  if (input.costCategories !== undefined) {
    if (Array.isArray(input.costCategories)) {
      const cleaned = input.costCategories
        .map((c) => (typeof c === "string" ? c.trim() : ""))
        .filter((c) => c.length > 0);
      if (cleaned.length > 0) {
        costCategories = [...new Set(cleaned)];
      }
    }
  }

  return {
    id: input.id !== undefined ? input.id.trim() : base.id,
    name: input.name !== undefined ? input.name.trim() : base.name,
    location: input.location !== undefined ? (input.location || "").trim() : (input.address !== undefined ? (input.address || "").trim() : base.location),
    address: input.address !== undefined ? (input.address || "").trim() : (input.location !== undefined ? (input.location || "").trim() : base.address),
    contact: input.contact !== undefined ? (input.contact || "").trim() : base.contact,
    phone: input.phone !== undefined ? (input.phone || "").trim() : base.phone,
    note: input.note !== undefined ? (input.note || "").trim() : base.note,
    isDefault: input.isDefault !== undefined ? Boolean(input.isDefault) : base.isDefault,
    createdAt: base.createdAt || new Date().toISOString(),
    costCategories,
  };
}

function getDefaultFarm(farms) {
  if (!farms || !farms.length) return null;
  return farms.find((f) => f.isDefault) || farms[0];
}

function ensureDefaultFarm(db) {
  if (!db.farms) db.farms = [];
  if (db.farms.length === 0) {
    db.farms.push({
      id: DEFAULT_FARM_ID,
      name: "默认场区",
      location: "",
      address: "",
      contact: "",
      phone: "",
      note: "系统自动创建的默认场区，包含所有迁移的历史数据",
      isDefault: true,
      createdAt: new Date().toISOString(),
      costCategories: getDefaultCostCategories(),
    });
  }
  if (!db.farms.some((f) => f.isDefault)) {
    db.farms[0].isDefault = true;
  }
  return getDefaultFarm(db.farms);
}

function migrateFarmCostCategories(db) {
  if (!Array.isArray(db.farms)) return 0;
  let migrated = 0;
  for (const farm of db.farms) {
    if (!Array.isArray(farm.costCategories) || farm.costCategories.length === 0) {
      farm.costCategories = getDefaultCostCategories();
      migrated++;
    }
  }
  return migrated;
}

function getFarmCostCategories(db, farmId) {
  const farm = (db.farms || []).find((f) => f.id === farmId);
  if (farm && Array.isArray(farm.costCategories) && farm.costCategories.length > 0) {
    return [...farm.costCategories];
  }
  return getDefaultCostCategories();
}

function getAllCostCategoriesForFarm(db, farmId) {
  const farmCats = getFarmCostCategories(db, farmId);
  const legacyCats = getDefaultCostCategories();
  const merged = [...new Set([...legacyCats, ...farmCats])];
  return merged;
}

function migrateDataToFarm(db, defaultFarm) {
  const farmId = defaultFarm.id;
  const collections = [
    "parentPools",
    "ponds",
    "batches",
    "records",
    "transfers",
    "sales",
    "costItems",
    "orders",
    "shipments",
    "warnings",
    "inventories",
  ];

  let migratedCount = 0;
  for (const collection of collections) {
    if (!Array.isArray(db[collection])) continue;
    for (const item of db[collection]) {
      if (!item.farmId) {
        item.farmId = farmId;
        migratedCount++;
      }
    }
  }
  return migratedCount;
}

export function createFarmsRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function farmsRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/farms") {
      const db = await loadDb();
      return sendJson(res, 200, db.farms || []);
    }

    if (method === "GET" && pathname === "/api/farms/default") {
      const db = await loadDb();
      const defaultFarm = getDefaultFarm(db.farms || []);
      return defaultFarm
        ? sendJson(res, 200, defaultFarm)
        : sendJson(res, 404, { error: "默认场区不存在" });
    }

    const farmMatch = pathname.match(/^\/api\/farms\/([^/]+)$/);
    if (farmMatch) {
      const farmId = decodeURIComponent(farmMatch[1]);
      const db = await loadDb();
      const farms = db.farms || [];
      const farmIndex = farms.findIndex((f) => f.id === farmId);

      if (method === "GET") {
        if (farmIndex === -1) {
          return sendJson(res, 404, { error: "场区不存在" });
        }
        return sendJson(res, 200, farms[farmIndex]);
      }

      if (method === "PUT") {
        if (farmIndex === -1) {
          return sendJson(res, 404, { error: "场区不存在" });
        }
        const input = await body(req);
        const errors = validateFarm(input, true);
        if (errors.length) {
          return sendJson(res, 400, { error: "validation_failed", details: errors });
        }

        if (input.isDefault) {
          farms.forEach((f, i) => {
            if (i !== farmIndex) f.isDefault = false;
          });
        } else if (farms[farmIndex].isDefault && farms.length > 1) {
          return sendJson(res, 400, {
            error: "cannot_unset_default",
            message: "至少需要保留一个默认场区，请先将其他场区设为默认",
          });
        }

        const updated = sanitizeFarm(input, farms[farmIndex]);
        const beforeFarm = JSON.parse(JSON.stringify(farms[farmIndex]));
        farms[farmIndex] = updated;
        db.farms = farms;
        writeLog(db, {
          operator: input.operator || "",
          action: "farm_update",
          targetType: "farm",
          targetId: farmId,
          before: beforeFarm,
          after: updated,
          farmId: farmId,
        });
        await saveDb(db);
        return sendJson(res, 200, updated);
      }

      if (method === "DELETE") {
        if (farmIndex === -1) {
          return sendJson(res, 404, { error: "场区不存在" });
        }
        if (farms[farmIndex].isDefault) {
          return sendJson(res, 400, {
            error: "cannot_delete_default",
            message: "默认场区无法删除，请先将其他场区设为默认",
          });
        }

        const collections = [
          "parentPools",
          "ponds",
          "batches",
          "records",
          "transfers",
          "sales",
          "costItems",
          "orders",
          "shipments",
          "warnings",
          "inventories",
        ];
        for (const collection of collections) {
          if (Array.isArray(db[collection])) {
            const hasData = db[collection].some((item) => item.farmId === farmId);
            if (hasData) {
              return sendJson(res, 400, {
                error: "farm_has_data",
                message: `该场区存在关联数据（${collection}），无法删除。请先迁移或删除相关数据。`,
              });
            }
          }
        }

        const existing = farms[farmIndex];
        existing._originalIndex = farmIndex;
        const [deleted] = farms.splice(farmIndex, 1);
        db.farms = farms;
        writeLog(db, {
          operator: "",
          action: "farm_delete",
          targetType: "farm",
          targetId: farmId,
          before: existing,
          after: null,
          farmId: farmId,
        });
        await saveDb(db);
        return sendJson(res, 200, deleted);
      }
    }

    if (method === "POST" && pathname === "/api/farms") {
      const input = await body(req);
      const errors = validateFarm(input, false);
      if (errors.length) {
        return sendJson(res, 400, { error: "validation_failed", details: errors });
      }
      const db = await loadDb();
      const farms = db.farms || [];
      if (farms.some((f) => f.id === input.id.trim())) {
        return sendJson(res, 409, { error: "场区编号已存在" });
      }

      if (input.isDefault) {
        farms.forEach((f) => (f.isDefault = false));
      }

      const newFarm = sanitizeFarm({
        ...input,
        id: input.id.trim(),
        isDefault: farms.length === 0 ? true : Boolean(input.isDefault),
      });
      farms.push(newFarm);
      db.farms = farms;
      writeLog(db, {
        operator: input.operator || "",
        action: "farm_create",
        targetType: "farm",
        targetId: newFarm.id,
        before: null,
        after: newFarm,
        farmId: newFarm.id,
      });
      await saveDb(db);
      return sendJson(res, 201, newFarm);
    }

    const setDefaultMatch = pathname.match(/^\/api\/farms\/([^/]+)\/set-default$/);
    if (setDefaultMatch && method === "PATCH") {
      const farmId = decodeURIComponent(setDefaultMatch[1]);
      const db = await loadDb();
      const farms = db.farms || [];
      const farm = farms.find((f) => f.id === farmId);
      if (!farm) {
        return sendJson(res, 404, { error: "场区不存在" });
      }
      farms.forEach((f) => (f.isDefault = f.id === farmId));
      db.farms = farms;
      writeLog(db, {
        operator: "",
        action: "farm_set_default",
        targetType: "farm",
        targetId: farmId,
        before: null,
        after: { isDefault: true },
        farmId: farmId,
      });
      await saveDb(db);
      return sendJson(res, 200, farm);
    }

    const costCategoriesMatch = pathname.match(/^\/api\/farms\/([^/]+)\/cost-categories$/);
    if (costCategoriesMatch) {
      const farmId = decodeURIComponent(costCategoriesMatch[1]);
      const db = await loadDb();
      const farms = db.farms || [];
      const farmIndex = farms.findIndex((f) => f.id === farmId);
      if (farmIndex === -1) {
        return sendJson(res, 404, { error: "场区不存在" });
      }

      if (method === "GET") {
        return sendJson(res, 200, {
          costCategories: getFarmCostCategories(db, farmId),
          allCategories: getAllCostCategoriesForFarm(db, farmId),
        });
      }

      if (method === "PUT") {
        const input = await body(req);
        const categories = input.costCategories;
        if (!Array.isArray(categories)) {
          return sendJson(res, 400, { error: "costCategories 必须是数组" });
        }
        const cleaned = categories
          .map((c) => (typeof c === "string" ? c.trim() : ""))
          .filter((c) => c.length > 0);
        if (cleaned.length === 0) {
          return sendJson(res, 400, { error: "至少需要保留一个成本分类" });
        }
        const uniqueCats = [...new Set(cleaned)];
        const beforeFarm = JSON.parse(JSON.stringify(farms[farmIndex]));
        farms[farmIndex].costCategories = uniqueCats;
        db.farms = farms;
        writeLog(db, {
          operator: input.operator || "",
          action: "farm_cost_categories_update",
          targetType: "farm",
          targetId: farmId,
          before: { costCategories: beforeFarm.costCategories },
          after: { costCategories: uniqueCats },
          farmId: farmId,
        });
        await saveDb(db);
        return sendJson(res, 200, {
          costCategories: uniqueCats,
          allCategories: getAllCostCategoriesForFarm(db, farmId),
        });
      }
    }

    return false;
  };
}

export {
  DEFAULT_FARM_ID,
  DEFAULT_COST_CATEGORIES,
  validateFarm,
  sanitizeFarm,
  getDefaultFarm,
  ensureDefaultFarm,
  migrateDataToFarm,
  migrateFarmCostCategories,
  getFarmCostCategories,
  getAllCostCategoriesForFarm,
  getDefaultCostCategories,
};
