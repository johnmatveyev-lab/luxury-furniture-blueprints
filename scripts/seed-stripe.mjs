import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Stripe from "stripe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const catalogPath = path.join(projectRoot, "data", "product-catalog.json");
const outputPath = path.join(projectRoot, "data", "stripe-products.generated.json");

if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes("replace_me")) {
  console.error("Set STRIPE_SECRET_KEY before running npm run stripe:seed.");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-02-25.clover",
});
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const activeProducts = catalog.products.filter((product) => product.status === "active");
const created = [];
const envLines = [];

for (const product of activeProducts) {
  for (const productPackage of product.packages || []) {
    const stripeProduct = await findOrCreateProduct(product, productPackage);
    const stripePrice = await findOrCreatePrice(stripeProduct.id, productPackage);
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      metadata: {
        product_id: product.id,
        package: productPackage.key,
        package_name: productPackage.name,
      },
    });

    created.push({
      productId: product.id,
      package: productPackage.key,
      product: stripeProduct.id,
      price: stripePrice.id,
      paymentLink: paymentLink.url,
    });
    envLines.push(`${productPackage.stripePriceEnv}=${stripePrice.id}`);
  }
}

await fs.writeFile(outputPath, `${JSON.stringify(created, null, 2)}\n`, "utf8");

console.log(`Stripe catalog seeded: ${outputPath}`);
console.log("");
console.log("Add these to your production environment:");
console.log(envLines.join("\n"));

async function findOrCreateProduct(product, productPackage) {
  const query = `metadata['product_id']:'${product.id}' AND metadata['package']:'${productPackage.key}'`;
  const existing = await stripe.products.search({ query, limit: 1 });
  if (existing.data[0]) return existing.data[0];

  return stripe.products.create({
    name: productPackage.name,
    description: productPackage.description,
    metadata: {
      product_id: product.id,
      package: productPackage.key,
      package_name: productPackage.name,
      delivery: "digital_pdf_mobile_guide",
    },
  });
}

async function findOrCreatePrice(productId, productPackage) {
  const existing = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  });
  const match = existing.data.find(
    (price) =>
      price.unit_amount === productPackage.priceCents &&
      price.currency === productPackage.currency
  );
  if (match) return match;

  return stripe.prices.create({
    product: productId,
    unit_amount: productPackage.priceCents,
    currency: productPackage.currency,
    metadata: {
      package: productPackage.key,
      delivery: "digital_pdf_mobile_guide",
    },
  });
}
