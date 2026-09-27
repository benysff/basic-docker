"use strict";

/* =====================================================================
   Kalıplar (imajlar): depoya göre gruplu liste, güncelleme denetimi,
   emülasyon uyarısı, eski sürümleri temizleme, indirme ve çalıştırma.
   ===================================================================== */

const UPDATE_PILL = {
  guncel: ["ok", "Güncel", "Up to date"],
  yeni: ["warn", "Yeni sürüm var", "Update available"],
  yerel: ["off", "Yerel derleme", "Local build"],
  hata: ["off", "Denetlenemedi", "Couldn't check"],
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
          desc: L("Parçaların tarifleri. Bir kalıptan istediğin kadar parça üretilir; ilk kullanımda internetten indirilir.",
            "Recipes for containers. You can create as many containers as you like from one image; it is downloaded the first time it is used."),
          actions: html`
            <button class="btn" data-check-all title="${L("Docker Hub'daki sürümlerle karşılaştır", "Compare with the versions on Docker Hub")}">${icon("update")}${L("Güncellemeleri denetle", "Check for updates")}</button>
            <button class="btn primary" data-pull>${icon("download")}${L(`${T("image")} indir`, "Pull image")}</button>`,
        })}
        <section class="stat-row" id="im-stats"></section>
        <div class="toolbar">
          ${searchBox("im-search", L(`${T("image")} ara…`, "Search images…"), this.query)}
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
    const qq = fold(this.query.trim());
    let list = this.data.images;
    if (qq) list = list.filter((i) => fold([i.repo, ...i.tags, i.id].join(" ")).includes(qq));
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
      { label: L("Bu kalıptan parça çalıştır", "Run a container from this image"), icon: "play", unsafe: true, onClick: () => openNew("ozel", { image: r || im.id }) },
      r && !im.local_build && { label: L("Yeni sürümü denetle", "Check for a new version"), icon: "update", onClick: () => this.check(r) },
      r && !im.local_build && { label: L("Yeniden indir (güncelle)", "Pull again (update)"), icon: "download", unsafe: true, onClick: () => runJob("/api/kalip/indir", { ref: r }, () => this.load()) },
      { label: L("İçini incele (katmanlar, ayarlar)", "Inspect (layers, settings)"), icon: "code", onClick: () => openImageDetail(r || im.full_id) },
      { label: L("Kimliği kopyala", "Copy ID"), icon: "copy", onClick: () => copyText(im.id) },
      "-",
      { label: im.in_use ? L("Sil (önce kullanan parçaları sil)", "Delete (delete the containers using it first)") : L("Sil…", "Delete…"), icon: "trash", danger: true, disabled: im.running,
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
      title: L(`${ref || "Etiketsiz kalıp " + im.id} silinsin mi?`, `Delete ${ref || "untagged image " + im.id}?`), danger: true, confirmText: L("Sil", "Delete"), icon: "trash",
      text: im.in_use
        ? L(`Bu kalıbı ${im.used_by.map((u) => u.name).join(", ")} kullanıyor. Kalıp, o parçalar silinmeden silinemez.`,
          `${im.used_by.map((u) => u.name).join(", ")} use this image. It cannot be deleted before those containers are.`)
        : L(`${fmt.bytes(im.unique_size ?? im.size)} yer açılır. Gerekirse tekrar indirilebilir.`, `Frees ${fmt.bytes(im.unique_size ?? im.size)}. You can pull it again if needed.`),
      checkbox: im.in_use ? { label: L("Yine de zorla sil", "Force delete anyway"), help: L("Kapalı parçalar bozulabilir; sadece ne yaptığını biliyorsan.", "Stopped containers may break; only if you know what you are doing.") } : null,
    });
    if (!r) return;
    runJob("/api/kalip/sil", { refs: [target], zorla: !!r.checked }, () => this.load());
  },

  async removeGroup(repo) {
    const g = this.groups().find((x) => x.repo === repo);
    if (!g) return;
    const free = g.items.filter((i) => !i.in_use);
    if (!free.length) return flash(L("Bu gruptaki kalıpların hepsi kullanılıyor.", "Every image in this group is in use."), true);
    const r = await confirmDialog({
      title: repo === "<sahipsiz>" ? L("Sahipsiz kalıplar silinsin mi?", "Delete dangling images?") : L(`${repo} kalıpları silinsin mi?`, `Delete ${repo} images?`), danger: true,
      confirmText: L(`${free.length} kalıbı sil`, `Delete ${plural(free.length, "image")}`), icon: "trash",
      text: L(`Kullanılmayan ${free.length} kalıp silinecek (${fmt.bytes(free.reduce((n, i) => n + (i.unique_size ?? i.size), 0))}). Kullanılanlar kalır.`,
        `${plural(free.length, "unused image")} will be deleted (${fmt.bytes(free.reduce((n, i) => n + (i.unique_size ?? i.size), 0))}). Images in use stay.`),
    });
    if (!r) return;
    const refs = free.flatMap((i) => (i.tags.length ? i.tags : [i.full_id]));
    runJob("/api/kalip/sil", { refs }, () => this.load());
  },

  async pruneRepo(repo) {
    // Filtre/aramadan bağımsız: deponun bütün sürümlerine bakılır; en yeni 2'si ve kullanılanlar kalır.
    const all = this.data.images.filter((i) => i.repo === repo && !i.dangling).sort((a, b) => (a.created < b.created ? 1 : -1));
    const victims = all.slice(2).filter((i) => !i.in_use);
    if (!victims.length) return flash(L("Silinecek eski sürüm yok.", "No old versions to delete."));
    const refs = victims.flatMap((i) => i.tags);
    const r = await confirmDialog({
      title: L("Eski sürümler temizlensin mi?", "Clean up old versions?"), confirmText: L(`${victims.length} eski sürümü sil`, `Delete ${plural(victims.length, "old version")}`), icon: "sparkles",
      text: L(`${repo} kalıbının en yeni 2 sürümü ve kullanılanlar kalır; ${victims.length} eski sürüm silinir (${fmt.bytes(victims.reduce((n, i) => n + (i.unique_size ?? i.size), 0))}).`,
        `The 2 newest versions of ${repo} and the ones in use stay; ${plural(victims.length, "old version")} will be deleted (${fmt.bytes(victims.reduce((n, i) => n + (i.unique_size ?? i.size), 0))}).`),
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
      <div class="stat"><div class="stat-label">${icon("layers")}${L("Toplam", "Total")}</div><div class="stat-value">${imgs.length}<small>${isEN() ? "images" : T("image")}</small></div><div class="stat-foot">${L(`${fmt.bytes(total)} diskte (yaklaşık)`, `about ${fmt.bytes(total)} on disk`)}</div></div>
      <button class="stat" data-seg="im" data-val="kullanilmayan"><div class="stat-label">${icon("archive")}${L("Kullanılmayan", "Unused")}</div><div class="stat-value">${unused.length}</div><div class="stat-foot">${L(`${fmt.bytes(unused.reduce((n, i) => n + (i.unique_size ?? i.size), 0))} boşaltılabilir`, `${fmt.bytes(unused.reduce((n, i) => n + (i.unique_size ?? i.size), 0))} can be freed`)}</div></button>
      <button class="stat ${emu.length ? "attention" : ""}" data-seg="im" data-val="emule"><div class="stat-label">${icon("cpu")}${L("Başka işlemci için", "For another CPU")}</div><div class="stat-value">${emu.length}</div><div class="stat-foot">${L(`${archWho()} ${this.data.host_arch}; bunlar emülasyonla, yavaş çalışır`, `${archWho()} ${this.data.host_arch}; these run slowly under emulation`)}</div></button>
      <div class="stat"><div class="stat-label">${icon("update")}${L("Yeni sürümü olan", "With updates")}</div><div class="stat-value">${newer.length}</div><div class="stat-foot">${newer.length ? newer.slice(0, 2).map((i) => i.ref).join(", ") : L("Denetlemek için üstteki düğme", "Use the button above to check")}</div></div>`);
    patch($("#im-filter", this.root), segmented("im", [
      { id: "hepsi", label: L("Tümü", "All"), count: imgs.length },
      { id: "kullanilan", label: L("Kullanılan", "In use"), count: imgs.filter((i) => i.in_use).length },
      { id: "kullanilmayan", label: L("Kullanılmayan", "Unused"), count: imgs.filter((i) => !i.in_use && !i.dangling).length },
      { id: "sahipsiz", label: L("Sahipsiz", "Dangling"), count: imgs.filter((i) => i.dangling).length },
      emu.length ? { id: "emule", label: L("Emülasyonla", "Emulated"), count: emu.length } : null,
    ].filter(Boolean), this.filter));

    const groups = this.groups();
    if (!groups.length) return patch(body, emptyState({ icon: "layers", title: L("Eşleşen kalıp yok", "No matching images"), compact: true }));
    patch(body, html`
      <div class="table-wrap">
        <table class="table images-table">
          <thead><tr><th>${T("image")}</th><th class="col-md">${L("Kullanan", "Used by")}</th><th class="num">${L("Boyut", "Size")}</th><th class="col-lg">${L("Oluşturulma", "Created")}</th><th class="col-md">${L("Durum", "Status")}</th><th class="actions-col"><span class="sr">${L("İşlemler", "Actions")}</span></th></tr></thead>
          <tbody>${groups.map((g) => (g.items.length > 1 || g.dangling ? this.groupRows(g) : this.imageRow(g.items[0], false)))}</tbody>
        </table>
      </div>`);
  },

  groupRows(g) {
    const open = this.open.has(g.repo) || !!this.query;
    const title = g.dangling ? L("Sahipsiz kalıplar", "Dangling images") : g.repo;
    return html`
      <tr class="group-row ${open ? "open" : ""}">
        <td><button class="group-toggle" data-toggle-repo="${g.repo}" aria-expanded="${open}">
          ${icon(open ? "chevronDown" : "chevronRight")}
          <span class="strong mono">${title}</span>
          <span class="pill">${L(`${g.items.length} sürüm`, plural(g.items.length, "version"))}</span>
          ${g.dangling ? hintIcon(L("Adı (etiketi) kalmamış eski kalıp sürümleri. Genelde aynı adla yeni sürüm indirilince/derlenince oluşur. Silmek güvenlidir.", "Old image versions that lost their name (tag). They appear when a new version with the same name is pulled or built. Safe to delete.")) : ""}
        </button></td>
        <td class="col-md">${g.inUse ? badge(g.running ? "ok" : "off", g.running ? L("Kullanılıyor", "In use") : L("Kapalı parçada", "In a stopped container")) : html`<span class="muted small">${L("Kullanılmıyor", "Unused")}</span>`}</td>
        <td class="num mono small">${fmt.bytes(g.size)}</td>
        <td class="col-lg small muted">${fmt.ago(g.newest)}</td>
        <td class="col-md"></td>
        <td class="actions-col"><div class="row-actions">
          ${!g.dangling && this.data.images.filter((i) => i.repo === g.repo && !i.dangling).length > 2 ? html`<button class="btn sm" data-im="prune" data-repo="${g.repo}" title="${L("En yeni 2 sürüm ve kullanılanlar kalır", "The 2 newest versions and the ones in use stay")}">${icon("sparkles")}${L("Eskileri temizle", "Clean up old")}</button>` : ""}
          ${g.items.some((i) => !i.in_use) ? html`<button class="icon-btn sm" data-im="sil-grup" data-repo="${g.repo}" aria-label="${L("Kullanılmayanları sil", "Delete unused")}" title="${L("Kullanılmayanları sil", "Delete unused")}">${icon("trash")}</button>` : ""}
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
              ${im.emulated ? html`<span class="pill warn" title="${L(`${archWho()} ${this.data.host_arch}; bu kalıp ${im.arch} için. Emülasyonla, yavaş çalışır.`, `${archWho()} ${this.data.host_arch}; this image is for ${im.arch}. It runs slowly under emulation.`)}">${icon("cpu")}${im.arch} · ${L("emülasyon", "emulated")}</span>` : html`<span class="mono">${im.arch}</span>`}
              ${im.local_build ? html` · <span>${L("yerelde derlendi", "built locally")}</span>` : ""}
            </div>
          </div>
        </div></td>
        <td class="col-md">${im.used_by.length ? html`<div class="chips nowrap">${im.used_by.slice(0, 1).map((u) => html`
          <a class="chip" href="${link(`/parca/${u.id}`)}" title="${u.app_name} · ${u.role}">${dot(u.running ? "ok" : "off")}<span class="ellipsis cell-clip-sm">${u.app_name && u.app_name !== u.name ? u.app_name : u.name}</span></a>`)}
          ${im.used_by.length > 1 ? html`<span class="muted small" title="${im.used_by.slice(1).map((u) => u.name).join(", ")}">+${im.used_by.length - 1}</span>` : ""}</div>` : html`<span class="muted small">—</span>`}</td>
        <td class="num mono small" title="${im.unique_size !== null ? L(`Toplam ${fmt.bytes(im.size)} · başka kalıplarla paylaşılmayan kısmı ${fmt.bytes(im.unique_size)} (silince açılacak yer)`, `Total ${fmt.bytes(im.size)} · not shared with other images: ${fmt.bytes(im.unique_size)} (freed if deleted)`) : ""}">${fmt.bytes(im.size)}</td>
        <td class="col-lg small muted">${fmt.ago(im.created)}</td>
        <td class="col-md">${this.checking.has(ref) ? html`<span class="busy-inline"><span class="spinner"></span>${L("Denetleniyor", "Checking")}</span>`
          : upd ? html`<span title="${upd.detail}">${badge(UPDATE_PILL[upd.status]?.[0] || "off", UPDATE_PILL[upd.status] ? L(UPDATE_PILL[upd.status][1], UPDATE_PILL[upd.status][2]) : "")}</span>` : ""}</td>
        <td class="actions-col"><div class="row-actions">
          ${upd?.status === "yeni" ? html`<button class="btn sm" data-im="pull" data-fid="${im.full_id}" data-ref="${ref}" title="${L("Yeni sürümü indir", "Pull the new version")}">${icon("download")}${L("Güncelle", "Update")}</button>` : ""}
          <button class="icon-btn sm" data-im="run" data-fid="${im.full_id}" data-ref="${ref || ""}" aria-label="${L("Çalıştır", "Run")}" title="${L("Bu kalıptan parça çalıştır", "Run a container from this image")}">${icon("play")}</button>
          <button class="icon-btn sm" data-im="menu" data-fid="${im.full_id}" data-ref="${ref || ""}" aria-label="${L("Diğer işlemler", "More actions")}" aria-haspopup="menu">${icon("more")}</button>
        </div></td>
      </tr>`;
  },
};
