
  function fmtPct(v){
    const n = Number(v);
    if(!Number.isFinite(n)) return "-";
    if(n === 0) return "0%";
    if(Math.abs(n) < 1) return `${n.toFixed(2)}%`;
    if(Math.abs(n) < 10) return `${n.toFixed(1)}%`;
    return `${Math.round(n)}%`;
  }
/* assets/js/mining.js - Version V1.5.29
   Module: MINAGE (Mode Débutant) - Mega Package (suite)
   Changements V1.2.1 :
   - Suppression des phrases/hints demandés (texte UI)
   - Unités mSCU pour ROC / ROC-DS / FPS (Mode Minerai)
   - Conversion interne: 1 SCU = 1000 mSCU
   - Capacité ROC/ROC-DS affichée en mSCU + alerte dépassement en mSCU
   - Ship reste en SCU (Mode Minerai)

   Dépendances :
   - miningShips.js expose window.getMiningShips() et window.getShipCapacity()
   - mining_ores_ship.json + mining_ores_roc.json (datasets locaux)
*/

(function(){
  "use strict";

  // Ensure global hooks exist even if some parts of the module are loaded in a different scope
  try{ window.oreDataShip = window.oreDataShip || null; }catch(_){ }
  try{ window.oreDataRoc = window.oreDataRoc || null; }catch(_){ }


  // Base URLs resolved robustly for GitHub Pages subpaths and /pages/* routes
  // We prefer resolving from the actual mining.js <script> src, but we also guard against absolute "/assets/..." paths
  // that would ignore the repo subpath on GitHub Pages (e.g. "/salvage-calc/").
  const __SCRIPT_URL__ = (() => {
    try{
      if (document.currentScript && document.currentScript.src) return document.currentScript.src;
      const s = document.querySelector('script[src*="mining.js"]');
      if (s && s.src) return s.src;
    }catch(e){}
    return window.location.href;
  })();

  const __REPO_BASE__ = (() => {
    try{
      const p = window.location.pathname || "/";
      if (p.includes("/pages/")) return p.split("/pages/")[0] + "/";
      // e.g. /salvage-calc/mining.html -> /salvage-calc/
      return p.substring(0, p.lastIndexOf("/") + 1);
    }catch(e){ return "/"; }
  })();

  const __SCRIPT_PATH__ = (() => {
    try{
      const u = new URL(__SCRIPT_URL__, window.location.origin);
      return u.pathname || "";
    }catch(e){ return ""; }
  })();

  // Default: resolve from script location
  let DATA_URL = new URL("../data/", __SCRIPT_URL__).toString();

  // GitHub Pages guard: if script path starts with "/assets/" but the page is under a repo base ("/salvage-calc/"),
  // then DATA_URL must include the repo base.
  if (__SCRIPT_PATH__.startsWith("/assets/") && __REPO_BASE__ !== "/"){
    DATA_URL = window.location.origin + __REPO_BASE__ + "assets/data/";
  }


  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);

  const clamp = (n, min, max) => {
    if (!Number.isFinite(n)) return min;
    return Math.min(Math.max(n, min), max);
  };

  const intSafe = (v) => {
    const n = parseInt(String(v ?? "").replace(/\s+/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const floatSafe = (v) => {
    const n = parseFloat(String(v ?? "").replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");

  const fmtPct = (n) => {
    if (!Number.isFinite(n)) return "-";
    const abs = Math.abs(n);
    let v;
    if (abs < 1) v = Math.round(n * 100) / 100;
    else if (abs < 10) v = Math.round(n * 10) / 10;
    else v = Math.round(n);
    const sign = v > 0 ? "+" : "";
    return sign + v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + "%";
  };

  const fmtMin = (min) => {
    if (!Number.isFinite(min) || min <= 0) return "-";
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const m = Math.round(min - h * 60);
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    return `${Math.round(min)} min`;
  };

  const SCU_TO_MSCU = 1000;
    // ---------- Elements ----------
  const elType = $("#miningType");
  const elSession = $("#sessionMinutes");
  const elTarget = $("#targetPerHour");

  // Mode toggle
  const btnModeExpress = $("#modeExpressBtn");
  const btnModeOre = $("#modeOreBtn");
  const panelExpress = $("#modeExpressPanel");
  const panelOre = $("#modeOrePanel");
  const panelOreSelected = $("#oreSelectedPanel");

  // Express value
  const elCargo = $("#cargoValue");

  // Ore mode
  const elOreAvailList = $("#oreAvailList");
  const elOreSelectedList = $("#oreSelectedList");
  const elTopSellersOreLabel = $("#topSellersOreLabel");
  const elTopSellersList = $("#topSellersList");
  const elOreUnitLabel = $("#oreUnitLabel");
  const elOreQtyHint = $("#oreQtyHint");
  const elOreUnitRatio = $("#oreUnitRatio");
  const elOreCapHint = $("#oreCapHint");

  // Ship picker
  const elShipField = $("#miningShipField");
  const elShipInput = $("#miningShip");
  const elShipPickerBtn = $("#miningShipPickerBtn");
  const elShipPickerMenu = $("#miningShipPickerMenu");
  const elShipPickerLabel = $("#miningShipPickerLabel");
  const elShipCapacityHint = $("#shipCapacityHint");

  // Type picker
  const elTypePickerBtn = $("#miningTypePickerBtn");
  const elTypePickerMenu = $("#miningTypePickerMenu");
  const elTypePickerLabel = $("#miningTypePickerLabel");
  const typePickerItems = elTypePickerMenu ? Array.from(elTypePickerMenu.querySelectorAll(".picker-item")) : [];

  // KPIs
  const elKpiTotal = $("#kpiTotal");
  const elKpiRun = $("#kpiRun");
  const elKpiHour = $("#kpiHour");
  const elKpiDelta = $("#kpiDelta");
  const elKpiTimeToTarget = $("#kpiTimeToTarget");

  const elVerdictPill = $("#verdictPill");
  const elVerdictReason = $("#verdictReason");

  // Badges
  const elBadgesRow = $("#badgesRow");
  const elBadgeRisk = elBadgesRow ? elBadgesRow.querySelector(".badge-risk") : null;
  const elBadgeStable = elBadgesRow ? elBadgesRow.querySelector(".badge-stable") : null;

  // Sellers
  const elSellersList = $("#sellersList");
  const elSellersNote = $("#sellersNote");

  // Presets / reset
  const presetButtons = Array.from(document.querySelectorAll(".btn-preset"));
  const btnReset = $("#resetBtn");

  // ---------- State ----------
  const DEFAULTS = {
    type: "roc",
    mode: "express", // express | ore
    sessionMinutes: 30,
    targetPerHour: 80000
  };

  const desiredShipOrder = ["Golem", "Prospector", "MOLE", "Arrastra", "Orion"];

  // Capacités (mineral storage)
  const CAPACITY_SCU = {
    roc: 1.2,
    rocds: 3.4
  };

  let shipListLoaded = false;

  let oreDataShip = (typeof window !== "undefined" && window.oreDataShip) ? window.oreDataShip : null;
  let oreDataRoc = (typeof window !== "undefined" && window.oreDataRoc) ? window.oreDataRoc : null;

  let selectedOreKeysShip = [];
  let selectedOreKeysRoc = [];
  let activeOreKeyShip = null;
  let activeOreKeyRoc = null;
  let miningLiveLastOresMap = null;
  let oreQtyByKeyShip = Object.create(null);
  let oreQtyByKeyRoc = Object.create(null);


  // ---------- Mining Live API (Worker) ----------
  // This optional overlay replaces local ore prices with live UEX-derived prices served by your Worker.
  // Config (optional):
  //   window.SC_HUB_CONFIG = {
  //     MINING_LIVE_ENABLED: true,
  //     MINING_LIVE_API_BASE: "https://miningliveapibase.yoyoastico74.workers.dev",
  //     MINING_LIVE_PREFER: "avg",   // "avg" | "last"
  //     MINING_LIVE_TOP: 5
  //   };
  const MINING_LIVE_DEFAULT_BASE = ""; // configurable via SC_HUB_CONFIG.MINING_LIVE_API_BASE or localStorage (SC_MINING_LIVE_API_BASE)
  let miningLiveLastFetchAt = 0;
  let miningLiveInFlight = null;
  let miningLiveMeta = null;
  let miningLiveStatusEl = null;
  let miningLiveAvailable = false;

  function miningLiveGetApiBase(){
    const fromConfig = (window.SC_HUB_CONFIG && typeof window.SC_HUB_CONFIG.MINING_LIVE_API_BASE === "string")
      ? window.SC_HUB_CONFIG.MINING_LIVE_API_BASE.trim()
      : "";
    const fromLs = (()=>{ try{ return (localStorage.getItem("SC_MINING_LIVE_API_BASE")||"").trim(); }catch(_){ return ""; }})();
    return (fromConfig || fromLs || miningLiveGetApiBase() || "").replace(/\/+$/,"");
  }

  function miningLiveSetApiBase(v){
    const clean = (v||"").trim().replace(/\/+$/,"");
    try{ localStorage.setItem("SC_MINING_LIVE_API_BASE", clean); }catch(_){}
    return clean;
  }


  function miningLiveEnsureStatusEl(){
    if (miningLiveStatusEl) return miningLiveStatusEl;
    const panel = document.getElementById("oreSelectedPanel");
    if (!panel) return null;
    let el = panel.querySelector(".mining-live-status");
    if (!el){
      el = document.createElement("div");
      el.className = "mining-live-status";
      // Insert under the unit ratio line if present, else at the bottom
      const anchor = document.getElementById("oreUnitRatio");
      if (anchor && anchor.parentElement === panel){
        anchor.insertAdjacentElement("afterend", el);
      } else {
        panel.appendChild(el);
      }
    }
    miningLiveStatusEl = el;
    return el;
  }

  function miningLiveFormatTs(ts){
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = (n < 2e10) ? (n * 1000) : n; // seconds -> ms heuristic
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  function miningLiveSetStatus(kind, details){
    const el = miningLiveEnsureStatusEl();
    if (!el) return;
    const cfg = miningLiveGetConfig();
    let text = "Source prix : Local";

    if (kind === "loading") text = `Source prix : Live UEX (${cfg.prefer}) - chargement...`;
    if (kind === "idle") text = `Source prix : Live UEX (${cfg.prefer})`;
    if (kind === "live"){
      const ts = details && details.updated_at ? miningLiveFormatTs(details.updated_at) : null;
      text = `Source prix : Live UEX (${cfg.prefer})${ts ? " - maj " + ts : ""}`;
    }
    if (kind === "error"){
      text = `Source prix : Local (Live UEX indisponible)`;
    }

    el.textContent = text;
    el.style.cssText = "margin-top:10px;font-size:12px;opacity:.85;";
  }


  function miningLiveGetConfig(){
    const cfg = (window.SC_HUB_CONFIG && typeof window.SC_HUB_CONFIG === "object") ? window.SC_HUB_CONFIG : {};
    const enabled = cfg.MINING_LIVE_ENABLED !== false; // enabled by default once a base is present
    const preferRaw = String(cfg.MINING_LIVE_PREFER || "avg").toLowerCase();
    const prefer = "best"; // forced: best terminal price (no avg)
    const top = Math.min(10, Math.max(1, Number.parseInt(String(cfg.MINING_LIVE_TOP ?? 5), 10) || 5));

    let base = String(cfg.MINING_LIVE_API_BASE || miningLiveGetApiBase()).trim();
    base = miningLiveSanitizeBase(base);

    return {
      enabled: Boolean(enabled),
      base,
      prefer,
      top,
      minIntervalMs: 60 * 1000
    };
  }

  function miningLiveSanitizeBase(base){
    let b = String(base || "").trim();
    if (!b) return "";
    b = b.replace(/\s+/g, "");
    b = b.replace(/\/+$/, "");

    // Make base absolute to avoid relative-fetch mistakes (e.g. "miningliveapibase...").
    // Allowed inputs:
    //  - https://host/api/mining
    //  - //host/api/mining
    //  - /api/mining  (same-origin)
    //  - host/api/mining
    if (!/^https?:\/\//i.test(b)){
      if (b.startsWith("//")){
        b = "https:" + b;
      } else if (b.startsWith("/")){
        b = (window.location && window.location.origin ? window.location.origin : "") + b;
      } else {
        b = "https://" + b;
      }
    }

    // If user pasted an endpoint, strip it back to the base
    b = b.replace(/\/(health|ores)(\?.*)?$/i, "");
    b = b.replace(/\/debug\/commodities(\?.*)?$/i, "");
    return b.replace(/\/+$/, "");
  }

  function miningLiveMakeOresUrl(base, keys, prefer, top){
    const qp = new URLSearchParams();
    qp.set("keys", keys.join(","));
    qp.set("prefer", prefer);
    qp.set("top", String(top));
    return base + "/ores?" + qp.toString();
  }

  
  async function miningLivePingHealth(base){
    try{
      const b = miningLiveSanitizeBase(base);
      if (!b) return { ok:false, error:"no_base" };
      const url = b + "/health";
      const res = await fetch(url, { method: "GET", headers: { "Accept":"application/json" } });
      if (!res.ok) return { ok:false, error:"http_"+res.status };
      const j = await res.json().catch(()=>null);
      return { ok:true, data:j };
    }catch(e){
      return { ok:false, error:String(e && e.message ? e.message : e) };
    }
  }

async function miningLiveFetchOres(keys, prefer, top){
    const cfg = miningLiveGetConfig();
    if (!cfg.enabled) return null;

    const uniq = Array.from(new Set(keys.filter(Boolean)));
    if (!uniq.length) return null;

    // Try both base styles to survive Worker route mounting differences.
    const basesToTry = [];
    if (cfg.base) basesToTry.push(cfg.base);
    if (cfg.base && !/\/api\/mining$/i.test(cfg.base)) basesToTry.push(cfg.base.replace(/\/+$/,"") + "/api/mining");

    let lastErr = null;

    for (const b of basesToTry){
      const url = miningLiveMakeOresUrl(b, uniq, prefer, top);
      try{
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json().catch(() => null);

        if (!res.ok){
          lastErr = new Error((data && data.message) ? data.message : ("HTTP " + res.status));
          continue;
        }
        // Accept both `ores` and `data` contract
        const ores = (data && (data.ores || data.data)) ? (data.ores || data.data) : null;
        if (ores && typeof ores === "object"){
          return {
            oresMap: ores,
            meta: {
              updated_at: data && (data.updated_at ?? data.updatedAt),
              source: data && data.source,
              prefer: data && data.prefer,
              top: data && data.top
            }
          };
        }
lastErr = new Error("Invalid live payload.");
      }catch(e){
        lastErr = e;
      }
    }

    throw lastErr || new Error("Live fetch failed.");
  }

  async function miningLiveProbeAvailability(){
    const cfg = miningLiveGetConfig();
    if (!cfg.enabled || !cfg.base) return false;

    // Ensure we probe the worker root (strip /api/mining if user configured it)
    const root = String(cfg.base).replace(/\/api\/mining$/i, "");
    const urls = [
      root.replace(/\/+$/, "") + "/health",
      root.replace(/\/+$/, "") + "/"
    ];

    for (const u of urls){
      try{
        const res = await fetch(u, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        if (data && data.status === "ok"){
          miningLiveAvailable = true;
          miningLiveSetStatus("idle");
          return true;
        }
      }catch(_){}
    }

    miningLiveAvailable = false;
    miningLiveSetStatus("local");
    return false;
  }

  function miningLiveApplyOverlay(oresMap){
    if (!oresMap || typeof oresMap !== "object") return 0;
    miningLiveLastOresMap = oresMap;

    let changed = 0;

    function applyToDataset(ds){
      if (!ds || !Array.isArray(ds.ores)) return;
      for (const o of ds.ores){
        const live = oresMap[o.key];
        if (!live) continue;

        const p = Number(live.price_auEc_per_scu);
        if (Number.isFinite(p) && p > 0){
          o.price_auEc_per_scu = p;
        }

        // Optional debug fields (Worker V1.1.1+)
        if (live.price_last != null && Number.isFinite(Number(live.price_last))) {
          o.price_last = Number(live.price_last);
        } else {
          delete o.price_last;
        }
        if (live.price_avg != null && Number.isFinite(Number(live.price_avg))) {
          o.price_avg = Number(live.price_avg);
        } else {
          delete o.price_avg;
        }
        if (live.price_field) {
          o.price_field = String(live.price_field);
        } else {
          delete o.price_field;
        }

        // Sellers (Top terminals)
        const sellersArr = Array.isArray(live.sellers) ? live.sellers : [];
        const normalizedSellers = sellersArr
          .map((s) => ({
            name: (s && (s.display_name || s.name)) ? String(s.display_name || s.name) : "Terminal",
            price_auEc_per_scu: Number(s && (s.price_auEc_per_scu ?? s.price_auec_per_scu ?? s.price)),
          }))
          .filter((s) => Number.isFinite(s.price_auEc_per_scu) && s.price_auEc_per_scu > 0);

        if (normalizedSellers.length > 0) {
          o.sellers = normalizedSellers;
        } else if (Number.isFinite(Number(live.best_sell)) && Number(live.best_sell) > 0) {
          const bestName = live.best_sell_terminal_name || live.best_sell_terminal || live.best_sell_terminal_slug || "Meilleur terminal";
          o.sellers = [{
            name: String(bestName),
            price_auEc_per_scu: Number(live.best_sell),
          }];
        } else {
          // Do not wipe local sellers if Live has none
          if (!Array.isArray(o.sellers)) o.sellers = [];
        }

        o.__live_ts = Date.now();
        changed++;
      }
    }

    applyToDataset(oreDataShip);
    applyToDataset(oreDataRoc);

    return changed;
  }

  function miningLiveRefreshCurrentSelection(force=false){
    const cfg = miningLiveGetConfig();
    if (!cfg.enabled || !cfg.base) return;

    const now = Date.now();
    if (!force && (now - miningLiveLastFetchAt) < cfg.minIntervalMs) return;
    if (miningLiveInFlight) return;

    const { selectedKeys } = getActiveOreDataset();
    const keys = Array.isArray(selectedKeys) ? selectedKeys : [];
    if (!keys.length){ miningLiveSetStatus(miningLiveAvailable ? "idle" : "local"); return; }

    miningLiveSetStatus("loading");

    miningLiveInFlight = miningLiveFetchOres(keys, cfg.prefer, cfg.top)
      .then((payload) => {
        const oresMap = payload && payload.oresMap ? payload.oresMap : payload;
        miningLiveMeta = payload && payload.meta ? payload.meta : null;
        miningLiveApplyOverlay(oresMap);
        miningLiveLastFetchAt = Date.now();
        miningLiveAvailable = true;
        miningLiveSetStatus("live", miningLiveMeta);
        try { updateVersionFooterLive(); } catch(e) {}
        // Re-render and recompute to reflect live prices
        renderOreChips();
        compute();
      })
      .catch((e) => {
        // Silent fail (no blocking UI). Debug in console.
        console.warn("[MINING] Live API unavailable:", e && e.message ? e.message : e);
        miningLiveAvailable = false;
        miningLiveSetStatus("error");
      })
      .finally(() => {
        miningLiveInFlight = null;
      });
  }

  // ---------- UI helpers ----------
  function closeMenu(menuEl, btnEl){
    if (!menuEl || !btnEl) return;
    menuEl.classList.add("is-hidden");
    btnEl.setAttribute("aria-expanded", "false");
  }
  function openMenu(menuEl, btnEl){
    if (!menuEl || !btnEl) return;
    menuEl.classList.remove("is-hidden");
    btnEl.setAttribute("aria-expanded", "true");
  }
  function toggleMenu(menuEl, btnEl){
    if (!menuEl || !btnEl) return;
    const open = !menuEl.classList.contains("is-hidden");
    if (open) closeMenu(menuEl, btnEl); else openMenu(menuEl, btnEl);
  }

  function getType(){
    return String(elType?.value || DEFAULTS.type);
  }

  function isVehicleType(t){ return (t === "roc" || t === "rocds"); }

  function setOreUnitLabel(){
  const t = getType();
  const useMSCU = isVehicleType(t);

  // Label in UI: Quantité (mSCU) for ROC/ROC-DS, SCU for ships
  if (elOreUnitLabel) elOreUnitLabel.textContent = useMSCU ? "mSCU" : "SCU";

  // Update all quantity inputs in the selected list (multi-ore)
  const inputs = document.querySelectorAll(".ore-qty-input");
  inputs.forEach((inp) => {
    inp.inputMode = "decimal";
    inp.step = useMSCU ? "1" : "0.01";
    inp.placeholder = useMSCU ? "1000" : "1.0";
    inp.setAttribute("aria-label", useMSCU ? "Quantité en mSCU" : "Quantité en SCU");
  });

  // Conversion ratio badge
  if (elOreUnitRatio){
    elOreUnitRatio.textContent = useMSCU
      ? "1 mSCU = 0.001 SCU / 1 SCU = 1 000 mSCU"
      : "1 SCU = 1 000 mSCU / 1 mSCU = 0.001 SCU";
  }
}

  // ---------- Type picker ----------
  function syncTypePicker(){
    if (!elType) return;
    const value = getType();

    typePickerItems.forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });

    const active = typePickerItems.find((b) => String(b.dataset.value) === value);
    if (active) {
      active.classList.add("is-active");
      active.setAttribute("aria-selected", "true");
      if (elTypePickerLabel) elTypePickerLabel.textContent = String(active.textContent || "").trim();
    }
  }

  function setType(value){
    if (!elType) return;
    elType.value = value;
    syncTypePicker();

    if (DEFAULTS.mode === "ore") renderOreChips();
    setOreUnitLabel();

    compute();
    miningLiveRefreshCurrentSelection(true);
    closeMenu(elTypePickerMenu, elTypePickerBtn);
  }

  // ---------- Ship picker ----------
  function setShip(name){
    if (elShipInput) elShipInput.value = name || "";
    if (elShipPickerLabel) elShipPickerLabel.textContent = name || "Sélectionner un vaisseau";
    closeMenu(elShipPickerMenu, elShipPickerBtn);
    refreshShipCapacityHint();
  }

  async function refreshShipCapacityHint(){
    if (!elShipCapacityHint) return;
    const t = getType();

    // Only ship type uses this hint; keep it minimal (no phrase)
    if (t !== "ship") {
      elShipCapacityHint.textContent = "";
      return;
    }

    const shipName = elShipInput?.value || null;
    if (!shipName || typeof window.getShipCapacity !== "function") {
      elShipCapacityHint.textContent = "";
      return;
    }

    try {
      const cap = await window.getShipCapacity(shipName);
      elShipCapacityHint.textContent = (cap === null || cap === 0) ? "" : `Capacité : ${cap} SCU.`;
    } catch {
      elShipCapacityHint.textContent = "";
    }
  }

  async function loadShipsOnce(){
    if (shipListLoaded) return;
    shipListLoaded = true;

    if (!elShipPickerMenu) return;
    if (typeof window.getMiningShips !== "function") {
      elShipPickerMenu.innerHTML = "<div class=\"picker-empty\">Source vaisseaux indisponible</div>";
      return;
    }

    try {
      const ships = await window.getMiningShips();

      const filtered = ships
        .filter(s => !["ROC","ROC-DS","Expanse","Golem OX"].includes(String(s.name)))
        .sort((a, b) => {
          const ia = desiredShipOrder.indexOf(String(a.name));
          const ib = desiredShipOrder.indexOf(String(b.name));
          const ra = ia === -1 ? 999 : ia;
          const rb = ib === -1 ? 999 : ib;
          return ra - rb || String(a.name).localeCompare(String(b.name));
        });

      elShipPickerMenu.innerHTML = "";

      filtered.forEach((ship) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "picker-item";
        btn.dataset.value = ship.name;
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", "false");
        btn.textContent = ship.name;

        btn.addEventListener("click", () => {
          Array.from(elShipPickerMenu.querySelectorAll(".picker-item")).forEach((b) => {
            b.classList.remove("is-active");
            b.setAttribute("aria-selected", "false");
          });
          btn.classList.add("is-active");
          btn.setAttribute("aria-selected", "true");
          setShip(ship.name);
          compute();
        });

        elShipPickerMenu.appendChild(btn);
      });

      if (!filtered.length) {
        elShipPickerMenu.innerHTML = "<div class=\"picker-empty\">Aucun vaisseau Mining trouvé</div>";
      }
    } catch (e) {
      elShipPickerMenu.innerHTML = "<div class=\"picker-empty\">Erreur chargement vaisseaux</div>";
      console.error(e);
    }
  }

  // ---------- Ore datasets ----------

function normalizeOreDataset(raw){
  // Expected shape for UI: { ores: [...] }
  if (raw && typeof raw === "object" && Array.isArray(raw.ores)) return raw;
  if (Array.isArray(raw)) return { ores: raw };
  return { ores: [] };
}

  async function loadOreDataShip(force=false){
  // Loads ship ores catalog from local JSON and keeps both local + window cache in sync.
  // Returns the parsed object (or {ores:[]} on failure).
  try{
    if(!force){
      // Prefer window cache if available
      if(typeof window !== "undefined" && window.oreDataShip && (window.oreDataShip.ores || Array.isArray(window.oreDataShip))){
        oreDataShip = window.oreDataShip;
        return Promise.resolve(window.oreDataShip);
      }
      if(oreDataShip && (oreDataShip.ores || Array.isArray(oreDataShip))) return Promise.resolve(oreDataShip);
    }
  }catch(_){}

  // Candidate local URLs (covers /pages/ and root hosting)
  const candidates = [
    "/assets/data/mining_ores_ship.json",
    "assets/data/mining_ores_ship.json",
    "../assets/data/mining_ores_ship.json",
    "../../assets/data/mining_ores_ship.json"
  ];

  const tryFetch = async (u) => {
    const res = await fetch(u, { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  };

  return (async () => {
    let data = null;
    for(const u of candidates){
      try{
        data = await tryFetch(u + (u.includes("?") ? "" : ("?t=" + Date.now())));
        if(data) break;
      }catch(_){}
    }

    if(!data){
      data = { ores: [] };
    }

    // Normalize: allow array form
    if(Array.isArray(data)) data = { ores: data };
    if(!Array.isArray(data.ores)) data.ores = [];

    oreDataShip = data;
    try{ if(typeof window !== "undefined") window.oreDataShip = data; }catch(_){}

    return data;
  })().catch(err => {
    console.error(err);
    const fallback = { ores: [] };
    oreDataShip = fallback;
    try{ if(typeof window !== "undefined") window.oreDataShip = fallback; }catch(_){}
    return fallback;
  });
}


  async function loadOreDataRoc(){
  if (oreDataRoc) return oreDataRoc;
  try{
    const res = await fetch(DATA_URL + "mining_ores_roc.json", { cache: "no-store" });
    if (!res.ok){
      showDataErrorBanner("Dataset ROC introuvable. Vérifie /assets/data/mining_ores_roc.json");
      oreDataRoc = { ores: [] };
      return oreDataRoc;
    }
    oreDataRoc = normalizeOreDataset(await res.json());
    return oreDataRoc;
  }catch(err){
    showDataErrorBanner("Impossible de charger le dataset ROC (réseau / CORS / chemin).");
    console.error(err);
    oreDataRoc = { ores: [] };
    return oreDataRoc;
  }
}


  function getActiveOreDataset(){
    const t = getType();
    if (t === "ship") return { data: oreDataShip, selectedKeys: selectedOreKeysShip };
    if (t === "roc" || t === "rocds") return { data: oreDataRoc, selectedKeys: selectedOreKeysRoc };
    return { data: null, selectedKeys: [] };
  }

  function setSelectedOreKeys(keys){
    const t = getType();
    const clean = Array.isArray(keys) ? keys.filter(Boolean) : [];
    if (t === "ship") selectedOreKeysShip = clean;
    else if (t === "roc" || t === "rocds") selectedOreKeysRoc = clean;
  }

  function getSelectedOreKeys(){
    const t = getType();
    if (t === "ship") return Array.isArray(selectedOreKeysShip) ? selectedOreKeysShip : [];
    if (t === "roc" || t === "rocds") return Array.isArray(selectedOreKeysRoc) ? selectedOreKeysRoc : [];
    return [];
  }  function getActiveOreKey(){
    const t = getType();
    return isVehicleType(t) ? activeOreKeyRoc : activeOreKeyShip;
  }

  function setActiveOreKey(key, opts = {}){
    const t = getType();
    const k = key ? String(key) : null;

    if (isVehicleType(t)) {
      activeOreKeyRoc = k;
    } else {
      activeOreKeyShip = k;
    }

    if (!opts.silent){
      try { renderOreChips(); } catch(e) {}
      try { renderTopSellersGlobal(); } catch(e) {}
    }
  }

  function ensureActiveOreKey(selectedKeys){
    const keys = Array.isArray(selectedKeys) ? selectedKeys : [];
    const cur = getActiveOreKey();
    if (cur && keys.includes(cur)) return cur;

    const fallback = keys.length ? keys[keys.length - 1] : null;
    if (fallback !== cur){
      setActiveOreKey(fallback, { silent: true });
    }
    return fallback;
  }

  function renderTopSellersGlobal(){
    if (!elTopSellersList) return;

    const { data } = getActiveOreDataset();
    const selectedKeys = getSelectedOreKeys();
    const activeKey = ensureActiveOreKey(selectedKeys);

    if (!activeKey){
      if (elTopSellersOreLabel) elTopSellersOreLabel.textContent = "-";
      elTopSellersList.innerHTML = '<div class="top-sellers-empty">Sélectionne un minerai...</div>';
      return;
    }

    const ore = (data && Array.isArray(data.ores)) ? data.ores.find(o => o && o.key === activeKey) : null;
    if (elTopSellersOreLabel) elTopSellersOreLabel.textContent = ore && ore.name ? ore.name : "-";

    const sellers = (ore && Array.isArray(ore.sellers)) ? ore.sellers : [];
    if (!sellers.length){
      elTopSellersList.innerHTML = '<div class="top-sellers-empty">Vendeurs indisponibles</div>';
      return;
    }

    const useMSCU = isVehicleType(getType());
    const unit = useMSCU ? "mSCU" : "SCU";
    const scale = useMSCU ? 1000 : 1; // sellers are in aUEC/SCU

    const normalized = sellers
      .map((s) => {
        const name = String(
          s?.name ?? s?.location_name ?? s?.terminal_name ?? s?.station_name ?? s?.outpost_name ?? s?.city ?? s?.location ?? "Terminal"
        );
        const p = Number(s?.price_auEc_per_scu ?? s?.price ?? s?.price_sell ?? s?.price_last ?? s?.price_avg ?? s?.price_sell_avg);
        return { name, price: p };
      })
      .filter((x) => x && x.name && Number.isFinite(x.price) && x.price > 0)
      .sort((a,b) => b.price - a.price)
      .slice(0, 3);

    if (!normalized.length){
      elTopSellersList.innerHTML = '<div class="top-sellers-empty">Vendeurs indisponibles</div>';
      return;
    }

    elTopSellersList.innerHTML = "";
    normalized.forEach((it) => {
      const row = document.createElement("div");
      row.className = "top-seller-row";

      const n = document.createElement("div");
      n.className = "top-seller-name";
      n.textContent = it.name;

      const p = document.createElement("div");
      p.className = "top-seller-price";
      const perUnit = it.price / scale;
      p.textContent = `${fmtInt(perUnit)} aUEC/${unit}`;

      row.appendChild(n);
      row.appendChild(p);
      elTopSellersList.appendChild(row);
    });
  }



  function toggleSelectedOreKey(key){
    const keys = getSelectedOreKeys();
    const idx = keys.indexOf(key);
    if (idx >= 0) {
      keys.splice(idx, 1);
      setSelectedOreKeys(keys);

      // If we removed the active ore, move active to the last remaining selection.
      const cur = getActiveOreKey();
      if (cur === key){
        const nextActive = keys.length ? keys[keys.length - 1] : null;
        setActiveOreKey(nextActive, { silent: true });
      }

      try { miningLiveRefreshCurrentSelection(true); } catch(e) {}
      return { changed: true, action: "remove" };
    }

    keys.push(key);
    setSelectedOreKeys(keys);

    // Newly added ore becomes active.
    setActiveOreKey(key, { silent: true });

    try { miningLiveRefreshCurrentSelection(true); } catch(e) {}
    return { changed: true, action: "add" };
  }

  function getSelectedOres(){
    const { data } = getActiveOreDataset();
    const keys = getSelectedOreKeys();
    if (!data || !Array.isArray(data.ores) || !keys.length) return [];
    const byKey = new Map(data.ores.map(o => [o.key, o]));
    return keys.map(k => byKey.get(k)).filter(Boolean);
  }

  // Backward-compat: some integrations expect a single ore
  function getSelectedOre(){
    return getSelectedOres()[0] || null;
  }

  function getOreQtyMap(){
    const t = getType();
    if (t === "ship") return oreQtyByKeyShip;
    if (t === "roc" || t === "rocds") return oreQtyByKeyRoc;
    return Object.create(null);
  }

  function getTotalOreQtyDisplay(){
    const keys = getSelectedOreKeys();
    const map = getOreQtyMap();
    let sum = 0;
    keys.forEach((k) => {
      const v = Number(map[k]);
      if (Number.isFinite(v) && v > 0) sum += v;
    });
    return sum;
  }

  // Expose minimal getters for external modules (UEX live) without leaking internals
  window.__miningGetSelectedOre = getSelectedOre;
  window.__miningGetSelectedOres = getSelectedOres;
  window.__miningGetType = getType;

  function renderOreChips(){
    // Dual-column picker: available (left) / selected (right)
    if (!elOreAvailList || !elOreSelectedList) return;

    const t = getType();
    setOreUnitLabel();

    const { data } = getActiveOreDataset();
    const selectedKeys = getSelectedOreKeys();

    if (!data || !Array.isArray(data.ores)) {
      elOreAvailList.innerHTML = "<div class=\"picker-empty\">Dataset minerais indisponible</div>";
      elOreSelectedList.innerHTML = "";
      return;
    }

    // ---------- Available ----------
    elOreAvailList.innerHTML = "";
    const selectedSet = new Set(selectedKeys);

    data.ores.forEach((ore) => {
      if (selectedSet.has(ore.key)) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ore-item";
      btn.dataset.key = ore.key;

      const color = ore.color || "#64748b";
      btn.style.setProperty("--ore-dot", color);
      btn.innerHTML = `<span class="ore-dot" aria-hidden="true"></span><span class="ore-name">${ore.name}</span>`;

      btn.addEventListener("click", () => {
        const r = toggleSelectedOreKey(ore.key);
        setActiveOreKey(ore.key, { silent: true });
        renderOreChips();
        compute();
        renderTopSellersGlobal();
      });

      elOreAvailList.appendChild(btn);
    });

    if (!elOreAvailList.children.length){
      elOreAvailList.innerHTML = "<div class=\"picker-empty\">-</div>";
    }

    // ---------- Selected ----------
    elOreSelectedList.innerHTML = "";
    if (!selectedKeys.length){
      elOreSelectedList.innerHTML = "<div class=\"picker-empty\">Aucun minerai sélectionné</div>";
      return;
    }

    const qtyMap = getOreQtyMap();
    const useMSCU = isVehicleType(t);

    selectedKeys.forEach((key) => {
      const ore = data.ores.find(o => o.key === key);
      if (!ore) return;

      const row = document.createElement("div");
      row.className = "ore-row";
      row.dataset.key = ore.key;

      // Clickable ore button -> remove (moves back to left)
      const oreBtn = document.createElement("button");
      oreBtn.type = "button";
      oreBtn.className = "ore-item is-selected";
      const color = ore.color || "#64748b";
      oreBtn.style.setProperty("--ore-dot", color);
      const activeKey = ensureActiveOreKey(selectedKeys);
      const isActive = ore.key === activeKey;
      oreBtn.innerHTML = `<span class="ore-dot" aria-hidden="true"></span><span class="ore-name">${ore.name}</span>${isActive ? '<span class="ore-active-badge">ACTIF</span>' : ""}`;
      row.classList.toggle("is-active", isActive);
      oreBtn.addEventListener("click", () => {
        // Set as active (removal only via cross)
        setActiveOreKey(ore.key);
        renderTopSellersGlobal();
        renderOreChips();
        compute();
      });

      const qty = document.createElement("input");
      qty.type = "number";
      qty.className = "ore-qty-input";
      qty.min = "0";
      qty.step = useMSCU ? "1" : "0.01";
      qty.value = (qtyMap[ore.key] !== undefined && qtyMap[ore.key] !== null) ? String(qtyMap[ore.key]) : "";
      qty.placeholder = useMSCU ? "1000" : "1.0";

      qty.addEventListener("input", () => {
        const v = clamp(floatSafe(qty.value), 0, 1_000_000);
        qtyMap[ore.key] = v;
        setActiveOreKey(ore.key, { silent: true });
        renderTopSellersGlobal();
        compute();
      });

      const price = document.createElement("div");
      price.className = "ore-price";
      price.textContent = "-";

      const subtotal = document.createElement("div");
      subtotal.className = "ore-subtotal";
      subtotal.textContent = "-";

      row.appendChild(oreBtn);
      row.appendChild(qty);
      row.appendChild(price);
      row.appendChild(subtotal);

      const rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "ore-remove-btn";
      rmBtn.title = "Retirer";
      rmBtn.setAttribute("aria-label", `Retirer ${ore.name}`);
      rmBtn.textContent = "x";
      rmBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleSelectedOreKey(ore.key);
        renderOreChips();
        compute();
        miningLiveRefreshCurrentSelection();
      });
      row.appendChild(rmBtn);

      elOreSelectedList.appendChild(row);
    });

    setOreUnitLabel();
  }

  // ---------- Input mode ----------
  function setInputMode(mode){
    const m = mode === "ore" ? "ore" : "express";
    DEFAULTS.mode = m;

    if (btnModeExpress) btnModeExpress.classList.toggle("is-active", m === "express");
    if (btnModeOre) btnModeOre.classList.toggle("is-active", m === "ore");
    if (panelExpress) panelExpress.classList.toggle("is-hidden", m !== "express");
    if (panelOre) panelOre.classList.toggle("is-hidden", m !== "ore");
    if (panelOreSelected) panelOreSelected.classList.toggle("is-hidden", m !== "ore");

    if (m === "ore") renderOreChips();
    setOreUnitLabel();
    compute();
  }

  // ---------- Presets / reset ----------
  function setPreset(label){
    presetButtons.forEach((b) => b.classList.remove("is-active"));
    const btn = presetButtons.find((b) => String(b.textContent || "").trim() === label);
    if (btn) btn.classList.add("is-active");

    if (!elSession) return;

    if (label === "Libre") {
      elSession.removeAttribute("readonly");
      elSession.focus();
      return;
    }

    const n = intSafe(label);
    if (n > 0) {
      elSession.value = String(n);
      elSession.removeAttribute("readonly");
      compute();
    }
  }

  function resetAll(){
    if (elType) elType.value = DEFAULTS.type;
    syncTypePicker();

    if (elSession) elSession.value = String(DEFAULTS.sessionMinutes);
    if (elTarget) elTarget.value = String(DEFAULTS.targetPerHour);

    if (elCargo) elCargo.value = "";
    selectedOreKeysShip = [];
    selectedOreKeysRoc = [];
    oreQtyByKeyShip = Object.create(null);
    oreQtyByKeyRoc = Object.create(null);

    setInputMode("express");

    if (elShipInput) elShipInput.value = "";
    if (elShipPickerLabel) elShipPickerLabel.textContent = "Sélectionner un vaisseau";
    if (elShipField) elShipField.classList.add("is-hidden");

    presetButtons.forEach((b) => b.classList.remove("is-active"));
    const btn30 = presetButtons.find((b) => String(b.textContent || "").trim() === "30 min");
    if (btn30) btn30.classList.add("is-active");

    clearCapacityWarning();
    compute();
  }

  // ---------- Capacity / warning ----------
  function clearCapacityWarning(){
    document.querySelectorAll(".ore-qty-input").forEach((i) => i.classList.remove("input-warn"));
    if (elOreCapHint) elOreCapHint.classList.remove("hint-warn");
  }

  async function getCapacitySCU(){
    const t = getType();
    if (t === "roc") return CAPACITY_SCU.roc ?? null;
    if (t === "rocds") return CAPACITY_SCU.rocds ?? null;

    if (t === "ship") {
      const shipName = elShipInput?.value || null;
      if (!shipName || typeof window.getShipCapacity !== "function") return null;
      try { return await window.getShipCapacity(shipName); }
      catch { return null; }
    }

    return null;
  }

  async function updateCapacityHintAndWarn(qtyInput){
    if (!elOreCapHint) return;

    const t = getType();
    const capSCU = await getCapacitySCU();
    if (capSCU === null || capSCU === undefined) {
      elOreCapHint.textContent = "Capacité : -";
      clearCapacityWarning();
      return;
    }

    // Display and compare in the unit the user enters
    const useMSCU = isVehicleType(t);
    const capDisplay = useMSCU ? Math.round(capSCU * SCU_TO_MSCU) : capSCU;

    const qtyDisplay = Number.isFinite(qtyInput) ? qtyInput : 0; // displayed unit
    elOreCapHint.textContent = `Capacité : ${useMSCU ? fmtInt(capDisplay) + " mSCU" : capDisplay + " SCU"}`;

    if (Number.isFinite(qtyDisplay) && qtyDisplay > capDisplay && qtyDisplay > 0) {
      document.querySelectorAll(".ore-qty-input").forEach((i) => i.classList.add("input-warn"));
      elOreCapHint.classList.add("hint-warn");
      elOreCapHint.textContent = `Capacité : ${useMSCU ? fmtInt(capDisplay) + " mSCU" : capDisplay + " SCU"} - Dépassée`;
    } else {
      clearCapacityWarning();
    }

    if (elOreQtyHint) {
      elOreQtyHint.textContent = useMSCU ? "Quantité (mSCU)." : "Quantité (SCU).";
    }
  }

  // ---------- Compute ----------
  async function compute(){
    const t = getType();
    const mode = DEFAULTS.mode;

    const sessionMinutes = clamp(intSafe(elSession?.value) || DEFAULTS.sessionMinutes, 1, 600);
    const targetPerHour = clamp(intSafe(elTarget?.value || DEFAULTS.targetPerHour), 0, 2_000_000_000);

    // Ship field visibility
    if (elShipField) {
      if (t === "ship") {
        elShipField.classList.remove("is-hidden");
        loadShipsOnce();
      } else {
        elShipField.classList.add("is-hidden");
        setShip("");
      }
    }

    refreshShipCapacityHint();
    setOreUnitLabel();

    let runValue = 0;
    let sellers = null;

    if (mode === "express") {
      runValue = clamp(intSafe(elCargo?.value), 0, 2_000_000_000);
      sellers = null;
      clearCapacityWarning();
      if (elOreCapHint) elOreCapHint.textContent = "Capacité : -";
    } else {
      const ores = getSelectedOres();
      const qtyMap = getOreQtyMap();

      const useMSCU = isVehicleType(t);

      // Total quantity in the unit the user enters (SCU for ships, mSCU for ROC/ROC-DS)
      const totalQtyDisplay = getTotalOreQtyDisplay();
      await updateCapacityHintAndWarn(totalQtyDisplay);

      // Compute totals and update per-row UI
      let sumValue = 0;

      ores.forEach((ore) => {
        const key = ore?.key;
        const qtyDisplay = clamp(floatSafe(qtyMap[key]), 0, 1_000_000);
        const qtySCU = useMSCU ? (qtyDisplay / SCU_TO_MSCU) : qtyDisplay;

        const pRaw = ore?.price_auEc_per_scu;
        const p = (pRaw === null || pRaw === undefined) ? NaN : Number(pRaw);

        const subtotal = (Number.isFinite(p) && p > 0 && qtySCU > 0) ? (qtySCU * p) : 0;
        sumValue += subtotal;

        // Row UI update (if present)
        if (elOreSelectedList){
          const row = elOreSelectedList.querySelector(`.ore-row[data-key="${key}"]`);
          if (row){
            const elPrice = row.querySelector(".ore-price");
            const elSub = row.querySelector(".ore-subtotal");
            if (elPrice) {
              elPrice.textContent = (Number.isFinite(p) && p > 0) ? fmtInt(p) : "-";
              // Debug tooltip for Regolith parity: show last/avg when available (from Live API)
              const pLast = (ore && Number.isFinite(ore.price_last)) ? ore.price_last : null;
              const pAvg = (ore && Number.isFinite(ore.price_avg)) ? ore.price_avg : null;
              const pField = (ore && ore.price_field) ? String(ore.price_field) : null;
              const tips = [];
              if (pLast != null) tips.push(`last: ${fmtInt(pLast)}`);
              if (pAvg != null) tips.push(`avg: ${fmtInt(pAvg)}`);
              if (pField) tips.push(`field: ${pField}`);
              if (tips.length) elPrice.title = tips.join(" | ");
              else elPrice.removeAttribute("title");
            }
            if (elSub) elSub.textContent = subtotal > 0 ? fmtInt(subtotal) : "-";
          }
        }
      });

      runValue = sumValue;

      // Sellers: only meaningful when a single ore is selected
      if (ores.length === 1) {
        sellers = Array.isArray(ores[0].sellers) ? ores[0].sellers : [];
      } else {
        sellers = null;
      }

      // Context hint: show current total quantity
      if (elOreQtyHint){
        if (!ores.length) {
          elOreQtyHint.textContent = "Clique sur un minerai (colonne gauche) pour l'ajouter. Clique sur un minerai sélectionné pour le retirer.";
        } else {
          const unit = useMSCU ? "mSCU" : "SCU";
          elOreQtyHint.textContent = `Quantité totale : ${fmtInt(totalQtyDisplay)} ${unit}`;
        }
      }
    }

    const total = runValue;
    const profitRun = runValue;
    const hours = sessionMinutes / 60;
    const profitHour = hours > 0 ? (profitRun / hours) : 0;

    let deltaPct = null;
    let timeToTargetMin = null;
    if (targetPerHour > 0) {
      deltaPct = ((profitHour - targetPerHour) / targetPerHour) * 100;
      if (profitHour > 0) timeToTargetMin = (targetPerHour / profitHour) * 60;
    }

    let verdict = "-";
    let verdictClass = "is-off";
    let reason = "Renseigne les champs à gauche pour obtenir un verdict.";

    // Si en mode Minerai et prix manquant, on explique pourquoi il n'y a pas de calcul.
    if (mode === "ore") {
      const oresNow = getSelectedOres();
      const qtyMapNow = getOreQtyMap();
      const useMSCU = isVehicleType(t);

      const missing = [];
      oresNow.forEach((ore) => {
        const key = ore?.key;
        const qtyDisplay = clamp(floatSafe(qtyMapNow[key]), 0, 1_000_000);
        const qtySCU = useMSCU ? (qtyDisplay / SCU_TO_MSCU) : qtyDisplay;
        if (qtySCU <= 0) return;

        const pRaw = ore?.price_auEc_per_scu;
        const p = (pRaw === null || pRaw === undefined) ? NaN : Number(pRaw);
        if (!Number.isFinite(p) || p <= 0) missing.push(ore?.name || key);
      });

      if (missing.length) {
        const list = missing.slice(0, 3).join(", ") + (missing.length > 3 ? "..." : "");
        reason = `Prix indisponible pour : ${list}. Passe en Estimation ou mets à jour le dataset des prix.`;
      }
    }

    if (runValue > 0 && targetPerHour > 0) {
      if (profitHour >= targetPerHour * 1.25) {
        verdict = "EXCELLENT";
        verdictClass = "is-good";
        reason = `Ton run dépasse nettement ton objectif (~ ${fmtInt(profitHour)} aUEC/h vs ${fmtInt(targetPerHour)}).`;
      } else if (profitHour >= targetPerHour * 0.85) {
        verdict = "ACCEPTABLE";
        verdictClass = "is-ok";
        reason = `Tu es proche de ton objectif (~ ${fmtInt(profitHour)} aUEC/h vs ${fmtInt(targetPerHour)}).`;
      } else {
        verdict = "À ÉVITER";
        verdictClass = "is-bad";
        reason = `Sous ton objectif (~ ${fmtInt(profitHour)} aUEC/h vs ${fmtInt(targetPerHour)}).`;
      }
    } else if (runValue > 0 && targetPerHour === 0) {
      verdict = "INFO";
      verdictClass = "is-ok";
      reason = `Objectif à 0 : profit estimé ~ ${fmtInt(profitHour)} aUEC/h. Saisis un objectif pour un verdict.`;
    }

    if (elKpiTotal) elKpiTotal.textContent = runValue > 0 ? fmtInt(total) : "-";
    if (elKpiRun) elKpiRun.textContent = runValue > 0 ? fmtInt(profitRun) : "-";
    if (elKpiHour) elKpiHour.textContent = runValue > 0 ? fmtInt(profitHour) : "-";

    if (elKpiDelta) elKpiDelta.textContent = (runValue > 0 && targetPerHour > 0) ? fmtPct(deltaPct) : "-";
    if (elKpiTimeToTarget) {
      if (runValue > 0 && targetPerHour > 0 && Number.isFinite(timeToTargetMin)) elKpiTimeToTarget.textContent = fmtMin(timeToTargetMin);
      else elKpiTimeToTarget.textContent = "-";
    }

    if (elVerdictPill) {
      elVerdictPill.textContent = verdict;
      elVerdictPill.classList.remove("is-off", "is-ok", "is-bad", "is-good");
      elVerdictPill.classList.add(verdictClass);
    }
    if (elVerdictReason) elVerdictReason.textContent = reason;

    if (elBadgeRisk) elBadgeRisk.style.display = "none";
    if (elBadgeStable) elBadgeStable.style.display = "none";
    if (t === "roc") { /* fps removed */
      if (elBadgeRisk) elBadgeRisk.style.display = "inline-flex";
    } else if (t === "ship") {
      if (elBadgeStable) elBadgeStable.style.display = "inline-flex";
    }

    if (elSellersList) if (elSellersList) elSellersList.innerHTML = "";
    if (elSellersNote) elSellersNote.textContent = "Disponible uniquement en mode Minerai.";

    if (mode === "ore") {
      if (t === "roc") { /* fps removed */
        if (elSellersNote) elSellersNote.textContent = "Vendeurs FPS : à venir.";
      } else if (!getSelectedOre()) {
        if (elSellersNote) elSellersNote.textContent = "Sélectionne un minerai pour voir les vendeurs.";
      } else {
        const ore = getSelectedOre();
        if (ore && (ore.price_auEc_per_scu === null || ore.price_auEc_per_scu === undefined || !Number.isFinite(Number(ore.price_auEc_per_scu)) || Number(ore.price_auEc_per_scu) <= 0)) {
          if (elSellersNote) elSellersNote.textContent = "Prix indisponible pour ce minerai (dataset). Utilise Estimation ou mets à jour les prix.";
        }
        const top = Array.isArray(sellers) ? sellers.slice(0, 3) : [];
        if (!top.length) {
          if (elSellersNote) elSellersNote.textContent = "Aucun vendeur dans le dataset.";
        } else {
          top.forEach((s, idx) => {
            const row = document.createElement("div");
            row.className = "seller-item";

            const left = document.createElement("div");
            const name = document.createElement("div");
            name.className = "seller-name";
            name.textContent = s.name;
            left.appendChild(name);

            const right = document.createElement("div");
            right.style.display = "flex";
            right.style.alignItems = "center";
            right.style.gap = "10px";

            const price = document.createElement("div");
            price.className = "seller-price";
            price.textContent = fmtInt(Number(s.price_auEc_per_scu || 0)) + " / SCU";
            right.appendChild(price);

            const badge = document.createElement("div");
            badge.className = "seller-badge" + (idx === 0 ? "" : " is-warn");
            badge.textContent = idx === 0 ? "BON" : "OK";
            right.appendChild(badge);

            row.appendChild(left);
            row.appendChild(right);
            if (elSellersList) elSellersList.appendChild(row);
          });

          if (elSellersNote) elSellersNote.textContent = "";
        }
      }
    }
  }

  // ---------- Bind ----------
  function bind(){
    if (elType) elType.addEventListener("change", () => {
  syncTypePicker();
  if (DEFAULTS.mode === "ore") renderOreChips();
  setOreUnitLabel();
  updateCapacityHintAndWarn(getTotalOreQtyDisplay());
  compute();
});
if (elTypePickerBtn) elTypePickerBtn.addEventListener("click", () => toggleMenu(elTypePickerMenu, elTypePickerBtn));
    typePickerItems.forEach((btn) => btn.addEventListener("click", () => setType(String(btn.dataset.value || "roc"))));

    if (elShipPickerBtn) elShipPickerBtn.addEventListener("click", () => toggleMenu(elShipPickerMenu, elShipPickerBtn));

    if (btnModeExpress) btnModeExpress.addEventListener("click", () => setInputMode("express"));
    if (btnModeOre) btnModeOre.addEventListener("click", () => setInputMode("ore"));

    if (elSession) elSession.addEventListener("input", () => compute());
    if (elTarget) elTarget.addEventListener("input", () => compute());
    if (elCargo) elCargo.addEventListener("input", () => compute());
presetButtons.forEach((btn) => btn.addEventListener("click", () => setPreset(String(btn.textContent || "").trim())));
    if (btnReset) btnReset.addEventListener("click", resetAll);

    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      // Robust outside-click detection:
      // HTML uses `.picker` wrappers (not the old #miningTypePicker/#miningShipPicker ids).
      const typeRoot = elTypePickerBtn ? elTypePickerBtn.closest(".picker") : null;
      const shipRoot = elShipPickerBtn ? elShipPickerBtn.closest(".picker") : null;

      if (typeRoot && !typeRoot.contains(t)) closeMenu(elTypePickerMenu, elTypePickerBtn);
      if (shipRoot && !shipRoot.contains(t)) closeMenu(elShipPickerMenu, elShipPickerBtn);
    });
document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeMenu(elTypePickerMenu, elTypePickerBtn);
        closeMenu(elShipPickerMenu, elShipPickerBtn);
      }
    });
  }


  // ---------- Version footer (compact + copy) ----------
  
  function updateVersionFooterLive(){
    // Non-blocking: enrich the existing version footer with live info.
    if (!miningLiveMeta) return;
    const el = document.getElementById("miningDataVer");
    if (el){
      const base = miningLiveGetConfig().base;
      const ts = miningLiveMeta.updated_at ? miningLiveFormatTs(miningLiveMeta.updated_at) : null;
      const baseShort = (base || "").replace(/^https?:\/\//i, "").replace(/\/api\/mining\/?$/i, "");
      const parts = ["UEX live", `prefer:${miningLiveGetConfig().prefer}`];
      if (ts) parts.push("maj:" + ts);
      if (baseShort) parts.push(baseShort);
      el.textContent = parts.join(" * ");
    }
  }

function initVersionFooter(){
    const toggleBtn = document.getElementById("versionToggle");
    const details = document.getElementById("versionDetails");
    const copyBtn = document.getElementById("copyVersionsBtn");

    if (!toggleBtn || !details) return;

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

    // Close on ESC (when details open)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !details.classList.contains("is-hidden")) setOpen(false);
    });

    // Copy versions block (Discord-friendly)
    const getCopyText = () => {
      const lines = [];
      lines.push("MINING v1.4.3");
      lines.push("PU 4.4");
      lines.push("");
      lines.push("Core: v1.3.9");
      lines.push("Ships: v2.0.5");
      lines.push("CSS: v1.2.4");
      lines.push("JS: v1.2.4");
      lines.push("miningShips: v1.0.2");
      lines.push("Ores (Ship): v1.2.0");
      lines.push("Ores (ROC/FPS): v1.1.0");
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

    if (copyBtn){
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

    try { updateVersionFooterLive(); } catch(e) {}
  }


  // ---------- Init ----------
  async function init(){
    
    initLiveApiEndpointUi();
// Live API quick health ping (non-blocking)
    try{
      const cfg = window.SC_HUB_CONFIG || {};
      const base = cfg.MINING_LIVE_API_BASE || DEFAULT_MINING_LIVE_BASE;
      if (cfg.MINING_LIVE_ENABLED !== false){
        miningLiveSetStatus("loading");
        miningLivePingHealth(base).then((r)=>{
          try{
            if (r && r.ok){
              miningLiveMeta = r.data || null;
              miningLiveSetStatus("idle", miningLiveMeta);
            } else {
              miningLiveMeta = null;
              miningLiveSetStatus("error");
            }
          }catch(e){}
        });
      }
    }catch(e){}


    // Sanitize mining type options (FPS removed) + ensure unit switching is consistent
    if (elType){
      // Remove any legacy FPS option if still present (cache / older HTML)
      const fpsOpt = elType.querySelector('option[value="fps"]');
      if (fpsOpt) fpsOpt.remove();

      const allowed = new Set(["roc","rocds","ship"]);
      if (!allowed.has(String(elType.value))){
        elType.value = "roc";
      }
    }

    bind();
    syncTypePicker();
    setOreUnitLabel();

    try { await loadOreDataShip(); } catch(e) { console.error(e); }
    try { await loadOreDataRoc(); } catch(e) { console.error(e); }

    // Initial live overlay (non-blocking)
    try { miningLiveRefreshCurrentSelection(true); } catch(e){}

    initVersionFooter();
    // Set initial live status line
    try { miningLiveSetStatus(miningLiveMeta ? "live" : "local", miningLiveMeta); } catch(e) {}

    resetAll();
  }

  init();

  // UEX live UI
  initUexUi();

})();

