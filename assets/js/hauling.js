// assets/js/hauling.js — V1_4_2
// Mode Débutant : calcul instantané (sans UEX).
// Patch: Custom ship picker dropdown styled (RECYCLAGE-like), top actions grouping, beginner UX (objectif + presets + verdict) + persistence.

(function() {
  const $ = (id) => document.getElementById(id);

  // Tabs
  const tabBeginner = $("tabBeginner");
  const tabAdvanced = $("tabAdvanced");
  const panelBeginner = $("panelBeginner");
  const panelAdvanced = $("panelAdvanced");

  function setMode(mode) {
    const isBeginner = mode === "beginner";
    tabBeginner?.classList.toggle("is-active", isBeginner);
    tabAdvanced?.classList.toggle("is-active", !isBeginner);
    tabBeginner?.setAttribute("aria-selected", String(isBeginner));
    tabAdvanced?.setAttribute("aria-selected", String(!isBeginner));
    panelBeginner?.classList.toggle("is-hidden", !isBeginner);
    panelAdvanced?.classList.toggle("is-hidden", isBeginner);
  }

  tabBeginner?.addEventListener("click", () => setMode("beginner"));
  tabAdvanced?.addEventListener("click", () => setMode("advanced"));

  // Inputs
  const btnMaxScu = $("btnMaxScu");
  const cargoScu = $("cargoScu");
  const cargoType = $("cargoType");
  const loopMinutes = $("loopMinutes");
  const buyPrice = $("buyPrice");
  const sellPrice = $("sellPrice");
  const targetProfitHour = $("targetProfitHour");
    const riskBadgeEl = $("riskBadge");
  const btnReset = $("btnReset");

  // Presets minutes
  const presetButtons = Array.from(document.querySelectorAll(".btn-preset"));

  // Custom fields
  const customBox = $("customShipBox");
  const customName = $("customShipName");
  const customScu = $("customShipScu");

  // Picker UI
  const shipPickerBtn = $("shipPickerBtn");
  const shipPickerLabel = $("shipPickerLabel");
  const shipPickerMenu = $("shipPickerMenu");
  const cargoTypeSelect = $("cargoType");
  const cargoTypePickerBtn = $("cargoTypePickerBtn");
  const cargoTypePickerMenu = $("cargoTypePickerMenu");
  const cargoTypePickerLabel = $("cargoTypePickerLabel");

  // Badges / verdict
  const manualBadge = $("manualBadge");
  const statusChip = $("statusChip");
  const verdictText = $("verdictText");
  const cargoProfile = $("cargoProfile");
  const riskNote = $("riskNote");
  const verdictBox = document.querySelector(".verdict");

  // KPIs
  const kpiInvest = $("kpiInvest");
  const kpiRevenue = $("kpiRevenue");
  const kpiProfit = $("kpiProfit");
  const kpiProfitHour = $("kpiProfitHour");

  // Storage keys
  const LS_LAST_SHIP = "shog_sc_hauling_last_ship";
  const LS_CUSTOM_SHIP = "shog_sc_hauling_custom_ship";
  const LS_LAST_STATE = "shog_sc_hauling_last_state";
  const LS_SHIP_CACHE = "shog_sc_ship_cache_v1";
  const LS_SHIP_CACHE_TS = "shog_sc_ship_cache_ts_v1";

  // Ships dataset
  // - BASE_SHIPS: local cargo-capacity overrides (used for auto-fill cargo SCU)
  // - ALL_SHIPS: full list for dropdown (attempts to load from Star Citizen Wiki API; fallback to BASE list)
  //
  // Note: The external list is used for names/roles/manufacturers (not for prices).
  // If API fetch fails, the picker still works with the local list.

  const BASE_SHIPS = [
    // Common cargo-capable ships (SCU values are used only to auto-fill "Cargo (SCU)")
    { id: "AEGS_Avenger_Titan", name: "Avenger Titan", scu: 8, career: "Transporter", role: "Courier" },
    { id: "AEGS_Avenger_Titan_Renegade", name: "Avenger Titan Renegade", scu: 8, career: "Transporter", role: "Courier" },
    { id: "ORIG_135c", name: "135c", scu: 6, career: "Transporter", role: "Light Freight" },
    { id: "RSI_Aurora_CL", name: "Aurora CL", scu: 6, career: "Transporter", role: "Light Freight" },
    { id: "DRAK_Cutlass_Black", name: "Cutlass Black", scu: 46, career: "Multi-Role", role: "Light Freight / Medium Fighter" },
    { id: "MISC_Freelancer", name: "Freelancer", scu: 66, career: "Transporter", role: "Medium Freight" },
    { id: "MISC_Freelancer_MAX", name: "Freelancer MAX", scu: 120, career: "Transporter", role: "Medium Freight" },
    { id: "RSI_Constellation_Andromeda", name: "Constellation Andromeda", scu: 96, career: "Transporter", role: "Medium Freight" },
    { id: "RSI_Constellation_Taurus", name: "Constellation Taurus", scu: 174, career: "Transporter", role: "Medium Freight" },
    { id: "CRUS_Spirit_C1", name: "C1 Spirit", scu: 64, career: "Transporter", role: "Light Freight" },
    { id: "MISC_Hull_A", name: "Hull A", scu: 64, career: "Transporter", role: "Light Freight" },
    { id: "ARGO_RAFT", name: "RAFT", scu: 192, career: "Transporter", role: "Medium Freight" },
    { id: "MISC_Hull_B", name: "Hull B", scu: 384, career: "Transporter", role: "Heavy Freight" },
    { id: "MISC_Hull_C", name: "Hull C", scu: 4608, career: "Transporter", role: "Heavy Freight" },
    { id: "BNUG_Merchantman", name: "Merchantman", scu: 2880, career: "Transporter", role: "Heavy Freight" },
    { id: "DRAK_Caterpillar", name: "Caterpillar", scu: 576, career: "Transporter", role: "Transport" },
    { id: "CRUS_Hercules_C2", name: "C2 Hercules Starlifter", scu: 696, career: "Transporter", role: "Transport" },
    { id: "CRUS_Hercules_M2", name: "M2 Hercules Starlifter", scu: 522, career: "Transporter", role: "Transport" },
    { id: "CRUS_Hercules_A2", name: "A2 Hercules Starlifter", scu: 216, career: "Transporter", role: "Transport" },
    { id: "CRUS_Mercury_Star_Runner", name: "Mercury Star Runner", scu: 114, career: "Transporter", role: "Runner" },
    { id: "ANVL_Carrack", name: "Carrack", scu: 456, career: "Exploration", role: "Expedition" },
    { id: "ORIG_400i", name: "400i", scu: 42, career: "Exploration", role: "Touring" },
    { id: "ORIG_600i_Explorer", name: "600i Explorer", scu: 44, career: "Exploration", role: "Touring" },
    { id: "ORIG_890Jump", name: "890 Jump", scu: 388, career: "Touring", role: "Luxury" },
    { id: "AEGS_Reclaimer", name: "Reclaimer", scu: 420, career: "Industrial", role: "Heavy Salvage" },

    // "Custom" remains available for manual entries
  ];

  // Fast lookup for auto-fill cargo
  const CAP_BY_ID = new Map(BASE_SHIPS.map(s => [s.id, s.scu]));

async function loadAllShipsFromLocalJson() {
  // Preferred source for performance / no CORS:
  // Put a generated JSON file in: ../assets/data/ships_v2.json
  // Format: [{id,name,manufacturer,career,role,scu}]
  const LOCAL_URL = "../assets/data/ships_v2.json";
  try {
    const res = await fetch(LOCAL_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length < 100) throw new Error("invalid");
    ALL_SHIPS = arr;
    SHIP_SOURCE = "local-json";
    saveCachedShips(arr);
  } catch (e) {
    // ignore
  }
}

  // All ships shown in the dropdown (filled at runtime)
  let ALL_SHIPS = BASE_SHIPS.slice();
  let SHIP_SOURCE = "local"; // local | local-json | cache | api

  function loadCachedShips() {
    try {
      const ts = Number(localStorage.getItem(LS_SHIP_CACHE_TS) || 0);
      const ageH = (Date.now() - ts) / 36e5;
      if (!ts || ageH > 168) return; // 7 days
      const raw = localStorage.getItem(LS_SHIP_CACHE);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length < 100) return;
      ALL_SHIPS = arr;
      SHIP_SOURCE = "cache";
    } catch (e) {}
  }

  function saveCachedShips(list) {
    try {
      localStorage.setItem(LS_SHIP_CACHE, JSON.stringify(list));
      localStorage.setItem(LS_SHIP_CACHE_TS, String(Date.now()));
    } catch (e) {}
  }

  async function loadAllShipsFromWikiApi() {
  // Source of truth: Star-Citizen.wiki API v2 OpenAPI (Vehicles are served under /api/v3/* endpoints)
  // Docs: https://docs.star-citizen.wiki  (OpenAPI: https://api.star-citizen.wiki/api/v2/openapi)
  //
  // We fetch the paginated vehicle list (JSON) and build the dropdown list from it.
  // If it fails (CORS/network), we keep the local BASE_SHIPS list.

  const BASE_URL = "https://api.star-citizen.wiki";
  const ENDPOINT = "/api/v3/vehicles";
  const LIMIT = 200;           // keep requests low
  const MAX_PAGES = 50;        // safety stop
  const LOCALE = "en_EN";

  function normStr(v) { return typeof v === "string" ? v.trim() : ""; }

  function pickId(obj) {
    // Common fields across the API / variants
    return (
      normStr(obj?.class_name) ||
      normStr(obj?.className)  ||
      normStr(obj?.slug)       ||
      normStr(obj?.name)       ||
      normStr(obj?.uuid)       ||
      ""
    );
  }

  function pickName(obj) {
    return (
      normStr(obj?.name) ||
      normStr(obj?.title) ||
      normStr(obj?.label) ||
      ""
    );
  }

  function pickManufacturer(obj) {
    // sometimes nested (manufacturer.name) or flat
    return (
      normStr(obj?.manufacturer?.name) ||
      normStr(obj?.manufacturer) ||
      normStr(obj?.maker) ||
      ""
    );
  }

  function pickCareer(obj) {
    return (
      normStr(obj?.career) ||
      normStr(obj?.classification?.career) ||
      ""
    );
  }

  function pickRole(obj) {
    return (
      normStr(obj?.role) ||
      normStr(obj?.primary_role) ||
      normStr(obj?.classification?.role) ||
      ""
    );
  }

  function isGroundVehicle(career, role, name) {
    const c = (career || "").toLowerCase();
    const r = (role || "").toLowerCase();
    const n = (name || "").toLowerCase();
    // Keep ship-only by default
    return c === "ground" || r.includes("ground") || n.includes("tumbril") || n.includes("greycat") || n.includes("ptv") || n.includes("ursa") || n.includes("cyclone");
  }

  try {
    const merged = new Map();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE_URL}${ENDPOINT}?limit=${LIMIT}&page=${page}&locale=${encodeURIComponent(LOCALE)}`;

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const arr = await res.json();
      if (!Array.isArray(arr)) break;

      for (const raw of arr) {
        const id = pickId(raw);
        const name = pickName(raw);
        if (!id || !name) continue;

        const manufacturer = pickManufacturer(raw);
        const career = pickCareer(raw);
        const role = pickRole(raw);

        if (isGroundVehicle(career, role, name)) continue;

        const scu = CAP_BY_ID.get(id) ?? 0;
        merged.set(id, { id, name, manufacturer, career: career || "Autre", role, scu });
      }

      if (arr.length < LIMIT) break;
    }

    // Ensure base ships are present even if the API misses an item
    for (const s of BASE_SHIPS) {
      if (!merged.has(s.id)) merged.set(s.id, { ...s, manufacturer: s.manufacturer || "", career: s.career || "Autre", role: s.role || "", scu: s.scu || 0 });
    }

    const list = Array.from(merged.values());

    // Sort: Transporter first, then alpha by career, then name
    list.sort((a, b) => {
      if (a.career === "Transporter" && b.career !== "Transporter") return -1;
      if (b.career === "Transporter" && a.career !== "Transporter") return 1;
      return (a.career || "").localeCompare(b.career || "") || (a.name || "").localeCompare(b.name || "");
    });

    // Only accept if it looks real
    if (list.length > 100) ALL_SHIPS = list;
  } catch (e) {
    // Fallback: keep local list
  }
}
  function num(v, fallback=0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtInt(n) {
    return Math.round(n).toLocaleString("fr-FR");
  }

  function fmtShipLabel(ship) {
    return `${ship.name} — ${fmtInt(ship.scu)} SCU`;
  }

  let manualCargo = false;
  let selectedShipId = "CRUS_Spirit_C1";

  function setManual(on) {
    manualCargo = !!on;
    manualBadge?.classList.toggle("is-on", manualCargo);
  }

  function getShipById(id) {
    return ALL_SHIPS.find(s => s.id === id) || null;
  }

  function setCustomVisible(on) {
    customBox?.classList.toggle("is-hidden", !on);
  }

  function setCargoToCap(cap) {
    if (cargoScu) cargoScu.value = String(Math.max(0, num(cap, 0)));
      if (cargoType && s?.cargoType) cargoType.value = String(s.cargoType);
  }

  function getCustomFromStorage() {
    try {
      const raw = localStorage.getItem(LS_CUSTOM_SHIP);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const name = typeof data?.name === "string" ? data.name : "";
      const scu = Math.max(0, num(data?.scu, 0));
      return { name, scu };
    } catch (e) {
      return null;
    }
  }

  function saveCustomToStorage(name, scu) {
    try {
      localStorage.setItem(LS_CUSTOM_SHIP, JSON.stringify({
        name: String(name || ""),
        scu: Math.max(0, num(scu, 0))
      }));
    } catch (e) {}
  }

  function saveState() {
    try {
      localStorage.setItem(LS_LAST_STATE, JSON.stringify({
        cargoScu: num(cargoScu?.value, 0),
        cargoType: String(cargoType?.value || "standard"),
        loopMinutes: num(loopMinutes?.value, 25),
        buyPrice: num(buyPrice?.value, 0),
        sellPrice: num(sellPrice?.value, 0),
        targetProfitHour: num(targetProfitHour?.value, 80000)
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_LAST_STATE);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (cargoScu && Number.isFinite(Number(s?.cargoScu))) cargoScu.value = String(Math.max(0, num(s.cargoScu, 0)));
      if (loopMinutes && Number.isFinite(Number(s?.loopMinutes))) loopMinutes.value = String(Math.max(1, num(s.loopMinutes, 25)));
      if (buyPrice && s?.buyPrice !== undefined) buyPrice.value = String(Math.max(0, num(s.buyPrice, 1)));
      if (sellPrice && s?.sellPrice !== undefined) sellPrice.value = String(Math.max(0, num(s.sellPrice, 2)));
      if (targetProfitHour && s?.targetProfitHour !== undefined) targetProfitHour.value = String(Math.max(0, num(s.targetProfitHour, 80000)));
    } catch (e) {}
  }

  function setPickerOpen(open) {
    if (!shipPickerMenu || !shipPickerBtn) return;
    shipPickerMenu.classList.toggle("is-hidden", !open);
    shipPickerBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      const si = shipPickerMenu._searchInput;
      if (si) requestAnimationFrame(() => si.focus());
    }
  }

  function updatePickerLabel() {
    if (!shipPickerLabel) return;

    if (selectedShipId === "custom") {
      const c = getCustomFromStorage();
      const name = c?.name ? c.name : "Custom";
      const scu = c?.scu ?? 0;
      shipPickerLabel.textContent = `${name} — ${fmtInt(scu)} SCU`;
      return;
    }

    const ship = getShipById(selectedShipId);
    shipPickerLabel.textContent = ship ? fmtShipLabel(ship) : "—";
  }

  function applySelectedShipCapacity({ force=false } = {}) {
    const isCustom = selectedShipId === "custom";
    setCustomVisible(isCustom);

    if (isCustom) {
      const stored = getCustomFromStorage();
      const name = stored?.name ?? "";
      const scu = stored?.scu ?? 0;

      if (customName) customName.value = name;
      if (customScu) customScu.value = String(scu);

      if (!manualCargo || force) {
        setCargoToCap(scu);
        setManual(false);
      }
      return;
    }

    const ship = getShipById(selectedShipId);
    if (!ship) return;

    if (!manualCargo || force) {
      setCargoToCap(ship.scu);
      setManual(false);
    }
  }

  function computeVerdictMeta({ cargo, sell, profit, profitHour, target }) {
    // returns { text, tone } where tone in: bad, ok, good, great
    if (cargo === 0 || sell === 0) return { text: "—", tone: "" };
    if (profit < 0) return { text: "À éviter (perte)", tone: "bad" };
    if (target <= 0) {
      if (profitHour >= 150000) return { text: "Très rentable", tone: "great" };
      if (profitHour >= 80000) return { text: "Rentable", tone: "good" };
      return { text: "Acceptable", tone: "ok" };
    }
    if (profitHour >= target * 1.5) return { text: "Très rentable", tone: "great" };
    if (profitHour >= target) return { text: "Rentable (objectif atteint)", tone: "good" };
    if (profitHour >= target * 0.7) return { text: "Acceptable (proche objectif)", tone: "ok" };
    return { text: "À éviter (sous objectif)", tone: "bad" };
  }

  function computeVerdict({ cargo, sell, profit, profitHour, target }) {
    return computeVerdictMeta({ cargo, sell, profit, profitHour, target }).text;
  }

function setRiskBadgeVisible(visible){
  if (!riskBadgeEl) return;
  riskBadgeEl.classList.toggle("is-hidden", !visible);
}

function recalc() {
    const cargo = Math.max(0, num(cargoScu?.value, 0));
    const minutes = Math.max(1, num(loopMinutes?.value, 1));
    const buy = Math.max(0, num(buyPrice?.value, 0));
    const sell = Math.max(0, num(sellPrice?.value, 0));
    const target = Math.max(0, num(targetProfitHour?.value, 0));

    const invest = cargo * buy;
    const revenue = cargo * sell;
    const profit = revenue - invest;
    const profitHour = profit * (60 / minutes);

    if (kpiInvest) kpiInvest.textContent = `${fmtInt(invest)} aUEC`;
    if (kpiRevenue) kpiRevenue.textContent = `${fmtInt(revenue)} aUEC`;
    if (kpiProfit) kpiProfit.textContent = `${fmtInt(profit)} aUEC`;
    if (kpiProfitHour) kpiProfitHour.textContent = `${fmtInt(profitHour)} aUEC/h`;

    let status = "OK";
    if (cargo === 0 || sell === 0) status = "VIDE";
    else if (profit < 0) status = "MAUVAIS";
    else if (target > 0 && profitHour >= target) status = "TOP";
    else if (profitHour > 100000) status = "TOP";

    if (statusChip) statusChip.textContent = status;
    const v = computeVerdictMeta({ cargo, sell, profit, profitHour, target });
    if (verdictText) verdictText.textContent = v.text;
    if (verdictBox) {
      verdictBox.classList.remove("is-bad","is-ok","is-good","is-great");
      if (v.tone) verdictBox.classList.add(`is-${v.tone}`);
    }

    // Cargo profile line (no impact on numbers)
    if (cargoProfile && cargoType) {
      const ct = String(cargoType.value || "standard");
      if (ct === "highValue") cargoProfile.textContent = "Profil : Haute valeur";
      else if (ct === "risky") cargoProfile.textContent = "Profil : Risque élevé";
      else cargoProfile.textContent = "Profil : Standard";
    }

    // Single risk badge (beginner-friendly)
    if (riskNote) {
      const HIGH_INVEST_THRESHOLD = 150000;
      const LONG_LOOP_THRESHOLD = 45;
      const ct = String(cargoType?.value || "standard");
      const isRisk = (invest >= HIGH_INVEST_THRESHOLD) || (loopMin >= LONG_LOOP_THRESHOLD) || (ct === "risky");
      riskNote.classList.toggle("is-hidden", !isRisk);
    }

    saveState();
  }

function setCargoTypeMenuOpen(open) {
  if (!cargoTypePickerMenu || !cargoTypePickerBtn) return;
  cargoTypePickerMenu.classList.toggle("is-hidden", !open);
  cargoTypePickerBtn.setAttribute("aria-expanded", String(open));
}

function refreshCargoTypeActive() {
  if (!cargoTypePickerMenu || !cargoTypeSelect) return;
  const v = cargoTypeSelect.value;
  const items = Array.from(cargoTypePickerMenu.querySelectorAll(".ship-item"));
  items.forEach((el) => el.classList.toggle("is-active", el.dataset.value === v));
}

function initCargoTypePicker() {
  if (!cargoTypeSelect || !cargoTypePickerBtn || !cargoTypePickerMenu || !cargoTypePickerLabel) return;

  // Build menu from <select> options (single source of truth)
  cargoTypePickerMenu.innerHTML = "";
  const opts = Array.from(cargoTypeSelect.querySelectorAll("option"));
  opts.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ship-item";
    btn.dataset.value = opt.value;
    btn.setAttribute("role", "option");

    const left = document.createElement("span");
    left.textContent = opt.textContent || opt.value;
    btn.appendChild(left);

    btn.addEventListener("click", () => {
      cargoTypeSelect.value = opt.value;
      // trigger existing listeners (recalc/save)
      cargoTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      cargoTypePickerLabel.textContent = opt.textContent || opt.value;
      refreshCargoTypeActive();
      setCargoTypeMenuOpen(false);
    });

    cargoTypePickerMenu.appendChild(btn);
  });

  // Init label from current select value
  const current = cargoTypeSelect.querySelector(`option[value="${CSS.escape(cargoTypeSelect.value)}"]`);
  cargoTypePickerLabel.textContent = current?.textContent || "Standard";
  refreshCargoTypeActive();

  cargoTypePickerBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const open = cargoTypePickerMenu.classList.contains("is-hidden");
    setCargoTypeMenuOpen(open);
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    const t = e.target;
    const inside = cargoTypePickerMenu.contains(t) || cargoTypePickerBtn.contains(t);
    if (!inside) setCargoTypeMenuOpen(false);
  });

  // Keep UI synced if select changes via loadState or other code
  cargoTypeSelect.addEventListener("change", () => {
    const cur = cargoTypeSelect.querySelector(`option[value="${CSS.escape(cargoTypeSelect.value)}"]`);
    cargoTypePickerLabel.textContent = cur?.textContent || cargoTypeSelect.value;
    refreshCargoTypeActive();
  });
}

function buildPickerMenu() {
    if (!shipPickerMenu) return;
    shipPickerMenu.innerHTML = "";

    // Search box
    const searchWrap = document.createElement("div");
    searchWrap.className = "ship-search";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.autocomplete = "off";
    searchInput.placeholder = "Rechercher un vaisseau…";
    searchInput.setAttribute("aria-label", "Rechercher un vaisseau");
    searchWrap.appendChild(searchInput);
    const shipCount = document.createElement("div");
    shipCount.className = "ship-count";
    shipCount.textContent = `Chargé : ${ALL_SHIPS.length} vaisseaux`;
    searchWrap.appendChild(shipCount);
    shipPickerMenu.appendChild(searchWrap);

    const listWrap = document.createElement("div");
    shipPickerMenu.appendChild(listWrap);

    const byCareer = new Map();
    for (const s of ALL_SHIPS) {
      const key = s.career || "Autre";
      if (!byCareer.has(key)) byCareer.set(key, []);
      byCareer.get(key).push(s);
    }

    // Deterministic order: Transporter first (best for hauling), then others alpha
    const careers = Array.from(byCareer.keys());
    careers.sort((a,b) => {
      if (a === "Transporter") return -1;
      if (b === "Transporter") return 1;
      return a.localeCompare(b);
    });

    function renderList(filterText) {
      listWrap.innerHTML = "";
      const q = (filterText || "").trim().toLowerCase();

      let totalVisible = 0;

      careers.forEach((career) => {
        const ships = byCareer.get(career) || [];
        const filtered = !q ? ships : ships.filter(s => (s.name||"").toLowerCase().includes(q));

        if (!filtered.length) return;

        const title = document.createElement("div");
        title.className = "ship-group-title";
        title.textContent = career;
        listWrap.appendChild(title);

        filtered.forEach((ship) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ship-item";
          btn.setAttribute("role", "option");
          btn.dataset.id = ship.id;

          const left = document.createElement("span");
          left.textContent = ship.name;

          const right = document.createElement("span");
          right.className = "ship-item-scu";
          right.textContent = ship.scu > 0 ? `${fmtInt(ship.scu)} SCU` : "—";

          btn.appendChild(left);
          btn.appendChild(right);

          btn.addEventListener("click", () => {
            selectShip(ship.id);
            setPickerOpen(false);
          });

          listWrap.appendChild(btn);
          totalVisible += 1;
        });

        const div = document.createElement("div");
        div.className = "ship-divider";
        listWrap.appendChild(div);
      });

      // Custom always available (even with search)
      const customBtn = document.createElement("button");
      customBtn.type = "button";
      customBtn.className = "ship-item";
      customBtn.setAttribute("role", "option");
      customBtn.dataset.id = "custom";

      const left = document.createElement("span");
      left.textContent = "Custom";

      const right = document.createElement("span");
      right.className = "ship-item-scu";
      right.textContent = "saisie manuelle";

      customBtn.appendChild(left);
      customBtn.appendChild(right);

      customBtn.addEventListener("click", () => {
        selectShip("custom");
        setPickerOpen(false);
      });

      listWrap.appendChild(customBtn);

      refreshActiveItem();

      // Update counter
      const totalAll = ALL_SHIPS.length;
      shipCount.textContent = q ? `Résultats : ${totalVisible} / ${totalAll}` : `Chargé : ${totalAll} vaisseaux`;

      // Auto-focus search when menu opens
      requestAnimationFrame(() => searchInput.focus());
    }

    // initial render
    renderList("");

    // filter
    searchInput.addEventListener("input", () => {
      renderList(searchInput.value);
    });

    // keep a ref for other handlers
    shipPickerMenu._searchInput = searchInput;
  }

  function refreshActiveItem() {
    if (!shipPickerMenu) return;
    const items = Array.from(shipPickerMenu.querySelectorAll(".ship-item"));
    items.forEach((el) => {
      const id = el.getAttribute("data-id");
      el.classList.toggle("is-active", id === selectedShipId);
    });
  }

  function selectShip(id) {
    selectedShipId = id;
    try { localStorage.setItem(LS_LAST_SHIP, selectedShipId); } catch (e) {}

    updatePickerLabel();
    refreshActiveItem();
    applySelectedShipCapacity({ force: false });
    recalc();
  }

  function applyMaxScu() {
    applySelectedShipCapacity({ force: true });
    recalc();
  }

  // Events
  shipPickerBtn?.addEventListener("click", () => {
    const isOpen = shipPickerBtn.getAttribute("aria-expanded") === "true";
    setPickerOpen(!isOpen);
  });

  document.addEventListener("click", (e) => {
    if (!shipPickerMenu || !shipPickerBtn) return;
    const t = e.target;
    const inside = shipPickerBtn.contains(t) || shipPickerMenu.contains(t);
    if (!inside) setPickerOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setPickerOpen(false);
  });

  cargoScu?.addEventListener("input", () => {
    let cap = -1;

    if (selectedShipId === "custom") {
      cap = num(customScu?.value, -1);
    } else {
      const ship = getShipById(selectedShipId);
      cap = ship ? ship.scu : -1;
    }

    const cargo = num(cargoScu?.value, 0);
    setManual(cap >= 0 && cargo !== cap);
    recalc();
  });

  customScu?.addEventListener("input", () => {
    const scu = Math.max(0, num(customScu.value, 0));
    const name = String(customName?.value || "");
    saveCustomToStorage(name, scu);

    if (selectedShipId === "custom" && !manualCargo) {
      setCargoToCap(scu);
    }
    updatePickerLabel();
    recalc();
  });

  customName?.addEventListener("input", () => {
    const scu = Math.max(0, num(customScu?.value, 0));
    const name = String(customName.value || "");
    saveCustomToStorage(name, scu);
    updatePickerLabel();
  });

  [loopMinutes, buyPrice, sellPrice, targetProfitHour].forEach((el) =>
    el?.addEventListener("input", recalc)
  );
  cargoTypeSelect?.addEventListener("change", recalc);
  cargoType?.addEventListener("change", recalc);

  // Preset state: if user edits minutes manually, unset preset unless it matches one.
  loopMinutes?.addEventListener("input", () => {
    const m = Math.max(1, num(loopMinutes.value, 0));
    // if matches a preset, mark it; else clear all
    let matched = false;
    presetButtons.forEach((b) => {
      const bm = Math.max(1, num(b.getAttribute("data-min"), 0));
      const isMatch = bm === m;
      b.classList.toggle("is-active", isMatch);
      matched = matched || isMatch;
    });
    if (!matched) presetButtons.forEach((b) => b.classList.remove("is-active"));
  });

  function setActivePreset(minutes) {
    presetButtons.forEach((b) => {
      const bm = Math.max(1, num(b.getAttribute("data-min"), 0));
      b.classList.toggle("is-active", bm === minutes);
    });
  }

  presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = Math.max(1, num(btn.getAttribute("data-min"), 25));
      if (loopMinutes) loopMinutes.value = String(m);
      setActivePreset(m);
      recalc();
    });
  });

  btnMaxScu?.addEventListener("click", applyMaxScu);

  btnReset?.addEventListener("click", () => {
    selectedShipId = "CRUS_Spirit_C1";
    try { localStorage.setItem(LS_LAST_SHIP, selectedShipId); } catch (e) {}

    if (cargoScu) cargoScu.value = "64";
    if (cargoType) cargoType.value = "standard";
    if (loopMinutes) loopMinutes.value = "25";
    if (buyPrice) buyPrice.value = "1";
    if (sellPrice) sellPrice.value = "2";
    if (targetProfitHour) targetProfitHour.value = "80000";

    setManual(false);
    setCustomVisible(false);

    try { localStorage.removeItem(LS_LAST_STATE); } catch (e) {}

    updatePickerLabel();
    refreshActiveItem();
    applySelectedShipCapacity({ force: true });
    recalc();
  });

  // Init
  async function init() {
    setMode("beginner");
    setManual(false);

    // Use cache first (instant), then try local JSON (fast/no CORS), then refresh from API in background
    loadCachedShips();
    loadAllShipsFromLocalJson().then(() => {
      buildPickerMenu();
      updatePickerLabel();
      refreshActiveItem();
    });

    // Load last ship
    try {
      const last = localStorage.getItem(LS_LAST_SHIP);
      if (last && (last === "custom" || getShipById(last))) selectedShipId = last;
    } catch (e) {}

    buildPickerMenu();
    loadState();
    initCargoTypePicker();

    // Background refresh (does not block UI)
    loadAllShipsFromWikiApi().then(() => {
      // Rebuild menu with full list if it changed
      buildPickerMenu();
      updatePickerLabel();
      refreshActiveItem();
    });
    // Init preset highlight if minutes match
    if (loopMinutes) {
      const m = Math.max(1, num(loopMinutes.value, 0));
      setActivePreset(m);
    }
    updatePickerLabel();
    applySelectedShipCapacity({ force: true });
    recalc();
  }

  init();
})();
