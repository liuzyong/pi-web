# 批量 PDF 转换（用于 Wiki 摄入）

当摄入一批（10 份以上）PDF 文件时的通用方法。

## 模式

1. **解压**（如果是压缩包）：`unzip -o input.zip -d raw/papers/`
2. **编写转换脚本**：使用 `pymupdf`（`fitz`）提取文本，计算 sha256，写入带 frontmatter 的 markdown
3. **执行脚本**：通过 terminal 运行 Python
4. **验证**：检查输出计数，抽查几个文件

## 转换脚本模板

```python
import os, hashlib
from pathlib import Path
import fitz

WIKI = Path("F:/my-test/wiki")  # 根据实际情况调整
PAPERS = WIKI / "raw/papers"
ARTICLES = WIKI / "raw/articles"

pdf_files = sorted(PAPERS.glob("*.pdf"))
print(f"找到 {len(pdf_files)} 个 PDF")

for f in pdf_files:
    try:
        doc = fitz.open(str(f))
        lines = []
        for page in doc:
            text = page.get_text("text")
            if text.strip():
                lines.append(text.strip())
        content = "\n\n".join(lines)
        doc.close()

        sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
        out_name = f.stem + ".md"
        out_path = ARTICLES / out_name

        full = f'---\n来源网址:\n摄入日期: {datetime.date.today()}\n哈希值: {sha}\n---\n{content}'
        out_path.write_text(full, encoding="utf-8")
        print(f"  OK {out_name} ({len(content)} 字)")
    except Exception as e:
        print(f"  FAIL {f.name}: {e}")

print("完成")
```

## 注意事项

- **只支持文本提取**：pymupdf 的 `get_text("text")` 仅提取纯文本。无法处理扫描件中的表格或图片
- **编码问题**：在 Windows 上，zip 中的中文文件名可能会导致解压时出现编码警告（无害）
- **之后清理**：摄入完成后删除转换脚本，以保持 wiki 根目录整洁
- **文件数量超过 50 份**：使用分块样本进行首次摄入（5-10 份），获取结构后，批量创建页面，最后总结其余部分
- **依赖安装**：`pip install pymupdf`（在终端中使用完整 python 路径进行安装）
