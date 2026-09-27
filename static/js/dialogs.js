"use strict";

/* =====================================================================
   Pencereler: yeni ekle sihirbazı, silme onayları, taşıma, iş çıktısı,
   sözlük, çalışma setleri, kalıp indirme/inceleme, geri yükleme, ağ bağlama.
   ===================================================================== */

// ---------- Uygulama seçimi (sihirbazlarda ortak) ----------------------------
function appSelectHTML(selected, id = "f-app") {
  const list = apps().filter(isGroupApp);
  const isNew = !selected || !list.some((a) => a.key === selected);
  return html`
    <div class="field">
      <label for="${id}">Hangi ${Tl("app")} içine?</label>
      <select id="${id}">
        <option value="__yeni__" ${isNew ? raw("selected") : ""}>+ Yeni ${Tl("app")} oluştur</option>
        ${list.length ? html`<optgroup label="Var olan uygulamalar">${list.map((a) => html`<option value="${a.key}" ${a.key === selected ? raw("selected") : ""}>${a.name}</option>`)}</optgroup>` : ""}
      </select>
    </div>
    <div class="field" id="${id}-new-wrap" ${isNew ? "" : raw("hidden")}>
      <label for="${id}-new">Yeni uygulamanın adı <span class="req" aria-hidden="true">*</span></label>
      <input id="${id}-new" placeholder="Ör. Blog Sitem" maxlength="60" autocomplete="off">
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

function formError(root, msg) {
  const box = $("#f-err", root);
  if (box) box.innerHTML = String(html`<div class="form-error" role="alert">${icon("alert")}<span>${msg}</span></div>`);
}

// ---------- Yeni ekle sihirbazı ------------------------------------------------
async function openNew(step = "secim", ctx = {}) {
  if (step === "secim") {
    Modal.open({
      title: "Ne eklemek istiyorsun?", sub: "Birini seç, gerisini ben hallederim.", size: "md",
      body: html`<div class="choice-list">
        <button class="choice" data-step="sablonlar">
          <div class="choice-icon">${icon("db")}</div>
          <div><h3>Hazır ${Tl("container")} ${pill("En kolayı", "ok")}</h3><p>Veritabanı, e-posta test kutusu, dosya deposu… Şifreler ve ayarlar otomatik yapılır, bağlantı adresini sana verir.</p></div>
          ${icon("chevronRight", "choice-go")}
        </button>
        <button class="choice" data-step="compose">
          <div class="choice-icon">${icon("folder")}</div>
          <div><h3>Proje klasörüm</h3><p>Projende <b>docker-compose.yml</b> varsa klasörü seç; içindeki her şey tek uygulama olarak kurulur ve başlatılır.</p></div>
          ${icon("chevronRight", "choice-go")}
        </button>
        <button class="choice" data-step="ozel">
          <div class="choice-icon">${icon("layers")}</div>
          <div><h3>Docker Hub'dan ${Tl("image")} ${pill("İleri seviye", "")}</h3><p>Bildiğin bir kalıbın adını yaz (ör. nginx:alpine), kapı ve ayarlarını kendin belirle.</p></div>
          ${icon("chevronRight", "choice-go")}
        </button>
      </div>`,
      onMount(m) { $$("[data-step]", m).forEach((b) => b.addEventListener("click", () => openNew(b.dataset.step, ctx))); },
    });
    return;
  }

  if (step === "sablonlar") {
    if (!S.catalog) {
      try { S.catalog = (await api("/api/katalog")).katalog; } catch (e) { return flash(e.message, true); }
    }
    Modal.open({
      title: `Hazır ${Tl("container")} seç`, sub: "Hangisine ihtiyacın var? Emin değilsen açıklamasını oku.", size: "lg",
      body: html`<div class="tpl-grid">${S.catalog.map((t) => html`
        <button class="tpl" data-tpl="${t.id}">
          <div class="tpl-top">${kindTile(t.kind)}<div><h4>${t.title}</h4><small>${t.tagline}</small></div></div>
          <p>${t.desc}</p>
          <div class="tpl-image mono">${t.image}</div>
        </button>`)}</div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}Geri</button>`,
      onMount(m) {
        $("[data-back]", m).addEventListener("click", () => openNew("secim", ctx));
        $$("[data-tpl]", m).forEach((b) => b.addEventListener("click", () => openNew("sablon", { ...ctx, tpl: b.dataset.tpl })));
      },
    });
    return;
  }

  if (step === "sablon") {
    const t = S.catalog.find((x) => x.id === ctx.tpl);
    Modal.open({
      title: `${t.title} kur`, sub: t.desc, size: "md",
      body: html`<div class="form">
        ${appSelectHTML(ctx.app)}
        <div class="field"><div class="label">Ne olacak?</div>
          <ol class="steps">
            <li><b class="mono">${t.image}</b> kalıbı indirilir (bilgisayarında yoksa, bir kere).</li>
            <li>Uygulamaya <b>${t.role}</b> adında yeni bir parça eklenir ve çalıştırılır.</li>
            ${t.has_password ? html`<li>Güçlü bir şifre otomatik üretilir; bağlantı adresi uygulamanın ayrıntılarında görünür.</li>` : ""}
            <li>${T("port", true)}: ${t.ports.join(" · ")} — boş bir numara otomatik seçilir, sadece bu Mac'ten erişilir.</li>
            ${t.has_data ? html`<li>Veriler ayrı bir veri kutusunda saklanır; parça silinse bile kaybolmaz.</li>` : ""}
          </ol>
        </div>
        <div id="f-err"></div>
      </div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}Geri</button><button class="btn primary" id="f-go">${icon("download")}Kur</button>`,
      onMount(m) {
        const read = bindAppSelect(m);
        $("[data-back]", m).addEventListener("click", () => openNew("sablonlar", ctx));
        $("#f-go", m).addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const r = await api("/api/olustur", { tur: "sablon", sablon: t.id, ...read() });
            Modal.close();
            trackJob(r.is, (job) => { if (job.status === "bitti" && job.app) Router.go(`/uygulama/${encodeURIComponent(job.app)}`); });
          } catch (err) { btn.disabled = false; formError(m, err.message); }
        });
      },
    });
    return;
  }

  if (step === "compose") {
    const mac = S.data?.platform?.mac;
    Modal.open({
      title: "Proje klasöründen kur", sub: "İçinde docker-compose.yml olan proje klasörünü seç.", size: "md",
      body: html`<div class="form">
        <div class="field">
          <label for="c-path">Proje klasörü</label>
          <div class="input-row">
            <input id="c-path" placeholder="/Users/sen/Projelerim/sitem" autocomplete="off" spellcheck="false">
            ${mac ? html`<button class="btn" id="c-pick">${icon("folder")}Seç…</button>` : ""}
          </div>
          <div class="help">${mac ? "“Seç…” ile klasörü bul ya da yolunu buraya yapıştırıp Enter'a bas." : "Klasörün tam yolunu yapıştır."}</div>
        </div>
        <div id="c-result" aria-live="polite"></div>
      </div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}Geri</button><button class="btn primary" id="c-go" disabled>${icon("play")}Kur ve başlat</button>`,
      onMount(m) {
        const input = $("#c-path", m), result = $("#c-result", m), go = $("#c-go", m);
        let info = null;
        const check = async () => {
          const yol = input.value.trim();
          info = null;
          go.disabled = true;
          if (!yol) { result.innerHTML = ""; return; }
          result.innerHTML = String(html`<div class="busy-inline"><span class="spinner"></span>Klasör kontrol ediliyor…</div>`);
          try {
            info = (await api(`/api/compose-bilgi${q({ yol })}`)).bilgi;
            result.innerHTML = String(html`
              <div class="found">
                <div class="found-title">${icon("checkCircle")}<b>${info.file}</b> bulundu · ${info.services.length} parça</div>
                <div class="chips">${info.services.map((s) => html`<span class="chip" title="${s.build ? "Kendi kodun derlenecek" : s.image}">${icon(s.kind)}${s.name} — ${shortRole(s.role)}</span>`)}</div>
              </div>
              ${info.exists ? callout({ level: "info", text: "Bu proje zaten listede. Kurarsan eksik parçalar oluşturulur, değişenler güncellenir ve hepsi başlatılır." }) : ""}
              <div class="row2">
                <div class="field"><label for="c-name">Görünen ad</label><input id="c-name" value="${info.display}" maxlength="80"><div class="help">Kart üzerinde bu yazar.</div></div>
                <div class="field"><label for="c-project">Proje kodu</label><input id="c-project" value="${info.name}" maxlength="40" spellcheck="false"><div class="help">Parça adlarının başına gelir. Bilmiyorsan değiştirme.</div></div>
              </div>
              ${info.services.some((s) => s.build) ? callout({ level: "tip", text: "Bazı parçalar senin kodundan derlenecek; ilk kurulum birkaç dakika sürebilir." }) : ""}`);
            go.disabled = false;
          } catch (e) {
            result.innerHTML = String(html`<div class="form-error" role="alert">${icon("alert")}<span>${e.message}</span></div>`);
          }
        };
        input.addEventListener("change", check);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } });
        $("#c-pick", m)?.addEventListener("click", async () => {
          try { const r = await api("/api/klasor-sec", {}); if (r.yol) { input.value = r.yol; check(); } } catch (e) { flash(e.message, true); }
        });
        $("[data-back]", m).addEventListener("click", () => openNew("secim", ctx));
        go.addEventListener("click", async () => {
          if (!info) return;
          go.disabled = true;
          try {
            const r = await api("/api/olustur", { tur: "compose", yol: input.value.trim(), proje: $("#c-project", m).value.trim(), ad: $("#c-name", m).value.trim() });
            Modal.close();
            trackJob(r.is, (job) => { if (job.status === "bitti" && job.app) Router.go(`/uygulama/${encodeURIComponent(job.app)}`); });
          } catch (e) {
            go.disabled = false;
            result.insertAdjacentHTML("beforeend", String(html`<div class="form-error" role="alert">${icon("alert")}<span>${e.message}</span></div>`));
          }
        });
      },
    });
    return;
  }

  if (step === "ozel") {
    Modal.open({
      title: `Docker Hub'dan ${Tl("image")}`, sub: "hub.docker.com'da bulduğun herhangi bir kalıbı çalıştır.", size: "md",
      body: html`<div class="form">
        <div class="row2">
          <div class="field"><label for="o-image">${T("image")} adı <span class="req" aria-hidden="true">*</span></label><input id="o-image" placeholder="nginx:alpine" value="${ctx.image || ""}" autocomplete="off" spellcheck="false"><div class="help">Docker Hub sayfasındaki ad. Sonundaki :etiket sürümdür.</div></div>
          <div class="field"><label for="o-role">${T("container")} adı</label><input id="o-role" placeholder="web" autocomplete="off" spellcheck="false"><div class="help">İsteğe bağlı. Boşsa kalıptan türetilir.</div></div>
        </div>
        ${appSelectHTML(ctx.app)}
        <div class="row2">
          <div class="field"><label for="o-cport">İç ${Tl("port")}</label><input id="o-cport" inputmode="numeric" placeholder="80"><div class="help">Kalıbın içeride dinlediği numara (Docker Hub sayfasında yazar). Bilmiyorsan boş bırak.</div></div>
          <div class="field"><label for="o-hport">Dış ${Tl("port")}</label><input id="o-hport" inputmode="numeric" placeholder="otomatik"><div class="help">Tarayıcıda localhost:BU_SAYI ile açılır. Boşsa boş bir numara seçilir.</div></div>
        </div>
        <div class="field"><label for="o-env">${T("env")}</label><textarea id="o-env" rows="3" placeholder="AD=değer&#10;BASKA_AYAR=123" spellcheck="false"></textarea><div class="help">Her satıra bir tane, AD=değer biçiminde.</div></div>
        <div class="field"><label for="o-data">Veri klasörü</label><input id="o-data" placeholder="/data" autocomplete="off" spellcheck="false"><div class="help">İsteğe bağlı. Kalıbın verilerini yazdığı iç klasör; doldurursan veriler parça silinse de korunur.</div></div>
        <div id="f-err"></div>
      </div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}Geri</button><button class="btn primary" id="o-go">${icon("play")}Oluştur ve başlat</button>`,
      onMount(m) {
        const read = bindAppSelect(m);
        $("[data-back]", m).addEventListener("click", () => openNew("secim", ctx));
        $("#o-go", m).addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const r = await api("/api/olustur", {
              tur: "ozel", imaj: $("#o-image", m).value, parca: $("#o-role", m).value,
              ic_kapi: $("#o-cport", m).value.trim(), dis_kapi: $("#o-hport", m).value.trim(),
              ayarlar: $("#o-env", m).value, veri: $("#o-data", m).value, ...read(),
            });
            Modal.close();
            trackJob(r.is, (job) => { if (job.status === "bitti" && job.app) Router.go(`/uygulama/${encodeURIComponent(job.app)}`); });
          } catch (err) { btn.disabled = false; formError(m, err.message); }
        });
      },
    });
  }
}

