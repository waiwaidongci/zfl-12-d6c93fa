# 育苗池档案模块说明

## 数据结构

池子 (ponds) 字段说明：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 池号，唯一标识，只能包含字母、数字、连字符和下划线 |
| name | string | 是 | 池子名称 |
| capacity | string | 否 | 容量，如 "42m³" 或 "50000L" |
| purpose | string | 否 | 用途，可选值：虾苗培育、蟹苗培育、贝苗培育、鱼种培育、暂养池、其他 |
| status | string | 是 | 当前状态：active(使用中)、idle(空闲)、cleaning(消毒中)、maintenance(维修中) |
| disinfectionDate | string | 否 | 最近消毒日期，ISO 日期格式 |
| note | string | 否 | 备注信息 |

## API 接口

### 1. 获取所有池子
- `GET /api/ponds`
- 返回：所有池子数组

### 2. 获取单个池子
- `GET /api/ponds/:id`
- 返回：池子对象，不存在则 404

### 3. 新增池子
- `POST /api/ponds`
- 请求体：池子字段 (id, name 必填)
- 成功返回 201 + 新池子对象；id 已存在返回 409

### 4. 修改池子（全量更新）
- `PUT /api/ponds/:id`
- 请求体：池子字段 (id 不可改，name 必填)
- 成功返回 200 + 更新后的池子对象

### 5. 修改池子状态（部分更新）
- `PATCH /api/ponds/:id/status`
- 请求体：`{ status, disinfectionDate?, note? }`
- 用于快速修改状态，适合日常操作

### 6. 删除池子
- `DELETE /api/ponds/:id`
- 若池子被批次、记录、流转引用，则返回 400，无法删除

## 目录结构

```
zfl-12/
├── public/              前端静态文件
│   ├── index.html       主页面
│   ├── css/
│   │   └── styles.css   样式表
│   └── js/
│       └── app.js       前端主逻辑（含育苗池档案模块）
├── routes/              API 路由模块
│   ├── ponds.js         育苗池档案 API
│   ├── batches.js       批次 API
│   ├── records.js       每日记录 API
│   ├── transfers.js     分池合池 API
│   └── sales.js         出苗销售 API
├── seed/                数据种子
│   ├── seed.js          初始数据定义
│   └── README.md        本说明文档
├── data/
│   └── hatchery.json    数据存储文件
├── server.js            服务器入口（已重构）
└── package.json
```

## 功能说明

### 育苗池档案页面提供：
1. **池子列表**：卡片式展示，包含状态标签、容量、用途、消毒日期、备注
2. **搜索与筛选**：按池号/名称搜索，按状态筛选
3. **统计概览**：池子总数、使用中、空闲、消毒中、维修中数量
4. **新增池子**：弹窗表单，填写完整池子信息
5. **编辑池子**：修改除 ID 外的所有字段
6. **修改状态**：快捷弹窗，适合日常状态变更（如切换到消毒中）
7. **状态联动**：新建批次、分池合池时的池子下拉框会自动过滤掉"维修中"的池子
