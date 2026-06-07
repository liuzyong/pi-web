---
name: chinese-web-research
description: Researching Chinese government/institutional platforms and websites. Use when the user asks to investigate, scrape, or analyze Chinese websites — especially government-operated SPA platforms, scene/innovation platforms, or any `.cn` domain that returns empty shells via curl. Covers SPA workarounds, search engine strategy for Chinese content, and structured competitive analysis output format.
---

# Chinese Web Research

## When to Use

- User asks to research, scrape, or analyze Chinese websites (especially gov/institutional `.cn` domains)
- User is doing competitive analysis of Chinese platforms
- User needs to research a Chinese industry landscape
- The target sites are SPAs (Vue/React/Angular) that return empty shells via curl
- User asks specifically about 场景平台, 政务平台, 创新平台, or similar categories

## Step 1: Initial Recon — Always curl First

Even SPAs often leak useful data in their HTML. Always start with curl before escalating to browser tools:

```bash
curl -sL --max-time 30 \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" \
  "https://target-site.cn/" 2>&1 | sed 's/<[^>]*>//g' | sed '/^$/d' | sed 's/^\s*//' | head -200
```

What to look for in the stripped HTML:
- `` tags — site name, org description, mission statement
- `` and `<description>` meta tags — keywords and descriptions
- Nav items (`<a>` hrefs and labels) — the site's information architecture
- Copyright footers — reveals the builder/operator
- Commented-out data (GBA had `机会项143能力项33` in HTML comments)

## Step 2: JS Config Extraction — The Hidden API Goldmine

Most Chinese government SPAs built on frameworks like 千行 (Qianxing), RuoYi, or similar have config files that expose API base URLs. **Always check these paths:**

| Path | Framework | What it exposes |
|------|-----------|-----------------|
| `/config/index-production.js` | 千行/Qianxing | `baseUrl`, site title, view file URLs |
| `/config/starter.js` | 千行/Qianxing | Framework version, login config, tech stack |
| `/public-config.js` | Generic Vue | Build-time config |
| `/config/themeColor.js` | Element-UI based | Theme settings |

Example extraction command:
```bash
curl -sL --max-time 30 "https://target.cn/config/index-production.js" \
  -H "User-Agent: Mozilla/5.0" 2>&1 | head -50
```

Key fields to grep for: `baseUrl`, `title`, `appId`, `viewFileUrl`, `ENV`

## Step 3: Chinese Search Engine Strategy

Order of preference for Chinese-language content:

| Engine | Format | Pros | Cons |
|--------|--------|------|------|
| **Sogou** (搜狗) | `sogou.com/web?query=...` | Best Chinese gov/institutional results | Rate-limits after ~2 queries; switch User-Agent |
| **Baidu** (百度) | `baidu.com/s?wd=...` | Largest Chinese index | Often returns tiny payloads (anti-bot) |
| **Bing** with `zh-CN` | `bing.com/search?q=...` + `Accept-Language: zh-CN` | No CAPTCHA | Poor relevance for Chinese gov sites |
| **DuckDuckGo Lite** | `lite.duckduckgo.com/lite/?q=...` | Clean HTML | CAPTCHA wall after ~3 queries |

**Sogou parsing pattern:**
```bash
curl -sL --max-time 30 -o /tmp/sogou.html \
  "https://www.sogou.com/web?query=URL_ENCODED_QUERY" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Extract result snippets
grep -oP 'class="[^"]*space-txt[^"]*"[^>]*>.*?</(p|div)>' /tmp/sogou.html \
  | sed 's/<[^>]*>//g' | head -20

# Extract result titles
grep -oP '<h3[^>]*>.*?</h3>' /tmp/sogou.html \
  | sed 's/<[^>]*>//g' | head -20
```

**PITFALL:** Sogou blocks after ~2 queries. Save search results to files immediately (don't re-query) and process the saved HTML. If blocked, switch to a different User-Agent or wait.

## Step 4: When SPAs Resist All Else

If curl + JS configs + search engines all fail:

1. Try the browser tool with `browser_navigate` — accept that SPA initial load may timeout, but `browser_snapshot` after JS execution may yield content
2. Check if the SPA exposes a `swagger`/`doc.html`/`v2/api-docs` endpoint (unlikely for gov sites)
3. Try common API paths: `/prod-api/`, `/dev-api/`, `/api/`, `/jeecg-boot/`
4. Accept partial data and note the data completeness caveat in the report

## Step 5: Structured Research Output

When the user asks for competitive analysis, structure the output as:

1. **Platform profiles** — table format (positioning, operator, tech stack, scale, status)
2. **Cross-comparison** — consensus points vs. contradictions, with a "industry pattern" summary
3. **Timeline** — 10 most important events in the relevant period
4. **Top players** — ranked table with core strengths and weaknesses for each
5. **Feature checklist** — detailed table with columns: 一级模块 | 二级功能 | 详细描述 | 优先级(P0-P3) | 工作说明
6. **Recommendations** — differentiated positioning for the user's project

**Output format:** Single self-contained markdown file with all sections. Save to the user's workspace with a descriptive Chinese filename.

**Style:** Terminal-renderable. Use tables sparingly within the report itself (markdown tables render fine in files). Avoid markdown in the conversation response — the user reads it in a terminal.

## References

- `references/gba-scenarios-data.md` — Extracted data from gba-scenarios.cn (site structure, opportunity categories, event history)
