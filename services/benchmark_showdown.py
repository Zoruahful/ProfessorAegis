import hashlib
import json
import os
import shlex
import subprocess
import threading
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SHOWDOWN_HELPER_VERSION = "2026.04.26-showdown-helper-v20-dist-auto-heal-guard"

_process_lock = threading.Lock()
_managed_process = None
_managed_command = None
_managed_started_at = None
_pack_cache = {}
_pack_cache_loaded = False
_pack_cache_lock = threading.Lock()
_dist_auto_heal_lock = threading.Lock()



def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "1" if default else "0")).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, str(default))).strip())
    except Exception:
        return default


def get_showdown_config():
    url = str(os.getenv("BENCHMARK_SHOWDOWN_URL", "http://127.0.0.1:8000")).strip() or "http://127.0.0.1:8000"
    parsed = urlparse(url)
    port = parsed.port or 8000
    cli_timeout = _env_int("BENCHMARK_SHOWDOWN_CLI_TIMEOUT_MS", 15000)
    pack_timeout = _env_int("BENCHMARK_SHOWDOWN_PACK_TIMEOUT_MS", max(cli_timeout, 30000))
    pack_retries = _env_int("BENCHMARK_SHOWDOWN_PACK_RETRIES", 3)
    library_pack_retries = _env_int("BENCHMARK_SHOWDOWN_LIBRARY_PACK_RETRIES", 1)
    pack_retry_sleep_ms = _env_int("BENCHMARK_SHOWDOWN_PACK_RETRY_SLEEP_MS", 400)

    return {
        "enabled": _env_bool("BENCHMARK_SHOWDOWN_ENABLED", False),
        "url": url,
        "timeoutMs": _env_int("BENCHMARK_SHOWDOWN_TIMEOUT_MS", 1500),
        "autoStart": _env_bool("BENCHMARK_SHOWDOWN_AUTOSTART", False),
        "port": port,
        "dir": str(os.getenv("BENCHMARK_SHOWDOWN_DIR", "")).strip(),
        "command": str(os.getenv("BENCHMARK_SHOWDOWN_COMMAND", "")).strip(),
        "cliTimeoutMs": cli_timeout,
        "packTimeoutMs": pack_timeout,
        "packRetries": max(pack_retries, 1),
        "libraryPackRetries": max(library_pack_retries, 1),
        "packRetrySleepMs": max(pack_retry_sleep_ms, 0),
        "packStrategy": str(os.getenv("BENCHMARK_SHOWDOWN_PACK_STRATEGY", "cli-first")).strip().lower() or "cli-first",
        "packCachePath": str(os.getenv("BENCHMARK_PACK_CACHE_PATH", "")).strip(),
        "formatId": str(os.getenv("BENCHMARK_SHOWDOWN_FORMAT", "")).strip(),
        "battleTimeoutMs": _env_int("BENCHMARK_SHOWDOWN_BATTLE_TIMEOUT_MS", 30000),
    }


def _default_command(config):
    if config["command"]:
        return config["command"]
    if config["dir"]:
        return f'node pokemon-showdown start {config["port"]} --no-security'
    return ""


def _probe_showdown(url: str, timeout_ms: int):
    try:
        req = Request(url, headers={"User-Agent": "Professor-Aegis-BenchMark/1.0"})
        with urlopen(req, timeout=max(timeout_ms / 1000.0, 0.5)) as response:
            body = response.read(512).decode("utf-8", errors="ignore")
            status_code = getattr(response, "status", 200)
            text = body.lower()
            looks_valid = (
                "showdown" in text
                or "battle" in text
                or "lobby" in text
                or status_code in (200, 302, 403)
            )
            return {
                "reachable": looks_valid,
                "statusCode": status_code,
                "detail": f"HTTP {status_code} from {url}",
            }
    except Exception as exc:
        return {
            "reachable": False,
            "statusCode": None,
            "detail": str(exc),
        }


def is_showdown_reachable():
    config = get_showdown_config()
    probe = _probe_showdown(config["url"], config["timeoutMs"])
    return probe["reachable"], probe


def _managed_pid():
    with _process_lock:
        if _managed_process and _managed_process.poll() is None:
            return _managed_process.pid
    return None


def _cli_command_base():
    config = get_showdown_config()
    if not config["dir"]:
        return None
    return ["node", "pokemon-showdown"]


def _run_showdown_cli(subcommand, stdin_text=None, extra_args=None, timeout_ms=None):
    config = get_showdown_config()
    if not config["dir"]:
        return {
            "ok": False,
            "error": "BENCHMARK_SHOWDOWN_DIR is not configured.",
            "stdout": "",
            "stderr": "",
            "returnCode": None,
        }

    base = _cli_command_base()
    if not base:
        return {
            "ok": False,
            "error": "Showdown CLI command could not be built.",
            "stdout": "",
            "stderr": "",
            "returnCode": None,
        }

    cmd = [*base, subcommand]
    if extra_args:
        cmd.extend(extra_args)

    effective_timeout_ms = timeout_ms if timeout_ms is not None else config["cliTimeoutMs"]

    try:
        completed = subprocess.run(
            cmd,
            cwd=config["dir"],
            input=stdin_text or "",
            capture_output=True,
            text=True,
            timeout=max(effective_timeout_ms / 1000.0, 1.0),
        )
        return {
            "ok": completed.returncode == 0,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "returnCode": completed.returncode,
            "command": " ".join(shlex.quote(part) for part in cmd),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "stdout": "",
            "stderr": "",
            "returnCode": None,
            "command": " ".join(shlex.quote(part) for part in cmd),
        }


def _normalized_team_text(team_export: str) -> str:
    return str(team_export or "").replace("\r\n", "\n").strip()


def _team_cache_key(team_export: str) -> str:
    normalized = _normalized_team_text(team_export)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _default_pack_cache_path(config=None):
    config = config or get_showdown_config()
    configured = str(config.get("packCachePath") or "").strip()
    if configured:
        return configured
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root_dir, "benchmark_cache", "packed_teams.json")


