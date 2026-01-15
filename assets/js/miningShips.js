/* assets/js/miningShips.js — Version V1.0.3
Source de vérité : ships_v2.json (local dataset)
Rôle :
- fournir la liste des vaisseaux taggés "Mining" (mineurs)
- fournir la capacité SCU d'un vaisseau par son nom (pour l'UI)

Notes :
- Compatible <script> classique (pas de import/export)
- Supporte local dev (127.0.0.1), /pages/, et GitHub Pages (repo subpath)
- Expose getMiningShips() et getShipCapacity() sur window
*/

(function(){
  "use strict";

  const __SCRIPT_URL__ = (() => {
    try{
      if (document.currentScript && document.currentScript.src) return document.currentScript.src;
      const s = document.querySelector('script[src*="miningShips.js"]');
      if (s && s.src) return s.src;
    }catch(_){}
    return window.location.href;
  })();

  const __REPO_BASE__ = (() => {
    try{
      const p = window.location.pathname || "/";
      if (p.includes("/pages/")) return p.split("/pages/")[0] + "/";
      return p.substring(0, p.lastIndexOf("/") + 1);
    }catch(_){ return "/"; }
  })();

  const SHIPS_CANDIDATES = [
    // Prefer path resolved from script location: ../data/ships_v2.json relative to /assets/js/
    new URL("../data/ships_v2.json", __SCRIPT_URL__).toString(),

    // Repo-base absolute (GitHub Pages friendly)
    (typeof __REPO_BASE__ === "string" ? (window.location.origin + __REPO_BASE__ + "assets/data/ships_v2.json") : null),

    // Common absolute/relative paths
    "/assets/data/ships_v2.json",
    "assets/data/ships_v2.json",
    "../assets/data/ships_v2.json",
    "../../assets/data/ships_v2.json",

    // Root fallbacks (when JSON is placed at project root)
    "/ships_v2.json",
    "ships_v2.json",
    "../ships_v2.json"
  ].filter(Boolean);

  let __CACHE__ = null;
  let __PROMISE__ = null;

  function normName(s){
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9 \-]/g, "")
      .replace(/\s/g, "");
  }

  async function fetchShipsOnce(){
    for (const u of SHIPS_CANDIDATES){
      try{
        const res = await fetch(u + (u.includes("?") ? "" : ("?t=" + Date.now())), { cache: "no-store" });
        if(!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.ships)) return data.ships;
      }catch(_){}
    }
    return [];
  }

  async function loadShips(){
    if (__CACHE__) return __CACHE__;
    if (__PROMISE__) return __PROMISE__;
    __PROMISE__ = (async () => {
      const ships = await fetchShipsOnce();
      __CACHE__ = Array.isArray(ships) ? ships : [];
      __PROMISE__ = null;
      return __CACHE__;
    })().catch(err => {
      __PROMISE__ = null;
      __CACHE__ = [];
      try{ console.error("[MINING] ships_v2.json load failed:", err); }catch(_){}
      return __CACHE__;
    });
    return __PROMISE__;
  }

  async function getMiningShips(){
    const ships = await loadShips();
    return ships
      .filter(s => Array.isArray(s.tags) && s.tags.includes("Mining"))
      .map(s => ({
        id: s.id,
        name: s.name,
        manufacturer: s.manufacturer,
        scu: Number(s.scu ?? 0) || 0
      }));
  }

  async function getShipCapacity(shipName){
    if (!shipName) return null;
    const target = normName(shipName);
    if (!target) return null;

    const ships = await loadShips();

    const found = ships.find(s => normName(s.name) === target)
      || ships.find(s => normName(s.name).includes(target) || target.includes(normName(s.name)));

    if (!found) return null;

    const cap = Number(found.scu ?? 0);
    return (Number.isFinite(cap) && cap > 0) ? cap : null;
  }

  window.getMiningShips = getMiningShips;
  window.getShipCapacity = getShipCapacity;
})();