// ---------- Silme onayları ------------------------------------------------------
async function confirmDeleteApp(a) {
  const vols = [...new Set(a.containers.flatMap((c) => c.mounts.filter((m) => m.type === "volume" && !m.anonymous).map((m) => m.name)))];
  const r = await confirmDialog({
    title: `“${a.name}” silinsin mi?`, danger: true, icon: "trash", confirmText: a.total ? "Sil" : "Kaldır",
    text: a.total ? `${a.total} parça durdurulup kaldırılacak.` : "Uygulama listeden kaldırılacak.",
    extra: a.source === "compose" && a.total ? callout({ level: "info", text: "Proje klasörün ve kodların silinmez. İstediğinde “Yeni ekle → Proje klasörüm” ile tekrar kurabilirsin." }) : "",
    checkbox: vols.length ? { label: "Verileri de sil", help: `${vols.length} veri kutusu (veritabanı kayıtları dahil) kalıcı olarak silinir. Geri alınamaz. İşaretlemezsen veriler saklanır.` } : null,
  });
  if (!r) return;
  const job = await runJob("/api/uygulama", { key: a.key, islem: "sil", veriler: r.checked });
  if (job && Router.current?.view === AppView) Router.go("/uygulamalar");
}

async function confirmDeleteContainer(c) {
  const vols = c.mounts.filter((m) => m.type === "volume" && !m.anonymous);
  const r = await confirmDialog({
    title: `${c.role_title} silinsin mi?`, danger: true, icon: "trash", confirmText: "Sil",
    text: `${c.name} parçası durdurulup kaldırılacak.`,
    extra: c.compose ? callout({ level: "info", text: "Bu parça bir Docker Compose projesine ait. Silersen, projeyi tekrar kurana ya da Güncelle'ye basana kadar geri gelmez." }) : "",
    checkbox: vols.length ? { label: "Verilerini de sil", help: `${vols.map((v) => v.name).join(", ")} kalıcı olarak silinir. Geri alınamaz.` } : null,
  });
  if (!r) return;
  const job = await runJob("/api/parca", { id: c.id, islem: "sil", veriler: r.checked });
  if (job && Router.current?.view === ContainerView) history.back();
}

