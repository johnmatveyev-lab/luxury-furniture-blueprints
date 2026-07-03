import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import nodemailer from "nodemailer";
import Stripe from "stripe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 8000);
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || getDefaultPublicBaseUrl()).replace(/\/$/, "");
const pdfPath = path.join(__dirname, "website", "luxury_fluted_walnut_bedroom_bundle_blueprints.pdf");
const catalogPath = path.join(__dirname, "data", "product-catalog.json");
const dataDir = path.join(__dirname, "data");
const newsletterPath = path.join(dataDir, "newsletter-signups.jsonl");
const catalog = loadCatalog();
const primaryProduct =
  catalog.products.find((product) => product.id === "luxury-fluted-walnut-bedroom") ||
  catalog.products.find((product) => product.status === "active") ||
  catalog.products[0];
const productPackages = Object.fromEntries(
  (primaryProduct?.packages || []).map((productPackage) => [productPackage.key, productPackage])
);
const isProduction = process.env.NODE_ENV === "production";
const hasStripeKey = Boolean(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes("replace_me"));
const accessSecret =
  process.env.DELIVERY_ACCESS_SECRET ||
  (hasStripeKey ? process.env.STRIPE_SECRET_KEY : "development-access-secret");
const testCheckoutEnabled =
  !isProduction && process.env.ENABLE_TEST_CHECKOUT !== "false";
