"use strict";

/* =====================================================================
   Açılış: kenar çubuğu, sayfa yolları, tema, periyodik yenileme,
   motor kapalı ekranı, genel tıklamalar ve klavye kısayolları.
   ===================================================================== */

const NAV = [
  { id: "apps", path: "/uygulamalar", icon: "grid", label: () => T("app", true), key: "1", group: "manage" },
  { id: "containers", path: "/parcalar", icon: "box", label: () => T("container", true), key: "2", group: "manage" },
  { id: "images", path: "/kaliplar", icon: "layers", label: () => T("image", true), key: "3", group: "manage" },
  { id: "volumes", path: "/kutular", icon: "drive", label: () => T("volume", true), key: "4", group: "manage" },
  { id: "networks", path: "/aglar", icon: "network", label: () => T("network", true), key: "5", group: "manage" },
  { id: "ports", path: "/kapilar", icon: "plug", label: () => T("port", true), key: "6", group: "tools" },
  { id: "cleanup", path: "/temizlik", icon: "sparkles", label: () => T("cleanup"), key: "7", group: "tools" },
  { id: "activity", path: "/etkinlik", icon: "activity", label: () => L("Etkinlik", "Activity"), key: "8", group: "tools" },
  { id: "system", path: "/sistem", icon: "server", label: () => L("Sistem ve ayarlar", "System & settings"), key: "9", group: null },
];
const NAV_GROUPS = { manage: ["Yönet", "Manage"], tools: ["Araçlar", "Tools"] };

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
bus.on("route", (nav) => { activeNav = nav; renderSidebar(); renderEngineState(); document.body.classList.remove("sb-open"); });

// ---------- Tema ---------------------------------------------------------------
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = S.prefs.tema || "sistem";
  const dark = t === "koyu" || (t === "sistem" && darkMQ.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("sb-narrow", !!S.prefs.kenar_dar);
}
darkMQ.addEventListener?.("change", applyTheme);

// ---------- Dil ---------------------------------------------------------------------
// index.html'deki sabit yazılar: [seçici, özellik, Türkçe, İngilizce]
const STATIC_TEXT = [
  [".skip-link", "text", "İçeriğe geç", "Skip to content"],
  ["[data-sb-toggle]", "aria-label", "Menüyü aç", "Open menu"],
  [".mobile-bar [data-global=palette]", "aria-label", "Ara (⌘K)", "Search (⌘K)"],
  ["#sidebar", "aria-label", "Ana menü", "Main menu"],
  [".brand-text small", "text", "Docker'ı sade yönet", "Docker, made simple"],
  [".sb-search", "title", "Her yerde ara (⌘K)", "Search anywhere (⌘K)"],
  [".sb-search .sb-label:not(.kbd-group)", "text", "Her yerde ara", "Search"],
];
function applyLanguage() {
  document.documentElement.lang = isEN() ? "en" : "tr";
  for (const [sel, attr, tr, en] of STATIC_TEXT) {
    const el = $(sel);
    if (!el) continue;
    if (attr === "text") el.textContent = modText(L(tr, en));
    else el.setAttribute(attr, modText(L(tr, en)));
  }
  const cmd = $(".sb-search .kbd-group kbd");
  if (cmd) cmd.textContent = modText("⌘").replace("+", "");
}

async function setLanguage(lang) {
  lang = lang === "en" ? "en" : "tr";
  if ((isEN() ? "en" : "tr") === lang) return;
  S.prefs.lang = lang;
  S.catalog = null;
  applyLanguage();
  await api("/api/ayarlar/kaydet", { lang }).catch(() => {});
  _gen++;  // eski dildeki cevaplar geri gelmesin
  await refresh(); // arka taraftaki yazılar (durum, rol adları) yeni dilde gelsin
  Router.current?.view.unmount?.();
  Router.current = null;
  Router.render();
  refreshBadges();
}

