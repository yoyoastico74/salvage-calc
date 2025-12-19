/* assets/js/salvage.js — V1.4.40 FULL
   Recyclage (Salvage) — PU 4.5
   ---------------------------------------------------------------------------
   Objectifs V1.4.25
   - FIX contrat UEX: supporte payload LEGACY (cmat/rmc à la racine) ET payload V1 (data.cmat/data.rmc)
   - Mode Débutant / Mode Avancé + calculs live
   - Top ventes + “où vendre maintenant” (bestTerminal)
   - Historique prix: rendu canvas simple + tooltip (sans dépendance externe)
   - Presets vaisseaux + tête de recyclage
   - Configs (3 slots) en localStorage
*/

(() => {
  "use strict";

  /* -----------------------------
     CONFIG & CONSTANTES
  ------------------------------*/

  const APP_VERSION = "V1.4.40";
  const DEFAULT_GAME_VERSION = "4.4";

  // IMPORTANT:
  // - Recyclage (frontend) attend historiquement le format LEGACY.
  // - Le Worker unifié peut répondre en LEGACY sur "/" ou "/salvage"
  //   et en V1 sur "/v1/salvage".
  // -> On utilise LEGACY par défaut, mais on parse les 2 formats (robuste).
  const UEX_PROXY_BASE = (window.UEX_PROXY_BASE || "https://uex-proxy.yoyoastico74.workers.dev").replace(/\/+$/, "");
  const UEX_ENDPOINT_LEGACY = `${UEX_PROXY_BASE}/salvage`;
  const UEX_ENDPOINT_V1 = `${UEX_PROXY_BASE}/v1/salvage`;

  const LS_KEY = "salvage_configs_v1";
  const LS_KEY_UI = "salvage_ui_v1";

  // Status thresholds (shared)
  const DEFAULT_THR_OK = 250000;
  const DEFAULT_THR_GOOD = 500000;

  // Basic ships presets (frontend-only; not tied to ships_v2.json)
  const SHIPS = [
    { id: "salvation", name: "Salvation", profile: "Solo (rapide)", rmcHint: "Hull Scraping", cmatHint: "CMR/CMS → CMAT", loopMin: 40, refinePct: 30, badge: "ship-badge-solo", badgeText: "SOLO" },
    { id: "vulture", name: "Vulture", profile: "Solo (standard)", rmcHint: "Hull Scraping", cmatHint: "CMR/CMS → CMAT", loopMin: 55, refinePct: 30, badge: "ship-badge-solo", badgeText: "SOLO" },
    { id: "fortune", name: "Fortune", profile: "Solo (standard)", rmcHint: "Hull Scraping", cmatHint: "CMR/CMS → CMAT", loopMin: 55, refinePct: 30, badge: "ship-badge-solo", badgeText: "SOLO" },
    { id: "reclaimer", name: "Reclaimer", profile: "Multi (logistique)", rmcHint: "Hull Scraping", cmatHint: "CMS → CMAT", loopMin: 60, refinePct: 15, badge: "ship-badge-multi", badgeText: "MULTI" },
    { id: "other", name: "Autre / Custom", profile: "Custom", rmcHint: "—", cmatHint: "—", loopMin: 45, refinePct: 30, badge: "ship-badge-off", badgeText: "—" },
  ];

  // Salvage head presets (optional helper)
  const HEADS = [
    { id: "default", name: "Standard", note: "Preset neutre", refinePct: null, loopMinDelta: 0 },
    { id: "fast", name: "Rapide", note: "Boucle plus courte (estimation)", refinePct: null, loopMinDelta: -5 },
    { id: "efficient", name: "Efficiente", note: "Meilleur rendement (estimation)", refinePct: +5, loopMinDelta: 0 },
  ];

  /* -----------------------------
     DOM HELPERS
  ------------------------------*/

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function setText(el, txt) {
    if (!el) return;
    el.textContent = String(txt ?? "");
  }

  function setHtml(el, html) {
    if (!el) return;
    el.innerHTML = html;
  }

  function fmtInt(n) {
    const x = Math.round(Number(n) || 0);
    return x.toLocaleString("fr-FR");
  }

  function fmtMoney(n) {
    return `${fmtInt(n)} aUEC`;
  }

  function fmtPerHour(n) {
    return `${fmtInt(n)} aUEC/h`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clamp01(x) {
    const n = Number(x) || 0;
    return Math.max(0, Math.min(1, n));
  }

  function safeNum(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  function safePosNum(v, def = 0) {
    const n = safeNum(v, def);
    return n >= 0 ? n : def;
  }

  function setBadge(el, kind, text) {
    if (!el) return;
    el.className = `status-badge ${kind}`;
    el.textContent = text;
  }

  /* -----------------------------
     UI REFERENCES
  ------------------------------*/

  // Modes
  const btnBeginner = $("#btnBeginner");
  const btnAdvanced = $("#btnAdvanced");
  const modeBeginner = $("#modeBeginner");
  const modeAdvanced = $("#modeAdvanced");

  // Configs
  const configSlot = $("#configSlot");
  const configName = $("#configName");
  const btnLoadConfig = $("#btnLoadConfig");
  const btnSaveConfig = $("#btnSaveConfig");

  // Beginner inputs
  const shipSelect = $("#shipSelect");
  const shipNote = $("#shipNote");
  const begRefineHint = $("#begRefineHint");
  const shipProfileBadge = $("#shipProfileBadge");
  const shipMetaHint = $("#shipMetaHint");

  const scuRmc = $("#scuRmc");
  const scuCmat = $("#scuCmat");
  const begLoopMinutes = $("#begLoopMinutes");
  const priceRmc = $("#priceRmc");
  const priceCmat = $("#priceCmat");
  const uexLockBadge = $("#uexLockBadge");
  const btnRefreshUex = $("#btnRefreshUex");
  const btnResetBeginner = $("#btnResetBeginner");

  // Beginner outputs
  const outPerHourBig = $("#outPerHourBig");
  const outRmc = $("#outRmc");
  const outCmat = $("#outCmat");
  const outTotal = $("#outTotal");
  const outPerHour = $("#outPerHour");
  const outStatus = $("#outStatus");
  const uexStatusLine = $("#uexStatusLine");
  const uexLastUpdate = $("#uexLastUpdate");
  const topRmc = $("#topRmc");
  const topCmat = $("#topCmat");

  // Advanced inputs
  const loopMinutes = $("#loopMinutes");
  const feesPct = $("#feesPct");
  const thrOk = $("#thrOk");
  const thrGood = $("#thrGood");
  const cmatRefineMode = $("#cmatRefineMode");
  const refineBlock = $("#refineBlock");
  const cmatRefineYield = $("#cmatRefineYield");
  const salvageHeadSelect = $("#salvageHeadSelect");
  const salvageHeadInfo = $("#salvageHeadInfo");
  const btnRefreshUexAdv = $("#btnRefreshUexAdv");
  const btnResetAdvanced = $("#btnResetAdvanced");

  // Advanced calc table
  const advScuRmc = $("#advScuRmc");
  const advPriceRmc = $("#advPriceRmc");
  const advValRmc = $("#advValRmc");
  const advScuCmat = $("#advScuCmat");
  const advPriceCmat = $("#advPriceCmat");
  const advValCmat = $("#advValCmat");
  const advGross = $("#advGross");
  const advNet = $("#advNet");
  const advPerHour = $("#advPerHour");
  const uexStatusLineAdv = $("#uexStatusLineAdv");

  // Advanced summary
  const sumNet = $("#sumNet");
  const sumHours = $("#sumHours");
  const sumPerHour = $("#sumPerHour");
  const sumStatus = $("#sumStatus");

  // Advanced sell now
  const advBestRmcSale = $("#advBestRmcSale");
  const advBestRmcMeta = $("#advBestRmcMeta");
  const advBestCmatSale = $("#advBestCmatSale");
  const advBestCmatMeta = $("#advBestCmatMeta");
  const advSellNowFeedback = $("#advSellNowFeedback");

  // Advanced market card
  const advMarketCmat = $("#advMarketCmat");
  const advMarketRmc = $("#advMarketRmc");
  const advMarketMoment = $("#advMarketMoment");
  const marketJustification = $("#marketJustification");

  // Chart
  const advPriceHistoryChart = $("#advPriceHistoryChart");
  const advChartTooltip = $("#advChartTooltip");
  const btnChartRefreshAdv = $("#btnChartRefreshAdv");
  const advChartStatus = $("#advChartStatus");

  /* -----------------------------
     STATE
  ------------------------------*/

  const state = {
    mode: "beginner",
    lastUex: null,           // { cmat, rmc, meta? }
    lastUexOk: false,
    lastUexAt: null,
    uexSource: null,         // "legacy" | "v1"
    locks: { prices: false },
    chart: {
      seriesRmc: [],
      seriesCmat: [],
      spotRmc: 0,
      spotCmat: 0,
      hovering: false,
    }
  };

  /* -----------------------------
     LOAD/SAVE CONFIGS
  ------------------------------*/

  function loadAllConfigs() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveAllConfigs(obj) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(obj || {}));
    } catch {}
  }

  function getUiState() {
    try {
      const raw = localStorage.getItem(LS_KEY_UI);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function setUiState(patch) {
    const cur = getUiState();
    const next = { ...cur, ...(patch || {}) };
    try { localStorage.setItem(LS_KEY_UI, JSON.stringify(next)); } catch {}
  }

  function snapshotCurrentInputs() {
    return {
      name: String(configName?.value || "").trim(),
      ship: shipSelect?.value || "other",

      // Beginner
      b_scuRmc: safePosNum(scuRmc?.value, 0),
      b_scuCmat: safePosNum(scuCmat?.value, 0),
      b_loopMin: Math.max(1, Math.round(safePosNum(begLoopMinutes?.value, 45))),
      b_priceRmc: safePosNum(priceRmc?.value, 0),
      b_priceCmat: safePosNum(priceCmat?.value, 0),

      // Advanced
      a_loopMin: Math.max(1, Math.round(safePosNum(loopMinutes?.value, 45))),
      a_feesPct: clamp01(safePosNum(feesPct?.value, 0) / 100) * 100, // store as pct in [0..100]
      a_thrOk: Math.max(0, Math.round(safePosNum(thrOk?.value, DEFAULT_THR_OK))),
      a_thrGood: Math.max(0, Math.round(safePosNum(thrGood?.value, DEFAULT_THR_GOOD))),
      a_refineMode: cmatRefineMode?.value || "sell",
      a_refineYield: Math.max(0, Math.min(100, Math.round(safePosNum(cmatRefineYield?.value, 30)))),

      a_advScuRmc: safePosNum(advScuRmc?.value, 0),
      a_advScuCmat: safePosNum(advScuCmat?.value, 0),
      a_advPriceRmc: safePosNum(advPriceRmc?.value, 0),
      a_advPriceCmat: safePosNum(advPriceCmat?.value, 0),

      head: salvageHeadSelect?.value || "default",
    };
  }

  function applySnapshot(s) {
    if (!s) return;

    if (configName) configName.value = s.name || "";
    if (shipSelect) shipSelect.value = s.ship || "other";

    if (scuRmc) scuRmc.value = safePosNum(s.b_scuRmc, 0);
    if (scuCmat) scuCmat.value = safePosNum(s.b_scuCmat, 0);
    if (begLoopMinutes) begLoopMinutes.value = Math.max(1, Math.round(safePosNum(s.b_loopMin, 45)));

    if (priceRmc) priceRmc.value = safePosNum(s.b_priceRmc, 0);
    if (priceCmat) priceCmat.value = safePosNum(s.b_priceCmat, 0);

    if (loopMinutes) loopMinutes.value = Math.max(1, Math.round(safePosNum(s.a_loopMin, 45)));
    if (feesPct) feesPct.value = safePosNum(s.a_feesPct, 0);
    if (thrOk) thrOk.value = Math.round(safePosNum(s.a_thrOk, DEFAULT_THR_OK));
    if (thrGood) thrGood.value = Math.round(safePosNum(s.a_thrGood, DEFAULT_THR_GOOD));
    if (cmatRefineMode) cmatRefineMode.value = s.a_refineMode || "sell";
    if (cmatRefineYield) cmatRefineYield.value = Math.max(0, Math.min(100, Math.round(safePosNum(s.a_refineYield, 30))));

    if (advScuRmc) advScuRmc.value = safePosNum(s.a_advScuRmc, 0);
    if (advScuCmat) advScuCmat.value = safePosNum(s.a_advScuCmat, 0);
    if (advPriceRmc) advPriceRmc.value = safePosNum(s.a_advPriceRmc, 0);
    if (advPriceCmat) advPriceCmat.value = safePosNum(s.a_advPriceCmat, 0);

    if (salvageHeadSelect) salvageHeadSelect.value = s.head || "default";

    syncShipPreset(true);
    syncHeadPreset(true);
    syncRefineVisibility();
    recalcBeginner();
    recalcAdvanced();
  }

  /* -----------------------------
     MODES
  ------------------------------*/

  function setMode(nextMode) {
    const m = (nextMode === "advanced") ? "advanced" : "beginner";
    state.mode = m;

    if (btnBeginner) btnBeginner.classList.toggle("is-active", m === "beginner");
    if (btnAdvanced) btnAdvanced.classList.toggle("is-active", m === "advanced");

    if (modeBeginner) modeBeginner.style.display = (m === "beginner") ? "" : "none";
    if (modeAdvanced) modeAdvanced.style.display = (m === "advanced") ? "" : "none";

    setUiState({ mode: m });
  }

  /* -----------------------------
     PRESETS (SHIP + HEAD)
  ------------------------------*/

  function fillShipSelect() {
    if (!shipSelect) return;
    shipSelect.innerHTML = SHIPS.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
    const ui = getUiState();
    shipSelect.value = ui.ship || "vulture";
  }

  function getShipPreset() {
    const id = shipSelect?.value || "other";
    return SHIPS.find(s => s.id === id) || SHIPS[SHIPS.length - 1];
  }

  function syncShipPreset(applyValues) {
    const preset = getShipPreset();

    if (shipMetaHint) setText(shipMetaHint, `Profil : ${preset.profile}`);
    if (shipNote) setText(shipNote, `${preset.rmcHint} • ${preset.cmatHint}`);

    if (shipProfileBadge) {
      shipProfileBadge.className = `ship-badge ${preset.badge || "ship-badge-off"}`;
      shipProfileBadge.textContent = preset.badgeText || "—";
    }

    if (applyValues) {
      if (begLoopMinutes && preset.loopMin) begLoopMinutes.value = preset.loopMin;
      if (loopMinutes && preset.loopMin) loopMinutes.value = preset.loopMin;

      if (cmatRefineYield && preset.refinePct) cmatRefineYield.value = preset.refinePct;

      if (begRefineHint) {
        setText(begRefineHint, `Preset conseillé : boucle ${preset.loopMin} min • raffinage ${preset.refinePct}%`);
      }
    } else if (begRefineHint) {
      setText(begRefineHint, `Preset conseillé : boucle ${preset.loopMin} min • raffinage ${preset.refinePct}%`);
    }

    setUiState({ ship: preset.id });
  }

  function fillHeadSelect() {
    if (!salvageHeadSelect) return;
    salvageHeadSelect.innerHTML = HEADS.map(h => `<option value="${h.id}">${h.name}</option>`).join("");
    const ui = getUiState();
    salvageHeadSelect.value = ui.head || "default";
  }

  function getHeadPreset() {
    const id = salvageHeadSelect?.value || "default";
    return HEADS.find(h => h.id === id) || HEADS[0];
  }

  function syncHeadPreset(applyValues) {
    const h = getHeadPreset();
    if (salvageHeadInfo) setText(salvageHeadInfo, h.note || "—");

    if (applyValues) {
      // Apply a small delta on loop minutes (estimation aid)
      if (loopMinutes) {
        const base = Math.max(1, Math.round(safePosNum(loopMinutes.value, 45)));
        loopMinutes.value = Math.max(1, base + (h.loopMinDelta || 0));
      }
      if (begLoopMinutes) {
        const base = Math.max(1, Math.round(safePosNum(begLoopMinutes.value, 45)));
        begLoopMinutes.value = Math.max(1, base + (h.loopMinDelta || 0));
      }

      // Optional refine +x%
      if (h.refinePct !== null && cmatRefineYield) {
        const base = Math.max(0, Math.min(100, Math.round(safePosNum(cmatRefineYield.value, 30))));
        cmatRefineYield.value = Math.max(0, Math.min(100, base + (h.refinePct || 0)));
      }
    }

    setUiState({ head: h.id });
  }

  function syncRefineVisibility() {
    const mode = cmatRefineMode?.value || "sell";
    if (refineBlock) refineBlock.style.display = (mode === "refine") ? "" : "none";
  }

  /* -----------------------------
     UEX FETCH + PARSING
  ------------------------------*/

  function normalizeUexPayload(json) {
    // Supports:
    // - LEGACY: { status, cmat, rmc }
    // - V1:     { status, data:{ cmat, rmc }, meta }
    const cmat = json?.cmat || json?.data?.cmat || null;
    window.__chartSeries = window.__chartSeries || {};
    window.__chartSeries.cmat = cmat;
    const rmc = json?.rmc || json?.data?.rmc || null;
    window.__chartSeries = window.__chartSeries || {};
    window.__chartSeries.rmc = rmc;

    const meta = json?.meta || null;

    if (!cmat || !rmc) return null;

    return {
      status: json?.status || "ok",
      cmat,
      rmc,
      meta,
      _raw: json,
      _format: (json?.data && json?.meta) ? "v1" : "legacy",
    };
  }

  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function refreshUex({ preferV1 = false } = {}) {
    // Strategy:
    // - Try LEGACY first (highest compatibility with current salvage.js expectations)
    // - If preferV1, try V1 first but fall back to LEGACY
    const first = preferV1 ? UEX_ENDPOINT_V1 : UEX_ENDPOINT_LEGACY;
    const second = preferV1 ? UEX_ENDPOINT_LEGACY : UEX_ENDPOINT_V1;

    const gameParam = `game_version=${encodeURIComponent(DEFAULT_GAME_VERSION)}`;

    const tryUrls = [
      `${first}?${gameParam}`,
      `${second}?${gameParam}`,
      // ultra fallback (root legacy)
      `${UEX_PROXY_BASE}/?${gameParam}`,
    ];

    let lastErr = null;

    for (const u of tryUrls) {
      try {
        const raw = await fetchJson(u);
        const norm = normalizeUexPayload(raw);
        if (!norm) throw new Error("Payload invalide (cmat/rmc manquants)");
        state.lastUex = norm;
        state.lastUexOk = true;
        state.lastUexAt = Date.now();
        state.uexSource = norm._format;
        return norm;
      } catch (e) {
        lastErr = e;
      }
    }

    state.lastUex = null;
    state.lastUexOk = false;
    state.lastUexAt = Date.now();
    state.uexSource = null;

    throw lastErr || new Error("UEX indisponible");
  }

  function applyUexPricesToInputs(uex) {
    if (!uex) return;

    const pRmc = safePosNum(uex.rmc?.price, 0);
    const pCmat = safePosNum(uex.cmat?.price, 0);

    // Beginner
    if (priceRmc) priceRmc.value = pRmc;
    if (priceCmat) priceCmat.value = pCmat;

    // Advanced (keep in sync)
    if (advPriceRmc) advPriceRmc.value = pRmc;
    if (advPriceCmat) advPriceCmat.value = pCmat;

    // lock badge + UI affordance
    state.locks.prices = (pRmc > 0 || pCmat > 0);
    if (uexLockBadge) uexLockBadge.style.display = state.locks.prices ? "" : "none";

    // Optional: soften input style when locked (CSS already supports .uex-locked)
    const container = document.querySelector(".page-salvage");
    if (container) container.classList.toggle("uex-locked", state.locks.prices);
  }

  function renderTopSales(listEl, topTerminals) {
    if (!listEl) return;

    const items = Array.isArray(topTerminals) ? topTerminals : [];
    if (!items.length) {
      setHtml(listEl, `<div class="top-sales-empty">Aucune donnée</div>`);
      return;
    }

    const html = items.slice(0, 3).map(t => {
      const name = t?.name || t?.terminal_name || "—";
      const loc = t?.location || t?.planet || t?.system || "";
      const sell = safePosNum(t?.sell, 0);
      return `
        <div class="sale-item top-sales-item">
          <div class="sale-main">
            <div class="sale-terminal top-sales-term">${escapeHtml(name)}</div>
            <div class="sale-location top-sales-loc">${escapeHtml(loc || "—")}</div>
          </div>
          <div class="sale-price top-sales-price">${fmtMoney(sell)}</div>
        </div>
      `;
    }).join("");

    setHtml(listEl, html);
  }

  function renderSellNowAdvanced(uex) {
    const bR = uex?.rmc?.bestTerminal || {};
    const bC = uex?.cmat?.bestTerminal || {};

    const rName = bR?.name || "—";
    const cName = bC?.name || "—";
    const rSell = safePosNum(bR?.sell, 0);
    const cSell = safePosNum(bC?.sell, 0);

    if (advBestRmcSale) setText(advBestRmcSale, rName);
    if (advBestRmcMeta) setText(advBestRmcMeta, rSell > 0 ? fmtMoney(rSell) : "—");

    if (advBestCmatSale) setText(advBestCmatSale, cName);
    if (advBestCmatMeta) setText(advBestCmatMeta, cSell > 0 ? fmtMoney(cSell) : "—");

    if (advMarketRmc) setText(advMarketRmc, rSell > 0 ? fmtMoney(rSell) : "—");
    if (advMarketCmat) setText(advMarketCmat, cSell > 0 ? fmtMoney(cSell) : "—");

    // Moment: recommend the higher value per SCU (simple)
    let moment = "—";
    let justif = "—";
    if (rSell > 0 || cSell > 0) {
      if (rSell >= cSell) {
        moment = "RMC";
        justif = `RMC ≥ CMAT (${fmtInt(rSell)} vs ${fmtInt(cSell)} aUEC/SCU)`;
      } else {
        moment = "CMAT";
        justif = `CMAT > RMC (${fmtInt(cSell)} vs ${fmtInt(rSell)} aUEC/SCU)`;
      }
    }
    if (advMarketMoment) setText(advMarketMoment, moment);
    if (marketJustification) setText(marketJustification, justif);
  }

  function setUexStatus(ok, extra = "") {
    const base = ok ? "UEX : OK." : "UEX : indisponible (saisie manuelle).";
    const msg = extra ? `${base} ${extra}` : base;

    if (uexStatusLine) setText(uexStatusLine, msg);
    if (uexStatusLineAdv) setText(uexStatusLineAdv, msg);

    if (uexLastUpdate) {
      const t = state.lastUexAt ? new Date(state.lastUexAt) : null;
      setText(uexLastUpdate, t ? `Dernière MAJ UEX : ${t.toLocaleString("fr-FR")}` : "Dernière MAJ UEX : —");
    }

    if (advChartStatus) {
      const src = state.uexSource ? `source: ${state.uexSource}` : "source: —";
      setText(advChartStatus, ok ? `UEX OK • ${src}` : `UEX KO • ${src}`);
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* -----------------------------
     CALCS
  ------------------------------*/

  function computeStatus(perHour, okThr, goodThr) {
    const v = safePosNum(perHour, 0);
    const okT = Math.max(0, safePosNum(okThr, DEFAULT_THR_OK));
    const goodT = Math.max(0, safePosNum(goodThr, DEFAULT_THR_GOOD));

    if (v <= 0) return { kind: "status-off", label: "—" };
    if (v >= goodT) return { kind: "status-good", label: "BON" };
    if (v >= okT) return { kind: "status-ok", label: "OK" };
    return { kind: "status-bad", label: "FAIBLE" };
  }

  function recalcBeginner() {
    const qRmc = safePosNum(scuRmc?.value, 0);
    const qCmat = safePosNum(scuCmat?.value, 0);

    const pRmc = safePosNum(priceRmc?.value, 0);
    const pCmat = safePosNum(priceCmat?.value, 0);

    const loopMin = Math.max(1, Math.round(safePosNum(begLoopMinutes?.value, 45)));
    const hours = loopMin / 60;

    const valRmc = qRmc * pRmc;
    const valCmat = qCmat * pCmat;
    const total = valRmc + valCmat;

    const perHour = hours > 0 ? (total / hours) : 0;

    if (outRmc) setText(outRmc, fmtMoney(valRmc));
    if (outCmat) setText(outCmat, fmtMoney(valCmat));
    if (outTotal) setText(outTotal, fmtMoney(total));
    if (outPerHour) setText(outPerHour, fmtPerHour(perHour));
    if (outPerHourBig) setText(outPerHourBig, fmtPerHour(perHour));

    const st = computeStatus(perHour, DEFAULT_THR_OK, DEFAULT_THR_GOOD);
    if (outStatus) setBadge(outStatus, st.kind, st.label);
  }

  function recalcAdvanced() {
    const qRmc = safePosNum(advScuRmc?.value, 0);
    const qCmatIn = safePosNum(advScuCmat?.value, 0);

    const pRmc = safePosNum(advPriceRmc?.value, 0);
    const pCmat = safePosNum(advPriceCmat?.value, 0);

    const loopMin = Math.max(1, Math.round(safePosNum(loopMinutes?.value, 45)));
    const hours = loopMin / 60;

    const fees = clamp01(safePosNum(feesPct?.value, 0) / 100); // 0..1

    const mode = cmatRefineMode?.value || "sell";
    const yieldPct = Math.max(0, Math.min(100, Math.round(safePosNum(cmatRefineYield?.value, 30))));

    // If refine mode: effective CMAT output is scaled by yield%
    const qCmatEff = (mode === "refine") ? (qCmatIn * (yieldPct / 100)) : qCmatIn;

    const valRmc = qRmc * pRmc;
    const valCmat = qCmatEff * pCmat;

    const gross = valRmc + valCmat;
    const net = gross * (1 - fees);
    const perHour = hours > 0 ? (net / hours) : 0;

    if (advValRmc) setText(advValRmc, fmtMoney(valRmc));
    if (advValCmat) setText(advValCmat, fmtMoney(valCmat));
    if (advGross) setText(advGross, fmtMoney(gross));
    if (advNet) setText(advNet, fmtMoney(net));
    if (advPerHour) setText(advPerHour, fmtPerHour(perHour));

    if (sumNet) setText(sumNet, fmtMoney(net));
    if (sumHours) setText(sumHours, `${hours.toFixed(2)} h`);
    if (sumPerHour) setText(sumPerHour, fmtPerHour(perHour));

    const okT = safePosNum(thrOk?.value, DEFAULT_THR_OK);
    const goodT = safePosNum(thrGood?.value, DEFAULT_THR_GOOD);
    const st = computeStatus(perHour, okT, goodT);
    if (sumStatus) setBadge(sumStatus, st.kind, st.label);
  }

  /* -----------------------------
     CHART (CANVAS)
  ------------------------------*/

  function getCanvasCtx() {
    if (!advPriceHistoryChart) return null;
    const ctx = advPriceHistoryChart.getContext("2d");
    return ctx || null;
  }

  
  /* -----------------------------
     CHART (ADV — UEX HISTORY)
     Goals:
     - Clean rendering in 2K (DPR-aware)
     - Dual Y axes (RMC left / CMAT right)
     - Robust parsing (strings, timestamps sec/ms)
     - Hover tracker (crosshair + tooltip with both prices)
     - SAFE: does not touch the rest of the module logic
  ------------------------------*/

  function parseTime(v) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      // seconds vs ms
      return n < 2_000_000_000 ? (n * 1000) : n;
    }
    const d = new Date(v);
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }

  function parsePrice(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;

    // Accept "7 497", "7,497", "7497.0"
    const s = String(v).trim()
      .replaceAll("\u00a0", " ")
      .replaceAll(" ", "")
      .replaceAll(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Convert UEX history array to [{t,v}] sorted asc, deduped by t
  function toSeries(history, preferredField = "sell") {
    const src = Array.isArray(history) ? history : [];
    const out = [];

    for (const it of src) {
      const t = parseTime(it?.t ?? it?.time ?? it?.ts ?? it?.at ?? it?.date ?? it?.createdAt);
      if (!t) continue;

      // Try common field names
      const v =
        parsePrice(it?.[preferredField]) ??
        parsePrice(it?.sell) ??
        parsePrice(it?.price) ??
        parsePrice(it?.value) ??
        parsePrice(it?.avg) ??
        parsePrice(it?.avg_sell) ??
        parsePrice(it?.avgSell);

      if (v === null) continue;
      out.push({ t, v });
    }

    // sort + dedupe
    out.sort((a, b) => a.t - b.t);
    const dedup = [];
    let lastT = null;
    for (const p of out) {
      if (lastT === p.t) {
        // keep latest value for same timestamp
        dedup[dedup.length - 1] = p;
      } else {
        dedup.push(p);
        lastT = p.t;
      }
    }

    // keep last N points (avoid spaghetti)
    const MAX_POINTS = 28;
    return dedup.length > MAX_POINTS ? dedup.slice(-MAX_POINTS) : dedup;
  }

  function boundsWithSpot(series, spotValue) {
    const b = boundsOf(series);
    const s = Number(spotValue);
    if (!Number.isFinite(s)) return b;
    if (!b) return { minV: s - 1, maxV: s + 1 };
    return {
      minV: Math.min(b.minV, s),
      maxV: Math.max(b.maxV, s),
    };
  }

  function boundsOf(series) {
    if (!series || !series.length) return null;
    let minV = Infinity, maxV = -Infinity;
    for (const p of series) {
      if (!Number.isFinite(p.v)) continue;
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return null;
    if (minV === maxV) { minV -= 1; maxV += 1; }
    return { minV, maxV };
  }

  function timeBounds(seriesA, seriesB) {
    const a = Array.isArray(seriesA) ? seriesA : [];
    const b = Array.isArray(seriesB) ? seriesB : [];
    const all = a.concat(b);
    if (!all.length) return null;
    let minT = Infinity, maxT = -Infinity;
    for (const p of all) {
      if (!Number.isFinite(p.t)) continue;
      if (p.t < minT) minT = p.t;
      if (p.t > maxT) maxT = p.t;
    }
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null;
    if (minT === maxT) { minT -= 3600_000; maxT += 3600_000; }
    return { minT, maxT };
  }

  function getCanvasCtx() {
    if (!advPriceHistoryChart) return null;
    return advPriceHistoryChart.getContext("2d");
  }

  function setCanvasDprSize() {
    if (!advPriceHistoryChart) return;

    const rect = advPriceHistoryChart.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));

    if (advPriceHistoryChart.width !== w) advPriceHistoryChart.width = w;
    if (advPriceHistoryChart.height !== h) advPriceHistoryChart.height = h;

    const ctx = getCanvasCtx();
    if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
  }

  function fmtDateShort(t) {
    const d = new Date(t);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }

  function drawChart(seriesR, seriesC, hoverT = null, spot = null) {
    if (!advPriceHistoryChart) return;

    setCanvasDprSize();
    const ctx = getCanvasCtx();
    if (!ctx) return;

    const tb = timeBounds(seriesR, seriesC);
    const spotR = spot && Number.isFinite(spot.rmc) ? spot.rmc : null;
    const spotC = spot && Number.isFinite(spot.cmat) ? spot.cmat : null;

    const bR = boundsWithSpot(seriesR, spotR);
    const bC = boundsWithSpot(seriesC, spotC);

    ctx.clearRect(0, 0, advPriceHistoryChart.width, advPriceHistoryChart.height);

    if (!tb || (!bR && !bC)) return;

    const w = advPriceHistoryChart.width;
    const h = advPriceHistoryChart.height;

    // Padding
    const pad = { l: 54, r: 54, t: 16, b: 28 };
    const gw = w - pad.l - pad.r;
    const gh = h - pad.t - pad.b;

    const xOf = (t) => pad.l + ((t - tb.minT) / Math.max(1, (tb.maxT - tb.minT))) * gw;

    const yOfR = (v) => {
      if (!bR) return pad.t + (gh / 2);
      return pad.t + (1 - ((v - bR.minV) / Math.max(1, (bR.maxV - bR.minV)))) * gh;
    };

    const yOfC = (v) => {
      if (!bC) return pad.t + (gh / 2);
      return pad.t + (1 - ((v - bC.minV) / Math.max(1, (bC.maxV - bC.minV)))) * gh;
    };

    // Grid (horizontal)
    ctx.strokeStyle = "rgba(231,236,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (gh * i / 4);
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + gw, y);
    }
    ctx.stroke();

    // X labels (dates)
    ctx.fillStyle = "rgba(231,236,255,0.65)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const ticksX = 5;
    for (let i = 0; i < ticksX; i++) {
      const tt = tb.minT + (tb.maxT - tb.minT) * (i / (ticksX - 1));
      const x = xOf(tt);
      ctx.fillText(fmtDateShort(tt), x - 16, h - 8);
    }

    // Y labels left (RMC) and right (CMAT)
    const yTicks = 5;
    if (bR) {
      ctx.fillStyle = "rgba(0,229,255,0.70)";
      for (let i = 0; i < yTicks; i++) {
        const v = bR.maxV - (bR.maxV - bR.minV) * (i / (yTicks - 1));
        const y = pad.t + (gh * i / (yTicks - 1));
        ctx.fillText(fmtInt(v), 8, y + 4);
      }
    }
    if (bC) {
      ctx.fillStyle = "rgba(231,236,255,0.70)";
      for (let i = 0; i < yTicks; i++) {
        const v = bC.maxV - (bC.maxV - bC.minV) * (i / (yTicks - 1));
        const y = pad.t + (gh * i / (yTicks - 1));
        const txt = fmtInt(v);
        const tw = ctx.measureText(txt).width;
        ctx.fillText(txt, w - 8 - tw, y + 4);
      }
    }

    function strokeSeries(series, stroke, fill, yFn) {
      if (!series || !series.length) return;

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      series.forEach((p, idx) => {
        const x = xOf(p.t);
        const y = yFn(p.v);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // points
      ctx.fillStyle = fill;
      for (const p of series) {
        const x = xOf(p.t);
        const y = yFn(p.v);
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // RMC (left axis)
    strokeSeries(seriesR, "rgba(0,229,255,0.90)", "rgba(0,229,255,0.90)", yOfR);
    // CMAT (right axis)
    strokeSeries(seriesC, "rgba(231,236,255,0.85)", "rgba(231,236,255,0.85)", yOfC);

    // Spot lines (actuel / best sell)
    // NOTE: We draw a dashed horizontal reference line for current UEX best sell (or fallback price),
    // so users can visually compare "historique" vs "prix actuel".
    function drawSpotLine(v, yFn, color, label, alignRight) {
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      const y = yFn(v);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + gw, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Small label near the axis edge
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = color;
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      const txt = `${label} ${fmtInt(v)}`;
      const tw = ctx.measureText(txt).width;
      const x = alignRight ? (pad.l + gw - tw - 6) : (pad.l + 6);
      ctx.fillText(txt, x, y - 6);
      ctx.restore();
    }

    // RMC spot (left)
    if (spotR !== null) drawSpotLine(spotR, yOfR, "rgba(0,229,255,0.95)", "Spot", false);
    // CMAT spot (right)
    if (spotC !== null) drawSpotLine(spotC, yOfC, "rgba(231,236,255,0.95)", "Spot", true);

    // Hover crosshair + highlights
    if (hoverT && Number.isFinite(hoverT)) {
      const x = xOf(hoverT);
      ctx.strokeStyle = "rgba(231,236,255,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + gh);
      ctx.stroke();

      const pR = nearestByTime(seriesR, hoverT);
      const pC = nearestByTime(seriesC, hoverT);

      if (pR) {
        const y = yOfR(pR.v);
        ctx.fillStyle = "rgba(0,229,255,1)";
        ctx.beginPath();
        ctx.arc(xOf(pR.t), y, 4.0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pC) {
        const y = yOfC(pC.v);
        ctx.fillStyle = "rgba(231,236,255,1)";
        ctx.beginPath();
        ctx.arc(xOf(pC.t), y, 4.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function nearestByTime(series, t) {
    if (!series || !series.length) return null;
    let best = null;
    let bestD = Infinity;
    for (const p of series) {
      const d = Math.abs(p.t - t);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  function timeAtX(xPx, tb) {
    const pad = { l: 54, r: 54 };
    const w = advPriceHistoryChart.width;
    const gw = w - pad.l - pad.r;
    const x = Math.max(pad.l, Math.min(pad.l + gw, xPx));
    const ratio = (x - pad.l) / Math.max(1, gw);
    return tb.minT + (tb.maxT - tb.minT) * ratio;
  }

  function setTooltip(on, x, y, title, lines) {
    if (!advChartTooltip) return;
    advChartTooltip.classList.toggle("is-on", !!on);
    advChartTooltip.setAttribute("aria-hidden", on ? "false" : "true");
    if (!on) return;

    // Position tooltip with horizontal clamping + edge docking (prevents clipping at chart end)
    const parent = advChartTooltip.parentElement;
    const pr = parent ? parent.getBoundingClientRect() : null;

    // Default anchor
    let leftPx = x;
    let mode = "center"; // center | left | right

    if(pr){
      const edgePad = 12;
      const rightDockAt = 170; // when near right edge, dock tooltip to the right side
      const leftDockAt  = 120; // when near left edge, dock tooltip to the left side

      if(leftPx > (pr.width - rightDockAt)){
        leftPx = pr.width - edgePad;
        mode = "right";
      }else if(leftPx < leftDockAt){
        leftPx = edgePad;
        mode = "left";
      }

      // Clamp (safety)
      leftPx = Math.max(edgePad, Math.min(pr.width - edgePad, leftPx));
    }

    // Keep Y anchored to cursor (we only flip vertically if needed)
    advChartTooltip.style.left = `${leftPx}px`;
    advChartTooltip.style.top = `${y}px`;

    const htmlLines = (Array.isArray(lines) ? lines : []).map(l => (
      `<div class="tt-line"><span class="tt-k">${escapeHtml(l.k)}</span><span class="tt-v">${escapeHtml(l.v)}</span></div>`
    )).join("");

    advChartTooltip.innerHTML = `
      <div class="tt-title">${escapeHtml(title)}</div>
      <div class="tt-body">${htmlLines}</div>
    `;

    // Flip vertically if out of bounds (top)
    const tr = advChartTooltip.getBoundingClientRect();
    const needsFlipY = pr && (tr.top < pr.top);

    const yPart = needsFlipY ? "18%" : "-120%";
    const xPart = (mode === "right") ? "-100%" : (mode === "left" ? "0%" : "-50%");
    advChartTooltip.style.transform = `translate(${xPart}, ${yPart})`;
  }

  function bindChartInteractions() {
    if (!advPriceHistoryChart) return;

    advPriceHistoryChart.addEventListener("mouseleave", () => {
      state.chart.hovering = false;
      state.chart.hoverT = null;
      setTooltip(false, 0, 0, "", []);
      drawChart(state.chart.seriesRmc, state.chart.seriesCmat, null, { rmc: state.chart.spotRmc, cmat: state.chart.spotCmat });
    });

    advPriceHistoryChart.addEventListener("mousemove", (ev) => {
      const rect = advPriceHistoryChart.getBoundingClientRect();
      const xCss = ev.clientX - rect.left;
      const yCss = ev.clientY - rect.top;

      // Convert CSS pixels to canvas pixels (DPR-aware)
      const dpr = advPriceHistoryChart.width / Math.max(1, rect.width);
      const x = xCss * dpr;
      const y = yCss * dpr;

      const tb = timeBounds(state.chart.seriesRmc, state.chart.seriesCmat);
      if (!tb) { setTooltip(false, 0, 0, "", []); return; }

      const t = timeAtX(x, tb);
      const pR = nearestByTime(state.chart.seriesRmc, t);
      const pC = nearestByTime(state.chart.seriesCmat, t);

      if (!pR && !pC) {
        state.chart.hovering = false;
        state.chart.hoverT = null;
        setTooltip(false, 0, 0, "", []);
        drawChart(state.chart.seriesRmc, state.chart.seriesCmat, null, { rmc: state.chart.spotRmc, cmat: state.chart.spotCmat });
        return;
      }

      // Title uses the nearest existing point time
      const tRef = (pR && pC) ? (Math.abs(pR.t - t) <= Math.abs(pC.t - t) ? pR.t : pC.t) : ((pR ? pR.t : pC.t));
      const dt = new Date(tRef);
      const title = dt.toLocaleString("fr-FR");

      const lines = [];
      if (pR) lines.push({ k: "RMC", v: `${fmtInt(pR.v)} aUEC/SCU` });
      if (pC) lines.push({ k: "CMAT", v: `${fmtInt(pC.v)} aUEC/SCU` });

      // Also show current spot (best sell) for reference
      if (Number.isFinite(state.chart.spotRmc) && state.chart.spotRmc > 0) lines.push({ k: "Spot RMC", v: `${fmtInt(state.chart.spotRmc)} aUEC/SCU` });
      if (Number.isFinite(state.chart.spotCmat) && state.chart.spotCmat > 0) lines.push({ k: "Spot CMAT", v: `${fmtInt(state.chart.spotCmat)} aUEC/SCU` });

      // Tooltip positioned in CSS pixels
      setTooltip(true, xCss, yCss, title, lines);

      state.chart.hovering = true;
      state.chart.hoverT = t;
      drawChart(state.chart.seriesRmc, state.chart.seriesCmat, t, { rmc: state.chart.spotRmc, cmat: state.chart.spotCmat });
    });
  }

  function updateChartFromUex(uex) {
    const r = toSeries(uex?.rmc?.history, "sell");
    const c = toSeries(uex?.cmat?.history, "sell");

    // Spot = "best sell" when available (matches Top ventes / vendre maintenant),
    // fallback to generic market price if best terminal is missing.
    const spotR = safePosNum(uex?.rmc?.bestTerminal?.sell, safePosNum(uex?.rmc?.price, 0));
    const spotC = safePosNum(uex?.cmat?.bestTerminal?.sell, safePosNum(uex?.cmat?.price, 0));

    state.chart.seriesRmc = r;
    state.chart.seriesCmat = c;
    state.chart.spotRmc = spotR;
    state.chart.spotCmat = spotC;

    drawChart(r, c, state.chart.hoverT || null, { rmc: spotR, cmat: spotC });
  }
/* -----------------------------
     RESET
  ------------------------------*/

  function resetBeginner() {
    if (scuRmc) scuRmc.value = 0;
    if (scuCmat) scuCmat.value = 0;
    if (priceRmc) priceRmc.value = 0;
    if (priceCmat) priceCmat.value = 0;

    // Keep ship preset loop minutes
    syncShipPreset(true);

    state.locks.prices = false;
    if (uexLockBadge) uexLockBadge.style.display = "none";
    const container = document.querySelector(".page-salvage");
    if (container) container.classList.remove("uex-locked");

    recalcBeginner();
  }

  function resetAdvanced() {
    if (advScuRmc) advScuRmc.value = 0;
    if (advScuCmat) advScuCmat.value = 0;
    if (advPriceRmc) advPriceRmc.value = 0;
    if (advPriceCmat) advPriceCmat.value = 0;

    if (feesPct) feesPct.value = 0;
    if (thrOk) thrOk.value = DEFAULT_THR_OK;
    if (thrGood) thrGood.value = DEFAULT_THR_GOOD;

    // Keep ship preset loop minutes
    syncShipPreset(true);

    recalcAdvanced();
  }

  /* -----------------------------
     EVENT WIRES
  ------------------------------*/

  function bindEvents() {
    // Mode buttons
    btnBeginner?.addEventListener("click", () => setMode("beginner"));
    btnAdvanced?.addEventListener("click", () => setMode("advanced"));

    // Ship / head presets
    shipSelect?.addEventListener("change", () => { syncShipPreset(true); recalcBeginner(); recalcAdvanced(); });
    salvageHeadSelect?.addEventListener("change", () => { syncHeadPreset(true); recalcBeginner(); recalcAdvanced(); });

    // Beginner inputs -> calc
    [scuRmc, scuCmat, begLoopMinutes, priceRmc, priceCmat].forEach(el => {
      el?.addEventListener("input", () => recalcBeginner());
    });

    // Advanced inputs -> calc
    [advScuRmc, advScuCmat, advPriceRmc, advPriceCmat, loopMinutes, feesPct, thrOk, thrGood, cmatRefineYield].forEach(el => {
      el?.addEventListener("input", () => recalcAdvanced());
    });

    cmatRefineMode?.addEventListener("change", () => {
      syncRefineVisibility();
      recalcAdvanced();
    });

    // Refresh UEX
    btnRefreshUex?.addEventListener("click", async () => {
      await doRefreshUex({ preferV1: false });
    });

    btnRefreshUexAdv?.addEventListener("click", async () => {
      await doRefreshUex({ preferV1: true });
    });

    btnChartRefreshAdv?.addEventListener("click", async () => {
      await doRefreshUex({ preferV1: true, chartOnly: true });
    });

    // Resets
    btnResetBeginner?.addEventListener("click", () => resetBeginner());
    btnResetAdvanced?.addEventListener("click", () => resetAdvanced());

    // Configs
    btnSaveConfig?.addEventListener("click", () => {
      const slot = configSlot?.value || "slot1";
      const all = loadAllConfigs();
      all[slot] = snapshotCurrentInputs();
      saveAllConfigs(all);
      setText(uexStatusLine, `Config ${slot.toUpperCase()} sauvegardée.`);
      setTimeout(() => setUexStatus(state.lastUexOk), 800);
    });

    btnLoadConfig?.addEventListener("click", () => {
      const slot = configSlot?.value || "slot1";
      const all = loadAllConfigs();
      applySnapshot(all[slot] || null);
      setText(uexStatusLine, `Config ${slot.toUpperCase()} chargée.`);
      setTimeout(() => setUexStatus(state.lastUexOk), 800);
    });
  }

  async function doRefreshUex({ preferV1 = false, chartOnly = false } = {}) {
    try {
      setUexStatus(false, "Chargement…");
      const uex = await refreshUex({ preferV1 });

      setUexStatus(true, "");

      // render + apply
      if (!chartOnly) {
        applyUexPricesToInputs(uex);
        renderTopSales(topRmc, uex?.rmc?.topTerminals);
        renderTopSales(topCmat, uex?.cmat?.topTerminals);
        renderSellNowAdvanced(uex);

        // also nudge advSellNowFeedback
        if (advSellNowFeedback) {
          const src = state.uexSource ? `source ${state.uexSource}` : "source inconnue";
          setText(advSellNowFeedback, `UEX OK (${src}) • MAJ: ${new Date(state.lastUexAt).toLocaleTimeString("fr-FR")}`);
        }
      }

      updateChartFromUex(uex);

      // Recalc after price fills
      recalcBeginner();
      recalcAdvanced();

    } catch (e) {
      setUexStatus(false, `${String(e?.message || e)}`);
      // keep manual inputs; just clear top lists if empty
      renderTopSales(topRmc, []);
      renderTopSales(topCmat, []);
      if (advSellNowFeedback) setText(advSellNowFeedback, "UEX KO • Mode manuel.");
      drawChart([], [], null, { rmc: 0, cmat: 0 });
      recalcBeginner();
      recalcAdvanced();
    }
  }

  /* -----------------------------
     INIT
  ------------------------------*/

  function init() {
    // Presets
    fillShipSelect();
    fillHeadSelect();

    syncShipPreset(true);
    syncHeadPreset(false);

    // Refine UI
    syncRefineVisibility();

    // Restore mode
    const ui = getUiState();
    setMode(ui.mode || "beginner");

    // Warm defaults for advanced thresholds
    if (thrOk && !thrOk.value) thrOk.value = DEFAULT_THR_OK;
    if (thrGood && !thrGood.value) thrGood.value = DEFAULT_THR_GOOD;

    // Bind chart
    bindChartInteractions();

    // Bind events
    bindEvents();

    // First paint
    recalcBeginner();
    recalcAdvanced();

    // Auto refresh UEX once at startup
    // (safe: if it fails, manual mode remains)
    doRefreshUex({ preferV1: false });

    // Debug hook (optional)
    window.__SALVAGE_APP__ = { version: APP_VERSION, refresh: doRefreshUex, state };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


/* =========================================================
   V1.4.37 — Tech footer wiring (SALVAGE) — restore Details toggle
   - Toggle via the whole bar button (#versionToggle)
   - Also toggle if user clicks on the label span (#versionToggleLabel)
   - Copy button keeps working and does not toggle
   ========================================================= */
(function(){
  const $ = (id) => document.getElementById(id);

  function initTechFooter(){
    const toggleBtn = $("versionToggle");
    const details = $("versionDetails");
    const label = $("versionToggleLabel");
    const copyBtn = $("copyVersionsBtn");

    if(!toggleBtn || !details) return;

    const isOpen = () => !details.classList.contains("is-hidden");

    const setOpen = (open) => {
      if(open){
        details.classList.remove("is-hidden");
        toggleBtn.setAttribute("aria-expanded", "true");
        details.setAttribute("aria-hidden", "false");
        if(label) label.textContent = "Masquer";
      }else{
        details.classList.add("is-hidden");
        toggleBtn.setAttribute("aria-expanded", "false");
        details.setAttribute("aria-hidden", "true");
        if(label) label.textContent = "Détails";
      }
    };

    // Keep initial state coherent
    setOpen(isOpen());

    const onToggle = (e) => {
      // If clicking copy, do nothing (copy handler manages it)
      if(e && e.target && (e.target.id === "copyVersionsBtn")) return;
      setOpen(!isOpen());
    };

    toggleBtn.addEventListener("click", onToggle);

    if(label){
      label.style.cursor = "pointer";
      label.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(e);
      });
    }

    // Escape closes
    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape" && isOpen()) setOpen(false);
    });

    // Copy should not toggle
    if(copyBtn){
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initTechFooter);
  }else{
    initTechFooter();
  }
})();


/* =========================================================
   CHART — Hover tracker UI (tooltip div overlay)
   - More readable than canvas-only
   - Keeps crosshair + nearest point highlight
   ========================================================= */
function ensureChartTooltip(container){
  if(!container) return null;
  let tip = container.querySelector(".chart-tooltip");
  if(tip) return tip;

  tip = document.createElement("div");
  tip.className = "chart-tooltip is-hidden";
  tip.innerHTML = `
    <div class="chart-tooltip__date"></div>
    <div class="chart-tooltip__row"><span class="dot dot-rmc"></span><span class="lbl">RMC</span><span class="val" data-k="rmc">—</span></div>
    <div class="chart-tooltip__row"><span class="dot dot-cmat"></span><span class="lbl">CMAT</span><span class="val" data-k="cmat">—</span></div>
  `;
  container.style.position = container.style.position || "relative";
  container.appendChild(tip);
  return tip;
}


/* Hook used by initChartHoverTracker().
   It expects window.__chartSeries = { labels:[], rmc:[], cmat:[], x:[] } to be set by the chart renderer.
*/
window.__salvageChartHover = function(event, canvas){
  const s = window.__chartSeries;
  if(!s || !Array.isArray(s.x) || s.x.length === 0) return null;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;

  // Find nearest by pixel x (precomputed)
  let best = 0;
  let bestD = Infinity;
  for(let i=0;i<s.x.length;i++){
    const d = Math.abs(s.x[i] - x);
    if(d < bestD){
      bestD = d;
      best = i;
    }
  }
  return {
    index: best,
    dateLabel: (s.labels && s.labels[best]) ? s.labels[best] : "",
    rmc: (s.rmc && s.rmc[best] != null) ? s.rmc[best] : null,
    cmat: (s.cmat && s.cmat[best] != null) ? s.cmat[best] : null,
  };
};


/* =========================================================
   V1.4.38 — Versions techniques (SALVAGE) — fill values
   Goal: populate the panel so bug reports include exact versions.
   - No network fetch
   - No endpoint exposure
   ========================================================= */
(function(){
  const TECH = {
    module: "RECYCLAGE",
    moduleVersion: "V1.4.35",
    html: "V1.4.35",
    css: "V1.4.38",
    js: "V1.4.38",
    core: "V1.5.20",
    ships: "v2.0.5",
    pu: "4.5",
    workerName: "UEX Proxy"
  };

  const $ = (id) => document.getElementById(id);
  function setText(id, v){
    const el = $(id);
    if(el) el.textContent = (v == null || v === "") ? "—" : String(v);
  }

  function fill(){
    setText("tvModuleSalvage", `${TECH.module} ${TECH.moduleVersion}`);
    setText("tvHtmlSalvage", TECH.html);
    setText("tvCssSalvage", TECH.css);
    setText("tvJsSalvage", TECH.js);
    setText("tvCoreSalvage", TECH.core);
    setText("tvShipsSalvage", TECH.ships);
    setText("tvPuSalvage", TECH.pu);

    // Worker/Contract/Gen/Source default
    setText("tvWorkerSalvage", `${TECH.workerName} —`);
    setText("tvContractSalvage", "—");
    setText("tvGenSalvage", "local");
    setText("tvSourceSalvage", "local");
  }

  // Optional hook: call this when a worker payload returns meta.
  // Example: window.__salvageOnProxyMeta(payload.meta)
  window.__salvageOnProxyMeta = function(meta){
    try{
      if(!meta) return;
      if(meta.workerVersion) setText("tvWorkerSalvage", `${TECH.workerName} ${meta.workerVersion}`);
      if(meta.contractVersion) setText("tvContractSalvage", meta.contractVersion);
      if(meta.generatedAt) setText("tvGenSalvage", meta.generatedAt);
      if(meta.gameVersion) setText("tvPuSalvage", meta.gameVersion);
      setText("tvSourceSalvage", "payload");
    }catch(_e){}
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", fill);
  }else{
    fill();
  }
})();


/* =========================================================
   V1.4.39 — Chart tracker polish (SALVAGE)
   - Crosshair + point snap overlay (non-destructive)
   - Better formatting (aUEC, thousands, monospace digits)
   - Touch support (tap/drag)
   Dependencies:
   - window.__chartSeries must expose: labels[], rmc[], cmat[], x[] (px in CSS space)
   - Optional: window.__chartSeries.yRmc[], yCmat[] (px in CSS space) for point dots
   ========================================================= */
(function(){
  const fmtAuec = (v) => {
    if(v == null || v === "" || Number.isNaN(Number(v))) return "—";
    const n = Number(v);
    try{
      return new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " aUEC";
    }catch(_){
      return String(Math.round(n)) + " aUEC";
    }
  };

  function ensureOverlayCanvas(wrap, baseCanvas){
    if(!wrap || !baseCanvas) return null;
    let c = wrap.querySelector("canvas.chart-overlay");
    if(c) return c;

    c = document.createElement("canvas");
    c.className = "chart-overlay";
    c.setAttribute("aria-hidden","true");
    c.style.position = "absolute";
    c.style.inset = "0";
    c.style.pointerEvents = "none";
    wrap.appendChild(c);
    return c;
  }

  function sizeOverlay(overlay, baseCanvas){
    const dpr = window.devicePixelRatio || 1;
    const rect = baseCanvas.getBoundingClientRect();
    overlay.width = Math.max(1, Math.round(rect.width * dpr));
    overlay.height = Math.max(1, Math.round(rect.height * dpr));
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    const ctx = overlay.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    return ctx;
  }

  function drawOverlay(ctx, canvasCssW, canvasCssH, x, yRmc, yCmat){
    ctx.clearRect(0,0,canvasCssW,canvasCssH);

    // Crosshair line
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x, canvasCssH - 8);
    ctx.stroke();

    // Points
    const drawDot = (y, alpha) => {
      if(typeof y !== "number" || !isFinite(y)) return;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI*2);
      ctx.stroke();
    };

    // RMC dot uses currentColor from CSS? We'll use explicit stroke/fill colors via computed styles on wrap (CSS vars)
    const root = document.documentElement;
    const accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "#00e5ff";
    const text = getComputedStyle(root).getPropertyValue("--text").trim() || "#e7ecff";

    // RMC
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    drawDot(yRmc, 0.95);

    // CMAT
    ctx.strokeStyle = text;
    ctx.fillStyle = text;
    drawDot(yCmat, 0.65);

    ctx.globalAlpha = 1;
  }

  function patchTooltipFormatting(){
    // If a tooltip exists, enforce formatting of value nodes.
    const tip = document.querySelector(".page-salvage .chart-tooltip");
    if(!tip) return;
    tip.classList.add("chart-tooltip--polished");
  }

  function initPolishedHover(){
    const baseCanvas = document.getElementById("advChartCanvas") || document.getElementById("priceHistoryCanvas");
    if(!baseCanvas) return;

    const wrap = baseCanvas.closest(".chart-wrap") || baseCanvas.parentElement;
    if(!wrap) return;

    const tip = wrap.querySelector(".chart-tooltip");
    const overlay = ensureOverlayCanvas(wrap, baseCanvas);
    if(!overlay) return;

    let ctx = null;

    const redraw = () => {
      ctx = sizeOverlay(overlay, baseCanvas);
    };
    redraw();
    window.addEventListener("resize", redraw);

    const hideOverlay = () => {
      if(!ctx) return;
      const rect = baseCanvas.getBoundingClientRect();
      ctx.clearRect(0,0,rect.width,rect.height);
    };

    const update = (clientX, clientY) => {
      const s = window.__chartSeries;
      if(!s || !Array.isArray(s.x) || s.x.length === 0) return;

      const rect = baseCanvas.getBoundingClientRect();
      const xCss = clientX - rect.left;
      const yCss = clientY - rect.top;

      // Nearest by x
      let best = 0;
      let bestD = Infinity;
      for(let i=0;i<s.x.length;i++){
        const d = Math.abs(s.x[i] - xCss);
        if(d < bestD){ bestD = d; best = i; }
      }

      // Tooltip values
      if(tip){
        tip.classList.remove("is-hidden");
        const dateEl = tip.querySelector(".chart-tooltip__date");
        const rmcEl = tip.querySelector('[data-k="rmc"]');
        const cmatEl = tip.querySelector('[data-k="cmat"]');

        if(dateEl) dateEl.textContent = (s.labels && s.labels[best]) ? s.labels[best] : "";
        if(rmcEl) rmcEl.textContent = fmtAuec(s.rmc ? s.rmc[best] : null);
        if(cmatEl) cmatEl.textContent = fmtAuec(s.cmat ? s.cmat[best] : null);

        // Position tooltip near cursor, clamped
        const pad = 12;
        const tw = tip.offsetWidth || 240;
        const th = tip.offsetHeight || 90;

        let left = xCss + pad;
        let top = yCss + pad;

        const maxL = rect.width - tw - 6;
        const maxT = rect.height - th - 6;
        if(left > maxL) left = xCss - tw - pad;
        if(top > maxT) top = yCss - th - pad;
        if(left < 6) left = 6;
        if(top < 6) top = 6;

        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      }

      // Overlay crosshair + snap points (if y arrays exist)
      const yRmc = (s.yRmc && typeof s.yRmc[best] === "number") ? s.yRmc[best] : undefined;
      const yCmat = (s.yCmat && typeof s.yCmat[best] === "number") ? s.yCmat[best] : undefined;

      const rect2 = baseCanvas.getBoundingClientRect();
      drawOverlay(ctx, rect2.width, rect2.height, s.x[best], yRmc, yCmat);
    };

    // Mouse events
    baseCanvas.addEventListener("mouseleave", () => {
      if(tip) tip.classList.add("is-hidden");
      hideOverlay();
    });
    baseCanvas.addEventListener("mousemove", (e) => update(e.clientX, e.clientY));

    // Touch events (tap/drag)
    baseCanvas.addEventListener("touchstart", (e) => {
      if(!e.touches || !e.touches[0]) return;
      const t = e.touches[0];
      update(t.clientX, t.clientY);
    }, { passive: true });
    baseCanvas.addEventListener("touchmove", (e) => {
      if(!e.touches || !e.touches[0]) return;
      const t = e.touches[0];
      update(t.clientX, t.clientY);
    }, { passive: true });
    baseCanvas.addEventListener("touchend", () => {
      if(tip) tip.classList.add("is-hidden");
      hideOverlay();
    });

    patchTooltipFormatting();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initPolishedHover);
  }else{
    initPolishedHover();
  }
})();