const testSessions = new Map();
const stripe = hasStripeKey
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-02-25.clover" })
  : null;
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET.includes("replace_me")) {
      return response.status(503).send("Stripe webhook is not configured.");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body,
        request.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      return response.status(400).send(`Webhook signature verification failed: ${error.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        await sendFulfillmentEmail(session);
      }
    }

    return response.json({ received: true });
  }
);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (_request, response) => {
  response.redirect("/website/index.html");
});

app.get("/healthz", (_request, response) => {
  response.json({ ok: true });
});

app.get("/readiness", (_request, response) => {
  const readiness = getReadinessReport();
  response.status(readiness.ready ? 200 : 503).json(readiness);
});

app.get("/api/catalog", (_request, response) => {
  response.json(catalog);
});

app.get(["/website/luxury_bed_blueprint.pdf", "/luxury_bed_blueprint.pdf"], (_request, response) => {
  response.redirect(302, "/website/index.html#paywall");
});

app.get("/website/image-manifest.js", (request, response) => {
  if (!hasValidAccessCookie(request)) {
    return response.status(403).type("application/javascript").send("window.BLUEPRINT_IMAGES = [];");
  }

  return response.sendFile(path.join(__dirname, "website", "image-manifest.js"));
});

app.use("/blueprint_images", (request, response, next) => {
  if (!hasValidAccessCookie(request)) {
    return response.status(403).send("Blueprint access requires verified payment.");
  }
  return next();
});

app.use("/website", express.static(path.join(__dirname, "website")));
app.use("/blueprint_images", express.static(path.join(__dirname, "blueprint_images")));

app.post("/create-checkout-session", async (request, response) => {
  if (!stripe) {
    return response.redirect("/website/setup.html?missing=stripe");
  }

  const selectedPackage = getSelectedPackage(request.body.package);
  const stripePriceId = getPackageStripePriceId(selectedPackage);
  const unitAmount = getPackageUnitAmount(selectedPackage);
  const lineItem = stripePriceId
    ? { price: stripePriceId, quantity: 1 }
    : {
        price_data: {
          currency: process.env.PRODUCT_CURRENCY || "usd",
          product_data: {
            name: selectedPackage.name,
            description: selectedPackage.description,
            metadata: {
              product_id: primaryProduct.id,
              package: selectedPackage.key,
              delivery: "digital_pdf_and_mobile_guide",
            },
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_creation: "always",
    line_items: [lineItem],
    allow_promotion_codes: true,
    success_url: `${publicBaseUrl}/website/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicBaseUrl}/website/cancel.html`,
    metadata: {
      product: "luxury_fluted_walnut_bedroom_bundle_blueprints",
      product_id: primaryProduct.id,
      package: selectedPackage.key,
      package_name: selectedPackage.name,
      fulfillment: "pdf_and_guide_access",
    },
  });

  return response.redirect(303, session.url);
});

app.get("/test/checkout", (_request, response) => {
  if (!testCheckoutEnabled) {
    return response.status(404).send("Local test checkout is disabled.");
  }

  return response.sendFile(path.join(__dirname, "website", "test-checkout.html"));
});

app.post("/test/complete", async (request, response) => {
  if (!testCheckoutEnabled) {
    return response.status(404).send("Local test checkout is disabled.");
  }

  const email = String(request.body.email || "").trim();
  if (!email || !email.includes("@")) {
    return response.status(400).send("A customer email is required for local test checkout.");
  }

  const selectedPackage = getSelectedPackage(request.body.package);
  const session = {
    id: `cs_test_local_${crypto.randomBytes(10).toString("hex")}`,
    payment_status: "paid",
    customer_email: email,
    customer_details: { email },
    metadata: {
      product_id: primaryProduct.id,
      package: selectedPackage.key,
      package_name: selectedPackage.name,
    },
  };
  testSessions.set(session.id, session);
  setAccessCookie(response, session.id);
  await sendFulfillmentEmail(session);

  return response.redirect(303, `/website/success.html?session_id=${encodeURIComponent(session.id)}`);
});

app.get("/api/verify-session", async (request, response) => {
  const sessionId = String(request.query.session_id || "");
  const session = await getPaidCheckoutSession(sessionId);

  if (!session) {
    return response.status(403).json({ paid: false, message: "Payment could not be verified." });
  }

  setAccessCookie(response, session.id);

  return response.json({
    paid: true,
    customerEmail: session.customer_details?.email || session.customer_email || "",
    guideUrl: `/access/guide?session_id=${encodeURIComponent(session.id)}`,
    pdfUrl: `/download/pdf?session_id=${encodeURIComponent(session.id)}`,
  });
});

app.get("/api/access-status", (request, response) => {
  response.json({ unlocked: hasValidAccessCookie(request) });
});

app.get("/download/pdf", async (request, response) => {
  const sessionId = String(request.query.session_id || "");
  const session = await getPaidCheckoutSession(sessionId);
  const hasCookieAccess = hasValidAccessCookie(request);

  if (!session && !hasCookieAccess) {
    return response.status(403).send("Payment verification required.");
  }

  if (!fs.existsSync(pdfPath)) {
    return response.status(404).send("Blueprint PDF has not been generated yet.");
  }

  return response.download(pdfPath, "luxury_fluted_walnut_bedroom_bundle_blueprints.pdf");
});

app.post("/api/newsletter", async (request, response) => {
  if (isProduction && !process.env.NEWSLETTER_WEBHOOK_URL) {
    return response.status(404).json({
      ok: false,
      message: "Newsletter capture is not enabled.",
    });
  }

  const email = String(request.body.email || "").trim().toLowerCase();
  const name = String(request.body.name || "").trim();
  const interest = String(request.body.interest || "").trim();
  const source = String(request.body.source || "website").trim();

  if (!isValidEmail(email)) {
    return response.status(400).json({ ok: false, message: "Enter a valid email address." });
  }

  const signup = {
    type: "newsletter",
    email,
    name,
    interest,
    source,
    createdAt: new Date().toISOString(),
  };

  try {
    await captureNewsletterSignup(signup);
  } catch (error) {
    console.error("Newsletter signup failed", error);
    return response.status(502).json({
      ok: false,
      message: "Signup could not be saved right now. Please try again.",
    });
  }

  return response.json({
    ok: true,
    message: "You're on the list. We'll send product drops and build updates.",
  });
});

app.post("/api/pdf-chat", async (request, response) => {
  if (!hasValidAccessCookie(request)) {
    return response.status(403).json({
      ok: false,
      answer: "Unlock the client guide before using the build assistant.",
    });
  }

  const question = String(request.body.question || "").trim();
  if (question.length < 3) {
    return response.status(400).json({ ok: false, answer: "Ask a build question to get started." });
  }

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("replace_me")) {
    return response.status(503).json({
      ok: false,
      answer:
        "The build assistant is wired in, but GEMINI_API_KEY is not configured yet. Add the key in production to answer questions from the guide context.",
    });
  }

  try {
    const answer = await askGeminiAboutGuide(question);
    return response.json({ ok: true, answer });
  } catch (error) {
    console.error(error);
    return response.status(502).json({
      ok: false,
      answer: "The build assistant could not answer right now. Please try again in a moment.",
    });
  }
});

app.get("/access/guide", async (request, response) => {
  const sessionId = String(request.query.session_id || "");
  const session = await getPaidCheckoutSession(sessionId);

  if (!session) {
    return response.redirect(302, "/website/index.html#paywall");
  }

  setAccessCookie(response, session.id);
  return response.redirect(302, "/website/guide.html");
});

if (process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`Luxury bed blueprint site running at ${publicBaseUrl}/website/index.html`);
  });
}

export default app;

async function getPaidCheckoutSession(sessionId) {
  if (testCheckoutEnabled && testSessions.has(sessionId)) {
    return testSessions.get(sessionId);
  }

  if (!stripe || !sessionId.startsWith("cs_")) {
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session.payment_status === "paid" ? session : null;
  } catch {
    return null;
  }
}

const INDIVIDUAL_PLAN_PRODUCTS = {
  "plink_1ToofVEg9evyAoHbR3xMquCA": {
    name: "Fluted Walnut Platform Bed Plans",
    pdfFile: "bed-plans.pdf",
    pageUrl: "bed-plans-thankyou.html",
  },
  "plink_1ToofWEg9evyAoHbEyRorSVi": {
    name: "Fluted Walnut Nightstand Plans",
    pdfFile: "nightstand-plans.pdf",
    pageUrl: "nightstand-plans-thankyou.html",
  },
  "plink_1ToofXEg9evyAoHb961TL894": {
    name: "Fluted Walnut Dresser Plans",
    pdfFile: "dresser-plans.pdf",
    pageUrl: "dresser-plans-thankyou.html",
  },
  "plink_1TovyPEg9evyAoHbAKwVSXs6": {
    name: "Fluted Walnut Dresser Mirror Plans",
    pdfFile: "dresser-mirror-plans.pdf",
    pageUrl: "dresser-mirror-plans-thankyou.html",
  },
};

async function sendFulfillmentEmail(session) {
  const email = session.customer_details?.email || session.customer_email;
  if (!email) {
    console.warn(`No customer email found for checkout session ${session.id}`);
    return;
  }

  const individualPlan = session.payment_link
    ? INDIVIDUAL_PLAN_PRODUCTS[session.payment_link]
    : null;

  const downloadUrl = individualPlan
    ? `${publicBaseUrl}/website/pdfs/${individualPlan.pdfFile}`
    : `${publicBaseUrl}/download/pdf?session_id=${encodeURIComponent(session.id)}`;
  const guideUrl = `${publicBaseUrl}/access/guide?session_id=${encodeURIComponent(session.id)}`;
  const successUrl = individualPlan
    ? `${publicBaseUrl}/website/${individualPlan.pageUrl}`
    : `${publicBaseUrl}/website/success.html?session_id=${encodeURIComponent(session.id)}`;
  const subject = individualPlan
    ? `Your ${individualPlan.name}`
    : "Your Luxury Fluted Walnut Bedroom Blueprint Bundle";

  const message = {
    from: process.env.FROM_EMAIL || "Luxury Furniture Blueprints <support@luxuryfurnitureblueprints.com>",
    to: email,
    subject,
    text: individualPlan
      ? [
          "Thank you for your purchase.",
          "",
          `Download your PDF: ${downloadUrl}`,
          `Receipt and access page: ${successUrl}`,
          "",
          "Keep this email for future access.",
        ].join("\n")
      : [
          "Thank you for your purchase.",
          "",
          `Download your PDF: ${downloadUrl}`,
          `Open the client guide: ${guideUrl}`,
          `Receipt and access page: ${successUrl}`,
          "",
          "Keep this email for future access.",
        ].join("\n"),
    html: individualPlan
      ? `
      <p>Thank you for your purchase.</p>
      <p><a href="${downloadUrl}">Download your PDF</a></p>
      <p><a href="${successUrl}">View your access page</a></p>
      <p>Keep this email for future access.</p>
    `
      : `
      <p>Thank you for your purchase.</p>
      <p><a href="${downloadUrl}">Download your PDF</a></p>
      <p><a href="${guideUrl}">Open the client guide</a></p>
      <p><a href="${successUrl}">View your access page</a></p>
      <p>Keep this email for future access.</p>
    `,
  };

  if ((process.env.EMAIL_DELIVERY_MODE || "console") === "smtp") {
    if (!isSmtpConfigured()) {
      console.warn("SMTP email delivery is selected but SMTP settings are incomplete.");
      return;
    }

    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false") === "true",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });
    await transport.sendMail(message);
    return;
  }

  const previewId = crypto.randomBytes(4).toString("hex");
  console.log(`[email:${previewId}] To: ${message.to}`);
  console.log(`[email:${previewId}] Subject: ${message.subject}`);
  console.log(`[email:${previewId}] ${message.text}`);
}

function setAccessCookie(response, sessionId) {
  const token = createAccessToken(sessionId);
  response.cookie("blueprint_access", token, {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 180,
    sameSite: "lax",
    secure: isProduction,
  });
}

function createAccessToken(sessionId) {
  const payload = Buffer.from(
    JSON.stringify({
      sid: sessionId,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 180,
    })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", accessSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasValidAccessCookie(request) {
  const cookies = Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
  const token = cookies.blueprint_access;
  if (!token || !token.includes(".")) return false;

  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", accessSecret).update(payload).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function getReadinessReport() {
  const productCurrency = process.env.PRODUCT_CURRENCY || "usd";
  const allPackagePricesConfigured = Object.values(productPackages).every(
    (productPackage) => getPackageUnitAmount(productPackage) > 0
  );
  const checks = {
    pdfDeliverableExists: fs.existsSync(pdfPath),
    stripeSecretConfigured: hasStripeKey,
    stripeWebhookConfigured: Boolean(
      process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_WEBHOOK_SECRET.includes("replace_me")
    ),
    accessSecretConfigured: Boolean(
      process.env.DELIVERY_ACCESS_SECRET && !process.env.DELIVERY_ACCESS_SECRET.includes("replace")
    ),
    productPricingConfigured: Boolean(
      process.env.STRIPE_PRICE_ID ||
        (allPackagePricesConfigured && productCurrency)
    ),
    publicBaseUrlConfigured: !publicBaseUrl.includes("127.0.0.1") && !publicBaseUrl.includes("localhost"),
    testCheckoutDisabledInProduction: !isProduction || !testCheckoutEnabled,
    checkoutSuccessDeliveryConfigured: true,
    fulfillmentEmailOptional: true,
    newsletterDisabledOrConfigured: Boolean(process.env.NEWSLETTER_WEBHOOK_URL) || isProduction,
  };

  const ready = Object.values(checks).every(Boolean);
  return {
    ready,
    mode: isProduction ? "production" : "development",
    publicBaseUrl,
    catalogProducts: catalog.products.length,
    checks,
  };
}

function getSelectedPackage(packageKey) {
  return productPackages[String(packageKey || "bundle")] || productPackages.bundle;
}

function getPackageStripePriceId(productPackage) {
  return process.env[productPackage.stripePriceEnv] || process.env.STRIPE_PRICE_ID || "";
}

function getPackageUnitAmount(productPackage) {
  return Number(process.env[productPackage.priceEnv] || productPackage.priceCents || 0);
}

function loadCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

async function appendJsonLine(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getDefaultPublicBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return `http://127.0.0.1:${port}`;
}

