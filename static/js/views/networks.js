"use strict";

/* =====================================================================
   Ağlar: hangi parça hangi ağda, hangi adresle? Oluştur, bağla, sil.
   ===================================================================== */

const NetworksView = {
  mount(root) {
    this.root = root;
    this.nets = null;
    this.error = null;
    this.showBuiltin = false;
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({
          title: T("network", true),
          desc: "Aynı ağdaki parçalar birbirine adıyla ulaşır (ör. postgres://db:5432). Farklı ağdakiler birbirini göremez.",
          actions: html`<button class="btn primary" data-create>${icon("plus")}${T("network")} oluştur</button>`,
        })}
        <div id="nw-body">${skeletonRows(6)}</div>
      </div>`);
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    this.offData = bus.on("job-done", () => this.load());
    this.load();
  },

  unmount() {
    this.root.removeEventListener("click", this.onClick);
    this.offData();
  },

  async load() {
    try { this.nets = (await api("/api/aglar")).aglar; this.error = null; } catch (e) { this.error = e.message; }
    this.render();
  },

  click(e) {
    const t = e.target;
    if (t.closest("[data-retry]")) return this.load();
    if (t.closest("[data-create]")) return this.create();
    if (t.closest("[data-toggle-builtin]")) { this.showBuiltin = !this.showBuiltin; return this.render(); }
    const a = t.closest("[data-net]");
    if (!a) return;
    const n = this.nets.find((x) => x.name === a.dataset.name);
    if (!n) return;
    if (a.dataset.net === "connect") return openConnectNetwork(n, () => this.load());
    if (a.dataset.net === "delete") return this.remove(n);
    if (a.dataset.net === "disconnect") return this.disconnect(n, a.dataset.member);
  },

  async create() {
    const name = await promptDialog({
      title: `Yeni ${Tl("network")}`, label: "Ad", placeholder: "proje-agi", confirmText: "Oluştur",
      help: "Aynı ağa bağladığın parçalar birbirini adıyla bulur.",
      validate: (v) => (/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(v) ? "" : "Geçerli bir ad yaz."),
    });
    if (!name) return;
    try { await api("/api/ag/olustur", { ad: name }); flash(`${name} oluşturuldu`); this.load(); } catch (e) { flash(e.message, true); }
  },

  async remove(n) {
    const r = await confirmDialog({ title: `${n.name} silinsin mi?`, danger: true, confirmText: "Sil", icon: "trash",
      text: n.containers.length ? "Bu ağa bağlı parçalar var; önce onları çıkarman gerekir." : "Ağ silinir. Parçalara ve verilere dokunulmaz." });
    if (!r) return;
    try { await api("/api/ag/sil", { ad: n.name }); flash("Ağ silindi"); this.load(); } catch (e) { flash(e.message, true); }
  },

  async disconnect(n, member) {
    const r = await confirmDialog({ title: `${member} bu ağdan çıkarılsın mı?`, confirmText: "Çıkar", icon: "unlink",
      text: `${member}, ${n.name} ağındaki diğer parçalara artık adıyla ulaşamaz.` });
    if (!r) return;
    try { await api("/api/ag/bagla", { ag: n.name, parca: member, bagla: false }); flash("Çıkarıldı"); this.load(); } catch (e) { flash(e.message, true); }
  },

  card(n) {
    return html`
      <article class="net-card ${n.containers.length ? "" : "empty"}">
        <header class="net-head">
          <div class="kind-tile sm ${n.containers.some((m) => m.running) ? "lvl-ok" : ""}">${icon("network")}</div>
          <div class="min0 grow">
            <div class="strong mono ellipsis" title="${n.name}">${n.name}</div>
            <div class="muted small">${n.app_name ? html`${findApp(n.app) ? html`<a href="${link(`/uygulama/${n.app}`)}">${n.app_name}</a>` : n.app_name} · ` : ""}${n.driver}${n.subnet ? html` · <span class="mono">${n.subnet}</span>` : ""}${n.internal ? " · internete kapalı" : ""}</div>
          </div>
          <div class="row-actions">
            ${n.name !== "host" && n.name !== "none" ? html`<button class="icon-btn sm" data-net="connect" data-name="${n.name}" aria-label="Parça bağla" title="Parça bağla">${icon("link")}</button>` : ""}
            ${n.builtin ? "" : html`<button class="icon-btn sm" data-net="delete" data-name="${n.name}" aria-label="Sil" title="Sil">${icon("trash")}</button>`}
          </div>
        </header>
        ${n.desc ? html`<p class="muted small">${n.desc}</p>` : ""}
        ${n.containers.length ? html`<ul class="net-members">${n.containers.map((m) => html`
          <li>
            ${dot(m.running ? "ok" : "off")}
            ${findContainer(m.id) ? html`<a class="ellipsis" href="${link(`/parca/${m.id}`)}">${m.role ? shortRole(m.role) : m.name}</a>` : html`<span class="ellipsis">${m.name}</span>`}
            <span class="mono muted small ellipsis">${m.name}</span>
            <span class="mono small">${m.ip}</span>
            <button class="icon-btn xs" data-net="disconnect" data-name="${n.name}" data-member="${m.name}" aria-label="${m.name} ağdan çıkar" title="Ağdan çıkar">${icon("close")}</button>
          </li>`)}</ul>`
          : html`<p class="muted small">Şu an bağlı çalışan ${Tl("container")} yok.${n.builtin ? "" : " Kullanılmıyorsa silebilirsin."}</p>`}
      </article>`;
  },

  render() {
    const body = $("#nw-body", this.root);
    if (this.error) return patch(body, errorState(this.error));
    if (!this.nets) return;
    const custom = this.nets.filter((n) => !n.builtin);
    const builtin = this.nets.filter((n) => n.builtin);
    const active = custom.filter((n) => n.containers.length);
    const idle = custom.filter((n) => !n.containers.length);
    patch(body, html`
      ${callout({ level: "tip", title: "Ağ neden önemli?", text: raw(`Bir parçanın içinden <code>localhost</code> yazarsan o parçanın kendisine gidersin. Diğer parçaya ulaşmak için aynı ağda olmalı ve onun <b>adını</b> kullanmalısın (ör. <code>db</code>, <code>redis</code>). Bir parçanın hangi adlarla bulunabildiği, parça sayfasındaki “Ağ ve adresler” kutusunda yazar.`) })}
      ${active.length ? html`<section class="section"><h2 class="section-title">Kullanımda <span>${active.length}</span></h2><div class="net-grid">${active.map((n) => this.card(n))}</div></section>` : ""}
      ${idle.length ? html`<section class="section"><h2 class="section-title">Şu an boş <span>${idle.length}</span>${hintIcon("Bu ağlara bağlı çalışan parça yok. Genelde kapalı projelere aittir; proje başlayınca yeniden dolar.")}</h2><div class="net-grid">${idle.map((n) => this.card(n))}</div></section>` : ""}
      <section class="section">
        <button class="section-title toggle" data-toggle-builtin aria-expanded="${this.showBuiltin}">${icon(this.showBuiltin ? "chevronDown" : "chevronRight")}Docker'ın kendi ağları <span>${builtin.length}</span></button>
        ${this.showBuiltin ? html`<div class="net-grid">${builtin.map((n) => this.card(n))}</div>` : ""}
      </section>`);
  },
};
