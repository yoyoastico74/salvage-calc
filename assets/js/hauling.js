/* hauling.js — V1.14.31 FULL (CITY_FILTER_FIX) */

(() => {
  "use strict";

  const VERSION = "V1.14.40 FULL (TOP3_ORIGIN_LIVE)";


const HTML_VERSION = "V1.13.91";
const CSS_VERSION = "V1.13.91";
function getAdvOriginQuery(){
  const el = document.getElementById("advRouteFrom")
        || document.getElementById("advOrigin")
        || document.getElementById("routeFrom")
        || null;
  return (el && typeof el.value === "string") ? el.value.trim() : "";
}


  // ------------------------------------------------------------
  // TECH VERSIONS (FRET) — single source of truth (Mining-like footer)
  // ------------------------------------------------------------
  const TECH = {
    module: "FRET",
    moduleVersion: "V1.14.27",
    html: "V1.14.27",
    css: "V1.14.27",
    js: "V1.14.27",
    core: "V1.5.20",
    ships: "v2.0.5",
    pu: "4.5"
  };



  console.info("[hauling] loaded", VERSION);

  // ------------------------------------------------------------
  // CONFIG

  // ------------------------------------------------------------
  // TOP3_ORIGIN_LIVE: keep Top 3 synced with Departure (A) when B is empty
  // ------------------------------------------------------------
  let __top3OriginTimer = null;
  function wireTop3OriginLive(){
    const fromEl = document.getElementById("advRouteFrom");
    if (!fromEl) return;

    const handler = () => {
      const fromName = (fromEl.value || "").trim();
      const toName = (document.getElementById("advRouteTo")?.value || "").trim();
      if (toName) return; // user is in A→B mode
      clearTimeout(__top3OriginTimer);
      __top3OriginTimer = setTimeout(() => {
        const q = (document.getElementById("advSearch")?.value || "").trim();
        if (!fromName){
          // back to global scan (no origin)
          try{ setAdvText("advRouteStatus", "Scan routes globales…"); }catch(_e){}
          fetchTopRoutes({ commodityQuery: q, reason: "origin-cleared" })
            .catch((_e) => {});
        }
      }, 250);
    };

    fromEl.addEventListener("input", handler);
  }

  // ------------------------------------------------------------
  const PROXY_BASE = "https://uex-proxy.yoyoastico74.workers.dev";
  const GAME_VERSION = "4.5";
  const LS_KEY = "hauling.state.v1_10_2";

  // Suggestions (Top Routes) defaults
  const TOP_ROUTES_LIMIT = 20;
  const TOP_ROUTES_MAX_TERMINALS = 90; // B: "tous terminaux" => scan large mais raisonnable; ajustable côté Worker via max_terminals

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const $q = (sel, root = document) => root.querySelector(sel);
  const $qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const num = (v) => {
    const x = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(x) ? x : 0;
  };
  const int = (v) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const fmt = (n) => `${Math.round(num(n)).toLocaleString("fr-FR")} aUEC`;
  const fmt0 = (n) => `${Math.round(num(n)).toLocaleString("fr-FR")}`;

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  function scoreClass(score) {
    const s = Number(score) || 0;
    if (s >= 70) return "score-good";
    if (s >= 45) return "score-mid";
    if (s >= 30) return "score-low";
    return "score-bad";
  }



  function score100(r){
    return int(r?.finalScore100 ?? Math.round(num(r?.finalScore ?? 0) * 100)) || 0;
  }

  function stabMeta(r){
    // Palette SC/HUD via CSS classes: is-ok (Très stable), is-ok2 (Stable), is-mid (Variable), is-low (Instable), is-low2 (Volatile), is-unk (—)

    // "Stabilité" badge (UEX) — 5 niveaux (badge uniquement)
    // Source: r.stability100 (0..100) ou r.stabilityScore / r.stability (0..1 ou 0..100).
    const raw =
      (typeof r?.stability100 === "number" ? r.stability100 :
      (typeof r?.stabilityScore === "number" ? r.stabilityScore :
      (typeof r?.stability === "number" ? r.stability : null)));

    if(raw === null || !Number.isFinite(raw)){
      return { label: "—", cls: "is-unk", title: "Stabilité : données insuffisantes (UEX)." };
    }

    // Normalize to 0..100
    const s = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    const stab100 = Math.max(0, Math.min(100, int(s) || 0));

    if(stab100 <= 0){
      return { label: "—", cls: "is-unk", title: "Stabilité : données insuffisantes (UEX)." };
    }

    // 5-level scale (more informative than a single 'Variable')
    if(stab100 >= 80) return { label: "Très stable", cls: "is-ok",  title: `Stabilité (UEX) : ${stab100}/100 — Très stable` };
    if(stab100 >= 65) return { label: "Stable",      cls: "is-ok",  title: `Stabilité (UEX) : ${stab100}/100 — Stable` };
    if(stab100 >= 50) return { label: "Variable",    cls: "is-mid", title: `Stabilité (UEX) : ${stab100}/100 — Variable` };
    if(stab100 >= 35) return { label: "Instable",    cls: "is-low", title: `Stabilité (UEX) : ${stab100}/100 — Instable` };
    return               { label: "Volatile",    cls: "is-low", title: `Stabilité (UEX) : ${stab100}/100 — Volatile` };
  }

  async function fetchJson(url, opts = {}) {

  // ------------------------------------------------------------
  // V1.13.62 — UEX PRO Guard (cache + inflight + retry + cooldown + countdown UI)
  // ------------------------------------------------------------
  const __UEX_GUARD = (window.__UEX_GUARD ||= {
    cache:new Map(),          // url -> {ts,data}
    inflight:new Map(),       // url -> Promise
    cooldownUntil:0,
    timer:null
  });

  function __uexNow(){ return Date.now(); }

  function __uexGetEls(){
    return {
      top3: document.getElementById("top3Row"),
      list: document.getElementById("advGoodsList"),
      analyzeBtn: document.getElementById("advRouteAnalyze"),
      calcBtn: document.getElementById("advCalculate") || document.getElementById("advCalc") || null
    };
  }

  function __uexSetTop3Message(html){
    const els = __uexGetEls();
    if(els.top3) els.top3.innerHTML = html;
  }

  function __uexSetListMessage(html){
    const els = __uexGetEls();
    if(els.list) els.list.innerHTML = html;
  }

  function __uexSetButtonsDisabled(disabled){
    const els = __uexGetEls();
    for(const b of [els.analyzeBtn, els.calcBtn]){
      if(!b) continue;
      b.disabled = !!disabled;
      b.classList.toggle("is-disabled", !!disabled);
    }
  }

  function __uexStartCooldown(seconds){
    const until = __uexNow() + (seconds*1000);
    __UEX_GUARD.cooldownUntil = Math.max(__UEX_GUARD.cooldownUntil, until);
    __uexSetButtonsDisabled(true);

    // render immediately
    const render = ()=>{
      const remMs = Math.max(0, __UEX_GUARD.cooldownUntil - __uexNow());
      const rem = Math.ceil(remMs/1000);
      if(rem <= 0){
        __uexSetButtonsDisabled(false);
        if(__UEX_GUARD.timer) { clearInterval(__UEX_GUARD.timer); __UEX_GUARD.timer=null; }
        // do not auto-fetch (avoid spam). User can click Calculer/Analyser again.
        return;
      }
      __uexSetTop3Message(`<div class="uex-cooldown">UEX en limite (429). Nouvelle tentative dans <span class="cd-time">${rem}s</span>.</div>`);
    };
    render();
    if(__UEX_GUARD.timer) clearInterval(__UEX_GUARD.timer);
    __UEX_GUARD.timer = setInterval(render, 250);
  }

  function __uexIsCooldownActive(){
    return __UEX_GUARD.cooldownUntil && __uexNow() < __UEX_GUARD.cooldownUntil;
  }

  function __uexCooldownRemaining(){
    return Math.max(0, __UEX_GUARD.cooldownUntil - __uexNow());
  }

  async function __uexParseJsonSafe(res){
    const ct = (res.headers && res.headers.get) ? (res.headers.get("content-type")||"") : "";
    try{
      if(ct.includes("application/json")) return await res.json();
      const txt = await res.text();
      try{ return JSON.parse(txt); }catch(_){ return { status:"error", message: txt || `HTTP ${res.status}` }; }
    }catch(e){
      return { status:"error", message: `HTTP ${res.status}` };
    }
  }

  function __uexLooksLike429(resStatus, payload){
    if(resStatus === 429) return true;
    const msg = String(payload && (payload.message||payload.error||payload.statusText||"") || "").toLowerCase();
    return msg.includes("429") || msg.includes("too many") || msg.includes("rate limit") || msg.includes("uex error 429");
  }

  async function __uexFetchWithRetry(url, opts){
    const delays = [0, 1500, 3000];
    let lastErr = null;

    for(let attempt=0; attempt<delays.length; attempt++){
      if(__uexIsCooldownActive()){
        const rem = __uexCooldownRemaining();
        const err = new Error("UEX_COOLDOWN");
        err.code = "UEX_COOLDOWN";
        err.cooldown_ms = rem;
        throw err;
      }

      if(delays[attempt] > 0) await new Promise(r=>setTimeout(r, delays[attempt]));
      try{
        const res = await fetch(url, { cache:"no-store", ...opts });
        const payload = await __uexParseJsonSafe(res);

        // treat UEX 429 (even wrapped in 500) as cooldown trigger
        if(!res.ok && __uexLooksLike429(res.status, payload)){
          __uexStartCooldown(30);
          const err = new Error("UEX_429");
          err.code = "UEX_429";
          err.payload = payload;
          err.http_status = res.status;
          lastErr = err;
          continue; // retry
        }

        if(!res.ok){
          const err = new Error(`HTTP ${res.status}`);
          err.code = "HTTP_ERROR";
          err.http_status = res.status;
          err.payload = payload;
          throw err;
        }

        try{ updateTechFromPayload(payload, url); }catch(_e){}
        return payload;
      }catch(e){
        lastErr = e;
        // if last attempt, throw
      }
    }
    throw lastErr || new Error("UEX_FETCH_FAILED");
  }

    // 30s cache on identical URL
    const ttl = 30000;
    const now = __uexNow();

    const cached = __UEX_GUARD.cache.get(url);
    if (cached && (now - cached.ts) < ttl) {
      return cached.data;
    }

    const inflight = __UEX_GUARD.inflight.get(url);
    if (inflight) return await inflight;

    const p = (async () => {
      try {
        const data = await __uexFetchWithRetry(url, opts);
        __UEX_GUARD.cache.set(url, { ts: __uexNow(), data });
        return data;
      } finally {
        __UEX_GUARD.inflight.delete(url);
      }
    })();

    __UEX_GUARD.inflight.set(url, p);
    return await p;
  }

  // unwrap contract v1.0 or tolerate legacy
  function unwrapV1(payload) {
    if (!payload || typeof payload !== "object") return { data: null, meta: null, warnings: [] };
    if (payload.status === "ok" && Object.prototype.hasOwnProperty.call(payload, "data")) {
      return { data: payload.data, meta: payload.meta || null, warnings: payload.warnings || [] };
    }
    return { data: payload, meta: null, warnings: [] };
  }


  // ------------------------------------------------------------
  // TECH META CAPTURE — update "Versions techniques" from ANY proxy payload
  // (No fetch monkey-patch; safest approach)
  // ------------------------------------------------------------
  function updateTechFromPayload(payload, url) {
    try {
      if (!payload || typeof payload !== "object") return;
      const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
      const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : null;

      const workerVersion = data.workerVersion || payload.workerVersion || null;
      const contractVersion = data.contractVersion || payload.contractVersion || null;
      const gameVersion = data.defaultGameVersion || data.gameVersion || payload.defaultGameVersion || payload.gameVersion || null;
      const generatedAt = meta?.generatedAt || data.generatedAt || payload.generatedAt || null;

      // Fill panel fields if present
      const setText = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = (val === undefined || val === null || val === "") ? "—" : String(val);
      };

      setText("tvWorkerFret", workerVersion ? `UEX Proxy ${workerVersion}` : "UEX Proxy —");
      setText("tvContractFret", contractVersion);
      setText("tvPuFret", gameVersion || TECH.pu);
      if (generatedAt) setText("tvGenFret", generatedAt);
      setText("tvEndpointFret", "—");
setText("tvSourceFret", sanitizeSourceLabel("last-worker-response"));

      // Update main bar pill if present
      const mainText = document.getElementById("versionMainText");
      if (mainText) mainText.textContent = `${TECH.module} ${TECH.moduleVersion} • PU ${gameVersion || TECH.pu || "—"}`;
      const barPu = document.getElementById("techBarPUFret");
      if (barPu) barPu.textContent = gameVersion || TECH.pu || "—";

    } catch (_) {}
  }

  // ------------------------------------------------------------
  // STATE (persist minimal)
  // ------------------------------------------------------------
  const state = {
  ui: { showAdvFromSuggest: false, showAdvToSuggest: false },
    tab: "beginner", // beginner|advanced
    beginner: { minutes: 25 },
    advanced: {
      fromName: "",
      toName: "",
      budget: 500000,
      lockedCommodity: "",
      risk: "low", // low|mid|high
    },
    terminalsCache: { ts: 0, q: "", items: [] },
    assisted: {
      lastRoutes: [],
      lastRoutesRaw: [],
      lastScan: null,
      active: false, // indicates list currently showing assisted routes
    },
    routeCache: {
      lastResultsRaw: [],
      lastResults: [],
      lastMeta: null,
      lastPayload: null,
    }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object") return;

      if (s.tab === "advanced") state.tab = "advanced";
      if (s.beginner?.minutes) state.beginner.minutes = int(s.beginner.minutes) || 25;

      if (s.advanced) {
        state.advanced.fromName = String(s.advanced.fromName || "");
        state.advanced.toName = String(s.advanced.toName || "");
        state.advanced.budget = num(s.advanced.budget || 500000) || 500000;
        state.advanced.lockedCommodity = String(s.advanced.lockedCommodity || "");
        state.advanced.risk = (s.advanced.risk === "high" || s.advanced.risk === "mid" || s.advanced.risk === "low")
          ? s.advanced.risk
          : "low";
      }
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        tab: state.tab,
        beginner: { minutes: int($("loopMinutes")?.value || state.beginner.minutes || 25) },
        advanced: {
          fromName: ($("advRouteFrom")?.value || state.advanced.fromName || "").trim(),
          toName: ($("advRouteTo")?.value || state.advanced.toName || "").trim(),
          budget: num($("advBudget")?.value || state.advanced.budget || 0),
          lockedCommodity: state.advanced.lockedCommodity || "",
          risk: state.advanced.risk || "low",
        },
      }));
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // TABS (Beginner/Advanced)
  // ------------------------------------------------------------
  function showBeginner() {
    $("panelBeginner")?.classList.remove("is-hidden");
    $("panelAdvanced")?.classList.add("is-hidden");

    $("tabBeginner")?.classList.add("is-active");
    $("tabAdvanced")?.classList.remove("is-active");

    $("tabBeginner")?.setAttribute("aria-selected", "true");
    $("tabAdvanced")?.setAttribute("aria-selected", "false");

    state.tab = "beginner";
    saveState();
  }

  function showAdvanced() {
    $("panelAdvanced")?.classList.remove("is-hidden");
    $("panelBeginner")?.classList.add("is-hidden");

    $("tabAdvanced")?.classList.add("is-active");
    $("tabBeginner")?.classList.remove("is-active");

    $("tabAdvanced")?.setAttribute("aria-selected", "true");
    $("tabBeginner")?.setAttribute("aria-selected", "false");

    state.tab = "advanced";
    saveState();

    autoLoadAdvancedTopRoutes();
  }

  // Auto Top Routes when entering Advanced:
  // - triggers only if no cached routes
  // - debounced (min 15s) to avoid spam
  // - does NOT lock permanently if previous fetch returned 0 routes
  let __autoTopLastAt = 0;
  async function autoLoadAdvancedTopRoutes(){
    const now = Date.now();
    if (now - __autoTopLastAt < 15000) return;

    // Respect cooldown (429 guard)
    if (typeof __uexIsCooldownActive === "function" && __uexIsCooldownActive()){
      return;
    }

    const raw = Array.isArray(state?.assisted?.lastRoutesRaw) ? state.assisted.lastRoutesRaw : [];
    if (raw.length) return;

    const shipScu = num($("advUsableScu")?.value || 0);
    if (shipScu <= 0) return;

    __autoTopLastAt = now;
    try{
      await fetchTopRoutes({ reason: "auto-open" });
      // If still empty, allow a re-try later (by time debounce), no permanent lock.
      const after = Array.isArray(state?.assisted?.lastRoutesRaw) ? state.assisted.lastRoutesRaw : [];
      if (!after.length) __autoTopLastAt = now; // keep debounce only
    }catch(_){
      // silent
    }
  }


  function initTabs() {
    $("tabBeginner")?.addEventListener("click", showBeginner);
    $("tabAdvanced")?.addEventListener("click", showAdvanced);
  }

  // ------------------------------------------------------------
  // SHIPS (ships_v2.json) — Beginner picker + Advanced picker
  // ------------------------------------------------------------
  function shipsUrls() {
    return [
      "../assets/data/ships_v2.json",
      "./assets/data/ships_v2.json",
      "assets/data/ships_v2.json",
      "/assets/data/ships_v2.json",
    ];
  }

  let shipsCatalog = [];

  function normalizeShipRow(r) {
    const id = String(r?.id ?? r?.slug ?? r?.key ?? r?.name ?? "").trim();
    const name = String(r?.name ?? r?.display ?? "").trim();
    const scu = num(r?.scu ?? r?.cargo_scu ?? r?.cargo ?? 0);
    return { id: id || name, name, scu };
  }

  async function loadShipsCatalog() {
    let data = null;
    for (const u of shipsUrls()) {
      try {
        const abs = new URL(u, window.location.href).toString();
        const res = await fetch(abs, { cache: "no-store" });
        if (!res.ok) continue;
        data = await res.json();
        if (data) break;
      } catch (_) {}
    }
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.ships) ? data.ships : []);
    shipsCatalog = rows.map(normalizeShipRow).filter(s => s.name);
    return shipsCatalog;
  }

  function setPickerMeta(metaId, txt) {
    const el = $(metaId);
    if (el) el.textContent = txt || "";
  }

  function syncSelectToTrigger(selectId, triggerId) {
    const sel = $(selectId);
    const trg = $(triggerId);
    if (!sel || !trg) return;
    const opt = sel.selectedOptions?.[0];
    trg.textContent = opt ? (opt.textContent || "—") : "—";
  }

  function openMenu(menuId, triggerId) {
    const menu = $(menuId);
    const trg = $(triggerId);
    if (!menu || !trg) return;
    menu.classList.remove("is-hidden");
    trg.setAttribute("aria-expanded", "true");
  }

  function closeMenu(menuId, triggerId) {
    const menu = $(menuId);
    const trg = $(triggerId);
    if (!menu || !trg) return;
    menu.classList.add("is-hidden");
    trg.setAttribute("aria-expanded", "false");
  }

  function fillPickerList(listId, selectId, triggerId, ships) {
    const root = $(listId);
    const sel = $(selectId);
    if (!root || !sel) return;

    const cur = sel.value || "";
    root.innerHTML = "";

    ships.forEach(s => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ship-picker-item" + ((s.id === cur || s.name === cur) ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.innerHTML = `
        <div class="ship-picker-name">${escapeHtml(s.name)}</div>
        <div class="ship-picker-sub">Cargo: ${int(s.scu)} SCU</div>
      `;
      btn.addEventListener("click", () => {
        sel.value = s.id;
        syncSelectToTrigger(selectId, triggerId);

        const isBeginner = (selectId === "shipSelect");
        closeMenu(isBeginner ? "shipPickerMenu" : "advShipPickerMenu", triggerId);

        if (isBeginner) {
          if ($("cargoScu") && int(s.scu) > 0) $("cargoScu").value = String(int(s.scu));
          computeBeginner();
        } else {
          if ($("advUsableScu") && int(s.scu) > 0) $("advUsableScu").value = String(int(s.scu));
        }

        saveState();
      });
      root.appendChild(btn);
    });
  }

  function initPicker({ selectId, triggerId, menuId, searchId, metaId, listId }) {
    const sel = $(selectId);
    const trg = $(triggerId);
    const menu = $(menuId);
    const search = $(searchId);

    if (!sel || !trg || !menu) return;

    trg.addEventListener("click", () => {
      const isOpen = !menu.classList.contains("is-hidden");
      if (isOpen) closeMenu(menuId, triggerId);
      else {
        openMenu(menuId, triggerId);
        search?.focus();
      }
    });

    document.addEventListener("click", (e) => {
      const box = trg.closest(".ship-picker") || trg.parentElement;
      if (!box) return;
      if (menu.classList.contains("is-hidden")) return;
      if (box.contains(e.target)) return;
      closeMenu(menuId, triggerId);
    });

    search?.addEventListener("input", () => {
      const q = (search.value || "").trim().toLowerCase();
      const filtered = !q ? shipsCatalog : shipsCatalog.filter(s => s.name.toLowerCase().includes(q));
      fillPickerList(listId, selectId, triggerId, filtered);
      setPickerMeta(metaId, `Ships: ${filtered.length}`);
    });
  }

  function populateNativeSelect(selectId) {
    const sel = $(selectId);
    if (!sel) return;

    sel.innerHTML = "";
    const base = document.createElement("option");
    base.value = "";
    base.textContent = "—";
    sel.appendChild(base);

    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom";
    sel.appendChild(custom);

    shipsCatalog.forEach(s => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name;
      o.setAttribute("data-scu", String(int(s.scu)));
      sel.appendChild(o);
    });

    if (!sel.value) {
      const pref = shipsCatalog.find(x => /c2|hercules|taurus|freelancer|max|raft|caterpillar/i.test(x.name)) || shipsCatalog[0];
      if (pref) sel.value = pref.id;
    }
  }

  // ------------------------------------------------------------
  // CARGO TYPE picker (beginner) — minimal sync
  // ------------------------------------------------------------
  function initCargoTypePicker() {
    const select = $("cargoType");
    const trigger = $("cargoTypePickerTrigger");
    const menu = $("cargoTypePickerMenu");
    const list = $("cargoTypePickerList");
    if (!select || !trigger || !menu || !list) return;

    function refreshTrigger() {
      const opt = select.selectedOptions?.[0];
      trigger.textContent = opt ? (opt.textContent || "—") : "—";
    }

    function open() { menu.classList.remove("is-hidden"); trigger.setAttribute("aria-expanded", "true"); }
    function close() { menu.classList.add("is-hidden"); trigger.setAttribute("aria-expanded", "false"); }

    trigger.addEventListener("click", () => {
      const isOpen = !menu.classList.contains("is-hidden");
      if (isOpen) close(); else open();
    });

    document.addEventListener("click", (e) => {
      const box = trigger.closest(".ship-picker") || trigger.parentElement;
      if (!box) return;
      if (menu.classList.contains("is-hidden")) return;
      if (box.contains(e.target)) return;
      close();
    });

    list.innerHTML = "";
    Array.from(select.options).forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ship-picker-item";
      btn.innerHTML = `<div class="ship-picker-name">${escapeHtml(opt.textContent || "")}</div>`;
      btn.addEventListener("click", () => {
        select.value = opt.value;
        refreshTrigger();
        close();
        computeBeginner();
        saveState();
      });
      list.appendChild(btn);
    });

    refreshTrigger();
  }

  // ------------------------------------------------------------
  // BEGINNER: manual calculator
  // ------------------------------------------------------------
  function setKpi(id, value) {
    const el = $(id);
    if (!el) return;
    el.textContent = value;
  }

  function setVerdict(text, meta, risky = false) {
    if ($("verdictText")) $("verdictText").textContent = text || "—";
    if ($("verdictMeta")) $("verdictMeta").textContent = meta || "—";
    if ($("riskBadge")) $("riskBadge").classList.toggle("is-hidden", !risky);
  }

  function computeBeginner() {
    const scu = num($("cargoScu")?.value || 0);
    const buy = num($("buyPrice")?.value || 0);
    const sell = num($("sellPrice")?.value || 0);
    const minutes = clamp(int($("loopMinutes")?.value || 25), 1, 9999);
    const target = num($("targetPerHour")?.value || 0);

    const invest = scu * buy;
    const revenue = scu * sell;
    const profit = revenue - invest;
    const perHour = profit * (60 / minutes);

    setKpi("kpiInvest", fmt(invest));
    setKpi("kpiRevenue", fmt(revenue));
    setKpi("kpiProfit", fmt(profit));
    setKpi("kpiProfitHour", fmt(perHour));

    if (scu <= 0 || buy <= 0 || sell <= 0) {
      setVerdict("Complète les paramètres (SCU + prix).", "—", false);
      return;
    }

    const marginPerScu = sell - buy;
    const isRisky = marginPerScu > 0 && marginPerScu / Math.max(1, buy) > 0.25;
    const ok = target > 0 ? perHour >= target : perHour > 0;

    if (profit <= 0) {
      setVerdict("Non rentable.", `Profit/trajet: ${fmt0(profit)} • ${minutes} min`, true);
      return;
    }

    if (target > 0) {
      setVerdict(ok ? "Objectif atteint." : "Sous l’objectif.",
        `Profit/h: ${fmt0(perHour)} • Objectif: ${fmt0(target)} • ${minutes} min`, isRisky);
    } else {
      setVerdict("Rentable.", `Profit/h: ${fmt0(perHour)} • ${minutes} min`, isRisky);
    }
  }


  // ---------------------------
// Support: Versions techniques (FRET) — style MINING (grille + copie)
// ---------------------------
async function initVersionFooterFret() {
  const toggleBtn = document.getElementById("versionToggle");
  const details = document.getElementById("versionDetails");
  const copyBtn = document.getElementById("copyVersionsBtn");
  const mainText = document.getElementById("versionMainText");

  if (!toggleBtn || !details) return;

  const cssVar = (name) => {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v.replace(/^["']|["']$/g, "");
    } catch (_) { return ""; }
  };

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = (val == null || val === "") ? "—" : String(val);
  };

  const setOpen = (open) => {
    details.classList.toggle("is-hidden", !open);
    toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    const cta = toggleBtn.querySelector(".version-cta");
    if (cta) cta.textContent = open ? "Masquer" : "Détails";
  };

  toggleBtn.addEventListener("click", () => {
    const open = details.classList.contains("is-hidden");
    setOpen(open);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !details.classList.contains("is-hidden")) setOpen(false);
  });

  // Base versions (local)
  const local = {
    module: `${TECH.module} ${TECH.moduleVersion}`,
    html: TECH.html,
    css: TECH.css,
    js: TECH.js,
    core: TECH.core,
    ships: TECH.ships,
    pu: TECH.pu,
  };
  // Fill immediately (no network dependency)
  setText("tvModuleFret", local.module);
  setText("tvHtmlFret", local.html);
  setText("tvCssFret", local.css);
  setText("tvJsFret", local.js);
  setText("tvCoreFret", local.core);
  setText("tvShipsFret", local.ships);
  setText("tvPuFret", local.pu);

  // Worker meta (best-effort) — use the proxy base (no PROXY_BASE dependency)
  let meta = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort("timeout"), 4500);
    try {
      const res = await fetch(`${PROXY_BASE}/meta`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (res.ok) meta = await res.json();
    } catch(e) {
      clearTimeout(t);
      throw e;
    }
  } catch(e) {
    meta = { error: String(e?.message || e) };
  }

  const mdata = meta?.data || meta || null;
  const workerVersion = mdata?.workerVersion || null;
  const contractVersion = mdata?.contractVersion || null;
  const defaultGameVersion = mdata?.defaultGameVersion || mdata?.gameVersion || null;
  const generatedAt = mdata?.meta?.generatedAt || mdata?.generatedAt || null;

  setText("tvWorkerFret", workerVersion ? `UEX Proxy ${workerVersion}` : "UEX Proxy —");
  setText("tvContractFret", contractVersion);
  setText("tvEndpointFret", "—");
setText("tvSourceFret", sanitizeSourceLabel(meta?.error ? "meta-error" : "worker-meta"));
  if (generatedAt) setText("tvGenFret", generatedAt);
  // Main bar text
  const pu = defaultGameVersion || local.pu || "";
  if (mainText) {
    mainText.textContent = `${TECH.module} ${TECH.moduleVersion} • PU ${pu || "—"}`;
  }

  // Copy block (Discord-friendly, same shape as MINING)
  const getCopyText = () => {
    const lines = [];
    lines.push(`${TECH.module} ${TECH.moduleVersion}`);
    lines.push(`PU ${pu || "—"}`);
    lines.push("");
    lines.push(`Core: ${local.core || "—"}`);
    lines.push(`Ships: ${local.ships || "—"}`);
    lines.push(`HTML: ${local.html}`);
    lines.push(`CSS: ${local.css || "—"}`);
    lines.push(`JS: ${TECH.js || VERSION}`);
    lines.push(`Worker: ${workerVersion || "—"}`);
    lines.push(`Contract: ${contractVersion || "—"}`);
    if (generatedAt) lines.push(`Meta: ${generatedAt}`);
return lines.join("\n");
  };

  const fallbackCopy = (text) => {
    const ta = document.getElementById("versionsCopyBuffer");
    if (!ta) return false;
    ta.value = text;
    ta.focus();
    ta.select();
    try { return document.execCommand("copy"); } catch { return false; }
  };

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = getCopyText();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copié";
          setTimeout(() => (copyBtn.textContent = "Copier"), 1200);
        } else {
          const ok = fallbackCopy(text);
          copyBtn.textContent = ok ? "Copié" : "Erreur";
          setTimeout(() => (copyBtn.textContent = "Copier"), 1200);
        }
      } catch {
        const ok = fallbackCopy(text);
        copyBtn.textContent = ok ? "Copié" : "Erreur";
        setTimeout(() => (copyBtn.textContent = "Copier"), 1200);
      }
    });
  }
}

  function initBeginner() {
    $qa(".quick-btn[data-min]").forEach(btn => {
      btn.addEventListener("click", () => {
        const m = int(btn.getAttribute("data-min") || 0);
        if (!m) return;
        if ($("loopMinutes")) $("loopMinutes").value = String(m);
        $qa(".quick-btn[data-min]").forEach(b => b.classList.toggle("is-active", b === btn));
        computeBeginner();
        saveState();
      });
    });

    ["cargoScu", "buyPrice", "sellPrice", "loopMinutes", "targetPerHour"].forEach(id => {
      $(id)?.addEventListener("input", () => { computeBeginner(); saveState(); });
      $(id)?.addEventListener("change", () => { computeBeginner(); saveState(); });
    });

    $("btnReset")?.addEventListener("click", () => {
      if ($("cargoScu")) $("cargoScu").value = "64";
      if ($("buyPrice")) $("buyPrice").value = "1500";
      if ($("sellPrice")) $("sellPrice").value = "1750";
      if ($("loopMinutes")) $("loopMinutes").value = "25";
      if ($("targetPerHour")) $("targetPerHour").value = "80000";
      computeBeginner();
      saveState();
    });
  }

  // ------------------------------------------------------------
  // ADVANCED: terminals + IDs + route + assisted top routes
  // ------------------------------------------------------------
  function riskHintText(r) {
    if (r === "low") return "Faible : privilégie la stabilité. Gains potentiels plus bas, moins de volatilité.";
    if (r === "high") return "Élevée : vise la perf brute. Gains potentiels plus hauts, plus risqué.";
    return "Normal : compromis stabilité / performance.";
  }

  
  function sanitizeSourceLabel(v){
    const s = (v == null) ? "" : String(v);
    if(!s) return "—";
    // Do not expose upstream "UEX OK" label to users (UX).
    if(/legacy/i.test(s)) return "UEX OK";
    return s;
  }

function setAdvText(id, v) { const el = $(id); if (el) el.textContent = v || "—"; }
  function setChip(text, warn = false) {
    const el = $("advSourceState");
    if (!el) return;
    el.textContent = sanitizeSourceLabel(text);
    el.classList.toggle("chip-warn", !!warn);
  }

  function normalizeScan(scan){
    // Accept legacy scan shapes and worker meta shapes.
    // Returns {sampledTerminals,totalTerminals,originMatched,marketsFetched}
    if (!scan) return null;

    // Some responses may wrap scan in meta
    const s = scan.meta ? scan.meta : scan;

    const total =
      (typeof s.totalTerminals === "number" ? s.totalTerminals :
      (typeof s.totalTerminalsAll === "number" ? s.totalTerminalsAll :
      (typeof s.total === "number" ? s.total :
      null)));

    const sampled =
      (typeof s.sampledTerminals === "number" ? s.sampledTerminals :
      (typeof s.sampledGlobal === "number" ? s.sampledGlobal :
      (typeof s.sampled === "number" ? s.sampled :
      null)));

    const originMatched = (typeof s.originMatched === "number" ? s.originMatched : null);
    const marketsFetched = (typeof s.marketsFetched === "number" ? s.marketsFetched : null);

    // Fallback: if sampled is missing but marketsFetched exists, use it for the "scan" numerator
    const sampled2 = (sampled == null && marketsFetched != null) ? marketsFetched : sampled;

    return {
      sampledTerminals: sampled2,
      totalTerminals: total,
      originMatched,
      marketsFetched
    }

  // Origin-only mode: user types a city/terminal in A, we compute best destinations (Top routes with origin=...).
  async function findDestinationsFromOrigin({ reason = "origin-ab" } = {}){
    const fromQ = ($("advRouteFrom")?.value || "").trim();
    if (!fromQ || fromQ.length < 3){
      setAdvError("Entre un départ (au moins 3 caractères).");
      return;
    }

    // Clear commodity search to avoid filtering everything out unintentionally
    const goodsInput = $("advGoodsSearch") || $("advCommoditySearch") || null;
    if (goodsInput) goodsInput.value = "";
    state.advanced.goodsSearch = "";

    // Also clear city filter input if it exists; server-side origin will handle the filter
    const originInput = $("advOrigin");
    if (originInput) originInput.value = fromQ;

    try{
      await fetchTopRoutes({ reason, originOverride: fromQ });
    }catch(_){}
  }

  let __originFromTimer = null;
  function wireOriginFromAB(){
    const input = $("advRouteFrom");
    const btn = $("advRouteAnalyze");
    if (!input) return;

    btn?.addEventListener("click", () => findDestinationsFromOrigin({ reason: "origin-button" }));

    input.addEventListener("input", () => {
      if (__originFromTimer) clearTimeout(__originFromTimer);
      __originFromTimer = setTimeout(() => {
        const v = (input.value || "").trim();
        if (v.length >= 3) findDestinationsFromOrigin({ reason: "origin-live" });
      }, 450);
    });
  }

  // Safe wiring: do NOT hijack the Analyze button.
  // Only triggers origin-only suggestions while typing in A, and only when B is empty.
  function wireOriginFromABSafe(){
    const input = $("advRouteFrom");
    const toInput = $("advRouteTo");
    if (!input) return;

    input.addEventListener("input", () => {
      if (__originFromTimer) clearTimeout(__originFromTimer);
      __originFromTimer = setTimeout(() => {
        const v = (input.value || "").trim();
        const toV = (toInput?.value || "").trim();
        if (v.length >= 3 && !toV) findDestinationsFromOrigin({ reason: "origin-live" });
      }, 450);
    });
  }


  function wireABExactToggle(){
    const t = $("advABExactToggle");
    const wrap = $("advABExactWrap");
    if (!t || !wrap) return;

    t.addEventListener("click", () => {
      const isHidden = wrap.hasAttribute("hidden");
      if (isHidden) wrap.removeAttribute("hidden");
      else wrap.setAttribute("hidden","hidden");
    });

    $("advRouteAnalyzeExact")?.addEventListener("click", () => {
      if (typeof analyzeRouteAdvanced === "function") analyzeRouteAdvanced();
      else setAdvError("Analyse exacte indisponible.");
    });
  }

;
  }


  function setSortStatus() {
    const el = $("advRouteStatus");
    if (!el) return;
    const mode = ($("advSort")?.value || "score");
    // Append a tiny suffix to show tri is applied (useful when ordering doesn't visibly change)
    const base = (el.textContent || "").split(" • Tri:")[0];
    el.textContent = `${base} • Tri: ${mode}`;
  }


  function renderTop3(results) {
    const row = $("top3Row");
    if (!row) return;

    if (!Array.isArray(results) || results.length === 0) {
      row.innerHTML = `<div class="empty">Aucun résultat.</div>`;
      return;
    }

    row.innerHTML = results.slice(0, 3).map(r => {
      const profit = num(r.profitTotal ?? 0);
      const pscu = num(r.profitPerSCU ?? 0);
      const qty = int(r.quantitySCU ?? 0);
      const commodity = r.commodity || "—";
      return `
        <div class="top3-card goods-item" data-commodity="${escapeHtml(commodity)}">
          <div class="goods-name">${escapeHtml(commodity)}</div>
          <div class="goods-sub">Qté: ${qty} SCU • +${fmt0(pscu)}/SCU</div>
          <div class="goods-sub stab-line">Score: <span class="score-pill ${scoreClass(score100(r))}">${fmt0(score100(r))}</span>/100 <span class="stab-badge ${stabMeta(r).cls}" title="${escapeHtml(stabMeta(r).title)}">${escapeHtml(stabMeta(r).label)}</span></div>
          <div class="goods-profit">+${fmt0(profit)} aUEC</div>
        </div>
      `;
    }).join("");

    $qa(".top3-card.goods-item", row).forEach(card => {
      card.addEventListener("click", () => {
        const c = (card.getAttribute("data-commodity") || "").trim();
        if (c) lockCommodity(c);
      });
    });
  }

  // ---- goods search (client-side filter) ----
  let advGoodsAll = [];
  let advAnalyzeInFlight = false;

  function normStr(s){
    try{
      return (s||"").toString().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    }catch(_){
      return (s||"").toString().toLowerCase();
    }
  }

  function filterGoodsByQuery(all, q){
    const query = normStr(q).trim();
    if (!query) return all;
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return all;

    return all.filter(r => {
      const hay = normStr(`${r.commodity||""}`);
      return tokens.every(t => hay.includes(t));
    });
  }
  function filterRoutesByCommodity(allRoutes, q){
    const query = normStr(q).trim();
    if (!query) return allRoutes;
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return allRoutes;

    return (allRoutes || []).filter(r => {
      const hay = normStr(`${r?.commodity || ""}`);
      return tokens.every(t => hay.includes(t));
    });
  }

  function bestCommodityLabel(allRoutes, q){
    const query = normStr(q).trim();
    if (!query) return "";
    // If user typed partial, try to pick the closest commodity label from current routes
    const set = new Map();
    (allRoutes || []).forEach(r => {
      const c = (r?.commodity || "").trim();
      if (c) set.set(normStr(c), c);
    });
    // exact match
    if (set.has(query)) return set.get(query);
    // contains match
    for (const [k, v] of set.entries()){
      if (k.includes(query)) return v;
    }
    return "";
  }

  let advCommoditySearchInFlight = false;
  let advCommodityLastQuery = "";
  let advCommodityLastRunTs = 0;


  let goodsSearchTimer = null;
  function wireGoodsSearch(){
    const input = $("advSearch");
    const clear = $("advSearchClear");

    const apply = async () => {
      const q = (input?.value || "").trim();

      // If user searches a commodity BEFORE running analysis/suggestions:
      // run a global scan and filter routes by commodity automatically.
      if (q){
        const now = Date.now();
        const needScan = !Array.isArray(state?.assisted?.lastRoutesRaw) || state.assisted.lastRoutesRaw.length === 0 || (now - (advCommodityLastRunTs || 0) > 120000);

        // Avoid spamming the proxy on every keystroke
        if (!advCommoditySearchInFlight && (needScan || advCommodityLastQuery !== q)){
          advCommoditySearchInFlight = true;
          advCommodityLastQuery = q;
          try{
            // If we already have routes cached, just filter and render without calling the proxy.
            if (!needScan){
              const routesRaw = Array.isArray(state.assisted.lastRoutesRaw) ? state.assisted.lastRoutesRaw : [];
              const routes = sortItems(routesRaw, getAdvSort());
              const routesFiltered = filterRoutesByCommodity(routes, q);
              unlockCommodity();
              const lbl = bestCommodityLabel(routes, q) || q;
              lockCommodity(lbl);
              renderTopRoutes(routesFiltered, state.assisted.lastScan || null);
              setAdvText("advCount", `${routesFiltered.length} / ${routes.length} routes`);
              setAdvText("advRouteStatus", `OK • ${routesFiltered.length} routes (filtré)`);
            } else {
              advCommodityLastRunTs = now;
              await fetchTopRoutes({ commodityQuery: q });
            }
          } finally {
            advCommoditySearchInFlight = false;
          }
          return;
        }

        // If list already displayed, keep live filtering locally.
        if (Array.isArray(advGoodsAll) && advGoodsAll.length){
          const filtered = filterGoodsByQuery(advGoodsAll, q);
          return renderGoodsList(filtered, true);
        }
      }

      // Empty query: restore full views
      if (!q){
        unlockCommodity();
        if (Array.isArray(state?.assisted?.lastRoutesRaw) && state.assisted.lastRoutesRaw.length){
          const routes = sortItems(state.assisted.lastRoutesRaw, getAdvSort());
          renderTopRoutes(routes, state.assisted.lastScan || null);
          setAdvText("advCount", `${routes.length} routes`);
        } else if (Array.isArray(advGoodsAll) && advGoodsAll.length){
          renderGoodsList(advGoodsAll, true);
        }
      }
    };

    let t = null;
    if (input){
      input.addEventListener("input", () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => { apply(); }, 250);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter"){
          e.preventDefault();
          apply();
        }
        if (e.key === "Escape"){
          input.value = "";
          apply();
          input.blur();
        }
      });
    }

    if (clear){
      clear.addEventListener("click", () => {
        if (input) input.value = "";
        apply();
        input && input.focus();
      });
    }
  }

  /* -----------------------------
     Advanced: Origin (city) live filter
  ------------------------------ */
  function extractCity(name){
    const s = (name || "—").toString().trim();
    if (!s || s === "—") return "—";
    // Heuristic: take first chunk before separators commonly used in terminal labels
    const parts = s.split(/\s[-–—|\/•:]\s|\s\(|\s\[|\s\{/).filter(Boolean);
    const city = (parts[0] || s).trim();
    return city || s;
  }

  function filterRoutesByOrigin(list, query){
    const q = normStr(query).trim();
    if (!q) return list;
    return (list || []).filter(r => {
      const fromName = (r?.from?.name || "").toString();
      const fromCity = extractCity(fromName);
      const a = normStr(fromName);
      const b = normStr(fromCity);
      return a.includes(q) || b === q || b.includes(q);
    });
  }

  function updateCitiesDatalistFromRoutes(routes){
    const dl = $("advCitiesDatalist");
    if (!dl) return;
    const set = new Set();

    (routes || []).forEach(r => {
      const fromName = (r?.from?.name || "").toString();
      const city = extractCity(fromName);
      if (city && city !== "—") set.add(city);
    });

    const cities = Array.from(set).sort((a,b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
    dl.innerHTML = cities.map(c => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  let advOriginSearchTimer = null;
  async function applyOriginAndCommodityFilters(sourceRoutes, scanMeta){
    const oq = ($("advOrigin")?.value || "").trim();
    const q  = ($("advSearch")?.value || "").trim();

    const sorted = sortItems(sourceRoutes || [], getAdvSort());
    let shown = oq ? filterRoutesByOrigin(sorted, oq) : sorted;
    shown = q ? filterRoutesByCommodity(shown, q) : shown;

    // Commodity lock (optional, consistent with existing behavior)
    if (q){
      unlockCommodity();
      const lbl = bestCommodityLabel(sorted, q) || q;
      lockCommodity(lbl);
      setAdvText("advCount", `${shown.length} / ${sorted.length} routes`);
      setAdvText("advRouteStatus", `OK • ${shown.length} routes (filtré)`);
    } else if (oq){
      unlockCommodity();
      setAdvText("advCount", `${shown.length} / ${sorted.length} routes`);
      setAdvText("advRouteStatus", `OK • ${shown.length} routes (filtré)`);
    } else {
      setAdvText("advCount", `${shown.length} routes`);
    }

    renderTopRoutes(shown, scanMeta || null);
    try { setSortStatus(); } catch (_){}
  }

  function wireOriginSearch(){
    const input = $("advOrigin");
    const clear = $("advOriginClear");
    if (!input) return;

    const apply = async () => {
      const oq = (input.value || "").trim();
      // If user filters by origin BEFORE any scan has run, run one global scan.
      const hasCache = Array.isArray(state?.assisted?.lastRoutesRaw) && state.assisted.lastRoutesRaw.length > 0;

      if (oq && !hasCache){
        await fetchTopRoutes({ reason: "origin-filter" });
        return;
      }

      // Otherwise apply filters locally from cache
      if (hasCache){
        await applyOriginAndCommodityFilters(state.assisted.lastRoutesRaw, state.assisted.lastScan || null);
      }
    };

    input.addEventListener("input", () => {
      if (advOriginSearchTimer) clearTimeout(advOriginSearchTimer);
      advOriginSearchTimer = setTimeout(() => { apply(); }, 220);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        apply();
      }
      if (e.key === "Escape"){
        input.value = "";
        apply();
        input.blur();
      }
    });

    if (clear){
      clear.addEventListener("click", () => {
        input.value = "";
        apply();
        try { input.focus(); } catch(_){}
      });
    }
  }




  function renderGoodsList(results, isFiltered=false) {
    const list = $("advGoodsList");
    if (!list) return;

    const empty = $("advGoodsEmpty");
    if (!Array.isArray(results) || results.length === 0) {
      if (empty) empty.textContent = "Analyse une route pour afficher les résultats.";
      return;
    }
    if (empty) empty.remove();

    // Keep a copy of the full dataset for client-side search
    if (!isFiltered) advGoodsAll = Array.isArray(results) ? results.slice() : [];

    // Auto-apply search query if present
    const __q = ($("advSearch")?.value || "").trim();
    if (!isFiltered && __q){
      const __filtered = filterGoodsByQuery(advGoodsAll, __q);
      return renderGoodsList(__filtered, true);
    }

    const locked = (state.advanced.lockedCommodity || "").toLowerCase();

    list.innerHTML = results.map(r => {
      const commodity = r.commodity || "—";
      const profit = num(r.profitTotal ?? 0);
      const pscu = num(r.profitPerSCU ?? 0);
      const qty = int(r.quantitySCU ?? 0);
      const spend = num(r.spend ?? 0);
      const isLocked = locked && commodity.toLowerCase() === locked;

      return `
        <div class="goods-item ${isLocked ? "is-locked" : ""}" role="listitem" data-commodity="${escapeHtml(commodity)}">
          <div class="goods-left">
            <div class="goods-name">${escapeHtml(commodity)}</div>
            <div class="goods-sub">Qté: ${qty} SCU • Achat: ${fmt0(spend)} • +${fmt0(pscu)}/SCU</div>
          </div>
          <div class="goods-right">
            <div class="goods-profit">+${fmt0(profit)}</div>
            <div class="goods-sub">aUEC</div>
          </div>
        </div>
      `;
    }).join("");

    $qa(".goods-item", list).forEach(item => {
      item.addEventListener("click", () => {
        const c = (item.getAttribute("data-commodity") || "").trim();
        if (c) lockCommodity(c);
      });
    });

    const total = Array.isArray(advGoodsAll) ? advGoodsAll.length : results.length;
    const suffix = total && total !== results.length ? ` (${results.length}/${total})` : "";
    setAdvText("advCount", `${results.length} résultats${suffix}`);
  }

  function showLocked(name) {
    $("advLockedBar")?.classList.remove("is-hidden");
    setAdvText("advLockedName", name);
  }

  function hideLocked() {
    $("advLockedBar")?.classList.add("is-hidden");
    setAdvText("advLockedName", "—");
  }

  function lockCommodity(name) {
    const n = (name || "").trim();
    if (!n) return;
    state.advanced.lockedCommodity = n;
    showLocked(n);

    const list = $("advGoodsList");
    if (list) {
      $qa(".goods-item", list).forEach(el => {
        const c = (el.getAttribute("data-commodity") || "").trim().toLowerCase();
        el.classList.toggle("is-locked", c === n.toLowerCase());
      });
    }
    saveState();
  }

  function unlockCommodity() {
    state.advanced.lockedCommodity = "";
    hideLocked();
    const list = $("advGoodsList");
    if (list) $qa(".goods-item", list).forEach(el => el.classList.remove("is-locked"));
    saveState();
  }

  // ---- terminal search (datalist) ----
  let termTimer = null;

  async function advSearchTerminals(q) {
    const query = (q || "").trim();
    if (query.length < 2) {
      setAdvText("advTermCount", "Terminaux : —");
      $("advTerminalsDatalist") && ($("advTerminalsDatalist").innerHTML = "");
      return [];
    }

    if (state.terminalsCache.q === query && (Date.now() - state.terminalsCache.ts) < 20_000) {
      // renderTermDatalist(state.terminalsCache.items); // disabled (single menu)
      setAdvText("advTermCount", `Terminaux : ${state.terminalsCache.items.length}`);
      return;
    return state.terminalsCache.items || [];
    }

    const url = `${PROXY_BASE}/v1/hauling/terminals/search?q=${encodeURIComponent(query)}&game_version=${encodeURIComponent(GAME_VERSION)}`;
    const payload = await fetchJson(url);
    const { data } = unwrapV1(payload);
    const terminals = Array.isArray(data?.terminals) ? data.terminals : [];

    state.terminalsCache.ts = Date.now();
    state.terminalsCache.q = query;
    state.terminalsCache.items = terminals;

    // renderTermDatalist(terminals); // disabled (single menu)
    setAdvText("advTermCount", `Terminaux : ${terminals.length}`);

    return terminals;
  }

  

function hideTermSuggest(which){
  const box = document.getElementById(which);
  if (!box) return;
  box.classList.add("is-hidden");
  box.innerHTML = "";
}

function renderTermSuggest(inputEl, items){
  if (!inputEl) return;
  const isFrom = inputEl.id === "advRouteFrom";
  const boxId = isFrom ? "advFromSuggest" : "advToSuggest";
  const box = document.getElementById(boxId);
  if (!box) return;

  const q = String(inputEl.value || "").trim().toLowerCase();
  if (q.length < 2){
    hideTermSuggest(boxId);
    return;
  }

  const list = Array.isArray(items) ? items : [];
  const filtered = list
    .filter(t => String(t?.name || "").toLowerCase().includes(q))
    .slice(0, 8);

  box.innerHTML = "";

  if (!filtered.length){
    box.innerHTML = `<div class="term-empty">Aucun terminal correspondant.</div>`;
    box.classList.remove("is-hidden");
    return;
  }

  filtered.forEach(t => {
    const name = String(t?.name || "").trim();
    const city = String(t?.city || "").trim();
    const system = String(t?.system || "").trim();
    const type = String(t?.type || "").trim();
    const meta = [city, system].filter(Boolean).join(" • ");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "term-item";
    btn.setAttribute("data-term-id", String(t?.id_terminal || ""));
    btn.setAttribute("data-term-name", name);

    // render
    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "2px";

    const main = document.createElement("div");
    main.className = "term-main";
    main.textContent = name;

    const sub = document.createElement("div");
    sub.className = "term-meta";
    sub.textContent = [meta, type].filter(Boolean).join(" • ");

    left.appendChild(main);
    left.appendChild(sub);

    btn.appendChild(left);

    btn.addEventListener("click", () => {
      inputEl.value = name;
      inputEl.setAttribute("data-terminal-id", String(t?.id_terminal || ""));
      hideTermSuggest(boxId);
      try { saveState(); } catch(_){}

      // TOP3_ORIGIN_LIVE: if user picked a Departure (A) and Arrival is empty,
      // refresh Top 3 + list for that origin without requiring an extra click.
      try{
        const id = inputEl && inputEl.id;
        const toName = (document.getElementById("advRouteTo")?.value || "").trim();
        if (id === "advRouteFrom" && !toName){
          const q = (document.getElementById("advSearch")?.value || "").trim();
          setAdvText("advRouteStatus", "Scan routes depuis A…");
          fetchTopRoutes({ originOverride: name, commodityQuery: q, reason: "origin-pick" })
            .then(() => { try{ setAdvText("advRouteStatus", "OK • Scan depuis A"); }catch(_e){} })
            .catch((e) => { try{ setAdvText("advRouteStatus", `Erreur: ${String(e?.message || e)}`); }catch(_e){} });
        }
      }catch(_e){}
    });

    box.appendChild(btn);
  });

  box.classList.remove("is-hidden");
}

function renderTermDatalist(items) {
    const dl = $("advTerminalsDatalist");
    if (!dl) return;
    dl.innerHTML = "";

    const seen = new Set();
    (items || []).forEach(t => {
      const name = (t?.name || "").trim();
      if (!name) return;

      const city = (t?.city || "").trim();
      const planet = (t?.planet || "").trim();
      const system = (t?.system || "").trim();
      const type = (t?.type || "").trim();

      // Build a stable display line that avoids duplicates
      const loc = city || planet || system || "";
      const label = [name, loc ? `— ${loc}` : "", (system && loc !== system) ? `(${system})` : "", type ? `• ${type}` : ""].join(" ").replace(/\s+/g, " ").trim();
      const key = `${name}||${loc}||${system}||${type}`.toLowerCase();

      if (seen.has(key)) return;
      seen.add(key);

      const opt = document.createElement("option");
      opt.value = name;
      opt.label = label;
      dl.appendChild(opt);
    });

    // Hard cap for datalist
    while (dl.children.length > 40) dl.removeChild(dl.lastChild);
  }

  async function resolveTerminalIdByName(name) {
    const raw = String(name || "").trim();
    if (!raw) return null;

    const n = raw.toLowerCase();
    const map = state.advanced.terminalsByName || {};
    const exact = map[n];
    if (exact?.id_terminal) return exact.id_terminal ?? null;

    // Fuzzy: contains / startsWith (helps when user types partial or missing suffix)
    const terminals = state.advanced.terminals || [];
    let cand = terminals.find(t => String(t?.name || "").toLowerCase() === n);
    if (!cand) cand = terminals.find(t => String(t?.name || "").toLowerCase().startsWith(n));
    if (!cand) cand = terminals.find(t => String(t?.name || "").toLowerCase().includes(n));
    return cand?.id_terminal ?? null;
  }

  async function analyzeRouteAdvanced() {
    const btn = $("advRouteAnalyze");
    btn && (btn.disabled = true);

    try {
      state.assisted.active = false;

      setAdvText("advRouteStatus", "Résolution terminaux…");

      const fromName = ($("advRouteFrom")?.value || "").trim();
      const toName = ($("advRouteTo")?.value || "").trim();
      const shipScu = num($("advUsableScu")?.value || 0);
      const budget = num($("advBudget")?.value || $("advBudgetAuec")?.value || 0);

      if (!fromName || shipScu <= 0) {
        setAdvText("advRouteStatus", "Paramètres incomplets (A, SCU).");
        return;
      }

      // Mode "A seulement": si B est vide, on bascule sur le scan Top routes filtré par origine.
      // Objectif: permettre à l'utilisateur de sélectionner un terminal A et obtenir immédiatement les routes possibles.
      if (!toName) {
        const q = ($("advSearch")?.value || "").trim();
        setAdvText("advRouteStatus", "Scan routes depuis A…");
        await fetchTopRoutes({ originOverride: fromName, commodityQuery: q, reason: "origin-only" });
        setAdvText("advRouteStatus", "OK • Scan depuis A (mode A seulement)");
        return;
      }

      const [fromId, toId] = await Promise.all([
        resolveTerminalIdByName(fromName),
        resolveTerminalIdByName(toName),
      ]);

      if (!fromId || !toId) {
        setAdvText("advRouteStatus", "Terminaux invalides (utilise l’autocomplete).");
        return;
      }

      setAdvText("advRouteStatus", `Analyse… (${fromId} → ${toId})`);

      const url =
        `${PROXY_BASE}/v1/hauling/route?from_id=${encodeURIComponent(fromId)}` +
        `&to_id=${encodeURIComponent(toId)}` +
        `&ship_scu=${encodeURIComponent(shipScu)}` +
        `&budget=${encodeURIComponent(budget)}` +
        `&risk=${encodeURIComponent(state.advanced.risk)}` +
        `&game_version=${encodeURIComponent(GAME_VERSION)}`;

      const payload = await fetchJson(url);
      const { data, meta, warnings } = unwrapV1(payload);

      setChip("Proxy OK (v1)", false);
      if (Array.isArray(warnings) && warnings.length) console.info("[hauling][adv] warnings:", warnings);

      if (meta?.generatedAt) {
        try {
          const d = new Date(meta.generatedAt);
          setAdvText("advMaj", `MAJ : ${d.toLocaleString("fr-FR")}`);
        } catch (_) {}
      }

      if ($("advRouteJson")) $("advRouteJson").textContent = JSON.stringify(payload, null, 2);

      const resultsRaw = Array.isArray(data?.results) ? data.results : [];
      state.routeCache.lastResultsBase = Array.isArray(resultsRaw) ? resultsRaw.map(r => ({ ...r })) : [];
      state.routeCache.lastResultsRaw = resultsRaw;
      state.routeCache.lastMeta = meta || null;
      state.routeCache.lastPayload = payload;
      const results = sortItems(resultsRaw, getAdvSort());
      state.routeCache.lastResults = results;
      renderTop3(results);
      renderGoodsList(results);
      try { setSortStatus(); } catch (_) {}

      setAdvText("advRouteStatus", `OK • ${results.length} résultats`);
      saveState();
    } catch (e) {
      console.warn("[hauling][adv] analyze failed:", e);
      setChip("Proxy/UEX indisponible", true);
      setAdvText("advRouteStatus", `Erreur: ${String(e?.message || e)}`);
    } finally {
      btn && (btn.disabled = false);
    }
  }

  
  function getAdvSort() {
    const v = ($("advSort")?.value || "score").trim();
    if (v === "profit" || v === "pscu" || v === "score") return v;
    return "score";
  }

  function sortItems(items, mode) {
    const arr = Array.isArray(items) ? [...items] : [];
    if (mode === "profit") {
      arr.sort((a, b) => num(b.profitTotal ?? 0) - num(a.profitTotal ?? 0));
      return arr;
    }
    if (mode === "pscu") {
      arr.sort((a, b) => num(b.profitPerSCU ?? 0) - num(a.profitPerSCU ?? 0));
      return arr;
    }
    // score (default): use finalScore (0..1) if present; fallback to profitTotal
    arr.sort((a, b) => (num(b.finalScore ?? 0) - num(a.finalScore ?? 0)) || (num(b.profitTotal ?? 0) - num(a.profitTotal ?? 0)));
    return arr;
  }


  function applySortAndRender() {
    const mode = getAdvSort();

    if (state.assisted.active && Array.isArray(state.assisted.lastRoutesRaw) && state.assisted.lastRoutesRaw.length) {
      const sorted = sortItems(state.assisted.lastRoutesRaw, mode);
      state.assisted.lastRoutes = sorted;
      const oq = ($("advOrigin")?.value || "").trim();
      const q  = ($("advSearch")?.value || "").trim();
      let shown = oq ? filterRoutesByOrigin(sorted, oq) : sorted;
      shown = q ? filterRoutesByCommodity(shown, q) : shown;
      renderTopRoutes(shown, state.assisted.lastScan || null);
      if (q || oq) setAdvText("advCount", `${shown.length} / ${sorted.length} routes`);
      else setAdvText("advCount", `${shown.length} routes`);
      return true;
    }

    if (!state.assisted.active && Array.isArray(state.routeCache.lastResultsRaw) && state.routeCache.lastResultsRaw.length) {
      const sorted = sortItems(state.routeCache.lastResultsRaw, mode);
      state.routeCache.lastResults = sorted;
      renderTop3(sorted);
      renderGoodsList(sorted);
      return true;
    }

    return false;
  }
// ------------------------------------------------------------
  // SUGGESTIONS: Top Routes Globales
  // ------------------------------------------------------------
  function clearResultsArea(message) {
    const row = $("top3Row");
    if (row) row.innerHTML = `<div class="empty">${escapeHtml(message || "—")}</div>`;
    const list = $("advGoodsList");
    if (list) list.innerHTML = `<div id="advGoodsEmpty" class="empty">${escapeHtml(message || "—")}</div>`;
    setAdvText("advCount", "—");
  }

  

  function applyContextToCachedTopRoutes(){
    const raw = Array.isArray(state?.assisted?.lastRoutesRaw) ? state.assisted.lastRoutesRaw : [];
    if (!raw.length) return;

    const shipScu = num($("advUsableScu")?.value || 0);
    const budget = num($("advBudget")?.value || $("advBudgetAuec")?.value || 0);

    const adj = raw.map(r => {
      const buy = num(r.buy || 0);
      const sell = num(r.sell || 0);

      // Quantity cap: ship, buy stock, budget/buy
      let q = Math.max(0, Math.floor(shipScu || 0));
      const stockBuy = num(r.buyStockSCU || 0);
      if (stockBuy > 0) q = Math.min(q, Math.floor(stockBuy));
      if (budget > 0 && buy > 0) q = Math.min(q, Math.floor(budget / buy));
      q = Math.max(0, Math.floor(q));

      const profitPer = Math.max(0, sell - buy);
      const spend = q * buy;
      const revenue = q * sell;
      const profitTotal = q * profitPer;

      // clone while overriding computed fields
      return {
        ...r,
        quantitySCU: q,
        spend,
        revenue,
        profitPerSCU: profitPer,
        profitTotal,
      };
    });

    // Preserve current sorting choice but do not rescore; just sort by existing finalScore then profitTotal
    const sorted = sortItems(adj, getAdvSort());
    state.assisted.lastRoutes = sorted;

    const q = (state.advanced.goodsSearch || "").trim();
    let shown = q ? filterRoutesByCommodity(sorted, q) : sorted;

    const oq = ($("advOrigin")?.value || "").trim();
    if (oq) shown = filterRoutesByOrigin(shown, oq);

    renderTopRoutes(shown, state.assisted.lastScan || null);
    setAdvText("advCount", `${shown.length} / ${sorted.length} routes`);
    setAdvText("advRouteStatus", `OK • ${shown.length} routes (SCU live)`);
  }

  
  // Live recompute for last analyzed route results (A→B mode).
  // This complements applyContextToCachedTopRoutes() which only targets "Top routes" cache.
  function applyContextToCachedRouteResults(){
    const base = Array.isArray(state?.routeCache?.lastResultsBase) && state.routeCache.lastResultsBase.length
      ? state.routeCache.lastResultsBase
      : (Array.isArray(state?.routeCache?.lastResultsRaw) ? state.routeCache.lastResultsRaw : []);
    if (!base.length) return false;

    const shipScu = num($("advUsableScu")?.value || 0);
    const budget = num($("advBudget")?.value || $("advBudgetAuec")?.value || 0);

    const adj = base.map(r => {
      const buy = num(r.buy || 0);
      const sell = num(r.sell || 0);

      // Quantity cap: ship, buy stock, budget/buy
      let q = Math.max(0, Math.floor(shipScu || 0));
      const stockBuy = num(r.buyStockSCU || 0);
      if (stockBuy > 0) q = Math.min(q, Math.floor(stockBuy));
      if (budget > 0 && buy > 0) q = Math.min(q, Math.floor(budget / buy));

      const spend = buy > 0 ? q * buy : 0;
      const revenue = sell > 0 ? q * sell : 0;
      const profitTotal = revenue - spend;
      const profitPerSCU = (sell > 0 && buy > 0) ? (sell - buy) : 0;

      // preserve everything else, override computed fields
      return {
        ...r,
        quantitySCU: q,
        spend,
        revenue,
        profitTotal,
        profitPerSCU,
        profitPerSCU_display: undefined,
      };
    });

    state.routeCache.lastResultsRaw = adj;
    try { return !!applySortAndRender(); } catch(_){ return false; }
  }

let __scuLiveTimer = null;
  function wireScuLive(){
    const input = $("advUsableScu");
    if (!input) return;

    const run = () => {
      if (__scuLiveTimer) clearTimeout(__scuLiveTimer);
      __scuLiveTimer = setTimeout(() => {
        // Recompute quantities/profits from cache (no network)
        if (typeof applyContextToCachedTopRoutes === "function") applyContextToCachedTopRoutes();
          try { applyContextToCachedRouteResults(); } catch(_){ }
          try { applyContextToCachedRouteResults(); } catch(_){ }
      }, 180);
    };

    input.addEventListener("input", run);
    input.addEventListener("change", run);
  }

  let __budgetLiveTimer = null;
  function wireBudgetLive(){
    const input = $("advBudget") || $("advBudgetAuec");
    if (!input) return;

    const run = () => {
      if (__budgetLiveTimer) clearTimeout(__budgetLiveTimer);
      __budgetLiveTimer = setTimeout(() => {
        if (typeof applyContextToCachedTopRoutes === "function") applyContextToCachedTopRoutes();
          try { applyContextToCachedRouteResults(); } catch(_){ }
          try { applyContextToCachedRouteResults(); } catch(_){ }
      }, 180);
    };

    input.addEventListener("input", run);
    input.addEventListener("change", run);
  }

function renderTopRoutes(routes, scanMeta) {
    const list = $("advGoodsList");
    if (!list) return;

    // Top3: reuse as "Top 3 routes"
    const row = $("top3Row");
    if (row) {
      row.innerHTML = (routes || []).slice(0, 3).map(r => {
        const profit = num(r.profitTotal ?? 0);
        const pscu = num(r.profitPerSCU ?? 0);
        const qty = int(r.quantitySCU ?? 0);
        const commodity = r.commodity || "—";
        const fromName = r?.from?.name || "—";
        const toName = r?.to?.name || "—";
        return `
          <div class="top3-card goods-item" data-route="1"
               data-from="${escapeHtml(fromName)}" data-to="${escapeHtml(toName)}" data-commodity="${escapeHtml(commodity)}">
            <div class="goods-name">${escapeHtml(commodity)}</div>
            <div class="goods-sub">${escapeHtml(fromName)} → ${escapeHtml(toName)}</div>
            <div class="goods-sub">Qté: ${qty} SCU • +${fmt0(pscu)}/SCU</div>
            <div class="goods-sub stab-line">Score: <span class="score-pill ${scoreClass(score100(r))}">${fmt0(score100(r))}</span>/100 <span class="stab-badge ${stabMeta(r).cls}" title="${escapeHtml(stabMeta(r).title)}">${escapeHtml(stabMeta(r).label)}</span></div>
            <div class="goods-profit">+${fmt0(profit)} aUEC</div>
          </div>
        `;
      }).join("") || `<div class="empty">Aucune route disponible.</div>`;
    }

    // Full list: routes
    list.innerHTML = (routes || []).map((r, i) => {
      const profit = num(r.profitTotal ?? 0);
      const pscu = num(r.profitPerSCU ?? 0);
      const qty = int(r.quantitySCU ?? 0);
      const commodity = r.commodity || "—";
      const fromName = r?.from?.name || "—";
      const toName = r?.to?.name || "—";
      const fromSys = r?.from?.system ? ` (${r.from.system})` : "";
      const toSys = r?.to?.system ? ` (${r.to.system})` : "";

      return `
        <div class="goods-item" role="listitem" data-route="1"
             data-from="${escapeHtml(fromName)}" data-to="${escapeHtml(toName)}" data-commodity="${escapeHtml(commodity)}">
          <div class="goods-left">
            <div class="goods-name">${escapeHtml(commodity)}</div>
            <div class="goods-sub">${escapeHtml(fromName)}${escapeHtml(fromSys)} → ${escapeHtml(toName)}${escapeHtml(toSys)}</div>
            <div class="goods-sub">Qté: ${qty} SCU • +${fmt0(pscu)}/SCU</div>
            <div class="goods-sub stab-line">Score: <span class="score-pill ${scoreClass(score100(r))}">${fmt0(score100(r))}</span>/100 <span class="stab-badge ${stabMeta(r).cls}" title="${escapeHtml(stabMeta(r).title)}">${escapeHtml(stabMeta(r).label)}</span></div>
          </div>
          <div class="goods-right">
            <div class="goods-profit">+${fmt0(profit)}</div>
            <div class="goods-sub">aUEC</div>
          </div>
        </div>
      `;
    }).join("") || `<div id="advGoodsEmpty" class="empty">Aucune route disponible.</div>`;

    // Bind click => B behavior (préfill + lock + analyse détaillée)
    const bindClick = (el) => {
      el.addEventListener("click", async () => {
        const from = (el.getAttribute("data-from") || "").trim();
        const to = (el.getAttribute("data-to") || "").trim();
        const commodity = (el.getAttribute("data-commodity") || "").trim();
        if (!from || !to) return;

        if ($("advRouteFrom")) $("advRouteFrom").value = from;
        if ($("advRouteTo")) $("advRouteTo").value = to;

        if (commodity) {
          lockCommodity(commodity);
        } else {
          unlockCommodity();
        }

        state.assisted.active = false;

        // Lancer analyse détaillée directement (B)
        await analyzeRouteAdvanced();

        // Optionnel: scroll léger vers la zone route
        $("advRouteFrom")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };

    $qa('[data-route="1"]', row || document).forEach(bindClick);
    $qa('[data-route="1"]', list).forEach(bindClick);

    setAdvText("advCount", `${(routes || []).length} routes`);
    if (scanMeta && typeof scanMeta === "object") {
      const st = `Scan: ${scanMeta.sampledTerminals ?? "?"}/${scanMeta.totalTerminals ?? "?"} terminaux`;
      setAdvText("advRouteStatus", st);
    } else {
      setAdvText("advRouteStatus", `OK • ${(routes || []).length} routes`);
    }
  }

  async function fetchTopRoutes(opts={}) {
    const btn = $("advTopCalc") || $("advAssist") || $("advCalculate") || $("advCalc");
    btn && (btn.disabled = true);

    try {
      const shipScu = num($("advUsableScu")?.value || 0);
      const budget = num($("advBudget")?.value || $("advBudgetAuec")?.value || 0);

      if (shipScu <= 0) {
        clearResultsArea("Renseigne d’abord un SCU utilisable.");
        return;
      }

      setChip("Scan routes…", false);
      setAdvText("advRouteStatus", "Scan routes globales…");
      clearResultsArea("Scan en cours…");

      
      const originQ0 = (opts && typeof opts.originOverride === "string" && opts.originOverride.trim().length >= 3)
        ? opts.originOverride.trim()
        : (getAdvOriginQuery() || "").trim();
      const originQ = originQ0.length >= 3 ? originQ0 : "";
      const usedOriginParam = !!originQ;
      const maxTerms = usedOriginParam ? 150 : TOP_ROUTES_MAX_TERMINALS;

      let url =
        `${PROXY_BASE}/v1/hauling/routes/top?ship_scu=${encodeURIComponent(shipScu)}` +
        `&budget=${encodeURIComponent(budget)}` +
        `&risk=${encodeURIComponent(state.advanced.risk)}` +
        `&limit=${encodeURIComponent(TOP_ROUTES_LIMIT)}` +
        `&max_terminals=${encodeURIComponent(maxTerms)}`;

      if (originQ) url += `&origin=${encodeURIComponent(originQ)}`;

      url += `&game_version=${encodeURIComponent(GAME_VERSION)}`;

      const payload = await fetchJson(url);
      const { data, meta, warnings } = unwrapV1(payload);

      setChip("Proxy OK (v1)", false);
      if (Array.isArray(warnings) && warnings.length) console.info("[hauling][assist] warnings:", warnings);

      if (meta?.generatedAt) {
        try {
          const d = new Date(meta.generatedAt);
          setAdvText("advMaj", `MAJ : ${d.toLocaleString("fr-FR")}`);
        } catch (_) {}
      }

      if ($("advRouteJson")) $("advRouteJson").textContent = JSON.stringify(payload, null, 2);

      const routesRaw = Array.isArray(data?.routes) ? data.routes : [];
      state.assisted.lastRoutesRaw = routesRaw;
      const routes = sortItems(routesRaw, getAdvSort());
      // Optional: commodity-driven search (client side filter)
      const __q = (opts && typeof opts.commodityQuery === "string") ? opts.commodityQuery.trim() : "";
      const routesFiltered = __q ? filterRoutesByCommodity(routes, __q) : routes;
      state.assisted.lastRoutes = routes;
      state.assisted.lastScan = (typeof normalizeScan === "function" ? (normalizeScan(data?.scan) || data?.scan) : data?.scan) || null;
      state.assisted.active = true;
      state.routeCache.lastResultsRaw = [];
      state.routeCache.lastResults = [];
    state.routeCache.lastResultsBase = [];
      state.routeCache.lastMeta = null;
      state.routeCache.lastPayload = null;

      // Suggestions view: no commodity lock forced; user chooses by clicking a route
      unlockCommodity();
      if (__q){
        const lbl = bestCommodityLabel(routes, __q) || __q;
        lockCommodity(lbl);
        // Ensure search count reflects filtering
        const total = routes.length;
        const shown = routesFiltered.length;
        setAdvText("advCount", `${shown} / ${total} routes`);
      }

      // Origin (city) filter + cities datalist
      try{ updateCitiesDatalistFromRoutes(routes); } catch(_){ }
      const __oq = ($("advOrigin")?.value || "").trim();
      let routesShown = routesFiltered;
      // If we used server-side origin param, routes are already restricted; do not client-filter by parsing names.
      if (!usedOriginParam && __oq){
        routesShown = filterRoutesByOrigin(routesShown, __oq);
        const total = routes.length;
        setAdvText("advCount", `${routesShown.length} / ${total} routes`);
      }

      renderTopRoutes(routesShown, state.assisted.lastScan || data?.scan || null)
      try { setSortStatus(); } catch (_) {}
    } catch (e) {
      console.warn("[hauling][assist] top routes failed:", e);
      setChip("Proxy/UEX indisponible", true);
      setAdvText("advRouteStatus", `Erreur: ${String(e?.message || e)}`);
      clearResultsArea("Erreur scan routes (voir console).");
    } finally {
      btn && (btn.disabled = false);
      saveState();
    }
  }

  // ------------------------------------------------------------
  // ADVANCED init + bindings
  // ------------------------------------------------------------
  

  function dockTopRoutesButtonNextToReset(){
    try{
      const topBtn =
        $("advTopCalc") || $("advAssist") || $("advCalculate") || $("advCalc") || null;
      if (!topBtn) return;

      const resetBtn =
        $("advReset") || $("advResetBtn") ||
        Array.from(document.querySelectorAll("button")).find(b => /Réinitialiser/i.test((b.textContent||"").trim())) ||
        null;

      if (!resetBtn) return;
      if (resetBtn.parentElement && resetBtn.parentElement.contains(topBtn)) return;

      let parent = resetBtn.parentElement;
      if (!parent) return;

      // Ensure a flex row container for both buttons
      if (!parent.classList.contains("context-actions")){
        const row = document.createElement("div");
        row.className = "context-actions";

        // Insert the row right where the reset button currently is
        parent.insertBefore(row, resetBtn);
        row.appendChild(topBtn);
        row.appendChild(resetBtn);
      } else {
        parent.insertBefore(topBtn, resetBtn);
      }

      const txt = (topBtn.textContent || "").trim();
      if (/^Calculer$/i.test(txt)) topBtn.textContent = "Rafraîchir routes (UEX)";
    }catch(_){}
  }
function initAdvanced() {
    $qa(".quick-btn[data-risk]").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = (btn.getAttribute("data-risk") || "low").trim();
        state.advanced.risk = (r === "high" || r === "mid" || r === "low") ? r : "low";

        $qa(".quick-btn[data-risk]").forEach(b => b.classList.toggle("is-active", b === btn));
        setAdvText("advRiskHint", `${riskHintText(state.advanced.risk)}  Score = profit pondéré par stabilité (selon risque).`);
        saveState();
      });
    });

    const onTermInput = (e) => {
      const target = e?.target || null;
      const q = String(target?.value || "").trim();
      if (termTimer) clearTimeout(termTimer);
      termTimer = setTimeout(async () => {
        try{
          const items = await advSearchTerminals(q);
          renderTermSuggest(target, items || []);
        }catch(_){}
      }, 220);
      saveState();
    };
    $("advRouteFrom")?.addEventListener("input", onTermInput);
    $("advRouteFrom")?.addEventListener("blur", () => { setTimeout(() => hideTermSuggest("advFromSuggest"), 160); });
    $("advRouteTo")?.addEventListener("blur", () => { setTimeout(() => hideTermSuggest("advToSuggest"), 160); });

    $("advRouteTo")?.addEventListener("input", onTermInput);

    $("advRefresh")?.addEventListener("click", analyzeRouteAdvanced);

    // Goods search (filters the full results list)
    if (typeof wireGoodsSearch === "function") wireGoodsSearch();
    if (typeof dockTopRoutesButtonNextToReset === "function") dockTopRoutesButtonNextToReset();
    if (typeof wireOriginFromABSafe === "function") wireOriginFromABSafe();
    if (typeof wireABExactToggle === "function") wireABExactToggle();
    if (typeof wireOriginSearch === "function") wireOriginSearch();
    if (typeof wireScuLive === "function") wireScuLive();
    if (typeof wireBudgetLive === "function") wireBudgetLive();

    // New: Suggestions (Top routes)
    $("advAssist")?.addEventListener("click", fetchTopRoutes);
    // Tri (Score / Profit / Profit/SCU) — apply instantly (no refetch if cached)
    const __sortHandler = () => {
      try { console.info("[hauling][sort]", getAdvSort()); } catch (_) {}
      try { setSortStatus(); } catch (_) {}
      const ok = applySortAndRender();
      if (ok) return;
      const fromName = ($("advRouteFrom")?.value || "").trim();
      const toName = ($("advRouteTo")?.value || "").trim();
      if (fromName && toName) analyzeRouteAdvanced();
    };
    $("advSort")?.addEventListener("change", __sortHandler);
    $("advSort")?.addEventListener("input", __sortHandler);

    

    $("advUnlock")?.addEventListener("click", unlockCommodity);

    $("resetAdvanced")?.addEventListener("click", () => {
      if ($("advRouteFrom")) $("advRouteFrom").value = "";
      if ($("advRouteTo")) $("advRouteTo").value = "";
      if ($("advBudget")) $("advBudget").value = "500000";
      if ($("advBudgetAuec")) $("advBudgetAuec").value = "500000";
      if ($("advRouteJson")) $("advRouteJson").textContent = "—";

      unlockCommodity();

      const list = $("advGoodsList");
      if (list) list.innerHTML = `<div id="advGoodsEmpty" class="empty">Analyse une route pour afficher les résultats.</div>`;
      const row = $("top3Row");
      if (row) row.innerHTML = `<div class="empty">—</div>`;

      setAdvText("advCount", "—");
      setAdvText("advRouteStatus", "—");
      setAdvText("advMaj", "MAJ : —");
      setChip("—", false);

      state.assisted.active = false;

      state.advanced.risk = "low";
      const lowBtn = $q('.quick-btn[data-risk="low"]');
      if (lowBtn) $qa(".quick-btn[data-risk]").forEach(b => b.classList.toggle("is-active", b === lowBtn));
      setAdvText("advRiskHint", `${riskHintText("low")}  Score = profit pondéré par stabilité (selon risque).`);

      saveState();
    });

    ["advBudget", "advUsableScu", "advRouteFrom", "advRouteTo"].forEach(id => {
      $(id)?.addEventListener("input", saveState);
      $(id)?.addEventListener("change", saveState);
    });
  }

  // ------------------------------------------------------------
  // INIT
  // ------------------------------------------------------------
  async function init() {
    loadState();
    initTabs();

    setAdvText("advRouteStatus", "—");
    setAdvText("advCount", "—");
    setAdvText("advMaj", "MAJ : —");
    setChip("—", false);
    setAdvText("advRiskHint", `${riskHintText(state.advanced.risk || "low")}  Score = profit pondéré par stabilité (selon risque).`);

    if ($("advRouteFrom")) $("advRouteFrom").value = state.advanced.fromName || "";
    if ($("advRouteTo")) $("advRouteTo").value = state.advanced.toName || "";
    if ($("advBudget")) $("advBudget").value = String(int(state.advanced.budget || 500000));

    await loadShipsCatalog().catch(() => {});
    populateNativeSelect("shipSelect");
    populateNativeSelect("advShipSelect");

    initPicker({
      selectId: "shipSelect",
      triggerId: "shipPickerTrigger",
      menuId: "shipPickerMenu",
      searchId: "shipPickerSearch",
      metaId: "shipPickerMeta",
      listId: "shipPickerList",
    });
    initPicker({
      selectId: "advShipSelect",
      triggerId: "advShipPickerTrigger",
      menuId: "advShipPickerMenu",
      searchId: "advShipPickerSearch",
      metaId: "advShipPickerMeta",
      listId: "advShipPickerList",
    });

    syncSelectToTrigger("shipSelect", "shipPickerTrigger");
    syncSelectToTrigger("advShipSelect", "advShipPickerTrigger");

    fillPickerList("shipPickerList", "shipSelect", "shipPickerTrigger", shipsCatalog);
    fillPickerList("advShipPickerList", "advShipSelect", "advShipPickerTrigger", shipsCatalog);

    setPickerMeta("shipPickerMeta", `Ships: ${shipsCatalog.length}`);
    setPickerMeta("advShipPickerMeta", `Ships: ${shipsCatalog.length}`);

    initCargoTypePicker();
    initBeginner();
    initAdvanced();
    initVersionFooterFret();

    if ($("loopMinutes")) $("loopMinutes").value = String(int(state.beginner.minutes || 25));
    computeBeginner();

    if ($("advUsableScu") && int($("advUsableScu").value) <= 0) {
      const scu = int($("cargoScu")?.value || 0);
      if (scu > 0) $("advUsableScu").value = String(scu);
    }

    if (state.advanced.lockedCommodity) showLocked(state.advanced.lockedCommodity);
    else hideLocked();

    if (state.tab === "advanced") showAdvanced();
    else showBeginner();

    
    // Auto-suggestions on arrival: show Top 3 conseillées without clicking "Suggestions"
    try{
      const hasCached = Array.isArray(state?.assisted?.lastRoutesRaw) && state.assisted.lastRoutesRaw.length > 0;
      if (!hasCached){
        await fetchTopRoutes();
      } else {
        const routes = sortItems(state.assisted.lastRoutesRaw, getAdvSort());
        renderTopRoutes(routes, state.assisted.lastScan || null);
        setAdvText("advCount", `${routes.length} routes`);
      }
    } catch(e){
      console.warn("[hauling] auto-suggestions failed:", e);
    }

const pre = ($("advRouteFrom")?.value || "").trim();
    if (pre.length >= 2) advSearchTerminals(pre).catch(() => {});
  }

  window.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => console.warn("[hauling] init failed:", e));
  });

})();




/* ============================================================
   V1.13.62 — Calculer (Top 3) + Balise "!" (Aide)
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  const topCalc = document.getElementById("advTopCalc");
  const infoBtn = document.getElementById("advInfoToggle");
  const infoPanel = document.getElementById("advInfoPanel");

  if (topCalc) {
    topCalc.addEventListener("click", () => {
      try {
        // Prefer the Top Routes endpoint / routine (best route suggestions)
        if (typeof fetchTopRoutes === "function") {
          fetchTopRoutes();
        } else if (typeof analyzeRouteAdvanced === "function") {
          // Fallback: keep behaviour if only analysis exists
          analyzeRouteAdvanced();
        }
      } catch (e) {
        console.warn("[advTopCalc]", e);
      }
    });
  }

  if (infoBtn && infoPanel) {
    infoBtn.addEventListener("click", () => {
      infoPanel.classList.toggle("is-hidden");
    });
  }
});


function setAdvButtonsDisabled(disabled){
  try{
    const a = document.getElementById("advRouteAnalyze");
    const c = document.getElementById("advTopCalc");
    if(a) a.disabled = !!disabled;
    if(c) c.disabled = !!disabled;
  }catch(e){}
}


/* ============================================================
   V1.13.62 — Calculer button (Top 3): trigger the same pipeline as "Analyser la route"
   - Using click() on #advRouteAnalyze ensures we hit the real, already-wired handler.
   - The "!" is now pure CSS hover tooltip (HTML/CSS), no JS needed.
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  const topCalc = document.getElementById("advTopCalc");
  if (topCalc) {
    topCalc.addEventListener("click", () => {
      try {
        const analyzeBtn = document.getElementById("advRouteAnalyze");
        if (analyzeBtn) {
          analyzeBtn.click();
          return;
        }
        if (typeof analyzeRouteAdvanced === "function") {
          analyzeRouteAdvanced();
          return;
        }
        if (typeof fetchTopRoutes === "function") {
          fetchTopRoutes();
          return;
        }
      } catch (e) {
        console.warn("[advTopCalc]", e);
      }
    });
  }
});




function killNativeAutofill(){
  const ids = ["advRouteFrom","advRouteTo","routeFrom","routeTo","advOrigin","advDest"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Browsers sometimes ignore autocomplete="off"; "new-password" is more reliably respected.
    el.setAttribute("autocomplete","new-password");
    el.setAttribute("autocapitalize","off");
    el.setAttribute("spellcheck","false");
    // "name" triggers autofill; randomize it each load.
    el.setAttribute("name", `nope_${id}_${Date.now()}`);
  });
}

function dedupeTermSuggestBoxes(){

function isAdvSuggestEnabled(inputId){
  if (inputId === "advRouteFrom") return !!state.ui?.showAdvFromSuggest;
  if (inputId === "advRouteTo") return !!state.ui?.showAdvToSuggest;
  return true;
}

function setAdvSuggestEnabled(inputId, v){
  if (!state.ui) state.ui = {};
  if (inputId === "advRouteFrom") state.ui.showAdvFromSuggest = !!v;
  if (inputId === "advRouteTo") state.ui.showAdvToSuggest = !!v;
}

function toggleAdvSuggest(inputId){
  const enabled = isAdvSuggestEnabled(inputId);
  setAdvSuggestEnabled(inputId, !enabled);
  const el = document.getElementById(inputId);
  if (el) el.focus();
  const boxId = (inputId === "advRouteFrom") ? "advFromSuggest" : "advToSuggest";
  const box = document.getElementById(boxId);
  if (!isAdvSuggestEnabled(inputId)){
    if (box) box.classList.add("is-hidden");
    return;
  }
  if (el) renderTermSuggest(el, boxId);
}

function wireAdvSuggestToggles(){
  const btnFrom = document.getElementById("advFromToggle");
  const btnTo = document.getElementById("advToToggle");
  if (btnFrom) btnFrom.addEventListener("click", () => toggleAdvSuggest("advRouteFrom"));
  if (btnTo) btnTo.addEventListener("click", () => toggleAdvSuggest("advRouteTo"));
}

  // If the HTML has been patched multiple times, duplicate suggestion nodes can exist.
  // Keep only the first instance for each id.
  ["advFromSuggest","advToSuggest"].forEach(id => {
    const nodes = document.querySelectorAll(`#${id}`);
    if (nodes.length <= 1) return;
    nodes.forEach((n, idx) => { if (idx > 0) n.remove(); });
  });
}

function extractVTag(str){
  if (!str) return "";
  const m = String(str).match(/V\d+\.\d+\.\d+/);
  return m ? m[0] : String(str).trim();
}

function setFretVersionUI(){
  const vTag = extractVTag(VERSION);
  const pu = "4.5";
  const main = document.getElementById("versionMainText");
  if (main) main.textContent = `FRET ${vTag} • PU ${pu}`;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("tvModuleFret", vTag);
  set("tvHtmlFret", HTML_VERSION);
  set("tvCssFret", CSS_VERSION);
  set("tvJsFret", vTag);

  // Worker/Contract are set elsewhere (proxy meta), keep if present.
  set("tvPuFret", pu);
}


