/* assets/js/ships.js — V1.2.27
   Module: VAISSEAUX (Ship Finder)
   Data source: UEX Proxy (Option B)
   -------------------------------------------------------
   - Loads ships list from Cloudflare Worker proxy (/ships)
   - Category filter (derived from UEX capability flags)
   - Autocomplete-like search list updates live
   - On selection: fetch /ship?id_vehicle=... to enrich:
       * IRL pledge price (vehicles_prices)
       * In-game buy prices + terminal locations (vehicles_purchases_prices)
*/

(() => {
  "use strict";

  // --- Configuration ---------------------------------------------------------
  const DEFAULT_PROXY = "https://uex-ships.yoyoastico74.workers.dev";
  const PROXY_BASE =
    (window.UEX_SHIPS_PROXY && String(window.UEX_SHIPS_PROXY).trim()) ||
    localStorage.getItem("UEX_SHIPS_PROXY") ||
    DEFAULT_PROXY;

  const ENDPOINT_SHIPS = `${PROXY_BASE.replace(/\/$/, "")}/ships`;
  const ENDPOINT_SHIP = `${PROXY_BASE.replace(/\/$/, "")}/ship`;

  // --- DOM -------------------------------------------------------------------
  const elQuery = document.getElementById("shipQuery");
  const elClear = document.getElementById("shipClear");
  const elMaker = document.getElementById("shipMaker");
  const elRole = document.getElementById("shipRole");
  const elResults = document.getElementById("shipResults");
  const elCard = document.getElementById("shipCard");
  const elSelectedBadge = document.getElementById("shipSelectedBadge");
  const elDbStatus = document.getElementById("shipsDbStatus");
  const elTvModule = document.getElementById("tvModuleShips");
  const elTvCore = document.getElementById("tvCoreShips");
  const elTvDb = document.getElementById("tvDbShips");

  if (!elQuery || !elClear || !elRole || !elResults || !elCard || !elDbStatus) {
    console.warn("[Ships] Missing required DOM nodes. Aborting.");
    return;
  }

  // --- State -----------------------------------------------------------------
  let ships = [];              // full list from proxy
  let filteredShips = [];      // results list
  let selectedShip = null;     // currently selected (from list)
  let lastDetailFetchId = 0;   // anti-race

  // --- Utils -----------------------------------------------------------------
  const safeText = (v) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
    if (typeof v === "string") {
      let s = v.trim();
      if (!s) return "—";
      // Prevent rendering of weird objects turned into strings
      if (s === "[object Object]" || s.includes("function Object()")) return "—";

      // Decode HTML entities if present (some sources may already contain &apos; etc.)
      if (s.includes("&") && typeof document !== "undefined") {
        try {
          const ta = document.createElement("textarea");
          // Some strings may require 2 decode passes (e.g., &amp;apos;)
          for (let i = 0; i < 2; i++) {
            const prev = s;
            ta.innerHTML = s;
            s = ta.value;
            if (s === prev) break;
          }
        } catch (e) {}
      }

      // Fix known corruption pattern: "Grey&apos;apos;s" -> "Grey's"
      s = s.replace(/'apos;/gi, "'");
      s = s.replace(/&apos;/gi, "'");

      // Normalize curly apostrophes just in case
      s = s.replace(/\u2019/g, "'").replace(/\u2018/g, "'");

      return s.trim() || "—";
    }
    // Avoid leaking object function bodies in UI
    return "—";
  };

  const fmtInt = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString("fr-FR");
  };

  const normalizeName = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  function deriveCategory(s) {
    // Single-role model (Erkul-style) — brand-first SAFE mapping
    // Priority:
    // 0) model overrides (exact / regex)
    // 1) brand rules (AEGIS/MIRAI etc.)
    // 2) explicit UEX flags
    // 3) keyword heuristics
    // 4) SCU fallback -> Freight (last)

    const rawName = String(s.name || "").trim();
    const n = normalizeName(rawName);
    const t = normalizeName(s.type);
    const makerRaw = safeText(s.manufacturer || s.manufacturer_name);
    const maker = normalizeName(makerRaw);
    const blob = `${n} ${t} ${maker}`;
    const scuNum = Number(s.scu ?? 0) || 0;

    // 0) ROLE_OVERRIDES (highest confidence)
    const ROLE_OVERRIDES = [
      [/(hercules.*a2)|(a2.*hercules)/, "Bomber"],
      [/avenger\s+stalker/, "Interceptor"],
      [/apollo.*(medivac|triage)/, "Medical"],
      [/cutlass.*red/, "Medical"],
      [/(c8r|pisces rescue)/, "Medical"],
      [/starfarer/, "Refuel"],
      [/mantis/, "Interdiction"],
      [/eclipse/, "Bomber"],
      [/retaliator/, "Bomber"],
    ];
    for (const [rx, role] of ROLE_OVERRIDES) {
      if (rx.test(blob)) return role;
    }

    // 1) BRAND_RULES (conservative per manufacturer)
    const match = (rx) => rx.test(blob);

    // MIRAI
    if (maker.includes("mirai")) {
      if (match(/pulse/)) return "Ground";
      if (match(/fury/)) return "Interceptor";
      if (match(/guardian/)) return "Combat";
      return "Combat";
    }

    // AEGIS
    if (maker.includes("aegis")) {
      if (match(/avenger\s+titan/)) return "Starter";
      if (match(/avenger\s+warlock/)) return "Interceptor";
      if (match(/avenger/)) return "Interceptor";

      if (match(/(gladius|sabre|vanguard|hammerhead)/)) return "Combat";
      if (match(/(retaliator|eclipse)/)) return "Bomber";
      if (match(/reclaimer/)) return "Salvage";

      return "Combat";
    }
    // DRAKE Interplanetary (brand-level)
    if (maker.includes("drake")) {
      // Starters / entry-level
      if (blob.includes("cutter")) return "Starter";

      // Cutlass family
      if (blob.includes("cutlass") && blob.includes("red")) return "Medical";
      if (blob.includes("cutlass") && blob.includes("blue")) return "Interdiction";
      if (blob.includes("cutlass") && blob.includes("steel")) return "Dropship";
      if (blob.includes("cutlass")) return "Freight";

      // Core lineup
      if (blob.includes("caterpillar")) return "Freight";
      if (blob.includes("corsair")) return "Exploration";
      if (blob.includes("vulture")) return "Salvage";
      if (blob.includes("buccaneer")) return "Interceptor";
      if (blob.includes("herald")) return "Data";

      // Ground / utility
      if (blob.includes("dragonfly")) return "Ground";

      // Capital / combat (conservative)
      if (blob.includes("kraken")) return "Combat";

      // Default DRAKE: Freight (brand skew) — better than Autre
      return "Freight";
    }


    // MISC (brand-level)
    if (maker.includes("misc") || maker.includes("musashi") || maker.includes("starflight")) {
      // Mining
      if (blob.includes("prospector")) return "Mining";
      if (blob.includes("mole")) return "Mining";
      if (blob.includes("expanse")) return "Mining";

      // Refuel (often MISC)
      if (blob.includes("starfarer")) return "Refuel";

      // Racing
      if (blob.includes("razor")) return "Racing";

      // Freight / Hauling
      if (blob.includes("freelancer")) return "Freight";
      if (blob.includes("hull")) return "Freight";
      if (blob.includes("rafter")) return "Freight";

      // Reliant family (conservative split)
      if (blob.includes("reliant") && blob.includes("tana")) return "Combat";
      if (blob.includes("reliant")) return "Freight";

      // Endeavor / science platform -> Support (no Science role in current taxonomy)
      if (blob.includes("endeavor")) return "Support";

      // Default MISC: Freight (brand skew) — better than Autre
      return "Freight";
    }



    
    // Crusader Industries (brand-level)
    if (maker.includes("crusader")) {
      // Hercules family
      if (blob.includes("hercules") && blob.includes("a2")) return "Bomber";
      if (blob.includes("hercules") && blob.includes("m2")) return "Combat";
      if (blob.includes("hercules") && blob.includes("c2")) return "Freight";

      // Spirit family
      if (blob.includes("spirit") && blob.includes("a1")) return "Bomber";
      if (blob.includes("spirit") && blob.includes("c1")) return "Freight";
      if (blob.includes("spirit") && blob.includes("e1")) return "Passenger";

      // Mercury Star Runner (data runner)
      if (blob.includes("mercury") || blob.includes("star runner") || blob.includes("msr")) return "Data";

      return "Freight";
    }


    // ORIGIN Jumpworks (brand-level)
    if (maker.includes("origin")) {
      // Starter line
      if (blob.includes("100i") || blob.includes("125a") || blob.includes("135c")) return "Starter";

      // 300 series: split by variant
      if (blob.includes("350r")) return "Racing";
      if (blob.includes("325a")) return "Combat";
      if (blob.includes("315p")) return "Exploration";
      if (blob.includes("300i")) return "Passenger";

      // 400/600/890: luxury touring (keep in Passenger)
      if (blob.includes("400i")) return "Passenger";
      if (blob.includes("600i")) return "Passenger";
      if (blob.includes("890")) return "Passenger";

      // M50: racing
      if (blob.includes("m50")) return "Racing";

      // Default Origin: Passenger (luxury skew)
      return "Passenger";
    }


    // ANVIL Aerospace (brand-level)
    if (maker.includes("anvil")) {
      // Fighters / interceptors
      if (blob.includes("arrow")) return "Interceptor";
      if (blob.includes("hawk")) return "Interceptor";

      // Combat
      if (blob.includes("hornet")) return "Combat";
      if (blob.includes("gladiator")) return "Bomber";

      // Dropship / transport
      if (blob.includes("valkyrie")) return "Dropship";

      // Exploration
      if (blob.includes("carrack")) return "Exploration";
      if (blob.includes("terrapin")) return "Exploration";

      // Freight
      if (blob.includes("c8") || blob.includes("pisces")) return "Starter";  // small shuttle often starter-tier
      if (blob.includes("crucible")) return "Support";

      // Default ANVIL: Combat
      return "Combat";
    }


    
    // RSI (Roberts Space Industries) (brand-level)
    if (maker.includes("roberts") || maker.includes("rsi")) {
      // Mining
      if (blob.includes("orion")) return "Mining";

      // Medical
      if (blob.includes("apollo") && (blob.includes("medivac") || blob.includes("triage"))) return "Medical";

      // Interdiction
      if (blob.includes("mantis")) return "Interdiction";

      // Constellation family (variant-specific)
      if (blob.includes("constellation") && blob.includes("andromeda")) return "Combat";      // Gunship
      if (blob.includes("constellation") && blob.includes("aquila")) return "Exploration";
      if (blob.includes("constellation") && blob.includes("phoenix")) return "Passenger";
      if (blob.includes("constellation") && blob.includes("taurus")) return "Freight";
      if (blob.includes("constellation")) return "Freight";

      // Ground
      if (blob.includes("ursa")) return "Ground";

      // Combat
      if (blob.includes("scorpius")) return "Combat";
      if (blob.includes("perseus")) return "Combat";

      // Capital / large
      if (blob.includes("polaris")) return "Combat";
      if (blob.includes("galaxy")) return "Freight";
      if (blob.includes("zeus")) return "Freight"; // conservative

      // Starter
      if (blob.includes("aurora")) return "Starter";

      // Default RSI
      return "Freight";
    }



    // SMALL BRANDS PACK (brand-level) — consolidated rules for low-volume manufacturers

    // ARGO Astronautics
    if (maker.includes("argo")) {
      if (blob.includes("srv")) return "Support";
      if (blob.includes("raft")) return "Freight";
      if (blob.includes("mole")) return "Mining"; // safeguard in case of mis-tag
      if (blob.includes("mpuv") && blob.includes("cargo")) return "Freight";
      if (blob.includes("mpuv")) return "Support"; // personnel/utility
      return "Freight";
    }

    // Consolidated Outland (CNOU)
    if (maker.includes("consolidated") || maker.includes("outland") || maker.includes("cnou")) {
      if (blob.includes("mustang")) return "Starter";
      if (blob.includes("nomad")) return "Freight";
      if (blob.includes("pioneer")) return "Freight";
      return "Starter";
    }

    // BANU
    if (maker.includes("banu")) {
      if (blob.includes("merchantman")) return "Freight";
      if (blob.includes("defender")) return "Combat";
      return "Freight";
    }

    // ESPERIA (Tevarin replicas)
    if (maker.includes("esperia")) {
      if (blob.includes("prowler")) return "Dropship";
      if (blob.includes("glaive") || blob.includes("blade")) return "Combat";
      return "Combat";
    }

    // GATAC (Xi'an)
    if (maker.includes("gatac")) {
      if (blob.includes("syulen")) return "Starter";
      if (blob.includes("railen")) return "Freight";
      return "Freight";
    }

    // AOPOA (Xi'an)
    if (maker.includes("aopoa")) {
      if (blob.includes("nox")) return "Ground";
      if (blob.includes("khartu") || blob.includes("kartu") || blob.includes("al")) return "Combat";
      return "Combat";
    }

    // GREYCAT Industrial
    if (maker.includes("greycat")) {
      if (blob.includes("roc")) return "Mining";
      return "Ground"; // PTV / STV / utility
    }

    // TUMBRIL Land Systems
    if (maker.includes("tumbril")) {
      return "Ground"; // Cyclone / Nova / Storm / etc.
    }

    // KRUGER Intergalactic
    if (maker.includes("kruger")) {
      if (blob.includes("p-72") || blob.includes("archimedes")) return "Interceptor";
      if (blob.includes("p-52") || blob.includes("merlin")) return "Interceptor";
      return "Interceptor";
    }

// 2) explicit UEX flags
    if (Number(s.is_ground) === 1) return "Ground";
    if (Number(s.is_mining) === 1) return "Mining";
    if (Number(s.is_salvage) === 1) return "Salvage";
    if (Number(s.is_combat) === 1) return "Combat";
    if (Number(s.is_exploration) === 1) return "Exploration";
    if (Number(s.is_freight) === 1) return "Freight";

    // 3) keyword heuristics
    if (/(medivac|triage|medical|ambulance|hospital)/.test(blob)) return "Medical";
    if (/(refuel|refuelling|tanker)/.test(blob)) return "Refuel";
    if (/(repair|rearm|support)/.test(blob)) return "Support";
    if (/(data)/.test(blob)) return "Data";
    if (/(passenger|touring|luxury)/.test(blob)) return "Passenger";
    if (/(racing|racer)/.test(blob)) return "Racing";
    if (/(dropship|drop ship|troop)/.test(blob)) return "Dropship";
    if (/(interdiction|interdict)/.test(blob)) return "Interdiction";
    if (/(bomber)/.test(blob)) return "Bomber";
    if (/(interceptor)/.test(blob)) return "Interceptor";

    if (blob.includes("mining") || blob.includes("miner")) return "Mining";
    if (blob.includes("salvage")) return "Salvage";
    if (blob.includes("exploration") || blob.includes("pathfinder") || blob.includes("expedition")) return "Exploration";
    if (blob.includes("cargo") || blob.includes("freight") || blob.includes("hauler")) return "Freight";
    if (blob.includes("fighter")) return "Combat";

    // 4) SCU fallback
    if (scuNum > 0) return "Freight";
    return "Autre";
  }

  function shipSubtitle(s) {
    const m = safeText(s.manufacturer);
    const role = safeText(s.category);
    const scu = fmtInt(s.scu ?? 0);
    return `${m} • ${role} • ${scu} SCU`;
  }

  function setDbStatus(text, isError = false) {
    elDbStatus.textContent = text;
    elDbStatus.classList.toggle("is-error", !!isError);
  }

  function setTechVersions() {
    if (elTvModule) elTvModule.textContent = "V1.2.26";
    // These are present in your layout; keep them if they exist
    if (elTvCore) elTvCore.textContent = (window.CORE_VERSION || elTvCore.textContent || "—");
    if (elTvDb) elTvDb.textContent = "UEX";
  }

  // --- Rendering --------------------------------------------------------------
  function renderResults(list) {
    elResults.innerHTML = "";
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "ship-empty";
      p.textContent = "Aucun résultat.";
      elResults.appendChild(p);
      return;
    }

    const frag = document.createDocumentFragment();
    list.slice(0, 80).forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ship-result";
      btn.dataset.idVehicle = String(s.id_vehicle);

      const title = document.createElement("div");
      title.className = "ship-result-title";
      title.textContent = safeText(s.name);

      const sub = document.createElement("div");
      sub.className = "ship-result-sub";
      sub.textContent = shipSubtitle(s);

      btn.appendChild(title);
      btn.appendChild(sub);

      btn.addEventListener("click", () => selectShipById(s.id_vehicle));
      frag.appendChild(btn);
    });

    elResults.appendChild(frag);
  }

  function renderEmptyCard() {
    elSelectedBadge.textContent = "Aucun vaisseau sélectionné";
    elCard.innerHTML = `
      <div class="ship-card-empty">
        Tape un nom, puis sélectionne un vaisseau.
      </div>
    `;
  }

  function renderCardBase(s) {
    const name = safeText(s.name);
    const category = safeText(s.category);

    elSelectedBadge.textContent = category ? `${name} • ${category}` : name;

    elCard.innerHTML = `
<div class="ship-grid">
        <div class="ship-kv"><div class="k">Constructeur</div><div class="v" id="shipKvManufacturer">${safeText(s.manufacturer)}</div></div>
        <div class="ship-kv"><div class="k">Rôle</div><div class="v" id="shipKvCategory">${category}</div></div>
        <div class="ship-kv"><div class="k">SCU</div><div class="v" id="shipKvScu">${fmtInt(s.scu ?? 0)}</div></div>

        <div class="ship-kv"><div class="k">Équipage (min / max)</div><div class="v" id="shipKvCrew">${crewText(s)}</div></div>

        <div class="ship-kv"><div class="k">Prix en jeu (aUEC)</div><div class="v" id="shipKvPriceIngame">—</div></div>
        <div class="ship-kv"><div class="k">Valeur IRL</div><div class="v" id="shipKvPriceIrl">—</div></div>
      </div>

      <div class="ship-sales">
        <div class="ship-sales-title">Emplacements de vente</div>
        <div class="ship-sales-list" id="shipSalesList">—</div>
      </div>
    `;
  }

  function crewText(s) {
    const min = s.crew_min;
    const max = s.crew_max;
    if (min === null && max === null) return "—";
    if (min !== null && max !== null) return `${fmtInt(min)} / ${fmtInt(max)}`;
    if (min !== null) return `${fmtInt(min)} / —`;
    return `— / ${fmtInt(max)}`;
  }

  function applyCardDetails(details) {
    if (!selectedShip) return;

    // IRL pledge store price
    const irl = details?.irl || null;
    const elIrl = document.getElementById("shipKvPriceIrl");
    if (elIrl) {
      if (irl && typeof irl.price !== "undefined" && irl.price !== null) {
        const currency = safeText(irl.currency || "USD");
        const price = Number(irl.price);
        elIrl.textContent = Number.isFinite(price) ? `${price.toFixed(0)} ${currency}` : "—";
      } else {
        elIrl.textContent = "—";
      }
    }

    // In-game prices + locations
    const ingame = Array.isArray(details?.ingame) ? details.ingame : [];
    const elIngame = document.getElementById("shipKvPriceIngame");
    const elSales = document.getElementById("shipSalesList");

    if (ingame.length) {
      // Compute a representative price: min of price_buy_min if available, else price_buy
      const prices = ingame
        .map((r) => Number(r.price_buy_min ?? r.price_buy))
        .filter((n) => Number.isFinite(n) && n > 0);

      const minPrice = prices.length ? Math.min(...prices) : null;
      if (elIngame) elIngame.textContent = minPrice ? fmtInt(minPrice) : "—";

      if (elSales) {
        const entries = ingame
          .map((r) => {
            const terminal = safeText(r.terminal_name);
            const city = safeText(r.city_name);
            const planet = safeText(r.planet_name || r.moon_name || r.space_station_name || r.orbit_name);
            const system = safeText(r.star_system_name);

            // Build a compact path: Terminal — City (Planet, System)
            const parts = [];
            if (city !== "—") parts.push(city);
            const place = [planet, system].filter((x) => x !== "—").join(", ");
            const placeText = place ? `(${place})` : "";
            const right = parts.length ? `${parts.join(" • ")} ${placeText}`.trim() : placeText;

            return {
              terminal,
              place: right || "—",
              price: Number(r.price_buy_min ?? r.price_buy) || 0,
            };
          })
          .filter((e) => (e.terminal && e.terminal !== "—") || (e.place && e.place !== "—"));

        // Sort by best (lowest) price first
        entries.sort((a, b) => (a.price || 0) - (b.price || 0));

        const maxLines = 6;
        const shown = entries.slice(0, maxLines);
        const more = entries.length - shown.length;

        elSales.innerHTML = "";
        const ul = document.createElement("ul");
        ul.className = "ship-sales-ul";

        shown.forEach((e) => {
          const li = document.createElement("li");

          const t = document.createElement("span");
          t.className = "sale-terminal";
          t.textContent = e.terminal && e.terminal !== "—" ? e.terminal : "Terminal";

          const p = document.createElement("span");
          p.className = "sale-place";
          p.textContent = e.place && e.place !== "—" ? e.place : "—";

          li.appendChild(t);
          li.appendChild(p);
          ul.appendChild(li);
        });

        elSales.appendChild(ul);

        if (more > 0) {
          const moreDiv = document.createElement("div");
          moreDiv.className = "ship-sales-more";
          moreDiv.textContent = `+${more} autres emplacements`;
          elSales.appendChild(moreDiv);
        }
      }
    } else {
      if (elIngame) elIngame.textContent = "—";
      if (elSales) elSales.textContent = "—";
    }
  }

  // --- Filtering --------------------------------------------------------------
  function applyFilters() {
    const q = normalizeName(elQuery.value);
    const cat = elRole.value || "__ALL__";
    const makerSel = (elMaker && elMaker.value) ? elMaker.value : "__ALL__";

    filteredShips = ships.filter((s) => {
      if (makerSel !== "__ALL__" && (s.manufacturer || "—") !== makerSel) return false;
      if (cat !== "__ALL__" && (s.category || "Autre") !== cat) return false;

      if (!q) return true;
      const hay = normalizeName(`${s.name} ${safeText(s.manufacturer)} ${s.type} ${s.category}`);
      return hay.includes(q);
    });

    renderResults(filteredShips);
  }

  function populateMakerSelect(){
    const makers = new Set();
    ships.forEach((s)=>makers.add(safeText(s.manufacturer)));
    const sorted = Array.from(makers).sort((a,b)=>a.localeCompare(b,"fr"));

    if (!elMaker) return;
    elMaker.innerHTML = "";
    const all = document.createElement("option");
    all.value="__ALL__";
    all.textContent="Tous les constructeurs";
    elMaker.appendChild(all);

    sorted.forEach((m)=>{
      const opt=document.createElement("option");
      opt.value=m;
      opt.textContent=m;
      elMaker.appendChild(opt);
    });
  }

