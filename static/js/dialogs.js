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
      <label for="${id}">${L(`Hangi ${Tl("app")} içine?`, "Which app?")}</label>
      <select id="${id}">
        <option value="__yeni__" ${isNew ? raw("selected") : ""}>+ ${L(`Yeni ${Tl("app")} oluştur`, "Create a new app")}</option>
        ${list.length ? html`<optgroup label="${L("Var olan uygulamalar", "Existing apps")}">${list.map((a) => html`<option value="${a.key}" ${a.key === selected ? raw("selected") : ""}>${a.name}</option>`)}</optgroup>` : ""}
      </select>
    </div>
    <div class="field" id="${id}-new-wrap" ${isNew ? "" : raw("hidden")}>
      <label for="${id}-new">${L("Yeni uygulamanın adı", "New app name")} <span class="req" aria-hidden="true">*</span></label>
      <input id="${id}-new" placeholder="${L("Ör. Blog Sitem", "e.g. My Blog")}" maxlength="60" autocomplete="off">
      <div class="help">${L("Kart üzerinde bu ad görünecek.", "This name is shown on the card.")}</div>
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
      title: L("Ne eklemek istiyorsun?", "What do you want to add?"), sub: L("Birini seç, gerisini ben hallederim.", "Pick one and I'll handle the rest."), size: "md",
      body: html`<div class="choice-list">
        <button class="choice" data-step="sablonlar">
          <div class="choice-icon">${icon("db")}</div>
          <div><h3>${L(`Hazır ${Tl("container")}`, "Ready-made container")} ${pill(L("En kolayı", "Easiest"), "ok")}</h3><p>${L("Veritabanı, e-posta test kutusu, dosya deposu… Şifreler ve ayarlar otomatik yapılır, bağlantı adresini sana verir.", "Database, test mailbox, file storage… Passwords and settings are done for you, and you get the connection URL.")}</p></div>
          ${icon("chevronRight", "choice-go")}
        </button>
        <button class="choice" data-step="compose">
          <div class="choice-icon">${icon("folder")}</div>
          <div><h3>${L("Proje klasörüm", "My project folder")}</h3><p>${isEN() ? html`If your project has a <b>docker-compose.yml</b>, pick the folder; everything in it is set up and started as one app.` : html`Projende <b>docker-compose.yml</b> varsa klasörü seç; içindeki her şey tek uygulama olarak kurulur ve başlatılır.`}</p></div>
          ${icon("chevronRight", "choice-go")}
        </button>
        <button class="choice" data-step="ozel">
          <div class="choice-icon">${icon("layers")}</div>
          <div><h3>${L(`Docker Hub'dan ${Tl("image")}`, "Image from Docker Hub")} ${pill(L("İleri seviye", "Advanced"), "")}</h3><p>${L("Bildiğin bir kalıbın adını yaz (ör. nginx:alpine), kapı ve ayarlarını kendin belirle.", "Type the name of an image you know (e.g. nginx:alpine) and set its ports and settings yourself.")}</p></div>
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
      title: L(`Hazır ${Tl("container")} seç`, "Pick a ready-made container"), sub: L("Hangisine ihtiyacın var? Emin değilsen açıklamasını oku.", "Which one do you need? If you're not sure, read the description."), size: "lg",
      body: html`<div class="tpl-grid">${S.catalog.map((t) => html`
        <button class="tpl" data-tpl="${t.id}">
          <div class="tpl-top">${kindTile(t.kind)}<div><h4>${t.title}</h4><small>${t.tagline}</small></div></div>
          <p>${t.desc}</p>
          <div class="tpl-image mono">${t.image}</div>
        </button>`)}</div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}${L("Geri", "Back")}</button>`,
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
      title: L(`${t.title} kur`, `Set up ${t.title}`), sub: t.desc, size: "md",
      body: html`<div class="form">
        ${appSelectHTML(ctx.app)}
        <div class="field"><div class="label">${L("Ne olacak?", "What happens?")}</div>
          <ol class="steps">${isEN() ? html`
            <li>The <b class="mono">${t.image}</b> image is pulled (once, if you don't have it yet).</li>
            <li>A new container named <b>${t.role}</b> is added to the app and started.</li>
            ${t.has_password ? html`<li>A strong password is generated; the connection URL shows up in the app's details.</li>` : ""}
            <li>${T("port", true)}: ${t.ports.join(" · ")} — a free number is picked automatically, reachable only from this Mac.</li>
            ${t.has_data ? html`<li>Data is kept in a separate volume, so it survives even if the container is deleted.</li>` : ""}` : html`
            <li><b class="mono">${t.image}</b> kalıbı indirilir (bilgisayarında yoksa, bir kere).</li>
            <li>Uygulamaya <b>${t.role}</b> adında yeni bir parça eklenir ve çalıştırılır.</li>
            ${t.has_password ? html`<li>Güçlü bir şifre otomatik üretilir; bağlantı adresi uygulamanın ayrıntılarında görünür.</li>` : ""}
            <li>${T("port", true)}: ${t.ports.join(" · ")} — boş bir numara otomatik seçilir, sadece bu Mac'ten erişilir.</li>
            ${t.has_data ? html`<li>Veriler ayrı bir veri kutusunda saklanır; parça silinse bile kaybolmaz.</li>` : ""}`}
          </ol>
        </div>
        <div id="f-err"></div>
      </div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}${L("Geri", "Back")}</button><button class="btn primary" id="f-go">${icon("download")}${L("Kur", "Set up")}</button>`,
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
      title: L("Proje klasöründen kur", "Set up from a project folder"), sub: L("İçinde docker-compose.yml olan proje klasörünü seç.", "Pick a project folder that contains a docker-compose.yml."), size: "md",
      body: html`<div class="form">
        <div class="field">
          <label for="c-path">${L("Proje klasörü", "Project folder")}</label>
          <div class="input-row">
            <input id="c-path" placeholder="${L("/Users/sen/Projelerim/sitem", "/Users/you/Projects/my-site")}" autocomplete="off" spellcheck="false">
            ${mac ? html`<button class="btn" id="c-pick">${icon("folder")}${L("Seç…", "Choose…")}</button>` : ""}
          </div>
          <div class="help">${mac ? L("“Seç…” ile klasörü bul ya da yolunu buraya yapıştırıp Enter'a bas.", "Find the folder with “Choose…” or paste its path here and press Enter.") : L("Klasörün tam yolunu yapıştır.", "Paste the full path of the folder.")}</div>
        </div>
        ${S.data?.platform?.remote ? callout({ level: "warn", text: L(`Uzak Docker'a (${S.data.platform.remote.host}) kurulacak. Compose dosyası buradan okunur ama klasör bağlamaları (./klasor:/app gibi) sunucuda aynı yolu arar.`,
          `This will be set up on the remote Docker (${S.data.platform.remote.host}). The compose file is read from here, but folder mounts (like ./folder:/app) look for the same path on the server.`) }) : ""}
        <div id="c-result" aria-live="polite"></div>
      </div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}${L("Geri", "Back")}</button><button class="btn primary" id="c-go" disabled>${icon("play")}${L("Kur ve başlat", "Set up and start")}</button>`,
      onMount(m) {
        const input = $("#c-path", m), result = $("#c-result", m), go = $("#c-go", m);
        let info = null;
        const check = async () => {
          const yol = input.value.trim();
          info = null;
          go.disabled = true;
          if (!yol) { result.innerHTML = ""; return; }
          result.innerHTML = String(html`<div class="busy-inline"><span class="spinner"></span>${L("Klasör kontrol ediliyor…", "Checking the folder…")}</div>`);
          try {
            info = (await api(`/api/compose-bilgi${q({ yol })}`)).bilgi;
            result.innerHTML = String(html`
              <div class="found">
                <div class="found-title">${icon("checkCircle")}${L(html`<b>${info.file}</b> bulundu · ${info.services.length} parça`, html`Found <b>${info.file}</b> · ${plural(info.services.length, "container")}`)}</div>
                <div class="chips">${info.services.map((s) => html`<span class="chip" title="${s.build ? L("Kendi kodun derlenecek", "Built from your code") : s.image}">${icon(s.kind)}${s.name} — ${shortRole(s.role)}</span>`)}</div>
              </div>
              ${info.exists ? callout({ level: "info", text: L("Bu proje zaten listede. Kurarsan eksik parçalar oluşturulur, değişenler güncellenir ve hepsi başlatılır.", "This project is already listed. Setting it up creates missing containers, updates changed ones and starts them all.") }) : ""}
              <div class="row2">
                <div class="field"><label for="c-name">${L("Görünen ad", "Display name")}</label><input id="c-name" value="${info.display}" maxlength="80"><div class="help">${L("Kart üzerinde bu yazar.", "Shown on the card.")}</div></div>
                <div class="field"><label for="c-project">${L("Proje kodu", "Project name")}</label><input id="c-project" value="${info.name}" maxlength="40" spellcheck="false"><div class="help">${L("Parça adlarının başına gelir. Bilmiyorsan değiştirme.", "Prefixed to container names. Leave it if you're not sure.")}</div></div>
              </div>
              ${info.services.some((s) => s.build) ? callout({ level: "tip", text: L("Bazı parçalar senin kodundan derlenecek; ilk kurulum birkaç dakika sürebilir.", "Some containers are built from your code; the first setup can take a few minutes.") }) : ""}`);
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
      title: L(`Docker Hub'dan ${Tl("image")}`, "Image from Docker Hub"), sub: L("hub.docker.com'da bulduğun herhangi bir kalıbı çalıştır.", "Run any image you found on hub.docker.com."), size: "md",
      body: html`<div class="form">
        <div class="row2">
          <div class="field"><label for="o-image">${L(`${T("image")} adı`, "Image name")} <span class="req" aria-hidden="true">*</span></label><input id="o-image" placeholder="nginx:alpine" value="${ctx.image || ""}" autocomplete="off" spellcheck="false"><div class="help">${L("Docker Hub sayfasındaki ad. Sonundaki :etiket sürümdür.", "The name on its Docker Hub page. The :tag at the end is the version.")}</div></div>
          <div class="field"><label for="o-role">${L(`${T("container")} adı`, "Container name")}</label><input id="o-role" placeholder="web" autocomplete="off" spellcheck="false"><div class="help">${L("İsteğe bağlı. Boşsa kalıptan türetilir.", "Optional. Derived from the image if empty.")}</div></div>
        </div>
        ${appSelectHTML(ctx.app)}
        <div class="row2">
          <div class="field"><label for="o-cport">${L(`İç ${Tl("port")}`, "Container port")}</label><input id="o-cport" inputmode="numeric" placeholder="80"><div class="help">${L("Kalıbın içeride dinlediği numara (Docker Hub sayfasında yazar). Bilmiyorsan boş bırak.", "The port the image listens on inside (see its Docker Hub page). Leave empty if you don't know.")}</div></div>
          <div class="field"><label for="o-hport">${L(`Dış ${Tl("port")}`, "Host port")}</label><input id="o-hport" inputmode="numeric" placeholder="${L("otomatik", "automatic")}"><div class="help">${L("Tarayıcıda localhost:BU_SAYI ile açılır. Boşsa boş bir numara seçilir.", "Opens in the browser as localhost:THIS_NUMBER. A free one is picked if empty.")}</div></div>
        </div>
        <div class="field"><label for="o-env">${T("env")}</label><textarea id="o-env" rows="3" placeholder="${L("AD=değer", "NAME=value")}&#10;${L("BASKA_AYAR", "OTHER_SETTING")}=123" spellcheck="false"></textarea><div class="help">${L("Her satıra bir tane, AD=değer biçiminde.", "One per line, as NAME=value.")}</div></div>
        <div class="field"><label for="o-data">${L("Veri klasörü", "Data folder")}</label><input id="o-data" placeholder="/data" autocomplete="off" spellcheck="false"><div class="help">${L("İsteğe bağlı. Kalıbın verilerini yazdığı iç klasör; doldurursan veriler parça silinse de korunur.", "Optional. The folder inside where the image writes its data; if set, the data survives even if the container is deleted.")}</div></div>
        <div id="f-err"></div>
      </div>`,
      foot: html`<button class="btn left" data-back>${icon("chevronLeft")}${L("Geri", "Back")}</button><button class="btn primary" id="o-go">${icon("play")}${L("Oluştur ve başlat", "Create and start")}</button>`,
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
    title: L(`“${a.name}” silinsin mi?`, `Delete “${a.name}”?`), danger: true, icon: "trash", confirmText: a.total ? L("Sil", "Delete") : L("Kaldır", "Remove"),
    text: a.total ? L(`${a.total} parça durdurulup kaldırılacak.`, `${plural(a.total, "container")} will be stopped and removed.`) : L("Uygulama listeden kaldırılacak.", "The app will be removed from the list."),
    extra: a.source === "compose" && a.total ? callout({ level: "info", text: L("Proje klasörün ve kodların silinmez. İstediğinde “Yeni ekle → Proje klasörüm” ile tekrar kurabilirsin.", "Your project folder and code are not deleted. You can set it up again any time with “Add new → My project folder”.") }) : "",
    checkbox: vols.length ? { label: L("Verileri de sil", "Delete the data too"), help: L(`${vols.length} veri kutusu (veritabanı kayıtları dahil) kalıcı olarak silinir. Geri alınamaz. İşaretlemezsen veriler saklanır.`, `${plural(vols.length, "volume")} (including database records) will be deleted permanently. This cannot be undone. Leave unchecked to keep the data.`) } : null,
  });
  if (!r) return;
  const job = await runJob("/api/uygulama", { key: a.key, islem: "sil", veriler: r.checked });
  if (job && Router.current?.view === AppView) Router.go("/uygulamalar");
}