// ---------- Kenar çubuğu ---------------------------------------------------------
function navBadge(id) {
  if (!S.data?.docker?.ok) return "";
  const real = apps().filter((a) => a.source !== "system");
  if (id === "apps") {
    const bad = real.filter((a) => a.state === "problem").length;
    return bad ? html`<span class="sb-badge err" title="${L(`${bad} sorunlu uygulama`, plural(bad, "app") + " with problems")}">${bad}</span>` : html`<span class="sb-count">${real.length}</span>`;
  }
  if (id === "containers") {
    const all = allContainers().filter((c) => c.app.source !== "system");
    return html`<span class="sb-count" title="${L("Çalışan / toplam", "Running / total")}">${all.filter((c) => c.running).length}/${all.length}</span>`;
  }
  if (id === "ports" && S.badges.conflicts) return html`<span class="sb-badge warn" title="${L("Kapı çakışması", "Port conflict")}">${S.badges.conflicts}</span>`;
  if (id === "cleanup" && S.badges.reclaim > 1e9) return html`<span class="sb-count" title="${L("Güvenle boşaltılabilir", "Safe to free")}">${fmt.bytes(S.badges.reclaim, 0)}</span>`;
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
    <a class="sb-item ${activeNav === n.id ? "active" : ""}" href="#${n.path}" ${activeNav === n.id ? raw('aria-current="page"') : ""} title="${n.label()} (${modText(`⌘${n.key}`)})">
      ${icon(n.icon)}<span class="sb-label">${n.label()}</span>${navBadge(n.id)}
    </a>`;
  const sets = S.data?.sets || [];
  // Makineler: Bu Mac + eklenen uzak sunucular. Tıklayınca o makineye geçilir (sadece uygulama için).
  const onRemote = !!S.data?.platform?.remote;
  const machineDot = S.offline ? "err" : S.data?.docker?.ok ? "ok" : "err";
  const machine = ({ id, label, sub, ic, current }) => html`
    <button class="sb-item sb-machine ${current ? "current" : ""}" data-machine="${id}" title="${sub}${current ? L(" · şu an burada", " · you are here") : L(" · geçmek için tıkla", " · click to switch")}" ${current ? raw('aria-current="true"') : ""}>
      ${icon(ic)}<span class="sb-label">${label}</span>${current ? dot(machineDot) : ""}
    </button>`;
  const machinesGroup = html`
    <div class="sb-group sb-machines">
      <div class="sb-group-title">${L("Makineler", "Machines")}<span class="sb-title-actions">
        <button class="icon-btn xs sb-add" data-global="sunucu-ekle" aria-label="${L("Sunucu ekle", "Add server")}" title="${L("Sunucu ekle", "Add server")}">${icon("plus")}</button>
        ${(S.data?.makineler || []).length ? html`<a class="icon-btn xs sb-add" href="#/sistem" aria-label="${L("Bağlantıları yönet", "Manage connections")}" title="${L("Bağlantıları yönet", "Manage connections")}">${icon("sliders")}</a>` : ""}
      </span></div>
      ${machine({ id: "", label: L(here("", true), hereEn(true)), sub: L(`${here("teki", true)} Docker`, `Docker on ${hereEn()}`), ic: "frontend", current: !onRemote })}
      ${(S.data?.makineler || []).map((mc) => machine({ id: mc.name, label: mc.desc || mc.name, sub: `${mc.name} · ${mc.host || mc.kind}`, ic: "globe", current: mc.current }))}
    </div>`;
  patch($("#sb-nav"), html`
    ${machinesGroup}
    ${groups.map((g) => html`<div class="sb-group"><div class="sb-group-title">${L(...NAV_GROUPS[g.name])}</div>${g.items.map(item)}</div>`)}
    <div class="sb-group">
      <div class="sb-group-title">${L("Çalışma setleri", "Work sets")}
        <button class="icon-btn xs sb-add" data-new-set aria-label="${L("Yeni set", "New set")}" title="${L("Yeni çalışma seti", "New work set")}">${icon("plus")}</button>
      </div>
      ${sets.length ? sets.map((s) => {
        const members = s.apps.map(findApp).filter(Boolean);
        const on = members.filter((a) => a.running > 0).length;
        const lvl = !members.length ? "off" : on === members.length ? "ok" : on ? "warn" : "off";
        const busy = [...S.jobs.values()].some((j) => j.status === "calisiyor" && j.title.startsWith(s.name + " set"));
        return html`
          <div class="sb-set" title="${members.map((a) => a.name).join(", ")}">
            <button class="sb-set-name" data-edit-set="${s.id}">${dot(lvl)}<span class="sb-label">${s.name}</span><span class="sb-count">${on}/${members.length}</span></button>
            ${busy ? html`<span class="spinner sm"></span>` : on < members.length
              ? html`<button class="icon-btn xs go" data-run-set="${s.id}" data-act="baslat" aria-label="${L(`${s.name} setini başlat`, `Start the ${s.name} set`)}" title="${L("Hepsini başlat", "Start all")}">${icon("play")}</button>`
              : html`<button class="icon-btn xs" data-run-set="${s.id}" data-act="durdur" aria-label="${L(`${s.name} setini durdur`, `Stop the ${s.name} set`)}" title="${L("Hepsini durdur", "Stop all")}">${icon("stop")}</button>`}
          </div>`;
      }) : html`<button class="sb-empty-set" data-new-set>${icon("rocket")}<span class="sb-label">${L("Birlikte açtığın uygulamaları grupla", "Group apps you start together")}</span></button>`}
    </div>`);

  const d = S.data;
  const running = [...S.jobs.values()].filter((j) => j.status === "calisiyor");
  const engine = d?.platform?.engine_name || "Docker";
  const state = S.offline ? ["err", L("Bağlantı yok", "No connection")] : !d ? ["off", L("Bağlanıyor…", "Connecting…")] : d.docker.ok ? ["ok", L("Çalışıyor", "Running")]
    : d.docker.reason === "yok" ? ["err", L("Yüklü değil", "Not installed")] : ["err", L("Kapalı", "Stopped")];
  patch($("#sb-foot"), html`
    ${running.length ? html`<button class="sb-jobs" data-jobs>${raw('<span class="spinner sm"></span>')}<span class="sb-label">${L(`${running.length} işlem sürüyor`, `${plural(running.length, "task")} running`)}</span></button>` : ""}
    <a class="sb-engine ${activeNav === "system" ? "active" : ""}" href="#/sistem" title="${L("Sistem ve ayarlar", "System & settings")} (${modText("⌘9")})">
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
    content = emptyState({
      icon: "plug", title: L("Arka taraf yanıt vermiyor", "The backend isn't responding"),
      text: L("Basic Docker'ın Python tarafına ulaşılamadı. Uygulamayı kapatıp yeniden açmayı dene.", "Couldn't reach Basic Docker's Python side. Try quitting and reopening the app."),
    });
  } else if (d && !d.docker.ok && d.platform?.remote) {
    const r = d.platform.remote;
    content = emptyState({
      icon: "server", title: L(`${r.context || r.host} sunucusuna ulaşılamıyor`, `Can't reach ${r.context || r.host}`),
      text: L(`Uzak Docker (${r.host}) yanıt vermiyor. İnternet ya da VPN bağlantını ve sunucunun açık olduğunu kontrol et. Bu arada ${here("teki")} Docker'a dönebilirsin.`,
        `The remote Docker (${r.host}) isn't responding. Check your internet or VPN connection and that the server is up. Meanwhile you can switch back to the Docker on ${hereEn()}.`),
      action: html`<button class="btn" data-global="retry-engine">${icon("refresh")}${L("Tekrar dene", "Try again")}</button>
        <button class="btn primary" data-global="use-local">${icon("server")}${engineOpenLabel("remote")}</button>`,
    });
  } else if (d && !d.docker.ok) {
    const kind = d.platform?.engine;
    content = d.docker.reason === "yok"
      ? emptyState({
        icon: "download", title: L("Docker yüklü değil", "Docker isn't installed"),
        text: onMac()
          ? L("Bu uygulama Docker'ı yönetir. Önce bir Docker motoru kurman gerekiyor: Mac için en hafifi OrbStack, en bilineni Docker Desktop. Kurduktan sonra bu sayfa kendiliğinden yenilenir.",
            "This app manages Docker, so you need a Docker engine first: OrbStack is the lightest on a Mac, Docker Desktop the best known. This page refreshes by itself once it's installed.")
          : onWin()
            ? L("Bu uygulama Docker'ı yönetir. Önce Docker Desktop'ı kurman gerekiyor. Kurduktan sonra bu sayfa kendiliğinden yenilenir.",
              "This app manages Docker, so you need Docker Desktop first. This page refreshes by itself once it's installed.")
            : L("Bu uygulama Docker'ı yönetir. Önce Docker'ı kurman gerekiyor (Docker Engine ya da Docker Desktop). Kurduktan sonra bu sayfa kendiliğinden yenilenir.",
              "This app manages Docker, so you need to install Docker first (Docker Engine or Docker Desktop). This page refreshes by itself once it's installed."),
        action: onMac()
          ? html`<a class="btn primary" href="https://orbstack.dev" target="_blank" rel="noopener">${icon("download")}${L("OrbStack'i indir", "Download OrbStack")}</a>
            <a class="btn" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">${icon("download")}${L("Docker Desktop'ı indir", "Download Docker Desktop")}</a>`
          : onWin()
            ? html`<a class="btn primary" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">${icon("download")}${L("Docker Desktop'ı indir", "Download Docker Desktop")}</a>`
            : html`<a class="btn primary" href="https://docs.docker.com/engine/install/" target="_blank" rel="noopener">${icon("download")}${L("Kurulum rehberi", "Install guide")}</a>`,
      })
      : emptyState({
        icon: "power", title: L(`${d.platform?.engine_name || "Docker"} kapalı`, `${d.platform?.engine_name || "Docker"} is not running`),
        text: L("Parçaları çalıştırmak için önce Docker motorunun açık olması gerekiyor. Aşağıdaki tuşa bas; açılınca bu sayfa kendiliğinden yenilenir.",
          "The Docker engine has to be running before containers can run. Press the button below; this page refreshes by itself once it's up."),
        action: html`<button class="btn primary lg" data-global="docker-ac">${icon("power")}${engineOpenLabel(kind)}</button>`,
      });
  }
  // Sistem sayfası motor kapalıyken de açılabilsin: dil, bağlantılar, tam kontrol oradan değiştirilir.
  const down = !!content && activeNav !== "system";
  document.body.classList.toggle("engine-down", down);
  screen.hidden = !down;
  patch(screen, content);
}

