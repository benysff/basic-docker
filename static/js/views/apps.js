"use strict";

/* =====================================================================
   Uygulamalar (ana sayfa): özet, filtreler, kart / liste görünümü.
   ===================================================================== */

const SOURCE_TEXT = {
  compose: ["Docker Compose projesi", "Docker Compose project"],
  basicdocker: ["Basic Docker ile kuruldu", "Created with Basic Docker"],
  manual: ["Elle gruplandı", "Grouped by hand"],
  single: ["Tek başına duran parça", "Standalone container"],
  system: ["Docker'ın kendi yardımcı parçaları", "Docker's own helper containers"],
};
const sourceText = (src) => (SOURCE_TEXT[src] ? L(...SOURCE_TEXT[src]) : "");

// ---------- Uygulama işlemleri (kart, liste ve ayrıntı sayfası ortak) ----------
function appMainButton(a, size = "") {
  const job = activeJob(a.key);
  if (job) return html`<button class="btn ${size}" disabled><span class="spinner"></span>${L("Bekle…", "Wait…")}</button>`;
  if (a.total === 0 && !a.compose?.exists) return "";
  if (a.up > 0) return html`<button class="btn ${size} stop" data-app-act="durdur" data-key="${a.key}">${icon("stop")}${L("Durdur", "Stop")}</button>`;
  return html`<button class="btn ${size} go" data-app-act="baslat" data-key="${a.key}">${icon("play")}${L("Başlat", "Start")}</button>`;
}

function appMenuItems(a) {
  const job = activeJob(a.key);
  const hasConn = a.containers.some((c) => c.connection);
  const compose = a.compose?.exists;
  return [
    { label: L("Ayrıntıları aç", "Open details"), icon: "arrowRight", onClick: () => Router.go(`/uygulama/${encodeURIComponent(a.key)}`) },
    "-",
    a.up > 0 && { label: L("Yeniden başlat", "Restart"), icon: "restart", disabled: !!job, onClick: () => appAction(a.key, "yeniden") },
    a.state === "partial" && { label: L("Kapalı olanları da başlat", "Start the stopped ones too"), icon: "play", disabled: !!job, onClick: () => appAction(a.key, "baslat") },
    compose && { label: L("Güncelle (yeni sürümleri indir)", "Update (pull new versions)"), icon: "update", disabled: !!job, unsafe: true, onClick: () => appAction(a.key, "guncelle") },
    compose && { label: L("Kodu yeniden derle", "Rebuild the code"), icon: "hammer", disabled: !!job, unsafe: true, onClick: () => appAction(a.key, "derle") },
    "-",
    { label: `${T("logs")}`, icon: "logs", onClick: () => Router.go(`/uygulama/${encodeURIComponent(a.key)}/kayitlar`) },
    hasConn && { label: L("Bağlantı bilgilerini .env olarak kopyala", "Copy connection details as .env"), icon: "key", onClick: () => copyAppEnv(a.key) },
    compose && a.compose.dir && { label: L("Proje klasörünü aç", "Open project folder"), icon: "folder", onClick: () => api("/api/klasor-ac", { key: a.key }).catch((e) => flash(e.message, true)) },
    isGroupApp(a) && { label: L(`${T("container")} ekle`, "Add a container"), icon: "plus", unsafe: true, onClick: () => openNew("sablonlar", { app: a.key }) },
    { label: L("Bir sete ekle", "Add to a set"), icon: "rocket", unsafe: true, onClick: () => openSetEditor(null, [a.key]) },
    "-",
    { label: a.total ? L("Sil…", "Delete…") : L("Listeden kaldır…", "Remove from list…"), icon: "trash", danger: true, disabled: !!job, onClick: () => confirmDeleteApp(a) },
  ];
}