// ---------- Parçayı bir uygulamaya taşı -----------------------------------------
function openMove(c) {
  const current = c.source === "manual" ? apps().find((a) => a.containers.some((x) => x.id === c.id))?.key : null;
  Modal.open({
    title: `${c.name} hangi uygulamaya ait?`, sub: "Aynı projeye ait parçaları tek kartta toplamak için.", size: "sm",
    body: html`<div class="form">${appSelectHTML(current)}<div id="f-err"></div></div>`,
    foot: html`${c.source === "manual" ? html`<button class="btn left" id="mv-free">Tek başına bırak</button>` : ""}
      <button class="btn" data-close>Vazgeç</button><button class="btn primary" id="mv-go">Taşı</button>`,
    onMount(m) {
      const read = bindAppSelect(m);
      const send = async (hedef, yeni_ad = "") => {
        try {
          await api("/api/parca/tasi", { id: c.id, hedef, yeni_ad });
          Modal.close();
          flash("Taşındı");
          refresh();
        } catch (e) { formError(m, e.message); }
      };
      $("#mv-go", m).addEventListener("click", () => { const v = read(); send(v.uygulama, v.yeni_ad); });
      $("#mv-free", m)?.addEventListener("click", () => send(""));
    },
  });
}

// ---------- İş çıktısı -----------------------------------------------------------
async function openJob(id) {
  const load = async () => (await api(`/api/is${q({ id })}`)).is;
  let job;
  try { job = await load(); } catch (e) { return flash(e.message, true); }
  Modal.open({
    title: job.title, sub: job.status === "calisiyor" ? "Sürüyor…" : job.message, size: "lg",
    body: html`
      <div class="toolbar"><button class="btn sm" id="jb-copy">${icon("copy")}Kopyala</button><span class="muted small">Bir sorun varsa bu çıktıyı kopyalayıp paylaşabilirsin.</span></div>
      <pre class="log-view" id="jb-view">${colorLog((job.lines || []).join("\n") || "(çıktı yok)")}</pre>`,
    onMount(m) {
      const view = $("#jb-view", m);
      view.scrollTop = view.scrollHeight;
      $("#jb-copy", m).addEventListener("click", () => copyText(`${job.title}\n${job.message}\n\n${(job.lines || []).join("\n")}`));
      if (job.status !== "calisiyor") return null;
      const timer = setInterval(async () => {
        try {
          job = await load();
          const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 30;
          view.innerHTML = String(colorLog((job.lines || []).join("\n")));
          if (atBottom) view.scrollTop = view.scrollHeight;
          const sub = $(".modal-titles p", m);
          if (sub) sub.textContent = job.status === "calisiyor" ? "Sürüyor…" : job.message;
          if (job.status !== "calisiyor") clearInterval(timer);
        } catch { clearInterval(timer); }
      }, 1000);
      return () => clearInterval(timer);
    },
  });
}