async function confirmDeleteContainer(c) {
  const vols = c.mounts.filter((m) => m.type === "volume" && !m.anonymous);
  const r = await confirmDialog({
    title: L(`${c.role_title} silinsin mi?`, `Delete ${c.role_title}?`), danger: true, icon: "trash", confirmText: L("Sil", "Delete"),
    text: L(`${c.name} parçası durdurulup kaldırılacak.`, `Container ${c.name} will be stopped and removed.`),
    extra: c.compose ? callout({ level: "info", text: L("Bu parça bir Docker Compose projesine ait. Silersen, projeyi tekrar kurana ya da Güncelle'ye basana kadar geri gelmez.", "This container belongs to a Docker Compose project. If you delete it, it won't come back until you set the project up again or press Update.") }) : "",
    checkbox: vols.length ? { label: L("Verilerini de sil", "Delete its data too"), help: L(`${vols.map((v) => v.name).join(", ")} kalıcı olarak silinir. Geri alınamaz.`, `${vols.map((v) => v.name).join(", ")} will be deleted permanently. This cannot be undone.`) } : null,
  });
  if (!r) return;
  const job = await runJob("/api/parca", { id: c.id, islem: "sil", veriler: r.checked });
  if (job && Router.current?.view === ContainerView) history.back();
}