function populateRoleSelect() {
    const roles = new Set();
    const makerSel = (elMaker && elMaker.value) ? elMaker.value : "__ALL__";

    ships.forEach((s) => {
      if (makerSel !== "__ALL__" && (s.manufacturer || "—") !== makerSel) return;
      roles.add((s.category || "Autre"));
    });

    const sorted = Array.from(roles).sort((a, b) => a.localeCompare(b, "fr"));

    elRole.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "__ALL__";
    optAll.textContent = "Tous les rôles";
    elRole.appendChild(optAll);

    sorted.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      elRole.appendChild(opt);
    });
  }

  // --- Selection --------------------------------------------------------------
  async function selectShipById(idVehicle) {
    const id = Number(idVehicle);
    const s = ships.find((x) => Number(x.id_vehicle) === id);
    if (!s) return;

    selectedShip = s;
    renderCardBase(s);

    const fetchId = ++lastDetailFetchId;

    try {
      const url = `${ENDPOINT_SHIP}?id_vehicle=${encodeURIComponent(id)}`;
      const resp = await fetch(url, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const details = await resp.json();

      // Ignore out-of-order responses
      if (fetchId !== lastDetailFetchId) return;

      applyCardDetails(details);
    } catch (e) {
      // Keep base card; just set placeholders
      if (fetchId !== lastDetailFetchId) return;
      applyCardDetails({ irl: null, ingame: null });
      console.warn("[Ships] ship details failed:", e);
    }
  }

  // --- Bootstrap --------------------------------------------------------------
  async function loadShips() {
    setTechVersions();
    setDbStatus("Chargement…", false);
    renderEmptyCard();

    try {
      const resp = await fetch(ENDPOINT_SHIPS, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      const list = Array.isArray(data?.ships) ? data.ships : [];

      ships = list
        .map((s) => ({
          id_vehicle: s.id_vehicle,
          name: s.name,
          manufacturer: safeText(s.manufacturer),
          type: s.type,
          scu: s.scu,
          crew_min: s.crew_min,
          crew_max: s.crew_max,
          is_mining: s.is_mining,
          is_salvage: s.is_salvage,
          is_freight: s.is_freight,
          is_combat: s.is_combat,
          is_ground: s.is_ground,
          is_exploration: s.is_exploration,
        }))
        .filter((s) => s.id_vehicle && s.name)
        .map((s) => ({ ...s, category: deriveCategory(s) }));

      setDbStatus(`DB : ${ships.length} vaisseaux`, false);
      populateMakerSelect();
      populateRoleSelect();
      applyFilters();

      // Auto-focus for speed
      elQuery.focus();
    } catch (e) {
      ships = [];
      setDbStatus("DB : Erreur", true);
      renderResults([]);
      renderEmptyCard();
      console.error("[Ships] DB load failed:", e);
    }
  }

  // Events
  elQuery.addEventListener("input", applyFilters);
  if (elMaker) {
    elMaker.addEventListener("change", () => {
      // Maker should immediately reduce results and the Role list
      populateRoleSelect();
      elRole.value = "__ALL__";
      applyFilters();
    });
  }
  elRole.addEventListener("change", applyFilters);

  elClear.addEventListener("click", () => {
    elQuery.value = "";
    elRole.value = "__ALL__";
    applyFilters();
    selectedShip = null;
    renderEmptyCard();
    elQuery.focus();
  });

  // Init
  loadShips();
})();
