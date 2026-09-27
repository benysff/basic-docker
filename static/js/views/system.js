"use strict";

/* =====================================================================
   Sistem: Docker motoru (OrbStack / Docker Desktop), bağlamlar,
   görünüm ve dil tercihleri, bildirimler, yedek klasörü, kısayollar.
   ===================================================================== */

const SHORTCUTS = [
  ["⌘+K", "Her yerde ara / komut paleti"],
  ["⌘+N", "Yeni ekle"],
  ["⌘+1 … ⌘+9", "Menüdeki sayfalara git"],
  ["/", "Sayfadaki arama kutusuna odaklan"],
  ["⌘+[", "Geri"],
  ["Esc", "Pencereyi / menüyü kapat"],
];

const SystemView = {
  mount(root) {
    this.root = root;
    this.info = null;
    this.prefs = null;
    this.error = null;
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({ title: "Sistem ve ayarlar", desc: "Docker motoru, bağlantılar ve Basic Docker'ın tercihleri." })}
        <div id="sy-body">${skeletonRows(8)}</div>
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
    try {
      const [s, p] = await Promise.all([api("/api/sistem").catch((e) => ({ error: e.message })), api("/api/ayarlar")]);
      this.info = s.sistem || null;
      this.error = s.error || null;
      this.prefs = p;
    } catch (e) { this.error = e.message; }
    this.render();
  },

  async click(e) {
    const t = e.target;
    const seg = t.closest("[data-seg]");
    if (seg) {
      const k = seg.dataset.seg, v = seg.dataset.val;
      if (k === "tema" || k === "dil") {
        S.prefs[k] = v;
        applyTheme();
        await api("/api/ayarlar/kaydet", { [k]: v }).catch(() => {});
        renderSidebar();
        this.render();
      }
      return;
    }
    if (t.closest("[data-start-engine]")) {
      try { flash((await api("/api/docker-ac", {})).mesaj); } catch (err) { flash(err.message, true); }
      return;
    }
    const ctx = t.closest("[data-context]");
    if (ctx) {
      const name = ctx.dataset.context;
      const r = await confirmDialog({
        title: `“${name}” bağlamına geçilsin mi?`, confirmText: "Geç", icon: "server",
        text: "Basic Docker ve terminaldeki docker komutu artık bu motora bağlanır. Diğer motordaki parçalar silinmez; geri geçince yine görünür.",
      });
      if (!r) return;
      try { await api("/api/baglam", { ad: name }); flash(`Artık ${name} kullanılıyor`); S.data = null; await refresh(); this.load(); } catch (err) { flash(err.message, true); }
      return;
    }
    if (t.closest("[data-backup-root]")) return chooseBackupRoot(() => this.load());
    if (t.closest("[data-open-backups]")) return api("/api/yedek/goster", {}).catch((err) => flash(err.message, true));
    if (t.closest("[data-intro]")) {
      S.prefs.intro_kapali = false;
      await api("/api/ayarlar/kaydet", { intro_kapali: false }).catch(() => {});
      return Router.go("/uygulamalar");
    }
    if (t.closest("[data-help]")) return openHelp();
    if (t.closest("[data-retry]")) return this.load();
  },

  change(e) {
    const t = e.target;
    if (t.id === "sy-notify") {
      S.prefs.bildirim = t.checked;
      api("/api/ayarlar/kaydet", { bildirim: t.checked }).catch(() => {});
      flash(t.checked ? "Çökme bildirimleri açık" : "Çökme bildirimleri kapalı");
    }
    if (t.id === "sy-narrow") {
      S.prefs.kenar_dar = t.checked;
      api("/api/ayarlar/kaydet", { kenar_dar: t.checked }).catch(() => {});
      applyTheme();
    }
  },

  render() {
    const body = $("#sy-body", this.root);
    const i = this.info;
    const up = S.data?.docker?.ok;
    const engineName = i?.engine_name || S.data?.platform?.engine_name || "Docker";
    patch(body, html`
      <div class="sys-grid">
        <section class="panel engine-card span-2">
          <div class="engine-top">
            <div class="engine-logo ${up ? "on" : ""}">${icon("server")}</div>
            <div class="grow">
              <div class="muted small">Docker motoru</div>
              <h2>${engineName}</h2>
              <div>${up ? badge("ok", "Çalışıyor") : badge("err", "Kapalı ya da ulaşılamıyor")}</div>
            </div>
            ${up ? "" : html`<button class="btn primary" data-start-engine>${icon("power")}${engineOpenLabel(i?.engine || S.data?.platform?.engine)}</button>`}
          </div>
          ${this.error && !i ? callout({ level: "warn", text: this.error, actions: html`<button class="btn sm" data-retry>${icon("refresh")}Tekrar dene</button>` }) : ""}
          ${i ? html`
            <div class="engine-stats">
              <div><span class="muted small">İşlemci</span><b>${i.cpus} çekirdek</b></div>
              <div><span class="muted small">Bellek</span><b>${fmt.bytes(i.memory, 0)}</b></div>
              <div><span class="muted small">Mimari</span><b>${i.arch}</b></div>
              <div><span class="muted small">${T("container", true)}</span><b>${i.containers.running} / ${i.containers.total}</b></div>
              <div><span class="muted small">${T("image", true)}</span><b>${i.images}</b></div>
            </div>
            ${kv([
              ["Docker sürümü", html`<span class="mono">${i.server_version}</span> <span class="muted small">(komut satırı ${i.client_version})</span>`],
              ["Compose sürümü", html`<span class="mono">${i.compose_version || "—"}</span>`],
              ["İşletim sistemi", i.os],
              ["Depolama sürücüsü", html`<span class="mono">${i.storage_driver}</span>`],
              ["docker komutu", html`<span class="mono">${i.docker_path || "bulunamadı"}</span>`],
            ])}
            ${i.engine === "orbstack" ? html`<p class="muted small">Motorun bellek ve işlemci sınırını OrbStack'in kendi ayarlarından değiştirebilirsin.</p>`
              : i.engine === "docker-desktop" ? html`<p class="muted small">Bellek ve işlemci sınırı: Docker Desktop → Settings → Resources.</p>` : ""}
            ${i.warnings.length ? callout({ level: "warn", title: "Docker uyarıları", text: i.warnings.join(" · ") }) : ""}` : ""}
        </section>

        ${i?.contexts?.length > 1 ? html`<section class="panel span-2">
          <h3 class="panel-title">${icon("server")}Bağlamlar (hangi Docker'a bağlanılıyor?)</h3>
          <p class="muted small">Bilgisayarında birden fazla Docker motoru varsa (ör. OrbStack ve Docker Desktop) buradan hangisini yöneteceğini seçersin.</p>
          <ul class="ctx-list">${i.contexts.map((c) => html`
            <li class="${c.current ? "current" : ""}">
              ${dot(c.current ? "ok" : "off")}
              <div class="grow min0"><div class="strong">${c.name}${c.desc ? html` <span class="muted small">— ${c.desc}</span>` : ""}</div><div class="mono small muted ellipsis">${c.endpoint}</div>${c.error ? html`<div class="small txt-err">${c.error}</div>` : ""}</div>
              ${c.current ? pill("Kullanılıyor", "ok") : html`<button class="btn sm" data-context="${c.name}">Buna geç</button>`}
            </li>`)}</ul>
        </section>` : ""}

        <section class="panel">
          <h3 class="panel-title">${icon("monitor")}Görünüm</h3>
          <div class="setting">
            <div><div class="strong">Tema</div><div class="muted small">Sistem seçilirse macOS'un açık/koyu ayarını izler.</div></div>
            ${segmented("tema", [{ id: "sistem", label: "Sistem", icon: "monitor" }, { id: "acik", label: "Açık", icon: "sun" }, { id: "koyu", label: "Koyu", icon: "moon" }], S.prefs.tema || "sistem")}
          </div>
          <div class="setting">
            <div><div class="strong">Dil</div><div class="muted small">Sade: “parça, kalıp, veri kutusu”. Teknik: “konteyner, imaj, volume”.</div></div>
            ${segmented("dil", [{ id: "sade", label: "Sade Türkçe" }, { id: "teknik", label: "Teknik terimler" }], S.prefs.dil || "sade")}
          </div>
          <div class="setting">
            <div><div class="strong">Dar kenar çubuğu</div><div class="muted small">Menüde sadece simgeler görünür, içeriğe daha çok yer kalır.</div></div>
            <label class="switch-inline"><input type="checkbox" id="sy-narrow" ${S.prefs.kenar_dar ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span><span class="sr">Dar kenar çubuğu</span></label>
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("bell")}Bildirimler ve yedekler</h3>
          <div class="setting">
            <div><div class="strong">Çökünce bildir</div><div class="muted small">Bir parça beklenmedik şekilde kapanırsa ya da sağlık kontrolünden geçemezse macOS bildirimi gelir (Basic Docker açıkken).</div></div>
            <label class="switch-inline"><input type="checkbox" id="sy-notify" ${S.prefs.bildirim !== false ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span><span class="sr">Çökünce bildir</span></label>
          </div>
          <div class="setting column">
            <div><div class="strong">Yedek klasörü</div><div class="mono small muted ellipsis" title="${this.prefs?.yedek_klasoru}">${this.prefs?.yedek_klasoru || ""}</div></div>
            <div class="row-actions"><button class="btn sm" data-open-backups>${icon("folder")}Aç</button><button class="btn sm" data-backup-root>Değiştir…</button></div>
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("command")}Klavye kısayolları</h3>
          <ul class="shortcut-list">${SHORTCUTS.map(([k, d]) => html`<li><span>${d}</span>${kbd(k)}</li>`)}</ul>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("info")}Hakkında</h3>
          <p><b>Basic Docker</b> <span class="mono muted">v${this.prefs?.surum || ""}</span></p>
          <p class="muted small">Docker'ı sade Türkçeyle yöneten, Mac'e özel uygulama. Tamamen yerel çalışır; ağa bir şey açmaz, sadece <code>docker</code> komutunu kullanır.</p>
          <div class="row-actions wrap">
            <button class="btn sm" data-help>${icon("help")}Sözlük</button>
            <button class="btn sm" data-intro>${icon("info")}Tanıtımı tekrar göster</button>
            <a class="btn sm" href="https://github.com/benysff/basic-docker" target="_blank" rel="noopener">${icon("external")}GitHub</a>
          </div>
        </section>
      </div>`);
  },
};
