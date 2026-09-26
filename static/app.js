"use strict";

/* =====================================================================
   Basic Docker — arayüz
   Sunucudan (/api/durum) gelen uygulama listesini çizer, düğmeleri bağlar.
   ===================================================================== */

// ---------- Küçük yardımcılar ----------------------------------------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const upper = (s) => (s || "").toLocaleUpperCase("tr");

async function api(path, body) {
  // Sunucu yok: Python tarafındaki fonksiyonlar pywebview köprüsüyle doğrudan çağrılır.
  const r = await window.pywebview.api.call(path, body === undefined ? null : body);
  if (!r || !r.ok) throw new Error((r && r.hata) || "Bilinmeyen hata");
  return r.veri;
}

async function copyText(text) {
  try {
    const r = await api("/api/kopyala", { metin: text });
    if (!r.tamam) throw new Error();
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  flash("Kopyalandı");
}

function hue(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function ago(iso) {
  if (!iso || iso.startsWith("0001")) return "";
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "az önce";
  const m = s / 60; if (m < 60) return `${Math.floor(m)} dakika önce`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)} saat önce`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)} gün önce`;
  const mo = d / 30; if (mo < 12) return `${Math.floor(mo)} ay önce`;
  return `${Math.floor(mo / 12)} yıl önce`;
}

// ---------- Simgeler ---------------------------------------------------
const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  logs: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  terminal: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>',
  folder: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14"/><path d="M12 17h.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  move: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  hub: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  // parça türleri
  db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  cache: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/>',
  frontend: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  backend: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  worker: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  scheduler: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  queue: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  storage: '<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  build: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  backup: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v5h8V4"/><rect x="8" y="13" width="8" height="7"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>',
  test: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/>',
  monitor: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  ai: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
  other: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`;

// ---------- Durum -------------------------------------------------------
const S = {
  data: null,           // son /api/durum cevabı
  offline: false,       // Python tarafına ulaşılamıyor
  openKey: null,        // ayrıntısı açık uygulama
  editingName: false,
  reveal: new Set(),    // şifresi gösterilen parçalar
  stats: {},            // { parçaAdı: {cpu, mem} }
  statsTimer: null,
  filter: "",
  catalog: null,
  jobs: new Map(),      // id -> iş (bildirimler için)
  closedToasts: new Set(),
  openWhenDone: new Set(), // bitince ayrıntısı açılacak işler
  pollTimer: null,
  lastGrid: "",
  lastDrawer: "",
};

const SOURCE_TEXT = {
  compose: "Docker Compose projesi",
  basicdocker: "Basic Docker ile kuruldu",
  manual: "Elle gruplandı",
  single: "Tek başına duran parça",
  system: "Docker'ın kendi yardımcı parçaları",
};

const findApp = (key) => (S.data?.apps || []).find((a) => a.key === key);
const activeJob = (key) => [...S.jobs.values()].find((j) => j.app === key && j.status === "calisiyor");
const groupApps = () => (S.data?.apps || []).filter((a) => ["compose", "basicdocker", "manual"].includes(a.source) && !a.key.startsWith("tek:"));

// ---------- Veri yenileme ---------------------------------------------
async function refresh() {
  clearTimeout(S.pollTimer);
  try {
    const data = await api("/api/durum");
    S.data = data;
    S.offline = false;
    mergeJobs(data.jobs || []);
  } catch {
    S.offline = true;
  }
  render();
  const busy = [...S.jobs.values()].some((j) => j.status === "calisiyor");
  S.pollTimer = setTimeout(refresh, document.hidden ? 10000 : busy ? 900 : 3000);
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

function mergeJobs(list) {
  for (const j of list) {
    const prev = S.jobs.get(j.id);
    S.jobs.set(j.id, j);
    if (prev && prev.status === "calisiyor" && j.status !== "calisiyor") onJobDone(j);
  }
  // Başarılı işlerin bildirimi kısa süre sonra kaybolsun; hatalar kapatılana kadar kalsın.
  const now = Date.now() / 1000;
  for (const [id, j] of S.jobs) {
    if (j.status === "bitti" && j.finished && now - j.finished > 7) S.jobs.delete(id);
  }
}

function onJobDone(job) {
  if (S.openWhenDone.has(job.id)) {
    S.openWhenDone.delete(job.id);
    if (job.status === "bitti" && job.app && findApp(job.app)) openDrawer(job.app);
  }
  if (S.openKey) loadStats();
}

function trackJob(job, openAfter = false) {
  if (!job) return;
  S.jobs.set(job.id, job);
  if (openAfter) S.openWhenDone.add(job.id);
  render();
  refresh();
}

// ---------- Çizim ------------------------------------------------------
function render() {
  renderIntro();
  renderPill();
  renderMain();
  renderDrawer();
  renderToasts();
}

function renderIntro() {
  if (S.data?.ui) $("#intro").hidden = !!S.data.ui.intro_kapali;
}

function renderPill() {
  const pill = $("#docker-pill");
  const d = S.data?.docker;
  let cls = "", text = "Bağlanıyor…";
  if (S.offline) { cls = "err"; text = "Bağlantı yok"; }
  else if (d?.ok) { cls = "ok"; text = "Docker açık"; }
  else if (d?.reason === "kapali") { cls = "err"; text = "Docker kapalı"; }
  else if (d?.reason === "yok") { cls = "err"; text = "Docker yüklü değil"; }
  pill.className = `pill ${cls}`;
  pill.lastElementChild.textContent = text;
}

function stateScreen(iconName, title, text, actions = "") {
  return `<div class="big-icon">${icon(iconName)}</div><h2>${title}</h2><p>${text}</p>${actions}`;
}

function renderMain() {
  const grid = $("#apps");
  const screen = $("#state-screen");
  const summary = $("#summary");
  let screenHTML = "";

  if (S.offline) {
    screenHTML = stateScreen("plug", "Arka taraf yanıt vermiyor",
      "Basic Docker'ın Python tarafına ulaşılamadı. Uygulamayı kapatıp yeniden açmayı dene.");
  } else if (S.data && !S.data.docker.ok) {
    screenHTML = S.data.docker.reason === "yok"
      ? stateScreen("download", "Docker yüklü değil",
        "Bu uygulama Docker'ı yönetir, önce Docker Desktop'ı kurman gerekiyor. Kurduktan sonra bu sayfa kendiliğinden yenilenir.",
        `<a class="btn primary big" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">${icon("download")}Docker Desktop'ı indir</a>`)
      : stateScreen("power", "Docker kapalı",
        "Konteynerleri çalıştırmak için önce Docker'ın açık olması gerekiyor. Aşağıdaki tuşa bas, açılınca bu sayfa kendiliğinden yenilenir.",
        `<button class="btn primary big" data-global="docker-ac">${icon("power")}Docker'ı aç</button>`);
  }

  if (screenHTML) {
    grid.hidden = true;
    screen.hidden = false;
    if (screen.innerHTML !== screenHTML) screen.innerHTML = screenHTML;
    summary.textContent = "";
    S.lastGrid = "";
    return;
  }
  if (!S.data) return;

  const apps = S.data.apps;
  const real = apps.filter((a) => a.source !== "system");
  const running = real.filter((a) => a.running > 0).length;
  const problems = real.filter((a) => a.state === "problem").length;
  summary.innerHTML = `<b>${real.length}</b> uygulama · <b>${running}</b> çalışıyor` +
    (problems ? ` · <b style="color:var(--err)">${problems}</b> sorunlu` : "");

  const q = S.filter.trim().toLocaleLowerCase("tr");
  const list = q ? apps.filter((a) => matches(a, q)) : apps;

  if (!apps.length) {
    grid.hidden = true;
    screen.hidden = false;
    screen.innerHTML = stateScreen("box", "Henüz hiç uygulama yok",
      "Hazır bir veritabanı kurabilir ya da docker-compose.yml olan proje klasörünü ekleyebilirsin.",
      `<button class="btn primary big" data-global="yeni">${icon("plus")}Yeni ekle</button>`);
    return;
  }
  if (!list.length) {
    grid.hidden = true;
    screen.hidden = false;
    screen.innerHTML = stateScreen("search", "Eşleşen uygulama yok", `“${esc(S.filter)}” ile eşleşen bir şey bulunamadı.`);
    return;
  }

  screen.hidden = true;
  grid.hidden = false;
  const sectionOf = (a) => a.source === "system" ? "system" : a.source === "single" ? "single" : "apps";
  const sections = new Set(list.map(sectionOf));
  const titles = { apps: "Uygulamalar", single: "Tek başına duran parçalar", system: "Docker'ın kendi parçaları" };
  let html = "", last = null;
  for (const a of list) {
    const sec = sectionOf(a);
    if (sec !== last && sections.size > 1) html += `<div class="section-title">${titles[sec]}</div>`;
    last = sec;
    html += cardHTML(a);
  }
  if (html !== S.lastGrid) {
    grid.innerHTML = html;
    S.lastGrid = html;
  }
}

