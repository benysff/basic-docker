"use strict";

/* =====================================================================
   Parçalar (konteynerler): hepsi tek tabloda, toplu işlemler, sıralama.
   ===================================================================== */

const ContainersView = {
  filter: "hepsi",
  query: "",
  sort: { key: "app", dir: 1 },

  mount(root) {
    this.root = root;
    this.selected = new Set();
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({
          title: T("container", true),
          desc: L("Bütün parçalar tek listede. Birden fazlasını seçip hepsini birlikte başlatabilir, durdurabilir ya da silebilirsin.",
            "Every container in one list. Select several to start, stop or delete them together."),
          actions: html`<button class="btn primary" data-global="yeni">${icon("plus")}${L("Yeni ekle", "Add new")}</button>`,
        })}
        <div class="toolbar">
          ${searchBox("ct-search", L(`${T("container")}, ${Tl("image")} ya da ${Tl("app")} ara…`, "Search containers, images or apps…"), this.query)}
          <div id="ct-filter"></div>
        </div>
        <div id="ct-bulk"></div>
        <div id="ct-body">${skeletonRows(10)}</div>
      </div>`);
    root.addEventListener("input", this.onInput = (e) => {
      if (e.target.id === "ct-search") { this.query = e.target.value; this.render(); }
    });
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    root.addEventListener("change", this.onChange = (e) => this.change(e));
    this.offData = bus.on("data", () => this.render());
    this.offStats = bus.on("stats", () => this.render());
    startStats(this);
    this.render();
  },

  unmount() {
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
    this.offData();
    this.offStats();
    stopStats(this);
  },

  list() {
    const qq = this.query.trim().toLocaleLowerCase(loc());
    let list = allContainers();
    if (qq) list = list.filter((c) => [c.name, c.image, c.role_title, c.app.name, c.service].join(" ").toLocaleLowerCase(loc()).includes(qq));
    if (this.filter === "calisan") list = list.filter((c) => c.running);
    if (this.filter === "kapali") list = list.filter((c) => !c.running);
    if (this.filter === "sorunlu") list = list.filter((c) => c.level === "err" || c.state === "restarting");
    const { key, dir } = this.sort;
    const val = (c) => {
      const s = S.stats[c.name];
      switch (key) {
        case "name": return c.role_title + c.name;
        case "state": return (c.running ? 0 : 1) + c.status_text;
        case "image": return c.image;
        case "cpu": return s && c.running ? s.cpu : -1;
        case "mem": return s && c.running ? s.mem : -1;
        case "time": return fmt._t(c.running ? c.started_at : c.finished_at) || 0;
        default: return (c.app.source === "system" ? "2" : c.app.source === "single" ? "1" : "0") + c.app.name.toLocaleLowerCase("tr") + " " + c.name;
      }
    };
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "tr")) * dir;
    });
  },

  click(e) {
    const t = e.target;
    const seg = t.closest("[data-seg='ct']");
    if (seg) { this.filter = seg.dataset.val; return this.render(); }
    const th = t.closest("[data-sort]");
    if (th) {
      const k = th.dataset.sort;
      this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : (["cpu", "mem", "time"].includes(k) ? -1 : 1) };
      return this.render();
    }
    const bulk = t.closest("[data-bulk]");
    if (bulk) return this.bulk(bulk.dataset.bulk);
    if (t.closest("[data-clear-sel]")) { this.selected.clear(); return this.render(); }
    const cact = t.closest("[data-cact]");
    if (cact) { e.stopPropagation(); return containerAction(cact.dataset.id, cact.dataset.cact, cact); }
    if (t.closest("a, button, input, label")) return;
    const row = t.closest("[data-open-part]");
    if (row) Router.go(`/parca/${encodeURIComponent(row.dataset.openPart)}`);
  },

  change(e) {
    const t = e.target;
    if (t.matches("[data-sel]")) {
      t.checked ? this.selected.add(t.dataset.sel) : this.selected.delete(t.dataset.sel);
      this.render();
    }
    if (t.matches("[data-sel-all]")) {
      const ids = this.list().map((c) => c.id);
      if (t.checked) ids.forEach((id) => this.selected.add(id)); else ids.forEach((id) => this.selected.delete(id));
      this.render();
    }
  },

  async bulk(act) {
    const items = allContainers().filter((c) => this.selected.has(c.id));
    if (!items.length) return;
    if (act === "sil") {
      const r = await confirmDialog({
        title: L(`${items.length} ${Tl("container")} silinsin mi?`, `Delete ${plural(items.length, "container")}?`), danger: true, confirmText: L("Sil", "Delete"), icon: "trash",
        text: L("Seçilen parçalar durdurulup kaldırılacak: ", "The selected containers will be stopped and removed: ") + `${items.slice(0, 6).map((c) => c.name).join(", ")}${items.length > 6 ? " …" : ""}`,
        checkbox: { label: L("Verilerini de sil", "Delete their data too"), help: L("Parçaların veri kutuları da kalıcı olarak silinir. Geri alınamaz.", "Their volumes are deleted permanently too. This cannot be undone.") },
      });
      if (!r) return;
      await runJob("/api/parcalar/toplu", { idler: items.map((c) => c.id), islem: "sil", veriler: r.checked });
    } else {
      const todo = act === "baslat" ? items.filter((c) => !c.up || c.state === "paused") : items.filter((c) => c.up);
      if (!todo.length) return flash(act === "baslat" ? L("Seçilenlerin hepsi zaten çalışıyor.", "All selected containers are already running.") : L("Seçilenlerin hepsi zaten kapalı.", "All selected containers are already stopped."));
      await runJob("/api/parcalar/toplu", { idler: todo.map((c) => c.id), islem: act });
    }
    this.selected.clear();
    this.render();
  },

  render() {
    if (!S.data) return;
    const all = allContainers();
    for (const id of [...this.selected]) if (!all.some((c) => c.id === id)) this.selected.delete(id);
    patch($("#ct-filter", this.root), segmented("ct", [
      { id: "hepsi", label: L("Tümü", "All"), count: all.length },
      { id: "calisan", label: L("Çalışan", "Running"), count: all.filter((c) => c.running).length },
      { id: "kapali", label: L("Kapalı", "Stopped"), count: all.filter((c) => !c.running).length },
      { id: "sorunlu", label: L("Sorunlu", "Problems"), count: all.filter((c) => c.level === "err" || c.state === "restarting").length },
    ], this.filter));

    const n = this.selected.size;
    patch($("#ct-bulk", this.root), n ? html`
      <div class="bulk-bar" role="region" aria-label="${L("Toplu işlemler", "Bulk actions")}">
        <b>${L(`${n} seçili`, `${n} selected`)}</b>
        <button class="btn sm go" data-bulk="baslat">${icon("play")}${L("Başlat", "Start")}</button>
        <button class="btn sm" data-bulk="durdur">${icon("stop")}${L("Durdur", "Stop")}</button>
        <button class="btn sm" data-bulk="yeniden">${icon("restart")}${L("Yeniden başlat", "Restart")}</button>
        <button class="btn sm danger" data-bulk="sil">${icon("trash")}${L("Sil…", "Delete…")}</button>
        <div class="toolbar-spacer"></div>
        <button class="link" data-clear-sel>${L("Seçimi temizle", "Clear selection")}</button>
      </div>` : "");

    const list = this.list();
    if (!list.length) {
      return patch($("#ct-body", this.root), emptyState({
        icon: "box", compact: true,
        title: all.length ? L("Eşleşen bir şey yok", "Nothing matches") : L(`Hiç ${Tl("container")} yok`, "No containers"),
        text: all.length ? L("Aramayı ya da filtreyi değiştir.", "Change the search or the filter.") : L("Yeni ekle ile bir veritabanı ya da proje kurabilirsin.", "Use Add new to install a database or a project."),
      }));
    }
    const allSel = list.every((c) => this.selected.has(c.id));
    const sortTh = (k, label, cls = "") => {
      const on = this.sort.key === k;
      return html`<th class="${cls}" aria-sort="${on ? (this.sort.dir > 0 ? "ascending" : "descending") : "none"}">
        <button class="th-sort ${on ? "on" : ""}" data-sort="${k}">${label}${icon("chevronDown", on ? (this.sort.dir > 0 ? "flip" : "") : "faint")}</button></th>`;
    };
    patch($("#ct-body", this.root), html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th class="check-col"><input type="checkbox" data-sel-all aria-label="${L("Hepsini seç", "Select all")}" ${allSel ? raw("checked") : ""}></th>
            ${sortTh("name", T("container"))}
            ${sortTh("app", T("app"), "col-md")}
            ${sortTh("state", L("Durum", "Status"))}
            ${sortTh("image", T("image"), "col-xl")}
            <th class="col-lg">${T("port", true)}</th>
            <th class="num col-md" aria-sort="${["cpu", "mem"].includes(this.sort.key) ? (this.sort.dir > 0 ? "ascending" : "descending") : "none"}">
              <span class="th-pair"><button class="th-sort ${this.sort.key === "cpu" ? "on" : ""}" data-sort="cpu" title="${L("İşlemciye göre sırala", "Sort by CPU")}">${L("İşlemci", "CPU")}</button> / <button class="th-sort ${this.sort.key === "mem" ? "on" : ""}" data-sort="mem" title="${L("Belleğe göre sırala", "Sort by memory")}">${L("Bellek", "Memory")}</button></span></th>
            ${sortTh("time", L("Süre", "Time"), "col-xl")}
            <th class="actions-col"><span class="sr">${L("İşlemler", "Actions")}</span></th>
          </tr></thead>
          <tbody>${list.map((c) => {
            const s = S.stats[c.name];
            const lvl = containerLevel(c);
            return html`
              <tr class="row-link ${this.selected.has(c.id) ? "selected" : ""}" data-open-part="${c.id}">
                <td class="check-col"><input type="checkbox" data-sel="${c.id}" aria-label="${L(`${c.name} seç`, `Select ${c.name}`)}" ${this.selected.has(c.id) ? raw("checked") : ""}></td>
                <td><div class="cell-main">${kindTile(c.kind, lvl)}<div class="min0"><a class="strong" href="${link(`/parca/${c.id}`)}">${c.role_title}</a><div class="muted small mono ellipsis cell-clip" title="${c.name} · ${c.image}">${c.name}</div></div></div></td>
                <td class="col-md">${c.app.source === "single" ? html`<span class="muted">—</span>` : html`<a href="${link(`/uygulama/${c.app.key}`)}">${c.app.name}</a>`}</td>
                <td>${badge(lvl, c.status_text)}</td>
                <td class="col-xl"><div class="mono small ellipsis cell-clip" title="${c.image}">${c.image}</div></td>
                <td class="col-lg"><div class="chips nowrap">${c.ports.slice(0, 1).map((p) => p.url ? linkChip(p.url, p.host, { dim: !c.running }) : html`<span class="chip mono">${p.host}</span>`)}${c.ports.length > 1 ? html`<span class="muted small" title="${c.ports.map((p) => p.host).join(", ")}">+${c.ports.length - 1}</span>` : ""}</div></td>
                <td class="num mono small col-md">${c.running && s ? html`${fmt.pct(s.cpu)}<span class="muted"> · </span>${fmt.bytes(s.mem)}` : html`<span class="muted">—</span>`}</td>
                <td class="small muted col-xl">${c.running ? fmt.since(c.started_at) : fmt.ago(c.finished_at)}</td>
                <td class="actions-col"><div class="row-actions">
                  ${activeJob(c.app.key) ? html`<span class="spinner"></span>` : c.up && c.state !== "paused"
                    ? html`<button class="icon-btn sm" data-cact="durdur" data-id="${c.id}" aria-label="${L("Durdur", "Stop")}" title="${L("Durdur", "Stop")}">${icon("stop")}</button>`
                    : html`<button class="icon-btn sm go" data-cact="baslat" data-id="${c.id}" aria-label="${L("Başlat", "Start")}" title="${L("Başlat", "Start")}">${icon("play")}</button>`}
                  <a class="icon-btn sm" href="${link(`/parca/${c.id}/kayitlar`)}" aria-label="${T("logs")}" title="${T("logs")}">${icon("logs")}</a>
                  <button class="icon-btn sm" data-cact="menu" data-id="${c.id}" aria-label="${L("Diğer işlemler", "More actions")}" aria-haspopup="menu">${icon("more")}</button>
                </div></td>
              </tr>`;
          })}</tbody>
        </table>
      </div>`);
  },
};
