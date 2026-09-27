"use strict";

/* =====================================================================
   Parça (konteyner) ayrıntısı: teşhis, genel bilgi, kayıtlar, kaynak,
   etkileşimli terminal, ortam değişkenleri, ham bilgi (inspect).
   ===================================================================== */

const QUICK_CMDS = [
  ["ls -la", "Bulunduğu klasördeki dosyalar"],
  ["env | sort", "Ortam değişkenleri"],
  ["df -h", "Disk kullanımı"],
  ["ps aux", "Çalışan programlar"],
  ["cat /etc/os-release", "İşletim sistemi"],
  ["whoami && id", "Hangi kullanıcı"],
];

function dbQuickCmds(c) {
  const img = (c.image || "").toLowerCase();
  if (/postgres|postgis|timescale/.test(img)) return [["psql -U \"${POSTGRES_USER:-postgres}\" -c '\\l'", "Veritabanları"], ["psql -U \"${POSTGRES_USER:-postgres}\" -d \"${POSTGRES_DB:-postgres}\" -c '\\dt'", "Tablolar"]];
  if (/mysql|mariadb/.test(img)) return [["MYSQL_PWD=\"${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}\" mysql -uroot -e 'SHOW DATABASES'", "Veritabanları"]];
  if (/redis|valkey/.test(img)) return [["redis-cli INFO keyspace", "Anahtar sayıları"], ["redis-cli DBSIZE", "Toplam anahtar"]];
  if (/mongo/.test(img)) return [["mongosh --quiet --eval 'db.adminCommand({listDatabases:1})'", "Veritabanları"]];
  return [];
}

const normTab = (t) => (t === "komut" ? "terminal" : t || "genel");