function matches(a, q) {
  const hay = [a.name, a.key, a.summary, ...a.containers.flatMap((c) => [c.name, c.image, c.role_title])]
    .join(" ").toLocaleLowerCase("tr");
  return hay.includes(q);
}

function mainButton(a, job, size = "big") {
  if (job) return `<button class="btn ${size}" disabled><span class="spinner"></span>Bekle…</button>`;
  if (a.running > 0) return `<button class="btn ${size} stop" data-act="durdur">${icon("stop")}Durdur</button>`;
  return `<button class="btn ${size} go" data-act="baslat">${icon("play")}Başlat</button>`;
}

function cardHTML(a) {
  const job = activeJob(a.key);
  const letter = upper(a.name.trim()[0] || "?");
  let parts;
  if (a.total === 0) {
    parts = `<span class="count">Parça yok</span>`;
  } else if (a.source === "single") {
    const c = a.containers[0];
    parts = `${esc(c.role_title)} <span class="count">· ${esc(c.image)}</span>`;
  } else {
    parts = `<span class="count">${a.total} parça:</span> ${esc(a.summary)}`;
  }
  const links = [...a.links].sort((x, y) => y.running - x.running).slice(0, 4)
    .map((l) => `<a class="chip ${l.running ? "" : "dim"}" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.role)} — tarayıcıda aç">${icon("external")}${esc(l.label)}</a>`)
    .join("");
  const hintCls = a.state === "problem" ? "err" : a.state === "empty" ? "info" : "";
  const hint = a.hint ? `<div class="hint ${hintCls}">${esc(a.hint)}</div>` : "";
  let footLeft = "";
  if (job) {
    footLeft = `<div class="busy-text"><span class="spinner"></span><span>${esc(job.last || job.title)}</span></div>`;
  } else if (a.state === "partial") {
    footLeft = `<button class="link-btn" data-act="baslat">Kapalı olanları da başlat</button>`;
  }
  return `
  <article class="card st-${a.state}" data-key="${esc(a.key)}" tabindex="0" aria-label="${esc(a.name)}: ${esc(a.state_text)}">
    <div class="card-head">
      <div class="avatar" style="--h:${hue(a.key)}">${esc(letter)}</div>
      <div class="card-title">
        <h3 title="${esc(a.name)}">${esc(a.name)}</h3>
        <div class="state"><span class="dot"></span>${esc(a.state_text)}</div>
      </div>
      ${mainButton(a, job)}
    </div>
    <p class="parts">${parts}</p>
    ${links ? `<div class="links">${links}</div>` : ""}
    ${hint}
    <div class="card-foot">
      <div>${footLeft}</div>
      <span class="more">Ayrıntılar ${icon("chevron")}</span>
    </div>
  </article>`;
}

// ---------- Ayrıntı paneli --------------------------------------------
function openDrawer(key) {
  S.openKey = key;
  S.editingName = false;
  S.stats = {};
  S.lastDrawer = "";
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
  renderDrawer();
  $("#drawer").focus();
  loadStats();
  clearInterval(S.statsTimer);
  S.statsTimer = setInterval(loadStats, 6000);
}

