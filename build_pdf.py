#!/usr/bin/env python3
"""Build the ordered luxury furniture blueprint bundle PDF and website image manifest.

Install dependencies if needed:
    python3 -m pip install pillow reportlab

Run:
    python3 build_pdf.py
"""

from __future__ import annotations

import json
import shutil
import sys
from hashlib import sha256
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - dependency guidance path
    raise SystemExit(
        "Missing dependency: Pillow. Install it with: python3 -m pip install pillow"
    ) from exc

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import landscape, letter, portrait
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
except ImportError as exc:  # pragma: no cover - dependency guidance path
    raise SystemExit(
        "Missing dependency: reportlab. Install it with: python3 -m pip install reportlab"
    ) from exc


PROJECT_ROOT = Path(__file__).resolve().parent
IMAGE_DIR = PROJECT_ROOT / "blueprint_images"
WEBSITE_DIR = PROJECT_ROOT / "website"
OUTPUT_PDF = PROJECT_ROOT / "luxury_fluted_walnut_bedroom_bundle_blueprints.pdf"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}

SECTION_DEFINITIONS = [
    {
        "id": "intro",
        "title": "Brand & Cover",
        "keywords": ("brand", "cover", "welcome", "contents", "table"),
    },
    {
        "id": "bed-overview",
        "title": "Bed Blueprint Overview",
        "keywords": ("bed-overview",),
    },
    {
        "id": "bed-build",
        "title": "Bed Build Plans",
        "keywords": ("bed-build",),
    },
    {
        "id": "nightstand-overview",
        "title": "Nightstand Blueprint Overview",
        "keywords": ("nightstand-overview",),
    },
    {
        "id": "nightstand-build",
        "title": "Nightstand Build Plans",
        "keywords": ("nightstand-build",),
    },
    {
        "id": "dresser-overview",
        "title": "Dresser Blueprint Overview",
        "keywords": ("dresser-overview",),
    },
    {
        "id": "dresser-build",
        "title": "Dresser Build Plans",
        "keywords": ("dresser-build",),
    },
    {
        "id": "tools-checklists",
        "title": "Tools, Checklists & Calculators",
        "keywords": ("tools-checklists",),
    },
    {
        "id": "upsells",
        "title": "Bundle & Upsell Pages",
        "keywords": ("upsells",),
    },
]

CLIENT_EXCLUDED_SECTIONS = {"upsells"}
CLIENT_EXCLUDED_FILES = {
    "002_brand_brand-and-cover_src038.png",
    "003_brand_brand-and-cover_src051.png",
    "005_brand_brand-and-cover_src069.png",
    "006_brand_brand-and-cover_src052.png",
    "007_brand_brand-and-cover_src070.png",
    "008_brand_brand-and-cover_src071.png",
    "009_bed-overview_bed-blueprint-overview_src010.png",
    "010_bed-overview_bed-blueprint-overview_src011.png",
    "011_bed-overview_bed-blueprint-overview_src012.png",
    "012_bed-overview_bed-blueprint-overview_src013.png",
    "013_bed-overview_bed-blueprint-overview_src014.png",
    "014_bed-overview_bed-blueprint-overview_src015.png",
    "015_bed-overview_bed-blueprint-overview_src017.png",
    "016_bed-overview_bed-blueprint-overview_src039.png",
    "017_bed-overview_bed-blueprint-overview_src040.png",
    "018_bed-overview_bed-blueprint-overview_src041.png",
    "019_bed-overview_bed-blueprint-overview_src042.png",
    "020_bed-overview_bed-blueprint-overview_src043.png",
    "021_bed-overview_bed-blueprint-overview_src044.png",
    "022_bed-overview_bed-blueprint-overview_src047.png",
    "023_bed-overview_bed-blueprint-overview_src048.png",
    "024_bed-overview_bed-blueprint-overview_src050.png",
    "025_bed-overview_bed-blueprint-overview_src053.png",
    "026_bed-overview_bed-blueprint-overview_src055.png",
    "047_nightstand-overview_nightstand-blueprint-overview_src081.png",
    "088_tools-checklists_tools-checklists-and-calculators_src064.png",
}
SECTION_OVERRIDES = {
    "045_bed-build_bed-build-plans_src078.png": "tools-checklists",
    "046_bed-build_bed-build-plans_src079.png": "tools-checklists",
}
CLIENT_SECTION_ORDER = {
    "intro": 0,
    "bed-build": 1,
    "nightstand-overview": 2,
    "nightstand-build": 3,
    "dresser-overview": 4,
    "dresser-build": 5,
    "tools-checklists": 6,
}


