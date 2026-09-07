import {
  priority,
  color,
  summary,
  filterAssets,
  date,
  initials,
  severityName,
} from "./utils.js";

const $ = (selector, parent = document) => parent.querySelector(selector);
const root = $("#root"),
  modal = $("#modal"),
  modalBody = $("#modal-body");
const state = {
  account: null,
  assets: [],
  reports: [],
  activity: [],
  view: "overview",
  archived: false,
  reportFilter: "Open",
};
let map,
  toastTimer,
  refreshing = false;
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  bridge:
    '<path d="M2 18h20M6 18V5m12 13V5M2 12c6-1 10-4 10-9 0 5 4 8 10 9M10 18v-7m4 7v-7"/>',
  road: '<path d="m8 3-4 18M16 3l4 18M12 3v3m0 4v4m0 4v3"/>',
  reports: '<path d="M8 3h8l5 5v13H3V3h5Zm8 0v6h5M7 13h10M7 17h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  heart: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
  logout: '<path d="M10 4H4v16h6m5-13 5 5-5 5m-7-5h12"/>',
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="5" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8 10 7-4m-7 8 7 4"/>',
  tool: '<path d="M14 3a6 6 0 0 0-7 8l-5 6 5 5 6-6a6 6 0 0 0 8-7l-4 4-4-4 4-4Z"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
}
function el(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") element.className = value;
    else if (key.startsWith("on"))
      element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value);
  }
  for (const child of [children].flat(Infinity))
    if (child != null)
      element.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return element;
}
function symbol(name) {
  const span = el("span", { class: "icon" });
  span.innerHTML = icon(name);
  return span;
}
function button(label, action, cls = "button", name) {
  return el("button", { class: cls, type: "button", onclick: action }, [
    name ? symbol(name) : null,
    label,
  ]);
}
function badge(label, tone = label.toLowerCase()) {
  return el("span", { class: `badge ${tone}` }, [
    el("span", { class: "dot" }),
    label,
  ]);
}
function brand() {
  const a = el("a", {
    class: "brand",
    href: "/",
    "aria-label": "StructIQ home",
  });
  a.innerHTML = '<img src="/static/favicon.svg" alt="">Struct<span>IQ</span>';
  return a;
}
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 5500);
}
async function api(path, options = {}) {
  const headers = { "X-Requested-With": "StructIQ", ...options.headers };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers,
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new Error(
      "Connection interrupted. Check your connection and try again.",
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body.detail)
      ? body.detail.map((e) => `${e.loc.at(-1)}: ${e.msg}`).join(" · ")
      : body.detail;
    const error = new Error(
      message || "Something went wrong. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return body;
}
function openDialog(title, content) {
  $("#modal-title").textContent = title;
  modalBody.replaceChildren(content);
  if (!modal.open) modal.showModal();
}
$("#close-modal").onclick = () => modal.close();
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      modal.close();
  }
});
function formError(form, message) {
  let error = $(".error-message", form);
  if (!error) {
    error = el("p", { class: "error-message", role: "alert" });
    form.prepend(error);
  }
  error.textContent = message;
  error.focus?.();
}
async function submit(form, task) {
  const controls = [...form.querySelectorAll('button[type="submit"]')];
  controls.forEach((b) => (b.disabled = true));
  $(".error-message", form)?.remove();
  try {
    await task();
  } catch (error) {
    formError(form, error.message);
  } finally {
    controls.forEach((b) => (b.disabled = false));
  }
}
async function startDemo(event) {
  const target = event?.currentTarget;
  if (target) target.disabled = true;
  try {
    state.account = await api("/auth/demo", { method: "POST" });
    history.pushState({}, "", "/app");
    await loadWorkspace();
  } catch (error) {
    toast(error.message);
  } finally {
    if (target) target.disabled = false;
  }
}
function authDialog(mode = "login") {
  const register = mode === "register";
  const form = el("form", { class: "form" });
  form.innerHTML = `${register ? '<label>Workspace name<input name="name" maxlength="80" required autocomplete="organization" placeholder="e.g. City maintenance team"></label>' : ""}
    <label>Username<input name="username" minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Your username"></label>
    <label>Password<input name="password" type="password" minlength="10" maxlength="128" required autocomplete="${register ? "new-password" : "current-password"}" placeholder="At least 10 characters"></label>
    <p class="hint">${register ? "Use letters, numbers, hyphens, or underscores for your username. Your workspace starts with nine illustrative assets. Keep your password safe; email recovery is not available." : "Sign in to your private workspace. Demo workspaces are accessible from the browser where you created them."}</p>
    <button type="submit" class="button">${register ? "Create workspace" : "Sign in"} ${icon("arrow")}</button>`;
  form.onsubmit = (event) => {
    event.preventDefault();
    submit(form, async () => {
      const data = Object.fromEntries(new FormData(form));
      state.account = await api(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: data,
      });
      modal.close();
      history.pushState({}, "", "/app");
      await loadWorkspace();
    });
  };
  const content = el("div", {}, [
    el(
      "p",
      { class: "auth-intro" },
      register
        ? "A dedicated place to organize assets and follow every report through to resolution."
        : "Welcome back. Your assets and reports are right where you left them.",
    ),
    form,
    el("div", { class: "auth-foot" }, [
      register ? "Already have a workspace? " : "New to StructIQ? ",
      button(
        register ? "Sign in" : "Create an account",
        () => authDialog(register ? "login" : "register"),
        "text-button",
      ),
    ]),
  ]);
  openDialog(
    register ? "Create your workspace" : "Sign in to StructIQ",
    content,
  );
}
function landing() {
  destroyMap();
  root.innerHTML = `<div class="landing"><header class="land-nav"><div id="landing-brand"></div><nav><a href="https://github.com/pralav-25/StructIQ" target="_blank" rel="noopener">Project source ↗</a><button class="text-button" id="sign-in">Sign in</button><button class="button dark" id="create-account">Create workspace</button></nav></header>
    <main id="main"><section class="hero"><div><span class="eyebrow">Infrastructure, understood.</span><h1>Every asset.<br>Every report.<br><em>A clearer picture.</em></h1><p>Bring asset health, community reports, and maintenance work into one organized workspace. See what needs attention. Keep track of what happens next.</p><div class="row"><button class="button dark" id="launch-demo">Launch private demo ${icon("arrow")}</button><a class="button secondary" href="#how-it-works">Explore the workflow</a></div><p class="hero-fine">No account required for a demo · Your own data · Kept for 7 days</p></div>
    <div class="hero-board"><div class="row between"><span class="eyebrow">CHENNAI / EXAMPLE NETWORK</span><span class="demo-label">Demonstration</span></div>
    <svg class="hero-map" viewBox="0 0 450 250" fill="none" aria-label="Illustration of a connected infrastructure network" role="img"><g stroke="#588178" stroke-width="1"><path d="m0 78 81 10 59 73 68-8 70 17 64-28 108 32M12 221l70-40 57-20 38-61 79-21 25-79M56 0l25 88 96 12 32 53-12 97M177 0v100l103 70 62-28 22-85 86-33M0 136l82 45 28 69M281 0l83 57 57 37 29 0M256 79l108-22M342 142l30 108"/></g><path d="M371 0c-18 48-1 67 24 86s-7 74-1 103 15 50 56 61" stroke="#3d686c" stroke-width="26" opacity=".6"/><g fill="#b6efce" stroke="#214a3e" stroke-width="7"><circle cx="81" cy="88" r="8"/><circle cx="177" cy="100" r="8"/><circle cx="256" cy="79" r="8"/><circle cx="280" cy="170" r="8"/><circle cx="364" cy="57" r="8"/><circle cx="82" cy="181" r="8"/></g><g fill="#efbd74" stroke="#604c35" stroke-width="7"><circle cx="139" cy="161" r="9"/><circle cx="209" cy="153" r="9"/></g><circle cx="342" cy="142" r="9" fill="#e69580" stroke="#60443b" stroke-width="7"/><g font-size="9" fill="#c3d8ce" font-family="sans-serif"><text x="182" y="81">Anna Flyover</text><text x="261" y="60">Napier Bridge</text><text x="82" y="214">Adyar Bridge</text></g></svg>
    <div class="preview-metrics"><div><strong>09</strong><span>Example assets</span></div><div><strong>03</strong><span>Asset categories</span></div><div><strong>01</strong><span>Connected workflow</span></div></div><div class="mini-incident row between"><span>From first report to verified closure</span><span class="badge">Full history</span></div></div></section>
    <section class="landing-features" id="how-it-works"><article class="feature"><span class="feature-number">01 / UNDERSTAND</span><h3>Your network, in context.</h3><p>Explore bridges, roads, and flyovers on a map. Search the asset register and compare clearly explained demonstration scores.</p></article><article class="feature"><span class="feature-number">02 / RESPOND</span><h3>Give every report a path.</h3><p>Capture an issue, attach a photo, and follow its status. Share a reporting link with your community without sharing account access.</p></article><article class="feature"><span class="feature-number">03 / REMEMBER</span><h3>Keep the whole story.</h3><p>Record maintenance, resolve incidents with notes, and export your register. A persistent timeline keeps every action in context.</p></article></section></main>
    <footer class="land-bottom"><div><p><strong>A working portfolio demonstration.</strong> Example assets, health scores, and flood effects are illustrative. StructIQ is not a validated engineering or emergency system and must not be used for real-world safety decisions.</p><nav><a href="/docs">API reference ↗</a><a href="https://github.com/pralav-25/StructIQ">GitHub ↗</a></nav></div></footer></div>`;
  $("#landing-brand").append(brand());
  $("#sign-in").onclick = () => authDialog();
  $("#create-account").onclick = () => authDialog("register");
  $("#launch-demo").onclick = startDemo;
  if (state.account) {
    $("#sign-in").textContent = "Open workspace";
    $("#sign-in").onclick = () => {
      history.pushState({}, "", "/app");
      loadWorkspace();
    };
  }
}
function destroyMap() {
  if (map) {
    map.remove();
    map = null;
  }
}
async function loadWorkspace() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [account, assets, reports, activity] = await Promise.all([
      api("/auth/me"),
      api("/assets"),
      api("/reports"),
      api("/activity"),
    ]);
    Object.assign(state, {
      account,
      assets,
      reports,
      activity,
      archived: false,
    });
    renderShell();
  } catch (error) {
    if (error.status === 401) {
      state.account = null;
      landing();
      authDialog();
    } else {
      toast(error.message);
      if (!$("#content"))
        root.replaceChildren(
          el("main", { id: "main", class: "public-page" }, [
            brand(),
            el("h1", {}, "Connection unavailable"),
            el("p", {}, error.message),
            button("Try again", loadWorkspace),
          ]),
        );
    }
  } finally {
    refreshing = false;
  }
}
function renderShell() {
  destroyMap();
  const open = state.reports.filter((r) => r.status === "Open").length;
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div id="app-brand"></div><div class="nav-label">Workspace</div><nav class="nav-items" aria-label="Workspace sections"></nav><div class="side-note"><div class="line-art">${icon("bridge")} ──────────</div><p>Infrastructure insight.<br>From report to resolution.</p><span class="demo-label">Illustrative scores</span></div><div class="side-account"><div class="avatar"></div><div><div class="account-name"></div><div class="small"></div></div><button class="icon-button" id="logout" aria-label="Sign out">${icon("logout")}</button></div></aside>
    <div class="workspace-main"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <strong id="breadcrumb-view"></strong></div><div class="row"><button class="icon-button" id="refresh-data" aria-label="Refresh workspace data" title="Refresh data">${icon("clock")}</button><span class="top-date"></span><span class="live-pill"><span class="dot"></span>Connected</span></div></header><main id="main" class="content"><div id="content"></div><footer class="app-foot"><span>Portfolio demo. Scores and flood effects are illustrative, not structural assessments.</span><a href="/docs" target="_blank" rel="noopener">API reference ↗</a></footer></main></div></div>`;
  $("#app-brand").append(brand());
  $(".avatar").textContent = initials(state.account.name);
  $(".account-name").textContent = state.account.name;
  $(".side-account .small").textContent = state.account.is_demo
    ? "Private demo · 7-day retention"
    : `@${state.account.username}`;
  $(".top-date").textContent = date(new Date().toISOString());
  $("#refresh-data").onclick = loadWorkspace;
  for (const [key, label, name] of [
    ["overview", "Overview", "grid"],
    ["assets", "Asset register", "bridge"],
    ["reports", "Incident reports", "reports"],
    ["activity", "Activity log", "clock"],
  ]) {
    const b = button(
      label,
      () => {
        state.view = key;
        state.archived = false;
        renderShell();
      },
      `nav-item ${state.view === key ? "active" : ""}`,
      name,
    );
    if (state.view === key) b.setAttribute("aria-current", "page");
    if (key === "reports" && open)
      b.append(el("span", { class: "count" }, open));
    $(".nav-items").append(b);
  }
  $("#logout").onclick = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      state.account = null;
      history.pushState({}, "", "/");
      landing();
    } catch (e) {
      toast(e.message);
    }
  };
  const names = {
    overview: "Overview",
    assets: "Asset register",
    reports: "Incident reports",
    activity: "Activity log",
  };
  $("#breadcrumb-view").textContent = names[state.view];
  ({ overview, assetsView, reportsView, activityView })[
    {
      overview: "overview",
      assets: "assetsView",
      reports: "reportsView",
      activity: "activityView",
    }[state.view]
  ]();
}
function heading(title, description, actions = []) {
  return el("div", { class: "page-head" }, [
    el("div", {}, [el("h1", {}, title), el("p", {}, description)]),
    el("div", { class: "row wrap" }, actions),
  ]);
}
function exportButton() {
  return el(
    "a",
    {
      class: "button secondary",
      href: "/api/export",
      download: "structiq-assets.csv",
    },
    [symbol("download"), "Export register"],
  );
}
function panel(title, subtitle, action) {
  const section = el("section", { class: "panel" });
  section.append(
    el("div", { class: "panel-head" }, [
      el("div", {}, [
        el("h2", {}, title),
        subtitle ? el("p", {}, subtitle) : null,
      ]),
      action,
    ]),
  );
  return section;
}
function stats() {
  const s = summary(state.assets, state.reports),
    box = el("div", { class: "stats" });
  for (const [label, value, foot, name] of [
    [
      "Monitored assets",
      String(s.total).padStart(2, "0"),
      "Bridges, roads & flyovers",
      "bridge",
    ],
    [
      "Average demo health",
      `${s.average.toFixed(1)}%`,
      "Illustrative condition estimate",
      "heart",
    ],
    [
      "Assets needing attention",
      String(s.attention).padStart(2, "0"),
      "Below the 70-point threshold",
      "warning",
    ],
    [
      "Open reports",
      String(s.open).padStart(2, "0"),
      `${state.reports.length - s.open} resolved and retained`,
      "reports",
    ],
  ]) {
    box.append(
      el("article", { class: "stat" }, [
        el("div", { class: "stat-label" }, [label, symbol(name)]),
        el("div", { class: "stat-value" }, value),
        el("div", { class: "stat-foot" }, foot),
      ]),
    );
  }
  return box;
}
function overview() {
  const content = $("#content");
  content.append(
    heading(
      "Network overview",
      "A clear view of your assets, reports, and maintenance priorities.",
      [
        exportButton(),
        button("Add asset", () => assetForm(), "button", "plus"),
      ],
    ),
    stats(),
  );
  const grid = el("div", { class: "dashboard-grid" }),
    mapPanel = panel(
      "Asset geography",
      "Chennai example network",
      badge(`${state.assets.length} assets`, "neutral"),
    );
  const wrap = el("div", { class: "map-wrap" }, [
    el(
      "div",
      { class: "map-fallback" },
      "Map unavailable. All assets remain accessible in the register below.",
    ),
    el("div", {
      class: "map",
      id: "asset-map",
      "aria-label": "Map of registered infrastructure assets",
    }),
  ]);
  mapPanel.append(wrap);
  const legend = el("div", { class: "map-legend" });
  for (const [label, tone] of [
    ["Low priority · 70–100", ""],
    ["High · 40–69", "amber"],
    ["Emergency · under 40", "red"],
  ])
    legend.append(
      el("span", {}, [el("i", { class: `legend-dot ${tone}` }), label]),
    );
  mapPanel.append(legend);
  const queue = panel(
    "Incident queue",
    "Latest open reports",
    badge(
      String(state.reports.filter((r) => r.status === "Open").length),
      "neutral",
    ),
  );
  const reports = state.reports.filter((r) => r.status === "Open").slice(0, 3),
    list = el("div", { class: "queue-list" });
  for (const report of reports) {
    const item = el("div", { class: "queue-item" }, [
      el("div", { class: "queue-title" }, [
        button(report.asset_name, () => reportDetail(report), "text-button"),
        badge(
          severityName(report.severity),
          report.severity === 15
            ? "emergency"
            : report.severity === 10
              ? "high"
              : "",
        ),
      ]),
      el("p", {}, report.description),
      el("div", { class: "queue-meta" }, [
        `REPORT #${report.id}`,
        date(report.created_at, true),
      ]),
    ]);
    list.append(item);
  }
  if (!reports.length)
    list.append(
      el("div", { class: "empty" }, [
        symbol("check"),
        el("strong", {}, "All caught up"),
        "New reports will appear here. Create one to try the full workflow.",
        el(
          "div",
          { style: "margin-top:15px" },
          button(
            "Submit a report",
            () => reportForm(),
            "button secondary slim",
            "plus",
          ),
        ),
      ]),
    );
  queue.append(
    list,
    el(
      "div",
      { class: "queue-footer" },
      button(
        "View all reports",
        () => {
          state.view = "reports";
          renderShell();
        },
        "text-button",
        "arrow",
      ),
    ),
  );
  grid.append(mapPanel, queue);
  content.append(grid);
  const tablePanel = panel(
    "Asset register",
    "Prioritized by demonstration health score",
    button(
      "View register",
      () => {
        state.view = "assets";
        renderShell();
      },
      "text-button",
      "arrow",
    ),
  );
  tablePanel.append(
    assetTable(
      [...state.assets]
        .sort((a, b) => a.health_score - b.health_score)
        .slice(0, 5),
    ),
  );
  content.append(tablePanel, scenarioBar());
  mountMap();
}
function mountMap() {
  if (!window.L || !$("#asset-map")) return;
  try {
    map = L.map("asset-map", {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([13.025, 80.245], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const points = [];
    for (const asset of state.assets) {
      points.push([asset.latitude, asset.longitude]);
      const popup = el("div", { class: "map-popup" }, [
        el("strong", {}, asset.name),
        el(
          "p",
          {},
          `${asset.asset_type} · ${asset.health_score.toFixed(1)} demo health`,
        ),
        button("Asset details", () => assetDetail(asset), "text-button"),
      ]);
      L.circleMarker([asset.latitude, asset.longitude], {
        radius: 7,
        fillColor: color(asset.health_score),
        color: "#fff",
        weight: 2,
        fillOpacity: 1,
      })
        .addTo(map)
        .bindPopup(popup);
    }
    if (points.length)
      map.fitBounds(points, { padding: [38, 38], maxZoom: 13 });
    $(".map-fallback").hidden = true;
    requestAnimationFrame(() => map?.invalidateSize());
  } catch {
    $("#asset-map").hidden = true;
  }
}
function scoreCell(asset) {
  const fill = el("span");
  fill.style.width = `${Math.max(0, Math.min(100, asset.health_score))}%`;
  fill.style.background = color(asset.health_score);
  return el("div", { class: "score" }, [
    el("strong", {}, asset.health_score.toFixed(1)),
    el("div", { class: "score-bar", "aria-hidden": "true" }, fill),
  ]);
}
function assetTable(assets) {
  if (!assets.length)
    return el("div", { class: "empty" }, [
      el("strong", {}, "No matching assets"),
      "Try a different filter or register a new asset.",
    ]);
  const table = el("table");
  table.innerHTML =
    '<thead><tr><th scope="col">Asset name</th><th scope="col">Type</th><th scope="col">Age</th><th scope="col">Demo health</th><th scope="col">Priority</th><th scope="col"><span class="small">Details</span></th></tr></thead>';
  const tbody = el("tbody");
  for (const a of assets)
    tbody.append(
      el("tr", {}, [
        el(
          "td",
          {},
          el("div", { class: "asset-name" }, [
            el(
              "span",
              { class: "asset-symbol" },
              symbol(a.asset_type === "Road" ? "road" : "bridge"),
            ),
            el("div", {}, [
              button(a.name, () => assetDetail(a), "text-button"),
              el("small", {}, `AST-${String(a.id).padStart(4, "0")}`),
            ]),
          ]),
        ),
        el("td", {}, a.asset_type),
        el("td", { class: "muted" }, `${a.age} years`),
        el("td", {}, scoreCell(a)),
        el("td", {}, badge(priority(a.health_score))),
        el(
          "td",
          {},
          button(
            a.archived ? "Restore" : "View →",
            () => (a.archived ? toggleArchive(a, false) : assetDetail(a)),
            "text-button",
          ),
        ),
      ]),
    );
  table.append(tbody);
  return el("div", { class: "table-wrap" }, table);
}
function scenarioBar() {
  return el(
    "div",
    { class: `scenario-bar ${state.account.flood_active ? "active" : ""}` },
    [
      el("div", {}, [
        el(
          "strong",
          {},
          state.account.flood_active
            ? "Flood scenario is active"
            : "Explore a flood scenario",
        ),
        el(
          "p",
          {},
          "Applies a reversible 15-point penalty to road scores. This is a demonstration, not live weather.",
        ),
      ]),
      button(
        state.account.flood_active ? "Clear scenario" : "Simulate flood",
        async (event) => {
          event.currentTarget.disabled = true;
          try {
            await api("/scenarios/flood", {
              method: "POST",
              body: { active: !state.account.flood_active },
            });
            await loadWorkspace();
            toast("Scenario updated.");
          } catch (e) {
            toast(e.message);
            event.currentTarget.disabled = false;
          }
        },
        "button secondary slim",
      ),
    ],
  );
}
function assetsView() {
  const content = $("#content");
  content.append(
    heading(
      "Asset register",
      "Search, register, and maintain your infrastructure inventory.",
      [
        exportButton(),
        button("Add asset", () => assetForm(), "button", "plus"),
      ],
    ),
  );
  const toolbar = el("div", { class: "toolbar" });
  toolbar.innerHTML = `<label class="search-wrap">${icon("search")}<input type="search" placeholder="Search asset name or ID" aria-label="Search assets"></label><div class="row"><select class="filter" aria-label="Filter asset type"><option value="">All asset types</option><option>Bridge</option><option>Road</option><option>Flyover</option></select><select class="filter" aria-label="Filter priority"><option value="">All priorities</option><option>Low</option><option>High</option><option>Emergency</option></select><button class="button secondary slim" id="archive-filter">${state.archived ? "Active assets" : "View archived"}</button></div>`;
  const area = el("div", { class: "panel" }),
    input = $("input", toolbar),
    [type, risk] = toolbar.querySelectorAll("select");
  let currentAssets = state.assets;
  const update = () =>
    area.replaceChildren(
      assetTable(
        filterAssets(currentAssets, input.value, type.value, risk.value),
      ),
    );
  [input, type, risk].forEach((control) =>
    control.addEventListener(control === input ? "input" : "change", update),
  );
  $("#archive-filter", toolbar).onclick = async () => {
    try {
      state.archived = !state.archived;
      currentAssets = state.archived
        ? await api("/assets?archived=true")
        : state.assets;
      $("#archive-filter").textContent = state.archived
        ? "Active assets"
        : "View archived";
      update();
    } catch (e) {
      toast(e.message);
    }
  };
  content.append(toolbar, area, scenarioBar());
  update();
}
function assetForm(asset) {
  const form = el("form", { class: "form" });
  form.innerHTML = `<label>Asset name<input name="name" required maxlength="120" placeholder="e.g. Riverside Bridge"></label><div class="form-grid"><label>Asset type<select name="asset_type"><option>Bridge</option><option>Road</option><option>Flyover</option></select></label><label>Construction year<input name="construction_year" type="number" min="1" max="${new Date().getFullYear()}" value="2020" required></label></div><div class="form-grid"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" value="13.0827" required></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" value="80.2707" required></label></div><p class="hint">Coordinates determine the map position. Changing construction year or asset type recalculates the base demonstration score.</p><button class="button" type="submit">${asset ? "Save changes" : "Register asset"}</button>`;
  if (asset)
    for (const key of [
      "name",
      "asset_type",
      "construction_year",
      "latitude",
      "longitude",
    ])
      form.elements[key].value = asset[key];
  form.onsubmit = (event) => {
    event.preventDefault();
    submit(form, async () => {
      const data = Object.fromEntries(new FormData(form));
      for (const key of ["construction_year", "latitude", "longitude"])
        data[key] = Number(data[key]);
      await api(asset ? `/assets/${asset.id}` : "/assets", {
        method: asset ? "PUT" : "POST",
        body: data,
      });
      modal.close();
      await loadWorkspace();
      toast(asset ? "Asset updated." : "Asset registered.");
    });
  };
  openDialog(asset ? "Edit asset" : "Register an asset", form);
}
function assetDetail(asset) {
  const incidents = state.reports.filter(
    (r) => r.asset_id === asset.id && r.status === "Open",
  );
  const body = el("div", {}, [
    el("div", { class: "row between" }, [
      badge(asset.asset_type, "neutral"),
      badge(priority(asset.health_score)),
    ]),
    el("div", { class: "details-grid" }, [
      el("div", { class: "detail-stat" }, [
        "Demo health",
        el("strong", {}, `${asset.health_score.toFixed(1)} / 100`),
      ]),
      el("div", { class: "detail-stat" }, [
        "Open reports",
        el("strong", {}, incidents.length),
      ]),
    ]),
    el("div", { class: "detail-list" }, [
      el("div", {}, [
        el("span", {}, "Construction year"),
        `${asset.construction_year} (${asset.age} years)`,
      ]),
      el("div", {}, [
        el("span", {}, "Coordinates"),
        `${asset.latitude.toFixed(4)}, ${asset.longitude.toFixed(4)}`,
      ]),
      el("div", {}, [
        el("span", {}, "Last maintenance"),
        date(asset.last_service_at),
      ]),
      el("div", {}, [
        el("span", {}, "Base condition score"),
        asset.condition_score.toFixed(1),
      ]),
    ]),
    el(
      "p",
      { class: "notice" },
      "Score = base condition − open report penalties − an active flood penalty. Reports use the submitter’s priority; photos are evidence for human review, not automated diagnoses.",
    ),
  ]);
  const scores = state.activity
    .filter((a) => a.asset_id === asset.id && a.health_score != null)
    .reverse();
  if (scores.length > 1) {
    body.append(
      el("p", { class: "progress-heading" }, "Recorded score history"),
    );
    const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chart.setAttribute("viewBox", "0 0 420 105");
    chart.setAttribute("class", "health-chart");
    chart.setAttribute("role", "img");
    chart.setAttribute(
      "aria-label",
      `Recorded demo scores: ${scores.map((s) => s.health_score).join(", ")}`,
    );
    const line = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline",
    );
    line.setAttribute(
      "points",
      scores
        .map(
          (s, i) =>
            `${10 + (i * 400) / (scores.length - 1)},${95 - s.health_score * 0.85}`,
        )
        .join(" "),
    );
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2");
    chart.append(line);
    body.append(chart);
  }
  body.append(
    el("div", { class: "row wrap" }, [
      button(
        "Log maintenance",
        () =>
          noteDialog(
            "Log maintenance",
            `Describe the completed work on ${asset.name}. This raises its base demonstration score by up to 20 points; open report penalties remain until resolved.`,
            `/assets/${asset.id}/maintenance`,
          ),
        "button",
        "tool",
      ),
      button("Edit details", () => assetForm(asset), "button secondary"),
      button("Report an issue", () => reportForm(asset.id), "text-button"),
    ]),
  );
  body.append(
    el(
      "div",
      { style: "margin-top:20px" },
      button(
        "Archive asset",
        () => {
          openDialog(
            "Archive this asset?",
            el("div", { class: "stack" }, [
              el(
                "p",
                { class: "auth-intro" },
                `${asset.name} will be hidden from the active register. Its history stays available, and you can restore it from the archived view. Open reports must be resolved first.`,
              ),
              button(
                "Archive asset",
                () => toggleArchive(asset, true),
                "button secondary",
              ),
            ]),
          );
        },
        "text-button",
      ),
    ),
  );
  openDialog(asset.name, body);
}
async function toggleArchive(asset, archived) {
  try {
    await api(`/assets/${asset.id}/archive`, {
      method: "PATCH",
      body: { archived },
    });
    modal.close();
    state.archived = false;
    await loadWorkspace();
    toast(
      archived
        ? "Asset archived. You can restore it from the register."
        : "Asset restored.",
    );
  } catch (e) {
    toast(e.message);
  }
}
function noteDialog(title, description, endpoint) {
  const form = el("form", { class: "form" });
  form.append(el("p", { class: "hint" }, description));
  const label = el("label", {}, [
    "Work completed",
    el("textarea", {
      name: "note",
      required: "",
      minlength: "5",
      maxlength: "1000",
      placeholder: "Record what was inspected, repaired, or verified.",
    }),
  ]);
  form.append(label, el("button", { type: "submit", class: "button" }, title));
  form.onsubmit = (e) => {
    e.preventDefault();
    submit(form, async () => {
      await api(endpoint, {
        method: "POST",
        body: { note: form.elements.note.value },
      });
      modal.close();
      await loadWorkspace();
      toast("Work recorded in the activity history.");
    });
  };
  openDialog(title, form);
}
function reportForm(assetId, publicContext) {
  const available = publicContext?.assets || state.assets;
  const form = el("form", { class: "form" });
  form.innerHTML = `<label>Asset<select name="asset_id" required><option value="">Choose a bridge, road, or flyover</option></select></label><label>What needs attention?<textarea name="description" required minlength="1" maxlength="2000" placeholder="Describe what you observed and where on the asset it is located."></textarea></label><label>Observed priority<select name="severity"><option value="5">Low — routine issue</option><option value="10" selected>Medium — needs review</option><option value="15">High — urgent review requested</option></select></label><label>Photo evidence <span class="muted small">Optional · JPEG, PNG, WebP · max 3 MB</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="hint">Photo metadata is removed before storage. Do not include personal details. This demo does not notify emergency or municipal services.</p><button class="button" type="submit">Submit report ${icon("arrow")}</button>`;
  for (const asset of available)
    form.elements.asset_id.append(
      el("option", { value: asset.id }, asset.name),
    );
  if (assetId) form.elements.asset_id.value = assetId;
  form.onsubmit = (event) => {
    event.preventDefault();
    submit(form, async () => {
      const data = new FormData(form),
        file = form.elements.file.files[0];
      if (!file) data.delete("file");
      else if (file.size > 3 * 1024 * 1024)
        throw new Error("Choose an image smaller than 3 MB.");
      const report = await api(
        publicContext ? `/public/${publicContext.token}/reports` : "/reports",
        { method: "POST", body: data },
      );
      if (!publicContext) {
        modal.close();
        await loadWorkspace();
      }
      const result = el("div", { class: "stack" }, [
        badge("Report received"),
        el(
          "p",
          { class: "auth-intro" },
          "Your report is saved and awaiting review. Keep this private tracking link to check its status.",
        ),
        linkBox(`${location.origin}/track/${report.tracking_code}`),
        el(
          "a",
          {
            href: `/track/${report.tracking_code}`,
            class: "button secondary",
            target: "_blank",
            rel: "noopener",
          },
          "View report status",
        ),
      ]);
      if (publicContext) {
        $("#public-form").replaceChildren(result);
      } else openDialog("Report submitted", result);
    });
  };
  if (publicContext) return form;
  if (!available.length) {
    toast("Register an asset before submitting a report.");
    return;
  }
  openDialog("Report an issue", form);
}
function reportsView() {
  const content = $("#content");
  content.append(
    heading(
      "Incident reports",
      "Track observations from submission through to documented resolution.",
      [
        button(
          "Share reporting link",
          shareReporting,
          "button secondary",
          "share",
        ),
        button("Submit report", () => reportForm(), "button", "plus"),
      ],
    ),
  );
  const tabs = el("div", {
    class: "tabs",
    "aria-label": "Report status filters",
  });
  for (const [value, label] of [
    ["Open", "Open reports"],
    ["Resolved", "Resolved"],
    ["", "All history"],
  ])
    tabs.append(
      button(
        label,
        () => {
          state.reportFilter = value;
          renderShell();
        },
        state.reportFilter === value ? "active" : "",
      ),
    );
  content.append(el("div", { class: "toolbar" }, tabs));
  const items = state.reports.filter(
      (r) => !state.reportFilter || r.status === state.reportFilter,
    ),
    grid = el("div", { class: "report-grid" });
  for (const r of items) {
    const card = el("article", { class: "report-card" }, [
      el("div", { class: "row between" }, [
        el(
          "span",
          { class: "small muted" },
          `REPORT #${r.id} · ${date(r.created_at)}`,
        ),
        badge(
          r.status === "Resolved" ? "Resolved" : severityName(r.severity),
          r.status === "Resolved"
            ? ""
            : r.severity === 15
              ? "emergency"
              : r.severity === 10
                ? "high"
                : "",
        ),
      ]),
      el("h3", {}, r.asset_name),
      el("p", {}, r.description),
      r.resolution_note
        ? el("div", { class: "resolution" }, [
            el("strong", {}, "Resolution: "),
            r.resolution_note,
          ])
        : null,
      el("div", { class: "report-bottom" }, [
        button(
          r.has_image ? "View details & photo" : "View details",
          () => reportDetail(r),
          "text-button",
        ),
        r.status === "Open"
          ? button(
              "Resolve report",
              () => resolveDialog(r),
              "button secondary slim",
              "check",
            )
          : el("span", { class: "small muted" }, date(r.resolved_at)),
      ]),
    ]);
    grid.append(card);
  }
  content.append(
    items.length
      ? grid
      : el("div", { class: "panel empty" }, [
          el("strong", {}, "No reports in this view"),
          "Submit an observation to begin the workflow, or choose a different status filter.",
        ]),
  );
}
function resolveDialog(report) {
  noteDialog(
    "Resolve report",
    `Record the resolution of report #${report.id} for ${report.asset_name}. The report and its attachment stay in your history.`,
    `/reports/${report.id}/resolve`,
  );
}
function reportDetail(report) {
  const content = el("div", { class: "stack" }, [
    el("div", { class: "row between" }, [
      badge(report.status),
      el("span", { class: "small muted" }, date(report.created_at, true)),
    ]),
    el("strong", {}, report.asset_name),
    el(
      "p",
      {
        class: "auth-intro",
        style: "white-space:pre-wrap;overflow-wrap:anywhere",
      },
      report.description,
    ),
  ]);
  if (report.has_image)
    content.append(
      el("img", {
        class: "evidence",
        src: `/api/reports/${report.id}/image`,
        alt: `Submitted evidence for report ${report.id}`,
      }),
    );
  if (report.resolution_note)
    content.append(
      el("div", { class: "resolution" }, [
        el("strong", {}, "Resolution: "),
        report.resolution_note,
      ]),
    );
  content.append(
    el(
      "p",
      { class: "small muted" },
      `Submitter priority: ${severityName(report.severity)}. Priority is manually selected, not an image diagnosis.`,
    ),
    linkBox(`${location.origin}/track/${report.tracking_code}`),
  );
  if (report.status === "Open")
    content.append(
      button("Resolve report", () => resolveDialog(report), "button", "check"),
    );
  openDialog(`Report #${report.id}`, content);
}
function linkBox(url) {
  const input = el("input", {
    value: url,
    readonly: "",
    "aria-label": "Shareable link",
  });
  return el("div", { class: "link-field" }, [
    input,
    button(
      "Copy link",
      async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast("Link copied.");
        } catch {
          input.select();
          toast("Select and copy the link from this field.");
        }
      },
      "button secondary slim",
    ),
  ]);
}
function shareReporting() {
  openDialog(
    "Community reporting link",
    el("div", { class: "stack" }, [
      el(
        "p",
        { class: "auth-intro" },
        "Anyone with this link can see your active asset names and submit a report. They cannot see your dashboard, report history, or account details.",
      ),
      linkBox(`${location.origin}/report/${state.account.share_token}`),
      el(
        "a",
        {
          class: "button secondary",
          href: `/report/${state.account.share_token}`,
          target: "_blank",
          rel: "noopener",
        },
        "Open reporting page ↗",
      ),
    ]),
  );
}
function activityView() {
  const content = $("#content");
  content.append(
    heading(
      "Activity log",
      "A persistent record of registrations, reports, maintenance, and scenarios.",
      [button("Refresh", loadWorkspace, "button secondary", "clock")],
    ),
  );
  const section = panel("Workspace timeline", "The 100 most recent events"),
    list = el("div", { class: "activity-list" });
  for (const a of state.activity)
    list.append(
      el("article", { class: "activity-item" }, [
        el(
          "div",
          { class: "activity-icon" },
          symbol(
            {
              report: "reports",
              resolution: "check",
              maintenance: "tool",
              scenario: "warning",
              asset: "bridge",
            }[a.kind] || "grid",
          ),
        ),
        el("div", {}, [
          el("p", {}, a.message),
          el("time", { datetime: a.created_at }, date(a.created_at, true)),
        ]),
        a.health_score != null
          ? badge(`${a.health_score.toFixed(1)} health`, "neutral")
          : null,
      ]),
    );
  section.append(
    state.activity.length
      ? list
      : el("div", { class: "empty" }, "Workspace events will appear here."),
  );
  content.append(section);
}
async function publicReportPage(token) {
  root.replaceChildren(
    el("main", { class: "public-page", id: "main" }, [
      brand(),
      el(
        "div",
        { class: "panel", id: "public-form" },
        el("p", {}, "Loading reporting form…"),
      ),
    ]),
  );
  try {
    const data = await api(`/public/${encodeURIComponent(token)}/assets`),
      panel = $("#public-form");
    panel.replaceChildren(
      el("span", { class: "eyebrow" }, data.workspace),
      el("h1", { style: "margin-top:15px" }, "Report an observation"),
      el(
        "p",
        { class: "auth-intro" },
        "Share an issue with this workspace. You’ll receive a private tracking link after submission.",
      ),
      el(
        "div",
        { class: "notice" },
        "Portfolio demonstration only. This form does not contact authorities or emergency services.",
      ),
    );
    panel.append(
      data.assets.length
        ? reportForm(null, { token, assets: data.assets })
        : el(
            "div",
            { class: "empty" },
            "There are no active assets available for reporting.",
          ),
    );
  } catch (e) {
    $("#public-form").replaceChildren(
      el("h1", {}, "Reporting link unavailable"),
      el("p", { class: "auth-intro" }, e.message),
      el("a", { href: "/", class: "button secondary" }, "Back to StructIQ"),
    );
  }
}
async function trackingPage(code) {
  root.replaceChildren(
    el("main", { class: "public-page", id: "main" }, [
      brand(),
      el(
        "section",
        { class: "panel", id: "tracking" },
        el("p", {}, "Loading report status…"),
      ),
    ]),
  );
  try {
    const r = await api(`/track/${encodeURIComponent(code)}`);
    $("#tracking").replaceChildren(
      el("span", { class: "eyebrow" }, "Report status"),
      el("h1", { style: "margin-top:14px" }, `Report #${r.id}`),
      el("p", { class: "auth-intro" }, r.asset_name),
      badge(r.status),
      el("div", { class: "tracking-result" }, [
        el("p", { class: "small" }, `Submitted ${date(r.created_at, true)}`),
        el(
          "p",
          { class: "small" },
          r.resolved_at
            ? `Resolved ${date(r.resolved_at, true)}`
            : "Your report is saved and awaiting review by the workspace owner.",
        ),
      ]),
      el(
        "p",
        { class: "notice" },
        "This is a portfolio demonstration. Report status does not confirm real-world inspection, repair, or safety.",
      ),
      button(
        "Refresh status",
        () => trackingPage(code),
        "button secondary",
        "clock",
      ),
    );
  } catch (e) {
    $("#tracking").replaceChildren(
      el("h1", {}, "Report unavailable"),
      el("p", { class: "auth-intro" }, e.message),
      el("a", { href: "/", class: "button secondary" }, "Back to StructIQ"),
    );
  }
}
async function route() {
  const path = location.pathname;
  if (path.startsWith("/report/")) return publicReportPage(path.split("/")[2]);
  if (path.startsWith("/track/")) return trackingPage(path.split("/")[2]);
  try {
    state.account = await api("/auth/me");
  } catch {
    state.account = null;
  }
  if (path === "/app" && state.account) return loadWorkspace();
  landing();
  if (path === "/app") authDialog();
}
window.addEventListener("popstate", route);
route();
