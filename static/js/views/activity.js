"use strict";

/* =====================================================================
   Etkinlik: ne zaman ne oldu? Başladı, durdu, çöktü, belleği yetmedi…
   Basic Docker açıkken olanlar ~/.basic-docker/etkinlik.jsonl'a kaydedilir.
   ===================================================================== */

const EXIT_SHORT = {
  1: "Uygulama bir hata yüzünden kapandı.",
  2: "Komut yanlış kullanıldı.",
  125: "Docker parçayı başlatamadı (ayar sorunu).",
  126: "Başlangıç komutu çalıştırılamadı (izin).",
  127: "Başlangıç komutu bulunamadı.",
  137: "Zorla kapatıldı ya da belleği yetmedi.",
  139: "Program çöktü (bellek hatası / mimari uyuşmazlığı).",
  143: "Kapat komutu aldı.",
};

const ActivityView = {
  filter: "hepsi",
  days: 7,
  query: "",

  mount(root) {
    this.root = root;
    this.events = null;
    this.error = null;
    root.innerHTML = String(html`
      <div class="page">
        ${pageHead({
          title: "Etkinlik",
          desc: "Parçaların ne zaman başladığı, durduğu, çöktüğü. Docker bu geçmişi kısa tutar; Basic Docker açıkken olanları kaydeder.",
          actions: html`<label class="switch-inline" title="Bir parça beklenmedik şekilde çökerse macOS bildirimi gönder">
            <input type="checkbox" id="ev-notify" ${S.prefs.bildirim !== false ? raw("checked") : ""}><span class="switch" aria-hidden="true"></span>${icon("bell")}Çökünce bildir</label>`,
        })}
        <div class="toolbar">
          ${searchBox("ev-search", `${T("app")} ya da ${Tl("container")} ara…`, this.query)}
          <div id="ev-filter"></div>
          <div class="toolbar-spacer"></div>
          <label class="select-inline"><select id="ev-days" aria-label="Zaman aralığı">
            ${[[1, "Son 24 saat"], [7, "Son 7 gün"], [30, "Son 30 gün"]].map(([v, l]) => html`<option value="${v}" ${v === this.days ? raw("selected") : ""}>${l}</option>`)}
          </select></label>
        </div>
        <div id="ev-body">${skeletonRows(10)}</div>
      </div>`);
    root.addEventListener("click", this.onClick = (e) => {
      const seg = e.target.closest("[data-seg='ev']");
      if (seg) { this.filter = seg.dataset.val; this.render(); }
      if (e.target.closest("[data-retry]")) this.load();
    });
    root.addEventListener("input", this.onInput = (e) => {
      if (e.target.id === "ev-search") { this.query = e.target.value; this.render(); }
    });
    root.addEventListener("change", this.onChange = (e) => {
      if (e.target.id === "ev-days") { this.days = +e.target.value; this.load(); }
      if (e.target.id === "ev-notify") {
        S.prefs.bildirim = e.target.checked;
        api("/api/ayarlar/kaydet", { bildirim: e.target.checked }).then(() => flash(e.target.checked ? "Çökme bildirimleri açık" : "Çökme bildirimleri kapalı")).catch(() => {});
      }
    });
    this.load();
    this.timer = setInterval(() => this.load(true), 8000);
  },

  unmount() {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("change", this.onChange);
    clearInterval(this.timer);
  },

  async load(quiet = false) {
    try { this.events = (await api(`/api/etkinlik${q({ gun: this.days })}`)).olaylar; this.error = null; } catch (e) { if (!quiet) this.error = e.message; }
    this.render();
  },

  who(ev) {
    const app = ev.app ? findApp(ev.app) : null;
    const appName = app ? app.name : ev.app ? ev.app : "";
    const found = ev.name ? findContainer(ev.name) : null;
    const part = found ? shortRole(found.c.role_title) : ev.service || ev.name;
    return { appName, part, found, app };
  },

  render() {
    const body = $("#ev-body", this.root);
    if (this.error) return patch(body, errorState(this.error));
    if (!this.events) return;
    const evs = this.events;
    const cats = {
      sorun: (e) => e.level === "err" || e.level === "warn",
      baslat: (e) => e.type === "container" && ["start", "stop", "die", "restart"].includes(e.action),
      kaynak: (e) => e.type !== "container" || ["create", "destroy"].includes(e.action),
    };
    patch($("#ev-filter", this.root), segmented("ev", [
      { id: "hepsi", label: "Tümü", count: evs.length },
      { id: "sorun", label: "Sorunlar", count: evs.filter(cats.sorun).length },
      { id: "baslat", label: "Başlat / durdur", count: evs.filter(cats.baslat).length },
      { id: "kaynak", label: "Oluştur / sil", count: evs.filter(cats.kaynak).length },
    ], this.filter));
    let list = this.filter === "hepsi" ? evs : evs.filter(cats[this.filter]);
    const qq = this.query.trim().toLocaleLowerCase("tr");
    if (qq) list = list.filter((e) => [e.name, e.app, e.service, e.image, e.text].join(" ").toLocaleLowerCase("tr").includes(qq));
    if (!list.length) {
      return patch(body, emptyState({
        icon: "activity", compact: true,
        title: evs.length ? "Bu filtrede olay yok" : "Henüz kayıtlı olay yok",
        text: evs.length ? "" : "Bir parçayı başlatıp durdurduğunda burada görünür. Basic Docker açık kaldıkça geçmiş birikir.",
      }));
    }
    const days = new Map();
    for (const e of list.slice(0, 600)) {
      const d = fmt.day(e.t);
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(e);
    }
    patch(body, html`${[...days.entries()].map(([day, items]) => html`
      <section class="tl-day">
        <h2 class="tl-date">${day}</h2>
        <ol class="timeline">${items.map((e) => {
          const { appName, part, found } = this.who(e);
          const ic = e.type === "image" ? "layers" : e.type === "volume" ? "drive"
            : e.level === "err" ? "xCircle" : e.level === "warn" ? "alert" : e.action === "start" ? "play" : e.action === "stop" || e.action === "die" ? "stop"
              : e.action === "destroy" ? "trash" : e.action === "create" ? "plus" : e.action.startsWith("health") ? "stethoscope" : "info";
          const subject = e.type === "container"
            ? html`${appName && appName !== e.name ? html`<b>${appName}</b> · ` : ""}${found ? html`<a href="${link(`/parca/${found.c.id}`)}">${part}</a>` : html`<span>${part}</span>`}`
            : html`<b class="mono">${e.name}</b>`;
          const explain = e.exit_code && EXIT_SHORT[e.exit_code] && e.level !== "info" ? EXIT_SHORT[e.exit_code] : "";
          return html`
            <li class="tl-item lvl-${e.level}">
              <time class="tl-time mono" datetime="${new Date(e.t * 1000).toISOString()}">${fmt.time(e.t).slice(0, 5)}</time>
              <span class="tl-dot">${icon(ic)}</span>
              <div class="tl-body">
                <div>${subject} <span class="tl-verb">${e.text}</span></div>
                ${explain ? html`<div class="muted small">${explain}${found && e.level === "err" ? html` <a href="${link(`/parca/${found.c.id}`)}">Teşhis et →</a>` : ""}</div>` : ""}
                ${e.type === "container" && e.image ? html`<div class="muted small mono ellipsis">${e.name} · ${e.image}</div>` : ""}
              </div>
            </li>`;
        })}</ol>
      </section>`)}`);
  },
};
