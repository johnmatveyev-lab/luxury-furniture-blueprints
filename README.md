# Luxury Fluted Walnut Bedroom Blueprint Bundle

This project compiles ordered blueprint page images into one client PDF, serves
a digital-download sales funnel, protects the client guide behind a checkout
gate, and emails customers their deliverable links after Stripe payment.

## Folder Layout

```text
.
├── blueprint_images/
├── build_pdf.py
├── data/
│   └── product-catalog.json
├── scripts/
│   ├── seed-stripe.mjs
│   └── smoke-test.mjs
├── server.js
├── DELIVERY_SETUP.md
├── luxury_fluted_walnut_bedroom_bundle_blueprints.pdf
└── website/
    ├── assets/
    ├── guide.html
    ├── index.html
    ├── style.css
    ├── script.js
    ├── image-manifest.js
    └── luxury_fluted_walnut_bedroom_bundle_blueprints.pdf
```

## Install

```bash
python3 -m pip install -r requirements.txt
npm install
```

## Build the PDF and Website Manifest

Add ordered images to `blueprint_images/`, then run:

```bash
python3 build_pdf.py
```

The script sorts image files by filename, removes exact duplicate pages, excludes
known sales/listing images from the paid client PDF, writes
`luxury_fluted_walnut_bedroom_bundle_blueprints.pdf`, copies that PDF into `website/`, and updates
`website/image-manifest.js` so the guide displays the current client pages.

## View the Website

Open `website/index.html` in a browser for the public landing page. The ordered
blueprint guide lives at `website/guide.html` and displays a paywall gate.

Use the Node server for the full Stripe/email workflow:

```bash
npm run dev
```

Then open `http://localhost:8000/website/`.

For Stripe and fulfillment setup, see `DELIVERY_SETUP.md`.

To seed Stripe Products and Prices from `data/product-catalog.json`:

```bash
STRIPE_SECRET_KEY=sk_test_... npm run stripe:seed
```

Useful checks:

```bash
npm run smoke
npm test
npm run test:pdf
```