async function appAction(key, act) {
  const a = findApp(key);
  if (!a) return;
  if (act === "sil") return confirmDeleteApp(a);
  if (act === "derle") {
    const r = await confirmDialog({
      title: L("Kod yeniden derlensin mi?", "Rebuild the code?"),
      text: L("Projedeki Dockerfile'lar baştan derlenir ve bütün parçalar yeniden oluşturulur. Verilerin (veri kutuları) korunur. Birkaç dakika sürebilir.",
        "The project's Dockerfiles are built from scratch and every container is recreated. Your data (volumes) is kept. This can take a few minutes."),
      confirmText: L("Derle ve başlat", "Rebuild and start"), icon: "hammer",
    });
    if (!r) return;
  }
  await runJob("/api/uygulama", { key, islem: act });
}

async function copyAppEnv(key) {
  try {
    const r = await api(`/api/uygulama/env${q({ key })}`);
    copyText(r.metin, L(".env satırları kopyalandı", ".env lines copied"));
  } catch (e) { flash(e.message, true); }
}

function appUsage(a) {
  let cpu = 0, mem = 0, have = false;
  for (const c of a.containers) {
    const s = S.stats[c.name];
    if (s && c.running) { cpu += s.cpu; mem += s.mem; have = true; }
  }
  return have ? { cpu, mem } : null;
}

function matchesApp(a, qq) {
  const hay = fold([a.name, a.key, a.summary, a.note, ...a.containers.flatMap((c) => [c.name, c.image, c.role_title])]
    .join(" "));
  return hay.includes(qq);
}