function openJobsList(anchor) {
  const jobs = [...S.jobs.values()].reverse();
  if (!jobs.length) return flash("Şu an süren bir işlem yok.");
  Menu.open(anchor, [
    { header: "İşlemler" },
    ...jobs.slice(0, 8).map((j) => ({
      label: `${j.title} — ${j.status === "calisiyor" ? (j.last || "sürüyor") : j.message}`,
      icon: j.status === "calisiyor" ? "refresh" : j.status === "bitti" ? "checkCircle" : "alert",
      onClick: () => openJob(j.id),
    })),
  ]);
}

// ---------- Sözlük ------------------------------------------------------------------
function openHelp() {
  const items = [
    ["app", "Uygulama", "", "Birlikte çalışan parçaların grubu. Örneğin bir web sitesi: site + veritabanı + e-posta kutusu. Her kart bir uygulama."],
    ["box", "Parça", "konteyner", "Uygulamanın tek bir işi yapan bölümü. Her biri kendi küçük bilgisayarı gibidir; biri veritabanını, biri siteyi çalıştırır."],
    ["layers", "Kalıp", "imaj", "Parçanın tarifi (postgres:17 gibi). Aynı kalıptan istediğin kadar parça üretilir; ilk kullanımda internetten indirilir."],
    ["plug", "Kapı", "port", "Parçaya bilgisayarından ulaşmak için numara. localhost:3000 yazınca 3000 numaralı kapıdaki parçaya gidersin."],
    ["drive", "Veri kutusu", "volume", "Parçanın verilerini sakladığı yer. Parçayı silsen bile veri kutusu durur; silerken ayrıca sorulur."],
    ["network", "Ağ", "network", "Aynı ağdaki parçalar birbirine adıyla ulaşır (ör. db). Parçanın içinde 'localhost' kendisi demektir."],
    ["logs", "Kayıtlar", "log", "Parçanın yazdığı mesajlar. Bir şey çalışmıyorsa sebebi genelde son satırlardadır. 'Teşhis et' sade Türkçeyle açıklar."],
    ["sliders", "Ortam ayarları", "environment variables", "Parçanın içindeki programa verilen ayarlar (şifre, veritabanı adı gibi)."],
    ["folder", "Docker Compose", "docker-compose.yml", "Birden fazla parçayı tek dosyada tarif etme yöntemi. Projende bu dosya varsa 'Yeni ekle → Proje klasörüm' ile tek seferde kurarsın."],
    ["server", "Docker motoru", "OrbStack / Docker Desktop", "Parçaları asıl çalıştıran program. Basic Docker onu yönetir; kapalıysa hiçbir parça çalışmaz."],
  ];
  Modal.open({
    title: "Bu ne demek?", sub: "Docker'daki kelimelerin sade anlamları", size: "md",
    body: html`<div class="glossary">
      ${items.map(([ic, t, alt, d]) => html`<div class="gl">${kindTile(ic)}<div><h4>${t} ${alt ? html`<small>(${alt})</small>` : ""}</h4><p>${d}</p></div></div>`)}
      <div class="gl">${kindTile("checkCircle")}<div><h4>Renkler</h4><p>${badge("ok", "Yeşil")} her şey çalışıyor · ${badge("warn", "Turuncu")} bir kısmı çalışıyor · ${badge("err", "Kırmızı")} sorun var · ${badge("off", "Gri")} kapalı</p></div></div>
    </div>`,
    foot: html`<button class="btn primary" data-close>Anladım</button>`,
  });
}

