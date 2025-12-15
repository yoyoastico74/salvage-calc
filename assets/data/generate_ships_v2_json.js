// generate_ships_v2_json.js — V3 (adds SCU mapping from starcitizen.tools cargo table)
// Usage (from project root):
//   node assets/data/generate_ships_v2_json.js
// Output:
//   assets/data/ships_v2.json
//
// Data sources:
// 1) Star-Citizen.wiki API (/api/v3/vehicles) for the FULL ship list (names/roles/manufacturer/career)
// 2) starcitizen.tools Ship cargo stats table for cargo capacity (SCU), merged by name
//
// Notes:
// - The wiki API list endpoint does not reliably expose cargo SCU for every ship.
// - We therefore merge a cargo-capacity table to restore SCU display in the dropdown.
// - Ships without a match keep scu = 0 (UI will show "—").
//
// Toggle:
// - INCLUDE_GROUND: include ground vehicles in the output (default false)

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://api.star-citizen.wiki";
const ENDPOINT = "/api/v3/vehicles";

const LIMIT = 200;
const MAX_PAGES = 120;
const LOCALE = "en_EN";

const INCLUDE_GROUND = false;

// Cargo stats table (SCU)
const CARGO_STATS_URL = "https://starcitizen.tools/Ship_cargo_stats";

function norm(v) { return (typeof v === "string") ? v.trim() : ""; }
function lower(v) { return norm(v).toLowerCase(); }

function pickId(obj) {
  return (
    norm(obj?.class_name) ||
    norm(obj?.className) ||
    norm(obj?.slug) ||
    norm(obj?.uuid) ||
    norm(obj?.id) ||
    norm(obj?.name) ||
    ""
  );
}
function pickName(obj) { return norm(obj?.name) || norm(obj?.title) || norm(obj?.label) || ""; }
function pickManufacturer(obj) { return norm(obj?.manufacturer?.name) || norm(obj?.manufacturer) || norm(obj?.maker) || ""; }
function pickCareer(obj) { return norm(obj?.career) || norm(obj?.classification?.career) || ""; }
function pickRole(obj) { return norm(obj?.role) || norm(obj?.primary_role) || norm(obj?.classification?.role) || ""; }

function isGroundVehicle(career, role) {
  const c = lower(career);
  const r = lower(role);
  return c === "ground" || r.includes("ground");
}

async function fetchJsonPage(page) {
  const url = `${BASE_URL}${ENDPOINT}?limit=${LIMIT}&page=${page}&locale=${encodeURIComponent(LOCALE)}`;
  const res = await fetch(url, { headers: { "accept": "application/json" }});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  const data = Array.isArray(json) ? json : json?.data;
  if (!Array.isArray(data)) throw new Error("Unexpected response shape: missing array 'data'");
  return { data, json };
}

function parseScuInt(raw) {
  if (raw == null) return 0;
  const s = String(raw).replace(/[,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function loadCargoScuMap() {
  // Parse the HTML table on starcitizen.tools (best effort).
  // Table columns: Name | Manufacturer | Cargo capacity
  const res = await fetch(CARGO_STATS_URL, { headers: { "accept": "text/html" }});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${CARGO_STATS_URL}`);
  const html = await res.text();

  // Extract rows: <tr> ... <td>NAME</td> ... <td>...SCU</td>
  // This is intentionally permissive; if the wiki changes HTML, the script will still generate ships without SCU.
  const map = new Map();

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gmi;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const row = tr[1];

    // Grab all cell texts (strip tags)
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gmi;
    const cells = [];
    let td;
    while ((td = tdRe.exec(row)) !== null) {
      const cellHtml = td[1];
      const text = cellHtml
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gmi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }

    if (cells.length < 3) continue;

    const name = cells[0];
    const cargo = cells[2];
    if (!name) continue;

    // Extract number from "12,288 SCU" or "64 SCU"
    const m = cargo.match(/([0-9][0-9,\s]*)/);
    const scu = m ? parseScuInt(m[1]) : 0;
    if (scu <= 0) continue;

    map.set(lower(name), scu);
  }

  return map;
}

function resolveScuByName(name, cargoMap) {
  const key = lower(name);
  if (cargoMap.has(key)) return cargoMap.get(key);

  // Heuristics for common naming mismatches:
  // - drop "Starlifter"
  // - drop "Mk II"/"Mk2"
  // - drop edition suffixes
  const simplified = key
    .replace(/\bstarlifter\b/g, "")
    .replace(/\bmk\s*ii\b/g, "mk2")
    .replace(/\bmk\s*2\b/g, "mk2")
    .replace(/\bexecutive edition\b/g, "")
    .replace(/\bbest in show edition\b/g, "")
    .replace(/\bbest in show\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cargoMap.has(simplified)) return cargoMap.get(simplified);

  // Starts-with match (rare): e.g., "C2 Hercules" vs "C2 Hercules Starlifter"
  for (const [k, v] of cargoMap.entries()) {
    if (simplified.startsWith(k) || k.startsWith(simplified)) return v;
  }

  return 0;
}

async function main() {
  let cargoMap = new Map();
  try {
    cargoMap = await loadCargoScuMap();
    console.log(`Cargo table loaded: ${cargoMap.size} entries`);
  } catch (e) {
    console.warn("WARN: cargo table not loaded, SCU may be missing. Reason:", e?.message || e);
  }

  const merged = new Map();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, json } = await fetchJsonPage(page);
    if (data.length === 0) break;

    for (const raw of data) {
      const id = pickId(raw);
      const name = pickName(raw);
      if (!id || !name) continue;

      const manufacturer = pickManufacturer(raw);
      const career = pickCareer(raw) || "Autre";
      const role = pickRole(raw);

      if (!INCLUDE_GROUND && isGroundVehicle(career, role)) continue;

      const scu = resolveScuByName(name, cargoMap);
      merged.set(id, { id, name, manufacturer, career, role, scu });
    }

    const meta = json?.meta;
    const lastPage = Number(meta?.last_page ?? meta?.lastPage ?? 0);
    if (Number.isFinite(lastPage) && lastPage > 0 && page >= lastPage) break;
    if (data.length < LIMIT) break;
  }

  const list = Array.from(merged.values()).sort((a, b) =>
    (a.career || "").localeCompare(b.career || "") ||
    (a.name || "").localeCompare(b.name || "")
  );

  const outPath = path.join(__dirname, "ships_v2.json");
  fs.writeFileSync(outPath, JSON.stringify(list, null, 2), "utf-8");

  const withScu = list.filter(x => (x.scu || 0) > 0).length;
  console.log(`OK: ships_v2.json generated with ${list.length} entries (${withScu} with SCU)`);
  console.log(`Saved to: ${outPath}`);
}

main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
