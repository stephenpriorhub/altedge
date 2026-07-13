/**
 * Free place-resolution for facility/site geolocation.
 *
 * WHY: the LLM must never be the source of a precise fact like a street address —
 * it confidently hallucinates them (and even "real" trade-data addresses like
 * ImportYeti's are consignee/mailroom strings, not facilities). The LLM's only
 * job here is to NAME a site ("Tesla Gigafactory Texas"); this module turns that
 * name into a canonical address + WGS84 coordinates using OpenStreetMap.
 *
 * Sources (both free, no API key):
 *   1. Nominatim (OSM)  — primary; authoritative for major named facilities.
 *   2. Photon (Komoot)  — fallback; better at fuzzy named-place search.
 *
 * Discipline:
 *   - A site's location never changes, so every resolved query is cached
 *     effectively forever (one network hit per site, ever).
 *   - Nominatim's usage policy requires ≤1 req/sec and an identifying User-Agent
 *     (http.ts already sends a contact UA). Live misses are serialized + spaced.
 *   - NO MATCH → null. Callers show the site with a blank address rather than a
 *     guess, so imagery is never aimed at the wrong building.
 */
import { getJson } from "./connectors/http";
import { getCached, setCached } from "./store";

export interface GeoResult {
  address: string;
  lat: number;
  lng: number;
  source: "nominatim" | "photon";
}

// A facility's coordinates are immutable — cache resolved queries for ~100y.
const GEO_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 100;
const NS = "geocode";

const normKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

// ── Nominatim rate-limiting: serialize live calls, ≥1.1s apart ────────────────
let liveChain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = 1100 - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastCallAt = Date.now();
    }
  };
  const p = liveChain.then(run, run);
  // Keep the chain alive regardless of this call's outcome.
  liveChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
}

/** Build a clean street-style address from Nominatim address parts. */
function formatNominatim(a: Record<string, string> | undefined, fallback: string): string {
  if (!a) return fallback;
  const line1 = [a.house_number, a.road].filter(Boolean).join(" ");
  const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county;
  const parts = [line1 || a.neighbourhood || a.suburb, city, a.state, a.postcode, a.country].filter(Boolean);
  return parts.length ? parts.join(", ") : fallback;
}

async function viaNominatim(query: string, signal?: AbortSignal): Promise<GeoResult | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=" +
    encodeURIComponent(query);
  const hits = await throttled(() =>
    getJson<NominatimHit[]>(url, { signal, timeoutMs: 10_000, headers: { "Accept-Language": "en" } })
  );
  const hit = Array.isArray(hits) ? hits[0] : undefined;
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { address: formatNominatim(hit.address, hit.display_name), lat, lng, source: "nominatim" };
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string>;
}

function formatPhoton(p: Record<string, string> | undefined): string {
  if (!p) return "";
  const line1 = [p.housenumber, p.street || p.name].filter(Boolean).join(" ");
  const parts = [line1 || p.name, p.city, p.state, p.postcode, p.country].filter(Boolean);
  return parts.join(", ");
}

async function viaPhoton(query: string, signal?: AbortSignal): Promise<GeoResult | null> {
  const url = "https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(query);
  const data = await throttled(() =>
    getJson<{ features?: PhotonFeature[] }>(url, { signal, timeoutMs: 10_000 })
  );
  const f = data.features?.[0];
  const coords = f?.geometry?.coordinates;
  if (!f || !coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address = formatPhoton(f.properties);
  if (!address) return null;
  return { address, lat, lng, source: "photon" };
}

/**
 * Resolve a named place to a canonical address + coordinates via free OSM sources.
 * Returns null when neither source can locate it — callers MUST treat null as
 * "unknown address", never fall back to an LLM guess.
 */
export async function geocodePlace(query: string, signal?: AbortSignal): Promise<GeoResult | null> {
  const q = (query || "").trim();
  if (q.length < 3) return null;

  const key = normKey(q);
  const cached = getCached<GeoResult | { miss: true }>(NS, key, GEO_TTL_MS);
  if (cached) return "miss" in cached ? null : cached;

  let out: GeoResult | null = null;
  try {
    out = await viaNominatim(q, signal);
  } catch {
    out = null;
  }
  if (!out) {
    try {
      out = await viaPhoton(q, signal);
    } catch {
      out = null;
    }
  }

  // Cache misses too, so an unlocatable site isn't retried on every scan.
  setCached(NS, key, out ?? { miss: true });
  return out;
}
