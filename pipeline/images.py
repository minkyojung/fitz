"""Render page images locally with pdftoppm."""
from __future__ import annotations

import subprocess
from pathlib import Path


def render_pages(pdf: Path, out_dir: Path, dpi: int = 150) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["pdftoppm", "-r", str(dpi), "-png", str(pdf), str(out_dir / "page")],
        check=True,
    )


def image_path(out_dir: Path, pdf_index: int, total: int) -> Path:
    width = len(str(total))
    return out_dir / f"page-{pdf_index:0{width}d}.png"
