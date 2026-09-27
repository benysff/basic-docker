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
    this.offSafety = bus.on("context-safety", () => this.load());
    this.info = null;
    this.prefs = null;
    this.error = null;
    this.ctx = null;
    this.tests = {};
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
    this.offSafety?.();
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
  },

  async load() {
    try {
      const [s, p, c] = await Promise.all([api("/api/sistem").catch((e) => ({ error: e.message })), api("/api/ayarlar"),
        api("/api/baglamlar").catch(() => null)]);
      this.info = s.sistem || null;
      this.error = s.error || null;
      this.prefs = p;
      this.ctx = c;
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
    if (t.closest("[data-use-local]")) return useLocalDocker();
    if (t.closest("[data-start-engine]")) {
      try { flash((await api("/api/docker-ac", {})).mesaj); } catch (err) { flash(err.message, true); }
      return;
    }
    const ctx = t.closest("[data-context]");
    if (ctx) {
      const name = ctx.dataset.context;
      const isRemote = (this.ctx?.baglamlar || []).some((c) => c.name === name && c.kind !== "local");
      const r = await confirmDialog({
        title: L(`“${name}” bağlamına geçilsin mi?`, `Switch to the “${name}” context?`), confirmText: L("Geç", "Switch"), icon: "server",
        text: isRemote
          ? L(`Sadece Basic Docker bu sunucuya bağlanır; terminaldeki docker komutu ${here("te")} kalır (yanlışlıkla sunucuda komut çalıştırmazsın). Varsayılan olarak güvenli moddadır.`,
            `Only Basic Docker connects to this server; the docker command in your terminal stays on ${hereEn()} (so you can't run something on the server by accident). It starts in safe mode.`)
          : L("Basic Docker ve terminaldeki docker komutu artık bu motora bağlanır. Diğer motordaki parçalar silinmez; geri geçince yine görünür.",
            "Basic Docker and the docker command in your terminal will connect to this engine. Containers on the other engine are not deleted; they show up again when you switch back."),
      });
      if (!r) return;
      try { await api("/api/baglam", { ad: name }); flash(L(`Artık ${name} kullanılıyor`, `Now using ${name}`)); await afterContextChange(); } catch (err) { flash(err.message, true); }
      return;
    }
    if (t.closest("[data-add-remote]")) return openAddRemote(() => this.load());
    const test = t.closest("[data-ctx-test]");
    if (test) {
      const name = test.dataset.ctxTest;
      this.tests[name] = { busy: true };
      this.render();
      try { this.tests[name] = (await api("/api/baglam/dene", { ad: name })).sonuc; } catch (err) { this.tests[name] = { ok: false, error: err.message }; }
      return this.render();
    }
    const del = t.closest("[data-ctx-del]");
    if (del) {
      const name = del.dataset.ctxDel;
      const r = await confirmDialog({
        title: L(`“${name}” bağlantısı silinsin mi?`, `Remove the “${name}” connection?`), danger: true, icon: "trash", confirmText: L("Sil", "Remove"),
        text: L(`Sadece ${here("teki")} bağlantı kaydı silinir. Sunucudaki parçalara ve verilere dokunulmaz.`,
          `Only the connection saved on ${hereEn()} is removed. Containers and data on the server are not touched.`),
      });
      if (!r) return;
      try { await api("/api/baglam/sil", { ad: name }); flash(L("Bağlantı silindi", "Connection removed")); this.load(); } catch (err) { flash(err.message, true); }
      return;
    }
    const tclose = t.closest("[data-tunnel-close]");
    if (tclose) {
      await api("/api/tunel/kapat", { kapi: +tclose.dataset.tunnelClose }).catch((err) => flash(err.message, true));
      return this.load();
    }
    if (t.closest("[data-tunnel-open]")) {
      const port = +$("#sy-tunnel-port", this.root)?.value;
      if (!port) return flash(L("Sunucudaki kapı numarasını yaz.", "Enter the port number on the server."), true);
      try {
        const tn = (await api("/api/tunel/ac", { kapi: port })).tunel;
        flash(L(`Tünel açık: localhost:${tn.local} → sunucu:${tn.remote}`, `Tunnel open: localhost:${tn.local} → server:${tn.remote}`));
      } catch (err) { flash(err.message, true); }
      return this.load();
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
    const remote = this.ctx?.uzak || S.data?.platform?.remote;
    const engineName = remote ? (remote.context || remote.host) : i?.engine_name || S.data?.platform?.engine_name || "Docker";
    patch(body, html`
      <div class="sys-grid">
        <section class="panel engine-card span-2">
          <div class="engine-top">
            <div class="engine-logo ${up ? "on" : ""}">${icon("server")}</div>
            <div class="grow">
              <div class="muted small">${remote ? L(`Uzak Docker · ${remote.kind.toUpperCase()} · ${remote.host}`, `Remote Docker · ${remote.kind.toUpperCase()} · ${remote.host}`) : L("Docker motoru", "Docker engine")}</div>
              <h2>${engineName}</h2>
              <div>${up ? badge("ok", L("Çalışıyor", "Running")) : badge("err", L("Kapalı ya da ulaşılamıyor", "Stopped or unreachable"))}</div>
            </div>
            ${up ? "" : remote ? html`<button class="btn primary" data-use-local>${icon("server")}${engineOpenLabel("remote")}</button>`
              : html`<button class="btn primary" data-start-engine>${icon("power")}${engineOpenLabel(i?.engine || S.data?.platform?.engine)}</button>`}
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
            ${remote ? html`<p class="muted small">${remote.kind === "ssh"
              ? L(`Bu motor uzak bir sunucuda. Parçaların kapılarına ${here("ten")} ulaşmak için bağlantılarına tıkla; SSH tüneli kendiliğinden açılır (VS Code'daki gibi).`,
                `This engine is on a remote server. Click a container's link to reach its port from ${hereEn()}; an SSH tunnel opens automatically (like in VS Code).`)
              : L("Bu motor uzak bir sunucuda (TCP). Kapılara sunucunun adresiyle ulaşılır; sadece sunucunun kendisine açık (127.0.0.1) kapılara buradan ulaşılamaz.",
                "This engine is on a remote server (TCP). Ports are reached at the server's address; ports bound only to the server itself (127.0.0.1) can't be reached from here.")}</p>`
              : i.engine === "orbstack" ? html`<p class="muted small">${L("Motorun bellek ve işlemci sınırını OrbStack'in kendi ayarlarından değiştirebilirsin.", "You can change the engine's memory and CPU limits in OrbStack's own settings.")}</p>`
              : i.engine === "docker-desktop" ? html`<p class="muted small">${L("Bellek ve işlemci sınırı", "Memory and CPU limits")}: Docker Desktop → Settings → Resources${onWin() ? L(" (WSL 2 kullanıyorsa %UserProfile%\\.wslconfig dosyasından)", " (with WSL 2: in %UserProfile%\\.wslconfig)") : ""}.</p>` : ""}
            ${i.warnings.length ? callout({ level: "warn", title: L("Docker uyarıları", "Docker warnings"), text: i.warnings.join(" · ") }) : ""}` : ""}
        </section>

        ${this.ctx ? html`<section class="panel span-2">
          <div class="panel-head">
            <h3 class="panel-title">${icon("server")}${L("Bağlantılar (hangi Docker'ı yönetiyorsun?)", "Connections (which Docker are you managing?)")}</h3>
            <button class="btn sm primary" data-add-remote>${icon("plus")}${L("Uzak Docker ekle", "Add remote Docker")}</button>
          </div>
          <p class="muted small">${L(`${here("teki", true)} motorlar (${onMac() ? "OrbStack, Docker Desktop" : "Docker Desktop"}) ve eklediğin uzak sunucular. Uzak sunucuya SSH anahtarınla bağlanılır; VS Code'daki gibi.`,
            `Engines on ${hereEn()} (${onMac() ? "OrbStack, Docker Desktop" : "Docker Desktop"}) and remote servers you've added. Remote servers are reached with your SSH key, just like in VS Code.`)}</p>
          <ul class="ctx-list">${this.ctx.baglamlar.map((c) => {
            const tr = this.tests[c.name];
            return html`
            <li class="${c.current ? "current" : ""}">
              ${dot(c.current ? "ok" : "off")}
              <div class="grow min0">
                <div class="strong">${c.name} ${pill(c.kind === "local" ? L(here("", true), hereEn(true)) : c.kind.toUpperCase(), c.kind === "local" ? "" : "info")}${c.desc ? html` <span class="muted small">— ${c.desc}</span>` : ""}</div>
                <div class="mono small muted ellipsis">${c.endpoint}</div>
                ${c.error ? html`<div class="small txt-err">${c.error}</div>` : ""}
                ${tr ? html`<div class="small ${tr.busy ? "muted" : tr.ok ? "txt-ok" : "txt-err"}">${tr.busy ? L("Deneniyor…", "Testing…")
                  : tr.ok ? L(`Bağlantı tamam · Docker ${tr.version} · ${tr.ms} ms`, `Connected · Docker ${tr.version} · ${tr.ms} ms`) : tr.error}</div>` : ""}
              </div>
              <div class="row-actions">
                <button class="btn sm" data-ctx-test="${c.name}" ${tr?.busy ? raw("disabled") : ""}>${icon("activity")}${L("Dene", "Test")}</button>
                ${c.kind === "local" ? "" : (this.ctx.tam_kontrol || []).includes(c.name)
                  ? html`<button class="btn sm" data-full-ctl="${c.name}" title="${L("Güvenli moda al", "Back to safe mode")}">${icon("shield")}${L("Tam kontrol", "Full control")}</button>`
                  : html`<button class="btn sm" data-full-ctl="${c.name}" data-on="1" title="${L("Silme, kurulum ve temizliği aç", "Allow delete, install and cleanup")}">${icon("lock")}${L("Güvenli mod", "Safe mode")}</button>`}
                ${c.current ? pill(L("Kullanılıyor", "In use"), "ok") : html`<button class="btn sm" data-context="${c.name}">${L("Buna geç", "Switch")}</button>`}
                ${c.current || c.kind === "local" ? "" : html`<button class="icon-btn sm" data-ctx-del="${c.name}" aria-label="${L("Bağlantıyı sil", "Remove connection")}" title="${L("Bağlantıyı sil", "Remove connection")}">${icon("trash")}</button>`}
              </div>
            </li>`;
          })}</ul>
        </section>` : ""}

        ${remote?.kind === "ssh" ? html`<section class="panel span-2">
          <h3 class="panel-title">${icon("link")}${L("SSH tünelleri", "SSH tunnels")}</h3>
          <p class="muted small">${L(`Sunucudaki bir kapıyı ${here("e")} getirir: sunucuda 3000'de çalışan site, burada localhost:3000'de açılır. Bağlantılara tıklayınca kendiliğinden açılır; veritabanı gibi tıklanmayan kapılar için buradan aç.`,
            `Brings a port on the server to ${hereEn()}: a site running on 3000 there opens at localhost:3000 here. Tunnels open automatically when you click a link; open one here for ports you don't click, like a database.`)}</p>
          ${this.ctx?.tuneller?.length ? html`<ul class="ctx-list">${this.ctx.tuneller.map((tn) => html`
            <li>${dot("ok")}
              <div class="grow min0"><div class="strong mono">localhost:${tn.local} → ${remote.host}:${tn.remote}</div><div class="small muted">${L(`${fmt.ago(tn.started)} açıldı`, `opened ${fmt.ago(tn.started)}`)}</div></div>
              <div class="row-actions">${linkChip(tn.url, L("Aç", "Open"))}<button class="btn sm" data-tunnel-close="${tn.remote}">${icon("close")}${L("Kapat", "Close")}</button></div>
            </li>`)}</ul>` : html`<p class="muted small">${L("Şu an açık tünel yok.", "No tunnels are open right now.")}</p>`}
          <div class="input-row tunnel-form">
            <input id="sy-tunnel-port" inputmode="numeric" placeholder="${L("Sunucudaki kapı (ör. 5432)", "Port on the server (e.g. 5432)")}" aria-label="${L("Sunucudaki kapı", "Port on the server")}">
            <button class="btn" data-tunnel-open>${icon("link")}${L("Tünel aç", "Open tunnel")}</button>
          </div>
        </section>` : ""}

        <section class="panel">
          <h3 class="panel-title">${icon("monitor")}${L("Görünüm", "Appearance")}</h3>
          <div class="setting">
            <div><div class="strong">Dil / Language</div><div class="muted small">${L("Arayüzün dili.", "The interface language.")}</div></div>
            ${segmented("lang", [{ id: "tr", label: "Türkçe" }, { id: "en", label: "English" }], S.prefs.lang === "en" ? "en" : "tr")}
          </div>
          <div class="setting">
            <div><div class="strong">${L("Tema", "Theme")}</div><div class="muted small">${L(`Sistem seçilirse ${onMac() ? "macOS'un" : onWin() ? "Windows'un" : "işletim sisteminin"} açık/koyu ayarını izler.`, `System follows ${onMac() ? "macOS's" : onWin() ? "Windows'" : "the system's"} light/dark setting.`)}</div></div>
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
          ${onMac() ? html`<div class="setting">
            <div><div class="strong">${L("Çökünce bildir", "Notify on crash")}</div><div class="muted small">${L("Bir parça beklenmedik şekilde kapanırsa ya da sağlık kontrolünden geçemezse macOS bildirimi gelir (Basic Docker açıkken).", "You get a macOS notification if a container stops unexpectedly or fails its health check (while Basic Docker is open).")}</div></div>
            <label class="switch-inline"><input type="checkbox" id="sy-notify" ${S.prefs.bildirim !== false ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span><span class="sr">${L("Çökünce bildir", "Notify on crash")}</span></label>
          </div>` : ""}
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
          <p class="muted small">${isEN() ? html`A desktop app that manages Docker in plain language. It runs entirely locally, opens nothing to the network and only uses the <code>docker</code> command.`
            : html`Docker'ı sade Türkçeyle yöneten masaüstü uygulaması. Tamamen yerel çalışır; ağa bir şey açmaz, sadece <code>docker</code> komutunu kullanır.`}</p>
          <div class="row-actions wrap">
            <button class="btn sm" data-help>${icon("help")}${L("Sözlük", "Glossary")}</button>
            <button class="btn sm" data-intro>${icon("info")}${L("Tanıtımı tekrar göster", "Show the intro again")}</button>
            <a class="btn sm" href="https://github.com/benysff/basic-docker" target="_blank" rel="noopener">${icon("external")}GitHub</a>
          </div>
        </section>
      </div>`);
  },
};
