export function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

export function generateCsv(headers, rows) {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    const values = headers.map((h) =>
      escapeCsvField(row[h] != null ? String(row[h]) : "")
    );
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function escapeCsvField(field) {
  if (
    field.includes(",") ||
    field.includes('"') ||
    field.includes("\n")
  ) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

export const RECORD_SCHEMA = {
  required: ["batchId", "date", "temperature", "salinity", "oxygen", "feed", "mortality"],
  optional: ["poolId", "abnormal"],
  numeric: ["temperature", "salinity", "oxygen", "feed", "mortality"],
  fieldLabels: {
    batchId: "批次号",
    date: "日期",
    poolId: "池号",
    temperature: "水温(℃)",
    salinity: "盐度",
    oxygen: "溶氧(mg/L)",
    feed: "投喂量(kg)",
    mortality: "死亡率(%)",
    abnormal: "异常情况",
  },
};

function validateSingleRecordRow(row, rowNum, context) {
  const { batchIds, existingRecordKeys, seenKeys, excludeDuplicateInFileCheck } = context || {};
  const rowErrors = [];

  RECORD_SCHEMA.required.forEach((field) => {
    if (!row[field] || String(row[field]).trim() === "") {
      rowErrors.push({
        type: "missing_field",
        field,
        row: rowNum,
        message: `第${rowNum}行：字段"${RECORD_SCHEMA.fieldLabels[field] || field}"缺失`,
      });
    }
  });

  if (
    row.batchId &&
    String(row.batchId).trim() !== "" &&
    batchIds &&
    !batchIds.has(String(row.batchId).trim())
  ) {
    rowErrors.push({
      type: "batch_not_found",
      field: "batchId",
      row: rowNum,
      message: `第${rowNum}行：批次"${row.batchId}"不存在`,
    });
  }

  RECORD_SCHEMA.numeric.forEach((field) => {
    if (row[field] !== undefined && String(row[field]).trim() !== "") {
      const num = Number(row[field]);
      if (isNaN(num)) {
        rowErrors.push({
          type: "invalid_number",
          field,
          row: rowNum,
          message: `第${rowNum}行：字段"${RECORD_SCHEMA.fieldLabels[field] || field}"值"${row[field]}"不是有效数字`,
        });
      }
    }
  });

  if (
    row.date &&
    String(row.date).trim() !== "" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date).trim())
  ) {
    rowErrors.push({
      type: "invalid_format",
      field: "date",
      row: rowNum,
      message: `第${rowNum}行：日期"${row.date}"格式不正确，应为YYYY-MM-DD`,
    });
  }

  const key = (row.batchId || "") + "|" + (row.date || "");
  if (row.batchId && row.date) {
    if (existingRecordKeys && existingRecordKeys.has(key)) {
      rowErrors.push({
        type: "duplicate_existing",
        field: "date",
        row: rowNum,
        message: `第${rowNum}行：批次${row.batchId}在${row.date}已有记录`,
      });
    }
    if (!excludeDuplicateInFileCheck && seenKeys) {
      if (seenKeys.has(key)) {
        rowErrors.push({
          type: "duplicate_in_file",
          field: "date",
          row: rowNum,
          message: `第${rowNum}行：文件内批次${row.batchId}在${row.date}重复`,
        });
      } else {
        seenKeys.add(key);
      }
    }
  }

  let normalizedRow = null;
  if (rowErrors.length === 0) {
    normalizedRow = {
      batchId: String(row.batchId).trim(),
      date: String(row.date).trim(),
      poolId: row.poolId ? String(row.poolId).trim() : "",
      temperature: Number(row.temperature),
      salinity: Number(row.salinity),
      oxygen: Number(row.oxygen),
      feed: Number(row.feed),
      mortality: Number(row.mortality),
      abnormal: row.abnormal ? String(row.abnormal).trim() : "无",
    };
  }

  return {
    rowNum,
    originalRow: { ...row },
    normalizedRow,
    errors: rowErrors,
    isValid: rowErrors.length === 0,
  };
}

