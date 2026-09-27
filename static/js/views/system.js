"use strict";

/* =====================================================================
   Sistem: Docker motoru (OrbStack / Docker Desktop), bağlamlar,
   görünüm ve dil tercihleri, bildirimler, yedek klasörü, kısayollar.
   ===================================================================== */

const SHORTCUTS = [
  ["⌘+K", "Her yerde ara / komut paleti", "Search anywhere / command palette"],
  ["⌘+N", "Yeni ekle", "Add new"],
  ["⌘+1 … ⌘+9", "Menüdeki sayfalara git", "Go to menu pages"],
  ["/", "Sayfadaki arama kutusuna odaklan", "Focus the page's search box"],
  ["⌘+[", "Geri", "Back"],
  ["Esc", "Pencereyi / menüyü kapat", "Close dialog / menu"],
];

const SystemView = {
  mount(root) {
    this.root = root;
    this.info = null;
    this.prefs = null;
    this.error = null;
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({ title: L("Sistem ve ayarlar", "System & settings"), desc: L("Docker motoru, bağlantılar ve Basic Docker'ın tercihleri.", "The Docker engine, connections and Basic Docker's preferences.") })}
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
      if (k === "lang") return setLanguage(v);
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
        title: L(`“${name}” bağlamına geçilsin mi?`, `Switch to the “${name}” context?`), confirmText: L("Geç", "Switch"), icon: "server",
        text: L("Basic Docker ve terminaldeki docker komutu artık bu motora bağlanır. Diğer motordaki parçalar silinmez; geri geçince yine görünür.",
          "Basic Docker and the docker command in your terminal will connect to this engine. Containers on the other engine are not deleted; they show up again when you switch back."),
      });
      if (!r) return;
      try { await api("/api/baglam", { ad: name }); flash(L(`Artık ${name} kullanılıyor`, `Now using ${name}`)); S.data = null; await refresh(); this.load(); } catch (err) { flash(err.message, true); }
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
      flash(t.checked ? L("Çökme bildirimleri açık", "Crash notifications on") : L("Çökme bildirimleri kapalı", "Crash notifications off"));
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
              <div class="muted small">${L("Docker motoru", "Docker engine")}</div>
              <h2>${engineName}</h2>
              <div>${up ? badge("ok", L("Çalışıyor", "Running")) : badge("err", L("Kapalı ya da ulaşılamıyor", "Stopped or unreachable"))}</div>
            </div>
            ${up ? "" : html`<button class="btn primary" data-start-engine>${icon("power")}${engineOpenLabel(i?.engine || S.data?.platform?.engine)}</button>`}
          </div>
          ${this.error && !i ? callout({ level: "warn", text: this.error, actions: html`<button class="btn sm" data-retry>${icon("refresh")}${L("Tekrar dene", "Try again")}</button>` }) : ""}
          ${i ? html`
            <div class="engine-stats">
              <div><span class="muted small">${L("İşlemci", "CPU")}</span><b>${L(`${i.cpus} çekirdek`, `${i.cpus} cores`)}</b></div>
              <div><span class="muted small">${L("Bellek", "Memory")}</span><b>${fmt.bytes(i.memory, 0)}</b></div>
              <div><span class="muted small">${L("Mimari", "Architecture")}</span><b>${i.arch}</b></div>
              <div><span class="muted small">${T("container", true)}</span><b>${i.containers.running} / ${i.containers.total}</b></div>
              <div><span class="muted small">${T("image", true)}</span><b>${i.images}</b></div>
            </div>
            ${kv([
              [L("Docker sürümü", "Docker version"), html`<span class="mono">${i.server_version}</span> <span class="muted small">(${L("komut satırı", "CLI")} ${i.client_version})</span>`],
              [L("Compose sürümü", "Compose version"), html`<span class="mono">${i.compose_version || "—"}</span>`],
              [L("İşletim sistemi", "Operating system"), i.os],
              [L("Depolama sürücüsü", "Storage driver"), html`<span class="mono">${i.storage_driver}</span>`],
              [L("docker komutu", "docker command"), html`<span class="mono">${i.docker_path || L("bulunamadı", "not found")}</span>`],
            ])}
            ${i.engine === "orbstack" ? html`<p class="muted small">${L("Motorun bellek ve işlemci sınırını OrbStack'in kendi ayarlarından değiştirebilirsin.", "You can change the engine's memory and CPU limits in OrbStack's own settings.")}</p>`
              : i.engine === "docker-desktop" ? html`<p class="muted small">${L("Bellek ve işlemci sınırı", "Memory and CPU limits")}: Docker Desktop → Settings → Resources.</p>` : ""}
            ${i.warnings.length ? callout({ level: "warn", title: L("Docker uyarıları", "Docker warnings"), text: i.warnings.join(" · ") }) : ""}` : ""}
        </section>

        ${i?.contexts?.length > 1 ? html`<section class="panel span-2">
          <h3 class="panel-title">${icon("server")}${L("Bağlamlar (hangi Docker'a bağlanılıyor?)", "Contexts (which Docker are we talking to?)")}</h3>
          <p class="muted small">${L("Bilgisayarında birden fazla Docker motoru varsa (ör. OrbStack ve Docker Desktop) buradan hangisini yöneteceğini seçersin.", "If you have more than one Docker engine (e.g. OrbStack and Docker Desktop), choose which one to manage here.")}</p>
          <ul class="ctx-list">${i.contexts.map((c) => html`
            <li class="${c.current ? "current" : ""}">
              ${dot(c.current ? "ok" : "off")}
              <div class="grow min0"><div class="strong">${c.name}${c.desc ? html` <span class="muted small">— ${c.desc}</span>` : ""}</div><div class="mono small muted ellipsis">${c.endpoint}</div>${c.error ? html`<div class="small txt-err">${c.error}</div>` : ""}</div>
              ${c.current ? pill(L("Kullanılıyor", "In use"), "ok") : html`<button class="btn sm" data-context="${c.name}">${L("Buna geç", "Switch")}</button>`}
            </li>`)}</ul>
        </section>` : ""}

        <section class="panel">
          <h3 class="panel-title">${icon("monitor")}${L("Görünüm", "Appearance")}</h3>
          <div class="setting">
            <div><div class="strong">Dil / Language</div><div class="muted small">${L("Arayüzün dili.", "The interface language.")}</div></div>
            ${segmented("lang", [{ id: "tr", label: "Türkçe" }, { id: "en", label: "English" }], S.prefs.lang === "en" ? "en" : "tr")}
          </div>
          <div class="setting">
            <div><div class="strong">${L("Tema", "Theme")}</div><div class="muted small">${L("Sistem seçilirse macOS'un açık/koyu ayarını izler.", "System follows macOS's light/dark setting.")}</div></div>
            ${segmented("tema", [{ id: "sistem", label: L("Sistem", "System"), icon: "monitor" }, { id: "acik", label: L("Açık", "Light"), icon: "sun" }, { id: "koyu", label: L("Koyu", "Dark"), icon: "moon" }], S.prefs.tema || "sistem")}
          </div>
          ${isEN() ? "" : html`<div class="setting">
            <div><div class="strong">Terimler</div><div class="muted small">Sade: “parça, kalıp, veri kutusu”. Teknik: “konteyner, imaj, volume”.</div></div>
            ${segmented("dil", [{ id: "sade", label: "Sade Türkçe" }, { id: "teknik", label: "Teknik terimler" }], S.prefs.dil || "sade")}
          </div>`}
          <div class="setting">
            <div><div class="strong">${L("Dar kenar çubuğu", "Narrow sidebar")}</div><div class="muted small">${L("Menüde sadece simgeler görünür, içeriğe daha çok yer kalır.", "Only icons in the menu, more room for content.")}</div></div>
            <label class="switch-inline"><input type="checkbox" id="sy-narrow" ${S.prefs.kenar_dar ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span><span class="sr">${L("Dar kenar çubuğu", "Narrow sidebar")}</span></label>
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("bell")}${L("Bildirimler ve yedekler", "Notifications & backups")}</h3>
          <div class="setting">
            <div><div class="strong">${L("Çökünce bildir", "Notify on crash")}</div><div class="muted small">${L("Bir parça beklenmedik şekilde kapanırsa ya da sağlık kontrolünden geçemezse macOS bildirimi gelir (Basic Docker açıkken).", "You get a macOS notification if a container stops unexpectedly or fails its health check (while Basic Docker is open).")}</div></div>
            <label class="switch-inline"><input type="checkbox" id="sy-notify" ${S.prefs.bildirim !== false ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span><span class="sr">${L("Çökünce bildir", "Notify on crash")}</span></label>
          </div>
          <div class="setting column">
            <div><div class="strong">${L("Yedek klasörü", "Backups folder")}</div><div class="mono small muted ellipsis" title="${this.prefs?.yedek_klasoru}">${this.prefs?.yedek_klasoru || ""}</div></div>
            <div class="row-actions"><button class="btn sm" data-open-backups>${icon("folder")}${L("Aç", "Open")}</button><button class="btn sm" data-backup-root>${L("Değiştir…", "Change…")}</button></div>
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("command")}${L("Klavye kısayolları", "Keyboard shortcuts")}</h3>
          <ul class="shortcut-list">${SHORTCUTS.map(([k, tr, en]) => html`<li><span>${L(tr, en)}</span>${kbd(k)}</li>`)}</ul>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("info")}${L("Hakkında", "About")}</h3>
          <p><b>Basic Docker</b> <span class="mono muted">v${this.prefs?.surum || ""}</span></p>
          <p class="muted small">${isEN() ? html`A native Mac app that manages Docker in plain language. It runs entirely locally, opens nothing to the network and only uses the <code>docker</code> command.`
            : html`Docker'ı sade Türkçeyle yöneten, Mac'e özel uygulama. Tamamen yerel çalışır; ağa bir şey açmaz, sadece <code>docker</code> komutunu kullanır.`}</p>
          <div class="row-actions wrap">
            <button class="btn sm" data-help>${icon("help")}${L("Sözlük", "Glossary")}</button>
            <button class="btn sm" data-intro>${icon("info")}${L("Tanıtımı tekrar göster", "Show the intro again")}</button>
            <a class="btn sm" href="https://github.com/benysff/basic-docker" target="_blank" rel="noopener">${icon("external")}GitHub</a>
          </div>
        </section>
      </div>`);
  },
};
