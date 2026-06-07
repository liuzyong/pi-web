# Chinese-First SCHEMA.md Template

When the wiki domain is Chinese, use this template instead of the English one.
All keys, tags, and conventions are in Chinese.

```markdown
# Wiki 规范

## 领域
[这个 wiki 覆盖什么 — 如"整治生态监督"、"中国教育政策研究"]

## 命名与语言约定
- 文件名：纯中文，如 `巡察整改.md`、`盐城市公安局.md`
- 标签：纯中文，见下方标签分类
- 正文语言：中文
- [[维基链接]]：直接用中文页面名，如 [[巡察整改]]、[[盐城市公安局]]
- 更新页面时务必更新 `更新日期`

## 页面属性
```yaml
---
标题: 页面标题
创建日期: YYYY年MM月DD日
更新日期: YYYY年MM月DD日
类型: 实体 | 概念 | 对比 | 查询 | 综述
标签: [从下方标签分类选取]
来源: [原始素材/文章名.md]
可信度: 高 | 中 | 低
存在争议: 是
矛盾页面: [页面名]
---
```

## 原始素材属性

```yaml
---
来源网址:
摄入日期: YYYY年MM月DD日
哈希值: <sha256>
---
```

## 标签分类
[定义10-20个中文顶级标签。新增标签必须先加到这里再使用。]

示例（整治生态监督领域）：
- 机构体系：监察、巡视、党内监察、国家监察、纪委
- 制度机制：制度、法律、规定、改革、体制
- 实践操作：巡视实践、监察案件、政治评估、廉政
- 概念理论：政治生态、权力运行、反腐败、督廉联
- 人员角色：监察干部、巡视组、被巡视单位
- 元数据：对比、时间线、争议、预测

规则：标签必须出自此分类。如需新标签，先加到这里再使用。

## 页面创建门槛
- **创建页面：** 实体/概念出现在 2+ 来源中，或在一个来源中为核心主题
- **更新已有页面：** 来源提到已有页面覆盖的内容
- **不创建页面：** 一次性提及、边缘细节、领域外内容
- **拆分页面：** 超过 ~200 行时拆分为子主题
- **归档页面：** 内容完全被取代 → 移到 `_归档/`

## 实体页面
一人/一机构一页。包括：概述、关键事实/日期、与其他实体关系（[[维基链接]]）、来源引用。

## 概念页面
一概念/一制度一页。包括：定义、当前认知、开放问题/争议、相关概念（[[维基链接]]）。

## 对比页面
并排分析。包括：对比目的、维度（优先表格）、结论/综合、来源。

## 更新策略
当新信息与已有内容矛盾：
1. 检查日期 — 较新来源通常优先
2. 如确有矛盾，同时标注两种立场及日期和来源
3. 在属性中标记：`矛盾页面: [页面名]`
4. 在审查报告中标记供用户审查
```

## Key Differences from English Template

| Aspect | English | Chinese |
|--------|---------|---------|
| File names | `transformer-architecture.md` | `巡察整改.md` |
| Frontmatter | `title/created/tags/confidence` | `标题/创建日期/标签/可信度` |
| Tags | `model, benchmark, training` | `被巡视单位, 监察, 制度` |
| Dates | `2026-05-28` | `2026年5月28日` |
| Index header | `Last updated: YYYY-MM-DD` | `最后更新: YYYY年MM月DD日` |
| Log format | `## [YYYY-MM-DD] action | subject` | `## [YYYY年MM月DD日] 操作 | 主题` |

## Common Pitfall: Pinyin Drift

When building a Chinese wiki, agents may default to pinyin file names and English
frontmatter keys (as the English template suggests). This creates a jarring
mixed-language wiki. Fix it by:

1. Rewriting SCHEMA.md with the Chinese template above
2. Renaming all files from pinyin to Chinese
3. Updating all [[wikilinks]] to point to Chinese page names
4. Updating all frontmatter keys to Chinese
5. Rebuilding index.md and log.md with Chinese formatting