// ---------- Yenileme ----------------------------------------------------------------
let _pollTimer = null;
let _booted = false;
let _prefsLoaded = false;
// Bağlam ya da dil değişince artar. Köprü çağrıları paralel çalıştığı için eski bir isteğin cevabı sonradan
// gelebilir (ör. ulaşılamayan sunucuda 15 sn bekleyen /api/durum); böyle cevaplar yok sayılır.
let _gen = 0;
async function refresh() {
  clearTimeout(_pollTimer);
  const gen = _gen;
  const wasDown = !S.data?.docker?.ok;
  try {
    const data = await api("/api/durum");
    if (gen !== _gen) return;  // bu arada başka sunucuya/dile geçildi; yenisi kendi zamanlayıcısını kurar
    S.data = data;
    S.offline = false;
    // Tercihler ilk başarılı cevapla yüklenir. Pencere açılırken köprü henüz hazır değilse ilk çağrı boşa gider;
    // o durumda sayfa varsayılanlarla çizilmiş olur, tercihler gelince (dil, tema) yeniden çizilir.
    if (!_prefsLoaded) {
      _prefsLoaded = true;
      S.prefs = { ...(data.ui || {}) };
      applyTheme();
      applyLanguage();
      if (_booted) { Router.current?.view.unmount?.(); Router.current = null; Router.render(); }
    }
    mergeJobs(data.jobs || []);
  } catch {
    if (gen !== _gen) return;
    S.offline = true;
  }
  renderRemoteBanner();
  renderEngineState();
  renderSidebar();
  renderToasts();
  bus.emit("data");
  if (!_booted) { _booted = true; Router.render(); refreshBadges(); }
  else if (wasDown && S.data?.docker?.ok) { Router.current?.view.unmount?.(); Router.current = null; Router.render(); }
  const busy = [...S.jobs.values()].some((j) => j.status === "calisiyor");
  clearTimeout(_pollTimer);  // aynı anda iki yenileme bittiyse iki zamanlayıcı kalmasın
  _pollTimer = setTimeout(refresh, !_prefsLoaded ? 400 : document.hidden ? 12000 : busy ? 1000 : 3000);
}