function closeDrawer() {
  S.openKey = null;
  clearInterval(S.statsTimer);
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

async function loadStats() {
  const a = S.openKey && findApp(S.openKey);
  if (!a || !a.running || document.hidden) return;
  try {
    const r = await api(`/api/kaynak?key=${encodeURIComponent(a.key)}`);
    S.stats = r.kaynak || {};
    renderDrawer();
  } catch { /* önemli değil */ }
}

function renderDrawer() {
  const drawer = $("#drawer");
  if (!S.openKey) return;
  const a = findApp(S.openKey);
  if (!a) {
    if (!activeJob(S.openKey)) closeDrawer();
    return;
  }
  // Kullanıcı bir şey yazıyorsa altından değiştirmeyelim.
  const focused = document.activeElement;
  if (focused && drawer.contains(focused) && /INPUT|TEXTAREA|SELECT/.test(focused.tagName)) return;

  const html = drawerHTML(a);
  if (html === S.lastDrawer) return;
  const body = $(".drawer-body", drawer);
  const scroll = body ? body.scrollTop : 0;
  drawer.innerHTML = html;
  S.lastDrawer = html;
  const nb = $(".drawer-body", drawer);
  if (nb) nb.scrollTop = scroll;
  if (S.editingName) {
    const inp = $("#name-input", drawer);
    inp.focus();
    inp.select();
  }
}

function drawerHTML(a) {
  const job = activeJob(a.key);
  const isGroup = ["compose", "basicdocker", "manual"].includes(a.source) && !a.key.startsWith("tek:");
  const title = S.editingName
    ? `<form class="name-edit" data-form="name"><input id="name-input" value="${esc(a.name)}" maxlength="80" aria-label="Uygulama adı"><button class="btn sm primary">Kaydet</button><button type="button" class="btn sm" data-dact="ad-iptal">Vazgeç</button></form>`
    : `<h2>${esc(a.name)} <button class="icon-btn" data-dact="ad" title="Adını değiştir" aria-label="Adını değiştir">${icon("edit")}</button></h2>`;

  const actions = [];
  actions.push(mainButton(a, job, "").replace('class="btn ', 'class="btn primary-ish '));
  if (a.running > 0 && !job) actions.push(`<button class="btn" data-act="yeniden">${icon("restart")}Yeniden başlat</button>`);
  if (a.state === "partial" && !job) actions.push(`<button class="btn" data-act="baslat">${icon("play")}Kapalı olanları başlat</button>`);
  if (isGroup) actions.push(`<button class="btn" data-dact="parca-ekle">${icon("plus")}Parça ekle</button>`);
  if (a.compose?.exists && a.compose.dir) actions.push(`<button class="btn" data-dact="klasor">${icon("folder")}Klasörü aç</button>`);
  actions.push(`<button class="btn danger" data-act="sil" ${job ? "disabled" : ""}>${icon("trash")}${a.total ? "Sil" : "Listeden kaldır"}</button>`);

  const info = [`<div class="info-row"><span class="k">Türü</span><span class="v">${SOURCE_TEXT[a.source] || ""}</span></div>`];
  if (a.compose?.dir) info.push(`<div class="info-row"><span class="k">Proje klasörü</span><span class="v mono">${esc(a.compose.dir)}</span></div>`);
  if (a.links.length) {
    info.push(`<div class="info-row"><span class="k">Tarayıcıda aç</span><span class="v links">${a.links.map((l) =>
      `<a class="chip ${l.running ? "" : "dim"}" href="${esc(l.url)}" target="_blank" rel="noopener">${icon("external")}${esc(l.label)}</a> <span class="part-meta">${esc(l.role)}</span>`).join("<br>")}</span></div>`);
  }
  if (a.name !== a.default_name) info.push(`<div class="info-row"><span class="k">Asıl adı</span><span class="v mono">${esc(a.default_name)}</span></div>`);

  const hint = a.hint ? `<div class="hint ${a.state === "problem" ? "err" : a.state === "empty" ? "info" : ""}" style="margin-bottom:16px">${esc(a.hint)}</div>` : "";
  const busy = job ? `<div class="hint info" style="margin-bottom:16px;display:flex;gap:8px;align-items:center"><span class="spinner"></span>${esc(job.title)} — ${esc(job.last || "…")}</div>` : "";

  return `
  <div class="drawer-head">
    <div class="drawer-title">
      <div class="avatar" style="--h:${hue(a.key)}">${esc(upper(a.name.trim()[0] || "?"))}</div>
      <div class="grow">
        ${title}
        <div class="st-${a.state}"><div class="state"><span class="dot"></span>${esc(a.state_text)}${a.total ? ` · ${a.running}/${a.total} parça açık` : ""}</div></div>
      </div>
      <button class="icon-btn" data-dact="kapat" aria-label="Kapat" title="Kapat (Esc)">${icon("close")}</button>
    </div>
    <div class="drawer-actions">${actions.join("")}</div>
  </div>
  <div class="drawer-body">
    ${busy}${hint}
    <div class="info-list">${info.join("")}</div>
    <div class="note-box">
      <label for="note-input">Not — bu uygulama ne işe yarıyor? (sadece sen görürsün)</label>
      <textarea id="note-input" data-note placeholder="Ör. Müşteri paneli. Açmadan önce VPN'e bağlan.">${esc(a.note)}</textarea>
    </div>
    <div class="parts-title"><h3>Parçalar</h3><span>Her biri uygulamanın bir görevini yapar</span></div>
    ${a.containers.map((c) => partHTML(c, a)).join("") || `<div class="hint info">Bu uygulamanın şu an hiç parçası yok.</div>`}
  </div>`;
}

function partHTML(c, a) {
  const st = S.stats[c.name];
  const lines = [];

  if (c.ports.length) {
    const chips = c.ports.map((p) => p.url
      ? `<a class="chip" href="${esc(p.url)}" target="_blank" rel="noopener">${icon("external")}localhost:${p.host}</a>`
      : `<span class="chip dim">localhost:${p.host}</span>`).join("");
    lines.push(`<div class="part-line"><span class="lbl">Kapı:</span>${chips}</div>`);
  } else if (c.internal_ports.length) {
    lines.push(`<div class="part-line"><span class="lbl">Kapı:</span>Dışarıya kapalı — sadece uygulamanın diğer parçaları ulaşabilir (içeride ${c.internal_ports.slice(0, 3).join(", ")})</div>`);
  }
  const vols = c.mounts.filter((m) => m.type === "volume" && !m.anonymous);
  if (vols.length) {
    lines.push(`<div class="part-line"><span class="lbl">Veri kutusu:</span>${vols.map((m) => `<span class="chip dim" title="İçeride: ${esc(m.dest)}">${esc(m.name)}</span>`).join("")}</div>`);
  }
  const binds = c.mounts.filter((m) => m.type === "bind" && !m.source.startsWith("/var/run") && !m.source.startsWith("/run"));
  if (binds.length) {
    lines.push(`<div class="part-line"><span class="lbl">Bilgisayarındaki klasör:</span><span class="mono">${binds.slice(0, 2).map((m) => esc(m.source)).join(", ")}${binds.length > 2 ? ` +${binds.length - 2}` : ""}</span></div>`);
  }
  if (c.running && st) {
    lines.push(`<div class="part-line"><span class="lbl">Kaynak kullanımı:</span>İşlemci ${esc(st.cpu)} · Bellek ${esc(st.mem)}</div>`);
  }

  let conn = "";
  if (c.connection) {
    const shown = S.reveal.has(c.id) ? c.connection.text : c.connection.masked;
    const note = c.connection.scope === "local"
      ? "Bilgisayarındaki kodun bu adresle bağlanır. Projenin .env dosyasına yapıştırabilirsin."
      : "Bu parçaya dışarıdan kapı açılmamış. Bu adres sadece aynı uygulamadaki diğer parçalardan çalışır.";
    const eye = c.connection.has_secret
      ? `<button class="icon-btn" data-cact="goster" data-id="${esc(c.id)}" title="${S.reveal.has(c.id) ? "Şifreyi gizle" : "Şifreyi göster"}" aria-label="Şifreyi göster/gizle">${icon(S.reveal.has(c.id) ? "eyeOff" : "eye")}</button>`
      : "";
    conn = `
    <div class="conn">
      <div class="conn-head"><span>Bağlantı bilgisi</span><span class="tools">${eye}<button class="btn sm" data-cact="kopyala" data-id="${esc(c.id)}">${icon("copy")}Kopyala</button></span></div>
      <pre>${esc(shown)}</pre>
      <div class="conn-note">${note}</div>
    </div>`;
  }

  const when = c.running ? (ago(c.started_at) && `${ago(c.started_at)} başladı`) : (ago(c.finished_at) && `${ago(c.finished_at)} kapandı`);
  const acts = [`<button class="btn sm" data-cact="kayitlar" data-id="${esc(c.id)}">${icon("logs")}Kayıtlar</button>`];
  if (c.running) {
    acts.push(`<button class="btn sm" data-cact="durdur" data-id="${esc(c.id)}">${icon("stop")}Durdur</button>`);
    acts.push(`<button class="btn sm" data-cact="yeniden" data-id="${esc(c.id)}">${icon("restart")}Yeniden başlat</button>`);
    if (S.data?.platform?.mac) acts.push(`<button class="btn sm" data-cact="terminal" data-id="${esc(c.id)}" title="Parçanın içinde komut satırı aç">${icon("terminal")}Terminal</button>`);
  } else {
    acts.push(`<button class="btn sm" data-cact="baslat" data-id="${esc(c.id)}">${icon("play")}Başlat</button>`);
  }
  if (c.source === "single" || c.source === "manual") {
    acts.push(`<button class="btn sm" data-cact="tasi" data-id="${esc(c.id)}">${icon("move")}${c.source === "single" ? "Uygulamaya ekle" : "Grubunu değiştir"}</button>`);
  }
  acts.push(`<button class="btn sm danger" data-cact="sil" data-id="${esc(c.id)}">${icon("trash")}Sil</button>`);

  return `
  <div class="part lvl-${c.level}">
    <div class="part-icon">${icon(c.kind)}</div>
    <div class="part-body">
      <div class="part-top"><strong>${esc(c.role_title)}</strong><span class="badge"><span class="dot"></span>${esc(c.status_text)}</span></div>
      <div class="part-desc">${esc(c.role_desc)}</div>
      <div class="part-meta">${esc(c.name)} · ${esc(c.image)}${when ? ` · ${esc(when)}` : ""}</div>
      ${c.status_hint ? `<div class="hint ${c.level === "err" ? "err" : ""} part-hint">${esc(c.status_hint)}</div>` : ""}
      ${lines.join("")}
      ${conn}
      <div class="part-actions">${acts.join("")}</div>
    </div>
  </div>`;
}

// ---------- İşlemler ---------------------------------------------------
async function appAction(key, act) {
  const a = findApp(key);
  if (!a) return;
  if (act === "sil") return confirmDeleteApp(a);
  try {
    const r = await api("/api/uygulama", { key, islem: act });
    trackJob(r.is);
  } catch (e) { flash(e.message, true); }
}

async function containerAction(id, act) {
  const found = findContainer(id);
  if (!found) return;
  const { app, c } = found;
  if (act === "kayitlar") return openLogs(c);
  if (act === "sil") return confirmDeleteContainer(c);
  if (act === "tasi") return openMove(c);
  if (act === "kopyala") return copyText(c.connection.text);
  if (act === "goster") {
    S.reveal.has(c.id) ? S.reveal.delete(c.id) : S.reveal.add(c.id);
    return renderDrawer();
  }
  try {
    const r = await api("/api/parca", { id, islem: act });
    if (act === "terminal") flash("Terminal penceresi açılıyor…");
    trackJob(r.is);
  } catch (e) { flash(e.message, true); }
  void app;
}

function findContainer(id) {
  for (const app of S.data?.apps || []) {
    const c = app.containers.find((x) => x.id === id);
    if (c) return { app, c };
  }
  return null;
}

async function saveMeta(key, fields) {
  try {
    await api("/api/uygulama/ayar", { key, ...fields });
    S.lastDrawer = "";
    await refresh();
  } catch (e) { flash(e.message, true); }
}

// ---------- Modallar ---------------------------------------------------
const modal = $("#modal");
let modalCleanup = null;

function openModal(html, onMount) {
  if (modalCleanup) modalCleanup();
  modalCleanup = null;
  $("#modal-body").innerHTML = `<div class="modal-inner">${html}</div>`;
  if (!modal.open) modal.showModal();
  if (onMount) modalCleanup = onMount($("#modal-body")) || null;
}

function closeModal() {
  if (modalCleanup) modalCleanup();
  modalCleanup = null;
  if (modal.open) modal.close();
}

modal.addEventListener("close", () => { if (modalCleanup) modalCleanup(); modalCleanup = null; });
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

function modalHead(title, sub = "") {
  return `<div class="modal-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div><button class="icon-btn" data-close aria-label="Kapat">${icon("close")}</button></div>`;
}

$("#modal-body").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeModal();
});

