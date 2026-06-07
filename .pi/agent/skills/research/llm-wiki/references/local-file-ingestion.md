# Local File Ingestion (docx/pptx/pdf → markdown)

When sources arrive as local `.docx`, `.pptx`, or `.pdf` files (not URLs), convert
them to markdown before building wiki pages. The skill's primary tool (`web_extract`)
doesn't handle local files.

## Quick Start: Reusable Script

A ready-to-run script is at `scripts/extract_office_files.py`. It handles all three
formats in one pass:

```bash
python scripts/extract_office_files.py <source_dir> <output_dir>
```

Use this for bulk ingestion (10+ files of mixed formats) rather than writing ad-hoc
scripts each time. It auto-generates frontmatter with sha256 hashes for drift detection.

## Prerequisites

```bash
pip install python-docx python-pptx pymupdf
```

## Conversion Script Pattern

Write a script file (e.g. `_convert.py`), then run via terminal with the correct
Python interpreter. Do NOT use `execute_code` — its sandbox lacks python-docx/pymupdf.

```python
import hashlib
from pathlib import Path
from docx import Document
import fitz  # pymupdf

PAPERS = Path("wiki/raw/papers")
ARTICLES = Path("wiki/raw/articles")

# --- DOCX ---
for f in sorted(PAPERS.glob("*.docx")):
    doc = Document(str(f))
    lines = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            lines.append("")
            continue
        style = para.style.name if para.style else ""
        if "Heading 1" in style:
            lines.append(f"# {text}")
        elif "Heading 2" in style:
            lines.append(f"## {text}")
        elif "Heading 3" in style:
            lines.append(f"### {text}")
        else:
            lines.append(text)
    # Extract tables
    for table in doc.tables:
        lines.append("")
        for row in table.rows:
            cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")
    content = "\n".join(lines)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    out = ARTICLES / (f.stem + ".md")
    out.write_text(
        f'---\nsource_url:\ningested: 2026-05-28\nsha256: {sha}\n---\n{content}',
        encoding="utf-8"
    )

# --- PDF ---
for f in sorted(PAPERS.glob("*.pdf")):
    doc = fitz.open(str(f))
    lines = [page.get_text("text").strip() for page in doc if page.get_text("text").strip()]
    doc.close()
    content = "\n\n".join(lines)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    out = ARTICLES / (f.stem + ".md")
    out.write_text(
        f'---\nsource_url:\ningested: 2026-05-28\nsha256: {sha}\n---\n{content}',
        encoding="utf-8"
    )
```

## Pitfalls

- **execute_code sandbox** does NOT have python-docx or pymupdf. Write a `.py` file
  and run it via `terminal()` with the full Python interpreter path.
- PDF text extraction via pymupdf loses formatting (headings, tables). For PDFs
  with complex layouts, manual review of the extracted text is recommended.
- Clean up the conversion script (`_convert.py`) after successful conversion —
  it's a transient tool, not wiki content.
- When the user copies files into `raw/papers/` instead of `raw/articles/`, treat
  `papers/` as the pre-conversion staging area and `articles/` as the final
  markdown destination. Files in `papers/` remain immutable raw sources.