async function refreshBadges() {
  if (!S.data?.docker?.ok) return;
  const gen = _gen;
  try { const n = (await api("/api/kapilar")).conflicts.length; if (gen === _gen) S.badges.conflicts = n; } catch { /* yok say */ }
  try { const p = (await api("/api/temizlik")).plan; if (gen === _gen) S.badges.reclaim = p.cache.size + p.dangling.size; } catch { /* yok say */ }
  if (gen !== _gen) return;  // başka sunucuya geçilmiş: eski makinenin rozetleri gösterilmesin
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
    if (a === "yeni" && !safeModeBlocked()) openNew();
    if (a === "sunucu-ekle") openAddRemote(() => refresh());
    if (a === "help") openHelp();
    if (a === "palette") Palette.open();
    if (a === "docker-ac") {
      try { flash((await api("/api/docker-ac", {})).mesaj); } catch (err) { flash(err.message, true); }
    }
    if (a === "use-local") useLocalDocker();
    if (a === "retry-engine") refresh();
    return;
  }
  const tn = t.closest("[data-tunnel]");
  if (tn) return openTunnel(+tn.dataset.tunnel);
  const fc = t.closest("[data-full-ctl]");
  if (fc) return toggleFullControl(fc.dataset.fullCtl, !!fc.dataset.on);
  const mc = t.closest("[data-machine]");
  if (mc) return switchMachine(mc.dataset.machine);
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
  api("/api/link-ac", { url: a.href }).then((r) => {
    const tn = r?.tunel;
    if (tn && Date.now() / 1000 - tn.started < 5) {
      flash(L(`SSH tüneli açıldı: localhost:${tn.local} → sunucu:${tn.remote}`, `SSH tunnel opened: localhost:${tn.local} → server:${tn.remote}`));
    }
  }).catch((err) => flash(err.message, true));
}, true);

