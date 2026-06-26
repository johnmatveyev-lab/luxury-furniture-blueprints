import { spawn } from "node:child_process";

const port = 8123;
const baseUrl = `http://127.0.0.1:${port}`;
const firstBlueprintImage = "/blueprint_images/001_brand_brand-and-cover_src054.png";
const server = startServer({
  PORT: String(port),
  PUBLIC_BASE_URL: baseUrl,
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
});

try {
  await waitForServer(server, port);
  await expectStatus("/healthz", 200);
  await expectStatus("/readiness", 503);
  await expectStatus("/api/catalog", 200);
  await expectBundleOnlyCatalog();
  await expectBundleOnlyLandingPage();
  await expectStatus("/website/guide.html", 200);
  await expectStatus("/website/image-manifest.js", 403);
  await expectStatus(firstBlueprintImage, 403);
  await expectStatus("/website/luxury_bed_blueprint.pdf", 302);
  await expectStatus("/download/pdf", 403);
  await expectPostStatus("/api/pdf-chat", { question: "Where do I start?" }, 403);
  await expectStatus("/access/guide", 302);
  await expectStatus("/test/checkout", 200);
  await expectPostStatus("/api/newsletter", {
    email: "reader@example.com",
    name: "Reader",
    interest: "bedroom",
    source: "smoke-test",
  }, 200);

  const checkout = await fetch(`${baseUrl}/create-checkout-session`, {
    method: "POST",
    redirect: "manual",
  });
  if (checkout.status !== 302 || checkout.headers.get("location") !== "/website/setup.html?missing=stripe") {
    throw new Error(`Expected checkout setup redirect, got ${checkout.status} ${checkout.headers.get("location")}`);
  }

  const purchase = await fetch(`${baseUrl}/test/complete`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=customer%40example.com",
    redirect: "manual",
  });
  if (purchase.status !== 303) {
    throw new Error(`Expected test purchase redirect, got ${purchase.status}`);
  }

  const cookie = purchase.headers.get("set-cookie");
  const successLocation = purchase.headers.get("location");
  if (!cookie?.includes("blueprint_access=") || !successLocation?.startsWith("/website/success.html?session_id=")) {
    throw new Error("Test purchase did not issue access cookie and success URL.");
  }

  const successUrl = new URL(`${baseUrl}${successLocation}`);
  const sessionId = successUrl.searchParams.get("session_id");
  await expectStatus(`/api/verify-session?session_id=${sessionId}`, 200);
  await expectStatusWithCookie("/website/image-manifest.js", 200, cookie);
  await expectStatusWithCookie(firstBlueprintImage, 200, cookie);
  await expectStatusWithCookie("/download/pdf", 200, cookie);
  await expectPostStatusWithCookie("/api/pdf-chat", { question: "Where do I start?" }, 503, cookie);

  await verifyProductionGuardrails();
  await verifyConfiguredProductionReadiness();
  console.log("Smoke test passed.");
} finally {
  stopServer(server);
}

function startServer(env) {
  const child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", (chunk) => {
    child.output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    child.output += chunk.toString();
  });
  return child;
}

function stopServer(child) {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
}

