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
          desc: L("Bilgisayarındaki hangi numaralı kapıyı kim kullanıyor? Docker, diğer programlar ve macOS birlikte. “Bu kapı dolu” hatasının sebebini burada bulursun.",
            "Who is using which port on your computer? Docker, other programs and macOS together. This is where you find out why a port is “already in use”."),
          actions: html`<button class="btn" data-retry>${icon("refresh")}${L("Yenile", "Refresh")}</button>`,
        })}
        <div id="pt-alerts"></div>
        <section class="panel port-finder">
          <div>
            <h3 class="panel-title">${icon("search")}${L("Boş kapı bul", "Find a free port")}</h3>
            <p class="muted small">${L("Yeni bir parça için numara mı arıyorsun? Yaz, dolu mu boş mu söyleyeyim.", "Looking for a port for a new container? Type it and I'll tell you if it's free.")}</p>
          </div>
          <form class="port-finder-form" data-port-form>
            <input id="pt-in" inputmode="numeric" placeholder="${L("ör. 5432", "e.g. 5432")}" aria-label="${L("Kapı numarası", "Port number")}" autocomplete="off">
            <button class="btn">${L("Denetle", "Check")}</button>
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
        ? html`${badge("ok", L(`${r.port} boş`, `${r.port} is free`))}<span>${L("Bu numarayı kullanabilirsin.", "You can use this port.")}</span>`
        : html`${badge("err", L(`${r.port} dolu`, `${r.port} is taken`))}<span>${row ? html`${L("Kullanan", "Used by")}: <b>${row.title}</b>. ` : ""}${L("En yakın boş numara", "Nearest free port")}: <b class="mono">${r.suggestion}</b></span>
            <button class="btn sm" data-copy="${r.suggestion}">${icon("copy")}${L("Kopyala", "Copy")}</button>`);
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
        title: L(`${c.wanted_by.app_name} başlatılırsa çakışır`, `${c.wanted_by.app_name} will clash if started`),
        text: isEN()
          ? html`<b>${c.wanted_by.role}</b> wants port <b class="mono">${c.port}</b>, but it is currently used by
            <b>${c.holder.title}</b>${c.holder.owner === "docker" ? html` (${c.holder.desc})` : c.holder.proc ? html` (${c.holder.proc})` : ""}.`
          : html`<b>${c.wanted_by.role}</b> parçası <b class="mono">${c.port}</b> numaralı kapıyı istiyor ama bu kapıyı şu an
          <b>${c.holder.title}</b>${c.holder.owner === "docker" ? html` (${c.holder.desc})` : c.holder.proc ? html` (${c.holder.proc})` : ""} kullanıyor.`,
        actions: html`
          ${c.holder.owner === "docker" && c.holder.app ? html`<button class="btn sm" data-stop-app="${c.holder.app}">${icon("stop")}${L(`${c.holder.title} uygulamasını durdur`, `Stop ${c.holder.title}`)}</button>` : ""}
          <a class="btn sm" href="${link(`/uygulama/${c.wanted_by.app}`)}">${L(`${c.wanted_by.app_name} uygulamasına git`, `Go to ${c.wanted_by.app_name}`)}</a>`,
      }))}
      ${lan.length ? callout({
        level: "info", icon: "globe",
        title: L(`${lan.length} Docker kapısı ağdaki herkese açık`, `${plural(lan.length, "Docker port")} open to everyone on the network`),
        text: isEN()
          ? html`${lan.map((p) => html`<b class="mono">${p.port}</b> (${p.title}) `)} — other devices on the same Wi-Fi can connect to these too.
            To allow this Mac only, write the port as <code>"127.0.0.1:8000:8000"</code> in the compose file.`
          : html`${lan.map((p) => html`<b class="mono">${p.port}</b> (${p.title}) `)} — aynı Wi-Fi'deki başka cihazlar da bunlara bağlanabilir.
          Sadece bu Mac'ten erişilsin istiyorsan compose dosyasında kapıyı <code>"127.0.0.1:8000:8000"</code> biçiminde yaz.`,
      }) : ""}`);

    const counts = {
      hepsi: ports.length,
      docker: ports.filter((p) => p.owner === "docker").length,
      diger: ports.filter((p) => p.owner !== "docker").length,
      acik: ports.filter((p) => p.scope === "lan").length,
    };
    patch($("#pt-filter", this.root), segmented("pt", [
      { id: "hepsi", label: L("Tümü", "All"), count: counts.hepsi },
      { id: "docker", label: "Docker", count: counts.docker },
      { id: "diger", label: L("Diğer programlar", "Other programs"), count: counts.diger },
      { id: "acik", label: L("Ağa açık", "Open to network"), count: counts.acik },
    ], this.filter));

    let list = ports;
    if (this.filter === "docker") list = list.filter((p) => p.owner === "docker");
    if (this.filter === "diger") list = list.filter((p) => p.owner !== "docker");
    if (this.filter === "acik") list = list.filter((p) => p.scope === "lan");
    if (!list.length) return patch(body, emptyState({ icon: "plug", title: L("Gösterilecek kapı yok", "No ports to show"), compact: true }));

    const conflictPorts = new Set(conflicts.map((c) => c.port));
    patch(body, html`
      <div class="table-wrap">
        <table class="table ports-table">
          <thead><tr><th class="num">${T("port")}</th><th>${L("Kim kullanıyor?", "Who uses it?")}</th><th class="col-md">${L("Erişim", "Access")}</th><th class="col-lg">${L("Açıklama", "Description")}</th><th class="actions-col"><span class="sr">${L("İşlemler", "Actions")}</span></th></tr></thead>
          <tbody>${list.map((p) => html`
            <tr class="${conflictPorts.has(p.port) ? "row-warn" : ""}">
              <td class="num"><span class="port-big mono">${p.port}</span></td>
              <td><div class="cell-main">
                <div class="kind-tile sm ${p.owner === "docker" ? "lvl-ok" : ""}">${icon(p.owner === "docker" ? "box" : p.owner === "engine" ? "server" : p.system ? "monitor" : "terminal")}</div>
                <div class="min0">
                  <div class="strong">${p.owner === "docker" ? (findApp(p.app) ? html`<a href="${link(`/uygulama/${p.app}`)}">${p.title}</a>` : p.title) : p.title}</div>
                  <div class="muted small">${p.owner === "docker" ? html`<a href="${link(`/parca/${p.id}`)}">${p.role}</a> · ${L(`içeride ${p.container_port}`, `${p.container_port} inside`)}`
                    : p.owner === "engine" ? L("Docker motoru", "Docker engine") : html`${p.proc}${p.pid ? html` <span class="mono">(pid ${p.pid})</span>` : ""}`}</div>
                </div></div></td>
              <td class="col-md">${p.scope === "lan" ? pill(html`${icon("globe")}${L("Ağa açık", "Open to network")}`, "warn") : pill(html`${icon("lock")}${L("Sadece bu Mac", "This Mac only")}`, "ok")}</td>
              <td class="col-lg small muted">${p.owner === "docker" ? html`<span class="mono">${p.container}</span>${p.url ? L(" · tarayıcıda açılır", " · opens in a browser") : ""}` : p.desc}</td>
              <td class="actions-col"><div class="row-actions">${p.url ? linkChip(p.url, L("Aç", "Open")) : ""}</div></td>
            </tr>`)}</tbody>
        </table>
      </div>
      <p class="muted small">${L("Sadece “dinleyen” (bağlantı bekleyen) TCP kapıları gösterilir. macOS'un kendi servisleri de listede; onları kapatmak için Sistem Ayarları'nı kullan.", "Only “listening” TCP ports (waiting for connections) are shown. macOS's own services are listed too; use System Settings to turn them off.")}</p>`);
  },
};