// ---------- Parçayı bir uygulamaya taşı -----------------------------------------
function openMove(c) {
  const current = c.source === "manual" ? apps().find((a) => a.containers.some((x) => x.id === c.id))?.key : null;
  Modal.open({
    title: L(`${c.name} hangi uygulamaya ait?`, `Which app does ${c.name} belong to?`), sub: L("Aynı projeye ait parçaları tek kartta toplamak için.", "Groups containers of the same project on one card."), size: "sm",
    body: html`<div class="form">${appSelectHTML(current)}<div id="f-err"></div></div>`,
    foot: html`${c.source === "manual" ? html`<button class="btn left" id="mv-free">${L("Tek başına bırak", "Leave on its own")}</button>` : ""}
      <button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="mv-go">${L("Taşı", "Move")}</button>`,
    onMount(m) {
      const read = bindAppSelect(m);
      const send = async (hedef, yeni_ad = "") => {
        try {
          await api("/api/parca/tasi", { id: c.id, hedef, yeni_ad });
          Modal.close();
          flash(L("Taşındı", "Moved"));
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
    title: job.title, sub: job.status === "calisiyor" ? L("Sürüyor…", "Running…") : job.message, size: "lg",
    body: html`
      <div class="toolbar"><button class="btn sm" id="jb-copy">${icon("copy")}${L("Kopyala", "Copy")}</button><span class="muted small">${L("Bir sorun varsa bu çıktıyı kopyalayıp paylaşabilirsin.", "If something went wrong, copy this output and share it.")}</span></div>
      <pre class="log-view" id="jb-view">${colorLog((job.lines || []).join("\n") || L("(çıktı yok)", "(no output)"))}</pre>`,
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
          if (sub) sub.textContent = job.status === "calisiyor" ? L("Sürüyor…", "Running…") : job.message;
          if (job.status !== "calisiyor") clearInterval(timer);
        } catch { clearInterval(timer); }
      }, 1000);
      return () => clearInterval(timer);
    },
  });
}