// ---------- Çalışma setleri ---------------------------------------------------------
function openSetEditor(set = null, preselect = []) {
  const chosen = new Set(set ? set.apps : preselect);
  const list = apps().filter((a) => a.source !== "system");
  Modal.open({
    title: set ? "Seti düzenle" : "Yeni çalışma seti",
    sub: "Birlikte açıp kapattığın uygulamaları gruplandır. Ör. “İş”: müşteri paneli + API + veritabanı.", size: "md",
    body: html`<div class="form">
      <div class="field"><label for="st-name">Set adı <span class="req" aria-hidden="true">*</span></label><input id="st-name" value="${set?.name || ""}" placeholder="Ör. İş, Kişisel projeler" maxlength="60" autocomplete="off"></div>
      <fieldset class="field"><legend class="label">Hangi uygulamalar? <span class="muted small" id="st-count"></span></legend>
        <div class="check-list">${list.map((a) => html`
          <label class="check"><input type="checkbox" value="${a.key}" ${chosen.has(a.key) ? raw("checked") : ""}>
            <span class="check-row">${avatar(a.key, a.name, "xs")}<span>${a.name}</span>${badge(LEVEL_OF_APP[a.state] || "off", a.state_text)}</span></label>`)}
        </div>
      </fieldset>
      <div id="f-err"></div>
    </div>`,
    foot: html`${set ? html`<button class="btn left danger" id="st-del">${icon("trash")}Seti sil</button>` : ""}
      <button class="btn" data-close>Vazgeç</button><button class="btn primary" id="st-save">Kaydet</button>`,
    onMount(m) {
      const count = () => { $("#st-count", m).textContent = `${$$(".check-list input:checked", m).length} seçili`; };
      count();
      m.addEventListener("change", count);
      $("#st-save", m).addEventListener("click", async () => {
        const keys = $$(".check-list input:checked", m).map((i) => i.value);
        try {
          await api("/api/set/kaydet", { id: set?.id || "", ad: $("#st-name", m).value, uygulamalar: keys });
          Modal.close();
          flash("Set kaydedildi");
          refresh();
        } catch (e) { formError(m, e.message); }
      });
      $("#st-del", m)?.addEventListener("click", async () => {
        try { await api("/api/set/sil", { id: set.id }); Modal.close(); flash("Set silindi"); refresh(); } catch (e) { formError(m, e.message); }
      });
    },
  });
}

