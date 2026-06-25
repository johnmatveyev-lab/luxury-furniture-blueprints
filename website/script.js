const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector("#site-nav");
const year = document.querySelector("#year");
const images = Array.isArray(window.BLUEPRINT_IMAGES) ? window.BLUEPRINT_IMAGES : [];
const revealItems = document.querySelectorAll(".reveal");
const catalogGrid = document.querySelector("#catalog-grid");
const filterButtons = document.querySelectorAll(".filter-button");
let catalogProducts = [];

if (year) {
  year.textContent = new Date().getFullYear();
}

if (menuToggle && siteNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  siteNav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      siteNav.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open navigation");
    }
  });
}

if (revealItems.length > 0) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
}

if (document.body.classList.contains("guide-page")) {
  const lock = document.createElement("div");
  lock.className = "guide-lock";
  lock.innerHTML = `
    <div class="guide-lock-card">
      <p class="gold-kicker">Blueprints Locked</p>
      <h1>Purchase Access to View the Full Plan Guide</h1>
      <p>
        This client guide contains the ordered blueprint pages, downloadable PDF,
        assembly instructions, finishing notes, cost calculator, license page, and FAQ.
      </p>
      <div class="paywall-actions">
        <a class="primary-cta" href="index.html#paywall">Buy Now</a>
        <a class="secondary-cta" href="index.html#included">See What Is Included</a>
      </div>
    </div>
  `;
  document.body.append(lock);
  document.documentElement.classList.add("is-locked");

  fetch("/api/access-status")
    .then((response) => response.json())
    .then((data) => {
      if (data.unlocked) {
        lock.remove();
        document.documentElement.classList.remove("is-locked");
      }
    })
    .catch(() => {});
}

if (document.querySelector("#fulfillment-status")) {
  const status = document.querySelector("#fulfillment-status");
  const actions = document.querySelector("#fulfillment-actions");
  const pdfLink = document.querySelector("#pdf-link");
  const guideLink = document.querySelector("#guide-link");
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");

  if (!sessionId) {
    status.textContent =
      "No checkout session was found. Please use the purchase link from the product page.";
  } else {
    fetch(`/api/verify-session?session_id=${encodeURIComponent(sessionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Payment not verified");
        return response.json();
      })
      .then((data) => {
        if (!data.paid) throw new Error("Payment not verified");
        status.textContent = data.customerEmail
          ? `Payment verified for ${data.customerEmail}. Your files are ready.`
          : "Payment verified. Your files are ready.";
        pdfLink.href = data.pdfUrl;
        guideLink.href = data.guideUrl;
        actions.hidden = false;
      })
      .catch(() => {
        status.textContent =
          "We could not verify payment for this session. Please use the link from your delivery email or contact support.";
      });
  }
}

if (catalogGrid) {
  fetch("/api/catalog")
    .then((response) => response.json())
    .then((catalog) => {
      catalogProducts = Array.isArray(catalog.products) ? catalog.products : [];
      renderCatalog("all", "all");
    })
    .catch(() => {
      catalogGrid.innerHTML = '<p class="empty-state">Catalog products could not load.</p>';
    });
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    renderCatalog(button.dataset.filterType || "all", button.dataset.filterValue || "all");
  });
});

const newsletterForm = document.querySelector("#newsletter-form");
if (newsletterForm) {
  newsletterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#newsletter-status");
    status.textContent = "Joining...";

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(newsletterForm))),
      });
      const data = await response.json();
      status.textContent = data.message || "Thanks. You're on the list.";
      if (response.ok) newsletterForm.reset();
    } catch {
      status.textContent = "Signup failed. Please try again.";
    }
  });
}

const pdfChatForm = document.querySelector("#pdf-chat-form");
if (pdfChatForm) {
  pdfChatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const responseBox = document.querySelector("#pdf-chat-response");
    responseBox.textContent = "Checking the guide...";

    try {
      const response = await fetch("/api/pdf-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(pdfChatForm))),
      });
      const data = await response.json();
      responseBox.textContent = data.answer || "No answer was returned.";
    } catch {
      responseBox.textContent = "The assistant is unavailable right now.";
    }
  });
}

function createImageCard(image) {
  const figure = document.createElement("figure");
  figure.className = "blueprint-card";

  const img = document.createElement("img");
  img.src = `../blueprint_images/${image.filename}`;
  img.alt = image.alt || "Blueprint page";
  img.loading = "lazy";
  img.decoding = "async";

  const caption = document.createElement("figcaption");
  caption.textContent = image.alt || image.filename;

  figure.append(img, caption);
  return figure;
}

document.querySelectorAll(".guide-section").forEach((section) => {
  const sectionId = section.getAttribute("data-section");
  const grid = section.querySelector(".image-grid");
  const sectionImages = images.filter((image) => image.section === sectionId);

  if (!grid) return;

  if (sectionImages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent =
      "Images for this section will appear here after running python3 build_pdf.py.";
    grid.append(empty);
    return;
  }

  sectionImages.forEach((image) => grid.append(createImageCard(image)));
});

function renderCatalog(filterType, filterValue) {
  if (!catalogGrid) return;

  const visibleProducts = catalogProducts.filter((product) => {
    if (filterType === "all" || filterValue === "all") return true;
    return product[filterType] === filterValue;
  });

  if (visibleProducts.length === 0) {
    catalogGrid.innerHTML = '<p class="empty-state">No products match this filter yet.</p>';
    return;
  }

  catalogGrid.innerHTML = "";
  visibleProducts.forEach((product) => {
    const card = document.createElement("article");
    card.className = "catalog-card";
    const packageCount = Array.isArray(product.packages) ? product.packages.length : 0;
    card.innerHTML = `
      <img src="${product.thumbnail || product.heroImage}" alt="${product.name}">
      <div class="catalog-card-body">
        <p class="catalog-meta">
          <span>${product.category || "catalog"}</span>
          <span>${product.status === "active" ? "available" : "coming soon"}</span>
        </p>
        <h3>${product.name}</h3>
        <p>${product.summary || ""}</p>
        <ul>
          ${(product.features || []).slice(0, 4).map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        ${
          product.status === "active" && packageCount > 0
            ? '<a class="secondary-cta" href="#paywall">View Packages</a>'
            : '<a class="secondary-cta" href="#newsletter-form">Get Notified</a>'
        }
      </div>
    `;
    catalogGrid.append(card);
  });
}