function openJobsList(anchor) {
  const jobs = [...S.jobs.values()].reverse();
  if (!jobs.length) return flash(L("Şu an süren bir işlem yok.", "No tasks are running right now."));
  Menu.open(anchor, [
    { header: L("İşlemler", "Tasks") },
    ...jobs.slice(0, 8).map((j) => ({
      label: `${j.title} — ${j.status === "calisiyor" ? (j.last || L("sürüyor", "running")) : j.message}`,
      icon: j.status === "calisiyor" ? "refresh" : j.status === "bitti" ? "checkCircle" : "alert",
      onClick: () => openJob(j.id),
    })),
  ]);
}

// ---------- Sözlük ------------------------------------------------------------------
function openHelp() {
  const items = isEN() ? [
    ["app", "App", "", "A group of containers that work together. For example a website: site + database + mailbox. Each card is an app."],
    ["box", "Container", "", "The part of an app that does one job. Each is like its own small computer; one runs the database, another the site."],
    ["layers", "Image", "", "The recipe for a container (like postgres:17). You can make as many containers from one image as you like; it's downloaded on first use."],
    ["plug", "Port", "", "The number you use to reach a container from your computer. Typing localhost:3000 takes you to the container on port 3000."],
    ["drive", "Volume", "", "Where a container keeps its data. The volume stays even if you delete the container; you're asked separately when deleting."],
    ["network", "Network", "", "Containers on the same network reach each other by name (e.g. db). Inside a container, 'localhost' means the container itself."],
    ["logs", "Logs", "", "The messages a container writes. If something doesn't work, the reason is usually in the last lines. 'Diagnose' explains it in plain words."],
    ["sliders", "Environment variables", "env", "Settings passed to the program inside the container (password, database name and so on)."],
    ["folder", "Docker Compose", "docker-compose.yml", "A way to describe several containers in one file. If your project has this file, set it all up at once with 'Add new → My project folder'."],
    ["server", "Docker engine", "OrbStack / Docker Desktop", "The program that actually runs the containers. Basic Docker manages it; if it's stopped, no container runs."],
  ] : [
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
    title: L("Bu ne demek?", "What does this mean?"), sub: L("Docker'daki kelimelerin sade anlamları", "Docker words in plain language"), size: "md",
    body: html`<div class="glossary">
      ${items.map(([ic, t, alt, d]) => html`<div class="gl">${kindTile(ic)}<div><h4>${t} ${alt ? html`<small>(${alt})</small>` : ""}</h4><p>${d}</p></div></div>`)}
      <div class="gl">${kindTile("checkCircle")}<div><h4>${L("Renkler", "Colors")}</h4><p>${badge("ok", L("Yeşil", "Green"))} ${L("her şey çalışıyor", "everything is running")} · ${badge("warn", L("Turuncu", "Orange"))} ${L("bir kısmı çalışıyor", "some are running")} · ${badge("err", L("Kırmızı", "Red"))} ${L("sorun var", "there's a problem")} · ${badge("off", L("Gri", "Gray"))} ${L("kapalı", "stopped")}</p></div></div>
    </div>`,
    foot: html`<button class="btn primary" data-close>${L("Anladım", "Got it")}</button>`,
  });
}

// ---------- Çalışma setleri ---------------------------------------------------------
function openSetEditor(set = null, preselect = []) {
  const chosen = new Set(set ? set.apps : preselect);
  const list = apps().filter((a) => a.source !== "system");
  Modal.open({
    title: set ? L("Seti düzenle", "Edit set") : L("Yeni çalışma seti", "New work set"),
    sub: L("Birlikte açıp kapattığın uygulamaları gruplandır. Ör. “İş”: müşteri paneli + API + veritabanı.", "Group apps you start and stop together. E.g. “Work”: customer panel + API + database."), size: "md",
    body: html`<div class="form">
      <div class="field"><label for="st-name">${L("Set adı", "Set name")} <span class="req" aria-hidden="true">*</span></label><input id="st-name" value="${set?.name || ""}" placeholder="${L("Ör. İş, Kişisel projeler", "e.g. Work, Side projects")}" maxlength="60" autocomplete="off"></div>
      <fieldset class="field"><legend class="label">${L("Hangi uygulamalar?", "Which apps?")} <span class="muted small" id="st-count"></span></legend>
        <div class="check-list">${list.map((a) => html`
          <label class="check"><input type="checkbox" value="${a.key}" ${chosen.has(a.key) ? raw("checked") : ""}>
            <span class="check-row">${avatar(a.key, a.name, "xs")}<span>${a.name}</span>${badge(LEVEL_OF_APP[a.state] || "off", a.state_text)}</span></label>`)}
        </div>
      </fieldset>
      <div id="f-err"></div>
    </div>`,
    foot: html`${set ? html`<button class="btn left danger" id="st-del">${icon("trash")}${L("Seti sil", "Delete set")}</button>` : ""}
      <button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="st-save">${L("Kaydet", "Save")}</button>`,
    onMount(m) {
      const count = () => { $("#st-count", m).textContent = `${$$(".check-list input:checked", m).length} ${L("seçili", "selected")}`; };
      count();
      m.addEventListener("change", count);
      $("#st-save", m).addEventListener("click", async () => {
        const keys = $$(".check-list input:checked", m).map((i) => i.value);
        try {
          await api("/api/set/kaydet", { id: set?.id || "", ad: $("#st-name", m).value, uygulamalar: keys });
          Modal.close();
          flash(L("Set kaydedildi", "Set saved"));
          refresh();
        } catch (e) { formError(m, e.message); }
      });
      $("#st-del", m)?.addEventListener("click", async () => {
        try { await api("/api/set/sil", { id: set.id }); Modal.close(); flash(L("Set silindi", "Set deleted")); refresh(); } catch (e) { formError(m, e.message); }
      });
    },
  });
}

