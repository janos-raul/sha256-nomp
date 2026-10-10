/*
  SHA256-NOMP theme helpers (v1.5.0)
  - dark/light toggle (dark by default, remembered in localStorage)
  - network bar: scrolls when wider than the screen, updated from the live
    stats stream (statsUpdate events triggered by main.js)
  - LIVE indicator follows the live stats connection
  - price bar: prices from the CoinGecko API, built here (no third-party script)
  - paginateRows(): client-side pager for long tables (payments, miners)
  - blockStatusHtml(): block status with confirmations spinner/progress bar
  - drawLineChart(): small SVG line/area chart used by the pages
  - revealCoinTab(): coin tab row scrolls sideways (wheel, fades, active tab in view)
*/
(function () {
  "use strict";

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) {
      return null;
    }
  }

  // ---------- theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "dark" ? "Light" : "Dark";
  }

  // ---------- formatting ----------
  function ago(seconds) {
    if (seconds === null || seconds === undefined || seconds === "" || isNaN(seconds)) return "-";
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60) return seconds + "s ago";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    return Math.floor(seconds / 86400) + "d ago";
  }
  function readableDiff(d) {
    var n = parseFloat(d);
    if (n > 0 && n < 0.01) return n.toExponential(2); // regtest/testnet minimums
    if (typeof window.getReadableDifficultyString === "function") return window.getReadableDifficultyString(d);
    return String(d);
  }
  window.themeAgo = ago;

  // ---------- network bar ----------
  var statsTime = null; // seconds, when the stats were gathered

  function refreshAges() {
    if (!statsTime) return;
    var elapsed = Date.now() / 1000 - statsTime;
    document.querySelectorAll('#network-track [data-f="last"]').forEach(function (el) {
      var since = parseFloat(el.getAttribute("data-since"));
      el.textContent = isNaN(since) ? "-" : ago(since + elapsed);
    });
  }

  function setupMarquee(track, pxPerSecond) {
    if (!track) return;
    // remove previous clones, then decide whether scrolling is needed
    track.querySelectorAll("[data-clone]").forEach(function (n) {
      n.remove();
    });
    track.classList.remove("scrolling");
    var box = track.parentElement;
    if (box) box.classList.remove("is-scrolling");
    if (!box || track.scrollWidth <= box.clientWidth) return;
    box.classList.add("is-scrolling");
    Array.prototype.slice.call(track.children).forEach(function (child) {
      var clone = child.cloneNode(true);
      clone.setAttribute("data-clone", "1");
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
    });
    // constant speed: about 40px per second unless given
    track.style.setProperty("--marquee-duration", Math.max(20, Math.round(track.scrollWidth / 2 / (pxPerSecond || 40))) + "s");
    track.classList.add("scrolling");
  }

  function updateNetwork(stats) {
    if (!stats || !stats.pools) return;
    if (stats.time) statsTime = stats.time;
    Object.keys(stats.pools).forEach(function (coin) {
      var p = stats.pools[coin];
      var ps = p.poolStats || {};
      document.querySelectorAll('#network-track .net-item[data-coin="' + coin + '"]').forEach(function (item) {
        var set = function (f, v) {
          var el = item.querySelector('[data-f="' + f + '"]');
          if (el && v !== undefined && v !== null && v !== "") el.textContent = v;
          return el;
        };
        set("height", ps.networkBlocks || p.blockheight);
        if (ps.networkDiff) set("diff", readableDiff(ps.networkDiff));
        set("hashrate", p.hashrateString);
        var last = item.querySelector('[data-f="last"]');
        if (last && p.timesincelast !== undefined && p.timesincelast !== null) last.setAttribute("data-since", p.timesincelast);
      });
    });
    refreshAges();
  }

  // ---------- live indicator ----------
  function updateLive() {
    var dot = document.getElementById("live-status");
    if (!dot) return;
    var src = window.statsSource;
    var state = !src || typeof EventSource === "undefined" ? "connecting"
      : src.readyState === EventSource.OPEN ? "live"
      : src.readyState === EventSource.CONNECTING ? "connecting" : "offline";
    dot.classList.toggle("connecting", state === "connecting");
    dot.classList.toggle("offline", state === "offline");
    dot.textContent = state === "live" ? "LIVE" : state === "connecting" ? "CONNECTING" : "OFFLINE";
  }

  // ---------- Chart.js styling from the theme ----------
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  // Series colours for multi-line charts: theme accent and aux first
  window.themeChartColors = function () {
    return [cssVar("--accent"), cssVar("--aux"), cssVar("--good"), "#a78bfa", cssVar("--warn"), "#f472b6", "#60a5fa", cssVar("--bad")];
  };
  window.applyChartTheme = function () {
    if (!window.Chart || !Chart.defaults) return;
    var d = Chart.defaults;
    d.color = cssVar("--muted");
    d.borderColor = cssVar("--line");
    d.font.family = '"JetBrains Mono", ui-monospace, Consolas, monospace';
    d.font.size = 10.5;
    var tip = d.plugins && d.plugins.tooltip;
    if (tip) {
      tip.backgroundColor = cssVar("--panel");
      tip.borderColor = cssVar("--line-hi");
      tip.borderWidth = 1;
      tip.cornerRadius = 2;
      tip.titleColor = cssVar("--text-hi");
      tip.bodyColor = cssVar("--text");
      tip.padding = 10;
    }
    var legend = d.plugins && d.plugins.legend;
    if (legend && legend.labels) {
      legend.labels.usePointStyle = true;
      legend.labels.pointStyle = "rect";
      legend.labels.boxWidth = 8;
      legend.labels.boxHeight = 8;
    }
  };
  function restyleCharts() {
    window.applyChartTheme();
    if (!window.Chart || !Chart.instances) return;
    Object.keys(Chart.instances).forEach(function (k) {
      var c = Chart.instances[k];
      try {
        ["x", "y"].forEach(function (axis) {
          var sc = c.options.scales && c.options.scales[axis];
          if (!sc) return;
          if (sc.grid) sc.grid.color = cssVar("--line");
          if (sc.ticks) sc.ticks.color = cssVar("--muted");
        });
        c.update("none");
      } catch (e) {}
    });
  }

  // ---------- coin tabs: one row, scrolls sideways ----------
  function coinTabFades(row) {
    var max = row.scrollWidth - row.clientWidth;
    row.classList.toggle("fade-l", max > 1 && row.scrollLeft > 1);
    row.classList.toggle("fade-r", max > 1 && row.scrollLeft < max - 1);
  }
  // pages call this after switching tabs: scrolls the tab into view, sets the
  // edge fades, and lets the mouse wheel scroll the row (bound once per row)
  window.revealCoinTab = function (tab) {
    var row = tab && tab.closest(".coin-tabs");
    if (!row) return;
    if (!row.__coinTabs) {
      row.__coinTabs = true;
      row.addEventListener("scroll", function () { coinTabFades(row); }, { passive: true });
      row.addEventListener("wheel", function (e) {
        if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        row.scrollLeft += e.deltaY;
      }, { passive: false });
      window.addEventListener("resize", function () { coinTabFades(row); });
    }
    var left = tab.offsetLeft, right = left + tab.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left - 24;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 24;
    coinTabFades(row);
  };

  // ---------- small SVG chart for the pages ----------
  // sets: [{ data: [[timeMs, value], ...], color: "var(--accent)" }]
  window.drawLineChart = function (svg, sets, options) {
    if (!svg) return;
    options = options || {};
    // width/height should match the svg's viewBox so labels keep their shape
    var W = options.width || 760, H = options.height || 190, L = 52, R = 10, T = 12, B = 22;
    var CHAR_W = 6.2; // width of one 10px mono label character, in viewBox units
    var all = [];
    sets.forEach(function (s) {
      // the server's history is not always in time order
      s.data = s.data.slice().sort(function (a, b) { return a[0] - b[0]; });
      s.data.forEach(function (pt) {
        all.push(pt);
      });
    });
    if (all.length < 2) {
      svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle">' + (options.empty || "No data yet") + "</text>";
      return;
    }
    var t0 = Math.min.apply(null, all.map(function (p) { return p[0]; }));
    var t1 = Math.max.apply(null, all.map(function (p) { return p[0]; }));
    var vmax = Math.max.apply(null, all.map(function (p) { return p[1]; })) || 1;
    vmax = vmax * 1.15;
    var fmt = options.format || function (v) { return v.toFixed(1); };
    // y labels first: the left margin grows to fit the longest ("123.45 TH")
    var yLabels = [];
    for (var k = 0; k <= 4; k++) yLabels.push(k === 0 ? "0" : String(fmt((vmax * k) / 4)));
    yLabels.forEach(function (lbl) {
      L = Math.max(L, Math.ceil(lbl.length * CHAR_W) + 10);
    });
    var X = function (t) { return L + (W - L - R) * (t1 === t0 ? 1 : (t - t0) / (t1 - t0)); };
    var Y = function (v) { return T + (H - T - B) * (1 - v / vmax); };
    var g = "";
    for (k = 0; k <= 4; k++) {
      var y = Y((vmax * k) / 4);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/>';
      g += '<text x="' + (L - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + yLabels[k] + "</text>";
    }
    for (var i = 0; i <= 4; i++) {
      var t = t0 + ((t1 - t0) * i) / 4;
      var d = new Date(t);
      var lbl = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      g += '<text x="' + X(t) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? "start" : i === 4 ? "end" : "middle") + '">' + lbl + "</text>";
    }
    sets.forEach(function (s) {
      if (s.data.length < 2) return;
      // split into segments where samples are missing (pool restarted, no data)
      var steps = [];
      for (var j = 1; j < s.data.length; j++) steps.push(s.data[j][0] - s.data[j - 1][0]);
      steps.sort(function (a, b) { return a - b; });
      var gap = (steps[Math.floor(steps.length / 2)] || 0) * 4;
      var segs = [[s.data[0]]];
      for (var m = 1; m < s.data.length; m++) {
        if (gap && s.data[m][0] - s.data[m - 1][0] > gap) segs.push([]);
        segs[segs.length - 1].push(s.data[m]);
      }
      segs.forEach(function (seg) {
        if (seg.length < 2) return;
        var path = seg.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
        var a = seg[0], b = seg[seg.length - 1];
        g += '<path d="' + path + " L" + X(b[0]).toFixed(1) + " " + Y(0) + " L" + X(a[0]).toFixed(1) + " " + Y(0) + ' Z" fill="' + s.color + '" fill-opacity="0.07"/>';
        g += '<path d="' + path + '" fill="none" stroke="' + s.color + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
      });
      var last = s.data[s.data.length - 1];
      g += '<rect x="' + (X(last[0]) - 3) + '" y="' + (Y(last[1]) - 3) + '" width="6" height="6" fill="' + s.color + '"/>';
    });
    svg.innerHTML = g;
  };

  // ---------- boot ----------
  /* ---------- table pager ----------
     Shows `perPage` of `rows` at a time with a pager bar inserted after
     `anchor`. Calling it again on the same anchor replaces the old pager. */
  window.paginateRows = function (anchor, rows, perPage) {
    if (!anchor) return;
    var next = anchor.nextElementSibling;
    if (next && next.classList.contains("pager")) next.remove();
    rows = Array.prototype.slice.call(rows);
    var pages = Math.ceil(rows.length / perPage);
    if (pages <= 1) {
      rows.forEach(function (r) { r.style.display = ""; });
      return;
    }
    var pager = document.createElement("div");
    pager.className = "pager";
    var info = document.createElement("span");
    var btns = document.createElement("div");
    btns.className = "pager-btns";
    pager.appendChild(info);
    pager.appendChild(btns);
    anchor.insertAdjacentElement("afterend", pager);

    function button(label, title, page) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = label;
      b.title = title;
      b.addEventListener("click", function () { show(page); });
      btns.appendChild(b);
      return b;
    }
    function show(page) {
      page = Math.max(0, Math.min(pages - 1, page));
      var from = page * perPage;
      var to = Math.min(rows.length, from + perPage);
      rows.forEach(function (r, i) { r.style.display = i >= from && i < to ? "" : "none"; });
      info.textContent = from + 1 + "\u2013" + to + " of " + rows.length;
      btns.innerHTML = "";
      button('<i class="fas fa-chevron-left"></i>', "Previous", page - 1).disabled = page === 0;
      // first, last and two pages either side of the current one
      var last = -1;
      for (var i = 0; i < pages; i++) {
        if (i !== 0 && i !== pages - 1 && Math.abs(i - page) > 2) continue;
        if (last >= 0 && i - last > 1) {
          var gap = document.createElement("span");
          gap.className = "pager-gap";
          gap.textContent = "\u2026";
          btns.appendChild(gap);
        }
        var b = button(String(i + 1), "Page " + (i + 1), i);
        if (i === page) b.classList.add("active");
        last = i;
      }
      button('<i class="fas fa-chevron-right"></i>', "Next", page + 1).disabled = page === pages - 1;
    }
    show(0);
  };

  /* ---------- block status ----------
     Same display as Pool Stats: spinner, confirmations and a progress bar
     while pending, a check when confirmed. `b` is an /api/blocks entry. */
  window.blockStatusHtml = function (b, minConf) {
    var esc = function (t) {
      return String(t).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    };
    var st = b.status || "pending";
    var confirmed = '<span class="bstat confirmed"><i class="fas fa-check-circle"></i> Confirmed</span>';
    if (st === "confirmed") return confirmed;
    if (st !== "pending") return '<span class="bstat ' + esc(st) + '">' + esc(st) + "</span>";
    minConf = parseInt(minConf, 10) || 0;
    if (b.confirmations == null || !minConf) {
      return '<span class="bstat pending"><i class="fas fa-clock"></i> Pending</span>';
    }
    if (b.confirmations >= minConf) return confirmed;
    var pct = Math.min(100, Math.max(0, (b.confirmations / minConf) * 100));
    return (
      '<div class="bstat-stack">' +
      '<div><i class="fas fa-spinner fa-spin"></i>' + b.confirmations + "/" + minConf + "</div>" +
      '<div class="bstat-progress"><div class="bstat-bar"><div class="bstat-fill' +
      (b.type === "solo" ? " solo" : "") + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      Math.round(pct) + "%</div></div>"
    );
  };

  /* ---------- price bar ----------
     Prices come straight from CoinGecko's public API and are rendered with
     DOM methods (textContent), so no third-party script runs on the site and
     nothing from the API is parsed as HTML. Refreshed every 5 minutes. */
  var PRICE_REFRESH_MS = 5 * 60 * 1000;

  function formatUsd(v) {
    v = Number(v);
    if (!isFinite(v)) return "-";
    if (v >= 1) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return "$" + v.toPrecision(4);
  }

  function priceItem(c) {
    var item = document.createElement("div");
    item.className = "net-item price-item";
    if (typeof c.image === "string" && /^https:\/\/[a-z0-9.-]*coingecko\.com\//.test(c.image)) {
      var img = document.createElement("img");
      img.src = c.image;
      img.alt = "";
      img.width = 14;
      img.height = 14;
      img.loading = "lazy";
      item.appendChild(img);
    }
    var name = document.createElement("span");
    name.className = "price-name";
    name.textContent = String(c.name || c.id || "");
    var sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = String(c.symbol || "").toUpperCase();
    var price = document.createElement("b");
    price.textContent = formatUsd(c.current_price);
    item.appendChild(name);
    item.appendChild(sym);
    item.appendChild(price);
    var ch = Number(c.price_change_percentage_24h);
    if (isFinite(ch)) {
      var change = document.createElement("span");
      change.className = ch >= 0 ? "up" : "down";
      change.textContent = (ch >= 0 ? "\u25B2 " : "\u25BC ") + Math.abs(ch).toFixed(1) + "%";
      item.appendChild(change);
    }
    return item;
  }

  function loadPrices(track) {
    var ids = (track.getAttribute("data-coins") || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    if (!ids.length) return;
    var url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&price_change_percentage=24h&ids=" + encodeURIComponent(ids.join(","));
    fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (list) {
        if (!Array.isArray(list) || !list.length) throw new Error("no data");
        var byId = {};
        list.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
        track.textContent = "";
        ids.forEach(function (id) { if (byId[id]) track.appendChild(priceItem(byId[id])); });
        setupMarquee(track, 30);
      })
      .catch(function () {
        // keep the last prices if we had them
        if (!track.querySelector(".price-item")) track.textContent = "Prices unavailable";
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(store("theme") === "light" ? "light" : "dark");
    window.applyChartTheme();
    document.addEventListener("themechange", restyleCharts);
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        applyTheme(next);
        store("theme", next);
        document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
      });
    }

    var track = document.getElementById("network-track");
    if (track) {
      statsTime = parseFloat(track.getAttribute("data-time")) || null;
      refreshAges();
      setupMarquee(track);
      var resizeTimer;
      window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          setupMarquee(track);
          var pt = document.getElementById("price-track");
          if (pt && pt.querySelector(".price-item")) setupMarquee(pt, 30);
        }, 250);
      });
    }
    setInterval(refreshAges, 15000);

    if (window.jQuery) {
      window.jQuery(document).on("statsUpdate", function (e, stats) {
        updateNetwork(stats);
        updateLive();
      });
    }
    updateLive();
    setInterval(updateLive, 5000);

    var priceTrack = document.getElementById("price-track");
    if (priceTrack) {
      loadPrices(priceTrack);
      setInterval(function () {
        if (!document.hidden) loadPrices(priceTrack);
      }, PRICE_REFRESH_MS);
    }
  });
})();