// --- Yardım / sözlük
function openHelp() {
  const items = [
    ["app", "Uygulama", "", "Birlikte çalışan parçaların grubu. Örneğin bir web sitesi: site + veritabanı + e-posta kutusu. Burada her kart bir uygulama."],
    ["box", "Parça", "konteyner", "Uygulamanın tek bir işi yapan bölümü. Her biri kendi küçük bilgisayarı gibidir; biri veritabanını, biri siteyi çalıştırır."],
    ["storage", "Kalıp", "imaj", "Parçanın tarifi. postgres:17 gibi. Aynı kalıptan istediğin kadar parça üretilir; ilk kullanımda internetten indirilir."],
    ["web", "Kapı", "port", "Parçaya bilgisayarından ulaşmak için numara. localhost:3000 yazınca 3000 numaralı kapıdaki parçaya gidersin."],
    ["db", "Veri kutusu", "volume", "Parçanın verilerini sakladığı yer. Parçayı silsen bile veri kutusu durur; silerken ayrıca sorulur."],
    ["logs", "Kayıtlar", "log", "Parçanın yazdığı mesajlar. Bir şey çalışmıyorsa sebebi genelde son satırlardadır. Kopyalayıp yapay zekâya sorabilirsin."],
    ["folder", "Docker Compose", "docker-compose.yml", "Birden fazla parçayı tek dosyada tarif etme yöntemi. Projende bu dosya varsa 'Yeni ekle → Proje klasörüm' ile tek seferde kurarsın."],
  ];
  openModal(`
    ${modalHead("Bu ne demek?", "Docker'daki kelimelerin sade anlamları")}
    <div class="modal-content"><div class="glossary">
      ${items.map(([ic, t, alt, d]) => `<div class="gl"><div class="part-icon">${icon(ic)}</div><div><h4>${t} ${alt ? `<small>(${alt})</small>` : ""}</h4><p>${d}</p></div></div>`).join("")}
      <div class="gl"><div class="part-icon">${icon("check")}</div><div><h4>Renkler</h4><p><b style="color:var(--ok)">Yeşil</b> her şey çalışıyor · <b style="color:var(--warn)">Turuncu</b> bir kısmı çalışıyor · <b style="color:var(--err)">Kırmızı</b> sorun var · <b style="color:var(--off)">Gri</b> kapalı</p></div></div>
    </div></div>
    <div class="modal-foot"><button class="btn primary" data-close>Anladım</button></div>`);
}

