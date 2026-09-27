"use strict";

/* =====================================================================
   Basic Docker — çekirdek
   Güvenli HTML şablonu, Python köprüsü, biçimlendirme, terimler, durum,
   simgeler, bildirimler, pencereler (modal), açılır menüler, yönlendirici.
   ===================================================================== */

// ---------- Güvenli HTML --------------------------------------------------
// html`...${değer}...` içindeki değerler otomatik kaçırılır. Kaçırılmaması
// gereken (zaten güvenli) parçalar raw() ile ya da başka bir html`` ile gelir.
const _ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => _ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const raw = (s) => new Raw(String(s ?? ""));

function _render(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(_render).join("");
  return esc(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += _render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// Canlı veriler sık yenilenir. Kullanıcı bir bölgeye tıklarken (fare basılıyken) ya da içindeki
// bir alana yazı yazarken o bölgeyi yeniden çizmeyelim: tıklama boşa gitmesin, yazı silinmesin.
let _pressed = null;
const _deferred = new Map();
document.addEventListener("pointerdown", (e) => { _pressed = e.target; }, true);
document.addEventListener("pointerup", () => {
  setTimeout(() => {
    _pressed = null;
    const items = [..._deferred];
    _deferred.clear();
    for (const [el, s] of items) patch(el, s);
  }, 0);
}, true);

/** İçerik değiştiyse yazar; kaydırma konumu ve odak korunur. */
function patch(el, content) {
  if (!el) return;
  const s = String(content);
  if (el.__html === s) return;
  if (_pressed && el.contains(_pressed)) { _deferred.set(el, s); return; }
  const active = document.activeElement;
  if (active && active !== el && el.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
  el.innerHTML = s;
  el.__html = s;
}

// ---------- Python köprüsü --------------------------------------------------
async function api(path, body) {
  // Sunucu yok: Python tarafındaki fonksiyonlar pywebview köprüsüyle doğrudan çağrılır.
  const r = await window.pywebview.api.call(path, body === undefined ? null : body);
  if (!r || !r.ok) throw new Error((r && r.hata) || L("Bilinmeyen hata", "Unknown error"));
  return r.veri;
}

const q = (params) => "?" + Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

// ---------- Dil -----------------------------------------------------------------
// Arayüz Türkçe (varsayılan) ya da İngilizce. L("Türkçe", "English") seçili dildeki metni verir.
const isEN = () => S.prefs.lang === "en";
const L = (tr, en) => (isEN() ? en : tr);
const loc = () => (isEN() ? "en-US" : "tr-TR");
/** Uygulama hangi bilgisayarda çalışıyor? (veri gelmeden önce tarayıcıdan tahmin edilir) */
const onMac = () => (S.data?.platform ? !!S.data.platform.mac : /Mac/i.test(navigator.platform || ""));
const onWin = () => (S.data?.platform ? !!S.data.platform.win : /Win/i.test(navigator.platform || ""));
const onRemoteEngine = () => !!S.data?.platform?.remote;
// "Bu Mac" yalnızca Mac'te; Windows/Linux'ta "bu bilgisayar". Türkçe ekler kelimeye göre değiştiği için her biçim ayrı.
const _HERE = {
  mac: { "": "bu Mac", te: "bu Mac'te", e: "bu Mac'e", ten: "bu Mac'ten", teki: "bu Mac'teki", in: "bu Mac'in",
    ine: "Mac'ine", inde: "Mac'inde", indeki: "Mac'indeki", acilinca: "Mac açılınca" },
  pc: { "": "bu bilgisayar", te: "bu bilgisayarda", e: "bu bilgisayara", ten: "bu bilgisayardan", teki: "bu bilgisayardaki", in: "bu bilgisayarın",
    ine: "bilgisayarına", inde: "bilgisayarında", indeki: "bilgisayarındaki", acilinca: "bilgisayar açılınca" },
};
/** here("te") → "bu Mac'te" / "bu bilgisayarda"; buyuk: cümle başı. */
function here(form = "", buyuk = false) {
  const s = _HERE[onMac() ? "mac" : "pc"][form];
  return buyuk ? s[0].toLocaleUpperCase("tr-TR") + s.slice(1) : s;
}
function hereEn(cap = false) {
  const s = onMac() ? "this Mac" : "this computer";
  return cap ? s[0].toUpperCase() + s.slice(1) : s;
}
const yourPcEn = () => (onMac() ? "your Mac" : "your computer");
/** "Finder'da aç" / "Gezgin'de aç" / "Klasörü aç" */
const openInFiles = () => (onMac() ? L("Finder'da aç", "Open in Finder") : onWin() ? L("Gezgin'de aç", "Open in File Explorer") : L("Klasörü aç", "Open folder"));
const showInFiles = () => (onMac() ? L("Finder'da göster", "Show in Finder") : onWin() ? L("Gezgin'de göster", "Show in File Explorer") : L("Klasörde göster", "Show in folder"));
/** Yedek silme: Mac'te Çöp Sepeti, Windows'ta Geri Dönüşüm Kutusu, Linux'ta kalıcı silme (backups.py ile aynı). */
const trashVerb = () => (onMac() ? L("Çöp Sepeti'ne taşı", "Move to Trash") : onWin() ? L("Geri Dönüşüm Kutusu'na taşı", "Move to Recycle Bin")
  : L("Kalıcı olarak sil", "Delete permanently"));
/** Kalıbın işlemcisini kiminkiyle karşılaştırıyoruz: uzak motorda sunucununki. */
const archWho = () => (onRemoteEngine() ? L("Sunucunun işlemcisi", "The server is") : L(`${here("in", true)} işlemcisi`, `${hereEn(true)} is`));

/** Uzak sunucu güvenli modda mı? (silme, kurulum, güncelleme, temizlik ve terminal kapalı) */
const safeModeOn = () => !!S.data?.platform?.remote?.guvenli;
/** Güvenli moddayken yıkıcı bir işleme basılırsa: işlemi yapma, sebebini söyle. */
function safeModeBlocked() {
  if (!safeModeOn()) return false;
  flash(L("Bu sunucu güvenli modda: silme, kurulum, güncelleme, temizlik ve terminal kapalı. Üstteki şeritten “Tam kontrol”ü açabilirsin.",
    "This server is in safe mode: deleting, installing, updating, cleanup and the terminal are off. You can allow “Full control” from the bar at the top."), true);
  return true;
}

/** Arama için harf katlama: I, İ ve ı hepsi "i". Türkçe küçük harfe çevirme "INFO"yu "ınfo" yaptığı için
 *  kayıtlarda "info", "failed" gibi aramalar bulunmuyordu. Uzunluk değişmez (işaretleme yerleri kaymaz). */
const fold = (s) => String(s ?? "").replace(/[A-ZÇĞİÖŞÜı]/g, (ch) => (ch === "I" || ch === "İ" || ch === "ı" ? "i" : ch.toLowerCase()));

/** Kısayol yazıları: macOS dışında (Windows, Linux) ⌘ yerine Ctrl. */
const modText = (s) => (S.data?.platform && !S.data.platform.mac ? String(s).replace(/⌘\+?/g, "Ctrl+") : s);

// ---------- Biçimlendirme -----------------------------------------------------
const fmt = {
  bytes(n, digits = 1) {
    n = Number(n) || 0;
    if (n < 1000) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let i = -1;
    do { n /= 1000; i++; } while (n >= 1000 && i < units.length - 1);
    return `${n.toLocaleString(loc(), { maximumFractionDigits: n >= 100 ? 0 : digits })} ${units[i]}`;
  },
  pct(n, digits = 1) {
    const v = (Number(n) || 0).toLocaleString(loc(), { maximumFractionDigits: digits });
    return isEN() ? `${v}%` : `%${v}`;
  },
  num(n) { return (Number(n) || 0).toLocaleString(loc()); },
  _t(v) {
    if (!v) return NaN;
    if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
    if (String(v).startsWith("0001")) return NaN;
    return Date.parse(v);
  },
  ago(v) {
    const t = fmt._t(v);
    if (isNaN(t)) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return L("az önce", "just now");
    const ago = (n, tr, en) => L(`${n} ${tr} önce`, `${n} ${en}${n === 1 ? "" : "s"} ago`);
    const m = s / 60; if (m < 60) return ago(Math.max(1, Math.round(m)), "dakika", "minute");
    const h = m / 60; if (h < 24) return ago(Math.round(h), "saat", "hour");
    const d = h / 24; if (d < 30) return ago(Math.round(d), "gün", "day");
    const mo = d / 30; if (mo < 12) return ago(Math.round(mo), "ay", "month");
    return ago(Math.round(mo / 12), "yıl", "year");
  },
  since(v) {
    const t = fmt._t(v);
    if (isNaN(t)) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return L(`${Math.round(s)} sn`, `${Math.round(s)}s`);
    const m = s / 60; if (m < 60) return L(`${Math.round(m)} dk`, `${Math.round(m)} min`);
    const h = m / 60; if (h < 48) return L(`${Math.floor(h)} sa ${Math.round(m % 60)} dk`, `${Math.floor(h)}h ${Math.round(m % 60)}m`);
    const d = Math.floor(h / 24);
    return L(`${d} gün`, `${d} day${d === 1 ? "" : "s"}`);
  },
  date(v) {
    const t = fmt._t(v);
    if (isNaN(t)) return "";
    return new Date(t).toLocaleString(loc(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  },
  time(v) {
    const t = fmt._t(v);
    if (isNaN(t)) return "";
    return new Date(t).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  },
  day(v) {
    const t = fmt._t(v);
    if (isNaN(t)) return "";
    const d = new Date(t), now = new Date();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return L("Bugün", "Today");
    if (d.toDateString() === y.toDateString()) return L("Dün", "Yesterday");
    return d.toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long" });
  },
};
const upper = (s) => (s || "").toLocaleUpperCase(isEN() ? "en" : "tr");
/** "7 parça" / "7 containers" — İngilizcede 1'den farklıysa sona "s" eklenir. */
const plural = (n, word) => `${fmt.num(n)} ${word}${isEN() && n !== 1 && !/s$/.test(word) ? "s" : ""}`;

function hue(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// ---------- Terimler: sade Türkçe ↔ teknik terimler (İngilizcede standart terimler) ----------
const TERMS_EN = {
  app: ["App", "Apps"],
  container: ["Container", "Containers"],
  image: ["Image", "Images"],
  volume: ["Volume", "Volumes"],
  network: ["Network", "Networks"],
  port: ["Port", "Ports"],
  logs: ["Logs", "Logs"],
  env: ["Environment", "Environment"],
  cleanup: ["Cleanup", "Cleanup"],
};
const TERMS = {
  app: ["Uygulama", "Uygulamalar", "Uygulama", "Uygulamalar"],
  container: ["Parça", "Parçalar", "Konteyner", "Konteynerler"],
  image: ["Kalıp", "Kalıplar", "İmaj", "İmajlar"],
  volume: ["Veri kutusu", "Veri kutuları", "Volume", "Volume'lar"],
  network: ["Ağ", "Ağlar", "Network", "Network'ler"],
  port: ["Kapı", "Kapılar", "Port", "Portlar"],
  logs: ["Kayıtlar", "Kayıtlar", "Loglar", "Loglar"],
  env: ["Ortam ayarları", "Ortam ayarları", "Ortam değişkenleri", "Ortam değişkenleri"],
  cleanup: ["Temizlik", "Temizlik", "Disk temizliği", "Disk temizliği"],
};
function T(key, pluralForm = false) {
  if (isEN()) return TERMS_EN[key]?.[pluralForm ? 1 : 0] || key;
  const row = TERMS[key];
  if (!row) return key;
  const tech = S.prefs.dil === "teknik";
  return row[(tech ? 2 : 0) + (pluralForm ? 1 : 0)];
}
const Tl = (key, p) => T(key, p).toLocaleLowerCase(isEN() ? "en" : "tr");

// ---------- Durum ve olaylar ---------------------------------------------------
const S = {
  data: null,             // son /api/durum cevabı
  offline: false,
  prefs: {},              // arayüz tercihleri (tema, dil…)
  jobs: new Map(),        // id -> iş
  jobWatch: new Map(),    // id -> iş bitince çağrılacak fonksiyonlar
  closedToasts: new Set(),
  reveal: new Set(),      // şifresi gösterilen bağlantılar
  catalog: null,
  stats: {},              // canlı kaynak kullanımı (ad -> {...})
  lastStatsAt: 0,
  badges: {},             // kenar çubuğu rozetleri (temizlik, kapı çakışması…)
};

const bus = {
  _h: {},
  on(evt, fn) { (this._h[evt] ||= new Set()).add(fn); return () => this._h[evt].delete(fn); },
  emit(evt, arg) { for (const fn of this._h[evt] || []) { try { fn(arg); } catch (e) { console.error(e); } } },
};

const apps = () => S.data?.apps || [];
const findApp = (key) => apps().find((a) => a.key === key);
function findContainer(id) {
  for (const app of apps()) {
    const c = app.containers.find((x) => x.id === id || x.name === id || x.short_id === id);
    if (c) return { app, c };
  }
  return null;
}
const allContainers = () => apps().flatMap((a) => a.containers.map((c) => ({ ...c, app: a })));
const activeJob = (key) => [...S.jobs.values()].find((j) => j.app === key && j.status === "calisiyor");
const isGroupApp = (a) => ["compose", "basicdocker", "manual"].includes(a.source) && !a.key.startsWith("tek:");

// ---------- Simgeler (Lucide tarzı, 24x24, çizgi) -----------------------------
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  drive: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
  network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/><path d="M5 17v4M3 19h4"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  memory: '<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.8V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.8Z"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  restart: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8z" class="fill"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" class="fill"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" class="fill"/><rect x="14" y="4.5" width="4" height="15" rx="1" class="fill"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  logs: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  update: '<circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4M12 16V8"/>',
  hammer: '<path d="m15 12-8.37 8.37a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.91-1.91A2 2 0 0 1 19 8.17V7l-2.26-2.26a6 6 0 0 0-4.2-1.76L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.17a2 2 0 0 1 1.42.59L18.5 14.5"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  unlink: '<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><path d="M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
  edit: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  stethoscope: '<path d="M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  move: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  // parça türleri
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  cache: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/>',
  frontend: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  backend: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  worker: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  scheduler: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  queue: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  storage: '<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  build: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  backup: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>',
  test: '<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55A1 1 0 0 0 5.61 22h12.78a1 1 0 0 0 .89-1.45l-5.07-10.12a2 2 0 0 1-.21-.9V2"/><path d="M8.5 2h7M7 16h10"/>',
  monitorKind: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  model: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  other: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/>',
};
const KIND_ICON = { monitor: "monitorKind" };
function icon(name, cls = "") {
  const body = ICONS[KIND_ICON[name] || name] || ICONS.box;
  return raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`);
}

// ---------- Panoya kopyalama ------------------------------------------------------
async function copyText(text, label = L("Kopyalandı", "Copied")) {
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
  flash(label);
}

// ---------- Bildirimler (sağ alt köşe) ---------------------------------------------
let _flashTimer = null;
function flash(text, isError = false) {
  const box = $("#toasts");
  $("#flash-toast")?.remove();
  box.insertAdjacentHTML("beforeend", String(html`
    <div class="toast ${isError ? "err" : "ok"}" id="flash-toast" role="${isError ? "alert" : "status"}">
      <div class="toast-icon">${icon(isError ? "alert" : "checkCircle")}</div>
      <div class="toast-body"><div class="toast-title">${text}</div></div>
    </div>`));
  clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => $("#flash-toast")?.remove(), isError ? 6500 : 2400);
}

function renderToasts() {
  const box = $("#toasts");
  const flashEl = $("#flash-toast");
  const jobs = [...S.jobs.values()].filter((j) => !S.closedToasts.has(j.id)).slice(-4);
  const out = jobs.map((j) => {
    const cls = j.status === "bitti" ? "ok" : j.status === "hata" ? "err" : "busy";
    const ic = j.status === "calisiyor" ? raw('<span class="spinner"></span>') : icon(j.status === "bitti" ? "checkCircle" : "alert");
    return html`
      <div class="toast ${cls}" data-job-toast="${j.id}">
        <div class="toast-icon">${ic}</div>
        <div class="toast-body">
          <div class="toast-title">${j.title}</div>
          <div class="toast-text">${j.status === "calisiyor" ? (j.last || L("Başlıyor…", "Starting…")) : j.message}</div>
          <div class="toast-actions">
            <button class="link" data-job="${j.id}">${j.status === "calisiyor" ? L("Çıktıyı gör", "View output") : L("Ayrıntılar", "Details")}</button>
            ${j.status !== "calisiyor" ? html`<button class="link" data-close-toast="${j.id}">${L("Kapat", "Dismiss")}</button>` : ""}
          </div>
        </div>
      </div>`;
  });
  const markup = String(html`${out}`);
  if (box.__jobs !== markup) {
    box.__jobs = markup;
    box.innerHTML = markup;
    if (flashEl) box.appendChild(flashEl);
  }
}

// ---------- İşler (uzun süren arka plan işlemleri) -------------------------------
function mergeJobs(list) {
  for (const j of list) {
    const prev = S.jobs.get(j.id);
    S.jobs.set(j.id, j);
    if (prev && prev.status === "calisiyor" && j.status !== "calisiyor") onJobDone(j);
  }
  const now = Date.now() / 1000;
  for (const [id, j] of S.jobs) {
    if (j.status === "bitti" && j.finished && now - j.finished > 8) S.jobs.delete(id);
  }
}

function onJobDone(job) {
  const fns = S.jobWatch.get(job.id);
  S.jobWatch.delete(job.id);
  for (const fn of fns || []) { try { fn(job); } catch (e) { console.error(e); } }
  bus.emit("job-done", job);
}

/** Yeni başlatılan işi izlemeye al. Bitince onDone(iş) çağrılır. */
function trackJob(job, onDone) {
  if (!job) return;
  S.jobs.set(job.id, job);
  if (onDone) {
    if (!S.jobWatch.has(job.id)) S.jobWatch.set(job.id, []);
    S.jobWatch.get(job.id).push(onDone);
  }
  renderToasts();
  refresh();
}

/** İş başlatan bir API çağrısı: hata olursa bildirir, işi izler. */
async function runJob(path, body, onDone) {
  try {
    const r = await api(path, body);
    trackJob(r.is, onDone);
    return r.is;
  } catch (e) {
    flash(e.message, true);
    return null;
  }
}

// ---------- Pencere (modal) ----------------------------------------------------------
const Modal = {
  el: null,
  cleanup: null,
  resolve: null,
  open({ title = "", sub = "", body = "", foot = "", size = "md", onMount, dismissable = true } = {}) {
    this.close(true);
    const m = this.el;
    m.className = `modal size-${size}`;
    m.dataset.dismissable = dismissable ? "1" : "";
    m.innerHTML = String(html`
      <div class="modal-card">
        ${title ? html`<header class="modal-head">
          <div class="modal-titles"><h2 id="modal-title">${title}</h2>${sub ? html`<p>${sub}</p>` : ""}</div>
          <button class="icon-btn" data-close aria-label="${L("Kapat", "Close")}" title="${L("Kapat (Esc)", "Close (Esc)")}">${icon("close")}</button>
        </header>` : ""}
        <div class="modal-body">${body}</div>
        ${foot ? html`<footer class="modal-foot">${foot}</footer>` : ""}
      </div>`);
    m.setAttribute("aria-labelledby", "modal-title");
    if (!m.open) m.showModal();
    // onMount'a <dialog>'un kendisi değil, her açılışta yeniden oluşan kartı ver: eklenen dinleyiciler
    // pencereyle birlikte gider, bir sonraki pencerede üst üste binmez (Enter iki kez gönderiyordu).
    if (onMount) this.cleanup = onMount($(".modal-card", m)) || null;
    const first = $("[autofocus]", m) || $(".modal-body input, .modal-body select, .modal-body textarea", m);
    if (first) setTimeout(() => first.focus(), 30);
    return m;
  },
  close(silent = false) {
    if (this.cleanup) { try { this.cleanup(); } catch { /* yok say */ } }
    this.cleanup = null;
    if (this.resolve && !silent) { const r = this.resolve; this.resolve = null; r(null); }
    if (!silent && this.el?.open) this.el.close();
  },
};

/** Onay penceresi. Promise<{ok, checked}> ya da vazgeçilirse null döner. */
function confirmDialog({ title, text = "", confirmText = L("Tamam", "OK"), danger = false, checkbox = null, icon: ic = null, extra = "" }) {
  return new Promise((resolve) => {
    Modal.open({
      title, size: "sm",
      body: html`
        ${text ? html`<p class="modal-text">${text}</p>` : ""}
        ${extra}
        ${checkbox ? html`<label class="check danger-check"><input type="checkbox" id="cf-check">
          <span><b>${checkbox.label}</b>${checkbox.help ? html`<small>${checkbox.help}</small>` : ""}</span></label>` : ""}`,
      foot: html`
        <button class="btn" data-close>${L("Vazgeç", "Cancel")}</button>
        <button class="btn ${danger ? "danger-solid" : "primary"}" id="cf-go" autofocus>${ic ? icon(ic) : ""}${confirmText}</button>`,
      onMount(m) {
        Modal.resolve = resolve;
        $("#cf-go", m).addEventListener("click", () => {
          const checked = !!$("#cf-check", m)?.checked;
          Modal.resolve = null;
          Modal.el.close();
          resolve({ ok: true, checked });
        });
      },
    });
  });
}

/** Tek alanlı giriş penceresi. Promise<string|null> */
function promptDialog({ title, label, value = "", placeholder = "", help = "", confirmText = L("Kaydet", "Save"), validate }) {
  return new Promise((resolve) => {
    Modal.open({
      title, size: "sm",
      body: html`
        <div class="field">
          <label for="pd-in">${label}</label>
          <input id="pd-in" value="${value}" placeholder="${placeholder}" autocomplete="off" spellcheck="false">
          ${help ? html`<div class="help">${help}</div>` : ""}
          <div class="field-error" id="pd-err" role="alert"></div>
        </div>`,
      foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="pd-go">${confirmText}</button>`,
      onMount(m) {
        Modal.resolve = resolve;
        const input = $("#pd-in", m);
        const go = () => {
          const v = input.value.trim();
          const err = validate ? validate(v) : "";
          if (err) { $("#pd-err", m).textContent = err; input.focus(); return; }
          Modal.resolve = null;
          Modal.el.close();
          resolve(v);
        };
        $("#pd-go", m).addEventListener("click", go);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
        setTimeout(() => input.select(), 40);
      },
    });
  });
}

// ---------- Açılır menü ------------------------------------------------------------
const Menu = {
  el: null,
  anchor: null,
  open(anchor, items) {
    this.close();
    // Güvenli moddaki sunucuda yıkıcı işlemler (danger: silme; unsafe: kurulum, güncelleme, terminal…) gösterilmez.
    const safe = safeModeOn();
    items = items.filter(Boolean).filter((it) => !(safe && typeof it === "object" && (it.unsafe || it.danger)));
    items = items.filter((it, i, arr) => it !== "-" || (i > 0 && i < arr.length - 1 && arr[i - 1] !== "-"));
    const el = document.createElement("div");
    el.className = "menu";
    el.setAttribute("role", "menu");
    el.innerHTML = String(html`${items.filter(Boolean).map((it, i) => it === "-"
      ? raw('<div class="menu-sep" role="separator"></div>')
      : it.header ? html`<div class="menu-header">${it.header}</div>`
        : html`<button class="menu-item ${it.danger ? "danger" : ""}" role="menuitem" data-i="${i}" ${it.disabled ? raw("disabled") : ""}>
          ${it.icon ? icon(it.icon) : raw('<span class="i"></span>')}<span>${it.label}</span>${it.hint ? html`<kbd>${it.hint}</kbd>` : ""}</button>`)}`);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    if (left < 8) left = Math.max(8, r.left);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const it = items.filter(Boolean)[+b.dataset.i];
      this.close();
      it.onClick?.();
    });
    el.addEventListener("keydown", (e) => {
      const btns = $$(".menu-item:not([disabled])", el);
      const i = btns.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
      if (e.key === "Escape") { e.preventDefault(); this.close(); anchor.focus(); }
    });
    this.el = el;
    this.anchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    $(".menu-item:not([disabled])", el)?.focus();
  },
  close() {
    this.el?.remove();
    this.anchor?.setAttribute("aria-expanded", "false");
    this.el = null;
    this.anchor = null;
  },
};
document.addEventListener("mousedown", (e) => {
  if (Menu.el && !Menu.el.contains(e.target) && !Menu.anchor?.contains(e.target)) Menu.close();
});
window.addEventListener("resize", () => Menu.close());

