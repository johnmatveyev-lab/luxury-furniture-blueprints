const targetBaseUrl = (process.argv[2] || process.env.PUBLIC_BASE_URL || "https://luxury-furniture-blueprints.vercel.app").replace(/\/$/, "");

const checks = [];

try {
  await expectJson("/healthz", 200, (payload) => payload.ok === true, "Health endpoint returns ok");

  const readiness = await fetchJson("/readiness");
  const missingReadiness = Object.entries(readiness.payload.checks || {})
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  record(
    "Readiness endpoint",
    readiness.status === 200 && readiness.payload.ready === true,
    readiness.status === 200
      ? "Production readiness passed"
      : `Production readiness failed: ${missingReadiness.join(", ") || "unknown"}`
  );

	  await expectText("/website/index.html", 200, (body) =>
	    body.includes("Complete Luxury Fluted Walnut Bedroom Blueprint Bundle") &&
	    body.includes("Complete Bedroom Blueprint Bundle") &&
	    !body.includes("Buy Bed Plans") &&
	    !body.includes("Add Nightstand") &&
	    !body.includes("Add Dresser"),
	    "Landing page renders the single bundle product and pricing section"
	  );

  await expectStatus("/download/pdf", 403, "Unpaid PDF download is blocked");
  await expectStatus("/website/image-manifest.js", 403, "Guide image manifest is blocked before payment");

  const newsletterEmail = `production-check-${Date.now()}@example.com`;
  const newsletterResponse = await postJson("/api/newsletter", {
    email: newsletterEmail,
    name: "Production Check",
    interest: "bedroom",
    source: "production-check",
  });
  record(
    "Newsletter endpoint",
    (newsletterResponse.status === 200 && newsletterResponse.payload.ok === true) ||
      newsletterResponse.status === 404,
    newsletterResponse.status === 404
      ? "Newsletter capture is intentionally disabled"
      : newsletterResponse.payload.message || `HTTP ${newsletterResponse.status}`
  );

  const checkoutResponse = await fetch(`${targetBaseUrl}/create-checkout-session`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "package=bundle",
  });
  const checkoutLocation = checkoutResponse.headers.get("location") || "";
  record(
    "Checkout route",
    checkoutResponse.status === 303 && checkoutLocation.startsWith("https://checkout.stripe.com/"),
    checkoutResponse.status === 302 && checkoutLocation.includes("/website/setup.html?missing=stripe")
      ? "Stripe is not configured; checkout shows setup page"
      : `HTTP ${checkoutResponse.status} ${checkoutLocation}`
  );

  printReport();
  if (checks.some((check) => !check.pass)) {
    process.exit(1);
  }
} catch (error) {
  record("Production check runner", false, error.message);
  printReport();
  process.exit(1);
}

async function expectJson(path, expectedStatus, predicate, description) {
  const result = await fetchJson(path);
  record(path, result.status === expectedStatus && predicate(result.payload), description);
}

async function expectText(path, expectedStatus, predicate, description) {
  const response = await fetch(`${targetBaseUrl}${path}`);
  const body = await response.text();
  record(path, response.status === expectedStatus && predicate(body), description);
}

async function expectStatus(path, expectedStatus, description) {
  const response = await fetch(`${targetBaseUrl}${path}`, { redirect: "manual" });
  record(path, response.status === expectedStatus, description);
}

async function fetchJson(path) {
  const response = await fetch(`${targetBaseUrl}${path}`);
  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { payload, status: response.status };
}

async function postJson(path, body) {
  const response = await fetch(`${targetBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { payload, status: response.status };
}

function record(name, pass, detail) {
  checks.push({ detail, name, pass });
}

function printReport() {
  console.log(`Production check: ${targetBaseUrl}`);
  for (const check of checks) {
    console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name} - ${check.detail}`);
  }
}
