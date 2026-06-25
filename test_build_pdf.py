import tempfile
import unittest
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

import build_pdf


class BuildPdfTests(unittest.TestCase):
    def test_discovers_images_in_filename_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_dir = root / "blueprint_images"
            image_dir.mkdir()

            for name in ["010_finish.png", "002_welcome.jpg", "001_cover.png"]:
                Image.new("RGB", (40, 30), "white").save(image_dir / name)
            (image_dir / "notes.txt").write_text("ignore me", encoding="utf-8")

            images = build_pdf.discover_images(image_dir)

        self.assertEqual(
            [image.name for image in images],
            ["001_cover.png", "002_welcome.jpg", "010_finish.png"],
        )

    def test_build_outputs_pdf_and_website_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_dir = root / "blueprint_images"
            website_dir = root / "website"
            image_dir.mkdir()

            Image.new("RGB", (120, 80), "white").save(image_dir / "001_cover.png")
            Image.new("RGB", (120, 80), "white").save(
                image_dir / "040_bed-build_step_01.png"
            )

            output_pdf = root / "luxury_fluted_walnut_bedroom_bundle_blueprints.pdf"
            build_pdf.build_pdf(image_dir, output_pdf)
            build_pdf.copy_pdf_to_website(output_pdf, website_dir)
            build_pdf.write_image_manifest(build_pdf.discover_images(image_dir), website_dir)

            self.assertTrue(output_pdf.exists())
            self.assertEqual(output_pdf.read_bytes()[:4], b"%PDF")
            self.assertTrue(
                (website_dir / "luxury_fluted_walnut_bedroom_bundle_blueprints.pdf").exists()
            )

            manifest = (website_dir / "image-manifest.js").read_text(encoding="utf-8")
            self.assertIn("001_cover.png", manifest)
            self.assertIn('"section": "intro"', manifest)
            self.assertIn('"section": "bed-build"', manifest)

    def test_client_images_excludes_sales_pages_and_exact_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_dir = root / "blueprint_images"
            image_dir.mkdir()

            Image.new("RGB", (120, 80), "white").save(
                image_dir / "001_brand_brand-and-cover_src054.png"
            )
            Image.new("RGB", (120, 80), "black").save(
                image_dir / "092_upsells_bundle-and-upsell-pages_src016.png"
            )
            Image.new("RGB", (120, 80), "blue").save(
                image_dir / "030_bed-build_bed-build-plans_src025.png"
            )
            Image.new("RGB", (120, 80), "blue").save(
                image_dir / "031_bed-build_bed-build-plans_src026.png"
            )
            Image.new("RGB", (120, 80), "red").save(
                image_dir / "006_brand_brand-and-cover_src052.png"
            )

            images = build_pdf.client_images(build_pdf.discover_images(image_dir))

        self.assertEqual(
            [image.name for image in images],
            [
                "001_brand_brand-and-cover_src054.png",
                "030_bed-build_bed-build-plans_src025.png",
            ],
        )

    def test_pdf_metadata_names_the_complete_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_dir = root / "blueprint_images"
            image_dir.mkdir()

            Image.new("RGB", (120, 80), "white").save(image_dir / "001_cover.png")
            output_pdf = root / "bundle.pdf"

            build_pdf.build_pdf(image_dir, output_pdf)

            reader = PdfReader(str(output_pdf))
            self.assertEqual(
                reader.metadata.title,
                "Complete Luxury Fluted Walnut Bedroom Blueprint Bundle",
            )


if __name__ == "__main__":
    unittest.main()
