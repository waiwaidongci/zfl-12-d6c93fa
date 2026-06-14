const VALID_STATUSES = ["active", "idle", "cleaning", "maintenance"];
const VALID_PURPOSES = ["虾苗培育", "蟹苗培育", "贝苗培育", "鱼种培育", "暂养池", "其他"];
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

function validatePond(input, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    if (!input.id || typeof input.id !== "string" || !input.id.trim()) {
      errors.push("池号不能为空");
    } else if (!/^[A-Za-z0-9\-_]+$/.test(input.id.trim())) {
      errors.push("池号只能包含字母、数字、连字符和下划线");
    }
  }

  if (input.name !== undefined && (!input.name || typeof input.name !== "string" || !input.name.trim())) {
    errors.push("名称不能为空");
  }

  if (input.status && !VALID_STATUSES.includes(input.status)) {
    errors.push("状态值无效");
  }

  if (input.purpose && !VALID_PURPOSES.includes(input.purpose)) {
    errors.push("用途值无效");
  }

  if (input.capacity !== undefined && typeof input.capacity !== "string") {
    errors.push("容量必须是字符串");
  }

  if (input.disinfectionDate !== undefined && input.disinfectionDate !== "") {
    const date = new Date(input.disinfectionDate);
    if (isNaN(date.getTime())) {
      errors.push("消毒日期格式无效");
    }
  }

  return errors;
}

function sanitizePond(input, existing = null) {
  const base = existing || {
    id: "",
    name: "",
    capacity: "",
    purpose: "",
    status: "idle",
    disinfectionDate: "",
    note: "",
    farmId: "",
  };

  return {
    id: input.id !== undefined ? input.id.trim() : base.id,
    name: input.name !== undefined ? input.name.trim() : base.name,
    capacity: input.capacity !== undefined ? input.capacity.trim() : base.capacity,
    purpose: input.purpose !== undefined ? input.purpose : base.purpose,
    status: input.status !== undefined ? input.status : base.status,
    disinfectionDate:
      input.disinfectionDate !== undefined
        ? input.disinfectionDate
        : base.disinfectionDate,
    note: input.note !== undefined ? input.note.trim() : base.note,
    farmId: input.farmId !== undefined ? input.farmId.trim() : base.farmId,
  };
}

export function createPondsRouter(helpers) {
  const { loadDb, saveDb, sendJson, body } = helpers;

  return async function pondsRouter(req, res, pathname, method) {
    if (method === "GET" && pathname === "/api/ponds") {
      const db = await loadDb();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get("farmId");
      let ponds = db.ponds;
      if (farmId) {
        ponds = ponds.filter((p) => p.farmId === farmId);
      }
      return sendJson(res, 200, ponds);
    }

    const pondsMatch = pathname.match(/^\/api\/ponds\/([^/]+)$/);
    if (pondsMatch) {
      const pondId = decodeURIComponent(pondsMatch[1]);
      const db = await loadDb();
      const pondIndex = db.ponds.findIndex((p) => p.id === pondId);

      if (method === "GET") {
        if (pondIndex === -1) {
          return sendJson(res, 404, { error: "pond_not_found" });
        }
        return sendJson(res, 200, db.ponds[pondIndex]);
      }

      if (method === "PUT") {
        if (pondIndex === -1) {
          return sendJson(res, 404, { error: "pond_not_found" });
        }
        const farmId = getFarmIdFromQuery(req);
        const existing = db.ponds[pondIndex];
        if (farmId && existing.farmId !== farmId) {
          return sendJson(res, 404, { error: "pond_not_found" });
        }
        const input = await body(req);
        const errors = validatePond(input, true);
        if (errors.length) {
          return sendJson(res, 400, { error: "validation_failed", details: errors });
        }
        const updated = sanitizePond(input, existing);
        updated.farmId = existing.farmId;
        db.ponds[pondIndex] = updated;
        await saveDb(db);
        return sendJson(res, 200, updated);
      }

      if (method === "DELETE") {
        if (pondIndex === -1) {
          return sendJson(res, 404, { error: "pond_not_found" });
        }
        const farmId = getFarmIdFromQuery(req);
        const existing = db.ponds[pondIndex];
        if (farmId && existing.farmId !== farmId) {
          return sendJson(res, 404, { error: "pond_not_found" });
        }
        const usedInBatch = db.batches.some((b) => b.currentPool === pondId);
        const usedInRecords = db.records.some((r) => r.poolId === pondId);
        const usedInTransfers = db.transfers.some(
          (t) => t.fromPool === pondId || t.toPool === pondId
        );
        if (usedInBatch || usedInRecords || usedInTransfers) {
          return sendJson(res, 400, {
            error: "pond_in_use",
            message: "该池子已被批次/记录/流转引用，无法删除",
          });
        }
        const [deleted] = db.ponds.splice(pondIndex, 1);
        await saveDb(db);
        return sendJson(res, 200, deleted);
      }
    }

    if (method === "POST" && pathname === "/api/ponds") {
      const input = await body(req);
      const errors = validatePond(input, false);
      if (errors.length) {
        return sendJson(res, 400, { error: "validation_failed", details: errors });
      }
      const db = await loadDb();
      if (db.ponds.some((p) => p.id === input.id.trim())) {
        return sendJson(res, 409, { error: "pond_exists", message: "池号已存在" });
      }
      const farmId = input.farmId || getDefaultFarmId(db);
      const newPond = sanitizePond({ ...input, id: input.id.trim(), farmId });
      db.ponds.push(newPond);
      await saveDb(db);
      return sendJson(res, 201, newPond);
    }

    const statusMatch = pathname.match(/^\/api\/ponds\/([^/]+)\/status$/);
    if (statusMatch && method === "PATCH") {
      const pondId = decodeURIComponent(statusMatch[1]);
      const db = await loadDb();
      const pondIndex = db.ponds.findIndex((p) => p.id === pondId);
      if (pondIndex === -1) {
        return sendJson(res, 404, { error: "pond_not_found" });
      }
      const farmId = getFarmIdFromQuery(req);
      const existing = db.ponds[pondIndex];
      if (farmId && existing.farmId !== farmId) {
        return sendJson(res, 404, { error: "pond_not_found" });
      }
      const input = await body(req);
      const errors = [];
      if (input.status && !VALID_STATUSES.includes(input.status)) {
        errors.push("状态值无效");
      }
      if (
        input.disinfectionDate !== undefined &&
        input.disinfectionDate !== "" &&
        isNaN(new Date(input.disinfectionDate).getTime())
      ) {
        errors.push("消毒日期格式无效");
      }
      if (errors.length) {
        return sendJson(res, 400, { error: "validation_failed", details: errors });
      }
      const updated = {
        ...existing,
        status: input.status !== undefined ? input.status : existing.status,
        disinfectionDate:
          input.disinfectionDate !== undefined
            ? input.disinfectionDate
            : existing.disinfectionDate,
        note: input.note !== undefined ? input.note.trim() : existing.note,
        farmId: existing.farmId,
      };
      db.ponds[pondIndex] = updated;
      await saveDb(db);
      return sendJson(res, 200, updated);
    }

    return false;
  };
}

export { VALID_STATUSES, VALID_PURPOSES, validatePond, sanitizePond };
