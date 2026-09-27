"use strict";

/* =====================================================================
   Açılış: kenar çubuğu, sayfa yolları, tema, periyodik yenileme,
   motor kapalı ekranı, genel tıklamalar ve klavye kısayolları.
   ===================================================================== */

const NAV = [
  { id: "apps", path: "/uygulamalar", icon: "grid", label: () => T("app", true), key: "1", group: "Yönet" },
  { id: "containers", path: "/parcalar", icon: "box", label: () => T("container", true), key: "2", group: "Yönet" },
  { id: "images", path: "/kaliplar", icon: "layers", label: () => T("image", true), key: "3", group: "Yönet" },
  { id: "volumes", path: "/kutular", icon: "drive", label: () => T("volume", true), key: "4", group: "Yönet" },
  { id: "networks", path: "/aglar", icon: "network", label: () => T("network", true), key: "5", group: "Yönet" },
  { id: "ports", path: "/kapilar", icon: "plug", label: () => T("port", true), key: "6", group: "Araçlar" },
  { id: "cleanup", path: "/temizlik", icon: "sparkles", label: () => T("cleanup"), key: "7", group: "Araçlar" },
  { id: "activity", path: "/etkinlik", icon: "activity", label: () => "Etkinlik", key: "8", group: "Araçlar" },
  { id: "system", path: "/sistem", icon: "server", label: () => "Sistem ve ayarlar", key: "9", group: null },
];

Router.add("/uygulamalar", AppsView, "apps");
Router.add("/uygulama/:key", AppView, "apps");
Router.add("/uygulama/:key/:tab", AppView, "apps");
Router.add("/parcalar", ContainersView, "containers");
Router.add("/parca/:id", ContainerView, "containers");
Router.add("/parca/:id/:tab", ContainerView, "containers");
Router.add("/kaliplar", ImagesView, "images");
Router.add("/kutular", VolumesView, "volumes");
Router.add("/kutular/:tab", VolumesView, "volumes");
Router.add("/aglar", NetworksView, "networks");
Router.add("/kapilar", PortsView, "ports");
Router.add("/temizlik", CleanupView, "cleanup");
Router.add("/etkinlik", ActivityView, "activity");
Router.add("/sistem", SystemView, "system");

let activeNav = "apps";
bus.on("route", (nav) => { activeNav = nav; renderSidebar(); document.body.classList.remove("sb-open"); });

// ---------- Tema ---------------------------------------------------------------
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = S.prefs.tema || "sistem";
  const dark = t === "koyu" || (t === "sistem" && darkMQ.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("sb-narrow", !!S.prefs.kenar_dar);
}
darkMQ.addEventListener?.("change", applyTheme);

// ---------- Kenar çubuğu ---------------------------------------------------------
function navBadge(id) {
  if (!S.data?.docker?.ok) return "";
  const real = apps().filter((a) => a.source !== "system");
  if (id === "apps") {
    const bad = real.filter((a) => a.state === "problem").length;
    return bad ? html`<span class="sb-badge err" title="${bad} sorunlu uygulama">${bad}</span>` : html`<span class="sb-count">${real.length}</span>`;
  }
  if (id === "containers") {
    const all = allContainers().filter((c) => c.app.source !== "system");
    return html`<span class="sb-count" title="Çalışan / toplam">${all.filter((c) => c.running).length}/${all.length}</span>`;
  }
  if (id === "ports" && S.badges.conflicts) return html`<span class="sb-badge warn" title="Kapı çakışması">${S.badges.conflicts}</span>`;
  if (id === "cleanup" && S.badges.reclaim > 1e9) return html`<span class="sb-count" title="Güvenle boşaltılabilir">${fmt.bytes(S.badges.reclaim, 0)}</span>`;
  return "";
}

