/* salvage.js - Version V1.4.18b HOTFIX
   Objectif :
   - Corriger les erreurs JS (bind() cassé / await hors async / blocs hotfix incomplets)
   - Mode Avancé : garder uniquement "Où vendre maintenant (UEX)" (informatif) + graphique intact
   - Supprimer toute logique/boutons Appliquer/Copier (pas d'état de vente sélectionnée)
*/

(() => {
  "use strict";

  const LS_KEY  = "salvage.module.state.v1_4_18b";
  const CFG_KEY = "salvage.module.configs.v1_4_16";

  // Proxy Worker (UEX)
  const WORKER_URL = "https://salvage-uex-proxy.yoyoastico74.workers.dev/";

  const $ = (id) => document.getElementById(id);

  const num = (v) => {
    const x = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(x) ? x : 0;
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const fmt = (n) => `${Math.round(num(n)).toLocaleString("fr-FR")} aUEC`;
  const fmtH = (n) => `${Math.round(num(n)).toLocaleString("fr-FR")} aUEC/h`;

  function setText(id, v){ const el = $(id); if(el) el.textContent = v; }

  // ---------------------------------------------------------------------------
  // Presets & Ships
  // ---------------------------------------------------------------------------
  let begRefineMode = "refine"; // refine | sell
  let begRefineYield = 0.30;

  const SHIPS = [
    { id:"salvation", name:"Salvation", note:"Collecte très rapide.", beginner:{ loopMin:40, refineMode:"refine", refineYield:0.30 }, advanced:{ loopMin:40, feesPct:0, refineMode:"refine", refineYield:0.30 } },
    { id:"vulture_fortune", name:"Vulture / Fortune", note:"Collecte très rapide.", beginner:{ loopMin:55, refineMode:"refine", refineYield:0.30 }, advanced:{ loopMin:55, feesPct:0, refineMode:"refine", refineYield:0.30 } },
    { id:"reclaimer", name:"Reclaimer", note:"Équipage conseillé.", beginner:{ loopMin:60, refineMode:"refine", refineYield:0.15 }, advanced:{ loopMin:60, feesPct:0, refineMode:"refine", refineYield:0.15 } },
    { id:"custom", name:"Custom", note:"Tes propres valeurs." }
  ];

  function populateShips(){
    const sel = $("shipSelect");
    if(!sel) return;
    sel.innerHTML = "";
    for(const s of SHIPS){
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    }
  }

  function applyShipPreset(){
    const id = $("shipSelect")?.value || "custom";
    const ship = SHIPS.find(s => s.id === id) || SHIPS[SHIPS.length - 1];

    if($("shipNote")) $("shipNote").textContent = ship.note || "";

    if(ship.beginner?.loopMin && $("begLoopMinutes")) $("begLoopMinutes").value = String(ship.beginner.loopMin);
    if(ship.advanced?.loopMin && $("loopMinutes")) $("loopMinutes").value = String(ship.advanced.loopMin);
    if(ship.advanced?.feesPct != null && $("feesPct")) $("feesPct").value = String(ship.advanced.feesPct);

    const presetMode = ship.beginner?.refineMode || ship.advanced?.refineMode;
    const presetYield = ship.beginner?.refineYield ?? ship.advanced?.refineYield;

    if(presetMode && $("cmatRefineMode")) $("cmatRefineMode").value = presetMode;
    if(presetYield != null && $("cmatRefineYield")) {
      const y = Number(presetYield);
      $("cmatRefineYield").value = (Number.isFinite(y) && y <= 1.0) ? String(Math.round(y * 100)) : String(y);
    }

    // Badge profil (Débutant) – si présent dans le HTML
    const badge = $("shipProfileBadge");
    const meta = $("shipMetaHint");
    if(badge){
      badge.classList.remove("ship-badge-off","ship-badge-solo","ship-badge-stable","ship-badge-multi");
      let label = "—";
      let metaTxt = "Profil : —";

      if(id === "salvation"){
        label = "SOLO / RAPIDE";
        metaTxt = "Profil : boucle courte, collecte rapide";
        badge.classList.add("ship-badge-solo");
      } else if(id === "vulture_fortune"){
        label = "SOLO STABLE";
        metaTxt = "Profil : solo, rendement régulier";
        badge.classList.add("ship-badge-stable");
      } else if(id === "reclaimer"){
        label = "MULTI / LOGISTIQUE";
        metaTxt = "Profil : équipage conseillé, logistique lourde";
        badge.classList.add("ship-badge-multi");
      } else {
        label = "CUSTOM";
        metaTxt = "Profil : valeurs personnalisées";
        badge.classList.add("ship-badge-off");
      }

      badge.textContent = label;
      if(meta) meta.textContent = metaTxt;
    }

    calcBeginner();
    calcAdvanced();
  }

  // ---------------------------------------------------------------------------
  // Status thresholds
  // ---------------------------------------------------------------------------
  function thresholds(){
    const ok = num($("thrOk")?.value);
    const good = num($("thrGood")?.value);
    return { ok: Math.min(ok, good), good: Math.max(ok, good) };
  }

  function setStatus(el, perHour){
    if(!el) return;
    const v = num(perHour);
    const { ok, good } = thresholds();

    el.classList.remove("status-off","status-bad","status-ok","status-good");

    if(v <= 0){
      el.textContent = "—";
      el.classList.add("status-off");
      return;
    }
    if(v >= good){
      el.textContent = "BON";
      el.classList.add("status-good");
      return;
    }
    if(v >= ok){
      el.textContent = "OK";
      el.classList.add("status-ok");
      return;
    }
    el.textContent = "FAIBLE";
    el.classList.add("status-bad");
  }

  // ---------------------------------------------------------------------------
  // Calculs
  // ---------------------------------------------------------------------------
  function calcBeginner(){
    const scuR = num($("scuRmc")?.value);
    const scuC = num($("scuCmat")?.value);
    const pR = num($("priceRmc")?.value);
    const pC = num($("priceCmat")?.value);
    const loopMin = clamp(num($("begLoopMinutes")?.value), 1, 9999);

    const vR = scuR * pR;

    let vC = scuC * pC;
    if(begRefineMode === "refine") vC = vC * begRefineYield;

    const total = vR + vC;
    const hours = loopMin / 60;
    const perHour = hours > 0 ? total / hours : 0;

    setText("outRmc", fmt(vR));
    setText("outCmat", fmt(vC));
    setText("outTotal", fmt(total));
    setText("outPerHour", fmtH(perHour));
    setText("outPerHourBig", fmtH(perHour));
    setStatus($("outStatus"), perHour);

    persist();
  }

  function calcAdvanced(){
    const scuR = num($("advScuRmc")?.value);
    const scuC = num($("advScuCmat")?.value);
    const pR = num($("advPriceRmc")?.value);
    const pC = num($("advPriceCmat")?.value);

    const feesPct = clamp(num($("feesPct")?.value), 0, 100);
    const loopMin = clamp(num($("loopMinutes")?.value), 1, 9999);

    const mode = $("cmatRefineMode")?.value || "sell";
    const yieldInput = clamp(num($("cmatRefineYield")?.value), 0, 100);
    const yieldFactor = (yieldInput <= 1.0) ? yieldInput : (yieldInput / 100);

    const vR = scuR * pR;
    let vC = scuC * pC;
    if(mode === "refine") vC = vC * yieldFactor;

    const gross = vR + vC;
    const net = gross * (1 - feesPct / 100);

    const hours = loopMin / 60;
    const perHour = hours > 0 ? net / hours : 0;

    setText("advValRmc", fmt(vR));
    setText("advValCmat", fmt(vC));
    setText("advGross", fmt(gross));
    setText("advNet", fmt(net));
    setText("advPerHour", fmtH(perHour));

    setText("sumNet", fmt(net));
    setText("sumHours", hours.toFixed(2) + " h");
    setText("sumPerHour", fmtH(perHour));
    setStatus($("sumStatus"), perHour);

    const rb = $("refineBlock");
    if(rb) rb.style.display = (mode === "refine") ? "" : "none";

    persist();
  }

  // ---------------------------------------------------------------------------
  // UEX helpers (best sales + history)
  // ---------------------------------------------------------------------------
  function extractPrice(o){
    if(!o || typeof o !== "object") return 0;
    return num(
      o.sell ?? o.sell_price ?? o.sellPrice ?? o.sell_per_unit ?? o.sellPerUnit ??
      o.sell_per_scu ?? o.sellPerScu ?? o.sell_price_per_scu ?? o.sellPricePerScu ??
      o.unit_price ?? o.unitPrice ?? o.unitPricePerScu ?? o.unit_price_per_scu ??
      o.price ?? o.value ?? o.last ?? o.latest ?? 0
    );
  }

  function pickFirst(it, keys){
    for(const k of keys){
      const v = it?.[k];
      if(v == null) continue;
      const s = String(v).trim();
      if(s) return s;
    }
    return "";
  }

  function formatSalePoint(it){
    const terminal = pickFirst(it, ["name","terminal","terminalName","terminal_name","station","stationName","station_name","port","outpost"]);
    const planet   = pickFirst(it, ["location","location_name","planet","planetName","planet_name","body","body_name","system","system_name"]);
    const zone     = pickFirst(it, ["zone","zoneName","zone_name","area","area_name"]);
    const parts = [terminal, zone, planet].filter(Boolean);
    return parts.length ? parts.join(" • ") : "—";
  }

  function avgHistoryPrice(arr){
    const xs = (Array.isArray(arr) ? arr : []).map(extractPrice).filter(v => Number.isFinite(v) && v > 0);
    if(xs.length === 0) return null;
    return xs.reduce((a,b)=>a+b,0) / xs.length;
  }

  function formatDeltaPct(best, avg){
    if(!Number.isFinite(best) || !Number.isFinite(avg) || avg <= 0) return "";
    const pct = ((best - avg) / avg) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}% vs moy.`;
  }

  let lastUexPayload = null;
  let lastBestRmcItem = null;
  let lastBestCmatItem = null;

  function setBestSalesFromUex(data){
    // Robust extraction: Worker payloads can change field names.
    function pickBestFromArray(arr){
      let best = null;
      let bestP = 0;
      for(const it of (Array.isArray(arr) ? arr : [])){
        const p = extractPrice(it);
        if(Number.isFinite(p) && p > bestP){
          bestP = p;
          best = it;
        }
      }
      return best;
    }

    function resolveBest(node){
      if(!node) return null;

      // Direct object candidates
      const direct =
        (node.bestTerminal ?? node.best_terminal ?? node.best ?? node.bestSale ?? node.best_sale ??
         node.bestPoint ?? node.best_point ?? node.best_location ?? null);

      if(direct && typeof direct === "object") return direct;

      // Array candidates (naming variants)
      const arr =
        (node.topTerminals ?? node.top_terminals ?? node.bestTerminals ?? node.best_terminals ??
         node.topSales ?? node.top_sales ?? node.top ?? node.terminals ?? node.points ??
         node.sellPoints ?? node.sell_points ?? node.sellZones ?? node.sell_zones ?? null);

      if(Array.isArray(arr) && arr.length){
        // Prefer highest sell price if present
        return pickBestFromArray(arr) || arr[0];
      }

      // Sometimes the commodity node is itself an array
      if(Array.isArray(node) && node.length){
        return pickBestFromArray(node) || node[0];
      }

      // Fallback: try to infer from history entries if they include location fields
      const hist = node.history;
      if(Array.isArray(hist) && hist.length){
        // If history items carry terminal/location fields + price, pick best
        return pickBestFromArray(hist);
      }

      return null;
    }

    const rNode = data?.rmc ?? data?.RMC ?? null;
    const cNode = data?.cmat ?? data?.CMAT ?? null;

    lastBestRmcItem  = resolveBest(rNode);
    lastBestCmatItem = resolveBest(cNode);

    const rPlace = $("advBestRmcSale");
    const cPlace = $("advBestCmatSale");
    const rMeta  = $("advBestRmcMeta");
    const cMeta  = $("advBestCmatMeta");

    if(rPlace) rPlace.textContent = lastBestRmcItem ? formatSalePoint(lastBestRmcItem) : "—";
    if(cPlace) cPlace.textContent = lastBestCmatItem ? formatSalePoint(lastBestCmatItem) : "—";

    const rBest = lastBestRmcItem ? extractPrice(lastBestRmcItem) : null;
    const cBest = lastBestCmatItem ? extractPrice(lastBestCmatItem) : null;

    const rAvg = avgHistoryPrice(rNode?.history);
    const cAvg = avgHistoryPrice(cNode?.history);

    // Meta lines (delta vs avg)
    if(rMeta) rMeta.textContent = (Number.isFinite(rBest) && Number.isFinite(rAvg)) ? formatDeltaPct(rBest, rAvg) : "—";
    if(cMeta) cMeta.textContent = (Number.isFinite(cBest) && Number.isFinite(cAvg)) ? formatDeltaPct(cBest, cAvg) : "—";
  }

  function computeTrendLabel(history){
    const arr = Array.isArray(history) ? history : [];
    if(arr.length < 2) return { arrow: "—", label: "—", dir: 0 };
    const first = extractPrice(arr[0]);
    const last  = extractPrice(arr[arr.length - 1]);
    if(!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return { arrow: "—", label: "—", dir: 0 };

    const pct = ((last - first) / first) * 100;
    // Seuil "stable" volontairement large pour éviter les faux signaux
    if(Math.abs(pct) < 1.5) return { arrow: "→", label: "stable", dir: 0 };
    if(pct > 0) return { arrow: "↑", label: "haussier", dir: 1 };
    return { arrow: "↓", label: "baissier", dir: -1 };
  }

  function updateMarketInsight(data){
    const cEl = $("advMarketCmat");
    const rEl = $("advMarketRmc");
    const mEl = $("advMarketMoment");
    if(!cEl && !rEl && !mEl) return;

    if(!data){
      if(cEl) cEl.textContent = "—";
      if(rEl) rEl.textContent = "—";
      if(mEl) mEl.textContent = "—";
      return;
    }

    const c = computeTrendLabel(data?.cmat?.history);
    const r = computeTrendLabel(data?.rmc?.history);

    if(cEl) cEl.textContent = `${c.arrow} ${c.label}`;
    if(rEl) rEl.textContent = `${r.arrow} ${r.label}`;

    // Moment de vendre (simple, lisible) :
    // - BON : CMAT monte et RMC ne baisse pas, ou les deux montent
    // - FAIBLE : les deux baissent
    // - OK : cas mixtes / incertains
    let moment = "OK";
    if(c.dir === -1 && r.dir === -1) moment = "FAIBLE";
    else if(c.dir === 1 && r.dir >= 0) moment = "BON";
    else if(c.dir === 0 && r.dir === 1) moment = "BON";
    else if(c.dir === 0 && r.dir === 0) moment = "OK";

    // Affichage demandé : "Moment de vendre : OUI / NON"
    // Règle simple : BON ou OK => OUI ; FAIBLE => NON
    const sellNow = (moment === "FAIBLE") ? "NON" : "OUI";
    if(mEl) mEl.textContent = sellNow;
  
    // V2 (sobre) : justification courte sous "Vendre maintenant"
    const jEl = document.getElementById("marketJustification");
    if(jEl){
      let j = "";
      if(sellNow === "OUI"){
        if(c.dir === 1 && r.dir >= 0) j = "CMAT favorable (hausse / stable)";
        else if(r.dir === 1 && c.dir >= 0) j = "RMC favorable (hausse / stable)";
        else if(c.dir === 1) j = "CMAT en hausse";
        else if(r.dir === 1) j = "RMC en hausse";
        else j = "Prix corrects actuellement";
      } else {
        if(c.dir !== r.dir) j = "Marché instable (signaux mixtes)";
        else j = "Marché peu favorable";
      }
      jEl.textContent = j;
    }
}


  // ---------------------------------------------------------------------------
  // UEX status lines
  // ---------------------------------------------------------------------------
  function setUexLine(which, ok, msg){
    const id = which === "adv" ? "uexStatusLineAdv" : "uexStatusLine";
    const el = $(id);
    if(!el) return;
    el.textContent = msg;
    el.style.opacity = ok ? "1" : "0.85";
  }

  function setUexUpdated(ts){
    const el = $("uexLastUpdate");
    if(!el) return;
    if(!ts){ el.textContent = "Dernière MAJ UEX : —"; return; }
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    el.textContent = `Dernière MAJ UEX : ${hh}:${mm}`;
  }

  function setUexLock(isOn){
    const badge = $("uexLockBadge");
    const wrap = $("priceRmc")?.closest(".form-row");
    if(badge) badge.style.display = isOn ? "inline-flex" : "none";
    if(wrap) wrap.classList.toggle("uex-locked", !!isOn);
  }

  // ---------------------------------------------------------------------------
  // Chart (kept intact)
  // ---------------------------------------------------------------------------
  let lastChartPoints = null;

  function extractSeries(historyArr){
    if(!Array.isArray(historyArr)) return [];
    const out = [];
    for(const it of historyArr){
      if(!it) continue;
      const v = (it.sell != null) ? Number(it.sell) : ((it.price != null) ? Number(it.price) : NaN);
      if(!Number.isFinite(v)) continue;
      out.push({ v });
    }
    return out;
  }

  function fmtNum(n){
    try { return Intl.NumberFormat("fr-FR").format(Math.round(n)); } catch(_) { return String(Math.round(n)); }
  }

  function renderAdvPriceHistoryChart(payload){
    const canvas = $("advPriceHistoryChart");
    const status = $("advChartStatus");
    if(!canvas) return;

    const rmc = payload?.rmc ? extractSeries(payload.rmc.history) : [];
    const cmat = payload?.cmat ? extractSeries(payload.cmat.history) : [];

    if(status){
      const rN = rmc.length, cN = cmat.length;
      status.textContent = (rN || cN) ? `RMC: ${rN} points • CMAT: ${cN} points` : "Aucune donnée d’historique.";
    }

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 260;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle = "rgba(0,0,0,.08)";
    ctx.fillRect(0,0,cssW,cssH);

    const padL = 46, padR = 14, padT = 14, padB = 28;
    const W = cssW - padL - padR;
    const H = cssH - padT - padB;

    const all = [...rmc.map(x=>x.v), ...cmat.map(x=>x.v)];
    if(all.length === 0){
      lastChartPoints = null;
      ctx.strokeStyle = "rgba(231,236,255,.12)";
      ctx.beginPath();
      ctx.moveTo(padL, padT + H/2);
      ctx.lineTo(padL + W, padT + H/2);
      ctx.stroke();
      return;
    }

    let vMin = Math.min(...all);
    let vMax = Math.max(...all);
    if(vMin === vMax){ vMin = vMin * 0.95; vMax = vMax * 1.05; }

    function yScale(v){
      const t = (v - vMin) / (vMax - vMin);
      return padT + (1 - t) * H;
    }

    // grid (3 ticks)
    ctx.strokeStyle = "rgba(231,236,255,.10)";
    ctx.fillStyle = "rgba(231,236,255,.55)";
    ctx.lineWidth = 1;
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

    for(let i=0;i<3;i++){
      const tt = i/2;
      const v = vMax - tt*(vMax-vMin);
      const y = yScale(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + W, y);
      ctx.stroke();
      ctx.fillText(fmtNum(v), 8, y + 4);
    }

    function drawSeries(series, strokeStyle){
      if(series.length < 2) return;
      const n = series.length;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for(let i=0;i<n;i++){
        const x = padL + (i/(n-1))*W;
        const y = yScale(series[i].v);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();

      ctx.fillStyle = strokeStyle;
      for(let i=0;i<n;i++){
        const x = padL + (i/(n-1))*W;
        const y = yScale(series[i].v);
        ctx.beginPath();
        ctx.arc(x,y,2.2,0,Math.PI*2);
        ctx.fill();
      }
    }

    drawSeries(rmc, "rgba(0,229,255,.92)");
    drawSeries(cmat, "rgba(231,236,255,.85)");

    ctx.strokeStyle = "rgba(231,236,255,.14)";
    ctx.beginPath();
    ctx.moveTo(padL, padT + H);
    ctx.lineTo(padL + W, padT + H);
    ctx.stroke();

    lastChartPoints = { padL, padT, W, H, vMin, vMax, rmc, cmat };
  }

  
  // ---------------------------------------------------------------------------
  // Beginner: Top ventes (UEX) - Top 3 RMC / CMAT
  // ---------------------------------------------------------------------------
  function escHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
    }[c]));
  }

  function renderBeginnerTopSales(payload){
    const elR = $("topRmc");
    const elC = $("topCmat");
    if(!elR && !elC) return;

    const rArr = Array.isArray(payload?.rmc?.topTerminals) ? payload.rmc.topTerminals : [];
    const cArr = Array.isArray(payload?.cmat?.topTerminals) ? payload.cmat.topTerminals : [];

    const render = (arr) => {
      const top = arr.slice(0,3);
      if(!top.length) return `<div class="top-sales-empty">—</div>`;
      return top.map((it) => {
        const name = escHtml(it?.name || "—");
        const loc  = escHtml(it?.location || "");
        const sell = (typeof it?.sell === "number") ? Math.round(it.sell).toLocaleString("fr-FR") : "—";
        const locPart = loc ? ` <span class="top-sales-loc">(${loc})</span>` : "";
        return `<div class="top-sales-item"><span class="top-sales-term">${name}</span>${locPart}<span class="top-sales-price">${sell} aUEC/SCU</span></div>`;
      }).join("");
    };

    if(elR) elR.innerHTML = render(rArr);
    if(elC) elC.innerHTML = render(cArr);
  }

// ---------------------------------------------------------------------------
  // UEX refresh
  // ---------------------------------------------------------------------------
  async function refreshUex(){
    try{
      setUexLine("beg", true, "UEX : actualisation…");
      setUexLine("adv", true, "UEX : actualisation…");

      const r = await fetch(WORKER_URL, { cache: "no-store" });
      if(!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();

      lastUexPayload = data;
      setBestSalesFromUex(data);
      renderBeginnerTopSales(data);
      renderAdvPriceHistoryChart(data);
      updateMarketInsight(data);

      const rNode = data?.rmc || {};
      const cNode = data?.cmat || {};

      const rHist = Array.isArray(rNode.history) ? rNode.history : [];
      const cHist = Array.isArray(cNode.history) ? cNode.history : [];

      const lastR = rHist.length ? rHist[rHist.length - 1] : null;
      const lastC = cHist.length ? cHist[cHist.length - 1] : null;

      let pR = (typeof rNode.price === "number") ? rNode.price : 0;
      let pC = (typeof cNode.price === "number") ? cNode.price : 0;

      if(typeof rNode?.bestTerminal?.sell === "number") pR = rNode.bestTerminal.sell;
      if(typeof cNode?.bestTerminal?.sell === "number") pC = cNode.bestTerminal.sell;

      if(lastR && typeof lastR.sell === "number") pR = lastR.sell;
      if(lastC && typeof lastC.sell === "number") pC = lastC.sell;

      if($("priceRmc")) $("priceRmc").value = String(pR || 0);
      if($("advPriceRmc")) $("advPriceRmc").value = String(pR || 0);

      if($("priceCmat")) $("priceCmat").value = String(pC || 0);
      if($("advPriceCmat")) $("advPriceCmat").value = String(pC || 0);

      setUexLine("beg", true, "UEX : opérationnel (prix à jour)");
      setUexLine("adv", true, "UEX : opérationnel (prix + historique)");
      setUexUpdated(Date.now());
      setUexLock(true);

      calcBeginner();
      calcAdvanced();
    }catch(e){
      setUexLine("beg", false, "UEX : indisponible (saisie manuelle)");
      setUexLine("adv", false, "UEX : indisponible (saisie manuelle)");
      setUexUpdated(null);
      setUexLock(false);

      lastUexPayload = null;
      lastBestRmcItem = null;
      lastBestCmatItem = null;
      setBestSalesFromUex({});
      renderBeginnerTopSales(null);
      renderAdvPriceHistoryChart(null);
      updateMarketInsight(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Configs
  // ---------------------------------------------------------------------------
  function readConfigs(){ try{ return JSON.parse(localStorage.getItem(CFG_KEY) || "{}") || {}; }catch(_){ return {}; } }
  function writeConfigs(c){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(c || {})); }catch(_){ } }
  function currentSlot(){ return $("configSlot")?.value || "slot1"; }

  function fillConfigMeta(){
    const cfg = readConfigs();
    const s = cfg?.[currentSlot()];
    if($("configName")) $("configName").value = s?.name || "";
  }

  function snapshotState(){
    return {
      mode: $("btnBeginner")?.classList.contains("is-active") ? "beginner" : "advanced",
      beginner: {
        ship: $("shipSelect")?.value || "vulture_fortune",
        loopMin: $("begLoopMinutes")?.value || "45",
        scuRmc: $("scuRmc")?.value || "0",
        scuCmat: $("scuCmat")?.value || "0",
        priceRmc: $("priceRmc")?.value || "0",
        priceCmat: $("priceCmat")?.value || "0",
      },
      advanced: {
        loopMinutes: $("loopMinutes")?.value || "45",
        feesPct: $("feesPct")?.value || "0",
        thrOk: $("thrOk")?.value || "250000",
        thrGood: $("thrGood")?.value || "500000",
        refineMode: $("cmatRefineMode")?.value || "sell",
        refineYield: $("cmatRefineYield")?.value || "30",
        scuRmc: $("advScuRmc")?.value || "0",
        scuCmat: $("advScuCmat")?.value || "0",
        priceRmc: $("advPriceRmc")?.value || "0",
        priceCmat: $("advPriceCmat")?.value || "0",
      }
    };
  }

  function applyState(s){
    if(s?.beginner){
      if($("shipSelect")) $("shipSelect").value = s.beginner.ship ?? "vulture_fortune";
      if($("begLoopMinutes")) $("begLoopMinutes").value = s.beginner.loopMin ?? "45";
      if($("scuRmc")) $("scuRmc").value = s.beginner.scuRmc ?? "0";
      if($("scuCmat")) $("scuCmat").value = s.beginner.scuCmat ?? "0";
      if($("priceRmc")) $("priceRmc").value = s.beginner.priceRmc ?? "0";
      if($("priceCmat")) $("priceCmat").value = s.beginner.priceCmat ?? "0";
    }
    if(s?.advanced){
      if($("loopMinutes")) $("loopMinutes").value = s.advanced.loopMinutes ?? "45";
      if($("feesPct")) $("feesPct").value = s.advanced.feesPct ?? "0";
      if($("thrOk")) $("thrOk").value = s.advanced.thrOk ?? "250000";
      if($("thrGood")) $("thrGood").value = s.advanced.thrGood ?? "500000";
      if($("cmatRefineMode")) $("cmatRefineMode").value = s.advanced.refineMode ?? "sell";
      if($("cmatRefineYield")) $("cmatRefineYield").value = s.advanced.refineYield ?? "30";
      if($("advScuRmc")) $("advScuRmc").value = s.advanced.scuRmc ?? "0";
      if($("advScuCmat")) $("advScuCmat").value = s.advanced.scuCmat ?? "0";
      if($("advPriceRmc")) $("advPriceRmc").value = s.advanced.priceRmc ?? "0";
      if($("advPriceCmat")) $("advPriceCmat").value = s.advanced.priceCmat ?? "0";
    }
    setMode(s?.mode === "advanced" ? "advanced" : "beginner");
    applyShipPreset();
  }

  function persist(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(snapshotState())); }catch(_){ } }
  function restore(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      applyState(JSON.parse(raw));
    }catch(_){ }
  }

  function saveConfig(){
    const cfg = readConfigs();
    cfg[currentSlot()] = { name: ($("configName")?.value || "").trim(), ts: Date.now(), state: snapshotState() };
    writeConfigs(cfg);
    fillConfigMeta();
  }

  function loadConfig(){
    const cfg = readConfigs();
    const s = cfg?.[currentSlot()]?.state;
    if(!s) return;
    applyState(s);
    fillConfigMeta();
    calcBeginner();
    calcAdvanced();
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------
  function setMode(mode){
    const isBeg = mode === "beginner";
    if($("modeBeginner")) $("modeBeginner").style.display = isBeg ? "" : "none";
    if($("modeAdvanced")) $("modeAdvanced").style.display = isBeg ? "none" : "";
    $("btnBeginner")?.classList.toggle("is-active", isBeg);
    $("btnAdvanced")?.classList.toggle("is-active", !isBeg);
    persist();
  }

  // ---------------------------------------------------------------------------
  // Wiring (clean)
  // ---------------------------------------------------------------------------
  function bind(){
    $("btnBeginner")?.addEventListener("click", () => setMode("beginner"));
    $("btnAdvanced")?.addEventListener("click", () => setMode("advanced"));

    $("shipSelect")?.addEventListener("change", applyShipPreset);

    ["scuRmc","scuCmat","begLoopMinutes","priceRmc","priceCmat"].forEach(id => {
      $(id)?.addEventListener("input", calcBeginner);
      $(id)?.addEventListener("change", calcBeginner);
    });

    ["advScuRmc","advScuCmat","advPriceRmc","advPriceCmat","feesPct","loopMinutes","thrOk","thrGood","cmatRefineMode","cmatRefineYield"].forEach(id => {
      $(id)?.addEventListener("input", calcAdvanced);
      $(id)?.addEventListener("change", calcAdvanced);
    });

    $("btnRefreshUex")?.addEventListener("click", refreshUex);
    $("btnRefreshUexAdv")?.addEventListener("click", refreshUex);

    $("btnChartRefreshAdv")?.addEventListener("click", refreshUex);
    window.addEventListener("resize", () => { if(lastUexPayload) renderAdvPriceHistoryChart(lastUexPayload); });

    $("btnSaveConfig")?.addEventListener("click", saveConfig);
    $("btnLoadConfig")?.addEventListener("click", loadConfig);
    $("configSlot")?.addEventListener("change", fillConfigMeta);

    $("btnResetBeginner")?.addEventListener("click", () => {
      if($("shipSelect")) $("shipSelect").value = "vulture_fortune";
      if($("scuRmc")) $("scuRmc").value = "0";
      if($("scuCmat")) $("scuCmat").value = "0";
      if($("begLoopMinutes")) $("begLoopMinutes").value = "45";
      applyShipPreset();
      calcBeginner();
    });

    $("btnResetAdvanced")?.addEventListener("click", () => {
      if($("loopMinutes")) $("loopMinutes").value = "45";
      if($("feesPct")) $("feesPct").value = "0";
      if($("thrOk")) $("thrOk").value = "250000";
      if($("thrGood")) $("thrGood").value = "500000";
      if($("cmatRefineMode")) $("cmatRefineMode").value = "sell";
      if($("cmatRefineYield")) $("cmatRefineYield").value = "30";
      if($("advScuRmc")) $("advScuRmc").value = "0";
      if($("advScuCmat")) $("advScuCmat").value = "0";
      calcAdvanced();
    });
  }

  function init(){
    populateShips();
    bind();
    restore();
    fillConfigMeta();

    if($("shipSelect") && !$("shipSelect").value) $("shipSelect").value = "vulture_fortune";
    applyShipPreset();

    calcBeginner();
    calcAdvanced();
    refreshUex();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