async function captureNewsletterSignup(signup) {
  if (process.env.NEWSLETTER_WEBHOOK_URL) {
    const webhookResponse = await fetch(process.env.NEWSLETTER_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signup),
    });

    if (!webhookResponse.ok) {
      throw new Error(`Newsletter webhook failed with ${webhookResponse.status}`);
    }

    return;
  }

  const targetPath = process.env.VERCEL === "1" || process.env.SERVERLESS_NEWSLETTER_TMP === "true"
    ? path.join("/tmp", "newsletter-signups.jsonl")
    : newsletterPath;
  await appendJsonLine(targetPath, signup);
}

async function askGeminiAboutGuide(question) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const context = getGuideContext();

  const geminiResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "You are a careful woodworking build assistant for a paid digital blueprint guide.",
                "Answer from the available guide context. If the guide context is insufficient, say what page or section the customer should inspect instead of inventing measurements.",
                "",
                "Guide context:",
                context,
                "",
                `Customer question: ${question}`,
              ].join("\n"),
            },
          ],
        },
      ],
    }),
  });

  if (!geminiResponse.ok) {
    throw new Error(`Gemini request failed with ${geminiResponse.status}`);
  }

  const payload = await geminiResponse.json();
  return (
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join("\n")
      .trim() || "I could not find enough guide context to answer that."
  );
}

function getGuideContext() {
  const manifestPath = path.join(__dirname, "website", "image-manifest.js");
  if (!fs.existsSync(manifestPath)) {
    return "The guide manifest has not been generated yet.";
  }

  const manifestSource = fs.readFileSync(manifestPath, "utf8");
  const jsonText = manifestSource
    .replace(/^window\.BLUEPRINT_IMAGES\s*=\s*/, "")
    .replace(/;\s*$/, "");
  const images = JSON.parse(jsonText);
  const sectionCounts = images.reduce((counts, image) => {
    counts[image.section] = (counts[image.section] || 0) + 1;
    return counts;
  }, {});

  return [
    `Product: ${primaryProduct.name}`,
    `Sections: ${Object.entries(sectionCounts)
      .map(([section, count]) => `${section} (${count} pages)`)
      .join(", ")}`,
    "Ordered pages:",
    images.map((image, index) => `${index + 1}. ${image.section}: ${image.alt}`).join("\n"),
  ].join("\n");
}