def _load_persistent_pack_cache(config=None):
    global _pack_cache_loaded
    if _pack_cache_loaded:
        return
    config = config or get_showdown_config()
    path = _default_pack_cache_path(config)
    with _pack_cache_lock:
        if _pack_cache_loaded:
            return
        try:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                entries = payload.get("entries") if isinstance(payload, dict) else None
                if isinstance(entries, dict):
                    for key, packed in entries.items():
                        if isinstance(key, str) and isinstance(packed, str) and packed.strip():
                            _pack_cache[key] = packed.strip()
        except Exception:
            pass
        _pack_cache_loaded = True


def _save_persistent_pack_cache(config=None):
    config = config or get_showdown_config()
    path = _default_pack_cache_path(config)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with _pack_cache_lock:
            payload = {
                "version": SHOWDOWN_HELPER_VERSION,
                "updatedAt": int(time.time()),
                "entries": dict(_pack_cache),
            }
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
        os.replace(tmp_path, path)
    except Exception:
        pass


def _remember_packed_team(cache_key: str, packed: str, config=None, persist: bool = True) -> bool:
    if not cache_key or not packed:
        return False
    _load_persistent_pack_cache(config)
    with _pack_cache_lock:
        if _pack_cache.get(cache_key) == packed:
            return False
        _pack_cache[cache_key] = packed
    if persist:
        _save_persistent_pack_cache(config)
    return True


def _run_pack_with_node_library_once(team_export: str, timeout_ms: int):
    config = get_showdown_config()
    if not config["dir"]:
        return {
            "ok": False,
            "error": "BENCHMARK_SHOWDOWN_DIR is not configured.",
            "stdout": "",
            "stderr": "",
            "returnCode": None,
            "command": "node -e <Teams.pack helper>",
            "method": "node-library",
        }

    script = r"""
const fs = require('fs');
(async () => {
  try {
    const ps = require(process.cwd());
    if (!ps || !ps.Teams || typeof ps.Teams.import !== 'function' || typeof ps.Teams.pack !== 'function') {
      throw new Error('Showdown Teams API not available from process.cwd()');
    }
    const input = fs.readFileSync(0, 'utf8');
    const imported = ps.Teams.import(input);
    const packed = ps.Teams.pack(imported);
    if (!packed) {
      console.error('Teams.pack returned an empty result.');
      process.exit(2);
      return;
    }
    process.stdout.write(packed);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
})();
""".strip()

    cmd = ["node", "-e", script]
    try:
        completed = subprocess.run(
            cmd,
            cwd=config["dir"],
            input=_normalized_team_text(team_export),
            capture_output=True,
            text=True,
            timeout=max(timeout_ms / 1000.0, 1.0),
        )
        return {
            "ok": completed.returncode == 0 and bool((completed.stdout or "").strip()),
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "returnCode": completed.returncode,
            "command": "node -e <Teams.import/Teams.pack helper>",
            "method": "node-library",
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "stdout": "",
            "stderr": "",
            "returnCode": None,
            "command": "node -e <Teams.import/Teams.pack helper>",
            "method": "node-library",
        }


def _retry_pack(method_name, callback, retries, sleep_ms):
    attempts = []
    packed = None

    for attempt in range(1, retries + 1):
        result = callback()
        result["attempt"] = attempt
        attempts.append(result)

        packed = (result.get("stdout") or "").strip()
        if result.get("ok") and packed:
            return {
                "ok": True,
                "packedTeam": packed,
                "result": result,
                "attempts": attempts,
                "method": method_name,
            }

        if attempt < retries and sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)

    return {
        "ok": False,
        "packedTeam": None,
        "result": attempts[-1] if attempts else None,
        "attempts": attempts,
        "method": method_name,
    }


def _pack_cache_hit_response(packed: str):
    return {
        "ok": True,
        "packedTeam": packed,
        "stdout": packed,
        "stderr": "",
        "returnCode": 0,
        "command": "cache-hit",
        "error": None,
        "method": "cache",
        "attempts": [],
    }


def _run_bulk_pack_with_node_library_once(team_exports: list[str], timeout_ms: int):
    config = get_showdown_config()
    if not config["dir"]:
        return {
            "ok": False,
            "error": "BENCHMARK_SHOWDOWN_DIR is not configured.",
            "stdout": "",
            "stderr": "",
            "returnCode": None,
            "command": "node -e <Teams.bulk-pack helper>",
            "method": "node-library-bulk",
        }

    script = r"""
const fs = require('fs');
(async () => {
  try {
    const ps = require(process.cwd());
    if (!ps || !ps.Teams || typeof ps.Teams.import !== 'function' || typeof ps.Teams.pack !== 'function') {
      throw new Error('Showdown Teams API not available from process.cwd()');
    }
    const input = fs.readFileSync(0, 'utf8');
    const teams = JSON.parse(input);
    if (!Array.isArray(teams)) throw new Error('Bulk pack input must be an array.');
    const out = teams.map((team, index) => {
      try {
        const imported = ps.Teams.import(String(team || ''));
        const packed = ps.Teams.pack(imported);
        if (!packed) return { ok: false, index, error: 'Teams.pack returned an empty result.' };
        return { ok: true, index, packedTeam: packed };
      } catch (error) {
        return { ok: false, index, error: error && error.message ? error.message : String(error) };
      }
    });
    process.stdout.write(JSON.stringify(out));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
})();
""".strip()

    cmd = ["node", "-e", script]
    try:
        completed = subprocess.run(
            cmd,
            cwd=config["dir"],
            input=json.dumps([_normalized_team_text(team) for team in team_exports]),
            capture_output=True,
            text=True,
            timeout=max(timeout_ms / 1000.0, 1.0),
        )
        return {
            "ok": completed.returncode == 0 and bool((completed.stdout or "").strip()),
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "returnCode": completed.returncode,
            "command": "node -e <Teams.import/Teams.pack bulk helper>",
            "method": "node-library-bulk",
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "stdout": "",
            "stderr": "",
            "returnCode": None,
            "command": "node -e <Teams.import/Teams.pack bulk helper>",
            "method": "node-library-bulk",
        }