// ---------- Yönlendirici -------------------------------------------------------------
// Adres çubuğu yok ama hash yine de geri/ileri ve derin bağlantı için kullanılır.
const Router = {
  routes: [],
  current: null,
  params: {},
  add(pattern, view, nav) {
    const keys = [];
    const rx = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    this.routes.push({ rx, keys, view, nav });
  },
  resolve() {
    const path = location.hash.replace(/^#/, "") || "/uygulamalar";
    for (const r of this.routes) {
      const m = path.match(r.rx);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params, path };
      }
    }
    return null;
  },
  go(path, replace = false) {
    const target = "#" + path;
    if (location.hash === target) return this.render();
    if (replace) { history.replaceState(null, "", target); this.render(); } else location.hash = target;
  },
  render() {
    const found = this.resolve();
    if (!found) return this.go("/uygulamalar", true);
    const { route, params } = found;
    const main = $("#main");
    const same = this.current?.view === route.view;
    if (same && route.view.reparam && JSON.stringify(this.params) !== JSON.stringify(params)) {
      const handled = route.view.reparam(params);
      if (handled) { this.params = params; bus.emit("route", route.nav); return; }
    } else if (same && JSON.stringify(this.params) === JSON.stringify(params)) {
      return;
    }
    Menu.close();
    this.current?.view.unmount?.();
    this.current = route;
    this.params = params;
    main.scrollTop = 0;
    main.__html = "";
    route.view.mount(main, params);
    bus.emit("route", route.nav);
    const h = $("h1", main);
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  },
};
const link = (path) => "#" + path.split("/").map((p, i) => (i === 0 ? p : encodeURIComponent(p))).join("/");
