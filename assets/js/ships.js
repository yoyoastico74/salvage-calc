/* assets/js/ships.js — V1.2.47_SPEED_MERGE_ZERO_FIX
   Module: VAISSEAUX (Ship Finder)
   Data source: UEX Proxy (Option B)

   - Loads ships list from Cloudflare Worker proxy (/ships)
   - Category filter (derived from UEX capability flags)
   - Autocomplete-like search list updates live
   - On selection: fetch /ship?id_vehicle=... to enrich:
       * IRL pledge price (vehicles_prices)
       * In-game buy prices + terminal locations (vehicles_purchases_prices)
*/

(() => {
  "use strict";

  // Build tag (debug/cache-bust)
  const BUILD_TAG = "V1.2.47_SPEED_MERGE_ZERO_FIX";

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
const elFilterConcepts = document.getElementById("filterConcepts");
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
  let lastLoadMs = null;
  let lastResultsCount = 0;
  const DB_SOURCE_LABEL = "UEX";


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

  const normalizeKey = (s) => normalizeName(String(s || "")).replace(/[^a-z0-9]+/g," ").trim();

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
      [/(\bhercules\b.*\ba2\b)|(\ba2\b.*\bhercules\b)/, "Bomber"],
      [/\bavenger\s+stalker\b/, "Interceptor"],
      [/\bapollo\b.*\b(medivac|triage)\b/, "Medical"],
      [/\bcutlass\b.*\bred\b/, "Medical"],
      [/\b(c8r|pisces rescue)\b/, "Medical"],
      [/\bstarfarer\b/, "Refuel"],
      [/\bmantis\b/, "Interdiction"],
      [/\beclipse\b/, "Bomber"],
      [/\bretaliator\b/, "Bomber"],
    ];
    for (const [rx, role] of ROLE_OVERRIDES) {
      if (rx.test(blob)) return role;
    }

    // 1) BRAND_RULES (conservative per manufacturer)
    const match = (rx) => rx.test(blob);

    // MIRAI
    if (maker.includes("mirai")) {
      if (match(/\bpulse\b/)) return "Ground";
      if (match(/\bfury\b/)) return "Interceptor";
      if (match(/\bguardian\b/)) return "Combat";
      return "Combat";
    }

    // AEGIS
    if (maker.includes("aegis")) {
      if (match(/\bavenger\s+titan\b/)) return "Starter";
      if (match(/\bavenger\s+warlock\b/)) return "Interceptor";
      if (match(/\bavenger\b/)) return "Interceptor";

      if (match(/\b(gladius|sabre|vanguard|hammerhead)\b/)) return "Combat";
      if (match(/\b(retaliator|eclipse)\b/)) return "Bomber";
      if (match(/\breclaimer\b/)) return "Salvage";

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
    if (/\b(medivac|triage|medical|ambulance|hospital)\b/.test(blob)) return "Medical";
    if (/\b(refuel|refuelling|tanker)\b/.test(blob)) return "Refuel";
    if (/\b(repair|rearm|support)\b/.test(blob)) return "Support";
    if (/\b(data)\b/.test(blob)) return "Data";
    if (/\b(passenger|touring|luxury)\b/.test(blob)) return "Passenger";
    if (/\b(racing|racer)\b/.test(blob)) return "Racing";
    if (/\b(dropship|drop ship|troop)\b/.test(blob)) return "Dropship";
    if (/\b(interdiction|interdict)\b/.test(blob)) return "Interdiction";
    if (/\b(bomber)\b/.test(blob)) return "Bomber";
    if (/\b(interceptor)\b/.test(blob)) return "Interceptor";

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
    return `${m} • ${role}`;
  }

  function setDbStatus(text, isError = false) {
  elDbStatus.textContent = text;
  elDbStatus.classList.toggle("is-error", !!isError);
}

function updateDbChip() {
  if (!elDbStatus) return;
  const db = ships.length || 0;
  const res = lastResultsCount || 0;
  const ms = (typeof lastLoadMs === "number" && Number.isFinite(lastLoadMs)) ? lastLoadMs : null;

  const parts = [`Source : ${DB_SOURCE_LABEL}`, `DB : ${db}` , `Résultats : ${res}`];
  if (ms !== null) parts.push(`Load : ${ms} ms`);
  setDbStatus(parts.join(" • "), false);
}

  function setTechVersions() {
    if (elTvModule) elTvModule.textContent = "V1.2.47_SPEED_MERGE_ZERO_FIX";
// These are present in your layout; keep them if they exist
    if (elTvCore) elTvCore.textContent = (window.CORE_VERSION || elTvCore.textContent || "—");
    if (elTvDb) elTvDb.textContent = "UEX (proxy)";
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
  const type = safeText(s.type);

  elSelectedBadge.textContent = category && category !== "—" ? `${name} • ${category}` : name;

  elCard.innerHTML = `
    <div class="ship-grid">
      <div class="ship-kv"><div class="k">Constructeur</div><div class="v" id="shipKvManufacturer">${safeText(s.manufacturer)}</div></div>
      <div class="ship-kv"><div class="k">Type</div><div class="v" id="shipKvType">${type}</div></div>
      <div class="ship-kv"><div class="k">SCU</div><div class="v" id="shipKvScu">${fmtInt(s.scu ?? 0)}</div></div>

      <div class="ship-kv"><div class="k">Équipage (min / max)</div><div class="v" id="shipKvCrew">${crewText(s)}</div></div>
      <div class="ship-kv"><div class="k">Armement</div><div class="v" id="shipKvArmament">—</div></div>
      <div class="ship-kv"><div class="k">Dimensions (L × l × h)</div><div class="v" id="shipKvDims">—</div></div>

      <div class="ship-kv"><div class="k">Masse</div><div class="v" id="shipKvMass">—</div></div>
      <div class="ship-kv"><div class="k">Vitesse (SCM / NAV)</div><div class="v" id="shipKvSpeed">—</div></div>
      <div class="ship-kv"><div class="k">Quantum (capable)</div><div class="v" id="shipKvQuantum">—</div></div>

      <div class="ship-kv"><div class="k">Carburant (H2 / QT)</div><div class="v" id="shipKvFuel">—</div></div>
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

  

  function normalizeSpeed(src) {
    const num = (v) => {
    // Robust parsing for numeric strings that may include spaces/commas (e.g. "1,234" or "1 234").
    if (v === null || typeof v === "undefined") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;

    const s0 = String(v).trim();
    if (!s0) return null;

    let s = s0.replace(/\u00A0/g, "");   // NBSP
    s = s.replace(/\s+/g, "");          // spaces

    // Handle common thousands/decimal formats:
    // - If both ',' and '.' exist, assume ',' are thousands separators.
    // - If only ',' exists and matches grouped thousands (1,234,567), treat as thousands; else treat as decimal comma.
    if (s.includes(",") && s.includes(".")) {
      s = s.replace(/,/g, "");
    } else if (s.includes(",") && !s.includes(".")) {
      if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
      else s = s.replace(",", ".");
    }

    s = s.replace(/_/g, ""); // underscores

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
    const scm = (() => { const v = num(src?.speed_scm ?? src?.scm_speed ?? src?.speed_scm_max ?? src?.scm); return (v !== null && v > 0) ? v : null; })();
  const boost = (() => { const v = num(src?.speed_boost ?? src?.boost_speed ?? src?.speed_boost_max ?? src?.boost); return (v !== null && v > 0) ? v : null; })();
  const max = (() => { const v = num(src?.speed_max ?? src?.max_speed ?? src?.top_speed ?? src?.speed); return (v !== null && v > 0) ? v : null; })();
    if (scm || boost) return `${scm ? fmtInt(scm) : "—"} / ${boost ? fmtInt(boost) : "—"} m/s`;
    if (max) return `${fmtInt(max)} m/s`;
    return "—";
  }

  function applyCardDetails(details) {
  if (!selectedShip) return;

  const elIrl = document.getElementById("shipKvPriceIrl");
  const elIngame = document.getElementById("shipKvPriceIngame");
  const elSales = document.getElementById("shipSalesList");

  // Specs fields
  const elDims = document.getElementById("shipKvDims");
  const elMass = document.getElementById("shipKvMass");
  const elFuel = document.getElementById("shipKvFuel");
  const elArm = document.getElementById("shipKvArmament");
  const elSpeed = document.getElementById("shipKvSpeed");
  const elQt = document.getElementById("shipKvQuantum");
// IRL pledge store price
  const irl = details?.irl || null;
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

  if (ingame.length) {
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

  // --- Specs (from worker /ship; can be at root or under `vehicle`) ----------
  const src = (details && typeof details === "object")
    ? (details.vehicle && typeof details.vehicle === "object" ? details.vehicle : details)
    : null;
  const enriched = (details && typeof details === "object" && details.enriched && typeof details.enriched === "object")
    ? details.enriched
    : null;

  // Build a merged source for speed extraction (enriched + base), without relying on undefined vars.
    // Prefer enrichment over UEX for speed fields (UEX frequently uses 0 when unknown).
  const speedSrc = { ...(src || {}), ...(enriched || {}), ...(enriched?.match || {}) };

  const num = (v) => {
    // Robust parsing for numeric strings that may include spaces/commas (e.g. "1,234" or "1 234").
    if (v === null || typeof v === "undefined") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;

    const s0 = String(v).trim();
    if (!s0) return null;

    let s = s0.replace(/\u00A0/g, "");   // NBSP
    s = s.replace(/\s+/g, "");          // spaces

    // Handle common thousands/decimal formats:
    // - If both ',' and '.' exist, assume ',' are thousands separators.
    // - If only ',' exists and matches grouped thousands (1,234,567), treat as thousands; else treat as decimal comma.
    if (s.includes(",") && s.includes(".")) {
      s = s.replace(/,/g, "");
    } else if (s.includes(",") && !s.includes(".")) {
      if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
      else s = s.replace(",", ".");
    }

    s = s.replace(/_/g, ""); // underscores

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };


  const pickPos = (primary, fallback) => {
  const p = num(primary);
  if (p !== null && p > 0) return p;
  const f = num(fallback);
  return (f !== null && f > 0) ? f : null;
}

function formatSpeedScmNav(speedObj){
  const scm = speedObj?.scm ?? null;
  const nav = speedObj?.max ?? null; // NAV max speed
  if (scm === null && nav === null) return "—";
  if (scm !== null && nav !== null) return `${Math.round(scm)} / ${Math.round(nav)} m/s`;
  if (scm !== null) return `${Math.round(scm)} / — m/s`;
  return `— / ${Math.round(nav)} m/s`;
}
;

  const len = pickPos(src?.length, enriched?.length ?? enriched?.match?.length);
  const wid = pickPos(src?.width,  enriched?.width  ?? enriched?.match?.width);
  const hei = pickPos(src?.height, enriched?.height ?? enriched?.match?.height);

  // UEX often provides 0 for "unknown" → treat as missing and fall back to enrichment sources.
  const mass = pickPos(src?.mass, enriched?.mass ?? enriched?.match?.mass);
  const h2   = pickPos(src?.fuel_hydrogen, enriched?.fuel_hydrogen ?? enriched?.match?.fuel_hydrogen);
  const qt   = pickPos(src?.fuel_quantum,  enriched?.fuel_quantum  ?? enriched?.match?.fuel_quantum);

  if (elDims) {
    if (len && wid && hei && len > 0 && wid > 0 && hei > 0) {
      const f = (x) => (Math.round(x * 10) / 10).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      elDims.textContent = `${f(len)} m × ${f(wid)} m × ${f(hei)} m`;
    } else {
      elDims.textContent = "—";
    }
  }

  if (elMass) {
    if (mass && mass > 0) {
      elMass.textContent = `${fmtInt(mass)} kg`;
    } else {
      elMass.textContent = "—";
    }
  }

  if (elFuel) {
    if ((h2 && h2 > 0) || (qt && qt > 0)) {
      elFuel.textContent = `${h2 && h2 > 0 ? fmtInt(h2) : "—"} / ${qt && qt > 0 ? fmtInt(qt) : "—"}`;
    } else {
      elFuel.textContent = "—";
    }
  }

  
  // --- Enrichment via proxy (specs + prices) ---------------------------------
if (elSpeed) {
    elSpeed.textContent = formatSpeedScmNav(normalizeSpeed(speedSrc));
  }

  // Armament + Quantum summary in KV grid

  if (elArm) { elArm.textContent = "—"; }

  if (elQt) {
    // Without base-loadout UI, keep Quantum field simple and readable.
    elQt.textContent = selectedShip && selectedShip.is_quantum_capable ? "Oui" : "Non";
  }

} // end applyCardDetails

  // --- Filtering -------------------------------------------------------------
  function applyFilters() {
    const q = normalizeKey(elQuery.value);
    const makerSel = elMaker ? String(elMaker.value || "").trim() : "";
    const roleSel = String(elRole.value || "").trim();


    const includeConcepts = !!(elFilterConcepts && elFilterConcepts.checked);
    filteredShips = ships.filter((s) => {
      if (!s) return false;

      // Flight-ready filter: by default we exclude concepts (UEX: is_concept = 1)
      if (!includeConcepts && Number(s.is_concept) === 1) return false;

      if (makerSel && makerSel !== "*" && safeText(s.manufacturer) !== makerSel) return false;
      if (roleSel && roleSel !== "*" && safeText(s.category) !== roleSel) return false;

      if (!q) return true;

      const name = normalizeKey(s.name);
      const maker = normalizeKey(s.manufacturer);
      const type = normalizeKey(s.type);
      return name.includes(q) || maker.includes(q) || type.includes(q);
    });

    lastResultsCount = filteredShips.length;
    updateDbChip();
    renderResults(filteredShips);
  }

  function populateMakerFilter() {
    if (!elMaker) return;

    const makers = Array.from(new Set(ships.map((s) => safeText(s.manufacturer)).filter((m) => m !== "—")))
      .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));

    elMaker.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "*";
    optAll.textContent = "Tous les constructeurs";
    elMaker.appendChild(optAll);

    makers.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      elMaker.appendChild(opt);
    });
  }

  function populateRoleFilter() {
    const roles = Array.from(new Set(ships.map((s) => safeText(s.category)).filter((r) => r !== "—")))
      .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));

    elRole.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "*";
    optAll.textContent = "Toutes les catégories";
    elRole.appendChild(optAll);

    roles.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      elRole.appendChild(opt);
    });
  }

  // --- Selection + Details ---------------------------------------------------
  async function selectShipById(idVehicle) {
    const id = String(idVehicle || "").trim();
    if (!id) return;

    const s = ships.find((x) => String(x.id_vehicle) === id);
    if (!s) return;

    selectedShip = s;

    // Ensure category is present (some upstream lists may not include it)
    if (!selectedShip.category || selectedShip.category === "—") {
      selectedShip.category = deriveCategory(selectedShip);
    }

    renderCardBase(selectedShip);

    // Fetch details (anti-race)
    const fetchId = ++lastDetailFetchId;
    const url = `${ENDPOINT_SHIP}?id_vehicle=${encodeURIComponent(id)}`;

    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const details = await r.json();

      if (fetchId !== lastDetailFetchId) return; // stale response
      applyCardDetails(details);
    } catch (e) {
      if (fetchId !== lastDetailFetchId) return;
      console.warn("[Ships] /ship failed:", e);
}
  }

  // --- Boot ------------------------------------------------------------------
  async function loadShips() {
    setTechVersions();
    renderEmptyCard();
    setDbStatus(`Chargement… (${DB_SOURCE_LABEL})`, false);

    const t0 = performance.now();
    try {
      const r = await fetch(ENDPOINT_SHIPS, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      ships = list
        .map((s) => {
          const o = Object.assign({}, s);
          // Normalize key fields expected by UI
          o.name = safeText(o.name);
          o.manufacturer = safeText(o.manufacturer || o.manufacturer_name);
          o.type = safeText(o.type);
          o.scu = Number(o.scu ?? 0) || 0;
          // Category derived deterministically (stable filter)
          o.category = deriveCategory(o);
          return o;
        })
        .filter((s) => s.name !== "—" && String(s.id_vehicle || "").trim() !== "");

      // sort by manufacturer then name (stable)
      ships.sort((a, b) => {
        const ma = safeText(a.manufacturer);
        const mb = safeText(b.manufacturer);
        const c = ma.localeCompare(mb, "fr", { sensitivity: "base" });
        if (c !== 0) return c;
        return safeText(a.name).localeCompare(safeText(b.name), "fr", { sensitivity: "base" });
      });

      lastLoadMs = Math.round(performance.now() - t0);
      lastResultsCount = ships.length;

      populateMakerFilter();
      populateRoleFilter();
      updateDbChip();

      applyFilters();
      setDbStatus(`OK • Source : ${DB_SOURCE_LABEL} • DB : ${ships.length}`, false);
    } catch (e) {
      console.error("[Ships] loadShips failed:", e);
      lastLoadMs = Math.round(performance.now() - t0);
      ships = [];
      filteredShips = [];
      lastResultsCount = 0;
      updateDbChip();
      renderResults([]);
      setDbStatus(`Erreur chargement DB (${DB_SOURCE_LABEL}) • ${safeText(e?.message)}`, true);
    }
  }

  // --- Events ----------------------------------------------------------------
  elQuery.addEventListener("input", () => applyFilters());

  elClear.addEventListener("click", () => {
    elQuery.value = "";
    elQuery.focus();
    applyFilters();
  });

  if (elMaker) elMaker.addEventListener("change", () => applyFilters());
  elRole.addEventListener("change", () => applyFilters());
  if (elFilterConcepts) elFilterConcepts.addEventListener("change", () => applyFilters());

  // Initial load
  loadShips();

})(); // end IIFE
