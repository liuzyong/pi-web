# Bulk .txt Corpus Ingestion into Wiki

## When to Use

When the user has 100+ .txt files in a directory hierarchy (e.g., annual reports,
government documents, structured text exports) that need to be ingested into a wiki
as raw source material.

## Prerequisites

1. Wiki must already exist (or be initialized in this session)
2. SCHEMA.md must define the tag taxonomy and page conventions
3. User confirms ingestion scope (all files, specific years, specific units)

## Step-by-Step

### Step 1: Explore Source Structure

Walk the tree, count files, extract directory hierarchy. Identify: years, orgs/units,
document types. Key info: total file count and size, year range covered, unique entities,
file naming pattern (e.g., YYYY_OrgName_FILENAME.txt).

### Step 2: Copy Files with Metadata

Copy ALL files to raw/articles/ (or appropriate subdirectory). Each file gets:

1. **Renamed** to include source path for traceability:
   Format: `YEAR_ORG_ORIGINALNAME.txt`
   Example: `2021_交通运输局_0047_欧阳沐晴晓东_交通运输局_2021.txt`

2. **sha256 frontmatter** prepended:
   ```yaml
   ---
   原始链接: D:/Downloads/wiki/...
   录入日期: 2026年6月6日
   sha256: <16-char hex digest of body>
   ---

   ```
   Compute sha256 over the body ONLY (everything after the closing `---`).

3. **Keep original content unchanged** — raw/ is immutable.

### Step 3: Generate Statistics

Create `raw/articles/00_统计摘要.md` with:
- Total file count
- Distribution by year
- Distribution by entity/organization
- Top-N entities by file count

### Step 4: Generate Entity Pages

For each unique entity (单位/部门):
1. Create `entities/<单位名称>.md`
2. Include frontmatter with: 标题, 创建日期, 更新日期, 类型, 标签, 来源
3. Include: overview, material summary (counts per year), cross-references
4. Cross-reference: link to 2+ concept pages ([[述职述廉]], [[巡察整改]], etc.)

### Step 5: Update Concept Pages

For each relevant concept page:
- Bump 更新日期
- Append new source counts (e.g., "本年度摄入 10000 份")
- Add section noting new ingest date and scope

### Step 6: Update index.md

- Add 原始素材 section listing source collections
- Add key entities to 实体 section (top-N by file count)
- Update 最后更新 date and 总页数 count

### Step 7: Update log.md

Append entry with: source path, file counts, coverage (years/entities),
pages created/updated, total pages in wiki after ingest.

## Pitfalls

- **文件名不含文档类型**：当多个分类/文档类型使用相同的文件命名模式（如 `2021_单位_编号_单位_2021.txt`）时，无法从文件名区分文件类型。必须用 `grep -r -l "关键词"` 按内容搜索才能精确统计。
- **Windows path resolution**: write_file() with C:\\Users\\... paths may resolve
  through the workspace root. If the wiki is at C:\Users\...\wiki, use terminal()
  to write files (heredoc), OR set the working directory correctly before calling
  write_file(). Verify the output path with read_file before proceeding.
- **execute_code sandbox**: Large file operations (1000+ files) work fine in
  execute_code but terminal() may be needed for operations requiring specific
  packages (like office file conversion). os, hashlib, datetime, collections are
  always available in the sandbox.
- **sha256 over body only**: The hash must be computed over the content AFTER the
  frontmatter block, not the entire file. This allows the frontmatter to be
  regenerated without invalidating the hash.
- **Don't create entity pages for every file**: Only create entity pages for
  organizational units/departments. Individual person-level reports belong in
  raw/ and are referenced by the unit's entity page.
