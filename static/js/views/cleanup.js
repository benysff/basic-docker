"use strict";

/* =====================================================================
   Temizlik: Docker diskte ne kadar yer kaplıyor, neler güvenle silinebilir?
   ===================================================================== */

const CLEAN_COLORS = { images: "var(--c1)", cache: "var(--c2)", volumes: "var(--c3)", containers: "var(--c4)" };
const CLEAN_LABELS = { images: "Kalıplar", cache: "Derleme önbelleği", volumes: "Veri kutuları", containers: "Parçalar" };

const CleanupView = {
  mount(root) {
    this.root = root;
    this.plan = null;
    this.error = null;
    this.sel = { cache: true, dangling: true, images: new Set(), stopped: new Set(), volumes: new Set() };
    this.open = new Set();
    root.innerHTML = String(html`
      <div class="page has-sticky-foot">
        ${pageHead({
          title: T("cleanup"),
          desc: "Docker zamanla diskte büyük yer kaplar: eski kalıplar, derleme artıkları, unutulmuş veri kutuları. Güvenli olanlar önceden seçili; gerisini sen seç.",
          actions: html`<button class="btn" data-retry>${icon("refresh")}Yeniden hesapla</button>`,
        })}
        <div id="cl-body">${skeletonRows(6)}</div>
        <div id="cl-foot"></div>
      </div>`);
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    root.addEventListener("change", this.onChange = (e) => this.change(e));
    this.load();
  },

  unmount() {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
  },

  async load() {
    this.plan = null;
    this.render();
    try {
      this.plan = (await api("/api/temizlik")).plan;
      this.error = null;
      const p = this.plan;
      S.badges.reclaim = p.cache.size + p.dangling.size;
      bus.emit("badges");
    } catch (e) { this.error = e.message; }
    this.render();
  },

  selectedSize() {
    const p = this.plan;
    if (!p) return 0;
    let n = 0;
    if (this.sel.cache) n += p.cache.size;
    if (this.sel.dangling) n += p.dangling.size;
    for (const it of p.unused_images.items) if (this.sel.images.has(it.full_id)) n += it.size;
    for (const it of p.stopped.items) if (this.sel.stopped.has(it.name)) n += it.size;
    for (const it of p.volumes.items) if (this.sel.volumes.has(it.name)) n += it.size;
    return n;
  },

  click(e) {
    const t = e.target;
    if (t.closest("[data-retry]")) return this.load();
    const tog = t.closest("[data-open]");
    if (tog) {
      const k = tog.dataset.open;
      this.open.has(k) ? this.open.delete(k) : this.open.add(k);
      return this.render();
    }
    const all = t.closest("[data-all]");
    if (all) {
      const k = all.dataset.all;
      const items = { images: this.plan.unused_images.items.map((i) => i.full_id), stopped: this.plan.stopped.items.map((i) => i.name), volumes: this.plan.volumes.items.map((i) => i.name) }[k];
      const set = this.sel[k];
      const every = items.every((x) => set.has(x));
      items.forEach((x) => (every ? set.delete(x) : set.add(x)));
      this.open.add(k);
      return this.render();
    }
    const bk = t.closest("[data-backup-vol]");
    if (bk) return runJob("/api/kutu/yedekle", { ad: bk.dataset.backupVol }, () => bus.emit("backups-changed"));
    if (t.closest("[data-run]")) return this.run();
  },

  change(e) {
    const t = e.target;
    if (t.matches("[data-cat]")) { this.sel[t.dataset.cat] = t.checked; return this.render(); }
    if (t.matches("[data-item]")) {
      const set = this.sel[t.dataset.item];
      t.checked ? set.add(t.value) : set.delete(t.value);
      return this.render();
    }
  },

  async run() {
    const p = this.plan;
    const lines = [];
    if (this.sel.cache && p.cache.size) lines.push(`Derleme önbelleği (${fmt.bytes(p.cache.size)})`);
    if (this.sel.dangling && p.dangling.size) lines.push(`${p.dangling.items.length} sahipsiz kalıp (${fmt.bytes(p.dangling.size)})`);
    if (this.sel.images.size) lines.push(`${this.sel.images.size} kullanılmayan kalıp`);
    if (this.sel.stopped.size) lines.push(`${this.sel.stopped.size} kapalı parça`);
    if (this.sel.volumes.size) lines.push(`${this.sel.volumes.size} veri kutusu — İÇİNDEKİ VERİLERLE BİRLİKTE`);
    if (!lines.length) return flash("Temizlenecek bir şey seçmedin.", true);
    const r = await confirmDialog({
      title: `Yaklaşık ${fmt.bytes(this.selectedSize())} yer açılsın mı?`,
      danger: this.sel.volumes.size > 0, confirmText: "Temizle", icon: "sparkles",
      extra: html`<ul class="confirm-list">${lines.map((l) => html`<li>${l}</li>`)}</ul>
        ${this.sel.volumes.size ? callout({ level: "err", text: "Seçtiğin veri kutuları kalıcı olarak silinecek. Geri alınamaz." }) : ""}`,
    });
    if (!r) return;
    const body = {
      onbellek: this.sel.cache,
      sahipsiz: this.sel.dangling,
      kaliplar: p.unused_images.items.filter((i) => this.sel.images.has(i.full_id)).map((i) => i.ref || i.full_id),
      parcalar: [...this.sel.stopped],
      kutular: [...this.sel.volumes],
    };
    runJob("/api/temizle", body, () => {
      this.sel.images.clear(); this.sel.stopped.clear(); this.sel.volumes.clear();
      this.load();
      refresh();
    });
  },

  category({ key, catKey, title, desc, size, count, items, itemKey, itemRow, level = "safe", checked, note = "" }) {
    const open = this.open.has(key);
    const selCount = items ? items.filter((i) => this.sel[key]?.has?.(i[itemKey])).length : null;
    return html`
      <section class="clean-cat ${level}">
        <div class="clean-head">
          ${catKey ? html`<label class="check big"><input type="checkbox" data-cat="${catKey}" ${checked ? raw("checked") : ""} ${size ? "" : raw("disabled")}><span class="sr">${title}</span></label>`
            : html`<div class="clean-count" aria-hidden="true">${selCount || ""}</div>`}
          <div class="clean-text">
            <h3>${title} ${level === "danger" ? pill("Dikkat", "err") : level === "safe" ? pill("Güvenli", "ok") : pill("Seçerek", "warn")}</h3>
            <p>${desc}</p>
            ${note ? html`<p class="small muted">${note}</p>` : ""}
          </div>
          <div class="clean-size">
            <b class="mono">${fmt.bytes(size)}</b>
            <span class="muted small">${count} öğe</span>
          </div>
        </div>
        ${items && items.length ? html`
          <div class="clean-tools">
            <button class="link" data-open="${key}" aria-expanded="${open}">${icon(open ? "chevronDown" : "chevronRight")}${open ? "Listeyi gizle" : "Listeyi göster ve seç"}</button>
            <button class="link" data-all="${key}">${items.every((i) => this.sel[key].has(i[itemKey])) ? "Seçimi kaldır" : "Hepsini seç"}</button>
            ${selCount ? html`<span class="muted small">${selCount} seçili</span>` : ""}
          </div>
          ${open ? html`<ul class="clean-items">${items.map((it) => itemRow(it))}</ul>` : ""}` : ""}
      </section>`;
  },

  render() {
    const body = $("#cl-body", this.root);
    const foot = $("#cl-foot", this.root);
    if (this.error) { patch(foot, ""); return patch(body, errorState(this.error)); }
    if (!this.plan) { patch(foot, ""); return patch(body, html`<div class="calc">${icon("sparkles")}<span>Docker'ın disk kullanımı hesaplanıyor…</span></div>${skeletonRows(5)}`); }
    const p = this.plan;
    const total = Object.values(p.usage).reduce((a, b) => a + b, 0) || 1;
    const safe = p.cache.size + p.dangling.size;
    const most = Math.min(total, safe + p.unused_images.size + p.volumes.size + p.stopped.size);

    const itemImg = (it) => html`
      <li><label class="check"><input type="checkbox" data-item="images" value="${it.full_id}" ${this.sel.images.has(it.full_id) ? raw("checked") : ""}>
        <span class="clean-item"><span class="mono ellipsis">${it.ref || it.id}</span><span class="muted small">${it.created}</span><b class="mono small">${fmt.bytes(it.size)}</b></span></label></li>`;
    const itemStopped = (it) => html`
      <li><label class="check"><input type="checkbox" data-item="stopped" value="${it.name}" ${this.sel.stopped.has(it.name) ? raw("checked") : ""}>
        <span class="clean-item"><span class="ellipsis"><span class="strong">${it.app_name !== it.name ? it.app_name + " · " : ""}${shortRole(it.role)}</span> <span class="mono muted small">${it.name}</span></span>
        <span class="muted small">${it.finished ? fmt.ago(it.finished) + " kapandı" : ""}</span>
        ${it.compose ? pill("Compose", "") : pill("Geri gelmez", "warn")}<b class="mono small">${fmt.bytes(it.size)}</b></span></label></li>`;
    const itemVol = (it) => html`
      <li><label class="check"><input type="checkbox" data-item="volumes" value="${it.name}" ${this.sel.volumes.has(it.name) ? raw("checked") : ""}>
        <span class="clean-item"><span class="ellipsis">${it.anonymous ? html`<span class="strong">İsimsiz kutu</span> <span class="mono muted small">${it.name.slice(0, 12)}…</span>` : html`<span class="mono strong">${it.name}</span>`}
          ${it.app_name ? html` <span class="muted small">(${it.app_name})</span>` : ""}</span>
        <button class="btn xs" data-backup-vol="${it.name}" title="Silmeden önce yedek al">${icon("archive")}Yedekle</button>
        <b class="mono small">${fmt.bytes(it.size)}</b></span></label></li>`;

    patch(body, html`
      <section class="panel usage-panel">
        <div class="usage-top">
          <div><div class="muted small">Docker'ın diskte kapladığı yer (yaklaşık)</div><div class="usage-total">${fmt.bytes(total)}</div></div>
          <div class="usage-reclaim"><div class="muted small">Güvenle boşaltılabilir</div><div class="usage-total accent">${fmt.bytes(safe)}</div>
            <div class="muted small">Her şey seçilirse en fazla ${fmt.bytes(most)}</div></div>
        </div>
        <div class="stack-bar" role="img" aria-label="Disk kullanımı dağılımı">
          ${Object.entries(p.usage).filter(([, v]) => v > 0).map(([k, v]) => html`<span style="width:${(v / total) * 100}%;background:${CLEAN_COLORS[k]}" title="${CLEAN_LABELS[k]}: ${fmt.bytes(v)}"></span>`)}
        </div>
        <ul class="legend">${Object.entries(p.usage).map(([k, v]) => html`<li><span class="swatch" style="background:${CLEAN_COLORS[k]}"></span>${CLEAN_LABELS[k]}<b class="mono">${fmt.bytes(v)}</b></li>`)}</ul>
      </section>

      ${this.category({
        key: "cache", catKey: "cache", checked: this.sel.cache,
        title: "Derleme önbelleği", size: p.cache.size, count: p.cache.count,
        desc: "Kendi kodundan kalıp derlerken biriken ara dosyalar. Silmek güvenlidir; sadece bir sonraki derleme biraz daha uzun sürer.",
      })}
      ${this.category({
        key: "dangling", catKey: "dangling", checked: this.sel.dangling,
        title: "Sahipsiz kalıplar", size: p.dangling.size, count: p.dangling.items.length,
        desc: "Adı kalmamış eski kalıp sürümleri. Aynı adla yenisi indirilince ya da derlenince eskisi böyle kalır. Hiçbir parça kullanmıyor.",
      })}
      ${this.category({
        key: "images", level: "choose", title: "Kullanılmayan kalıplar", size: p.unused_images.size, count: p.unused_images.items.length,
        items: p.unused_images.items, itemKey: "full_id", itemRow: itemImg,
        desc: "Hiçbir parçanın kullanmadığı kalıplar. Silersen, lazım olduğunda tekrar indirilir (kendi derlediklerin tekrar derlenir).",
      })}
      ${this.category({
        key: "stopped", level: "choose", title: "Kapalı parçalar", size: p.stopped.size, count: p.stopped.items.length,
        items: p.stopped.items, itemKey: "name", itemRow: itemStopped,
        desc: "Şu an çalışmayan parçalar. Veri kutularına dokunulmaz.",
        note: "“Compose” etiketliler proje klasöründen tekrar kurulabilir. “Geri gelmez” olanlar tek başına açılmış parçalar; silersen ayarlarıyla birlikte gider.",
      })}
      ${this.category({
        key: "volumes", level: "danger", title: "Sahipsiz veri kutuları", size: p.volumes.size, count: p.volumes.items.length,
        items: p.volumes.items, itemKey: "name", itemRow: itemVol,
        desc: "Hiçbir parçanın bağlı olmadığı veri kutuları. İçlerinde eski veritabanı kayıtları olabilir. Silinen veri geri gelmez.",
        note: "Emin değilsen önce yanındaki “Yedekle” ile .tar.gz yedeğini al.",
      })}`);

    const sel = this.selectedSize();
    patch(foot, html`
      <div class="sticky-foot">
        <div><div class="muted small">Seçilenlerle açılacak yer</div><div class="sticky-size mono">${fmt.bytes(sel)}</div></div>
        <button class="btn ${this.sel.volumes.size ? "danger-solid" : "primary"} lg" data-run ${sel ? "" : raw("disabled")}>${icon("sparkles")}Temizle</button>
      </div>`);
  },
};