// ---------- Kalıp indirme ve inceleme -------------------------------------------------
const POPULAR_IMAGES = ["postgres:17-alpine", "mysql:8.4", "redis:7-alpine", "mongo:8", "nginx:alpine", "node:22-alpine", "python:3.13-slim", "alpine:3.20"];

function openPull(ref = "") {
  Modal.open({
    title: `${T("image")} indir`, sub: "Docker Hub'daki (ya da başka bir kayıt defterindeki) bir kalıbı bilgisayarına indir.", size: "sm",
    body: html`<div class="form">
      <div class="field"><label for="pl-ref">${T("image")} adı</label><input id="pl-ref" value="${ref}" placeholder="postgres:17-alpine" autocomplete="off" spellcheck="false">
        <div class="help">Biçim: ad:etiket. Etiket yazmazsan “latest” (en son) indirilir.</div></div>
      <div class="field"><div class="label">Popüler</div><div class="chips">${POPULAR_IMAGES.map((p) => html`<button class="chip" data-pop="${p}">${p}</button>`)}</div></div>
      <div id="f-err"></div>
    </div>`,
    foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="pl-go">${icon("download")}İndir</button>`,
    onMount(m) {
      const input = $("#pl-ref", m);
      m.addEventListener("click", (e) => { const p = e.target.closest("[data-pop]"); if (p) { input.value = p.dataset.pop; input.focus(); } });
      const go = async () => {
        const v = input.value.trim();
        if (!v) return formError(m, "Bir kalıp adı yaz.");
        try { const r = await api("/api/kalip/indir", { ref: v }); Modal.close(); trackJob(r.is); } catch (e) { formError(m, e.message); }
      };
      $("#pl-go", m).addEventListener("click", go);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    },
  });
}

async function openImageDetail(ref) {
  let d;
  try { d = (await api(`/api/kalip/detay${q({ ref })}`)).detay; } catch (e) { return flash(e.message, true); }
  Modal.open({
    title: ref, sub: "Kalıbın içinde neler var?", size: "lg",
    body: html`
      ${kv([
        ["Başlangıç komutu", html`<code>${[...d.entrypoint, ...d.cmd].join(" ") || "—"}</code>`],
        ["Çalışma klasörü", html`<code>${d.workdir || "/"}</code>`],
        ["Dinlediği kapılar", d.ports.length ? html`<span class="mono">${d.ports.join(", ")}</span>` : "—"],
        ["Kalıcı klasörler", d.volumes.length ? html`<span class="mono">${d.volumes.join(", ")}</span>` : "—"],
      ])}
      ${d.env.length ? html`<h3 class="panel-title">Varsayılan ${Tl("env")}</h3><pre class="code small">${d.env.join("\n")}</pre>` : ""}
      <h3 class="panel-title">Katmanlar (${d.layers.length})</h3>
      <p class="muted small">Kalıp üst üste binen katmanlardan oluşur; her satır Dockerfile'daki bir adım.</p>
      <table class="table compact"><thead><tr><th>Adım</th><th class="num">Boyut</th></tr></thead><tbody>
        ${d.layers.map((l) => html`<tr><td class="mono small ellipsis-2" title="${l.cmd}">${l.cmd || "—"}</td><td class="num mono small">${l.size ? fmt.bytes(l.size) : "0"}</td></tr>`)}
      </tbody></table>`,
    foot: html`<button class="btn" id="im-copy">${icon("copy")}Ham bilgiyi kopyala</button><button class="btn primary" data-close>Kapat</button>`,
    onMount(m) { $("#im-copy", m).addEventListener("click", () => copyText(JSON.stringify(d.raw, null, 2))); },
  });
}

// ---------- Geri yükleme ---------------------------------------------------------------
function openRestoreVolume(b, vols, target = "") {
  const list = (vols || []).filter((v) => !v.anonymous);
  const def = target || (list.some((v) => v.name === b.source) ? b.source : "");
  const overwrite = !!target; // üzerine yazma sadece kullanıcı belirli bir kutuyu seçip geldiyse varsayılan olsun
  Modal.open({
    title: "Veri kutusu yedeğini geri yükle", sub: b.file, size: "md",
    body: html`<div class="form">
      <fieldset class="field"><legend class="label">Nereye?</legend>
        <label class="radio-card"><input type="radio" name="rv-mode" value="yeni" ${overwrite ? "" : raw("checked")}>
          <span><b>Yeni bir veri kutusuna</b><small>En güvenlisi. Mevcut verilere dokunulmaz.</small></span></label>
        <label class="radio-card"><input type="radio" name="rv-mode" value="mevcut" ${overwrite ? raw("checked") : ""} ${list.length ? "" : raw("disabled")}>
          <span><b>Var olan bir kutunun üzerine</b><small>Kutudaki dosyalar yedektekilerle değiştirilir.</small></span></label>
      </fieldset>
      <div class="field" id="rv-new"><label for="rv-name">Yeni kutunun adı</label><input id="rv-name" value="${b.source}-geri" spellcheck="false" autocomplete="off"></div>
      <div class="field" id="rv-old" hidden>
        <label for="rv-target">Hedef kutu</label>
        <select id="rv-target">${list.map((v) => html`<option value="${v.name}" ${v.name === def ? raw("selected") : ""}>${v.name}${v.app_name ? ` (${v.app_name})` : ""}</option>`)}</select>
        <label class="check"><input type="checkbox" id="rv-wipe"><span><b>Önce kutuyu boşalt</b><small>Yedekte olmayan dosyalar da silinir; kutu yedekteki haline tam döner.</small></span></label>
        ${callout({ level: "warn", text: "Bu kutuyu kullanan parçaların önce durdurulması gerekir." })}
      </div>
      <div id="f-err"></div>
    </div>`,
    foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="rv-go">${icon("upload")}Geri yükle</button>`,
    onMount(m) {
      const sync = () => {
        const mode = $("input[name=rv-mode]:checked", m).value;
        $("#rv-new", m).hidden = mode !== "yeni";
        $("#rv-old", m).hidden = mode !== "mevcut";
      };
      sync();
      m.addEventListener("change", sync);
      $("#rv-go", m).addEventListener("click", async () => {
        const mode = $("input[name=rv-mode]:checked", m).value;
        const body = mode === "yeni"
          ? { dosya: b.path, hedef: $("#rv-name", m).value.trim(), yeni: true }
          : { dosya: b.path, hedef: $("#rv-target", m).value, yeni: false, temizle: $("#rv-wipe", m).checked };
        try { const r = await api("/api/kutu/geri-yukle", body); Modal.close(); trackJob(r.is); } catch (e) { formError(m, e.message); }
      });
    },
  });
}

