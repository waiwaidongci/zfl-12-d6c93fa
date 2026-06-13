export const seedData = {
  parentPools: [
    { id: "PP-01", species: "南美白对虾", count: 320, note: "春季亲本" },
  ],
  batches: [
    {
      id: "B-260601",
      species: "南美白对虾",
      parentPoolId: "PP-01",
      hatchDate: "2026-06-01",
      currentPool: "P-03",
      estimatedCount: 850000,
      status: "育苗中",
      cost: 12600,
    },
  ],
  ponds: [
    {
      id: "P-01",
      name: "育苗池1号",
      capacity: "40m³",
      purpose: "虾苗培育",
      status: "idle",
      disinfectionDate: "2026-05-28",
      note: "标准虾苗培育池，配备独立增氧系统",
    },
    {
      id: "P-02",
      name: "育苗池2号",
      capacity: "45m³",
      purpose: "虾苗培育",
      status: "idle",
      disinfectionDate: "2026-05-30",
      note: "",
    },
    {
      id: "P-03",
      name: "育苗池3号",
      capacity: "42m³",
      purpose: "虾苗培育",
      status: "active",
      disinfectionDate: "2026-05-25",
      note: "当前养殖南美白对虾 B-260601 批次",
    },
    {
      id: "P-04",
      name: "育苗池4号",
      capacity: "48m³",
      purpose: "暂养池",
      status: "cleaning",
      disinfectionDate: "2026-06-12",
      note: "消毒作业中，预计 6 月 14 日完成",
    },
    {
      id: "P-05",
      name: "育苗池5号",
      capacity: "48m³",
      purpose: "蟹苗培育",
      status: "idle",
      disinfectionDate: "2026-05-20",
      note: "计划用于三疣梭子蟹夏季苗种",
    },
    {
      id: "P-06",
      name: "育苗池6号",
      capacity: "36m³",
      purpose: "鱼种培育",
      status: "maintenance",
      disinfectionDate: "2026-05-15",
      note: "排水阀维修中，预计 6 月 16 日恢复",
    },
  ],
  records: [
    {
      id: "REC-1",
      batchId: "B-260601",
      date: "2026-06-12",
      poolId: "P-03",
      temperature: 28.2,
      salinity: 22,
      oxygen: 6.1,
      feed: 18,
      mortality: 0.8,
      abnormal: "无",
    },
  ],
  transfers: [
    {
      id: "TR-1",
      batchId: "B-260601",
      fromPool: "孵化桶",
      toPool: "P-03",
      date: "2026-06-03",
      count: 900000,
      reason: "初次入池",
    },
  ],
  sales: [],
};

export function getInitialSeed() {
  return JSON.parse(JSON.stringify(seedData));
}