// ---------- Görünüm --------------------------------------------------------------
const AppsView = {
  filter: "hepsi",
  query: "",
  showSystem: false,

  mount(root) {
    this.root = root;
    const mode = S.prefs.gorunum || "kart";
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({
          title: T("app", true),
          desc: L("Her kart bir uygulama: birlikte çalışan parçaların grubu. Tek tuşla aç, tek tuşla kapat.",
            "Each card is an app: a group of containers that work together. Start and stop them with one click."),
          actions: html`<button class="btn" data-global="sunucu-ekle" title="${L("Uzak bir sunucudaki Docker'ı ekle", "Add Docker on a remote server")}">${icon("globe")}${L("Sunucu ekle", "Add server")}</button>
            <button class="btn primary" data-global="yeni" title="${modText(L("Yeni ekle (⌘N)", "Add new (⌘N)"))}">${icon("plus")}${L("Yeni ekle", "Add new")}</button>`,
        })}
        <div id="apps-intro"></div>
        <section class="stat-row" id="apps-stats" aria-label="${L("Özet", "Summary")}"></section>
        <div class="toolbar">
          ${searchBox("apps-search", L(`${T("app")} ya da ${Tl("container")} ara…`, "Search apps or containers…"), this.query)}
          <div id="apps-filter"></div>
          <div class="toolbar-spacer"></div>
          ${segmented("gorunum", [
            { id: "kart", icon: "grid", title: L("Kart görünümü", "Card view") },
            { id: "liste", icon: "list", title: L("Liste görünümü", "List view") },
          ], mode)}
        </div>
        <div id="apps-body" aria-live="polite">${skeletonCards(6)}</div>
      </div>`);

    root.addEventListener("input", this.onInput = (e) => {
      if (e.target.id === "apps-search") { this.query = e.target.value; this.render(); }
    });
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    root.addEventListener("keydown", this.onKey = (e) => {
      const card = e.target.closest?.("[data-open-app]");
      if (card && e.target === card && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        Router.go(`/uygulama/${encodeURIComponent(card.dataset.openApp)}`);
      }
    });
    this.offData = bus.on("data", () => this.render());
    this.offStats = bus.on("stats", () => this.render());
    startStats(this);
    this.render();
  },

  unmount() {
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("keydown", this.onKey);
    this.offData();
    this.offStats();
    stopStats(this);
  },

  click(e) {
    const seg = e.target.closest("[data-seg]");
    if (seg) {
      if (seg.dataset.seg === "gorunum") {
        S.prefs.gorunum = seg.dataset.val;
        api("/api/ayarlar/kaydet", { gorunum: seg.dataset.val }).catch(() => {});
        $$('[data-seg="gorunum"]', this.root).forEach((b) => {
          b.classList.toggle("active", b === seg);
          b.setAttribute("aria-checked", b === seg);
        });
      } else if (seg.dataset.seg === "durum") {
        this.filter = seg.dataset.val;
      }
      return this.render();
    }
    if (e.target.closest("[data-intro-close]")) {
      S.prefs.intro_kapali = true;
      api("/api/ayarlar/kaydet", { intro_kapali: true }).catch(() => {});
      return this.render();
    }
    if (e.target.closest("[data-toggle-system]")) { this.showSystem = !this.showSystem; return this.render(); }
    if (e.target.closest("[data-stat-filter]")) {
      this.filter = e.target.closest("[data-stat-filter]").dataset.statFilter;
      return this.render();
    }
    if (e.target.closest("a")) return;
    const act = e.target.closest("[data-app-act]");
    if (act) { e.stopPropagation(); return appAction(act.dataset.key, act.dataset.appAct); }
    const menu = e.target.closest("[data-app-menu]");
    if (menu) {
      e.stopPropagation();
      const a = findApp(menu.dataset.appMenu);
      if (a) Menu.open(menu, appMenuItems(a));
      return;
    }
    const open = e.target.closest("[data-open-app]");
    if (open) Router.go(`/uygulama/${encodeURIComponent(open.dataset.openApp)}`);
  },

  render() {
    if (!S.data) return;
    const all = apps();
    const real = all.filter((a) => a.source !== "system");
    const counts = {
      hepsi: real.length,
      calisan: real.filter((a) => a.running > 0).length,
      kapali: real.filter((a) => a.running === 0).length,
      sorunlu: real.filter((a) => a.state === "problem" || a.hint).length,
    };

    // Tanıtım
    patch($("#apps-intro", this.root), S.prefs.intro_kapali ? "" : html`
      <div class="intro">
        <div class="intro-art" aria-hidden="true">${icon("grid")}</div>
        <div class="intro-text">
          <h2>${L("Nasıl çalışır?", "How does it work?")}</h2>
          ${isEN() ? html`<p>Each card is an <b>app</b>. An app is made of a few <b>containers</b> that work together.
            For example, a website = site + database + mailbox. Press <b>Start</b> and they all start together;
            press <b>Stop</b> and they all stop. Click a card for details. Press <b>${modText("⌘K")}</b> to search anywhere.</p>`
          : html`<p>Her kart bir <b>uygulama</b>. Bir uygulama, birlikte çalışan birkaç <b>parçadan</b> (konteyner) oluşur.
            Örneğin bir web sitesi = site + veritabanı + e-posta kutusu. <b>Başlat</b>'a basınca hepsi birlikte açılır,
            <b>Durdur</b>'a basınca hepsi kapanır. Ayrıntılar için karta tıkla. Her yerde arama için <b>${modText("⌘K")}</b>.</p>`}
        </div>
        <button class="icon-btn" data-intro-close aria-label="${L("Tanıtımı kapat", "Hide intro")}" title="${L("Kapat", "Close")}">${icon("close")}</button>
      </div>`);

    // Özet kutuları
    let cpu = 0, mem = 0, limit = 0, have = false;
    for (const c of allContainers()) {
      const s = S.stats[c.name];
      if (s && c.running) { cpu += s.cpu; mem += s.mem; limit = s.mem_limit || limit; have = true; }
    }
    const cpuHist = sumHistories(allContainers().filter((c) => c.running).map((c) => S.stats[c.name]?.hist?.cpu));
    const memHist = sumHistories(allContainers().filter((c) => c.running).map((c) => S.stats[c.name]?.hist?.mem));
    const problems = counts.sorunlu + (S.badges.conflicts || 0);
    patch($("#apps-stats", this.root), html`
      <button class="stat" data-stat-filter="calisan">
        <div class="stat-label">${icon("play")}${L("Çalışan", "Running")}</div>
        <div class="stat-value">${counts.calisan}<small>/ ${plural(counts.hepsi, Tl("app"))}</small></div>
        <div class="stat-foot">${plural(allContainers().filter((c) => c.running && c.app.source !== "system").length, Tl("container"))} ${L("açık", "up")}</div>
      </button>
      <div class="stat">
        <div class="stat-label">${icon("cpu")}${L("İşlemci", "CPU")}</div>
        <div class="stat-value">${have ? fmt.pct(cpu) : "—"}</div>
        ${sparkline(cpuHist, { w: 160, h: 28, cls: "accent" })}
      </div>
      <div class="stat">
        <div class="stat-label">${icon("memory")}${L("Bellek", "Memory")}</div>
        <div class="stat-value">${have ? fmt.bytes(mem) : "—"}${limit ? html`<small>/ ${fmt.bytes(limit, 0)}</small>` : ""}</div>
        ${limit ? meter((mem / limit) * 100) : sparkline(memHist, { w: 160, h: 28 })}
      </div>
      <button class="stat ${problems ? "attention" : ""}" data-stat-filter="sorunlu">
        <div class="stat-label">${icon(problems ? "alert" : "checkCircle")}${L("Dikkat", "Attention")}</div>
        <div class="stat-value">${problems || L("Yok", "None")}</div>
        <div class="stat-foot">${problems ? L("sorunlu uygulama ya da kapı çakışması", "app problems or port conflicts") : L("Her şey yolunda görünüyor", "Everything looks fine")}</div>
      </button>`);

    patch($("#apps-filter", this.root), segmented("durum", [
      { id: "hepsi", label: L("Tümü", "All"), count: counts.hepsi },
      { id: "calisan", label: L("Çalışan", "Running"), count: counts.calisan },
      { id: "kapali", label: L("Kapalı", "Stopped"), count: counts.kapali },
      { id: "sorunlu", label: L("Sorunlu", "Problems"), count: counts.sorunlu },
    ], this.filter));

    const qq = fold(this.query.trim());
    let list = all;
    if (qq) list = list.filter((a) => matchesApp(a, qq));
    if (this.filter === "calisan") list = list.filter((a) => a.running > 0);
    if (this.filter === "kapali") list = list.filter((a) => a.running === 0);
    if (this.filter === "sorunlu") list = list.filter((a) => a.state === "problem" || a.hint);

    const body = $("#apps-body", this.root);
    if (!all.length) {
      return patch(body, emptyState({
        icon: "grid", title: L(`Henüz hiç ${Tl("app")} yok`, "No apps yet"),
        text: L("Hazır bir veritabanı kurabilir ya da docker-compose.yml olan proje klasörünü ekleyebilirsin.",
          "Install a ready-made database or add a project folder that has a docker-compose.yml."),
        action: html`<button class="btn primary" data-global="yeni">${icon("plus")}${L("Yeni ekle", "Add new")}</button>`,
      }));
    }
    if (!list.length) {
      return patch(body, emptyState({
        icon: "search", title: L("Eşleşen bir şey yok", "Nothing matches"),
        text: qq ? L(`“${this.query}” ile eşleşen ${Tl("app")} bulunamadı.`, `No app matches “${this.query}”.`)
          : L("Bu filtrede gösterilecek uygulama yok.", "No apps for this filter."),
        compact: true,
      }));
    }

    const groups = { apps: [], single: [], system: [] };
    for (const a of list) groups[a.source === "system" ? "system" : a.source === "single" ? "single" : "apps"].push(a);
    const mode = S.prefs.gorunum || "kart";
    const block = (items) => (mode === "liste" ? this.table(items) : html`<div class="card-grid">${items.map((a) => this.card(a))}</div>`);

    patch(body, html`
      ${groups.apps.length ? html`
        <section class="section">
          ${groups.single.length || groups.system.length ? html`<h2 class="section-title">${T("app", true)} <span>${groups.apps.length}</span></h2>` : ""}
          ${block(groups.apps)}
        </section>` : ""}
      ${groups.single.length ? html`
        <section class="section">
          <h2 class="section-title">${L(`Tek başına duran ${Tl("container", true)}`, "Standalone containers")} <span>${groups.single.length}</span>
            ${hintIcon(L("Bir projeye bağlı olmayan, tek komutla (docker run) açılmış parçalar. Ayrıntılardaki 'Uygulamaya ekle' ile bir karta toplayabilirsin.",
              "Containers started with a single command (docker run) that don't belong to a project. Use 'Add to an app' in the details to group them into a card."))}</h2>
          ${block(groups.single)}
        </section>` : ""}
      ${groups.system.length ? html`
        <section class="section">
          <button class="section-title toggle" data-toggle-system aria-expanded="${this.showSystem}">
            ${icon(this.showSystem ? "chevronDown" : "chevronRight")}${L("Docker'ın yardımcıları", "Docker helpers")} <span>${groups.system.reduce((n, a) => n + a.total, 0)}</span>
          </button>
          ${this.showSystem ? block(groups.system) : ""}
        </section>` : ""}`);
  },

  card(a) {
    const job = activeJob(a.key);
    const level = LEVEL_OF_APP[a.state] || "off";
    const usage = appUsage(a);
    const parts = a.source === "single"
      ? html`<div class="card-image mono" title="${a.containers[0]?.image}">${a.containers[0]?.image}</div>`
      : html`<div class="part-pills">${a.containers.slice(0, 6).map((c) => html`
          <span class="part-pill lvl-${containerLevel(c)}" title="${c.role_title} (${c.name}) — ${c.status_text}">${icon(c.kind)}<span>${pillLabel(c, a)}</span></span>`)}
          ${a.containers.length > 6 ? html`<span class="part-pill more">+${a.containers.length - 6}</span>` : ""}
          ${a.total === 0 ? html`<span class="muted small">${L(`${T("container")} yok — Başlat'a basınca yeniden kurulur`, "No containers — press Start to recreate them")}</span>` : ""}
        </div>`;
    const links = [...a.links].sort((x, y) => y.running - x.running).slice(0, 3);
    return html`
      <article class="card app-card lvl-${level}" data-open-app="${a.key}" tabindex="0" aria-label="${a.name}: ${a.state_text}">
        <div class="app-card-head">
          ${avatar(a.key, a.name)}
          <div class="app-card-title">
            <h3 title="${a.name}">${a.name}</h3>
            <div class="app-card-state">${badge(level, a.state_text)}${a.source !== "single" && a.total ? html`<span class="muted">· ${a.running}/${a.total}</span>` : ""}</div>
          </div>
          ${appMainButton(a, "sm")}
        </div>
        ${parts}
        ${links.length ? html`<div class="chips">${links.map((l) => linkChip(l.url, l.label, { dim: !l.running, title: `${l.role} — ${L("tarayıcıda aç", "open in browser")}` }))}</div>` : ""}
        ${job ? html`<div class="card-busy"><span class="spinner"></span><span>${job.last || job.title}</span></div>`
          : a.hint ? html`<div class="card-hint lvl-${a.state === "problem" ? "err" : a.state === "empty" ? "info" : "warn"}">${icon(a.state === "empty" ? "info" : "alert")}<span>${a.hint}</span></div>` : ""}
        <div class="app-card-foot">
          <span class="usage">${usage ? html`${icon("cpu")}${fmt.pct(usage.cpu)}<span class="sep-dot"></span>${icon("memory")}${fmt.bytes(usage.mem)}` : html`<span class="muted">${a.note ? a.note.slice(0, 60) : sourceText(a.source)}</span>`}</span>
          <button class="icon-btn sm" data-app-menu="${a.key}" aria-label="${L("Diğer işlemler", "More actions")}" aria-haspopup="menu" title="${L("Diğer işlemler", "More actions")}">${icon("more")}</button>
        </div>
      </article>`;
  },

  table(items) {
    return html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>${T("app")}</th><th>${L("Durum", "Status")}</th><th class="col-md">${T("container", true)}</th>
            <th class="col-lg">${L("Adresler", "Addresses")}</th><th class="col-md num">${L("Kaynak", "Usage")}</th><th class="actions-col"><span class="sr">${L("İşlemler", "Actions")}</span></th>
          </tr></thead>
          <tbody>${items.map((a) => {
            const level = LEVEL_OF_APP[a.state] || "off";
            const usage = appUsage(a);
            const job = activeJob(a.key);
            return html`
              <tr class="row-link" data-open-app="${a.key}" tabindex="0">
                <td><div class="cell-main">${avatar(a.key, a.name, "sm")}<div><div class="strong">${a.name}</div><div class="muted small ellipsis">${a.source === "single" ? a.containers[0]?.image : a.summary}</div></div></div></td>
                <td>${job ? html`<span class="busy-inline"><span class="spinner"></span>${job.last || L("Bekle…", "Wait…")}</span>` : badge(level, a.state_text)}</td>
                <td class="col-md">${a.total ? html`<span class="mono">${a.running}/${a.total}</span>` : "—"}</td>
                <td class="col-lg"><div class="chips">${a.links.slice(0, 2).map((l) => linkChip(l.url, l.label, { dim: !l.running }))}</div></td>
                <td class="col-md num mono small">${usage ? html`${fmt.pct(usage.cpu)} · ${fmt.bytes(usage.mem)}` : "—"}</td>
                <td class="actions-col"><div class="row-actions">${appMainButton(a, "sm")}<button class="icon-btn sm" data-app-menu="${a.key}" aria-label="${L("Diğer işlemler", "More actions")}">${icon("more")}</button></div></td>
              </tr>`;
          })}</tbody>
        </table>
      </div>`;
  },
};

