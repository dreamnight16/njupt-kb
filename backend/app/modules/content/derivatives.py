"""预览派生（设计文档 §13.1、§16.2、§17.1；prevew.md 四、五、十二）。

- PDF → 首页或少量页（`settings.PREVIEW_MAX_PAGES`）的受限 PDF + 首页缩略图（pypdfium2）。
- PDF / PNG / JPEG → 第一页水印图片预览（WebP）：只渲染第一页、限定宽度、低可见度
  斜向重复水印（prevew.md 五、十二）；浏览器拿到的是 page1.webp，不是完整 PDF。
- PNG/JPEG → 缩略图（Pillow）。
- DOCX/PPTX → 调 `settings.LIBREOFFICE_BIN` 无头转换（临时目录、超时）后再取首页缩略图；
  本轮不做图片化，维持受限 PDF 链路（见 `build_watermarked_preview` 说明）。
- 转换失败由调用方记录 `FileDerivative.status=failed`，不改变原件审核事实，不假显示“预览就绪”。
- 隐私遮盖、纠错、水印、格式转换都生成派生文件或新版本，不修改原始文件（§16.2）。
"""

from __future__ import annotations

import asyncio
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from PIL import Image

from app.config import settings
from app.core.enums import DerivativeKind
from app.modules.content.scanning import DOCX_MIME, JPEG_MIME, PDF_MIME, PNG_MIME, PPTX_MIME

PROCESSOR_VERSION = "derive/1"


class DerivativeError(Exception):
    """预览转换失败。"""


@dataclass(frozen=True)
class DerivativeArtifact:
    kind: DerivativeKind
    path: Path
    content_type: str
    page_count: int | None


def primary_kind(detected_mime: str | None) -> DerivativeKind:
    """失败记录使用的主要派生类型。"""
    if detected_mime in (PDF_MIME, DOCX_MIME, PPTX_MIME):
        return DerivativeKind.PREVIEW_PDF
    return DerivativeKind.THUMBNAIL


async def _run_blocking(fn, /, *args):
    return await asyncio.wait_for(
        asyncio.to_thread(fn, *args), timeout=settings.DERIVATIVE_TIMEOUT_SECONDS
    )


def _make_preview_pdf(source: Path, workdir: Path) -> DerivativeArtifact:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(source))
    if reader.is_encrypted:
        raise DerivativeError("PDF 已加密，无法生成预览")
    total = len(reader.pages)
    if total == 0:
        raise DerivativeError("PDF 没有页面")
    limit = min(total, max(1, settings.PREVIEW_MAX_PAGES))
    writer = PdfWriter()
    for index in range(limit):
        writer.add_page(reader.pages[index])
    target = workdir / "preview.pdf"
    with target.open("wb") as handle:
        writer.write(handle)
    return DerivativeArtifact(DerivativeKind.PREVIEW_PDF, target, "application/pdf", limit)


def _render_pdf_thumbnail(source: Path, workdir: Path) -> DerivativeArtifact:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(source))
    if len(document) == 0:
        raise DerivativeError("PDF 没有页面")
    page = document[0]
    width_pt, _ = page.get_size()
    scale = max(0.1, settings.PREVIEW_THUMBNAIL_WIDTH / max(1.0, width_pt))
    image = page.render(scale=scale).to_pil().convert("RGB")
    target = workdir / "thumb.png"
    image.save(target, format="PNG", optimize=True)
    return DerivativeArtifact(DerivativeKind.THUMBNAIL, target, "image/png", 1)


def _image_thumbnail(source: Path, workdir: Path) -> DerivativeArtifact:
    from PIL import Image

    with Image.open(source) as image:
        converted = image.convert("RGB")
        side = settings.PREVIEW_THUMBNAIL_WIDTH
        converted.thumbnail((side, side))
        target = workdir / "thumb.png"
        converted.save(target, format="PNG", optimize=True)
    return DerivativeArtifact(DerivativeKind.THUMBNAIL, target, "image/png", 1)


def _convert_office(source: Path, workdir: Path) -> Path:
    """无头转换为 PDF：受限临时目录、独立用户配置、超时（§16.1）。"""
    profile = workdir / "lo-profile"
    profile.mkdir(exist_ok=True)
    env = {
        "HOME": str(workdir),
        "PATH": os.environ.get("PATH", ""),
        "LANG": "C.UTF-8",
    }
    command = [
        settings.LIBREOFFICE_BIN,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        f"-env:UserInstallation=file://{profile}",
        "--convert-to",
        "pdf",
        "--outdir",
        str(workdir),
        str(source),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            timeout=settings.DERIVATIVE_TIMEOUT_SECONDS,
            env=env,
            cwd=str(workdir),
            check=False,
        )
    except FileNotFoundError as exc:
        raise DerivativeError(f"未找到转换器 {settings.LIBREOFFICE_BIN}") from exc
    except subprocess.TimeoutExpired as exc:
        raise DerivativeError("转换超时") from exc
    if completed.returncode != 0:
        raise DerivativeError(f"转换失败（返回码 {completed.returncode}）")
    target = workdir / f"{source.stem}.pdf"
    if not target.exists():
        produced = sorted(workdir.glob("*.pdf"))
        if not produced:
            raise DerivativeError("转换未产生 PDF")
        target = produced[0]
    return target


async def _build_pdf(source: Path, workdir: Path) -> list[DerivativeArtifact]:
    preview = await _run_blocking(_make_preview_pdf, source, workdir)
    thumbnail = await _run_blocking(_render_pdf_thumbnail, source, workdir)
    return [preview, thumbnail]