// ---------- Kalıp indirme ve inceleme -------------------------------------------------
const POPULAR_IMAGES = ["postgres:17-alpine", "mysql:8.4", "redis:7-alpine", "mongo:8", "nginx:alpine", "node:22-alpine", "python:3.13-slim", "alpine:3.20"];

function openPull(ref = "") {
  Modal.open({
    title: L(`${T("image")} indir`, "Pull an image"), sub: L("Docker Hub'daki (ya da başka bir kayıt defterindeki) bir kalıbı bilgisayarına indir.", "Download an image from Docker Hub (or another registry) to your computer."), size: "sm",
    body: html`<div class="form">
      <div class="field"><label for="pl-ref">${L(`${T("image")} adı`, "Image name")}</label><input id="pl-ref" value="${ref}" placeholder="postgres:17-alpine" autocomplete="off" spellcheck="false">
        <div class="help">${L("Biçim: ad:etiket. Etiket yazmazsan “latest” (en son) indirilir.", "Format: name:tag. Without a tag, “latest” is pulled.")}</div></div>
      <div class="field"><div class="label">${L("Popüler", "Popular")}</div><div class="chips">${POPULAR_IMAGES.map((p) => html`<button class="chip" data-pop="${p}">${p}</button>`)}</div></div>
      <div id="f-err"></div>
    </div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="pl-go">${icon("download")}${L("İndir", "Pull")}</button>`,
    onMount(m) {
      const input = $("#pl-ref", m);
      m.addEventListener("click", (e) => { const p = e.target.closest("[data-pop]"); if (p) { input.value = p.dataset.pop; input.focus(); } });
      const go = async () => {
        const v = input.value.trim();
        if (!v) return formError(m, L("Bir kalıp adı yaz.", "Type an image name."));
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
    title: ref, sub: L("Kalıbın içinde neler var?", "What's inside the image?"), size: "lg",
    body: html`
      ${kv([
        [L("Başlangıç komutu", "Start command"), html`<code>${[...d.entrypoint, ...d.cmd].join(" ") || "—"}</code>`],
        [L("Çalışma klasörü", "Working directory"), html`<code>${d.workdir || "/"}</code>`],
        [L("Dinlediği kapılar", "Exposed ports"), d.ports.length ? html`<span class="mono">${d.ports.join(", ")}</span>` : "—"],
        [L("Kalıcı klasörler", "Volumes"), d.volumes.length ? html`<span class="mono">${d.volumes.join(", ")}</span>` : "—"],
      ])}
      ${d.env.length ? html`<h3 class="panel-title">${L(`Varsayılan ${Tl("env")}`, "Default environment variables")}</h3><pre class="code small">${d.env.join("\n")}</pre>` : ""}
      <h3 class="panel-title">${L("Katmanlar", "Layers")} (${d.layers.length})</h3>
      <p class="muted small">${L("Kalıp üst üste binen katmanlardan oluşur; her satır Dockerfile'daki bir adım.", "An image is made of stacked layers; each row is one step in the Dockerfile.")}</p>
      <table class="table compact"><thead><tr><th>${L("Adım", "Step")}</th><th class="num">${L("Boyut", "Size")}</th></tr></thead><tbody>
        ${d.layers.map((l) => html`<tr><td class="mono small ellipsis-2" title="${l.cmd}">${l.cmd || "—"}</td><td class="num mono small">${l.size ? fmt.bytes(l.size) : "0"}</td></tr>`)}
      </tbody></table>`,
    foot: html`<button class="btn" id="im-copy">${icon("copy")}${L("Ham bilgiyi kopyala", "Copy raw JSON")}</button><button class="btn primary" data-close>${L("Kapat", "Close")}</button>`,
    onMount(m) { $("#im-copy", m).addEventListener("click", () => copyText(JSON.stringify(d.raw, null, 2))); },
  });
}

// ---------- Geri yükleme ---------------------------------------------------------------
function openRestoreVolume(b, vols, target = "") {
  const list = (vols || []).filter((v) => !v.anonymous);
  const def = target || (list.some((v) => v.name === b.source) ? b.source : "");
  const overwrite = !!target; // üzerine yazma sadece kullanıcı belirli bir kutuyu seçip geldiyse varsayılan olsun
  Modal.open({
    title: L("Veri kutusu yedeğini geri yükle", "Restore a volume backup"), sub: b.file, size: "md",
    body: html`<div class="form">
      <fieldset class="field"><legend class="label">${L("Nereye?", "Where to?")}</legend>
        <label class="radio-card"><input type="radio" name="rv-mode" value="yeni" ${overwrite ? "" : raw("checked")}>
          <span><b>${L("Yeni bir veri kutusuna", "Into a new volume")}</b><small>${L("En güvenlisi. Mevcut verilere dokunulmaz.", "The safest. Existing data is not touched.")}</small></span></label>
        <label class="radio-card"><input type="radio" name="rv-mode" value="mevcut" ${overwrite ? raw("checked") : ""} ${list.length ? "" : raw("disabled")}>
          <span><b>${L("Var olan bir kutunun üzerine", "Over an existing volume")}</b><small>${L("Kutudaki dosyalar yedektekilerle değiştirilir.", "Files in the volume are replaced by the ones in the backup.")}</small></span></label>
      </fieldset>
      <div class="field" id="rv-new"><label for="rv-name">${L("Yeni kutunun adı", "New volume name")}</label><input id="rv-name" value="${b.source}-${L("geri", "restored")}" spellcheck="false" autocomplete="off"></div>
      <div class="field" id="rv-old" hidden>
        <label for="rv-target">${L("Hedef kutu", "Target volume")}</label>
        <select id="rv-target">${list.map((v) => html`<option value="${v.name}" ${v.name === def ? raw("selected") : ""}>${v.name}${v.app_name ? ` (${v.app_name})` : ""}</option>`)}</select>
        <label class="check"><input type="checkbox" id="rv-wipe"><span><b>${L("Önce kutuyu boşalt", "Empty the volume first")}</b><small>${L("Yedekte olmayan dosyalar da silinir; kutu yedekteki haline tam döner.", "Files not in the backup are deleted too; the volume goes back exactly to the backup.")}</small></span></label>
        ${callout({ level: "warn", text: L("Bu kutuyu kullanan parçaların önce durdurulması gerekir.", "Containers using this volume must be stopped first.") })}
      </div>
      <div id="f-err"></div>
    </div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="rv-go">${icon("upload")}${L("Geri yükle", "Restore")}</button>`,
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
  if (!dbs.length) return flash(L(`Geri yüklemek için çalışan bir ${kind ? DB_NAMES[kind] + " " : ""}veritabanı parçası gerekiyor.`, `Restoring needs a running ${kind ? DB_NAMES[kind] + " " : ""}database container.`), true);
  const def = preset?.id || dbs.find((c) => c.name === b.source)?.id || dbs[0].id;
  Modal.open({
    title: L("Veritabanı dökümünü geri yükle", "Restore a database dump"), sub: b.file, size: "md",
    body: html`<div class="form">
      ${kind ? html`<p class="muted small">${L(`Bu bir ${DB_NAMES[kind]} dökümü; sadece ${DB_NAMES[kind]} veritabanları listelenir.`, `This is a ${DB_NAMES[kind]} dump; only ${DB_NAMES[kind]} databases are listed.`)}</p>` : ""}
      <div class="field"><label for="rd-target">${L("Hangi veritabanına?", "Into which database?")}</label>
        <select id="rd-target">${dbs.map((c) => html`<option value="${c.id}" ${c.id === def ? raw("selected") : ""}>${c.app.name} · ${c.role_title} (${c.name})</option>`)}</select></div>
      ${callout({ level: "warn", title: L("Dikkat", "Careful"), text: L("Dökümdeki veritabanları ve tablolar, hedefteki aynı adlı olanların yerine yazılır. Uygulamanın diğer parçalarını (site, API) önce durdurman önerilir; bağlı kalanlar işlemi engelleyebilir.", "Databases and tables in the dump replace the ones with the same name in the target. Stopping the app's other containers (site, API) first is recommended; open connections can block the restore.") })}
      ${callout({ level: "tip", text: L("Emin değilsen önce hedef veritabanının dökümünü al; bir şey ters giderse geri dönebilirsin.", "If you're not sure, dump the target database first so you can go back if something goes wrong.") })}
      <div id="f-err"></div>
    </div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn danger-solid" id="rd-go">${icon("upload")}${L("Geri yükle", "Restore")}</button>`,
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
  if (!list.length) return flash(L("Bu veritabanı için döküm bulunamadı. Önce “Veritabanı dökümü al”ı kullan.", "No dump found for this database. Use “Dump database” first."), true);
  Modal.open({
    title: L("Hangi döküm geri yüklensin?", "Which dump should be restored?"), sub: `${c.role_title} · ${c.name}`, size: "md",
    body: html`<div class="pick-list">${list.map((b, i) => html`
      <label class="radio-card"><input type="radio" name="rp" value="${i}" ${i === 0 ? raw("checked") : ""}>
        <span><b class="mono">${b.source}</b><small>${fmt.date(b.mtime)} · ${fmt.bytes(b.size)}</small></span></label>`)}</div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="rp-go">${L("Devam", "Continue")}</button>`,
    onMount(m) {
      $("#rp-go", m).addEventListener("click", () => openRestoreDb(list[+$("input[name=rp]:checked", m).value], c));
    },
  });
}

// ---------- Yeniden başlama kuralı ---------------------------------------------------
async function openRestartPolicy(c) {
  const opts = isEN() ? {
    no: ["Never", "Stays stopped unless you start it. Doesn't start when the Mac boots either."],
    "on-failure": ["Only if it exits with an error", "Docker retries if it crashes; stays stopped if you stop it."],
    "unless-stopped": ["Always (unless you stopped it)", "Starts by itself when Docker/the Mac starts. Stays stopped if you stopped it. Best in most cases."],
    always: ["Always", "Restarted no matter what."],
  } : {
    no: ["Hiçbir zaman", "Sen başlatmadıkça kapalı kalır. Mac açılınca da başlamaz."],
    "on-failure": ["Sadece hata verip kapanırsa", "Çökerse Docker tekrar dener; sen durdurursan kapalı kalır."],
    "unless-stopped": ["Her zaman (sen durdurmadıysan)", "Docker/Mac açılınca kendiliğinden başlar. Sen durdurduysan kapalı kalır. Çoğu durumda en iyisi."],
    always: ["Her zaman", "Ne olursa olsun tekrar başlatılır."],
  };
  Modal.open({
    title: L("Yeniden başlama kuralı", "Restart policy"), sub: `${c.role_title} · ${c.name}`, size: "sm",
    body: html`<div class="pick-list">${Object.entries(opts).map(([k, [t, d]]) => html`
      <label class="radio-card"><input type="radio" name="rp" value="${k}" ${k === c.restart_policy ? raw("checked") : ""}><span><b>${t}</b><small>${d}</small></span></label>`)}
      <div id="f-err"></div></div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="rp-go">${L("Kaydet", "Save")}</button>`,
    onMount(m) {
      $("#rp-go", m).addEventListener("click", async () => {
        try {
          await api("/api/parca/politika", { id: c.id, politika: $("input[name=rp]:checked", m).value });
          Modal.close();
          flash(L("Kaydedildi", "Saved"));
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
  if (!list.length) return flash(L("Bağlanacak başka parça yok.", "There are no other containers to connect."));
  Modal.open({
    title: L(`${net.name} ağına parça bağla`, `Connect a container to ${net.name}`), sub: L("Bağladığın parça, bu ağdaki diğer parçalara adıyla ulaşabilir.", "The container you connect can reach the others on this network by name."), size: "sm",
    body: html`<div class="form"><div class="field"><label for="cn-c">${T("container")}</label>
      <select id="cn-c">${list.map((c) => html`<option value="${c.name}">${c.app.source === "single" ? "" : c.app.name + " · "}${c.role_title} (${c.name})</option>`)}</select></div><div id="f-err"></div></div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="cn-go">${icon("link")}${L("Bağla", "Connect")}</button>`,
    onMount(m) {
      $("#cn-go", m).addEventListener("click", async () => {
        try { await api("/api/ag/bagla", { ag: net.name, parca: $("#cn-c", m).value, bagla: true }); Modal.close(); flash(L("Bağlandı", "Connected")); after?.(); } catch (e) { formError(m, e.message); }
      });
    },
  });
}

async function openConnectToNetwork(c) {
  let nets;
  try { nets = (await api("/api/aglar")).aglar; } catch (e) { return flash(e.message, true); }
  const list = nets.filter((n) => !["host", "none"].includes(n.name) && !n.containers.some((m) => m.name === c.name));
  if (!list.length) return flash(L("Bağlanabilecek başka ağ yok.", "There are no other networks to connect to."));
  Modal.open({
    title: L(`${c.role_title} başka bir ağa bağlansın`, `Connect ${c.role_title} to another network`), sub: L("Farklı bir uygulamadaki parçayla konuşması gerekiyorsa işine yarar.", "Useful when it needs to talk to a container in a different app."), size: "sm",
    body: html`<div class="form"><div class="field"><label for="cn-n">${T("network")}</label>
      <select id="cn-n">${list.map((n) => html`<option value="${n.name}">${n.name}${n.app_name ? ` (${n.app_name})` : ""}</option>`)}</select></div><div id="f-err"></div></div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="cn-go">${icon("link")}${L("Bağla", "Connect")}</button>`,
    onMount(m) {
      $("#cn-go", m).addEventListener("click", async () => {
        try {
          await api("/api/ag/bagla", { ag: $("#cn-n", m).value, parca: c.name, bagla: true });
          Modal.close();
          flash(L("Bağlandı", "Connected"));
          if (Router.current?.view === ContainerView) ContainerView.loadDetail();
        } catch (e) { formError(m, e.message); }
      });
    },
  });
}

// ---------- Uzak Docker ekle ----------------------------------------------------------
function openAddRemote(after) {
  let kind = "ssh";
  const mac = S.data?.platform?.mac;
  Modal.open({
    title: L("Uzak Docker ekle", "Add remote Docker"),
    sub: L("Başka bir bilgisayardaki (sunucu, ev sunucusu, sanal makine) Docker'ı buradan yönet.",
      "Manage Docker on another machine (a server, home server or VM) from here."), size: "md",
    body: html`<div class="form">
      ${segmented("rm-kind", [{ id: "ssh", label: L("SSH (önerilen)", "SSH (recommended)"), icon: "key" }, { id: "tcp", label: "TCP", icon: "network" }], kind)}
      <div id="rm-ssh" class="form">
        <div class="field"><label for="rm-host">${L("Sunucu", "Server")} <span class="req" aria-hidden="true">*</span></label>
          <input id="rm-host" placeholder="${L("kullanici@sunucu.com", "user@server.com")}" autocomplete="off" spellcheck="false">
          <div class="help">${L("kullanici@adres, bir IP ya da ~/.ssh/config'teki bir ad. VS Code Remote-SSH'te yazdığın adresin aynısı.",
            "user@address, an IP or a name from ~/.ssh/config. The same address you use in VS Code Remote-SSH.")}</div></div>
        <div class="row2">
          <div class="field"><label for="rm-port">${L("SSH kapısı", "SSH port")}</label><input id="rm-port" inputmode="numeric" placeholder="22"></div>
          <div class="field"><label for="rm-name">${L("Bağlantı adı", "Connection name")}</label><input id="rm-name" placeholder="${L("otomatik", "automatic")}" autocomplete="off" spellcheck="false"></div>
        </div>
        ${callout({ level: "tip", text: L("Şifre sorulmaz; bağlantı SSH anahtarınla kurulur. Terminal'de ssh kullanici@sunucu ile şifresiz girebiliyorsan hazırsın. Sunucuda Docker kurulu, kullanıcın da docker grubunda olmalı.",
          "No password is asked; the connection uses your SSH key. If ssh user@server works in Terminal without a password, you're ready. Docker must be installed on the server and your user must be in the docker group.") })}
      </div>
      <div id="rm-tcp" class="form" hidden>
        <div class="row2">
          <div class="field"><label for="rm-thost">${L("Adres", "Address")} <span class="req" aria-hidden="true">*</span></label><input id="rm-thost" placeholder="192.168.1.20" autocomplete="off" spellcheck="false"></div>
          <div class="field"><label for="rm-tport">${L("Kapı", "Port")}</label><input id="rm-tport" inputmode="numeric" placeholder="2376"></div>
        </div>
        <div class="field"><label for="rm-tls">${L("TLS sertifika klasörü", "TLS certificate folder")}</label>
          <div class="input-row"><input id="rm-tls" placeholder="~/.docker/${L("sunucu", "server")}" autocomplete="off" spellcheck="false">
            ${mac ? html`<button class="btn" id="rm-tls-pick">${icon("folder")}${L("Seç…", "Choose…")}</button>` : ""}</div>
          <div class="help">${L("İçinde ca.pem, cert.pem ve key.pem olan klasör.", "A folder containing ca.pem, cert.pem and key.pem.")}</div></div>
        <div class="field"><label for="rm-tname">${L("Bağlantı adı", "Connection name")}</label><input id="rm-tname" placeholder="${L("otomatik", "automatic")}" autocomplete="off" spellcheck="false"></div>
        ${callout({ level: "warn", text: L("Sertifikasız TCP bağlantısı şifrelenmez; ağdaki herkes o Docker'ı yönetebilir. Sadece güvendiğin ağda ya da VPN içinde kullan. Mümkünse SSH seç.",
          "A TCP connection without certificates is unencrypted; anyone on the network can control that Docker. Only use it on a network you trust or over a VPN. Prefer SSH when you can.") })}
      </div>
      <label class="check"><input type="checkbox" id="rm-use" checked><span><b>${L("Bağlanınca buna geç", "Switch to it after connecting")}</b></span></label>
      <div id="f-err"></div>
    </div>`,
    foot: html`<button class="btn" data-close>${L("Vazgeç", "Cancel")}</button><button class="btn primary" id="rm-go">${icon("link")}${L("Bağlan", "Connect")}</button>`,
    onMount(m) {
      m.addEventListener("click", (e) => {
        const seg = e.target.closest("[data-seg=rm-kind]");
        if (!seg) return;
        kind = seg.dataset.val;
        $$("[data-seg=rm-kind]", m).forEach((b) => { b.classList.toggle("active", b === seg); b.setAttribute("aria-checked", String(b === seg)); });
        $("#rm-ssh", m).hidden = kind !== "ssh";
        $("#rm-tcp", m).hidden = kind !== "tcp";
        $(kind === "ssh" ? "#rm-host" : "#rm-thost", m).focus();
      });
      $("#rm-tls-pick", m)?.addEventListener("click", async () => {
        try { const r = await api("/api/klasor-sec", {}); if (r.yol) $("#rm-tls", m).value = r.yol; } catch (e) { flash(e.message, true); }
      });
      const go = $("#rm-go", m);
      const submit = async () => {
        const v = (id) => $(id, m).value.trim();
        const body = kind === "ssh"
          ? { tur: "ssh", sunucu: v("#rm-host"), kapi: v("#rm-port"), ad: v("#rm-name") }
          : { tur: "tcp", sunucu: v("#rm-thost"), kapi: v("#rm-tport"), tls: v("#rm-tls"), ad: v("#rm-tname") };
        body.gec = $("#rm-use", m).checked;
        go.disabled = true;
        go.innerHTML = String(html`<span class="spinner"></span>${L("Bağlanılıyor…", "Connecting…")}`);
        $("#f-err", m).innerHTML = "";
        try {
          const r = (await api("/api/uzak/ekle", body)).sonuc;
          Modal.close();
          flash(L(`Bağlandı: ${r.name} · Docker ${r.version}`, `Connected: ${r.name} · Docker ${r.version}`));
          if (body.gec) await afterContextChange();
          else after?.();
        } catch (e) {
          go.disabled = false;
          go.innerHTML = String(html`${icon("link")}${L("Bağlan", "Connect")}`);
          formError(m, e.message);
        }
      };
      go.addEventListener("click", submit);
      m.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); submit(); } });
      setTimeout(() => $("#rm-host", m)?.focus(), 50);
    },
  });
}
