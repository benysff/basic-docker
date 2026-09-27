"use strict";

/* =====================================================================
   Uygulama ayrıntısı: parçalar, birleşik kayıtlar, kaynak, compose dosyası.
   ===================================================================== */

const AppView = {
  mount(root, params) {
    this.root = root;
    this.key = params.key;
    this.tab = params.tab || "parcalar";
    this.logState = { query: "", follow: true, lines: 300, rows: [], loading: false };
    this.compose = null;
    root.innerHTML = String(html`<div class="page" id="app-page"><div id="app-head"></div><div id="app-tabs"></div><div id="app-body"></div></div>`);
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    root.addEventListener("input", this.onInput = (e) => this.input(e));
    root.addEventListener("change", this.onChange = (e) => this.change(e));
    root.addEventListener("focusout", this.onBlur = (e) => this.blur(e));
    this.offData = bus.on("data", () => this.render());
    this.offStats = bus.on("stats", () => { if (this.tab === "parcalar" || this.tab === "kaynak") this.render(); });
    startStats(this);
    this.render();
    this.enterTab();
  },

  reparam(params) {
    if (params.key !== this.key) return false;
    this.tab = params.tab || "parcalar";
    this.render();
    this.enterTab();
    return true;
  },

  unmount() {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("change", this.onChange);
    this.root.removeEventListener("focusout", this.onBlur);
    this.offData();
    this.offStats();
    stopStats(this);
    clearInterval(this.logTimer);
  },

  setTab(tab) {
    history.replaceState(null, "", link(`/uygulama/${this.key}${tab === "parcalar" ? "" : "/" + tab}`));
    Router.params = { key: this.key, tab: tab === "parcalar" ? undefined : tab };
    this.tab = tab;
    this.render();
    this.enterTab();
  },

  enterTab() {
    clearInterval(this.logTimer);
    if (this.tab === "kayitlar") {
      this.loadLogs(true);
      this.logTimer = setInterval(() => { if (this.logState.follow) this.loadLogs(); }, 2500);
    }
    if (this.tab === "compose" && !this.compose) this.loadCompose();
  },

  // ---------- olaylar
  click(e) {
    const t = e.target;
    const tab = t.closest("[data-tab]");
    if (tab) return this.setTab(tab.dataset.tab);
    const act = t.closest("[data-app-act]");
    if (act) return appAction(act.dataset.key, act.dataset.appAct);
    if (t.closest("[data-app-more]")) {
      const a = findApp(this.key);
      if (a) Menu.open(t.closest("[data-app-more]"), appMenuItems(a).slice(2));
      return;
    }
    if (t.closest("[data-rename]")) return this.rename();
    const cact = t.closest("[data-cact]");
    if (cact) { e.stopPropagation(); return containerAction(cact.dataset.id, cact.dataset.cact, cact); }
    const reveal = t.closest("[data-reveal]");
    if (reveal) {
      const id = reveal.dataset.reveal;
      S.reveal.has(id) ? S.reveal.delete(id) : S.reveal.add(id);
      return this.render();
    }
    if (t.closest("[data-env]")) return copyAppEnv(this.key);
    if (t.closest("[data-log-copy]")) {
      const text = this.logState.rows.map((r) => `[${r.src}] ${r.line}`).join("\n");
      return copyText(`${findApp(this.key)?.name} kayıtları:\n\n${text}`, "Kayıtlar kopyalandı");
    }
    if (t.closest("[data-folder]")) return api("/api/klasor-ac", { key: this.key }).catch((err) => flash(err.message, true));
    if (t.closest("[data-add-part]")) return openNew("sablonlar", { app: this.key });
    if (t.closest("[data-open-part]") && !t.closest("a, button")) {
      Router.go(`/parca/${encodeURIComponent(t.closest("[data-open-part]").dataset.openPart)}`);
    }
  },

  input(e) {
    if (e.target.id === "alog-q") { this.logState.query = e.target.value; this.renderLogs(); }
  },

  change(e) {
    if (e.target.id === "alog-follow") this.logState.follow = e.target.checked;
    if (e.target.id === "alog-lines") { this.logState.lines = +e.target.value; this.loadLogs(true); }
  },

  blur(e) {
    if (!e.target.matches("[data-note]")) return;
    const a = findApp(this.key);
    const v = e.target.value;
    if (a && v.trim() !== (a.note || "")) {
      a.note = v.trim();
      api("/api/uygulama/ayar", { key: a.key, not: v }).then(() => { flash("Not kaydedildi"); refresh(); })
        .catch((err) => flash(err.message, true));
    }
  },

  async rename() {
    const a = findApp(this.key);
    if (!a) return;
    const name = await promptDialog({
      title: "Uygulamanın adını değiştir", label: "Görünen ad", value: a.name,
      help: `Sadece Basic Docker'da görünen ad değişir. Asıl adı (${a.default_name}) aynı kalır. Boş bırakırsan asıl ada döner.`,
    });
    if (name === null) return;
    try {
      await api("/api/uygulama/ayar", { key: a.key, ad: name });
      await refresh();
      flash("Ad değişti");
    } catch (err) { flash(err.message, true); }
  },

  // ---------- veri
  async loadLogs(force = false) {
    if (this.logState.loading) return;
    this.logState.loading = true;
    try {
      const r = await api(`/api/uygulama/kayitlar${q({ key: this.key, satir: this.logState.lines })}`);
      this.logState.rows = r.satirlar || [];
      this.logState.error = null;
    } catch (err) { this.logState.error = err.message; }
    this.logState.loading = false;
    this.renderLogs(force);
  },

  async loadCompose() {
    try {
      this.compose = (await api(`/api/uygulama/compose${q({ key: this.key })}`)).dosyalar;
    } catch (err) { this.compose = { error: err.message }; }
    this.render();
  },

  // ---------- çizim
  render() {
    const a = findApp(this.key);
    if (!S.data) return;
    if (!a) {
      patch($("#app-head", this.root), "");
      patch($("#app-tabs", this.root), "");
      if (activeJob(this.key)) return patch($("#app-body", this.root), skeletonRows(4));
      return patch($("#app-body", this.root), emptyState({
        icon: "search", title: `${T("app")} bulunamadı`, text: "Silinmiş ya da adı değişmiş olabilir.",
        action: html`<a class="btn" href="#/uygulamalar">${icon("chevronLeft")}${T("app", true)}</a>`,
      }));
    }
    const level = LEVEL_OF_APP[a.state] || "off";
    const job = activeJob(a.key);
    const compose = a.compose?.exists;

    patch($("#app-head", this.root), html`
      ${pageHead({
        crumbs: [{ href: "#/uygulamalar", label: T("app", true) }, { label: a.name }],
        lead: avatar(a.key, a.name, "lg"),
        title: html`${a.name}<button class="icon-btn sm title-edit" data-rename title="Adını değiştir" aria-label="Adını değiştir">${icon("edit")}</button>`,
        desc: html`${badge(level, a.state_text)}
          ${a.total ? html`<span class="meta">${a.running}/${a.total} ${Tl("container")} açık</span>` : ""}
          <span class="meta">${SOURCE_TEXT[a.source] || ""}</span>
          ${a.name !== a.default_name ? html`<span class="meta mono" title="Asıl adı">${a.default_name}</span>` : ""}`,
        actions: html`
          ${appMainButton(a)}
          ${a.up > 0 ? html`<button class="btn" data-app-act="yeniden" data-key="${a.key}" ${job ? raw("disabled") : ""}>${icon("restart")}Yeniden başlat</button>` : ""}
          ${compose ? html`<button class="btn" data-app-act="guncelle" data-key="${a.key}" ${job ? raw("disabled") : ""} title="Kalıpların yeni sürümlerini indirip değişen parçaları yeniden oluşturur">${icon("update")}Güncelle</button>` : ""}
          <button class="icon-btn" data-app-more aria-label="Diğer işlemler" aria-haspopup="menu" title="Diğer işlemler">${icon("more")}</button>`,
      })}
      ${job ? callout({ level: "info", icon: "refresh", title: job.title, text: job.last || "Sürüyor…",
        actions: html`<button class="btn sm" data-job="${job.id}">Çıktıyı gör</button>` }) : ""}
      ${!job && a.hint ? callout({
        level: a.state === "problem" ? "err" : a.state === "empty" ? "info" : "warn",
        title: a.state === "problem" ? "Bu uygulamada sorun var" : a.state === "empty" ? `${T("container", true)} silinmiş` : "Dikkat",
        text: a.hint,
        actions: (() => {
          const bad = a.containers.find((c) => c.level === "err");
          return bad ? html`<a class="btn sm" href="${link(`/parca/${bad.id}`)}">${icon("stethoscope")}Teşhis et: ${shortRole(bad.role_title)}</a>` : "";
        })(),
      }) : ""}`);

    patch($("#app-tabs", this.root), tabs([
      { id: "parcalar", label: T("container", true), icon: "box", count: a.total },
      { id: "kayitlar", label: T("logs"), icon: "logs" },
      { id: "kaynak", label: "Kaynak kullanımı", icon: "gauge" },
      a.compose?.files?.length && { id: "compose", label: "Compose dosyası", icon: "code" },
    ], this.tab));

    const body = $("#app-body", this.root);
    if (this.tab === "parcalar") patch(body, this.partsTab(a));
    else if (this.tab === "kaynak") patch(body, this.usageTab(a));
    else if (this.tab === "compose") patch(body, this.composeTab(a));
    else if (this.tab === "kayitlar") {
      if (!$("#alog-view", body)) {
        patch(body, html`
          <div class="toolbar">
            ${searchBox("alog-q", "Kayıtlarda ara…", this.logState.query)}
            <label class="select-inline">Son
              <select id="alog-lines">${[100, 300, 1000, 3000].map((n) => html`<option value="${n}" ${n === this.logState.lines ? raw("selected") : ""}>${n}</option>`)}</select>
              satır (her parçadan)</label>
            <label class="switch-inline"><input type="checkbox" id="alog-follow" ${this.logState.follow ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>Canlı takip</label>
            <div class="toolbar-spacer"></div>
            <button class="btn sm" data-log-copy>${icon("copy")}Kopyala</button>
          </div>
          <p class="muted small">Bütün ${Tl("container", true)} tek akışta, zamana göre sıralı. Soldaki etiket satırın hangi parçadan geldiğini gösterir.</p>
          <pre class="log-view tall" id="alog-view" tabindex="0" aria-label="Birleşik kayıtlar">Yükleniyor…</pre>`);
      }
      this.renderLogs();
    }
  },

  partsTab(a) {
    const conns = a.containers.filter((c) => c.connection);
    return html`
      <div class="split">
        <div class="split-main">
          ${a.containers.length ? html`<div class="part-list">${a.containers.map((c) => this.partRow(c, a))}</div>`
            : emptyState({ icon: "box", title: `Şu an hiç ${Tl("container")} yok`, compact: true,
              text: a.compose?.exists ? "Başlat'a basınca proje klasöründen yeniden kurulur." : "" })}
          ${isGroupApp(a) ? html`<button class="add-row" data-add-part>${icon("plus")}Bu uygulamaya ${Tl("container")} ekle (veritabanı, e-posta kutusu…)</button>` : ""}
        </div>
        <aside class="split-side">
          <section class="panel">
            <h3 class="panel-title">Bilgiler</h3>
            ${kv([
              ["Türü", SOURCE_TEXT[a.source] || ""],
              a.compose?.dir && ["Proje klasörü", html`<button class="link mono" data-folder title="Finder'da aç">${a.compose.dir}</button>`],
              a.compose?.files?.length && ["Compose dosyası", html`<span class="mono">${a.compose.files.map((f) => f.split("/").pop()).join(", ")}</span>`],
              ["Asıl adı", html`<span class="mono">${a.default_name}</span>`],
            ])}
          </section>
          ${a.links.length ? html`<section class="panel">
            <h3 class="panel-title">Tarayıcıda aç</h3>
            <div class="link-list">${a.links.map((l) => html`<div class="link-row">${linkChip(l.url, l.label, { dim: !l.running })}<span class="muted small">${l.role}</span></div>`)}</div>
          </section>` : ""}
          ${conns.length ? html`<section class="panel">
            <h3 class="panel-title">Bağlantı bilgileri</h3>
            <p class="muted small">Projenin .env dosyasına yapıştırılacak satırlar (${conns.length} ${Tl("container")}).</p>
            <button class="btn sm" data-env>${icon("key")}Hepsini .env olarak kopyala</button>
          </section>` : ""}
          <section class="panel">
            <label class="panel-title" for="note-input">Not</label>
            <textarea id="note-input" class="note" data-note rows="4" placeholder="Bu uygulama ne işe yarıyor? Ör. Müşteri paneli. Açmadan önce VPN'e bağlan.">${a.note}</textarea>
            <div class="help">Sadece sen görürsün. Kutudan çıkınca kaydedilir.</div>
          </section>
        </aside>
      </div>`;
  },

  partRow(c, a) {
    const st = S.stats[c.name];
    const lvl = containerLevel(c);
    const when = c.running ? (c.started_at && `${fmt.ago(c.started_at)} başladı`) : (c.finished_at && fmt.ago(c.finished_at) && `${fmt.ago(c.finished_at)} kapandı`);
    const vols = c.mounts.filter((m) => m.type === "volume" && !m.anonymous);
    const conn = c.connection;
    const shown = conn ? (S.reveal.has(c.id) ? conn.text : conn.masked) : "";
    return html`
      <article class="part-row lvl-${lvl}" data-open-part="${c.id}">
        ${kindTile(c.kind, lvl)}
        <div class="part-main">
          <div class="part-head">
            <a class="part-title" href="${link(`/parca/${c.id}`)}">${c.role_title}</a>
            ${badge(lvl, c.status_text)}
            ${c.running && st ? html`<span class="part-usage mono">${icon("cpu")}${fmt.pct(st.cpu)} ${icon("memory")}${fmt.bytes(st.mem)}</span>` : ""}
          </div>
          <div class="part-desc">${c.role_desc}</div>
          <div class="part-meta mono">${c.name} · ${c.image}${when ? html` · <span class="nomono">${when}</span>` : ""}</div>
          ${c.status_hint ? html`<div class="part-hint lvl-${c.level}">${icon("info")}${c.status_hint}</div>` : ""}
          <div class="part-facts">
            ${c.ports.length ? html`<div class="fact"><span class="fact-k">${T("port")}</span>${c.ports.map((p) => p.url
              ? linkChip(p.url, `localhost:${p.host}`, { dim: !c.running })
              : html`<span class="chip mono" title="İçeride ${p.container}">localhost:${p.host}</span>`)}</div>`
              : c.internal_ports.length ? html`<div class="fact"><span class="fact-k">${T("port")}</span><span class="muted small">Dışarıya kapalı — sadece diğer ${Tl("container", true)} ulaşır (içeride ${c.internal_ports.slice(0, 3).join(", ")})</span></div>` : ""}
            ${vols.length ? html`<div class="fact"><span class="fact-k">${T("volume")}</span>${vols.map((m) => html`<a class="chip mono" href="#/kutular" title="İçeride: ${m.dest}">${icon("drive")}${m.name}</a>`)}</div>` : ""}
          </div>
          ${conn ? html`
            <div class="conn">
              <div class="conn-head">
                <span>${icon("key")}Bağlantı bilgisi</span>
                <span class="conn-tools">
                  ${conn.has_secret ? html`<button class="icon-btn sm" data-reveal="${c.id}" aria-label="Şifreyi göster/gizle" title="${S.reveal.has(c.id) ? "Şifreyi gizle" : "Şifreyi göster"}">${icon(S.reveal.has(c.id) ? "eyeOff" : "eye")}</button>` : ""}
                  ${copyBtn(conn.text)}
                </span>
              </div>
              <pre>${shown}</pre>
              <div class="conn-note">${conn.scope === "local"
                ? "Bilgisayarındaki kodun bu adresle bağlanır. Projenin .env dosyasına yapıştırabilirsin."
                : "Bu parçaya dışarıdan kapı açılmamış. Bu adres sadece aynı uygulamadaki diğer parçalardan çalışır."}</div>
            </div>` : ""}
        </div>
        <div class="part-actions">
          ${c.state === "paused" ? html`<button class="btn sm go" data-cact="devam" data-id="${c.id}">${icon("play")}Devam ettir</button>` : ""}
          ${c.up
            ? html`<button class="btn sm" data-cact="durdur" data-id="${c.id}">${icon("stop")}Durdur</button>`
            : html`<button class="btn sm" data-cact="baslat" data-id="${c.id}">${icon("play")}Başlat</button>`}
          <a class="btn sm" href="${link(`/parca/${c.id}/kayitlar`)}">${icon("logs")}${T("logs")}</a>
          <button class="icon-btn sm" data-cact="menu" data-id="${c.id}" aria-label="Diğer işlemler" aria-haspopup="menu">${icon("more")}</button>
        </div>
      </article>`;
  },

  usageTab(a) {
    const running = a.containers.filter((c) => c.running);
    if (!running.length) return emptyState({ icon: "gauge", title: `Çalışan ${Tl("container")} yok`, text: "Kaynak kullanımı parçalar çalışırken görünür.", compact: true });
    return html`
      <div class="usage-grid">
        ${running.map((c) => {
          const s = S.stats[c.name];
          return html`
            <article class="usage-card">
              <header>${kindTile(c.kind, "ok")}<div><a class="strong" href="${link(`/parca/${c.id}/kaynak`)}">${c.role_title}</a><div class="muted small mono">${c.name}</div></div></header>
              ${s ? html`
                <div class="usage-metric"><div class="um-head"><span>İşlemci</span><b class="mono">${fmt.pct(s.cpu)}</b></div>${sparkline(s.hist.cpu, { w: 260, h: 40, cls: "accent" })}</div>
                <div class="usage-metric"><div class="um-head"><span>Bellek</span><b class="mono">${fmt.bytes(s.mem)}</b></div>${sparkline(s.hist.mem, { w: 260, h: 40 })}</div>
                <div class="usage-foot muted small mono">Ağ ↓${fmt.bytes(s.net_rx)} ↑${fmt.bytes(s.net_tx)} · Disk ${fmt.bytes(s.blk_r)} / ${fmt.bytes(s.blk_w)}</div>`
                : html`<div class="muted small">Ölçülüyor…</div>`}
            </article>`;
        })}
      </div>`;
  },

  composeTab(a) {
    if (!this.compose) return skeletonRows(8);
    if (this.compose.error) return callout({ level: "err", text: this.compose.error });
    return html`${this.compose.map((f) => html`
      <section class="panel code-panel">
        <header class="code-head">
          <span class="mono">${f.path}</span>
          <span class="row-actions">
            <button class="btn sm" data-folder>${icon("folder")}Klasörü aç</button>
            ${copyBtn(f.text)}
          </span>
        </header>
        <pre class="code">${f.text.split("\n").map((ln, i) => html`<span class="code-ln"><span class="code-no">${i + 1}</span>${ln}</span>`)}</pre>
      </section>`)}
      <p class="muted small">Dosyayı değiştirdikten sonra üstteki <b>Güncelle</b> ile değişen parçalar yeniden oluşturulur.</p>`;
  },

  renderLogs(scrollBottom = false) {
    const view = $("#alog-view", this.root);
    if (!view) return;
    const st = this.logState;
    if (st.error) { view.textContent = st.error; return; }
    const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 40;
    const qq = st.query.trim().toLocaleLowerCase("tr");
    const srcs = [...new Set(st.rows.map((r) => r.src))];
    const rows = qq ? st.rows.filter((r) => (r.src + " " + r.line).toLocaleLowerCase("tr").includes(qq)) : st.rows;
    if (!rows.length) {
      view.textContent = st.loading ? "Yükleniyor…" : qq ? "Aramaya uyan satır yok." : "(Henüz kayıt yok.)";
      return;
    }
    const markup = rows.map((r) => {
      const h = hue(r.src);
      const body = colorLog(r.line, qq);
      return `<span class="ln-src" style="--h:${h}" title="${esc(fmt.time(r.t))}">${esc(r.src.padEnd(Math.min(14, Math.max(...srcs.map((s) => s.length)))))}</span> ${body}`;
    }).join("\n");
    if (view.__html !== markup) {
      view.innerHTML = markup;
      view.__html = markup;
      if (scrollBottom || atBottom) view.scrollTop = view.scrollHeight;
    }
  },
};

