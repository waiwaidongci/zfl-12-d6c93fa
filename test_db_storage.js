import { mkdir, readFile, writeFile, unlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  DbStorageError,
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
  sha256,
  DEFAULT_BACKUP_COUNT,
} from "./utils/db-storage.js";
import { getInitialSeed } from "./seed/seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(__dirname, "data", "_test_storage");
const TEST_DB = join(TEST_DIR, "testdb.json");

let testCounter = 0;
let passCounter = 0;
let failCounter = 0;

function log(msg, indent = 0) {
  const prefix = "  ".repeat(indent);
  console.log(prefix + msg);
}

function section(title) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

async function test(name, fn) {
  testCounter++;
  process.stdout.write(`  [${testCounter.toString().padStart(2, "0")}] ${name} ... `);
  try {
    await fn();
    passCounter++;
    process.stdout.write("PASS\n");
  } catch (e) {
    failCounter++;
    process.stdout.write("FAIL\n");
    console.error(`       错误: ${e.message}`);
    if (e.cause) console.error(`       原因: ${e.cause.message}`);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

async function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true, force: true });
  }
  await mkdir(TEST_DIR, { recursive: true });
}

function makeValidDb() {
  const seed = getInitialSeed();
  return {
    ...seed,
    farms: seed.farms || [
      {
        id: "FARM-DEFAULT",
        name: "默认场区",
        isDefault: true,
        costCategories: ["饲料", "药品"],
        createdAt: new Date().toISOString(),
      },
    ],
    lineages: [],
    warnings: [],
    importDrafts: [],
  };
}