/** Kartta parça etiketi; aynı ada düşen parçaları servis adıyla ayırır ("Arka uç · backoffice"). */
function pillLabel(c, a) {
  const label = shortRole(c.role_title);
  const same = a.containers.filter((x) => shortRole(x.role_title) === label);
  return same.length > 1 ? `${label} · ${c.service || c.name}` : label;
}

function shortRole(t) {
  return (t || "").replace(/\s*\(.*\)$/, "");
}

/** Birden çok parçanın geçmişini sondan hizalayıp toplar. */
function sumHistories(list) {
  const arrs = list.filter((x) => Array.isArray(x) && x.length);
  if (!arrs.length) return [];
  const n = Math.max(...arrs.map((x) => x.length));
  const out = new Array(n).fill(0);
  for (const a of arrs) {
    const off = n - a.length;
    a.forEach((v, i) => { out[off + i] += v; });
  }
  return out;
}

// ---------- Canlı kaynak kullanımı (görünümler abone olur) ----------------------
const _statSubs = new Set();
let _statTimer = null;
async function loadStats() {
  if (document.hidden || !S.data?.docker?.ok) return;
  try {
    const r = await api("/api/istatistik");
    S.stats = r.istatistik || {};
    S.lastStatsAt = Date.now();
    bus.emit("stats");
  } catch { /* önemli değil */ }
}
function startStats(sub) {
  _statSubs.add(sub);
  if (!_statTimer) {
    loadStats();
    _statTimer = setInterval(loadStats, 2500);
  }
}
function stopStats(sub) {
  _statSubs.delete(sub);
  if (!_statSubs.size && _statTimer) { clearInterval(_statTimer); _statTimer = null; }
}