// --- Silme onayları
function confirmDeleteApp(a) {
  const vols = [...new Set(a.containers.flatMap((c) => c.mounts.filter((m) => m.type === "volume" && !m.anonymous).map((m) => m.name)))];
  const composeNote = a.source === "compose" && a.total
    ? `<p class="hint info">Proje klasörün ve kodların <b>silinmez</b>. İstediğinde “Yeni ekle → Proje klasörüm” ile tekrar kurabilirsin.</p>` : "";
  const dataBox = vols.length ? `
    <label class="check"><input type="checkbox" id="del-data">
      <span>Verileri de sil <small>${vols.length} veri kutusu (veritabanı kayıtları dahil) kalıcı olarak silinir. Geri alınamaz. İşaretlemezsen veriler saklanır.</small></span>
    </label>` : "";
  const what = a.total ? `${a.total} parça durdurulup kaldırılacak.` : "Uygulama listeden kaldırılacak.";
  openModal(`
    ${modalHead(`“${esc(a.name)}” silinsin mi?`, what)}
    <div class="modal-content form">${composeNote}${dataBox}</div>
    <div class="modal-foot"><button class="btn" data-close>Vazgeç</button><button class="btn danger-solid" id="del-go">${icon("trash")}${a.total ? "Sil" : "Kaldır"}</button></div>`,
  (root) => {
    $("#del-go", root).addEventListener("click", async () => {
      const withData = !!$("#del-data", root)?.checked;
      try {
        const r = await api("/api/uygulama", { key: a.key, islem: "sil", veriler: withData });
        closeModal();
        closeDrawer();
        trackJob(r.is);
      } catch (e) { flash(e.message, true); }
    });
  });
}

function confirmDeleteContainer(c) {
  const vols = c.mounts.filter((m) => m.type === "volume" && !m.anonymous);
  const composeNote = c.compose ? `<p class="hint info">Bu parça bir Docker Compose projesine ait. Silersen, projeyi tekrar kurana kadar geri gelmez.</p>` : "";
  openModal(`
    ${modalHead(`${esc(c.role_title)} silinsin mi?`, `${esc(c.name)} parçası durdurulup kaldırılacak.`)}
    <div class="modal-content form">${composeNote}
      ${vols.length ? `<label class="check"><input type="checkbox" id="del-data"><span>Verilerini de sil <small>${vols.map((v) => esc(v.name)).join(", ")} kalıcı olarak silinir. Geri alınamaz.</small></span></label>` : ""}
    </div>
    <div class="modal-foot"><button class="btn" data-close>Vazgeç</button><button class="btn danger-solid" id="del-go">${icon("trash")}Sil</button></div>`,
  (root) => {
    $("#del-go", root).addEventListener("click", async () => {
      try {
        const r = await api("/api/parca", { id: c.id, islem: "sil", veriler: !!$("#del-data", root)?.checked });
        closeModal();
        trackJob(r.is);
      } catch (e) { flash(e.message, true); }
    });
  });
}