def discover_images(image_dir: Path = IMAGE_DIR) -> list[Path]:
    """Return supported image files sorted by numeric filename prefix/name."""
    if not image_dir.exists():
        raise FileNotFoundError(f"Image folder not found: {image_dir}")

    images = [
        path
        for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]
    if not images:
        raise FileNotFoundError(f"No supported images found in: {image_dir}")

    return sorted(images, key=lambda path: path.name.lower())


def client_images(images: list[Path]) -> list[Path]:
    """Return only customer-facing blueprint pages, with exact duplicates removed."""
    selected: list[Path] = []
    seen_hashes: set[str] = set()

    for path in images:
        section = classify_image(path)
        if section in CLIENT_EXCLUDED_SECTIONS or path.name in CLIENT_EXCLUDED_FILES:
            continue

        digest = sha256(path.read_bytes()).hexdigest()
        if digest in seen_hashes:
            continue

        seen_hashes.add(digest)
        selected.append(path)

    return sorted(
        selected,
        key=lambda path: (CLIENT_SECTION_ORDER.get(classify_image(path), 99), path.name.lower()),
    )


def choose_page_size(images: list[Path]) -> tuple[float, float]:
    """Choose one consistent letter page orientation from the image set."""
    landscape_count = 0
    portrait_count = 0

    for path in images:
        with Image.open(path) as image:
            if image.width >= image.height:
                landscape_count += 1
            else:
                portrait_count += 1

    return landscape(letter) if landscape_count >= portrait_count else portrait(letter)


def image_to_reader(path: Path) -> tuple[ImageReader, int, int]:
    """Load an image as an RGB ImageReader, flattening transparency on white."""
    with Image.open(path) as image:
        width, height = image.size

        if image.mode in ("RGBA", "LA") or (
            image.mode == "P" and "transparency" in image.info
        ):
            image = image.convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            image = background.convert("RGB")
        else:
            image = image.convert("RGB")

        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=95, optimize=True)
        buffer.seek(0)

    return ImageReader(buffer), width, height


def draw_image_page(pdf: canvas.Canvas, image_path: Path, page_size: tuple[float, float]) -> None:
    """Center one blueprint image on the PDF page while preserving aspect ratio."""
    page_width, page_height = page_size
    reader, image_width, image_height = image_to_reader(image_path)

    scale = min(page_width / image_width, page_height / image_height)
    draw_width = image_width * scale
    draw_height = image_height * scale
    x = (page_width - draw_width) / 2
    y = (page_height - draw_height) / 2

    pdf.setFillColorRGB(1, 1, 1)
    pdf.rect(0, 0, page_width, page_height, stroke=0, fill=1)
    pdf.drawImage(reader, x, y, width=draw_width, height=draw_height)
    pdf.showPage()


