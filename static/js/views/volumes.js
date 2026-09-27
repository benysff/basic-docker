"use strict";

/* =====================================================================
   Veri kutuları (volume) ve yedekler: listeleme, yedekleme, geri yükleme.
   ===================================================================== */

const VolumesView = {
  filter: "hepsi",
  query: "",

  mount(root, params) {
    this.root = root;
    this.tab = params.tab === "yedekler" ? "yedekler" : "kutular";
    this.vols = null;
    this.backups = null;
    this.error = null;
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({
          title: T("volume", true),
          desc: L("Parçaların verilerini sakladığı kutular. Parça silinse bile kutu durur. Buradan tek tıkla yedek alıp geri yükleyebilirsin.",
            "Where containers keep their data. A volume stays even if its container is deleted. Back it up and restore it with one click here."),
          actions: html`
            <button class="btn" data-restore-file>${icon("upload")}${L("Dosyadan geri yükle", "Restore from file")}</button>
            <button class="btn primary" data-create>${icon("plus")}${L(`${T("volume")} oluştur`, "Create volume")}</button>`,
        })}
        <div id="vl-tabs"></div>
        <div class="toolbar" id="vl-toolbar">
          ${searchBox("vl-search", L(`${T("volume")} ara…`, "Search volumes…"), this.query)}
          <div id="vl-seg"></div>
        </div>
        <div id="vl-body">${skeletonRows(8)}</div>
      </div>`);
    root.addEventListener("input", this.onInput = (e) => {
      if (e.target.id === "vl-search") { this.query = e.target.value; this.renderBody(); }
    });
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    this.offJob = bus.on("job-done", () => this.load());
    this.offBk = bus.on("backups-changed", () => this.loadBackups());
    this.load();
  },

  reparam(params) {
    this.tab = params.tab === "yedekler" ? "yedekler" : "kutular";
    this.render();
    return true;
  },

  unmount() {
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("click", this.onClick);
    this.offJob();
    this.offBk();
  },

  async load() {
    try {
      const [v, b] = await Promise.all([api("/api/kutular"), api("/api/yedekler")]);
      this.vols = v.kutular;
      this.backups = b;
      this.error = null;
    } catch (e) { this.error = e.message; }
    this.render();
  },

  async loadBackups() {
    try { this.backups = await api("/api/yedekler"); } catch { /* yok say */ }
    this.render();
  },

  click(e) {
    const t = e.target;
    const tab = t.closest("[data-tab]");
    if (tab) return Router.go(tab.dataset.tab === "yedekler" ? "/kutular/yedekler" : "/kutular");
    const seg = t.closest("[data-seg='vl']");
    if (seg) { this.filter = seg.dataset.val; return this.renderBody(); }
    if (t.closest("[data-retry]")) return this.load();
    if (t.closest("[data-create]")) return this.create();
    if (t.closest("[data-restore-file]")) return this.restoreFromFile();
    if (t.closest("[data-open-root]")) return api("/api/yedek/goster", {}).catch((err) => flash(err.message, true));
    if (t.closest("[data-change-root]")) return chooseBackupRoot(() => this.loadBackups());
    const va = t.closest("[data-vol]");
    if (va) {
      const v = this.vols.find((x) => x.name === va.dataset.name);
      if (!v) return;
      const kind = va.dataset.vol;
      if (kind === "backup") return runJob("/api/kutu/yedekle", { ad: v.name }, () => this.loadBackups());
      if (kind === "menu") return Menu.open(va, this.volMenu(v));
      if (kind === "delete") return this.remove(v);
    }
    const ba = t.closest("[data-bk]");
    if (ba) {
      const b = this.backups.backups.find((x) => x.path === ba.dataset.path);
      if (!b) return;
      const kind = ba.dataset.bk;
      if (kind === "restore") return b.kind === "db" ? openRestoreDb(b) : openRestoreVolume(b, this.vols);
      if (kind === "reveal") return api("/api/yedek/goster", { dosya: b.path }).catch((err) => flash(err.message, true));
      if (kind === "delete") return this.removeBackup(b);
    }
  },

  volMenu(v) {
    const dbUser = v.used_by.find((u) => u.kind === "db" && u.running);
    return [
      { label: L("Yedek al (.tar.gz)", "Back up (.tar.gz)"), icon: "archive", unsafe: true, onClick: () => runJob("/api/kutu/yedekle", { ad: v.name }, () => this.loadBackups()) },
      dbUser && { label: L("Veritabanı dökümü al (daha güvenli)", "Take a database dump (safer)"), icon: "backup", unsafe: true, onClick: () => runJob("/api/db/dokum", { id: dbUser.id }, () => this.loadBackups()) },
      { label: L("Bir yedeği bu kutuya geri yükle…", "Restore a backup into this volume…"), icon: "upload", unsafe: true, onClick: () => this.pickBackupFor(v) },
      { label: L("Adını kopyala", "Copy name"), icon: "copy", onClick: () => copyText(v.name) },
      "-",
      { label: v.in_use ? L("Sil (önce kullanan parçaları sil)", "Delete (delete the containers using it first)") : L("Sil…", "Delete…"), icon: "trash", danger: true, disabled: v.in_use, onClick: () => this.remove(v) },
    ];
  },

  pickBackupFor(v) {
    const own = (this.backups?.backups || []).filter((b) => b.kind === "volume" && b.source === v.name);
    if (!own.length) {
      return flash(L(`${v.name} için henüz yedek yok. Başka bir kutunun yedeğini yüklemek için Yedekler sekmesini kullan.`,
        `There is no backup of ${v.name} yet. To load another volume's backup, use the Backups tab.`), true);
    }
    if (own.length === 1) return openRestoreVolume(own[0], this.vols, v.name);
    Modal.open({
      title: L("Hangi yedek geri yüklensin?", "Which backup should be restored?"), sub: v.name, size: "sm",
      body: html`<div class="pick-list">${own.map((b, i) => html`
        <label class="radio-card"><input type="radio" name="pb" value="${i}" ${i === 0 ? raw("checked") : ""}>
          <span><b>${fmt.date(b.mtime)}</b><small>${fmt.ago(b.mtime)} · ${fmt.bytes(b.size)}</small></span></label>`)}</div>`,
      foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="pb-go">${L("Devam", "Continue")}</button>`,
      onMount: (m) => {
        $("#pb-go", m).addEventListener("click", () => openRestoreVolume(own[+$("input[name=pb]:checked", m).value], this.vols, v.name));
      },
    });
  },

  async create() {
    const name = await promptDialog({
      title: L(`Yeni ${Tl("volume")}`, "New volume"), label: L("Ad", "Name"), placeholder: L("proje-veri", "project-data"),
      help: L("Harf, rakam, - ve _ kullanabilirsin. Oluşturduktan sonra bir parçaya bağlayabilirsin.", "Use letters, digits, - and _. You can attach it to a container afterwards."),
      confirmText: L("Oluştur", "Create"), validate: (v) => (/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(v) ? "" : L("Geçerli bir ad yaz (ör. proje-veri).", "Enter a valid name (e.g. project-data).")),
    });
    if (!name) return;
    try { await api("/api/kutu/olustur", { ad: name }); flash(L(`${name} oluşturuldu`, `${name} created`)); this.load(); } catch (e) { flash(e.message, true); }
  },

  async remove(v) {
    const r = await confirmDialog({
      title: L(`${v.anonymous ? "İsimsiz kutu" : v.name} silinsin mi?`, `Delete ${v.anonymous ? "anonymous volume" : v.name}?`), danger: true,
      confirmText: L("Kalıcı olarak sil", "Delete permanently"), icon: "trash",
      text: L(`İçindeki bütün veriler${v.size ? ` (${fmt.bytes(v.size)})` : ""} kalıcı olarak silinir. Geri alınamaz.`,
        `All data in it${v.size ? ` (${fmt.bytes(v.size)})` : ""} is deleted permanently. This cannot be undone.`),
      extra: callout({ level: "tip", text: L("Emin değilsen önce “Yedek al” ile .tar.gz yedeğini alabilirsin.", "If you are not sure, take a .tar.gz backup first with “Back up”.") }),
    });
    if (!r) return;
    runJob("/api/kutu/sil", { adlar: [v.name] }, () => this.load());
  },

  async removeBackup(b) {
    const r = await confirmDialog({
      title: L("Yedek silinsin mi?", "Delete this backup?"), danger: true, confirmText: trashVerb(), icon: "trash",
      text: onMac() ? L(`${b.file} Çöp Sepeti'ne taşınacak. Çöp Sepeti'ni boşaltana kadar geri alabilirsin.`,
          `${b.file} will be moved to the Trash. You can get it back until you empty the Trash.`)
        : onWin() ? L(`${b.file} Geri Dönüşüm Kutusu'na taşınacak. Kutuyu boşaltana kadar geri alabilirsin.`,
          `${b.file} will be moved to the Recycle Bin. You can get it back until you empty it.`)
        : L(`${b.file} kalıcı olarak silinecek. Geri alınamaz.`, `${b.file} will be deleted permanently. This can't be undone.`),
    });
    if (!r) return;
    try { flash((await api("/api/yedek/sil", { dosya: b.path })).mesaj); this.loadBackups(); } catch (e) { flash(e.message, true); }
  },

  async restoreFromFile() {
    try {
      const r = await api("/api/dosya-sec", {});
      if (!r.yol) return;
      const name = r.yol.split(/[\\/]/).pop();  // Windows yolları \\ ile ayrılır
      const isVol = /\.(tar\.gz|tgz|tar)$/.test(name);
      const b = { path: r.yol, file: name, kind: isVol ? "volume" : "db", source: name.split("__")[0], ext: name.split(".").slice(1).join(".") };
      isVol ? openRestoreVolume(b, this.vols || []) : openRestoreDb(b);
    } catch (e) { flash(e.message, true); }
  },

  render() {
    const nb = this.backups?.backups?.length;
    patch($("#vl-tabs", this.root), tabs([
      { id: "kutular", label: T("volume", true), icon: "drive", count: this.vols?.length },
      { id: "yedekler", label: L("Yedekler", "Backups"), icon: "archive", count: nb },
    ], this.tab));
    this.renderBody();
  },

  renderBody() {
    const body = $("#vl-body", this.root);
    const bar = $("#vl-toolbar", this.root);
    bar.hidden = this.tab === "yedekler" || !!this.error;
    if (this.error) return patch(body, errorState(this.error));
    if (!this.vols) return;
    if (this.tab === "yedekler") return patch(body, this.backupsBody());

    const vols = this.vols;
    patch($("#vl-seg", this.root), segmented("vl", [
      { id: "hepsi", label: L("Tümü", "All"), count: vols.length },
      { id: "kullanilan", label: L("Kullanılan", "In use"), count: vols.filter((v) => v.in_use).length },
      { id: "sahipsiz", label: L("Sahipsiz", "Orphaned"), count: vols.filter((v) => !v.in_use).length },
    ], this.filter));

    const qq = fold(this.query.trim());
    let list = vols;
    if (qq) list = list.filter((v) => fold([v.name, v.app_name, ...v.used_by.map((u) => u.name)].join(" ")).includes(qq));
    if (this.filter === "kullanilan") list = list.filter((v) => v.in_use);
    if (this.filter === "sahipsiz") list = list.filter((v) => !v.in_use);
    if (!list.length) return patch(body, emptyState({ icon: "drive", title: L("Eşleşen veri kutusu yok", "No matching volumes"), compact: true }));
    const orphanSize = vols.filter((v) => !v.in_use).reduce((n, v) => n + (v.size || 0), 0);

    patch(body, html`
      ${this.filter === "sahipsiz" && orphanSize ? callout({ level: "tip", title: L("Sahipsiz kutular", "Orphaned volumes"),
        text: L(`Hiçbir parçanın kullanmadığı kutular (${fmt.bytes(orphanSize)}). Çoğu eski projelerden kalmadır ama içinde veri olabilir; silmeden önce yedek almak iyi fikir.`,
          `Volumes no container uses (${fmt.bytes(orphanSize)}). Most are left over from old projects but may still hold data; backing up before deleting is a good idea.`) }) : ""}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${T("volume")}</th><th class="col-md">${T("app")}</th><th>${L("Kullanan", "Used by")}</th><th class="num">${L("Boyut", "Size")}</th><th class="col-lg">${L("Oluşturulma", "Created")}</th><th class="actions-col"><span class="sr">${L("İşlemler", "Actions")}</span></th></tr></thead>
          <tbody>${list.map((v) => html`
            <tr>
              <td><div class="cell-main"><div class="kind-tile sm ${v.running ? "lvl-ok" : ""}">${icon(v.db ? "db" : "drive")}</div>
                <div class="min0">${v.anonymous
                  ? html`<div class="strong">${L("İsimsiz kutu", "Anonymous volume")} ${hintIcon(L("Bir kalıp kendi içinde 'kalıcı klasör' istediğinde Docker bunu otomatik oluşturur. Adı rastgele bir koddur.", "Docker creates these automatically when an image asks for a persistent folder. The name is a random code."))}</div><div class="mono small muted ellipsis" title="${v.name}">${v.name.slice(0, 16)}…</div>`
                  : html`<div class="strong mono ellipsis" title="${v.name}">${v.name}</div>`}</div></div></td>
              <td class="col-md">${v.app_name ? (findApp(v.app) ? html`<a href="${link(`/uygulama/${v.app}`)}">${v.app_name}</a>` : html`<span class="muted">${v.app_name}</span>`) : html`<span class="muted">—</span>`}</td>
              <td>${v.used_by.length ? html`<div class="chips">${v.used_by.slice(0, 2).map((u) => html`<a class="chip" href="${link(`/parca/${u.id}`)}" title="${L("İçeride", "Inside")} ${u.dest}">${dot(u.running ? "ok" : "off")}${shortRole(u.role)}</a>`)}</div>` : html`<span class="pill">${L("Sahipsiz", "Orphaned")}</span>`}</td>
              <td class="num mono small">${v.size === null ? "—" : fmt.bytes(v.size)}</td>
              <td class="col-lg small muted">${fmt.ago(v.created)}</td>
              <td class="actions-col"><div class="row-actions">
                <button class="btn sm" data-vol="backup" data-name="${v.name}" title="${L(`İçeriği .tar.gz olarak ${here("ine")} kaydet`, `Save its contents to ${yourPcEn()} as .tar.gz`)}">${icon("archive")}${L("Yedekle", "Back up")}</button>
                <button class="icon-btn sm" data-vol="menu" data-name="${v.name}" aria-label="${L("Diğer işlemler", "More actions")}" aria-haspopup="menu">${icon("more")}</button>
              </div></td>
            </tr>`)}</tbody>
        </table>
      </div>`);
  },

  backupsBody() {
    const b = this.backups;
    if (!b) return skeletonRows(4);
    const list = b.backups;
    return html`
      <div class="backup-root panel">
        <div class="backup-root-info">
          ${icon("folder")}
          <div class="min0"><div class="muted small">${L("Yedeklerin durduğu klasör", "Backups folder")}</div><div class="mono ellipsis" title="${b.root}">${b.root}</div></div>
        </div>
        <div class="row-actions">
          <button class="btn sm" data-open-root>${icon("folder")}${openInFiles()}</button>
          <button class="btn sm" data-change-root>${L("Değiştir…", "Change…")}</button>
        </div>
      </div>
      ${list.length ? html`
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>${L("Yedek", "Backup")}</th><th>${L("Türü", "Type")}</th><th class="col-md">${L("Tarih", "Date")}</th><th class="num">${L("Boyut", "Size")}</th><th class="actions-col"><span class="sr">${L("İşlemler", "Actions")}</span></th></tr></thead>
            <tbody>${list.map((x) => html`
              <tr>
                <td><div class="cell-main"><div class="kind-tile sm">${icon(x.kind === "db" ? "db" : "archive")}</div>
                  <div class="min0"><div class="strong mono ellipsis">${x.source}</div><div class="small muted mono ellipsis" title="${x.file}">${x.file}</div></div></div></td>
                <td>${x.kind === "db" ? pill(L("Veritabanı dökümü", "Database dump"), "accent") : pill(L(`${T("volume")} yedeği`, "Volume backup"))}</td>
                <td class="col-md small">${fmt.date(x.mtime)} <span class="muted">· ${fmt.ago(x.mtime)}</span></td>
                <td class="num mono small">${fmt.bytes(x.size)}</td>
                <td class="actions-col"><div class="row-actions">
                  <button class="btn sm" data-bk="restore" data-path="${x.path}">${icon("upload")}${L("Geri yükle", "Restore")}</button>
                  <button class="icon-btn sm" data-bk="reveal" data-path="${x.path}" aria-label="${showInFiles()}" title="${showInFiles()}">${icon("folder")}</button>
                  <button class="icon-btn sm" data-bk="delete" data-path="${x.path}" aria-label="${trashVerb()}" title="${trashVerb()}">${icon("trash")}</button>
                </div></td>
              </tr>`)}</tbody>
          </table>
        </div>` : emptyState({
          icon: "archive", title: L("Henüz yedek yok", "No backups yet"),
          text: L(`${T("volume", true)} sekmesinde “Yedekle”ye bas ya da bir veritabanı parçasında “Veritabanı dökümü al”ı seç. Yedekler ${here("inde")}, yukarıdaki klasörde durur.`,
            `Press “Back up” on the Volumes tab, or choose “Take a database dump” on a database container. Backups are kept on ${yourPcEn()}, in the folder above.`),
        })}
      ${callout({ level: "tip", title: L("Hangi yedek ne zaman?", "Which backup when?"), text: isEN()
        ? raw("A <b>volume backup</b> archives every file in the volume as is; it works for any container. A <b>database dump</b> is taken with the database's own tool; it is consistent even while running and is the only safe way to move to another version.")
        : raw(`<b>${esc(T("volume"))} yedeği</b> kutunun içindeki bütün dosyaları olduğu gibi arşivler; her tür parça için çalışır. <b>Veritabanı dökümü</b> ise veritabanının kendi aracıyla alınır; çalışırken bile tutarlıdır ve farklı bir sürüme taşımak için tek güvenli yoldur.`) })}`;
  },
};

async function chooseBackupRoot(after) {
  try {
    const r = await api("/api/klasor-sec", {});
    if (!r.yol) return;
    await api("/api/yedek-klasoru", { yol: r.yol });
    flash(L("Yedek klasörü değişti", "Backups folder changed"));
    after?.();
  } catch (e) { flash(e.message, true); }
}