// ---------- Uzak Docker ------------------------------------------------------------------
/** Başka bir Docker'a geçildikten sonra: eski motorun verileri, rozetleri ve grafikleri temizlenir. */
async function afterContextChange() {
  _gen++;
  TermHub.closeAll();  // açık terminaller eski sunucudaki konteynerlere bağlıydı
  S.data = null;
  S.catalog = null;
  S.stats = {};
  S.badges = {};
  await refresh();
  Router.current?.view.unmount?.();
  Router.current = null;
  Router.render();
  refreshBadges();
}

/** Kenar çubuğundaki "Makineler": "" = Bu Mac, diğerleri uzak bağlam adı. */
async function switchMachine(name) {
  const onRemote = S.data?.platform?.remote;
  if (!name) { if (onRemote) await useLocalDocker(); return; }
  if (onRemote?.context === name) return;
  flash(L(`Bağlanılıyor: ${name}…`, `Connecting: ${name}…`));
  try {
    await api("/api/baglam", { ad: name });
    await afterContextChange();
  } catch (err) { flash(err.message, true); }
}

/** Uzak sunucudayken üstte kırmızı şerit; güvenli modda bazı işlemler gizlenir. */
function renderRemoteBanner() {
  const r = S.data?.platform?.remote;
  document.body.classList.toggle("remote", !!r);
  document.body.classList.toggle("remote-safe", !!r?.guvenli);
  let bar = $("#remote-banner");
  if (!r) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "remote-banner";
    bar.className = "remote-banner";
    bar.setAttribute("role", "status");
    document.body.appendChild(bar);
  }
  const ok = S.data?.docker?.ok;
  patch(bar, html`
    ${icon("globe")}
    <span><b>${L("Uzak sunucu", "Remote server")}: ${r.context || r.host}</b> <span class="rb-addr">${r.user ? r.user + "@" : ""}${r.host}${r.port ? ":" + r.port : ""}</span></span>
    <span class="rb-sep">·</span>
    <span class="rb-mode">${!ok ? L("Bağlantı yok", "Not connected")
      : r.guvenli ? L("Güvenli mod: silme, kurulum, temizlik ve terminal kapalı", "Safe mode: delete, install, cleanup and terminal are off")
      : L("Tam kontrol açık", "Full control is on")}</span>
    <span class="grow"></span>
    ${r.context ? html`<button class="rb-btn" data-full-ctl="${r.context}" data-on="${r.guvenli ? "1" : ""}">${icon(r.guvenli ? "lock" : "shield")}${r.guvenli ? L("Tam kontrolü aç…", "Allow full control…") : L("Güvenli moda al", "Back to safe mode")}</button>` : ""}
    <button class="rb-btn" data-machine="">${icon("frontend")}${L(`${here("e", true)} dön`, `Back to ${hereEn()}`)}</button>`);
}

