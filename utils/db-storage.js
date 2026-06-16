import { mkdir, readFile, writeFile, rename, copyFile, unlink, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename, extname } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_BACKUP_COUNT = 5;
const TEMP_SUFFIX = ".tmp";
const BACKUP_DIRNAME = "backups";

const REQUIRED_COLLECTIONS = {
  parentPools: { type: "array", required: false },
  ponds: { type: "array", required: false },
  batches: { type: "array", required: false },
  records: { type: "array", required: false },
  transfers: { type: "array", required: false },
  sales: { type: "array", required: false },
  costItems: { type: "array", required: false },
  orders: { type: "array", required: false },
  shipments: { type: "array", required: false },
  customers: { type: "array", required: false },
  warnings: { type: "array", required: true },
  warningThresholds: { type: "object", required: false },
  inventories: { type: "array", required: false },
  farms: { type: "array", required: true },
  lineages: { type: "array", required: true },
  opLogs: { type: "array", required: false },
  importDrafts: { type: "array", required: true },
  quantityLedgers: { type: "array", required: false },
  _schemaVersion: { type: "number", required: false },
};

const FARM_SCOPED_COLLECTIONS = [
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
  "lineages",
  "opLogs",
  "importDrafts",
  "quantityLedgers",
];

class DbStorageError extends Error {
  constructor(message, { code, cause, details } = {}) {
    super(message);
    this.name = "DbStorageError";
    this.code = code || "STORAGE_ERROR";
    this.cause = cause || null;
    this.details = details || null;
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function getTempPath(dbPath) {
  return `${dbPath}${TEMP_SUFFIX}`;
}

function getBackupDir(dbPath) {
  return join(dirname(dbPath), BACKUP_DIRNAME);
}

function getBackupPath(dbPath, timestamp) {
  const base = basename(dbPath, extname(dbPath));
  const backupDir = getBackupDir(dbPath);
  const dateStr = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  return join(backupDir, `${base}-${dateStr}.json.bak`);
}

async function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

async function atomicWriteFile(filePath, data, options = {}) {
  const tmpPath = getTempPath(filePath);
  const dir = dirname(filePath);
  await ensureDir(dir);

  try {
    await unlink(tmpPath);
  } catch {}

  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const expectedHash = sha256(content);

  await writeFile(tmpPath, content, { encoding: "utf-8", flag: "w", ...options });

  const writtenContent = await readFile(tmpPath, "utf-8");
  const actualHash = sha256(writtenContent);
  if (actualHash !== expectedHash) {
    try {
      await unlink(tmpPath);
    } catch {}
    throw new DbStorageError("原子写入失败：临时文件校验和不匹配", {
      code: "WRITE_CHECKSUM_MISMATCH",
      details: {
        expectedHash,
        actualHash,
        contentLength: content.length,
        writtenLength: writtenContent.length,
        firstDiff: findFirstDiff(content, writtenContent),
      },
    });
  }

  await rename(tmpPath, filePath);
  return { hash: actualHash, size: Buffer.byteLength(content, "utf-8") };
}

function findFirstDiff(a, b) {
  if (a === b) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

function parseBackupTimestamp(filename) {
  const match = filename.match(/-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
  if (!match) return 0;
  try {
    const isoStr = match[1].replace(/(\d{2})-(\d{2})-(\d{3}Z)$/, "$1:$2.$3");
    return new Date(isoStr).getTime();
  } catch {
    return 0;
  }
}

async function listBackups(dbPath) {
  const backupDir = getBackupDir(dbPath);
  if (!existsSync(backupDir)) return [];

  const files = await readdir(backupDir);
  const backupFiles = [];

  for (const file of files) {
    if (file.endsWith(".json.bak")) {
      const fullPath = join(backupDir, file);
      try {
        const stats = await stat(fullPath);
        const tsFromName = parseBackupTimestamp(file);
        backupFiles.push({
          path: fullPath,
          name: file,
          size: stats.size,
          createdAt: tsFromName || stats.birthtime.getTime(),
          mtime: stats.mtime.getTime(),
        });
      } catch {}
    }
  }

  backupFiles.sort((a, b) => b.createdAt - a.createdAt);
  return backupFiles;
}

async function rotateBackups(dbPath, keepCount = DEFAULT_BACKUP_COUNT) {
  const backupDir = getBackupDir(dbPath);
  await ensureDir(backupDir);

  const backups = await listBackups(dbPath);
  while (backups.length > keepCount) {
    const oldest = backups.pop();
    try {
      await unlink(oldest.path);
    } catch (e) {
      console.warn(`[db-storage] 删除旧备份失败: ${oldest.path}`, e.message);
    }
  }
}

async function createBackup(dbPath, sourceContent = null) {
  const backupDir = getBackupDir(dbPath);
  await ensureDir(backupDir);

  const now = Date.now();
  const backupPath = getBackupPath(dbPath, now);

  if (sourceContent !== null) {
    await writeFile(backupPath, sourceContent, "utf-8");
  } else {
    if (!existsSync(dbPath)) {
      return null;
    }
    await copyFile(dbPath, backupPath);
  }

  return {
    path: backupPath,
    createdAt: now,
    size: (await stat(backupPath)).size,
  };
}

async function restoreFromBackup(dbPath, backupPath) {
  if (!existsSync(backupPath)) {
    throw new DbStorageError(`备份文件不存在: ${backupPath}`, {
      code: "BACKUP_NOT_FOUND",
      details: { backupPath },
    });
  }

  const backupContent = await readFile(backupPath, "utf-8");
  try {
    JSON.parse(backupContent);
  } catch (e) {
    throw new DbStorageError(`备份文件损坏，无法解析为JSON: ${backupPath}`, {
      code: "BACKUP_CORRUPTED",
      cause: e,
      details: { backupPath, parseError: e.message },
    });
  }

  let corruptedBackupPath = null;
  if (existsSync(dbPath)) {
    const base = basename(dbPath, extname(dbPath));
    const backupDir = getBackupDir(dbPath);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    corruptedBackupPath = join(backupDir, `${base}-corrupted-${ts}.json.bak`);
    try {
      await ensureDir(backupDir);
      await copyFile(dbPath, corruptedBackupPath);
    } catch (e) {
      corruptedBackupPath = null;
      console.warn(`[db-storage] 保存损坏文件的副本失败:`, e.message);
    }
  }

  const result = await atomicWriteFile(dbPath, backupContent);
  return {
    ...result,
    restoredFrom: backupPath,
    corruptedBackup: corruptedBackupPath,
  };
}

async function findLatestValidBackup(dbPath) {
  const backups = await listBackups(dbPath);
  for (const backup of backups) {
    try {
      const content = await readFile(backup.path, "utf-8");
      JSON.parse(content);
      return backup;
    } catch (e) {
      console.warn(`[db-storage] 备份文件损坏，跳过: ${backup.name}`, e.message);
    }
  }
  return null;
}

function validateStructure(db, options = {}) {
  const errors = [];
  const warnings = [];
  const info = [];

  if (!db || typeof db !== "object" || Array.isArray(db)) {
    errors.push({
      field: "<root>",
      message: "数据库根节点必须是对象",
      code: "ROOT_NOT_OBJECT",
    });
    return { valid: false, errors, warnings, info };
  }

  for (const [key, spec] of Object.entries(REQUIRED_COLLECTIONS)) {
    const value = db[key];

    if (value === undefined || value === null) {
      if (spec.required) {
        errors.push({
          field: key,
          message: `缺少必需字段: ${key}`,
          code: "MISSING_REQUIRED",
        });
      } else {
        info.push({
          field: key,
          message: `可选字段不存在: ${key}（将在迁移时自动创建）`,
          code: "MISSING_OPTIONAL",
        });
      }
      continue;
    }

    if (spec.type === "array" && !Array.isArray(value)) {
      errors.push({
        field: key,
        message: `字段 ${key} 类型错误：期望数组，实际 ${typeof value}`,
        code: "TYPE_MISMATCH",
      });
    }

    if (spec.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
      errors.push({
        field: key,
        message: `字段 ${key} 类型错误：期望对象，实际 ${Array.isArray(value) ? "数组" : typeof value}`,
        code: "TYPE_MISMATCH",
      });
    }
  }

  if (db.farms && Array.isArray(db.farms) && db.farms.length > 0) {
    const farmIds = new Set(db.farms.map((f) => f.id));
    const hasDefault = db.farms.some((f) => f.isDefault);

    if (!hasDefault) {
      warnings.push({
        field: "farms",
        message: "未设置默认场区，将自动设置第一个为默认",
        code: "NO_DEFAULT_FARM",
      });
    }

    for (const collection of FARM_SCOPED_COLLECTIONS) {
      if (!Array.isArray(db[collection])) continue;
      for (let i = 0; i < db[collection].length; i++) {
        const item = db[collection][i];
        if (!item || typeof item !== "object") continue;
        if (item.farmId && !farmIds.has(item.farmId)) {
          warnings.push({
            field: `${collection}[${i}]`,
            message: `${collection} 第 ${i + 1} 条记录引用了不存在的场区: ${item.farmId}`,
            code: "UNKNOWN_FARM_ID",
            details: { id: item.id, farmId: item.farmId },
          });
        }
      }
    }
  }

  if (db.batches && Array.isArray(db.batches)) {
    const batchIds = new Set();
    for (const b of db.batches) {
      if (b.id) {
        if (batchIds.has(b.id)) {
          errors.push({
            field: `batches`,
            message: `批次ID重复: ${b.id}`,
            code: "DUPLICATE_BATCH_ID",
            details: { batchId: b.id },
          });
        }
        batchIds.add(b.id);
      }
    }

    if (db.lineages && Array.isArray(db.lineages)) {
      for (let i = 0; i < db.lineages.length; i++) {
        const lin = db.lineages[i];
        for (const src of lin.sources || []) {
          if (src.batchId && !batchIds.has(src.batchId)) {
            warnings.push({
              field: `lineages[${i}]`,
              message: `血缘记录引用了不存在的来源批次: ${src.batchId}`,
              code: "UNKNOWN_SOURCE_BATCH",
              details: { lineageId: lin.id, batchId: src.batchId },
            });
          }
        }
        for (const tgt of lin.targets || []) {
          if (tgt.batchId && !batchIds.has(tgt.batchId)) {
            warnings.push({
              field: `lineages[${i}]`,
              message: `血缘记录引用了不存在的目标批次: ${tgt.batchId}`,
              code: "UNKNOWN_TARGET_BATCH",
              details: { lineageId: lin.id, batchId: tgt.batchId },
            });
          }
        }
      }
    }
  }

  if (db._schemaVersion !== undefined) {
    if (typeof db._schemaVersion !== "number") {
      warnings.push({
        field: "_schemaVersion",
        message: `_schemaVersion 不是数字: ${typeof db._schemaVersion}`,
        code: "SCHEMA_VERSION_TYPE",
      });
    } else {
      info.push({
        field: "_schemaVersion",
        message: `当前 schema 版本: ${db._schemaVersion}`,
        code: "SCHEMA_VERSION_INFO",
        details: { version: db._schemaVersion },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
    stats: {
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: info.length,
    },
  };
}

function deepCloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

async function safeLoadAndPrepare(dbPath, options = {}) {
  const { autoCreate = true, seedFn = null } = options;
  const result = {
    db: null,
    loadedFrom: null,
    originalContent: null,
    backupCreated: null,
    preValidation: null,
    recoveryUsed: false,
    createdNew: false,
  };

  if (!existsSync(dbPath)) {
    if (!autoCreate) {
      throw new DbStorageError(`数据库文件不存在且禁止自动创建: ${dbPath}`, {
        code: "DB_NOT_FOUND",
      });
    }
    await ensureDir(dirname(dbPath));
    if (seedFn) {
      const seed = seedFn();
      const seedContent = JSON.stringify(seed, null, 2);
      await atomicWriteFile(dbPath, seedContent);
      result.createdNew = true;
      result.db = seed;
      result.loadedFrom = "seed";
      result.originalContent = seedContent;
      result.preValidation = validateStructure(seed);
      return result;
    }
  }

  let rawContent = null;
  let parseError = null;

  try {
    rawContent = await readFile(dbPath, "utf-8");
    result.db = JSON.parse(rawContent);
    result.originalContent = rawContent;
    result.loadedFrom = "primary";
  } catch (e) {
    parseError = e;
    console.error(`[db-storage] 主数据库文件读取/解析失败，尝试恢复:`, e.message);
  }

  if (parseError) {
    const validBackup = await findLatestValidBackup(dbPath);
    if (validBackup) {
      console.warn(`[db-storage] 使用最近有效备份恢复: ${validBackup.name}`);
      await restoreFromBackup(dbPath, validBackup.path);
      rawContent = await readFile(dbPath, "utf-8");
      result.db = JSON.parse(rawContent);
      result.originalContent = rawContent;
      result.loadedFrom = "backup";
      result.recoveryUsed = true;
    } else {
      if (autoCreate && seedFn) {
        console.warn(`[db-storage] 无有效备份，重新初始化种子数据`);
        const seed = seedFn();
        const seedContent = JSON.stringify(seed, null, 2);
        await atomicWriteFile(dbPath, seedContent);
        result.createdNew = true;
        result.db = seed;
        result.originalContent = seedContent;
        result.loadedFrom = "seed_after_corruption";
      } else {
        throw new DbStorageError("数据库文件损坏且无有效备份", {
          code: "DB_CORRUPTED_NO_BACKUP",
          cause: parseError,
          details: { dbPath },
        });
      }
    }
  }

  if (result.originalContent && result.loadedFrom === "primary") {
    try {
      result.backupCreated = await createBackup(dbPath, result.originalContent);
    } catch (e) {
      console.warn(`[db-storage] 保存启动前备份失败:`, e.message);
    }
  }

  result.preValidation = validateStructure(result.db);
  return result;
}

async function safeSave(dbPath, db, options = {}) {
  const {
    preValidate = true,
    postValidate = true,
    createBackup: doCreateBackup = true,
    backupCount = DEFAULT_BACKUP_COUNT,
  } = options;

  if (preValidate) {
    const v = validateStructure(db);
    if (!v.valid) {
      throw new DbStorageError("保存前结构校验失败", {
        code: "PRE_VALIDATION_FAILED",
        details: v,
      });
    }
  }

  const content = JSON.stringify(db, null, 2);
  const contentHash = sha256(content);

  let backupResult = null;
  if (doCreateBackup && existsSync(dbPath)) {
    try {
      backupResult = await createBackup(dbPath);
      await rotateBackups(dbPath, backupCount);
    } catch (e) {
      console.warn(`[db-storage] 备份流程警告（不会阻止保存）:`, e.message);
    }
  }

  const writeResult = await atomicWriteFile(dbPath, content);

  const verifyContent = await readFile(dbPath, "utf-8");
  const verifyHash = sha256(verifyContent);
  if (verifyHash !== contentHash) {
    throw new DbStorageError("保存后校验和验证失败，数据可能已损坏", {
      code: "POST_WRITE_VERIFY_FAILED",
      details: { expected: contentHash, actual: verifyHash },
    });
  }

  let postValidation = null;
  if (postValidate) {
    let savedDb;
    try {
      savedDb = JSON.parse(verifyContent);
      postValidation = validateStructure(savedDb);
      if (!postValidation.valid) {
        throw new DbStorageError("保存后结构校验失败", {
          code: "POST_VALIDATION_FAILED",
          details: postValidation,
        });
      }
    } catch (e) {
      if (e instanceof DbStorageError) throw e;
      throw new DbStorageError("保存后无法重新解析数据", {
        code: "POST_WRITE_PARSE_FAILED",
        cause: e,
      });
    }
  }

  return {
    ...writeResult,
    hash: contentHash,
    postValidation,
    backupCreated: backupResult,
  };
}

function isOnlyMissingFieldErrors(validation) {
  if (validation.valid) return true;
  const acceptableCodes = new Set(["MISSING_REQUIRED", "MISSING_OPTIONAL"]);
  return validation.errors.every((e) => acceptableCodes.has(e.code));
}

async function runMigration(dbPath, db, migrateFn, options = {}) {
  const {
    validateBefore = true,
    validateAfter = true,
    backupBefore = true,
    migrationName = "migration",
    allowMissingFields = true,
  } = options;

  let preValidation = null;
  if (validateBefore) {
    preValidation = validateStructure(db);
    if (!preValidation.valid) {
      if (allowMissingFields && isOnlyMissingFieldErrors(preValidation)) {
        console.log(`[db-storage] 迁移[${migrationName}]前有 ${preValidation.stats.errorCount} 个缺失字段错误，允许迁移修复`);
      } else {
        throw new DbStorageError(`迁移[${migrationName}]前结构校验失败`, {
          code: "MIGRATION_PRE_VALIDATION_FAILED",
          details: preValidation,
        });
      }
    }
  }

  const dbSnapshot = deepCloneDb(db);
  const snapshotHash = sha256(JSON.stringify(dbSnapshot));

  if (backupBefore && existsSync(dbPath)) {
    try {
      const originalContent = await readFile(dbPath, "utf-8");
      const preBackupPath = getBackupPath(
        dbPath.replace(/\.json$/, `-pre-${migrationName}`),
        Date.now()
      );
      await ensureDir(dirname(preBackupPath));
      await writeFile(preBackupPath, originalContent, "utf-8");
    } catch (e) {
      console.warn(`[db-storage] 迁移前备份警告:`, e.message);
    }
  }

  let migrationResult;
  try {
    migrationResult = migrateFn(db);
  } catch (e) {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, dbSnapshot);
    throw new DbStorageError(`迁移[${migrationName}]执行失败，已回滚到迁移前状态`, {
      code: "MIGRATION_EXECUTION_FAILED",
      cause: e,
      details: { migrationName, originalError: e.message },
    });
  }

  const postMigrationHash = sha256(JSON.stringify(db));
  const changed = postMigrationHash !== snapshotHash;

  let postValidation = null;
  if (validateAfter) {
    postValidation = validateStructure(db);
    if (!postValidation.valid) {
      if (allowMissingFields && isOnlyMissingFieldErrors(postValidation)) {
        console.log(`[db-storage] 迁移[${migrationName}]后有 ${postValidation.stats.errorCount} 个缺失字段错误，后续迁移将继续修复`);
      } else {
        for (const key of Object.keys(db)) delete db[key];
        Object.assign(db, dbSnapshot);
        throw new DbStorageError(`迁移[${migrationName}]后结构校验失败，已回滚`, {
          code: "MIGRATION_POST_VALIDATION_FAILED",
          details: postValidation,
        });
      }
    }
  }

  return {
    success: true,
    changed,
    migrationName,
    migrationResult,
    preValidation,
    postValidation,
    rollbackPerformed: false,
  };
}

export {
  DbStorageError,
  REQUIRED_COLLECTIONS,
  FARM_SCOPED_COLLECTIONS,
  DEFAULT_BACKUP_COUNT,
  validateStructure,
  deepCloneDb,
  atomicWriteFile,
  createBackup,
  listBackups,
  rotateBackups,
  restoreFromBackup,
  findLatestValidBackup,
  safeLoadAndPrepare,
  safeSave,
  runMigration,
  getBackupDir,
  getBackupPath,
  sha256,
};