// --- Parçayı bir uygulamaya taşı
function appSelectHTML(selected, id = "f-app") {
  const apps = groupApps();
  const opts = apps.map((a) => `<option value="${esc(a.key)}" ${a.key === selected ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const isNew = !selected || !apps.some((a) => a.key === selected);
  return `
    <div class="field">
      <label for="${id}">Hangi uygulamaya ait olsun?</label>
      <select id="${id}">
        <option value="__yeni__" ${isNew ? "selected" : ""}>+ Yeni uygulama oluştur</option>
        ${opts ? `<optgroup label="Var olan uygulamalar">${opts}</optgroup>` : ""}
      </select>
    </div>
    <div class="field" id="${id}-new-wrap" ${isNew ? "" : "hidden"}>
      <label for="${id}-new">Yeni uygulamanın adı</label>
      <input id="${id}-new" placeholder="Ör. Blog Sitem" maxlength="60">
      <div class="help">Kart üzerinde bu ad görünecek.</div>
    </div>`;
}

function bindAppSelect(root, id = "f-app") {
  const sel = $(`#${id}`, root);
  const wrap = $(`#${id}-new-wrap`, root);
  sel.addEventListener("change", () => {
    wrap.hidden = sel.value !== "__yeni__";
    if (!wrap.hidden) $(`#${id}-new`, root).focus();
  });
  return () => ({ uygulama: sel.value, yeni_ad: sel.value === "__yeni__" ? $(`#${id}-new`, root).value.trim() : "" });
}

function openMove(c) {
  const current = c.source === "manual" ? S.data.apps.find((a) => a.containers.some((x) => x.id === c.id))?.key : null;
  openModal(`
    ${modalHead(`${esc(c.name)} hangi uygulamaya ait?`, "Aynı projeye ait parçaları tek kartta toplamak için.")}
    <div class="modal-content form">${appSelectHTML(current)}<div id="f-err"></div></div>
    <div class="modal-foot">
      ${c.source === "manual" ? `<button class="btn left" id="mv-free">Tek başına bırak</button>` : ""}
      <button class="btn" data-close>Vazgeç</button><button class="btn primary" id="mv-go">Taşı</button>
    </div>`,
  (root) => {
    const read = bindAppSelect(root);
    const send = async (hedef, yeni_ad = "") => {
      try {
        await api("/api/parca/tasi", { id: c.id, hedef, yeni_ad });
        closeModal();
        closeDrawer();
        flash("Taşındı");
        refresh();
      } catch (e) { $("#f-err", root).innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
    };
    $("#mv-go", root).addEventListener("click", () => { const v = read(); send(v.uygulama, v.yeni_ad); });
    $("#mv-free", root)?.addEventListener("click", () => send(""));
  });
}

// --- Kayıtlar (loglar)
function colorLog(text) {
  return text.split("\n").map((line) => {
    const e = esc(line);
    if (/\b(error|exception|fatal|failed|traceback|panic|critical|hata)\b/i.test(line)) return `<span class="e">${e}</span>`;
    if (/\b(warn|warning|uyarı)\b/i.test(line)) return `<span class="w">${e}</span>`;
    return e;
  }).join("\n");
}

function openLogs(c) {
  openModal(`
    ${modalHead(`Kayıtlar — ${esc(c.role_title)}`, `${esc(c.name)} parçasının yazdığı son mesajlar`)}
    <div class="modal-content">
      <div class="log-tools">
        <button class="btn sm" id="lg-refresh">${icon("restart")}Yenile</button>
        <label><input type="checkbox" id="lg-follow" checked> Canlı takip</label>
        <button class="btn sm" id="lg-copy">${icon("copy")}Kopyala</button>
        <span>Hata arıyorsan en alttaki satırlara bak. Kopyalayıp yapay zekâya sorabilirsin.</span>
      </div>
      <pre class="log-view" id="lg-view">Yükleniyor…</pre>
    </div>`,
  (root) => {
    const view = $("#lg-view", root);
    let raw = "";
    let first = true;
    const load = async () => {
      try {
        const r = await api(`/api/kayitlar?id=${encodeURIComponent(c.id)}&satir=500`);
        if (r.metin === raw && !first) return;
        raw = r.metin;
        const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 30;
        view.innerHTML = raw.trim() ? colorLog(raw) : "(Bu parça henüz hiçbir şey yazmamış.)";
        if (first || atBottom) view.scrollTop = view.scrollHeight;
        first = false;
      } catch (e) { view.textContent = e.message; }
    };
    load();
    const timer = setInterval(() => { if ($("#lg-follow", root).checked) load(); }, 2000);
    $("#lg-refresh", root).addEventListener("click", load);
    $("#lg-copy", root).addEventListener("click", () => copyText(`${c.name} (${c.image}) kayıtları:\n\n${raw}`));
    return () => clearInterval(timer);
  });
}

// --- İş ayrıntısı (başarısız işlemin çıktısı)
async function openJob(id) {
  try {
    const { is: job } = await api(`/api/is?id=${encodeURIComponent(id)}`);
    const text = (job.lines || []).join("\n");
    openModal(`
      ${modalHead(esc(job.title), esc(job.message))}
      <div class="modal-content">
        <div class="log-tools"><button class="btn sm" id="jb-copy">${icon("copy")}Kopyala</button><span>Bu çıktıyı kopyalayıp yapay zekâya sorabilirsin.</span></div>
        <pre class="log-view">${colorLog(text || "(çıktı yok)")}</pre>
      </div>`,
    (root) => { $("#jb-copy", root).addEventListener("click", () => copyText(`${job.title}\n${job.message}\n\n${text}`)); });
  } catch (e) { flash(e.message, true); }
}

// --- Yeni ekle sihirbazı
async function openNew(step = "secim", ctx = {}) {
  if (step === "secim") {
    openModal(`
      ${modalHead("Ne eklemek istiyorsun?", "Birini seç, gerisini ben hallederim.")}
      <div class="modal-content"><div class="choice-grid">
        <button class="choice" data-step="sablonlar">
          <div class="ci">${icon("db")}</div>
          <div><h3>Hazır parça <span class="tag">EN KOLAYI</span></h3><p>Veritabanı, e-posta test kutusu, dosya deposu… Şifreler ve ayarlar otomatik yapılır, bağlantı adresini sana verir.</p></div>
        </button>
        <button class="choice" data-step="compose">
          <div class="ci">${icon("folder")}</div>
          <div><h3>Proje klasörüm</h3><p>Projende <b>docker-compose.yml</b> dosyası varsa klasörü seç; içindeki her şey tek uygulama olarak kurulur ve başlatılır.</p></div>
        </button>
        <button class="choice" data-step="ozel">
          <div class="ci">${icon("hub")}</div>
          <div><h3>Docker Hub'dan imaj <span class="tag">İLERİ SEVİYE</span></h3><p>Bildiğin bir imajın adını yaz (ör. nginx:alpine), kapı ve ayarlarını kendin belirle.</p></div>
        </button>
      </div></div>`,
    (root) => {
      root.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => openNew(b.dataset.step, ctx)));
    });
    return;
  }

  if (step === "sablonlar") {
    if (!S.catalog) {
      try { S.catalog = (await api("/api/katalog")).katalog; } catch (e) { return flash(e.message, true); }
    }
    openModal(`
      ${modalHead("Hazır parça seç", "Hangisine ihtiyacın var? Emin değilsen üzerindeki açıklamayı oku.")}
      <div class="modal-content"><div class="tpl-grid">
        ${S.catalog.map((t) => `
          <button class="tpl" data-tpl="${esc(t.id)}">
            <div class="tpl-top"><div class="part-icon">${icon(t.kind)}</div><div><h4>${esc(t.title)}</h4><small>${esc(t.tagline)}</small></div></div>
            <p>${esc(t.desc)}</p>
          </button>`).join("")}
      </div></div>
      <div class="modal-foot"><button class="btn left" data-back>${icon("back")}Geri</button></div>`,
    (root) => {
      $("[data-back]", root).addEventListener("click", () => openNew("secim", ctx));
      root.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => openNew("sablon", { ...ctx, tpl: b.dataset.tpl })));
    });
    return;
  }

  if (step === "sablon") {
    const t = S.catalog.find((x) => x.id === ctx.tpl);
    openModal(`
      ${modalHead(`${esc(t.title)} kur`, esc(t.desc))}
      <div class="modal-content form">
        ${appSelectHTML(ctx.app)}
        <div>
          <div class="field"><label>Ne olacak?</label></div>
          <ol class="steps">
            <li><b>${esc(t.image)}</b> kalıbı indirilir (bilgisayarında yoksa, bir kere).</li>
            <li>Uygulamaya <b>${esc(t.role)}</b> adında yeni bir parça eklenir ve çalıştırılır.</li>
            ${t.has_password ? "<li>Güçlü bir şifre otomatik üretilir; bağlantı adresi uygulamanın ayrıntılarında görünür.</li>" : ""}
            <li>Kapılar: ${t.ports.map(esc).join(" · ")} — boş bir numara otomatik seçilir, sadece bu bilgisayardan erişilir.</li>
            ${t.has_data ? "<li>Veriler ayrı bir veri kutusunda saklanır; parça silinse bile kaybolmaz.</li>" : ""}
          </ol>
        </div>
        <div id="f-err"></div>
      </div>
      <div class="modal-foot"><button class="btn left" data-back>${icon("back")}Geri</button><button class="btn primary" id="f-go">${icon("download")}Kur</button></div>`,
    (root) => {
      const read = bindAppSelect(root);
      $("[data-back]", root).addEventListener("click", () => openNew("sablonlar", ctx));
      $("#f-go", root).addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
          const r = await api("/api/olustur", { tur: "sablon", sablon: t.id, ...read() });
          closeModal();
          trackJob(r.is, true);
        } catch (err) {
          e.target.disabled = false;
          $("#f-err", root).innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        }
      });
      if (!ctx.app) $("#f-app-new", root)?.focus();
    });
    return;
  }

  if (step === "compose") {
    const mac = S.data?.platform?.mac;
    openModal(`
      ${modalHead("Proje klasöründen kur", "İçinde docker-compose.yml olan proje klasörünü seç.")}
      <div class="modal-content form">
        <div class="field">
          <label for="c-path">Proje klasörü</label>
          <div style="display:flex;gap:8px">
            <input id="c-path" placeholder="/Users/sen/Projelerim/sitem" autocomplete="off">
            ${mac ? `<button class="btn" id="c-pick">${icon("folder")}Seç…</button>` : ""}
          </div>
          <div class="help">${mac ? "“Seç…” ile klasörü bul ya da yolunu buraya yapıştır." : "Klasörün tam yolunu yapıştır."}</div>
        </div>
        <div id="c-result"></div>
      </div>
      <div class="modal-foot"><button class="btn left" data-back>${icon("back")}Geri</button><button class="btn primary" id="c-go" disabled>${icon("play")}Kur ve başlat</button></div>`,
    (root) => {
      const input = $("#c-path", root);
      const result = $("#c-result", root);
      const go = $("#c-go", root);
      let info = null;
      const check = async () => {
        const yol = input.value.trim();
        info = null;
        go.disabled = true;
        if (!yol) { result.innerHTML = ""; return; }
        result.innerHTML = `<div class="busy-text"><span class="spinner"></span><span>Klasör kontrol ediliyor…</span></div>`;
        try {
          info = (await api(`/api/compose-bilgi?yol=${encodeURIComponent(yol)}`)).bilgi;
          result.innerHTML = `
            <div class="found">
              <b>${icon("check")} ${esc(info.file)} bulundu.</b> İçinde ${info.services.length} parça var:
              <div class="service-list">${info.services.map((s) => `<span class="chip" title="${esc(s.build ? "Kendi kodun derlenecek" : s.image)}">${icon(s.kind)}${esc(s.name)} — ${esc(s.role)}</span>`).join("")}</div>
            </div>
            ${info.exists ? `<div class="hint">Bu proje zaten listede. Kurarsan eksik parçalar oluşturulur, değişenler güncellenir ve hepsi başlatılır.</div>` : ""}
            <div class="row2">
              <div class="field"><label for="c-name">Görünen ad</label><input id="c-name" value="${esc(info.display)}" maxlength="80"><div class="help">Kart üzerinde bu yazar.</div></div>
              <div class="field"><label for="c-project">Proje kodu</label><input id="c-project" value="${esc(info.name)}" maxlength="40"><div class="help">Parça adlarının başına gelir. Bilmiyorsan değiştirme.</div></div>
            </div>
            ${info.services.some((s) => s.build) ? `<div class="hint info">Bazı parçalar senin kodundan derlenecek; ilk kurulum birkaç dakika sürebilir.</div>` : ""}`;
          go.disabled = false;
        } catch (e) {
          result.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
        }
      };
      input.addEventListener("change", check);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } });
      $("#c-pick", root)?.addEventListener("click", async () => {
        try {
          const r = await api("/api/klasor-sec", {});
          if (r.yol) { input.value = r.yol; check(); }
        } catch (e) { flash(e.message, true); }
      });
      $("[data-back]", root).addEventListener("click", () => openNew("secim", ctx));
      go.addEventListener("click", async () => {
        if (!info) return;
        go.disabled = true;
        try {
          const r = await api("/api/olustur", {
            tur: "compose", yol: input.value.trim(),
            proje: $("#c-project", root).value.trim(), ad: $("#c-name", root).value.trim(),
          });
          closeModal();
          trackJob(r.is, true);
        } catch (e) {
          go.disabled = false;
          result.insertAdjacentHTML("beforeend", `<div class="form-error">${esc(e.message)}</div>`);
        }
      });
      input.focus();
    });
    return;
  }

  if (step === "ozel") {
    openModal(`
      ${modalHead("Docker Hub'dan imaj", "hub.docker.com'da bulduğun herhangi bir imajı çalıştır.")}
      <div class="modal-content form">
        <div class="row2">
          <div class="field"><label for="o-image">İmaj adı</label><input id="o-image" placeholder="nginx:alpine" autocomplete="off"><div class="help">Docker Hub sayfasındaki ad. Sonundaki :etiket sürümdür.</div></div>
          <div class="field"><label for="o-role">Parça adı (isteğe bağlı)</label><input id="o-role" placeholder="web" autocomplete="off"><div class="help">Boş bırakırsan imajdan türetilir.</div></div>
        </div>
        ${appSelectHTML(ctx.app)}
        <div class="row2">
          <div class="field"><label for="o-cport">İç kapı</label><input id="o-cport" inputmode="numeric" placeholder="80"><div class="help">İmajın içeride dinlediği numara (Docker Hub sayfasında yazar). Bilmiyorsan boş bırak.</div></div>
          <div class="field"><label for="o-hport">Dış kapı</label><input id="o-hport" inputmode="numeric" placeholder="otomatik"><div class="help">Tarayıcıda localhost:BU_SAYI ile açılır. Boşsa boş bir numara seçilir.</div></div>
        </div>
        <div class="field"><label for="o-env">Ayarlar (ortam değişkenleri)</label><textarea id="o-env" placeholder="AD=değer&#10;BASKA_AYAR=123"></textarea><div class="help">Her satıra bir tane, AD=değer biçiminde.</div></div>
        <div class="field"><label for="o-data">Veri klasörü (isteğe bağlı)</label><input id="o-data" placeholder="/data" autocomplete="off"><div class="help">İmajın verilerini yazdığı iç klasör. Doldurursan veriler parça silinse de korunur.</div></div>
        <div id="f-err"></div>
      </div>
      <div class="modal-foot"><button class="btn left" data-back>${icon("back")}Geri</button><button class="btn primary" id="o-go">${icon("download")}Oluştur</button></div>`,
    (root) => {
      const read = bindAppSelect(root);
      $("[data-back]", root).addEventListener("click", () => openNew("secim", ctx));
      $("#o-go", root).addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
          const r = await api("/api/olustur", {
            tur: "ozel",
            imaj: $("#o-image", root).value, parca: $("#o-role", root).value,
            ic_kapi: $("#o-cport", root).value.trim(), dis_kapi: $("#o-hport", root).value.trim(),
            ayarlar: $("#o-env", root).value, veri: $("#o-data", root).value,
            ...read(),
          });
          closeModal();
          trackJob(r.is, true);
        } catch (err) {
          e.target.disabled = false;
          $("#f-err", root).innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        }
      });
      $("#o-image", root).focus();
    });
  }
}