async function waitForServer(child, expectedPort) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (
      child.output.includes(`:${expectedPort}/website/index.html`) ||
      child.output.includes("blueprint site running at")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start. Output:\n${child.output}`);
}

async function expectStatus(path, expected) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  if (response.status !== expected) {
    throw new Error(`Expected ${path} to return ${expected}, got ${response.status}`);
  }
}

async function expectBundleOnlyCatalog() {
  const response = await fetch(`${baseUrl}/api/catalog`);
  if (response.status !== 200) {
    throw new Error(`Expected /api/catalog to return 200, got ${response.status}`);
  }

  const catalog = await response.json();
  const activeProducts = catalog.products.filter((product) => product.status === "active");
  if (activeProducts.length !== 1) {
    throw new Error(`Expected one active digital product, got ${activeProducts.length}`);
  }

  const packages = activeProducts[0].packages || [];
  if (packages.length !== 1 || packages[0].key !== "bundle") {
    throw new Error(`Expected active product to sell one bundle package, got ${packages.map((item) => item.key).join(", ")}`);
  }
}

async function expectBundleOnlyLandingPage() {
  const response = await fetch(`${baseUrl}/website/index.html`);
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`Expected /website/index.html to return 200, got ${response.status}`);
  }

  if (!body.includes("Complete Bedroom Blueprint Bundle")) {
    throw new Error("Landing page does not present the bundle as the core digital product.");
  }

  for (const legacyCopy of ["Buy Bed Plans", "Add Nightstand", "Add Dresser"]) {
    if (body.includes(legacyCopy)) {
      throw new Error(`Landing page still exposes legacy package action: ${legacyCopy}`);
    }
  }
}

async function expectPostStatus(path, body, expected) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== expected) {
    throw new Error(`Expected POST ${path} to return ${expected}, got ${response.status}`);
  }
}

async function expectStatusWithCookie(path, expected, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: { cookie },
  });
  if (response.status !== expected) {
    throw new Error(`Expected ${path} with cookie to return ${expected}, got ${response.status}`);
  }
}

async function expectPostStatusWithCookie(path, body, expected, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  if (response.status !== expected) {
    throw new Error(`Expected POST ${path} with cookie to return ${expected}, got ${response.status}`);
  }
}

async function verifyProductionGuardrails() {
  const productionPort = 8124;
  const productionBase = `http://127.0.0.1:${productionPort}`;
  const productionServer = startServer({
    PORT: String(productionPort),
    PUBLIC_BASE_URL: productionBase,
    VERCEL_URL: "luxury-furniture-blueprints.vercel.app",
    SERVERLESS_NEWSLETTER_TMP: "true",
    NODE_ENV: "production",
    ENABLE_TEST_CHECKOUT: "true",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    DELIVERY_ACCESS_SECRET: "",
  });

  try {
    await waitForServer(productionServer, productionPort);
    await expectStatusOnBase(productionBase, "/healthz", 200);
    await expectStatusOnBase(productionBase, "/readiness", 503);
    await expectStatusOnBase(productionBase, "/test/checkout", 404);
    await expectPostStatusOnBase(productionBase, "/api/newsletter", {
      email: "production-reader@example.com",
      name: "Production Reader",
      interest: "bedroom",
      source: "production-smoke-test",
    }, 404);
  } finally {
    stopServer(productionServer);
  }
}

async function verifyConfiguredProductionReadiness() {
  const productionPort = 8125;
  const productionBase = `http://127.0.0.1:${productionPort}`;
  const productionServer = startServer({
    PORT: String(productionPort),
    PUBLIC_BASE_URL: "https://luxury-furniture-blueprints.example",
    NODE_ENV: "production",
    ENABLE_TEST_CHECKOUT: "false",
    STRIPE_SECRET_KEY: "sk_live_configured_for_readiness_test",
    STRIPE_WEBHOOK_SECRET: "whsec_configured_for_readiness_test",
    DELIVERY_ACCESS_SECRET: "configured-readiness-secret",
    EMAIL_DELIVERY_MODE: "console",
    NEWSLETTER_WEBHOOK_URL: "",
  });

  try {
    await waitForServer(productionServer, productionPort);
    await expectStatusOnBase(productionBase, "/readiness", 200);
    await expectPostStatusOnBase(productionBase, "/api/newsletter", {
      email: "production-reader@example.com",
      name: "Production Reader",
      interest: "bedroom",
      source: "configured-production-smoke-test",
    }, 404);
  } finally {
    stopServer(productionServer);
  }
}

async function expectStatusOnBase(base, path, expected) {
  const response = await fetch(`${base}${path}`, { redirect: "manual" });
  if (response.status !== expected) {
    throw new Error(`Expected ${base}${path} to return ${expected}, got ${response.status}`);
  }
}

async function expectPostStatusOnBase(base, path, body, expected) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== expected) {
    throw new Error(`Expected POST ${base}${path} to return ${expected}, got ${response.status}`);
  }
}