function dbEngineOf(image) {
  const i = (image || "").toLowerCase();
  if (/postgres|postgis|timescale/.test(i)) return "postgres";
  if (/mariadb|mysql|percona/.test(i)) return "mysql";
  if (/mongo/.test(i) && !/express/.test(i)) return "mongo";
  return null;
}

const DB_NAMES = { postgres: "PostgreSQL", mysql: "MySQL / MariaDB", mongo: "MongoDB" };

function openRestoreDb(b, preset = null) {
  const kind = b.engine || (b.ext?.includes("archive") ? "mongo" : null);
  const dbs = allContainers().filter((c) => c.kind === "db" && c.running && dbEngineOf(c.image) && (!kind || dbEngineOf(c.image) === kind));
  if (!dbs.length) return flash(`Geri yüklemek için çalışan bir ${kind ? DB_NAMES[kind] + " " : ""}veritabanı parçası gerekiyor.`, true);
  const def = preset?.id || dbs.find((c) => c.name === b.source)?.id || dbs[0].id;
  Modal.open({
    title: "Veritabanı dökümünü geri yükle", sub: b.file, size: "md",
    body: html`<div class="form">
      ${kind ? html`<p class="muted small">Bu bir ${DB_NAMES[kind]} dökümü; sadece ${DB_NAMES[kind]} veritabanları listelenir.</p>` : ""}
      <div class="field"><label for="rd-target">Hangi veritabanına?</label>
        <select id="rd-target">${dbs.map((c) => html`<option value="${c.id}" ${c.id === def ? raw("selected") : ""}>${c.app.name} · ${c.role_title} (${c.name})</option>`)}</select></div>
      ${callout({ level: "warn", title: "Dikkat", text: "Dökümdeki veritabanları ve tablolar, hedefteki aynı adlı olanların yerine yazılır. Uygulamanın diğer parçalarını (site, API) önce durdurman önerilir; bağlı kalanlar işlemi engelleyebilir." })}
      ${callout({ level: "tip", text: "Emin değilsen önce hedef veritabanının dökümünü al; bir şey ters giderse geri dönebilirsin." })}
      <div id="f-err"></div>
    </div>`,
    foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn danger-solid" id="rd-go">${icon("upload")}Geri yükle</button>`,
    onMount(m) {
      $("#rd-go", m).addEventListener("click", async () => {
        try { const r = await api("/api/db/geri-yukle", { id: $("#rd-target", m).value, dosya: b.path }); Modal.close(); trackJob(r.is); } catch (e) { formError(m, e.message); }
      });
    },
  });
}