/* =========================================================
   UEX (live) integration - V1.3.0
   - Fetches current sell prices and price history (chart)
   - Uses UEX API 2.0 (no token required for these endpoints)
   Docs:
   - /commodities_prices?commodity_name=...
   - /commodities_prices_history?id_terminal=..&id_commodity=..&game_version=4.4
========================================================= */


function resolveUexBase(){
  // Prefer Cloudflare Worker proxy to avoid browser CORS issues.
  // Configure ONE of:
  // - window.UEX_PROXY_BASE (recommended)   e.g. "https://<your-worker>.workers.dev"
  // - localStorage "uexProxyBase"
  // - URL param ?uexProxy=https://<your-worker>.workers.dev
  //
  // The proxy should forward requests to https://api.uexcorp.uk and return CORS headers.
  try{
    const url = new URL(window.location.href);
    const qp = url.searchParams.get("uexProxy");
    if(qp) return qp.replace(/\/+$/,"");
  }catch(e){}
  try{
    if(window.UEX_PROXY_BASE) return String(window.UEX_PROXY_BASE).replace(/\/+$/,"");
  }catch(e){}
  try{
    const ls = localStorage.getItem("uexProxyBase");
    if(ls) return String(ls).replace(/\/+$/,"");
  }catch(e){}
  // Fallback (may be blocked by CORS in browsers)
  return "https://api.uexcorp.uk";
}

