#!/usr/bin/env python3
import json
import os
import random
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Persistent simulator workers need battle logs to rebuild Simulation Archives.
os.environ["BENCHMARK_PERSISTENT_SIM_WORKER_BATTLE_LOG_CAPTURE"] = "1"

from benchmark_engine import (
    ENGINE_VERSION,
    build_battle_series_report,
    build_benchmark_suite_report,
    build_core_pre_score_candidates,
    build_core_sweep_candidates,
    build_core_sweep_report,
    build_lead_pair_pre_score_candidates,
    build_lead_pair_sweep_candidates,
    build_lead_pair_sweep_report,
    build_sim_matchup_scaffold_from_team,
    build_weakness_report_from_team,
    get_core_sweep_profile,
    clean_text,
    get_lead_pair_sweep_profile,
    looks_like_team_export,
)
from benchmark_showdown import (
    SHOWDOWN_HELPER_VERSION,
    ensure_showdown_ready,
    ensure_benchmark_custom_formats,
    get_showdown_status,
    pack_team_export,
    validate_showdown_integrity,
    validate_team_export,
    auto_heal_showdown_dist,
    is_showdown_dist_corruption_error,
)
from benchmark_templates import TEMPLATE_LIBRARY_VERSION, list_template_summaries
from benchmark_opponents import OPPONENT_LIBRARY_VERSION, get_opponent_by_id
from benchmark_battle_runner import BATTLE_RUNNER_VERSION, SERIES_BATCH_DISABLED_REASON, BenchmarkSeriesRunner, configure_warm_runner_pool, get_warm_runner_pool_snapshot, retire_warm_runner_pool, configure_persistent_sim_worker_pool, get_persistent_sim_worker_pool_snapshot, prewarm_persistent_sim_worker_pool, retire_persistent_sim_worker_pool, retire_idle_persistent_sim_worker_pool, recover_stale_persistent_sim_worker_checkouts, run_default_policy_battle
from benchmark_modes import resolve_benchmark_mode_selection
from benchmark_repo_teams import warm_repo_opponent_cache, hydrate_repo_opponent_records, get_champions_sp_simulator_export

WORKER_VERSION = "2026.04.26-benchmark-worker-v55-stuck-battle-finalizer"
BATTLE_POLICY_VERSION = "r6.20.10r-policy-v3-battlebrain-memory"
HOST = os.getenv("BENCHMARK_WORKER_HOST", "127.0.0.1")
PORT = int(os.getenv("BENCHMARK_WORKER_PORT", "8787"))
DEFAULT_FORMAT_ID = str(os.getenv("BENCHMARK_SHOWDOWN_FORMAT", "gen9benchmarkdoublesag")).strip() or "gen9benchmarkdoublesag"
CHAMPIONS_FORMAT_ID = "gen9championscustomgame"
BENCHMARK_BATTLE_BUDGET_OPTIONS = (100, 200, 300, 850, 1250)
DEFAULT_BENCHMARK_BATTLE_BUDGET = 200
SUITE_PARALLEL_BATTLES = max(int(os.getenv("BENCHMARK_SUITE_PARALLEL_BATTLES", "8") or "8"), 1)
FULL_REG_SWEEP_BATCH_SIZE = max(int(os.getenv("BENCHMARK_FULL_REG_SWEEP_BATCH_SIZE", str(SUITE_PARALLEL_BATTLES)) or str(SUITE_PARALLEL_BATTLES)), 1)
FULL_REG_SWEEP_HYDRATION_WARN_THRESHOLD_MS = max(int(os.getenv("BENCHMARK_FULL_REG_SWEEP_HYDRATION_WARN_THRESHOLD_MS", "15000") or "15000"), 0)


def _simulator_team_export_for_format(team_export: str, format_id: str) -> str:
    return get_champions_sp_simulator_export(team_export, format_id)


FULL_REG_STUCK_SERIES_WATCHDOG_SEC = max(float(os.getenv("BENCHMARK_FULL_REG_STUCK_SERIES_WATCHDOG_SEC", "30") or "30"), 5.0)
FULL_REG_ENDGAME_DRAIN_SEC = max(float(os.getenv("BENCHMARK_FULL_REG_ENDGAME_DRAIN_SEC", "12") or "12"), 5.0)
FULL_REG_ENDGAME_PENDING_THRESHOLD = max(int(os.getenv("BENCHMARK_FULL_REG_ENDGAME_PENDING_THRESHOLD", "2") or "2"), 1)
FULL_REG_SHARED_WORKER_CAP = max(int(os.getenv("BENCHMARK_FULL_REG_SHARED_WORKER_CAP", "8") or "8"), 1)
STUCK_CHECKOUT_FINALIZER_GRACE_SEC = max(float(os.getenv("BENCHMARK_STUCK_CHECKOUT_FINALIZER_GRACE_SEC", "5") or "5"), 0.0)
FULL_REG_STUCK_SERIES_POLL_SEC = max(float(os.getenv("BENCHMARK_FULL_REG_STUCK_SERIES_POLL_SEC", "1") or "1"), 0.25)
GLOBAL_BATTLE_SEMAPHORE_CAP = max(int(os.getenv("BENCHMARK_GLOBAL_BATTLE_SEMAPHORE_CAP", str(SUITE_PARALLEL_BATTLES)) or str(SUITE_PARALLEL_BATTLES)), 1)
SHARED_WORKER_POOL_ENABLED = str(os.getenv("BENCHMARK_SHARED_WORKER_POOL_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
SHARED_WORKER_POOL_CAP = max(int(os.getenv("BENCHMARK_SHARED_WORKER_POOL_CAP", "8") or "8"), 1)
SHARED_WORKER_SOLO_MAX = max(int(os.getenv("BENCHMARK_SHARED_WORKER_SOLO_MAX", "8") or "8"), 1)
SHARED_WORKER_PRIMARY_SHARED_MAX = max(int(os.getenv("BENCHMARK_SHARED_WORKER_PRIMARY_SHARED_MAX", "6") or "6"), 1)
SHARED_WORKER_SECONDARY_SHARED_MAX = max(int(os.getenv("BENCHMARK_SHARED_WORKER_SECONDARY_SHARED_MAX", "2") or "2"), 1)
SHARED_WORKER_MAX_ACTIVE_REPORTS = max(int(os.getenv("BENCHMARK_SHARED_WORKER_MAX_ACTIVE_REPORTS", "2") or "2"), 1)
SHARED_WORKER_CPU_WARM_CAP = float(os.getenv("BENCHMARK_SHARED_WORKER_CPU_WARM_CAP", "45") or "45")
SHARED_WORKER_CPU_SOFT_CAP = float(os.getenv("BENCHMARK_SHARED_WORKER_CPU_SOFT_CAP", "55") or "55")
SHARED_WORKER_CPU_HARD_CAP = float(os.getenv("BENCHMARK_SHARED_WORKER_CPU_HARD_CAP", "75") or "75")
SHARED_WORKER_CPU_CRITICAL_CAP = float(os.getenv("BENCHMARK_SHARED_WORKER_CPU_CRITICAL_CAP", "90") or "90")
SHARED_WORKER_CPU_SOFT_WORKER_CAP = max(int(os.getenv("BENCHMARK_SHARED_WORKER_CPU_SOFT_WORKER_CAP", "6") or "6"), 1)
SHARED_WORKER_CPU_HARD_WORKER_CAP = max(int(os.getenv("BENCHMARK_SHARED_WORKER_CPU_HARD_WORKER_CAP", "4") or "4"), 1)
SHARED_WORKER_CPU_CRITICAL_WORKER_CAP = max(int(os.getenv("BENCHMARK_SHARED_WORKER_CPU_CRITICAL_WORKER_CAP", "1") or "1"), 1)
SHARED_WORKER_CPU_COOLDOWN_SEC = max(float(os.getenv("BENCHMARK_SHARED_WORKER_CPU_COOLDOWN_SEC", "4") or "4"), 0.0)
SHARED_WORKER_CPU_COOLDOWN_WORKER_CAP = max(int(os.getenv("BENCHMARK_SHARED_WORKER_CPU_COOLDOWN_WORKER_CAP", "4") or "4"), 1)
SHARED_WORKER_CPU_CRITICAL_COOLDOWN_WORKER_CAP = max(int(os.getenv("BENCHMARK_SHARED_WORKER_CPU_CRITICAL_COOLDOWN_WORKER_CAP", "1") or "1"), 1)
SHARED_WORKER_CPU_RAMP_CALM_SEC = max(float(os.getenv("BENCHMARK_SHARED_WORKER_CPU_RAMP_CALM_SEC", "2") or "2"), 0.0)
SHARED_WORKER_CPU_RAMP_CALM_WORKER_CAP = max(int(os.getenv("BENCHMARK_SHARED_WORKER_CPU_RAMP_CALM_WORKER_CAP", "6") or "6"), 1)
SHARED_WORKER_HOT_RELAUNCH_BLOCK_ENABLED = str(os.getenv("BENCHMARK_SHARED_WORKER_HOT_RELAUNCH_BLOCK_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
SHARED_WORKER_WAIT_LOG_INTERVAL_SEC = max(float(os.getenv("BENCHMARK_SHARED_WORKER_WAIT_LOG_INTERVAL_SEC", "8") or "8"), 1.0)
REQUIRE_SHOWDOWN_SERVER_READY = str(os.getenv("BENCHMARK_REQUIRE_SHOWDOWN_SERVER_READY", "0")).strip().lower() in {"1", "true", "yes", "on"}
READINESS_CACHE_TTL_MS = max(int(os.getenv("BENCHMARK_READINESS_CACHE_TTL_MS", "2000") or "2000"), 0)
RESOURCE_MONITOR_ENABLED = str(os.getenv("BENCHMARK_RESOURCE_MONITOR_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
RESOURCE_MONITOR_INTERVAL_SEC = max(float(os.getenv("BENCHMARK_RESOURCE_MONITOR_INTERVAL_SEC", "2") or "2"), 1.0)
BATTLE_RETRY_MAX_ATTEMPTS = max(int(os.getenv("BENCHMARK_BATTLE_RETRY_MAX_ATTEMPTS", "2") or "2"), 0)
BATTLE_RETRY_BACKOFF_SEC = max(float(os.getenv("BENCHMARK_BATTLE_RETRY_BACKOFF_SEC", "0.5") or "0.5"), 0.0)
BATTLE_RETRY_SAFE_WORKER_CAP = max(int(os.getenv("BENCHMARK_BATTLE_RETRY_SAFE_WORKER_CAP", "3") or "3"), 1)
BATTLE_RETRY_FINAL_WORKER_CAP = max(int(os.getenv("BENCHMARK_BATTLE_RETRY_FINAL_WORKER_CAP", "1") or "1"), 1)
BATTLE_START_STAGGER_ENABLED = str(os.getenv("BENCHMARK_BATTLE_START_STAGGER_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
BATTLE_START_STAGGER_MS = max(int(os.getenv("BENCHMARK_BATTLE_START_STAGGER_MS", "80") or "80"), 0)
BATTLE_RETRY_START_STAGGER_MS = max(int(os.getenv("BENCHMARK_BATTLE_RETRY_START_STAGGER_MS", "250") or "250"), 0)
BATTLE_START_STAGGER_JITTER_MS = max(int(os.getenv("BENCHMARK_BATTLE_START_STAGGER_JITTER_MS", "40") or "40"), 0)
SERIES_BATCH_RUNNER_PREP_ENABLED = str(os.getenv("BENCHMARK_SERIES_BATCH_RUNNER_PREP_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
SERIES_BATCH_RUNNER_ENABLED = str(os.getenv("BENCHMARK_SERIES_BATCH_RUNNER_ENABLED", "0")).strip().lower() in {"1", "true", "yes", "on"}
WARM_RUNNER_POOL_ENABLED = str(os.getenv("BENCHMARK_WARM_RUNNER_POOL_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
WARM_RUNNER_POOL_SIZE = max(int(os.getenv("BENCHMARK_WARM_RUNNER_POOL_SIZE", "1") or "1"), 0)
PERSISTENT_SIM_WORKER_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_POOL_SIZE = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_POOL_SIZE", "8") or "8"), 0)
PERSISTENT_SIM_WORKER_PREWARM_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_PREWARM_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_PREWARM_SIZE = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_PREWARM_SIZE", "8") or "8"), 0)
PERSISTENT_SIM_WORKER_PREWARM_TIMEOUT_MS = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_PREWARM_TIMEOUT_MS", "0") or "0"), 0)
PERSISTENT_SIM_WORKER_STARTUP_PREWARM_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_STARTUP_PREWARM_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_STARTUP_PREWARM_SIZE = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_STARTUP_PREWARM_SIZE", str(PERSISTENT_SIM_WORKER_PREWARM_SIZE)) or str(PERSISTENT_SIM_WORKER_PREWARM_SIZE)), 0)
PERSISTENT_SIM_WORKER_STARTUP_PREWARM_TIMEOUT_MS = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_STARTUP_PREWARM_TIMEOUT_MS", "5000") or "5000"), 0)
FIRST_WAVE_THROTTLE_ENABLED = str(os.getenv("BENCHMARK_FIRST_WAVE_THROTTLE_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
FIRST_WAVE_WORKER_CAP = max(int(os.getenv("BENCHMARK_FIRST_WAVE_WORKER_CAP", "4") or "4"), 1)
FIRST_WAVE_MIN_SCORED_GAMES = max(int(os.getenv("BENCHMARK_FIRST_WAVE_MIN_SCORED_GAMES", "1") or "1"), 0)
FIRST_WAVE_MIN_SECONDS = max(float(os.getenv("BENCHMARK_FIRST_WAVE_MIN_SECONDS", "1") or "1"), 0.0)
GRADUAL_RAMP_ENABLED = str(os.getenv("BENCHMARK_GRADUAL_RAMP_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
GRADUAL_RAMP_START_WORKER_CAP = max(int(os.getenv("BENCHMARK_GRADUAL_RAMP_START_WORKER_CAP", "4") or "4"), 1)
GRADUAL_RAMP_STEP_WORKERS = max(int(os.getenv("BENCHMARK_GRADUAL_RAMP_STEP_WORKERS", "2") or "2"), 1)
GRADUAL_RAMP_SCORED_GAMES_PER_STEP = max(int(os.getenv("BENCHMARK_GRADUAL_RAMP_SCORED_GAMES_PER_STEP", "1") or "1"), 1)
GRADUAL_RAMP_HIGH_CPU_HOLD_ENABLED = str(os.getenv("BENCHMARK_GRADUAL_RAMP_HIGH_CPU_HOLD_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
GRADUAL_RAMP_HIGH_CPU_HOLD_CAP = max(int(os.getenv("BENCHMARK_GRADUAL_RAMP_HIGH_CPU_HOLD_CAP", "2") or "2"), 1)
GRADUAL_RAMP_HIGH_CPU_HOLD_SCORED_GAMES = max(int(os.getenv("BENCHMARK_GRADUAL_RAMP_HIGH_CPU_HOLD_SCORED_GAMES", "4") or "4"), 0)
STABILITY_LOCK_ENABLED = str(os.getenv("BENCHMARK_STABILITY_LOCK_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
STABILITY_LOCK_WORKER_CAP = max(int(os.getenv("BENCHMARK_STABILITY_LOCK_WORKER_CAP", "8") or "8"), 1)
SHOWDOWN_INTEGRITY_CHECK_ENABLED = str(os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_CHECK_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
SHOWDOWN_INTEGRITY_TIMEOUT_MS = max(int(os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_TIMEOUT_MS", "15000") or "15000"), 1000)
SHOWDOWN_INTEGRITY_CACHE_TTL_SEC = max(float(os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_CACHE_TTL_SEC", "600") or "600"), 0.0)
SHOWDOWN_INTEGRITY_RECHECK_ON_WARNINGS = str(os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_RECHECK_ON_WARNINGS", "0")).strip().lower() in {"1", "true", "yes", "on"}
SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_ENABLED = str(os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_DELAY_SEC = max(float(os.getenv("BENCHMARK_SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_DELAY_SEC", "1.5") or "1.5"), 0.0)
PERSISTENT_SIM_WORKER_IDLE_RETIRE_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_IDLE_RETIRE_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_IDLE_RETIRE_SEC = max(float(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_IDLE_RETIRE_SEC", "90") or "90"), 0.0)
PERSISTENT_SIM_WORKER_IDLE_RETIRE_DELAY_SEC = max(float(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_IDLE_RETIRE_DELAY_SEC", "90") or "90"), 0.0)
_GLOBAL_BATTLE_SEMAPHORE = threading.Semaphore(GLOBAL_BATTLE_SEMAPHORE_CAP)
_BATTLE_START_STAGGER_LOCK = threading.Lock()
_BATTLE_START_LAST_TS = 0.0

_resource_lock = threading.Lock()
_resource_state = {
    "activeBattles": 0,
    "activeSuiteJobs": 0,
    "containedFailures": 0,
    "launchedBattles": 0,
    "scoredBattles": 0,
}
_resource_monitor_started = False
_resource_monitor_lock = threading.Lock()
_resource_latest_cpu_percent = None
_resource_latest_cpu_lock = threading.Lock()
_shared_pool_condition = threading.Condition()
_shared_pool_active_by_job = {}
_shared_pool_waiting_since = {}
_shared_pool_forced_cap_by_job = {}
_shared_pool_forced_cap_reason_by_job = {}
_shared_pool_recoverable_cap_by_job = {}
_shared_pool_high_cpu_hold_by_job = {}
_shared_pool_wait_log_last_by_key = {}
_persistent_sim_job_counter_baselines = {}
_persistent_sim_job_counter_lock = threading.Lock()
_worker_diagnostic_samples_by_job = {}
_phase_worker_diagnostic_samples_by_job = {}
_worker_diagnostic_samples_lock = threading.Lock()
_shared_pool_cpu_cooldown_until = 0.0
_shared_pool_cpu_cooldown_cap = None
_shared_pool_cpu_cooldown_state = None
_shared_pool_cpu_last_not_calm_ts = 0.0
_shared_pool_cpu_cooldown_lock = threading.Lock()
_showdown_dist_heal_lock = threading.Lock()
_showdown_dist_heal_active = False



_jobs = {}
_jobs_lock = threading.Lock()
_next_job_id = 1
_WORKER_BOOT_TS = time.time()


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _is_champions_format(format_id) -> bool:
    return str(format_id or DEFAULT_FORMAT_ID).strip().lower() == CHAMPIONS_FORMAT_ID


def _normalize_battle_budget(value) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = DEFAULT_BENCHMARK_BATTLE_BUDGET
    return parsed if parsed in BENCHMARK_BATTLE_BUDGET_OPTIONS else DEFAULT_BENCHMARK_BATTLE_BUDGET


def _allocated_games_per_opponent(selected_count, battle_budget) -> int:
    try:
        opponents = max(int(selected_count or 0), 0)
    except Exception:
        opponents = 0
    budget = _normalize_battle_budget(battle_budget)
    if opponents <= 0:
        return 1
    return max(1, budget // opponents)


def _expected_total_games(selected_count, battle_budget) -> int:
    try:
        opponents = max(int(selected_count or 0), 0)
    except Exception:
        opponents = 0
    if opponents <= 0:
        return 0
    return opponents * _allocated_games_per_opponent(opponents, battle_budget)


_WORKER_BOOT_ISO = utc_now_iso()

_ready_lock = threading.Lock()
_readiness_state = {
    "ok": False,
    "ready": False,
    "status": "initializing",
    "statusText": "BenchMark worker is initializing",
    "detailText": "Readiness checks have not completed yet.",
    "checkedAt": None,
    "checkedEpochMs": 0,
    "reason": "startup",
    "checks": {},
    "showdown": {},
}

_integrity_cache_lock = threading.Lock()
_integrity_check_lock = threading.Lock()
_integrity_cache = {
    "checkedAt": 0.0,
    "repoDir": None,
    "formatId": None,
    "customFormats": None,
    "integrity": None,
}
_startup_integrity_state_lock = threading.Lock()
_startup_integrity_state = {
    "enabled": bool(SHOWDOWN_INTEGRITY_CHECK_ENABLED and SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_ENABLED),
    "active": False,
    "completed": False,
    "ready": False,
    "ok": False,
    "status": "pending" if SHOWDOWN_INTEGRITY_CHECK_ENABLED and SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_ENABLED else "disabled",
    "statusText": "Startup integrity warm cache pending" if SHOWDOWN_INTEGRITY_CHECK_ENABLED and SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_ENABLED else "Startup integrity warm cache disabled",
    "detailText": None,
    "startedAt": None,
    "completedAt": None,
    "startedEpochMs": 0,
    "completedEpochMs": 0,
    "durationMs": None,
    "reason": None,
    "warningCount": 0,
    "persistentWorkersWarmEnabled": bool(PERSISTENT_SIM_WORKER_ENABLED and PERSISTENT_SIM_WORKER_STARTUP_PREWARM_ENABLED),
    "persistentWorkersReady": False,
    "persistentWorkersTargetReady": PERSISTENT_SIM_WORKER_STARTUP_PREWARM_SIZE,
    "persistentWorkersSnapshot": None,
    "error": None,
}
_persistent_idle_retire_lock = threading.Lock()
_persistent_idle_retire_timer = None


def _elapsed_ms(start_ts: float) -> int:
    try:
        return int(round((time.time() - float(start_ts)) * 1000))
    except Exception:
        return 0


def _log_event(event: str, **payload):
    record = {
        "event": event,
        "ts": utc_now_iso(),
        "workerUptimeMs": _elapsed_ms(_WORKER_BOOT_TS),
        **payload,
    }
    try:
        print("[benchmark-worker] " + json.dumps(record, sort_keys=True, default=str), flush=True)
    except Exception:
        print(f"[benchmark-worker] {event} {payload}", flush=True)


def _log_resource(event: str, **payload):
    record = {
        "event": event,
        "ts": utc_now_iso(),
        "workerUptimeMs": _elapsed_ms(_WORKER_BOOT_TS),
        **payload,
    }
    try:
        print("[benchmark-resource] " + json.dumps(record, sort_keys=True, default=str), flush=True)
    except Exception:
        print(f"[benchmark-resource] {event} {payload}", flush=True)


def _read_proc_cpu_times():
    try:
        with open("/proc/stat", "r", encoding="utf-8") as handle:
            parts = handle.readline().strip().split()
        if not parts or parts[0] != "cpu":
            return None
        values = [int(value) for value in parts[1:]]
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        total = sum(values)
        return total, idle
    except Exception:
        return None


def _read_memory_snapshot():
    try:
        data = {}
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            for line in handle:
                key, raw = line.split(":", 1)
                value = raw.strip().split()[0]
                data[key] = int(value)
        total_kb = int(data.get("MemTotal") or 0)
        available_kb = int(data.get("MemAvailable") or 0)
        used_kb = max(total_kb - available_kb, 0)
        total_mb = round(total_kb / 1024, 1) if total_kb else None
        used_mb = round(used_kb / 1024, 1) if total_kb else None
        percent = round((used_kb / total_kb) * 100, 1) if total_kb else None
        return {
            "memoryUsedMb": used_mb,
            "memoryTotalMb": total_mb,
            "memoryPercent": percent,
        }
    except Exception:
        return {
            "memoryUsedMb": None,
            "memoryTotalMb": None,
            "memoryPercent": None,
        }


def _resource_state_snapshot():
    with _resource_lock:
        return dict(_resource_state)


def _resource_adjust(field: str, delta: int):
    with _resource_lock:
        current = int(_resource_state.get(field) or 0)
        if field in {"activeBattles", "activeSuiteJobs"}:
            _resource_state[field] = max(current + int(delta), 0)
        else:
            _resource_state[field] = current + int(delta)
        return int(_resource_state.get(field) or 0)


def _resource_reset_completed_counters(reason: str, job_id: str | None = None):
    """Clear per-suite counters so the next job does not inherit stale telemetry."""
    changed = False
    snapshot = None
    with _resource_lock:
        for field in ("launchedBattles", "scoredBattles", "containedFailures"):
            if int(_resource_state.get(field) or 0) != 0:
                changed = True
            _resource_state[field] = 0
        snapshot = dict(_resource_state)
    if changed:
        _log_resource(
            "resource_counters_reset",
            reason=reason,
            jobId=job_id,
            activeBattles=int(snapshot.get("activeBattles") or 0),
            activeSuiteJobs=int(snapshot.get("activeSuiteJobs") or 0),
            launchedBattles=int(snapshot.get("launchedBattles") or 0),
            scoredBattles=int(snapshot.get("scoredBattles") or 0),
            containedFailures=int(snapshot.get("containedFailures") or 0),
        )


def _set_latest_cpu_percent(value):
    global _resource_latest_cpu_percent
    if value is None:
        return
    try:
        value = float(value)
    except Exception:
        return
    with _resource_latest_cpu_lock:
        _resource_latest_cpu_percent = max(0.0, min(100.0, value))


def _get_latest_cpu_percent():
    with _resource_latest_cpu_lock:
        return _resource_latest_cpu_percent


def _nonnegative_int(value, fallback: int = 0) -> int:
    try:
        return max(int(value), 0)
    except Exception:
        return max(int(fallback or 0), 0)


def _persistent_first_attempt_stagger_view(retry_number: int = 0) -> dict:
    view = {
        "bypass": False,
        "reason": None,
        "runnerMode": None,
        "persistentReady": 0,
        "persistentLive": 0,
        "persistentCheckedOut": 0,
        "persistentTargetSize": int(PERSISTENT_SIM_WORKER_POOL_SIZE),
    }
    if int(retry_number or 0) > 0:
        view["reason"] = "retry-attempt"
        return view
    try:
        runner_mode = _effective_series_runner_mode()
    except Exception:
        runner_mode = "unknown"
    view["runnerMode"] = runner_mode
    if runner_mode != "persistent-sim-worker":
        view["reason"] = "non-persistent-runner"
        return view
    if not PERSISTENT_SIM_WORKER_ENABLED or int(PERSISTENT_SIM_WORKER_POOL_SIZE) <= 0:
        view["reason"] = "persistent-worker-disabled"
        return view
    try:
        pool = get_persistent_sim_worker_pool_snapshot() or {}
    except Exception:
        pool = {}
    ready = _nonnegative_int(pool.get("ready"), 0)
    live = _nonnegative_int(pool.get("live"), 0)
    checked_out = _nonnegative_int(pool.get("checkedOut"), 0)
    target_size = _nonnegative_int(pool.get("targetSize"), PERSISTENT_SIM_WORKER_POOL_SIZE)
    view.update({
        "persistentReady": ready,
        "persistentLive": live,
        "persistentCheckedOut": checked_out,
        "persistentTargetSize": target_size,
    })
    if not bool(pool.get("enabled", True)):
        view["reason"] = "persistent-worker-pool-disabled"
        return view
    if target_size <= 0 or live <= 0:
        view["reason"] = "persistent-worker-unavailable"
        return view
    if ready <= 0:
        view["reason"] = "persistent-worker-not-ready"
        return view
    view["bypass"] = True
    view["reason"] = "prewarmed-persistent-worker-ready"
    return view


def _apply_battle_start_stagger(job_id: str, opponent_index: int, opponent_name: str, game_number: int, retry_number: int = 0, bypass_view: dict | None = None):
    """Smooth CPU spikes by spacing out simulator process launches globally.

    This keeps the current shared worker/retry policy intact while preventing
    multiple Node/Showdown runners from launching at the exact same moment.
    """
    global _BATTLE_START_LAST_TS
    bypass_view = bypass_view if isinstance(bypass_view, dict) else {}
    if bool(bypass_view.get("bypass")):
        return {
            "applied": False,
            "bypassed": True,
            "bypassReason": bypass_view.get("reason"),
            "sleepMs": 0,
            "baseMs": 0,
            "jitterMs": 0,
            "persistentReady": bypass_view.get("persistentReady"),
            "persistentLive": bypass_view.get("persistentLive"),
            "persistentCheckedOut": bypass_view.get("persistentCheckedOut"),
        }
    if not BATTLE_START_STAGGER_ENABLED:
        return {"applied": False, "bypassed": False, "bypassReason": "stagger-disabled", "sleepMs": 0, "baseMs": 0, "jitterMs": 0}
    base_ms = BATTLE_RETRY_START_STAGGER_MS if int(retry_number or 0) > 0 else BATTLE_START_STAGGER_MS
    if base_ms <= 0 and BATTLE_START_STAGGER_JITTER_MS <= 0:
        return {"applied": False, "bypassed": False, "bypassReason": "stagger-zero", "sleepMs": 0, "baseMs": base_ms, "jitterMs": 0}
    jitter_ms = random.randint(0, BATTLE_START_STAGGER_JITTER_MS) if BATTLE_START_STAGGER_JITTER_MS > 0 else 0
    desired_gap_sec = max((base_ms + jitter_ms) / 1000.0, 0.0)
    if desired_gap_sec <= 0:
        return {"applied": False, "bypassed": False, "bypassReason": "stagger-zero", "sleepMs": 0, "baseMs": base_ms, "jitterMs": jitter_ms}

    sleep_sec = 0.0
    with _BATTLE_START_STAGGER_LOCK:
        now = time.time()
        earliest = _BATTLE_START_LAST_TS + desired_gap_sec
        if now < earliest:
            sleep_sec = earliest - now
            _BATTLE_START_LAST_TS = earliest
        else:
            _BATTLE_START_LAST_TS = now

    if sleep_sec > 0:
        _log_event(
            "battle_start_stagger_applied",
            jobId=job_id,
            opponentIndex=opponent_index,
            opponentName=opponent_name,
            gameNumber=game_number,
            retryNumber=retry_number,
            sleepMs=int(round(sleep_sec * 1000)),
            baseMs=base_ms,
            jitterMs=jitter_ms,
        )
        time.sleep(sleep_sec)
    return {
        "applied": sleep_sec > 0,
        "bypassed": False,
        "bypassReason": bypass_view.get("reason"),
        "sleepMs": int(round(sleep_sec * 1000)),
        "baseMs": base_ms,
        "jitterMs": jitter_ms,
    }


def _shared_worker_cpu_cap():
    """Return the adaptive pool cap plus CPU-governor metadata.

    R6.9.2 keeps the adaptive ceiling at 8, but separates CPU labels from
    CPU brakes. Warm CPU now logs honestly without throttling, medium CPU
    nudges the cap down, and high/critical CPU still brakes hard.
    """
    global _shared_pool_cpu_cooldown_until, _shared_pool_cpu_cooldown_cap, _shared_pool_cpu_cooldown_state, _shared_pool_cpu_last_not_calm_ts
    base_cap = max(1, min(SHARED_WORKER_POOL_CAP, GLOBAL_BATTLE_SEMAPHORE_CAP))
    cpu = _get_latest_cpu_percent()
    now = time.time()
    cooldown = {
        "active": False,
        "cap": None,
        "untilEpochMs": None,
        "remainingMs": 0,
        "triggerState": None,
    }

    if cpu is None:
        return base_cap, cpu, "unknown", cooldown

    if cpu >= SHARED_WORKER_CPU_CRITICAL_CAP:
        cap = max(1, min(base_cap, SHARED_WORKER_CPU_CRITICAL_WORKER_CAP))
        state = "critical"
    elif cpu >= SHARED_WORKER_CPU_HARD_CAP:
        cap = max(1, min(base_cap, SHARED_WORKER_CPU_HARD_WORKER_CAP))
        state = "high"
    elif cpu >= SHARED_WORKER_CPU_SOFT_CAP:
        cap = max(1, min(base_cap, SHARED_WORKER_CPU_SOFT_WORKER_CAP))
        state = "medium"
    elif cpu >= SHARED_WORKER_CPU_WARM_CAP:
        cap = base_cap
        state = "warm"
    else:
        cap = base_cap
        state = "healthy"

    with _shared_pool_cpu_cooldown_lock:
        if state in {"medium", "high", "critical"}:
            _shared_pool_cpu_last_not_calm_ts = now

        if state in {"high", "critical"} and SHARED_WORKER_CPU_COOLDOWN_SEC > 0:
            existing_remaining = max(float(_shared_pool_cpu_cooldown_until or 0.0) - now, 0.0)
            existing_is_critical = existing_remaining > 0 and _shared_pool_cpu_cooldown_state == "critical"
            if state == "critical" or not existing_is_critical:
                _shared_pool_cpu_cooldown_until = max(_shared_pool_cpu_cooldown_until, now + SHARED_WORKER_CPU_COOLDOWN_SEC)
                if state == "critical":
                    cooldown_worker_cap = max(int(SHARED_WORKER_CPU_CRITICAL_COOLDOWN_WORKER_CAP), 1)
                else:
                    cooldown_worker_cap = max(int(SHARED_WORKER_CPU_COOLDOWN_WORKER_CAP), 1)
                _shared_pool_cpu_cooldown_cap = min(cooldown_worker_cap, base_cap)
                _shared_pool_cpu_cooldown_state = state

        remaining = max(float(_shared_pool_cpu_cooldown_until or 0.0) - now, 0.0)
        if remaining > 0:
            cooldown_cap = max(int(_shared_pool_cpu_cooldown_cap or SHARED_WORKER_CPU_COOLDOWN_WORKER_CAP), 1)
            cap = min(cap, cooldown_cap)
            cooldown = {
                "active": True,
                "cap": int(cooldown_cap),
                "untilEpochMs": int(round(_shared_pool_cpu_cooldown_until * 1000)),
                "remainingMs": int(round(remaining * 1000)),
                "triggerState": _shared_pool_cpu_cooldown_state,
            }
            if state in {"healthy", "warm", "medium", "unknown"}:
                state = "cpu-cooldown"
        else:
            _shared_pool_cpu_cooldown_until = 0.0
            _shared_pool_cpu_cooldown_cap = None
            _shared_pool_cpu_cooldown_state = None

        calm_remaining = 0.0
        if SHARED_WORKER_CPU_RAMP_CALM_SEC > 0 and _shared_pool_cpu_last_not_calm_ts > 0:
            calm_remaining = max((_shared_pool_cpu_last_not_calm_ts + SHARED_WORKER_CPU_RAMP_CALM_SEC) - now, 0.0)
        if calm_remaining > 0 and cap > SHARED_WORKER_CPU_RAMP_CALM_WORKER_CAP:
            cap = min(cap, max(int(SHARED_WORKER_CPU_RAMP_CALM_WORKER_CAP), 1))
            cooldown["rampCalmActive"] = True
            cooldown["rampCalmRemainingMs"] = int(round(calm_remaining * 1000))
            cooldown["rampCalmCap"] = int(SHARED_WORKER_CPU_RAMP_CALM_WORKER_CAP)
            if state in {"healthy", "warm"}:
                state = "ramp-calm-wait"
        else:
            cooldown["rampCalmActive"] = False
            cooldown["rampCalmRemainingMs"] = 0
            cooldown["rampCalmCap"] = int(SHARED_WORKER_CPU_RAMP_CALM_WORKER_CAP)

    return cap, cpu, state, cooldown


def _normal_full_reg_stability_cap() -> int:
    return max(1, min(int(FULL_REG_SHARED_WORKER_CAP or 4), SHARED_WORKER_POOL_CAP, GLOBAL_BATTLE_SEMAPHORE_CAP))


def _forced_cap_counts_as_safe_mode(reason: str | None, cap) -> bool:
    normalized_reason = str(reason or "").strip().lower()
    if not normalized_reason:
        return False
    if normalized_reason == "full-regulation-drain-stability-cap":
        try:
            return int(cap) < _normal_full_reg_stability_cap()
        except Exception:
            return False
    return True


def _running_suite_jobs_ordered():
    with _jobs_lock:
        jobs = [
            job for job in _jobs.values()
            if job.get("status") == "running" and job.get("jobType") == "run-benchmark-suite"
        ]
    jobs.sort(key=lambda job: (int(job.get("startedEpochMs") or job.get("submittedEpochMs") or 0), str(job.get("jobId") or "")))
    return jobs


def _first_wave_throttle_view(job_id: str):
    """Return a short conservative cap while persistent workers warm up."""
    if not FIRST_WAVE_THROTTLE_ENABLED:
        return {"active": False, "cap": None, "elapsedSec": None, "scoredGames": None}
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("jobType") != "run-benchmark-suite" or job.get("status") != "running":
            return {"active": False, "cap": None, "elapsedSec": None, "scoredGames": None}
        started_ms = int(job.get("startedEpochMs") or job.get("submittedEpochMs") or 0)
        progress = dict(job.get("progress") or {})
    now_ms = int(time.time() * 1000)
    elapsed_sec = max((now_ms - started_ms) / 1000.0, 0.0) if started_ms else 0.0
    scored_games = max(
        _safe_int(progress.get("processedGames"), 0),
        _safe_int(progress.get("battleWins"), 0) + _safe_int(progress.get("battleLosses"), 0) + _safe_int(progress.get("battleTies"), 0),
        _safe_int(progress.get("recordWins"), 0) + _safe_int(progress.get("recordLosses"), 0) + _safe_int(progress.get("recordTies"), 0),
    )
    active = elapsed_sec < FIRST_WAVE_MIN_SECONDS and scored_games < FIRST_WAVE_MIN_SCORED_GAMES
    return {
        "active": bool(active),
        "cap": int(FIRST_WAVE_WORKER_CAP),
        "elapsedSec": round(elapsed_sec, 2),
        "scoredGames": int(scored_games),
    }




def _suite_job_scored_games(job_id: str) -> int:
    with _jobs_lock:
        job = _jobs.get(job_id)
        progress = dict((job or {}).get("progress") or {})
    return max(
        _safe_int(progress.get("processedGames"), 0),
        _safe_int(progress.get("battleWins"), 0) + _safe_int(progress.get("battleLosses"), 0) + _safe_int(progress.get("battleTies"), 0),
        _safe_int(progress.get("recordWins"), 0) + _safe_int(progress.get("recordLosses"), 0) + _safe_int(progress.get("recordTies"), 0),
    )


def _gradual_ramp_view(job_id: str, base_cap: int, first_wave: dict):
    """Clamp post-first-wave worker growth so reports ramp 2 -> 4 -> 6 -> 8 quickly instead of jumping blindly."""
    if not GRADUAL_RAMP_ENABLED:
        return {"active": False, "cap": None, "scoredGames": None, "scoredAfterFirstWave": None, "step": None}
    with _jobs_lock:
        job = _jobs.get(job_id)
        is_suite_running = bool(job and job.get("jobType") == "run-benchmark-suite" and job.get("status") == "running")
    if not is_suite_running or first_wave.get("active"):
        return {"active": False, "cap": None, "scoredGames": None, "scoredAfterFirstWave": None, "step": None}

    scored_games = _suite_job_scored_games(job_id)
    first_wave_floor = FIRST_WAVE_MIN_SCORED_GAMES if FIRST_WAVE_THROTTLE_ENABLED else 0
    scored_after = max(int(scored_games) - int(first_wave_floor), 0)
    ramp_step = int(scored_after // GRADUAL_RAMP_SCORED_GAMES_PER_STEP)
    ramp_cap = min(
        max(int(base_cap or 1), 1),
        max(int(GRADUAL_RAMP_START_WORKER_CAP) + (ramp_step * int(GRADUAL_RAMP_STEP_WORKERS)), 1),
    )
    active = ramp_cap < max(int(base_cap or 1), 1)
    return {
        "active": bool(active),
        "cap": int(ramp_cap),
        "scoredGames": int(scored_games),
        "scoredAfterFirstWave": int(scored_after),
        "step": int(ramp_step),
    }


def _dist_heal_gate_active() -> bool:
    return bool(_showdown_dist_heal_active)


def _effective_series_runner_mode() -> str:
    if SERIES_BATCH_RUNNER_ENABLED:
        return "series-batch-process"
    if PERSISTENT_SIM_WORKER_ENABLED:
        return "persistent-sim-worker"
    return "per-game-process-safe-fallback"


def _wait_for_active_battles_to_drain(job_id: str, timeout_sec: float = 20.0) -> dict:
    started = time.time()
    last_active = None
    while True:
        active = int((_resource_state_snapshot().get("activeBattles") or 0))
        if active <= 0:
            return {"drained": True, "activeBattles": 0, "waitMs": int(round((time.time() - started) * 1000))}
        if active != last_active:
            last_active = active
            _log_event("showdown_dist_auto_heal_waiting_for_battles", jobId=job_id, activeBattles=active, timeoutSec=timeout_sec)
        if (time.time() - started) >= timeout_sec:
            return {"drained": False, "activeBattles": active, "waitMs": int(round((time.time() - started) * 1000))}
        time.sleep(0.25)


def _maybe_auto_heal_showdown_dist(job_id: str, result: dict, reason: str = "battle-failure") -> dict | None:
    detail = str((result or {}).get("failureReason") or (result or {}).get("error") or (result or {}).get("stderr") or "")
    if not is_showdown_dist_corruption_error(detail):
        return None

    _activate_job_safe_mode(job_id, reason="showdown-dist-auto-heal", cap=1)
    global _showdown_dist_heal_active
    with _showdown_dist_heal_lock:
        with _shared_pool_condition:
            _showdown_dist_heal_active = True
            _shared_pool_condition.notify_all()
        try:
            drain = _wait_for_active_battles_to_drain(job_id, timeout_sec=25.0)
            _log_event(
                "showdown_dist_auto_heal_started",
                jobId=job_id,
                reason=reason,
                activeBattlesBeforeBuild=drain.get("activeBattles"),
                drainWaitMs=drain.get("waitMs"),
                drained=bool(drain.get("drained")),
                detail=detail[:1500],
            )
            try:
                retire_snapshot = {"warmRunnerPool": retire_warm_runner_pool(reason="showdown-dist-auto-heal"), "persistentSimWorkerPool": retire_persistent_sim_worker_pool(reason="showdown-dist-auto-heal")}
            except Exception as exc:
                retire_snapshot = {"error": str(exc)}
            heal = auto_heal_showdown_dist(reason=reason, detail=detail)
            _log_event(
                "showdown_dist_auto_heal_completed",
                jobId=job_id,
                ok=bool(heal.get("ok")),
                healed=bool(heal.get("healed")),
                skipped=bool(heal.get("skipped")),
                reason=heal.get("reason"),
                durationMs=heal.get("durationMs"),
                repoDir=heal.get("repoDir"),
                retireWarmRunnerPool=retire_snapshot,
                buildReturnCode=(heal.get("build") or {}).get("returnCode") if isinstance(heal.get("build"), dict) else None,
                probeAfterOk=bool((heal.get("probeAfter") or {}).get("ok")) if isinstance(heal.get("probeAfter"), dict) else None,
            )
            return heal
        finally:
            with _shared_pool_condition:
                _showdown_dist_heal_active = False
                _shared_pool_condition.notify_all()


def _shared_worker_allocation_locked(job_id: str):
    cap, cpu_percent, cpu_state, cpu_cooldown = _shared_worker_cpu_cap()
    adaptive_ceiling = max(1, min(SHARED_WORKER_POOL_CAP, GLOBAL_BATTLE_SEMAPHORE_CAP))
    cap_before_ramp = cap
    ramp_blocked_by_cpu = False
    hot_relaunch_block_active = False
    forced_cap = _shared_pool_forced_cap_by_job.get(job_id)
    forced_cap_reason = _shared_pool_forced_cap_reason_by_job.get(job_id)
    forced_cap_safe_mode_active = False
    if forced_cap is not None:
        try:
            forced_cap = max(int(forced_cap), 1)
            cap = min(cap, forced_cap)
            forced_cap_safe_mode_active = _forced_cap_counts_as_safe_mode(forced_cap_reason, forced_cap)
            if cpu_state == "healthy" and forced_cap_safe_mode_active:
                cpu_state = "safe-mode"
        except Exception:
            pass

    first_wave = _first_wave_throttle_view(job_id)
    if first_wave.get("active"):
        try:
            cap = min(cap, max(int(first_wave.get("cap") or FIRST_WAVE_WORKER_CAP), 1))
            if cpu_state in ("healthy", "warm", "unknown"):
                cpu_state = "first-wave"
        except Exception:
            pass

    gradual_ramp = _gradual_ramp_view(job_id, adaptive_ceiling, first_wave)
    if gradual_ramp.get("active"):
        try:
            ramp_target_cap = max(int(gradual_ramp.get("cap") or GRADUAL_RAMP_START_WORKER_CAP), 1)
            if ramp_target_cap > cap_before_ramp:
                ramp_blocked_by_cpu = True
            cap = min(cap, ramp_target_cap)
            if cpu_state in ("healthy", "warm", "unknown"):
                cpu_state = "ramping"
        except Exception:
            pass

    high_cpu_hold_active = False
    if GRADUAL_RAMP_HIGH_CPU_HOLD_ENABLED:
        try:
            scored_games_for_hold = _suite_job_scored_games(job_id)
            if cpu_state == "high" and scored_games_for_hold < GRADUAL_RAMP_HIGH_CPU_HOLD_SCORED_GAMES:
                _shared_pool_high_cpu_hold_by_job[job_id] = int(time.time())
            if job_id in _shared_pool_high_cpu_hold_by_job and scored_games_for_hold < GRADUAL_RAMP_HIGH_CPU_HOLD_SCORED_GAMES:
                hold_cap = max(int(GRADUAL_RAMP_HIGH_CPU_HOLD_CAP), 1)
                cap = min(cap, hold_cap)
                high_cpu_hold_active = True
                if cpu_state in ("healthy", "warm", "unknown", "medium", "ramping"):
                    cpu_state = "ramp-hold"
            elif job_id in _shared_pool_high_cpu_hold_by_job:
                _shared_pool_high_cpu_hold_by_job.pop(job_id, None)
        except Exception:
            pass

    stability_lock_active = False
    if STABILITY_LOCK_ENABLED:
        try:
            stability_cap = max(int(STABILITY_LOCK_WORKER_CAP), 1)
            first_wave_active_for_lock = bool(first_wave.get("active"))
            forced_cap_active_for_lock = forced_cap is not None
            if cap > stability_cap:
                cap = stability_cap
                stability_lock_active = True
                if cpu_state in ("healthy", "warm", "unknown", "medium", "ramping"):
                    cpu_state = "stability-lock"
        except Exception:
            pass

    ordered_jobs = _running_suite_jobs_ordered()
    ordered_ids = [str(job.get("jobId")) for job in ordered_jobs if job.get("jobId")]
    if job_id not in ordered_ids:
        ordered_ids.append(job_id)

    active_total = sum(max(int(value or 0), 0) for value in _shared_pool_active_by_job.values())
    assigned = max(int(_shared_pool_active_by_job.get(job_id) or 0), 0)
    if SHARED_WORKER_HOT_RELAUNCH_BLOCK_ENABLED and cpu_state in {"high", "critical"} and active_total > 0:
        cap = min(cap, active_total)
        hot_relaunch_block_active = True
    dist_heal_active = _dist_heal_gate_active()
    if dist_heal_active:
        cap = min(cap, 1)
        if cpu_state in ("healthy", "warm", "unknown", "medium", "ramping", "stability-lock"):
            cpu_state = "dist-auto-heal"

    if not SHARED_WORKER_POOL_ENABLED:
        return {
            "allowed": cap,
            "assigned": assigned,
            "activeTotal": active_total,
            "queueSpot": 0,
            "globalCap": cap,
            "cpuPercent": cpu_percent,
            "cpuState": cpu_state,
            "cpuCooldownActive": bool(cpu_cooldown.get("active")),
            "cpuCooldownCap": cpu_cooldown.get("cap"),
            "cpuCooldownRemainingMs": cpu_cooldown.get("remainingMs"),
            "cpuCooldownTriggerState": cpu_cooldown.get("triggerState"),
            "cpuRampCalmActive": bool(cpu_cooldown.get("rampCalmActive")),
            "cpuRampCalmRemainingMs": cpu_cooldown.get("rampCalmRemainingMs"),
            "cpuRampCalmCap": cpu_cooldown.get("rampCalmCap"),
            "hotRelaunchBlockActive": bool(hot_relaunch_block_active),
            "rampBlockedByCpu": bool(ramp_blocked_by_cpu),
            "adaptiveCeiling": int(adaptive_ceiling),
            "runningReports": len(ordered_ids),
            "firstWaveActive": bool(first_wave.get("active")),
            "firstWaveCap": first_wave.get("cap"),
            "firstWaveElapsedSec": first_wave.get("elapsedSec"),
            "firstWaveScoredGames": first_wave.get("scoredGames"),
            "gradualRampActive": bool(gradual_ramp.get("active")),
            "gradualRampCap": gradual_ramp.get("cap"),
            "gradualRampScoredGames": gradual_ramp.get("scoredGames"),
            "gradualRampStep": gradual_ramp.get("step"),
            "highCpuHoldActive": bool(high_cpu_hold_active),
            "highCpuHoldCap": int(GRADUAL_RAMP_HIGH_CPU_HOLD_CAP) if GRADUAL_RAMP_HIGH_CPU_HOLD_ENABLED else None,
            "highCpuHoldUntilScoredGames": int(GRADUAL_RAMP_HIGH_CPU_HOLD_SCORED_GAMES) if GRADUAL_RAMP_HIGH_CPU_HOLD_ENABLED else None,
            "stabilityLockActive": bool(stability_lock_active),
            "stabilityLockCap": int(STABILITY_LOCK_WORKER_CAP) if STABILITY_LOCK_ENABLED else None,
            "distAutoHealActive": bool(dist_heal_active),
            "forcedCap": forced_cap,
            "forcedCapReason": forced_cap_reason,
            "forcedCapSafeModeActive": bool(forced_cap_safe_mode_active),
        }

    try:
        index = ordered_ids.index(job_id)
    except ValueError:
        index = len(ordered_ids)

    if index >= SHARED_WORKER_MAX_ACTIVE_REPORTS:
        allowed = 0
        queue_spot = index - SHARED_WORKER_MAX_ACTIVE_REPORTS + 1
    elif len(ordered_ids) <= 1:
        allowed = min(cap, SHARED_WORKER_SOLO_MAX)
        queue_spot = 0
    elif index == 0:
        # When two users are active, reserve room for the second report instead of letting the first report hold all slots.
        reserved_for_second = min(SHARED_WORKER_SECONDARY_SHARED_MAX, max(cap - 1, 0)) if cap > 1 else 0
        allowed = min(SHARED_WORKER_PRIMARY_SHARED_MAX, max(cap - reserved_for_second, 1))
        queue_spot = 0
    else:
        primary_allowed = min(SHARED_WORKER_PRIMARY_SHARED_MAX, max(cap - min(SHARED_WORKER_SECONDARY_SHARED_MAX, max(cap - 1, 0)), 1)) if cap > 1 else cap
        allowed = min(SHARED_WORKER_SECONDARY_SHARED_MAX, max(cap - primary_allowed, 0))
        if allowed <= 0 and cap > 1:
            allowed = 1
        queue_spot = 0

    return {
        "allowed": max(int(allowed), 0),
        "assigned": assigned,
        "activeTotal": active_total,
        "queueSpot": queue_spot,
        "globalCap": cap,
        "cpuPercent": cpu_percent,
        "cpuState": cpu_state,
        "cpuCooldownActive": bool(cpu_cooldown.get("active")),
        "cpuCooldownCap": cpu_cooldown.get("cap"),
        "cpuCooldownRemainingMs": cpu_cooldown.get("remainingMs"),
        "cpuCooldownTriggerState": cpu_cooldown.get("triggerState"),
        "cpuRampCalmActive": bool(cpu_cooldown.get("rampCalmActive")),
        "cpuRampCalmRemainingMs": cpu_cooldown.get("rampCalmRemainingMs"),
        "cpuRampCalmCap": cpu_cooldown.get("rampCalmCap"),
        "hotRelaunchBlockActive": bool(hot_relaunch_block_active),
        "rampBlockedByCpu": bool(ramp_blocked_by_cpu),
        "adaptiveCeiling": int(adaptive_ceiling),
        "runningReports": len(ordered_ids),
        "firstWaveActive": bool(first_wave.get("active")),
        "firstWaveCap": first_wave.get("cap"),
        "firstWaveElapsedSec": first_wave.get("elapsedSec"),
        "firstWaveScoredGames": first_wave.get("scoredGames"),
        "gradualRampActive": bool(gradual_ramp.get("active")),
        "gradualRampCap": gradual_ramp.get("cap"),
        "gradualRampScoredGames": gradual_ramp.get("scoredGames"),
        "gradualRampStep": gradual_ramp.get("step"),
        "highCpuHoldActive": bool(high_cpu_hold_active),
        "highCpuHoldCap": int(GRADUAL_RAMP_HIGH_CPU_HOLD_CAP) if GRADUAL_RAMP_HIGH_CPU_HOLD_ENABLED else None,
        "highCpuHoldUntilScoredGames": int(GRADUAL_RAMP_HIGH_CPU_HOLD_SCORED_GAMES) if GRADUAL_RAMP_HIGH_CPU_HOLD_ENABLED else None,
        "stabilityLockActive": bool(stability_lock_active),
        "stabilityLockCap": int(STABILITY_LOCK_WORKER_CAP) if STABILITY_LOCK_ENABLED else None,
        "distAutoHealActive": bool(dist_heal_active),
        "forcedCap": forced_cap,
        "forcedCapReason": forced_cap_reason,
        "forcedCapSafeModeActive": bool(forced_cap_safe_mode_active),
    }


def _shared_worker_cap_snapshot_from_view(view: dict | None, job_id: str | None = None) -> dict:
    def _to_int(value, fallback=None):
        try:
            if value is None:
                return fallback
            return int(value)
        except Exception:
            return fallback

    def _to_bool(value):
        return bool(value)

    view = view if isinstance(view, dict) else {}
    pool_cap = max(_to_int(SHARED_WORKER_POOL_CAP, 1) or 1, 1)
    semaphore_cap = max(_to_int(GLOBAL_BATTLE_SEMAPHORE_CAP, pool_cap) or pool_cap, 1)
    try:
        full_reg_cap = _normal_full_reg_stability_cap()
    except Exception:
        full_reg_cap = max(1, min(pool_cap, semaphore_cap))

    effective_cap = max(_to_int(view.get("globalCap"), min(pool_cap, semaphore_cap)) or 1, 1)
    allowed_for_job = max(_to_int(view.get("allowed"), 0) or 0, 0)
    assigned_for_job = max(_to_int(view.get("assigned"), 0) or 0, 0)
    active_global = max(_to_int(view.get("activeTotal"), 0) or 0, 0)
    cpu_state = str(view.get("cpuState") or "unknown").strip().lower() or "unknown"
    forced_cap = _to_int(view.get("forcedCap"), None)
    forced_reason = str(view.get("forcedCapReason") or "").strip().lower()

    cpu_cap = None
    if _to_bool(view.get("cpuCooldownActive")) and view.get("cpuCooldownCap") is not None:
        cpu_cap = _to_int(view.get("cpuCooldownCap"), None)
    elif _to_bool(view.get("cpuRampCalmActive")) and view.get("cpuRampCalmCap") is not None:
        cpu_cap = _to_int(view.get("cpuRampCalmCap"), None)
    elif cpu_state in {"medium", "high", "critical", "cpu-cooldown", "ramp-calm-wait"}:
        cpu_cap = effective_cap

    ramp_cap = None
    if _to_bool(view.get("firstWaveActive")):
        ramp_cap = _to_int(view.get("firstWaveCap"), None)
    elif _to_bool(view.get("gradualRampActive")):
        ramp_cap = _to_int(view.get("gradualRampCap"), None)
    elif _to_bool(view.get("highCpuHoldActive")):
        ramp_cap = _to_int(view.get("highCpuHoldCap"), None)

    retry_cap = forced_cap if forced_reason.startswith("battle-retry") else None
    full_reg_active = forced_reason == "full-regulation-drain-stability-cap"

    limiters = []

    def _add_limiter(name: str, active: bool, cap=None, reason: str | None = None):
        if not active:
            return
        item = {"name": name}
        cap_int = _to_int(cap, None)
        if cap_int is not None:
            item["cap"] = cap_int
        if reason:
            item["reason"] = reason
        limiters.append(item)

    if forced_cap is not None:
        if full_reg_active:
            _add_limiter("full-reg-stability", True, forced_cap, forced_reason)
        elif "retry" in forced_reason:
            _add_limiter("retry-cap", True, forced_cap, forced_reason)
        else:
            _add_limiter("forced-cap", True, forced_cap, forced_reason or None)
    _add_limiter("cpu-cooldown", _to_bool(view.get("cpuCooldownActive")), view.get("cpuCooldownCap"), view.get("cpuCooldownTriggerState"))
    _add_limiter("cpu-ramp-calm", _to_bool(view.get("cpuRampCalmActive")), view.get("cpuRampCalmCap"))
    _add_limiter("cpu-cap", bool(cpu_cap is not None and cpu_state in {"medium", "high", "critical", "cpu-cooldown", "ramp-calm-wait"}), cpu_cap, cpu_state)
    _add_limiter("first-wave-ramp", _to_bool(view.get("firstWaveActive")), view.get("firstWaveCap"))
    _add_limiter("gradual-ramp", _to_bool(view.get("gradualRampActive")), view.get("gradualRampCap"))
    _add_limiter("high-cpu-hold", _to_bool(view.get("highCpuHoldActive")), view.get("highCpuHoldCap"))
    _add_limiter("stability-lock", _to_bool(view.get("stabilityLockActive")), view.get("stabilityLockCap"))
    _add_limiter("dist-auto-heal", _to_bool(view.get("distAutoHealActive")), 1)

    if not limiters:
        if pool_cap <= semaphore_cap:
            _add_limiter("pool-cap", True, pool_cap)
        else:
            _add_limiter("semaphore-cap", True, semaphore_cap)

    active_limiter = limiters[0]["name"] if limiters else None
    safe_mode_display_reason = None
    if _to_bool(view.get("forcedCapSafeModeActive")):
        safe_mode_display_reason = forced_reason or "forced-cap"
    elif cpu_state in {"high", "critical", "cpu-cooldown", "safe-mode"}:
        safe_mode_display_reason = cpu_state

    return {
        "jobId": job_id,
        "effectiveCap": effective_cap,
        "poolCap": pool_cap,
        "semaphoreCap": semaphore_cap,
        "fullRegCap": full_reg_cap,
        "cpuCap": cpu_cap,
        "rampCap": ramp_cap,
        "retryCap": retry_cap,
        "stabilityLockCap": _to_int(view.get("stabilityLockCap"), None),
        "allowedForJob": allowed_for_job,
        "assignedForJob": assigned_for_job,
        "activeGlobal": active_global,
        "queueSpot": max(_to_int(view.get("queueSpot"), 0) or 0, 0),
        "cpuPercent": view.get("cpuPercent"),
        "cpuState": cpu_state,
        "cpuCooldownActive": _to_bool(view.get("cpuCooldownActive")),
        "cpuRampCalmActive": _to_bool(view.get("cpuRampCalmActive")),
        "firstWaveActive": _to_bool(view.get("firstWaveActive")),
        "gradualRampActive": _to_bool(view.get("gradualRampActive")),
        "highCpuHoldActive": _to_bool(view.get("highCpuHoldActive")),
        "stabilityLockActive": _to_bool(view.get("stabilityLockActive")),
        "distAutoHealActive": _to_bool(view.get("distAutoHealActive")),
        "forcedCap": forced_cap,
        "forcedCapReason": forced_reason or None,
        "forcedCapSafeModeActive": _to_bool(view.get("forcedCapSafeModeActive")),
        "activeLimiter": active_limiter,
        "activeLimiters": [item["name"] for item in limiters],
        "limiterDetails": limiters,
        "safeModeDisplayReason": safe_mode_display_reason,
        "metadataOnly": True,
    }


def _shared_worker_snapshot(job_id: str | None = None):
    with _shared_pool_condition:
        if job_id:
            view = _shared_worker_allocation_locked(job_id)
        else:
            ordered_jobs = _running_suite_jobs_ordered()
            if ordered_jobs and ordered_jobs[0].get("jobId"):
                view = _shared_worker_allocation_locked(str(ordered_jobs[0].get("jobId")))
            else:
                cap, cpu_percent, cpu_state, cpu_cooldown = _shared_worker_cpu_cap()
                view = {
                    "allowed": 0,
                    "assigned": 0,
                    "activeTotal": sum(max(int(value or 0), 0) for value in _shared_pool_active_by_job.values()),
                    "queueSpot": 0,
                    "globalCap": cap,
                    "cpuPercent": cpu_percent,
                    "cpuState": cpu_state,
                    "cpuCooldownActive": bool(cpu_cooldown.get("active")),
                    "cpuCooldownCap": cpu_cooldown.get("cap"),
                    "cpuCooldownRemainingMs": cpu_cooldown.get("remainingMs"),
                    "cpuCooldownTriggerState": cpu_cooldown.get("triggerState"),
                    "cpuRampCalmActive": bool(cpu_cooldown.get("rampCalmActive")),
                    "cpuRampCalmRemainingMs": cpu_cooldown.get("rampCalmRemainingMs"),
                    "cpuRampCalmCap": cpu_cooldown.get("rampCalmCap"),
                    "hotRelaunchBlockActive": False,
                    "rampBlockedByCpu": False,
                    "adaptiveCeiling": max(1, min(SHARED_WORKER_POOL_CAP, GLOBAL_BATTLE_SEMAPHORE_CAP)),
                    "runningReports": 0,
                    "distAutoHealActive": bool(_showdown_dist_heal_active),
                }
        view["activeByJob"] = dict(_shared_pool_active_by_job)
        view["waitingJobs"] = list(_shared_pool_waiting_since.keys())
        view["forcedCapsByJob"] = dict(_shared_pool_forced_cap_by_job)
        view["forcedCapReasonsByJob"] = dict(_shared_pool_forced_cap_reason_by_job)
        view["workerCapSnapshot"] = _shared_worker_cap_snapshot_from_view(view, job_id=job_id)
        return view



def _should_log_shared_worker_waiting_locked(job_id: str, log_key: tuple, now: float) -> bool:
    """Throttle shared-worker wait logs across all waiting series threads for a job.

    Without this, every waiting opponent/game thread emits the same waiting state once,
    which makes healthy CPU gating look like an error storm in PM2 logs.
    """
    try:
        throttle_sec = max(float(SHARED_WORKER_WAIT_LOG_INTERVAL_SEC or 8.0), 1.0)
    except Exception:
        throttle_sec = 8.0
    key = (str(job_id or ""), tuple(log_key or ()))
    last = _shared_pool_wait_log_last_by_key.get(key)
    if last is not None and (now - float(last)) < throttle_sec:
        return False
    _shared_pool_wait_log_last_by_key[key] = now

    # Keep this best-effort cache bounded for long-running PM2 processes.
    if len(_shared_pool_wait_log_last_by_key) > 500:
        cutoff = now - max(throttle_sec * 6.0, 60.0)
        for stale_key, stale_ts in list(_shared_pool_wait_log_last_by_key.items()):
            try:
                if float(stale_ts) < cutoff:
                    _shared_pool_wait_log_last_by_key.pop(stale_key, None)
            except Exception:
                _shared_pool_wait_log_last_by_key.pop(stale_key, None)
    return True



def _persistent_sim_counter_values(pool: dict) -> dict:
    """Extract persistent simulator counters as ints from a pool snapshot."""
    def _int_value(key: str) -> int:
        try:
            return int(pool.get(key) or 0)
        except Exception:
            return 0
    return {
        "created": _int_value("created"),
        "retired": _int_value("retired"),
        "borrowedPersistent": _int_value("borrowedPersistent"),
        "reusedPersistent": _int_value("reusedPersistent"),
        "fallbacks": _int_value("fallbacks"),
        "spawnFailed": _int_value("spawnFailed"),
        "requestFailed": _int_value("requestFailed"),
        "borrowWaits": _int_value("borrowWaits"),
        "borrowWaitTimeouts": _int_value("borrowWaitTimeouts"),
        "borrowWaitMsSamples": _int_value("borrowWaitMsSamples"),
        "borrowWaitMsTotal": _int_value("borrowWaitMsTotal"),
        "borrowWaitMsMax": _int_value("borrowWaitMsMax"),
        "battleRuntimeMsSamples": _int_value("battleRuntimeMsSamples"),
        "battleRuntimeMsTotal": _int_value("battleRuntimeMsTotal"),
        "battleRuntimeMsMax": _int_value("battleRuntimeMsMax"),
        "coldSpawnsDisciplined": _int_value("coldSpawnsDisciplined"),
    }


def _persistent_sim_register_job_counter_baseline(job_id: str, reason: str = "job-start") -> dict:
    """Capture lifetime simulator counters at job start so logs can show per-job deltas."""
    try:
        pool = get_persistent_sim_worker_pool_snapshot() or {}
    except Exception:
        pool = {}
    baseline = _persistent_sim_counter_values(pool)
    baseline["capturedAt"] = utc_now_iso()
    baseline["reason"] = reason
    with _persistent_sim_job_counter_lock:
        _persistent_sim_job_counter_baselines[str(job_id or "")] = baseline
        if len(_persistent_sim_job_counter_baselines) > 100:
            for stale_job_id in list(_persistent_sim_job_counter_baselines.keys())[:-50]:
                _persistent_sim_job_counter_baselines.pop(stale_job_id, None)
    return baseline


def _persistent_sim_clear_job_counter_baseline(job_id: str | None):
    if not job_id:
        return
    with _persistent_sim_job_counter_lock:
        _persistent_sim_job_counter_baselines.pop(str(job_id), None)


def _persistent_sim_job_counter_deltas(pool: dict, job_id: str | None) -> dict:
    if not job_id:
        return {}
    current = _persistent_sim_counter_values(pool)
    with _persistent_sim_job_counter_lock:
        baseline = dict(_persistent_sim_job_counter_baselines.get(str(job_id)) or {})
    if not baseline:
        return {}

    def _delta(key: str) -> int:
        try:
            return max(int(current.get(key) or 0) - int(baseline.get(key) or 0), 0)
        except Exception:
            return 0

    return {
        "actualSimWorkersBorrowedThisJob": _delta("borrowedPersistent"),
        "actualSimWorkersReusedThisJob": _delta("reusedPersistent"),
        "actualSimWorkersCreatedThisJob": _delta("created"),
        "actualSimWorkersRetiredThisJob": _delta("retired"),
        "actualSimWorkersFallbacksThisJob": _delta("fallbacks"),
        "actualSimWorkersSpawnFailedThisJob": _delta("spawnFailed"),
        "actualSimWorkersRequestFailedThisJob": _delta("requestFailed"),
        "actualSimWorkersBorrowWaitsThisJob": _delta("borrowWaits"),
        "actualSimWorkersBorrowWaitTimeoutsThisJob": _delta("borrowWaitTimeouts"),
        "actualSimWorkersBorrowWaitMsSamplesThisJob": _delta("borrowWaitMsSamples"),
        "actualSimWorkersBorrowWaitMsThisJob": _delta("borrowWaitMsTotal"),
        "actualSimWorkerBattleRuntimeMsSamplesThisJob": _delta("battleRuntimeMsSamples"),
        "actualSimWorkerBattleRuntimeMsThisJob": _delta("battleRuntimeMsTotal"),
        "actualSimWorkersColdSpawnsDisciplinedThisJob": _delta("coldSpawnsDisciplined"),
        "actualSimWorkerCountersArePerJob": True,
        "actualSimWorkerLifetimeCountersAlsoShown": True,
    }


def _persistent_sim_telemetry_snapshot(
    job_id: str | None = None,
    *,
    include_pool: bool = False,
    include_details: bool = False,
) -> dict:
    """Return simulator-worker telemetry for logs.

    High-frequency slot/battle events use a true compact view so logs stay readable.
    Resource samples and final job summaries can request detailed counters. Runtime
    behavior is unchanged; this function only controls logging shape.
    """
    try:
        pool = get_persistent_sim_worker_pool_snapshot() or {}
    except Exception:
        pool = {}

    def _int_value(key: str) -> int:
        try:
            return int(pool.get(key) or 0)
        except Exception:
            return 0

    deltas = _persistent_sim_job_counter_deltas(pool, job_id)
    detailed = bool(include_pool or include_details)

    data = {
        "actualSimWorkerTelemetryCompact": not detailed,
        "actualSimWorkersLive": _int_value("live"),
        "actualSimWorkersCheckedOut": _int_value("checkedOut"),
        "actualSimWorkersReady": _int_value("ready"),
        "actualSimWorkersSpawning": _int_value("spawning"),
        "actualSimWorkersDisciplineMaxLive": _int_value("disciplineMaxLive"),
        "actualSimWorkersBorrowedThisJob": int(deltas.get("actualSimWorkersBorrowedThisJob") or 0),
        "actualSimWorkersCreatedThisJob": int(deltas.get("actualSimWorkersCreatedThisJob") or 0),
        "actualSimWorkersSpawnFailedThisJob": int(deltas.get("actualSimWorkersSpawnFailedThisJob") or 0),
    }

    if detailed:
        data.update({
            "actualSimWorkersCreated": _int_value("created"),
            "actualSimWorkersRetired": _int_value("retired"),
            "actualSimWorkersBorrowed": _int_value("borrowedPersistent"),
            "actualSimWorkersReused": _int_value("reusedPersistent"),
            "actualSimWorkersFallbacks": _int_value("fallbacks"),
            "actualSimWorkersSpawnFailed": _int_value("spawnFailed"),
            "actualSimWorkersRequestFailed": _int_value("requestFailed"),
            "actualSimWorkersDisciplineEnabled": bool(pool.get("disciplineEnabled")),
            "actualSimWorkersBorrowWaits": _int_value("borrowWaits"),
            "actualSimWorkersBorrowWaitTimeouts": _int_value("borrowWaitTimeouts"),
            "actualSimWorkersBorrowWaitMsSamples": _int_value("borrowWaitMsSamples"),
            "actualSimWorkersBorrowWaitMsTotal": _int_value("borrowWaitMsTotal"),
            "actualSimWorkersBorrowWaitMsMax": _int_value("borrowWaitMsMax"),
            "actualSimWorkersLastBorrowWaitMs": _int_value("lastBorrowWaitMs"),
            "actualSimWorkerBattleRuntimeMsSamples": _int_value("battleRuntimeMsSamples"),
            "actualSimWorkerBattleRuntimeMsTotal": _int_value("battleRuntimeMsTotal"),
            "actualSimWorkerBattleRuntimeMsMax": _int_value("battleRuntimeMsMax"),
            "actualSimWorkerLastBattleRuntimeMs": _int_value("lastBattleRuntimeMs"),
            "actualSimWorkersColdSpawnsDisciplined": _int_value("coldSpawnsDisciplined"),
            "actualSimWorkersLifetimeBorrowed": _int_value("borrowedPersistent"),
            "actualSimWorkersLifetimeReused": _int_value("reusedPersistent"),
            "actualSimWorkersLifetimeCreated": _int_value("created"),
            "actualSimWorkersLifetimeRetired": _int_value("retired"),
            "actualSimWorkersLifetimeFallbacks": _int_value("fallbacks"),
            "actualSimWorkersLifetimeSpawnFailed": _int_value("spawnFailed"),
            "actualSimWorkersLifetimeRequestFailed": _int_value("requestFailed"),
        })
        data.update(deltas)
        data.setdefault("actualSimWorkerCountersArePerJob", True)
        data.setdefault("actualSimWorkerLifetimeCountersAlsoShown", True)
        if include_pool:
            data["actualSimWorkerPool"] = pool

    return data

def _shared_slot_telemetry(view: dict, *, include_queue: bool = False) -> dict:
    """Return explicit shared-slot telemetry.

    These fields mirror the older assigned/global worker fields using slot
    terminology so logs do not imply every assigned shared slot is a separate
    simulator process.
    """
    data = {
        "sharedSlotsAssignedForJob": int(view.get("assigned") or 0),
        "sharedSlotsActiveGlobal": int(view.get("activeTotal") or 0),
        "sharedSlotsAllowedForJob": int(view.get("allowed") or 0),
        "sharedSlotsGlobalCap": int(view.get("globalCap") or SHARED_WORKER_POOL_CAP),
        "sharedSlotsAreConcurrencyPermits": True,
    }
    if include_queue:
        data["sharedSlotQueueSpot"] = int(view.get("queueSpot") or 0)
    return data

def _shared_worker_progress_worker_values(view: dict):
    """Return user-facing worker numbers for Discord progress.

    The denominator is the full shared worker pool, not the temporary CPU safety cap.
    The displayed assigned value is clamped to the current safety/allowed cap so the
    UI never shows impossible values like 6/4 after CPU throttling.
    """
    pool_cap = max(int(SHARED_WORKER_POOL_CAP or 1), 1)
    safety_cap = max(int(view.get("globalCap") or pool_cap), 1)
    allowed = max(int(view.get("allowed") or 0), 0)
    assigned = max(int(view.get("assigned") or 0), 0)
    clamp_cap = min(pool_cap, safety_cap)
    if allowed > 0:
        clamp_cap = min(clamp_cap, allowed)
    displayed_assigned = min(assigned, clamp_cap)
    return displayed_assigned, pool_cap, safety_cap

def _set_waiting_for_worker_progress(job_id: str, progress_state: dict, progress_lock: threading.Lock, view: dict):
    try:
        with progress_lock:
            snap = _progress_snapshot(progress_state)
        scored_games = int(snap.get("battle_wins") or 0) + int(snap.get("battle_losses") or 0) + int(snap.get("battle_ties") or 0)
        queue_spot = int(view.get("queueSpot") or 0)
        display_assigned_workers, display_total_workers, display_safety_cap = _shared_worker_progress_worker_values(view)
        worker_cap_snapshot = view.get("workerCapSnapshot") or _shared_worker_cap_snapshot_from_view(view, job_id=job_id)
        set_job_progress(
            job_id,
            phase="waiting-for-workers" if queue_spot > 0 else "benchmark-suite",
            percent=_progress_percent(progress_state),
            currentStep="Waiting for battle workers" if queue_spot > 0 else "Waiting for battle worker slot",
            waitingForWorkers=True,
            queueSpot=queue_spot,
            assignedWorkers=display_assigned_workers,
            totalWorkers=display_total_workers,
            safetyWorkerCap=display_safety_cap,
            cpuState=view.get("cpuState"),
            safeModeActive=_job_safe_mode_active(job_id),
            battleWins=int(snap.get("battle_wins") or 0),
            battleLosses=int(snap.get("battle_losses") or 0),
            battleTies=int(snap.get("battle_ties") or 0),
            recordWins=int(snap.get("battle_wins") or 0),
            recordLosses=int(snap.get("battle_losses") or 0),
            recordTies=int(snap.get("battle_ties") or 0),
            processedOpponents=int(snap.get("completed_opponents") or 0),
            totalOpponents=int(snap.get("total_opponents") or 0),
            processedGames=scored_games,
            totalGames=int(snap.get("total_games") or 0),
            failedGames=int(snap.get("failed_games") or 0),
            workerCapSnapshot=worker_cap_snapshot,
        )
    except Exception as exc:
        _log_event("shared_worker_wait_progress_failed", jobId=job_id, error=str(exc))


def _acquire_shared_worker_slot(job_id: str, progress_state: dict, progress_lock: threading.Lock, phase: str | None = None):
    last_progress_update = 0.0
    last_logged_view = None
    wait_started = time.time()
    with _shared_pool_condition:
        _shared_pool_waiting_since.setdefault(job_id, time.time())
        while True:
            view = _shared_worker_allocation_locked(job_id)
            assigned = int(view.get("assigned") or 0)
            allowed = int(view.get("allowed") or 0)
            active_total = int(view.get("activeTotal") or 0)
            global_cap = int(view.get("globalCap") or SHARED_WORKER_POOL_CAP)
            queue_spot = int(view.get("queueSpot") or 0)
            dist_heal_active = bool(view.get("distAutoHealActive"))
            can_run = (not dist_heal_active) and queue_spot <= 0 and allowed > assigned and active_total < global_cap
            if can_run:
                _shared_pool_active_by_job[job_id] = assigned + 1
                _shared_pool_waiting_since.pop(job_id, None)
                new_view = _shared_worker_allocation_locked(job_id)
                new_view["workerCapSnapshot"] = _shared_worker_cap_snapshot_from_view(new_view, job_id=job_id)
                _record_throughput_shared_slot_wait(job_id, _elapsed_ms(wait_started), new_view, phase=phase)
                _log_event(
                    "shared_worker_slot_assigned",
                    jobId=job_id,
                    assignedWorkers=int(new_view.get("assigned") or 0),
                    allowedWorkers=int(new_view.get("allowed") or 0),
                    globalActiveWorkers=int(new_view.get("activeTotal") or 0),
                    globalWorkerCap=int(new_view.get("globalCap") or global_cap),
                    cpuPercent=new_view.get("cpuPercent"),
                    cpuState=new_view.get("cpuState"),
                    cpuCooldownActive=bool(new_view.get("cpuCooldownActive")),
                    cpuCooldownCap=new_view.get("cpuCooldownCap"),
                    cpuCooldownRemainingMs=new_view.get("cpuCooldownRemainingMs"),
                    cpuCooldownTriggerState=new_view.get("cpuCooldownTriggerState"),
                    cpuRampCalmActive=bool(new_view.get("cpuRampCalmActive")),
                    cpuRampCalmRemainingMs=new_view.get("cpuRampCalmRemainingMs"),
                    cpuRampCalmCap=new_view.get("cpuRampCalmCap"),
                    hotRelaunchBlockActive=bool(new_view.get("hotRelaunchBlockActive")),
                    rampBlockedByCpu=bool(new_view.get("rampBlockedByCpu")),
                    adaptiveCeiling=new_view.get("adaptiveCeiling"),
                    runningReports=int(new_view.get("runningReports") or 0),
                    firstWaveActive=bool(new_view.get("firstWaveActive")),
                    firstWaveCap=new_view.get("firstWaveCap"),
                    firstWaveScoredGames=new_view.get("firstWaveScoredGames"),
                    firstWaveElapsedSec=new_view.get("firstWaveElapsedSec"),
                    gradualRampActive=bool(new_view.get("gradualRampActive")),
                    gradualRampCap=new_view.get("gradualRampCap"),
                    gradualRampScoredGames=new_view.get("gradualRampScoredGames"),
                    gradualRampStep=new_view.get("gradualRampStep"),
                    highCpuHoldActive=bool(new_view.get("highCpuHoldActive")),
                    highCpuHoldCap=new_view.get("highCpuHoldCap"),
                    highCpuHoldUntilScoredGames=new_view.get("highCpuHoldUntilScoredGames"),
                    stabilityLockActive=bool(new_view.get("stabilityLockActive")),
                    stabilityLockCap=new_view.get("stabilityLockCap"),
                    distAutoHealActive=bool(new_view.get("distAutoHealActive")),
                    **_shared_slot_telemetry(new_view),
                    **_persistent_sim_telemetry_snapshot(job_id),
                )
                return new_view

            now = time.time()
            log_key = (assigned, allowed, active_total, global_cap, queue_spot, view.get("cpuState"), dist_heal_active)
            if log_key != last_logged_view and _should_log_shared_worker_waiting_locked(job_id, log_key, now):
                last_logged_view = log_key
                _log_event(
                    "shared_worker_slot_waiting",
                    jobId=job_id,
                    assignedWorkers=assigned,
                    allowedWorkers=allowed,
                    globalActiveWorkers=active_total,
                    globalWorkerCap=global_cap,
                    queueSpot=queue_spot,
                    cpuPercent=view.get("cpuPercent"),
                    cpuState=view.get("cpuState"),
                    cpuCooldownActive=bool(view.get("cpuCooldownActive")),
                    cpuCooldownCap=view.get("cpuCooldownCap"),
                    cpuCooldownRemainingMs=view.get("cpuCooldownRemainingMs"),
                    cpuCooldownTriggerState=view.get("cpuCooldownTriggerState"),
                    cpuRampCalmActive=bool(view.get("cpuRampCalmActive")),
                    cpuRampCalmRemainingMs=view.get("cpuRampCalmRemainingMs"),
                    cpuRampCalmCap=view.get("cpuRampCalmCap"),
                    hotRelaunchBlockActive=bool(view.get("hotRelaunchBlockActive")),
                    rampBlockedByCpu=bool(view.get("rampBlockedByCpu")),
                    adaptiveCeiling=view.get("adaptiveCeiling"),
                    runningReports=int(view.get("runningReports") or 0),
                    firstWaveActive=bool(view.get("firstWaveActive")),
                    firstWaveCap=view.get("firstWaveCap"),
                    firstWaveScoredGames=view.get("firstWaveScoredGames"),
                    firstWaveElapsedSec=view.get("firstWaveElapsedSec"),
                    gradualRampActive=bool(view.get("gradualRampActive")),
                    gradualRampCap=view.get("gradualRampCap"),
                    gradualRampScoredGames=view.get("gradualRampScoredGames"),
                    gradualRampStep=view.get("gradualRampStep"),
                    highCpuHoldActive=bool(view.get("highCpuHoldActive")),
                    highCpuHoldCap=view.get("highCpuHoldCap"),
                    highCpuHoldUntilScoredGames=view.get("highCpuHoldUntilScoredGames"),
                    stabilityLockActive=bool(view.get("stabilityLockActive")),
                    stabilityLockCap=view.get("stabilityLockCap"),
                    distAutoHealActive=bool(view.get("distAutoHealActive")),
                    **_shared_slot_telemetry(view, include_queue=True),
                    **_persistent_sim_telemetry_snapshot(job_id),
                )
            if now - last_progress_update >= 1.0:
                last_progress_update = now
                _set_waiting_for_worker_progress(job_id, progress_state, progress_lock, view)
            _shared_pool_condition.wait(timeout=0.5)


def _release_shared_worker_slot(job_id: str, phase: str | None = None):
    with _shared_pool_condition:
        current = max(int(_shared_pool_active_by_job.get(job_id) or 0), 0)
        if current <= 1:
            _shared_pool_active_by_job.pop(job_id, None)
        else:
            _shared_pool_active_by_job[job_id] = current - 1
        view = _shared_worker_allocation_locked(job_id)
        _shared_pool_condition.notify_all()
    _log_event(
        "shared_worker_slot_released",
        jobId=job_id,
        assignedWorkers=int(view.get("assigned") or 0),
        globalActiveWorkers=int(view.get("activeTotal") or 0),
        globalWorkerCap=int(view.get("globalCap") or SHARED_WORKER_POOL_CAP),
        cpuPercent=view.get("cpuPercent"),
        cpuState=view.get("cpuState"),
        cpuCooldownActive=bool(view.get("cpuCooldownActive")),
        cpuCooldownCap=view.get("cpuCooldownCap"),
        cpuCooldownRemainingMs=view.get("cpuCooldownRemainingMs"),
        cpuCooldownTriggerState=view.get("cpuCooldownTriggerState"),
        cpuRampCalmActive=bool(view.get("cpuRampCalmActive")),
        cpuRampCalmRemainingMs=view.get("cpuRampCalmRemainingMs"),
        cpuRampCalmCap=view.get("cpuRampCalmCap"),
        hotRelaunchBlockActive=bool(view.get("hotRelaunchBlockActive")),
        rampBlockedByCpu=bool(view.get("rampBlockedByCpu")),
        adaptiveCeiling=view.get("adaptiveCeiling"),
        gradualRampActive=bool(view.get("gradualRampActive")),
        gradualRampCap=view.get("gradualRampCap"),
        highCpuHoldActive=bool(view.get("highCpuHoldActive")),
        highCpuHoldCap=view.get("highCpuHoldCap"),
        highCpuHoldUntilScoredGames=view.get("highCpuHoldUntilScoredGames"),
        stabilityLockActive=bool(view.get("stabilityLockActive")),
        stabilityLockCap=view.get("stabilityLockCap"),
        distAutoHealActive=bool(view.get("distAutoHealActive")),
        **_shared_slot_telemetry(view),
        **_persistent_sim_telemetry_snapshot(job_id),
    )
    _record_worker_diagnostic_samples(
        job_id,
        phase=phase,
        sharedAssigned=view.get("assigned"),
        sharedAllowed=view.get("allowed"),
        sharedActiveGlobal=view.get("activeTotal"),
        cpuPercent=view.get("cpuPercent"),
    )


def _activate_job_safe_mode(job_id: str, reason: str = "battle-retry", cap: int = None):
    safe_cap = max(int(cap or BATTLE_RETRY_SAFE_WORKER_CAP or 4), 1)
    with _shared_pool_condition:
        previous = _shared_pool_forced_cap_by_job.get(job_id)
        if reason == "full-regulation-drain-stability-cap":
            _shared_pool_recoverable_cap_by_job[job_id] = safe_cap
        elif job_id in _shared_pool_recoverable_cap_by_job:
            _shared_pool_recoverable_cap_by_job[job_id] = max(int(_shared_pool_recoverable_cap_by_job.get(job_id) or 1), safe_cap)
        if previous is None or int(previous) > safe_cap:
            _shared_pool_forced_cap_by_job[job_id] = safe_cap
            _shared_pool_forced_cap_reason_by_job[job_id] = reason
            _shared_pool_condition.notify_all()
            _log_event(
                "safe_mode_activated",
                jobId=job_id,
                reason=reason,
                safeWorkerCap=safe_cap,
                previousWorkerCap=previous,
            )
        elif reason != "full-regulation-drain-stability-cap":
            _shared_pool_forced_cap_reason_by_job[job_id] = reason
    return safe_cap


def _recover_job_safe_mode_after_progress(job_id: str, reason: str = "battle-progress"):
    cap, cpu_percent, cpu_state, cpu_cooldown = _shared_worker_cpu_cap()
    if cpu_state in {"high", "critical", "cpu-cooldown"} or bool(cpu_cooldown.get("active")) or _dist_heal_gate_active():
        return {"recovered": False, "reason": "cpu-or-heal-guard", "cpuState": cpu_state, "cpuPercent": cpu_percent}

    target_cap = None
    previous = None
    with _shared_pool_condition:
        previous = _shared_pool_forced_cap_by_job.get(job_id)
        target_cap = _shared_pool_recoverable_cap_by_job.get(job_id)
        if previous is None or target_cap is None:
            return {"recovered": False, "reason": "no-recoverable-cap", "cpuState": cpu_state, "cpuPercent": cpu_percent}
        target_cap = max(1, min(int(target_cap or 1), int(cap or 1), SHARED_WORKER_POOL_CAP, GLOBAL_BATTLE_SEMAPHORE_CAP))
        if int(previous) >= target_cap:
            return {
                "recovered": False,
                "reason": "already-at-target",
                "previousWorkerCap": int(previous),
                "targetWorkerCap": int(target_cap),
                "cpuState": cpu_state,
                "cpuPercent": cpu_percent,
            }
        _shared_pool_forced_cap_by_job[job_id] = target_cap
        _shared_pool_condition.notify_all()

    _log_event(
        "safe_mode_cap_recovered",
        jobId=job_id,
        reason=reason,
        previousWorkerCap=int(previous),
        recoveredWorkerCap=int(target_cap),
        cpuPercent=cpu_percent,
        cpuState=cpu_state,
    )
    return {
        "recovered": True,
        "previousWorkerCap": int(previous),
        "recoveredWorkerCap": int(target_cap),
        "cpuState": cpu_state,
        "cpuPercent": cpu_percent,
    }


def _clear_lead_pair_retry_cap_after_progress(job_id: str, reason: str = "lead-pair-progress"):
    previous = None
    with _shared_pool_condition:
        current_reason = str(_shared_pool_forced_cap_reason_by_job.get(job_id) or "").strip()
        if current_reason != "lead-pair-battle-retry":
            return {"cleared": False, "reason": "no-lead-pair-retry-cap", "forcedCapReason": current_reason or None}
        previous = _shared_pool_forced_cap_by_job.pop(job_id, None)
        _shared_pool_forced_cap_reason_by_job.pop(job_id, None)
        _shared_pool_recoverable_cap_by_job.pop(job_id, None)
        view = _shared_worker_allocation_locked(job_id)
        _shared_pool_condition.notify_all()

    _log_event(
        "lead_pair_retry_cap_cleared",
        jobId=job_id,
        reason=reason,
        previousWorkerCap=previous,
        clearedForcedCapReason="lead-pair-battle-retry",
        assignedWorkers=int(view.get("assigned") or 0),
        allowedWorkers=int(view.get("allowed") or 0),
        globalActiveWorkers=int(view.get("activeTotal") or 0),
        globalWorkerCap=int(view.get("globalCap") or SHARED_WORKER_POOL_CAP),
        cpuPercent=view.get("cpuPercent"),
        cpuState=view.get("cpuState"),
        cpuCooldownActive=bool(view.get("cpuCooldownActive")),
    )
    return {
        "cleared": True,
        "previousWorkerCap": previous,
        "clearedForcedCapReason": "lead-pair-battle-retry",
    }


def _lead_pair_retry_cap_active(job_id: str) -> bool:
    with _shared_pool_condition:
        return str(_shared_pool_forced_cap_reason_by_job.get(job_id) or "").strip() == "lead-pair-battle-retry"


def _job_safe_mode_active(job_id: str) -> bool:
    with _shared_pool_condition:
        return _forced_cap_counts_as_safe_mode(
            _shared_pool_forced_cap_reason_by_job.get(job_id),
            _shared_pool_forced_cap_by_job.get(job_id),
        )


def _retry_worker_cap_for_attempt(attempt: int) -> int:
    """Return the safest worker cap for the next retry attempt.

    Attempt 1 is the original try. Attempt 2 is the first retry and should
    drop to the deeper Safe Mode cap. Attempt 3+ uses the final single-worker
    rescue path so failed games are solved safely instead of becoming report data.
    """
    try:
        attempt = int(attempt or 1)
    except Exception:
        attempt = 1
    if attempt >= 2:
        return max(1, int(BATTLE_RETRY_FINAL_WORKER_CAP or 1))
    return max(1, int(BATTLE_RETRY_SAFE_WORKER_CAP or 2))


def _clear_shared_worker_job(job_id: str):
    with _shared_pool_condition:
        _shared_pool_active_by_job.pop(job_id, None)
        _shared_pool_waiting_since.pop(job_id, None)
        _shared_pool_forced_cap_by_job.pop(job_id, None)
        _shared_pool_forced_cap_reason_by_job.pop(job_id, None)
        _shared_pool_recoverable_cap_by_job.pop(job_id, None)
        _shared_pool_high_cpu_hold_by_job.pop(job_id, None)
        _shared_pool_condition.notify_all()


def _running_benchmark_job_count():
    with _jobs_lock:
        return sum(
            1 for job in _jobs.values()
            if job.get("status") == "running" and job.get("jobType") == "run-benchmark-suite"
        )


def _any_active_benchmark_work() -> bool:
    try:
        resource_state = _resource_state_snapshot()
        job_counts = summarize_job_counts()
        return (
            _running_benchmark_job_count() > 0
            or int(resource_state.get("activeBattles") or 0) > 0
            or int(resource_state.get("activeSuiteJobs") or 0) > 0
            or int(job_counts.get("queued") or 0) > 0
        )
    except Exception:
        return True


def _schedule_persistent_idle_retire(reason: str = "job-completed"):
    global _persistent_idle_retire_timer
    if not PERSISTENT_SIM_WORKER_IDLE_RETIRE_ENABLED or not PERSISTENT_SIM_WORKER_ENABLED:
        return
    delay = max(float(PERSISTENT_SIM_WORKER_IDLE_RETIRE_DELAY_SEC or 0.0), 0.0)
    idle_sec = max(float(PERSISTENT_SIM_WORKER_IDLE_RETIRE_SEC or 0.0), 0.0)
    if idle_sec <= 0:
        return

    def _retire_if_idle():
        global _persistent_idle_retire_timer
        with _persistent_idle_retire_lock:
            _persistent_idle_retire_timer = None
        if _any_active_benchmark_work():
            _log_event("persistent_sim_worker_idle_retire_deferred", reason=reason, activeWork=True)
            _schedule_persistent_idle_retire(reason="active-work-deferred")
            return
        try:
            snapshot = retire_idle_persistent_sim_worker_pool(max_idle_sec=idle_sec, reason=reason)
            if int(snapshot.get("idleRetired") or 0) > 0:
                _log_event(
                    "persistent_sim_worker_idle_retired",
                    reason=reason,
                    idleRetired=snapshot.get("idleRetired"),
                    ready=snapshot.get("ready"),
                    targetSize=snapshot.get("targetSize"),
                    maxIdleSec=snapshot.get("idleRetireMaxIdleSec"),
                    pool=snapshot,
                )
        except Exception as exc:
            _log_event("persistent_sim_worker_idle_retire_failed", reason=reason, error=str(exc))

    with _persistent_idle_retire_lock:
        if _persistent_idle_retire_timer is not None:
            try:
                _persistent_idle_retire_timer.cancel()
            except Exception:
                pass
        timer = threading.Timer(delay, _retire_if_idle)
        timer.daemon = True
        _persistent_idle_retire_timer = timer
        timer.start()


def _update_startup_integrity_state(**updates):
    with _startup_integrity_state_lock:
        _startup_integrity_state.update(updates)
        return dict(_startup_integrity_state)


def _get_startup_integrity_state() -> dict:
    with _startup_integrity_state_lock:
        state = dict(_startup_integrity_state)
    if state.get("startedEpochMs") and not state.get("completedEpochMs"):
        state["elapsedMs"] = max(int(time.time() * 1000) - int(state.get("startedEpochMs") or 0), 0)
    else:
        state["elapsedMs"] = int(state.get("durationMs") or 0) if state.get("durationMs") is not None else 0
    return state


def _startup_integrity_gate_active() -> bool:
    state = _get_startup_integrity_state()
    return bool(state.get("enabled") and not state.get("ready") and state.get("status") not in {"disabled", "skipped", "failed"})


def _read_showdown_integrity_cache(repo_dir: str, format_id: str) -> tuple[dict | None, dict | None, float | None]:
    now = time.time()
    repo_dir = str(repo_dir or "")
    format_id = str(format_id or "")
    with _integrity_cache_lock:
        cached_custom = _integrity_cache.get("customFormats")
        cached_integrity = _integrity_cache.get("integrity")
        cache_age = now - float(_integrity_cache.get("checkedAt") or 0.0)
        cache_match = (
            bool(cached_custom)
            and bool(cached_integrity)
            and _integrity_cache.get("repoDir") == repo_dir
            and _integrity_cache.get("formatId") == format_id
            and SHOWDOWN_INTEGRITY_CACHE_TTL_SEC > 0
            and cache_age <= SHOWDOWN_INTEGRITY_CACHE_TTL_SEC
            and bool(cached_custom.get("ok"))
            and bool(cached_integrity.get("ok"))
            and (not SHOWDOWN_INTEGRITY_RECHECK_ON_WARNINGS or not cached_integrity.get("warnings"))
        )
        if not cache_match:
            return None, None, None
        return dict(cached_custom), dict(cached_integrity), cache_age


def _log_showdown_integrity_cache_used(job_id: str, cached_integrity: dict, cache_age: float, waited_for_active_check: bool = False):
    _log_event(
        "showdown_integrity_cache_used",
        jobId=job_id,
        cacheAgeMs=int(round(float(cache_age or 0.0) * 1000)),
        cacheTtlSec=SHOWDOWN_INTEGRITY_CACHE_TTL_SEC,
        reason=cached_integrity.get("reason"),
        warningCount=len(cached_integrity.get("warnings") or []),
        waitedForActiveCheck=bool(waited_for_active_check),
    )


def _cached_showdown_prereq_checks(job_id: str, repo_dir: str, format_id: str) -> tuple[dict, dict, bool]:
    repo_dir = str(repo_dir or "")
    format_id = str(format_id or "")
    cached_custom, cached_integrity, cache_age = _read_showdown_integrity_cache(repo_dir, format_id)
    if cached_custom and cached_integrity:
        _log_showdown_integrity_cache_used(job_id, cached_integrity, cache_age or 0.0)
        return cached_custom, cached_integrity, True

    with _integrity_check_lock:
        # If startup warming or another benchmark finished the expensive check while this job waited, reuse it.
        cached_custom, cached_integrity, cache_age = _read_showdown_integrity_cache(repo_dir, format_id)
        if cached_custom and cached_integrity:
            _log_showdown_integrity_cache_used(job_id, cached_integrity, cache_age or 0.0, waited_for_active_check=True)
            return cached_custom, cached_integrity, True

        custom_formats = ensure_benchmark_custom_formats(timeout_ms=SHOWDOWN_INTEGRITY_TIMEOUT_MS)
        _log_event(
            "showdown_custom_formats_checked",
            jobId=job_id,
            ok=bool(custom_formats.get("ok")),
            reason=custom_formats.get("reason"),
            repaired=bool(custom_formats.get("repaired")),
            detail=(str(custom_formats.get("detail") or "")[:1000]),
            formatId=custom_formats.get("formatId"),
            repair=custom_formats.get("repair"),
        )
        if not custom_formats.get("ok"):
            return custom_formats, {"ok": False, "reason": "custom-formats-not-ready", "detail": custom_formats.get("detail")}, False

        integrity = validate_showdown_integrity(timeout_ms=SHOWDOWN_INTEGRITY_TIMEOUT_MS)
        _log_event(
            "showdown_integrity_checked",
            jobId=job_id,
            ok=bool(integrity.get("ok")),
            reason=integrity.get("reason"),
            durationMs=integrity.get("durationMs"),
            detail=(str(integrity.get("detail") or "")[:500]),
            warnings=integrity.get("warnings"),
        )
        if custom_formats.get("ok") and integrity.get("ok"):
            with _integrity_cache_lock:
                _integrity_cache.update({
                    "checkedAt": time.time(),
                    "repoDir": repo_dir,
                    "formatId": format_id,
                    "customFormats": dict(custom_formats),
                    "integrity": dict(integrity),
                })
        return custom_formats, integrity, False

def _resource_monitor_loop():
    previous_cpu = _read_proc_cpu_times()
    cpu_count = os.cpu_count() or 1
    while True:
        time.sleep(RESOURCE_MONITOR_INTERVAL_SEC)
        try:
            current_cpu = _read_proc_cpu_times()
            cpu_percent = None
            if previous_cpu and current_cpu:
                total_delta = max(current_cpu[0] - previous_cpu[0], 1)
                idle_delta = max(current_cpu[1] - previous_cpu[1], 0)
                cpu_percent = round(max(0.0, min(100.0, (1.0 - (idle_delta / total_delta)) * 100.0)), 1)
            _set_latest_cpu_percent(cpu_percent)
            previous_cpu = current_cpu or previous_cpu

            resource_state = _resource_state_snapshot()
            shared_pool = _shared_worker_snapshot()
            job_counts = summarize_job_counts()
            active_jobs = _running_benchmark_job_count()
            active_battles = int(resource_state.get("activeBattles") or 0)
            queued_jobs = int(job_counts.get("queued") or 0)

            if active_jobs <= 0 and active_battles <= 0 and queued_jobs <= 0:
                _resource_reset_completed_counters(reason="resource-monitor-idle")
                continue

            try:
                load_1m, load_5m, load_15m = os.getloadavg()
            except Exception:
                load_1m = load_5m = load_15m = None

            memory = _read_memory_snapshot()
            shared_active_by_job = shared_pool.get("activeByJob") if isinstance(shared_pool.get("activeByJob"), dict) else {}
            active_job_ids = [str(jid) for jid, count in shared_active_by_job.items() if int(count or 0) > 0]
            active_job_id = active_job_ids[0] if len(active_job_ids) == 1 else None
            persistent_pool_snapshot = get_persistent_sim_worker_pool_snapshot()
            if active_job_id:
                _record_worker_diagnostic_samples(
                    active_job_id,
                    cpuPercent=cpu_percent,
                    memoryUsedMb=memory.get("memoryUsedMb"),
                    memoryPercent=memory.get("memoryPercent"),
                    sharedAssigned=shared_pool.get("assigned"),
                    sharedAllowed=shared_pool.get("allowed"),
                    sharedActiveGlobal=shared_pool.get("activeTotal"),
                    persistentLive=persistent_pool_snapshot.get("live"),
                    persistentReady=persistent_pool_snapshot.get("ready"),
                    persistentCheckedOut=persistent_pool_snapshot.get("checkedOut"),
                )
            _log_resource(
                "resource_sample",
                cpuPercent=cpu_percent,
                cpuCount=cpu_count,
                loadAvg1m=round(load_1m, 2) if load_1m is not None else None,
                loadAvg5m=round(load_5m, 2) if load_5m is not None else None,
                loadAvg15m=round(load_15m, 2) if load_15m is not None else None,
                loadPerCpu=round(load_1m / cpu_count, 2) if load_1m is not None and cpu_count else None,
                activeJobs=active_jobs,
                queuedJobs=queued_jobs,
                runningJobs=int(job_counts.get("running") or 0),
                activeBattles=active_battles,
                activeSuiteJobs=int(resource_state.get("activeSuiteJobs") or 0),
                launchedBattles=int(resource_state.get("launchedBattles") or 0),
                scoredBattles=int(resource_state.get("scoredBattles") or 0),
                containedFailures=int(resource_state.get("containedFailures") or 0),
                configuredParallel=SUITE_PARALLEL_BATTLES,
                globalSemaphoreCap=GLOBAL_BATTLE_SEMAPHORE_CAP,
                sharedWorkerPoolEnabled=SHARED_WORKER_POOL_ENABLED,
                sharedWorkerCap=int(shared_pool.get("globalCap") or SHARED_WORKER_POOL_CAP),
                sharedWorkerCpuState=shared_pool.get("cpuState"),
                sharedWorkerCpuCooldownActive=bool(shared_pool.get("cpuCooldownActive")),
                sharedWorkerCpuCooldownCap=shared_pool.get("cpuCooldownCap"),
                sharedWorkerCpuCooldownRemainingMs=shared_pool.get("cpuCooldownRemainingMs"),
                sharedWorkerCpuCooldownTriggerState=shared_pool.get("cpuCooldownTriggerState"),
                sharedWorkerCpuRampCalmActive=bool(shared_pool.get("cpuRampCalmActive")),
                sharedWorkerCpuRampCalmRemainingMs=shared_pool.get("cpuRampCalmRemainingMs"),
                sharedWorkerCpuRampCalmCap=shared_pool.get("cpuRampCalmCap"),
                sharedWorkerHotRelaunchBlockActive=bool(shared_pool.get("hotRelaunchBlockActive")),
                sharedWorkerRampBlockedByCpu=bool(shared_pool.get("rampBlockedByCpu")),
                sharedWorkerAdaptiveCeiling=shared_pool.get("adaptiveCeiling"),
                sharedSlotsActiveGlobal=int(shared_pool.get("activeTotal") or 0),
                sharedSlotsGlobalCap=int(shared_pool.get("globalCap") or SHARED_WORKER_POOL_CAP),
                sharedSlotsAreConcurrencyPermits=True,
                sharedWorkersActive=int(shared_pool.get("activeTotal") or 0),
                sharedWorkersByJob=shared_pool.get("activeByJob"),
                sharedWorkerWaitingJobs=shared_pool.get("waitingJobs"),
                firstWaveActive=bool(shared_pool.get("firstWaveActive")),
                firstWaveCap=shared_pool.get("firstWaveCap"),
                firstWaveScoredGames=shared_pool.get("firstWaveScoredGames"),
                firstWaveElapsedSec=shared_pool.get("firstWaveElapsedSec"),
                gradualRampActive=bool(shared_pool.get("gradualRampActive")),
                gradualRampCap=shared_pool.get("gradualRampCap"),
                gradualRampScoredGames=shared_pool.get("gradualRampScoredGames"),
                gradualRampStep=shared_pool.get("gradualRampStep"),
                stabilityLockActive=bool(shared_pool.get("stabilityLockActive")),
                stabilityLockCap=shared_pool.get("stabilityLockCap"),
                distAutoHealActive=bool(shared_pool.get("distAutoHealActive")),
                warmRunnerPool=get_warm_runner_pool_snapshot(),
                persistentSimWorkerPool=persistent_pool_snapshot,
                **_persistent_sim_telemetry_snapshot(active_job_id, include_details=True),
                activeJobId=active_job_id,
                **memory,
            )
        except Exception as exc:
            _log_resource("resource_monitor_error", error=str(exc), traceback=traceback.format_exc(limit=2))


def _start_resource_monitor():
    global _resource_monitor_started
    if not RESOURCE_MONITOR_ENABLED:
        return
    with _resource_monitor_lock:
        if _resource_monitor_started:
            return
        _resource_monitor_started = True
        thread = threading.Thread(target=_resource_monitor_loop, daemon=True)
        thread.start()
        _log_resource(
            "resource_monitor_started",
            intervalSec=RESOURCE_MONITOR_INTERVAL_SEC,
            configuredParallel=SUITE_PARALLEL_BATTLES,
            globalSemaphoreCap=GLOBAL_BATTLE_SEMAPHORE_CAP,
        )



def _build_readiness_payload(reason: str = "manual", allow_autostart: bool = True) -> dict:
    check_started = time.time()
    try:
        if allow_autostart:
            try:
                ensure_showdown_ready()
            except Exception as exc:
                _log_event("readiness_autostart_check_failed", reason=reason, error=str(exc))

        showdown_status = get_showdown_status()
        repo_ready = bool(showdown_status.get("repoDir"))
        cli_ready = bool(showdown_status.get("cliReady"))
        reachable = bool(showdown_status.get("reachable"))
        server_required = bool(REQUIRE_SHOWDOWN_SERVER_READY)
        execution_ready = bool(repo_ready and cli_ready and (reachable or not server_required))
        startup_integrity = _get_startup_integrity_state()
        startup_gate_active = bool(execution_ready and _startup_integrity_gate_active())

        checks = {
            "workerListening": True,
            "repoDirConfigured": repo_ready,
            "showdownCliReady": cli_ready,
            "showdownServerReachable": reachable,
            "showdownServerRequired": server_required,
            "localBattleExecutionReady": execution_ready,
            "startupIntegrityWarmCacheReady": bool(startup_integrity.get("ready") or not startup_integrity.get("enabled")),
            "startupIntegrityWarmCacheActive": bool(startup_integrity.get("active")),
            "startupPersistentWorkersReady": bool(startup_integrity.get("persistentWorkersReady") or not startup_integrity.get("persistentWorkersWarmEnabled")),
            "startupPersistentWorkersTargetReady": int(startup_integrity.get("persistentWorkersTargetReady") or 0),
        }

        if startup_gate_active:
            status = "warming"
            status_text = "BenchMark startup warm cache is still preparing"
            detail_text = startup_integrity.get("statusText") or "Showdown integrity cache and persistent simulator workers are warming. Matchup reports will unlock automatically when ready."
        elif execution_ready:
            status = "ready"
            status_text = "BenchMark execution path ready"
            detail_text = "Worker, local Showdown CLI, and battle execution prerequisites are ready."
        else:
            status = "not-ready"
            missing = []
            if not repo_ready:
                missing.append("Showdown repo dir")
            if not cli_ready:
                missing.append("Showdown CLI")
            if server_required and not reachable:
                missing.append("Showdown server reachability")
            detail_text = "Waiting on: " + ", ".join(missing or ["benchmark execution readiness"])
            status_text = "BenchMark execution path not ready"

        try:
            worker_cap_snapshot = _shared_worker_snapshot().get("workerCapSnapshot")
        except Exception:
            worker_cap_snapshot = None

        return {
            "ok": execution_ready and not startup_gate_active,
            "ready": execution_ready and not startup_gate_active,
            "startupWarmCache": startup_integrity,
            "warmupActive": startup_gate_active,
            "retryable": True,
            "status": status,
            "statusText": status_text,
            "detailText": detail_text,
            "checkedAt": utc_now_iso(),
            "checkedEpochMs": int(time.time() * 1000),
            "checkDurationMs": _elapsed_ms(check_started),
            "reason": reason,
            "workerVersion": WORKER_VERSION,
            "bootedAt": _WORKER_BOOT_ISO,
            "uptimeMs": _elapsed_ms(_WORKER_BOOT_TS),
            "configuredParallelBattles": SUITE_PARALLEL_BATTLES,
            "globalBattleSemaphoreCap": GLOBAL_BATTLE_SEMAPHORE_CAP,
            "sharedWorkerPoolEnabled": SHARED_WORKER_POOL_ENABLED,
            "sharedWorkerPoolCap": SHARED_WORKER_POOL_CAP,
            "sharedWorkerSoloMax": SHARED_WORKER_SOLO_MAX,
            "sharedWorkerPrimarySharedMax": SHARED_WORKER_PRIMARY_SHARED_MAX,
            "sharedWorkerSecondarySharedMax": SHARED_WORKER_SECONDARY_SHARED_MAX,
            "workerCapSnapshot": worker_cap_snapshot,
            "checks": checks,
            "showdown": showdown_status,
        }
    except Exception as exc:
        return {
            "ok": False,
            "ready": False,
            "status": "error",
            "statusText": "BenchMark readiness check failed",
            "detailText": str(exc) or "Unknown readiness error.",
            "checkedAt": utc_now_iso(),
            "checkedEpochMs": int(time.time() * 1000),
            "checkDurationMs": _elapsed_ms(check_started),
            "reason": reason,
            "workerVersion": WORKER_VERSION,
            "bootedAt": _WORKER_BOOT_ISO,
            "uptimeMs": _elapsed_ms(_WORKER_BOOT_TS),
            "checks": {"workerListening": True, "readinessException": True},
            "showdown": {},
        }


def refresh_benchmark_readiness(reason: str = "manual", allow_autostart: bool = True) -> dict:
    payload = _build_readiness_payload(reason=reason, allow_autostart=allow_autostart)
    with _ready_lock:
        previous_status = _readiness_state.get("status")
        _readiness_state.clear()
        _readiness_state.update(payload)

    if previous_status != payload.get("status") or reason in {"startup", "job-submit"}:
        _log_event(
            "readiness_checked",
            reason=reason,
            ready=payload.get("ready"),
            status=payload.get("status"),
            detailText=payload.get("detailText"),
            checks=payload.get("checks"),
        )
    return payload


def get_benchmark_readiness(reason: str = "manual", force: bool = False) -> dict:
    now_ms = int(time.time() * 1000)
    with _ready_lock:
        cached = dict(_readiness_state)
    age_ms = now_ms - int(cached.get("checkedEpochMs") or 0)
    if force or not cached.get("checkedAt") or age_ms > READINESS_CACHE_TTL_MS:
        return refresh_benchmark_readiness(reason=reason)
    cached["cacheAgeMs"] = age_ms
    return cached


def _require_benchmark_ready() -> tuple[bool, dict]:
    readiness = get_benchmark_readiness(reason="job-submit", force=False)
    return bool(readiness.get("ready")), readiness


def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "1" if default else "0")).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, str(default))).strip())
    except Exception:
        return default


def _prewarm_repo_opponent_cache():
    if not _env_bool("BENCHMARK_REPO_CACHE_PREWARM_ENABLED", True):
        _log_event("repo_opponent_cache_prewarm_skipped", reason="disabled")
        return

    limit = max(_env_int("BENCHMARK_REPO_CACHE_PREWARM_LIMIT", 16), 1)
    started = time.time()
    _log_event(
        "repo_opponent_cache_prewarm_started",
        formatId=DEFAULT_FORMAT_ID,
        featuredOnly=True,
        limit=limit,
    )
    try:
        result = warm_repo_opponent_cache(
            format_id=DEFAULT_FORMAT_ID,
            featured_only=True,
            limit=limit,
        )
        result_payload = dict(result or {})
        cache_duration_ms = result_payload.pop("durationMs", None)
        _log_event(
            "repo_opponent_cache_prewarm_completed",
            durationMs=_elapsed_ms(started),
            cacheDurationMs=cache_duration_ms,
            **result_payload,
        )
    except Exception as exc:
        _log_event(
            "repo_opponent_cache_prewarm_failed",
            durationMs=_elapsed_ms(started),
            error=str(exc),
        )


def _startup_integrity_warm_cache():
    if not SHOWDOWN_INTEGRITY_CHECK_ENABLED or not SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_ENABLED:
        _update_startup_integrity_state(
            enabled=False,
            active=False,
            completed=True,
            ready=True,
            ok=True,
            status="disabled",
            statusText="Startup integrity warm cache disabled",
            completedAt=utc_now_iso(),
            completedEpochMs=int(time.time() * 1000),
        )
        _log_event("showdown_integrity_startup_warm_cache_skipped", reason="disabled")
        return
    if SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_DELAY_SEC > 0:
        time.sleep(SHOWDOWN_INTEGRITY_STARTUP_WARM_CACHE_DELAY_SEC)

    started = time.time()
    job_id = "startup-integrity-warm-cache"
    _update_startup_integrity_state(
        enabled=True,
        active=True,
        completed=False,
        ready=False,
        ok=False,
        status="running",
        statusText="Showdown integrity cache is warming",
        detailText="Professor Aegis is preparing the first-run benchmark cache.",
        startedAt=utc_now_iso(),
        startedEpochMs=int(started * 1000),
        completedAt=None,
        completedEpochMs=0,
        durationMs=None,
        reason=None,
        error=None,
    )
    try:
        showdown_status = get_showdown_status()
        repo_dir = showdown_status.get("repoDir")
        if not repo_dir:
            _update_startup_integrity_state(
                active=False,
                completed=True,
                ready=True,
                ok=False,
                status="skipped",
                statusText="Startup integrity warm cache skipped",
                detailText="Showdown repo dir was not configured during startup warm cache.",
                completedAt=utc_now_iso(),
                completedEpochMs=int(time.time() * 1000),
                durationMs=_elapsed_ms(started),
                reason="missing-repo-dir",
            )
            _log_event("showdown_integrity_startup_warm_cache_skipped", reason="missing-repo-dir")
            return

        _log_event(
            "showdown_integrity_startup_warm_cache_started",
            jobId=job_id,
            formatId=DEFAULT_FORMAT_ID,
            cacheTtlSec=SHOWDOWN_INTEGRITY_CACHE_TTL_SEC,
        )
        custom_formats, integrity, used_cache = _cached_showdown_prereq_checks(
            job_id=job_id,
            repo_dir=repo_dir,
            format_id=DEFAULT_FORMAT_ID,
        )
        ok = bool(custom_formats.get("ok") and integrity.get("ok"))
        warning_count = len(integrity.get("warnings") or [])
        _log_event(
            "showdown_integrity_startup_warm_cache_completed",
            jobId=job_id,
            ok=ok,
            usedCache=bool(used_cache),
            reason=integrity.get("reason"),
            warningCount=warning_count,
            durationMs=_elapsed_ms(started),
        )

        worker_prewarm_snapshot = None
        workers_ready = False
        configured_worker_target_ready = min(PERSISTENT_SIM_WORKER_STARTUP_PREWARM_SIZE, PERSISTENT_SIM_WORKER_POOL_SIZE)
        worker_target_ready = configured_worker_target_ready
        try:
            startup_pool_snapshot = get_persistent_sim_worker_pool_snapshot() or {}
            if startup_pool_snapshot.get("disciplineEnabled"):
                discipline_max_live = int(startup_pool_snapshot.get("disciplineMaxLive") or worker_target_ready)
                if discipline_max_live > 0:
                    worker_target_ready = min(worker_target_ready, discipline_max_live)
        except Exception:
            worker_target_ready = configured_worker_target_ready
        if ok and PERSISTENT_SIM_WORKER_ENABLED and PERSISTENT_SIM_WORKER_STARTUP_PREWARM_ENABLED and worker_target_ready > 0:
            _update_startup_integrity_state(
                status="warming-workers",
                statusText="Startup persistent simulator workers are warming",
                detailText="Professor Aegis is starting warm simulator workers for the first report.",
                persistentWorkersWarmEnabled=True,
                persistentWorkersReady=False,
                persistentWorkersTargetReady=worker_target_ready,
            )
            _log_event(
                "persistent_sim_worker_startup_prewarm_started",
                jobId=job_id,
                targetReady=worker_target_ready,
                configuredTargetReady=configured_worker_target_ready,
                timeoutMs=PERSISTENT_SIM_WORKER_STARTUP_PREWARM_TIMEOUT_MS,
            )
            try:
                worker_prewarm_snapshot = prewarm_persistent_sim_worker_pool(
                    repo_dir=repo_dir,
                    target_ready=worker_target_ready,
                    timeout_ms=PERSISTENT_SIM_WORKER_STARTUP_PREWARM_TIMEOUT_MS,
                    reason="startup-warm-workers",
                )
                workers_ready = int(worker_prewarm_snapshot.get("ready") or 0) >= worker_target_ready and int(worker_prewarm_snapshot.get("spawning") or 0) <= 0
                _log_event(
                    "persistent_sim_worker_startup_prewarm_completed",
                    jobId=job_id,
                    ok=workers_ready,
                    ready=worker_prewarm_snapshot.get("ready"),
                    spawning=worker_prewarm_snapshot.get("spawning"),
                    started=worker_prewarm_snapshot.get("prewarmStarted"),
                    targetReady=worker_target_ready,
                    configuredTargetReady=configured_worker_target_ready,
                    timeoutMs=PERSISTENT_SIM_WORKER_STARTUP_PREWARM_TIMEOUT_MS,
                    pool=worker_prewarm_snapshot,
                )
            except Exception as worker_exc:
                workers_ready = False
                worker_prewarm_snapshot = {"error": str(worker_exc)}
                _log_event(
                    "persistent_sim_worker_startup_prewarm_failed",
                    jobId=job_id,
                    targetReady=worker_target_ready,
                    configuredTargetReady=configured_worker_target_ready,
                    error=str(worker_exc),
                )
        else:
            workers_ready = True

        _update_startup_integrity_state(
            active=False,
            completed=True,
            ready=True,
            ok=ok,
            status="ready" if ok else "failed",
            statusText="Startup warm cache and workers ready" if ok and workers_ready else ("Startup warm cache ready; workers will finish on demand" if ok else "Startup integrity warm cache failed"),
            detailText=("First-run Showdown integrity cache and persistent simulator workers are ready." if ok and workers_ready else ("First-run Showdown integrity cache is ready; simulator workers will finish warming on demand." if ok else str(integrity.get("detail") or integrity.get("reason") or "Startup integrity warm cache failed.")[:500])),
            completedAt=utc_now_iso(),
            completedEpochMs=int(time.time() * 1000),
            durationMs=_elapsed_ms(started),
            reason=integrity.get("reason"),
            warningCount=warning_count,
            persistentWorkersWarmEnabled=bool(PERSISTENT_SIM_WORKER_ENABLED and PERSISTENT_SIM_WORKER_STARTUP_PREWARM_ENABLED),
            persistentWorkersReady=bool(workers_ready),
            persistentWorkersTargetReady=worker_target_ready,
            persistentWorkersSnapshot=worker_prewarm_snapshot,
            error=None if ok else str(integrity.get("detail") or integrity.get("reason") or "integrity-check-failed")[:500],
        )
        try:
            refresh_benchmark_readiness(reason="ready")
        except Exception as refresh_exc:
            _log_event("readiness_refresh_after_startup_warm_failed", error=str(refresh_exc))
    except Exception as exc:
        _update_startup_integrity_state(
            active=False,
            completed=True,
            ready=True,
            ok=False,
            status="failed",
            statusText="Startup integrity warm cache failed",
            detailText=str(exc)[:500],
            completedAt=utc_now_iso(),
            completedEpochMs=int(time.time() * 1000),
            durationMs=_elapsed_ms(started),
            error=str(exc)[:500],
        )
        _log_event(
            "showdown_integrity_startup_warm_cache_failed",
            jobId=job_id,
            durationMs=_elapsed_ms(started),
            error=str(exc),
        )


def _startup_readiness_and_cache_probe():
    refresh_benchmark_readiness(reason="startup")
    _prewarm_repo_opponent_cache()
    _startup_integrity_warm_cache()


def _start_readiness_probe():
    thread = threading.Thread(target=_startup_readiness_and_cache_probe, daemon=True)
    thread.start()

def _job_metrics(job: dict) -> dict:
    metrics = dict(job.get("metrics") or {})
    submitted = job.get("submittedEpochMs")
    started = job.get("startedEpochMs")
    completed = job.get("completedEpochMs")
    now_ms = int(time.time() * 1000)
    if submitted and started:
        metrics["queueWaitMs"] = int(started - submitted)
    elif submitted:
        metrics["queueWaitMs"] = int(now_ms - submitted)
    if started and completed:
        metrics["runDurationMs"] = int(completed - started)
    elif started:
        metrics["runDurationMs"] = int(now_ms - started)
    if submitted and completed:
        metrics["totalDurationMs"] = int(completed - submitted)
    elif submitted:
        metrics["totalDurationMs"] = int(now_ms - submitted)
    if isinstance(metrics.get("throughput"), dict):
        throughput = dict(metrics.get("throughput") or {})
        phases = dict(throughput.get("phaseDurationsMs") or {})
        if metrics.get("runDurationMs") is not None:
            phases["totalJobRuntime"] = int(metrics.get("runDurationMs") or 0)
        if metrics.get("totalDurationMs") is not None:
            phases["totalQueuePlusRuntime"] = int(metrics.get("totalDurationMs") or 0)
        throughput["phaseDurationsMs"] = phases
        metrics["throughput"] = throughput
    return metrics


THROUGHPUT_PER_BATCH_LIMIT = 80
THROUGHPUT_PAIR_RUNTIME_LIMIT = 20
THROUGHPUT_DIAGNOSTIC_SAMPLE_LIMIT = 2048


def _new_worker_diagnostic_metrics() -> dict:
    return {
        "schemaVersion": "r6.20.11v-worker-occupancy-v1",
        "metadataOnly": True,
        "samplePolicy": "numeric-counters-and-timings-only",
        "sharedSlots": {
            "assigned": {},
            "allowed": {},
            "activeGlobal": {},
            "waitMs": {},
        },
        "persistentWorkers": {
            "live": {},
            "ready": {},
            "checkedOut": {},
            "borrowWaitMs": {},
        },
        "waves": {
            "launchMs": {},
            "drainMs": {},
            "pendingSeries": {},
        },
        "battleRuntimeMs": {},
        "cpuPercent": {},
        "memory": {
            "usedMb": {},
            "percent": {},
        },
        "failures": {
            "spawn": 0,
            "request": 0,
            "fallback": 0,
            "borrowWaitTimeouts": 0,
        },
    }


def _new_phase_worker_diagnostic_metrics() -> dict:
    data = _new_worker_diagnostic_metrics()
    data["schemaVersion"] = "r6.20.12k-phase-worker-occupancy-v1"
    return data


def _new_phase_diagnostic_metrics() -> dict:
    return {
        "schemaVersion": "r6.20.12k-phase-diagnostics-v1",
        "metadataOnly": True,
        "samplePolicy": "numeric-counters-and-timings-only",
        "mainSimulation": _new_phase_worker_diagnostic_metrics(),
        "leadPairSweep": _new_phase_worker_diagnostic_metrics(),
        "coreSweep": _new_phase_worker_diagnostic_metrics(),
    }


def _new_throughput_metrics() -> dict:
    return {
        "schemaVersion": "r6.20.11a-throughput-v1",
        "selectedOpponentCount": 0,
        "expectedGames": 0,
        "effectiveBatchSize": 0,
        "phaseDurationsMs": {
            "validation": 0,
            "packUser": 0,
            "selectOpponents": 0,
            "prewarm": 0,
            "integrity": 0,
            "hydrateTotal": 0,
            "batchLaunchTotal": 0,
            "battleTotal": 0,
            "leadPairSweep": 0,
            "coreSweep": 0,
            "reportBuild": 0,
            "totalJobRuntime": 0,
            "totalQueuePlusRuntime": 0,
        },
        "sharedSlot": {
            "waitMsCount": 0,
            "waitMsTotal": 0,
            "waitMsMax": 0,
            "lastWaitMs": 0,
            "lastAllocation": {},
        },
        "persistentWorker": {},
        "battleRuntimeMs": {
            "count": 0,
            "total": 0,
            "avg": 0,
            "max": 0,
        },
        "leadPair": {},
        "coreSweep": {},
        "perBatch": [],
        "workerDiagnostics": _new_worker_diagnostic_metrics(),
        "phaseDiagnostics": _new_phase_diagnostic_metrics(),
        "bounded": True,
        "payloadPolicy": "timings-and-counters-only",
    }


def _ensure_throughput_metrics_locked(job: dict) -> dict:
    metrics = job.setdefault("metrics", {})
    throughput = metrics.get("throughput")
    if not isinstance(throughput, dict):
        throughput = _new_throughput_metrics()
        metrics["throughput"] = throughput
        return throughput

    template = _new_throughput_metrics()
    for key, value in template.items():
        if key not in throughput:
            throughput[key] = value
    for key, value in template.get("phaseDurationsMs", {}).items():
        throughput.setdefault("phaseDurationsMs", {}).setdefault(key, value)
    for key, value in template.get("sharedSlot", {}).items():
        throughput.setdefault("sharedSlot", {}).setdefault(key, value)
    for key, value in template.get("battleRuntimeMs", {}).items():
        throughput.setdefault("battleRuntimeMs", {}).setdefault(key, value)
    worker_diag = throughput.get("workerDiagnostics")
    if not isinstance(worker_diag, dict):
        throughput["workerDiagnostics"] = _new_worker_diagnostic_metrics()
    else:
        diag_template = _new_worker_diagnostic_metrics()
        for key, value in diag_template.items():
            if key not in worker_diag:
                worker_diag[key] = value
        for section, value in diag_template.items():
            if isinstance(value, dict) and isinstance(worker_diag.get(section), dict):
                for child_key, child_value in value.items():
                    worker_diag[section].setdefault(child_key, child_value)
    phase_diag = throughput.get("phaseDiagnostics")
    if not isinstance(phase_diag, dict):
        throughput["phaseDiagnostics"] = _new_phase_diagnostic_metrics()
    else:
        phase_template = _new_phase_diagnostic_metrics()
        for key, value in phase_template.items():
            if key not in phase_diag:
                phase_diag[key] = value
        for phase_name in ("mainSimulation", "leadPairSweep", "coreSweep"):
            phase_bucket = phase_diag.get(phase_name)
            if not isinstance(phase_bucket, dict):
                phase_diag[phase_name] = _new_phase_worker_diagnostic_metrics()
                continue
            worker_template = _new_phase_worker_diagnostic_metrics()
            for key, value in worker_template.items():
                if key not in phase_bucket:
                    phase_bucket[key] = value
            for section, value in worker_template.items():
                if isinstance(value, dict) and isinstance(phase_bucket.get(section), dict):
                    for child_key, child_value in value.items():
                        phase_bucket[section].setdefault(child_key, child_value)
    return throughput


def _update_throughput_metrics(job_id: str, updater):
    if not job_id or updater is None:
        return {}
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return {}
        throughput = _ensure_throughput_metrics_locked(job)
        try:
            updater(throughput)
        except Exception as exc:
            _log_event("throughput_metrics_update_failed", jobId=job_id, error=str(exc))
        return dict(throughput)


def _record_throughput_phase(job_id: str, phase_name: str, duration_ms, *, aggregate: bool = False):
    safe_duration = max(_safe_int(duration_ms, 0), 0)

    def _updater(throughput: dict):
        phases = throughput.setdefault("phaseDurationsMs", {})
        if aggregate:
            phases[phase_name] = max(_safe_int(phases.get(phase_name), 0), 0) + safe_duration
        else:
            phases[phase_name] = safe_duration

    return _update_throughput_metrics(job_id, _updater)


def _set_throughput_fields(job_id: str, **fields):
    clean = {key: value for key, value in fields.items() if value is not None}

    def _updater(throughput: dict):
        throughput.update(clean)

    return _update_throughput_metrics(job_id, _updater)


_WORKER_DIAGNOSTIC_SAMPLE_PATHS = {
    "sharedAssigned": ("sharedSlots", "assigned"),
    "sharedAllowed": ("sharedSlots", "allowed"),
    "sharedActiveGlobal": ("sharedSlots", "activeGlobal"),
    "sharedSlotWaitMs": ("sharedSlots", "waitMs"),
    "persistentLive": ("persistentWorkers", "live"),
    "persistentReady": ("persistentWorkers", "ready"),
    "persistentCheckedOut": ("persistentWorkers", "checkedOut"),
    "persistentBorrowWaitMs": ("persistentWorkers", "borrowWaitMs"),
    "waveLaunchMs": ("waves", "launchMs"),
    "waveDrainMs": ("waves", "drainMs"),
    "pendingSeries": ("waves", "pendingSeries"),
    "battleRuntimeMs": ("battleRuntimeMs",),
    "cpuPercent": ("cpuPercent",),
    "memoryUsedMb": ("memory", "usedMb"),
    "memoryPercent": ("memory", "percent"),
}


def _safe_number(value):
    try:
        parsed = float(value)
        if parsed != parsed:
            return None
        return parsed
    except Exception:
        return None


def _display_number(value):
    if value is None:
        return None
    try:
        value = float(value)
    except Exception:
        return value
    if abs(value - round(value)) < 0.0001:
        return int(round(value))
    return round(value, 3)


def _percentile_value(values: list, percentile: float):
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return _display_number(ordered[0])
    try:
        index = int(round(((float(percentile) / 100.0) * (len(ordered) - 1))))
    except Exception:
        index = len(ordered) - 1
    index = max(0, min(index, len(ordered) - 1))
    return _display_number(ordered[index])


def _diagnostic_distribution(values: list) -> dict:
    clean = []
    for value in values or []:
        parsed = _safe_number(value)
        if parsed is not None:
            clean.append(parsed)
    if not clean:
        return {"count": 0, "p50": None, "p95": None, "max": None, "avg": None}
    total = sum(clean)
    return {
        "count": len(clean),
        "p50": _percentile_value(clean, 50),
        "p95": _percentile_value(clean, 95),
        "max": _display_number(max(clean)),
        "avg": _display_number(total / max(len(clean), 1)),
    }


def _assign_worker_diagnostic_summary(diagnostics: dict, sample_key: str, summary: dict):
    path = _WORKER_DIAGNOSTIC_SAMPLE_PATHS.get(sample_key)
    if not path:
        return
    target = diagnostics
    for item in path[:-1]:
        target = target.setdefault(item, {})
    target[path[-1]] = summary


def _normalize_phase_diagnostic_name(phase: str | None) -> str | None:
    normalized = str(phase or "").strip()
    aliases = {
        "main": "mainSimulation",
        "main-simulation": "mainSimulation",
        "main_simulation": "mainSimulation",
        "mainSimulation": "mainSimulation",
        "lead": "leadPairSweep",
        "lead-pair": "leadPairSweep",
        "lead_pair": "leadPairSweep",
        "lead-pair-sweep": "leadPairSweep",
        "lead_pair_sweep": "leadPairSweep",
        "leadPairSweep": "leadPairSweep",
        "core": "coreSweep",
        "core-sweep": "coreSweep",
        "core_sweep": "coreSweep",
        "coreSweep": "coreSweep",
    }
    return aliases.get(normalized)


def _phase_diagnostic_bucket(throughput: dict, phase: str) -> dict:
    safe_phase = _normalize_phase_diagnostic_name(phase)
    if not safe_phase:
        return {}
    phase_diagnostics = throughput.setdefault("phaseDiagnostics", _new_phase_diagnostic_metrics())
    if not isinstance(phase_diagnostics, dict):
        throughput["phaseDiagnostics"] = _new_phase_diagnostic_metrics()
        phase_diagnostics = throughput["phaseDiagnostics"]
    bucket = phase_diagnostics.get(safe_phase)
    if not isinstance(bucket, dict):
        bucket = _new_phase_worker_diagnostic_metrics()
        phase_diagnostics[safe_phase] = bucket
    bucket["metadataOnly"] = True
    bucket["samplePolicy"] = "numeric-counters-and-timings-only"
    return bucket


def _set_phase_diagnostic_fields(job_id: str, phase: str, **fields):
    safe_phase = _normalize_phase_diagnostic_name(phase)
    if not job_id or not safe_phase:
        return {}
    clean = {key: value for key, value in fields.items() if value is not None}

    def _updater(throughput: dict):
        bucket = _phase_diagnostic_bucket(throughput, safe_phase)
        if not bucket:
            return
        bucket.update(clean)
        wall_ms = _safe_number(bucket.get("phaseWallMs"))
        battle_total_ms = _safe_number((bucket.get("battleRuntimeMs") or {}).get("total"))
        if wall_ms and wall_ms > 0 and battle_total_ms is not None:
            bucket["effectiveActiveBattles"] = round(float(battle_total_ms) / float(wall_ms), 3)

    return _update_throughput_metrics(job_id, _updater)


def _record_worker_diagnostic_samples(job_id: str, phase: str | None = None, **samples):
    if not job_id:
        return {}
    clean_samples = {}
    for key, raw_value in (samples or {}).items():
        if key not in _WORKER_DIAGNOSTIC_SAMPLE_PATHS:
            continue
        raw_values = raw_value if isinstance(raw_value, (list, tuple)) else [raw_value]
        numeric_values = []
        for value in raw_values:
            parsed = _safe_number(value)
            if parsed is not None:
                numeric_values.append(parsed)
        if numeric_values:
            clean_samples[key] = numeric_values
    if not clean_samples:
        return {}

    summaries = {}
    phase_summaries = {}
    safe_phase = _normalize_phase_diagnostic_name(phase)
    with _worker_diagnostic_samples_lock:
        bucket = _worker_diagnostic_samples_by_job.setdefault(str(job_id), {})
        for key, numeric_values in clean_samples.items():
            values = list(bucket.get(key) or [])
            values.extend(numeric_values)
            if len(values) > THROUGHPUT_DIAGNOSTIC_SAMPLE_LIMIT:
                values = values[-THROUGHPUT_DIAGNOSTIC_SAMPLE_LIMIT:]
            bucket[key] = values
            summaries[key] = _diagnostic_distribution(values)
        if safe_phase:
            phase_buckets = _phase_worker_diagnostic_samples_by_job.setdefault(str(job_id), {})
            phase_bucket = phase_buckets.setdefault(safe_phase, {})
            for key, numeric_values in clean_samples.items():
                values = list(phase_bucket.get(key) or [])
                values.extend(numeric_values)
                if len(values) > THROUGHPUT_DIAGNOSTIC_SAMPLE_LIMIT:
                    values = values[-THROUGHPUT_DIAGNOSTIC_SAMPLE_LIMIT:]
                phase_bucket[key] = values
                phase_summaries[key] = _diagnostic_distribution(values)

    def _updater(throughput: dict):
        diagnostics = throughput.setdefault("workerDiagnostics", _new_worker_diagnostic_metrics())
        diagnostics["metadataOnly"] = True
        diagnostics["samplePolicy"] = "numeric-counters-and-timings-only"
        for key, summary in summaries.items():
            _assign_worker_diagnostic_summary(diagnostics, key, summary)
        if safe_phase and phase_summaries:
            phase_bucket = _phase_diagnostic_bucket(throughput, safe_phase)
            for key, summary in phase_summaries.items():
                _assign_worker_diagnostic_summary(phase_bucket, key, summary)

    return _update_throughput_metrics(job_id, _updater)


def _clear_worker_diagnostic_samples(job_id: str):
    if not job_id:
        return
    with _worker_diagnostic_samples_lock:
        _worker_diagnostic_samples_by_job.pop(str(job_id), None)
        _phase_worker_diagnostic_samples_by_job.pop(str(job_id), None)


def _update_worker_diagnostic_failure_summary(throughput: dict, persistent_snapshot: dict | None = None):
    diagnostics = throughput.setdefault("workerDiagnostics", _new_worker_diagnostic_metrics())
    persistent_snapshot = persistent_snapshot if isinstance(persistent_snapshot, dict) else {}
    diagnostics["metadataOnly"] = True
    diagnostics["samplePolicy"] = "numeric-counters-and-timings-only"
    diagnostics["failures"] = {
        "spawn": _safe_int(persistent_snapshot.get("actualSimWorkersSpawnFailedThisJob"), 0),
        "request": _safe_int(persistent_snapshot.get("actualSimWorkersRequestFailedThisJob"), 0),
        "fallback": _safe_int(persistent_snapshot.get("actualSimWorkersFallbacksThisJob"), 0),
        "borrowWaitTimeouts": _safe_int(persistent_snapshot.get("actualSimWorkersBorrowWaitTimeoutsThisJob"), 0),
    }
    return diagnostics


def _record_throughput_shared_slot_wait(job_id: str, wait_ms, view: dict, phase: str | None = None):
    safe_wait = max(_safe_int(wait_ms, 0), 0)
    view = view if isinstance(view, dict) else {}
    allocation = {
        "assigned": _safe_int(view.get("assigned"), 0),
        "allowed": _safe_int(view.get("allowed"), 0),
        "activeTotal": _safe_int(view.get("activeTotal"), 0),
        "globalCap": _safe_int(view.get("globalCap"), SHARED_WORKER_POOL_CAP),
        "cpuState": view.get("cpuState"),
        "firstWaveActive": bool(view.get("firstWaveActive")),
        "gradualRampActive": bool(view.get("gradualRampActive")),
        "cpuCooldownActive": bool(view.get("cpuCooldownActive")),
        "queueSpot": _safe_int(view.get("queueSpot"), 0),
    }

    def _updater(throughput: dict):
        slot = throughput.setdefault("sharedSlot", {})
        slot["waitMsCount"] = _safe_int(slot.get("waitMsCount"), 0) + 1
        slot["waitMsTotal"] = _safe_int(slot.get("waitMsTotal"), 0) + safe_wait
        slot["waitMsMax"] = max(_safe_int(slot.get("waitMsMax"), 0), safe_wait)
        slot["lastWaitMs"] = safe_wait
        slot["lastAllocation"] = allocation

    metrics = _update_throughput_metrics(job_id, _updater)
    _record_worker_diagnostic_samples(
        job_id,
        phase=phase,
        sharedSlotWaitMs=safe_wait,
        sharedAssigned=allocation.get("assigned"),
        sharedAllowed=allocation.get("allowed"),
        sharedActiveGlobal=allocation.get("activeTotal"),
        cpuPercent=view.get("cpuPercent"),
    )
    return metrics


def _record_throughput_persistent_worker(job_id: str):
    snapshot = _persistent_sim_telemetry_snapshot(job_id, include_details=True)

    def _updater(throughput: dict):
        throughput["persistentWorker"] = snapshot
        _update_worker_diagnostic_failure_summary(throughput, snapshot)

    metrics = _update_throughput_metrics(job_id, _updater)
    _record_worker_diagnostic_samples(
        job_id,
        persistentLive=snapshot.get("actualSimWorkersLive"),
        persistentReady=snapshot.get("actualSimWorkersReady"),
        persistentCheckedOut=snapshot.get("actualSimWorkersCheckedOut"),
    )
    return metrics


def _record_throughput_battle_runtime(job_id: str, duration_ms, result: dict | None = None, phase: str | None = None):
    safe_duration = max(_safe_int(duration_ms, 0), 0)
    pool = (result or {}).get("persistentWorkerPool") if isinstance(result, dict) else None

    def _updater(throughput: dict):
        runtime = throughput.setdefault("battleRuntimeMs", {})
        count = _safe_int(runtime.get("count"), 0) + 1
        total = _safe_int(runtime.get("total"), 0) + safe_duration
        runtime["count"] = count
        runtime["total"] = total
        runtime["avg"] = int(round(total / max(count, 1)))
        runtime["max"] = max(_safe_int(runtime.get("max"), 0), safe_duration)
        throughput.setdefault("phaseDurationsMs", {})["battleTotal"] = total
        safe_phase = _normalize_phase_diagnostic_name(phase)
        if safe_phase:
            phase_bucket = _phase_diagnostic_bucket(throughput, safe_phase)
            phase_runtime = phase_bucket.setdefault("battleRuntimeMs", {})
            phase_count = _safe_int(phase_runtime.get("count"), 0) + 1
            phase_total = _safe_int(phase_runtime.get("total"), 0) + safe_duration
            phase_runtime["count"] = phase_count
            phase_runtime["total"] = phase_total
            phase_runtime["avg"] = int(round(phase_total / max(phase_count, 1)))
            phase_runtime["max"] = max(_safe_int(phase_runtime.get("max"), 0), safe_duration)
            wall_ms = _safe_number(phase_bucket.get("phaseWallMs"))
            if wall_ms and wall_ms > 0:
                phase_bucket["effectiveActiveBattles"] = round(float(phase_total) / float(wall_ms), 3)
        if isinstance(pool, dict):
            throughput["persistentWorkerPoolLastBattle"] = {
                "ready": _safe_int(pool.get("ready"), 0),
                "checkedOut": _safe_int(pool.get("checkedOut"), 0),
                "live": _safe_int(pool.get("live"), 0),
                "fallbacks": _safe_int(pool.get("fallbacks"), 0),
                "requestFailed": _safe_int(pool.get("requestFailed"), 0),
            }

    metrics = _update_throughput_metrics(job_id, _updater)
    if isinstance(pool, dict):
        _record_worker_diagnostic_samples(
            job_id,
            phase=phase,
            battleRuntimeMs=safe_duration,
            persistentLive=pool.get("live"),
            persistentReady=pool.get("ready"),
            persistentCheckedOut=pool.get("checkedOut"),
            persistentBorrowWaitMs=pool.get("lastBorrowWaitMs"),
        )
    else:
        _record_worker_diagnostic_samples(job_id, phase=phase, battleRuntimeMs=safe_duration)
    _record_throughput_persistent_worker(job_id)
    return metrics


def _record_throughput_batch(job_id: str, row: dict):
    clean = {
        "batchStart": _safe_int(row.get("batchStart"), 0),
        "batchEnd": _safe_int(row.get("batchEnd"), 0),
        "requestedRecords": _safe_int(row.get("requestedRecords"), 0),
        "hydratedReady": _safe_int(row.get("hydratedReady"), 0),
        "hydrateMs": _safe_int(row.get("hydrateMs"), 0),
        "launchedSeries": _safe_int(row.get("launchedSeries"), 0),
        "completedSeries": _safe_int(row.get("completedSeries"), 0),
        "batchMs": _safe_int(row.get("batchMs"), 0),
        "launchMs": _safe_int(row.get("launchMs"), 0),
        "drainMs": _safe_int(row.get("drainMs"), 0),
        "pendingSeriesP50": _safe_int(row.get("pendingSeriesP50"), 0),
        "pendingSeriesP95": _safe_int(row.get("pendingSeriesP95"), 0),
        "pendingSeriesMax": _safe_int(row.get("pendingSeriesMax"), 0),
        "stuckWatchdogCount": _safe_int(row.get("stuckWatchdogCount"), 0),
        "skipped": bool(row.get("skipped")),
    }
    if row.get("rollingSchedulerEnabled") is not None:
        clean.update({
            "rollingSchedulerEnabled": bool(row.get("rollingSchedulerEnabled")),
            "rollingActiveWindowTarget": _safe_int(row.get("rollingActiveWindowTarget"), 0),
            "rollingPrefetchCount": _safe_int(row.get("rollingPrefetchCount"), 0),
            "rollingBarrierCount": _safe_int(row.get("rollingBarrierCount"), 0),
            "rollingQueuedSeries": _safe_int(row.get("rollingQueuedSeries"), 0),
            "rollingExecutorQueueTopUp": bool(row.get("rollingExecutorQueueTopUp")),
            "rollingBoundedPendingMax": _safe_int(row.get("rollingBoundedPendingMax"), 0),
            "rollingSubmittedSeries": _safe_int(row.get("rollingSubmittedSeries"), 0),
            "rollingTopUpSubmissions": _safe_int(row.get("rollingTopUpSubmissions"), 0),
        })

    def _updater(throughput: dict):
        rows = list(throughput.get("perBatch") or [])
        rows.append(clean)
        throughput["perBatch"] = rows[-THROUGHPUT_PER_BATCH_LIMIT:]

    return _update_throughput_metrics(job_id, _updater)


def _set_throughput_lead_pair(job_id: str, **fields):
    clean = {key: value for key, value in fields.items() if value is not None}

    def _updater(throughput: dict):
        lead_pair = throughput.setdefault("leadPair", {})
        lead_pair.update(clean)
        runtimes = lead_pair.get("perPairRuntimeMs")
        if isinstance(runtimes, list):
            lead_pair["perPairRuntimeMs"] = runtimes[-THROUGHPUT_PAIR_RUNTIME_LIMIT:]

    return _update_throughput_metrics(job_id, _updater)


def _set_throughput_core_sweep(job_id: str, **fields):
    clean = {key: value for key, value in fields.items() if value is not None}

    def _updater(throughput: dict):
        core_sweep = throughput.setdefault("coreSweep", {})
        core_sweep.update(clean)
        runtimes = core_sweep.get("perCoreRuntimeMs")
        if isinstance(runtimes, list):
            core_sweep["perCoreRuntimeMs"] = runtimes[-THROUGHPUT_PAIR_RUNTIME_LIMIT:]

    return _update_throughput_metrics(job_id, _updater)


def _finalize_throughput_metrics_locked(job: dict):
    throughput = _ensure_throughput_metrics_locked(job)
    phases = throughput.setdefault("phaseDurationsMs", {})
    started = job.get("startedEpochMs")
    submitted = job.get("submittedEpochMs")
    completed = job.get("completedEpochMs")
    if started and completed:
        phases["totalJobRuntime"] = max(int(completed - started), 0)
    if submitted and completed:
        phases["totalQueuePlusRuntime"] = max(int(completed - submitted), 0)
    try:
        persistent_snapshot = _persistent_sim_telemetry_snapshot(job.get("jobId"), include_details=True)
        throughput["persistentWorker"] = persistent_snapshot
        _update_worker_diagnostic_failure_summary(throughput, persistent_snapshot)
    except Exception:
        pass
    return throughput


def summarize_job_counts():
    summary = {
        "queued": 0,
        "running": 0,
        "completed": 0,
        "failed": 0,
    }
    with _jobs_lock:
        for job in _jobs.values():
            status = job.get("status")
            if status in summary:
                summary[status] += 1
    return summary


def _progress_bar(percent: int, width: int = 20) -> str:
    pct = max(0, min(int(percent or 0), 100))
    filled = int(round((pct / 100.0) * width))
    return ("◼" * filled) + ("▭" * (width - filled)) + f" {pct}%"


def _new_progress():
    return {
        "phase": "queued",
        "percent": 0,
        "progressBar": _progress_bar(0),
        "currentStep": "Queued",
        "processedTemplates": 0,
        "totalTemplates": 0,
        "currentTemplate": None,
        "currentEstimatedWinRate": None,
        "processedGames": 0,
        "totalGames": 0,
        "processedOpponents": 0,
        "totalOpponents": 0,
        "currentOpponent": None,
        "metrics": {},
    }


def _safe_int(value, fallback=0):
    try:
        return int(value)
    except Exception:
        return fallback


def set_job_progress(job_id: str, **updates):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        progress = dict(job.get("progress") or _new_progress())
        clean_updates = {k: v for k, v in updates.items() if v is not None or k in updates}

        # Battle threads update progress at the same time. A late older update
        # must not reset completed-battle counters back to zero.
        monotonic_fields = (
            "processedGames",
            "completedGames",
            "currentBattleNumber",
            "processedOpponents",
            "completedOpponents",
            "failedGames",
            "battleWins",
            "battleLosses",
            "battleTies",
            "recordWins",
            "recordLosses",
            "recordTies",
        )
        for field in monotonic_fields:
            if field in clean_updates:
                clean_updates[field] = max(_safe_int(progress.get(field), 0), _safe_int(clean_updates.get(field), 0))

        progress.update(clean_updates)

        # Keep both naming styles available for the Discord terminal UI.
        if any(field in clean_updates for field in ("battleWins", "battleLosses", "battleTies")):
            progress["recordWins"] = _safe_int(progress.get("battleWins"), 0)
            progress["recordLosses"] = _safe_int(progress.get("battleLosses"), 0)
            progress["recordTies"] = _safe_int(progress.get("battleTies"), 0)
        elif any(field in clean_updates for field in ("recordWins", "recordLosses", "recordTies")):
            progress["battleWins"] = _safe_int(progress.get("recordWins"), 0)
            progress["battleLosses"] = _safe_int(progress.get("recordLosses"), 0)
            progress["battleTies"] = _safe_int(progress.get("recordTies"), 0)

        pct = max(0, min(int(progress.get("percent") or 0), 100))
        progress["percent"] = pct
        progress["progressBar"] = _progress_bar(pct)
        progress["metrics"] = _job_metrics(job)
        job["progress"] = progress


def serialize_job(job, include_report: bool = True):
    report = job.get("report")
    return {
        "ok": True,
        "mode": "http",
        "backendLanguage": "python",
        "workerVersion": WORKER_VERSION,
        "analyzerVersion": ENGINE_VERSION,
        "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
        "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "battleRunnerVersion": BATTLE_RUNNER_VERSION,
        "jobId": job["jobId"],
        "jobType": job.get("jobType"),
        "status": job["status"],
        "submittedAt": job["submittedAt"],
        "startedAt": job["startedAt"],
        "completedAt": job["completedAt"],
        "error": job["error"],
        "progress": job.get("progress"),
        "metrics": _job_metrics(job),
        "reportAvailable": report is not None,
        "reportIncluded": bool(include_report and report is not None),
        "report": report if include_report else None,
    }


def _mark_job_running(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job["status"] != "queued":
            return False
        job["status"] = "running"
        if job.get("jobType") == "run-benchmark-suite":
            _resource_reset_completed_counters(reason="job-start", job_id=job_id)
            _persistent_sim_register_job_counter_baseline(job_id, reason="job-start")
        job["startedAt"] = utc_now_iso()
        job["startedEpochMs"] = int(time.time() * 1000)
        _log_event("job_started", jobId=job_id, jobType=job.get("jobType"), queueWaitMs=_job_metrics(job).get("queueWaitMs"))
        return True


def _complete_job(job_id: str, report):
    should_schedule_idle_retire = False
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job["status"] not in ("queued", "running"):
            return
        job["status"] = "completed"
        job["completedAt"] = utc_now_iso()
        job["completedEpochMs"] = int(time.time() * 1000)
        throughput = _finalize_throughput_metrics_locked(job)
        if isinstance(report, dict):
            report = dict(report)
            report["throughputMetrics"] = throughput
        job["report"] = report
        should_schedule_idle_retire = job.get("jobType") == "run-benchmark-suite"
        _log_event("job_completed", jobId=job_id, jobType=job.get("jobType"), metrics=_job_metrics(job), **_persistent_sim_telemetry_snapshot(job_id, include_pool=True))
        if job.get("progress"):
            job["progress"]["phase"] = "completed"
            job["progress"]["percent"] = 100
            job["progress"]["progressBar"] = _progress_bar(100)
            job["progress"]["currentStep"] = "Completed"
    if should_schedule_idle_retire:
        _schedule_persistent_idle_retire(reason="job-completed")
    _persistent_sim_clear_job_counter_baseline(job_id)
    _clear_worker_diagnostic_samples(job_id)


def _fail_job(job_id: str, message: str):
    should_schedule_idle_retire = False
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job["status"] = "failed"
        job["completedAt"] = utc_now_iso()
        job["completedEpochMs"] = int(time.time() * 1000)
        job["error"] = message or "BenchMark Python worker failed."
        _finalize_throughput_metrics_locked(job)
        should_schedule_idle_retire = job.get("jobType") == "run-benchmark-suite"
        _log_event("job_failed", jobId=job_id, jobType=job.get("jobType"), error=job["error"], metrics=_job_metrics(job), **_persistent_sim_telemetry_snapshot(job_id, include_pool=True))
        if job.get("progress"):
            job["progress"]["phase"] = "failed"
            job["progress"]["progressBar"] = _progress_bar(job["progress"].get("percent", 0))
            job["progress"]["currentStep"] = job["error"] or "Failed"
    if should_schedule_idle_retire:
        _schedule_persistent_idle_retire(reason="job-failed")
    _persistent_sim_clear_job_counter_baseline(job_id)
    _clear_worker_diagnostic_samples(job_id)


def _scaffold_progress_callback(job_id: str):
    def _callback(payload: dict):
        set_job_progress(
            job_id,
            phase=payload.get("phase"),
            percent=payload.get("percent"),
            currentStep=payload.get("currentStep"),
            processedTemplates=payload.get("processedTemplates"),
            totalTemplates=payload.get("totalTemplates"),
            currentTemplate=payload.get("currentTemplate"),
            currentEstimatedWinRate=payload.get("currentEstimatedWinRate"),
        )
    return _callback


def _run_weakness_job(job_id: str, team_export: str):
    time.sleep(0.05)
    if not _mark_job_running(job_id):
        return
    set_job_progress(job_id, phase="building-weakness-report", percent=10, currentStep="Building weakness report")
    try:
        report = build_weakness_report_from_team(team_export)
        set_job_progress(job_id, phase="building-weakness-report", percent=100, currentStep="Weakness report completed")
        _complete_job(job_id, report)
    except Exception as exc:
        _fail_job(job_id, str(exc) or "BenchMark Python worker failed to build the weakness report.")


def _run_simulate_matchup_job(job_id: str, team_export: str, template_keys, battle_count: int, format_id: str, validation_result: dict, packed_team: str):
    time.sleep(0.05)
    if not _mark_job_running(job_id):
        return
    set_job_progress(
        job_id,
        phase="starting-scaffold",
        percent=5,
        currentStep="Starting simulate-matchup scaffold",
        processedTemplates=0,
        totalTemplates=len(template_keys or []),
    )
    try:
        report = build_sim_matchup_scaffold_from_team(
            team_export=team_export,
            template_keys=template_keys,
            battle_count=battle_count,
            showdown_ready=True,
            format_id=format_id,
            validation_result=validation_result,
            packed_team=packed_team,
            progress_callback=_scaffold_progress_callback(job_id),
        )
        _complete_job(job_id, report)
    except Exception as exc:
        _fail_job(job_id, str(exc) or "BenchMark Python worker failed to build the simulate-matchup scaffold.")



def _build_failed_battle_result(game_index: int, seed, error, timeout_ms: int, duration_ms: int, opponent_name: str = None) -> dict:
    message = str(error or "Battle failed before a completed result was captured.").strip()
    return {
        "ok": False,
        "failed": True,
        "failureContained": True,
        "failureScope": "battle",
        "failureReason": message,
        "error": message,
        "winner": None,
        "turns": 0,
        "tie": False,
        "end": None,
        "requestsHandled": 0,
        "lastChoice": None,
        "returnCode": None,
        "durationMs": duration_ms,
        "timeoutMs": timeout_ms,
        "timeoutSource": "battle_exception",
        "stderr": message,
        "recentMessages": [],
        "recentDebugEvents": [],
        "battleLogData": "",
        "runnerVersion": BATTLE_RUNNER_VERSION,
        "policy": "deterministic preview and active-turn policy for both sides",
        "policyVersion": BATTLE_POLICY_VERSION,
        "seed": seed,
        "gameNumber": game_index,
        "opponentName": opponent_name,
    }


def _build_failed_series_result(opponent_index: int, opponent: dict, error, games_per_opponent: int, timeout_ms: int) -> dict:
    opponent = dict(opponent or {})
    opponent_name = opponent.get("name") or opponent.get("id") or f"opponent-{opponent_index}"
    failure_count = max(int(games_per_opponent or 1), 1)
    games = [
        _build_failed_battle_result(
            game_index=game_number,
            seed=[],
            error=error,
            timeout_ms=timeout_ms,
            duration_ms=0,
            opponent_name=opponent_name,
        )
        for game_number in range(1, failure_count + 1)
    ]
    return {
        "opponentIndex": opponent_index,
        "opponent": opponent,
        "games": games,
        "failed": True,
        "failureContained": True,
        "failureScope": "series",
        "failureReason": str(error or "Opponent series failed before results were captured."),
    }


def _is_unidentified_species_error(error) -> bool:
    return "Unidentified species:" in str(error or "")


def _run_battle_series_job(job_id: str, user_team_export: str, user_packed_team: str, opponent: dict, games: int, format_id: str, validation_result: dict):
    time.sleep(0.05)
    if not _mark_job_running(job_id):
        return

    showdown_status = get_showdown_status()
    repo_dir = showdown_status.get("repoDir")
    if not repo_dir:
        _fail_job(job_id, "Showdown repoDir is not configured, so battle series cannot run.")
        return

    total_games = max(int(games or 1), 1)
    results = []
    rng = random.Random()

    try:
        for idx in range(total_games):
            set_job_progress(
                job_id,
                phase="simulating-games",
                percent=10 + int((idx / max(total_games, 1)) * 80),
                currentStep=f"Running game {idx + 1}/{total_games}",
                processedGames=idx,
                totalGames=total_games,
                currentTemplate=opponent.get("id"),
                currentEstimatedWinRate=None,
            )

            seed = [rng.randrange(1, 65535) for _ in range(4)]
            result = run_default_policy_battle(
                repo_dir=repo_dir,
                format_id=format_id,
                p1_name="Professor Aegis User",
                p2_name="Benchmark Opponent",
                p1_team=user_packed_team,
                p2_team=opponent.get("packedTeam"),
                seed=seed,
                timeout_ms=int(showdown_status.get("battleTimeoutMs") or 30000),
            )
            result["seed"] = seed
            result["gameNumber"] = idx + 1
            results.append(result)

            set_job_progress(
                job_id,
                phase="simulating-games",
                percent=10 + int(((idx + 1) / max(total_games, 1)) * 80),
                currentStep=f"Completed game {idx + 1}/{total_games}",
                processedGames=idx + 1,
                totalGames=total_games,
                currentTemplate=opponent.get("id"),
                currentEstimatedWinRate=None,
            )

        set_job_progress(job_id, phase="finalizing-series-report", percent=95, currentStep="Finalizing battle series report")
        report = build_battle_series_report(
            format_id=format_id,
            opponent=opponent,
            series_results=results,
            user_team_validation=validation_result,
            user_packed_team=user_packed_team,
            games_requested=total_games,
        )
        _complete_job(job_id, report)
    except Exception as exc:
        _fail_job(job_id, str(exc) or "BenchMark Python worker failed to run the battle series.")




def _series_target_wins(games_per_opponent: int) -> int:
    games = max(int(games_per_opponent or 1), 1)
    return (games // 2) + 1


def _is_user_battle_win(result: dict) -> bool:
    return bool(result and result.get("ok") and not result.get("failed") and result.get("winner") == "Professor Aegis User")


def _is_opponent_battle_win(result: dict) -> bool:
    return bool(result and result.get("ok") and not result.get("failed") and result.get("winner") == "Benchmark Opponent")


def _is_usable_battle_result(result: dict) -> bool:
    if not result or result.get("failed") or not result.get("ok"):
        return False
    if _is_user_battle_win(result) or _is_opponent_battle_win(result):
        return True
    return bool(result.get("ok") and not result.get("winner"))


def _team_export_blocks(team_export: str) -> list:
    normalized = str(team_export or "").replace("\r\n", "\n").strip()
    return [block.strip() for block in normalized.split("\n\n") if block.strip()]


def _reordered_team_export_for_lead_pair(team_export: str, pair_indexes: list) -> str:
    blocks = _team_export_blocks(team_export)
    indexes = [int(index) for index in list(pair_indexes or []) if 0 <= int(index) < len(blocks)]
    selected = []
    for index in indexes:
        if index not in selected:
            selected.append(index)
    remaining = [index for index in range(len(blocks)) if index not in selected]
    return "\n\n".join([blocks[index] for index in selected + remaining])


def _lead_pair_species_key(value) -> str:
    return "".join(ch for ch in clean_text(value).lower() if ch.isalnum())


def _lead_pair_species_from_details(value) -> str:
    text = clean_text(value)
    return clean_text(text.split(",", 1)[0]) if text else ""


def _lead_pair_name_from_ident(value) -> str:
    text = clean_text(value)
    if ":" in text:
        return clean_text(text.split(":", 1)[1])
    return text


def _lead_pair_summary(name, slot=None, battle_slot=None) -> dict:
    species = clean_text(name) or "Unknown"
    row = {
        "name": species,
        "species": species,
        "types": [],
    }
    if slot is not None:
        row["slot"] = slot
    if battle_slot:
        row["battleSlot"] = battle_slot
    return row


def _planned_lead_pair_from_candidate(candidate: dict) -> list:
    planned = []
    for item in list((candidate or {}).get("pair") or [])[:2]:
        if isinstance(item, dict):
            planned.append(dict(item))
        else:
            planned.append(_lead_pair_summary(item))
    return planned


def _extract_actual_p1_lead_pair_from_battle_log(battle_log_data: str) -> list:
    leads = {}
    for raw_line in str(battle_log_data or "").splitlines():
        line = raw_line.strip()
        if line.startswith("|turn|"):
            break
        parts = line.split("|")
        if len(parts) < 4 or parts[1] not in {"switch", "drag"}:
            continue
        ident = clean_text(parts[2] if len(parts) > 2 else "")
        if not ident.lower().startswith("p1"):
            continue
        side_slot = ident.split(":", 1)[0].strip().lower()
        battle_slot = side_slot[2:3] or ""
        if battle_slot not in {"a", "b"} or battle_slot in leads:
            continue
        species = _lead_pair_species_from_details(parts[3] if len(parts) > 3 else "") or _lead_pair_name_from_ident(ident)
        leads[battle_slot] = _lead_pair_summary(species, battle_slot=battle_slot)
        if "a" in leads and "b" in leads:
            break
    return [leads[slot] for slot in ("a", "b") if slot in leads]


def _actual_p1_lead_pair_from_result(result: dict, planned_pair: list) -> tuple:
    choices = (result or {}).get("teamPreviewChoices") or {}
    p1_choice = choices.get("p1") if isinstance(choices, dict) else None
    if isinstance(p1_choice, dict):
        chosen_slots = p1_choice.get("chosenSlots") or p1_choice.get("slots") or []
    else:
        chosen_slots = p1_choice or []
    try:
        normalized_slots = [int(slot) for slot in list(chosen_slots or [])[:2]]
    except (TypeError, ValueError):
        normalized_slots = []
    if normalized_slots == [1, 2] and len(planned_pair or []) >= 2:
        return [dict(item) for item in planned_pair[:2]], "teamPreviewChoice"

    actual_from_log = _extract_actual_p1_lead_pair_from_battle_log((result or {}).get("battleLogData") or (result or {}).get("archiveBattleLogData") or "")
    if len(actual_from_log) >= 2:
        return actual_from_log[:2], "battleLogData"

    return actual_from_log, "battleLogData" if actual_from_log else "missing"


def _lead_pair_match_metadata(planned_pair: list, actual_pair: list, source: str) -> dict:
    planned_names = [clean_text((item or {}).get("species") or (item or {}).get("name")) for item in list(planned_pair or [])[:2] if isinstance(item, dict)]
    actual_names = [clean_text((item or {}).get("species") or (item or {}).get("name")) for item in list(actual_pair or [])[:2] if isinstance(item, dict)]
    planned_keys = sorted(_lead_pair_species_key(name) for name in planned_names if name)
    actual_keys = sorted(_lead_pair_species_key(name) for name in actual_names if name)
    matched = len(planned_keys) == 2 and planned_keys == actual_keys
    mismatch_reason = None
    if not matched:
        if len(actual_keys) < 2:
            mismatch_reason = f"actual-leads-missing:{source or 'missing'}"
        elif len(planned_keys) < 2:
            mismatch_reason = "planned-leads-missing"
        else:
            mismatch_reason = "actual-leads-did-not-match-planned-pair"
    return {
        "plannedLeadPair": [dict(item) for item in list(planned_pair or [])[:2] if isinstance(item, dict)],
        "actualLeadPair": [dict(item) for item in list(actual_pair or [])[:2] if isinstance(item, dict)],
        "actualLeadPairSource": source,
        "leadPairMatched": bool(matched),
        "mismatchReason": mismatch_reason,
    }


def _apply_lead_pair_match_metadata(result: dict, candidate: dict) -> dict:
    result = dict(result or {})
    planned_pair = _planned_lead_pair_from_candidate(candidate)
    actual_pair, source = _actual_p1_lead_pair_from_result(result, planned_pair)
    result.update(_lead_pair_match_metadata(planned_pair, actual_pair, source))
    return result


def _team_block_species(block: str, fallback: str) -> str:
    header = clean_text(str(block or "").splitlines()[0] if str(block or "").splitlines() else "")
    raw = clean_text(header.split(" @ ", 1)[0] if header else "")
    if "(" in raw and ")" in raw:
        last_open = raw.rfind("(")
        last_close = raw.rfind(")")
        if last_open >= 0 and last_close > last_open:
            inside = clean_text(raw[last_open + 1:last_close])
            if inside:
                return inside
    return raw or fallback


def _core_team_slot_summaries(team_export: str) -> dict:
    summaries = {}
    for index, block in enumerate(_team_export_blocks(team_export), 1):
        species = _team_block_species(block, f"Slot {index}")
        summaries[index] = {
            "slot": index,
            "name": species,
            "species": species,
            "types": [],
        }
    return summaries


def _planned_core_from_candidate(candidate: dict) -> list:
    return [dict(item) for item in list((candidate or {}).get("core") or [])[:4] if isinstance(item, dict)]


def _actual_p1_core_from_result(result: dict, team_slot_summaries: dict) -> tuple:
    choices = (result or {}).get("teamPreviewChoices") or {}
    p1_choice = choices.get("p1") if isinstance(choices, dict) else None
    if isinstance(p1_choice, dict):
        chosen_slots = p1_choice.get("chosenSlots") or p1_choice.get("slots") or []
    else:
        chosen_slots = p1_choice or []
    selected_slots = []
    for slot in list(chosen_slots or [])[:4]:
        try:
            value = int(slot)
        except (TypeError, ValueError):
            continue
        if value not in selected_slots:
            selected_slots.append(value)

    selected_core = [
        dict(team_slot_summaries.get(slot) or {"slot": slot, "name": f"Slot {slot}", "species": f"Slot {slot}", "types": []})
        for slot in selected_slots
    ]
    actual_pair = selected_core[:2]
    source = "teamPreviewChoice" if len(selected_core) >= 4 else ("teamPreviewChoice-partial" if selected_core else "missing")
    return selected_core, actual_pair, source


def _core_match_metadata(planned_core: list, actual_core: list, actual_pair: list, source: str) -> dict:
    planned_slots = sorted(int(item.get("slot")) for item in list(planned_core or []) if isinstance(item, dict) and item.get("slot"))
    actual_slots = sorted(int(item.get("slot")) for item in list(actual_core or []) if isinstance(item, dict) and item.get("slot"))
    matched = len(planned_slots) == 4 and planned_slots == actual_slots
    mismatch_reason = None
    if not matched:
        if len(actual_slots) < 4:
            mismatch_reason = f"actual-core-missing:{source or 'missing'}"
        elif len(planned_slots) < 4:
            mismatch_reason = "planned-core-missing"
        else:
            mismatch_reason = "actual-core-did-not-match-planned-core"
    return {
        "plannedCore": [dict(item) for item in list(planned_core or [])[:4] if isinstance(item, dict)],
        "actualSelectedCore": [dict(item) for item in list(actual_core or [])[:4] if isinstance(item, dict)],
        "actualLeadPair": [dict(item) for item in list(actual_pair or [])[:2] if isinstance(item, dict)],
        "actualCoreSource": source,
        "coreMatched": bool(matched),
        "mismatchReason": mismatch_reason,
    }


def _apply_core_match_metadata(result: dict, candidate: dict, team_slot_summaries: dict) -> dict:
    result = dict(result or {})
    planned_core = _planned_core_from_candidate(candidate)
    actual_core, actual_pair, source = _actual_p1_core_from_result(result, team_slot_summaries)
    result.update(_core_match_metadata(planned_core, actual_core, actual_pair, source))
    return result


def _lead_pair_replay_refs_from_result(result: dict, pair_id: str, pair_game_number: int, opponent: dict) -> list:
    if not isinstance(result, dict):
        return []
    refs = []
    archetype_metadata = _opponent_archetype_metadata(opponent, result)
    opponent_template_key = clean_text((opponent or {}).get("templateKey") or result.get("templateKey") or (opponent or {}).get("archetype") or result.get("archetype") or (opponent or {}).get("name"))
    opponent_archetype = clean_text(
        (archetype_metadata or {}).get("displayLabel")
        or (opponent or {}).get("archetype")
        or (opponent or {}).get("championLabArchetype")
        or result.get("archetype")
        or opponent_template_key
    )
    if archetype_metadata and archetype_metadata.get("primaryKey"):
        opponent_template_key = clean_text(archetype_metadata.get("primaryKey"))
    battle_log_data = clean_text(result.get("battleLogData") or result.get("archiveBattleLogData"))
    if battle_log_data:
        game_result = "win" if _is_user_battle_win(result) else ("loss" if _is_opponent_battle_win(result) else "tie")
        refs.append(
            {
                "sourceKind": "lead-pair-sweep",
                "kind": "battleLogData",
                "value": f"lead-pair-sweep/{pair_id or 'unknown-pair'}/game-{pair_game_number}-{game_result}.html",
                "pairId": pair_id,
                "leadPairId": pair_id,
                "leadPairName": result.get("leadPairLabel") or pair_id or "Lead Pair",
                "pairGameNumber": pair_game_number,
                "gameNumber": pair_game_number,
                "result": game_result,
                "winner": result.get("winner"),
                "turns": result.get("turns"),
                "seed": result.get("seed"),
                "battleLogData": battle_log_data,
                "plannedLeadPair": result.get("plannedLeadPair"),
                "actualLeadPair": result.get("actualLeadPair"),
                "actualLeadPairSource": result.get("actualLeadPairSource"),
                "leadPairMatched": result.get("leadPairMatched"),
                "mismatchReason": result.get("mismatchReason"),
                "opponentId": (opponent or {}).get("id"),
                "opponentName": (opponent or {}).get("name") or result.get("opponentName"),
                "opponentArchetype": opponent_archetype,
                "templateKey": opponent_template_key,
                "templateLabel": opponent_archetype,
                "archetypeMetadata": archetype_metadata,
                "opponentTeamExport": result.get("opponentTeamExport") or (opponent or {}).get("teamExport") or "",
                "playerTeamExport": result.get("playerTeamExport") or result.get("userTeamExport") or "",
            }
        )
    for key in ("replayUrl", "replayURL", "battleLogPath", "archiveBattleLogPath", "htmlPath", "logPath"):
        value = result.get(key)
        if value:
            refs.append(
                {
                    "kind": key,
                    "value": value,
                    "pairId": pair_id,
                    "pairGameNumber": pair_game_number,
                    "plannedLeadPair": result.get("plannedLeadPair"),
                    "actualLeadPair": result.get("actualLeadPair"),
                    "actualLeadPairSource": result.get("actualLeadPairSource"),
                    "leadPairMatched": result.get("leadPairMatched"),
                    "mismatchReason": result.get("mismatchReason"),
                    "opponentId": (opponent or {}).get("id"),
                    "opponentName": (opponent or {}).get("name"),
                    "opponentArchetype": opponent_archetype,
                    "templateKey": opponent_template_key,
                    "templateLabel": opponent_archetype,
                    "archetypeMetadata": archetype_metadata,
                }
            )
    return refs


def _opponent_archetype_metadata(opponent: dict | None = None, result: dict | None = None) -> dict | None:
    for source in (opponent if isinstance(opponent, dict) else {}, result if isinstance(result, dict) else {}):
        metadata = source.get("archetypeMetadata")
        if isinstance(metadata, dict) and (metadata.get("displayLabel") or metadata.get("primaryLabel")):
            return dict(metadata)
    return None


def _core_replay_refs_from_result(result: dict, core_id: str, core_game_number: int, opponent: dict) -> list:
    if not isinstance(result, dict):
        return []
    refs = []
    archetype_metadata = _opponent_archetype_metadata(opponent, result)
    opponent_template_key = clean_text((opponent or {}).get("templateKey") or result.get("templateKey") or (opponent or {}).get("archetype") or result.get("archetype") or (opponent or {}).get("name"))
    opponent_archetype = clean_text(
        (archetype_metadata or {}).get("displayLabel")
        or (opponent or {}).get("archetype")
        or (opponent or {}).get("championLabArchetype")
        or result.get("archetype")
        or opponent_template_key
    )
    if archetype_metadata and archetype_metadata.get("primaryKey"):
        opponent_template_key = clean_text(archetype_metadata.get("primaryKey"))
    battle_log_data = clean_text(result.get("battleLogData") or result.get("archiveBattleLogData"))
    if battle_log_data:
        game_result = "win" if _is_user_battle_win(result) else ("loss" if _is_opponent_battle_win(result) else "tie")
        refs.append(
            {
                "sourceKind": "core-sweep",
                "kind": "battleLogData",
                "value": f"core-sweep/{core_id or 'unknown-core'}/game-{core_game_number}-{game_result}.html",
                "coreId": core_id,
                "coreName": result.get("coreLabel") or core_id or "Core",
                "coreGameNumber": core_game_number,
                "gameNumber": core_game_number,
                "result": game_result,
                "winner": result.get("winner"),
                "turns": result.get("turns"),
                "seed": result.get("seed"),
                "battleLogData": battle_log_data,
                "plannedCore": result.get("plannedCore"),
                "actualSelectedCore": result.get("actualSelectedCore"),
                "actualLeadPair": result.get("actualLeadPair"),
                "actualCoreSource": result.get("actualCoreSource"),
                "coreMatched": result.get("coreMatched"),
                "mismatchReason": result.get("mismatchReason"),
                "opponentId": (opponent or {}).get("id"),
                "opponentName": (opponent or {}).get("name") or result.get("opponentName"),
                "opponentArchetype": opponent_archetype,
                "templateKey": opponent_template_key,
                "templateLabel": opponent_archetype,
                "archetypeMetadata": archetype_metadata,
                "opponentTeamExport": result.get("opponentTeamExport") or (opponent or {}).get("teamExport") or "",
                "playerTeamExport": result.get("playerTeamExport") or result.get("userTeamExport") or "",
            }
        )
    return refs


def _lead_pair_parallelism_cap(profile: dict) -> int:
    try:
        profile_cap = max(int((profile or {}).get("parallelismCap") or 4), 1)
    except Exception:
        profile_cap = 4
    caps = [profile_cap, 4, SHARED_WORKER_POOL_CAP, GLOBAL_BATTLE_SEMAPHORE_CAP]
    return max(min(int(cap or 1) for cap in caps), 1)


def _run_lead_pair_sweep(job_id: str, user_team_export: str, selected_opponents: list, format_id: str, repo_dir: str, timeout_ms: int) -> dict:
    profile = get_lead_pair_sweep_profile()
    all_candidates = build_lead_pair_sweep_candidates(user_team_export)
    ranked_candidates = build_lead_pair_pre_score_candidates(user_team_export)
    candidates = [dict(candidate) for candidate in ranked_candidates if candidate.get("selectedForBattle")]
    ready_opponents = [
        dict(opponent or {})
        for opponent in list(selected_opponents or [])
        if isinstance(opponent, dict) and opponent.get("packedTeam") and opponent.get("packedTeamAvailable") is not False
    ]
    if len(all_candidates) != 15:
        raise RuntimeError(f"Lead-pair sweep expected 15 pairs from a 6 Pokémon team, but generated {len(all_candidates)}.")
    if len(candidates) != 5:
        raise RuntimeError(f"Lead-pair sweep expected 5 pre-scored finalists, but selected {len(candidates)}.")
    if not ready_opponents:
        raise RuntimeError("Lead-pair sweep could not start because no approved completed-pool opponents were available.")

    games_per_pair = max(int(profile.get("gamesPerPair") or 25), 1)
    parallelism_cap = _lead_pair_parallelism_cap(profile)
    total_games = len(candidates) * games_per_pair
    sweep_started_at = utc_now_iso()
    sweep_timer = time.time()
    rng = random.Random()
    completed_games = 0
    lead_progress_lock = threading.Lock()
    lead_progress_state = {
        "completed_games": 0,
        "failed_games": 0,
        "launched_games": 0,
        "total_games": total_games,
        "total_opponents": len(candidates),
    }
    pair_contexts = []
    sweep_tasks = []

    _log_event(
        "lead_pair_sweep_started",
        jobId=job_id,
        profileId=profile.get("profileId"),
        pairsGenerated=len(all_candidates),
        pairsSelected=len(candidates),
        finalistLimit=len(candidates),
        gamesPerPair=games_per_pair,
        totalGames=total_games,
        approvedOpponentPool=len(ready_opponents),
        parallelism=parallelism_cap,
        sharedWorkerPoolCap=SHARED_WORKER_POOL_CAP,
        globalSemaphoreCap=GLOBAL_BATTLE_SEMAPHORE_CAP,
    )
    _set_throughput_lead_pair(
        job_id,
        profileId=profile.get("profileId"),
        pairsGenerated=len(all_candidates),
        pairsSelected=len(candidates),
        finalistLimit=len(candidates),
        gamesPerPair=games_per_pair,
        totalGames=total_games,
        completedGames=0,
        parallelism=parallelism_cap,
        status="running",
    )

    for pair_index, candidate in enumerate(candidates, 1):
        pair_id = candidate.get("pairId")
        pair_label = candidate.get("label")
        reordered_export = _reordered_team_export_for_lead_pair(user_team_export, candidate.get("pairIndexes") or [])
        simulator_reordered_export = _simulator_team_export_for_format(reordered_export, format_id)
        packing = pack_team_export(simulator_reordered_export)
        if not packing.get("ok") or not packing.get("packedTeam"):
            raise RuntimeError(f"Lead-pair sweep could not pack reordered team for {pair_label}.")
        pair_contexts.append(
            {
                "pairIndex": pair_index,
                "candidate": candidate,
                "pairId": pair_id,
                "pairLabel": pair_label,
                "packedTeam": packing.get("packedTeam"),
                "startedAt": None,
                "completedAt": None,
                "games": [],
            }
        )
        for game_number in range(1, games_per_pair + 1):
            global_game_number = len(sweep_tasks) + 1
            opponent = ready_opponents[(global_game_number - 1) % len(ready_opponents)]
            seed = [rng.randrange(1, 65535) for _ in range(4)]
            sweep_tasks.append(
                {
                    "pairContext": pair_contexts[-1],
                    "pairIndex": pair_index,
                    "pairId": pair_id,
                    "pairLabel": pair_label,
                    "gameNumber": game_number,
                    "globalGameNumber": global_game_number,
                    "opponent": opponent,
                    "seed": seed,
                }
            )

    def _run_lead_pair_game(task: dict) -> dict:
        pair_index = int(task.get("pairIndex") or 0)
        pair_id = task.get("pairId")
        pair_label = task.get("pairLabel")
        game_number = int(task.get("gameNumber") or 0)
        global_game_number = int(task.get("globalGameNumber") or 0)
        opponent = dict(task.get("opponent") or {})
        seed = list(task.get("seed") or [])
        pair_context = task.get("pairContext") or {}
        packed_team = pair_context.get("packedTeam")

        with lead_progress_lock:
            lead_progress_state["launched_games"] = int(lead_progress_state.get("launched_games") or 0) + 1
            lead_progress_state["current_pair_index"] = pair_index
            lead_progress_state["current_pair_label"] = pair_label
            lead_progress_state["current_game_number"] = game_number
            lead_progress_state["current_global_game_number"] = global_game_number
            lead_progress_state["current_opponent_id"] = opponent.get("id")
            lead_progress_state["current_opponent_name"] = opponent.get("name")
            launched_games = int(lead_progress_state.get("launched_games") or 0)
            progress_completed = int(lead_progress_state.get("completed_games") or 0)

        percent = min(99, 97 + int((progress_completed / max(total_games, 1)) * 2))
        worker_view = _shared_worker_snapshot(job_id)
        set_job_progress(
            job_id,
            phase="lead-pair-sweep",
            percent=percent,
            currentStep=f"Testing Top {len(candidates)} lead-pair finalist {pair_index}/{len(candidates)}: {pair_label} game {game_number}/{games_per_pair}",
            leadPairSweep=True,
            leadPairProfileId=profile.get("profileId"),
            leadPairPairsProcessed=0,
            leadPairPairsTotal=len(candidates),
            leadPairPairsGenerated=len(all_candidates),
            leadPairFinalistLimit=len(candidates),
            leadPairGamesProcessed=progress_completed,
            leadPairGamesTotal=total_games,
            currentLeadPair=pair_label,
            currentOpponent=opponent.get("name"),
            currentTemplate=opponent.get("templateKey"),
            currentBattleNumber=launched_games,
            waitingForWorkers=False,
            queueSpot=0,
            workerCapSnapshot=worker_view.get("workerCapSnapshot"),
        )

        final_result = None
        last_failed_result = None
        contained_failures = []
        max_attempts = BATTLE_RETRY_MAX_ATTEMPTS + 1
        attempt = 0

        def _is_lead_pair_timeout_failure(result_row: dict, error_text: str) -> bool:
            result_row = result_row if isinstance(result_row, dict) else {}
            timeout_source = str(result_row.get("timeoutSource") or "").strip().lower()
            if timeout_source and timeout_source not in ("none", "null"):
                return True
            if result_row.get("timedOut") is True or result_row.get("timeout") is True:
                return True
            timeout_text = " ".join(
                str(value or "")
                for value in (
                    error_text,
                    result_row.get("failureReason"),
                    result_row.get("error"),
                    result_row.get("stderr"),
                )
            ).lower()
            return (
                "timeout" in timeout_text
                or "timed out" in timeout_text
                or "response-timeout" in timeout_text
                or "no_completed_result" in timeout_text
            )

        while attempt < max_attempts:
            attempt += 1
            retry_number = max(attempt - 1, 0)
            attempt_seed = seed
            if retry_number > 0:
                attempt_rng = random.Random(f"{job_id}:{global_game_number}:{attempt}:{time.time_ns()}")
                attempt_seed = [attempt_rng.randrange(1, 65535) for _ in range(4)]
                _activate_job_safe_mode(job_id, reason="lead-pair-battle-retry", cap=_retry_worker_cap_for_attempt(attempt))
                if BATTLE_RETRY_BACKOFF_SEC > 0:
                    time.sleep(BATTLE_RETRY_BACKOFF_SEC)

            battle_start = time.time()
            with lead_progress_lock:
                if not pair_context.get("startedAt"):
                    pair_context["startedAt"] = battle_start
            slot_view = _acquire_shared_worker_slot(job_id, lead_progress_state, lead_progress_lock, phase="leadPairSweep")
            stagger_view = _persistent_first_attempt_stagger_view(retry_number)
            _apply_battle_start_stagger(job_id, pair_index, pair_label, game_number, retry_number, stagger_view)
            _resource_adjust("launchedBattles", 1)
            _resource_adjust("activeBattles", 1)
            try:
                try:
                    result = run_default_policy_battle(
                        repo_dir=repo_dir,
                        format_id=format_id,
                        p1_name="Professor Aegis User",
                        p2_name="Benchmark Opponent",
                        p1_team=packed_team,
                        p2_team=opponent.get("packedTeam"),
                        seed=attempt_seed,
                        timeout_ms=timeout_ms,
                        p1_forced_team_preview_slots=[1, 2],
                    )
                finally:
                    _resource_adjust("activeBattles", -1)
                    _release_shared_worker_slot(job_id, phase="leadPairSweep")
            except Exception as exc:
                result = _build_failed_battle_result(
                    game_index=game_number,
                    seed=attempt_seed,
                    error=exc,
                    timeout_ms=timeout_ms,
                    duration_ms=_elapsed_ms(battle_start),
                    opponent_name=opponent.get("name"),
                )

            result = _apply_lead_pair_match_metadata(result, pair_context.get("candidate") or {})
            result["seed"] = result.get("seed") or attempt_seed
            result["originalSeed"] = seed
            result["gameNumber"] = result.get("gameNumber") or game_number
            result["leadPairId"] = pair_id
            result["leadPairLabel"] = pair_label
            result["leadPairGameNumber"] = game_number
            result["globalLeadPairGameNumber"] = global_game_number
            result["opponentId"] = opponent.get("id")
            result["opponentName"] = opponent.get("name")
            archetype_metadata = _opponent_archetype_metadata(opponent, result)
            result["archetypeMetadata"] = archetype_metadata
            result["templateKey"] = (archetype_metadata or {}).get("primaryKey") or opponent.get("templateKey")
            result["templateLabel"] = (archetype_metadata or {}).get("displayLabel") or opponent.get("archetype") or opponent.get("championLabArchetype") or opponent.get("templateKey") or opponent.get("name")
            result["archetype"] = (archetype_metadata or {}).get("displayLabel") or opponent.get("archetype") or opponent.get("championLabArchetype")
            result.setdefault("durationMs", _elapsed_ms(battle_start))
            result.setdefault("policyVersion", BATTLE_POLICY_VERSION)
            result["attempt"] = attempt
            result["retryNumber"] = retry_number
            _record_throughput_battle_runtime(job_id, result.get("durationMs"), result, phase="leadPairSweep")

            if _is_usable_battle_result(result):
                final_result = result
                if contained_failures:
                    result["containedLeadPairFailures"] = contained_failures
                    result["containedLeadPairFailureCount"] = len(contained_failures)
                    _log_event(
                        "lead_pair_game_retry_completed",
                        jobId=job_id,
                        pairIndex=pair_index,
                        pairRank=pair_index,
                        preScoreRank=(pair_context.get("candidate") or {}).get("preScoreRank"),
                        pairId=pair_id,
                        pairLabel=pair_label,
                        gameNumber=game_number,
                        globalGameNumber=global_game_number,
                        opponentName=opponent.get("name"),
                        retryNumber=retry_number,
                        containedFailureCount=len(contained_failures),
                        durationMs=result.get("durationMs"),
                        ok=result.get("ok"),
                        winner=result.get("winner"),
                    )
                break

            last_failed_result = result
            error_message = str(
                result.get("failureReason")
                or result.get("error")
                or result.get("stderr")
                or "Lead-pair battle returned an unusable result."
            ).strip()
            timeout_failure = _is_lead_pair_timeout_failure(result, error_message)
            terminal_failure = timeout_failure or attempt >= max_attempts
            failure_record = {
                "pairIndex": pair_index,
                "pairRank": pair_index,
                "preScoreRank": (pair_context.get("candidate") or {}).get("preScoreRank"),
                "pairId": pair_id,
                "pairLabel": pair_label,
                "gameNumber": game_number,
                "globalGameNumber": global_game_number,
                "attempt": attempt,
                "retryNumber": retry_number,
                "maxAttempts": max_attempts,
                "opponentId": opponent.get("id"),
                "opponentName": opponent.get("name"),
                "seed": result.get("seed") or attempt_seed,
                "durationMs": result.get("durationMs"),
                "error": error_message,
                "terminal": bool(terminal_failure),
                "timeout": bool(timeout_failure),
                "terminalReason": "timeout" if timeout_failure else ("max-attempts" if terminal_failure else None),
            }
            contained_failures.append(failure_record)
            _resource_adjust("containedFailures", 1)
            _log_event(
                "lead_pair_game_failed_contained",
                jobId=job_id,
                pairIndex=pair_index,
                pairRank=pair_index,
                preScoreRank=(pair_context.get("candidate") or {}).get("preScoreRank"),
                pairId=pair_id,
                pairLabel=pair_label,
                gameNumber=game_number,
                globalGameNumber=global_game_number,
                attempt=attempt,
                retryNumber=retry_number,
                maxAttempts=max_attempts,
                opponentId=opponent.get("id"),
                opponentName=opponent.get("name"),
                durationMs=result.get("durationMs"),
                ok=result.get("ok"),
                failed=result.get("failed"),
                winner=result.get("winner"),
                error=error_message,
                timeoutFailure=bool(timeout_failure),
                terminalReason=failure_record.get("terminalReason"),
                action="terminal-timeout" if timeout_failure else ("terminal-contained" if terminal_failure else "retry"),
            )
            if terminal_failure:
                break

        if final_result is None:
            result = last_failed_result or _build_failed_battle_result(
                game_index=game_number,
                seed=seed,
                error="Lead-pair battle returned no result after retry containment.",
                timeout_ms=timeout_ms,
                duration_ms=0,
                opponent_name=opponent.get("name"),
            )
            result["leadPairMatched"] = False
            result["mismatchReason"] = "lead-pair-game-failed-contained"
            result["containedLeadPairFailures"] = contained_failures
            result["containedLeadPairFailureCount"] = len(contained_failures)
            result["containedLeadPairTerminalFailure"] = True
            with lead_progress_lock:
                lead_progress_state["failed_games"] = int(lead_progress_state.get("failed_games") or 0) + 1
                pair_context["completedAt"] = time.time()
                completed = int(lead_progress_state.get("completed_games") or 0)
            result["leadPairRetryCapRecovery"] = {
                "cleared": False,
                "reason": "terminal-contained-failure-abort-pending",
            }
            return {
                "pairIndex": pair_index,
                "pairId": pair_id,
                "pairLabel": pair_label,
                "gameNumber": game_number,
                "globalGameNumber": global_game_number,
                "result": result,
                "opponent": opponent,
                "replayRefs": [],
                "completedGames": completed,
                "containedFailure": True,
            }

        result = final_result
        replay_refs = _lead_pair_replay_refs_from_result(result, pair_id, game_number, opponent)
        with lead_progress_lock:
            lead_progress_state["completed_games"] = int(lead_progress_state.get("completed_games") or 0) + 1
            pair_context["completedAt"] = time.time()
            completed = int(lead_progress_state.get("completed_games") or 0)
            _resource_adjust("scoredBattles", 1)
        retry_cap_recovery = _clear_lead_pair_retry_cap_after_progress(job_id, reason="lead-pair-game-completed")
        result["leadPairRetryCapRecovery"] = retry_cap_recovery
        return {
            "pairIndex": pair_index,
            "pairId": pair_id,
            "pairLabel": pair_label,
            "gameNumber": game_number,
            "globalGameNumber": global_game_number,
            "result": result,
            "opponent": opponent,
            "replayRefs": replay_refs,
            "completedGames": completed,
        }

    pending = set()
    future_map = {}
    executor = ThreadPoolExecutor(max_workers=parallelism_cap)
    try:
        for task in sweep_tasks:
            future = executor.submit(_run_lead_pair_game, task)
            future_map[future] = task
            pending.add(future)

        last_completed_games = 0
        last_progress_ts = time.time()
        retry_stuck_guard_sec = max(
            (float(timeout_ms or 30000) / 1000.0) * max(int(BATTLE_RETRY_MAX_ATTEMPTS or 0) + 2, 2)
            + float(BATTLE_RETRY_BACKOFF_SEC or 0.0) * max(int(BATTLE_RETRY_MAX_ATTEMPTS or 0), 0),
            120.0,
        )

        def _pending_task_context():
            with lead_progress_lock:
                live_context = {
                    "pairIndex": int(lead_progress_state.get("current_pair_index") or 0),
                    "pairRank": int(lead_progress_state.get("current_pair_index") or 0),
                    "pairLabel": lead_progress_state.get("current_pair_label"),
                    "gameNumber": int(lead_progress_state.get("current_game_number") or 0),
                    "globalGameNumber": int(lead_progress_state.get("current_global_game_number") or 0),
                    "opponentId": lead_progress_state.get("current_opponent_id"),
                    "opponentName": lead_progress_state.get("current_opponent_name"),
                }
            if live_context.get("pairLabel") or live_context.get("gameNumber"):
                return live_context
            task = None
            try:
                task = future_map.get(next(iter(pending))) if pending else None
            except Exception:
                task = None
            task = task if isinstance(task, dict) else {}
            opponent = task.get("opponent") if isinstance(task.get("opponent"), dict) else {}
            return {
                "pairIndex": int(task.get("pairIndex") or 0),
                "pairRank": int(task.get("pairIndex") or 0),
                "pairLabel": task.get("pairLabel"),
                "gameNumber": int(task.get("gameNumber") or 0),
                "globalGameNumber": int(task.get("globalGameNumber") or 0),
                "opponentId": opponent.get("id"),
                "opponentName": opponent.get("name"),
            }

        def _fail_terminal_contained_lead_pair(completed: dict, task: dict):
            for pending_future in pending:
                pending_future.cancel()
            result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
            opponent = completed.get("opponent") if isinstance(completed.get("opponent"), dict) else {}
            if not opponent:
                opponent = task.get("opponent") if isinstance(task.get("opponent"), dict) else {}
            failures = [
                dict(item)
                for item in list(result.get("containedLeadPairFailures") or [])
                if isinstance(item, dict)
            ]
            last_failure = failures[-1] if failures else {}
            pair_index = int(completed.get("pairIndex") or task.get("pairIndex") or 0)
            pair_label = completed.get("pairLabel") or task.get("pairLabel") or "unknown"
            game_number = int(completed.get("gameNumber") or task.get("gameNumber") or 0)
            global_game_number = int(completed.get("globalGameNumber") or task.get("globalGameNumber") or 0)
            opponent_name = opponent.get("name") or last_failure.get("opponentName") or "unknown"
            retry_count = int(last_failure.get("attempt") or result.get("attempt") or 0)
            retry_number = int(last_failure.get("retryNumber") or result.get("retryNumber") or 0)
            max_attempts = int(last_failure.get("maxAttempts") or BATTLE_RETRY_MAX_ATTEMPTS + 1)
            inner_error = str(
                last_failure.get("error")
                or result.get("failureReason")
                or result.get("error")
                or "Lead-pair battle exhausted retries."
            ).strip()
            with lead_progress_lock:
                current_completed_games = int(lead_progress_state.get("completed_games") or 0)
                current_failed_games = int(lead_progress_state.get("failed_games") or 0)
            clear_result = _clear_lead_pair_retry_cap_after_progress(job_id, reason="lead-pair-terminal-failure-abort")
            message = (
                "Lead Pair Sweep could not safely complete after a lead-pair battle exhausted retries. "
                f"Phase: Lead Pair Sweep. Pair: {pair_label} ({pair_index}/{len(candidates)}). "
                f"Game: {game_number}/{games_per_pair}. "
                f"Opponent: {opponent_name}. "
                f"Completed lead-pair games: {current_completed_games}/{total_games}. "
                f"Failed lead-pair games: {current_failed_games}. "
                f"Retry status: exhausted after {retry_count}/{max_attempts} attempts "
                f"(retry number {retry_number}). "
                f"Reason: {inner_error}. "
                "Your previous completed Simulation Report was preserved."
            )
            _set_throughput_lead_pair(
                job_id,
                completedGames=current_completed_games,
                parallelism=parallelism_cap,
                status="failed",
                error="lead-pair-terminal-contained-failure",
            )
            set_job_progress(
                job_id,
                phase="lead-pair-sweep-failed",
                percent=97,
                currentStep=message,
                leadPairSweep=True,
                leadPairProfileId=profile.get("profileId"),
                leadPairPairsProcessed=sum(1 for context_row in pair_contexts if len(context_row.get("games") or []) >= games_per_pair),
                leadPairPairsTotal=len(candidates),
                leadPairPairsGenerated=len(all_candidates),
                leadPairFinalistLimit=len(candidates),
                leadPairGamesProcessed=current_completed_games,
                leadPairGamesTotal=total_games,
                currentLeadPair=pair_label,
                currentOpponent=opponent_name,
                waitingForWorkers=False,
                queueSpot=0,
            )
            _log_event(
                "lead_pair_sweep_terminal_failure_triggered",
                jobId=job_id,
                profileId=profile.get("profileId"),
                pairIndex=pair_index,
                pairRank=pair_index,
                preScoreRank=last_failure.get("preScoreRank"),
                pairId=completed.get("pairId") or task.get("pairId"),
                pairLabel=pair_label,
                gameNumber=game_number,
                globalGameNumber=global_game_number,
                opponentId=opponent.get("id") or last_failure.get("opponentId"),
                opponentName=opponent_name,
                retryNumber=retry_number,
                maxAttempts=max_attempts,
                gamesCompleted=current_completed_games,
                gamesRequested=total_games,
                failedGames=current_failed_games,
                pendingGames=len(pending),
                retryCapCleared=bool(clear_result.get("cleared")),
                retryCapClearReason=clear_result.get("reason"),
                innerError=inner_error,
                error="lead-pair-terminal-contained-failure",
                previousReportPreserved=True,
            )
            raise RuntimeError(message)

        while pending:
            done, pending = wait(pending, timeout=1.0, return_when=FIRST_COMPLETED)
            if not done:
                with lead_progress_lock:
                    current_completed_games = int(lead_progress_state.get("completed_games") or 0)
                    current_failed_games = int(lead_progress_state.get("failed_games") or 0)
                if current_completed_games > last_completed_games:
                    last_completed_games = current_completed_games
                    last_progress_ts = time.time()
                    continue
                no_progress_sec = max(time.time() - last_progress_ts, 0.0)
                if _lead_pair_retry_cap_active(job_id) and no_progress_sec >= retry_stuck_guard_sec:
                    for pending_future in pending:
                        pending_future.cancel()
                    context = _pending_task_context()
                    clear_result = _clear_lead_pair_retry_cap_after_progress(job_id, reason="lead-pair-stuck-guard")
                    contained_failures_total = int(_resource_state_snapshot().get("containedFailures") or 0)
                    message = (
                        "Lead Pair Sweep could not safely complete after retry recovery stalled. "
                        f"Phase: Lead Pair Sweep. Pair: {context.get('pairLabel') or 'unknown'} "
                        f"({context.get('pairIndex') or 0}/{len(candidates)}). "
                        f"Game: {context.get('gameNumber') or 0}/{games_per_pair}. "
                        f"Opponent: {context.get('opponentName') or 'unknown'}. "
                        f"Completed lead-pair games: {current_completed_games}/{total_games}. "
                        f"Contained failures: {contained_failures_total}. "
                        "Retry status: exhausted/no-progress under lead-pair-battle-retry. "
                        "Your previous completed Simulation Report was preserved."
                    )
                    _set_throughput_lead_pair(
                        job_id,
                        completedGames=current_completed_games,
                        parallelism=parallelism_cap,
                        status="failed",
                        error="lead-pair-retry-stuck-guard",
                    )
                    set_job_progress(
                        job_id,
                        phase="lead-pair-sweep-failed",
                        percent=97,
                        currentStep=message,
                        leadPairSweep=True,
                        leadPairProfileId=profile.get("profileId"),
                        leadPairPairsProcessed=sum(1 for context_row in pair_contexts if len(context_row.get("games") or []) >= games_per_pair),
                        leadPairPairsTotal=len(candidates),
                        leadPairPairsGenerated=len(all_candidates),
                        leadPairFinalistLimit=len(candidates),
                        leadPairGamesProcessed=current_completed_games,
                        leadPairGamesTotal=total_games,
                        currentLeadPair=context.get("pairLabel"),
                        currentOpponent=context.get("opponentName"),
                        waitingForWorkers=False,
                        queueSpot=0,
                    )
                    _log_event(
                        "lead_pair_sweep_retry_stuck_guard_triggered",
                        jobId=job_id,
                        profileId=profile.get("profileId"),
                        noProgressSec=round(no_progress_sec, 2),
                        guardSec=round(retry_stuck_guard_sec, 2),
                        gamesCompleted=current_completed_games,
                        gamesRequested=total_games,
                        failedGames=current_failed_games,
                        containedFailures=contained_failures_total,
                        pendingGames=len(pending),
                        retryCapCleared=bool(clear_result.get("cleared")),
                        error="lead-pair-retry-stuck-guard",
                        previousReportPreserved=True,
                        **context,
                    )
                    raise RuntimeError(message)
                continue
            for future in done:
                task = future_map.get(future) or {}
                try:
                    completed = future.result()
                except Exception as exc:
                    for pending_future in pending:
                        pending_future.cancel()
                    raise RuntimeError(f"Lead-pair sweep failed before completing all {total_games} games: {exc}") from exc

                pair_context = task.get("pairContext") or {}
                pair_games = pair_context.setdefault("games", [])
                completed_result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
                if completed.get("containedFailure") and completed_result.get("containedLeadPairTerminalFailure"):
                    _fail_terminal_contained_lead_pair(completed, task)
                pair_games.append(completed)
                completed_games = int(completed.get("completedGames") or completed_games)
                if completed_games > last_completed_games:
                    last_completed_games = completed_games
                    last_progress_ts = time.time()
                pairs_processed = sum(1 for context in pair_contexts if len(context.get("games") or []) >= games_per_pair)
                _set_throughput_lead_pair(
                    job_id,
                    pairsProcessed=pairs_processed,
                    completedGames=completed_games,
                    parallelism=parallelism_cap,
                )
    finally:
        executor.shutdown(wait=True, cancel_futures=True)

    results = []
    for pair_context in pair_contexts:
        candidate = pair_context.get("candidate") or {}
        pair_id = pair_context.get("pairId")
        pair_label = pair_context.get("pairLabel")
        pair_games = sorted(list(pair_context.get("games") or []), key=lambda row: int(row.get("gameNumber") or 0))
        if len(pair_games) != games_per_pair:
            raise RuntimeError(f"Lead-pair sweep incomplete for {pair_label}: {len(pair_games)}/{games_per_pair} games completed.")
        wins = 0
        losses = 0
        ties = 0
        total_turns = 0
        replay_refs = []
        validated_games = 0
        rejected_games = 0
        mismatch_reasons = {}
        contained_failures = []
        first_actual_pair = None
        first_actual_pair_source = None
        for row in pair_games:
            result = row.get("result") or {}
            contained_failures.extend([dict(item) for item in list(result.get("containedLeadPairFailures") or []) if isinstance(item, dict)])
            if result.get("leadPairMatched") is not True:
                rejected_games += 1
                reason = result.get("mismatchReason") or "actual-leads-unverified"
                mismatch_reasons[reason] = int(mismatch_reasons.get(reason) or 0) + 1
                continue
            validated_games += 1
            if first_actual_pair is None:
                first_actual_pair = list(result.get("actualLeadPair") or [])
                first_actual_pair_source = result.get("actualLeadPairSource")
            if _is_user_battle_win(result):
                wins += 1
            elif _is_opponent_battle_win(result):
                losses += 1
            else:
                ties += 1
            total_turns += int(result.get("turns") or 0)
            replay_refs.extend(list(row.get("replayRefs") or []))
        runtime_ms = 0
        if pair_context.get("startedAt") and pair_context.get("completedAt"):
            runtime_ms = int(round((float(pair_context.get("completedAt") or 0) - float(pair_context.get("startedAt") or 0)) * 1000))
        results.append(
            {
                "pairId": pair_id,
                "pairIndexes": list(candidate.get("pairIndexes") or []),
                "pair": list(candidate.get("pair") or []),
                "label": pair_label,
                "preScore": candidate.get("preScore"),
                "preScoreRank": candidate.get("preScoreRank"),
                "preScoreReasons": list(candidate.get("preScoreReasons") or []),
                "selectedForBattle": True,
                "plannedLeadPair": _planned_lead_pair_from_candidate(candidate),
                "actualLeadPair": first_actual_pair or [],
                "actualLeadPairSource": first_actual_pair_source,
                "leadPairMatched": rejected_games == 0 and validated_games > 0,
                "mismatchReason": None if rejected_games == 0 else "; ".join(f"{key}={value}" for key, value in sorted(mismatch_reasons.items())),
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "gamesPlayed": wins + losses + ties,
                "gamesCompleted": len(pair_games),
                "gamesValidated": validated_games,
                "gamesRejected": rejected_games,
                "gamesAttempted": games_per_pair,
                "containedLeadPairFailures": contained_failures,
                "containedLeadPairFailureCount": len(contained_failures),
                "averageTurns": round(total_turns / max(wins + losses + ties, 1), 2),
                "runtimeMs": runtime_ms,
                "replayRefs": replay_refs,
            }
        )
    runtimes = [int(item.get("runtimeMs") or 0) for item in results if isinstance(item, dict)]
    _set_throughput_lead_pair(
        job_id,
        pairsProcessed=len(results),
        completedGames=completed_games,
        perPairRuntimeMs=runtimes,
        parallelism=parallelism_cap,
    )

    sweep_report = build_lead_pair_sweep_report(
        user_team_export,
        lead_pair_results=results,
        started_at=sweep_started_at,
        completed_at=utc_now_iso(),
        runtime_ms=_elapsed_ms(sweep_timer),
        status="completed",
    )
    actual_pairs_tested = sum(1 for row in results if int(row.get("gamesCompleted") or 0) >= games_per_pair)
    actual_games_completed = sum(int(row.get("gamesCompleted") or 0) for row in results)
    actual_games_validated = sum(int(row.get("gamesValidated") or 0) for row in results)
    actual_games_rejected = sum(int(row.get("gamesRejected") or 0) for row in results)
    replay_artifacts_count = int(sweep_report.get("replayArtifactsCount") or 0)
    sweep_report["pairsTested"] = actual_pairs_tested
    sweep_report["gamesCompleted"] = actual_games_completed
    sweep_report["gamesValidated"] = actual_games_validated
    sweep_report["gamesRejected"] = actual_games_rejected
    sweep_report["missingReplayArtifactsCount"] = max(actual_games_completed - replay_artifacts_count, 0)
    sweep_report["replayArtifactsReady"] = replay_artifacts_count >= actual_games_completed and actual_games_completed > 0
    rejected_pair_summaries = [
        {
            "pairId": row.get("pairId"),
            "pairLabel": row.get("label"),
            "gamesCompleted": row.get("gamesCompleted"),
            "gamesValidated": row.get("gamesValidated"),
            "gamesRejected": row.get("gamesRejected"),
            "mismatchReason": row.get("mismatchReason"),
            "actualLeadPairSource": row.get("actualLeadPairSource"),
        }
        for row in results
        if int(row.get("gamesRejected") or 0) > 0
    ]
    if rejected_pair_summaries:
        sweep_report["rejectedPairSummaries"] = rejected_pair_summaries
    sweep_games_requested = int(sweep_report.get("gamesRequested") or 0)
    sweep_games_completed = int(sweep_report.get("gamesCompleted") or 0)
    sweep_report["gamesFailed"] = max(sweep_games_requested - min(sweep_games_completed, actual_games_validated), 0)
    incomplete_reasons = []
    if sweep_games_requested > 0 and sweep_games_completed < sweep_games_requested:
        incomplete_reasons.append("lead-pair-games-incomplete")
    if sweep_games_requested > 0 and actual_games_validated < sweep_games_requested:
        incomplete_reasons.append("lead-pair-validated-games-incomplete")
    if sweep_games_requested > 0 and sweep_report.get("replayArtifactsReady") is not True:
        incomplete_reasons.append("lead-pair-replay-artifacts-missing")
    if sweep_games_requested > 0 and (
        incomplete_reasons
    ):
        sweep_report["status"] = "incomplete"
        sweep_report["error"] = sweep_report.get("error") or ",".join(incomplete_reasons)
        _log_event(
            "lead_pair_sweep_contained_failures_blocking_promotion",
            jobId=job_id,
            profileId=profile.get("profileId"),
            gamesRequested=sweep_games_requested,
            gamesCompleted=sweep_games_completed,
            gamesValidated=actual_games_validated,
            gamesRejected=actual_games_rejected,
            replayArtifactsReady=bool(sweep_report.get("replayArtifactsReady")),
            replayArtifactsCount=sweep_report.get("replayArtifactsCount"),
            missingReplayArtifactsCount=sweep_report.get("missingReplayArtifactsCount"),
            rejectedPairSummaries=rejected_pair_summaries[:5],
            status=sweep_report.get("status"),
            error=sweep_report.get("error"),
        )
    _record_throughput_phase(job_id, "leadPairSweep", sweep_report.get("runtimeMs"))
    _set_phase_diagnostic_fields(
        job_id,
        "leadPairSweep",
        phaseWallMs=sweep_report.get("runtimeMs"),
        pairsGenerated=sweep_report.get("pairsGenerated"),
        pairsSelected=sweep_report.get("pairsSelected"),
        pairsTested=sweep_report.get("pairsTested"),
        gamesPerPair=games_per_pair,
        totalGames=sweep_report.get("gamesRequested"),
        completedGames=sweep_report.get("gamesCompleted"),
        parallelism=parallelism_cap,
    )
    _set_throughput_lead_pair(
        job_id,
        profileId=profile.get("profileId"),
        pairsGenerated=sweep_report.get("pairsGenerated"),
        pairsSelected=sweep_report.get("pairsSelected"),
        finalistLimit=sweep_report.get("finalistLimit"),
        pairsTested=sweep_report.get("pairsTested"),
        gamesPerPair=games_per_pair,
        totalGames=sweep_report.get("gamesRequested"),
        completedGames=sweep_report.get("gamesCompleted"),
        parallelism=parallelism_cap,
        runtimeMs=sweep_report.get("runtimeMs"),
        status=sweep_report.get("status"),
    )
    if sweep_report.get("status") != "completed":
        raise RuntimeError(
            "Lead Pair Sweep final validation failed: "
            f"{sweep_report.get('error') or sweep_report.get('status') or 'incomplete'} "
            f"({sweep_games_completed}/{sweep_games_requested} completed, "
            f"{actual_games_validated}/{sweep_games_requested} validated, "
            f"{actual_games_rejected} rejected, "
            f"{sweep_report.get('replayArtifactsCount')}/{sweep_games_completed} replay artifacts, "
            f"rejected pairs: {rejected_pair_summaries[:3]})."
        )
    _log_event(
        "lead_pair_sweep_completed",
        jobId=job_id,
        profileId=profile.get("profileId"),
        pairsGenerated=sweep_report.get("pairsGenerated"),
        pairsSelected=sweep_report.get("pairsSelected"),
        finalistLimit=sweep_report.get("finalistLimit"),
        pairsTested=sweep_report.get("pairsTested"),
        gamesRequested=sweep_report.get("gamesRequested"),
        gamesCompleted=sweep_report.get("gamesCompleted"),
        parallelism=parallelism_cap,
        runtimeMs=sweep_report.get("runtimeMs"),
    )
    return sweep_report


def _run_core_sweep(job_id: str, user_team_export: str, selected_opponents: list, format_id: str, repo_dir: str, timeout_ms: int) -> dict:
    profile = get_core_sweep_profile()
    all_candidates = build_core_sweep_candidates(user_team_export)
    ranked_candidates = build_core_pre_score_candidates(user_team_export)
    candidates = [dict(candidate, selectedForBattle=True) for candidate in ranked_candidates]
    ready_opponents = [
        dict(opponent or {})
        for opponent in list(selected_opponents or [])
        if isinstance(opponent, dict) and opponent.get("packedTeam") and opponent.get("packedTeamAvailable") is not False
    ]
    if len(all_candidates) != 15:
        raise RuntimeError(f"Core sweep expected 15 cores from a 6 Pokémon team, but generated {len(all_candidates)}.")
    if len(candidates) != len(all_candidates):
        raise RuntimeError(f"Core sweep expected to battle-test all {len(all_candidates)} generated cores, but selected {len(candidates)}.")
    if not ready_opponents:
        raise RuntimeError("Core sweep could not start because no approved completed-pool opponents were available.")

    games_per_core = max(int(profile.get("gamesPerCore") or 25), 1)
    parallelism_cap = _lead_pair_parallelism_cap(profile)
    total_games = len(candidates) * games_per_core
    sweep_started_at = utc_now_iso()
    sweep_timer = time.time()
    rng = random.Random()
    completed_games = 0
    team_slot_summaries = _core_team_slot_summaries(user_team_export)
    simulator_export = _simulator_team_export_for_format(user_team_export, format_id)
    packing = pack_team_export(simulator_export)
    if not packing.get("ok") or not packing.get("packedTeam"):
        raise RuntimeError("Core sweep could not pack the submitted team.")
    packed_team = packing.get("packedTeam")
    core_progress_lock = threading.Lock()
    core_progress_state = {
        "completed_games": 0,
        "failed_games": 0,
        "launched_games": 0,
        "total_games": total_games,
        "total_opponents": len(candidates),
    }
    core_contexts = []
    sweep_tasks = []

    _log_event(
        "core_sweep_started",
        jobId=job_id,
        profileId=profile.get("profileId"),
        coresGenerated=len(all_candidates),
        coresSelected=len(candidates),
        finalistLimit=len(candidates),
        gamesPerCore=games_per_core,
        totalGames=total_games,
        approvedOpponentPool=len(ready_opponents),
        parallelism=parallelism_cap,
        sharedWorkerPoolCap=SHARED_WORKER_POOL_CAP,
        globalSemaphoreCap=GLOBAL_BATTLE_SEMAPHORE_CAP,
    )
    _set_throughput_core_sweep(
        job_id,
        profileId=profile.get("profileId"),
        coresGenerated=len(all_candidates),
        coresSelected=len(candidates),
        finalistLimit=len(candidates),
        gamesPerCore=games_per_core,
        totalGames=total_games,
        completedGames=0,
        parallelism=parallelism_cap,
        status="running",
    )

    for core_index, candidate in enumerate(candidates, 1):
        core_id = candidate.get("coreId")
        core_label = candidate.get("label")
        allowed_slots = [int(index) + 1 for index in list(candidate.get("coreIndexes") or [])]
        core_contexts.append(
            {
                "coreIndex": core_index,
                "candidate": candidate,
                "coreId": core_id,
                "coreLabel": core_label,
                "allowedSlots": allowed_slots,
                "startedAt": None,
                "completedAt": None,
                "games": [],
            }
        )
        for game_number in range(1, games_per_core + 1):
            global_game_number = len(sweep_tasks) + 1
            opponent = ready_opponents[(global_game_number - 1) % len(ready_opponents)]
            seed = [rng.randrange(1, 65535) for _ in range(4)]
            sweep_tasks.append(
                {
                    "coreContext": core_contexts[-1],
                    "coreIndex": core_index,
                    "coreId": core_id,
                    "coreLabel": core_label,
                    "gameNumber": game_number,
                    "globalGameNumber": global_game_number,
                    "opponent": opponent,
                    "seed": seed,
                }
            )

    def _run_core_game(task: dict) -> dict:
        core_index = int(task.get("coreIndex") or 0)
        core_id = task.get("coreId")
        core_label = task.get("coreLabel")
        game_number = int(task.get("gameNumber") or 0)
        global_game_number = int(task.get("globalGameNumber") or 0)
        opponent = dict(task.get("opponent") or {})
        seed = list(task.get("seed") or [])
        core_context = task.get("coreContext") or {}

        with core_progress_lock:
            core_progress_state["launched_games"] = int(core_progress_state.get("launched_games") or 0) + 1
            launched_games = int(core_progress_state.get("launched_games") or 0)
            progress_completed = int(core_progress_state.get("completed_games") or 0)

        percent = min(99, 98 + int((progress_completed / max(total_games, 1)) * 1))
        worker_view = _shared_worker_snapshot(job_id)
        set_job_progress(
            job_id,
            phase="core-sweep",
            percent=percent,
            currentStep=f"Testing full core sweep {core_index}/{len(candidates)}: {core_label} game {game_number}/{games_per_core}",
            coreSweep=True,
            coreSweepProfileId=profile.get("profileId"),
            coreSweepCoresProcessed=0,
            coreSweepCoresTotal=len(candidates),
            coreSweepCoresGenerated=len(all_candidates),
            coreSweepFinalistLimit=len(candidates),
            coreSweepGamesProcessed=progress_completed,
            coreSweepGamesTotal=total_games,
            currentCore=core_label,
            currentOpponent=opponent.get("name"),
            currentTemplate=opponent.get("templateKey"),
            currentBattleNumber=launched_games,
            waitingForWorkers=False,
            queueSpot=0,
            workerCapSnapshot=worker_view.get("workerCapSnapshot"),
        )

        battle_start = time.time()
        with core_progress_lock:
            if not core_context.get("startedAt"):
                core_context["startedAt"] = battle_start
        slot_view = _acquire_shared_worker_slot(job_id, core_progress_state, core_progress_lock, phase="coreSweep")
        stagger_view = _persistent_first_attempt_stagger_view(0)
        _apply_battle_start_stagger(job_id, core_index, core_label, game_number, 0, stagger_view)
        _resource_adjust("launchedBattles", 1)
        _resource_adjust("activeBattles", 1)
        try:
            try:
                result = run_default_policy_battle(
                    repo_dir=repo_dir,
                    format_id=format_id,
                    p1_name="Professor Aegis User",
                    p2_name="Benchmark Opponent",
                    p1_team=packed_team,
                    p2_team=opponent.get("packedTeam"),
                    seed=seed,
                    timeout_ms=timeout_ms,
                    p1_allowed_team_preview_slots=list(core_context.get("allowedSlots") or []),
                )
            finally:
                _resource_adjust("activeBattles", -1)
                _release_shared_worker_slot(job_id, phase="coreSweep")
        except Exception as exc:
            result = _build_failed_battle_result(
                game_index=game_number,
                seed=seed,
                error=exc,
                timeout_ms=timeout_ms,
                duration_ms=_elapsed_ms(battle_start),
                opponent_name=opponent.get("name"),
            )

        result = _apply_core_match_metadata(result, core_context.get("candidate") or {}, team_slot_summaries)
        result["seed"] = result.get("seed") or seed
        result["gameNumber"] = result.get("gameNumber") or game_number
        result["coreId"] = core_id
        result["coreLabel"] = core_label
        result["coreGameNumber"] = game_number
        result["globalCoreGameNumber"] = global_game_number
        result["opponentId"] = opponent.get("id")
        result["opponentName"] = opponent.get("name")
        archetype_metadata = _opponent_archetype_metadata(opponent, result)
        result["archetypeMetadata"] = archetype_metadata
        result["templateKey"] = (archetype_metadata or {}).get("primaryKey") or opponent.get("templateKey")
        result["templateLabel"] = (archetype_metadata or {}).get("displayLabel") or opponent.get("archetype") or opponent.get("championLabArchetype") or opponent.get("templateKey") or opponent.get("name")
        result["archetype"] = (archetype_metadata or {}).get("displayLabel") or opponent.get("archetype") or opponent.get("championLabArchetype")
        result.setdefault("durationMs", _elapsed_ms(battle_start))
        result.setdefault("policyVersion", BATTLE_POLICY_VERSION)
        _record_throughput_battle_runtime(job_id, result.get("durationMs"), result, phase="coreSweep")

        if not _is_usable_battle_result(result):
            raise RuntimeError(f"Core sweep failed before completing {core_label} game {game_number}.")

        replay_refs = _core_replay_refs_from_result(result, core_id, game_number, opponent)
        with core_progress_lock:
            core_progress_state["completed_games"] = int(core_progress_state.get("completed_games") or 0) + 1
            core_context["completedAt"] = time.time()
            completed = int(core_progress_state.get("completed_games") or 0)
            _resource_adjust("scoredBattles", 1)
        return {
            "coreIndex": core_index,
            "coreId": core_id,
            "coreLabel": core_label,
            "gameNumber": game_number,
            "globalGameNumber": global_game_number,
            "result": result,
            "opponent": opponent,
            "coreReplayRefs": replay_refs,
            "completedGames": completed,
        }

    pending = set()
    future_map = {}
    executor = ThreadPoolExecutor(max_workers=parallelism_cap)
    try:
        for task in sweep_tasks:
            future = executor.submit(_run_core_game, task)
            future_map[future] = task
            pending.add(future)

        while pending:
            done, pending = wait(pending, timeout=1.0, return_when=FIRST_COMPLETED)
            for future in done:
                task = future_map.get(future) or {}
                try:
                    completed = future.result()
                except Exception as exc:
                    for pending_future in pending:
                        pending_future.cancel()
                    raise RuntimeError(f"Core sweep failed before completing all {total_games} games: {exc}") from exc

                core_context = task.get("coreContext") or {}
                core_games = core_context.setdefault("games", [])
                core_games.append(completed)
                completed_games = int(completed.get("completedGames") or completed_games)
                cores_processed = sum(1 for context in core_contexts if len(context.get("games") or []) >= games_per_core)
                _set_throughput_core_sweep(
                    job_id,
                    coresProcessed=cores_processed,
                    completedGames=completed_games,
                    parallelism=parallelism_cap,
                )
    finally:
        executor.shutdown(wait=True, cancel_futures=True)

    results = []
    for core_context in core_contexts:
        candidate = core_context.get("candidate") or {}
        core_id = core_context.get("coreId")
        core_label = core_context.get("coreLabel")
        core_games = sorted(list(core_context.get("games") or []), key=lambda row: int(row.get("gameNumber") or 0))
        if len(core_games) != games_per_core:
            raise RuntimeError(f"Core sweep incomplete for {core_label}: {len(core_games)}/{games_per_core} games completed.")
        wins = 0
        losses = 0
        ties = 0
        total_turns = 0
        replay_refs = []
        validated_games = 0
        rejected_games = 0
        mismatch_reasons = {}
        first_actual_core = None
        first_actual_pair = None
        first_actual_core_source = None
        for row in core_games:
            result = row.get("result") or {}
            if result.get("coreMatched") is not True:
                rejected_games += 1
                reason = result.get("mismatchReason") or "actual-core-unverified"
                mismatch_reasons[reason] = int(mismatch_reasons.get(reason) or 0) + 1
                continue
            validated_games += 1
            if first_actual_core is None:
                first_actual_core = list(result.get("actualSelectedCore") or [])
                first_actual_pair = list(result.get("actualLeadPair") or [])
                first_actual_core_source = result.get("actualCoreSource")
            if _is_user_battle_win(result):
                wins += 1
            elif _is_opponent_battle_win(result):
                losses += 1
            else:
                ties += 1
            total_turns += int(result.get("turns") or 0)
            replay_refs.extend(list(row.get("coreReplayRefs") or []))
        runtime_ms = 0
        if core_context.get("startedAt") and core_context.get("completedAt"):
            runtime_ms = int(round((float(core_context.get("completedAt") or 0) - float(core_context.get("startedAt") or 0)) * 1000))
        results.append(
            {
                "coreId": core_id,
                "coreIndexes": list(candidate.get("coreIndexes") or []),
                "core": list(candidate.get("core") or []),
                "label": core_label,
                "coreScore": candidate.get("preScore"),
                "coreRank": candidate.get("preScoreRank"),
                "preScore": candidate.get("preScore"),
                "preScoreRank": candidate.get("preScoreRank"),
                "preScoreReasons": list(candidate.get("preScoreReasons") or []),
                "selectedForBattle": True,
                "plannedCore": _planned_core_from_candidate(candidate),
                "actualSelectedCore": first_actual_core or [],
                "actualLeadPair": first_actual_pair or [],
                "actualCoreSource": first_actual_core_source,
                "coreMatched": rejected_games == 0 and validated_games > 0,
                "mismatchReason": None if rejected_games == 0 else "; ".join(f"{key}={value}" for key, value in sorted(mismatch_reasons.items())),
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "gamesPlayed": wins + losses + ties,
                "gamesCompleted": len(core_games),
                "gamesValidated": validated_games,
                "gamesRejected": rejected_games,
                "gamesAttempted": games_per_core,
                "averageTurns": round(total_turns / max(wins + losses + ties, 1), 2),
                "runtimeMs": runtime_ms,
                "coreReplayRefs": replay_refs,
                "replayRefs": replay_refs,
            }
        )

    runtimes = [int(item.get("runtimeMs") or 0) for item in results if isinstance(item, dict)]
    _set_throughput_core_sweep(
        job_id,
        coresProcessed=len(results),
        completedGames=completed_games,
        perCoreRuntimeMs=runtimes,
        parallelism=parallelism_cap,
    )

    sweep_report = build_core_sweep_report(
        user_team_export,
        core_results=results,
        started_at=sweep_started_at,
        completed_at=utc_now_iso(),
        runtime_ms=_elapsed_ms(sweep_timer),
        status="completed",
    )
    actual_cores_tested = sum(1 for row in results if int(row.get("gamesCompleted") or 0) >= games_per_core)
    actual_games_completed = sum(int(row.get("gamesCompleted") or 0) for row in results)
    actual_games_validated = sum(int(row.get("gamesValidated") or 0) for row in results)
    actual_games_rejected = sum(int(row.get("gamesRejected") or 0) for row in results)
    replay_artifacts_count = int(sweep_report.get("replayArtifactsCount") or 0)
    sweep_report["coresTested"] = actual_cores_tested
    sweep_report["gamesCompleted"] = actual_games_completed
    sweep_report["gamesValidated"] = actual_games_validated
    sweep_report["gamesRejected"] = actual_games_rejected
    sweep_report["missingReplayArtifactsCount"] = max(actual_games_completed - replay_artifacts_count, 0)
    sweep_report["replayArtifactsReady"] = replay_artifacts_count >= actual_games_completed and actual_games_completed > 0
    core_rejected_summaries = [
        {
            "coreId": row.get("coreId"),
            "coreLabel": row.get("label"),
            "gamesCompleted": row.get("gamesCompleted"),
            "gamesValidated": row.get("gamesValidated"),
            "gamesRejected": row.get("gamesRejected"),
            "mismatchReason": row.get("mismatchReason"),
            "actualCoreSource": row.get("actualCoreSource"),
        }
        for row in results
        if int(row.get("gamesRejected") or 0) > 0
    ]
    if core_rejected_summaries:
        sweep_report["rejectedCoreSummaries"] = core_rejected_summaries
    sweep_games_requested = int(sweep_report.get("gamesRequested") or 0)
    sweep_games_completed = int(sweep_report.get("gamesCompleted") or 0)
    sweep_report["gamesFailed"] = max(sweep_games_requested - min(sweep_games_completed, actual_games_validated), 0)
    incomplete_reasons = []
    if sweep_games_requested > 0 and actual_cores_tested < len(candidates):
        incomplete_reasons.append("core-sweep-incomplete-cores")
    if sweep_games_requested > 0 and sweep_games_completed < sweep_games_requested:
        incomplete_reasons.append("core-sweep-incomplete-games")
    if sweep_games_requested > 0 and actual_games_validated < sweep_games_requested:
        incomplete_reasons.append("core-sweep-validated-games-incomplete")
    if sweep_games_requested > 0 and sweep_report.get("replayArtifactsReady") is not True:
        incomplete_reasons.append("core-replay-artifacts-not-ready")
    if incomplete_reasons:
        sweep_report["status"] = "incomplete"
        sweep_report["error"] = sweep_report.get("error") or ",".join(incomplete_reasons)
        _log_event(
            "core_sweep_contained_failures_blocking_promotion",
            jobId=job_id,
            profileId=profile.get("profileId"),
            coresSelected=sweep_report.get("coresSelected"),
            coresTested=sweep_report.get("coresTested"),
            gamesRequested=sweep_games_requested,
            gamesCompleted=sweep_games_completed,
            gamesValidated=actual_games_validated,
            gamesRejected=actual_games_rejected,
            replayArtifactsReady=bool(sweep_report.get("replayArtifactsReady")),
            replayArtifactsCount=sweep_report.get("replayArtifactsCount"),
            missingReplayArtifactsCount=sweep_report.get("missingReplayArtifactsCount"),
            rejectedCoreSummaries=core_rejected_summaries[:5],
            status=sweep_report.get("status"),
            error=sweep_report.get("error"),
        )
    if sweep_report.get("status") != "completed":
        raise RuntimeError(
            "Core Sweep final validation failed: "
            f"{sweep_report.get('error') or sweep_report.get('status') or 'incomplete'} "
            f"({sweep_games_completed}/{sweep_games_requested} completed, "
            f"{actual_games_validated}/{sweep_games_requested} validated, "
            f"{actual_games_rejected} rejected, "
            f"{sweep_report.get('replayArtifactsCount')}/{sweep_games_completed} replay artifacts, "
            f"rejected cores: {core_rejected_summaries[:3]})."
        )
    _record_throughput_phase(job_id, "coreSweep", sweep_report.get("runtimeMs"))
    _set_phase_diagnostic_fields(
        job_id,
        "coreSweep",
        phaseWallMs=sweep_report.get("runtimeMs"),
        coresGenerated=sweep_report.get("coresGenerated"),
        coresSelected=sweep_report.get("coresSelected"),
        coresTested=sweep_report.get("coresTested"),
        gamesPerCore=games_per_core,
        totalGames=sweep_report.get("gamesRequested"),
        completedGames=sweep_report.get("gamesCompleted"),
        parallelism=parallelism_cap,
    )
    _set_throughput_core_sweep(
        job_id,
        profileId=profile.get("profileId"),
        coresGenerated=sweep_report.get("coresGenerated"),
        coresSelected=sweep_report.get("coresSelected"),
        finalistLimit=sweep_report.get("finalistLimit"),
        coresTested=sweep_report.get("coresTested"),
        gamesPerCore=games_per_core,
        totalGames=sweep_report.get("gamesRequested"),
        completedGames=sweep_report.get("gamesCompleted"),
        parallelism=parallelism_cap,
        runtimeMs=sweep_report.get("runtimeMs"),
        status=sweep_report.get("status"),
    )
    _log_event(
        "core_sweep_completed",
        jobId=job_id,
        profileId=profile.get("profileId"),
        coresGenerated=sweep_report.get("coresGenerated"),
        coresSelected=sweep_report.get("coresSelected"),
        finalistLimit=sweep_report.get("finalistLimit"),
        coresTested=sweep_report.get("coresTested"),
        gamesRequested=sweep_report.get("gamesRequested"),
        gamesCompleted=sweep_report.get("gamesCompleted"),
        parallelism=parallelism_cap,
        runtimeMs=sweep_report.get("runtimeMs"),
    )
    return sweep_report


def _progress_percent(progress_state: dict) -> int:
    return 5 + int((int(progress_state.get("completed_games") or 0) / max(int(progress_state.get("total_games") or 1), 1)) * 90)


def _progress_total_games(progress_state: dict) -> int:
    return max(
        int(progress_state.get("total_games") or 0),
        int(progress_state.get("completed_games") or 0),
        1,
    )


def _progress_snapshot(progress_state: dict) -> dict:
    return {
        "completed_games": int(progress_state.get("completed_games") or 0),
        "completed_opponents": int(progress_state.get("completed_opponents") or 0),
        "failed_games": int(progress_state.get("failed_games") or 0),
        "launched_games": int(progress_state.get("launched_games") or 0),
        "battle_wins": int(progress_state.get("battle_wins") or 0),
        "battle_losses": int(progress_state.get("battle_losses") or 0),
        "battle_ties": int(progress_state.get("battle_ties") or 0),
        "total_games": _progress_total_games(progress_state),
        "total_opponents": int(progress_state.get("total_opponents") or 0),
    }




def _battle_wave_numbers(battle_number: int, total_games: int) -> tuple:
    cap = max(int(SUITE_PARALLEL_BATTLES or 1), 1)
    safe_battle = max(int(battle_number or 0), 0)
    safe_total = max(int(total_games or 0), safe_battle, 1)
    current_wave = max(((safe_battle - 1) // cap) + 1, 1) if safe_battle > 0 else 1
    total_waves = max(((safe_total - 1) // cap) + 1, 1)
    return current_wave, total_waves

def _run_benchmark_suite_series(job_id: str, opponent_index: int, opponent: dict, user_packed_team: str, games_per_opponent: int, format_id: str, repo_dir: str, timeout_ms: int, progress_state: dict, progress_lock: threading.Lock, current_wave: int = 1, total_waves: int = 1, stop_on_series_decision: bool = True):
    opponent_games = []
    rng = random.Random()
    series_start = time.time()
    opponent_name = opponent.get("name") or opponent.get("id") or f"opponent-{opponent_index}"
    max_games = max(int(games_per_opponent or 1), 1)
    target_wins = _series_target_wins(max_games)
    user_wins = 0
    opponent_wins = 0
    ties = 0
    series_runner = None
    store_battle_log_data = str(os.getenv("BENCHMARK_FULL_REG_STORE_BATTLE_LOG_DATA", "1")).strip().lower() in {"1", "true", "yes", "on"}
    try:
        max_saved_battle_log_bytes = max(int(os.getenv("BENCHMARK_FULL_REG_MAX_SAVED_BATTLE_LOG_BYTES", "750000") or "750000"), 0)
    except Exception:
        max_saved_battle_log_bytes = 750000

    def _stored_battle_result_payload(result_payload: dict) -> dict:
        if not isinstance(result_payload, dict):
            return result_payload
        stored = dict(result_payload)
        battle_log_data = stored.get("battleLogData")
        if isinstance(battle_log_data, str):
            battle_log_bytes = battle_log_data.encode("utf-8", errors="ignore")
            if max_saved_battle_log_bytes > 0 and len(battle_log_bytes) > max_saved_battle_log_bytes:
                stored["battleLogData"] = ""
                stored["archiveBattleLogData"] = ""
                stored["battleLogDataPruned"] = True
                stored["battleLogDataOriginalBytes"] = len(battle_log_bytes)
                stored["battleLogDataPruneReason"] = "max-saved-battle-log-bytes"
                stored["battleLogDataMaxBytes"] = max_saved_battle_log_bytes
            else:
                if not store_battle_log_data:
                    stored["archiveBattleLogData"] = battle_log_data
                    stored["battleLogData"] = ""
                    stored["battleLogDataPruned"] = bool(battle_log_data)
                    stored["battleLogDataOriginalBytes"] = len(battle_log_bytes) if battle_log_data else 0
                    stored["battleLogDataPruneReason"] = "full-report-log-disabled-archive-copy-saved"
        return stored

    if SERIES_BATCH_RUNNER_PREP_ENABLED:
        series_runner = BenchmarkSeriesRunner(
            repo_dir=repo_dir,
            format_id=format_id,
            p1_name="Professor Aegis User",
            p2_name="Benchmark Opponent",
            p1_team=user_packed_team,
            p2_team=opponent.get("packedTeam"),
            metadata={"jobId": job_id, "opponentIndex": opponent_index, "opponentName": opponent_name, "maxGames": max_games},
        )
        _log_event(
            "series_batch_runner_prepared" if SERIES_BATCH_RUNNER_ENABLED else "series_batch_runner_disabled",
            jobId=job_id,
            opponentIndex=opponent_index,
            opponentName=opponent_name,
            runnerMode=_effective_series_runner_mode(),
            maxGames=max_games,
            targetWins=target_wins,
            batchEnabled=bool(SERIES_BATCH_RUNNER_ENABLED),
            reason=None if SERIES_BATCH_RUNNER_ENABLED else SERIES_BATCH_DISABLED_REASON,
            note="True batch mode enabled; falls back safely if Showdown rejects reuse." if SERIES_BATCH_RUNNER_ENABLED else ("True batch mode disabled after instability; using persistent simulator workers." if PERSISTENT_SIM_WORKER_ENABLED else "True batch mode disabled after instability; using safe per-game fallback."),
        )
    _log_event(
        "suite_series_waiting_for_slot",
        jobId=job_id,
        opponentIndex=opponent_index,
        opponentName=opponent_name,
        configuredParallel=SUITE_PARALLEL_BATTLES,
        globalSemaphoreCap=GLOBAL_BATTLE_SEMAPHORE_CAP,
    )

    _log_event("suite_series_started", jobId=job_id, opponentIndex=opponent_index, opponentName=opponent_name, maxGames=max_games, targetWins=target_wins)

    for game_index in range(1, max_games + 1):
        final_result = None
        last_failed_result = None
        attempt = 0
        max_attempts = BATTLE_RETRY_MAX_ATTEMPTS + 1

        while attempt < max_attempts:
            attempt += 1
            retry_number = max(attempt - 1, 0)
            safe_mode_active = _job_safe_mode_active(job_id)

            with progress_lock:
                if attempt == 1:
                    progress_state["launched_games"] = int(progress_state.get("launched_games") or 0) + 1
                else:
                    progress_state["retry_attempts"] = int(progress_state.get("retry_attempts") or 0) + 1
                    progress_state["safe_mode_active"] = True
                current_battle_number = int(progress_state.get("launched_games") or 0)
                snap = _progress_snapshot(progress_state)
                completed_games = snap["completed_games"]
                completed_opponents = snap["completed_opponents"]
                failed_games = snap["failed_games"]
                battle_wins = snap["battle_wins"]
                battle_losses = snap["battle_losses"]
                battle_ties = snap["battle_ties"]
                total_games = snap["total_games"]
                total_opponents = snap["total_opponents"]
                current_battle_wave, total_battle_waves = _battle_wave_numbers(max(completed_games + 1, 1), total_games)

            slot_view = _acquire_shared_worker_slot(job_id, progress_state, progress_lock, phase="mainSimulation")
            display_assigned_workers, display_total_workers, display_safety_cap = _shared_worker_progress_worker_values(slot_view)
            set_job_progress(
                job_id,
                phase="benchmark-suite",
                percent=_progress_percent(progress_state),
                currentStep=f"Running {opponent_name} game {game_index}/{max_games}",
                currentBattleNumber=current_battle_number,
                currentWave=current_battle_wave,
                totalWaves=total_battle_waves,
                currentBattleWave=current_battle_wave,
                totalBattleWaves=total_battle_waves,
                seriesWins=user_wins,
                seriesLosses=opponent_wins,
                seriesTies=ties,
                failedGames=failed_games,
                battleWins=battle_wins,
                battleLosses=battle_losses,
                battleTies=battle_ties,
                recordWins=battle_wins,
                recordLosses=battle_losses,
                recordTies=battle_ties,
                processedOpponents=completed_opponents,
                totalOpponents=total_opponents,
                currentOpponent=opponent_name,
                currentTemplate=opponent.get("templateKey"),
                currentEstimatedWinRate=None,
                processedGames=(battle_wins + battle_losses + battle_ties),
                totalGames=total_games,
                assignedWorkers=display_assigned_workers,
                totalWorkers=display_total_workers,
                safetyWorkerCap=display_safety_cap,
                cpuState=slot_view.get("cpuState"),
                workerCapSnapshot=slot_view.get("workerCapSnapshot"),
                safeModeActive=safe_mode_active or retry_number > 0,
                waitingForWorkers=False,
                queueSpot=0,
            )

            stagger_view = _persistent_first_attempt_stagger_view(retry_number)
            stagger_result = _apply_battle_start_stagger(job_id, opponent_index, opponent_name, game_index, retry_number, stagger_view)
            seed = [rng.randrange(1, 65535) for _ in range(4)]
            battle_start = time.time()
            _log_event(
                "battle_started",
                jobId=job_id,
                opponentIndex=opponent_index,
                opponentName=opponent_name,
                gameNumber=game_index,
                attempt=attempt,
                retryNumber=retry_number,
                maxAttempts=max_attempts,
                maxGames=max_games,
                targetWins=target_wins,
                seriesScore=f"{user_wins}-{opponent_wins}",
                timeoutMs=timeout_ms,
                startStaggerApplied=bool((stagger_result or {}).get("applied")),
                startStaggerBypassed=bool((stagger_result or {}).get("bypassed")),
                startStaggerBypassReason=(stagger_result or {}).get("bypassReason"),
                startStaggerSleepMs=(stagger_result or {}).get("sleepMs"),
                startStaggerBaseMs=(stagger_result or {}).get("baseMs"),
                assignedWorkers=int(slot_view.get("assigned") or 0),
                globalWorkerCap=int(slot_view.get("globalCap") or SHARED_WORKER_POOL_CAP),
                cpuState=slot_view.get("cpuState"),
                safeModeActive=_job_safe_mode_active(job_id),
                **_shared_slot_telemetry(slot_view),
                **_persistent_sim_telemetry_snapshot(job_id),
            )
            _resource_adjust("launchedBattles", 1)
            _resource_adjust("activeBattles", 1)
            try:
                try:
                    if series_runner is not None:
                        result = series_runner.run_game(game_number=game_index, timeout_ms=timeout_ms)
                        seed = result.get("seed") or seed
                    else:
                        result = run_default_policy_battle(
                            repo_dir=repo_dir,
                            format_id=format_id,
                            p1_name="Professor Aegis User",
                            p2_name="Benchmark Opponent",
                            p1_team=user_packed_team,
                            p2_team=opponent.get("packedTeam"),
                            seed=seed,
                            timeout_ms=timeout_ms,
                        )
                finally:
                    _resource_adjust("activeBattles", -1)
                    _release_shared_worker_slot(job_id, phase="mainSimulation")
            except Exception as exc:
                result = _build_failed_battle_result(
                    game_index=game_index,
                    seed=seed,
                    error=exc,
                    timeout_ms=timeout_ms,
                    duration_ms=_elapsed_ms(battle_start),
                    opponent_name=opponent_name,
                )

            result["seed"] = result.get("seed") or seed
            result["gameNumber"] = result.get("gameNumber") or game_index
            result.setdefault("durationMs", _elapsed_ms(battle_start))
            result.setdefault("policyVersion", BATTLE_POLICY_VERSION)
            result["attempt"] = attempt
            result["retryNumber"] = retry_number
            _record_throughput_battle_runtime(job_id, result.get("durationMs"), result, phase="mainSimulation")

            usable = _is_usable_battle_result(result)
            if usable:
                final_result = result
                if retry_number > 0:
                    _log_event(
                        "battle_retry_completed",
                        jobId=job_id,
                        opponentIndex=opponent_index,
                        opponentName=opponent_name,
                        gameNumber=game_index,
                        retryNumber=retry_number,
                        durationMs=result.get("durationMs"),
                        ok=result.get("ok"),
                        winner=result.get("winner"),
                    )
                break

            last_failed_result = result
            _log_event(
                "battle_failed",
                jobId=job_id,
                opponentIndex=opponent_index,
                opponentName=opponent_name,
                gameNumber=game_index,
                attempt=attempt,
                retryNumber=retry_number,
                durationMs=result.get("durationMs"),
                timeoutMs=timeout_ms,
                ok=result.get("ok"),
                failed=result.get("failed"),
                winner=result.get("winner"),
                error=result.get("failureReason") or result.get("error") or result.get("stderr"),
            )
            _resource_adjust("containedFailures", 1)
            heal_result = _maybe_auto_heal_showdown_dist(job_id, result, reason="battle-failure")
            if heal_result is not None:
                result["distAutoHeal"] = {
                    "ok": bool(heal_result.get("ok")),
                    "healed": bool(heal_result.get("healed")),
                    "skipped": bool(heal_result.get("skipped")),
                    "reason": heal_result.get("reason"),
                    "durationMs": heal_result.get("durationMs"),
                }
            with progress_lock:
                progress_state["failed_attempts"] = int(progress_state.get("failed_attempts") or 0) + 1
                progress_state["safe_mode_active"] = True
            next_retry_cap = _retry_worker_cap_for_attempt(attempt)
            if attempt >= max_attempts:
                next_retry_cap = max(1, int(BATTLE_RETRY_FINAL_WORKER_CAP or 1))
            safe_cap = _activate_job_safe_mode(job_id, reason="battle-retry" if attempt < max_attempts else "battle-retry-exhausted", cap=next_retry_cap)
            _log_event(
                "battle_retry_started" if attempt < max_attempts else "battle_retry_exhausted",
                jobId=job_id,
                opponentIndex=opponent_index,
                opponentName=opponent_name,
                gameNumber=game_index,
                attempt=attempt,
                retryNumber=retry_number,
                maxAttempts=max_attempts,
                safeWorkerCap=safe_cap,
                durationMs=result.get("durationMs"),
                timeoutMs=timeout_ms,
                ok=result.get("ok"),
                failed=result.get("failed"),
                winner=result.get("winner"),
                error=result.get("failureReason") or result.get("error") or result.get("stderr"),
            )
            if attempt < max_attempts and BATTLE_RETRY_BACKOFF_SEC > 0:
                time.sleep(BATTLE_RETRY_BACKOFF_SEC)

        if final_result is None:
            with progress_lock:
                progress_state["failed_games"] = int(progress_state.get("failed_games") or 0) + 1
                progress_state["safe_mode_active"] = True
            _activate_job_safe_mode(job_id, reason="battle-retry-exhausted-final", cap=BATTLE_RETRY_FINAL_WORKER_CAP)
            failure_detail = ""
            if isinstance(last_failed_result, dict):
                failure_detail = str(
                    last_failed_result.get("failureReason")
                    or last_failed_result.get("error")
                    or last_failed_result.get("stderr")
                    or ""
                ).strip()
            raise RuntimeError(failure_detail or "Matchup Report could not safely complete. Please try again in a few minutes.")

        result = final_result
        opponent_games.append(_stored_battle_result_payload(result))

        if _is_user_battle_win(result):
            user_wins += 1
        elif _is_opponent_battle_win(result):
            opponent_wins += 1
        elif result.get("ok") and not result.get("failed"):
            ties += 1

        _log_event(
            "battle_completed",
            jobId=job_id,
            opponentIndex=opponent_index,
            opponentName=opponent_name,
            gameNumber=game_index,
            attempt=result.get("attempt"),
            retryNumber=result.get("retryNumber"),
            durationMs=result.get("durationMs"),
            turns=result.get("turns"),
            ok=result.get("ok"),
            winner=result.get("winner"),
            runnerPoolMode=result.get("runnerPoolMode"),
            seriesRunnerMode=result.get("seriesRunnerMode"),
            seriesProcessLaunches=result.get("seriesProcessLaunches"),
            batchGames=result.get("batchGames"),
            batchFallbacks=result.get("batchFallbacks"),
            batchFailReason=result.get("batchFailReason"),
            batchFallbackReason=result.get("batchFallbackReason"),
            warmRunnerPool=result.get("warmRunnerPool"),
            seriesScore=f"{user_wins}-{opponent_wins}",
        )

        with progress_lock:
            progress_state["completed_games"] += 1
            if _is_user_battle_win(result):
                progress_state["battle_wins"] = int(progress_state.get("battle_wins") or 0) + 1
                _resource_adjust("scoredBattles", 1)
            elif _is_opponent_battle_win(result):
                progress_state["battle_losses"] = int(progress_state.get("battle_losses") or 0) + 1
                _resource_adjust("scoredBattles", 1)
            elif result.get("ok"):
                progress_state["battle_ties"] = int(progress_state.get("battle_ties") or 0) + 1
                _resource_adjust("scoredBattles", 1)
            snap = _progress_snapshot(progress_state)
            completed_games = snap["completed_games"]
            completed_opponents = snap["completed_opponents"]
            failed_games = snap["failed_games"]
            battle_wins = snap["battle_wins"]
            battle_losses = snap["battle_losses"]
            battle_ties = snap["battle_ties"]
            total_games = snap["total_games"]
            total_opponents = snap["total_opponents"]
            current_battle_wave, total_battle_waves = _battle_wave_numbers(completed_games, total_games)
            safe_mode_active = bool(progress_state.get("safe_mode_active"))

        safe_mode_recovery = _recover_job_safe_mode_after_progress(job_id, reason="battle-completed")
        worker_view = _shared_worker_snapshot(job_id)
        display_assigned_workers, display_total_workers, display_safety_cap = _shared_worker_progress_worker_values(worker_view)
        set_job_progress(
            job_id,
            phase="benchmark-suite",
            percent=_progress_percent(progress_state),
            currentStep=f"Completed {opponent_name} game {game_index}/{max_games}",
            currentBattleNumber=completed_games,
            currentWave=current_battle_wave,
            totalWaves=total_battle_waves,
            currentBattleWave=current_battle_wave,
            totalBattleWaves=total_battle_waves,
            seriesWins=user_wins,
            seriesLosses=opponent_wins,
            seriesTies=ties,
            failedGames=failed_games,
            battleWins=battle_wins,
            battleLosses=battle_losses,
            battleTies=battle_ties,
            recordWins=battle_wins,
            recordLosses=battle_losses,
            recordTies=battle_ties,
            processedOpponents=completed_opponents,
            totalOpponents=total_opponents,
            currentOpponent=opponent_name,
            currentTemplate=opponent.get("templateKey"),
            currentEstimatedWinRate=None,
            processedGames=(battle_wins + battle_losses + battle_ties),
            totalGames=total_games,
            assignedWorkers=display_assigned_workers,
            totalWorkers=display_total_workers,
            safetyWorkerCap=display_safety_cap,
            cpuState=worker_view.get("cpuState"),
            workerCapSnapshot=worker_view.get("workerCapSnapshot"),
            safeModeActive=safe_mode_active,
            safeModeRecovered=bool(safe_mode_recovery.get("recovered")) if isinstance(safe_mode_recovery, dict) else False,
            waitingForWorkers=False,
            queueSpot=0,
        )

        if stop_on_series_decision and (user_wins >= target_wins or opponent_wins >= target_wins):
            skipped_games = max_games - game_index
            if skipped_games > 0:
                with progress_lock:
                    progress_state["total_games"] = max(
                        int(progress_state.get("completed_games") or 0),
                        int(progress_state.get("total_games") or 0) - skipped_games,
                    )
                    snap = _progress_snapshot(progress_state)
                    completed_games = snap["completed_games"]
                    completed_opponents = snap["completed_opponents"]
                    failed_games = snap["failed_games"]
                    battle_wins = snap["battle_wins"]
                    battle_losses = snap["battle_losses"]
                    battle_ties = snap["battle_ties"]
                    total_games = snap["total_games"]
                    total_opponents = snap["total_opponents"]
                    current_battle_wave, total_battle_waves = _battle_wave_numbers(completed_games, total_games)
                    safe_mode_active = bool(progress_state.get("safe_mode_active"))
                _log_event(
                    "suite_series_decided_early",
                    jobId=job_id,
                    opponentIndex=opponent_index,
                    opponentName=opponent_name,
                    decidedAfterGames=game_index,
                    skippedGames=skipped_games,
                    seriesScore=f"{user_wins}-{opponent_wins}-{ties}",
                    targetWins=target_wins,
                )
                set_job_progress(
                    job_id,
                    phase="benchmark-suite",
                    percent=_progress_percent(progress_state),
                    currentStep=f"Series decided early: {opponent_name} {user_wins}W - {opponent_wins}L - {ties}T",
                    currentBattleNumber=completed_games,
                    currentWave=current_battle_wave,
                    totalWaves=total_battle_waves,
                    currentBattleWave=current_battle_wave,
                    totalBattleWaves=total_battle_waves,
                    seriesWins=user_wins,
                    seriesLosses=opponent_wins,
                    seriesTies=ties,
                    failedGames=failed_games,
                    battleWins=battle_wins,
                    battleLosses=battle_losses,
                    battleTies=battle_ties,
                    recordWins=battle_wins,
                    recordLosses=battle_losses,
                    recordTies=battle_ties,
                    processedOpponents=completed_opponents,
                    totalOpponents=total_opponents,
                    currentOpponent=opponent_name,
                    currentTemplate=opponent.get("templateKey"),
                    currentEstimatedWinRate=None,
                    processedGames=(battle_wins + battle_losses + battle_ties),
                    totalGames=total_games,
                    safeModeActive=safe_mode_active,
                )
            break

    series_runner_snapshot = series_runner.snapshot() if series_runner is not None else None
    if series_runner is not None:
        try:
            series_runner.close()
        except Exception as exc:
            _log_event("series_batch_runner_close_warning", jobId=job_id, opponentIndex=opponent_index, opponentName=opponent_name, error=str(exc)[:500])
    _log_event("suite_series_completed", jobId=job_id, opponentIndex=opponent_index, opponentName=opponent_name, durationMs=_elapsed_ms(series_start), games=len(opponent_games), maxGames=max_games, seriesScore=f"{user_wins}-{opponent_wins}-{ties}", seriesRunner=series_runner_snapshot)
    return {
        "opponentIndex": opponent_index,
        "opponent": opponent,
        "games": opponent_games,
        "failed": False,
        "failureContained": False,
        "seriesWins": user_wins,
        "seriesLosses": opponent_wins,
        "seriesTies": ties,
        "seriesRunner": series_runner_snapshot,
    }

def _prepare_and_run_benchmark_suite_job(job_id: str, team_export: str, mode: str, sample_size, sample_seed, games_per_opponent: int, format_id: str, battle_budget=None):
    time.sleep(0.05)
    if not _mark_job_running(job_id):
        return

    set_job_progress(
        job_id,
        phase="preparing-suite",
        percent=1,
        currentStep="Preparing benchmark suite request",
        processedOpponents=0,
        totalOpponents=0,
        processedGames=0,
        totalGames=0,
        assignedWorkers=0,
        totalWorkers=SHARED_WORKER_POOL_CAP,
        queueSpot=0,
        waitingForWorkers=False,
    )

    try:
        ready, readiness = _require_benchmark_ready()
        if not ready:
            _fail_job(job_id, "BenchMark execution path is not ready yet.")
            return

        simulator_team_export = _simulator_team_export_for_format(team_export, format_id)
        set_job_progress(job_id, phase="validating-team", percent=2, currentStep="Validating submitted team")
        validation_started = time.time()
        validation = validate_team_export(simulator_team_export, format_id)
        validation_ms = _elapsed_ms(validation_started)
        _record_throughput_phase(job_id, "validation", validation_ms)
        _log_event(
            "submitted_team_validation_completed",
            jobId=job_id,
            valid=bool(validation.get("valid")),
            durationMs=validation_ms,
            method=validation.get("command"),
        )
        if not validation.get("valid"):
            _fail_job(job_id, "Team did not validate for the requested format.")
            return

        set_job_progress(job_id, phase="packing-team", percent=3, currentStep="Packing submitted team for simulation")
        packing_started = time.time()
        packing = pack_team_export(simulator_team_export)
        packing_ms = _elapsed_ms(packing_started)
        _record_throughput_phase(job_id, "packUser", packing_ms)
        _log_event(
            "submitted_team_packing_completed",
            jobId=job_id,
            ok=bool(packing.get("ok")),
            durationMs=packing_ms,
            method=packing.get("method"),
            attempts=len(packing.get("attempts") or []),
            libraryAttempts=len(packing.get("libraryAttempts") or []),
        )
        if not packing.get("ok") or not packing.get("packedTeam"):
            _fail_job(job_id, "Team could not be packed into Showdown format.")
            return

        set_job_progress(job_id, phase="selecting-opponents", percent=4, currentStep="Selecting benchmark opponents")
        selection_started = time.time()
        mode_selection = resolve_benchmark_mode_selection(
            format_id=format_id,
            mode=mode,
            sample_size=sample_size,
            sample_seed=sample_seed,
        )
        is_full_reg_sweep = bool(mode_selection.get("sweepMode") or str(mode_selection.get("mode") or "").strip().lower() in {"full-reg", "all-meta-all-tournament"})
        is_lazy_hydration = bool(mode_selection.get("lazyHydration"))
        if is_full_reg_sweep:
            _log_event(
                "all_meta_sweep_selection_completed",
                jobId=job_id,
                formatId=format_id,
                totalRegulationOpponents=mode_selection.get("totalRegulationOpponents"),
                sampleSizeIgnored=bool(mode_selection.get("sampleSizeIgnored")),
                excludesUserTeams=bool(mode_selection.get("excludesUserTeams")),
                hydrationChunkSize=mode_selection.get("hydrationChunkSize"),
                durationMs=_elapsed_ms(selection_started),
            )
        if is_lazy_hydration:
            selected_opponents = [dict(record) for record in (mode_selection.get("selectedOpponentRecords") or [])]
            _log_event(
                "championlab_mode_records_selected",
                jobId=job_id,
                formatId=format_id,
                mode=mode_selection.get("mode"),
                sweepMode=bool(is_full_reg_sweep),
                recordCount=len(selected_opponents),
                lazyHydration=True,
                hydrationDeferredToBatch=True,
                sampleSizeIgnored=bool(mode_selection.get("sampleSizeIgnored")),
                excludesUserTeams=bool(mode_selection.get("excludesUserTeams")),
                durationMs=_elapsed_ms(selection_started),
            )
        else:
            selected_opponents = [
                opponent for opponent in (mode_selection.get("selectedOpponents") or [])
                if opponent.get("validForFormat") and opponent.get("packedTeamAvailable") and opponent.get("packedTeam")
            ]
        selection_ms = _elapsed_ms(selection_started)
        _record_throughput_phase(job_id, "selectOpponents", selection_ms)
        _log_event(
            "opponent_selection_completed",
            jobId=job_id,
            mode=mode_selection.get("mode"),
            sweepMode=bool(is_full_reg_sweep),
            sweepModeLabel=mode_selection.get("sweepModeLabel"),
            requestedSampleSize=mode_selection.get("requestedSampleSize"),
            sampleSizeIgnored=bool(mode_selection.get("sampleSizeIgnored")),
            availableOpponents=mode_selection.get("availableOpponents"),
            totalRegulationOpponents=mode_selection.get("totalRegulationOpponents"),
            excludesUserTeams=bool(mode_selection.get("excludesUserTeams")),
            selectedOpponents=len(selected_opponents),
            lazyHydration=bool(mode_selection.get("lazyHydration")) if isinstance(mode_selection, dict) else False,
            selectedOpponentRecords=len(mode_selection.get("selectedOpponentRecords") or []) if isinstance(mode_selection, dict) else 0,
            durationMs=selection_ms,
        )

        if not selected_opponents:
            _fail_job(job_id, "No benchmark opponents were ready for the requested mode.")
            return

        mode_selection = dict(mode_selection)
        selected_count = len(selected_opponents)
        champion_battle_budget = _normalize_battle_budget(battle_budget) if _is_champions_format(format_id) else None
        allocated_games_per_opponent = (
            _allocated_games_per_opponent(selected_count, champion_battle_budget)
            if champion_battle_budget is not None
            else max(int(games_per_opponent or 1), 1)
        )
        expected_total_games = (
            _expected_total_games(selected_count, champion_battle_budget)
            if champion_battle_budget is not None
            else selected_count * allocated_games_per_opponent
        )
        mode_selection["selectedCount"] = selected_count
        mode_selection["gamesPerOpponent"] = allocated_games_per_opponent
        _set_throughput_fields(
            job_id,
            selectedOpponentCount=selected_count,
            expectedGames=expected_total_games,
            selectedMode=mode_selection.get("mode"),
            sweepMode=bool(is_full_reg_sweep),
            lazyHydration=bool(is_lazy_hydration),
        )
        if champion_battle_budget is not None:
            mode_selection["battleBudget"] = champion_battle_budget
            mode_selection["battlesPerMatchup"] = champion_battle_budget
            mode_selection["battleBudgetAllocationRule"] = "championslab-min-one-per-opponent-floor-budget"
            mode_selection["allocatedGamesPerOpponent"] = allocated_games_per_opponent
            mode_selection["expectedTotalGames"] = expected_total_games
            mode_selection["seriesLength"] = "BO1"
            mode_selection["boStyle"] = "BO1"
            mode_selection["earlySeriesCutoff"] = False
        set_job_progress(
            job_id,
            phase="benchmark-suite",
            percent=5,
            currentStep=(
                f"Queued All Meta + All Tournament sweep: {len(selected_opponents)} tournament opponents"
                if is_full_reg_sweep else (
                    f"Queued ChampionLab opponent records: {len(selected_opponents)} opponent series"
                    if is_lazy_hydration else f"Queued {len(selected_opponents)} opponent series"
                )
            ),
            processedOpponents=0,
            totalOpponents=len(selected_opponents),
            remainingOpponents=len(selected_opponents),
            failedOpponents=0,
            processedGames=0,
            totalGames=expected_total_games,
            battleBudget=champion_battle_budget,
            battlesPerMatchup=champion_battle_budget,
            allocatedGamesPerOpponent=allocated_games_per_opponent,
            expectedTotalGames=expected_total_games,
            sweepMode=bool(is_full_reg_sweep),
            sweepModeLabel=mode_selection.get("sweepModeLabel"),
            totalRegulationOpponents=mode_selection.get("totalRegulationOpponents"),
            sampleSizeIgnored=bool(mode_selection.get("sampleSizeIgnored")),
            excludesUserTeams=bool(mode_selection.get("excludesUserTeams")),
        )

        _run_benchmark_suite_job(
            job_id,
            packing.get("packedTeam"),
            selected_opponents,
            allocated_games_per_opponent,
            format_id,
            validation,
            mode_selection,
            user_team_export=team_export,
            assume_running=True,
        )
    except Exception as exc:
        _fail_job(job_id, str(exc) or "BenchMark Python worker failed while preparing the benchmark suite.")


def _run_benchmark_suite_job(job_id: str, user_packed_team: str, selected_opponents: list, games_per_opponent: int, format_id: str, validation_result: dict, mode_selection: dict, user_team_export: str = "", assume_running: bool = False):
    time.sleep(0.05)
    if not assume_running and not _mark_job_running(job_id):
        return

    _start_resource_monitor()
    _resource_adjust("activeSuiteJobs", 1)

    showdown_status = get_showdown_status()
    repo_dir = showdown_status.get("repoDir")
    if not repo_dir:
        _fail_job(job_id, "Showdown repoDir is not configured, so benchmark suite cannot run.")
        _resource_adjust("activeSuiteJobs", -1)
        return

    if PERSISTENT_SIM_WORKER_ENABLED and PERSISTENT_SIM_WORKER_PREWARM_ENABLED and PERSISTENT_SIM_WORKER_PREWARM_SIZE > 0:
        prewarm_timer = time.time()
        try:
            prewarm_snapshot = prewarm_persistent_sim_worker_pool(
                repo_dir=repo_dir,
                target_ready=min(PERSISTENT_SIM_WORKER_PREWARM_SIZE, PERSISTENT_SIM_WORKER_POOL_SIZE),
                timeout_ms=PERSISTENT_SIM_WORKER_PREWARM_TIMEOUT_MS,
                reason="suite-prereq-overlap",
            )
            _log_event(
                "persistent_sim_worker_prewarm_requested",
                jobId=job_id,
                targetReady=prewarm_snapshot.get("prewarmTargetReady"),
                started=prewarm_snapshot.get("prewarmStarted"),
                ready=prewarm_snapshot.get("ready"),
                spawning=prewarm_snapshot.get("spawning"),
                timeoutMs=prewarm_snapshot.get("prewarmTimeoutMs"),
                pool=prewarm_snapshot,
            )
        except Exception as exc:
            _log_event("persistent_sim_worker_prewarm_failed", jobId=job_id, error=str(exc))
        finally:
            _record_throughput_phase(job_id, "prewarm", _elapsed_ms(prewarm_timer))

    if SHOWDOWN_INTEGRITY_CHECK_ENABLED:
        integrity_timer = time.time()
        custom_formats, integrity, used_integrity_cache = _cached_showdown_prereq_checks(job_id=job_id, repo_dir=repo_dir, format_id=format_id)
        _record_throughput_phase(job_id, "integrity", _elapsed_ms(integrity_timer))
        if not custom_formats.get("ok"):
            _fail_job(job_id, "Matchup Report could not start because the local battle format config is not ready. Check PM2 logs for the custom formats repair details.")
            _resource_adjust("activeSuiteJobs", -1)
            return

        if not integrity.get("ok"):
            integrity_detail = str(integrity.get("detail") or "")
            if is_showdown_dist_corruption_error(integrity_detail):
                _activate_job_safe_mode(job_id, reason="showdown-dist-integrity-auto-heal", cap=1)
                _log_event(
                    "showdown_dist_integrity_auto_heal_requested",
                    jobId=job_id,
                    reason=integrity.get("reason"),
                    detail=integrity_detail[:1500],
                )
                try:
                    retire_snapshot = {"warmRunnerPool": retire_warm_runner_pool(reason="showdown-dist-integrity-auto-heal"), "persistentSimWorkerPool": retire_persistent_sim_worker_pool(reason="showdown-dist-integrity-auto-heal")}
                except Exception as exc:
                    retire_snapshot = {"error": str(exc)}
                heal = auto_heal_showdown_dist(reason="integrity-check", detail=integrity_detail)
                _log_event(
                    "showdown_dist_integrity_auto_heal_completed",
                    jobId=job_id,
                    ok=bool(heal.get("ok")),
                    healed=bool(heal.get("healed")),
                    skipped=bool(heal.get("skipped")),
                    reason=heal.get("reason"),
                    durationMs=heal.get("durationMs"),
                    retireWarmRunnerPool=retire_snapshot,
                )
                if heal.get("ok"):
                    integrity = validate_showdown_integrity(timeout_ms=SHOWDOWN_INTEGRITY_TIMEOUT_MS)
                    _log_event(
                        "showdown_integrity_rechecked_after_auto_heal",
                        jobId=job_id,
                        ok=bool(integrity.get("ok")),
                        reason=integrity.get("reason"),
                        durationMs=integrity.get("durationMs"),
                        detail=(str(integrity.get("detail") or "")[:500]),
                        warnings=integrity.get("warnings"),
                    )
                    if integrity.get("ok"):
                        with _integrity_cache_lock:
                            _integrity_cache.update({
                                "checkedAt": time.time(),
                                "repoDir": str(repo_dir or ""),
                                "formatId": str(format_id or ""),
                                "customFormats": dict(custom_formats),
                                "integrity": dict(integrity),
                            })
            # Keep the dist guard diagnostic warning-only. The retry/safe-mode layer
            # contains bad Showdown child-process failures without blocking users.
            _log_event(
                "showdown_dist_guard_warning_only",
                jobId=job_id,
                reason=integrity.get("reason"),
                detail=(str(integrity.get("detail") or "")[:2000]),
                checks=integrity.get("checks"),
                userBlocked=False,
                continued=True,
                usedIntegrityCache=bool(used_integrity_cache),
            )

    try:
        warm_snapshot = configure_warm_runner_pool(repo_dir=repo_dir, enabled=(WARM_RUNNER_POOL_ENABLED and not PERSISTENT_SIM_WORKER_ENABLED), target_size=(0 if PERSISTENT_SIM_WORKER_ENABLED else WARM_RUNNER_POOL_SIZE))
        _log_event(
            "warm_runner_pool_configured",
            jobId=job_id,
            enabled=warm_snapshot.get("enabled"),
            targetSize=warm_snapshot.get("targetSize"),
            ready=warm_snapshot.get("ready"),
            spawning=warm_snapshot.get("spawning"),
            runnerVersion=BATTLE_RUNNER_VERSION,
        )
        persistent_snapshot = configure_persistent_sim_worker_pool(repo_dir=repo_dir, enabled=PERSISTENT_SIM_WORKER_ENABLED, target_size=PERSISTENT_SIM_WORKER_POOL_SIZE)
        _log_event(
            "persistent_sim_worker_pool_configured",
            jobId=job_id,
            enabled=persistent_snapshot.get("enabled"),
            targetSize=persistent_snapshot.get("targetSize"),
            ready=persistent_snapshot.get("ready"),
            runnerVersion=BATTLE_RUNNER_VERSION,
            pool=persistent_snapshot,
        )
        _record_throughput_persistent_worker(job_id)
    except Exception as exc:
        _log_event("warm_runner_pool_configure_failed", jobId=job_id, error=str(exc))

    is_full_reg_sweep = bool(isinstance(mode_selection, dict) and (mode_selection.get("sweepMode") or str(mode_selection.get("mode") or "").strip().lower() in {"full-reg", "all-meta-all-tournament"}))
    is_lazy_hydration = bool(isinstance(mode_selection, dict) and mode_selection.get("lazyHydration"))
    if is_full_reg_sweep:
        full_reg_cap = max(1, min(int(FULL_REG_SHARED_WORKER_CAP or 4), SHARED_WORKER_POOL_CAP, GLOBAL_BATTLE_SEMAPHORE_CAP))
        _activate_job_safe_mode(job_id, reason="full-regulation-drain-stability-cap", cap=full_reg_cap)
        _log_event(
            "full_regulation_worker_cap_applied",
            jobId=job_id,
            fullRegSharedWorkerCap=full_reg_cap,
            configuredSharedCap=SHARED_WORKER_POOL_CAP,
            configuredGlobalCap=GLOBAL_BATTLE_SEMAPHORE_CAP,
            endgameDrainSec=FULL_REG_ENDGAME_DRAIN_SEC,
            endgamePendingThreshold=FULL_REG_ENDGAME_PENDING_THRESHOLD,
        )
    effective_suite_batch_size = min(SUITE_PARALLEL_BATTLES, FULL_REG_SWEEP_BATCH_SIZE, FULL_REG_SHARED_WORKER_CAP) if is_full_reg_sweep else SUITE_PARALLEL_BATTLES
    effective_suite_batch_size = max(int(effective_suite_batch_size or 1), 1)
    total_opponents = len(selected_opponents)
    total_games = total_opponents * max(int(games_per_opponent or 1), 1)
    stop_on_series_decision = not bool(isinstance(mode_selection, dict) and mode_selection.get("battleBudget"))
    lazy_hydration_chunk_size = effective_suite_batch_size
    if is_lazy_hydration and isinstance(mode_selection, dict):
        try:
            lazy_hydration_chunk_size = max(int(mode_selection.get("hydrationChunkSize") or effective_suite_batch_size), effective_suite_batch_size)
        except Exception:
            lazy_hydration_chunk_size = effective_suite_batch_size
    scheduler_batch_size = effective_suite_batch_size
    if is_lazy_hydration:
        scheduler_batch_size = max(
            int(lazy_hydration_chunk_size or effective_suite_batch_size or 1),
            effective_suite_batch_size * 2,
        )
    scheduler_batch_size = max(int(scheduler_batch_size or 1), 1)
    rolling_scheduler_enabled = bool(is_full_reg_sweep)
    if rolling_scheduler_enabled:
        scheduler_batch_size = max(total_opponents, 1)
    _set_throughput_fields(
        job_id,
        selectedOpponentCount=total_opponents,
        expectedGames=total_games,
        effectiveBatchSize=effective_suite_batch_size,
        schedulerBatchSize=scheduler_batch_size,
        hydrationChunkSize=lazy_hydration_chunk_size if is_lazy_hydration else None,
        gamesPerOpponent=max(int(games_per_opponent or 1), 1),
        rollingSchedulerEnabled=rolling_scheduler_enabled,
        rollingSchedulerModel="bounded-pending-top-up" if rolling_scheduler_enabled else None,
        rollingActiveWindowTarget=effective_suite_batch_size if rolling_scheduler_enabled else None,
        rollingBarrierCount=0 if rolling_scheduler_enabled else None,
        rollingQueuedSeries=0 if rolling_scheduler_enabled else None,
        rollingExecutorQueueTopUp=False if rolling_scheduler_enabled else None,
        rollingBoundedPendingMax=0 if rolling_scheduler_enabled else None,
        rollingSubmittedSeries=0 if rolling_scheduler_enabled else None,
        rollingTopUpSubmissions=0 if rolling_scheduler_enabled else None,
    )
    main_phase_wall_ms_total = 0
    main_phase_launched_series_total = 0
    main_phase_completed_series_total = 0
    results = [None] * total_opponents
    progress_lock = threading.Lock()
    progress_state = {
        "completed_games": 0,
        "completed_opponents": 0,
        "failed_games": 0,
        "failed_attempts": 0,
        "launched_games": 0,
        "retry_attempts": 0,
        "safe_mode_active": False,
        "battle_wins": 0,
        "battle_losses": 0,
        "battle_ties": 0,
        "total_games": total_games,
        "total_opponents": total_opponents,
    }

    def _full_reg_launch_pacing_view():
        if not is_full_reg_sweep:
            return {"delayMs": 0}
        enabled = str(os.getenv("BENCHMARK_FULL_REG_CPU_LAUNCH_PACING_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
        if not enabled:
            return {"delayMs": 0, "enabled": False}

        def _delay_ms(env_name: str, default_ms: int) -> int:
            try:
                return max(int(os.getenv(env_name, str(default_ms)) or str(default_ms)), 0)
            except Exception:
                return max(int(default_ms or 0), 0)

        try:
            _, cpu_percent, cpu_state, cpu_cooldown = _shared_worker_cpu_cap()
        except Exception:
            return {"delayMs": 0, "enabled": True, "cpuState": "unknown"}

        state = str(cpu_state or "unknown").strip().lower()
        cpu_cooldown = cpu_cooldown if isinstance(cpu_cooldown, dict) else {}
        delay_ms = 0
        if state == "high":
            delay_ms = max(delay_ms, _delay_ms("BENCHMARK_FULL_REG_CPU_HIGH_LAUNCH_DELAY_MS", 350))
        elif state == "critical":
            delay_ms = max(delay_ms, _delay_ms("BENCHMARK_FULL_REG_CPU_CRITICAL_LAUNCH_DELAY_MS", 900))
        elif state == "cpu-cooldown":
            delay_ms = max(delay_ms, _delay_ms("BENCHMARK_FULL_REG_CPU_COOLDOWN_LAUNCH_DELAY_MS", 500))

        if bool(cpu_cooldown.get("active")):
            delay_ms = max(delay_ms, _delay_ms("BENCHMARK_FULL_REG_CPU_COOLDOWN_LAUNCH_DELAY_MS", 500))

        return {
            "delayMs": delay_ms,
            "enabled": True,
            "cpuPercent": cpu_percent,
            "cpuState": state,
            "cpuCooldownActive": bool(cpu_cooldown.get("active")),
            "cpuCooldownRemainingMs": cpu_cooldown.get("remainingMs"),
            "cpuRampCalmActive": bool(cpu_cooldown.get("rampCalmActive")),
            "cpuRampCalmRemainingMs": cpu_cooldown.get("rampCalmRemainingMs"),
        }

    def _full_reg_launch_bridge_floor(batch_size_value: int) -> int:
        if not is_full_reg_sweep:
            return 0
        try:
            configured_floor = int(os.getenv("BENCHMARK_FULL_REG_LAUNCH_BRIDGE_FLOOR", "5") or "5")
        except Exception:
            configured_floor = 5
        try:
            _, _, cpu_state, _ = _shared_worker_cpu_cap()
        except Exception:
            cpu_state = "unknown"
        state = str(cpu_state or "unknown").strip().lower()
        batch_size_int = max(int(batch_size_value or 0), 0)
        if state in {"healthy", "warm", "unknown", "medium", "ramp-calm-wait"}:
            return batch_size_int
        if state in {"high", "critical", "cpu-cooldown"}:
            return 0
        return max(min(configured_floor, batch_size_int), 0)

    timeout_ms = int(showdown_status.get("battleTimeoutMs") or 30000)
    _log_event(
        "suite_job_ready",
        jobId=job_id,
        totalOpponents=total_opponents,
        totalGames=total_games,
        gamesPerOpponent=games_per_opponent,
        battleBudget=mode_selection.get("battleBudget") if isinstance(mode_selection, dict) else None,
        battlesPerMatchup=mode_selection.get("battlesPerMatchup") if isinstance(mode_selection, dict) else None,
        allocatedGamesPerOpponent=mode_selection.get("allocatedGamesPerOpponent") if isinstance(mode_selection, dict) else None,
        expectedTotalGames=mode_selection.get("expectedTotalGames") if isinstance(mode_selection, dict) else None,
        stopOnSeriesDecision=stop_on_series_decision,
        configuredParallel=SUITE_PARALLEL_BATTLES,
        globalSemaphoreCap=GLOBAL_BATTLE_SEMAPHORE_CAP,
        sharedWorkerPoolEnabled=SHARED_WORKER_POOL_ENABLED,
        sharedWorkerPoolCap=SHARED_WORKER_POOL_CAP,
        timeoutMs=timeout_ms,
        formatId=format_id,
        mode=mode_selection.get("mode") if isinstance(mode_selection, dict) else None,
        sweepMode=bool(is_full_reg_sweep),
        sweepModeLabel=mode_selection.get("sweepModeLabel") if isinstance(mode_selection, dict) else None,
        sampleSizeIgnored=bool(mode_selection.get("sampleSizeIgnored")) if isinstance(mode_selection, dict) else False,
        totalRegulationOpponents=mode_selection.get("totalRegulationOpponents") if isinstance(mode_selection, dict) else None,
        excludesUserTeams=bool(mode_selection.get("excludesUserTeams")) if isinstance(mode_selection, dict) else False,
        effectiveSuiteBatchSize=effective_suite_batch_size,
        lazyHydration=bool(mode_selection.get("lazyHydration")) if isinstance(mode_selection, dict) else False,
        showdownReady=showdown_status.get("fullyReady"),
        **_persistent_sim_telemetry_snapshot(job_id, include_pool=True),
    )

    lazy_hydrated_records = {}
    lazy_hydration_prefetch_count = 0

    def _prefetch_lazy_hydration(batch_start_index: int, batch_end_index: int, requested_batch_size: int, current_wave_number: int, total_wave_count: int) -> int:
        nonlocal lazy_hydration_prefetch_count
        if not is_lazy_hydration:
            return 0
        chunk_size = max(int(lazy_hydration_chunk_size or requested_batch_size or 1), 1)
        prefetch_start = (int(batch_start_index or 0) // chunk_size) * chunk_size
        prefetch_end = min(prefetch_start + chunk_size, total_opponents)
        missing_indices = [idx for idx in range(prefetch_start, prefetch_end) if idx not in lazy_hydrated_records]
        if not missing_indices:
            return 0

        hydrate_timer = time.time()
        worker_view = _shared_worker_snapshot(job_id)
        set_job_progress(
            job_id,
            phase=("hydrating-all-meta-batch" if is_full_reg_sweep else "hydrating-championlab-batch"),
            percent=_progress_percent(progress_state),
            currentStep=(
                f"Preparing All Meta + All Tournament chunk {current_wave_number}/{total_wave_count}: opponents {batch_start_index + 1}-{batch_end_index}"
                if is_full_reg_sweep else
                f"Preparing ChampionLab opponent chunk {current_wave_number}/{total_wave_count}: opponents {batch_start_index + 1}-{batch_end_index}"
            ),
            processedOpponents=progress_state["completed_opponents"],
            totalOpponents=total_opponents,
            remainingOpponents=max(total_opponents - batch_start_index, 0),
            processedGames=(int(progress_state.get("battle_wins") or 0) + int(progress_state.get("battle_losses") or 0) + int(progress_state.get("battle_ties") or 0)),
            totalGames=total_games,
            sweepMode=True,
            sweepModeLabel=mode_selection.get("sweepModeLabel"),
            lazyHydration=True,
            opponentPreparationActive=True,
            opponentPreparationLabel=("All Meta + All Tournament" if is_full_reg_sweep else "ChampionLab opponents"),
            opponentPreparationPrepared=progress_state["completed_opponents"],
            opponentPreparationTotal=total_opponents,
            battleWorkersReady=True,
            assignedWorkers=None,
            totalWorkers=None,
            waitingForWorkers=False,
            workerCapSnapshot=worker_view.get("workerCapSnapshot"),
        )
        _log_event(
            "championlab_batch_hydration_started",
            jobId=job_id,
            mode=mode_selection.get("mode") if isinstance(mode_selection, dict) else None,
            sweepMode=bool(is_full_reg_sweep),
            batchStart=batch_start_index + 1,
            batchEnd=batch_end_index,
            batchSize=requested_batch_size,
            currentWave=current_wave_number,
            totalWaves=total_wave_count,
            remainingOpponents=max(total_opponents - batch_start_index, 0),
            prefetchStart=prefetch_start + 1,
            prefetchEnd=prefetch_end,
            prefetchChunkSize=chunk_size,
            prefetchMissingRecords=len(missing_indices),
        )
        hydrated = hydrate_repo_opponent_records([selected_opponents[idx] for idx in missing_indices], format_id)
        for offset, original_index in enumerate(missing_indices):
            lazy_hydrated_records[original_index] = hydrated[offset] if offset < len(hydrated) else None
        lazy_hydration_prefetch_count += 1
        hydrate_ms = _elapsed_ms(hydrate_timer)
        _record_throughput_phase(job_id, "hydrateTotal", hydrate_ms, aggregate=True)
        unready_opponents = [
            (idx, lazy_hydrated_records.get(idx) or selected_opponents[idx])
            for idx in range(prefetch_start, prefetch_end)
            if not (
                (lazy_hydrated_records.get(idx) or {}).get("validForFormat")
                and (lazy_hydrated_records.get(idx) or {}).get("packedTeamAvailable")
                and (lazy_hydrated_records.get(idx) or {}).get("packedTeam")
            )
        ]
        ready_opponents = sum(
            1
            for idx in range(prefetch_start, prefetch_end)
            if (lazy_hydrated_records.get(idx) or {}).get("validForFormat")
            and (lazy_hydrated_records.get(idx) or {}).get("packedTeamAvailable")
            and (lazy_hydrated_records.get(idx) or {}).get("packedTeam")
        )
        _log_event(
            "championlab_batch_hydration_completed",
            jobId=job_id,
            mode=mode_selection.get("mode") if isinstance(mode_selection, dict) else None,
            sweepMode=bool(is_full_reg_sweep),
            batchStart=batch_start_index + 1,
            batchEnd=batch_end_index,
            requestedRecords=len(missing_indices),
            readyOpponents=ready_opponents,
            durationMs=hydrate_ms,
            warning=bool(FULL_REG_SWEEP_HYDRATION_WARN_THRESHOLD_MS and hydrate_ms > FULL_REG_SWEEP_HYDRATION_WARN_THRESHOLD_MS),
            prefetchStart=prefetch_start + 1,
            prefetchEnd=prefetch_end,
            prefetchChunkSize=chunk_size,
            hydratedCacheSize=len(lazy_hydrated_records),
        )
        if is_full_reg_sweep and unready_opponents:
            unready_sample = []
            for idx, opponent in unready_opponents[:5]:
                opponent = opponent or {}
                unready_sample.append({
                    "opponentIndex": idx + 1,
                    "id": opponent.get("id"),
                    "name": opponent.get("name"),
                    "validForFormat": bool(opponent.get("validForFormat")),
                    "packedTeamAvailable": bool(opponent.get("packedTeamAvailable")),
                    "unresolvedSpecies": list(opponent.get("unresolvedSpecies") or [])[:6],
                    "hydrationMethod": opponent.get("hydrationMethod"),
                })
            _log_event(
                "full_regulation_unrunnable_hydration_blocked",
                jobId=job_id,
                mode=mode_selection.get("mode") if isinstance(mode_selection, dict) else None,
                batchStart=batch_start_index + 1,
                batchEnd=batch_end_index,
                prefetchStart=prefetch_start + 1,
                prefetchEnd=prefetch_end,
                requestedRecords=len(missing_indices),
                readyOpponents=ready_opponents,
                unreadyOpponents=len(unready_opponents),
                sample=unready_sample,
            )
            raise RuntimeError(
                f"All Meta + All Tournament opponent pool is not fully runnable: "
                f"{len(unready_opponents)} unrunnable opponents in chunk {current_wave_number}/{total_wave_count}."
            )
        return hydrate_ms

    try:
        if total_opponents <= 0:
            _fail_job(job_id, "No benchmark opponents were ready for the requested mode.")
            return

        total_waves = max((total_opponents + max(scheduler_batch_size, 1) - 1) // max(scheduler_batch_size, 1), 1)
        for batch_start in range(0, total_opponents, scheduler_batch_size):
            raw_batch = selected_opponents[batch_start:batch_start + scheduler_batch_size]
            batch_size = len(raw_batch)
            batch_end = batch_start + batch_size
            batch_indices = list(range(batch_start, batch_end))

            current_wave = batch_start // max(scheduler_batch_size, 1) + 1
            batch_timer = time.time()
            hydrate_ms = 0
            stuck_watchdog_count = 0
            batch_launch_ms = 0
            batch_drain_ms = 0
            batch_drain_timer = batch_timer
            pending_series_samples = []
            if is_lazy_hydration and not rolling_scheduler_enabled:
                hydration_step = max(min(int(lazy_hydration_chunk_size or batch_size or 1), batch_size), 1)
                hydrate_ms = 0
                for hydrate_start in range(batch_start, batch_end, hydration_step):
                    hydrate_end = min(hydrate_start + hydration_step, batch_end)
                    hydrate_ms += _prefetch_lazy_hydration(
                        hydrate_start,
                        hydrate_end,
                        hydrate_end - hydrate_start,
                        current_wave,
                        total_waves,
                    )
                batch_entries = [
                    (idx, lazy_hydrated_records.get(idx))
                    for idx in range(batch_start, batch_end)
                    if (lazy_hydrated_records.get(idx) or {}).get("validForFormat")
                    and (lazy_hydrated_records.get(idx) or {}).get("packedTeamAvailable")
                    and (lazy_hydrated_records.get(idx) or {}).get("packedTeam")
                ]
                batch_indices = [idx for idx, _ in batch_entries]
                batch = [opponent for _, opponent in batch_entries]
                if not batch:
                    _log_event(
                        "championlab_batch_hydration_empty",
                        jobId=job_id,
                        mode=mode_selection.get("mode") if isinstance(mode_selection, dict) else None,
                        sweepMode=bool(is_full_reg_sweep),
                        batchStart=batch_start + 1,
                        batchEnd=batch_end,
                        skipped=True,
                    )
                    _record_throughput_batch(
                        job_id,
                        {
                            "batchStart": batch_start + 1,
                            "batchEnd": batch_end,
                            "requestedRecords": len(raw_batch),
                            "hydratedReady": 0,
                            "hydrateMs": hydrate_ms,
                            "launchedSeries": 0,
                            "completedSeries": 0,
                            "batchMs": _elapsed_ms(batch_timer),
                            "stuckWatchdogCount": 0,
                            "skipped": True,
                        },
                    )
                    continue
                batch_size = len(batch)
            else:
                batch = raw_batch

            _log_event(
                "suite_batch_started",
                jobId=job_id,
                batchStart=batch_start + 1,
                batchEnd=batch_end,
                batchSize=batch_size,
                totalOpponents=total_opponents,
                sweepMode=bool(is_full_reg_sweep),
                lazyHydration=bool(mode_selection.get("lazyHydration")) if isinstance(mode_selection, dict) else False,
                effectiveSuiteBatchSize=effective_suite_batch_size,
                schedulerBatchSize=scheduler_batch_size,
                remainingOpponents=max(total_opponents - batch_start, 0),
            )

            battle_wave, battle_total_waves = _battle_wave_numbers(max(int(progress_state.get("completed_games") or 0), 1), total_games)
            worker_view = _shared_worker_snapshot(job_id)
            display_assigned_workers, display_total_workers, display_safety_cap = _shared_worker_progress_worker_values(worker_view)
            set_job_progress(
                job_id,
                phase="benchmark-suite",
                percent=_progress_percent(progress_state),
                currentStep=f"Launching battle wave {battle_wave}/{battle_total_waves}",
                currentWave=battle_wave,
                totalWaves=battle_total_waves,
                currentBattleWave=battle_wave,
                totalBattleWaves=battle_total_waves,
                battleWins=int(progress_state.get("battle_wins") or 0),
                battleLosses=int(progress_state.get("battle_losses") or 0),
                battleTies=int(progress_state.get("battle_ties") or 0),
                processedOpponents=progress_state["completed_opponents"],
                totalOpponents=total_opponents,
                currentOpponent=None,
                currentTemplate=None,
                currentEstimatedWinRate=None,
                processedGames=(int(progress_state.get("battle_wins") or 0) + int(progress_state.get("battle_losses") or 0) + int(progress_state.get("battle_ties") or 0)),
                totalGames=total_games,
                assignedWorkers=display_assigned_workers,
                totalWorkers=display_total_workers,
                safetyWorkerCap=display_safety_cap,
                waitingForWorkers=False,
                queueSpot=0,
            )

            def _record_series_result(series_result, mapped_index, mapped_opponent, reason=None):
                opponent_index = int(series_result.get("opponentIndex") if series_result.get("opponentIndex") is not None else mapped_index)
                results[opponent_index] = {
                    "opponent": series_result.get("opponent"),
                    "games": series_result.get("games") or [],
                    "failed": bool(series_result.get("failed")),
                    "failureContained": bool(series_result.get("failureContained")),
                    "failureReason": series_result.get("failureReason"),
                }

                with progress_lock:
                    progress_state["completed_opponents"] += 1
                    if bool(series_result.get("failed")) or bool(series_result.get("failureContained")):
                        progress_state["failed_games"] = int(progress_state.get("failed_games") or 0) + max(len(series_result.get("games") or []), 1)
                        progress_state["safe_mode_active"] = True
                    snap = _progress_snapshot(progress_state)
                    completed_opponents = snap["completed_opponents"]
                    completed_games = snap["completed_games"]
                    failed_games = snap["failed_games"]
                    battle_wins = snap["battle_wins"]
                    battle_losses = snap["battle_losses"]
                    battle_ties = snap["battle_ties"]
                    total_games_live = snap["total_games"]
                    total_opponents_live = snap["total_opponents"]

                opponent = series_result.get("opponent") or mapped_opponent or {}
                worker_view = _shared_worker_snapshot(job_id)
                display_assigned_workers, display_total_workers, display_safety_cap = _shared_worker_progress_worker_values(worker_view)
                set_job_progress(
                    job_id,
                    phase="benchmark-suite",
                    percent=_progress_percent(progress_state),
                    currentStep=(f"Recovered stuck opponent {completed_opponents}/{total_opponents_live}: {opponent.get('name')}" if reason else f"Finished opponent {completed_opponents}/{total_opponents_live}: {opponent.get('name')}"),
                    currentBattleNumber=completed_games,
                    currentWave=None,
                    totalWaves=None,
                    currentBattleWave=None,
                    totalBattleWaves=None,
                    seriesWins=None,
                    seriesLosses=None,
                    seriesTies=None,
                    failedGames=failed_games,
                    battleWins=battle_wins,
                    battleLosses=battle_losses,
                    battleTies=battle_ties,
                    recordWins=battle_wins,
                    recordLosses=battle_losses,
                    recordTies=battle_ties,
                    processedOpponents=completed_opponents,
                    totalOpponents=total_opponents_live,
                    remainingOpponents=max(int(total_opponents_live or 0) - int(completed_opponents or 0), 0),
                    failedOpponents=sum(1 for item in results if isinstance(item, dict) and item.get("failed")),
                    sweepMode=bool(is_full_reg_sweep),
                    sweepModeLabel=mode_selection.get("sweepModeLabel") if isinstance(mode_selection, dict) else None,
                    currentOpponent=opponent.get("name"),
                    currentTemplate=opponent.get("templateKey"),
                    currentEstimatedWinRate=None,
                    processedGames=(battle_wins + battle_losses + battle_ties),
                    totalGames=total_games_live,
                    assignedWorkers=display_assigned_workers,
                    totalWorkers=display_total_workers,
                    safetyWorkerCap=display_safety_cap,
                    cpuState=worker_view.get("cpuState"),
                    workerCapSnapshot=worker_view.get("workerCapSnapshot"),
                    safeModeActive=bool(progress_state.get("safe_mode_active")),
                    waitingForWorkers=False,
                    queueSpot=0,
                )

            executor_window_size = max(min(batch_size, effective_suite_batch_size), 1)
            executor = ThreadPoolExecutor(max_workers=executor_window_size)
            future_map = {}
            pending = set()
            next_launch_offset = 0
            launched_series_count = 0
            rolling_top_up_submissions = 0
            rolling_early_top_up_submissions = 0
            rolling_early_top_up_cycles = 0
            rolling_early_top_up_ms = 0
            rolling_post_result_top_up_submissions = 0
            rolling_result_handling_ms = 0
            rolling_pending_max = 0
            rolling_done_batch_samples = []
            batch_last_completion_ts = time.time()
            with progress_lock:
                batch_last_progress_games = int(progress_state.get("completed_games") or 0) + int(progress_state.get("failed_games") or 0)
            last_full_reg_parent_heartbeat_ts = 0.0
            try:
                def _resolve_launch_opponent(launch_offset: int):
                    nonlocal hydrate_ms
                    opponent_index = batch_indices[launch_offset] if launch_offset < len(batch_indices) else batch_start + launch_offset
                    opponent = batch[launch_offset] if launch_offset < len(batch) else selected_opponents[opponent_index]
                    if rolling_scheduler_enabled and is_lazy_hydration:
                        hydration_step = max(int(lazy_hydration_chunk_size or executor_window_size or 1), 1)
                        hydrate_end = min(opponent_index + hydration_step, total_opponents)
                        hydrate_ms += _prefetch_lazy_hydration(
                            opponent_index,
                            hydrate_end,
                            max(hydrate_end - opponent_index, 1),
                            current_wave,
                            total_waves,
                        )
                        opponent = lazy_hydrated_records.get(opponent_index)
                        if not (
                            (opponent or {}).get("validForFormat")
                            and (opponent or {}).get("packedTeamAvailable")
                            and (opponent or {}).get("packedTeam")
                        ):
                            raise RuntimeError(
                                f"All Meta + All Tournament opponent {opponent_index + 1} was not hydrated before launch."
                            )
                    return opponent_index, opponent

                def _submit_next_series(initial_window: bool) -> bool:
                    nonlocal batch_launch_ms, launched_series_count, next_launch_offset, rolling_pending_max, rolling_top_up_submissions
                    if next_launch_offset >= batch_size:
                        return False
                    launch_timer = time.time()
                    opponent_index, opponent = _resolve_launch_opponent(next_launch_offset)
                    submitted_series = len(pending)
                    launch_bridge_floor = _full_reg_launch_bridge_floor(executor_window_size)
                    launch_bridge_active = submitted_series < launch_bridge_floor
                    pacing_view = {"delayMs": 0}
                    if not launch_bridge_active:
                        pacing_view = _full_reg_launch_pacing_view()
                    launch_delay_ms = int(pacing_view.get("delayMs") or 0)
                    if launch_delay_ms > 0:
                        _log_event(
                            "full_regulation_launch_pacing_applied",
                            jobId=job_id,
                            opponentIndex=opponent_index,
                            opponentName=(opponent or {}).get("name"),
                            delayMs=launch_delay_ms,
                            cpuPercent=pacing_view.get("cpuPercent"),
                            cpuState=pacing_view.get("cpuState"),
                            cpuCooldownActive=bool(pacing_view.get("cpuCooldownActive")),
                            cpuCooldownRemainingMs=pacing_view.get("cpuCooldownRemainingMs"),
                            cpuRampCalmActive=bool(pacing_view.get("cpuRampCalmActive")),
                            cpuRampCalmRemainingMs=pacing_view.get("cpuRampCalmRemainingMs"),
                            pendingSeries=submitted_series,
                            launchBridgeFloor=launch_bridge_floor,
                            launchBridgeActive=launch_bridge_active,
                            batchSize=batch_size,
                            executorWindowSize=executor_window_size,
                        )
                        time.sleep(launch_delay_ms / 1000.0)
                    future = executor.submit(
                        _run_benchmark_suite_series,
                        job_id,
                        opponent_index,
                        opponent,
                        user_packed_team,
                        games_per_opponent,
                        format_id,
                        repo_dir,
                        timeout_ms,
                        progress_state,
                        progress_lock,
                        current_wave,
                        total_waves,
                        stop_on_series_decision,
                    )
                    future_map[future] = (opponent_index, opponent)
                    pending.add(future)
                    launched_series_count += 1
                    next_launch_offset += 1
                    if not initial_window:
                        rolling_top_up_submissions += 1
                    rolling_pending_max = max(rolling_pending_max, len(pending))
                    batch_launch_ms += _elapsed_ms(launch_timer)
                    return True

                def _top_up_pending_series(reason: str) -> int:
                    nonlocal rolling_early_top_up_submissions, rolling_early_top_up_cycles, rolling_early_top_up_ms, rolling_post_result_top_up_submissions
                    top_up_timer = time.time()
                    submitted = 0
                    while next_launch_offset < batch_size and len(pending) < executor_window_size:
                        if not _submit_next_series(initial_window=False):
                            break
                        submitted += 1
                    if submitted:
                        if rolling_scheduler_enabled and reason == "early-before-result-bookkeeping":
                            rolling_early_top_up_submissions += submitted
                            rolling_early_top_up_cycles += 1
                            rolling_early_top_up_ms += _elapsed_ms(top_up_timer)
                        elif rolling_scheduler_enabled and reason == "post-result-fallback":
                            rolling_post_result_top_up_submissions += submitted
                    if pending:
                        pending_series_samples.append(min(len(pending), executor_window_size))
                    return submitted

                while next_launch_offset < batch_size and len(pending) < executor_window_size:
                    _submit_next_series(initial_window=True)
                batch_drain_timer = time.time()
                pending_series_samples = [min(len(pending), executor_window_size)] if pending else []

                while pending:
                    done, pending = wait(pending, timeout=FULL_REG_STUCK_SERIES_POLL_SEC, return_when=FIRST_COMPLETED)
                    pending_series_samples.append(min(len(pending), executor_window_size))
                    rolling_done_batch_samples.append(len(done))
                    if done:
                        batch_last_completion_ts = time.time()
                    early_top_up_error = None
                    if done:
                        try:
                            _top_up_pending_series("early-before-result-bookkeeping")
                        except Exception as exc:
                            early_top_up_error = exc
                    result_handling_timer = time.time()
                    for future in done:
                        mapped_index, mapped_opponent = future_map[future]
                        try:
                            series_result = future.result()
                        except Exception as exc:
                            _log_event(
                                "suite_series_retry_exhausted",
                                jobId=job_id,
                                opponentIndex=mapped_index,
                                opponentName=(mapped_opponent or {}).get("name"),
                                error=str(exc),
                            )
                            species_error_contained = _is_unidentified_species_error(exc)
                            if not is_full_reg_sweep and not species_error_contained:
                                raise RuntimeError("Matchup Report could not safely complete. Please try again in a few minutes.") from exc
                            series_result = _build_failed_series_result(mapped_index, mapped_opponent, exc, games_per_opponent, timeout_ms)
                            if species_error_contained:
                                series_result["failureReason"] = f"Opponent contained unsupported species and was skipped: {exc}"
                            else:
                                series_result["failureReason"] = f"All Meta + All Tournament contained failed opponent and continued: {exc}"
                            series_result["failureScope"] = "series-contained"
                            _record_series_result(series_result, mapped_index, mapped_opponent, reason="exception-contained")
                            continue
                        _record_series_result(series_result, mapped_index, mapped_opponent)
                    rolling_result_handling_ms += _elapsed_ms(result_handling_timer)
                    if early_top_up_error is not None:
                        raise early_top_up_error

                    if next_launch_offset < batch_size:
                        _top_up_pending_series("post-result-fallback")

                    if pending and is_full_reg_sweep:
                        with progress_lock:
                            progress_activity_games = int(progress_state.get("completed_games") or 0) + int(progress_state.get("failed_games") or 0)
                        if progress_activity_games > batch_last_progress_games:
                            batch_last_progress_games = progress_activity_games
                            batch_last_completion_ts = time.time()

                    if pending and is_full_reg_sweep:
                        remaining_to_launch = max(int(batch_size or 0) - int(next_launch_offset or 0), 0) if rolling_scheduler_enabled else 0
                        remaining_after_batch = remaining_to_launch if rolling_scheduler_enabled else max(int(total_opponents or 0) - int(batch_end or 0), 0)
                        pending_count = len(pending)
                        if rolling_scheduler_enabled:
                            endgame_drain_active = bool(pending_count <= FULL_REG_ENDGAME_PENDING_THRESHOLD and remaining_to_launch <= 0)
                        else:
                            endgame_drain_active = bool(
                                pending_count <= FULL_REG_ENDGAME_PENDING_THRESHOLD
                                or remaining_after_batch <= 0
                            )
                        watchdog_sec = float(FULL_REG_ENDGAME_DRAIN_SEC if endgame_drain_active else FULL_REG_STUCK_SERIES_WATCHDOG_SEC)
                    else:
                        remaining_after_batch = 0
                        pending_count = 0
                        endgame_drain_active = False
                        watchdog_sec = float(FULL_REG_STUCK_SERIES_WATCHDOG_SEC)

                    now = time.time()
                    if pending and is_full_reg_sweep and not done and (now - last_full_reg_parent_heartbeat_ts) >= 3.0:
                        last_full_reg_parent_heartbeat_ts = now
                        with progress_lock:
                            snap = _progress_snapshot(progress_state)
                        worker_view = _shared_worker_snapshot(job_id)
                        display_assigned_workers, display_total_workers, display_safety_cap = _shared_worker_progress_worker_values(worker_view)
                        pending_opponent = None
                        try:
                            pending_future = next(iter(pending))
                            _, pending_opponent = future_map.get(pending_future, (None, None))
                        except Exception:
                            pending_opponent = None
                        pending_opponent_name = (pending_opponent or {}).get("name") or (pending_opponent or {}).get("id")
                        set_job_progress(
                            job_id,
                            phase="benchmark-suite",
                            percent=_progress_percent(progress_state),
                            currentStep="Recovering slow All Meta + All Tournament opponent" if endgame_drain_active else "Waiting for active All Meta + All Tournament battle to finish",
                            currentBattleNumber=int(snap.get("completed_games") or 0),
                            currentWave=None,
                            totalWaves=None,
                            currentBattleWave=None,
                            totalBattleWaves=None,
                            failedGames=int(snap.get("failed_games") or 0),
                            battleWins=int(snap.get("battle_wins") or 0),
                            battleLosses=int(snap.get("battle_losses") or 0),
                            battleTies=int(snap.get("battle_ties") or 0),
                            recordWins=int(snap.get("battle_wins") or 0),
                            recordLosses=int(snap.get("battle_losses") or 0),
                            recordTies=int(snap.get("battle_ties") or 0),
                            processedOpponents=int(snap.get("completed_opponents") or 0),
                            totalOpponents=int(snap.get("total_opponents") or 0),
                            remainingOpponents=max(int(snap.get("total_opponents") or 0) - int(snap.get("completed_opponents") or 0), 0),
                            pendingSeries=pending_count,
                            remainingOpponentsAfterBatch=remaining_after_batch,
                            endgameDrainActive=bool(endgame_drain_active),
                            watchdogSec=watchdog_sec,
                            currentOpponent=pending_opponent_name,
                            currentTemplate=(pending_opponent or {}).get("templateKey"),
                            processedGames=(int(snap.get("battle_wins") or 0) + int(snap.get("battle_losses") or 0) + int(snap.get("battle_ties") or 0)),
                            totalGames=int(snap.get("total_games") or 0),
                            assignedWorkers=display_assigned_workers,
                            totalWorkers=display_total_workers,
                            safetyWorkerCap=display_safety_cap,
                            safeModeActive=bool(progress_state.get("safe_mode_active")),
                            waitingForWorkers=False,
                            queueSpot=0,
                        )

                    if pending and is_full_reg_sweep and (time.time() - batch_last_completion_ts) >= watchdog_sec:
                        stuck_watchdog_count += 1
                        stuck_items = list(pending)
                        _log_event(
                            "full_regulation_endgame_drain_triggered" if endgame_drain_active else "full_regulation_stuck_series_watchdog_triggered",
                            jobId=job_id,
                            batchStart=batch_start + 1,
                            batchEnd=batch_end,
                            stuckSeries=len(stuck_items),
                            pendingSeries=pending_count,
                            remainingOpponentsAfterBatch=remaining_after_batch,
                            endgameDrainActive=bool(endgame_drain_active),
                            idleSec=round(time.time() - batch_last_completion_ts, 2),
                            watchdogSec=watchdog_sec,
                            activeBattles=int(_resource_state_snapshot().get("activeBattles") or 0),
                            sharedSlotsActiveGlobal=int(_shared_worker_snapshot(job_id).get("activeTotal") or 0),
                        )
                        cancelled_series = 0
                        running_series = 0
                        done_race_series = 0
                        for future in stuck_items:
                            mapped_index, mapped_opponent = future_map.get(future, (None, None))
                            if future.done():
                                done_race_series += 1
                                continue
                            cancelled = False
                            try:
                                cancelled = bool(future.cancel())
                            except Exception:
                                cancelled = False
                            if not cancelled:
                                running_series += 1
                                continue

                            pending.discard(future)
                            cancelled_series += 1
                            opponent_name = (mapped_opponent or {}).get("name") or (mapped_opponent or {}).get("id") or f"opponent-{mapped_index}"
                            stale_pool_recovery = {}
                            result = _build_failed_series_result(
                                int(mapped_index or 0),
                                mapped_opponent or {},
                                f"All Meta + All Tournament skipped a pending series after {watchdog_sec:.0f}s with no progress; cancellation succeeded before worker ownership was confirmed.",
                                1,
                                timeout_ms,
                            )
                            result["failureScope"] = "full-regulation-endgame-drain" if endgame_drain_active else "full-regulation-stuck-series-watchdog"
                            result["watchdogRecovered"] = True
                            result["endgameDrainRecovered"] = bool(endgame_drain_active)
                            _resource_adjust("containedFailures", 1)
                            _log_event(
                                "full_regulation_endgame_drain_recovered" if endgame_drain_active else "full_regulation_stuck_series_recovered",
                                jobId=job_id,
                                opponentIndex=mapped_index,
                                opponentName=opponent_name,
                                watchdogSec=watchdog_sec,
                                endgameDrainActive=bool(endgame_drain_active),
                                activeBattlesAfter=int(_resource_state_snapshot().get("activeBattles") or 0),
                                sharedSlotsAfter=int(_shared_worker_snapshot(job_id).get("activeTotal") or 0),
                                staleCheckoutRecovered=int((stale_pool_recovery or {}).get("staleCheckoutRecovered") or 0),
                                persistentCheckedOutAfter=int((stale_pool_recovery or {}).get("checkedOut") or 0),
                            )
                            _record_series_result(result, int(mapped_index or 0), mapped_opponent or {}, reason="watchdog")
                        if running_series or done_race_series:
                            _log_event(
                                "full_regulation_watchdog_deferred_running_series",
                                jobId=job_id,
                                batchStart=batch_start + 1,
                                batchEnd=batch_end,
                                runningSeries=running_series,
                                doneRaceSeries=done_race_series,
                                cancelledSeries=cancelled_series,
                                pendingSeries=len(pending),
                                endgameDrainActive=bool(endgame_drain_active),
                                watchdogSec=watchdog_sec,
                                activeBattles=int(_resource_state_snapshot().get("activeBattles") or 0),
                                sharedSlotsActiveGlobal=int(_shared_worker_snapshot(job_id).get("activeTotal") or 0),
                            )
                        batch_last_completion_ts = time.time()
            finally:
                executor.shutdown(wait=False, cancel_futures=True)

            batch_drain_ms = _elapsed_ms(batch_drain_timer)
            if batch_launch_ms:
                _record_throughput_phase(job_id, "batchLaunchTotal", batch_launch_ms, aggregate=True)
            completed_series_count = 0
            try:
                completed_series_count = sum(1 for idx in range(batch_start, min(batch_end, len(results))) if results[idx] is not None)
            except Exception:
                completed_series_count = 0
            main_phase_wall_ms_total += batch_drain_ms
            main_phase_launched_series_total += launched_series_count if rolling_scheduler_enabled else len(future_map)
            main_phase_completed_series_total += completed_series_count
            pending_series_summary = _diagnostic_distribution(pending_series_samples)
            _record_worker_diagnostic_samples(
                job_id,
                phase="mainSimulation",
                waveLaunchMs=batch_launch_ms,
                waveDrainMs=batch_drain_ms,
                pendingSeries=pending_series_samples,
            )
            done_batch_summary = _diagnostic_distribution(rolling_done_batch_samples)
            _set_phase_diagnostic_fields(
                job_id,
                "mainSimulation",
                phaseWallMs=main_phase_wall_ms_total,
                launchedSeries=main_phase_launched_series_total,
                completedSeries=main_phase_completed_series_total,
                lastBatchWallMs=batch_drain_ms,
                lastBatchLaunchedSeries=launched_series_count if rolling_scheduler_enabled else len(future_map),
                lastBatchCompletedSeries=completed_series_count,
                pendingSeriesP50=pending_series_summary.get("p50"),
                pendingSeriesP95=pending_series_summary.get("p95"),
                pendingSeriesMax=pending_series_summary.get("max"),
                earlyTopUpSubmissions=rolling_early_top_up_submissions,
                earlyTopUpCycles=rolling_early_top_up_cycles,
                earlyTopUpMs=rolling_early_top_up_ms,
                postResultTopUpSubmissions=rolling_post_result_top_up_submissions,
                resultHandlingMs=rolling_result_handling_ms,
                doneBatchP50=done_batch_summary.get("p50"),
                doneBatchP95=done_batch_summary.get("p95"),
                doneBatchMax=done_batch_summary.get("max"),
                rollingActiveWindowTarget=executor_window_size if rolling_scheduler_enabled else None,
                rollingSchedulerEnabled=bool(rolling_scheduler_enabled),
            )
            _record_throughput_batch(
                job_id,
                {
                    "batchStart": batch_start + 1,
                    "batchEnd": batch_end,
                    "requestedRecords": len(raw_batch),
                    "hydratedReady": len(batch),
                    "hydrateMs": hydrate_ms,
                    "launchedSeries": launched_series_count if rolling_scheduler_enabled else len(future_map),
                    "completedSeries": completed_series_count,
                    "batchMs": _elapsed_ms(batch_timer),
                    "launchMs": batch_launch_ms,
                    "drainMs": batch_drain_ms,
                    "pendingSeriesP50": pending_series_summary.get("p50"),
                    "pendingSeriesP95": pending_series_summary.get("p95"),
                    "pendingSeriesMax": pending_series_summary.get("max"),
                    "stuckWatchdogCount": stuck_watchdog_count,
                    "skipped": False,
                    "rollingSchedulerEnabled": rolling_scheduler_enabled,
                    "rollingActiveWindowTarget": executor_window_size if rolling_scheduler_enabled else 0,
                    "rollingPrefetchCount": lazy_hydration_prefetch_count if rolling_scheduler_enabled else 0,
                    "rollingBarrierCount": 0 if rolling_scheduler_enabled else None,
                    "rollingQueuedSeries": 0 if rolling_scheduler_enabled else 0,
                    "rollingExecutorQueueTopUp": bool(rolling_early_top_up_submissions or rolling_post_result_top_up_submissions) if rolling_scheduler_enabled else False,
                    "rollingBoundedPendingMax": rolling_pending_max if rolling_scheduler_enabled else 0,
                    "rollingSubmittedSeries": launched_series_count if rolling_scheduler_enabled else 0,
                    "rollingTopUpSubmissions": rolling_top_up_submissions if rolling_scheduler_enabled else 0,
                    "rollingEarlyTopUpSubmissions": rolling_early_top_up_submissions if rolling_scheduler_enabled else 0,
                    "rollingEarlyTopUpCycles": rolling_early_top_up_cycles if rolling_scheduler_enabled else 0,
                    "rollingEarlyTopUpMs": rolling_early_top_up_ms if rolling_scheduler_enabled else 0,
                    "rollingPostResultTopUpSubmissions": rolling_post_result_top_up_submissions if rolling_scheduler_enabled else 0,
                    "rollingResultHandlingMs": rolling_result_handling_ms if rolling_scheduler_enabled else 0,
                    "rollingDoneBatchP50": done_batch_summary.get("p50") if rolling_scheduler_enabled else None,
                    "rollingDoneBatchP95": done_batch_summary.get("p95") if rolling_scheduler_enabled else None,
                    "rollingDoneBatchMax": done_batch_summary.get("max") if rolling_scheduler_enabled else None,
                },
            )
            if rolling_scheduler_enabled:
                _set_throughput_fields(
                    job_id,
                    rollingActiveWindowTarget=executor_window_size,
                    rollingDrainWaitTotalMs=batch_drain_ms,
                    rollingIdleSlotWaitTotalMs=0,
                    rollingPrefetchCount=lazy_hydration_prefetch_count,
                    rollingBarrierCount=0,
                    rollingQueuedSeries=0,
                    rollingExecutorQueueTopUp=bool(rolling_early_top_up_submissions or rolling_post_result_top_up_submissions),
                    rollingBoundedPendingMax=rolling_pending_max,
                    rollingSubmittedSeries=launched_series_count,
                    rollingTopUpSubmissions=rolling_top_up_submissions,
                    rollingEarlyTopUpSubmissions=rolling_early_top_up_submissions,
                    rollingEarlyTopUpCycles=rolling_early_top_up_cycles,
                    rollingEarlyTopUpMs=rolling_early_top_up_ms,
                    rollingPostResultTopUpSubmissions=rolling_post_result_top_up_submissions,
                    rollingResultHandlingMs=rolling_result_handling_ms,
                    rollingDoneBatchP50=done_batch_summary.get("p50"),
                    rollingDoneBatchP95=done_batch_summary.get("p95"),
                    rollingDoneBatchMax=done_batch_summary.get("max"),
                )
            _log_event(
                "suite_batch_completed",
                jobId=job_id,
                batchStart=batch_start + 1,
                batchEnd=batch_end,
                batchSize=batch_size,
                durationMs=_elapsed_ms(batch_timer),
                completedGames=progress_state["completed_games"],
                completedOpponents=progress_state["completed_opponents"],
                remainingOpponents=max(total_opponents - int(progress_state.get("completed_opponents") or 0), 0),
                failedGames=progress_state.get("failed_games") or 0,
                sweepMode=bool(is_full_reg_sweep),
                rollingSchedulerEnabled=bool(rolling_scheduler_enabled),
                rollingActiveWindowTarget=executor_window_size if rolling_scheduler_enabled else None,
                rollingPrefetchCount=lazy_hydration_prefetch_count if rolling_scheduler_enabled else None,
                rollingBarrierCount=0 if rolling_scheduler_enabled else None,
                rollingBoundedPendingMax=rolling_pending_max if rolling_scheduler_enabled else None,
                rollingSubmittedSeries=launched_series_count if rolling_scheduler_enabled else None,
                rollingTopUpSubmissions=rolling_top_up_submissions if rolling_scheduler_enabled else None,
            )

        if is_full_reg_sweep:
            missing_indices = [idx for idx, entry in enumerate(results) if entry is None]
            if missing_indices:
                _log_event(
                    "full_regulation_endgame_missing_results_finalized",
                    jobId=job_id,
                    missingOpponents=len(missing_indices),
                    expectedOpponents=int(total_opponents or 0),
                    completedOpponents=int(progress_state.get("completed_opponents") or 0),
                    reason="full-regulation-finalization-gap-fill",
                )
                for missing_index in missing_indices:
                    missing_opponent = selected_opponents[missing_index] if missing_index < len(selected_opponents) else {}
                    missing_result = _build_failed_series_result(
                        missing_index,
                        missing_opponent or {},
                        "All Meta + All Tournament finalized a missing or skipped opponent so the sweep could complete.",
                        1,
                        timeout_ms,
                    )
                    missing_result["failureScope"] = "full-regulation-finalization-gap-fill"
                    missing_result["finalizationRecovered"] = True
                    _resource_adjust("containedFailures", 1)
                    try:
                        _record_series_result(missing_result, missing_index, missing_opponent or {}, reason="finalization-gap-fill")
                    except Exception:
                        results[missing_index] = {
                            "opponent": missing_opponent or {},
                            "games": missing_result.get("games") or [],
                            "failed": True,
                            "failureContained": True,
                            "failureReason": missing_result.get("failureReason"),
                        }

        ordered_results = [entry for entry in results if entry is not None]
        with progress_lock:
            snap = _progress_snapshot(progress_state)

        scored_games = int(snap.get("battle_wins") or 0) + int(snap.get("battle_losses") or 0) + int(snap.get("battle_ties") or 0)
        failed_games = int(snap.get("failed_games") or 0)
        incomplete_opponents = len(ordered_results) != int(total_opponents or 0)
        incomplete_games = scored_games != int(snap.get("completed_games") or 0)
        allow_contained_full_sweep_failures = bool(is_full_reg_sweep and not incomplete_opponents)
        if (failed_games > 0 and not allow_contained_full_sweep_failures) or incomplete_opponents or incomplete_games:
            _log_event(
                "suite_full_results_guard_blocked_report",
                jobId=job_id,
                failedGames=failed_games,
                failedAttempts=int(progress_state.get("failed_attempts") or 0),
                completedGames=int(snap.get("completed_games") or 0),
                scoredGames=scored_games,
                completedOpponents=int(snap.get("completed_opponents") or 0),
                expectedOpponents=int(total_opponents or 0),
                resultEntries=len(ordered_results),
                reason="failed-or-incomplete-results",
                sweepMode=bool(is_full_reg_sweep),
                allowContainedFullSweepFailures=allow_contained_full_sweep_failures,
            )
            raise RuntimeError("Matchup Report could not safely complete. Please try again in a few minutes.")
        if is_full_reg_sweep:
            _log_event(
                "full_regulation_sweep_finalized_with_contained_failures" if failed_games > 0 else "full_regulation_sweep_completed",
                jobId=job_id,
                failedGames=failed_games,
                completedOpponents=int(snap.get("completed_opponents") or 0),
                expectedOpponents=int(total_opponents or 0),
                resultEntries=len(ordered_results),
                containedFailures=int(_resource_state_snapshot().get("containedFailures") or 0),
                scoredGames=scored_games,
            )
        if failed_games > 0 and allow_contained_full_sweep_failures:
            _log_event(
                "full_regulation_contained_failures_allowed",
                jobId=job_id,
                failedGames=failed_games,
                completedOpponents=int(snap.get("completed_opponents") or 0),
                expectedOpponents=int(total_opponents or 0),
                resultEntries=len(ordered_results),
            )

        worker_view = _shared_worker_snapshot(job_id)
        set_job_progress(
            job_id,
            phase="finalizing-suite-report",
            percent=97,
            currentStep="Preparing lead-pair sweep",
            currentBattleNumber=None,
            currentWave=None,
            totalWaves=None,
            currentBattleWave=None,
            totalBattleWaves=None,
            seriesWins=None,
            seriesLosses=None,
            seriesTies=None,
            failedGames=snap["failed_games"],
            battleWins=snap["battle_wins"],
            battleLosses=snap["battle_losses"],
            battleTies=snap["battle_ties"],
            processedOpponents=snap["completed_opponents"],
            totalOpponents=snap["total_opponents"],
            currentOpponent=None,
            currentTemplate=None,
            currentEstimatedWinRate=None,
            processedGames=(snap["battle_wins"] + snap["battle_losses"] + snap["battle_ties"]),
            totalGames=snap["total_games"],
            assignedWorkers=0,
            totalWorkers=SHARED_WORKER_POOL_CAP,
            safetyWorkerCap=int(worker_view.get("globalCap") or SHARED_WORKER_POOL_CAP),
            cpuState=worker_view.get("cpuState"),
            workerCapSnapshot=worker_view.get("workerCapSnapshot"),
            safeModeActive=bool(snap.get("failed_games") or progress_state.get("safe_mode_active")),
            waitingForWorkers=False,
            queueSpot=0,
        )

        sweep_opponents = [
            dict(entry.get("opponent") or {})
            for entry in ordered_results
            if isinstance(entry, dict) and isinstance(entry.get("opponent"), dict)
        ]
        lead_pair_sweep = _run_lead_pair_sweep(
            job_id=job_id,
            user_team_export=user_team_export,
            selected_opponents=sweep_opponents,
            format_id=format_id,
            repo_dir=repo_dir,
            timeout_ms=timeout_ms,
        )

        worker_view = _shared_worker_snapshot(job_id)
        set_job_progress(
            job_id,
            phase="finalizing-suite-report",
            percent=98,
            currentStep="Preparing core sweep",
            leadPairSweep=True,
            leadPairSweepStatus=lead_pair_sweep.get("status"),
            leadPairPairsProcessed=lead_pair_sweep.get("pairsTested"),
            leadPairPairsTotal=lead_pair_sweep.get("pairsSelected") or lead_pair_sweep.get("pairsTested"),
            leadPairPairsGenerated=lead_pair_sweep.get("pairsGenerated"),
            leadPairFinalistLimit=lead_pair_sweep.get("finalistLimit"),
            leadPairGamesProcessed=lead_pair_sweep.get("gamesCompleted"),
            leadPairGamesTotal=lead_pair_sweep.get("gamesRequested"),
            waitingForWorkers=False,
            queueSpot=0,
            workerCapSnapshot=worker_view.get("workerCapSnapshot"),
        )
        core_sweep = _run_core_sweep(
            job_id=job_id,
            user_team_export=user_team_export,
            selected_opponents=sweep_opponents,
            format_id=format_id,
            repo_dir=repo_dir,
            timeout_ms=timeout_ms,
        )

        worker_view = _shared_worker_snapshot(job_id)
        set_job_progress(
            job_id,
            phase="finalizing-suite-report",
            percent=99,
            currentStep="Finalizing benchmark suite report",
            leadPairSweep=True,
            leadPairSweepStatus=lead_pair_sweep.get("status"),
            leadPairPairsProcessed=lead_pair_sweep.get("pairsTested"),
            leadPairPairsTotal=lead_pair_sweep.get("pairsSelected") or lead_pair_sweep.get("pairsTested"),
            leadPairPairsGenerated=lead_pair_sweep.get("pairsGenerated"),
            leadPairFinalistLimit=lead_pair_sweep.get("finalistLimit"),
            leadPairGamesProcessed=lead_pair_sweep.get("gamesCompleted"),
            leadPairGamesTotal=lead_pair_sweep.get("gamesRequested"),
            coreSweep=True,
            coreSweepStatus=core_sweep.get("status"),
            coreSweepCoresProcessed=core_sweep.get("coresTested"),
            coreSweepCoresTotal=core_sweep.get("coresSelected") or core_sweep.get("coresTested"),
            coreSweepCoresGenerated=core_sweep.get("coresGenerated"),
            coreSweepFinalistLimit=core_sweep.get("finalistLimit"),
            coreSweepGamesProcessed=core_sweep.get("gamesCompleted"),
            coreSweepGamesTotal=core_sweep.get("gamesRequested"),
            waitingForWorkers=False,
            queueSpot=0,
            workerCapSnapshot=worker_view.get("workerCapSnapshot"),
        )

        report_timer = time.time()
        report = build_benchmark_suite_report(
            format_id=format_id,
            benchmark_mode=mode_selection.get("mode"),
            mode_selection=mode_selection,
            suite_results=ordered_results,
            games_per_opponent=games_per_opponent,
            user_team_validation=validation_result,
            user_packed_team=user_packed_team,
            user_team_export=user_team_export,
            lead_pair_sweep=lead_pair_sweep,
            core_sweep=core_sweep,
        )
        _record_throughput_phase(job_id, "reportBuild", _elapsed_ms(report_timer))
        _complete_job(job_id, report)
    except Exception as exc:
        error_message = str(exc) or "Matchup Report could not safely complete. Please try again in a few minutes."
        safe_error_message = (
            error_message
            if error_message.startswith("Lead Pair Sweep could not safely complete")
            else "Matchup Report could not safely complete. Please try again in a few minutes."
        )
        _log_event("suite_job_failed_safely", jobId=job_id, error=error_message, displayedError=safe_error_message, traceback=traceback.format_exc(limit=3))
        _fail_job(job_id, safe_error_message)
    finally:
        _clear_shared_worker_job(job_id)
        _resource_adjust("activeSuiteJobs", -1)
        _resource_reset_completed_counters(reason="suite-finalized", job_id=job_id)


def create_job(user_id: str, job_type: str):
    global _next_job_id
    submitted_at = utc_now_iso()
    with _jobs_lock:
        job_id = f"py-worker-job-{int(time.time() * 1000)}-{_next_job_id}"
        _next_job_id += 1
        job = {
            "jobId": job_id,
            "userId": user_id,
            "jobType": job_type,
            "status": "queued",
            "submittedAt": submitted_at,
            "submittedEpochMs": int(time.time() * 1000),
            "startedAt": None,
            "startedEpochMs": None,
            "completedAt": None,
            "completedEpochMs": None,
            "error": None,
            "report": None,
            "progress": _new_progress(),
            "metrics": {"throughput": _new_throughput_metrics()} if job_type == "run-benchmark-suite" else {},
        }
        _jobs[job_id] = job
    _log_event("job_created", jobId=job_id, jobType=job_type, userId=user_id)
    return job


class Handler(BaseHTTPRequestHandler):
    server_version = "BenchMarkPythonWorker/8.0"

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception as exc:
            raise ValueError("Worker received invalid JSON.") from exc

    def _write_json(self, status_code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            readiness = get_benchmark_readiness(reason="health")
            resource_state = _resource_state_snapshot()
            worker_cap_snapshot = _shared_worker_snapshot().get("workerCapSnapshot")
            job_counts = summarize_job_counts()
            cpu_percent = _get_latest_cpu_percent()
            benchmark_active = (
                int(job_counts.get("queued") or 0) > 0
                or int(job_counts.get("running") or 0) > 0
                or int(resource_state.get("activeBattles") or 0) > 0
                or int(resource_state.get("activeSuiteJobs") or 0) > 0
                or bool(readiness.get("warmupActive"))
                or str(readiness.get("status") or "").lower() == "warming"
            )
            self._write_json(
                200,
                {
                    "ok": True,
                    "statusText": readiness.get("statusText") or "BenchMark Python worker ready",
                    "detailText": readiness.get("detailText") or f"Listening on http://{HOST}:{PORT}",
                    "backendLanguage": "python",
                    "workerVersion": WORKER_VERSION,
                    "analyzerVersion": ENGINE_VERSION,
                    "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
                    "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
                    "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
                    "battleRunnerVersion": BATTLE_RUNNER_VERSION,
                    "jobCounts": job_counts,
                    "readiness": readiness,
                    "resourceState": resource_state,
                    "workerCapSnapshot": worker_cap_snapshot,
                    "cpuPercent": cpu_percent,
                    "benchmarkActive": benchmark_active,
                    "bootedAt": _WORKER_BOOT_ISO,
                    "uptimeMs": _elapsed_ms(_WORKER_BOOT_TS),
                    "configuredParallelBattles": SUITE_PARALLEL_BATTLES,
                    "globalBattleSemaphoreCap": GLOBAL_BATTLE_SEMAPHORE_CAP,
                    "showdown": get_showdown_status(),
                },
            )
            return

        if parsed.path == "/capabilities":
            readiness = get_benchmark_readiness(reason="capabilities")
            self._write_json(
                200,
                {
                    "ok": True,
                    "backendLanguage": "python",
                    "workerVersion": WORKER_VERSION,
                    "analyzerVersion": ENGINE_VERSION,
                    "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
                    "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
                    "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
                    "battleRunnerVersion": BATTLE_RUNNER_VERSION,
                    "supportedJobs": ["weakness-report", "simulate-matchup", "run-battle-series", "run-benchmark-suite"],
                    "readiness": readiness,
                    "workerCapSnapshot": readiness.get("workerCapSnapshot"),
                    "bootedAt": _WORKER_BOOT_ISO,
                    "uptimeMs": _elapsed_ms(_WORKER_BOOT_TS),
                    "configuredParallelBattles": SUITE_PARALLEL_BATTLES,
                    "globalBattleSemaphoreCap": GLOBAL_BATTLE_SEMAPHORE_CAP,
                    "showdown": get_showdown_status(),
                    "templates": list_template_summaries(),
                },
            )
            return

        if parsed.path == "/ready":
            readiness = get_benchmark_readiness(reason="ready", force=True)
            self._write_json(200 if readiness.get("ready") else 503, readiness)
            return

        if parsed.path == "/showdown/status":
            readiness = get_benchmark_readiness(reason="showdown-status")
            self._write_json(200, {"ok": True, "showdown": get_showdown_status(), "readiness": readiness})
            return

        if parsed.path.startswith("/jobs/"):
            job_id = parsed.path[len("/jobs/") :]
            query = parse_qs(parsed.query or "")
            include_report_raw = str((query.get("include_report") or ["1"])[0]).strip().lower()
            include_report = include_report_raw not in {"0", "false", "no", "off"}
            with _jobs_lock:
                job = _jobs.get(job_id)

            if not job:
                self._write_json(404, {"error": "BenchMark job was not found."})
                return

            if job.get("status") == "completed" and job.get("report") is not None:
                _log_event(
                    "job_status_requested",
                    jobId=job_id,
                    includeReport=include_report,
                    reportAvailable=True,
                )

            self._write_json(200, serialize_job(job, include_report=include_report))
            return

        self._write_json(404, {"error": "Worker route not found."})

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/jobs/weakness-report":
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._write_json(400, {"error": str(exc)})
                return

            user_id = clean_text(body.get("user_id"))
            team_export = clean_text(body.get("team_export"))

            if not user_id:
                self._write_json(400, {"error": "user_id is required."})
                return

            if not looks_like_team_export(team_export):
                self._write_json(400, {"error": "That does not look like a valid Pokémon Showdown export."})
                return

            job = create_job(user_id, "weakness-report")
            thread = threading.Thread(target=_run_weakness_job, args=(job["jobId"], team_export), daemon=True)
            thread.start()
            self._write_json(
                200,
                {
                    "ok": True,
                    "mode": "http",
                    "backendLanguage": "python",
                    "workerVersion": WORKER_VERSION,
                    "analyzerVersion": ENGINE_VERSION,
                    "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
                    "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
                    "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
                    "battleRunnerVersion": BATTLE_RUNNER_VERSION,
                    "jobId": job["jobId"],
                    "jobType": job["jobType"],
                    "status": job["status"],
                    "submittedAt": job["submittedAt"],
                    "progress": job["progress"],
                },
            )
            return

        if parsed.path == "/jobs/simulate-matchup":
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._write_json(400, {"error": str(exc)})
                return

            user_id = clean_text(body.get("user_id"))
            team_export = clean_text(body.get("team_export"))
            template_keys = body.get("template_keys") or []
            battle_count = int(body.get("battle_count") or 20)
            format_id = clean_text(body.get("format_id")) or DEFAULT_FORMAT_ID

            if not user_id:
                self._write_json(400, {"error": "user_id is required."})
                return
            if not looks_like_team_export(team_export):
                self._write_json(400, {"error": "That does not look like a valid Pokémon Showdown export."})
                return

            ready, readiness = _require_benchmark_ready()
            if not ready:
                self._write_json(503, {"ok": False, "error": "BenchMark execution path is not ready yet.", "retryable": True, "readiness": readiness})
                return

            simulator_team_export = _simulator_team_export_for_format(team_export, format_id)
            validation = validate_team_export(simulator_team_export, format_id)
            if not validation.get("valid"):
                self._write_json(400, {"error": "Team did not validate for the requested format.", "validation": validation})
                return

            packing = pack_team_export(simulator_team_export)
            if not packing.get("ok") or not packing.get("packedTeam"):
                self._write_json(400, {"error": "Team could not be packed into Showdown format.", "packing": packing})
                return

            showdown_status = get_showdown_status()
            job = create_job(user_id, "simulate-matchup")
            thread = threading.Thread(
                target=_run_simulate_matchup_job,
                args=(job["jobId"], team_export, template_keys, battle_count, format_id, validation, packing.get("packedTeam")),
                daemon=True,
            )
            thread.start()

            self._write_json(
                200,
                {
                    "ok": True,
                    "mode": "http",
                    "backendLanguage": "python",
                    "workerVersion": WORKER_VERSION,
                    "analyzerVersion": ENGINE_VERSION,
                    "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
                    "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
                    "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
                    "battleRunnerVersion": BATTLE_RUNNER_VERSION,
                    "showdownReady": bool(showdown_status.get("fullyReady") or showdown_status.get("cliReady")),
                    "jobId": job["jobId"],
                    "jobType": job["jobType"],
                    "status": job["status"],
                    "submittedAt": job["submittedAt"],
                    "formatId": format_id,
                    "validation": validation,
                    "showdownStatus": showdown_status,
                    "progress": job["progress"],
                },
            )
            return

        if parsed.path == "/jobs/run-benchmark-suite":
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._write_json(400, {"error": str(exc)})
                return

            user_id = clean_text(body.get("user_id"))
            team_export = clean_text(body.get("team_export"))
            mode = clean_text(body.get("mode")) or "s-tier-top-tournament"
            sample_size = body.get("sample_size")
            sample_seed = clean_text(body.get("sample_seed")) or None
            games_per_opponent = int(body.get("games_per_opponent") or 3)
            format_id = clean_text(body.get("format_id")) or DEFAULT_FORMAT_ID
            battle_budget = _normalize_battle_budget(body.get("battle_budget") or body.get("battleBudget") or body.get("iterations"))
            if _is_champions_format(format_id):
                games_per_opponent = 1

            if not user_id:
                self._write_json(400, {"error": "user_id is required."})
                return
            if not looks_like_team_export(team_export):
                self._write_json(400, {"error": "That does not look like a valid Pokémon Showdown export."})
                return
            if games_per_opponent < 1:
                self._write_json(400, {"error": "games_per_opponent must be at least 1."})
                return

            ready, readiness = _require_benchmark_ready()
            if not ready:
                self._write_json(503, {"ok": False, "error": "BenchMark execution path is not ready yet.", "retryable": True, "readiness": readiness})
                return

            showdown_status = get_showdown_status()
            job = create_job(user_id, "run-benchmark-suite")
            job["progress"].update({
                "phase": "queued",
                "percent": 0,
                "progressBar": _progress_bar(0),
                "currentStep": "Queued benchmark suite request",
                "processedOpponents": 0,
                "totalOpponents": 0,
                "processedGames": 0,
                "totalGames": 0,
            })

            thread = threading.Thread(
                target=_prepare_and_run_benchmark_suite_job,
                args=(job["jobId"], team_export, mode, sample_size, sample_seed, games_per_opponent, format_id, battle_budget),
                daemon=True,
            )
            thread.start()

            self._write_json(
                200,
                {
                    "ok": True,
                    "mode": "http",
                    "backendLanguage": "python",
                    "workerVersion": WORKER_VERSION,
                    "analyzerVersion": ENGINE_VERSION,
                    "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
                    "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
                    "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
                    "battleRunnerVersion": BATTLE_RUNNER_VERSION,
                    "showdownReady": bool(showdown_status.get("fullyReady") or showdown_status.get("cliReady")),
                    "jobId": job["jobId"],
                    "jobType": job["jobType"],
                    "status": job["status"],
                    "submittedAt": job["submittedAt"],
                    "formatId": format_id,
                    "validation": None,
                    "showdownStatus": showdown_status,
                    "benchmarkMode": mode,
                    "battleBudget": battle_budget,
                    "battlesPerMatchup": battle_budget,
                    "gamesPerOpponent": games_per_opponent,
                    "selectedOpponents": None,
                    "selectionSummary": {
                        "requestedSampleSize": sample_size,
                        "selectionSeed": sample_seed,
                        "availableOpponents": None,
                        "battleBudget": battle_budget,
                        "battlesPerMatchup": battle_budget,
                        "battleBudgetAllocationRule": "championslab-min-one-per-opponent-floor-budget",
                    },
                    "progress": job["progress"],
                },
            )
            return

        if parsed.path == "/jobs/run-battle-series":
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._write_json(400, {"error": str(exc)})
                return

            user_id = clean_text(body.get("user_id"))
            team_export = clean_text(body.get("team_export"))
            opponent_id = clean_text(body.get("opponent_id"))
            games = int(body.get("games") or 5)
            format_id = clean_text(body.get("format_id")) or DEFAULT_FORMAT_ID

            if not user_id:
                self._write_json(400, {"error": "user_id is required."})
                return
            if not opponent_id:
                self._write_json(400, {"error": "opponent_id is required."})
                return
            if not looks_like_team_export(team_export):
                self._write_json(400, {"error": "That does not look like a valid Pokémon Showdown export."})
                return

            ready, readiness = _require_benchmark_ready()
            if not ready:
                self._write_json(503, {"ok": False, "error": "BenchMark execution path is not ready yet.", "retryable": True, "readiness": readiness})
                return

            simulator_team_export = _simulator_team_export_for_format(team_export, format_id)
            validation = validate_team_export(simulator_team_export, format_id)
            if not validation.get("valid"):
                self._write_json(400, {"error": "Team did not validate for the requested format.", "validation": validation})
                return

            packing = pack_team_export(simulator_team_export)
            if not packing.get("ok") or not packing.get("packedTeam"):
                self._write_json(400, {"error": "Team could not be packed into Showdown format.", "packing": packing})
                return

            opponent = get_opponent_by_id(opponent_id, format_id=format_id)
            if not opponent:
                self._write_json(404, {"error": "Opponent could not be found for the requested format."})
                return
            if not opponent.get("packedTeamAvailable") or not opponent.get("packedTeam"):
                self._write_json(400, {"error": "Opponent team is not packed and ready for simulation.", "opponent": opponent})
                return

            showdown_status = get_showdown_status()
            job = create_job(user_id, "run-battle-series")
            job["progress"]["totalGames"] = max(games, 1)

            thread = threading.Thread(
                target=_run_battle_series_job,
                args=(job["jobId"], team_export, packing.get("packedTeam"), opponent, games, format_id, validation),
                daemon=True,
            )
            thread.start()

            self._write_json(
                200,
                {
                    "ok": True,
                    "mode": "http",
                    "backendLanguage": "python",
                    "workerVersion": WORKER_VERSION,
                    "analyzerVersion": ENGINE_VERSION,
                    "showdownHelperVersion": SHOWDOWN_HELPER_VERSION,
                    "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
                    "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
                    "battleRunnerVersion": BATTLE_RUNNER_VERSION,
                    "showdownReady": bool(showdown_status.get("fullyReady") or showdown_status.get("cliReady")),
                    "jobId": job["jobId"],
                    "jobType": job["jobType"],
                    "status": job["status"],
                    "submittedAt": job["submittedAt"],
                    "formatId": format_id,
                    "validation": validation,
                    "showdownStatus": showdown_status,
                    "opponentId": opponent_id,
                    "games": games,
                    "progress": job["progress"],
                },
            )
            return

        self._write_json(404, {"error": "Worker route not found."})

    def log_message(self, format, *args):
        return


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[BenchMark Python Worker] Listening on http://{HOST}:{PORT}")
    _start_readiness_probe()
    _start_resource_monitor()
    server.serve_forever()


if __name__ == "__main__":
    main()