// ---------- Bildirimler --------------------------------------------------
function renderToasts() {
  const box = $("#toasts");
  const jobs = [...S.jobs.values()].filter((j) => !S.closedToasts.has(j.id));
  const html = jobs.map((j) => {
    const cls = j.status === "bitti" ? "ok" : j.status === "hata" ? "err" : "";
    const ic = j.status === "calisiyor" ? `<span class="spinner"></span>` : icon(j.status === "bitti" ? "check" : "alert");
    const body = j.status === "calisiyor"
      ? `<div class="tl">${esc(j.last || "Başlıyor…")}</div>`
      : `<div class="tm">${esc(j.message)}</div>`;
    const tools = j.status === "hata"
      ? `<div class="tools"><button class="link-btn" data-job="${j.id}">Ayrıntılar</button><button class="link-btn" data-close-toast="${j.id}">Kapat</button></div>`
      : j.status === "calisiyor" ? `<div class="tools"><button class="link-btn" data-job="${j.id}">Çıktıyı gör</button></div>` : "";
    return `<div class="toast ${cls}"><div class="ti">${ic}</div><div class="tb"><div class="tt">${esc(j.title)}</div>${body}${tools}</div></div>`;
  }).join("");
  if (box.innerHTML !== html) box.innerHTML = html;
}