def draw_bundle_toc_page(pdf: canvas.Canvas, page_size: tuple[float, float]) -> None:
    """Draw a selectable-text contents page for the complete bundle."""
    page_width, page_height = page_size
    margin = 54
    y = page_height - margin
    sections = [
        ("01", "Start Here", "Brand welcome, bundle overview, and how to use the digital guide."),
        ("02", "Platform Bed Build", "Bed dimensions, frame, headboard, assembly flow, and cut planning."),
        ("03", "Nightstand Build", "Matching nightstand dimensions, case, drawer, hardware, and finish steps."),
        ("04", "Dresser Build", "Dresser overview, drawer layout, cut checklists, and assembly sheets."),
        ("05", "Tools, Materials, and Checklists", "Shopping list, tool guide, finishing guide, and cost worksheet."),
        ("06", "License, FAQ, and Support", "Usage rights, build notes, and customer support information."),
    ]

    pdf.setFillColor(colors.HexColor("#fbf6ee"))
    pdf.rect(0, 0, page_width, page_height, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#17130f"))
    pdf.rect(0, page_height - 170, page_width, 170, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#c48a3a"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawCentredString(page_width / 2, y, "LUXURY FURNITURE BLUEPRINTS")
    y -= 34
    pdf.setFillColor(colors.white)
    pdf.setFont("Times-Bold", 28)
    pdf.drawCentredString(page_width / 2, y, "Complete Bedroom Blueprint Bundle")
    y -= 28
    pdf.setFont("Helvetica", 10)
    pdf.drawCentredString(page_width / 2, y, "Digital woodworking plans for the platform bed, nightstand, and dresser")

    y = page_height - 220
    pdf.setFillColor(colors.HexColor("#3a2718"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin, y, "Table of Contents")
    y -= 22
    pdf.setFillColor(colors.HexColor("#6d5a47"))
    pdf.setFont("Helvetica", 10)
    pdf.drawString(margin, y, "Use this page as the bundle map. Individual blueprint sheets retain their original labels.")
    y -= 28

    for number, title, detail in sections:
        pdf.setFillColor(colors.HexColor("#c48a3a"))
        pdf.roundRect(margin, y - 8, 34, 26, 4, stroke=0, fill=1)
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawCentredString(margin + 17, y, number)
        pdf.setFillColor(colors.HexColor("#17130f"))
        pdf.setFont("Helvetica-Bold", 12)
        pdf.drawString(margin + 48, y + 4, title)
        pdf.setFillColor(colors.HexColor("#4c4137"))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(margin + 48, y - 10, detail)
        y -= 54

    pdf.setFillColor(colors.HexColor("#17130f"))
    pdf.roundRect(margin, 58, page_width - margin * 2, 62, 6, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin + 20, 94, "Digital download only")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(margin + 20, 76, "Your purchase unlocks the protected PDF and mobile guide after checkout.")
    pdf.showPage()


def build_pdf(image_dir: Path = IMAGE_DIR, output_pdf: Path = OUTPUT_PDF) -> Path:
    """Build the ordered complete bedroom bundle PDF from all blueprint images."""
    images = client_images(discover_images(image_dir))
    if not images:
        raise FileNotFoundError(f"No client-facing blueprint images found in: {image_dir}")
    page_size = choose_page_size(images)

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output_pdf), pagesize=page_size)
    pdf.setTitle("Complete Luxury Fluted Walnut Bedroom Blueprint Bundle")
    pdf.setAuthor("Luxury Furniture Blueprints")
    pdf.setSubject("Digital woodworking blueprint bundle for the platform bed, nightstand, and dresser")

    toc_inserted = False
    for image_path in images:
        if not toc_inserted and classify_image(image_path) != "intro":
            draw_bundle_toc_page(pdf, page_size)
            toc_inserted = True
        draw_image_page(pdf, image_path, page_size)

    if not toc_inserted:
        draw_bundle_toc_page(pdf, page_size)

    pdf.save()
    return output_pdf


def classify_image(path: Path) -> str:
    """Assign an image to the closest website section using filename hints."""
    if path.name in SECTION_OVERRIDES:
        return SECTION_OVERRIDES[path.name]

    name = path.stem.lower().replace("_", "-").replace(" ", "-")

    for section in SECTION_DEFINITIONS:
        if any(keyword in name for keyword in section["keywords"]):
            return section["id"]

    digits = "".join(char for char in path.stem if char.isdigit())
    index = int(digits[:3]) if digits else 0
    if index <= 8:
        return "intro"
    if index <= 26:
        return "bed-overview"
    if index <= 46:
        return "bed-build"
    if index <= 51:
        return "nightstand-overview"
    if index <= 67:
        return "nightstand-build"
    if index <= 71:
        return "dresser-overview"
    if index <= 79:
        return "dresser-build"
    if index <= 91:
        return "tools-checklists"
    return "upsells"


def manifest_items(images: list[Path]) -> list[dict[str, str]]:
    """Return browser-ready metadata for all blueprint images."""
    return [
        {
            "filename": path.name,
            "section": classify_image(path),
            "alt": path.stem.replace("_", " ").replace("-", " ").title(),
        }
        for path in images
    ]


def write_image_manifest(images: list[Path], website_dir: Path = WEBSITE_DIR) -> Path:
    """Write the website's generated image manifest."""
    website_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = website_dir / "image-manifest.js"
    payload = json.dumps(manifest_items(images), indent=2)
    manifest_path.write_text(
        "window.BLUEPRINT_IMAGES = " + payload + ";\n",
        encoding="utf-8",
    )
    return manifest_path


def copy_pdf_to_website(output_pdf: Path = OUTPUT_PDF, website_dir: Path = WEBSITE_DIR) -> Path:
    """Copy the compiled PDF into the website folder for download."""
    website_dir.mkdir(parents=True, exist_ok=True)
    destination = website_dir / output_pdf.name
    shutil.copy2(output_pdf, destination)
    legacy_destination = website_dir / "luxury_bed_blueprint.pdf"
    if legacy_destination != destination and legacy_destination.exists():
        legacy_destination.unlink()
    return destination


def main() -> int:
    try:
        all_images = discover_images(IMAGE_DIR)
        images = client_images(all_images)
        output_pdf = build_pdf(IMAGE_DIR, OUTPUT_PDF)
        website_pdf = copy_pdf_to_website(output_pdf, WEBSITE_DIR)
        manifest = write_image_manifest(images, WEBSITE_DIR)
    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print("Add ordered images to blueprint_images/ and run again.", file=sys.stderr)
        return 1

    print(f"Success: generated {output_pdf}")
    print(f"Success: copied PDF to {website_pdf}")
    print(f"Success: updated website image manifest at {manifest}")
    print(f"Success: included {len(images)} client pages after duplicate and sales-page filtering")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
