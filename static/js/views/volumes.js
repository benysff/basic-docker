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
          desc: "Parçaların verilerini sakladığı kutular. Parça silinse bile kutu durur. Buradan tek tıkla yedek alıp geri yükleyebilirsin.",
          actions: html`
            <button class="btn" data-restore-file>${icon("upload")}Dosyadan geri yükle</button>
            <button class="btn primary" data-create>${icon("plus")}${T("volume")} oluştur</button>`,
        })}
        <div id="vl-tabs"></div>
        <div class="toolbar" id="vl-toolbar">
          ${searchBox("vl-search", `${T("volume")} ara…`, this.query)}
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
      { label: "Yedek al (.tar.gz)", icon: "archive", onClick: () => runJob("/api/kutu/yedekle", { ad: v.name }, () => this.loadBackups()) },
      dbUser && { label: "Veritabanı dökümü al (daha güvenli)", icon: "backup", onClick: () => runJob("/api/db/dokum", { id: dbUser.id }, () => this.loadBackups()) },
      { label: "Bir yedeği bu kutuya geri yükle…", icon: "upload", onClick: () => this.pickBackupFor(v) },
      { label: "Adını kopyala", icon: "copy", onClick: () => copyText(v.name) },
      "-",
      { label: v.in_use ? "Sil (önce kullanan parçaları sil)" : "Sil…", icon: "trash", danger: true, disabled: v.in_use, onClick: () => this.remove(v) },
    ];
  },

  pickBackupFor(v) {
    const own = (this.backups?.backups || []).filter((b) => b.kind === "volume" && b.source === v.name);
    if (!own.length) {
      return flash(`${v.name} için henüz yedek yok. Başka bir kutunun yedeğini yüklemek için Yedekler sekmesini kullan.`, true);
    }
    if (own.length === 1) return openRestoreVolume(own[0], this.vols, v.name);
    Modal.open({
      title: "Hangi yedek geri yüklensin?", sub: v.name, size: "sm",
      body: html`<div class="pick-list">${own.map((b, i) => html`
        <label class="radio-card"><input type="radio" name="pb" value="${i}" ${i === 0 ? raw("checked") : ""}>
          <span><b>${fmt.date(b.mtime)}</b><small>${fmt.ago(b.mtime)} · ${fmt.bytes(b.size)}</small></span></label>`)}</div>`,
      foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="pb-go">Devam</button>`,
      onMount: (m) => {
        $("#pb-go", m).addEventListener("click", () => openRestoreVolume(own[+$("input[name=pb]:checked", m).value], this.vols, v.name));
      },
    });
  },

  async create() {
    const name = await promptDialog({
      title: `Yeni ${Tl("volume")}`, label: "Ad", placeholder: "proje-veri",
      help: "Harf, rakam, - ve _ kullanabilirsin. Oluşturduktan sonra bir parçaya bağlayabilirsin.",
      confirmText: "Oluştur", validate: (v) => (/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(v) ? "" : "Geçerli bir ad yaz (ör. proje-veri)."),
    });
    if (!name) return;
    try { await api("/api/kutu/olustur", { ad: name }); flash(`${name} oluşturuldu`); this.load(); } catch (e) { flash(e.message, true); }
  },

  async remove(v) {
    const r = await confirmDialog({
      title: `${v.anonymous ? "İsimsiz kutu" : v.name} silinsin mi?`, danger: true, confirmText: "Kalıcı olarak sil", icon: "trash",
      text: `İçindeki bütün veriler${v.size ? ` (${fmt.bytes(v.size)})` : ""} kalıcı olarak silinir. Geri alınamaz.`,
      extra: callout({ level: "tip", text: "Emin değilsen önce “Yedek al” ile .tar.gz yedeğini alabilirsin." }),
    });
    if (!r) return;
    runJob("/api/kutu/sil", { adlar: [v.name] }, () => this.load());
  },

  async removeBackup(b) {
    const r = await confirmDialog({
      title: "Yedek silinsin mi?", danger: true, confirmText: "Çöp Sepeti'ne taşı", icon: "trash",
      text: `${b.file} Çöp Sepeti'ne taşınacak. Çöp Sepeti'ni boşaltana kadar geri alabilirsin.`,
    });
    if (!r) return;
    try { flash((await api("/api/yedek/sil", { dosya: b.path })).mesaj); this.loadBackups(); } catch (e) { flash(e.message, true); }
  },

  async restoreFromFile() {
    try {
      const r = await api("/api/dosya-sec", {});
      if (!r.yol) return;
      const name = r.yol.split("/").pop();
      const isVol = /\.(tar\.gz|tgz|tar)$/.test(name);
      const b = { path: r.yol, file: name, kind: isVol ? "volume" : "db", source: name.split("__")[0], ext: name.split(".").slice(1).join(".") };
      isVol ? openRestoreVolume(b, this.vols || []) : openRestoreDb(b);
    } catch (e) { flash(e.message, true); }
  },

  render() {
    const nb = this.backups?.backups?.length;
    patch($("#vl-tabs", this.root), tabs([
      { id: "kutular", label: T("volume", true), icon: "drive", count: this.vols?.length },
      { id: "yedekler", label: "Yedekler", icon: "archive", count: nb },
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
      { id: "hepsi", label: "Tümü", count: vols.length },
      { id: "kullanilan", label: "Kullanılan", count: vols.filter((v) => v.in_use).length },
      { id: "sahipsiz", label: "Sahipsiz", count: vols.filter((v) => !v.in_use).length },
    ], this.filter));

    const qq = this.query.trim().toLocaleLowerCase("tr");
    let list = vols;
    if (qq) list = list.filter((v) => [v.name, v.app_name, ...v.used_by.map((u) => u.name)].join(" ").toLocaleLowerCase("tr").includes(qq));
    if (this.filter === "kullanilan") list = list.filter((v) => v.in_use);
    if (this.filter === "sahipsiz") list = list.filter((v) => !v.in_use);
    if (!list.length) return patch(body, emptyState({ icon: "drive", title: "Eşleşen veri kutusu yok", compact: true }));
    const orphanSize = vols.filter((v) => !v.in_use).reduce((n, v) => n + (v.size || 0), 0);

    patch(body, html`
      ${this.filter === "sahipsiz" && orphanSize ? callout({ level: "tip", title: "Sahipsiz kutular",
        text: `Hiçbir parçanın kullanmadığı kutular (${fmt.bytes(orphanSize)}). Çoğu eski projelerden kalmadır ama içinde veri olabilir; silmeden önce yedek almak iyi fikir.` }) : ""}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${T("volume")}</th><th class="col-md">${T("app")}</th><th>Kullanan</th><th class="num">Boyut</th><th class="col-lg">Oluşturulma</th><th class="actions-col"><span class="sr">İşlemler</span></th></tr></thead>
          <tbody>${list.map((v) => html`
            <tr>
              <td><div class="cell-main"><div class="kind-tile sm ${v.running ? "lvl-ok" : ""}">${icon(v.db ? "db" : "drive")}</div>
                <div class="min0">${v.anonymous
                  ? html`<div class="strong">İsimsiz kutu ${hintIcon("Bir kalıp kendi içinde 'kalıcı klasör' istediğinde Docker bunu otomatik oluşturur. Adı rastgele bir koddur.")}</div><div class="mono small muted ellipsis" title="${v.name}">${v.name.slice(0, 16)}…</div>`
                  : html`<div class="strong mono ellipsis" title="${v.name}">${v.name}</div>`}</div></div></td>
              <td class="col-md">${v.app_name ? (findApp(v.app) ? html`<a href="${link(`/uygulama/${v.app}`)}">${v.app_name}</a>` : html`<span class="muted">${v.app_name}</span>`) : html`<span class="muted">—</span>`}</td>
              <td>${v.used_by.length ? html`<div class="chips">${v.used_by.slice(0, 2).map((u) => html`<a class="chip" href="${link(`/parca/${u.id}`)}" title="İçeride ${u.dest}">${dot(u.running ? "ok" : "off")}${shortRole(u.role)}</a>`)}</div>` : html`<span class="pill">Sahipsiz</span>`}</td>
              <td class="num mono small">${v.size === null ? "—" : fmt.bytes(v.size)}</td>
              <td class="col-lg small muted">${fmt.ago(v.created)}</td>
              <td class="actions-col"><div class="row-actions">
                <button class="btn sm" data-vol="backup" data-name="${v.name}" title="İçeriği .tar.gz olarak Mac'ine kaydet">${icon("archive")}Yedekle</button>
                <button class="icon-btn sm" data-vol="menu" data-name="${v.name}" aria-label="Diğer işlemler" aria-haspopup="menu">${icon("more")}</button>
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
          <div class="min0"><div class="muted small">Yedeklerin durduğu klasör</div><div class="mono ellipsis" title="${b.root}">${b.root}</div></div>
        </div>
        <div class="row-actions">
          <button class="btn sm" data-open-root>${icon("folder")}Finder'da aç</button>
          <button class="btn sm" data-change-root>Değiştir…</button>
        </div>
      </div>
      ${list.length ? html`
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Yedek</th><th>Türü</th><th class="col-md">Tarih</th><th class="num">Boyut</th><th class="actions-col"><span class="sr">İşlemler</span></th></tr></thead>
            <tbody>${list.map((x) => html`
              <tr>
                <td><div class="cell-main"><div class="kind-tile sm">${icon(x.kind === "db" ? "db" : "archive")}</div>
                  <div class="min0"><div class="strong mono ellipsis">${x.source}</div><div class="small muted mono ellipsis" title="${x.file}">${x.file}</div></div></div></td>
                <td>${x.kind === "db" ? pill("Veritabanı dökümü", "accent") : pill(`${T("volume")} yedeği`)}</td>
                <td class="col-md small">${fmt.date(x.mtime)} <span class="muted">· ${fmt.ago(x.mtime)}</span></td>
                <td class="num mono small">${fmt.bytes(x.size)}</td>
                <td class="actions-col"><div class="row-actions">
                  <button class="btn sm" data-bk="restore" data-path="${x.path}">${icon("upload")}Geri yükle</button>
                  <button class="icon-btn sm" data-bk="reveal" data-path="${x.path}" aria-label="Finder'da göster" title="Finder'da göster">${icon("folder")}</button>
                  <button class="icon-btn sm" data-bk="delete" data-path="${x.path}" aria-label="Çöp Sepeti'ne taşı" title="Çöp Sepeti'ne taşı">${icon("trash")}</button>
                </div></td>
              </tr>`)}</tbody>
          </table>
        </div>` : emptyState({
          icon: "archive", title: "Henüz yedek yok",
          text: `${T("volume", true)} sekmesinde “Yedekle”ye bas ya da bir veritabanı parçasında “Veritabanı dökümü al”ı seç. Yedekler Mac'inde, yukarıdaki klasörde durur.`,
        })}
      ${callout({ level: "tip", title: "Hangi yedek ne zaman?", text: raw(`<b>${esc(T("volume"))} yedeği</b> kutunun içindeki bütün dosyaları olduğu gibi arşivler; her tür parça için çalışır. <b>Veritabanı dökümü</b> ise veritabanının kendi aracıyla alınır; çalışırken bile tutarlıdır ve farklı bir sürüme taşımak için tek güvenli yoldur.`) })}`;
  },
};

async function chooseBackupRoot(after) {
  try {
    const r = await api("/api/klasor-sec", {});
    if (!r.yol) return;
    await api("/api/yedek-klasoru", { yol: r.yol });
    flash("Yedek klasörü değişti");
    after?.();
  } catch (e) { flash(e.message, true); }
}