async def build_derivatives(
    source: Path, *, detected_mime: str, workdir: Path
) -> list[DerivativeArtifact]:
    """按真实格式生成受限预览产物；失败抛 `DerivativeError`。"""
    try:
        if detected_mime == PDF_MIME:
            return await _build_pdf(source, workdir)
        if detected_mime in (PNG_MIME, JPEG_MIME):
            return [await _run_blocking(_image_thumbnail, source, workdir)]
        if detected_mime in (DOCX_MIME, PPTX_MIME):
            converted = await _run_blocking(_convert_office, source, workdir)
            return await _build_pdf(converted, workdir)
    except DerivativeError:
        raise
    except asyncio.TimeoutError as exc:
        raise DerivativeError("转换超时") from exc
    except Exception as exc:  # noqa: BLE001 - 统一为派生失败
        raise DerivativeError(f"转换异常：{type(exc).__name__}") from exc
    raise DerivativeError(f"不支持的预览格式：{detected_mime}")


# --------------------------------------------------------------------------- #
# 第一页水印图片预览（prevew.md 四、五、十二）
# --------------------------------------------------------------------------- #
def _apply_watermark(image: "Image.Image", text: str) -> "Image.Image":
    """叠加低可见度斜向重复水印（prevew.md 十二）。

    平铺而非只放角落：裁剪边缘去不掉水印；透明度受 `PREVIEW_WATERMARK_OPACITY`
    控制，不破坏阅读但可追溯。字体用内置 `load_default()`，不依赖系统字体文件。
    """
    from PIL import Image, ImageDraw, ImageFont

    tile = Image.new("RGBA", (360, 96), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    draw.text(
        (18, 28),
        text,
        font=ImageFont.load_default(),
        fill=(0, 0, 0, settings.PREVIEW_WATERMARK_OPACITY),
    )
    rotated = tile.rotate(30, expand=True, resample=Image.Resampling.BICUBIC)
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    for top in range(0, image.height, rotated.height):
        for left in range(0, image.width, rotated.width):
            layer.alpha_composite(rotated, (left, top))
    return Image.alpha_composite(image, layer)


def _watermarked_webp(
    image: "Image.Image", workdir: Path, *, watermark_text: str
) -> DerivativeArtifact | None:
    """加水印并保存为 WebP；渲染或写入失败返回 None（调用方回退既有预览）。"""
    try:
        watermarked = _apply_watermark(image.convert("RGBA"), watermark_text)
        target = workdir / "preview.webp"
        # 图片由服务端重新渲染/缩放生成，不携带原件元数据（prevew.md 四）。
        watermarked.convert("RGB").save(
            target, format="WEBP", quality=settings.PREVIEW_IMAGE_QUALITY
        )
    except Exception:  # noqa: BLE001 - 生成失败回退既有预览，不阻断预览链路（§13.1）
        return None
    return DerivativeArtifact(DerivativeKind.WATERMARKED_PREVIEW, target, "image/webp", 1)


def _pdf_first_page_image(
    source: Path, workdir: Path, watermark_text: str
) -> DerivativeArtifact | None:
    """PDF 只渲染第一页为限定宽度图片（prevew.md 五、六：不原尺寸输出）。

    浏览器拿到的是 page1.webp，不是完整 PDF——权限隔离由服务端渲染保证，
    不是前端隐藏后续页。
    """
    import pypdfium2 as pdfium

    document = None
    try:
        document = pdfium.PdfDocument(str(source))
        if len(document) == 0:
            return None
        page = document[0]
        width_pt, height_pt = page.get_size()
        if min(width_pt, height_pt) <= 0:
            return None
        # 同时限制长边，避免极长页面按宽度缩放后分配巨量位图内存。
        scale = settings.PREVIEW_IMAGE_WIDTH / max(width_pt, height_pt)
        bitmap = page.render(scale=scale)
        try:
            image = bitmap.to_pil().copy()
        finally:
            bitmap.close()
            page.close()
    except Exception:  # noqa: BLE001 - 渲染失败回退既有预览
        return None
    finally:
        # pdfium 持有源文件句柄，必须显式关闭，否则临时目录清理会被文件锁阻塞（Windows）。
        if document is not None:
            document.close()
    return _watermarked_webp(image, workdir, watermark_text=watermark_text)


def _image_first_page(
    source: Path, workdir: Path, watermark_text: str
) -> DerivativeArtifact | None:
    """PNG/JPEG 原件：缩放后作为图片预览（水印同样叠加）。"""
    from PIL import Image

    try:
        with Image.open(source) as opened:
            image = opened.convert("RGBA")
            image.thumbnail((settings.PREVIEW_IMAGE_WIDTH, settings.PREVIEW_IMAGE_WIDTH))
    except Exception:  # noqa: BLE001 - 解码失败回退既有预览
        return None
    return _watermarked_webp(image, workdir, watermark_text=watermark_text)


async def build_watermarked_preview(
    source: Path, *, detected_mime: str, workdir: Path, watermark_text: str
) -> DerivativeArtifact | None:
    """生成第一页水印图片预览（WebP）；无法生成时返回 None（prevew.md 四、五、十二）。

    调用方据此回退到既有 preview_pdf / thumbnail 预览，不让预览链路失败。
    DOCX/PPTX 不在本函数处理：维持现有 LibreOffice 受限 PDF 链路。
    渲染是 CPU 阻塞操作：放线程池并受 `DERIVATIVE_TIMEOUT_SECONDS` 约束。
    """
    builder = {
        PDF_MIME: _pdf_first_page_image,
        PNG_MIME: _image_first_page,
        JPEG_MIME: _image_first_page,
    }.get(detected_mime)
    if builder is None:
        return None
    try:
        return await _run_blocking(builder, source, workdir, watermark_text)
    except Exception:  # noqa: BLE001 - 超时/异常回退既有预览，不阻断预览链路
        return None
