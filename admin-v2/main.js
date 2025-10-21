const views = {
  overview: {
    title: "Welcome to Admin v2",
    body:
      "This preview highlights the structure of the modern dashboard. Use the navigation to explore placeholders for each section before wiring in Supabase data and Netlify functions.",
    ctaLabel: "Review implementation checklist",
    ctaHref: "https://www.notion.so/"
  },
  assignments: {
    title: "Assignments pipeline",
    body:
      "Track job briefs, deadlines and owner allocations. The production version will surface the same Supabase data source used by the legacy admin, but scoped to the new UI components.",
    ctaLabel: "Open Assignments spec",
    ctaHref: "https://docs.google.com/document/"
  },
  clients: {
    title: "Client directory",
    body:
      "Manage client organisations, contacts and billing preferences. This space is ready for CRUD forms powered by Netlify Functions once service credentials are configured.",
    ctaLabel: "View client schema",
    ctaHref: "https://docs.google.com/spreadsheets/"
  },
  candidates: {
    title: "Candidate talent pool",
    body:
      "Search profiles, progression notes and placement history. During development you can stub the data locally, then switch to live Supabase queries for production.",
    ctaLabel: "See candidate journey",
    ctaHref: "https://miro.com/app/"
  },
  reports: {
    title: "Reporting and insights",
    body:
      "Design custom reports by combining assignments, placements and consultant KPIs. Hook this view up to your analytics endpoint to deliver interactive charts.",
    ctaLabel: "Explore reporting backlog",
    ctaHref: "https://linear.app/"
  }
};

const template = document.getElementById("view-template");
const container = document.getElementById("view-container");
const navButtons = Array.from(document.querySelectorAll(".sidebar__link"));

const normalisePath = (path) => {
  const segments = path
    .replace(/^\/admin-v2\/?/, "")
    .split("/")
    .filter(Boolean);
  if (segments[0] === "admin") {
    segments.shift();
  }
  return segments[0] ?? "overview";
};

function render(viewKey) {
  const view = views[viewKey] ?? views.overview;
  container.innerHTML = "";

  const card = template.content.cloneNode(true);
  card.querySelector(".panel__title").textContent = view.title;
  card.querySelector(".panel__body").textContent = view.body;
  const cta = card.querySelector(".panel__button");
  cta.textContent = view.ctaLabel;
  cta.href = view.ctaHref;
  cta.setAttribute("aria-label", `${view.ctaLabel} (opens in new tab)`);
  container.appendChild(card);
}

function setActive(button) {
  navButtons.forEach((btn) => btn.removeAttribute("aria-current"));
  button.setAttribute("aria-current", "page");
}

function navigate(viewKey, replace = false) {
  const button = navButtons.find((btn) => btn.dataset.view === viewKey) ?? navButtons[0];
  setActive(button);
  render(button.dataset.view);
  const url = viewKey === "overview" ? "/admin-v2" : `/admin-v2/${viewKey}`;
  const state = {};
  if (replace) {
    window.history.replaceState(state, "", url);
  } else {
    window.history.pushState(state, "", url);
  }
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const viewKey = button.dataset.view;
    navigate(viewKey);
  });
});

navigate(normalisePath(window.location.pathname), true);

window.addEventListener("popstate", () => {
  navigate(normalisePath(window.location.pathname), true);
});
