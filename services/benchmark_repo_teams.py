import os
import re
import json
import hashlib
import subprocess
import time
from threading import Lock
from functools import lru_cache
from pathlib import Path

try:
    from benchmark_archetypes import classify_team_archetype
except ModuleNotFoundError:
    from services.benchmark_archetypes import classify_team_archetype
from benchmark_showdown import SHOWDOWN_HELPER_VERSION, pack_team_export, pack_team_exports_bulk, validate_team_export

REPO_TEAM_LOADER_VERSION = "2026.05.10-repo-team-loader-v8-champion-hydration-cache"

_SPREAD_MOVES = (
    "heat wave", "dazzling gleam", "hyper voice", "rock slide", "earthquake",
    "discharge", "blizzard", "eruption", "surf", "snarl", "bleakwind storm",
    "icy wind", "electroweb", "muddy water", "expanding force", "make it rain",
)

_SLOW_ROOM_NAMES = ("ursaluna", "torkoal", "hatterene", "amoonguss", "indeedee-f")
_RAIN_NAMES = ("pelipper", "archaludon", "basculegion", "gholdengo", "tornadus")
_DEFAULT_CANDIDATE_LIMIT = 12
_CHAMPIONS_SP_FORMAT_ID = "gen9championscustomgame"
_CHAMPIONS_SP_POINT_TO_EV = (
    0, 4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116,
    124, 132, 140, 148, 156, 164, 172, 180, 188, 196, 204, 212, 220,
    228, 236, 244, 252,
)
_CHAMPIONS_SP_TOTAL_CAP = 66
_CHAMPIONS_SP_PER_STAT_CAP = 32
_AEGIS_LIMITLESS_SOURCE = "aegis-limitless-active-opponent-pool"
_CHAMPIONLAB_SOURCE = "championslab-public-source"
_CHAMPIONLAB_SOURCE_VERSION = "Andrew21P/ChampionsLab@main"
_CHAMPIONLAB_REPO_URL = "https://github.com/Andrew21P/ChampionsLab"
_CHAMPIONLAB_TARGET_COUNTS = {
    "s-tier-top-tournament": 271,
    "sa-tier-top4-tournament": 545,
    "all-meta-all-tournament": 1050,
    "full-meta-random-100": 1150,
    "gauntlet-full-meta-200": 1250,
}
_aegis_pool_cache = {}
_championlab_source_cache = {}
_STANDARD_EV_TOTAL_CAP = 508
_STAT_LABEL_TO_CANONICAL = {
    "hp": "HP",
    "atk": "Atk",
    "def": "Def",
    "spa": "SpA",
    "spd": "SpD",
    "spe": "Spe",
}
_STAT_ORDER = ("hp", "atk", "def", "spa", "spd", "spe")
_REVERSE_TRIM_TIE_ORDER = ("atk", "spa", "hp", "def", "spd", "spe")
_NATURE_LOWERED_STAT = {
    "adamant": "spa",
    "bashful": None,
    "bold": "atk",
    "brave": "spe",
    "calm": "atk",
    "careful": "spa",
    "docile": None,
    "gentle": "def",
    "hardy": None,
    "hasty": "def",
    "impish": "spa",
    "jolly": "spa",
    "lax": "spd",
    "lonely": "def",
    "mild": "def",
    "modest": "atk",
    "naive": "spd",
    "naughty": "spd",
    "quiet": "spe",
    "quirky": None,
    "rash": "spd",
    "relaxed": "spe",
    "sassy": "spe",
    "serious": None,
    "timid": "atk",
}


# Permanent opponent registry -----------------------------------------------
# This file lives outside the normal report DB so DB wipes do not reset ids.
# It gives every unique format+team combination one permanent global id.
_OPPONENT_REGISTRY_VERSION = "2026.04.18-opponent-registry-v1"
_registry_lock = Lock()


def _registry_path() -> Path:
    return _project_root() / "benchmark_opponent_registry.json"


def _load_opponent_registry() -> dict:
    path = _registry_path()
    if not path.exists():
        return {"version": _OPPONENT_REGISTRY_VERSION, "nextId": 1, "entries": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"version": _OPPONENT_REGISTRY_VERSION, "nextId": 1, "entries": {}}
    if not isinstance(data, dict):
        return {"version": _OPPONENT_REGISTRY_VERSION, "nextId": 1, "entries": {}}
    data.setdefault("version", _OPPONENT_REGISTRY_VERSION)
    data["nextId"] = max(int(data.get("nextId") or 1), 1)
    if not isinstance(data.get("entries"), dict):
        data["entries"] = {}
    return data


def _save_opponent_registry(data: dict) -> None:
    _registry_path().write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")


def _build_opponent_fingerprint(reg: str, team_export: str) -> str:
    normalized = str(team_export or "").replace("\r\n", "\n").strip()
    payload = f"{str(reg or '').strip().lower()}\n{normalized}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _get_or_create_opponent_registry_entry(reg: str, team_export: str, record_name: str, source_path: str) -> dict:
    fingerprint = _build_opponent_fingerprint(reg, team_export)
    with _registry_lock:
        data = _load_opponent_registry()
        entries = data["entries"]
        existing = entries.get(fingerprint)
        if isinstance(existing, dict) and existing.get("id"):
            existing.setdefault("fingerprint", fingerprint)
            return existing
        next_id = max(int(data.get("nextId") or 1), 1)
        entry = {
            "id": next_id,
            "fingerprint": fingerprint,
            "reg": str(reg or "").strip().lower(),
            "name": str(record_name or "").strip(),
            "sourcePath": str(source_path or "").strip(),
        }
        entries[fingerprint] = entry
        data["nextId"] = next_id + 1
        _save_opponent_registry(data)
        return entry


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def get_repo_root() -> Path:
    raw = str(os.getenv("BENCHMARK_REPO_VGC_BENCH_DIR", "")).strip()
    if raw:
        return Path(raw)
    return _project_root()


def _aegis_pool_key() -> str:
    return str(os.getenv("BENCHMARK_AEGIS_OPPONENT_POOL_KEY", "default") or "default").strip() or "default"


def _aegis_adapter_timeout_seconds() -> float:
    raw = str(os.getenv("BENCHMARK_AEGIS_ADAPTER_TIMEOUT_SECONDS", "8") or "8").strip()
    try:
        return max(float(raw), 1.0)
    except Exception:
        return 8.0


def _aegis_adapter_cache_ttl_seconds() -> float:
    raw = str(os.getenv("BENCHMARK_AEGIS_ADAPTER_CACHE_TTL_SECONDS", "30") or "30").strip()
    try:
        return max(float(raw), 0.0)
    except Exception:
        return 30.0


def _load_active_aegis_pool(format_id: str | None = None) -> dict:
    fmt = str(format_id or _CHAMPIONS_SP_FORMAT_ID).strip()
    pool_key = _aegis_pool_key()
    cache_key = (fmt.lower(), pool_key)
    now = time.time()
    cached = _aegis_pool_cache.get(cache_key)
    if cached and (now - float(cached.get("loadedAt") or 0)) <= _aegis_adapter_cache_ttl_seconds():
        return dict(cached.get("payload") or {})

    node_code = r"""
const originalConsoleLog = console.log;
console.log = () => {};
const database = require('./services/database.js');
console.log = originalConsoleLog;
(async () => {
  const status = await database.initializePostgresIntegration();
  if (!status || !status.connected) {
    process.stdout.write(JSON.stringify({ ok: false, reason: 'postgres-unavailable' }));
    return;
  }
  const pool = await database.getActiveBenchmarkLimitlessOpponentPool({
    formatId: process.env.AEGIS_LIMITLESS_FORMAT_ID || '',
    poolKey: process.env.AEGIS_LIMITLESS_POOL_KEY || 'default',
  });
  process.stdout.write(JSON.stringify({ ok: true, pool }));
})()
  .catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, reason: error && error.message ? error.message : String(error) }));
  })
  .finally(async () => {
    const pool = database.getPostgresPool && database.getPostgresPool();
    if (pool && pool.end) await pool.end().catch(() => {});
  });
"""
    env = dict(os.environ)
    env["AEGIS_LIMITLESS_FORMAT_ID"] = fmt
    env["AEGIS_LIMITLESS_POOL_KEY"] = pool_key
    try:
        result = subprocess.run(
            ["node", "-e", node_code],
            cwd=str(_project_root()),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_aegis_adapter_timeout_seconds(),
            check=False,
        )
    except Exception as exc:
        payload = {"ok": False, "reason": f"adapter-error:{exc}"}
        _aegis_pool_cache[cache_key] = {"loadedAt": now, "payload": payload}
        return payload

    try:
        payload = json.loads(str(result.stdout or "").strip() or "{}")
    except Exception:
        payload = {"ok": False, "reason": "adapter-json-parse-failed"}
    if result.returncode != 0 and payload.get("ok") is not True:
        payload.setdefault("reason", str(result.stderr or "").strip() or f"node-exit-{result.returncode}")
    _aegis_pool_cache[cache_key] = {"loadedAt": now, "payload": payload}
    return payload