export function validateRecordsCsv(parsed, db, options = {}) {
  const { headers, rows } = parsed;
  const missingHeaders = RECORD_SCHEMA.required.filter(
    (h) => !headers.includes(h)
  );
  if (missingHeaders.length > 0) {
    return {
      valid: false,
      fatalError: "缺少必要列：" + missingHeaders.join("、"),
    };
  }

  const batchIds = new Set((db.batches || []).map((b) => b.id));
  const existingRecordKeys = new Set(
    (db.records || []).map((r) => r.batchId + "|" + r.date)
  );
  const seenKeys = new Set();

  const errors = [];
  const warnings = [];
  const validRows = [];
  const allRowStatuses = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const result = validateSingleRecordRow(row, rowNum, {
      batchIds,
      existingRecordKeys,
      seenKeys,
    });

    allRowStatuses.push(result);

    if (result.isValid) {
      validRows.push(result.normalizedRow);
    } else {
      errors.push(...result.errors);
    }
  });

  return {
    valid: true,
    totalRows: rows.length,
    validCount: validRows.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    preview: validRows.slice(0, 20),
    validRows,
    allRowStatuses,
    headers,
  };
}

export function revalidateSingleRow(row, rowNum, db, existingValidKeys = []) {
  const batchIds = new Set((db.batches || []).map((b) => b.id));
  const existingRecordKeys = new Set(
    (db.records || []).map((r) => r.batchId + "|" + r.date)
  );
  const seenKeys = new Set(existingValidKeys);

  return validateSingleRecordRow(row, rowNum, {
    batchIds,
    existingRecordKeys,
    seenKeys,
    excludeDuplicateInFileCheck: false,
  });
}

export function buildRecordExportHeaders() {
  return [
    "id",
    "batchId",
    "date",
    "poolId",
    "temperature",
    "salinity",
    "oxygen",
    "feed",
    "mortality",
    "abnormal",
  ];
}

export function buildBatchExportHeaders() {
  return [
    "id",
    "species",
    "parentPoolId",
    "hatchDate",
    "currentPool",
    "estimatedCount",
    "status",
    "cost",
  ];
}

export function buildTransferExportHeaders() {
  return ["id", "batchId", "fromPool", "toPool", "date", "count", "reason"];
}

export function buildSalesExportHeaders() {
  return ["id", "batchId", "date", "customerId", "customer", "count", "unitPrice"];
}

export function buildOrderExportHeaders() {
  return [
    "id",
    "customerId",
    "customerName",
    "batchId",
    "orderQuantity",
    "shippedQuantity",
    "remainingQuantity",
    "status",
    "statusLabel",
    "deliveryDate",
    "unitPrice",
    "totalAmount",
    "note",
    "createdAt",
  ];
}

export function buildShipmentExportHeaders() {
  return [
    "id",
    "orderId",
    "customerId",
    "customerName",
    "batchId",
    "quantity",
    "unitPrice",
    "amount",
    "date",
    "note",
    "createdAt",
  ];
}

export function enrichOrdersForExport(orders, db) {
  return orders.map((order) => {
    const shipments = (db.shipments || []).filter((s) => s.orderId === order.id);
    const shippedQuantity = shipments.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    const remainingQuantity = Math.max(0, Number(order.orderQuantity) - shippedQuantity);
    const totalAmount = Number(order.orderQuantity) * Number(order.unitPrice);

    let status = order.status;
    if (status !== "cancelled") {
      if (shippedQuantity === 0) {
        status = "pending";
      } else if (shippedQuantity < Number(order.orderQuantity)) {
        status = "partial";
      } else {
        status = "completed";
      }
    }

    const STATUS_LABELS = {
      pending: "待发货",
      partial: "部分发货",
      completed: "已完成",
      cancelled: "已取消",
    };

    return {
      ...order,
      shippedQuantity,
      remainingQuantity,
      status,
      statusLabel: STATUS_LABELS[status] || status,
      totalAmount: Number(totalAmount.toFixed(2)),
    };
  });
}

export function enrichShipmentsForExport(shipments, db) {
  return shipments.map((shipment) => {
    const order = (db.orders || []).find((o) => o.id === shipment.orderId);
    const unitPrice = order?.unitPrice || 0;
    const amount = Number(shipment.quantity) * Number(unitPrice);

    return {
      ...shipment,
      customerId: order?.customerId || "",
      customerName: order?.customerName || shipment.customerName || "",
      unitPrice: Number(unitPrice),
      amount: Number(amount.toFixed(2)),
    };
  });
}
