"use strict";

/* =====================================================================
   Parça (konteyner) ayrıntısı: teşhis, genel bilgi, kayıtlar, kaynak,
   etkileşimli terminal, ortam değişkenleri, ham bilgi (inspect).
   ===================================================================== */

const QUICK_CMDS = [
  ["ls -la", "Bulunduğu klasördeki dosyalar", "Files in the current folder"],
  ["env | sort", "Ortam değişkenleri", "Environment variables"],
  ["df -h", "Disk kullanımı", "Disk usage"],
  ["ps aux", "Çalışan programlar", "Running processes"],
  ["cat /etc/os-release", "İşletim sistemi", "Operating system"],
  ["whoami && id", "Hangi kullanıcı", "Which user"],
];

function dbQuickCmds(c) {
  const img = (c.image || "").toLowerCase();
  if (/postgres|postgis|timescale/.test(img)) return [["psql -U \"${POSTGRES_USER:-postgres}\" -c '\\l'", "Veritabanları", "Databases"], ["psql -U \"${POSTGRES_USER:-postgres}\" -d \"${POSTGRES_DB:-postgres}\" -c '\\dt'", "Tablolar", "Tables"]];
  if (/mysql|mariadb/.test(img)) return [["MYSQL_PWD=\"${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}\" mysql -uroot -e 'SHOW DATABASES'", "Veritabanları", "Databases"]];
  if (/redis|valkey/.test(img)) return [["redis-cli INFO keyspace", "Anahtar sayıları", "Key counts"], ["redis-cli DBSIZE", "Toplam anahtar", "Total keys"]];
  if (/mongo/.test(img)) return [["mongosh --quiet --eval 'db.adminCommand({listDatabases:1})'", "Veritabanları", "Databases"]];
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
    this.termStopped = false;  // başka bir parçada "oturumu kapat" denmesi burada sürmesin
    // Bu nesne sayfalar arasında yeniden kullanılır: A'nın geç gelen cevabı B'nin sayfasına yazılmasın.
    this.token = {};
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
    const token = this.token;
    let detail;
    try {
      detail = (await api(`/api/parca/detay${q({ id: f.c.id })}`)).detay;
    } catch (e) { detail = { error: e.message }; }
    if (token !== this.token) return;
    this.detail = detail;
    const c = this.found?.c;
    let diag = null;
    if (c && (c.level === "err" || c.state === "restarting" || c.health === "unhealthy" || (!c.running && c.exit_code))) {
      try { diag = (await api(`/api/parca/teshis${q({ id: c.id })}`)).teshis; } catch { diag = null; }
    }
    if (token !== this.token) return;
    this.diag = diag;
    this.render();
  },

  async loadLogs(force = false) {
    const f = this.found;
    if (!f || this.log.loading) return;
    const token = this.token;
    const log = this.log;
    log.loading = true;
    try {
      const r = await api(`/api/kayitlar${q({ id: f.c.id, satir: this.log.lines, zaman: this.log.ts ? 1 : "", since: this.log.since })}`);
      if (token !== this.token) { log.loading = false; return; }  // başka parçaya geçilmiş
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
      return copyText(text + "\n", L("Ortam değişkenleri kopyalandı", "Environment variables copied"));
    }
    if (t.closest("[data-log-copy]")) {
      const c = this.found?.c;
      return copyText(`${c?.name} (${c?.image}) ${L("kayıtları", "logs")}:\n\n${this.visibleLog()}`, L("Kayıtlar kopyalandı", "Logs copied"));
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
    if (t.closest("[data-raw-copy]")) return copyText(JSON.stringify(this.detail?.raw, null, 2), L("Ham bilgi kopyalandı", "Raw info copied"));
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
      if (!this.diag.findings.length && !this.diag.summary) flash(L("Kayıtlarda bilinen bir hata kalıbı bulunamadı.", "No known error pattern found in the logs."));
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
        icon: "search", title: L(`${T("container")} bulunamadı`, "Container not found"), text: L("Silinmiş ya da yeniden oluşturulmuş olabilir.", "It may have been deleted or recreated."),
        action: html`<a class="btn" href="#/parcalar">${icon("chevronLeft")}${T("container", true)}</a>`,
      }));
    }
    const { app, c } = f;
    const lvl = containerLevel(c);
    const job = activeJob(app.key);
    const when = c.running ? L(`${fmt.since(c.started_at)} süredir çalışıyor`, `up for ${fmt.since(c.started_at)}`)
      : c.finished_at && fmt.ago(c.finished_at) ? L(`${fmt.ago(c.finished_at)} kapandı`, `stopped ${fmt.ago(c.finished_at)}`) : "";
    const crumbs = app.source === "single"
      ? [{ href: "#/parcalar", label: T("container", true) }, { label: c.role_title }]
      : [{ href: "#/uygulamalar", label: T("app", true) }, { href: link(`/uygulama/${app.key}`), label: app.name }, { label: c.role_title }];

    patch($("#c-head", this.root), pageHead({
      crumbs,
      lead: kindTile(c.kind, lvl),
      title: c.role_title,
      desc: html`${badge(lvl, c.status_text)}<span class="meta mono">${c.name}</span><span class="meta mono">${c.image}</span>${when ? html`<span class="meta">${when}</span>` : ""}`,
      actions: html`
        ${job ? html`<button class="btn" disabled><span class="spinner"></span>${L("Bekle…", "Wait…")}</button>`
          : c.state === "paused"
            ? html`<button class="btn go" data-cact="devam" data-id="${c.id}">${icon("play")}${L("Devam ettir", "Resume")}</button>
                   <button class="btn stop" data-cact="durdur" data-id="${c.id}">${icon("stop")}${L("Durdur", "Stop")}</button>`
          : c.up
            ? html`<button class="btn stop" data-cact="durdur" data-id="${c.id}">${icon("stop")}${L("Durdur", "Stop")}</button>
                   <button class="btn" data-cact="yeniden" data-id="${c.id}">${icon("restart")}${L("Yeniden başlat", "Restart")}</button>`
            : html`<button class="btn go" data-cact="baslat" data-id="${c.id}">${icon("play")}${L("Başlat", "Start")}</button>`}
        ${c.running && S.data.platform?.mac ? html`<button class="btn" data-cact="terminal" data-id="${c.id}" title="${L("Ayrı bir macOS Terminal penceresinde aç", "Open in a separate macOS Terminal window")}">${icon("external")}${L("Terminal'de aç", "Open in Terminal")}</button>` : ""}
        <button class="icon-btn" data-cact="menu" data-id="${c.id}" aria-label="${L("Diğer işlemler", "More actions")}" aria-haspopup="menu" title="${L("Diğer işlemler", "More actions")}">${icon("more")}</button>`,
    }));
    this.renderDiag();
    patch($("#c-tabs", this.root), tabs([
      { id: "genel", label: L("Genel", "Overview"), icon: "info" },
      { id: "kayitlar", label: T("logs"), icon: "logs", alert: c.level === "err" ? "err" : null },
      { id: "kaynak", label: L("Kaynak", "Usage"), icon: "gauge" },
      { id: "terminal", label: "Terminal", icon: "terminal" },
      { id: "ayarlar", label: T("env"), icon: "sliders", count: this.detail?.env?.length },
      { id: "incele", label: L("Ham bilgi", "Inspect"), icon: "code" },
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
      ? html`<div class="diag-exit">${sameTitle ? "" : html`<b>${d.exit.title}.</b> `}${d.exit.desc}${d.exit.fix ? html` <b>${L("Ne yapmalı?", "What to do?")}</b> ${d.exit.fix}` : ""}</div>` : "";
    patch(el, html`
      <section class="diag" aria-label="${L("Teşhis", "Diagnosis")}">
        <header class="diag-head">
          <div class="diag-icon">${icon("stethoscope")}</div>
          <div>
            <h2>${L("Teşhis", "Diagnosis")}</h2>
            <p>${d.summary || (d.findings.length ? L("Kayıtlarda bilinen sorunlara benzeyen satırlar bulundu.", "Found log lines that look like known problems.") : L("Belirgin bir sorun bulunamadı.", "No obvious problem found."))}</p>
          </div>
        </header>
        ${exitLine}
        ${d.findings.length ? html`<ol class="findings">${d.findings.map((x) => html`
          <li class="finding">
            <div class="finding-title">${icon("bulb")}${x.title}</div>
            <p>${x.desc}</p>
            ${x.fix ? html`<p class="finding-fix"><b>${L("Ne yapmalı?", "What to do?")}</b> ${x.fix}</p>` : ""}
            ${x.line ? html`<pre class="finding-line">${x.line}</pre>` : ""}
            ${x.link ? html`<button class="btn sm" data-go="/${{ ports: "kapilar", volumes: "kutular", networks: "aglar", cleanup: "temizlik", images: "kaliplar", system: "sistem" }[x.link] || ""}">${icon("arrowRight")}${isEN() ? ({ ports: "Go to Ports", volumes: "Go to Volumes", networks: "Go to Networks", cleanup: "Go to Cleanup", images: "Go to Images", system: "Go to System" }[x.link] || "Go")
              : ({ ports: "Kapılara git", volumes: "Veri kutularına git", networks: "Ağlara git", cleanup: "Temizliğe git", images: "Kalıplara git", system: "Sisteme git" }[x.link] || "Git")}</button>` : ""}
          </li>`)}</ol>`
          : d.error_lines.length ? html`<div class="diag-lines"><div class="muted small">${L("Hata gibi görünen son satırlar:", "Last lines that look like errors:")}</div><pre>${d.error_lines.join("\n")}</pre></div>` : ""}
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
          <h3 class="panel-title">${icon("info")}${L("Durum", "Status")}</h3>
          ${kv([
            [L("Ne işe yarar?", "What it does"), c.role_desc],
            [L("Durum", "Status"), badge(containerLevel(c), c.status_text)],
            c.running ? [L("Çalışma süresi", "Uptime"), fmt.since(c.started_at)] : c.finished_at && [L("Kapanma", "Stopped at"), fmt.date(c.finished_at)],
            [L("Oluşturulma", "Created"), fmt.date(c.created)],
            [L("Yeniden başlama", "Restart policy"), html`${policy} <button class="link" data-policy>${L("Değiştir", "Change")}</button>`],
            c.restart_count ? [L("Kaç kez yeniden başladı", "Restart count"), html`<b class="${c.restart_count > 3 ? "txt-err" : ""}">${c.restart_count}</b>`] : null,
            [T("app"), html`<a href="${link(`/uygulama/${app.key}`)}">${app.name}</a>`],
            [L("Kimlik", "ID"), html`<span class="mono">${c.short_id}</span>`],
          ])}
          ${c.running && st ? html`<div class="ov-usage">
            <div><span class="muted small">${L("İşlemci", "CPU")}</span><b class="mono">${fmt.pct(st.cpu)}</b>${sparkline(st.hist.cpu, { w: 140, h: 26, cls: "accent" })}</div>
            <div><span class="muted small">${L("Bellek", "Memory")}</span><b class="mono">${fmt.bytes(st.mem)}</b>${sparkline(st.hist.mem, { w: 140, h: 26 })}</div>
          </div>` : ""}
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("plug")}${T("port", true)}</h3>
          ${c.ports.length ? html`<ul class="plain-list">${c.ports.map((p) => html`
            <li class="port-li">
              <span class="port-num mono">${p.host}</span>${icon("arrowRight", "muted")}<span class="mono muted">${L(`içeride ${p.container}/${p.proto}`, `${p.container}/${p.proto} inside`)}</span>
              ${p.local_only ? pill(html`${icon("lock")}${L(onRemoteEngine() ? "Sadece sunucunun kendisi" : `Sadece ${here()}`, onRemoteEngine() ? "Server only" : `${hereEn(true)} only`)}`, "ok") : pill(html`${icon("globe")}${L("Ağa açık", "Open to network")}`, "warn")}
              ${p.url ? linkChip(p.url, L("Aç", "Open"), { dim: !c.running }) : ""}
            </li>`)}</ul>
            ${c.ports.some((p) => !p.local_only) ? html`<p class="muted small">${isEN() ? html`Other devices on the same Wi-Fi can reach ports that are “open to network”. To allow ${onRemoteEngine() ? "the server itself" : hereEn()} only, use <code>127.0.0.1:${c.ports[0].host}:${c.ports[0].container}</code> in the compose file.`
              : html`“Ağa açık” kapılara aynı Wi-Fi'deki başka cihazlar da ulaşabilir. Sadece ${onRemoteEngine() ? "sunucunun kendisinden" : here("ten")} erişilsin istiyorsan compose dosyasında <code>127.0.0.1:${c.ports[0].host}:${c.ports[0].container}</code> biçimini kullan.`}</p>` : ""}`
            : c.internal_ports.length ? html`<p class="muted">${L(`Dışarıya kapı açılmamış. Sadece aynı ağdaki diğer ${Tl("container", true)} içerideki ${c.internal_ports.join(", ")} numarasına ulaşabilir.`, `No published port. Only other containers on the same network can reach ${c.internal_ports.join(", ")} inside.`)}</p>`
              : html`<p class="muted">${L("Bu parça hiçbir kapı dinlemiyor.", "This container doesn't listen on any port.")}</p>`}
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("network")}${L("Ağ ve adresler", "Network and addresses")}</h3>
          ${d?.networks?.length ? html`<ul class="plain-list">${d.networks.map((n) => html`
            <li class="net-li">
              <div><a class="strong" href="#/aglar">${n.name}</a>${n.ip ? html`<span class="mono muted"> · ${n.ip}</span>` : ""}</div>
              ${n.aliases.length ? html`<div class="muted small">${L(`Diğer ${Tl("container", true)} bu parçaya şu adlarla ulaşır:`, "Other containers reach it by these names:")} ${n.aliases.map((al) => html`<code>${al}</code> `)}</div>` : ""}
            </li>`)}</ul>` : html`<p class="muted">${d ? L("Hiçbir ağa bağlı değil.", "Not connected to any network.") : L("Yükleniyor…", "Loading…")}</p>`}
          <button class="btn sm" data-connect-net>${icon("link")}${L("Başka bir ağa bağla", "Connect to another network")}</button>
        </section>

        <section class="panel">
          <h3 class="panel-title">${icon("drive")}${L("Veriler", "Data")}</h3>
          ${vols.length || binds.length ? html`<ul class="plain-list">
            ${vols.map((m) => html`<li><div>${icon("drive")}<a class="mono" href="#/kutular">${m.anonymous ? L("İsimsiz kutu ", "Anonymous volume ") + m.name.slice(0, 10) + "…" : m.name}</a></div><div class="muted small mono">→ ${m.dest}</div></li>`)}
            ${binds.map((m) => html`<li><div>${icon("folder")}<span class="mono">${m.source}</span></div><div class="muted small mono">→ ${m.dest}</div></li>`)}
          </ul>
          ${vols.length ? html`<p class="muted small">${L(`${T("volume")} parça silinse bile durur.`, "Volumes stay even if the container is deleted.")} ${c.kind === "db" ? L("Veritabanı için 'Veritabanı dökümü' en güvenli yedektir.", "For a database, a 'Database dump' is the safest backup.") : ""}</p>` : ""}
          ${c.kind === "db" && c.running ? html`<button class="btn sm" data-dump>${icon("backup")}${L("Veritabanı dökümü al", "Take a database dump")}</button>` : ""}`
            : html`<p class="muted">${L("Kalıcı veri yok: parça silinince içindekiler de gider.", "No persistent data: its contents go away with the container.")}</p>`}
        </section>

        ${conn ? html`<section class="panel span-2">
          <h3 class="panel-title">${icon("key")}${L("Bağlantı bilgisi", "Connection details")}</h3>
          <div class="conn">
            <div class="conn-head"><span>${L(".env satırları", ".env lines")}</span><span class="conn-tools">
              ${conn.has_secret ? html`<button class="icon-btn sm" data-reveal="${c.id}" aria-label="${L("Şifreyi göster/gizle", "Show/hide password")}">${icon(S.reveal.has(c.id) ? "eyeOff" : "eye")}</button>` : ""}
              ${copyBtn(conn.text)}</span></div>
            <pre>${shown}</pre>
            <div class="conn-note">${connNote(conn) || (conn.scope === "local" ? L("Bilgisayarındaki kodun bu adresle bağlanır.", "Code on your computer connects with this address.") : L("Bu adres sadece aynı uygulamadaki diğer parçalardan çalışır.", "This address only works from other containers in the same app."))}</div>
          </div>
        </section>` : ""}

        ${d?.health?.test ? html`<section class="panel span-2">
          <h3 class="panel-title">${icon("stethoscope")}${L("Sağlık kontrolü", "Health check")}</h3>
          <p class="muted small">${L("Docker bu komutu düzenli çalıştırıp parçanın gerçekten hazır olup olmadığına bakar.", "Docker runs this command regularly to see whether the container is really ready.")}</p>
          <pre class="code small">${d.health.test}</pre>
          ${d.health.log.length ? html`<table class="table compact"><thead><tr><th>${L("Zaman", "Time")}</th><th>${L("Sonuç", "Result")}</th><th>${L("Çıktı", "Output")}</th></tr></thead><tbody>
            ${d.health.log.slice().reverse().map((h) => html`<tr><td class="mono small">${fmt.time(h.start)}</td><td>${h.code === 0 ? badge("ok", L("Geçti", "Passed")) : badge("err", L(`Kaldı (${h.code})`, `Failed (${h.code})`))}</td><td class="mono small ellipsis-2">${h.output || "—"}</td></tr>`)}
          </tbody></table>` : ""}
        </section>` : ""}
      </div>`;
  },

  usage(c) {
    if (!c.running) return emptyState({ icon: "gauge", title: L("Parça kapalı", "Container is stopped"), text: L("Kaynak kullanımı parça çalışırken ölçülür.", "Usage is measured while the container is running."), compact: true });
    const s = S.stats[c.name];
    if (!s) return html`<div class="usage-big">${skeletonRows(3)}</div>`;
    const memPct = s.mem_limit ? (s.mem / s.mem_limit) * 100 : 0;
    const limit = this.detail?.memory_limit;
    return html`
      <div class="usage-big">
        <section class="panel metric">
          <div class="metric-head"><span>${icon("cpu")}${L("İşlemci", "CPU")}</span><b class="mono">${fmt.pct(s.cpu)}</b></div>
          ${sparkline(s.hist.cpu, { w: 600, h: 90, cls: "accent big" })}
          <p class="muted small">${L("%100 = bir işlemci çekirdeğinin tamamı. Docker motorunun kullanabildiği çekirdek sayısı Sistem sayfasında yazar.", "100% = one full CPU core. The number of cores the Docker engine can use is on the System page.")}</p>
        </section>
        <section class="panel metric">
          <div class="metric-head"><span>${icon("memory")}${L("Bellek", "Memory")}</span><b class="mono">${fmt.bytes(s.mem)} <small>/ ${fmt.bytes(limit || s.mem_limit, 0)}</small></b></div>
          ${sparkline(s.hist.mem, { w: 600, h: 90, cls: "big" })}
          ${meter(memPct)}
          <p class="muted small">${limit ? L("Bu parçaya özel bir bellek sınırı konmuş.", "This container has its own memory limit.") : L("Bu parçanın özel bir sınırı yok; Docker motorunun belleğini paylaşır.", "No limit of its own; it shares the Docker engine's memory.")}</p>
        </section>
        <div class="stat-row small">
          <div class="stat"><div class="stat-label">${icon("download")}${L("Ağdan gelen", "Network in")}</div><div class="stat-value mono">${fmt.bytes(s.net_rx)}</div></div>
          <div class="stat"><div class="stat-label">${icon("upload")}${L("Ağa giden", "Network out")}</div><div class="stat-value mono">${fmt.bytes(s.net_tx)}</div></div>
          <div class="stat"><div class="stat-label">${icon("drive")}${L("Diskten okunan", "Disk read")}</div><div class="stat-value mono">${fmt.bytes(s.blk_r)}</div></div>
          <div class="stat"><div class="stat-label">${icon("drive")}${L("Diske yazılan", "Disk written")}</div><div class="stat-value mono">${fmt.bytes(s.blk_w)}</div></div>
          <div class="stat"><div class="stat-label">${icon("activity")}${L("Süreç sayısı", "Processes")}</div><div class="stat-value mono">${s.pids}</div></div>
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
          <div class="row-actions"><button class="btn sm" data-env-copy>${icon("copy")}${L(".env olarak kopyala", "Copy as .env")}</button></div>
        </header>
        <p class="muted small">${L("Parçanın içindeki programa verilen ayarlar. Şifre gibi görünenler gizlendi; göz simgesiyle gösterebilirsin. Değiştirmek için compose dosyasını düzenleyip uygulamayı güncelle.", "Settings passed to the program inside the container. Values that look like passwords are hidden; use the eye icon to show them. To change them, edit the compose file and update the app.")}</p>
        ${d.env.length ? html`<table class="table compact env-table"><tbody>${d.env.map((x) => html`
          <tr><td class="mono strong">${x.key}</td>
            <td class="mono env-val">${x.secret && !this.showEnv.has(x.key) ? "••••••••" : x.value || html`<span class="muted">${L("(boş)", "(empty)")}</span>`}</td>
            <td class="actions-col">${x.secret ? html`<button class="icon-btn sm" data-env-show="${x.key}" aria-label="${L("Göster/gizle", "Show/hide")}">${icon(this.showEnv.has(x.key) ? "eyeOff" : "eye")}</button>` : ""}
              <button class="icon-btn sm" data-copy="${x.value}" aria-label="${L("Değeri kopyala", "Copy value")}" title="${L("Değeri kopyala", "Copy value")}">${icon("copy")}</button></td></tr>`)}
        </tbody></table>` : html`<p class="muted">${L("Hiç ortam değişkeni yok.", "No environment variables.")}</p>`}
      </section>
      <section class="panel">
        <h3 class="panel-title">${L("Başlangıç", "Startup")}</h3>
        ${kv([
          [L("Komut", "Command"), html`<code>${(d.cmd || []).join(" ") || "—"}</code>`],
          [L("Giriş noktası", "Entrypoint"), html`<code>${(d.entrypoint || []).join(" ") || "—"}</code>`],
          [L("Çalışma klasörü", "Working directory"), html`<code>${d.workdir || "/"}</code>`],
          [L("Kullanıcı", "User"), html`<code>${d.user || L("root (varsayılan)", "root (default)")}</code>`],
          [L("Makine adı", "Hostname"), html`<code>${d.hostname}</code>`],
        ])}
      </section>
      ${labels.length ? html`<details class="panel">
        <summary class="panel-title">${L("Etiketler", "Labels")} (${labels.length})</summary>
        <table class="table compact"><tbody>${labels.map(([k, v]) => html`<tr><td class="mono small">${k}</td><td class="mono small env-val">${v}</td></tr>`)}</tbody></table>
      </details>` : ""}`;
  },

  rawTab() {
    const d = this.detail;
    if (!d) return skeletonRows(10);
    return html`
      <section class="panel code-panel">
        <header class="code-head"><span>${L("docker inspect çıktısı", "docker inspect output")}</span><button class="btn sm" data-raw-copy>${icon("copy")}${L("Kopyala", "Copy")}</button></header>
        <pre class="code json">${JSON.stringify(d.raw, null, 2)}</pre>
      </section>`;
  },

  logsShell() {
    const l = this.log;
    return html`
      <div class="toolbar wrap">
        ${searchBox("log-q", L("Kayıtlarda ara…", "Search logs…"), l.query)}
        <label class="switch-inline"><input type="checkbox" id="log-err" ${l.errorsOnly ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>${L("Sadece hatalar", "Errors only")}</label>
        <label class="switch-inline"><input type="checkbox" id="log-ts" ${l.ts ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>${L("Zaman", "Timestamps")}</label>
        <label class="switch-inline"><input type="checkbox" id="log-follow" ${l.follow ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>${L("Canlı", "Follow")}</label>
        <label class="select-inline">
          <select id="log-since" aria-label="${L("Zaman aralığı", "Time range")}">
            ${[["", L("Tüm zamanlar", "All time")], ["5m", L("Son 5 dakika", "Last 5 minutes")], ["1h", L("Son 1 saat", "Last hour")], ["24h", L("Son 24 saat", "Last 24 hours")]].map(([v, t]) => html`<option value="${v}" ${v === l.since ? raw("selected") : ""}>${t}</option>`)}
          </select>
        </label>
        <label class="select-inline">
          <select id="log-lines" aria-label="${L("Satır sayısı", "Line count")}">
            ${[200, 500, 2000, 10000].map((n) => html`<option value="${n}" ${n === l.lines ? raw("selected") : ""}>${L(`Son ${fmt.num(n)} satır`, `Last ${fmt.num(n)} lines`)}</option>`)}
          </select>
        </label>
        <div class="toolbar-spacer"></div>
        <button class="btn sm" data-log-diagnose title="${L("Kayıtlardaki bilinen hataları sade Türkçeyle açıkla", "Explain known errors in the logs in plain words")}">${icon("stethoscope")}${L("Teşhis et", "Diagnose")}</button>
        <button class="btn sm" data-log-copy>${icon("copy")}${L("Kopyala", "Copy")}</button>
      </div>
      <div class="log-meta muted small" id="log-meta"></div>
      <pre class="log-view tall" id="log-view" tabindex="0" aria-label="${T("logs")}">${L("Yükleniyor…", "Loading…")}</pre>`;
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
    patch($("#log-meta", this.root), html`${L(`${fmt.num(total)} satır`, plural(total, "line"))}${hintCount ? html` · <span class="txt-warn">${icon("bulb")}${L(`${hintCount} satırda açıklama var`, `${plural(hintCount, "line")} with an explanation`)}</span>` : ""}`);
    if (!text.trim()) {
      view.textContent = l.loading ? L("Yükleniyor…", "Loading…") : l.errorsOnly ? L("Hata satırı yok. Güzel!", "No error lines. Nice!") : L("(Bu parça henüz hiçbir şey yazmamış.)", "(This container hasn't written anything yet.)");
      return;
    }
    const markup = String(colorLog(text, l.query, hints));
    if (view.__html !== markup) {
      view.innerHTML = markup || (l.query ? L("Aramaya uyan satır yok.", "No lines match your search.") : "");
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
            ? callout({ level: "warn", text: L("Parça kapalı. Terminal açmak için önce başlat.", "The container is stopped. Start it to open a terminal."),
                actions: html`<button class="btn go sm" data-cact="baslat" data-id="${c.id}">${icon("play")}${L("Başlat", "Start")}</button>` })
            : html`<p class="muted">${L("Terminal oturumu kapalı.", "The terminal session is closed.")}</p>
                   <button class="btn primary" data-term-open>${icon("terminal")}${L("Yeni oturum aç", "Open a new session")}</button>`}
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
    if (safeModeOn()) {
      return callout({ level: "info", icon: "lock", title: L("Güvenli mod: terminal kapalı", "Safe mode: the terminal is off"),
        text: L("Bu sunucu güvenli modda. Terminalden her şey silinebildiği için kapalı; kayıtlar ve ayrıntılar açık. Açmak için üstteki şeritten “Tam kontrol”ü aç.",
          "This server is in safe mode. The terminal is off because anything can be deleted from a shell; logs and details stay available. To allow it, turn on “Full control” from the bar at the top.") });
    }
    const quick = [...dbQuickCmds(c), ...QUICK_CMDS];
    return html`
      <div class="xterm-wrap">
        <div class="xterm-bar" id="xterm-bar"></div>
        <div class="xterm-slot" id="xterm-slot"></div>
      </div>
      <div class="quick-cmds">
        <span class="muted small">${L("Hazır komutlar (terminale yazar):", "Quick commands (typed into the terminal):")}</span>
        ${quick.map(([cmd, tr, en]) => html`<button class="chip" data-qcmd="${cmd}" title="${cmd}">${L(tr, en)}</button>`)}
      </div>
      <p class="muted small">${isEN()
        ? html`A real terminal inside the container: <code>cd</code>, tab completion, <code>top</code> and <code>vim</code> work.
          Select + ${onMac() ? "⌘C" : "Ctrl+Shift+C"} to copy, ${onMac() ? "⌘V" : "Ctrl+Shift+V"} to paste. The session survives moving between pages; type <code>exit</code> to leave.`
        : html`Parçanın içinde gerçek bir terminal: <code>cd</code>, sekme tamamlama, <code>top</code>, <code>vim</code> çalışır.
          Kopyalamak için seç + ${onMac() ? "⌘C" : "Ctrl+Shift+C"}, yapıştırmak için ${onMac() ? "⌘V" : "Ctrl+Shift+V"}. Oturum, sayfalar arasında gezinince kopmaz; çıkmak için <code>exit</code>.`}</p>`;
  },

  renderTermBar() {
    const s = this.termSession;
    const bar = $("#xterm-bar", this.root);
    if (!s || !bar) return;
    const [lvl, text] = {
      baglaniyor: ["warn", L("Bağlanıyor…", "Connecting…")],
      acik: ["ok", L("Bağlı", "Connected")],
      kapandi: ["info", L("Oturum kapandı · Enter ile yeniden bağlan", "Session closed · press Enter to reconnect")],
      hata: ["err", s.error || L("Bağlantı hatası", "Connection error")],
    }[s.state];
    patch(bar, html`
      <span class="xterm-status"><span class="dot lvl-${lvl}"></span>${text}</span>
      <span class="mono small muted xterm-name">${s.user === "root" ? "root@" : ""}${s.name}</span>
      <span class="grow"></span>
      <label class="small muted xterm-user">${L("Kullanıcı", "User")}
        <select id="term-user" aria-label="${L("Terminal kullanıcısı", "Terminal user")}">
          <option value="" ${s.user ? "" : "selected"}>${L("varsayılan", "default")}</option>
          <option value="root" ${s.user === "root" ? "selected" : ""}>root</option>
        </select>
      </label>
      <button class="btn sm" data-term-clear title="${L("Ekranı temizle", "Clear the screen")}">${icon("trash")}${L("Temizle", "Clear")}</button>
      <button class="btn sm" data-term-reconnect title="${L("Oturumu yeniden başlat", "Restart the session")}">${icon("restart")}${L("Yeniden bağlan", "Reconnect")}</button>
      <button class="btn sm" data-term-close title="${L("Oturumu kapat", "Close the session")}">${icon("close")}${L("Kapat", "Close")}</button>`);
  },
};
