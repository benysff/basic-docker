"use strict";

/* =====================================================================
   Ortak arayüz parçaları: sayfa başlığı, durum rozeti, boş ekran,
   iskelet, sekmeler, küçük grafik (sparkline), ölçü çubuğu, uyarı kutusu.
   ===================================================================== */

const LEVEL_OF_APP = { running: "ok", partial: "warn", problem: "err", stopped: "off", empty: "off" };

function pageHead({ title, desc = "", actions = "", crumbs = null, lead = "" }) {
  return html`
    <header class="page-head">
      ${crumbs ? html`<nav class="crumbs" aria-label="${L("Konum", "Breadcrumb")}">${crumbs.map((c, i) => i < crumbs.length - 1
        ? html`<a href="${c.href}">${c.label}</a>${icon("chevronRight", "sep")}`
        : html`<span aria-current="page">${c.label}</span>`)}</nav>` : ""}
      <div class="page-title-row">
        ${lead}
        <div class="page-titles">
          <h1>${title}</h1>
          ${desc ? html`<p class="page-desc">${desc}</p>` : ""}
        </div>
        <div class="page-actions">${actions}</div>
      </div>
    </header>`;
}

function dot(level) {
  return html`<span class="dot lvl-${level}" aria-hidden="true"></span>`;
}

function badge(level, text, title = "") {
  return html`<span class="badge lvl-${level}" ${title ? raw(`title="${esc(title)}"`) : ""}>${dot(level)}${text}</span>`;
}

function pill(text, cls = "") {
  return html`<span class="pill ${cls}">${text}</span>`;
}

function avatar(key, name, size = "") {
  return html`<div class="avatar ${size}" style="--h:${hue(key)}" aria-hidden="true">${upper((name || "?").trim()[0] || "?")}</div>`;
}

function kindTile(kind, level = "") {
  return html`<div class="kind-tile ${level ? `lvl-${level}` : ""}" aria-hidden="true">${icon(kind)}</div>`;
}

function emptyState({ icon: ic = "box", title, text = "", action = "", compact = false }) {
  return html`
    <div class="empty ${compact ? "compact" : ""}">
      <div class="empty-icon">${icon(ic)}</div>
      <h3>${title}</h3>
      ${text ? html`<p>${text}</p>` : ""}
      ${action ? html`<div class="empty-actions">${action}</div>` : ""}
    </div>`;
}

function errorState(message, retryAttr = "data-retry") {
  return emptyState({
    icon: "alert", title: L("Bir şeyler ters gitti", "Something went wrong"), text: message,
    action: html`<button class="btn" ${raw(retryAttr)}>${icon("refresh")}${L("Tekrar dene", "Try again")}</button>`,
  });
}

function skeletonRows(n = 6, cls = "") {
  return html`<div class="skeleton-list ${cls}" aria-busy="true" aria-label="${L("Yükleniyor", "Loading")}">${Array.from({ length: n }, (_, i) =>
    html`<div class="skeleton-row" style="--d:${i * 60}ms"><span class="sk sk-a"></span><span class="sk sk-b"></span><span class="sk sk-c"></span></div>`)}</div>`;
}

function skeletonCards(n = 6) {
  return html`<div class="card-grid" aria-busy="true">${Array.from({ length: n }, (_, i) =>
    html`<div class="card skeleton-card" style="--d:${i * 60}ms"><span class="sk sk-a"></span><span class="sk sk-b"></span><span class="sk sk-c"></span></div>`)}</div>`;
}

function callout({ level = "info", icon: ic, title = "", text = "", actions = "", cls = "" }) {
  const defIcon = { info: "info", ok: "checkCircle", warn: "alert", err: "xCircle", tip: "bulb" }[level] || "info";
  return html`
    <div class="callout lvl-${level} ${cls}" role="${level === "err" ? "alert" : "note"}">
      <div class="callout-icon">${icon(ic || defIcon)}</div>
      <div class="callout-body">
        ${title ? html`<div class="callout-title">${title}</div>` : ""}
        ${text ? html`<div class="callout-text">${text}</div>` : ""}
        ${actions ? html`<div class="callout-actions">${actions}</div>` : ""}
      </div>
    </div>`;
}

function tabs(items, active, attr = "data-tab") {
  return html`
    <nav class="tabs" role="tablist">
      ${items.filter(Boolean).map((t) => html`
        <button class="tab ${t.id === active ? "active" : ""}" role="tab" aria-selected="${t.id === active}" ${raw(attr)}="${t.id}">
          ${t.icon ? icon(t.icon) : ""}${t.label}${t.count !== undefined && t.count !== null ? html`<span class="tab-count">${t.count}</span>` : ""}
          ${t.alert ? html`<span class="tab-alert" aria-label="${L("Dikkat", "Attention")}">${dot(t.alert)}</span>` : ""}
        </button>`)}
    </nav>`;
}

function segmented(name, options, value) {
  return html`
    <div class="segmented" role="radiogroup" aria-label="${name}">
      ${options.map((o) => html`
        <button class="seg ${o.id === value ? "active" : ""}" role="radio" aria-checked="${o.id === value}" data-seg="${name}" data-val="${o.id}" ${o.title ? raw(`title="${esc(o.title)}"`) : ""}>
          ${o.icon ? icon(o.icon) : ""}${o.label ? html`<span>${o.label}</span>` : ""}${o.count !== undefined ? html`<span class="seg-count">${o.count}</span>` : ""}
        </button>`)}
    </div>`;
}