def pack_team_exports_bulk(team_exports: list[str]):
    config = get_showdown_config()
    _load_persistent_pack_cache(config)
    normalized = [_normalized_team_text(team) for team in (team_exports or [])]
    results = [None] * len(normalized)
    missing_indices = []
    missing_teams = []

    for index, team in enumerate(normalized):
        cached = _pack_cache.get(_team_cache_key(team))
        if cached:
            results[index] = _pack_cache_hit_response(cached)
        else:
            missing_indices.append(index)
            missing_teams.append(team)

    if missing_teams:
        base_timeout = int(config.get("packTimeoutMs") or 30000)
        bulk_timeout = max(base_timeout, base_timeout * min(len(missing_teams), 4))
        bulk = _run_bulk_pack_with_node_library_once(missing_teams, bulk_timeout)
        parsed = None
        if bulk.get("ok"):
            try:
                parsed = json.loads(bulk.get("stdout") or "[]")
            except Exception:
                parsed = None

        if isinstance(parsed, list) and len(parsed) == len(missing_teams):
            cache_changed = False
            for local_index, item in enumerate(parsed):
                original_index = missing_indices[local_index]
                packed = (item or {}).get("packedTeam")
                if (item or {}).get("ok") and packed:
                    cache_changed = (
                        _remember_packed_team(
                            _team_cache_key(normalized[original_index]),
                            packed,
                            config,
                            persist=False,
                        )
                        or cache_changed
                    )
                    results[original_index] = {
                        "ok": True,
                        "packedTeam": packed,
                        "stdout": packed,
                        "stderr": "",
                        "returnCode": 0,
                        "command": bulk.get("command"),
                        "error": None,
                        "method": "node-library-bulk",
                        "attempts": [bulk],
                    }
                else:
                    results[original_index] = {
                        "ok": False,
                        "packedTeam": None,
                        "stdout": "",
                        "stderr": bulk.get("stderr", ""),
                        "returnCode": bulk.get("returnCode"),
                        "command": bulk.get("command"),
                        "error": (item or {}).get("error") or bulk.get("error"),
                        "method": "node-library-bulk",
                        "attempts": [bulk],
                    }
            if cache_changed:
                _save_persistent_pack_cache(config)
        else:
            for original_index in missing_indices:
                results[original_index] = pack_team_export(normalized[original_index])

    return results


def pack_team_export(team_export):
    config = get_showdown_config()
    _load_persistent_pack_cache(config)
    normalized = _normalized_team_text(team_export)
    cache_key = _team_cache_key(normalized)

    cached = _pack_cache.get(cache_key)
    if cached:
        return _pack_cache_hit_response(cached)

    strategy = str(config.get("packStrategy") or "cli-first").lower()
    prefer_library = strategy in {"library-first", "node-library", "node-first"}

    library_pack = {"ok": False, "attempts": [], "result": {}}
    cli_pack = {"ok": False, "attempts": [], "result": {}}

    if not prefer_library:
        cli_pack = _retry_pack(
            "cli-first",
            lambda: _run_showdown_cli("pack-team", stdin_text=normalized, timeout_ms=config["packTimeoutMs"]),
            config["packRetries"],
            config["packRetrySleepMs"],
        )
        if cli_pack["ok"]:
            packed = cli_pack["packedTeam"]
            _remember_packed_team(cache_key, packed, config)
            final = cli_pack["result"]
            return {
                "ok": True,
                "packedTeam": packed,
                "stdout": final.get("stdout", ""),
                "stderr": final.get("stderr", ""),
                "returnCode": final.get("returnCode"),
                "command": final.get("command"),
                "error": final.get("error"),
                "method": "cli-first",
                "attempts": cli_pack["attempts"],
                "libraryAttempts": [],
            }

    library_pack = _retry_pack(
        "node-library",
        lambda: _run_pack_with_node_library_once(normalized, config["packTimeoutMs"]),
        config.get("libraryPackRetries") or 1,
        config["packRetrySleepMs"],
    )
    if library_pack["ok"]:
        packed = library_pack["packedTeam"]
        _remember_packed_team(cache_key, packed, config)
        final = library_pack["result"]
        return {
            "ok": True,
            "packedTeam": packed,
            "stdout": final.get("stdout", ""),
            "stderr": final.get("stderr", ""),
            "returnCode": final.get("returnCode"),
            "command": final.get("command"),
            "error": final.get("error"),
            "method": "node-library",
            "attempts": library_pack["attempts"],
        }

    if prefer_library:
        cli_pack = _retry_pack(
            "cli-fallback",
            lambda: _run_showdown_cli("pack-team", stdin_text=normalized, timeout_ms=config["packTimeoutMs"]),
            config["packRetries"],
            config["packRetrySleepMs"],
        )
        if cli_pack["ok"]:
            packed = cli_pack["packedTeam"]
            _remember_packed_team(cache_key, packed, config)
            final = cli_pack["result"]
            return {
                "ok": True,
                "packedTeam": packed,
                "stdout": final.get("stdout", ""),
                "stderr": final.get("stderr", ""),
                "returnCode": final.get("returnCode"),
                "command": final.get("command"),
                "error": final.get("error"),
                "method": "cli-fallback",
                "attempts": cli_pack["attempts"],
                "libraryAttempts": library_pack["attempts"],
            }

    final_cli = cli_pack.get("result") or {}
    final_library = library_pack.get("result") or {}

    return {
        "ok": False,
        "packedTeam": None,
        "stdout": final_cli.get("stdout", ""),
        "stderr": final_cli.get("stderr", ""),
        "returnCode": final_cli.get("returnCode"),
        "command": final_cli.get("command"),
        "error": final_cli.get("error") or final_library.get("error"),
        "method": "pack-failed",
        "attempts": cli_pack.get("attempts") or [],
        "libraryAttempts": library_pack.get("attempts") or [],
        "libraryFallback": {
            "ok": library_pack.get("ok"),
            "returnCode": final_library.get("returnCode"),
            "stderr": final_library.get("stderr", ""),
            "error": final_library.get("error"),
        },
    }