const ContainerView = {
  mount(root, params) {
    this.root = root;
    this.id = params.id;
    this.tab = normTab(params.tab);
    this.detail = null;
    this.diag = null;
    this.log = { raw: "", query: "", errorsOnly: false, ts: false, lines: 500, since: "", follow: true, hints: {}, loading: false };
    this.showEnv = new Set();
    root.innerHTML = String(html`<div class="page"><div id="c-head"></div><div id="c-diag"></div><div id="c-tabs"></div><div id="c-body"></div></div>`);
    root.addEventListener("click", this.onClick = (e) => this.click(e));
    root.addEventListener("input", this.onInput = (e) => this.input(e));
    root.addEventListener("change", this.onChange = (e) => this.change(e));
    root.addEventListener("keydown", this.onKey = (e) => this.key(e));
    this.offData = bus.on("data", () => this.onData());
    this.offStats = bus.on("stats", () => { if (["genel", "kaynak"].includes(this.tab)) this.renderBody(); });
    startStats(this);
    this.lastState = null;
    this.render();
    this.loadDetail();
    this.enterTab();
  },

  reparam(params) {
    if (params.id !== this.id) return false;
    this.tab = normTab(params.tab);
    this.render();
    this.enterTab();
    return true;
  },

  unmount() {
    for (const [ev, fn] of [["click", this.onClick], ["input", this.onInput], ["change", this.onChange], ["keydown", this.onKey]]) {
      this.root.removeEventListener(ev, fn);
    }
    this.offData();
    this.offStats();
    this.offTerm?.();
    this.termSession = null;
    stopStats(this);
    clearInterval(this.logTimer);
  },

  get found() { return findContainer(this.id); },

  onData() {
    const f = this.found;
    const sig = f ? `${f.c.state}|${f.c.health}|${f.c.started_at}` : "yok";
    if (this.lastState && sig !== this.lastState) { this.loadDetail(); }
    this.lastState = sig;
    this.render();
  },

  setTab(tab) {
    // Odak terminaldeyse gövde güncellenmez (patch odaklı metin kutusuna dokunmaz); önce bırak.
    if (this.tab === "terminal" && this.root.contains(document.activeElement)) document.activeElement.blur();
    history.replaceState(null, "", link(`/parca/${this.id}${tab === "genel" ? "" : "/" + tab}`));
    Router.params = { id: this.id, tab: tab === "genel" ? undefined : tab };
    this.tab = tab;
    this.render();
    this.enterTab();
  },

  enterTab() {
    clearInterval(this.logTimer);
    if (this.tab === "kayitlar") {
      this.loadLogs(true);
      this.logTimer = setInterval(() => { if (this.log.follow) this.loadLogs(); }, 2000);
    }
    if (this.tab === "terminal") setTimeout(() => this.termSession?.focus(), 60);
  },

  async loadDetail() {
    const f = this.found;
    if (!f) return;
    try {
      this.detail = (await api(`/api/parca/detay${q({ id: f.c.id })}`)).detay;
    } catch (e) { this.detail = { error: e.message }; }
    const c = this.found?.c;
    if (c && (c.level === "err" || c.state === "restarting" || c.health === "unhealthy" || (!c.running && c.exit_code))) {
      try { this.diag = (await api(`/api/parca/teshis${q({ id: c.id })}`)).teshis; } catch { this.diag = null; }
    } else {
      this.diag = null;
    }
    this.render();
  },

  async loadLogs(force = false) {
    const f = this.found;
    if (!f || this.log.loading) return;
    this.log.loading = true;
    try {
      const r = await api(`/api/kayitlar${q({ id: f.c.id, satir: this.log.lines, zaman: this.log.ts ? 1 : "", since: this.log.since })}`);
      const changed = r.metin !== this.log.raw;
      this.log.raw = r.metin;
      this.log.error = null;
      if (changed) await this.loadHints();
    } catch (e) { this.log.error = e.message; }
    this.log.loading = false;
    this.renderLogs(force);
  },

  async loadHints() {
    // Sadece hata gibi görünen satırlar için "bu ne demek?" ipucu iste.
    const lines = this.log.raw.split("\n");
    const idx = [];
    lines.forEach((ln, i) => { if (/error|exception|fatal|failed|refused|denied|killed|not found|no such|cannot|could not|unable|permission|allocated|in use/i.test(ln)) idx.push(i); });
    if (!idx.length) { this.log.hints = {}; return; }
    try {
      const r = await api("/api/kayit-ipuclari", { satirlar: idx.map((i) => lines[i]) });
      const hints = {};
      for (const [k, v] of Object.entries(r.ipuclari || {})) hints[idx[+k]] = v;
      this.log.hints = hints;
    } catch { this.log.hints = {}; }
  },

  // ---------- olaylar
  click(e) {
    const t = e.target;
    const tab = t.closest("[data-tab]");
    if (tab) return this.setTab(tab.dataset.tab);
    const cact = t.closest("[data-cact]");
    if (cact) return containerAction(cact.dataset.id, cact.dataset.cact, cact);
    const reveal = t.closest("[data-reveal]");
    if (reveal) {
      const id = reveal.dataset.reveal;
      S.reveal.has(id) ? S.reveal.delete(id) : S.reveal.add(id);
      return this.renderBody();
    }
    const envShow = t.closest("[data-env-show]");
    if (envShow) {
      const k = envShow.dataset.envShow;
      this.showEnv.has(k) ? this.showEnv.delete(k) : this.showEnv.add(k);
      return this.renderBody();
    }
    if (t.closest("[data-env-copy]")) {
      const text = (this.detail?.env || []).map((x) => `${x.key}=${x.value}`).join("\n");
      return copyText(text + "\n", "Ortam değişkenleri kopyalandı");
    }
    if (t.closest("[data-log-copy]")) {
      const c = this.found?.c;
      return copyText(`${c?.name} (${c?.image}) kayıtları:\n\n${this.visibleLog()}`, "Kayıtlar kopyalandı");
    }
    if (t.closest("[data-log-diagnose]")) return this.diagnoseNow();
    const qc = t.closest("[data-qcmd]");
    if (qc) return this.termSession?.run(qc.dataset.qcmd);
    if (t.closest("[data-term-clear]")) return this.termSession?.clear();
    if (t.closest("[data-term-reconnect]")) { this.termSession?.reconnect(); return this.termSession?.focus(); }
    if (t.closest("[data-term-close]")) {
      const f = this.found;
      if (f) { TermHub.close(f.c.id); this.termSession = null; this.termStopped = true; this.renderBody(); }
      return;
    }
    if (t.closest("[data-term-open]")) { this.termStopped = false; this.renderBody(); return this.termSession?.focus(); }
    if (t.closest("[data-raw-copy]")) return copyText(JSON.stringify(this.detail?.raw, null, 2), "Ham bilgi kopyalandı");
    if (t.closest("[data-policy]")) { const f = this.found; if (f) openRestartPolicy(f.c); return; }
    if (t.closest("[data-dump]")) { const f = this.found; if (f) runJob("/api/db/dokum", { id: f.c.id }, () => bus.emit("backups-changed")); return; }
    if (t.closest("[data-connect-net]")) { const f = this.found; if (f) openConnectToNetwork(f.c); return; }
    const goLink = t.closest("[data-go]");
    if (goLink) return Router.go(goLink.dataset.go);
  },

  input(e) {
    if (e.target.id === "log-q") { this.log.query = e.target.value; this.renderLogs(); }
  },

  change(e) {
    const id = e.target.id;
    if (id === "log-err") { this.log.errorsOnly = e.target.checked; this.renderLogs(); }
    if (id === "log-ts") { this.log.ts = e.target.checked; this.loadLogs(true); }
    if (id === "log-follow") this.log.follow = e.target.checked;
    if (id === "log-lines") { this.log.lines = +e.target.value; this.loadLogs(true); }
    if (id === "log-since") { this.log.since = e.target.value; this.loadLogs(true); }
    if (id === "term-user") { this.termSession?.reconnect(e.target.value); this.termSession?.focus(); }
  },

  key() {},

  async diagnoseNow() {
    const f = this.found;
    if (!f) return;
    try {
      this.diag = (await api(`/api/parca/teshis${q({ id: f.c.id })}`)).teshis;
      this.renderDiag(true);
      if (!this.diag.findings.length && !this.diag.summary) flash("Kayıtlarda bilinen bir hata kalıbı bulunamadı.");
      $("#c-diag", this.root)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) { flash(err.message, true); }
  },

  // ---------- çizim
  render() {
    const f = this.found;
    if (!S.data) return;
    if (!f) {
      patch($("#c-head", this.root), "");
      patch($("#c-diag", this.root), "");
      patch($("#c-tabs", this.root), "");
      return patch($("#c-body", this.root), emptyState({
        icon: "search", title: `${T("container")} bulunamadı`, text: "Silinmiş ya da yeniden oluşturulmuş olabilir.",
        action: html`<a class="btn" href="#/parcalar">${icon("chevronLeft")}${T("container", true)}</a>`,
      }));
    }
    const { app, c } = f;
    const lvl = containerLevel(c);
    const job = activeJob(app.key);
    const when = c.running ? `${fmt.since(c.started_at)} süredir çalışıyor` : c.finished_at && fmt.ago(c.finished_at) ? `${fmt.ago(c.finished_at)} kapandı` : "";
    const crumbs = app.source === "single"
      ? [{ href: "#/parcalar", label: T("container", true) }, { label: c.role_title }]
      : [{ href: "#/uygulamalar", label: T("app", true) }, { href: link(`/uygulama/${app.key}`), label: app.name }, { label: c.role_title }];

    patch($("#c-head", this.root), pageHead({
      crumbs,
      lead: kindTile(c.kind, lvl),
      title: c.role_title,
      desc: html`${badge(lvl, c.status_text)}<span class="meta mono">${c.name}</span><span class="meta mono">${c.image}</span>${when ? html`<span class="meta">${when}</span>` : ""}`,
      actions: html`
        ${job ? html`<button class="btn" disabled><span class="spinner"></span>Bekle…</button>`
          : c.state === "paused"
            ? html`<button class="btn go" data-cact="devam" data-id="${c.id}">${icon("play")}Devam ettir</button>
                   <button class="btn stop" data-cact="durdur" data-id="${c.id}">${icon("stop")}Durdur</button>`
          : c.up
            ? html`<button class="btn stop" data-cact="durdur" data-id="${c.id}">${icon("stop")}Durdur</button>
                   <button class="btn" data-cact="yeniden" data-id="${c.id}">${icon("restart")}Yeniden başlat</button>`
            : html`<button class="btn go" data-cact="baslat" data-id="${c.id}">${icon("play")}Başlat</button>`}
        ${c.running && S.data.platform?.mac ? html`<button class="btn" data-cact="terminal" data-id="${c.id}" title="Ayrı bir macOS Terminal penceresinde aç">${icon("external")}Terminal'de aç</button>` : ""}
        <button class="icon-btn" data-cact="menu" data-id="${c.id}" aria-label="Diğer işlemler" aria-haspopup="menu" title="Diğer işlemler">${icon("more")}</button>`,
    }));
    this.renderDiag();
    patch($("#c-tabs", this.root), tabs([
      { id: "genel", label: "Genel", icon: "info" },
      { id: "kayitlar", label: T("logs"), icon: "logs", alert: c.level === "err" ? "err" : null },
      { id: "kaynak", label: "Kaynak", icon: "gauge" },
      { id: "terminal", label: "Terminal", icon: "terminal" },
      { id: "ayarlar", label: T("env"), icon: "sliders", count: this.detail?.env?.length },
      { id: "incele", label: "Ham bilgi", icon: "code" },
    ], this.tab));
    this.renderBody();
  },

  renderDiag(force = false) {
    const d = this.diag;
    const c = this.found?.c;
    const el = $("#c-diag", this.root);
    if (!d || !c || (!d.summary && !d.findings.length && !force)) return patch(el, "");
    const sameTitle = d.exit && d.summary && d.summary.startsWith(d.exit.title);
    const exitLine = d.exit && d.exit.level !== "ok"
      ? html`<div class="diag-exit">${sameTitle ? "" : html`<b>${d.exit.title}.</b> `}${d.exit.desc}${d.exit.fix ? html` <b>Ne yapmalı?</b> ${d.exit.fix}` : ""}</div>` : "";
    patch(el, html`
      <section class="diag" aria-label="Teşhis">
        <header class="diag-head">
          <div class="diag-icon">${icon("stethoscope")}</div>
          <div>
            <h2>Teşhis</h2>
            <p>${d.summary || (d.findings.length ? "Kayıtlarda bilinen sorunlara benzeyen satırlar bulundu." : "Belirgin bir sorun bulunamadı.")}</p>
          </div>
        </header>
        ${exitLine}
        ${d.findings.length ? html`<ol class="findings">${d.findings.map((x) => html`
          <li class="finding">
            <div class="finding-title">${icon("bulb")}${x.title}</div>
            <p>${x.desc}</p>
            ${x.fix ? html`<p class="finding-fix"><b>Ne yapmalı?</b> ${x.fix}</p>` : ""}
            ${x.line ? html`<pre class="finding-line">${x.line}</pre>` : ""}
            ${x.link ? html`<button class="btn sm" data-go="/${{ ports: "kapilar", volumes: "kutular", networks: "aglar", cleanup: "temizlik", images: "kaliplar", system: "sistem" }[x.link] || ""}">${icon("arrowRight")}${{ ports: "Kapılara git", volumes: "Veri kutularına git", networks: "Ağlara git", cleanup: "Temizliğe git", images: "Kalıplara git", system: "Sisteme git" }[x.link] || "Git"}</button>` : ""}
          </li>`)}</ol>`
          : d.error_lines.length ? html`<div class="diag-lines"><div class="muted small">Hata gibi görünen son satırlar:</div><pre>${d.error_lines.join("\n")}</pre></div>` : ""}
      </section>`);
  },

  renderBody() {
    const f = this.found;
    if (!f) return;
    const body = $("#c-body", this.root);
    if (this.tab === "kayitlar") {
      if (!$("#log-view", body)) patch(body, this.logsShell());
      return this.renderLogs();
    }
    if (this.tab === "terminal") return this.renderTerminal(f.c);
    if (this.detail?.error) return patch(body, callout({ level: "err", text: this.detail.error }));
    if (this.tab === "genel") return patch(body, this.overview(f));
    if (this.tab === "kaynak") return patch(body, this.usage(f.c));
    if (this.tab === "ayarlar") return patch(body, this.envTab());
    if (this.tab === "incele") return patch(body, this.rawTab());
  },

  overview({ app, c }) {
    const d = this.detail;
    const st = S.stats[c.name];
    const vols = c.mounts.filter((m) => m.type === "volume");
    const binds = c.mounts.filter((m) => m.type === "bind");
    const conn = c.connection;
    const shown = conn ? (S.reveal.has(c.id) ? conn.text : conn.masked) : "";
    const policy = d?.restart?.options?.[d.restart.policy] || c.restart_policy;
    return html`
      <div class="ov-grid">
        <section class="panel">
          <h3 class="panel-title">${icon("info")}Durum</h3>
          ${kv([
            ["Ne işe yarar?", c.role_desc],
            ["Durum", badge(containerLevel(c), c.status_text)],
            c.running ? ["Çalışma süresi", fmt.since(c.started_at)] : c.finished_at && ["Kapanma", fmt.date(c.finished_at)],
            ["Oluşturulma", fmt.date(c.created)],
            ["Yeniden başlama", html`${policy} <button class="link" data-policy>Değiştir</button>`],
            c.restart_count ? ["Kaç kez yeniden başladı", html`<b class="${c.restart_count > 3 ? "txt-err" : ""}">${c.restart_count}</b>`] : null,
            [T("app"), html`<a href="${link(`/uygulama/${app.key}`)}">${app.name}</a>`],
            ["Kimlik", html`<span class="mono">${c.short_id}</span>`],
          ])}
          ${c.running && st ? html`<div class="ov-usage">
            <div><span class="muted small">İşlemci</span><b class="mono">${fmt.pct(st.cpu)}</b>${sparkline(st.hist.cpu, { w: 140, h: 26, cls: "accent" })}</div>
            <div><span class="muted small">Bellek</span><b class="mono">${fmt.bytes(st.mem)}</b>${sparkline(st.hist.mem, { w: 140, h: 26 })}</div>
          </div>` : ""}
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("plug")}${T("port", true)}</h3>
          ${c.ports.length ? html`<ul class="plain-list">${c.ports.map((p) => html`
            <li class="port-li">
              <span class="port-num mono">${p.host}</span>${icon("arrowRight", "muted")}<span class="mono muted">içeride ${p.container}/${p.proto}</span>
              ${p.local_only ? pill(html`${icon("lock")}Sadece bu Mac`, "ok") : pill(html`${icon("globe")}Ağa açık`, "warn")}
              ${p.url ? linkChip(p.url, "Aç", { dim: !c.running }) : ""}
            </li>`)}</ul>
            ${c.ports.some((p) => !p.local_only) ? html`<p class="muted small">“Ağa açık” kapılara aynı Wi-Fi'deki başka cihazlar da ulaşabilir. Sadece bu Mac'ten erişilsin istiyorsan compose dosyasında <code>127.0.0.1:${c.ports[0].host}:${c.ports[0].container}</code> biçimini kullan.</p>` : ""}`
            : c.internal_ports.length ? html`<p class="muted">Dışarıya kapı açılmamış. Sadece aynı ağdaki diğer ${Tl("container", true)} içerideki ${c.internal_ports.join(", ")} numarasına ulaşabilir.</p>`
              : html`<p class="muted">Bu parça hiçbir kapı dinlemiyor.</p>`}
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("network")}Ağ ve adresler</h3>
          ${d?.networks?.length ? html`<ul class="plain-list">${d.networks.map((n) => html`
            <li class="net-li">
              <div><a class="strong" href="#/aglar">${n.name}</a>${n.ip ? html`<span class="mono muted"> · ${n.ip}</span>` : ""}</div>
              ${n.aliases.length ? html`<div class="muted small">Diğer ${Tl("container", true)} bu parçaya şu adlarla ulaşır: ${n.aliases.map((al) => html`<code>${al}</code> `)}</div>` : ""}
            </li>`)}</ul>` : html`<p class="muted">${d ? "Hiçbir ağa bağlı değil." : "Yükleniyor…"}</p>`}
          <button class="btn sm" data-connect-net>${icon("link")}Başka bir ağa bağla</button>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("drive")}Veriler</h3>
          ${vols.length || binds.length ? html`<ul class="plain-list">
            ${vols.map((m) => html`<li><div>${icon("drive")}<a class="mono" href="#/kutular">${m.anonymous ? "İsimsiz kutu " + m.name.slice(0, 10) + "…" : m.name}</a></div><div class="muted small mono">→ ${m.dest}</div></li>`)}
            ${binds.map((m) => html`<li><div>${icon("folder")}<span class="mono">${m.source}</span></div><div class="muted small mono">→ ${m.dest}</div></li>`)}
          </ul>
          ${vols.length ? html`<p class="muted small">${T("volume")} parça silinse bile durur. ${c.kind === "db" ? "Veritabanı için 'Veritabanı dökümü' en güvenli yedektir." : ""}</p>` : ""}
          ${c.kind === "db" && c.running ? html`<button class="btn sm" data-dump>${icon("backup")}Veritabanı dökümü al</button>` : ""}`
            : html`<p class="muted">Kalıcı veri yok: parça silinince içindekiler de gider.</p>`}
        </section>

        ${conn ? html`<section class="panel span-2">
          <h3 class="panel-title">${icon("key")}Bağlantı bilgisi</h3>
          <div class="conn">
            <div class="conn-head"><span>.env satırları</span><span class="conn-tools">
              ${conn.has_secret ? html`<button class="icon-btn sm" data-reveal="${c.id}" aria-label="Şifreyi göster/gizle">${icon(S.reveal.has(c.id) ? "eyeOff" : "eye")}</button>` : ""}
              ${copyBtn(conn.text)}</span></div>
            <pre>${shown}</pre>
            <div class="conn-note">${conn.scope === "local" ? "Bilgisayarındaki kodun bu adresle bağlanır." : "Bu adres sadece aynı uygulamadaki diğer parçalardan çalışır."}</div>
          </div>
        </section>` : ""}

        ${d?.health?.test ? html`<section class="panel span-2">
          <h3 class="panel-title">${icon("stethoscope")}Sağlık kontrolü</h3>
          <p class="muted small">Docker bu komutu düzenli çalıştırıp parçanın gerçekten hazır olup olmadığına bakar.</p>
          <pre class="code small">${d.health.test}</pre>
          ${d.health.log.length ? html`<table class="table compact"><thead><tr><th>Zaman</th><th>Sonuç</th><th>Çıktı</th></tr></thead><tbody>
            ${d.health.log.slice().reverse().map((h) => html`<tr><td class="mono small">${fmt.time(h.start)}</td><td>${h.code === 0 ? badge("ok", "Geçti") : badge("err", `Kaldı (${h.code})`)}</td><td class="mono small ellipsis-2">${h.output || "—"}</td></tr>`)}
          </tbody></table>` : ""}
        </section>` : ""}
      </div>`;
  },

  usage(c) {
    if (!c.running) return emptyState({ icon: "gauge", title: "Parça kapalı", text: "Kaynak kullanımı parça çalışırken ölçülür.", compact: true });
    const s = S.stats[c.name];
    if (!s) return html`<div class="usage-big">${skeletonRows(3)}</div>`;
    const memPct = s.mem_limit ? (s.mem / s.mem_limit) * 100 : 0;
    const limit = this.detail?.memory_limit;
    return html`
      <div class="usage-big">
        <section class="panel metric">
          <div class="metric-head"><span>${icon("cpu")}İşlemci</span><b class="mono">${fmt.pct(s.cpu)}</b></div>
          ${sparkline(s.hist.cpu, { w: 600, h: 90, cls: "accent big" })}
          <p class="muted small">%100 = bir işlemci çekirdeğinin tamamı. Docker motorunun kullanabildiği çekirdek sayısı Sistem sayfasında yazar.</p>
        </section>
        <section class="panel metric">
          <div class="metric-head"><span>${icon("memory")}Bellek</span><b class="mono">${fmt.bytes(s.mem)} <small>/ ${fmt.bytes(limit || s.mem_limit, 0)}</small></b></div>
          ${sparkline(s.hist.mem, { w: 600, h: 90, cls: "big" })}
          ${meter(memPct)}
          <p class="muted small">${limit ? "Bu parçaya özel bir bellek sınırı konmuş." : "Bu parçanın özel bir sınırı yok; Docker motorunun belleğini paylaşır."}</p>
        </section>
        <div class="stat-row small">
          <div class="stat"><div class="stat-label">${icon("download")}Ağdan gelen</div><div class="stat-value mono">${fmt.bytes(s.net_rx)}</div></div>
          <div class="stat"><div class="stat-label">${icon("upload")}Ağa giden</div><div class="stat-value mono">${fmt.bytes(s.net_tx)}</div></div>
          <div class="stat"><div class="stat-label">${icon("drive")}Diskten okunan</div><div class="stat-value mono">${fmt.bytes(s.blk_r)}</div></div>
          <div class="stat"><div class="stat-label">${icon("drive")}Diske yazılan</div><div class="stat-value mono">${fmt.bytes(s.blk_w)}</div></div>
          <div class="stat"><div class="stat-label">${icon("activity")}Süreç sayısı</div><div class="stat-value mono">${s.pids}</div></div>
        </div>
      </div>`;
  },

  envTab() {
    const d = this.detail;
    if (!d) return skeletonRows(8);
    const labels = Object.entries(d.labels || {});
    return html`
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">${T("env")}</h3>
          <div class="row-actions"><button class="btn sm" data-env-copy>${icon("copy")}.env olarak kopyala</button></div>
        </header>
        <p class="muted small">Parçanın içindeki programa verilen ayarlar. Şifre gibi görünenler gizlendi; göz simgesiyle gösterebilirsin. Değiştirmek için compose dosyasını düzenleyip uygulamayı güncelle.</p>
        ${d.env.length ? html`<table class="table compact env-table"><tbody>${d.env.map((x) => html`
          <tr><td class="mono strong">${x.key}</td>
            <td class="mono env-val">${x.secret && !this.showEnv.has(x.key) ? "••••••••" : x.value || html`<span class="muted">(boş)</span>`}</td>
            <td class="actions-col">${x.secret ? html`<button class="icon-btn sm" data-env-show="${x.key}" aria-label="Göster/gizle">${icon(this.showEnv.has(x.key) ? "eyeOff" : "eye")}</button>` : ""}
              <button class="icon-btn sm" data-copy="${x.value}" aria-label="Değeri kopyala" title="Değeri kopyala">${icon("copy")}</button></td></tr>`)}
        </tbody></table>` : html`<p class="muted">Hiç ortam değişkeni yok.</p>`}
      </section>
      <section class="panel">
        <h3 class="panel-title">Başlangıç</h3>
        ${kv([
          ["Komut", html`<code>${(d.cmd || []).join(" ") || "—"}</code>`],
          ["Giriş noktası", html`<code>${(d.entrypoint || []).join(" ") || "—"}</code>`],
          ["Çalışma klasörü", html`<code>${d.workdir || "/"}</code>`],
          ["Kullanıcı", html`<code>${d.user || "root (varsayılan)"}</code>`],
          ["Makine adı", html`<code>${d.hostname}</code>`],
        ])}
      </section>
      ${labels.length ? html`<details class="panel">
        <summary class="panel-title">Etiketler (${labels.length})</summary>
        <table class="table compact"><tbody>${labels.map(([k, v]) => html`<tr><td class="mono small">${k}</td><td class="mono small env-val">${v}</td></tr>`)}</tbody></table>
      </details>` : ""}`;
  },

  rawTab() {
    const d = this.detail;
    if (!d) return skeletonRows(10);
    return html`
      <section class="panel code-panel">
        <header class="code-head"><span>docker inspect çıktısı</span><button class="btn sm" data-raw-copy>${icon("copy")}Kopyala</button></header>
        <pre class="code json">${JSON.stringify(d.raw, null, 2)}</pre>
      </section>`;
  },

  logsShell() {
    const l = this.log;
    return html`
      <div class="toolbar wrap">
        ${searchBox("log-q", "Kayıtlarda ara…", l.query)}
        <label class="switch-inline"><input type="checkbox" id="log-err" ${l.errorsOnly ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>Sadece hatalar</label>
        <label class="switch-inline"><input type="checkbox" id="log-ts" ${l.ts ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>Zaman</label>
        <label class="switch-inline"><input type="checkbox" id="log-follow" ${l.follow ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>Canlı</label>
        <label class="select-inline">
          <select id="log-since" aria-label="Zaman aralığı">
            ${[["", "Tüm zamanlar"], ["5m", "Son 5 dakika"], ["1h", "Son 1 saat"], ["24h", "Son 24 saat"]].map(([v, t]) => html`<option value="${v}" ${v === l.since ? raw("selected") : ""}>${t}</option>`)}
          </select>
        </label>
        <label class="select-inline">
          <select id="log-lines" aria-label="Satır sayısı">
            ${[200, 500, 2000, 10000].map((n) => html`<option value="${n}" ${n === l.lines ? raw("selected") : ""}>Son ${fmt.num(n)} satır</option>`)}
          </select>
        </label>
        <div class="toolbar-spacer"></div>
        <button class="btn sm" data-log-diagnose title="Kayıtlardaki bilinen hataları sade Türkçeyle açıkla">${icon("stethoscope")}Teşhis et</button>
        <button class="btn sm" data-log-copy>${icon("copy")}Kopyala</button>
      </div>
      <div class="log-meta muted small" id="log-meta"></div>
      <pre class="log-view tall" id="log-view" tabindex="0" aria-label="Kayıtlar">Yükleniyor…</pre>`;
  },

  visibleLog() {
    const lines = this.log.raw.split("\n");
    return (this.log.errorsOnly ? lines.filter((ln) => /\b(error|exception|fatal|failed|traceback|panic|critical|hata|refused|denied|warn)/i.test(ln)) : lines).join("\n");
  },

  renderLogs(scrollBottom = false) {
    const view = $("#log-view", this.root);
    if (!view) return;
    const l = this.log;
    if (l.error) { view.textContent = l.error; return; }
    const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 40;
    let text = l.raw;
    let hints = l.hints;
    if (l.errorsOnly) {
      const lines = l.raw.split("\n");
      const keep = [];
      const newHints = {};
      lines.forEach((ln, i) => {
        if (/\b(error|exception|fatal|failed|traceback|panic|critical|hata|refused|denied|warn)/i.test(ln) || hints[i]) {
          if (hints[i]) newHints[keep.length] = hints[i];
          keep.push(ln);
        }
      });
      text = keep.join("\n");
      hints = newHints;
    }
    const total = l.raw ? l.raw.split("\n").filter(Boolean).length : 0;
    const hintCount = Object.keys(l.hints).length;
    patch($("#log-meta", this.root), html`${fmt.num(total)} satır${hintCount ? html` · <span class="txt-warn">${icon("bulb")}${hintCount} satırda açıklama var</span>` : ""}`);
    if (!text.trim()) {
      view.textContent = l.loading ? "Yükleniyor…" : l.errorsOnly ? "Hata satırı yok. Güzel!" : "(Bu parça henüz hiçbir şey yazmamış.)";
      return;
    }
    const markup = String(colorLog(text, l.query, hints));
    if (view.__html !== markup) {
      view.innerHTML = markup || (l.query ? "Aramaya uyan satır yok." : "");
      view.__html = markup;
      if (scrollBottom || atBottom) view.scrollTop = view.scrollHeight;
    }
  },

  renderTerminal(c) {
    const body = $("#c-body", this.root);
    const existing = TermHub.get(c.id);
    if (this.termStopped || (!c.running && !existing)) {
      this.offTerm?.();
      this.termSession = null;
      return patch(body, html`
        <div class="term-closed">
          ${!c.running
            ? callout({ level: "warn", text: "Parça kapalı. Terminal açmak için önce başlat.",
                actions: html`<button class="btn go sm" data-cact="baslat" data-id="${c.id}">${icon("play")}Başlat</button>` })
            : html`<p class="muted">Terminal oturumu kapalı.</p>
                   <button class="btn primary" data-term-open>${icon("terminal")}Yeni oturum aç</button>`}
        </div>`);
    }
    let slot = $("#xterm-slot", body);
    if (!slot) {
      patch(body, this.termShell(c));
      slot = $("#xterm-slot", body);
    }
    const session = TermHub.open(c);
    if (this.termSession !== session) {
      this.offTerm?.();
      this.termSession = session;
      this.offTerm = session.onChange(() => this.renderTermBar());
    }
    session.mount(slot);
    this.renderTermBar();
  },

  termShell(c) {
    const quick = [...dbQuickCmds(c), ...QUICK_CMDS];
    return html`
      <div class="xterm-wrap">
        <div class="xterm-bar" id="xterm-bar"></div>
        <div class="xterm-slot" id="xterm-slot"></div>
      </div>
      <div class="quick-cmds">
        <span class="muted small">Hazır komutlar (terminale yazar):</span>
        ${quick.map(([cmd, label]) => html`<button class="chip" data-qcmd="${cmd}" title="${cmd}">${label}</button>`)}
      </div>
      <p class="muted small">Parçanın içinde gerçek bir terminal: <code>cd</code>, sekme tamamlama, <code>top</code>, <code>vim</code> çalışır.
        Kopyalamak için seç + ⌘C, yapıştırmak için ⌘V. Oturum, sayfalar arasında gezinince kopmaz; çıkmak için <code>exit</code>.</p>`;
  },

  renderTermBar() {
    const s = this.termSession;
    const bar = $("#xterm-bar", this.root);
    if (!s || !bar) return;
    const [lvl, text] = {
      baglaniyor: ["warn", "Bağlanıyor…"],
      acik: ["ok", "Bağlı"],
      kapandi: ["info", "Oturum kapandı · Enter ile yeniden bağlan"],
      hata: ["err", s.error || "Bağlantı hatası"],
    }[s.state];
    patch(bar, html`
      <span class="xterm-status"><span class="dot lvl-${lvl}"></span>${text}</span>
      <span class="mono small muted xterm-name">${s.user === "root" ? "root@" : ""}${s.name}</span>
      <span class="grow"></span>
      <label class="small muted xterm-user">Kullanıcı
        <select id="term-user" aria-label="Terminal kullanıcısı">
          <option value="" ${s.user ? "" : "selected"}>varsayılan</option>
          <option value="root" ${s.user === "root" ? "selected" : ""}>root</option>
        </select>
      </label>
      <button class="btn sm" data-term-clear title="Ekranı temizle">${icon("trash")}Temizle</button>
      <button class="btn sm" data-term-reconnect title="Oturumu yeniden başlat">${icon("restart")}Yeniden bağlan</button>
      <button class="btn sm" data-term-close title="Oturumu kapat">${icon("close")}Kapat</button>`);
  },
};
