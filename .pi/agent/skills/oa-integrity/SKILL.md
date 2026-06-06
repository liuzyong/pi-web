---
name: oa-integrity
description: 查询员工廉政档案，包括基本信息、违规记录、培训记录、承诺书、举报投诉。当用户询问廉政档案相关内容时使用。
---

# 廉政档案查询

## 重要：必须通过 bash 执行以下命令获取数据，不要自行编造结果。

## 命令

### 员工档案查询

查询基本信息：
```bash
node oa-integrity.js profile <员工ID>
```

查询违规记录：
```bash
node oa-integrity.js violations <员工ID>
```

查询培训记录：
```bash
node oa-integrity.js trainings <员工ID>
```

查询承诺书签署情况：
```bash
node oa-integrity.js pledges <员工ID>
```

查询举报投诉记录：
```bash
node oa-integrity.js reports <员工ID>
```

### 单位述职述廉报告查询

查询所有单位提交情况：
```bash
node oa-integrity.js submissions
```

查询特定部门提交情况：
```bash
node oa-integrity.js submissions <部门名>
```

## 步骤

1. 根据用户需求选择对应命令
2. 将 `<员工ID>` 替换为实际工号，或提供筛选参数
3. 用 bash 工具执行命令
4. 将返回的 JSON 结果整理后展示给用户