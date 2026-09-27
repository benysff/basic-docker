"use strict";

/* =====================================================================
   Kapılar (port) haritası: bilgisayardaki hangi numara kimde?
   Docker + diğer programlar + macOS servisleri; çakışma ve ağa açıklık uyarısı.
   ===================================================================== */

const PortsView = {
  filter: "hepsi",

  mount(root) {
    this.root = root;
    this.data = null;
    this.error = null;
    this.check = null;
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({
          title: T("port", true),
          desc: "Bilgisayarındaki hangi numaralı kapıyı kim kullanıyor? Docker, diğer programlar ve macOS birlikte. “Bu kapı dolu” hatasının sebebini burada bulursun.",
          actions: html`<button class="btn" data-retry>${icon("refresh")}Yenile</button>`,
        })}
        <div id="pt-alerts"></div>
        <section class="panel port-finder">
          <div>
            <h3 class="panel-title">${icon("search")}Boş kapı bul</h3>
            <p class="muted small">Yeni bir parça için numara mı arıyorsun? Yaz, dolu mu boş mu söyleyeyim.</p>
          </div>
          <form class="port-finder-form" data-port-form>
            <input id="pt-in" inputmode="numeric" placeholder="ör. 5432" aria-label="Kapı numarası" autocomplete="off">
            <button class="btn">Denetle</button>
          </form>
          <div id="pt-check" class="port-check" aria-live="polite"></div>
        </section>
        <div class="toolbar"><div id="pt-filter"></div></div>
        <div id="pt-body">${skeletonRows(10)}</div>
      </div>`);
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    root.addEventListener("submit", this.onSubmit = (e) => { e.preventDefault(); this.checkPort(); });
    this.offData = bus.on("job-done", () => this.load());
    this.load();
  },

  unmount() {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("submit", this.onSubmit);
    this.offData();
  },

  async load() {
    try {
      this.data = await api("/api/kapilar");
      this.error = null;
      S.badges.conflicts = this.data.conflicts.length;
      bus.emit("badges");
    } catch (e) { this.error = e.message; }
    this.render();
  },

  async checkPort() {
    const v = $("#pt-in", this.root).value.trim();
    if (!v) return;
    try {
      const r = await api(`/api/kapi-oner${q({ kapi: v })}`);
      const row = this.data?.ports.find((p) => p.port === r.port);
      patch($("#pt-check", this.root), r.free
        ? html`${badge("ok", `${r.port} boş`)}<span>Bu numarayı kullanabilirsin.</span>`
        : html`${badge("err", `${r.port} dolu`)}<span>${row ? html`Kullanan: <b>${row.title}</b>. ` : ""}En yakın boş numara: <b class="mono">${r.suggestion}</b></span>
            <button class="btn sm" data-copy="${r.suggestion}">${icon("copy")}Kopyala</button>`);
    } catch (e) { patch($("#pt-check", this.root), html`<span class="txt-err">${e.message}</span>`); }
  },

  click(e) {
    const t = e.target;
    if (t.closest("[data-retry]")) return this.load();
    const seg = t.closest("[data-seg='pt']");
    if (seg) { this.filter = seg.dataset.val; return this.render(); }
    const stop = t.closest("[data-stop-app]");
    if (stop) return appAction(stop.dataset.stopApp, "durdur").then(() => setTimeout(() => this.load(), 1500));
  },

  render() {
    const body = $("#pt-body", this.root);
    if (this.error) return patch(body, errorState(this.error));
    if (!this.data) return;
    const { ports, conflicts } = this.data;
    const lan = ports.filter((p) => p.scope === "lan" && p.owner === "docker");

    patch($("#pt-alerts", this.root), html`
      ${conflicts.map((c) => callout({
        level: "warn", icon: "alert",
        title: `${c.wanted_by.app_name} başlatılırsa çakışır`,
        text: html`<b>${c.wanted_by.role}</b> parçası <b class="mono">${c.port}</b> numaralı kapıyı istiyor ama bu kapıyı şu an
          <b>${c.holder.title}</b>${c.holder.owner === "docker" ? html` (${c.holder.desc})` : c.holder.proc ? html` (${c.holder.proc})` : ""} kullanıyor.`,
        actions: html`
          ${c.holder.owner === "docker" && c.holder.app ? html`<button class="btn sm" data-stop-app="${c.holder.app}">${icon("stop")}${c.holder.title} uygulamasını durdur</button>` : ""}
          <a class="btn sm" href="${link(`/uygulama/${c.wanted_by.app}`)}">${c.wanted_by.app_name} uygulamasına git</a>`,
      }))}
      ${lan.length ? callout({
        level: "info", icon: "globe",
        title: `${lan.length} Docker kapısı ağdaki herkese açık`,
        text: html`${lan.map((p) => html`<b class="mono">${p.port}</b> (${p.title}) `)} — aynı Wi-Fi'deki başka cihazlar da bunlara bağlanabilir.
          Sadece bu Mac'ten erişilsin istiyorsan compose dosyasında kapıyı <code>"127.0.0.1:8000:8000"</code> biçiminde yaz.`,
      }) : ""}`);

    const counts = {
      hepsi: ports.length,
      docker: ports.filter((p) => p.owner === "docker").length,
      diger: ports.filter((p) => p.owner !== "docker").length,
      acik: ports.filter((p) => p.scope === "lan").length,
    };
    patch($("#pt-filter", this.root), segmented("pt", [
      { id: "hepsi", label: "Tümü", count: counts.hepsi },
      { id: "docker", label: "Docker", count: counts.docker },
      { id: "diger", label: "Diğer programlar", count: counts.diger },
      { id: "acik", label: "Ağa açık", count: counts.acik },
    ], this.filter));

    let list = ports;
    if (this.filter === "docker") list = list.filter((p) => p.owner === "docker");
    if (this.filter === "diger") list = list.filter((p) => p.owner !== "docker");
    if (this.filter === "acik") list = list.filter((p) => p.scope === "lan");
    if (!list.length) return patch(body, emptyState({ icon: "plug", title: "Gösterilecek kapı yok", compact: true }));

    const conflictPorts = new Set(conflicts.map((c) => c.port));
    patch(body, html`
      <div class="table-wrap">
        <table class="table ports-table">
          <thead><tr><th class="num">${T("port")}</th><th>Kim kullanıyor?</th><th class="col-md">Erişim</th><th class="col-lg">Açıklama</th><th class="actions-col"><span class="sr">İşlemler</span></th></tr></thead>
          <tbody>${list.map((p) => html`
            <tr class="${conflictPorts.has(p.port) ? "row-warn" : ""}">
              <td class="num"><span class="port-big mono">${p.port}</span></td>
              <td><div class="cell-main">
                <div class="kind-tile sm ${p.owner === "docker" ? "lvl-ok" : ""}">${icon(p.owner === "docker" ? "box" : p.owner === "engine" ? "server" : p.system ? "monitor" : "terminal")}</div>
                <div class="min0">
                  <div class="strong">${p.owner === "docker" ? (findApp(p.app) ? html`<a href="${link(`/uygulama/${p.app}`)}">${p.title}</a>` : p.title) : p.title}</div>
                  <div class="muted small">${p.owner === "docker" ? html`<a href="${link(`/parca/${p.id}`)}">${p.role}</a> · içeride ${p.container_port}`
                    : p.owner === "engine" ? "Docker motoru" : html`${p.proc}${p.pid ? html` <span class="mono">(pid ${p.pid})</span>` : ""}`}</div>
                </div></div></td>
              <td class="col-md">${p.scope === "lan" ? pill(html`${icon("globe")}Ağa açık`, "warn") : pill(html`${icon("lock")}Sadece bu Mac`, "ok")}</td>
              <td class="col-lg small muted">${p.owner === "docker" ? html`<span class="mono">${p.container}</span>${p.url ? " · tarayıcıda açılır" : ""}` : p.desc}</td>
              <td class="actions-col"><div class="row-actions">${p.url ? linkChip(p.url, "Aç") : ""}</div></td>
            </tr>`)}</tbody>
        </table>
      </div>
      <p class="muted small">Sadece “dinleyen” (bağlantı bekleyen) TCP kapıları gösterilir. macOS'un kendi servisleri de listede; onları kapatmak için Sistem Ayarları'nı kullan.</p>`);
  },
};
