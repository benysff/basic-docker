"use strict";

/* =====================================================================
   Komut paleti (⌘K): uygulama, parça, sayfa ve işlem ara, Enter ile yap.
   ===================================================================== */

const Palette = {
  el: null,
  items: [],
  shown: [],
  idx: 0,

  groups() {
    return { pages: L("Sayfalar", "Pages"), actions: L("İşlemler", "Actions"), sets: L("Setler", "Sets"), cmds: L("Komutlar", "Commands") };
  },

  build() {
    const out = [];
    const G = this.groups();
    for (const n of NAV) out.push({ group: G.pages, icon: n.icon, label: n.label(), hint: n.key ? `⌘${n.key}` : "", run: () => Router.go(n.path) });
    for (const a of apps().filter((x) => x.source !== "system")) {
      out.push({ group: T("app", true), icon: "grid", label: a.name, sub: a.state_text, level: LEVEL_OF_APP[a.state], run: () => Router.go(`/uygulama/${encodeURIComponent(a.key)}`) });
      if (a.total || a.compose?.exists) {
        out.push(a.up > 0
          ? { group: G.actions, icon: "stop", label: `${a.name}: ${L("durdur", "stop")}`, run: () => appAction(a.key, "durdur") }
          : { group: G.actions, icon: "play", label: `${a.name}: ${L("başlat", "start")}`, run: () => appAction(a.key, "baslat") });
      }
    }
    for (const s of S.data?.sets || []) {
      out.push({ group: G.sets, icon: "rocket", label: L(`${s.name} setini başlat`, `Start the ${s.name} set`), run: () => runJob("/api/set/calistir", { id: s.id, islem: "baslat" }) });
      out.push({ group: G.sets, icon: "stop", label: L(`${s.name} setini durdur`, `Stop the ${s.name} set`), run: () => runJob("/api/set/calistir", { id: s.id, islem: "durdur" }) });
    }
    for (const c of allContainers().filter((x) => x.app.source !== "system")) {
      out.push({ group: T("container", true), icon: c.kind, label: `${c.role_title}`, sub: `${c.app.source === "single" ? "" : c.app.name + " · "}${c.name}`, level: containerLevel(c), run: () => Router.go(`/parca/${encodeURIComponent(c.id)}`) });
      out.push({ group: T("logs"), icon: "logs", label: L(`${c.name} kayıtları`, `${c.name} logs`), run: () => Router.go(`/parca/${encodeURIComponent(c.id)}/kayitlar`) });
    }
    const cmds = [
      ["plus", L("Yeni ekle", "Add new"), () => openNew(), "⌘N"],
      ["db", L("Hazır veritabanı kur", "Set up a ready-made database"), () => openNew("sablonlar")],
      ["folder", L("Proje klasöründen kur (docker-compose)", "Set up from a project folder (docker-compose)"), () => openNew("compose")],
      ["download", L(`${T("image")} indir`, "Pull an image"), () => openPull()],
      ["update", L("Kalıp güncellemelerini denetle", "Check for image updates"), () => runJob("/api/kalip/denetle-hepsi", {})],
      ["sparkles", L("Disk temizliği", "Disk cleanup"), () => Router.go("/temizlik")],
      ["rocket", L("Yeni çalışma seti", "New work set"), () => openSetEditor()],
      ["archive", L("Yedekleri aç", "Open backups"), () => Router.go("/kutular/yedekler")],
      ["server", L("Uzak Docker ekle (SSH)", "Add remote Docker (SSH)"), () => openAddRemote(() => Router.go("/sistem"))],
      S.data?.platform?.remote && ["server", L("Bu Mac'teki Docker'a dön", "Switch to the Docker on this Mac"), () => useLocalDocker()],
      ["globe", L("Switch to English", "Türkçeye geç"), () => setLanguage(isEN() ? "tr" : "en")],
      ["moon", L("Temayı değiştir (açık/koyu)", "Toggle theme (light/dark)"), () => { S.prefs.tema = document.documentElement.dataset.theme === "dark" ? "acik" : "koyu"; applyTheme(); api("/api/ayarlar/kaydet", { tema: S.prefs.tema }).catch(() => {}); }],
      !isEN() && ["sliders", S.prefs.dil === "teknik" ? "Sade Türkçeye geç" : "Teknik terimlere geç", () => { S.prefs.dil = S.prefs.dil === "teknik" ? "sade" : "teknik"; api("/api/ayarlar/kaydet", { dil: S.prefs.dil }).catch(() => {}); renderSidebar(); Router.current?.view.unmount?.(); Router.current = null; Router.render(); }],
      ["help", L("Sözlük: bu ne demek?", "Glossary: what does this mean?"), () => openHelp()],
    ].filter(Boolean);
    for (const [ic, label, run, hint] of cmds) out.push({ group: G.cmds, icon: ic, label, run, hint });
    return out;
  },

  score(item, qq) {
    if (!qq) return 1;
    const hay = (item.label + " " + (item.sub || "") + " " + item.group).toLocaleLowerCase(loc());
    if (hay.startsWith(qq)) return 100;
    const i = hay.indexOf(qq);
    if (i >= 0) return 80 - Math.min(i, 40);
    // harf sırası eşleşmesi (ör. "blg" → "blog")
    let pos = 0;
    for (const ch of qq) {
      pos = hay.indexOf(ch, pos);
      if (pos < 0) return 0;
      pos++;
    }
    return 10;
  },

  open() {
    if (this.el?.open) return;
    Menu.close();
    this.items = this.build();
    const d = document.createElement("dialog");
    d.className = "palette";
    d.setAttribute("aria-label", L("Komut paleti", "Command palette"));
    d.innerHTML = String(html`
      <div class="palette-card">
        <div class="palette-search">${icon("search")}<input id="pal-in" placeholder="${L("Ne yapmak istiyorsun? (ör. blog başlat, kayıtlar, temizlik)", "What do you want to do? (e.g. start blog, logs, cleanup)")}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="pal-list"><kbd>esc</kbd></div>
        <div class="palette-list" id="pal-list" role="listbox"></div>
        <div class="palette-foot"><span>${kbd("↑")}${kbd("↓")} ${L("seç", "select")}</span><span>${kbd("↵")} ${L("uygula", "run")}</span><span>${kbd("esc")} ${L("kapat", "close")}</span></div>
      </div>`);
    document.body.appendChild(d);
    this.el = d;
    d.showModal();
    const input = $("#pal-in", d);
    input.addEventListener("input", () => { this.idx = 0; this.render(input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.move(1); }
      if (e.key === "ArrowUp") { e.preventDefault(); this.move(-1); }
      if (e.key === "Enter") { e.preventDefault(); this.pick(this.idx); }
    });
    d.addEventListener("click", (e) => {
      if (e.target === d) return this.close();
      const it = e.target.closest("[data-pi]");
      if (it) this.pick(+it.dataset.pi);
    });
    d.addEventListener("close", () => { d.remove(); this.el = null; });
    this.idx = 0;
    this.render("");
    input.focus();
  },

  close() { this.el?.close(); },

  move(dir) {
    if (!this.shown.length) return;
    this.idx = (this.idx + dir + this.shown.length) % this.shown.length;
    this.render($("#pal-in", this.el).value, true);
  },

  pick(i) {
    const it = this.shown[i];
    if (!it) return;
    this.close();
    setTimeout(() => it.run(), 10);
  },

  render(query, keepScroll = false) {
    const qq = query.trim().toLocaleLowerCase(loc());
    const G = this.groups();
    let list = this.items.map((it) => ({ it, s: this.score(it, qq) })).filter((x) => x.s > 0);
    if (qq) list.sort((a, b) => b.s - a.s);
    else list = list.filter((x) => [G.pages, G.cmds, T("app", true), G.sets].includes(x.it.group));
    // Aynı gruptakiler bir arada dursun; gruplar en iyi eşleşmelerine göre sıralansın.
    const order = [];
    const byGroup = new Map();
    for (const x of list.slice(0, 60)) {
      if (!byGroup.has(x.it.group)) { byGroup.set(x.it.group, []); order.push(x.it.group); }
      byGroup.get(x.it.group).push(x.it);
    }
    this.shown = order.flatMap((g) => byGroup.get(g));
    const box = $("#pal-list", this.el);
    let last = null;
    box.innerHTML = String(html`${this.shown.length ? this.shown.map((it, i) => {
      const head = it.group !== last ? html`<div class="pal-group">${it.group}</div>` : "";
      last = it.group;
      return html`${head}<div class="pal-item ${i === this.idx ? "active" : ""}" role="option" aria-selected="${i === this.idx}" data-pi="${i}" id="pi-${i}">
        <span class="pal-icon">${icon(it.icon)}</span>
        <span class="pal-label">${it.label}${it.sub ? html`<small>${it.sub}</small>` : ""}</span>
        ${it.level ? dot(it.level) : ""}${it.hint ? html`<kbd>${it.hint}</kbd>` : ""}
      </div>`;
    }) : html`<div class="pal-empty">${L(`“${query}” için sonuç yok.`, `No results for “${query}”.`)}</div>`}`);
    $("#pal-in", this.el).setAttribute("aria-activedescendant", `pi-${this.idx}`);
    const act = $(".pal-item.active", box);
    if (act) act.scrollIntoView({ block: "nearest" });
  },
};