await (async () => {
section("1. 原子写入测试");
await cleanupTestDir();

await test("原子写入: 写入有效JSON并校验内容", async () => {
  const data = { a: 1, b: "test", c: [1, 2, 3] };
  await atomicWriteFile(TEST_DB, data);
  const readBack = JSON.parse(await readFile(TEST_DB, "utf-8"));
  assert.deepEqual(readBack, data, "读写内容不一致");
});

await test("原子写入: 临时文件不应残留", async () => {
  const tmpPath = TEST_DB + ".tmp";
  if (existsSync(tmpPath)) await unlink(tmpPath);
  await atomicWriteFile(TEST_DB, { x: 1 });
  assert.equal(existsSync(tmpPath), false, "临时文件未清理");
});

await test("原子写入: 自动创建目录", async () => {
  const nestedPath = join(TEST_DIR, "nested", "deep", "db.json");
  if (existsSync(dirname(nestedPath))) await rm(dirname(nestedPath), { recursive: true, force: true });
  await atomicWriteFile(nestedPath, { created: true });
  assert.equal(existsSync(nestedPath), true, "目录未自动创建");
  const content = JSON.parse(await readFile(nestedPath, "utf-8"));
  assert.deepEqual(content, { created: true });
});

await test("原子写入: SHA256校验和一致性", async () => {
  const content = { hash: "test", n: 42 };
  const str = JSON.stringify(content, null, 2);
  const expected = sha256(str);
  const result = await atomicWriteFile(TEST_DB, content);
  assert.equal(typeof result.hash, "string", "未返回hash");
  assert.equal(result.hash, expected, "hash不匹配");
  const actual = sha256(await readFile(TEST_DB, "utf-8"));
  assert.equal(actual, expected, "文件hash不匹配");
});

section("2. 备份机制测试");
await cleanupTestDir();
const validDb = makeValidDb();
await atomicWriteFile(TEST_DB, validDb);

await test("createBackup: 创建备份成功", async () => {
  const backup = await createBackup(TEST_DB);
  assert.ok(backup, "未返回备份信息");
  assert.ok(backup.path, "备份路径为空");
  assert.ok(existsSync(backup.path), "备份文件不存在");
  assert.ok(backup.size > 0, "备份文件大小为0");
  const backupContent = JSON.parse(await readFile(backup.path, "utf-8"));
  assert.deepEqual(backupContent, validDb, "备份内容与原文件不一致");
});

await test("listBackups: 列出所有备份", async () => {
  await createBackup(TEST_DB);
  await createBackup(TEST_DB);
  const list = await listBackups(TEST_DB);
  assert.ok(list.length >= 2, `备份数量不足: 期望>=2, 实际${list.length}`);
  for (const b of list) {
    assert.ok(b.name, "备份项缺少name");
    assert.ok(b.path, "备份项缺少path");
    assert.ok(typeof b.size === "number", "备份项缺少size");
    assert.ok(typeof b.createdAt === "number", "备份项缺少createdAt");
  }
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  assert.deepEqual(list, sorted, "备份列表未按创建时间倒序排列");
});

await test("rotateBackups: 备份轮换保留指定数量", async () => {
  await rm(getBackupDir(TEST_DB), { recursive: true, force: true }).catch(() => {});
  const backupDir = getBackupDir(TEST_DB);
  await mkdir(backupDir, { recursive: true });
  const now = Date.now();
  for (let i = 0; i < 8; i++) {
    const fakeBackup = join(backupDir, `testdb-${new Date(now + i * 1000).toISOString().replace(/[:.]/g, "-")}.json.bak`);
    await writeFile(fakeBackup, JSON.stringify({ backup: i }), "utf-8");
  }
  await rotateBackups(TEST_DB, 3);
  const list = await listBackups(TEST_DB);
  assert.equal(list.length, 3, `轮换后备份数量错误: 期望3, 实际${list.length}`);
});

await test("createBackup: 使用传入内容而非读取文件", async () => {
  const customContent = JSON.stringify({ custom: true, from: "string" }, null, 2);
  const backup = await createBackup(TEST_DB, customContent);
  const readContent = await readFile(backup.path, "utf-8");
  assert.equal(readContent, customContent, "备份内容与传入内容不一致");
});

section("3. 备份恢复测试");
await cleanupTestDir();

await test("restoreFromBackup: 从备份恢复", async () => {
  const version1 = { ...makeValidDb(), marker: "v1" };
  await atomicWriteFile(TEST_DB, version1);
  const backup = await createBackup(TEST_DB);

  const version2 = { ...makeValidDb(), marker: "v2", extra: "data" };
  await atomicWriteFile(TEST_DB, version2);
  assert.equal(JSON.parse(await readFile(TEST_DB, "utf-8")).marker, "v2");

  await restoreFromBackup(TEST_DB, backup.path);
  const restored = JSON.parse(await readFile(TEST_DB, "utf-8"));
  assert.equal(restored.marker, "v1", "恢复后marker不匹配");
});

await test("restoreFromBackup: 损坏的备份抛出错误", async () => {
  const backupDir = getBackupDir(TEST_DB);
  await mkdir(backupDir, { recursive: true });
  const corruptedBackup = join(backupDir, "corrupted-test.json.bak");
  await writeFile(corruptedBackup, "{ this is not valid json !!!", "utf-8");
  await assert.rejects(
    () => restoreFromBackup(TEST_DB, corruptedBackup),
    (e) => e instanceof DbStorageError && e.code === "BACKUP_CORRUPTED",
    "损坏备份未抛出正确错误"
  );
});

await test("findLatestValidBackup: 找到最近有效备份跳过损坏", async () => {
  await rm(getBackupDir(TEST_DB), { recursive: true, force: true }).catch(() => {});
  const backupDir = getBackupDir(TEST_DB);
  await mkdir(backupDir, { recursive: true });

  const b1 = await createBackup(TEST_DB);

  await new Promise((r) => setTimeout(r, 15));
  const corruptedPath = join(backupDir, `testdb-${new Date().toISOString().replace(/[:.]/g, "-")}-corrupt.json.bak`);
  await writeFile(corruptedPath, "not json at all", "utf-8");

  const latest = await findLatestValidBackup(TEST_DB);
  assert.ok(latest, "未找到有效备份");
  assert.notEqual(latest.path, corruptedPath, "不应返回损坏的备份");
});

section("4. 结构自检测试");

await test("validateStructure: 完整有效数据通过校验", async () => {
  const result = validateStructure(makeValidDb());
  assert.equal(result.valid, true, `有效数据未通过校验: ${JSON.stringify(result.errors)}`);
  assert.equal(result.stats.errorCount, 0, "有效数据不应有errors");
});

await test("validateStructure: 缺少必需字段返回错误", async () => {
  const incomplete = { batches: [] };
  const result = validateStructure(incomplete);
  assert.equal(result.valid, false, "缺少字段应校验失败");
  const missingFarms = result.errors.find((e) => e.field === "farms");
  assert.ok(missingFarms, "应报告缺少farms字段");
  assert.equal(missingFarms.code, "MISSING_REQUIRED");
});

await test("validateStructure: 类型错误被检测", async () => {
  const bad = { ...makeValidDb(), batches: "not-an-array" };
  const result = validateStructure(bad);
  assert.equal(result.valid, false, "类型错误应校验失败");
  const typeErr = result.errors.find((e) => e.field === "batches");
  assert.ok(typeErr, "应报告batches类型错误");
  assert.equal(typeErr.code, "TYPE_MISMATCH");
});

await test("validateStructure: 重复批次ID被检测", async () => {
  const db = makeValidDb();
  db.batches = [
    { id: "B-1", farmId: "FARM-DEFAULT" },
    { id: "B-1", farmId: "FARM-DEFAULT" },
  ];
  const result = validateStructure(db);
  const dupErr = result.errors.find((e) => e.code === "DUPLICATE_BATCH_ID");
  assert.ok(dupErr, "重复批次ID应被检测");
});

await test("validateStructure: 引用不存在的场区产生警告", async () => {
  const db = makeValidDb();
  db.batches = [{ id: "B-1", farmId: "NONEXISTENT-FARM" }];
  const result = validateStructure(db);
  const unknownFarm = result.warnings.find((w) => w.code === "UNKNOWN_FARM_ID");
  assert.ok(unknownFarm, "引用不存在场区应产生警告");
});

await test("validateStructure: 血缘引用不存在批次产生警告", async () => {
  const db = makeValidDb();
  db.batches = [{ id: "B-EXIST", farmId: "FARM-DEFAULT" }];
  db.lineages = [
    {
      id: "LIN-1",
      sources: [{ batchId: "NOEXIST", contributionCount: 100 }],
      targets: [{ batchId: "B-EXIST", receivedCount: 100 }],
    },
  ];
  const result = validateStructure(db);
  const warn = result.warnings.find((w) => w.code === "UNKNOWN_SOURCE_BATCH");
  assert.ok(warn, "来源批次不存在应产生警告");
});

section("5. 迁移幂等性测试");
await cleanupTestDir();

await test("runMigration: 无变更操作幂等", async () => {
  const db = makeValidDb();
  const originalHash = sha256(JSON.stringify(db));

  const idempotentFn = (d) => {
    if (!d.warnings) d.warnings = [];
    return { warningsInit: false };
  };

  const r1 = await runMigration(TEST_DB, db, idempotentFn, { migrationName: "test_idempotent_1" });
  const hashAfter1 = sha256(JSON.stringify(db));
  assert.equal(hashAfter1, originalHash, "首次执行不应改变数据（已初始化）");
  assert.equal(r1.changed, false, "首次执行changed应为false");

  const r2 = await runMigration(TEST_DB, db, idempotentFn, { migrationName: "test_idempotent_2" });
  const hashAfter2 = sha256(JSON.stringify(db));
  assert.equal(hashAfter2, originalHash, "二次执行不应改变数据");
  assert.equal(r2.changed, false, "二次执行changed应为false");
});

await test("runMigration: 多次执行不重复添加数据", async () => {
  const db = makeValidDb();
  const addDefaultItemFn = (d) => {
    if (!d.warnings) d.warnings = [];
    const marker = d.warnings.find((w) => w.migrationMarker === "test_unique");
    if (!marker) {
      d.warnings.push({ id: "w-1", migrationMarker: "test_unique" });
      return { added: 1 };
    }
    return { added: 0 };
  };

  for (let i = 0; i < 5; i++) {
    await runMigration(TEST_DB, db, addDefaultItemFn, { migrationName: `test_unique_${i}` });
  }
  const markerCount = db.warnings.filter((w) => w.migrationMarker === "test_unique").length;
  assert.equal(markerCount, 1, `重复执行应只添加1条，实际${markerCount}条`);
});

await test("runMigration: 失败时自动回滚", async () => {
  const db = makeValidDb();
  const snapshotHash = sha256(JSON.stringify(db));
  const originalFarmsCount = db.farms.length;

  const failingFn = (d) => {
    d.farms.push({ id: "TEMP-FARM", name: "临时" });
    d.batches.push({ id: "TEMP-BATCH", farmId: "TEMP-FARM" });
    throw new Error("模拟迁移中途失败");
  };

  await assert.rejects(
    () => runMigration(TEST_DB, db, failingFn, { migrationName: "test_rollback" }),
    (e) => e instanceof DbStorageError && e.code === "MIGRATION_EXECUTION_FAILED",
    "失败迁移应抛出正确错误类型"
  );

  const afterHash = sha256(JSON.stringify(db));
  assert.equal(afterHash, snapshotHash, "失败后数据未回滚到快照");
  assert.equal(db.farms.length, originalFarmsCount, "回滚后farms数量应恢复");
  const tempFarm = db.farms.find((f) => f.id === "TEMP-FARM");
  assert.equal(tempFarm, undefined, "临时场区应被回滚");
  const tempBatch = (db.batches || []).find((b) => b.id === "TEMP-BATCH");
  assert.equal(tempBatch, undefined, "临时批次应被回滚");
});

await test("runMigration: 迁移后结构校验失败会回滚", async () => {
  const db = makeValidDb();
  const snapshotHash = sha256(JSON.stringify(db));

  const corruptFn = (d) => {
    d.farms = "SHOULD-BE-ARRAY";
    return { corrupted: true };
  };

  await assert.rejects(
    () => runMigration(TEST_DB, db, corruptFn, { migrationName: "test_corrupt" }),
    (e) => e instanceof DbStorageError && e.code === "MIGRATION_POST_VALIDATION_FAILED",
    "结构校验失败应抛出正确错误"
  );

  const afterHash = sha256(JSON.stringify(db));
  assert.equal(afterHash, snapshotHash, "结构校验失败后数据未回滚");
  assert.ok(Array.isArray(db.farms), "farms应恢复为数组");
});

section("6. 异常写入与安全保存测试");
await cleanupTestDir();

await test("safeSave: 保存前后校验有效数据", async () => {
  const db = makeValidDb();
  const result = await safeSave(TEST_DB, db);
  assert.ok(result.hash, "safeSave未返回hash");
  assert.ok(result.postValidation, "未执行保存后校验");
  assert.equal(result.postValidation.valid, true, "保存后校验应通过");
});

await test("safeSave: 保存前结构校验失败拒绝写入", async () => {
  const db = { ...makeValidDb(), farms: undefined };
  await atomicWriteFile(TEST_DB, makeValidDb());
  const originalContent = await readFile(TEST_DB, "utf-8");

  await assert.rejects(
    () => safeSave(TEST_DB, db),
    (e) => e instanceof DbStorageError && e.code === "PRE_VALIDATION_FAILED",
    "结构无效应拒绝保存"
  );

  const afterContent = await readFile(TEST_DB, "utf-8");
  assert.equal(afterContent, originalContent, "校验失败不应修改原文件");
});

await test("safeSave: 自动创建备份", async () => {
  await rm(getBackupDir(TEST_DB), { recursive: true, force: true }).catch(() => {});
  await atomicWriteFile(TEST_DB, makeValidDb());
  const beforeBackups = await listBackups(TEST_DB);
  const db = makeValidDb();
  db._testMarker = Date.now();
  await safeSave(TEST_DB, db, { createBackup: true });
  const afterBackups = await listBackups(TEST_DB);
  assert.ok(
    afterBackups.length > beforeBackups.length,
    `保存后备份数量应增加: 前${beforeBackups.length} 后${afterBackups.length}`
  );
});

await test("deepCloneDb: 深拷贝不共享引用", async () => {
  const original = makeValidDb();
  original.batches = [{ id: "B1", farmId: "FARM-DEFAULT", nested: { x: 1 } }];
  const clone = deepCloneDb(original);
  clone.batches[0].nested.x = 999;
  clone.farms.push({ id: "NEW" });
  assert.equal(original.batches[0].nested.x, 1, "原数据嵌套对象被修改");
  assert.equal(original.farms.length, 1, "原数据farms被修改");
});

section("7. 安全加载与恢复测试");
await cleanupTestDir();

await test("safeLoadAndPrepare: 文件不存在时用seed初始化", async () => {
  if (existsSync(TEST_DB)) await unlink(TEST_DB);
  const result = await safeLoadAndPrepare(TEST_DB, {
    autoCreate: true,
    seedFn: () => makeValidDb(),
  });
  assert.equal(result.createdNew, true, "应标记为新创建");
  assert.equal(result.loadedFrom, "seed", "加载来源应为seed");
  assert.ok(result.db, "应返回db对象");
  assert.ok(result.preValidation, "应返回校验结果");
});

await test("safeLoadAndPrepare: 文件损坏从备份恢复", async () => {
  const good = makeValidDb();
  good._restoreTest = "good";
  await atomicWriteFile(TEST_DB, good);
  await createBackup(TEST_DB);

  await writeFile(TEST_DB, "{ this JSON is definitely broken !!!", "utf-8");

  const result = await safeLoadAndPrepare(TEST_DB, {
    autoCreate: true,
    seedFn: () => makeValidDb(),
  });
  assert.equal(result.recoveryUsed, true, "应使用了恢复机制");
  assert.equal(result.loadedFrom, "backup", "加载来源应为backup");
  assert.equal(result.db._restoreTest, "good", "应从备份恢复到好的版本");
});

await test("safeLoadAndPrepare: 禁止autoCreate时文件不存在抛错", async () => {
  if (existsSync(TEST_DB)) await unlink(TEST_DB);
  await assert.rejects(
    () => safeLoadAndPrepare(TEST_DB, { autoCreate: false }),
    (e) => e instanceof DbStorageError && e.code === "DB_NOT_FOUND"
  );
});

await test("safeLoadAndPrepare: 加载后自动创建启动备份", async () => {
  await rm(getBackupDir(TEST_DB), { recursive: true, force: true }).catch(() => {});
  await atomicWriteFile(TEST_DB, makeValidDb());
  const before = await listBackups(TEST_DB);
  await safeLoadAndPrepare(TEST_DB, { autoCreate: true, seedFn: () => makeValidDb() });
  const after = await listBackups(TEST_DB);
  assert.ok(
    after.length > before.length,
    `加载后应创建启动备份: 前${before.length} 后${after.length}`
  );
});

section("8. 真实数据迁移链路集成测试");
await cleanupTestDir();

await test("集成: 从原始种子经过完整迁移链路", async () => {
  const rawSeed = getInitialSeed();
  delete rawSeed.lineages;
  delete rawSeed.importDrafts;
  delete rawSeed.warnings;

  await atomicWriteFile(TEST_DB, rawSeed);
  const loadResult = await safeLoadAndPrepare(TEST_DB, {
    autoCreate: true,
    seedFn: getInitialSeed,
  });
  const db = loadResult.db;

  const migrations = [
    {
      name: "init_lineages",
      fn: (d) => {
        if (!d.lineages) d.lineages = [];
        return { initialized: !d.lineages };
      },
    },
    {
      name: "ensure_farms",
      fn: (d) => {
        if (!Array.isArray(d.farms) || d.farms.length === 0) {
          d.farms = [
            {
              id: "FARM-DEFAULT",
              name: "默认场区",
              isDefault: true,
              costCategories: ["饲料", "药品"],
              createdAt: new Date().toISOString(),
            },
          ];
        }
        const fid = d.farms[0].id;
        for (const collection of ["batches", "ponds"]) {
          if (Array.isArray(d[collection])) {
            for (const item of d[collection]) {
              if (!item.farmId) item.farmId = fid;
            }
          }
        }
        return { applied: true };
      },
    },
    {
      name: "init_import_drafts",
      fn: (d) => {
        if (!d.importDrafts) d.importDrafts = [];
      },
    },
    {
      name: "init_warnings",
      fn: (d) => {
        if (!d.warnings) d.warnings = [];
      },
    },
  ];

  for (const m of migrations) {
    await runMigration(TEST_DB, db, m.fn, { migrationName: m.name });
  }

  for (let i = 0; i < 3; i++) {
    for (const m of migrations) {
      await runMigration(TEST_DB, db, m.fn, { migrationName: `${m.name}_repeat${i}` });
    }
  }

  const finalValidation = validateStructure(db);
  assert.equal(
    finalValidation.valid,
    true,
    `迁移后结构校验失败: errors=${JSON.stringify(finalValidation.errors)}`
  );
  assert.ok(Array.isArray(db.lineages), "lineages应是数组");
  assert.ok(Array.isArray(db.importDrafts), "importDrafts应是数组");
  assert.ok(Array.isArray(db.warnings), "warnings应是数组");
  assert.ok(Array.isArray(db.farms) && db.farms.length > 0, "farms应有默认场区");

  await safeSave(TEST_DB, db);
  const reload = JSON.parse(await readFile(TEST_DB, "utf-8"));
  assert.equal(sha256(JSON.stringify(reload)), sha256(JSON.stringify(db)), "保存前后hash不一致");
});

section("9. 多场区/血缘/草稿/流水账结构兼容性测试");

await test("兼容: 多场区数据通过结构校验", async () => {
  const db = makeValidDb();
  db.farms = [
    { id: "F1", name: "场区A", isDefault: true, costCategories: ["饲料"], createdAt: new Date().toISOString() },
    { id: "F2", name: "场区B", isDefault: false, costCategories: ["饲料", "电费"], createdAt: new Date().toISOString() },
  ];
  db.batches = [
    { id: "B-A1", farmId: "F1", species: "虾" },
    { id: "B-B1", farmId: "F2", species: "鱼" },
  ];
  db.lineages = [
    {
      id: "LIN-1",
      type: "split",
      sources: [{ batchId: "B-A1", contributionCount: 1000, ratio: 1 }],
      targets: [
        { batchId: "B-A1", receivedCount: 500, ratio: 0.5 },
      ],
      farmId: "F1",
      date: "2026-06-01",
    },
  ];
  db.importDrafts = [
    {
      id: "DRAFT-1",
      name: "草稿1",
      farmId: "F1",
      status: "draft",
      createdAt: new Date().toISOString(),
      rows: [],
      headers: [],
    },
  ];
  db.quantityLedgers = [
    { id: "QL-1", batchId: "B-A1", farmId: "F1", type: "initial", change: 10000, date: "2026-06-01" },
  ];
  db.opLogs = [
    { id: "LOG-1", action: "batch_create", targetType: "batch", farmId: "F1", createdAt: new Date().toISOString() },
  ];

  const result = validateStructure(db);
  assert.equal(
    result.valid,
    true,
    `多场区兼容数据校验失败: errors=${JSON.stringify(result.errors, null, 2)}`
  );
});

console.log("\n" + "=".repeat(60));
console.log("  测试结果汇总");
console.log("=".repeat(60));
console.log(`  总计: ${testCounter}  通过: ${passCounter}  失败: ${failCounter}`);
console.log(`  通过率: ${((passCounter / testCounter) * 100).toFixed(1)}%`);
console.log("=".repeat(60));

if (failCounter > 0) {
  process.exitCode = 1;
}

await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});

})();