function renderSidebar() {
  const groups = [];
  for (const n of NAV.filter((x) => x.group)) {
    let g = groups.find((x) => x.name === n.group);
    if (!g) groups.push(g = { name: n.group, items: [] });
    g.items.push(n);
  }
  const item = (n) => html`
    <a class="sb-item ${activeNav === n.id ? "active" : ""}" href="#${n.path}" ${activeNav === n.id ? raw('aria-current="page"') : ""} title="${n.label()} (⌘${n.key})">
      ${icon(n.icon)}<span class="sb-label">${n.label()}</span>${navBadge(n.id)}
    </a>`;
  const sets = S.data?.sets || [];
  patch($("#sb-nav"), html`
    ${groups.map((g) => html`<div class="sb-group"><div class="sb-group-title">${g.name}</div>${g.items.map(item)}</div>`)}
    <div class="sb-group">
      <div class="sb-group-title">Çalışma setleri
        <button class="icon-btn xs sb-add" data-new-set aria-label="Yeni set" title="Yeni çalışma seti">${icon("plus")}</button>
      </div>
      ${sets.length ? sets.map((s) => {
        const members = s.apps.map(findApp).filter(Boolean);
        const on = members.filter((a) => a.running > 0).length;
        const lvl = !members.length ? "off" : on === members.length ? "ok" : on ? "warn" : "off";
        const busy = [...S.jobs.values()].some((j) => j.status === "calisiyor" && j.title.startsWith(s.name + " seti"));
        return html`
          <div class="sb-set" title="${members.map((a) => a.name).join(", ")}">
            <button class="sb-set-name" data-edit-set="${s.id}">${dot(lvl)}<span class="sb-label">${s.name}</span><span class="sb-count">${on}/${members.length}</span></button>
            ${busy ? html`<span class="spinner sm"></span>` : on < members.length
              ? html`<button class="icon-btn xs go" data-run-set="${s.id}" data-act="baslat" aria-label="${s.name} setini başlat" title="Hepsini başlat">${icon("play")}</button>`
              : html`<button class="icon-btn xs" data-run-set="${s.id}" data-act="durdur" aria-label="${s.name} setini durdur" title="Hepsini durdur">${icon("stop")}</button>`}
          </div>`;
      }) : html`<button class="sb-empty-set" data-new-set>${icon("rocket")}<span class="sb-label">Birlikte açtığın uygulamaları grupla</span></button>`}
    </div>`);

  const d = S.data;
  const running = [...S.jobs.values()].filter((j) => j.status === "calisiyor");
  const engine = d?.platform?.engine_name || "Docker";
  const state = S.offline ? ["err", "Bağlantı yok"] : !d ? ["off", "Bağlanıyor…"] : d.docker.ok ? ["ok", "Çalışıyor"] : d.docker.reason === "yok" ? ["err", "Yüklü değil"] : ["err", "Kapalı"];
  patch($("#sb-foot"), html`
    ${running.length ? html`<button class="sb-jobs" data-jobs>${raw('<span class="spinner sm"></span>')}<span class="sb-label">${running.length} işlem sürüyor</span></button>` : ""}
    <a class="sb-engine ${activeNav === "system" ? "active" : ""}" href="#/sistem" title="Sistem ve ayarlar (⌘9)">
      <span class="sb-engine-icon">${icon("server")}${dot(state[0])}</span>
      <span class="sb-label"><b>${engine}</b><small>${state[1]}</small></span>
      ${icon("sliders", "sb-engine-go")}
    </a>`);
}

// ---------- Motor kapalı / bağlantı yok ekranı ------------------------------------
function renderEngineState() {
  const d = S.data;
  const screen = $("#engine-screen");
  let content = "";
  if (S.offline) {
    content = emptyState({ icon: "plug", title: "Arka taraf yanıt vermiyor", text: "Basic Docker'ın Python tarafına ulaşılamadı. Uygulamayı kapatıp yeniden açmayı dene." });
  } else if (d && !d.docker.ok) {
    const kind = d.platform?.engine;
    content = d.docker.reason === "yok"
      ? emptyState({
        icon: "download", title: "Docker yüklü değil",
        text: "Bu uygulama Docker'ı yönetir. Önce bir Docker motoru kurman gerekiyor: Mac için en hafifi OrbStack, en bilineni Docker Desktop. Kurduktan sonra bu sayfa kendiliğinden yenilenir.",
        action: html`<a class="btn primary" href="https://orbstack.dev" target="_blank" rel="noopener">${icon("download")}OrbStack'i indir</a>
          <a class="btn" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">${icon("download")}Docker Desktop'ı indir</a>`,
      })
      : emptyState({
        icon: "power", title: `${d.platform?.engine_name || "Docker"} kapalı`,
        text: "Parçaları çalıştırmak için önce Docker motorunun açık olması gerekiyor. Aşağıdaki tuşa bas; açılınca bu sayfa kendiliğinden yenilenir.",
        action: html`<button class="btn primary lg" data-global="docker-ac">${icon("power")}${engineOpenLabel(kind)}</button>`,
      });
  }
  const down = !!content;
  document.body.classList.toggle("engine-down", down);
  screen.hidden = !down;
  patch(screen, content);
}