async function toggleFullControl(name, on) {
  if (on) {
    const ok = await confirmDialog({
      title: L(`“${name}” için tam kontrol açılsın mı?`, `Allow full control for “${name}”?`), icon: "alert", danger: true,
      confirmText: L("Tam kontrolü aç", "Allow full control"),
      text: L("Bu sunucuda parça ve veri silme, kurulum, güncelleme ve temizlik işlemleri açılır. Canlı bir sunucuysa dikkatli ol; istediğin zaman güvenli moda dönebilirsin.",
        "Deleting containers and data, installing, updating and cleanup become available on this server. Be careful if it's a live server; you can go back to safe mode any time."),
    });
    if (!ok) return;
  }
  try {
    await api("/api/uzak/tam-kontrol", { ad: name, acik: !!on });
    flash(on ? L("Tam kontrol açıldı", "Full control is on") : L("Güvenli moda alındı", "Safe mode is on"));
    await refresh();
    bus.emit("context-safety");
  } catch (err) { flash(err.message, true); }
}

async function useLocalDocker() {
  try {
    const r = await api("/api/baglam/yerel", {});
    flash(L(`${here("teki", true)} Docker'a dönüldü (${r.ad})`, `Switched back to the Docker on ${hereEn()} (${r.ad})`));
    await afterContextChange();
  } catch (err) { flash(err.message, true); }
}

async function openTunnel(port) {
  try {
    const tn = (await api("/api/tunel/ac", { kapi: port })).tunel;
    flash(tn.local === tn.remote
      ? L(`Tünel açık: ${here("teki")} localhost:${tn.local} artık sunucudaki ${tn.remote} numaralı kapıya gider.`, `Tunnel open: localhost:${tn.local} on ${hereEn()} now reaches ${tn.remote} on the server.`)
      : L(`Tünel açık: localhost:${tn.local} → sunucu:${tn.remote}. ${tn.remote} ${here("te")} dolu olduğu için adreste ${tn.local} kullan.`,
        `Tunnel open: localhost:${tn.local} → server:${tn.remote}. ${tn.remote} is taken on ${hereEn()}, so use ${tn.local} in the address.`));
  } catch (err) { flash(err.message, true); }
}

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
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); if (!safeModeBlocked()) openNew(); return; }
  if (mod && /^[1-9]$/.test(e.key)) {
    const n = NAV.find((x) => x.key === e.key);
    if (n) { e.preventDefault(); Router.go(n.path); }
    return;
  }
  // AltGr, Windows'ta Ctrl+Alt olarak gelir; Türkçe/Almanca klavyede [ ve ] AltGr ile yazılır. Yazarken ya da
  // AltGr basılıyken geri/ileri gitme (karakter kaybolup sayfa değişiyordu).
  const altGr = e.altKey || e.getModifierState?.("AltGraph");
  if (mod && !altGr && !typing && e.key === "[") { e.preventDefault(); history.back(); return; }
  if (mod && !altGr && !typing && e.key === "]") { e.preventDefault(); history.forward(); return; }
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
