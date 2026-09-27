/* =====================================================================
   Uygulama içi terminal (xterm.js)
   Her parça için bir oturum tutulur; sekmeler ya da sayfalar arasında gezinince kopmaz.
   Çıktı Python'dan "bekleyen istek" ile gelir (/api/terminal/oku), yazılanlar sırayla gönderilir.
   ===================================================================== */

const TERM_THEME = {
  background: "#090c11",
  foreground: "#d5dbe6",
  cursor: "#5b93ff",
  cursorAccent: "#090c11",
  selectionBackground: "rgba(91, 147, 255, .35)",
  black: "#1b212c", red: "#ff7272", green: "#45d992", yellow: "#f6bb4f",
  blue: "#5b93ff", magenta: "#c792ea", cyan: "#5fd4e0", white: "#d5dbe6",
  brightBlack: "#5c6678", brightRed: "#ff9a9a", brightGreen: "#7ee6b3", brightYellow: "#ffd27f",
  brightBlue: "#8fb4ff", brightMagenta: "#ddb4f5", brightCyan: "#8ee6ee", brightWhite: "#ffffff",
};

const b64ToBytes = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

class TermSession {
  constructor(container, user = "") {
    this.cid = container.id;
    this.name = container.name;
    this.user = user;
    this.sid = null;
    this.state = "baglaniyor"; // baglaniyor | acik | kapandi | hata
    this.error = "";
    this.exitCode = null;
    this.pending = "";
    this.sending = false;
    this.listeners = new Set();

    this.el = document.createElement("div");
    this.el.className = "xterm-host";
    this.term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: TERM_THEME,
    });
    this.fitter = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitter);
    this.term.open(this.el);
    this.term.onData((d) => this.input(d));
    this.term.onResize(({ cols, rows }) => {
      if (this.sid && this.state === "acik") api("/api/terminal/boyut", { sid: this.sid, cols, rows }).catch(() => {});
    });
    this.resizeObs = new ResizeObserver(() => this.fitSoon());
    this.resizeObs.observe(this.el);
    this.connect();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn(this)); }
  setState(state, extra = {}) { Object.assign(this, { state }, extra); this.emit(); }

  fitSoon() {
    clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => {
      if (!this.el.isConnected || !this.el.clientWidth) return;
      try { this.fitter.fit(); } catch { /* görünür değilken ölçülemez */ }
    }, 30);
  }

  async connect() {
    this.setState("baglaniyor", { error: "", exitCode: null });
    this.fitSoon();
    try {
      const r = await api("/api/terminal/ac", { id: this.cid, cols: this.term.cols, rows: this.term.rows, kullanici: this.user });
      this.sid = r.sid;
      this.setState("acik");
      this.readLoop(r.sid);
      if (this.pending) this.flush();
    } catch (e) {
      this.setState("hata", { error: e.message });
      this.term.write(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`);
    }
  }

  async readLoop(sid) {
    while (this.sid === sid) {
      let r;
      try {
        r = await api("/api/terminal/oku", { sid });
      } catch (e) {
        if (this.sid === sid) this.setState("hata", { error: e.message });
        return;
      }
      if (this.sid !== sid) return;
      if (r.veri) this.term.write(b64ToBytes(r.veri));
      if (r.bitti) {
        this.sid = null;
        const code = r.kod;
        this.term.write(`\r\n\x1b[2m[Oturum kapandı${code != null && code !== 0 ? ` · çıkış kodu ${code}` : ""}. Yeniden bağlanmak için Enter'a bas.]\x1b[0m\r\n`);
        this.setState("kapandi", { exitCode: code });
        return;
      }
    }
  }

  input(data) {
    if (this.state === "kapandi" || this.state === "hata") {
      if (data === "\r") this.reconnect();
      return;
    }
    this.pending += data;
    if (this.state === "acik") this.flush();
  }

  /** Yazılanları sırayla gönderir (köprü çağrıları paralel çalışır; sıra karışmasın). */
  async flush() {
    if (this.sending) return;
    this.sending = true;
    while (this.pending && this.sid && this.state === "acik") {
      const chunk = this.pending;
      this.pending = "";
      try {
        await api("/api/terminal/yaz", { sid: this.sid, veri: chunk });
      } catch (e) {
        this.setState("hata", { error: e.message });
        break;
      }
    }
    this.sending = false;
  }

  /** Hazır komut düğmeleri için: komutu yazıp Enter'a basar. */
  run(command) {
    if (this.state !== "acik") {
      flash("Terminal bağlı değil. Önce bağlan.", true);
      return;
    }
    this.input(command + "\r");
    this.focus();
  }

  reconnect(user = this.user) {
    const old = this.sid;
    this.sid = null;
    this.user = user;
    if (old) api("/api/terminal/kapat", { sid: old }).catch(() => {});
    this.term.write("\r\n");
    this.connect();
  }

  clear() { this.term.clear(); this.focus(); }

  focus() { setTimeout(() => this.term.focus(), 0); }

  mount(slot) {
    if (this.el.parentNode === slot) return;
    slot.appendChild(this.el);
    this.fitSoon();
    // DOM'dan çıkıp geri gelince ekranı yeniden çiz.
    setTimeout(() => this.term.refresh(0, this.term.rows - 1), 40);
  }

  dispose() {
    const old = this.sid;
    this.sid = null;
    if (old) api("/api/terminal/kapat", { sid: old }).catch(() => {});
    this.resizeObs.disconnect();
    this.term.dispose();
    this.el.remove();
    this.listeners.clear();
  }
}

/** Parça başına tek oturum. */
const TermHub = {
  sessions: new Map(),

  get(cid) { return this.sessions.get(cid); },

  open(container) {
    let s = this.sessions.get(container.id);
    if (!s) {
      s = new TermSession(container);
      this.sessions.set(container.id, s);
    }
    return s;
  },

  close(cid) {
    const s = this.sessions.get(cid);
    if (s) { s.dispose(); this.sessions.delete(cid); }
  },
};
