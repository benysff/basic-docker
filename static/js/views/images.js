"use strict";

/* =====================================================================
   Kalıplar (imajlar): depoya göre gruplu liste, güncelleme denetimi,
   emülasyon uyarısı, eski sürümleri temizleme, indirme ve çalıştırma.
   ===================================================================== */

const UPDATE_PILL = {
  guncel: ["ok", "Güncel"],
  yeni: ["warn", "Yeni sürüm var"],
  yerel: ["off", "Yerel derleme"],
  hata: ["off", "Denetlenemedi"],
};

const ImagesView = {
  filter: "hepsi",
  query: "",

  mount(root) {
    this.root = root;
    this.data = null;
    this.error = null;
    this.open = new Set();
    this.checking = new Set();
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({
          title: T("image", true),
          desc: "Parçaların tarifleri. Bir kalıptan istediğin kadar parça üretilir; ilk kullanımda internetten indirilir.",
          actions: html`
            <button class="btn" data-check-all title="Docker Hub'daki sürümlerle karşılaştır">${icon("update")}Güncellemeleri denetle</button>
            <button class="btn primary" data-pull>${icon("download")}${T("image")} indir</button>`,
        })}
        <section class="stat-row" id="im-stats"></section>
        <div class="toolbar">
          ${searchBox("im-search", `${T("image")} ara…`, this.query)}
          <div id="im-filter"></div>
        </div>
        <div id="im-body">${skeletonRows(10)}</div>
      </div>`);
    root.addEventListener("input", this.onInput = (e) => {
      if (e.target.id === "im-search") { this.query = e.target.value; this.render(); }
    });
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    this.offJob = bus.on("job-done", () => this.load());
    this.load();
  },

  unmount() {
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("click", this.onClick);
    this.offJob();
  },

  async load() {
    try {
      this.data = await api("/api/kaliplar");
      this.error = null;
    } catch (e) { this.error = e.message; }
    this.render();
  },

  groups() {
    const qq = this.query.trim().toLocaleLowerCase("tr");
    let list = this.data.images;
    if (qq) list = list.filter((i) => [i.repo, ...i.tags, i.id].join(" ").toLocaleLowerCase("tr").includes(qq));
    if (this.filter === "kullanilan") list = list.filter((i) => i.in_use);
    if (this.filter === "kullanilmayan") list = list.filter((i) => !i.in_use && !i.dangling);
    if (this.filter === "sahipsiz") list = list.filter((i) => i.dangling);
    if (this.filter === "emule") list = list.filter((i) => i.emulated);
    const map = new Map();
    for (const im of list) {
      const key = im.dangling ? "<sahipsiz>" : im.repo;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(im);
    }
    const groups = [...map.entries()].map(([repo, items]) => {
      items.sort((a, b) => (a.created < b.created ? 1 : -1));
      return {
        repo, items,
        size: items.reduce((n, i) => n + (i.unique_size ?? i.size), 0),
        inUse: items.some((i) => i.in_use),
        running: items.some((i) => i.running),
        newest: items[0].created,
        dangling: repo === "<sahipsiz>",
      };
    });
    groups.sort((a, b) => (a.dangling - b.dangling) || (b.inUse - a.inUse) || a.repo.localeCompare(b.repo, "tr"));
    return groups;
  },

  click(e) {
    const t = e.target;
    const seg = t.closest("[data-seg='im']");
    if (seg) { this.filter = seg.dataset.val; return this.render(); }
    if (t.closest("[data-pull]")) return openPull();
    if (t.closest("[data-check-all]")) return runJob("/api/kalip/denetle-hepsi", {}, () => this.load());
    if (t.closest("[data-retry]")) return this.load();
    const tog = t.closest("[data-toggle-repo]");
    if (tog) {
      const r = tog.dataset.toggleRepo;
      this.open.has(r) ? this.open.delete(r) : this.open.add(r);
      return this.render();
    }
    const act = t.closest("[data-im]");
    if (!act) return;
    const im = this.data.images.find((i) => i.full_id === act.dataset.fid);
    const kind = act.dataset.im;
    if (kind === "prune") return this.pruneRepo(act.dataset.repo);
    if (kind === "sil-grup") return this.removeGroup(act.dataset.repo);
    if (!im) return;
    if (kind === "menu") return Menu.open(act, this.menu(im, act.dataset.ref));
    if (kind === "check") return this.check(act.dataset.ref || im.ref);
    if (kind === "run") return openNew("ozel", { image: act.dataset.ref || im.ref || im.id });
    if (kind === "pull") return runJob("/api/kalip/indir", { ref: act.dataset.ref }, () => this.load());
  },

  menu(im, ref) {
    const r = ref || im.ref;
    return [
      { label: "Bu kalıptan parça çalıştır", icon: "play", onClick: () => openNew("ozel", { image: r || im.id }) },
      r && !im.local_build && { label: "Yeni sürümü denetle", icon: "update", onClick: () => this.check(r) },
      r && !im.local_build && { label: "Yeniden indir (güncelle)", icon: "download", onClick: () => runJob("/api/kalip/indir", { ref: r }, () => this.load()) },
      { label: "İçini incele (katmanlar, ayarlar)", icon: "code", onClick: () => openImageDetail(r || im.full_id) },
      { label: "Kimliği kopyala", icon: "copy", onClick: () => copyText(im.id) },
      "-",
      { label: im.in_use ? "Sil (önce kullanan parçaları sil)" : "Sil…", icon: "trash", danger: true, disabled: im.running,
        onClick: () => this.remove(im, r) },
    ];
  },

  async check(ref) {
    this.checking.add(ref);
    this.render();
    try {
      const res = (await api("/api/kalip/denetle", { ref })).sonuc;
      const im = this.data.images.find((i) => i.tags.includes(ref));
      if (im) im.updates[ref] = res;
      flash(`${ref}: ${res.detail}`, res.status === "hata");
    } catch (e) { flash(e.message, true); }
    this.checking.delete(ref);
    this.render();
  },

  async remove(im, ref) {
    const target = ref || im.full_id;
    const r = await confirmDialog({
      title: `${ref || "Etiketsiz kalıp " + im.id} silinsin mi?`, danger: true, confirmText: "Sil", icon: "trash",
      text: im.in_use
        ? `Bu kalıbı ${im.used_by.map((u) => u.name).join(", ")} kullanıyor. Kalıp, o parçalar silinmeden silinemez.`
        : `${fmt.bytes(im.unique_size ?? im.size)} yer açılır. Gerekirse tekrar indirilebilir.`,
      checkbox: im.in_use ? { label: "Yine de zorla sil", help: "Kapalı parçalar bozulabilir; sadece ne yaptığını biliyorsan." } : null,
    });
    if (!r) return;
    runJob("/api/kalip/sil", { refs: [target], zorla: !!r.checked }, () => this.load());
  },

  async removeGroup(repo) {
    const g = this.groups().find((x) => x.repo === repo);
    if (!g) return;
    const free = g.items.filter((i) => !i.in_use);
    if (!free.length) return flash("Bu gruptaki kalıpların hepsi kullanılıyor.", true);
    const r = await confirmDialog({
      title: repo === "<sahipsiz>" ? "Sahipsiz kalıplar silinsin mi?" : `${repo} kalıpları silinsin mi?`, danger: true, confirmText: `${free.length} kalıbı sil`, icon: "trash",
      text: `Kullanılmayan ${free.length} kalıp silinecek (${fmt.bytes(free.reduce((n, i) => n + (i.unique_size ?? i.size), 0))}). Kullanılanlar kalır.`,
    });
    if (!r) return;
    const refs = free.flatMap((i) => (i.tags.length ? i.tags : [i.full_id]));
    runJob("/api/kalip/sil", { refs }, () => this.load());
  },

  async pruneRepo(repo) {
    // Filtre/aramadan bağımsız: deponun bütün sürümlerine bakılır; en yeni 2'si ve kullanılanlar kalır.
    const all = this.data.images.filter((i) => i.repo === repo && !i.dangling).sort((a, b) => (a.created < b.created ? 1 : -1));
    const victims = all.slice(2).filter((i) => !i.in_use);
    if (!victims.length) return flash("Silinecek eski sürüm yok.");
    const refs = victims.flatMap((i) => i.tags);
    const r = await confirmDialog({
      title: "Eski sürümler temizlensin mi?", confirmText: `${victims.length} eski sürümü sil`, icon: "sparkles",
      text: `${repo} kalıbının en yeni 2 sürümü ve kullanılanlar kalır; ${victims.length} eski sürüm silinir (${fmt.bytes(victims.reduce((n, i) => n + (i.unique_size ?? i.size), 0))}).`,
      extra: html`<p class="muted small mono">${refs.slice(0, 8).join(", ")}${refs.length > 8 ? ` … +${refs.length - 8}` : ""}</p>`,
    });
    if (!r) return;
    runJob("/api/kalip/sil", { refs }, () => this.load());
  },

  render() {
    const body = $("#im-body", this.root);
    if (this.error) return patch(body, errorState(this.error));
    if (!this.data) return;
    const imgs = this.data.images;
    const total = imgs.reduce((n, i) => n + (i.unique_size ?? i.size), 0);
    const unused = imgs.filter((i) => !i.in_use);
    const emu = imgs.filter((i) => i.emulated);
    const newer = imgs.filter((i) => Object.values(i.updates || {}).some((u) => u?.status === "yeni"));
    patch($("#im-stats", this.root), html`
      <div class="stat"><div class="stat-label">${icon("layers")}Toplam</div><div class="stat-value">${imgs.length}<small>${T("image")}</small></div><div class="stat-foot">${fmt.bytes(total)} diskte (yaklaşık)</div></div>
      <button class="stat" data-seg="im" data-val="kullanilmayan"><div class="stat-label">${icon("archive")}Kullanılmayan</div><div class="stat-value">${unused.length}</div><div class="stat-foot">${fmt.bytes(unused.reduce((n, i) => n + (i.unique_size ?? i.size), 0))} boşaltılabilir</div></button>
      <button class="stat ${emu.length ? "attention" : ""}" data-seg="im" data-val="emule"><div class="stat-label">${icon("cpu")}Intel (amd64) kalıbı</div><div class="stat-value">${emu.length}</div><div class="stat-foot">Mac'in ${this.data.host_arch}; bunlar emülasyonla, yavaş çalışır</div></button>
      <div class="stat"><div class="stat-label">${icon("update")}Yeni sürümü olan</div><div class="stat-value">${newer.length}</div><div class="stat-foot">${newer.length ? newer.slice(0, 2).map((i) => i.ref).join(", ") : "Denetlemek için üstteki düğme"}</div></div>`);
    patch($("#im-filter", this.root), segmented("im", [
      { id: "hepsi", label: "Tümü", count: imgs.length },
      { id: "kullanilan", label: "Kullanılan", count: imgs.filter((i) => i.in_use).length },
      { id: "kullanilmayan", label: "Kullanılmayan", count: imgs.filter((i) => !i.in_use && !i.dangling).length },
      { id: "sahipsiz", label: "Sahipsiz", count: imgs.filter((i) => i.dangling).length },
      emu.length ? { id: "emule", label: "Intel", count: emu.length } : null,
    ].filter(Boolean), this.filter));

    const groups = this.groups();
    if (!groups.length) return patch(body, emptyState({ icon: "layers", title: "Eşleşen kalıp yok", compact: true }));
    patch(body, html`
      <div class="table-wrap">
        <table class="table images-table">
          <thead><tr><th>${T("image")}</th><th class="col-md">Kullanan</th><th class="num">Boyut</th><th class="col-lg">Oluşturulma</th><th class="col-md">Durum</th><th class="actions-col"><span class="sr">İşlemler</span></th></tr></thead>
          <tbody>${groups.map((g) => (g.items.length > 1 || g.dangling ? this.groupRows(g) : this.imageRow(g.items[0], false)))}</tbody>
        </table>
      </div>`);
  },

  groupRows(g) {
    const open = this.open.has(g.repo) || !!this.query;
    const title = g.dangling ? "Sahipsiz kalıplar" : g.repo;
    return html`
      <tr class="group-row ${open ? "open" : ""}">
        <td><button class="group-toggle" data-toggle-repo="${g.repo}" aria-expanded="${open}">
          ${icon(open ? "chevronDown" : "chevronRight")}
          <span class="strong mono">${title}</span>
          <span class="pill">${g.items.length} sürüm</span>
          ${g.dangling ? hintIcon("Adı (etiketi) kalmamış eski kalıp sürümleri. Genelde aynı adla yeni sürüm indirilince/derlenince oluşur. Silmek güvenlidir.") : ""}
        </button></td>
        <td class="col-md">${g.inUse ? badge(g.running ? "ok" : "off", g.running ? "Kullanılıyor" : "Kapalı parçada") : html`<span class="muted small">Kullanılmıyor</span>`}</td>
        <td class="num mono small">${fmt.bytes(g.size)}</td>
        <td class="col-lg small muted">${fmt.ago(g.newest)}</td>
        <td class="col-md"></td>
        <td class="actions-col"><div class="row-actions">
          ${!g.dangling && this.data.images.filter((i) => i.repo === g.repo && !i.dangling).length > 2 ? html`<button class="btn sm" data-im="prune" data-repo="${g.repo}" title="En yeni 2 sürüm ve kullanılanlar kalır">${icon("sparkles")}Eskileri temizle</button>` : ""}
          ${g.items.some((i) => !i.in_use) ? html`<button class="icon-btn sm" data-im="sil-grup" data-repo="${g.repo}" aria-label="Kullanılmayanları sil" title="Kullanılmayanları sil">${icon("trash")}</button>` : ""}
        </div></td>
      </tr>
      ${open ? g.items.map((im) => this.imageRow(im, true)) : ""}`;
  },

  imageRow(im, nested) {
    const ref = im.ref;
    const upd = ref && im.updates?.[ref];
    const tag = im.dangling ? html`<span class="mono muted">${im.id}</span>` : nested
      ? html`<span class="mono">${im.tag_names.join(", ")}</span>`
      : html`<span class="strong mono">${im.repo}</span><span class="mono muted">:${im.tag_names.join(", ")}</span>`;
    return html`
      <tr class="${nested ? "nested" : ""}">
        <td><div class="cell-main">
          ${nested ? "" : html`<div class="kind-tile sm">${icon("layers")}</div>`}
          <div class="min0">
            <div class="ellipsis">${tag}</div>
            <div class="small muted">
              ${im.emulated ? html`<span class="pill warn" title="Mac'in ${this.data.host_arch}; bu kalıp ${im.arch} için. Emülasyonla, yavaş çalışır.">${icon("cpu")}${im.arch} · emülasyon</span>` : html`<span class="mono">${im.arch}</span>`}
              ${im.local_build ? html` · <span>yerelde derlendi</span>` : ""}
            </div>
          </div>
        </div></td>
        <td class="col-md">${im.used_by.length ? html`<div class="chips nowrap">${im.used_by.slice(0, 1).map((u) => html`
          <a class="chip" href="${link(`/parca/${u.id}`)}" title="${u.app_name} · ${u.role}">${dot(u.running ? "ok" : "off")}<span class="ellipsis cell-clip-sm">${u.app_name && u.app_name !== u.name ? u.app_name : u.name}</span></a>`)}
          ${im.used_by.length > 1 ? html`<span class="muted small" title="${im.used_by.slice(1).map((u) => u.name).join(", ")}">+${im.used_by.length - 1}</span>` : ""}</div>` : html`<span class="muted small">—</span>`}</td>
        <td class="num mono small" title="${im.unique_size !== null ? `Toplam ${fmt.bytes(im.size)} · başka kalıplarla paylaşılmayan kısmı ${fmt.bytes(im.unique_size)} (silince açılacak yer)` : ""}">${fmt.bytes(im.size)}</td>
        <td class="col-lg small muted">${fmt.ago(im.created)}</td>
        <td class="col-md">${this.checking.has(ref) ? html`<span class="busy-inline"><span class="spinner"></span>Denetleniyor</span>`
          : upd ? html`<span title="${upd.detail}">${badge(UPDATE_PILL[upd.status]?.[0] || "off", UPDATE_PILL[upd.status]?.[1] || "")}</span>` : ""}</td>
        <td class="actions-col"><div class="row-actions">
          ${upd?.status === "yeni" ? html`<button class="btn sm" data-im="pull" data-fid="${im.full_id}" data-ref="${ref}" title="Yeni sürümü indir">${icon("download")}Güncelle</button>` : ""}
          <button class="icon-btn sm" data-im="run" data-fid="${im.full_id}" data-ref="${ref || ""}" aria-label="Çalıştır" title="Bu kalıptan parça çalıştır">${icon("play")}</button>
          <button class="icon-btn sm" data-im="menu" data-fid="${im.full_id}" data-ref="${ref || ""}" aria-label="Diğer işlemler" aria-haspopup="menu">${icon("more")}</button>
        </div></td>
      </tr>`;
  },
};