async function openRestoreDbPicker(c) {
  let list;
  try { list = (await api("/api/yedekler")).backups.filter((b) => b.kind === "db"); } catch (e) { return flash(e.message, true); }
  const eng = dbEngineOf(c.image);
  list = list.filter((b) => (b.engine ? b.engine === eng : (eng === "mongo") === (b.ext || "").includes("archive")));
  if (!list.length) return flash("Bu veritabanı için döküm bulunamadı. Önce “Veritabanı dökümü al”ı kullan.", true);
  Modal.open({
    title: "Hangi döküm geri yüklensin?", sub: `${c.role_title} · ${c.name}`, size: "md",
    body: html`<div class="pick-list">${list.map((b, i) => html`
      <label class="radio-card"><input type="radio" name="rp" value="${i}" ${i === 0 ? raw("checked") : ""}>
        <span><b class="mono">${b.source}</b><small>${fmt.date(b.mtime)} · ${fmt.bytes(b.size)}</small></span></label>`)}</div>`,
    foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="rp-go">Devam</button>`,
    onMount(m) {
      $("#rp-go", m).addEventListener("click", () => openRestoreDb(list[+$("input[name=rp]:checked", m).value], c));
    },
  });
}

// ---------- Yeniden başlama kuralı ---------------------------------------------------
async function openRestartPolicy(c) {
  const opts = {
    no: ["Hiçbir zaman", "Sen başlatmadıkça kapalı kalır. Mac açılınca da başlamaz."],
    "on-failure": ["Sadece hata verip kapanırsa", "Çökerse Docker tekrar dener; sen durdurursan kapalı kalır."],
    "unless-stopped": ["Her zaman (sen durdurmadıysan)", "Docker/Mac açılınca kendiliğinden başlar. Sen durdurduysan kapalı kalır. Çoğu durumda en iyisi."],
    always: ["Her zaman", "Ne olursa olsun tekrar başlatılır."],
  };
  Modal.open({
    title: "Yeniden başlama kuralı", sub: `${c.role_title} · ${c.name}`, size: "sm",
    body: html`<div class="pick-list">${Object.entries(opts).map(([k, [t, d]]) => html`
      <label class="radio-card"><input type="radio" name="rp" value="${k}" ${k === c.restart_policy ? raw("checked") : ""}><span><b>${t}</b><small>${d}</small></span></label>`)}
      <div id="f-err"></div></div>`,
    foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="rp-go">Kaydet</button>`,
    onMount(m) {
      $("#rp-go", m).addEventListener("click", async () => {
        try {
          await api("/api/parca/politika", { id: c.id, politika: $("input[name=rp]:checked", m).value });
          Modal.close();
          flash("Kaydedildi");
          refresh();
        } catch (e) { formError(m, e.message); }
      });
    },
  });
}

// ---------- Ağ bağlama ------------------------------------------------------------------
function openConnectNetwork(net, after) {
  const members = new Set(net.containers.map((m) => m.name));
  const list = allContainers().filter((c) => !members.has(c.name) && c.app.source !== "system");
  if (!list.length) return flash("Bağlanacak başka parça yok.");
  Modal.open({
    title: `${net.name} ağına parça bağla`, sub: "Bağladığın parça, bu ağdaki diğer parçalara adıyla ulaşabilir.", size: "sm",
    body: html`<div class="form"><div class="field"><label for="cn-c">${T("container")}</label>
      <select id="cn-c">${list.map((c) => html`<option value="${c.name}">${c.app.source === "single" ? "" : c.app.name + " · "}${c.role_title} (${c.name})</option>`)}</select></div><div id="f-err"></div></div>`,
    foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="cn-go">${icon("link")}Bağla</button>`,
    onMount(m) {
      $("#cn-go", m).addEventListener("click", async () => {
        try { await api("/api/ag/bagla", { ag: net.name, parca: $("#cn-c", m).value, bagla: true }); Modal.close(); flash("Bağlandı"); after?.(); } catch (e) { formError(m, e.message); }
      });
    },
  });
}

async function openConnectToNetwork(c) {
  let nets;
  try { nets = (await api("/api/aglar")).aglar; } catch (e) { return flash(e.message, true); }
  const list = nets.filter((n) => !["host", "none"].includes(n.name) && !n.containers.some((m) => m.name === c.name));
  if (!list.length) return flash("Bağlanabilecek başka ağ yok.");
  Modal.open({
    title: `${c.role_title} başka bir ağa bağlansın`, sub: "Farklı bir uygulamadaki parçayla konuşması gerekiyorsa işine yarar.", size: "sm",
    body: html`<div class="form"><div class="field"><label for="cn-n">${T("network")}</label>
      <select id="cn-n">${list.map((n) => html`<option value="${n.name}">${n.name}${n.app_name ? ` (${n.app_name})` : ""}</option>`)}</select></div><div id="f-err"></div></div>`,
    foot: html`<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="cn-go">${icon("link")}Bağla</button>`,
    onMount(m) {
      $("#cn-go", m).addEventListener("click", async () => {
        try {
          await api("/api/ag/bagla", { ag: $("#cn-n", m).value, parca: c.name, bagla: true });
          Modal.close();
          flash("Bağlandı");
          if (Router.current?.view === ContainerView) ContainerView.loadDetail();
        } catch (e) { formError(m, e.message); }
      });
    },
  });
}