// ---------- Tek parça işlemleri (uygulama ve parça sayfaları ortak) ------------
async function containerAction(id, act, anchor) {
  const found = findContainer(id);
  if (!found) return;
  const { app, c } = found;
  if (act === "menu") return Menu.open(anchor, containerMenuItems(c, app));
  if (act === "sil") return confirmDeleteContainer(c);
  if (act === "tasi") return openMove(c);
  if (act === "oldur") {
    const r = await confirmDialog({
      title: "Zorla kapatılsın mı?", danger: true, confirmText: "Zorla kapat", icon: "zap",
      text: `${c.name} beklemeden, anında kapatılır (fişini çekmek gibi). Normal Durdur çalışmıyorsa kullan; kaydedilmemiş veriler kaybolabilir.`,
    });
    if (!r) return;
  }
  if (act === "terminal") {
    try { await api("/api/parca", { id, islem: "terminal" }); flash("Terminal penceresi açılıyor…"); } catch (e) { flash(e.message, true); }
    return;
  }
  await runJob("/api/parca", { id, islem: act });
}

function containerMenuItems(c, app) {
  const db = c.kind === "db";
  return [
    { label: "Ayrıntıları aç", icon: "arrowRight", onClick: () => Router.go(`/parca/${encodeURIComponent(c.id)}`) },
    "-",
    c.up && { label: "Yeniden başlat", icon: "restart", onClick: () => containerAction(c.id, "yeniden") },
    c.running && c.state !== "paused" && { label: "Duraklat", icon: "pause", onClick: () => containerAction(c.id, "duraklat") },
    c.state === "paused" && { label: "Devam ettir", icon: "play", onClick: () => containerAction(c.id, "devam") },
    c.running && S.data?.platform?.mac && { label: "Terminal'de aç", icon: "terminal", onClick: () => containerAction(c.id, "terminal") },
    c.running && { label: "Komut çalıştır", icon: "code", onClick: () => Router.go(`/parca/${encodeURIComponent(c.id)}/komut`) },
    db && c.running && { label: "Veritabanı dökümü al", icon: "backup", onClick: () => runJob("/api/db/dokum", { id: c.id }, () => bus.emit("backups-changed")) },
    db && c.running && { label: "Dökümden geri yükle…", icon: "upload", onClick: () => openRestoreDbPicker(c) },
    "-",
    (c.source === "single" || c.source === "manual") && { label: c.source === "single" ? "Bir uygulamaya ekle" : "Grubunu değiştir", icon: "move", onClick: () => openMove(c) },
    { label: "Yeniden başlama kuralı…", icon: "sliders", onClick: () => openRestartPolicy(c) },
    c.up && c.state !== "paused" && { label: "Zorla kapat", icon: "zap", onClick: () => containerAction(c.id, "oldur") },
    "-",
    { label: "Sil…", icon: "trash", danger: true, onClick: () => confirmDeleteContainer(c) },
  ];
}