function searchBox(id, placeholder, value = "") {
  return html`
    <label class="search-box">
      ${icon("search")}
      <span class="sr">${placeholder}</span>
      <input id="${id}" type="search" placeholder="${placeholder}" value="${value}" autocomplete="off" spellcheck="false">
      <kbd class="search-kbd" aria-hidden="true">/</kbd>
    </label>`;
}

/** Küçük çizgi grafik. values: sayı dizisi. */
function sparkline(values, { max = null, w = 120, h = 32, cls = "" } = {}) {
  const vals = (values || []).filter((v) => typeof v === "number");
  if (vals.length < 2) return html`<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"></svg>`;
  const top = Math.max(max ?? 0, ...vals) || 1;
  const step = w / (vals.length - 1);
  const pts = vals.map((v, i) => [i * step, h - 2 - (v / top) * (h - 4)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const area = `${line}L${w},${h}L0,${h}Z`;
  return html`<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="${w}" height="${h}" aria-hidden="true">
    <path class="spark-area" d="${area}"/><path class="spark-line" d="${line}"/></svg>`;
}

function meter(pct, level = "") {
  const p = Math.max(0, Math.min(100, pct || 0));
  const lvl = level || (p > 85 ? "err" : p > 65 ? "warn" : "ok");
  return html`<div class="meter lvl-${lvl}" role="meter" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`;
}

function kv(rows) {
  return html`<dl class="kv">${rows.filter(Boolean).map(([k, v, cls]) => html`<div class="kv-row"><dt>${k}</dt><dd class="${cls || ""}">${v}</dd></div>`)}</dl>`;
}

function linkChip(url, label, { dim = false, title = "" } = {}) {
  return html`<a class="chip link-chip ${dim ? "dim" : ""}" href="${url}" target="_blank" rel="noopener" title="${title || L("Tarayıcıda aç", "Open in browser")}">${icon("external")}${label}</a>`;
}

function copyBtn(text, label = L("Kopyala", "Copy"), cls = "sm") {
  return html`<button class="btn ${cls}" data-copy="${text}">${icon("copy")}${label}</button>`;
}

function kbd(keys) {
  return html`<span class="kbd-group">${modText(keys).split("+").map((k) => html`<kbd>${k}</kbd>`)}</span>`;
}

/** Kayıt satırlarını renklendirir (hata kırmızı, uyarı sarı). */
function colorLog(text, query = "", hints = {}) {
  const qq = fold(query || "");
  const out = [];
  (text || "").split("\n").forEach((line, i) => {
    if (qq && !fold(line).includes(qq)) return;
    let cls = "";
    if (/\b(error|exception|fatal|failed|traceback|panic|critical|hata|refused|denied)\b/i.test(line)) cls = "e";
    else if (/\b(warn|warning|uyarı|deprecated)\b/i.test(line)) cls = "w";
    let body = esc(line);
    if (qq) {
      const lower = fold(line);
      let idx = 0, res = "", pos;
      while ((pos = lower.indexOf(qq, idx)) !== -1) {
        res += esc(line.slice(idx, pos)) + "<mark>" + esc(line.slice(pos, pos + qq.length)) + "</mark>";
        idx = pos + qq.length;
      }
      body = res + esc(line.slice(idx));
    }
    const hint = hints[i];
    out.push(`<span class="ln ${cls}">${body}${hint ? `<span class="ln-hint" title="${esc(hint)}">${String(icon("bulb"))}${esc(hint)}</span>` : ""}</span>`);
  });
  return raw(out.join("\n"));
}

/** Ekrandaki kısa açıklama balonu ("bu ne demek?"). */
function hintIcon(text) {
  return html`<span class="hint-icon" tabindex="0" role="img" aria-label="${text}" title="${text}">${icon("help")}</span>`;
}

/** Durum metnine göre parça seviyesi (ok/warn/err/off). */
function containerLevel(c) {
  if (c.state === "paused") return "warn";
  return c.level;
}

/** Uzak SSH motorunda bağlantı adresi sunucudadır; bilgisayardaki kod için tünel gerekir. */
function connNote(conn) {
  if (conn.scope !== "local") return "";
  const r = S.data?.platform?.remote;
  if (!r) return "";
  if (r.kind === "tcp") return L(`Adres sunucuda: bilgisayarından bağlanırken localhost yerine ${r.host} yaz.`, `This address is on the server: use ${r.host} instead of localhost when connecting from your computer.`);
  return html`${L("Bu adres sunucuda çalışır. Bilgisayarındaki kod bağlansın diye tünel aç:", "This address works on the server. Open a tunnel so code on your computer can connect:")}
    <button class="btn xs" data-tunnel="${conn.port}">${icon("link")}${L(`${here("e", true)} tünel aç`, `Tunnel to ${hereEn()}`)}</button>`;
}

/** Motoru açma düğmesinin yazısı (Türkçe ekler motor adına göre değişir). */
function engineOpenLabel(kind) {
  if (isEN()) return { orbstack: "Open OrbStack", "docker-desktop": "Open Docker Desktop", colima: "Start Colima", remote: `Switch to the Docker on ${hereEn()}` }[kind] || "Open Docker";
  return { orbstack: "OrbStack'i aç", "docker-desktop": "Docker Desktop'ı aç", colima: "Colima'yı başlat", remote: `${here("teki", true)} Docker'a dön` }[kind] || "Docker'ı aç";
}
