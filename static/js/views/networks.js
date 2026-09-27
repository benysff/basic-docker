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
          desc: L("Aynı ağdaki parçalar birbirine adıyla ulaşır (ör. postgres://db:5432). Farklı ağdakiler birbirini göremez.",
            "Containers on the same network reach each other by name (e.g. postgres://db:5432). Containers on different networks can't see each other."),
          actions: html`<button class="btn primary" data-create>${icon("plus")}${L(`${T("network")} oluştur`, "Create network")}</button>`,
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
      title: L(`Yeni ${Tl("network")}`, "New network"), label: L("Ad", "Name"), placeholder: L("proje-agi", "project-net"), confirmText: L("Oluştur", "Create"),
      help: L("Aynı ağa bağladığın parçalar birbirini adıyla bulur.", "Containers you connect to the same network find each other by name."),
      validate: (v) => (/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(v) ? "" : L("Geçerli bir ad yaz.", "Enter a valid name.")),
    });
    if (!name) return;
    try { await api("/api/ag/olustur", { ad: name }); flash(L(`${name} oluşturuldu`, `${name} created`)); this.load(); } catch (e) { flash(e.message, true); }
  },

  async remove(n) {
    const r = await confirmDialog({ title: L(`${n.name} silinsin mi?`, `Delete ${n.name}?`), danger: true, confirmText: L("Sil", "Delete"), icon: "trash",
      text: n.containers.length ? L("Bu ağa bağlı parçalar var; önce onları çıkarman gerekir.", "Containers are connected to this network; disconnect them first.")
        : L("Ağ silinir. Parçalara ve verilere dokunulmaz.", "The network is deleted. Containers and data are not touched.") });
    if (!r) return;
    try { await api("/api/ag/sil", { ad: n.name }); flash(L("Ağ silindi", "Network deleted")); this.load(); } catch (e) { flash(e.message, true); }
  },

  async disconnect(n, member) {
    const r = await confirmDialog({ title: L(`${member} bu ağdan çıkarılsın mı?`, `Disconnect ${member} from this network?`), confirmText: L("Çıkar", "Disconnect"), icon: "unlink",
      text: L(`${member}, ${n.name} ağındaki diğer parçalara artık adıyla ulaşamaz.`, `${member} will no longer reach the other containers on ${n.name} by name.`) });
    if (!r) return;
    try { await api("/api/ag/bagla", { ag: n.name, parca: member, bagla: false }); flash(L("Çıkarıldı", "Disconnected")); this.load(); } catch (e) { flash(e.message, true); }
  },

  card(n) {
    return html`
      <article class="net-card ${n.containers.length ? "" : "empty"}">
        <header class="net-head">
          <div class="kind-tile sm ${n.containers.some((m) => m.running) ? "lvl-ok" : ""}">${icon("network")}</div>
          <div class="min0 grow">
            <div class="strong mono ellipsis" title="${n.name}">${n.name}</div>
            <div class="muted small">${n.app_name ? html`${findApp(n.app) ? html`<a href="${link(`/uygulama/${n.app}`)}">${n.app_name}</a>` : n.app_name} · ` : ""}${n.driver}${n.subnet ? html` · <span class="mono">${n.subnet}</span>` : ""}${n.internal ? L(" · internete kapalı", " · no internet") : ""}</div>
          </div>
          <div class="row-actions">
            ${n.name !== "host" && n.name !== "none" ? html`<button class="icon-btn sm" data-net="connect" data-name="${n.name}" aria-label="${L("Parça bağla", "Connect a container")}" title="${L("Parça bağla", "Connect a container")}">${icon("link")}</button>` : ""}
            ${n.builtin ? "" : html`<button class="icon-btn sm" data-net="delete" data-name="${n.name}" aria-label="${L("Sil", "Delete")}" title="${L("Sil", "Delete")}">${icon("trash")}</button>`}
          </div>
        </header>
        ${n.desc ? html`<p class="muted small">${n.desc}</p>` : ""}
        ${n.containers.length ? html`<ul class="net-members">${n.containers.map((m) => html`
          <li>
            ${dot(m.running ? "ok" : "off")}
            ${findContainer(m.id) ? html`<a class="ellipsis" href="${link(`/parca/${m.id}`)}">${m.role ? shortRole(m.role) : m.name}</a>` : html`<span class="ellipsis">${m.name}</span>`}
            <span class="mono muted small ellipsis">${m.name}</span>
            <span class="mono small">${m.ip}</span>
            <button class="icon-btn xs" data-net="disconnect" data-name="${n.name}" data-member="${m.name}" aria-label="${L(`${m.name} ağdan çıkar`, `Disconnect ${m.name}`)}" title="${L("Ağdan çıkar", "Disconnect")}">${icon("close")}</button>
          </li>`)}</ul>`
          : html`<p class="muted small">${L(`Şu an bağlı çalışan ${Tl("container")} yok.`, "No running containers are connected right now.")}${n.builtin ? "" : L(" Kullanılmıyorsa silebilirsin.", " You can delete it if it's not used.")}</p>`}
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
      ${callout({ level: "tip", title: L("Ağ neden önemli?", "Why do networks matter?"), text: isEN()
        ? raw("If you type <code>localhost</code> inside a container, you reach that container itself. To reach another container it must be on the same network and you must use its <b>name</b> (e.g. <code>db</code>, <code>redis</code>). The names a container can be found by are listed in the “Network and addresses” box on its page.")
        : raw(`Bir parçanın içinden <code>localhost</code> yazarsan o parçanın kendisine gidersin. Diğer parçaya ulaşmak için aynı ağda olmalı ve onun <b>adını</b> kullanmalısın (ör. <code>db</code>, <code>redis</code>). Bir parçanın hangi adlarla bulunabildiği, parça sayfasındaki “Ağ ve adresler” kutusunda yazar.`) })}
      ${active.length ? html`<section class="section"><h2 class="section-title">${L("Kullanımda", "In use")} <span>${active.length}</span></h2><div class="net-grid">${active.map((n) => this.card(n))}</div></section>` : ""}
      ${idle.length ? html`<section class="section"><h2 class="section-title">${L("Şu an boş", "Empty right now")} <span>${idle.length}</span>${hintIcon(L("Bu ağlara bağlı çalışan parça yok. Genelde kapalı projelere aittir; proje başlayınca yeniden dolar.", "No running containers are connected to these. They usually belong to stopped projects and fill up again when the project starts."))}</h2><div class="net-grid">${idle.map((n) => this.card(n))}</div></section>` : ""}
      <section class="section">
        <button class="section-title toggle" data-toggle-builtin aria-expanded="${this.showBuiltin}">${icon(this.showBuiltin ? "chevronDown" : "chevronRight")}${L("Docker'ın kendi ağları", "Docker's built-in networks")} <span>${builtin.length}</span></button>
        ${this.showBuiltin ? html`<div class="net-grid">${builtin.map((n) => this.card(n))}</div>` : ""}
      </section>`);
  },
};