def validate_team_export(team_export, format_id=""):
    chosen_format = str(format_id or "").strip() or (get_showdown_config().get("formatId") or "")
    extra_args = [chosen_format] if chosen_format else []
    result = _run_showdown_cli("validate-team", stdin_text=team_export, extra_args=extra_args)
    stderr = (result.get("stderr") or "").strip()
    stdout = (result.get("stdout") or "").strip()
    messages = stderr or stdout
    return {
        "ok": bool(result.get("ok")),
        "valid": bool(result.get("ok")),
        "messages": messages,
        "stdout": result.get("stdout", ""),
        "stderr": result.get("stderr", ""),
        "returnCode": result.get("returnCode"),
        "command": result.get("command"),
        "formatId": chosen_format or None,
        "error": result.get("error"),
    }


def start_showdown_if_needed(force: bool = False):
    config = get_showdown_config()
    if not config["enabled"]:
        return {"ok": False, "message": "Showdown integration is disabled by environment."}

    reachable, probe = is_showdown_reachable()
    if reachable and not force:
        return {"ok": True, "message": "Showdown server is already reachable.", "probe": probe}

    command = _default_command(config)
    if not command:
        return {
            "ok": False,
            "message": "No Showdown command configured. Set BENCHMARK_SHOWDOWN_COMMAND or BENCHMARK_SHOWDOWN_DIR.",
        }

    with _process_lock:
        global _managed_process, _managed_command, _managed_started_at
        if _managed_process and _managed_process.poll() is None and not force:
            return {
                "ok": True,
                "message": "Managed Showdown process is already running.",
                "pid": _managed_process.pid,
            }

        cwd = config["dir"] or None
        _managed_process = subprocess.Popen(
            shlex.split(command),
            cwd=cwd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _managed_command = command
        _managed_started_at = time.time()

    for _ in range(20):
        time.sleep(0.5)
        reachable, probe = is_showdown_reachable()
        if reachable:
            return {
                "ok": True,
                "message": "Showdown server started and is reachable.",
                "pid": _managed_pid(),
                "probe": probe,
            }

    return {
        "ok": False,
        "message": "Tried to start Showdown, but it is still not reachable.",
        "pid": _managed_pid(),
    }


def stop_managed_showdown():
    with _process_lock:
        global _managed_process, _managed_command, _managed_started_at
        if not _managed_process or _managed_process.poll() is not None:
            _managed_process = None
            _managed_command = None
            _managed_started_at = None
            return {"ok": True, "message": "No managed Showdown process is running."}

        _managed_process.terminate()
        try:
            _managed_process.wait(timeout=5)
        except Exception:
            _managed_process.kill()

        pid = _managed_process.pid
        _managed_process = None
        _managed_command = None
        _managed_started_at = None
        return {"ok": True, "message": "Managed Showdown process stopped.", "pid": pid}




AEGIS_CUSTOM_FORMATS_TS = """// Auto-normalized by Professor Aegis BenchMark.
// Keeps the local Pokemon Showdown config/custom-formats.ts compatible with
// the benchmark runner. The important requirement is that Formats exports an array.

import type {FormatList} from '../sim/dex-formats';

export const Formats: FormatList = [
  {
    section: 'Professor Aegis',
    column: 4,
  },
  {
    name: '[Gen 9] BenchMark Doubles AG',
    mod: 'gen9',
    gameType: 'doubles',
    searchShow: false,
    challengeShow: true,
    tournamentShow: false,
    bestOfDefault: true,
    battle: {trunc: Math.trunc},
    debug: true,
    ruleset: [
      'Team Preview',
      'Cancel Mod',
      'Min Team Size = 4',
      'Picked Team Size = 4',
      'Max Team Size = 6',
      'Adjust Level = 50',
    ],
  },
  {
    name: '[Gen 9 Champions] Custom Game',
    mod: 'champions',
    gameType: 'doubles',
    searchShow: false,
    debug: true,
    battle: {trunc: Math.trunc},
    ruleset: [
      'Team Preview',
      'Cancel Mod',
      'Picked Team Size = 4',
      'Max Team Size = 24',
      'Max Move Count = 24',
      'Max Level = 9999',
      'Default Level = 50',
    ],
    banlist: [],
    onBegin() {
      this.reportPercentages = true;
    },
  },
];
"""


AEGIS_CUSTOM_FORMATS_JS = """"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var custom_formats_exports = {};
__export(custom_formats_exports, {
  Formats: () => Formats
});
module.exports = __toCommonJS(custom_formats_exports);
const Formats = [
  {
    section: "Professor Aegis",
    column: 4
  },
  {
    name: "[Gen 9] BenchMark Doubles AG",
    mod: "gen9",
    gameType: "doubles",
    searchShow: false,
    challengeShow: true,
    tournamentShow: false,
    bestOfDefault: true,
    battle: { trunc: Math.trunc },
    debug: true,
    ruleset: [
      "Team Preview",
      "Cancel Mod",
      "Min Team Size = 4",
      "Picked Team Size = 4",
      "Max Team Size = 6",
      "Adjust Level = 50"
    ]
  },
  {
    name: "[Gen 9 Champions] Custom Game",
    mod: "champions",
    gameType: "doubles",
    searchShow: false,
    debug: true,
    battle: { trunc: Math.trunc },
    ruleset: [
      "Team Preview",
      "Cancel Mod",
      "Picked Team Size = 4",
      "Max Team Size = 24",
      "Max Move Count = 24",
      "Max Level = 9999",
      "Default Level = 50"
    ],
    banlist: [],
    onBegin() {
      this.reportPercentages = true;
    }
  }
];
//# sourceMappingURL=custom-formats.js.map
"""


def _custom_formats_overlay_present(repo_dir: str, format_id: str):
    if str(format_id or "").strip().lower() != "gen9championscustomgame":
        return True
    required_fragments = [
        "[Gen 9 Champions] Custom Game",
        "champions",
        "doubles",
        "Max Team Size = 24",
        "Max Move Count = 24",
        "Max Level = 9999",
        "Default Level = 50",
        "reportPercentages",
    ]
    targets = [
        os.path.join(repo_dir, "config", "custom-formats.ts"),
        os.path.join(repo_dir, "dist", "config", "custom-formats.js"),
    ]
    for target in targets:
        if not os.path.exists(target):
            return False
        try:
            with open(target, "r", encoding="utf-8") as handle:
                content = handle.read()
        except Exception:
            return False
        if not all(fragment in content for fragment in required_fragments):
            return False
    return True


def _write_aegis_custom_formats(repo_dir: str):
    targets = [
        (os.path.join(repo_dir, "config", "custom-formats.ts"), AEGIS_CUSTOM_FORMATS_TS),
        (os.path.join(repo_dir, "dist", "config", "custom-formats.js"), AEGIS_CUSTOM_FORMATS_JS),
    ]
    results = []
    changed = False
    for target, desired in targets:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        previous = ""
        if os.path.exists(target):
            try:
                with open(target, "r", encoding="utf-8") as handle:
                    previous = handle.read()
            except Exception:
                previous = ""
        if previous.strip() == desired.strip():
            results.append({"changed": False, "path": target, "backupPath": None})
            continue
        backup_path = None
        if previous:
            backup_path = target + ".aegis-backup-" + time.strftime("%Y%m%d%H%M%S")
            try:
                with open(backup_path, "w", encoding="utf-8") as handle:
                    handle.write(previous)
            except Exception:
                backup_path = None
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(desired)
        changed = True
        results.append({"changed": True, "path": target, "backupPath": backup_path})
    return {"changed": changed, "targets": results}


def _champions_custom_format_probe_js():
    return (
        "const requiredRules=['Team Preview','Cancel Mod','Picked Team Size = 4','Max Team Size = 24','Max Move Count = 24','Max Level = 9999','Default Level = 50'];"
        "const championsRuleTable=Dex.formats.getRuleTable(fmt);"
        "if(fmt.mod !== 'champions'){throw new Error('Champions custom format must use champions mod, got: '+fmt.mod);}"
        "for (const rule of requiredRules){if(!(fmt.ruleset||[]).includes(rule)){throw new Error('Champions custom format missing rule: '+rule);}}"
        "if(championsRuleTable.pickedTeamSize !== 4){throw new Error('Champions custom format must resolve pickedTeamSize=4, got: '+championsRuleTable.pickedTeamSize);}"
        "if(championsRuleTable.maxTeamSize !== 24){throw new Error('Champions custom format must keep maxTeamSize=24 for custom champion sets, got: '+championsRuleTable.maxTeamSize);}"
        "if(Array.isArray(fmt.banlist) && fmt.banlist.length){throw new Error('Champions custom format banlist must be empty.');}"
        "if(typeof fmt.onBegin !== 'function'){throw new Error('Champions custom format missing onBegin.');}"
    )


def _probe_custom_formats(repo_dir: str, format_id: str, timeout_ms: int):
    format_id = str(format_id or "gen9benchmarkdoublesag").strip() or "gen9benchmarkdoublesag"
    champions_probe = _champions_custom_format_probe_js() if format_id.lower() == "gen9championscustomgame" else ""
    script = (
        "const {Dex}=require('./dist/sim/dex');"
        "const id=process.argv[1]||'gen9benchmarkdoublesag';"
        "Dex.includeFormats();"
        "const fmt=Dex.formats.get(id);"
        "if(!fmt || fmt.exists === false){throw new Error('Benchmark format not found: '+id); }"
        "if(fmt.gameType !== 'doubles'){throw new Error('Benchmark format must be doubles, got: '+fmt.gameType); }"
        + champions_probe +
        "const ruleTable=Dex.formats.getRuleTable(fmt);"
        "console.log(JSON.stringify({id:fmt.id,name:fmt.name,gameType:fmt.gameType,mod:fmt.mod,ruleset:fmt.ruleset||[],banlist:fmt.banlist||[],hasOnBegin:typeof fmt.onBegin === 'function',pickedTeamSize:ruleTable.pickedTeamSize||null,maxTeamSize:ruleTable.maxTeamSize||null,minTeamSize:ruleTable.minTeamSize||null}));"
    )
    try:
        completed = subprocess.run(
            ["node", "-e", script, format_id],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            timeout=max(timeout_ms / 1000.0, 1.0),
        )
        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
        output = (stderr + "\n" + stdout).strip()

        # R6.8C.9: some Node/Showdown probes can return a noisy/non-zero signal
        # while still resolving and printing the exact benchmark format object.
        # If stdout contains the expected format id + doubles gameType, accept it
        # as a valid probe instead of blocking Matchup Report.
        parsed_format = None
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if not line.startswith("{") or not line.endswith("}"):
                continue
            try:
                candidate = json.loads(line)
            except Exception:
                continue
            candidate_id = str(candidate.get("id") or "").strip().lower()
            candidate_game_type = str(candidate.get("gameType") or "").strip().lower()
            candidate_mod = str(candidate.get("mod") or "").strip().lower()
            if candidate_id == format_id.lower() and candidate_game_type == "doubles":
                if format_id.lower() == "gen9championscustomgame" and candidate_mod != "champions":
                    continue
                parsed_format = candidate
                break

        accepted_by_object = parsed_format is not None
        return {
            "ok": completed.returncode == 0 or accepted_by_object,
            "returnCode": completed.returncode,
            "stdout": stdout[-2000:],
            "stderr": stderr[-4000:],
            "detail": output,
            "formatObject": parsed_format,
            "acceptedByFormatObject": accepted_by_object,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "returnCode": "timeout", "stdout": "", "stderr": "", "detail": "Custom formats probe timed out."}
    except Exception as exc:
        return {"ok": False, "returnCode": "exception", "stdout": "", "stderr": str(exc), "detail": str(exc)}


def is_showdown_dist_corruption_error(text) -> bool:
    """Return true for real Pokemon Showdown dist syntax/runtime corruption."""
    haystack = str(text or "")
    if not haystack:
        return False
    lower = haystack.lower()
    has_dist_path = "dist/data/learnsets.js" in lower or "dist\\data\\learnsets.js" in lower
    has_syntax_marker = "syntaxerror" in lower or "unexpected end of input" in lower or "invalid or unexpected token" in lower
    has_showdown_loader = "moddeddex.loaddatafile" in lower or "dist/sim/dex.js" in lower or "pokemon-showdown" in lower
    return bool(has_dist_path and has_syntax_marker and has_showdown_loader)


def _run_dist_health_probe(repo_dir: str, timeout_sec: float = 15.0) -> dict:
    checks = [
        ["node", "--check", os.path.join("dist", "data", "learnsets.js")],
        ["node", "--check", os.path.join("dist", "sim", "battle.js")],
    ]
    results = []
    for cmd in checks:
        try:
            completed = subprocess.run(
                cmd,
                cwd=repo_dir,
                capture_output=True,
                text=True,
                timeout=max(float(timeout_sec), 1.0),
            )
            results.append({
                "cmd": cmd,
                "ok": completed.returncode == 0,
                "returnCode": completed.returncode,
                "stdout": (completed.stdout or "")[-1000:],
                "stderr": (completed.stderr or "")[-2000:],
            })
        except Exception as exc:
            results.append({"cmd": cmd, "ok": False, "returnCode": None, "stdout": "", "stderr": str(exc)})
    return {"ok": all(bool(item.get("ok")) for item in results), "checks": results}


def auto_heal_showdown_dist(reason: str = "dist-corruption-detected", detail: str = "", timeout_ms=None) -> dict:
    """Rebuild Pokemon Showdown dist when a real dist syntax break is detected."""
    if not _env_bool("BENCHMARK_SHOWDOWN_DIST_AUTO_HEAL_ENABLED", True):
        return {"ok": False, "healed": False, "skipped": True, "reason": "dist-auto-heal-disabled"}

    config = get_showdown_config()
    repo_dir = str(config.get("dir") or "").strip()
    if not repo_dir:
        return {"ok": False, "healed": False, "skipped": True, "reason": "repo-dir-missing"}
    if not os.path.exists(os.path.join(repo_dir, "package.json")):
        return {"ok": False, "healed": False, "skipped": True, "reason": "showdown-package-missing", "repoDir": repo_dir}

    effective_timeout_ms = int(timeout_ms or os.getenv("BENCHMARK_SHOWDOWN_DIST_AUTO_HEAL_TIMEOUT_MS", "120000") or "120000")
    command_raw = str(os.getenv("BENCHMARK_SHOWDOWN_DIST_AUTO_HEAL_COMMAND", "npm run build")).strip() or "npm run build"
    command = shlex.split(command_raw)
    started = time.time()

    with _dist_auto_heal_lock:
        before = _run_dist_health_probe(repo_dir, timeout_sec=min(max(effective_timeout_ms / 1000.0, 1.0), 20.0))
        if before.get("ok"):
            return {
                "ok": True,
                "healed": False,
                "skipped": True,
                "reason": "dist-already-healthy",
                "repoDir": repo_dir,
                "durationMs": int(round((time.time() - started) * 1000)),
                "probeBefore": before,
            }

        try:
            completed = subprocess.run(
                command,
                cwd=repo_dir,
                capture_output=True,
                text=True,
                timeout=max(effective_timeout_ms / 1000.0, 1.0),
            )
            build = {
                "cmd": command,
                "returnCode": completed.returncode,
                "stdout": (completed.stdout or "")[-3000:],
                "stderr": (completed.stderr or "")[-5000:],
            }
        except subprocess.TimeoutExpired as exc:
            build = {
                "cmd": command,
                "returnCode": "timeout",
                "stdout": (getattr(exc, "stdout", None) or "")[-3000:] if isinstance(getattr(exc, "stdout", None), str) else "",
                "stderr": (getattr(exc, "stderr", None) or "")[-5000:] if isinstance(getattr(exc, "stderr", None), str) else "",
            }
            after = _run_dist_health_probe(repo_dir, timeout_sec=15.0)
            return {
                "ok": bool(after.get("ok")),
                "healed": bool(after.get("ok")),
                "skipped": False,
                "reason": "dist-auto-heal-timeout" if not after.get("ok") else "dist-auto-heal-timeout-but-healthy",
                "repoDir": repo_dir,
                "durationMs": int(round((time.time() - started) * 1000)),
                "probeBefore": before,
                "build": build,
                "probeAfter": after,
            }
        except Exception as exc:
            return {
                "ok": False,
                "healed": False,
                "skipped": False,
                "reason": "dist-auto-heal-exception",
                "repoDir": repo_dir,
                "durationMs": int(round((time.time() - started) * 1000)),
                "probeBefore": before,
                "error": str(exc),
            }

        after = _run_dist_health_probe(repo_dir, timeout_sec=20.0)
        return {
            "ok": bool(completed.returncode == 0 and after.get("ok")),
            "healed": bool(completed.returncode == 0 and after.get("ok")),
            "skipped": False,
            "reason": "dist-auto-heal-completed" if completed.returncode == 0 and after.get("ok") else "dist-auto-heal-failed",
            "repoDir": repo_dir,
            "durationMs": int(round((time.time() - started) * 1000)),
            "triggerReason": reason,
            "triggerDetail": str(detail or "")[:1000],
            "probeBefore": before,
            "build": build,
            "probeAfter": after,
        }


def ensure_benchmark_custom_formats(timeout_ms=None):
    """Repair/check pokemon-showdown/config/custom-formats.ts before battles start."""
    config = get_showdown_config()
    repo_dir = str(config.get("dir") or "").strip()
    effective_timeout_ms = int(timeout_ms or os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_TIMEOUT_MS", "15000") or "15000")
    format_id = str(config.get("formatId") or os.getenv("BENCHMARK_SHOWDOWN_FORMAT", "gen9benchmarkdoublesag") or "gen9benchmarkdoublesag").strip() or "gen9benchmarkdoublesag"
    repair_enabled = _env_bool("BENCHMARK_CUSTOM_FORMATS_REPAIR_ENABLED", True)
    if not repo_dir:
        return {"ok": False, "reason": "repo-dir-missing", "detail": "BENCHMARK_SHOWDOWN_DIR is not configured.", "repaired": False}
    if not os.path.exists(os.path.join(repo_dir, "dist", "sim", "dex.js")):
        return {"ok": False, "reason": "showdown-dist-missing", "detail": "Missing dist/sim/dex.js.", "repoDir": repo_dir, "repaired": False}

    overlay_present = _custom_formats_overlay_present(repo_dir, format_id)
    first = _probe_custom_formats(repo_dir, format_id, effective_timeout_ms)
    if first.get("ok") and overlay_present:
        return {"ok": True, "reason": "ok", "detail": "Custom formats probe passed.", "repoDir": repo_dir, "formatId": format_id, "repaired": False, "probe": first, "overlayPresent": overlay_present}

    detail = str(first.get("detail") or "")
    should_repair = (
        "custom-formats" in detail
        or "Benchmark format not found" in detail
        or "must be an array" in detail
        or not os.path.exists(os.path.join(repo_dir, "config", "custom-formats.ts"))
        or not overlay_present
    )
    if not repair_enabled or not should_repair:
        return {"ok": False, "reason": "custom-formats-probe-failed", "detail": detail or "Custom formats probe failed.", "repoDir": repo_dir, "formatId": format_id, "repaired": False, "probe": first, "overlayPresent": overlay_present}

    try:
        repair = _write_aegis_custom_formats(repo_dir)
    except Exception as exc:
        return {"ok": False, "reason": "custom-formats-repair-write-failed", "detail": str(exc), "repoDir": repo_dir, "formatId": format_id, "repaired": False, "probe": first, "overlayPresent": overlay_present}

    second = _probe_custom_formats(repo_dir, format_id, effective_timeout_ms)
    if second.get("ok"):
        return {"ok": True, "reason": "custom-formats-repaired", "detail": "Custom formats were normalized and verified.", "repoDir": repo_dir, "formatId": format_id, "repaired": True, "repair": repair, "probeBefore": first, "probeAfter": second, "overlayPresentBefore": overlay_present, "overlayPresentAfter": _custom_formats_overlay_present(repo_dir, format_id)}
    return {"ok": False, "reason": "custom-formats-repair-verify-failed", "detail": str(second.get("detail") or "Custom formats repair did not verify."), "repoDir": repo_dir, "formatId": format_id, "repaired": bool(repair.get("changed")), "repair": repair, "probeBefore": first, "probeAfter": second, "overlayPresentBefore": overlay_present, "overlayPresentAfter": _custom_formats_overlay_present(repo_dir, format_id)}

def validate_showdown_integrity(timeout_ms=None):
    """Verify the local Pokemon Showdown checkout before a report starts.

    R6.8C.5 keeps true syntax failures as blockers, but treats the Learnsets
    runtime export-shape probe as PM2-only diagnostics. Some Showdown builds can
    pass CLI validation and battle retries even when this probe is noisy, so it
    must not block users from starting Matchup Report.
    """
    config = get_showdown_config()
    repo_dir = str(config.get("dir") or "").strip()
    effective_timeout_ms = int(timeout_ms or os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_TIMEOUT_MS", "15000") or "15000")
    if not repo_dir:
        return {"ok": False, "reason": "repo-dir-missing", "detail": "BENCHMARK_SHOWDOWN_DIR is not configured.", "repoDir": None}

    required_files = [
        "pokemon-showdown",
        os.path.join("dist", "data", "learnsets.js"),
        os.path.join("dist", "sim", "dex.js"),
    ]
    missing = [rel for rel in required_files if not os.path.exists(os.path.join(repo_dir, rel))]
    if missing:
        return {"ok": False, "reason": "required-files-missing", "detail": "Missing Showdown files: " + ", ".join(missing), "repoDir": repo_dir, "missing": missing}

    learnsets_runtime_check = (
        "const mod=require('./dist/data/learnsets');"
        "const learnsets=mod && mod.Learnsets;"
        "if (!learnsets || typeof learnsets !== 'object' || Array.isArray(learnsets)) {"
        "console.error('dist/data/learnsets must export Learnsets as an object');"
        "process.exit(42);"
        "}"
        "const count=Object.keys(learnsets).length;"
        "if (count < 100) {"
        "console.error('dist/data/learnsets Learnsets object is unexpectedly small: '+count);"
        "process.exit(43);"
        "}"
        "console.log('Learnsets export OK: '+count);"
    )

    battle_runtime_check = (
        "const battle=require('./dist/sim/battle');"
        "const stream=require('./dist/sim/battle-stream');"
        "if (typeof battle.Battle !== 'function') {"
        "console.error('dist/sim/battle must export Battle as a constructor');"
        "process.exit(44);"
        "}"
        "if (typeof stream.BattleStream !== 'function') {"
        "console.error('dist/sim/battle-stream must export BattleStream as a constructor');"
        "process.exit(45);"
        "}"
        "console.log('Battle runtime exports OK');"
    )

    checks = [
        {"name": "dist-learnsets-syntax", "cmd": ["node", "--check", os.path.join("dist", "data", "learnsets.js")], "hard": True},
        {"name": "dist-moves-text-syntax", "cmd": ["node", "--check", os.path.join("dist", "data", "text", "moves.js")], "hard": True},
        {"name": "dist-battle-stream-syntax", "cmd": ["node", "--check", os.path.join("dist", "sim", "battle-stream.js")], "hard": True},
        {"name": "dist-battle-syntax", "cmd": ["node", "--check", os.path.join("dist", "sim", "battle.js")], "hard": True},
        {"name": "dist-battle-runtime-export", "cmd": ["node", "-e", battle_runtime_check], "hard": True},
        {"name": "dist-learnsets-runtime-export", "cmd": ["node", "-e", learnsets_runtime_check], "hard": False, "warningOnly": True},
    ]
    if os.path.exists(os.path.join(repo_dir, "data", "learnsets.ts")):
        checks.append({"name": "source-learnsets-syntax", "cmd": ["node", "--check", os.path.join("data", "learnsets.ts")], "hard": False})

    hard_error_markers = (
        "SyntaxError",
        "Invalid or unexpected token",
        "Cannot find module",
        "MODULE_NOT_FOUND",
        "ENOENT",
    )
    started = time.time()
    results = []
    warnings = []

    for check in checks:
        try:
            completed = subprocess.run(
                check["cmd"],
                cwd=repo_dir,
                capture_output=True,
                text=True,
                timeout=max(effective_timeout_ms / 1000.0, 1.0),
            )
            output = ((completed.stderr or "") + "\n" + (completed.stdout or "")).strip()
            result = {
                "name": check["name"],
                "ok": completed.returncode == 0,
                "returnCode": completed.returncode,
                "stdout": (completed.stdout or "")[-2000:],
                "stderr": (completed.stderr or "")[-4000:],
            }
            if completed.returncode != 0:
                is_hard_check = bool(check.get("hard"))
                has_output = bool(output)
                has_hard_marker = any(marker in output for marker in hard_error_markers)
                runtime_export_succeeded_before_abort = (
                    check.get("name") == "dist-battle-runtime-export"
                    and "Battle runtime exports OK" in (completed.stdout or "")
                )

                if runtime_export_succeeded_before_abort:
                    result["ok"] = True
                    result["warning"] = "dist-runtime-export-aborted-after-success-ignored"
                    warnings.append({
                        "name": check["name"],
                        "returnCode": completed.returncode,
                        "warningOnly": True,
                        "warning": result.get("warning"),
                    })
                    results.append(result)
                    continue

                # R6.8D.3: Node can occasionally abort with SIGABRT / returnCode -6
                # while producing no stdout or stderr from a `node --check` probe.
                # Manual checks can pass immediately afterward, so treat the empty
                # abort as an indeterminate PM2 warning instead of a false syntax
                # failure. Real syntax/module errors still include stderr/stdout
                # markers and remain reportable diagnostics.
                if has_output and (is_hard_check or has_hard_marker):
                    results.append(result)
                    return {
                        "ok": False,
                        "reason": check["name"],
                        "detail": output or "Showdown integrity check failed.",
                        "repoDir": repo_dir,
                        "durationMs": int(round((time.time() - started) * 1000)),
                        "checks": results,
                    }

                result["ok"] = True
                if int(completed.returncode or 0) == -6 and not has_output:
                    result["warning"] = "dist-check-process-aborted-empty-output-ignored"
                else:
                    result["warning"] = "warning-only-check-failed" if check.get("warningOnly") else "nonzero-empty-or-indeterminate-check-ignored"
                warnings.append({
                    "name": check["name"],
                    "returnCode": completed.returncode,
                    "warningOnly": bool(check.get("warningOnly")),
                    "warning": result.get("warning"),
                })
        except subprocess.TimeoutExpired as exc:
            result = {
                "name": check["name"],
                "ok": True,
                "returnCode": None,
                "stdout": "",
                "stderr": "",
                "warning": "syntax-check-timeout-ignored",
            }
            warnings.append({"name": check["name"], "returnCode": "timeout"})
        except Exception as exc:
            result = {"name": check["name"], "ok": True, "returnCode": None, "stdout": "", "stderr": str(exc), "warning": "syntax-check-exception-ignored"}
            warnings.append({"name": check["name"], "returnCode": "exception"})
        results.append(result)

    return {
        "ok": True,
        "reason": "ok-with-warnings" if warnings else "ok",
        "detail": "Pokemon Showdown integrity check passed." if not warnings else "Pokemon Showdown integrity check passed with PM2-only warnings.",
        "repoDir": repo_dir,
        "durationMs": int(round((time.time() - started) * 1000)),
        "checks": results,
        "warnings": warnings,
    }

def ensure_showdown_ready():
    config = get_showdown_config()
    reachable, probe = is_showdown_reachable()
    cli_ready = bool(config["dir"])
    if reachable and cli_ready:
        return {"ok": True, "probe": probe}
    if config["enabled"] and config["autoStart"]:
        return start_showdown_if_needed(force=False)
    return {"ok": False, "probe": probe}


def build_eval_context(template_keys, battle_count):
    readiness = ensure_showdown_ready()
    return {
        "showdownReady": bool(readiness.get("ok")),
        "requestedTemplates": list(template_keys or []),
        "requestedBattleCount": int(battle_count or 0),
        "readiness": readiness,
    }


def get_showdown_status():
    config = get_showdown_config()
    reachable, probe = is_showdown_reachable()
    pid = _managed_pid()
    cli_base = _cli_command_base()
    cli_ready = bool(cli_base and config["dir"])
    fully_ready = bool(config["enabled"] and reachable and cli_ready)

    return {
        "enabled": config["enabled"],
        "configuredUrl": config["url"],
        "timeoutMs": config["timeoutMs"],
        "autoStart": config["autoStart"],
        "reachable": reachable,
        "detailText": probe.get("detail"),
        "statusCode": probe.get("statusCode"),
        "managedProcessPid": pid,
        "managedByWorker": bool(pid),
        "command": _managed_command if pid else None,
        "helperVersion": SHOWDOWN_HELPER_VERSION,
        "repoDir": config["dir"] or None,
        "cliReady": cli_ready,
        "defaultFormatId": config["formatId"] or None,
        "canValidateTeams": cli_ready,
        "canPackTeams": cli_ready,
        "fullyReady": fully_ready,
        "cliDetailText": f"CLI repo dir found: {config['dir']}" if config["dir"] else "CLI repo dir is not configured.",
        "battleTimeoutMs": config["battleTimeoutMs"],
        "packTimeoutMs": config["packTimeoutMs"],
        "packRetries": config["packRetries"],
        "packCacheSize": len(_pack_cache),
        "integrityCheckEnabled": _env_bool("BENCHMARK_SHOWDOWN_INTEGRITY_CHECK_ENABLED", True),
    }