// ---------- Yenileme ----------------------------------------------------------------
let _pollTimer = null;
let _booted = false;
async function refresh() {
  clearTimeout(_pollTimer);
  const wasDown = !S.data?.docker?.ok;
  try {
    const data = await api("/api/durum");
    S.data = data;
    S.offline = false;
    if (!_booted) {
      S.prefs = { ...(data.ui || {}) };
      applyTheme();
    }
    mergeJobs(data.jobs || []);
  } catch {
    S.offline = true;
  }
  renderEngineState();
  renderSidebar();
  renderToasts();
  bus.emit("data");
  if (!_booted) { _booted = true; Router.render(); refreshBadges(); }
  else if (wasDown && S.data?.docker?.ok) { Router.current?.view.unmount?.(); Router.current = null; Router.render(); }
  const busy = [...S.jobs.values()].some((j) => j.status === "calisiyor");
  _pollTimer = setTimeout(refresh, document.hidden ? 12000 : busy ? 1000 : 3000);
}

async function refreshBadges() {
  if (!S.data?.docker?.ok) return;
  try { S.badges.conflicts = (await api("/api/kapilar")).conflicts.length; } catch { /* yok say */ }
  try { const p = (await api("/api/temizlik")).plan; S.badges.reclaim = p.cache.size + p.dangling.size; } catch { /* yok say */ }
  renderSidebar();
  bus.emit("badges");
}
setInterval(refreshBadges, 120000);
bus.on("badges", renderSidebar);
bus.on("job-done", () => setTimeout(refreshBadges, 1500));
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

// ---------- Genel tıklamalar ---------------------------------------------------------
document.addEventListener("click", async (e) => {
  const t = e.target;
  const g = t.closest("[data-global]");
  if (g) {
    const a = g.dataset.global;
    if (a === "yeni") openNew();
    if (a === "help") openHelp();
    if (a === "palette") Palette.open();
    if (a === "docker-ac") {
      try { flash((await api("/api/docker-ac", {})).mesaj); } catch (err) { flash(err.message, true); }
    }
    return;
  }
  const job = t.closest("[data-job]");
  if (job) return openJob(job.dataset.job);
  const ct = t.closest("[data-close-toast]");
  if (ct) { S.closedToasts.add(ct.dataset.closeToast); S.jobs.delete(ct.dataset.closeToast); return renderToasts(); }
  const cp = t.closest("[data-copy]");
  if (cp && cp.dataset.copy) return copyText(cp.dataset.copy);
  if (t.closest("[data-jobs]")) return openJobsList(t.closest("[data-jobs]"));
  if (t.closest("[data-new-set]")) return openSetEditor();
  const es = t.closest("[data-edit-set]");
  if (es) return openSetEditor((S.data?.sets || []).find((s) => s.id === es.dataset.editSet));
  const rs = t.closest("[data-run-set]");
  if (rs) return runJob("/api/set/calistir", { id: rs.dataset.runSet, islem: rs.dataset.act });
  if (t.closest("[data-sb-toggle]")) return document.body.classList.toggle("sb-open");
  if (t.closest("#sb-scrim")) return document.body.classList.remove("sb-open");
});

// Dış bağlantılar tarayıcıda açılsın (pencere içinde değil).
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || !/^https?:/.test(a.getAttribute("href"))) return;
  e.preventDefault();
  e.stopPropagation();
  api("/api/link-ac", { url: a.href }).catch((err) => flash(err.message, true));
}, true);

// ---------- Pencere (modal) olayları ---------------------------------------------------
Modal.el = $("#modal");
Modal.el.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) { Modal.close(); return; }
  if (e.target === Modal.el && Modal.el.dataset.dismissable) Modal.close();
});
Modal.el.addEventListener("close", () => {
  if (Modal.cleanup) { try { Modal.cleanup(); } catch { /* yok say */ } }
  Modal.cleanup = null;
  if (Modal.resolve) { const r = Modal.resolve; Modal.resolve = null; r(null); }
});

// ---------- Klavye kısayolları ----------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && !e.metaKey && e.target.closest?.(".xterm")) return;
  const mod = e.metaKey || e.ctrlKey;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); Palette.el?.open ? Palette.close() : Palette.open(); return; }
  if (Modal.el.open || Palette.el?.open) return;
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); openNew(); return; }
  if (mod && /^[1-9]$/.test(e.key)) {
    const n = NAV.find((x) => x.key === e.key);
    if (n) { e.preventDefault(); Router.go(n.path); }
    return;
  }
  if (mod && e.key === "[") { e.preventDefault(); history.back(); return; }
  if (mod && e.key === "]") { e.preventDefault(); history.forward(); return; }
  if (e.key === "Escape" && Menu.el) { Menu.close(); return; }
  if (!typing && e.key === "/") {
    const s = $("#main input[type=search]");
    if (s) { e.preventDefault(); s.focus(); s.select(); }
  }
});

window.addEventListener("hashchange", () => Router.render());

// ---------- Başlat ----------------------------------------------------------------------
applyTheme();
renderSidebar();
if (window.pywebview?.api) refresh();
else window.addEventListener("pywebviewready", refresh, { once: true });
