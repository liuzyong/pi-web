# 大批量 .txt 摄入（10,000 份以上）

## 何时使用

当源文件超过 10,000 份且结构规整（分类/年份/单位/文件.txt 或类似层级）时，
使用本方法替代逐文件摄入。

## 实际案例：2026-06-07 生成文件1 100,000 份

**源结构**：
```
D:/Downloads/wiki/生成文件1/
  信访回复函/2022/中医院/100120_中医院_2022.txt  ...
  信访回复函/2022/互联网信息办公室/...
  ...
  8 个分类 × 5 个年度 × 94 个单位 = 100,000 个 .txt
```

**命名模式**：`分类_年份_单位_原文件名.txt`

### 关键发现

1. **文件名不含文档类型**（旧批次 2021_单位_*.txt 和配套公文同名格式混放）
   - 旧批次 48,446 个文件中混有述职和配套公文，无法从文件名区分
   - **解决**：必须用 `grep -r -l "关键词"` 按内容扫描才能精确统计
   - 新批次（带"廉政述职报告_"前缀）可直接文件名筛选

2. **execute_code sandbox 无法访问 D: 盘文件**
   - Windows 下 `os.stat()` 报 PermissionError
   - **解决**：用 `terminal()` 的 `find` + `grep` 做结构探索和统计

3. **100,000 份文件逐个写入 frontmatter 耗时较长**（约 30-60 秒）
   - 写入脚本应放在 wiki 根目录，通过 `terminal` 运行
   - 不要用 `execute_code` 的 sandbox（无所需包且路径不可达）

4. **单位去重**：跨分类的单位名可能重复出现在已有实体页中
   - 先检查 `entities/` 目录，仅对新单位创建页面
   - 已有页面追加来源引用（在 frontmatter 的 `来源:` 段后插入）

## 脚本模板

```python
#!/usr/bin/env python3
"""批量摄入: SOURCE_DIR → wiki/raw/articles/"""

import hashlib, datetime
from pathlib import Path
from collections import Counter

SOURCE = Path(r"<源目录>")
WIKI_RAW = Path(r"<wiki路径>/raw/articles")

for cat in sorted(SOURCE.iterdir()):
    if not cat.is_dir(): continue
    for year in sorted(cat.iterdir()):
        if not year.is_dir(): continue
        for unit in sorted(year.iterdir()):
            if not unit.is_dir(): continue
            for f in sorted(unit.iterdir()):
                if not f.is_file(): continue
                dest = WIKI_RAW / f"{cat.name}_{year.name}_{unit.name}_{f.name}"
                if dest.exists():
                    continue  # 跳过重复
                content = f.read_text(encoding='utf-8')
                sha = hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]
                dest.write_text(
                    f'---\n来源路径: {f}\n摄入日期: {datetime.date.today().strftime("%Y年%m月%d日")}\nsha256: {sha}\n---\n\n{content}',
                    encoding='utf-8'
                )
```

运行方式：
```bash
python _ingest_batch.py
```

## 精确统计方法

**不能靠文件名统计**（分类和类型混在同名前缀）。用 `grep`：

```bash
# 统计含"述职"的文件总数
cd wiki/raw/articles
grep -r -l "述职" *.txt | wc -l

# 按新/旧批次分别统计
grep -r -l "述职" 廉政述职报告_*.txt | wc -l  # 新批次
grep -r -l "述职" 202[1-6]_*.txt | wc -l       # 旧批次

# 按年度细分
grep -r -l "述职" 廉政述职报告_2022_*.txt | wc -l
grep -r -l "述职" 2022_*.txt | wc -l
```

## 更新实体页面

对已有的实体页面追加新批次来源（在 `来源:` 和 `可信度:` 之间插入）：

```python
page = entities_dir / f"{unit_name}.md"
content = page.read_text(encoding='utf-8')
insert_point = content.find("可信度:")
if insert_point > 0:
    new_sources = f"""  - raw/articles/分类_{YEAR_RANGE}_{unit_name}_*.txt — {YEAR_RANGE}（共N份）
  ...
"""
    content = content[:insert_point] + new_sources + content[insert_point:]
    page.write_text(content, encoding='utf-8')
```

## 常见陷阱

- **不要给每个文件创建实体页**：实体页 = 单位/部门/机构，不是一人一份
- **94 个单位全部覆盖 8 分类×5 年度**（每单位 40 份）时，批量操作比逐个高效
- **旧批次与新批次文件在同一 raw/articles/ 目录**，需要合并统计
- **摄入后更新 index.md 和 log.md** 是必须的，否则 wiki 退化
