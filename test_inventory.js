const BASE_URL = "http://localhost:3012";

async function test() {
  console.log("=== 开始测试盘点校准模块 ===\n");

  try {
    console.log("1. 测试 GET /api/inventories");
    const res1 = await fetch(BASE_URL + "/api/inventories");
    const data1 = await res1.json();
    console.log("   状态:", res1.status);
    console.log("   返回:", JSON.stringify(data1));
    console.log("   ✓ 成功\n");

    console.log("2. 测试 GET /api/batches/B-260601/trace (查看当前估算数量)");
    const res2 = await fetch(BASE_URL + "/api/batches/B-260601/trace");
    const data2 = await res2.json();
    const originalCount = data2.batch.estimatedCount;
    console.log("   状态:", res2.status);
    console.log("   当前估算数量:", originalCount);
    console.log("   现有盘点记录数:", (data2.inventories || []).length);
    console.log("   ✓ 成功\n");

    console.log("3. 测试 POST /api/inventories (创建盘点校准记录)");
    const newInventory = {
      batchId: "B-260601",
      date: "2026-06-14",
      poolId: "P-03",
      method: "sampling",
      manualEstimate: 820000,
      actualCount: 815000,
      operator: "李场长",
      note: "因前期死亡率偏高，实际数量低于系统估算"
    };
    const res3 = await fetch(BASE_URL + "/api/inventories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newInventory)
    });
    const data3 = await res3.json();
    console.log("   状态:", res3.status);
    console.log("   返回:", JSON.stringify(data3, null, 2));
    if (res3.status !== 201) {
      throw new Error("创建盘点记录失败: " + data3.error);
    }
    console.log("   beforeCount:", data3.beforeCount, "(应等于", originalCount, ")");
    console.log("   afterCount:", data3.afterCount, "(应等于 815000)");
    console.log("   difference:", data3.difference, "(应等于", 815000 - originalCount, ")");
    console.log("   ✓ 成功\n");

    console.log("4. 测试 GET /api/batches/B-260601/trace (验证估算数量已更新)");
    const res4 = await fetch(BASE_URL + "/api/batches/B-260601/trace");
    const data4 = await res4.json();
    const newCount = data4.batch.estimatedCount;
    console.log("   状态:", res4.status);
    console.log("   新估算数量:", newCount, "(应等于 815000)");
    console.log("   盘点记录数:", (data4.inventories || []).length);
    console.log("   inventoryStats:", JSON.stringify(data4.summary.inventoryStats));
    if (newCount !== 815000) {
      throw new Error("批次估算数量未正确更新");
    }
    console.log("   ✓ 成功\n");

    console.log("5. 测试 GET /api/batches/B-260601/inventories");
    const res5 = await fetch(BASE_URL + "/api/batches/B-260601/inventories");
    const data5 = await res5.json();
    console.log("   状态:", res5.status);
    console.log("   返回记录数:", data5.length);
    console.log("   ✓ 成功\n");

    console.log("6. 测试盘点记录数据完整性");
    const inv = data5[0];
    console.log("   检查字段:");
    console.log("   - id:", inv.id ? "✓" : "✗");
    console.log("   - batchId:", inv.batchId === "B-260601" ? "✓" : "✗");
    console.log("   - beforeCount:", inv.beforeCount === originalCount ? "✓" : "✗", "(" + inv.beforeCount + ")");
    console.log("   - afterCount:", inv.afterCount === 815000 ? "✓" : "✗", "(" + inv.afterCount + ")");
    console.log("   - difference:", inv.difference === (815000 - originalCount) ? "✓" : "✗", "(" + inv.difference + ")");
    console.log("   - systemEstimate:", inv.systemEstimate === originalCount ? "✓" : "✗");
    console.log("   - manualEstimate:", inv.manualEstimate === 820000 ? "✓" : "✗");
    console.log("   - actualCount:", inv.actualCount === 815000 ? "✓" : "✗");
    console.log("   ✓ 所有字段完整\n");

    console.log("7. 测试删除盘点记录");
    const res7 = await fetch(BASE_URL + "/api/inventories/" + inv.id, {
      method: "DELETE"
    });
    const data7 = await res7.json();
    console.log("   状态:", res7.status);
    console.log("   ✓ 删除成功\n");

    console.log("8. 验证删除后批次估算数量回退");
    const res8 = await fetch(BASE_URL + "/api/batches/B-260601/trace");
    const data8 = await res8.json();
    console.log("   删除后估算数量:", data8.batch.estimatedCount, "(应等于", originalCount, ")");
    if (data8.batch.estimatedCount !== originalCount) {
      throw new Error("删除盘点记录后估算数量未正确回退，期望 " + originalCount + "，实际 " + data8.batch.estimatedCount);
    }
    console.log("   ✓ 回退成功\n");

    console.log("=== 所有测试通过！ ===");

  } catch (error) {
    console.error("✗ 测试失败:", error.message);
    process.exit(1);
  }
}

test();
