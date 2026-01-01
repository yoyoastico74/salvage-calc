/* assets/js/mining.js — Version V1.4.24
   Module: MINAGE (Mode Débutant) — Mega Package (suite)
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
    if (!Number.isFinite(n)) return "—";
    const v = Math.round(n);
    const sign = v > 0 ? "+" : "";
    return sign + v + "%";
  };

  const fmtMin = (min) => {
    if (!Number.isFinite(min) || min <= 0) return "—";
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

  let oreDataShip = null;
  let oreDataRoc = null;

  let selectedOreKeysShip = [];
  let selectedOreKeysRoc = [];
  let oreQtyByKeyShip = Object.create(null);
  let oreQtyByKeyRoc = Object.create(null);

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
      ? "1 mSCU = 0.001 SCU · 1 SCU = 1 000 mSCU"
      : "1 SCU = 1 000 mSCU · 1 mSCU = 0.001 SCU";
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
  async function loadOreDataShip(){
    if (oreDataShip) return oreDataShip;
    const res = await fetch(DATA_URL + "mining_ores_ship.json", { cache: "no-store" });
    if (!res.ok) {
      showDataErrorBanner("Dataset Ship introuvable. Vérifie /assets/data/mining_ores_ship.json");
      throw new Error("mining_ores_ship.json introuvable (" + res.status + ")");
    }
oreDataShip = await res.json();
    return oreDataShip;
  }

  async function loadOreDataRoc(){
    if (oreDataRoc) return oreDataRoc;
    const res = await fetch(DATA_URL + "mining_ores_roc.json", { cache: "no-store" });
    if (!res.ok) {
      showDataErrorBanner("Dataset ROC introuvable. Vérifie /assets/data/mining_ores_roc.json");
      throw new Error("mining_ores_roc.json introuvable (" + res.status + ")");
    }
oreDataRoc = await res.json();
    return oreDataRoc;
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
  }

  function toggleSelectedOreKey(key){
    const keys = getSelectedOreKeys();
    const idx = keys.indexOf(key);
    if (idx >= 0) {
      keys.splice(idx, 1);
      setSelectedOreKeys(keys);
      return { changed: true, action: "remove" };
    }
keys.push(key);
    setSelectedOreKeys(keys);
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
renderOreChips();
        compute();
      });

      elOreAvailList.appendChild(btn);
    });

    if (!elOreAvailList.children.length){
      elOreAvailList.innerHTML = "<div class=\"picker-empty\">—</div>";
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
      oreBtn.innerHTML = `<span class="ore-dot" aria-hidden="true"></span><span class="ore-name">${ore.name}</span>`;
      oreBtn.addEventListener("click", () => {
        toggleSelectedOreKey(ore.key);
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
        compute();
      });

      const price = document.createElement("div");
      price.className = "ore-price";
      price.textContent = "—";

      const subtotal = document.createElement("div");
      subtotal.className = "ore-subtotal";
      subtotal.textContent = "—";

      row.appendChild(oreBtn);
      row.appendChild(qty);
      row.appendChild(price);
      row.appendChild(subtotal);

      const rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "ore-remove-btn";
      rmBtn.title = "Retirer";
      rmBtn.setAttribute("aria-label", `Retirer ${ore.name}`);
      rmBtn.textContent = "×";
      rmBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleSelectedOreKey(ore.key);
        renderOreChips();
        compute();
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
      elOreCapHint.textContent = "Capacité : —";
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
      elOreCapHint.textContent = `Capacité : ${useMSCU ? fmtInt(capDisplay) + " mSCU" : capDisplay + " SCU"} — Dépassée`;
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
      if (elOreCapHint) elOreCapHint.textContent = "Capacité : —";
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
            if (elPrice) elPrice.textContent = (Number.isFinite(p) && p > 0) ? fmtInt(p) : "—";
            if (elSub) elSub.textContent = subtotal > 0 ? fmtInt(subtotal) : "—";
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

    let verdict = "—";
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
        const list = missing.slice(0, 3).join(", ") + (missing.length > 3 ? "…" : "");
        reason = `Prix indisponible pour : ${list}. Passe en Estimation ou mets à jour le dataset des prix.`;
      }
    }

    if (runValue > 0 && targetPerHour > 0) {
      if (profitHour >= targetPerHour * 1.25) {
        verdict = "EXCELLENT";
        verdictClass = "is-good";
        reason = `Ton run dépasse nettement ton objectif (≈ ${fmtInt(profitHour)} aUEC/h vs ${fmtInt(targetPerHour)}).`;
      } else if (profitHour >= targetPerHour * 0.85) {
        verdict = "ACCEPTABLE";
        verdictClass = "is-ok";
        reason = `Tu es proche de ton objectif (≈ ${fmtInt(profitHour)} aUEC/h vs ${fmtInt(targetPerHour)}).`;
      } else {
        verdict = "À ÉVITER";
        verdictClass = "is-bad";
        reason = `Sous ton objectif (≈ ${fmtInt(profitHour)} aUEC/h vs ${fmtInt(targetPerHour)}).`;
      }
    } else if (runValue > 0 && targetPerHour === 0) {
      verdict = "INFO";
      verdictClass = "is-ok";
      reason = `Objectif à 0 : profit estimé ≈ ${fmtInt(profitHour)} aUEC/h. Saisis un objectif pour un verdict.`;
    }

    if (elKpiTotal) elKpiTotal.textContent = runValue > 0 ? fmtInt(total) : "—";
    if (elKpiRun) elKpiRun.textContent = runValue > 0 ? fmtInt(profitRun) : "—";
    if (elKpiHour) elKpiHour.textContent = runValue > 0 ? fmtInt(profitHour) : "—";

    if (elKpiDelta) elKpiDelta.textContent = (runValue > 0 && targetPerHour > 0) ? fmtPct(deltaPct) : "—";
    if (elKpiTimeToTarget) {
      if (runValue > 0 && targetPerHour > 0 && Number.isFinite(timeToTargetMin)) elKpiTimeToTarget.textContent = fmtMin(timeToTargetMin);
      else elKpiTimeToTarget.textContent = "—";
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

    if (elSellersList) elSellersList.innerHTML = "";
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
            elSellersList.appendChild(row);
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
  }


  // ---------- Init ----------
  async function init(){

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

    initVersionFooter();

    resetAll();
  }

  init();

  // UEX live UI
  initUexUi();

})();

/* =========================================================
   UEX (live) integration — V1.3.0
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
  if(n === null || n === undefined || Number.isNaN(Number(n))) return "—";
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
  if(tEl) tEl.textContent = terminal || "—";
  if(pEl) pEl.textContent = uexFmt(price);
}

function uexDrawChart(items){
  // Live comparative chart (Top sellers) — items: [{ name, price }]
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

  legend.textContent = `Comparatif live (Top ${data.length}) • Min ${Math.round(minV)} — Max ${Math.round(maxV)} aUEC`;
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
    uexSetMetric("—", null);
    uexDrawChart([]);
    return;
  }

  const oreObj = (window.__miningGetSelectedOre ? window.__miningGetSelectedOre() : null);
  const oreName = oreObj && oreObj.name ? oreObj.name : "";
  if(!oreName){
    uexSetStatus("Sélectionne un minerai.");
    uexSetMetric("—", null);
    uexDrawChart([]);
    return;
  }

  try{
    uexSetStatus("Chargement…");
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
    uexSetMetric("—", null);
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
   Version footer (MINAGE) — Details toggle + fill
   ============================ */
function miningGetCssVar(name){
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace(/^"|"$/g, "");
  } catch(_) { return ""; }
}

function miningInitVersionFooter(){
  const bar = document.getElementById("miningVersionBar");
  const details = document.getElementById("miningVersionDetails");
  const closeBtn = document.getElementById("miningVersionCloseBtn");
  const cta = document.getElementById("miningVersionCta");
  const closedLabel = document.getElementById("miningVersionClosedLabel");
  if(!bar || !details || !cta || !closedLabel) return;

  const jsV = "V1.4.25";
  const cssV = "V1.3.29";
  const coreV = miningGetCssVar("--core-css-version") || "—";
  const dataV = (window.MINING_DATA_VERSION) ? String(window.MINING_DATA_VERSION) : "assets/data/*";

  const repo = location.pathname.split("/").filter(Boolean)[0] || "—";
  const page = location.pathname.split("/").slice(-1)[0] || "mining.html";
  const build = (location.search || "").replace(/^\?/, "") || "—";

  // Closed bar label exactly like Recyclage (adapted)
  closedLabel.textContent = `MINAGE ${jsV} · PU 4.5`;

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

document.addEventListener("DOMContentLoaded", () => {
  try { miningInitVersionFooter(); } catch(_) {}
});