function uexUrl(path){
  const base = resolveUexBase();
  // If proxy base already includes "/2.0", allow path without double
  const b = base.endsWith("/2.0") ? base : (base + "/2.0");
  return b + path;
}

const UEX = {
  base: resolveUexBase(),
  gameVersion: "4.4",
  // caching: prices 30min, history 12h (per UEX docs)
  ttlPricesMs: 30 * 60 * 1000,
  ttlHistoryMs: 12 * 60 * 60 * 1000
};

function uexCacheGet(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(!obj || typeof obj !== "object") return null;
    if(Date.now() > (obj.exp || 0)) return null;
    return obj.val;
  }catch(e){ return null; }
}

function uexCacheSet(key, val, ttlMs){
  try{
    localStorage.setItem(key, JSON.stringify({ val, exp: Date.now() + ttlMs }));
  }catch(e){}
}

async function uexFetchJson(url, cacheKey, ttlMs){
  const cached = uexCacheGet(cacheKey);
  if(cached) return cached;

  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error("UEX HTTP " + res.status);
  const data = await res.json();
  uexCacheSet(cacheKey, data, ttlMs);
  return data;
}

function uexFmt(n){
  if(n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  const v = Math.round(Number(n));
  return v.toLocaleString("fr-FR") + " aUEC";
}

function getOreUnitPriceUEX(){
  // Live-only: we rely on the latest fetched UEX sell price for the selected ore.
  const v = Number(window.oreLivePriceOverride);
  if(Number.isFinite(v) && v > 0) return v;
  return null;
}

function uexSetStatus(msg, isError=false){
  const el = document.getElementById("uexLiveStatus");
  if(!el) return;
  el.textContent = msg;
  el.style.color = isError ? "rgba(255,120,120,.92)" : "rgba(255,255,255,.70)";
}

function uexSetMetric(terminal, price){
  const tEl = document.getElementById("uexLiveTerminal");
  const pEl = document.getElementById("uexLivePrice");
  if(tEl) tEl.textContent = terminal || "-";
  if(pEl) pEl.textContent = uexFmt(price);
}

function uexDrawChart(items){
  // Live comparative chart (Top sellers) - items: [{ name, price }]
  const svg = document.getElementById("uexChart");
  const legend = document.getElementById("uexChartLegend");
  if(!svg || !legend) return;

  svg.innerHTML = "";

  if(!Array.isArray(items) || items.length === 0){
    legend.textContent = "Graph live indisponible.";
    return;
  }

  const data = items
    .filter(it => it && typeof it === "object" && it.price !== null && it.price !== undefined)
    .map(it => ({ label: String(it.name || "Terminal"), value: Number(it.price) }))
    .filter(it => Number.isFinite(it.value));

  if(data.length === 0){
    legend.textContent = "Graph live indisponible.";
    return;
  }

  const w = 320, h = 120;
  const padX = 10, padY = 10;
  const barGap = 8;

  const maxV = Math.max(...data.map(d => d.value));
  const minV = Math.min(...data.map(d => d.value));

  // background grid line
  const grid = document.createElementNS("http://www.w3.org/2000/svg","line");
  grid.setAttribute("x1", padX);
  grid.setAttribute("x2", w - padX);
  grid.setAttribute("y1", h - padY);
  grid.setAttribute("y2", h - padY);
  grid.setAttribute("stroke", "rgba(255,255,255,.10)");
  grid.setAttribute("stroke-width", "1");
  svg.appendChild(grid);

  const n = data.length;
  const barW = (w - padX*2 - barGap*(n-1)) / n;
  const usableH = h - padY*2;

  data.forEach((d, i) => {
    const x = padX + i*(barW + barGap);
    const barH = maxV <= 0 ? 0 : (d.value / maxV) * usableH;
    const y = (h - padY) - barH;

    // bar
    const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x", x.toFixed(2));
    rect.setAttribute("y", y.toFixed(2));
    rect.setAttribute("width", barW.toFixed(2));
    rect.setAttribute("height", barH.toFixed(2));
    rect.setAttribute("rx", "6");
    rect.setAttribute("fill", "rgba(15,185,200,.78)");
    rect.setAttribute("stroke", "rgba(15,185,200,.92)");
    rect.setAttribute("stroke-width", "1");
    svg.appendChild(rect);

    // value label (top)
    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    t.textContent = Math.round(d.value).toString();
    t.setAttribute("x", (x + barW/2).toFixed(2));
    t.setAttribute("y", Math.max(padY + 12, y - 4).toFixed(2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "10");
    t.setAttribute("fill", "rgba(255,255,255,.85)");
    svg.appendChild(t);
  });

  legend.textContent = `Comparatif live (Top ${data.length}) * Min ${Math.round(minV)} - Max ${Math.round(maxV)} aUEC`;
}

function uexPickBestSell(rows){
  if(!Array.isArray(rows) || rows.length === 0) return null;
  // Prefer terminals that have a sell price and look like "TDD" (for ship minerals),
  // otherwise fall back to any with sell price.
  const usable = rows
    .filter(r => r && typeof r === "object" && r.price_sell !== null && r.price_sell !== undefined)
    .slice();

  if(usable.length === 0) return null;

  const tdd = usable.filter(r => (r.terminal_name || "").toUpperCase().includes("TDD"));
  const pool = tdd.length ? tdd : usable;

  pool.sort((a,b) => Number(b.price_sell||0) - Number(a.price_sell||0));
  return pool[0];
}

function uexTopSellers(rows, max=3){
  if(!Array.isArray(rows)) return [];
  const usable = rows
    .filter(r => r && typeof r === "object" && r.price_sell !== null && r.price_sell !== undefined)
    .slice()
    .sort((a,b) => Number(b.price_sell||0) - Number(a.price_sell||0));
  return usable.slice(0, max).map(r => ({
    name: r.terminal_name || "Terminal",
    price: r.price_sell
  }));
}

function uexSyntheticSeriesFromRow(row){
  if(!row || typeof row !== "object") return [];
  const last = Number(row.price_sell);
  const minM = Number(row.price_sell_min_month);
  const avgM = Number(row.price_sell_avg_month);
  const maxM = Number(row.price_sell_max_month);

  const vals = [minM, avgM, maxM, last].filter(v => Number.isFinite(v) && v > 0);
  if(vals.length < 2) return [];

  // Build a small pseudo-history (month stats -> last)
  const now = new Date();
  const label = (d) => d.toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit" });

  const d0 = new Date(now.getTime() - 28*24*3600*1000);
  const d1 = new Date(now.getTime() - 14*24*3600*1000);
  const d2 = new Date(now.getTime() -  7*24*3600*1000);
  const d3 = now;

  const points = [];
  if(Number.isFinite(minM) && minM > 0) points.push({ x: d0.getTime(), y: minM, t: label(d0) });
  if(Number.isFinite(avgM) && avgM > 0) points.push({ x: d1.getTime(), y: avgM, t: label(d1) });
  if(Number.isFinite(maxM) && maxM > 0) points.push({ x: d2.getTime(), y: maxM, t: label(d2) });
  if(Number.isFinite(last) && last > 0) points.push({ x: d3.getTime(), y: last, t: label(d3) });

  return points.length >= 2 ? points : [];
}


async function uexLoadForOre(oreName){
  const name = (oreName || "").trim();
  if(!name) throw new Error("missing ore name");

  const url = `${UEX.base}//commodities_prices")}?commodity_name=${encodeURIComponent(name)}&game_version=${encodeURIComponent(UEX.gameVersion)}`;
  const rows = await uexFetchJson(url, "uex:cp:" + UEX.gameVersion + ":" + name.toLowerCase(), UEX.ttlPricesMs);

  const best = uexPickBestSell(rows);
  if(!best) throw new Error("UEX: no sell price");

  return { best, rows };
}


/**
 * Public entry called when ore selection changes
 */
async function updateUexLive(force=false){
  const wrap = document.getElementById("uexLive");
  if(!wrap) return;

  const enabled = true;

  // Always enabled (live-only)
// Only for Ship minerals (seller panel note says Ship)
  const __t = (window.__miningGetType ? window.__miningGetType() : null);
  if(__t && __t !== "ship"){
    uexSetStatus("Disponible uniquement en mode Minerai (Ship).");
    uexSetMetric("-", null);
    uexDrawChart([]);
    return;
  }

  const oreObj = (window.__miningGetSelectedOre ? window.__miningGetSelectedOre() : null);
  const oreName = oreObj && oreObj.name ? oreObj.name : "";
  if(!oreName){
    uexSetStatus("Sélectionne un minerai.");
    uexSetMetric("-", null);
    uexDrawChart([]);
    return;
  }

  try{
    uexSetStatus("Chargement...");
    const { best, rows } = await uexLoadForOre(oreName);

    uexSetMetric(best.terminal_name || "Terminal", best.price_sell);

    // Update seller list with live data (top 3) if we have the container
    const sellersList = document.getElementById("sellersList");
    if(sellersList){
      const top = uexTopSellers(rows, 3);
      if(top.length){
        sellersList.innerHTML = top.map(s => `
          <div class="seller-row">
            <div class="seller-left">
              <div class="seller-name">${escapeHtml(s.name)}</div>
              <div class="seller-sub">UEX</div>
            </div>
            <div class="seller-right">
              <div class="seller-price">${uexFmt(s.price)}</div>
            </div>
          </div>
        `).join("");
      }
    }

    let pts = uexHistToPoints(hist);
    let synthetic = false;
    if(!pts || pts.length < 2){
      pts = uexSyntheticSeriesFromRow(best);
      synthetic = pts && pts.length >= 2;
    }
    uexDrawChart(pts);
    if(synthetic){
      const legend = document.getElementById("uexChartLegend");
      if(legend) legend.textContent = "Synthèse (UEX) basée sur min/avg/max (30j) + dernier prix.";
    }
    uexSetStatus("OK (UEX)");

    // Optional: feed live price into the calculator (beginner estimation)
    // We do NOT overwrite local dataset permanently; we store a transient override.
    if(typeof oreLivePriceOverride !== "undefined"){
      oreLivePriceOverride = Number(best.price_sell);
    }else{
      window.oreLivePriceOverride = Number(best.price_sell);
    }

    // Trigger a recalculation if the existing code exposes a calc function.
    if(typeof recomputeAll === "function") recomputeAll();
    if(typeof updateSummary === "function") updateSummary();

  }catch(err){
    console.error(err);
    uexSetStatus("UEX indisponible (API / réseau / CORS). Voir console.", true);
    uexSetMetric("-", null);
    uexDrawChart([]);
  }
}

function initUexUi(){
  const btn = document.getElementById("uexRefreshBtn");
  if(!btn) return;

  btn.addEventListener("click", () => {
    updateUexLive(true);
  });

  updateUexLive(false);
}


function showDataErrorBanner(msg){
  try{
    let el = document.getElementById("dataErrorBanner");
    if(!el){
      el = document.createElement("div");
      el.id = "dataErrorBanner";
      el.className = "data-error-banner";
      el.textContent = msg;
      const host = document.querySelector(".mining-container") || document.body;
      host.prepend(el);
    }else{
      el.textContent = msg;
    }
  }catch(e){}
}

function escapeHtml(str){return String(str||'').replace(/[&<>"']/g,(c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}

/* ============================
   Version footer (MINAGE) - Details toggle + fill
   ============================ */
function miningGetCssVar(name){
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace(/^"|"$/g, "");
  } catch(_) { return ""; }
}

function cssEscape(s){
  // Minimal CSS selector escape for data-key queries
  return String(s || "").replace(/["\\]/g, "\\$&");
}


function miningInitVersionFooter(){
  const bar = document.getElementById("miningVersionBar");
  const details = document.getElementById("miningVersionDetails");
  const closeBtn = document.getElementById("miningVersionCloseBtn");
  const cta = document.getElementById("miningVersionCta");
  const closedLabel = document.getElementById("miningVersionClosedLabel");
  if(!bar || !details || !cta || !closedLabel) return;

  const jsV = "V1.4.57";
  const cssV = "V1.3.46";
  const coreV = miningGetCssVar("--core-css-version") || "-";
  const dataV = (window.MINING_DATA_VERSION) ? String(window.MINING_DATA_VERSION) : "assets/data/*";

  const repo = location.pathname.split("/").filter(Boolean)[0] || "-";
  const page = location.pathname.split("/").slice(-1)[0] || "mining.html";
  const build = (location.search || "").replace(/^\?/, "") || "-";

  // Closed bar label exactly like Recyclage (adapted)
  closedLabel.textContent = `MINAGE ${jsV} / PU 4.5`;

  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set("miningJsVer", jsV);
  set("miningCssVer", cssV);
  set("miningCoreVer", coreV);
  set("miningDataVer", dataV);
  set("miningBuildVer", build);
  set("miningRepoVer", repo);
  set("miningPageVer", page);
  set("miningLastVer", new Date().toLocaleString("fr-FR"));

  

  const copyBtn = document.getElementById("miningVersionCopyBtn");
  const buildText = () => {
    const lines = [];
    lines.push(`MINAGE Support Snapshot`);
    lines.push(`PU: 4.5`);
    lines.push(`Repo: ${repo}`);
    lines.push(`Page: ${page}`);
    lines.push(`Build: ${build}`);
    lines.push(`MINAGE JS: ${jsV}`);
    lines.push(`MINAGE CSS: ${cssV}`);
    lines.push(`Core: ${coreV}`);
    lines.push(`Dataset: ${dataV}`);
    lines.push(`Last update: ${new Date().toLocaleString("fr-FR")}`);
    return lines.join("\n");
  };
  const doCopy = async () => {
    const txt = buildText();
    try {
      await navigator.clipboard.writeText(txt);
      if(copyBtn) {
        const prev = copyBtn.textContent;
        copyBtn.textContent = "Copié";
        setTimeout(() => { copyBtn.textContent = prev; }, 1200);
      }
    } catch(_) {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = txt;
      ta.setAttribute("readonly","");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch(__) {}
      document.body.removeChild(ta);
    }
  };
  if(copyBtn) copyBtn.addEventListener("click", (e) => { e.stopPropagation(); doCopy(); });
const open = () => {
    details.classList.remove("is-hidden");
    details.setAttribute("aria-hidden","false");
    bar.setAttribute("aria-expanded","true");
    cta.textContent = "Fermer";
  };

  const close = () => {
    details.classList.add("is-hidden");
    details.setAttribute("aria-hidden","true");
    bar.setAttribute("aria-expanded","false");
    cta.textContent = "Détails";
  };

  const toggle = () => {
    const isOpen = !details.classList.contains("is-hidden");
    if(isOpen) close(); else open();
  };

  bar.addEventListener("click", (e) => {
    e.preventDefault();
    toggle();
  });

  bar.addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    if(e.key === "Escape") { close(); }
  });

  if(closeBtn) closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });

  close();
}


/* =========================
   Module Mode (Beginner / Advanced)
   ========================= */

let miningModuleModeInited = false;
let miningAdvancedScaffoldInited = false;

function miningGetLiveBaseForUi(){
  try{
    const cfg = window.SC_HUB_CONFIG || {};
    const base = String(cfg.MINING_LIVE_API_BASE || miningLiveGetApiBase() || "").trim();
    return miningLiveSanitizeBase(base) || "";
  }catch(_){
    return "";
  }
}

function miningInitAdvancedScaffold(){
  if(miningAdvancedScaffoldInited) return;
  miningAdvancedScaffoldInited = true;

  const els = {
    // Selection UI
    oreSearch: document.getElementById("advOreSearch"),
    oreDatalist: document.getElementById("advOreDatalist"),
    oreQty: document.getElementById("advOreQty"),
    addBtn: document.getElementById("advAddOreBtn"),
    importBtn: document.getElementById("advImportFromBeginnerBtn"),
    clearBtn: document.getElementById("advClearSelectionBtn"),
    selectStatus: document.getElementById("advSelectStatus"),

    emptySel: document.getElementById("advEmptySelection"),
    selectedList: document.getElementById("advSelectedList"),
    selectedMeta: document.getElementById("advSelectedMeta"),
    availOres: document.getElementById("advAvailOres"),
    totalInputScu: document.getElementById("advTotalInputScu"),
    totalProducts: document.getElementById("advTotalProducts"),

    // Params
    objective: document.getElementById("advObjective"),
    refinery: document.getElementById("advRefinery"),
    method: document.getElementById("advMethod"),
    yieldWindow: document.getElementById("advYieldWindow"),
    includeTime: document.getElementById("advIncludeTime"), // compat

    // Actions
    metaBtn: document.getElementById("advMetaBtn"),
    computeBtn: document.getElementById("advComputeBtn"),
    copyBtn: document.getElementById("advCopyEndpointBtn"),
    status: document.getElementById("advStatus"),

    // Results
    resEmpty: document.getElementById("advResultEmpty"),
    resLoading: document.getElementById("advResultLoading"),
    resError: document.getElementById("advResultError"),
    resBody: document.getElementById("advResultBody"),
    kpis: document.getElementById("advKpis"),
    itemsWrap: document.getElementById("advItemsWrap"),
    resJson: document.getElementById("advResultJson"),
    debugWrap: document.getElementById("advDebugWrap"),
  };

  let advMeta = null;
  let advMetaLoadedAt = 0;
  let advMetaInFlight = null;

  // Ship-only catalog (from assets/data/mining_ores_ship.json)
  let advCatalog = null;            // [{key,name}]
  let advCatalogSource = "none";     // "api" | "local" | "none"
  let advByKey = Object.create(null); // key -> {key,name}

  const ADV_SEL_STORAGE_KEY = "mining_adv_selection_ship_v1";
  let advSelection = []; // [{key, scu}]

  const fmtUEC = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString("fr-FR") : "-";
  const fmtSCU = (n) => {
    if(!Number.isFinite(n)) return "-";
    const v = Math.round(n * 1000) / 1000;
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
  };

  function advMiniStatus(msg){
    if(!els.selectStatus) return;
    els.selectStatus.textContent = msg || "";
  }

  function advStatus(msg, opts = {}){
    if(!els.status) return;

    els.status.textContent = String(msg || "");

    // Optional: offline styling (if CSS supports it)
    try{
      els.status.classList.toggle("is-offline", !!opts.offline);
    }catch(_){}

    // Optional: API base prompt
    const needsApi = !!opts.needsApi;
    const LS_KEY = "sc_hub_mining_api_base";

    let extras = null;
    try{
      const pid = "advStatusExtras";
      extras = document.getElementById(pid);
      if(!extras){
        extras = document.createElement("div");
        extras.id = pid;
        extras.style.marginTop = "8px";
        extras.style.display = "grid";
        extras.style.gap = "8px";
        if(els.status.parentElement) els.status.parentElement.appendChild(extras);
      }
      extras.innerHTML = "";
    }catch(_){
      extras = null;
    }

    if(!needsApi || !extras) return;

    let current = "";
    try{ current = (localStorage.getItem(LS_KEY) || "").trim(); }catch(_){}
    if(!current){
      try{
        const cfg = (window && window.SC_HUB_CONFIG) ? window.SC_HUB_CONFIG : null;
        current = (cfg && cfg.MINING_LIVE_API_BASE) ? String(cfg.MINING_LIVE_API_BASE).trim() : "";
      }catch(_){}
    }

    // escapeHtml exists in this script; fallback if not
    const esc = (typeof escapeHtml === "function") ? escapeHtml : (s) => String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    const valueAttr = esc(current);

    extras.innerHTML = `
      <div style="opacity:.85;font-size:12px;">
        API non configurée. Renseigne l'URL du Worker (base), puis clique <strong>Enregistrer</strong>.
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="advApiBaseInput" type="text" placeholder="https://ton-worker.workers.dev"
          value="${valueAttr}"
          style="flex:1 1 360px;min-width:260px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);
                 background:rgba(0,0,0,0.22);padding:10px 12px;color:rgba(255,255,255,0.92);" />
        <button id="advApiBaseSaveBtn" type="button"
          style="border-radius:999px;border:1px solid rgba(255,255,255,0.14);
                 background:rgba(32,214,232,0.12);padding:10px 14px;font-weight:800;color:rgba(255,255,255,0.92);">
          Enregistrer
        </button>
        <button id="advApiBaseClearBtn" type="button"
          style="border-radius:999px;border:1px solid rgba(255,255,255,0.14);
                 background:rgba(255,255,255,0.06);padding:10px 14px;font-weight:800;color:rgba(255,255,255,0.92);">
          Réinitialiser
        </button>
      </div>
      <div style="opacity:.7;font-size:12px;">
        Astuce: tu peux aussi passer <code>?miningApiBase=...</code> dans l'URL pour tester rapidement.
      </div>
    `;

    const wire = async () => {
      const save = document.getElementById("advApiBaseSaveBtn");
      const clear = document.getElementById("advApiBaseClearBtn");
      const inp = document.getElementById("advApiBaseInput");
      if(!save || !clear || !inp) return;

      if(save.dataset.wired === "1") return;
      save.dataset.wired = "1";

      save.addEventListener("click", async () => {
        const v = String(inp.value || "").trim().replace(/\/+$/,"");
        if(!v){
          els.status.textContent = "URL invalide.";
          return;
        }
        try{ localStorage.setItem(LS_KEY, v); }catch(_){}
        els.status.textContent = "API configurée. Chargement des listes...";
        try{ await advLoadMeta({ force:true }); }catch(_){}
      });

      clear.addEventListener("click", () => {
        try{ localStorage.removeItem(LS_KEY); }catch(_){}
        inp.value = "";
        els.status.textContent = "Réinitialisé. Renseigne une URL d'API.";
      });
    };

    try{ wire(); }catch(_){}
  }

  function advSetVisibleState(state){
    if(els.resEmpty) els.resEmpty.classList.toggle("is-hidden", state !== "empty");
    if(els.resLoading) els.resLoading.classList.toggle("is-hidden", state !== "loading");
    if(els.resError) els.resError.classList.toggle("is-hidden", state !== "error");
    if(els.resBody) els.resBody.classList.toggle("is-hidden", state !== "ready");
  }

  function advSetError(message){
    if(els.resError) els.resError.textContent = message || "Erreur inconnue.";
    advSetVisibleState("error");
  }

  async function advCopyToClipboard(text){
    const t = String(text || "");
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(t);
        return true;
      }
    }catch(_){}
    try{
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.setAttribute("readonly","true");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    }catch(_){}
    return false;
  }

  function advGetApiBase(){
    // Resolution order:
    // 1) window.SC_HUB_CONFIG.MINING_LIVE_API_BASE (preferred)
    // 2) localStorage override (sc_hub_mining_api_base)
    // 3) URL param ?miningApiBase=
    // 4) miningLiveGetApiBase() (optional)
    const LS_KEY = "sc_hub_mining_api_base";

    // URL param override
    try{
      const u = new URL(location.href);
      const p = (u.searchParams.get("miningApiBase") || "").trim();
      if(p) return p.replace(/\/+$/,"");
    }catch(_){}

    // Global config
    try{
      const cfg = (window && window.SC_HUB_CONFIG) ? window.SC_HUB_CONFIG : null;
      const base = (cfg && cfg.MINING_LIVE_API_BASE) ? String(cfg.MINING_LIVE_API_BASE).trim() : "";
      if(base) return base.replace(/\/+$/,"");
    }catch(_){}

    // LocalStorage override
    try{
      const stored = (localStorage.getItem(LS_KEY) || "").trim();
      if(stored) return stored.replace(/\/+$/,"");
    }catch(_){}

    // Default (optional)
    try{
      const d = (typeof miningLiveGetApiBase() !== "undefined") ? String(miningLiveGetApiBase() || "").trim() : "";
      return d ? d.replace(/\/+$/,"") : "";
    }catch(_){
      return "";
    }
  }

  function advEnsureNumber(n){
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }

  function advNormalizeKeyFromInput(v){
    const raw = String(v || "").trim();
    if(!raw) return "";
    // Accept "Name - key" OR direct key
    const parts = raw.split("-").map(s => s.trim()).filter(Boolean);
    if(parts.length >= 2) return parts[parts.length - 1];
    return raw.toLowerCase().replace(/\s+/g, "_");
  }

  function advSaveSelection(){
    try{
      localStorage.setItem(ADV_SEL_STORAGE_KEY, JSON.stringify(advSelection));
    }catch(_){}
  }

  function advLoadSelection(){
    try{
      const raw = localStorage.getItem(ADV_SEL_STORAGE_KEY);
      if(!raw) return;
      const parsed = JSON.parse(raw);
      if(!Array.isArray(parsed)) return;
      advSelection = parsed
        .map(it => ({ key: String(it?.key || ""), scu: advEnsureNumber(it?.scu) }))
        .filter(it => it.key && it.scu > 0);
    }catch(_){}
  }

  async function advEnsureCatalog(opts = {}){
  // Cache: allow retry if previous attempt produced an empty catalog
  if(!opts.force && advCatalog && Array.isArray(advCatalog) && advCatalog.length) return advCatalog;

  const base = advGetApiBase();
  let ores = [];
  let apiTried = false;
  let apiOk = false;

  // 1) Try API catalog (preferred)
  if(base){
    apiTried = true;
    const url = base.replace(/\/+$/,"") + "/catalog/ship?t=" + Date.now();
    try{
      const data = await advFetchJSON(url, { timeoutMs: 12000 });
      if(Array.isArray(data?.ores)) ores = data.ores;
      apiOk = Array.isArray(ores) && ores.length > 0;
      if(apiOk) advCatalogSource = "api";
    }catch(_){
      // swallow; fallback to local dataset
    }
  }

  // 2) Fallback: local dataset assets/data/mining_ores_ship.json
  if(!ores.length){
    // Local fallback: load ship catalog JSON (safe even if oreDataShip is not in this scope)
    let local = null;
    try{ local = await loadOreDataShip(); }catch(_){ local = null; }

    let ods = null;
    try{
      if(typeof oreDataShip !== "undefined") ods = oreDataShip;
    }catch(_){ ods = null; }
    if(!ods){
      try{ ods = (typeof window !== "undefined") ? window.oreDataShip : null; }catch(_){ ods = null; }
    }
    if(!ods && local) ods = local;

    if(Array.isArray(ods)) ores = ods;
    else if(ods && Array.isArray(ods.ores)) ores = ods.ores;

    if(Array.isArray(ores) && ores.length) advCatalogSource = "local";
  }


  // 3) Still empty: surface a clear hint in the panel
  if(!Array.isArray(ores) || !ores.length){
    advCatalogSource = apiTried ? "none" : "none";
  }else if(!apiOk && apiTried && advCatalogSource === "local"){
    // API is configured but endpoint /catalog/ship is missing -> keep quiet in status (UI already shows ores)
    // You can still implement /catalog/ship in the Worker later for full-live operation.
  }

  advCatalog = (ores || [])
    .map(o => ({
      key: String(o?.key || ""),
      name: String(o?.name || o?.label || o?.display_name || o?.key || ""),
      aliases: Array.isArray(o?.aliases) ? o.aliases : [],
      color: o?.color
    }))
    .filter(o => o.key && o.name)
    .sort((a,b) => a.name.localeCompare(b.name, "fr", { sensitivity:"base" }));

  advByKey = Object.create(null);
  advCatalog.forEach(o => { advByKey[o.key] = o; });

  return advCatalog;
}

  function advUpsertSelection(key, deltaScu){
    const k = String(key || "");
    const d = advEnsureNumber(deltaScu);
    if(!k || d <= 0) return false;

    const idx = advSelection.findIndex(it => it.key === k);
    if(idx === -1){
      advSelection.push({ key: k, scu: Math.round(d * 1000)/1000 });
    }else{
      const next = Math.round((advSelection[idx].scu + d) * 1000) / 1000;
      advSelection[idx].scu = next;
    }
    advSaveSelection();
    return true;
  }

  function advSetSelectionQty(key, scu){
    const k = String(key || "");
    const q = Math.round(advEnsureNumber(scu) * 1000) / 1000;
    const idx = advSelection.findIndex(it => it.key === k);
    if(idx === -1) return;
    if(q <= 0){
      advSelection.splice(idx, 1);
    }else{
      advSelection[idx].scu = q;
    }
    advSaveSelection();
  }

  function advRemoveSelection(key){
    const k = String(key || "");
    const idx = advSelection.findIndex(it => it.key === k);
    if(idx !== -1){
      advSelection.splice(idx, 1);
      advSaveSelection();
    }
  }

  function advClearSelection(){
    advSelection = [];
    advSaveSelection();
  }

  function advGetSelectedItems(){
    const items = advSelection
      .map(it => {
        const ore = advByKey[it.key];
        return {
          key: it.key,
          name: ore ? ore.name : it.key,
          scu: Math.round(advEnsureNumber(it.scu) * 1000) / 1000
        };
      })
      .filter(it => it.key && it.scu > 0);

    // Sort by value desc (qty) then name
    items.sort((a,b) => (b.scu - a.scu) || a.name.localeCompare(b.name, "fr", { sensitivity:"base" }));
    return items;
  }

  function advNormalizeOreKey(v){
  return String(v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// --- Mineable ore allowlist (ship/vehicle mining) ---
// You can override/extend from config:
//   SC_HUB_CONFIG.MINING_MINEABLE_ORE_KEYS = ["quantanium", ...]
// Or disable filtering entirely:
//   SC_HUB_CONFIG.MINING_SHOW_ALL_ORES = true
const DEFAULT_MINEABLE_ORE_KEYS = [
  // High-value / rare
  "quantanium",
  "riccite",
  "riccite ore",
  "ricciteore",
  "stileron",
  "stileron ore",
  "stileronore",
  "bexalite",
  "taranite",
  "borase",
  "laranite",
  "agricium",

  // New ores (4.4+)
  "lindinium",
  "lindinium ore",
  "lindiniumore",
  "savrilium",
  "savrilium ore",
  "savriliumore",
  "torite",
  "torite ore",
  "toriteore",

  // Common / mid-value
  "hephaestanite",
  "titanium",
  "diamond",
  "gold",
  "copper",
  "beryl",
  "tungsten",
  "corundum",
  "quartz",

  // Industrial / common
  "aluminum",
  "aluminium",
  "iron",

  // Neutral/low-value filler often present in mining datasets
  "inert materials",
  "inert material",
  "inertmaterials",
  "inertmaterial"
];


// --- Profit sorting fallback (used when price is missing) ---
// This keeps the "Disponibles" list ordered sensibly even if an ore has no price yet in the dataset/API.
const ADV_FALLBACK_PROFIT_RANK = {
  // Top tier / rare
  savrilium: 1000000,
  lindinium: 950000,
  quantanium: 900000,
  bexalite: 850000,
  taranite: 820000,
  borase: 800000,
  laranite: 760000,
  agricium: 720000,
  torite: 680000,

  // Mid / common
  hephaestanite: 620000,
  titanium: 600000,
  diamond: 580000,
  gold: 560000,
  copper: 520000,
  beryl: 500000,
  tungsten: 480000,
  corundum: 460000,
  quartz: 420000,

  // Industrial / low
  aluminium: 200000,
  aluminum: 200000,
  iron: 180000,
  inertmaterials: 1,
  inertmaterial: 1
};

function advGetProfitScore(ore){
  if(!ore) return 0;
  const keyN = advNormalizeOreKey(ore.key || ore.name || "");
  const p = Number(ore.price_auEc_per_scu);
  if(Number.isFinite(p) && p > 0) return p;
  return Number(ADV_FALLBACK_PROFIT_RANK[keyN] || 0);
}
function advGetMineableKeySet(){
  try{
    if(window.SC_HUB_CONFIG && window.SC_HUB_CONFIG.MINING_SHOW_ALL_ORES) return null; // null = no filtering
    const cfg = (window.SC_HUB_CONFIG && Array.isArray(window.SC_HUB_CONFIG.MINING_MINEABLE_ORE_KEYS))
      ? window.SC_HUB_CONFIG.MINING_MINEABLE_ORE_KEYS
      : null;

    const keys = (cfg && cfg.length) ? cfg : DEFAULT_MINEABLE_ORE_KEYS;
    const s = new Set();
    keys.forEach(k => s.add(advNormalizeOreKey(k)));
    return s;
  }catch(_){
    const s = new Set();
    DEFAULT_MINEABLE_ORE_KEYS.forEach(k => s.add(advNormalizeOreKey(k)));
    return s;
  }
}

function advFocusSelectedOreInput(key){
  try{
    if(!els.selectedList) return;
    // keys are usually safe, but keep it minimal
    const li = els.selectedList.querySelector(`li[data-key="${CSS && CSS.escape ? CSS.escape(String(key)) : String(key).replace(/"/g,'&quot;')}"]`);
    if(!li) return;
    const input = li.querySelector("input.adv-sel-qty");
    if(input){
      input.focus();
      input.select?.();
    }
  }catch(_){}
}

function advRenderAvailOres(){
  if(!els.availOres) return;

  if(!advCatalog || !advCatalog.length){
    els.availOres.innerHTML = '<div class="adv-avail-empty">Catalogue indisponible (API). Vérifie l\'endpoint <b>/catalog/ship</b> (Worker) ou le dataset <b>/assets/data/mining_ores_ship.json</b>.</div>';
    return;
  }

  const qtyByKey = Object.create(null);
  advSelection.forEach(it => { qtyByKey[it.key] = Math.round(advEnsureNumber(it.scu) * 1000) / 1000; });

  let list = advCatalog.slice();

  // Filter out non-mineable ores (avoid confusing "future/unused" commodities)
  const mineableSet = advGetMineableKeySet(); // null => no filtering
  if(mineableSet){
    const filtered = list.filter(o => {
      const keyN  = advNormalizeOreKey(o?.key);
      const nameN = advNormalizeOreKey(o?.name);
      return mineableSet.has(keyN) || mineableSet.has(nameN);
    });

    // Safety: never allow the UI to become empty because of a mismatch
    if(filtered.length){
      list = filtered;
    } else {
      // Keep all items visible rather than a blank UI
      // (User can tighten the list later via config override)
      // No console spam, but a small hint in UI:
      // Will be shown only once per render.
      // (We keep it unobtrusive.)
      // Note: do not return.
      try{
        // inline hint at top
        els.availOres.innerHTML = '<div class="adv-avail-empty">Filtre "mineable" trop strict (0 match). Affichage complet réactivé. (Option: <b>SC_HUB_CONFIG.MINING_SHOW_ALL_ORES = true</b>)</div>';
      }catch(_){}
    }
  }
  // --- Regolith-like tiers (color grouping) ---
  // We group by tier (color) first, then sort by profitability within the tier.
  const __tierByKey = Object.create(null);

  const __tierRank = { "tier-s": 0, "tier-a": 1, "tier-b": 2, "tier-c": 3, "tier-d": 4, "tier-e": 5 };

  // Fixed tier mapping (avoid percentile-based colors that change with list length/prices)
  const __tierMap = Object.create(null);
  // S (violet) — most profitable
  ["riccite","stileron","savrilium","quantanium"].forEach(k => __tierMap[k] = "tier-s");

  // A (green)
  ["lindinium","taranite","bexalite","diamond"].forEach(k => __tierMap[k] = "tier-a");

  // B (olive/yellow)
  ["gold","borase"].forEach(k => __tierMap[k] = "tier-b");

  // C (orange)
  ["beryl","laranite","agricium","hephaestanite"].forEach(k => __tierMap[k] = "tier-c");

  // D (brown) — requested: Tungsten/Titanium/Torite + Iron/Quartz/Copper/Corundum in brown
  ["tungsten","titanium","torite","iron","quartz","copper","corundum"].forEach(k => __tierMap[k] = "tier-d");

  // E (gray) — requested: Aluminium + Inert in gray
  ["aluminum","aluminium","inertmaterials","inertmaterial"].forEach(k => __tierMap[k] = "tier-e");

  const __norm = (v) => advNormalizeOreKey(v);

  function __tierForOre(o){
    const k = __norm(o?.key);
    const n = __norm(o?.name);
    // direct matches
    if(k && __tierMap[k]) return __tierMap[k];
    if(n && __tierMap[n]) return __tierMap[n];

    // handle common variants like "<name>ore"
    if(k && k.endsWith("ore")){
      const kk = k.slice(0, -3);
      if(__tierMap[kk]) return __tierMap[kk];
    }
    if(n && n.endsWith("ore")){
      const nn = n.slice(0, -3);
      if(__tierMap[nn]) return __tierMap[nn];
    }

    // default: keep it visible but low priority
    return "tier-e";
  }

  // Muted tier styles (HUD-friendly)
  (function advEnsureTierStylesOnce(){
    try{
      if(document.getElementById("advOreTierStyles")) return;
      const st = document.createElement("style");
      st.id = "advOreTierStyles";
      st.textContent = `
        /* Advanced ores — Regolith-like tiers (muted) */
        #advAvailOres .ore-item{ border: 1px solid rgba(148,163,184,0.18); background: rgba(15,23,42,0.18); }
        #advAvailOres .ore-item:hover{ border-color: rgba(148,163,184,0.28); }
        #advAvailOres .ore-item.tier-s{ background: rgba(168,85,247,0.14); border-color: rgba(168,85,247,0.26); }
        #advAvailOres .ore-item.tier-a{ background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.22); }
        #advAvailOres .ore-item.tier-b{ background: rgba(190,242,100,0.10); border-color: rgba(190,242,100,0.22); }
        #advAvailOres .ore-item.tier-c{ background: rgba(251,146,60,0.10); border-color: rgba(251,146,60,0.22); }
        #advAvailOres .ore-item.tier-d{ background: rgba(161,98,7,0.10); border-color: rgba(161,98,7,0.22); }
        #advAvailOres .ore-item.tier-e{ background: rgba(148,163,184,0.08); border-color: rgba(148,163,184,0.18); }
      `;
      document.head.appendChild(st);
    }catch(_){}
  })();

  // Tier-first sorting: (tier -> profit -> name)
  list.sort((a,b) => {
    const ta = __tierForOre(a);
    const tb = __tierForOre(b);
    const ra = (__tierRank[ta] ?? 9);
    const rb = (__tierRank[tb] ?? 9);
    if(ra !== rb) return ra - rb;

    const ap = advGetProfitScore(a);
    const bp = advGetProfitScore(b);
    if(bp !== ap) return bp - ap;

    const an = String(a?.name || a?.key || "").trim();
    const bn = String(b?.name || b?.key || "").trim();
    return an.localeCompare(bn, "fr", { sensitivity:"base" });
  });

  // Build lookup for class assignment (by ore key)
  try{
    for(let i=0;i<list.length;i++){
      const k = (list[i] && list[i].key) ? String(list[i].key) : "";
      if(k) __tierByKey[k] = __tierForOre(list[i]);
    }
  }catch(_){}


  if(!list.length){
    els.availOres.innerHTML = '<div class="adv-avail-empty">Aucun minerai affichable.</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  list.forEach(o => {
    const qty = qtyByKey[o.key] || 0;
    const btn = document.createElement("button");
    btn.type = "button";
    const tierCls = (__tierByKey && o && o.key && __tierByKey[o.key]) ? __tierByKey[o.key] : "";
    btn.className = "ore-item" + (tierCls ? (" " + tierCls) : "") + (qty > 0 ? " is-selected" : "");

    btn.setAttribute("data-key", o.key);

    // Build label: dot + name (no qty badge)
    const dot = document.createElement("span");
    dot.className = "ore-dot";
    dot.style.background = o.color || "#64748b";
    btn.appendChild(dot);

    const label = document.createElement("span");
    label.className = "ore-label";
    label.textContent = o.name || o.key || "—";
    btn.appendChild(label);

    // Optional small price label (kept off by default to avoid clutter)
    // if(window.SC_HUB_CONFIG && window.SC_HUB_CONFIG.MINING_SHOW_PRICE_TAG){
    //   const p = Number(o.price_auEc_per_scu || 0);
    //   if(p > 0){
    //     const tag = document.createElement("span");
    //     tag.className = "adv-ore-price";
    //     tag.textContent = `${Math.round(p)} aUEC/SCU`;
    //     btn.appendChild(tag);
    //   }
    // }

    btn.addEventListener("click", () => {
      // If already selected, do NOT add again; focus qty input
      if((qtyByKey[o.key] || 0) > 0){
        advFocusSelectedOreInput(o.key);
        return;
      }

      // First click adds +1 SCU, then focus qty input in selection list
      advUpsertSelection(o.key, 1);
      advRenderSelection();
      advRenderAvailOres();
      // Focus after DOM updates
      setTimeout(() => advFocusSelectedOreInput(o.key), 0);
    });

    frag.appendChild(btn);
  });

  // If we inserted an inline hint earlier, don't wipe it out; append below.
  // If not, clear and render normally.
  const hadHint = els.availOres.querySelector && els.availOres.querySelector(".adv-avail-empty");
  if(hadHint && els.availOres.children.length === 1 && els.availOres.firstElementChild?.classList?.contains("adv-avail-empty")){
    els.availOres.appendChild(frag);
  } else {
    els.availOres.innerHTML = "";
    els.availOres.appendChild(frag);
  }
}

function advRenderSelection(){
    const items = advGetSelectedItems();
    const has = items.length > 0;

    if(els.emptySel) els.emptySel.classList.toggle("is-hidden", has);
    if(els.selectedList) els.selectedList.classList.toggle("is-hidden", !has);
    if(els.selectedMeta) els.selectedMeta.classList.toggle("is-hidden", !has);

    const baseOk = Boolean(advGetApiBase());
    if(els.computeBtn) els.computeBtn.disabled = !has;
    if(els.copyBtn) els.copyBtn.disabled = !(has && baseOk);

    if(!els.selectedList) return;
    els.selectedList.innerHTML = "";

    let totalScu = 0;
    const frag = document.createDocumentFragment();

    items.forEach(it => {
      totalScu += it.scu;

      const li = document.createElement("li");
      li.dataset.key = it.key;
      li.innerHTML = `
        <div class="adv-sel-left">
          <span class="adv-pill">BRUT</span>
          <span class="truncate">${escapeHtml(it.name)}</span>
          <span class="adv-sel-key">${escapeHtml(it.key)}</span>
        </div>
        <div class="adv-sel-right">
          <input class="adv-sel-qty" type="number" min="0" step="0.001" value="${escapeHtml(String(it.scu))}" aria-label="Quantité SCU" />
          <span class="adv-sel-unit">SCU</span>
          <button class="adv-sel-remove" type="button" aria-label="Supprimer">x</button>
        </div>
      `;

      const qtyInput = li.querySelector(".adv-sel-qty");
      const rmBtn = li.querySelector(".adv-sel-remove");

      if(qtyInput){
        qtyInput.addEventListener("change", () => {
          const v = Math.max(0, Math.round(advEnsureNumber(qtyInput.value) * 1000) / 1000);
          advSetSelectionQty(it.key, v);
          advRenderSelection();
        });
      }
      if(rmBtn){
        rmBtn.addEventListener("click", () => {
          advRemoveSelection(it.key);
          advRenderSelection();
        });
      }

      frag.appendChild(li);
    });

    els.selectedList.appendChild(frag);

    if(els.totalInputScu) els.totalInputScu.textContent = `${fmtSCU(totalScu)} SCU`;
    if(els.totalProducts) els.totalProducts.textContent = `${items.length}`;
  }

  function advBuildItemsParam(items){
    return items.map(it => `${it.key}:${it.scu}`).join(",");
  }

  function advBuildEndpoint(items){
    const base = advGetApiBase();
    if(!base) return "";
    const qp = new URLSearchParams();
    qp.set("items", advBuildItemsParam(items));
    qp.set("refinery", String(els.refinery?.value || "auto"));
    qp.set("method", String(els.method?.value || "auto"));
    qp.set("yield_window", String(els.yieldWindow?.value || "30d"));
    qp.set("objective", String(els.objective?.value || "net_total"));
    qp.set("include_time", String(els.includeTime?.value || "1"));
    qp.set("v", String(Date.now()));
    return base.replace(/\/+$/,"") + "/advanced?" + qp.toString();
  }

  async function advFetchJSON(url, { timeoutMs=12000 } = {}){
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try{
      const res = await fetch(url, { method:"GET", headers:{ "accept":"application/json" }, signal: ctrl.signal });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }finally{
      clearTimeout(t);
    }
  }

  function advPopulateSelect(select, items, {valueKey="value", labelKey="label", keepAuto=true} = {}){
    if(!select) return;

    const current = select.value || "";
    const base = [];
    if(keepAuto){
      base.push({ value:"auto", label:"Auto" });
    }

    const normalized = Array.isArray(items) ? items.map(x => ({
      value: String(x?.[valueKey] ?? x?.value ?? ""),
      label: String(x?.[labelKey] ?? x?.label ?? x?.name ?? x?.value ?? "")
    })).filter(x => x.value && x.label) : [];

    const all = base.concat(normalized);

    select.innerHTML = "";
    all.forEach((o, idx) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if(idx===0 && keepAuto) opt.selected = true;
      select.appendChild(opt);
    });

    if(current && Array.from(select.options).some(o=>o.value===current)){
      select.value = current;
    }
  }

  async function advLoadMeta({ force=false } = {}){
    const base = advGetApiBase();
    if(!base){
      advStatus("API non configurée.", { needsApi:true });
      return null;
    }

    const now = Date.now();
    const ttl = 6 * 60 * 60 * 1000;
    if(!force && advMeta && (now - advMetaLoadedAt) < ttl) return advMeta;
    if(advMetaInFlight) return advMetaInFlight;

    const url = base.replace(/\/+$/,"") + "/advanced/meta?v=" + now;
    advStatus("Chargement des listes (raffineries / méthodes)...");

    advMetaInFlight = (async () => {
      try{
        const data = await advFetchJSON(url, { timeoutMs: 15000 });
        if(!data || data.status !== "ok") throw new Error("Réponse API invalide.");

        advMeta = data;
        advMetaLoadedAt = Date.now();

        const refineries = Array.isArray(data.refineries) ? data.refineries : [];
        const methods = Array.isArray(data.methods) ? data.methods : [];

        advPopulateSelect(els.refinery, refineries, { valueKey: "id_terminal", labelKey: "label", keepAuto:true });
        advPopulateSelect(els.method, methods, { valueKey: "code", labelKey: "label", keepAuto:true });

        advStatus(`Listes chargées: ${refineries.length} raffineries, ${methods.length} méthodes.`);
        return advMeta;
      }catch(err){
        advStatus(`Erreur meta: ${String(err && err.message ? err.message : err)}`);
        return null;
      }finally{
        advMetaInFlight = null;
      }
    })();

    return advMetaInFlight;
  }

  function advRenderKpis(payload){
    if(!els.kpis) return;
    const t = payload?.totals || {};
    const sel = payload?.selected || {};
    const refineryLabel = sel?.refinery?.label || "Auto";
    const methodLabel = sel?.method?.label || "Auto";

    const gross = Number.isFinite(t.gross_auec) ? t.gross_auec : null;
    const cost = Number.isFinite(t.cost_auec) ? t.cost_auec : null;
    const net = Number.isFinite(t.net_auec) ? t.net_auec : (gross != null ? gross : null);

    const totalTimeH = Number.isFinite(t.total_time_h) ? t.total_time_h : null;
    const netPerHour = Number.isFinite(t.net_per_hour) ? t.net_per_hour : (net != null && totalTimeH != null && totalTimeH > 0 ? (net / totalTimeH) : null);

    const kpis = [
      { label: "Brut total", value: `${fmtSCU(t.input_scu)} SCU` },
      { label: "Bonus rendement (moy.)", value: (Number.isFinite(t.avg_yield_bonus_pct) ? `${fmtPct(t.avg_yield_bonus_pct)}` : "-") },
      { label: "Valeur brute", value: `${fmtUEC(gross)} aUEC` },
      { label: "Coût raffinage", value: (cost != null ? `${fmtUEC(cost)} aUEC` : "-") },
      { label: "Net total", value: `${fmtUEC(net)} aUEC` },
      { label: "Net / heure", value: (netPerHour != null ? `${fmtUEC(netPerHour)} aUEC/h` : "-") },
      { label: "Raffinerie / Méthode", value: `${refineryLabel} / ${methodLabel}` },
    ];

    els.kpis.innerHTML = kpis.map((k, i) => {
      const isRef = (k.label === "Raffinerie / Méthode");
      const cls = `kpi${isRef ? " kpi-wide kpi-refinery-method" : ""}`;
      const valueHtml = isRef
        ? `${escapeHtml(refineryLabel)}<br><span class="kpi-sub">${escapeHtml(methodLabel)}</span>`
        : escapeHtml(k.value);

      return `
      <div class="${cls}">
        <div class="kpi-label">${escapeHtml(k.label)}</div>
        <div class="kpi-value${isRef ? " kpi-value-wrap" : ""}">${valueHtml}</div>
      </div>
    `;
    }).join("");
  }

  function advRenderItems(payload){
    if(!els.itemsWrap) return;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if(!items.length){
      els.itemsWrap.innerHTML = `<div class="empty-state">Aucun résultat exploitable.</div>`;
      return;
    }

    const html = items.map((it) => {
      const oreName = it?.raw?.name || it?.key || "-";
      const refName = it?.refined?.name || "-";
      const best = it?.refined?.best || null;
      const bestLabel = best ? `${best.terminal_name || best.location || "-"}` : "-";
      const bestPrice = best ? `${fmtUEC(best.price_sell)} aUEC/SCU` : "-";
      const sellers = Array.isArray(it?.refined?.top_sellers) ? it.refined.top_sellers : [];

      const sellersHtml = sellers.length ? `
        <div class="adv-sellers">
          ${sellers.map(s => `
            <div class="adv-seller">
              <div>${escapeHtml(s.terminal_name || s.location || "-")}</div>
              <div><strong>${fmtUEC(s.price_sell)}</strong> aUEC/SCU</div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="hint" style="margin-top:8px;">Top vendeurs indisponible.</div>`;

      return `
        <div class="adv-item">
          <div class="adv-item-head">
            <div class="adv-item-title">
              <div class="t-main">${escapeHtml(refName)}</div>
              <div class="t-sub">${escapeHtml(oreName)} -> Raffiné</div>
            </div>
            <div class="adv-item-metrics">
              <div class="metric"><span>Brut</span><strong>${fmtSCU(it.input_scu)}</strong></div>
              <div class="metric"><span>Sortie</span><strong>${fmtSCU(it.output_scu)}</strong></div>
              <div class="metric"><span>Meilleur</span><strong>${escapeHtml(bestPrice)}</strong></div>
            </div>
          </div>
          <div class="adv-item-body">
            <div class="meta-row" style="display:flex;justify-content:space-between;opacity:.92;">
              <span>${escapeHtml(bestLabel)}</span>
              <span>Bonus: <strong>${Number.isFinite(it.yield_bonus_pct) ? fmtPct(it.yield_bonus_pct) : "-"}</strong></span>
            </div>
            ${sellersHtml}
          </div>
        </div>
      `;
    }).join("");

    els.itemsWrap.innerHTML = html;
  }

  async function advCompute(){
    const items = advGetSelectedItems();
    if(!items.length){
      advStatus("Sélection vide.");
      advSetVisibleState("empty");
      return;
    }

    const endpoint = advBuildEndpoint(items);
    if(!endpoint){
      advSetError("API non configurée. Renseigne l'endpoint Worker (Advanced API base) puis réessaie.");
      advSetVisibleState("error");
      advStatus("API non configurée.", { needsApi:true });
      return;
    }

    const refineryMode = String(els.refinery?.value || "auto");
    const methodMode   = String(els.method?.value || "auto");

    advStatus("Calcul post-raffinage...");
    advSetVisibleState("loading");

    try{
      const url = new URL(endpoint);
      url.searchParams.set("v", String(Date.now())); // cache-bust
      const payload = await advFetchJSON(url.toString(), { timeoutMs: 25000 });

      if(!payload || payload.status !== "ok"){
        throw new Error(payload?.error || payload?.message || "Réponse API invalide.");
      }

      // Decorate labels when user selected Auto (keeps UX: Auto → X)
      try{
        payload.selected = payload.selected || {};
        payload.selected.refinery = payload.selected.refinery || {};
        payload.selected.method = payload.selected.method || {};

        if(refineryMode === "auto"){
          const lbl = String(payload.selected.refinery.label || "");
          if(lbl && !lbl.startsWith("Auto → ")) payload.selected.refinery.label = "Auto → " + lbl;
        }
        if(methodMode === "auto"){
          const lbl = String(payload.selected.method.label || "");
          if(lbl && !lbl.startsWith("Auto → ")) payload.selected.method.label = "Auto → " + lbl;
        }
      }catch(_){}

      advRenderKpis(payload);
      advRenderItems(payload);

      if(els.resJson) els.resJson.textContent = JSON.stringify(payload, null, 2);
      if(els.debugWrap) els.debugWrap.open = false;

      advSetVisibleState("ready");
      advStatus(`OK - maj: ${payload.updated_at || "-"}`);
    }catch(err){
      advSetError(`Erreur: ${String(err && err.message ? err.message : err)}`);
      advSetVisibleState("error");
      advStatus("Erreur de calcul.");
    }
  }

  function advCopyEndpoint(){
    const items = advGetSelectedItems();
    const endpoint = advBuildEndpoint(items);
    if(!endpoint){
      advStatus("Impossible de copier: API non configurée ou sélection vide.");
      return;
    }
    advCopyToClipboard(endpoint);
    advStatus("URL API copiée.");
  }

  async function advHandleAdd(){
    await advEnsureCatalog();

    const key = advNormalizeKeyFromInput(els.oreSearch?.value || "");
    const qty = Math.round(Math.max(0, advEnsureNumber(els.oreQty?.value || 0) || 1) * 1000) / 1000;

    if(!key || !advByKey[key]){
      advMiniStatus("Minerai invalide. Utilise la liste (vaisseau).");
      return;
    }
    if(qty <= 0){
      advMiniStatus("Quantité invalide.");
      return;
    }

    advUpsertSelection(key, qty);
    advMiniStatus(`Ajouté: ${advByKey[key].name} (+${fmtSCU(qty)} SCU)`);

    if(els.oreSearch) els.oreSearch.value = "";
    if(els.oreQty) els.oreQty.value = "";

    advRenderSelection();
  }

  async function advHandleImportFromBeginner(){
    await advEnsureCatalog();

    // Import ONLY ship-minable ores (ship dataset) from Beginner selection storage.
    const keys = Array.isArray(selectedOreKeysShip) ? selectedOreKeysShip.slice() : [];
    let imported = 0;
    let ignored = 0;

    keys.forEach((k) => {
      const key = String(k || "");
      if(!key) return;
      if(!advByKey[key]) { ignored++; return; }

      const rawQty = advEnsureNumber(oreQtyByKeyShip && oreQtyByKeyShip[key]);
      const qty = Math.round(Math.max(0, rawQty || 1) * 1000) / 1000;
      if(qty <= 0) return;

      advUpsertSelection(key, qty);
      imported++;
    });

    if(imported === 0){
      advMiniStatus(ignored ? `Import: 0 - ${ignored} ignoré(s) (non vaisseau).` : "Import: aucun minerai (vaisseau) trouvé.");
    }else{
      advMiniStatus(`Import: ${imported} minerai(s) - ${ignored} ignoré(s) (non vaisseau).`);
    }
    advRenderSelection();
  }

  function advHandleClear(){
    advClearSelection();
    advMiniStatus("Sélection vidée.");
    advRenderSelection();
    advSetVisibleState("empty");
    advStatus("");
  }

  // Bind buttons (Mode Avancé)
  // Actions: load meta, compute, copy endpoint
  if(els.metaBtn) els.metaBtn.addEventListener("click", () => { try{ advLoadMeta({ force:true }); }catch(_){} });
  if(els.computeBtn) els.computeBtn.addEventListener("click", () => { try{ advCompute(); }catch(_){} });
  if(els.copyBtn) els.copyBtn.addEventListener("click", () => { try{ advCopyEndpoint(); }catch(_){} });

if(els.clearBtn) els.clearBtn.addEventListener("click", () => advHandleClear());

      // Click-to-add from "Disponibles" (ship-only)
      if(els.availOres){
        els.availOres.addEventListener("click", (e) => {
          const t = e.target && (e.target.closest ? e.target.closest(".adv-ore-chip") : null);
          if(!t) return;
          const key = t.dataset && t.dataset.key ? String(t.dataset.key) : "";
          if(!key) return;

          const exists = advSelection.some(it => it.key === key);
          if(!exists){
            advSelection.push({ key, scu: 1 });
            advSaveSelection();
            advMiniStatus(`${advByKey && advByKey[key] ? advByKey[key].name : key} ajouté (1 SCU)`);
            advRenderSelection();
          }else{
            // Focus the quantity input of the existing line
            const row = els.selectedList && els.selectedList.querySelector(`[data-key="${cssEscape(key)}"]`);
            const inp = row ? row.querySelector(".adv-sel-qty") : null;
            if(inp && inp.focus){
              inp.focus();
              try{ inp.select(); }catch(_){}
            }
          }
        });
      }

      // (Search/add/import removed in UI)
// Enter-to-add

  const bindEnter = (el) => {
    if(!el) return;
    el.addEventListener("keydown", (e) => {
      if(e.key === "Enter"){
        e.preventDefault();
        advHandleAdd();
      }
    });
  };
  bindEnter(els.oreSearch);
  bindEnter(els.oreQty);

  
  // Custom ore search dropdown (more visible than native <datalist>)
  let advSuggestEl = null;
  let advSuggestItems = [];
  let advSuggestIndex = -1;
  let advSuggestOpen = false;
  let advSuggestBlurTimer = null;

  function advEnsureSuggestEl(){
    if (advSuggestEl) return advSuggestEl;
    if (!els.oreSearch) return null;

    const host = els.oreSearch.closest(".adv-field-compact") || els.oreSearch.parentElement;
    if (!host) return null;

    advSuggestEl = document.createElement("div");
    advSuggestEl.id = "advOreSuggest";
    advSuggestEl.className = "adv-suggest is-hidden";
    advSuggestEl.setAttribute("role", "listbox");
    host.appendChild(advSuggestEl);

    // Prevent blur->hide when clicking inside
    advSuggestEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    return advSuggestEl;
  }

  function advFilterSuggest(query){
    const q = String(query || "").trim().toLowerCase();
    const list = Array.isArray(advCatalog) ? advCatalog : [];
    if (!q) return list.slice(0, 12);

    // Loose matching on name OR key
    const ranked = [];
    for (const it of list){
      const name = String(it.name || "").toLowerCase();
      const key = String(it.key || "").toLowerCase();
      if (!name && !key) continue;

      // rank: prefix match > contains match
      let score = 0;
      if (name.startsWith(q) || key.startsWith(q)) score += 3;
      if (name.includes(q) || key.includes(q)) score += 1;
      if (score <= 0) continue;

      ranked.push({ it, score });
    }

    ranked.sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name, "fr", { sensitivity:"base" }));
    return ranked.slice(0, 12).map(r => r.it);
  }

  function advSetSuggestOpen(open){
    const el = advEnsureSuggestEl();
    if (!el) return;
    advSuggestOpen = Boolean(open);
    el.classList.toggle("is-hidden", !advSuggestOpen);
  }

  function advRenderSuggest(){
    const el = advEnsureSuggestEl();
    if (!el) return;

    const q = els.oreSearch ? els.oreSearch.value : "";
    advSuggestItems = advFilterSuggest(q);
    advSuggestIndex = -1;

    if (!advSuggestItems.length){
      el.innerHTML = `<div class="adv-suggest-empty">Aucun résultat</div>`;
      advSetSuggestOpen(true);
      return;
    }

    el.innerHTML = "";
    const frag = document.createDocumentFragment();

    advSuggestItems.forEach((it, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "adv-suggest-item";
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", "false");
      btn.innerHTML = `<span class="adv-suggest-name">${escapeHtml(it.name)}</span><span class="adv-suggest-key">${escapeHtml(it.key)}</span>`;

      btn.addEventListener("click", () => {
        advChooseSuggest(idx);
      });

      frag.appendChild(btn);
    });

    el.appendChild(frag);
    advSetSuggestOpen(true);
  }

  function advHighlightSuggest(idx){
    const el = advSuggestEl;
    if (!el) return;
    const items = Array.from(el.querySelectorAll(".adv-suggest-item"));
    items.forEach((b) => b.classList.remove("is-active"));
    if (idx < 0 || idx >= items.length) return;
    items[idx].classList.add("is-active");
    advSuggestIndex = idx;

    // Keep highlighted item visible
    try{
      items[idx].scrollIntoView({ block: "nearest" });
    }catch(_){}
  }

  function advChooseSuggest(idx){
    const it = advSuggestItems && advSuggestItems[idx];
    if (!it || !els.oreSearch) return;

    els.oreSearch.value = `${it.name} - ${it.key}`;
    advSetSuggestOpen(false);

    // UX: jump to qty input
    if (els.oreQty) els.oreQty.focus();
  }

  function advOpenSuggest(){
    if (!els.oreSearch) return;
    if (advSuggestBlurTimer) { clearTimeout(advSuggestBlurTimer); advSuggestBlurTimer = null; }

    advEnsureCatalog().then(() => {
      advRenderSuggest();
    }).catch(() => {
      // ignore
    });
  }

  function advCloseSuggestSoon(){
    if (advSuggestBlurTimer) clearTimeout(advSuggestBlurTimer);
    advSuggestBlurTimer = setTimeout(() => advSetSuggestOpen(false), 140);
  }

  if (els.oreSearch){
    els.oreSearch.addEventListener("focus", () => advOpenSuggest());
    els.oreSearch.addEventListener("click", () => advOpenSuggest());
    els.oreSearch.addEventListener("input", () => advOpenSuggest());
    els.oreSearch.addEventListener("blur", () => advCloseSuggestSoon());

    els.oreSearch.addEventListener("keydown", (e) => {
      if (!advSuggestOpen) return;

      if (e.key === "Escape"){
        advSetSuggestOpen(false);
        return;
      }

      if (e.key === "ArrowDown"){
        e.preventDefault();
        const next = Math.min((advSuggestIndex < 0 ? 0 : advSuggestIndex + 1), advSuggestItems.length - 1);
        advHighlightSuggest(next);
        return;
      }

      if (e.key === "ArrowUp"){
        e.preventDefault();
        const prev = Math.max((advSuggestIndex < 0 ? advSuggestItems.length - 1 : advSuggestIndex - 1), 0);
        advHighlightSuggest(prev);
        return;
      }

      if (e.key === "Enter" && advSuggestIndex >= 0){
        e.preventDefault();
        advChooseSuggest(advSuggestIndex);
        return;
      }
    });
  }

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!advSuggestOpen) return;
    const t = e.target;
    if (!t) return;
    if (t === els.oreSearch) return;
    if (advSuggestEl && advSuggestEl.contains(t)) return;
    advSetSuggestOpen(false);
  }, true);
// Initial load
  advLoadSelection();
  advEnsureCatalog().finally(() => {
    advRenderSelection();
    try{ advRenderAvailOres(); }catch(_){ }
  });
advLoadMeta({ force:false });
  advSetVisibleState("empty");
}


let miningCurrentModuleMode = "beginner";

function miningApplyModuleMode(mode, opts){
  opts = opts || {};
  const save = opts.save !== false;

  const beginnerBtn = document.getElementById("moduleModeBeginnerBtn");
  const advancedBtn = document.getElementById("moduleModeAdvancedBtn");
  const beginnerView = document.getElementById("moduleBeginnerView");
  const advancedView = document.getElementById("moduleAdvancedView");

  if(!beginnerBtn || !advancedBtn || !beginnerView || !advancedView) return;

  const next = (mode === "advanced") ? "advanced" : "beginner";
  miningCurrentModuleMode = next;

  // Buttons
  beginnerBtn.classList.toggle("is-active", next === "beginner");
  advancedBtn.classList.toggle("is-active", next === "advanced");
  beginnerBtn.setAttribute("aria-selected", next === "beginner" ? "true" : "false");
  advancedBtn.setAttribute("aria-selected", next === "advanced" ? "true" : "false");

  // Views
  beginnerView.classList.toggle("is-hidden", next !== "beginner");
  advancedView.classList.toggle("is-hidden", next !== "advanced");

  // Accessibility: keep aria-hidden in sync with visibility
  beginnerView.setAttribute("aria-hidden", next !== "beginner" ? "true" : "false");
  advancedView.setAttribute("aria-hidden", next !== "advanced" ? "true" : "false");

  // Lazy init Advanced UI (doesn't touch Beginner logic)
  if(next === "advanced"){
    try{ miningInitAdvancedScaffold(); }catch(_){}
}

  if(save){
    try{ localStorage.setItem("mining_module_mode", next); }catch(_){}
  }
}


function miningInitModuleModeSwitch
(){
  if(miningModuleModeInited) return;
  miningModuleModeInited = true;

  const beginnerBtn = document.getElementById("moduleModeBeginnerBtn");
  const advancedBtn = document.getElementById("moduleModeAdvancedBtn");
  const beginnerView = document.getElementById("moduleBeginnerView");
  const advancedView = document.getElementById("moduleAdvancedView");

  if(!beginnerBtn || !advancedBtn || !beginnerView || !advancedView) return;

  beginnerBtn.addEventListener("click", () => miningApplyModuleMode("beginner"));
  advancedBtn.addEventListener("click", () => miningApplyModuleMode("advanced"));

  let saved = "beginner";
  try{
    const s = localStorage.getItem("mining_module_mode");
    if(s === "advanced" || s === "beginner") saved = s;
  }catch(_){}
  miningApplyModuleMode(saved, {save:false});
}


/* =======================
   V1.5.19
   - Regolith-like ordering must apply immediately when entering Advanced (no page refresh required)
   - Dock the MINING version bar ("techbar" in your UI) under the bottom panels in Advanced, centered
   ======================= */

function miningEnsureTechbarSlotV1519(){
  try{
    let slot = document.getElementById("miningTechbarSlot");
    if(slot) return slot;

    const advView = document.getElementById("moduleAdvancedView");
    const grid = advView ? advView.querySelector(".adv-grid") : null;
    if(!grid) return null;

    slot = document.createElement("div");
    slot.id = "miningTechbarSlot";
    slot.className = "mining-techbar-slot";
    slot.setAttribute("role","region");
    slot.setAttribute("aria-label","Techbar");
    grid.appendChild(slot);
    return slot;
  }catch(_){
    return null;
  }
}

function miningDockVersionBarToAdvancedV1519(){
  try{
    const slot = miningEnsureTechbarSlotV1519();
    if(!slot) return false;

    const vb = document.querySelector(".page-mining-version");
    if(!vb) return false;

    if(vb.parentElement !== slot){
      slot.appendChild(vb);
    }
    try{ vb.classList.add("is-docked-mining"); }catch(_){}
    return true;
  }catch(_){
    return false;
  }
}

function miningIsAdvancedVisibleV1519(){
  try{
    const advView = document.getElementById("moduleAdvancedView");
    if(advView && !advView.classList.contains("is-hidden")) return true;

    const btn = document.getElementById("moduleModeAdvancedBtn");
    if(btn){
      if(btn.classList.contains("is-active")) return true;
      const aria = btn.getAttribute("aria-selected");
      if(aria === "true") return true;
    }
  }catch(_){}
  return false;
}

let __miningAdvEnterLockV1519 = false;

function miningOnAdvancedShownV1519(){
  try{
    if(!miningIsAdvancedVisibleV1519()) return;
    if(__miningAdvEnterLockV1519) return;
    __miningAdvEnterLockV1519 = true;

    // Ensure dock now (even before lists finish loading)
    try{ miningDockVersionBarToAdvancedV1519(); }catch(_){}

    // Ensure Advanced scaffold exists
    try{ miningInitAdvancedScaffold(); }catch(_){}

    // Force catalog + render (Regolith ordering is done inside advRenderAvailOres)
    Promise.resolve(advEnsureCatalog({ force: true }))
      .finally(() => {
        try{ advRenderAvailOres(); }catch(_){}
        try{ advRenderSelection(); }catch(_){}
        try{ miningDockVersionBarToAdvancedV1519(); }catch(_){}
        // unlock after a short delay (allow re-enter later)
        setTimeout(() => { __miningAdvEnterLockV1519 = false; }, 120);
      });
  }catch(_){
    __miningAdvEnterLockV1519 = false;
  }
}

function miningWatchAdvancedVisibilityV1519(){
  try{
    const advView = document.getElementById("moduleAdvancedView");
    const btn = document.getElementById("moduleModeAdvancedBtn");
    const fire = () => { try{ miningOnAdvancedShownV1519(); }catch(_){} };

    if(advView){
      try{ new MutationObserver(fire).observe(advView, { attributes:true, attributeFilter:["class","aria-hidden","style"] }); }catch(_){}
    }
    if(btn){
      try{ new MutationObserver(fire).observe(btn, { attributes:true, attributeFilter:["class","aria-selected"] }); }catch(_){}
    }

    // Click capture: works even if another script owns the switch logic
    document.addEventListener("click", (e) => {
      const t = e.target;
      if(!t) return;
      if(t.closest("#moduleModeAdvancedBtn")) setTimeout(fire, 0);
    }, true);

    // Retry loop for late DOM, cached tabs, or delayed dataset init
    let tries = 0;
    (function tick(){
      fire();
      tries++;
      if(tries < 25) setTimeout(tick, 160);
    })();
  }catch(_){}
}


document.addEventListener("DOMContentLoaded", () => {
    try { miningWatchAdvancedVisibilityV1519(); } catch(_) {}
try { miningInitVersionFooter(); } catch(_) {}
  try { miningInitModuleModeSwitch(); } catch(_) {}
  try { miningLiveProbeAvailability(); } catch(_) {}
});


/* ========================================================================
   ADV ORES UI LAYER — V1.4.93 (PERF OPT)
   Objectifs:
   - En Mode Avancé, empêcher le multi-clic qui cumule des SCU sur "Disponibles".
     * Si déjà sélectionné: focus l'input SCU dans "Minerais sélectionnés" (aucun ajout).
   - Retirer toute quantité/badge dans la liste "Disponibles" (l'input SCU n'existe que dans la sélection).
   - Trier la liste "Disponibles" du plus rentable au moins rentable (price_auEc_per_scu décroissant).
   - Supprimer les minerais "non minables" (allowlist basée sur mining_ores_ship.json).
   Perf:
   - Un seul chargement/parsing dataset (cache)
   - MutationObserver throttlé (RAF) + garde anti-boucle
   - Reorder uniquement si l'ordre a réellement changé
   ======================================================================== */

(function(){
  "use strict";

  const ADV_AVAIL_ID = "advAvailOres";
  const ADV_SEL_ID   = "advSelectedList";

  // Dataset index cache
  let _shipIndexPromise = null;
  let _shipAllow = null;          // Set<key>
  let _shipPrice = null;          // Map<key, price_auEc_per_scu>

  // Observer / scheduling
  let _obs = null;
  let _scheduled = false;
  let _isApplying = false;
  let _lastSig = ""; // signature of sorted keys to avoid redundant work

  function _normKey(s){
    return String(s || "").trim().toLowerCase();
  }

  function _raf(fn){
    const r = window.requestAnimationFrame || ((cb)=>setTimeout(cb, 16));
    r(fn);
  }

  async function _fetchJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

  async function _loadShipIndex(){
    if(_shipIndexPromise) return _shipIndexPromise;

    _shipIndexPromise = (async () => {
      // Try both prod + local/dev common paths
      const candidates = [
        "/assets/data/mining_ores_ship.json",
        "assets/data/mining_ores_ship.json",
        "../assets/data/mining_ores_ship.json",
        "../../assets/data/mining_ores_ship.json",

        "/mining_ores_ship.json",
        "mining_ores_ship.json",
        "../mining_ores_ship.json",
        "../../mining_ores_ship.json"
      ];

      let data = null;
      for(const u of candidates){
        try{
          data = await _fetchJson(u);
          if(data) break;
        }catch(_){}
      }

      // Normalize payload shape
      const ores = Array.isArray(data) ? data
        : (data && Array.isArray(data.ores) ? data.ores : []);

      const allow = new Set();
      const price = new Map();

      for(const o of ores){
        const key  = _normKey(o?.key || o?.id || o?.slug || o?.name);
        if(!key) continue;

        allow.add(key);

        // accept multiple field names defensively
        const p =
          Number(o?.price_auEc_per_scu ?? o?.price_per_scu ?? o?.price ?? o?.uec_per_scu ?? 0) || 0;

        // store if positive
        if(p > 0) price.set(key, p);
      }

      _shipAllow = allow.size ? allow : null;
      _shipPrice = price.size ? price : new Map();

      return { allow: _shipAllow, price: _shipPrice };
    })();

    return _shipIndexPromise;
  }

  function _isSelectedKey(key){
    const sel = document.getElementById(ADV_SEL_ID);
    if(!sel) return false;
    // Accept multiple row patterns
    return !!(
      sel.querySelector(`[data-key="${CSS.escape(key)}"]`) ||
      sel.querySelector(`.adv-sel-row[data-key="${CSS.escape(key)}"]`)
    );
  }

  function _findSelectedInput(key){
    const sel = document.getElementById(ADV_SEL_ID);
    if(!sel) return null;

    const row =
      sel.querySelector(`[data-key="${CSS.escape(key)}"]`) ||
      sel.querySelector(`.adv-sel-row[data-key="${CSS.escape(key)}"]`);

    if(!row) return null;

    // Typical patterns: input[type=number] in row, or .adv-scu-input
    return (
      row.querySelector('input[type="number"]') ||
      row.querySelector("input.adv-scu-input") ||
      row.querySelector("input")
    );
  }

  function _focusSelectedInput(key){
    const inp = _findSelectedInput(key);
    if(!inp) return false;

    try{
      inp.focus({ preventScroll:false });
      inp.select?.();
    }catch(_){}
    return true;
  }

  function _removeQtyBadges(avail){
    // Remove any “qty” pills/badges in the avail list
    avail.querySelectorAll(".ore-qty, .oreQty, .adv-ore-qty, .qty, .pill-qty, .adv-ore-badge").forEach(el => el.remove());
  }

  function _scheduleApply(){
    if(_scheduled) return;
    _scheduled = true;
    _raf(() => {
      _scheduled = false;
      _applyAvailRules().catch(()=>{});
    });
  }

  function _sortedSignature(nodes){
    return nodes.map(n => _normKey(n?.dataset?.key)).join("|");
  }

  async function _applyAvailRules(){
    if(_isApplying) return;

    const avail = document.getElementById(ADV_AVAIL_ID);
    if(!avail) return;

    // Only run if we have items to work with
    const all = Array.from(avail.querySelectorAll("[data-key]"));
    if(!all.length) return;

    // Load dataset index once
    await _loadShipIndex();

    _removeQtyBadges(avail);

    // Filter non-minable via allowlist (hide to avoid mutation storms)
    const visible = [];
    for(const el of all){
      const key = _normKey(el.dataset.key);
      if(_shipAllow && !_shipAllow.has(key)){
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      visible.push(el);
    }

    if(!visible.length) return;

    // Sort by profitability (price/SCU desc). If no price map, fallback by label.
    const sorted = visible.slice().sort((a,b) => {
      const ak = _normKey(a.dataset.key);
      const bk = _normKey(b.dataset.key);

      const ap = _shipPrice ? (Number(_shipPrice.get(ak) || 0) || 0) : 0;
      const bp = _shipPrice ? (Number(_shipPrice.get(bk) || 0) || 0) : 0;

      if(ap !== bp) return bp - ap;

      const an = (a.textContent || "").trim();
      const bn = (b.textContent || "").trim();
      return an.localeCompare(bn, "fr", { sensitivity:"base" });
    });

    // Avoid doing work if order is already correct
    const sig = _sortedSignature(sorted);
    if(sig && sig === _lastSig) return;

    const current = _sortedSignature(visible);
    if(sig && sig === current){
      _lastSig = sig;
      return;
    }

    _lastSig = sig;

    // Reorder with observer temporarily disconnected (avoid self-trigger loops)
    _isApplying = true;
    try{
      if(_obs) _obs.disconnect();

      const frag = document.createDocumentFragment();
      sorted.forEach(el => frag.appendChild(el));
      avail.appendChild(frag);
    }finally{
      if(_obs){
        // Observe only direct child changes (subtree false) to reduce chatter
        _obs.observe(avail, { childList:true, subtree:false });
      }
      _isApplying = false;
    }
  }

  function _installObserver(){
    const avail = document.getElementById(ADV_AVAIL_ID);
    if(!avail) return false;

    if(_obs) return true;

    _obs = new MutationObserver(() => {
      if(_isApplying) return;
      _scheduleApply();
    });

    _obs.observe(avail, { childList:true, subtree:false });

    // First run
    _scheduleApply();
    return true;
  }

  // Intercept click: if already selected -> focus input instead of adding again.
  // If not selected -> allow default "add 1 SCU", then focus input after a short delay.
  document.addEventListener("click", (ev) => {
    const avail = document.getElementById(ADV_AVAIL_ID);
    if(!avail) return;

    const target = ev.target;
    if(!(target instanceof Element)) return;

    const btn = target.closest("[data-key]");
    if(!btn || !avail.contains(btn)) return;

    const key = _normKey(btn.dataset.key);

    // If selected already, block default add and focus input.
    const selected = btn.classList.contains("is-selected") || _isSelectedKey(key);
    if(selected){
      ev.preventDefault();
      ev.stopPropagation();
      _focusSelectedInput(key);
      return;
    }

    // Not selected: allow the internal handler to add 1 SCU, then focus.
    setTimeout(() => {
      _focusSelectedInput(key);
    }, 0);
  }, true);

  // Try install now, then retry a few times if DOM not ready yet.
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    if(_installObserver() || tries > 25){
      clearInterval(t);
    }
  }, 200);

})();

  // Live API endpoint config UI (optional)
  function initLiveApiEndpointUi(){
    const input = document.getElementById("miningApiBaseInput");
    const btnSave = document.getElementById("miningApiBaseSaveBtn");
    const btnTest = document.getElementById("miningApiBaseTestBtn");
    if (!input || !btnSave || !btnTest) return;

    const current = miningLiveGetApiBase();
    if (current) input.value = current;

    btnSave.addEventListener("click", ()=>{
      const v = miningLiveSetApiBase(input.value);
      input.value = v;
      miningLiveSetStatus(v ? `Live API: configuré (${v})` : "Live API: désactivé");
    });

    btnTest.addEventListener("click", async ()=>{
      const v = (input.value||"").trim();
      const baseUrl = v ? miningLiveSetApiBase(v) : miningLiveGetApiBase();
      if (!baseUrl){
        miningLiveSetStatus("Live API: endpoint manquant (configure ton worker).");
        return;
      }
      try{
        const testUrl = `${baseUrl}/health`;
        const r = await fetch(testUrl, { method: "GET", cache: "no-store" });
        if (r.ok){
          miningLiveSetStatus(`Live API: OK (${baseUrl})`);
        }else{
          miningLiveSetStatus(`Live API: réponse ${r.status} (${baseUrl})`);
        }
      }catch(e){
        miningLiveSetStatus(`Live API: échec réseau (${baseUrl}).`);
      }
    });
  }
