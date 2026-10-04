/* PVHSN shared board engine.
   Written in plain older JavaScript on purpose (no ?. or ??) so it runs on
   the older Chromium inside the Yodeck Raspberry Pi player. */
(function () {
  var PV = {};
  var TZ = "America/Los_Angeles";
  PV.WORKER = "https://pv-house-sports.gian-ganziano.workers.dev";

  /* ---- Los Angeles teams get the spotlight on every board ---- */
  PV.LA = {
    nfl: { LAR: 1, LAC: 1 },
    mlb: { 119: 1, 108: 1 },            // Dodgers, Angels (MLB team ids)
    ncaa: { "26": 1, "30": 1 },         // UCLA, USC (ESPN team ids)
    nba: { LAL: 1, LAC: 1 },
    nhl: { LA: 1, ANA: 1 }
  };
  PV.isLA = function (league, key) { return !!(PV.LA[league] && PV.LA[league][key]); };

  PV.qs = function (name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  };
  PV.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  /* ---- 1920x1080 canvas scaled to whatever the screen is ---- */
  PV.scale = function () {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var st = document.getElementById("stage");
    st.style.transform = "scale(" + s + ")";
    st.style.left = (window.innerWidth - 1920 * s) / 2 + "px";
    st.style.top = (window.innerHeight - 1080 * s) / 2 + "px";
  };

  /* ---- Header + footer ---- */
  PV.frame = function (opts) {
    var st = document.getElementById("stage");
    var hd = document.createElement("header");
    hd.className = "hd";
    hd.innerHTML =
      '<div class="mark"><div class="mark-badge">PV<br>HSN</div><div>' +
      '<div class="mark-name">P.V. HOUSE SPORTS NETWORK</div>' +
      '<div class="board-title" id="boardTitle">' + opts.title + "</div></div></div>" +
      '<img class="pvlogo" src="core/pv-house-logo-white.png" alt="P.V. House">' +
      '<div class="hd-right"><div class="clock num" id="clock"></div><div class="date" id="date"></div>' +
      '<div class="upd" id="updated">LOADING&hellip;</div></div>';
    var ft = document.createElement("footer");
    ft.className = "ft";
    ft.innerHTML =
      '<div class="web">PVHOUSELA.COM &bull; @P.V.HOUSE</div>' +
      '<div class="pager" id="pager"></div>' +
      '<div class="addr">12751 MILLENNIUM DR #140 &bull; PLAYA VISTA &bull; (424) 500-8229</div>';
    st.insertBefore(hd, st.firstChild);
    st.appendChild(ft);
    PV.tick();
    setInterval(PV.tick, 15000);
    PV.scale();
    window.addEventListener("resize", PV.scale);
  };

  PV.fmt = function (d, o) {
    o.timeZone = TZ;
    return new Intl.DateTimeFormat("en-US", o).format(d);
  };
  PV.tick = function () {
    var now = new Date();
    var c = document.getElementById("clock"), d = document.getElementById("date");
    if (c) c.textContent = PV.fmt(now, { hour: "numeric", minute: "2-digit" }) + " PT";
    if (d) d.textContent = PV.fmt(now, { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
  };
  PV.timePT = function (iso) {
    return PV.fmt(new Date(iso), { hour: "numeric", minute: "2-digit" }).replace(" ", "") + " PT";
  };
  PV.dayPT = function (iso) {
    return PV.fmt(new Date(iso), { weekday: "short" }).toUpperCase();
  };
  PV.todayKey = function () {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + p.month + p.day;
  };

  /* ---- Data: timeout + keep last good copy, never show an error if we have data ---- */
  PV.getJSON = function (url, cacheKey, timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 12000);
    return fetch(url, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        clearTimeout(timer);
        var at = Date.now();
        try { localStorage.setItem("pvhsn:" + cacheKey, JSON.stringify({ at: at, data: data })); } catch (e) {}
        return { data: data, at: at, stale: false };
      })
      .catch(function () {
        clearTimeout(timer);
        try {
          var saved = JSON.parse(localStorage.getItem("pvhsn:" + cacheKey));
          if (saved && saved.data) return { data: saved.data, at: saved.at, stale: true };
        } catch (e) {}
        return null;
      });
  };

  PV.updated = function (res) {
    var el = document.getElementById("updated");
    if (!el || !res) return;
    var t = PV.fmt(new Date(res.at), { hour: "numeric", minute: "2-digit" });
    el.textContent = (res.stale ? "LAST UPDATE " : "UPDATED ") + t;
    el.className = "upd" + (res.stale ? " stale" : "");
  };

  PV.message = function (big, small) {
    var b = document.querySelector(".body");
    b.innerHTML = '<div class="msg"><b>' + PV.esc(big) + "</b><span>" + PV.esc(small || "") + "</span></div>";
  };

  /* ---- Paging that starts at page 1 when the board is actually on screen ----
     The timer only starts on the first animation frame, which browsers do not
     run for a hidden page. Coming back into view also restarts at page 1. */
  PV.pager = function (count, ms, render) {
    var idx = 0, timer = null, el = document.getElementById("pager");
    document.documentElement.style.setProperty("--page-ms", ms + "ms");
    function dots() {
      if (!el) return;
      if (count < 2) { el.innerHTML = ""; return; }
      var h = "";
      for (var i = 0; i < count; i++) h += '<i class="' + (i === idx ? "on" : i < idx ? "done" : "") + '"></i>';
      el.innerHTML = h;
    }
    function show(i) { idx = i; render(idx); dots(); }
    function start() {
      clearInterval(timer);
      show(0);
      if (count > 1) timer = setInterval(function () { show((idx + 1) % count); }, ms);
    }
    render(0);
    var raf = window.requestAnimationFrame || function (f) { setTimeout(f, 0); };
    raf(start);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") start();
    });
    return { stop: function () { clearInterval(timer); } };
  };

  /* ---- Small helpers ---- */
  PV.hex = function (c, fallback) {
    c = String(c || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(c)) return fallback || "#3a4452";
    var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum < 0.16 || lum > 0.92) return fallback || "#5b6573";   // too dark or white to read on the board
    return "#" + c;
  };
  PV.initials = function (abbr, color, size) {
    return '<div class="initials" style="width:' + size + "px;height:" + size + "px;background:" + color +
      ";font-size:" + Math.round(size * 0.36) + 'px">' + PV.esc(abbr) + "</div>";
  };

  /* ---- Team logos: try each source in order, then fall back to a team-color badge ----
     1. our own copy in the repo (fastest, never blocked)
     2. the league's logo server (ESPN / MLB)
     3. the same logo relayed through our Cloudflare Worker (in case the Pi can't reach #2)
     4. team abbreviation on the team color */
  var REPO = (function () { var s = document.currentScript && document.currentScript.src; return s ? s.replace(/v2\/core\/pvhsn\.js.*$/, "") : "../"; })();
  PV.logoSources = function (league, key) {
    key = String(key == null ? "" : key);
    if (!key) return [];
    var lk = key.toLowerCase();
    if (league === "nfl") {
      var f = { wsh: "was" }[lk] || lk;
      return [REPO + "pvhsn-assets/nfl/" + f + ".png", "https://a.espncdn.com/i/teamlogos/nfl/500/" + lk + ".png", PV.WORKER + "/logo/nfl/" + lk];
    }
    if (league === "mlb") return [REPO + "pvhsn-assets/mlb/id/" + key + ".svg", "https://www.mlbstatic.com/team-logos/team-cap-on-dark/" + key + ".svg", PV.WORKER + "/logo/mlb/" + key];
    if (league === "ncaa") return [REPO + "pvhsn-assets/ncaa/id/" + key + ".webp", "https://a.espncdn.com/i/teamlogos/ncaa/500-dark/" + key + ".png", PV.WORKER + "/logo/ncaa/" + key];
    if (league === "nhl") return [REPO + "pvhsn-assets/nhl/" + lk + ".webp", "https://a.espncdn.com/i/teamlogos/nhl/500-dark/" + lk + ".png", PV.WORKER + "/logo/nhl/" + lk];
    if (league === "nba") return ["https://a.espncdn.com/i/teamlogos/nba/500/" + lk + ".png", PV.WORKER + "/logo/nba/" + lk];
    return [];
  };
  PV.logo = function (league, key, abbr, color, size, cls) {
    var srcs = PV.logoSources(league, key);
    var badge = PV.initials(abbr || "", color || "#3a4452", size);
    if (!srcs.length) return badge;
    return '<img class="logo ' + (cls || "") + '" style="width:' + size + "px;height:" + size + 'px" alt="" src="' + srcs[0] +
      '" data-next="' + PV.esc(srcs.slice(1).join("|")) + '" data-badge="' + PV.esc(badge) + '" onerror="PV.logoFail(this)">';
  };
  PV.logoFail = function (img) {
    var rest = (img.getAttribute("data-next") || "").split("|").filter(Boolean);
    if (rest.length) { img.setAttribute("data-next", rest.slice(1).join("|")); img.src = rest[0]; return; }
    var span = document.createElement("span");
    span.innerHTML = img.getAttribute("data-badge") || "";
    if (span.firstChild) img.parentNode.replaceChild(span.firstChild, img);
  };

  window.PV = PV;
})();