def _stable_aegis_registry_id(source_opponent_id: str) -> int:
    digest = hashlib.sha1(str(source_opponent_id or "").encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _championlab_source_cache_ttl_seconds() -> float:
    raw = str(os.getenv("BENCHMARK_CHAMPIONLAB_SOURCE_CACHE_TTL_SECONDS", "300") or "300").strip()
    try:
        return max(float(raw), 0.0)
    except Exception:
        return 300.0


def _load_championlab_source_payload() -> dict:
    cache_key = _CHAMPIONLAB_SOURCE_VERSION
    now = time.time()
    cached = _championlab_source_cache.get(cache_key)
    if cached and (now - float(cached.get("loadedAt") or 0)) <= _championlab_source_cache_ttl_seconds():
        return dict(cached.get("payload") or {})

    node_code = r"""
const https = require('https');

const SOURCE_VERSION = 'Andrew21P/ChampionsLab@main';
const SOURCE_URLS = {
  generatedTeams: 'https://raw.githubusercontent.com/Andrew21P/ChampionsLab/main/src/lib/engine/generated-teams.ts',
  simulationData: 'https://raw.githubusercontent.com/Andrew21P/ChampionsLab/main/src/lib/simulation-data.ts',
  pokemonData: 'https://raw.githubusercontent.com/Andrew21P/ChampionsLab/main/src/lib/pokemon-data.ts',
  usageData: 'https://raw.githubusercontent.com/Andrew21P/ChampionsLab/main/src/lib/usage-data.ts',
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Professor-Aegis' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`${res.statusCode} ${url}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function stripComments(text) {
  return String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractAssignedValue(source, name) {
  const text = stripComments(source);
  const marker = `const ${name}`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const eq = text.indexOf('=', start);
  if (eq < 0) throw new Error(`missing assignment for ${name}`);
  let cursor = eq + 1;
  while (/\s/.test(text[cursor])) cursor += 1;
  const open = text[cursor];
  const close = open === '[' ? ']' : (open === '{' ? '}' : null);
  if (!close) throw new Error(`unsupported literal for ${name}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (; cursor < text.length; cursor += 1) {
    const ch = text[cursor];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(eq + 1, cursor + 1).trim();
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

function evalLiteral(source, name) {
  const literal = extractAssignedValue(source, name).replace(/\s+as\s+const\s*$/g, '');
  return Function(`"use strict"; return (${literal});`)();
}

function slugify(value) {
  return String(value || 'championlab')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'championlab';
}

function normalizeSp(set) {
  const sp = set && set.sp ? set.sp : {};
  return {
    hp: Number(sp.hp) || 0,
    attack: Number(sp.attack) || Number(sp.atk) || 0,
    defense: Number(sp.defense) || Number(sp.def) || 0,
    spAtk: Number(sp.spAtk) || Number(sp.spa) || 0,
    spDef: Number(sp.spDef) || Number(sp.spd) || 0,
    speed: Number(sp.speed) || Number(sp.spe) || 0,
  };
}

function defaultSet(pokemon) {
  const moves = Array.isArray(pokemon && pokemon.moves)
    ? pokemon.moves.map((move) => move && move.name).filter(Boolean).slice(0, 4)
    : [];
  while (moves.length < 4) moves.push('Protect');
  return {
    ability: pokemon && Array.isArray(pokemon.abilities) && pokemon.abilities[0] ? pokemon.abilities[0].name : '',
    item: 'Sitrus Berry',
    nature: 'Hardy',
    moves: moves.slice(0, 4),
    sp: { hp: 12, attack: 12, defense: 10, spAtk: 12, spDef: 10, speed: 10 },
  };
}

function setForPokemon(id, usageData, pokemon, explicitSet) {
  const usageSet = explicitSet || (Array.isArray(usageData[id]) && usageData[id][0]) || null;
  const set = usageSet || defaultSet(pokemon);
  const fallback = defaultSet(pokemon);
  return {
    ability: set.ability || fallback.ability,
    item: set.item || fallback.item,
    nature: set.nature || fallback.nature,
    moves: Array.isArray(set.moves) && set.moves.length ? set.moves.slice(0, 4) : fallback.moves,
    sp: normalizeSp(set),
  };
}

function teamExportFor(ids, explicitSets, pokemonById, usageData) {
  const blocks = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = Number(ids[index]);
    const pokemon = pokemonById.get(id);
    if (!pokemon || !pokemon.name) continue;
    const set = setForPokemon(id, usageData, pokemon, Array.isArray(explicitSets) ? explicitSets[index] : null);
    const itemSuffix = set.item ? ` @ ${set.item}` : '';
    const moves = Array.isArray(set.moves) ? set.moves.filter(Boolean).slice(0, 4) : [];
    const lines = [
      `${pokemon.name}${itemSuffix}`,
      set.ability ? `Ability: ${set.ability}` : null,
      `EVs: ${set.sp.hp} HP / ${set.sp.attack} Atk / ${set.sp.defense} Def / ${set.sp.spAtk} SpA / ${set.sp.spDef} SpD / ${set.sp.speed} Spe`,
      `${set.nature || 'Hardy'} Nature`,
      ...moves.map((move) => `- ${move}`),
    ].filter(Boolean);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function makePrebuiltRecord(team, index, pokemonById, usageData) {
  const ids = Array.isArray(team.pokemonIds) ? team.pokemonIds.map(Number).filter(Number.isFinite) : [];
  return {
    id: `championlab-prebuilt-${slugify(team.id || team.name || index)}`,
    sourceId: String(team.id || team.name || index),
    kind: 'prebuilt',
    name: String(team.name || `ChampionLab Prebuilt ${index + 1}`),
    tier: String(team.tier || ''),
    placement: null,
    archetype: String(team.archetype || 'balance'),
    pokemonIds: ids,
    teamExport: teamExportFor(ids, team.sets, pokemonById, usageData),
  };
}

function makeTournamentRecord(team, index, pokemonById, usageData) {
  const ids = Array.isArray(team.pokemonIds) ? team.pokemonIds.map(Number).filter(Number.isFinite) : [];
  const tournamentName = String(team.tournament || '').slice(0, 30);
  const playerName = String(team.player || `Tournament Team ${index + 1}`);
  return {
    id: `championlab-tournament-${slugify(team.id || `${playerName}-${index}`)}`,
    sourceId: String(team.id || `${playerName}-${index}`),
    kind: 'tournament',
    name: tournamentName ? `${playerName} (${tournamentName})` : playerName,
    tier: '',
    placement: Number(team.placement) || null,
    archetype: String(team.archetype || 'tournament'),
    pokemonIds: ids,
    teamExport: teamExportFor(ids, team.sets, pokemonById, usageData),
  };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGeneratedRecords(count, pokemonSeed, pokemonById, usageData) {
  const candidates = pokemonSeed
    .filter((pokemon) => pokemon && !pokemon.hidden && Array.isArray(usageData[pokemon.id]) && usageData[pokemon.id].length)
    .map((pokemon) => Number(pokemon.id))
    .filter(Number.isFinite);
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const rng = seededRandom(12031 + index);
    const pool = candidates.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const ids = pool.slice(0, 6);
    records.push({
      id: `championlab-generated-random-${index + 1}`,
      sourceId: `generated-random-${index + 1}`,
      kind: 'generated-random',
      name: `Generated Random Team ${index + 1}`,
      tier: '',
      placement: null,
      archetype: 'generated-random',
      pokemonIds: ids,
      teamExport: teamExportFor(ids, null, pokemonById, usageData),
    });
  }
  return records;
}

(async () => {
  const sources = await Promise.all(Object.values(SOURCE_URLS).map(fetchText));
  const PREBUILT_TEAMS = evalLiteral(sources[0], 'PREBUILT_TEAMS');
  const CHAMPIONS_TOURNAMENT_TEAMS = evalLiteral(sources[1], 'CHAMPIONS_TOURNAMENT_TEAMS');
  const POKEMON_SEED = evalLiteral(sources[2], 'POKEMON_SEED');
  const USAGE_DATA = evalLiteral(sources[3], 'USAGE_DATA');
  const pokemonById = new Map(POKEMON_SEED.filter((pokemon) => pokemon && !pokemon.hidden).map((pokemon) => [Number(pokemon.id), pokemon]));
  const prebuilt = PREBUILT_TEAMS.map((team, index) => makePrebuiltRecord(team, index, pokemonById, USAGE_DATA)).filter((record) => record.teamExport);
  const tournament = CHAMPIONS_TOURNAMENT_TEAMS.map((team, index) => makeTournamentRecord(team, index, pokemonById, USAGE_DATA)).filter((record) => record.teamExport);
  const generated = makeGeneratedRecords(200, POKEMON_SEED, pokemonById, USAGE_DATA);

  const sTier = [
    ...prebuilt.filter((record) => record.tier === 'S'),
    ...tournament.filter((record) => Number(record.placement) <= 2),
  ];
  const saExtra = [
    ...prebuilt.filter((record) => record.tier === 'A'),
    ...tournament.filter((record) => Number(record.placement) > 2 && Number(record.placement) <= 4),
  ];
  const allExtra = [
    ...prebuilt.filter((record) => record.tier !== 'S' && record.tier !== 'A'),
    ...tournament.filter((record) => Number(record.placement) > 4),
  ];
  const records = [
    ...sTier,
    ...saExtra,
    ...allExtra,
    ...generated,
  ].map((record, index) => ({ ...record, poolRank: index + 1 }));

  process.stdout.write(JSON.stringify({
    ok: true,
    source: 'championslab-public-source',
    sourceVersion: SOURCE_VERSION,
    sourceUrls: SOURCE_URLS,
    counts: {
      prebuilt: prebuilt.length,
      prebuiltS: prebuilt.filter((record) => record.tier === 'S').length,
      prebuiltSA: prebuilt.filter((record) => record.tier === 'S' || record.tier === 'A').length,
      tournament: tournament.length,
      tournamentTop2: tournament.filter((record) => Number(record.placement) <= 2).length,
      tournamentTop4: tournament.filter((record) => Number(record.placement) <= 4).length,
      generatedRandom: generated.length,
      sTierTopTournament: sTier.length,
      saTierTop4Tournament: sTier.length + saExtra.length,
      allMetaAllTournament: sTier.length + saExtra.length + allExtra.length,
      fullMetaRandom100: sTier.length + saExtra.length + allExtra.length + 100,
      gauntletFullMeta200: sTier.length + saExtra.length + allExtra.length + 200,
    },
    records,
  }));
})().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, reason: error && error.message ? error.message : String(error) }));
});
"""
    try:
        result = subprocess.run(
            ["node", "-e", node_code],
            cwd=str(_project_root()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
        )
    except Exception as exc:
        payload = {"ok": False, "reason": f"championlab-source-error:{exc}"}
        _championlab_source_cache[cache_key] = {"loadedAt": now, "payload": payload}
        return payload

    try:
        payload = json.loads(str(result.stdout or "").strip() or "{}")
    except Exception:
        payload = {"ok": False, "reason": "championlab-source-json-parse-failed"}
    if result.returncode != 0 and payload.get("ok") is not True:
        payload.setdefault("reason", str(result.stderr or "").strip() or f"node-exit-{result.returncode}")
    _championlab_source_cache[cache_key] = {"loadedAt": now, "payload": payload}
    return payload


def _build_championlab_record(row: dict, format_id: str | None = None) -> dict | None:
    team_export = str(row.get("teamExport") or "").strip()
    source_opponent_id = str(row.get("id") or "").strip()
    if not team_export or not source_opponent_id:
        return None

    reg = get_reg_from_format_id(format_id)
    display_name = str(row.get("name") or source_opponent_id).strip()
    source_path = f"championslab:{str(row.get('kind') or 'source')}:{str(row.get('sourceId') or source_opponent_id)}"
    registry_id = _stable_aegis_registry_id(source_path)
    archetype = str(row.get("archetype") or "").strip()
    template_keys = infer_template_keys(team_export)
    if archetype:
        template_key = re.sub(r"[^a-z0-9]+", "-", archetype.lower()).strip("-")
        if template_key and template_key not in template_keys:
            template_keys.insert(0, template_key)
    pool_rank = int(row.get("poolRank") or 0)
    archetype_metadata = _build_archetype_metadata(
        team_export,
        format_id=format_id,
        source_label=archetype or row.get("kind"),
        source_kind=f"championslab:{str(row.get('kind') or 'source')}",
    )

    return {
        "id": source_opponent_id,
        "reg": reg,
        "opponentRegistryId": registry_id,
        "opponentRegistryLabel": f"[C{registry_id % 100000:05d}]",
        "opponentFingerprint": hashlib.sha1(team_export.replace("\r\n", "\n").strip().encode("utf-8")).hexdigest(),
        "sourcePath": source_path,
        "name": display_name,
        "archetype": archetype,
        "archetypeMetadata": archetype_metadata,
        "teamExport": team_export,
        "teamPreview": [],
        "templateKeys": template_keys,
        "featured": 0 < pool_rank <= _CHAMPIONLAB_TARGET_COUNTS["s-tier-top-tournament"],
        "topCut": str(row.get("kind") or "") == "tournament" and (int(row.get("placement") or 9999) <= 4),
        "source": "ChampionsLab public source behavior",
        "summary": "Selected from ChampionsLab public source buckets for Champion-format simulations.",
        "notes": [
            f"Source: {_CHAMPIONLAB_REPO_URL}",
            f"Source version: {_CHAMPIONLAB_SOURCE_VERSION}",
            f"Source bucket: {str(row.get('kind') or 'unknown')}",
        ],
        "championLabKind": row.get("kind"),
        "championLabTier": row.get("tier"),
        "championLabPlacement": row.get("placement"),
        "championLabPoolRank": pool_rank,
    }


def _get_championlab_opponent_records(format_id: str | None = None, featured_only: bool = False, limit: int | None = None) -> list[dict]:
    payload = _load_championlab_source_payload()
    if payload.get("ok") is not True:
        return []
    records = []
    for row in payload.get("records") or []:
        if not isinstance(row, dict):
            continue
        record = _build_championlab_record(row, format_id=format_id)
        if record:
            records.append(record)
    if featured_only:
        records = [record for record in records if record.get("featured")]
    records.sort(key=lambda r: int(r.get("championLabPoolRank") or 999999))
    if limit is not None:
        try:
            records = records[: max(int(limit), 1)]
        except Exception:
            pass
    return [dict(record) for record in records]


def _championlab_summary(format_id: str | None = None) -> dict:
    payload = _load_championlab_source_payload()
    source_ready = payload.get("ok") is True
    records = payload.get("records") if source_ready and isinstance(payload.get("records"), list) else []
    counts = payload.get("counts") if source_ready and isinstance(payload.get("counts"), dict) else {}
    team_count = len(records)
    featured_count = counts.get("sTierTopTournament")
    if not isinstance(featured_count, int):
        featured_count = sum(
            1
            for record in records
            if int((record or {}).get("poolRank") or 0) <= _CHAMPIONLAB_TARGET_COUNTS["s-tier-top-tournament"]
        )
    return {
        "repoRoot": None,
        "reg": get_reg_from_format_id(format_id),
        "teamCount": team_count,
        "featuredCount": featured_count if source_ready else 0,
        "candidateLimit": _candidate_limit(),
        "source": _CHAMPIONLAB_SOURCE,
        "sourceVersion": _CHAMPIONLAB_SOURCE_VERSION,
        "sourceUrl": _CHAMPIONLAB_REPO_URL,
        "sourceReady": bool(source_ready),
        "sourceReason": None if source_ready else payload.get("reason"),
        "loaderVersion": REPO_TEAM_LOADER_VERSION,
        "modeTargetCounts": dict(_CHAMPIONLAB_TARGET_COUNTS),
    }


def _build_archetype_metadata(
    team_export: str,
    format_id: str | None = None,
    source_label: str | None = None,
    source_kind: str | None = None,
) -> dict:
    format_profile = "champions" if _is_champions_sp_format(format_id) else get_reg_from_format_id(format_id)
    try:
        return classify_team_archetype(
            team_export,
            format_profile=format_profile,
            source_label=source_label,
            source_kind=source_kind,
        )
    except Exception as exc:
        return {
            "primaryKey": "goodstuffs",
            "primaryLabel": "Goodstuffs",
            "secondaryKey": None,
            "secondaryLabel": None,
            "displayLabel": "Goodstuffs",
            "tags": ["fallback"],
            "confidence": 0,
            "confidenceBand": "Unknown",
            "formatProfile": format_profile,
            "source": {
                "kind": source_kind or "team-export",
                "label": str(source_label or "").strip(),
                "labelKey": re.sub(r"[^a-z0-9]+", "-", str(source_label or "").strip().lower()).strip("-"),
                "genericLabel": True,
            },
            "evidence": [{"type": "fallback", "value": f"classification failed: {exc}", "weight": 0}],
            "glossaryEntry": "Goodstuffs teams use individually strong Pokemon without one rigid mode.",
        }


def _build_aegis_record(row: dict, format_id: str | None = None) -> dict | None:
    team_export = str(row.get("normalizedTeamExport") or "").strip()
    source_opponent_id = str(row.get("sourceOpponentId") or "").strip()
    if not team_export or not source_opponent_id:
        return None

    reg = get_reg_from_format_id(format_id)
    display_name = str(row.get("playerName") or row.get("teamHash") or source_opponent_id).strip()
    template_keys = [
        str(value or "").strip()
        for value in (row.get("templateKey"), row.get("archetypeKey"))
        if str(value or "").strip()
    ]
    if not template_keys:
        template_keys = infer_template_keys(team_export)
    registry_id = _stable_aegis_registry_id(source_opponent_id)
    source_label = template_keys[0] if template_keys else row.get("archetypeKey")
    archetype_metadata = _build_archetype_metadata(
        team_export,
        format_id=format_id,
        source_label=source_label,
        source_kind="aegis-limitless",
    )

    return {
        "id": f"aegis-limitless-{source_opponent_id}",
        "reg": reg,
        "opponentRegistryId": registry_id,
        "opponentRegistryLabel": f"[A{registry_id % 100000:05d}]",
        "opponentFingerprint": row.get("opponentFingerprint") or row.get("teamHash") or source_opponent_id,
        "sourcePath": f"aegis-limitless:{source_opponent_id}",
        "name": display_name,
        "teamExport": team_export,
        "teamPreview": [],
        "templateKeys": template_keys,
        "archetypeMetadata": archetype_metadata,
        "featured": bool(row.get("featured") or row.get("topCut")),
        "topCut": bool(row.get("topCut")),
        "source": "Aegis Limitless active opponent pool",
        "summary": "Active Professor Aegis Limitless opponent pool team.",
        "notes": ["Loaded from the active Aegis-owned Limitless opponent pool."],
    }


def _get_aegis_opponent_records(format_id: str | None = None, featured_only: bool = False, limit: int | None = None) -> list[dict]:
    payload = _load_active_aegis_pool(format_id=format_id)
    if payload.get("ok") is not True:
        return []
    rows = ((payload.get("pool") or {}).get("opponents") or [])
    records = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not _aegis_row_is_champions_only(row, format_id=format_id):
            continue
        record = _build_aegis_record(row, format_id=format_id)
        if record:
            records.append(record)
    if featured_only:
        records = [record for record in records if record.get("featured")]
    records.sort(key=lambda r: (not r.get("topCut", False), not r.get("featured", False), str(r.get("name") or "").lower()))
    if limit is not None:
        try:
            records = records[: max(int(limit), 1)]
        except Exception:
            pass
    return [dict(record) for record in records]




def _repo_validation_enabled() -> bool:
    raw = str(os.getenv("BENCHMARK_REPO_VALIDATE_OPPONENTS", "0")).strip().lower()
    return raw in {"1", "true", "yes", "on"}

def _candidate_limit() -> int:
    raw = str(os.getenv("BENCHMARK_REPO_CANDIDATE_LIMIT", str(_DEFAULT_CANDIDATE_LIMIT))).strip()
    try:
        return max(int(raw), 1)
    except Exception:
        return _DEFAULT_CANDIDATE_LIMIT


def get_reg_from_format_id(format_id: str | None) -> str:
    fmt = str(format_id or "").strip().lower()
    explicit = str(os.getenv("BENCHMARK_REPO_DEFAULT_REG", "i")).strip().lower() or "i"

    mapping = {
        "gen9benchmarkdoublesag": "i",
        "gen9championscustomgame": "i",
        "gen9vgc2026regi": "i",
        "gen9vgc2025regh": "h",
        "gen9vgc2024regg": "g",
        "gen9vgc2024regf": "f",
        "gen9vgc2024rege": "e",
    }
    return mapping.get(fmt, explicit)


def get_reg_dir(reg: str) -> Path:
    return get_repo_root() / "teams" / f"reg_{str(reg).strip().lower()}"


def _clean_display_name(path: Path) -> str:
    stem = path.stem.replace("_", " ").replace("-", " ").strip()
    if not stem:
        stem = path.name
    if "featured" in path.parts:
        return f"Featured – {stem}"
    return stem


def _count_occurrences(text: str, phrases: tuple[str, ...]) -> int:
    return sum(text.count(phrase) for phrase in phrases)


def infer_template_keys(team_export: str) -> list[str]:
    text = str(team_export or "").lower()
    tags = []

    has_trick_room = "trick room" in text
    has_tailwind = "tailwind" in text
    has_redirection = ("follow me" in text) or ("rage powder" in text)
    has_fake_out = "fake out" in text
    protect_count = text.count("- protect")
    spread_count = _count_occurrences(text, _SPREAD_MOVES)
    has_intimidate = "ability: intimidate" in text
    has_pivot = ("u-turn" in text) or ("volt switch" in text) or ("flip turn" in text) or ("parting shot" in text)
    has_choice_or_booster = ("choice scarf" in text) or ("choice specs" in text) or ("choice band" in text) or ("booster energy" in text)

    if has_trick_room and (has_redirection or any(name in text for name in _SLOW_ROOM_NAMES)):
        tags.append("hard-trick-room")
    if spread_count >= 2 or any(name in text for name in _RAIN_NAMES):
        tags.append("spread-heavy-offense")
    if has_tailwind and (has_fake_out or spread_count >= 1 or has_choice_or_booster):
        tags.append("fast-offense-mirrors")
    if has_redirection and (protect_count >= 2 or has_fake_out):
        tags.append("redirection-balance")
    if (protect_count >= 4 or has_intimidate or has_pivot) and (has_fake_out or has_tailwind or has_redirection):
        tags.append("bulky-balance")
    if has_fake_out or has_tailwind or has_choice_or_booster or has_intimidate:
        tags.append("direct-pressure-offense")
    if not tags:
        tags.append("direct-pressure-offense")

    seen = set()
    ordered = []
    for tag in tags:
        if tag in seen:
            continue
        seen.add(tag)
        ordered.append(tag)
    return ordered


@lru_cache(maxsize=16)
def _scan_reg(reg: str) -> list[dict]:
    return []


_validation_cache: dict[tuple[str, str, str], dict] = {}
_pack_cache: dict[tuple[str, str, str], dict] = {}
_hydration_cache: dict[str, dict] = {}
_hydration_cache_loaded = False
_hydration_cache_lock = Lock()


def _hydration_cache_path() -> Path:
    return _project_root() / "benchmark_cache" / "repo_opponents.json"


def _load_hydration_cache() -> None:
    global _hydration_cache_loaded
    if _hydration_cache_loaded:
        return
    with _hydration_cache_lock:
        if _hydration_cache_loaded:
            return
        path = _hydration_cache_path()
        try:
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
                entries = data.get("entries") if isinstance(data, dict) else None
                if isinstance(entries, dict):
                    _hydration_cache.update({str(k): v for k, v in entries.items() if isinstance(v, dict)})
        except Exception:
            pass
        _hydration_cache_loaded = True


def _save_hydration_cache() -> None:
    path = _hydration_cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _hydration_cache_lock:
            payload = {
                "version": REPO_TEAM_LOADER_VERSION,
                "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
                "updatedAt": int(time.time()),
                "entries": dict(_hydration_cache),
            }
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        tmp_path.replace(path)
    except Exception:
        pass


def _hydration_cache_key(record: dict, format_id: str | None) -> str:
    metadata = _hydration_cache_metadata(record, format_id)
    record_id = str(record.get("id") or "").strip()
    return f"{record_id}::{metadata['formatId']}::{metadata['teamFingerprint']}::{metadata['showdownHelperVersion']}::{metadata['speciesAliasToken']}"


def _is_champions_sp_format(format_id: str | None) -> bool:
    return str(format_id or "").strip().lower() == _CHAMPIONS_SP_FORMAT_ID


_CHAMPIONS_SPECIES_ALIAS_MAP = {
    "singlestrikeurshifu": "Urshifu",
    "urshifusinglestrike": "Urshifu",
    "floette": "Floette-Eternal",
    "eternalfloette": "Floette-Eternal",
    "eternalflowerfloette": "Floette-Eternal",
    "floetteeternalflower": "Floette-Eternal",
    "rapidstrikeurshifu": "Urshifu-Rapid-Strike",
    "urshifurapidstrikeform": "Urshifu-Rapid-Strike",
    "shadowridercalyrex": "Calyrex-Shadow",
    "calyrexshadowrider": "Calyrex-Shadow",
    "iceridercalyrex": "Calyrex-Ice",
    "calyrexicerider": "Calyrex-Ice",
    "tealmaskogerpon": "Ogerpon",
    "ogerpontealmask": "Ogerpon",
    "wellspringmaskogerpon": "Ogerpon-Wellspring",
    "ogerponwellspringmask": "Ogerpon-Wellspring",
    "hearthflamemaskogerpon": "Ogerpon-Hearthflame",
    "ogerponhearthflamemask": "Ogerpon-Hearthflame",
    "cornerstonemaskogerpon": "Ogerpon-Cornerstone",
    "ogerponcornerstonemask": "Ogerpon-Cornerstone",
    "bloodmoonursaluna": "Ursaluna-Bloodmoon",
    "ursalunabloodmoonform": "Ursaluna-Bloodmoon",
    "therianformelandorus": "Landorus-Therian",
    "landorustherianforme": "Landorus-Therian",
    "incarnateformelandorus": "Landorus",
    "therianformetornadus": "Tornadus-Therian",
    "tornadustherianforme": "Tornadus-Therian",
    "incarnateformetornadus": "Tornadus",
    "therianformethundurus": "Thundurus-Therian",
    "thundurustherianforme": "Thundurus-Therian",
    "incarnateformethundurus": "Thundurus",
    "therianformeenamorus": "Enamorus-Therian",
    "enamorustherianforme": "Enamorus-Therian",
    "incarnateformeenamorus": "Enamorus",
    "originformedialga": "Dialga-Origin",
    "dialgaoriginforme": "Dialga-Origin",
    "originformepalkia": "Palkia-Origin",
    "palkiaoriginforme": "Palkia-Origin",
    "originformegiratina": "Giratina-Origin",
    "giratinaoriginforme": "Giratina-Origin",
    "alteredformegiratina": "Giratina",
    "blackkyurem": "Kyurem-Black",
    "whitekyurem": "Kyurem-White",
    "duskmannenecrozma": "Necrozma-Dusk-Mane",
    "dawnwingsnecrozma": "Necrozma-Dawn-Wings",
    "crownedzacian": "Zacian-Crowned",
    "crownedzamazenta": "Zamazenta-Crowned",
    "femaleindeedee": "Indeedee-F",
    "indeedeefemale": "Indeedee-F",
    "maleindeedee": "Indeedee",
    "indeedeemale": "Indeedee",
    "femalebasculegion": "Basculegion-F",
    "basculegionfemale": "Basculegion-F",
    "basculegionf": "Basculegion-F",
    "malebasculegion": "Basculegion",
    "basculegionmale": "Basculegion",
    "basculegionm": "Basculegion",
    "malemeowstic": "Meowstic",
    "meowsticmale": "Meowstic",
    "meowsticm": "Meowstic",
    "familyoffourmaushold": "Maushold-Four",
    "mausholdfamilyoffour": "Maushold-Four",
    "familyofthreemaushold": "Maushold",
    "mausholdfamilyofthree": "Maushold",
    "threesegmentdudunsparce": "Dudunsparce-Three-Segment",
    "dudunsparcethreesegmentform": "Dudunsparce-Three-Segment",
    "twosegmentdudunsparce": "Dudunsparce",
    "dudunsparcetwosegmentform": "Dudunsparce",
    "droopyformtatsugiri": "Tatsugiri-Droopy",
    "tatsugiridroopyform": "Tatsugiri-Droopy",
    "stretchyformtatsugiri": "Tatsugiri-Stretchy",
    "tatsugiristretchyform": "Tatsugiri-Stretchy",
    "curlyformtatsugiri": "Tatsugiri",
    "tatsugiricurlyform": "Tatsugiri",
    "masterpieceformsinistcha": "Sinistcha-Masterpiece",
    "sinistchamasterpieceform": "Sinistcha-Masterpiece",
    "unremarkableformsinistcha": "Sinistcha",
    "artisanformpoltchageist": "Poltchageist-Artisan",
    "poltchageistartisanform": "Poltchageist-Artisan",
    "counterfeitformpoltchageist": "Poltchageist",
    "paldeantauroscombatbreed": "Tauros-Paldea-Combat",
    "combattaurospaldea": "Tauros-Paldea-Combat",
    "paldeantaurosblazebreed": "Tauros-Paldea-Blaze",
    "blazebreedtauros": "Tauros-Paldea-Blaze",
    "paldeantaurosaquabreed": "Tauros-Paldea-Aqua",
    "aquabreedtauros": "Tauros-Paldea-Aqua",
    "heatrotom": "Rotom-Heat",
    "rotomheatform": "Rotom-Heat",
    "washrotom": "Rotom-Wash",
    "rotomwashform": "Rotom-Wash",
    "frostrotom": "Rotom-Frost",
    "rotomfrostform": "Rotom-Frost",
    "fanrotom": "Rotom-Fan",
    "rotomfanform": "Rotom-Fan",
    "mowrotom": "Rotom-Mow",
    "rotommowform": "Rotom-Mow",
    "aegislashbladeforme": "Aegislash",
    "bladeformeaegislash": "Aegislash",
}


@lru_cache(maxsize=1)
def _champions_species_alias_cache_token() -> str:
    payload = json.dumps(_CHAMPIONS_SPECIES_ALIAS_MAP, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def _hydration_team_fingerprint(record: dict, format_id: str | None) -> str:
    explicit = str((record or {}).get("opponentFingerprint") or "").strip()
    if explicit:
        return explicit
    team_export = str((record or {}).get("teamExport") or "")
    try:
        team_export = _champions_sp_simulator_export(team_export, format_id)
    except Exception:
        pass
    normalized = team_export.replace("\r\n", "\n").replace("\r", "\n").strip()
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def _hydration_species_alias_token(format_id: str | None) -> str:
    if not _is_champions_sp_format(format_id):
        return "species-aliases:not-required"
    return f"champions-species-aliases:{_champions_species_alias_cache_token()}"


def _hydration_cache_metadata(record: dict, format_id: str | None) -> dict:
    return {
        "formatId": str(format_id or "").strip().lower(),
        "teamFingerprint": _hydration_team_fingerprint(record, format_id),
        "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
        "speciesAliasToken": _hydration_species_alias_token(format_id),
    }


def _hydration_cache_entry_matches(entry: dict, metadata: dict) -> bool:
    if not isinstance(entry, dict) or not isinstance(metadata, dict):
        return False
    for key in ("formatId", "teamFingerprint", "showdownHelperVersion", "speciesAliasToken"):
        if str(entry.get(key) or "") != str(metadata.get(key) or ""):
            return False
    return True

_REGIONAL_FORM_PREFIXES = {
    "alolan": "Alola",
    "galarian": "Galar",
    "hisuian": "Hisui",
    "paldean": "Paldea",
}


def _species_alias_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


@lru_cache(maxsize=1)
def _showdown_species_index() -> dict:
    path = _project_root() / "pokemon-showdown" / "dist" / "data" / "pokedex.js"
    names_by_id = {}
    names_by_key = {}
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception as exc:
        return {
            "available": False,
            "path": str(path),
            "error": str(exc),
            "namesById": names_by_id,
            "namesByKey": names_by_key,
        }

    current_id = None
    current_name = None
    depth = 0
    for line in lines:
        if current_id is None:
            match = re.match(r"^\s*([a-z0-9]+):\s*{\s*$", line)
            if not match:
                continue
            current_id = match.group(1)
            current_name = None
            depth = line.count("{") - line.count("}")
            continue

        name_match = re.match(r'^\s*name:\s*"([^"]+)"', line)
        if name_match and current_name is None:
            current_name = name_match.group(1).strip()

        depth += line.count("{") - line.count("}")
        if depth <= 0:
            if current_id and current_name:
                names_by_id[current_id] = current_name
                names_by_key[current_id] = current_name
                names_by_key[_species_alias_key(current_name)] = current_name
            current_id = None
            current_name = None
            depth = 0

    return {
        "available": True,
        "path": str(path),
        "error": None,
        "namesById": names_by_id,
        "namesByKey": names_by_key,
    }


def _showdown_species_exists(value: str) -> bool:
    index = _showdown_species_index()
    if not index.get("available"):
        return False
    key = _species_alias_key(value)
    return bool(index.get("namesByKey", {}).get(key))


def _canonical_showdown_species(value: str) -> str | None:
    raw = str(value or "")
    key = _species_alias_key(value)
    if not key:
        return None
    index = _showdown_species_index()
    names_by_key = index.get("namesByKey", {}) if index.get("available") else {}
    if "♀" in raw:
        female = names_by_key.get(f"{key}f")
        if female:
            return female
        alias = _CHAMPIONS_SPECIES_ALIAS_MAP.get(f"{key}female") or _CHAMPIONS_SPECIES_ALIAS_MAP.get(f"female{key}")
        if alias and _showdown_species_exists(alias):
            return alias
    if "♂" in raw:
        male = names_by_key.get(f"{key}m")
        if male:
            return male
        alias = _CHAMPIONS_SPECIES_ALIAS_MAP.get(f"{key}male") or _CHAMPIONS_SPECIES_ALIAS_MAP.get(f"male{key}")
        if alias and _showdown_species_exists(alias):
            return alias
    alias = _CHAMPIONS_SPECIES_ALIAS_MAP.get(key)
    if alias and _showdown_species_exists(alias):
        return alias
    direct = names_by_key.get(key)
    if direct:
        return direct

    for prefix, suffix in _REGIONAL_FORM_PREFIXES.items():
        if not key.startswith(prefix):
            continue
        base_key = key[len(prefix):]
        if not base_key:
            continue
        regional = names_by_key.get(f"{base_key}{_species_alias_key(suffix)}")
        if regional:
            return regional
    return None


@lru_cache(maxsize=1)
def _champions_legal_species_index() -> dict:
    path = _project_root() / "pokemon-showdown" / "dist" / "data" / "mods" / "champions" / "formats-data.js"
    legal_ids = set()
    illegal_ids = set()
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception as exc:
        return {
            "available": False,
            "path": str(path),
            "error": str(exc),
            "legalIds": legal_ids,
            "illegalIds": illegal_ids,
        }

    current_id = None
    depth = 0
    block_lines = []
    for line in lines:
        if current_id is None:
            match = re.match(r"^\s*([a-z0-9]+):\s*{\s*$", line)
            if not match:
                continue
            current_id = match.group(1)
            block_lines = [line]
            depth = line.count("{") - line.count("}")
            continue

        block_lines.append(line)
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            body = "\n".join(block_lines)
            if 'tier: "Illegal"' in body or 'isNonstandard: "Past"' in body:
                illegal_ids.add(current_id)
            elif "tier:" in body:
                legal_ids.add(current_id)
            current_id = None
            depth = 0
            block_lines = []

    return {
        "available": True,
        "path": str(path),
        "error": None,
        "legalIds": legal_ids,
        "illegalIds": illegal_ids,
    }


def _champions_species_membership_for_export(team_export: str, format_id: str | None) -> dict:
    species_validation = _champions_species_validation_for_export(team_export, format_id)
    if not _is_champions_sp_format(format_id):
        return {
            "ok": True,
            "valid": True,
            "messages": "",
            "speciesValidation": species_validation,
            "illegalChampionSpecies": [],
            "method": "champions-membership-not-required",
        }
    if not species_validation.get("valid"):
        return {
            "ok": False,
            "valid": False,
            "messages": species_validation.get("messages") or "Champion species scan failed.",
            "speciesValidation": species_validation,
            "illegalChampionSpecies": [],
            "method": "champions-membership-species-unresolved",
        }

    index = _champions_legal_species_index()
    if not index.get("available"):
        return {
            "ok": False,
            "valid": False,
            "messages": f"Champion legality scan unavailable; local Champions formats data could not be read: {index.get('error') or index.get('path')}",
            "speciesValidation": species_validation,
            "illegalChampionSpecies": [],
            "method": "champions-membership-unavailable",
        }

    legal_ids = index.get("legalIds") or set()
    illegal = []
    for species in ((species_validation.get("speciesScan") or {}).get("resolvedSpecies") or []):
        canonical = str(species or "").strip()
        if canonical and _species_alias_key(canonical) not in legal_ids:
            illegal.append(canonical)

    illegal = _ordered_unique_strings(illegal)
    if illegal:
        return {
            "ok": False,
            "valid": False,
            "messages": "Non-Champions species excluded from Champion opponent pool: " + ", ".join(illegal),
            "speciesValidation": species_validation,
            "illegalChampionSpecies": illegal,
            "method": "champions-membership-filter",
        }

    return {
        "ok": True,
        "valid": True,
        "messages": "Champion-only membership scan passed.",
        "speciesValidation": species_validation,
        "illegalChampionSpecies": [],
        "method": "champions-membership-filter",
    }


def _aegis_row_matches_format(row: dict, format_id: str | None = None) -> bool:
    expected = str(format_id or _CHAMPIONS_SP_FORMAT_ID).strip().lower()
    actual = str((row or {}).get("formatId") or "").strip().lower()
    return not expected or not actual or actual == expected


def _aegis_row_is_champions_only(row: dict, format_id: str | None = None) -> bool:
    effective_format = format_id or _CHAMPIONS_SP_FORMAT_ID
    if not _aegis_row_matches_format(row, effective_format):
        return False
    if not _is_champions_sp_format(effective_format):
        return True
    membership = _champions_species_membership_for_export((row or {}).get("normalizedTeamExport") or "", effective_format)
    return bool(membership.get("valid"))


def _normalize_champions_species_alias(value: str) -> str | None:
    return _canonical_showdown_species(value)


def _extract_team_header_species(line: str) -> str:
    raw = str(line or "")
    body = raw.strip()
    item_match = re.search(r"\s+@\s+", body)
    header = body[:item_match.start()].rstrip() if item_match else body
    if not header:
        return ""

    nicknamed = re.match(r"^(?P<nickname>.+?)\s+\((?P<species>[^)]+)\)$", header)
    if nicknamed and str(nicknamed.group("species") or "").strip().upper() not in {"M", "F"}:
        return str(nicknamed.group("species") or "").strip()

    gendered = re.match(r"^(?P<species>.+?)\s+\((?P<gender>[MF])\)$", header, re.IGNORECASE)
    if gendered:
        return str(gendered.group("species") or "").strip()

    return header.strip()


def _ordered_unique_strings(values: list[str]) -> list[str]:
    seen = set()
    out = []
    for value in values or []:
        cleaned = str(value or "").strip()
        key = _species_alias_key(cleaned)
        if not cleaned or key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def _champions_species_validation_for_export(team_export: str, format_id: str | None) -> dict:
    if not _is_champions_sp_format(format_id):
        return {"ok": True, "valid": True, "messages": "", "method": "species-scan-not-required"}

    index = _showdown_species_index()
    if not index.get("available"):
        message = f"Champion species scan unavailable; local Showdown Pokedex could not be read: {index.get('error') or index.get('path')}"
        return {
            "ok": False,
            "valid": False,
            "messages": message,
            "method": "champions-species-scan-unavailable",
            "speciesScan": {
                "dexAvailable": False,
                "dexPath": index.get("path"),
                "totalUniqueSpecies": 0,
                "aliasesNormalized": [],
                "unresolvedSpecies": [],
                "skippedSpecies": [],
            },
            "unresolvedSpecies": [],
            "aliasesNormalized": [],
        }

    source_species = []
    resolved_species = []
    alias_rows = []
    unresolved_species = []
    text = str(team_export or "").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n{2,}", text.strip()) if text.strip() else []
    for block in blocks:
        lines = [line for line in block.split("\n") if str(line or "").strip()]
        if not lines:
            continue
        raw_species = _extract_team_header_species(lines[0])
        if not raw_species:
            continue
        source_species.append(raw_species)
        canonical = _canonical_showdown_species(raw_species)
        if not canonical:
            unresolved_species.append(raw_species)
            continue
        resolved_species.append(canonical)
        if _species_alias_key(raw_species) != _species_alias_key(canonical) or raw_species != canonical:
            alias_rows.append({"source": raw_species, "canonical": canonical})

    unique_source = _ordered_unique_strings(source_species)
    unique_unresolved = _ordered_unique_strings(unresolved_species)
    unique_aliases = []
    seen_aliases = set()
    for row in alias_rows:
        source = str(row.get("source") or "").strip()
        canonical = str(row.get("canonical") or "").strip()
        key = f"{_species_alias_key(source)}::{_species_alias_key(canonical)}"
        if not source or not canonical or key in seen_aliases:
            continue
        seen_aliases.add(key)
        unique_aliases.append({"source": source, "canonical": canonical})

    valid = not unique_unresolved
    message = (
        "Champion species scan passed."
        if valid
        else "Unresolved Champion species skipped before battle startup: " + ", ".join(unique_unresolved)
    )
    return {
        "ok": valid,
        "valid": valid,
        "messages": message,
        "method": "champions-species-scan",
        "speciesScan": {
            "dexAvailable": True,
            "dexSpeciesCount": len(index.get("namesById") or {}),
            "totalUniqueSpecies": len(unique_source),
            "sourceSpecies": unique_source,
            "resolvedSpecies": _ordered_unique_strings(resolved_species),
            "aliasesNormalized": unique_aliases,
            "unresolvedSpecies": unique_unresolved,
            "skippedSpecies": unique_unresolved,
        },
        "unresolvedSpecies": unique_unresolved,
        "aliasesNormalized": unique_aliases,
    }


def _blocked_champions_species_packing(validation: dict) -> dict:
    return {
        "ok": False,
        "packedTeam": None,
        "error": (validation or {}).get("messages") or "Champion species scan failed.",
        "method": "champions-species-gate",
    }


def scan_champions_pool_species(format_id: str | None = None, records: list[dict] | None = None) -> dict:
    fmt = format_id or _CHAMPIONS_SP_FORMAT_ID
    pool_records = list(records) if records is not None else get_repo_opponent_records(format_id=fmt, featured_only=False)
    aliases = []
    unresolved = []
    illegal_champions_species = []
    skipped_records = []
    unique_species = []
    for record in pool_records:
        team_export = str((record or {}).get("teamExport") or "")
        validation = _champions_species_validation_for_export(team_export, fmt)
        membership = _champions_species_membership_for_export(team_export, fmt)
        scan = validation.get("speciesScan") or {}
        unique_species.extend(scan.get("sourceSpecies") or [])
        aliases.extend(scan.get("aliasesNormalized") or [])
        unresolved.extend(scan.get("unresolvedSpecies") or [])
        illegal_champions_species.extend(membership.get("illegalChampionSpecies") or [])
        if not validation.get("valid") or not membership.get("valid"):
            skipped_records.append({
                "id": (record or {}).get("id"),
                "name": (record or {}).get("name"),
                "unresolvedSpecies": scan.get("unresolvedSpecies") or [],
                "illegalChampionSpecies": membership.get("illegalChampionSpecies") or [],
            })

    unique_aliases = []
    seen_aliases = set()
    for row in aliases:
        source = str((row or {}).get("source") or "").strip()
        canonical = str((row or {}).get("canonical") or "").strip()
        key = f"{_species_alias_key(source)}::{_species_alias_key(canonical)}"
        if not source or not canonical or key in seen_aliases:
            continue
        seen_aliases.add(key)
        unique_aliases.append({"source": source, "canonical": canonical})

    unique_unresolved = _ordered_unique_strings(unresolved)
    unique_illegal_champions_species = _ordered_unique_strings(illegal_champions_species)
    return {
        "formatId": fmt,
        "recordsScanned": len(pool_records),
        "totalUniqueSpecies": len(_ordered_unique_strings(unique_species)),
        "aliasesNormalized": unique_aliases,
        "unresolvedSpecies": unique_unresolved,
        "illegalChampionSpecies": unique_illegal_champions_species,
        "skippedSpecies": _ordered_unique_strings(unique_unresolved + unique_illegal_champions_species),
        "skippedRecords": skipped_records,
        "allResolved": not unique_unresolved,
        "allChampionLegal": not unique_illegal_champions_species,
    }


def _normalize_champions_team_header(line: str) -> str:
    raw = str(line or "")
    leading_match = re.match(r"^\s*", raw)
    leading = leading_match.group(0) if leading_match else ""
    body = raw[len(leading):]
    item_match = re.search(r"\s+@\s+", body)
    item_suffix = ""
    if item_match:
        item_suffix = body[item_match.start():]
        header = body[:item_match.start()].rstrip()
    else:
        header = body.strip()

    if not header:
        return raw

    nicknamed = re.match(r"^(?P<nickname>.+?)\s+\((?P<species>[^)]+)\)$", header)
    if nicknamed:
        canonical = _normalize_champions_species_alias(nicknamed.group("species"))
        if canonical:
            return f"{leading}{nicknamed.group('nickname')} ({canonical}){item_suffix}"

    gendered = re.match(r"^(?P<species>.+?)\s+\((?P<gender>[MF])\)$", header, re.IGNORECASE)
    if gendered:
        canonical = _normalize_champions_species_alias(gendered.group("species"))
        if canonical:
            return f"{leading}{canonical} ({gendered.group('gender').upper()}){item_suffix}"

    canonical = _normalize_champions_species_alias(header)
    if canonical:
        return f"{leading}{canonical}{item_suffix}"
    return raw


def _parse_allocation_line(line: str):
    raw = str(line or "").strip()
    if not re.match(r"^(EVs|SPs):", raw, re.IGNORECASE):
        return None
    body = raw.split(":", 1)[1].strip()
    if not body:
        return None
    values = {stat: 0 for stat in _STAT_ORDER}
    seen = set()
    for part in body.split("/"):
        chunk = part.strip()
        if not chunk:
            return None
        match = re.match(r"^(-?\d+)\s+([A-Za-z]+)$", chunk)
        if not match:
            return None
        stat = match.group(2).lower()
        if stat not in _STAT_LABEL_TO_CANONICAL:
            return None
        amount = int(match.group(1))
        if amount < 0 or stat in seen:
            return None
        seen.add(stat)
        values[stat] = amount
    return values


def _format_evs_line(values: dict) -> str:
    parts = [
        f"{int(values.get(stat) or 0)} {_STAT_LABEL_TO_CANONICAL[stat]}"
        for stat in _STAT_ORDER
        if int(values.get(stat) or 0) > 0
    ]
    if not parts:
        parts = ["0 HP"]
    return "EVs: " + " / ".join(parts)


def _format_sps_line(values: dict) -> str:
    parts = [f"{int(values.get(stat) or 0)} {_STAT_LABEL_TO_CANONICAL[stat]}" for stat in _STAT_ORDER]
    return "SPs: " + " / ".join(parts)


def _is_iv_line(line: str) -> bool:
    return bool(re.match(r"^\s*IVs:", str(line or ""), re.IGNORECASE))


def _ev_to_champions_sp(value: int) -> int:
    try:
        ev = max(int(value or 0), 0)
    except Exception:
        ev = 0
    return min(_CHAMPIONS_SP_PER_STAT_CAP, (ev + 4) // 8)


def _champions_sp_to_ev(value: int) -> int:
    try:
        point = max(int(value or 0), 0)
    except Exception:
        point = 0
    point = min(_CHAMPIONS_SP_PER_STAT_CAP, point)
    return _CHAMPIONS_SP_POINT_TO_EV[point]


def _map_allocation_values(values: dict, mapper) -> dict:
    return {stat: mapper(values.get(stat) or 0) for stat in _STAT_ORDER}


def _allocation_total(values: dict) -> int:
    total = 0
    for stat in _STAT_ORDER:
        try:
            total += max(int(values.get(stat) or 0), 0)
        except Exception:
            continue
    return total


def _stat_order_index(stat: str) -> int:
    try:
        return _STAT_ORDER.index(stat)
    except ValueError:
        return len(_STAT_ORDER)


def _apply_champions_remainder_fill(values: dict, source_ev_values: dict) -> dict:
    filled = dict(values or {})
    missing = _CHAMPIONS_SP_TOTAL_CAP - _allocation_total(filled)
    if missing <= 0:
        return filled

    while missing > 0:
        candidates = [
            stat for stat in _STAT_ORDER
            if max(int(source_ev_values.get(stat) or 0), 0) > 0
            and max(int(filled.get(stat) or 0), 0) > 0
            and max(int(filled.get(stat) or 0), 0) < _CHAMPIONS_SP_PER_STAT_CAP
        ]
        candidates.sort(key=lambda stat: (
            max(int(filled.get(stat) or 0), 0),
            max(int(source_ev_values.get(stat) or 0), 0),
            _stat_order_index(stat),
        ))
        if not candidates:
            break
        stat = candidates[0]
        filled[stat] = max(int(filled.get(stat) or 0), 0) + 1
        missing -= 1

    return filled


def _ev_allocation_to_champions_sp(values: dict, fill_remainder: bool = False) -> dict:
    mapped = _map_allocation_values(values, _ev_to_champions_sp)
    if fill_remainder:
        return _apply_champions_remainder_fill(mapped, values)
    return mapped


def _get_nature_lowered_stat(lines: list[str]) -> str | None:
    for line in lines or []:
        match = re.match(r"^\s*([A-Za-z]+)\s+Nature\s*$", str(line or ""), re.IGNORECASE)
        if not match:
            continue
        nature = match.group(1).strip().lower()
        if nature in _NATURE_LOWERED_STAT:
            return _NATURE_LOWERED_STAT[nature]
    return None


def _reverse_trim_rank(stat: str, nature_lowered_stat: str | None = None) -> int:
    if nature_lowered_stat and stat == nature_lowered_stat:
        return -1
    try:
        return _REVERSE_TRIM_TIE_ORDER.index(stat)
    except ValueError:
        return len(_REVERSE_TRIM_TIE_ORDER)


def _sort_reverse_trim_candidates(candidates: list[str], values: dict, source_sp_values: dict, nature_lowered_stat: str | None = None) -> list[str]:
    return sorted(candidates, key=lambda stat: (
        max(int(source_sp_values.get(stat) or 0), 0),
        max(int(values.get(stat) or 0), 0),
        _reverse_trim_rank(stat, nature_lowered_stat),
        _stat_order_index(stat),
    ))


def _trim_showdown_ev_overflow(values: dict, source_sp_values: dict, nature_lowered_stat: str | None = None) -> dict:
    trimmed = dict(values or {})
    excess = _allocation_total(trimmed) - _STANDARD_EV_TOTAL_CAP
    if excess <= 0:
        return trimmed

    while excess > 0:
        candidates = _sort_reverse_trim_candidates(
            [
                stat for stat in _STAT_ORDER
                if max(int(source_sp_values.get(stat) or 0), 0) > 0
                and max(int(source_sp_values.get(stat) or 0), 0) < _CHAMPIONS_SP_PER_STAT_CAP
                and max(int(trimmed.get(stat) or 0), 0) > 4
            ],
            trimmed,
            source_sp_values,
            nature_lowered_stat,
        )
        if not candidates:
            break
        stat = candidates[0]
        trimmed[stat] = max(int(trimmed.get(stat) or 0), 0) - 4
        excess -= 4

    while excess > 0:
        candidates = _sort_reverse_trim_candidates(
            [
                stat for stat in _STAT_ORDER
                if max(int(source_sp_values.get(stat) or 0), 0) > 0
                and max(int(source_sp_values.get(stat) or 0), 0) < _CHAMPIONS_SP_PER_STAT_CAP
                and max(int(trimmed.get(stat) or 0), 0) > 0
            ],
            trimmed,
            source_sp_values,
            nature_lowered_stat,
        )
        if not candidates:
            break
        stat = candidates[0]
        trim = min(4, max(int(trimmed.get(stat) or 0), 0), excess)
        trimmed[stat] = max(int(trimmed.get(stat) or 0), 0) - trim
        excess -= trim

    while excess > 0:
        candidates = _sort_reverse_trim_candidates(
            [stat for stat in _STAT_ORDER if max(int(trimmed.get(stat) or 0), 0) > 0],
            trimmed,
            source_sp_values,
            nature_lowered_stat,
        )
        if not candidates:
            break
        stat = candidates[0]
        trim = min(4, max(int(trimmed.get(stat) or 0), 0), excess)
        trimmed[stat] = max(int(trimmed.get(stat) or 0), 0) - trim
        excess -= trim

    return trimmed


def _champions_sp_allocation_to_showdown_evs(values: dict, nature_lowered_stat: str | None = None, trim_overflow: bool = False) -> dict:
    mapped = _map_allocation_values(values, _champions_sp_to_ev)
    if trim_overflow:
        return _trim_showdown_ev_overflow(mapped, values, nature_lowered_stat)
    return mapped


def _is_valid_champions_sp_values(values: dict) -> bool:
    total = 0
    for stat in _STAT_ORDER:
        try:
            amount = max(int(values.get(stat) or 0), 0)
        except Exception:
            return False
        if amount > _CHAMPIONS_SP_PER_STAT_CAP:
            return False
        total += amount
    return total <= _CHAMPIONS_SP_TOTAL_CAP


def _champions_sp_simulator_export(team_export: str, format_id: str | None) -> str:
    text = str(team_export or "")
    if not _is_champions_sp_format(format_id):
        return text
    blocks = re.split(r"\n{2,}", text.replace("\r\n", "\n").replace("\r", "\n"))
    rendered_blocks = []
    for block in blocks:
        lines = block.split("\n")
        nature_lowered_stat = _get_nature_lowered_stat(lines)
        out = []
        for line_index, line in enumerate(lines):
            if line_index == 0:
                line = _normalize_champions_team_header(line)
            if re.match(r"^\s*(EVs|SPs):", line, re.IGNORECASE):
                values = _parse_allocation_line(line)
                if values is None:
                    out.append(line)
                    continue
                if re.match(r"^\s*SPs:", line, re.IGNORECASE):
                    if not _is_valid_champions_sp_values(values):
                        out.append(line)
                        continue
                    values = _champions_sp_allocation_to_showdown_evs(values, nature_lowered_stat=nature_lowered_stat, trim_overflow=True)
                elif _is_valid_champions_sp_values(values):
                    values = _champions_sp_allocation_to_showdown_evs(values, nature_lowered_stat=nature_lowered_stat, trim_overflow=True)
                out.append(_format_evs_line(values))
            else:
                out.append(line)
        rendered_blocks.append("\n".join(out))
    return "\n\n".join(rendered_blocks)


def get_champions_sp_simulator_export(team_export: str, format_id: str | None) -> str:
    return _champions_sp_simulator_export(team_export, format_id)


def _champions_sp_display_export(team_export: str, format_id: str | None) -> str:
    text = str(team_export or "")
    if not _is_champions_sp_format(format_id):
        return text
    out = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if _is_iv_line(line):
            continue
        if re.match(r"^\s*(EVs|SPs):", line, re.IGNORECASE):
            values = _parse_allocation_line(line)
            if values is None:
                out.append(line)
                continue
            if re.match(r"^\s*EVs:", line, re.IGNORECASE) and not _is_valid_champions_sp_values(values):
                values = _ev_allocation_to_champions_sp(values, fill_remainder=True)
            elif _is_valid_champions_sp_values(values):
                values = _apply_champions_remainder_fill(values, values)
            if not _is_valid_champions_sp_values(values):
                out.append(line)
                continue
            out.append(_format_evs_line(values))
        else:
            out.append(line)
    return "\n".join(out)


def get_champions_sp_display_export(team_export: str, format_id: str | None) -> str:
    return _champions_sp_display_export(team_export, format_id)


def _pack_cache_key(record: dict, format_id: str | None, team_export: str) -> tuple[str, str, str]:
    record_id = str(record.get("id") or "").strip()
    fmt = str(format_id or "").strip().lower()
    fingerprint = hashlib.sha1(str(team_export or "").replace("\r\n", "\n").strip().encode("utf-8")).hexdigest()
    return (record_id, fmt, fingerprint)


def _validation_cache_key(record: dict, format_id: str | None, team_export: str) -> tuple[str, str, str]:
    return _pack_cache_key(record, format_id, team_export)


def _cached_hydrated_record(record: dict, format_id: str | None):
    is_champions = _is_champions_sp_format(format_id)
    validation_required = _repo_validation_enabled()
    if validation_required and not is_champions:
        return None
    species_validation = None
    if is_champions:
        species_validation = _champions_species_validation_for_export(record.get("teamExport") or "", format_id)
        if not species_validation.get("valid"):
            return None
    _load_hydration_cache()
    metadata = _hydration_cache_metadata(record, format_id)
    cache_key = _hydration_cache_key(record, format_id)
    with _hydration_cache_lock:
        entry = dict(_hydration_cache.get(cache_key) or {})
    if not _hydration_cache_entry_matches(entry, metadata):
        return None
    if validation_required and not bool(entry.get("repoValidationEnabled")):
        return None
    packed = str(entry.get("packedTeam") or "").strip()
    if not packed:
        return None
    validation = entry.get("validation") if isinstance(entry.get("validation"), dict) else _default_validation(format_id)
    if is_champions and species_validation:
        validation = dict(validation)
        validation["speciesScan"] = species_validation.get("speciesScan")
        validation["aliasesNormalized"] = species_validation.get("aliasesNormalized") or []
        validation["unresolvedSpecies"] = []
    packing = {
        "ok": True,
        "packedTeam": packed,
        "method": "persistent-repo-cache",
    }
    return _build_hydrated_record(record, format_id, validation, packing)


def _remember_hydrated_record(record: dict, format_id: str | None, hydrated: dict, persist: bool = True) -> bool:
    is_champions = _is_champions_sp_format(format_id)
    validation_enabled = _repo_validation_enabled()
    if validation_enabled and not is_champions:
        return False
    packed = str((hydrated or {}).get("packedTeam") or "").strip()
    if not packed or not bool((hydrated or {}).get("validForFormat")) or not bool((hydrated or {}).get("packedTeamAvailable")):
        return False
    if is_champions and (hydrated.get("unresolvedSpecies") or []):
        return False
    _load_hydration_cache()
    metadata = _hydration_cache_metadata(record, format_id)
    cache_key = _hydration_cache_key(record, format_id)
    validation = {
        "ok": bool(hydrated.get("validForFormat")),
        "valid": bool(hydrated.get("validForFormat")),
        "messages": hydrated.get("validationMessages", ""),
        "formatId": format_id or None,
        "method": "persistent-cache-rehydrated-validation",
        "speciesScan": hydrated.get("speciesScan"),
        "aliasesNormalized": list(hydrated.get("aliasesNormalized") or []),
        "unresolvedSpecies": list(hydrated.get("unresolvedSpecies") or []),
    }
    entry = {
        "recordId": record.get("id"),
        "formatId": metadata["formatId"],
        "opponentFingerprint": record.get("opponentFingerprint"),
        "teamFingerprint": metadata["teamFingerprint"],
        "showdownHelperVersion": metadata["showdownHelperVersion"],
        "speciesAliasToken": metadata["speciesAliasToken"],
        "packedTeam": packed,
        "validation": validation,
        "repoValidationEnabled": bool(validation_enabled),
        "name": record.get("name"),
        "featured": bool(record.get("featured")),
        "sourcePath": record.get("sourcePath"),
        "cachedAt": int(time.time()),
    }
    with _hydration_cache_lock:
        previous = _hydration_cache.get(cache_key)
        if (
            previous
            and previous.get("packedTeam") == packed
            and _hydration_cache_entry_matches(previous, metadata)
            and (not validation_enabled or bool(previous.get("repoValidationEnabled")))
        ):
            return False
        _hydration_cache[cache_key] = entry
    if persist:
        _save_hydration_cache()
    return True


def _build_hydrated_record(record: dict, format_id: str | None, validation: dict, packing: dict) -> dict:
    team_export = _champions_sp_display_export(record["teamExport"], format_id)
    return {
        "id": record["id"],
        "opponentRegistryId": int(record.get("opponentRegistryId") or 0),
        "opponentRegistryLabel": record.get("opponentRegistryLabel"),
        "opponentFingerprint": record.get("opponentFingerprint"),
        "templateKey": record["templateKeys"][0] if record["templateKeys"] else "direct-pressure-offense",
        "templateKeys": list(record["templateKeys"]),
        "name": record["name"],
        "archetype": record.get("archetype"),
        "archetypeMetadata": dict(record.get("archetypeMetadata") or {}),
        "source": record["source"],
        "summary": record["summary"],
        "notes": list(record["notes"]),
        "teamPreview": list(record["teamPreview"]),
        "teamExport": team_export,
        "validForFormat": bool(validation.get("valid")),
        "formatId": format_id or None,
        "packedTeamAvailable": bool(packing.get("ok") and packing.get("packedTeam")),
        "packedTeam": packing.get("packedTeam"),
        "validationMessages": validation.get("messages", ""),
        "speciesScan": validation.get("speciesScan"),
        "unresolvedSpecies": list(validation.get("unresolvedSpecies") or []),
        "aliasesNormalized": list(validation.get("aliasesNormalized") or []),
        "featured": bool(record.get("featured")),
        "sourcePath": record["sourcePath"],
        "hydrationMethod": packing.get("method"),
    }


def _default_validation(format_id: str | None) -> dict:
    return {
        "ok": True,
        "valid": True,
        "messages": "Opponent validation skipped; approved opponent source teams are trusted for selection speed.",
        "formatId": format_id or None,
        "method": "trusted-source-pool-skip-validation",
    }


def _hydrate_record(record: dict, format_id: str | None) -> dict:
    record_id = str(record["id"])
    fmt = str(format_id or "").strip().lower()
    team_export = _champions_sp_simulator_export(record["teamExport"], format_id)
    species_validation = _champions_species_validation_for_export(record["teamExport"], format_id)
    if not species_validation.get("valid"):
        return _build_hydrated_record(record, format_id, species_validation, _blocked_champions_species_packing(species_validation))
    cache_key = _validation_cache_key(record, format_id, team_export)

    if _repo_validation_enabled():
        validation = _validation_cache.get(cache_key)
        if validation is None:
            validation = validate_team_export(team_export, format_id or "")
            _validation_cache[cache_key] = validation
    else:
        validation = _default_validation(format_id)
        if _is_champions_sp_format(format_id):
            validation = dict(validation)
            validation["speciesScan"] = species_validation.get("speciesScan")
            validation["aliasesNormalized"] = species_validation.get("aliasesNormalized") or []
            validation["unresolvedSpecies"] = []

    packing_key = _pack_cache_key(record, format_id, team_export)
    packing = _pack_cache.get(packing_key)
    if packing is None:
        packing = pack_team_export(team_export)
        _pack_cache[packing_key] = packing

    return _build_hydrated_record(record, format_id, validation, packing)


def get_repo_opponent_records(format_id: str | None = None, featured_only: bool = False, limit: int | None = None) -> list[dict]:
    if _is_champions_sp_format(format_id):
        return _get_championlab_opponent_records(format_id=format_id, featured_only=featured_only, limit=limit)
    return _get_aegis_opponent_records(format_id=format_id, featured_only=featured_only, limit=limit)


def hydrate_repo_opponent_records(records: list[dict], format_id: str | None = None) -> list[dict]:
    records = list(records or [])
    if not records:
        return []

    validate_opponents = _repo_validation_enabled()
    fmt = str(format_id or "").strip().lower()
    cached_hydrated = [None] * len(records)
    validations = [None] * len(records)
    team_exports = [None] * len(records)

    for index, record in enumerate(records):
        cached = _cached_hydrated_record(record, format_id)
        if cached is not None:
            cached_hydrated[index] = cached
            continue

        record_id = str(record["id"])
        team_export = _champions_sp_simulator_export(record["teamExport"], format_id)
        team_exports[index] = team_export
        species_validation = _champions_species_validation_for_export(record["teamExport"], format_id)
        if not species_validation.get("valid"):
            validations[index] = species_validation
            continue
        cache_key = _validation_cache_key(record, format_id, team_export)
        if validate_opponents:
            validation = _validation_cache.get(cache_key)
            if validation is None:
                validation = validate_team_export(team_export, format_id or "")
                _validation_cache[cache_key] = validation
        else:
            validation = _default_validation(format_id)
            if _is_champions_sp_format(format_id):
                validation = dict(validation)
                validation["speciesScan"] = species_validation.get("speciesScan")
                validation["aliasesNormalized"] = species_validation.get("aliasesNormalized") or []
                validation["unresolvedSpecies"] = []
        validations[index] = validation

    packings = [None] * len(records)
    missing_indices = []
    missing_exports = []
    for index, record in enumerate(records):
        if cached_hydrated[index] is not None:
            continue
        if validations[index] and not validations[index].get("valid"):
            packings[index] = _blocked_champions_species_packing(validations[index])
            continue
        team_export = team_exports[index] or _champions_sp_simulator_export(record["teamExport"], format_id)
        cache_key = _pack_cache_key(record, format_id, team_export)
        cached = _pack_cache.get(cache_key)
        if cached is not None:
            packings[index] = cached
        else:
            missing_indices.append(index)
            missing_exports.append(team_export)

    if missing_exports:
        bulk_packings = pack_team_exports_bulk(missing_exports)
        for local_index, packing in enumerate(bulk_packings):
            original_index = missing_indices[local_index]
            record = records[original_index]
            team_export = team_exports[original_index] or _champions_sp_simulator_export(record["teamExport"], format_id)
            _pack_cache[_pack_cache_key(record, format_id, team_export)] = packing
            packings[original_index] = packing

    hydrated_records = []
    hydration_cache_changed = False
    for index, record in enumerate(records):
        if cached_hydrated[index] is not None:
            hydrated_records.append(cached_hydrated[index])
            continue
        hydrated = _build_hydrated_record(record, format_id, validations[index] or _default_validation(format_id), packings[index] or {})
        hydrated_records.append(hydrated)
        if hydrated.get("validForFormat") and hydrated.get("packedTeamAvailable") and hydrated.get("packedTeam"):
            hydration_cache_changed = (
                _remember_hydrated_record(record, format_id, hydrated, persist=False)
                or hydration_cache_changed
            )

    if hydration_cache_changed:
        _save_hydration_cache()

    return hydrated_records


def get_repo_opponents_for_template(template_key: str, format_id: str | None = None) -> list[dict]:
    candidates = [r for r in get_repo_opponent_records(format_id=format_id) if template_key in r.get("templateKeys", [])]
    candidates.sort(key=lambda r: (not r.get("featured", False), r["name"].lower()))
    limited = candidates[: _candidate_limit()]
    return hydrate_repo_opponent_records(limited, format_id)


def get_repo_opponent_by_id(opponent_id: str, format_id: str | None = None):
    oid = str(opponent_id or "").strip().lower()
    if not (oid.startswith("aegis-limitless-") or oid.startswith("championlab-")):
        return None
    for record in get_repo_opponent_records(format_id=format_id):
        if str(record["id"]).strip().lower() == oid:
            return _hydrate_record(record, format_id)
    return None


def get_repo_opponents(format_id: str | None = None, featured_only: bool = False, limit: int | None = None) -> list[dict]:
    records = get_repo_opponent_records(format_id=format_id, featured_only=featured_only, limit=limit)
    return hydrate_repo_opponent_records(records, format_id)


def warm_repo_opponent_cache(format_id: str | None = None, featured_only: bool = True, limit: int | None = None) -> dict:
    started = time.time()
    records = get_repo_opponent_records(format_id=format_id, featured_only=featured_only, limit=limit)
    species_scan = scan_champions_pool_species(format_id=format_id, records=records) if _is_champions_sp_format(format_id) else None
    hydrated = hydrate_repo_opponent_records(records, format_id)
    ready = [item for item in hydrated if item.get("validForFormat") and item.get("packedTeamAvailable") and item.get("packedTeam")]
    return {
        "formatId": format_id or None,
        "featuredOnly": bool(featured_only),
        "requestedLimit": limit,
        "records": len(records),
        "ready": len(ready),
        "source": _CHAMPIONLAB_SOURCE if _is_champions_sp_format(format_id) else _AEGIS_LIMITLESS_SOURCE,
        "durationMs": int(round((time.time() - started) * 1000)),
        "loaderVersion": REPO_TEAM_LOADER_VERSION,
        "speciesScan": species_scan,
    }


def get_repo_summary(format_id: str | None = None) -> dict:
    if _is_champions_sp_format(format_id):
        return _championlab_summary(format_id=format_id)
    reg = get_reg_from_format_id(format_id)
    records = _get_aegis_opponent_records(format_id=format_id, featured_only=False)
    featured_count = sum(1 for r in records if r.get("featured"))
    return {
        "repoRoot": None,
        "reg": reg,
        "teamCount": len(records),
        "featuredCount": featured_count,
        "candidateLimit": _candidate_limit(),
        "source": _AEGIS_LIMITLESS_SOURCE,
        "loaderVersion": REPO_TEAM_LOADER_VERSION,
    }
