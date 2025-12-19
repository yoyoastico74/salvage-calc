/* hauling.js — V1.13.19 FULL (Assisté: Top Routes Globales + click => bascule A→B)
   - FULL FILE (remplacement total)
   - Compatible hauling.html (tabs : tabBeginner/tabAdvanced, panels : panelBeginner/panelAdvanced)
   - Beginner: calcul manuel
   - Advanced:
       - A→B via /v1/hauling/terminals/search + /v1/hauling/route
       - Assisté via /v1/hauling/routes/top (scan terminaux, best-effort)
       - Clic sur une route => pré-remplit A/B + verrouille marchandise + lance analyse détaillée (B)
*/

(() => {
  "use strict";

  const VERSION = "V1.13.8a FULL";

  // ------------------------------------------------------------
  // TECH VERSIONS (FRET) — single source of truth (Mining-like footer)
  // ------------------------------------------------------------
  const TECH = {
    module: "FRET",
    moduleVersion: "V1.13.8a",
    html: "V1.13.0",
    css: "V1.13.5",
    js: "V1.13.8a",
    core: "V1.5.20",
    ships: "v2.0.5",
    pu: "4.5"
  };



  console.info("[hauling] loaded", VERSION);

  // ------------------------------------------------------------
  // CONFIG
  // ------------------------------------------------------------
  const PROXY_BASE = "https://uex-proxy.yoyoastico74.workers.dev";
  const GAME_VERSION = "4.5";
  const LS_KEY = "hauling.state.v1_10_2";

  // Assisted (Top Routes) defaults
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
    // Accept number or numeric string (UEX proxy may serialize numbers).
    const pick = (...vals) => {
      for(const v of vals){
        if(typeof v === "number" && Number.isFinite(v)) return v;
        if(typeof v === "string"){
          const f = parseFloat(v.replace(",", "."));
          if(Number.isFinite(f)) return f;
        }
      }
      return null;
    };

    const raw = pick(
      r?.stability100, r?.stability_100, r?.stabilityPercent, r?.stability_percent,
      r?.stabilityScore, r?.stability_score,
      r?.stability
    );

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
    const res = await fetch(url, { cache: "no-store", ...opts });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    try { updateTechFromPayload(json, url); } catch (_) {}
    return json;
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

  function renderGoodsList(results) {
    const list = $("advGoodsList");
    if (!list) return;

    const empty = $("advGoodsEmpty");
    if (!Array.isArray(results) || results.length === 0) {
      if (empty) empty.textContent = "Analyse une route pour afficher les résultats.";
      return;
    }
    if (empty) empty.remove();

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

    setAdvText("advCount", `${results.length} résultats`);
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
      return;
    }

    if (state.terminalsCache.q === query && (Date.now() - state.terminalsCache.ts) < 20_000) {
      renderTermDatalist(state.terminalsCache.items);
      setAdvText("advTermCount", `Terminaux : ${state.terminalsCache.items.length}`);
      return;
    }

    const url = `${PROXY_BASE}/v1/hauling/terminals/search?q=${encodeURIComponent(query)}&game_version=${encodeURIComponent(GAME_VERSION)}`;
    const payload = await fetchJson(url);
    const { data } = unwrapV1(payload);
    const terminals = Array.isArray(data?.terminals) ? data.terminals : [];

    state.terminalsCache.ts = Date.now();
    state.terminalsCache.q = query;
    state.terminalsCache.items = terminals;

    renderTermDatalist(terminals);
    setAdvText("advTermCount", `Terminaux : ${terminals.length}`);
  }

  function renderTermDatalist(items) {
    const dl = $("advTerminalsDatalist");
    if (!dl) return;
    dl.innerHTML = "";
    (items || []).slice(0, 30).forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.name || "";
      opt.label = t.system ? `${t.name} — ${t.system}` : (t.name || "");
      dl.appendChild(opt);
    });
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

      if (!fromName || !toName || shipScu <= 0) {
        setAdvText("advRouteStatus", "Paramètres incomplets (A, B, SCU).");
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
      renderTopRoutes(sorted, state.assisted.lastScan || null);
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
  // ASSISTÉ: Top Routes Globales
  // ------------------------------------------------------------
  function clearResultsArea(message) {
    const row = $("top3Row");
    if (row) row.innerHTML = `<div class="empty">${escapeHtml(message || "—")}</div>`;
    const list = $("advGoodsList");
    if (list) list.innerHTML = `<div id="advGoodsEmpty" class="empty">${escapeHtml(message || "—")}</div>`;
    setAdvText("advCount", "—");
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

  async function fetchTopRoutes() {
    const btn = $("advAssist");
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

      const url =
        `${PROXY_BASE}/v1/hauling/routes/top?ship_scu=${encodeURIComponent(shipScu)}` +
        `&budget=${encodeURIComponent(budget)}` +
        `&risk=${encodeURIComponent(state.advanced.risk)}` +
        `&limit=${encodeURIComponent(TOP_ROUTES_LIMIT)}` +
        `&max_terminals=${encodeURIComponent(TOP_ROUTES_MAX_TERMINALS)}` +
        `&game_version=${encodeURIComponent(GAME_VERSION)}`;

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
      state.assisted.lastRoutes = routes;
      state.assisted.lastScan = data?.scan || null;
      state.assisted.active = true;
      state.routeCache.lastResultsRaw = [];
      state.routeCache.lastResults = [];
      state.routeCache.lastMeta = null;
      state.routeCache.lastPayload = null;

      // Assisted view: no commodity lock forced; user chooses by clicking a route
      unlockCommodity();

      renderTopRoutes(routes, data?.scan || null);
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
      const q = String(e?.target?.value || "").trim();
      if (termTimer) clearTimeout(termTimer);
      termTimer = setTimeout(() => { advSearchTerminals(q).catch(() => {}); }, 220);
      saveState();
    };
    $("advRouteFrom")?.addEventListener("input", onTermInput);
    $("advRouteTo")?.addEventListener("input", onTermInput);

    $("advRouteAnalyze")?.addEventListener("click", analyzeRouteAdvanced);
    $("advRefresh")?.addEventListener("click", analyzeRouteAdvanced);

    // New: Assisté (Top routes)
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

    const pre = ($("advRouteFrom")?.value || "").trim();
    if (pre.length >= 2) advSearchTerminals(pre).catch(() => {});
  }

  window.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => console.warn("[hauling] init failed:", e));
  });

})();