let flashTimer = null;
function flash(text, isError = false) {
  const id = "flash";
  S.jobs.delete(id);
  const box = $("#toasts");
  $("#flash-toast")?.remove();
  box.insertAdjacentHTML("beforeend", `<div class="toast ${isError ? "err" : "ok"}" id="flash-toast"><div class="ti">${icon(isError ? "alert" : "check")}</div><div class="tb"><div class="tt">${esc(text)}</div></div></div>`);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $("#flash-toast")?.remove(), isError ? 6000 : 2200);
}

// ---------- Olay bağlama ------------------------------------------------
$("#btn-new").innerHTML = `${icon("plus")}Yeni ekle`;
$("#btn-help").innerHTML = `${icon("help")}Bu ne demek?`;
$("#intro-close").innerHTML = icon("close");
$("#btn-new").addEventListener("click", () => openNew());
$("#btn-help").addEventListener("click", openHelp);

$("#intro-close").addEventListener("click", () => {
  $("#intro").hidden = true;
  if (S.data?.ui) S.data.ui.intro_kapali = true;
  api("/api/arayuz", { intro_kapali: true }).catch(() => {});
});

$("#search").addEventListener("input", (e) => { S.filter = e.target.value; renderMain(); });

document.addEventListener("click", async (e) => {
  const g = e.target.closest("[data-global]");
  if (!g) return;
  if (g.dataset.global === "yeni") openNew();
  if (g.dataset.global === "docker-ac") {
    try { flash((await api("/api/docker-ac", {})).mesaj); } catch (err) { flash(err.message, true); }
  }
});

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[href]");
  if (!link || !/^https?:/.test(link.getAttribute("href"))) return;
  e.preventDefault();
  e.stopPropagation();
  api("/api/link-ac", { url: link.href }).catch((err) => flash(err.message, true));
}, true);

$("#apps").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const card = e.target.closest(".card");
  if (!card) return;
  const btn = e.target.closest("[data-act]");
  if (btn) { appAction(card.dataset.key, btn.dataset.act); return; }
  openDrawer(card.dataset.key);
});
$("#apps").addEventListener("keydown", (e) => {
  const card = e.target.closest?.(".card");
  if (card && e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDrawer(card.dataset.key); }
});

$("#drawer").addEventListener("click", (e) => {
  const key = S.openKey;
  const act = e.target.closest("[data-act]");
  if (act) return appAction(key, act.dataset.act);
  const cact = e.target.closest("[data-cact]");
  if (cact) return containerAction(cact.dataset.id, cact.dataset.cact);
  const dact = e.target.closest("[data-dact]");
  if (!dact) return;
  const d = dact.dataset.dact;
  if (d === "kapat") closeDrawer();
  if (d === "ad") { S.editingName = true; S.lastDrawer = ""; renderDrawer(); }
  if (d === "ad-iptal") { S.editingName = false; S.lastDrawer = ""; document.activeElement.blur(); renderDrawer(); }
  if (d === "parca-ekle") openNew("sablonlar", { app: key });
  if (d === "klasor") api("/api/klasor-ac", { key }).catch((err) => flash(err.message, true));
});
$("#drawer").addEventListener("submit", (e) => {
  if (e.target.dataset.form !== "name") return;
  e.preventDefault();
  S.editingName = false;
  const name = $("#name-input").value;
  document.activeElement.blur();
  saveMeta(S.openKey, { ad: name });
});
$("#drawer").addEventListener("focusout", (e) => {
  if (!e.target.matches("[data-note]")) return;
  const a = findApp(S.openKey);
  if (a && e.target.value.trim() !== (a.note || "")) saveMeta(a.key, { not: e.target.value });
});
$("#scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.openKey && !modal.open) {
    if (S.editingName) { S.editingName = false; S.lastDrawer = ""; document.activeElement.blur(); renderDrawer(); }
    else closeDrawer();
  }
});

$("#toasts").addEventListener("click", (e) => {
  const j = e.target.closest("[data-job]");
  if (j) return openJob(j.dataset.job);
  const c = e.target.closest("[data-close-toast]");
  if (c) { S.closedToasts.add(c.dataset.closeToast); S.jobs.delete(c.dataset.closeToast); renderToasts(); }
});

// pywebview köprüsü hazır olunca başla.
if (window.pywebview?.api) refresh();
else window.addEventListener("pywebviewready", refresh, { once: true });
