import "dotenv/config";

import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const webhookUrl = process.env.STRIPE_WEBHOOK_URL || `${publicBaseUrl}/stripe/webhook`;

if (!stripeSecretKey || stripeSecretKey.includes("replace_me")) {
  console.error("Set STRIPE_SECRET_KEY before running npm run stripe:webhook.");
  process.exit(1);
}

if (!webhookUrl.startsWith("https://")) {
  console.error(
    "Set PUBLIC_BASE_URL or STRIPE_WEBHOOK_URL to an HTTPS production URL before creating the webhook."
  );
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2026-02-25.clover",
});

const existingEndpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const existingEndpoint = existingEndpoints.data.find(
  (endpoint) => endpoint.url === webhookUrl && endpoint.status === "enabled"
);

if (existingEndpoint) {
  console.log(`Stripe webhook already exists: ${existingEndpoint.id}`);
  console.log(`URL: ${existingEndpoint.url}`);
  console.log("");
  console.log("Stripe only returns the signing secret when an endpoint is first created.");
  console.log("Use the Stripe Dashboard to reveal or rotate the signing secret, then set:");
  console.log("STRIPE_WEBHOOK_SECRET=whsec_...");
  process.exit(0);
}

const endpoint = await stripe.webhookEndpoints.create({
  url: webhookUrl,
  enabled_events: ["checkout.session.completed"],
  metadata: {
    app: "luxury-furniture-blueprints",
    purpose: "digital_fulfillment_email",
  },
});

console.log(`Stripe webhook created: ${endpoint.id}`);
console.log(`URL: ${endpoint.url}`);
console.log("");
console.log("Add this to your production environment:");
console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
