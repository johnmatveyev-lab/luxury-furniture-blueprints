# Delivery, Stripe, and Email Workflow

This project is wired for one-time digital product sales using Stripe Checkout.
The product catalog lives in `data/product-catalog.json`; the active offer is
one complete bedroom blueprint bundle. After payment, the server verifies the
Checkout Session, exposes protected PDF download links, and sends the customer a
fulfillment email from the Stripe webhook.

## 1. Build the PDF Deliverable

```bash
python3 -m pip install -r requirements.txt
python3 build_pdf.py
```

Generated deliverables:

- `luxury_fluted_walnut_bedroom_bundle_blueprints.pdf`
- `website/luxury_fluted_walnut_bedroom_bundle_blueprints.pdf`
- `website/image-manifest.js`

The builder removes exact duplicate images and excludes known marketplace,
Etsy-listing, and landing-page assets from the paid client PDF. Those sales
assets can still be used on the public landing page.

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

- `PUBLIC_BASE_URL` - your deployed domain, for example `https://yourdomain.com`
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - webhook signing secret from Stripe
- `DELIVERY_ACCESS_SECRET` - a long random value used to sign customer access cookies
- `STRIPE_PRICE_ID_BUNDLE` - preferred for a stable Stripe Product/Price
- `EMAIL_DELIVERY_MODE=smtp` - when ready to send real emails
- `SMTP_*` - your transactional email provider settings
- `NEWSLETTER_WEBHOOK_URL` - optional durable newsletter signup destination

If the Stripe Price ID is empty, the server creates an inline Checkout price from
`BUNDLE_PRICE_CENTS` and `PRODUCT_CURRENCY`.

Optional:

- `GEMINI_API_KEY` and `GEMINI_MODEL` enable the paid guide's Talk to PDF build
  assistant.

## 3. Seed Stripe Products and Prices

With a Stripe test or live secret key in `.env`, run:

```bash
npm run stripe:seed
```

The script creates or reuses a Stripe Product and Price for:

- `Complete Bedroom Blueprint Bundle` at `$59`

It writes `data/stripe-products.generated.json` and prints these environment
variables:

```text
STRIPE_PRICE_ID_BUNDLE=price_...
```

## 4. Stripe Dashboard Setup

Create a webhook endpoint pointing to:

```text
https://yourdomain.com/stripe/webhook
```

Subscribe to:

```text
checkout.session.completed
```

For local testing with Stripe CLI:

```bash
stripe listen --forward-to localhost:8000/stripe/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.

You can also create the production webhook from the Stripe API after
`STRIPE_SECRET_KEY` and `PUBLIC_BASE_URL` are set:

```bash
npm run stripe:webhook
```

The command creates an endpoint for `checkout.session.completed` and prints the
`STRIPE_WEBHOOK_SECRET` value to add to Vercel. If the endpoint already exists,
Stripe does not return its secret again; reveal or rotate it in the Stripe
Dashboard and then set `STRIPE_WEBHOOK_SECRET`.

## 5. Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:8000/website/index.html
```

Without Stripe keys, the Buy button redirects to the setup page. Use
`Run Local Test Purchase` from that page to simulate a paid checkout locally.
The test purchase:

- creates a development-only paid session,
- writes the fulfillment email to the server console,
- unlocks the protected guide with the same access cookie flow,
- exposes the protected PDF download link.

The route is disabled when `NODE_ENV=production` or when
`ENABLE_TEST_CHECKOUT=false`.

Checkout flow:

1. Customer chooses the complete bedroom blueprint bundle.
2. Server creates a Stripe Checkout Session.
3. Stripe redirects back to `website/success.html?session_id=...`.
4. Success page verifies payment with `/api/verify-session`.
5. Customer gets protected PDF download and guide access.
6. Stripe webhook sends the fulfillment email.

Customer delivery links:

- PDF: `/download/pdf?session_id=cs_...`
- Guide: `/access/guide?session_id=cs_...`

Both links verify the Stripe Checkout Session before granting access. After guide
access is verified, the signed access cookie also allows the in-guide PDF
download button to work.

Development-only test sessions use the same links and cookie logic, but they are
held in memory and disappear when the local server restarts.

## 6. Production Notes

- Do not deploy `.env`.
- Use HTTPS for `PUBLIC_BASE_URL`.
- Use live Stripe keys only after test checkout works.
- Keep the PDF route behind `/download/pdf?session_id=...`.
- The generated PDF, blueprint image manifest, and blueprint images are protected
  by Stripe session verification plus a signed access cookie.
- Newsletter signups are appended to `data/newsletter-signups.jsonl` locally. In
  production, set `NEWSLETTER_WEBHOOK_URL` to send signups to your email service,
  CRM, Make/Zapier webhook, or newsletter platform.
- Add future furniture products in `data/product-catalog.json`; the landing page
  catalog and Stripe seed script will pick them up.
- Before going live, open `/readiness`. It should return HTTP `200` and
  `"ready": true`. If it returns HTTP `503`, the JSON response lists the missing
  Stripe, email, domain, access-secret, or deliverable checks.

Useful local checks:

```bash
npm test
npm run test:pdf
npm run production:check -- https://luxury-furniture-blueprints.vercel.app
curl http://127.0.0.1:8000/readiness
```
