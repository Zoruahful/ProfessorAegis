import json
import os
import random
import selectors
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional

BATTLE_RUNNER_VERSION = "2026.05.11-battle-runner-v29-policy-v3-battlebrain-memory"
SERIES_BATCH_RUNNER_ENABLED = str(os.getenv("BENCHMARK_SERIES_BATCH_RUNNER_ENABLED", "0")).strip().lower() in {"1", "true", "yes", "on"}
SERIES_BATCH_RUNNER_MAX_GAMES = max(int(os.getenv("BENCHMARK_SERIES_BATCH_RUNNER_MAX_GAMES", "5") or "5"), 1)
SERIES_BATCH_GAME_TIMEOUT_MS = max(int(os.getenv("BENCHMARK_SERIES_BATCH_GAME_TIMEOUT_MS", "12000") or "12000"), 2500)
SERIES_BATCH_DISABLED_REASON = str(os.getenv("BENCHMARK_SERIES_BATCH_DISABLED_REASON", "disabled-after-instability")).strip() or "disabled-after-instability"

PERSISTENT_SIM_WORKER_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_POOL_SIZE = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_POOL_SIZE", "8") or "8"), 0)
PERSISTENT_SIM_WORKER_MAX_AGE_SEC = max(float(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_MAX_AGE_SEC", "900") or "900"), 10.0)
PERSISTENT_SIM_WORKER_MAX_BATTLES = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_MAX_BATTLES", "2048") or "2048"), 1)
PERSISTENT_SIM_WORKER_FALLBACK_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_FALLBACK_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "benchmark_persistent_sim_worker.js")
PERSISTENT_SIM_WORKER_PREWARM_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_PREWARM_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_PREWARM_SIZE = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_PREWARM_SIZE", "8") or "8"), 0)
PERSISTENT_SIM_WORKER_PREWARM_TIMEOUT_MS = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_PREWARM_TIMEOUT_MS", "0") or "0"), 0)
PERSISTENT_SIM_WORKER_PREWARM_MAX_SPAWN_BATCH = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_PREWARM_MAX_SPAWN_BATCH", "8") or "8"), 1)
PERSISTENT_SIM_WORKER_BORROW_WAIT_MS = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_BORROW_WAIT_MS", "2500") or "2500"), 0)
PERSISTENT_SIM_WORKER_DISCIPLINE_ENABLED = str(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_DISCIPLINE_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
PERSISTENT_SIM_WORKER_DISCIPLINE_MAX_LIVE = max(int(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_DISCIPLINE_MAX_LIVE", "8") or "8"), 1)
PERSISTENT_SIM_WORKER_STALE_CHECKOUT_SEC = max(float(os.getenv("BENCHMARK_PERSISTENT_SIM_WORKER_STALE_CHECKOUT_SEC", "35") or "35"), 5.0)
BATTLEBRAIN_MEMORY_TURNS = 4
PROTECT_MOVE_IDS = {"protect", "detect", "spikyshield", "kingsshield", "banefulbunker", "silktrap", "burningbulwark"}
FAKE_OUT_MOVE_IDS = {"fakeout"}
SPEED_CONTROL_MOVE_IDS = {"tailwind", "trickroom", "icywind", "electroweb", "thunderwave", "nuzzle"}
REDIRECTION_MOVE_IDS = {"followme", "ragepowder"}
GUARD_MOVE_IDS = {"wideguard", "quickguard"}
SUPPORT_MOVE_IDS = {"helpinghand", "willowisp", "spore", "sleeppowder"}


def _stop_process(proc: Optional[subprocess.Popen], timeout: float = 1.0):
    """Stop and reap a child process so completed Node children do not linger."""
    if proc is None:
        return None
    try:
        return_code = proc.poll()
        if return_code is not None:
            try:
                return proc.wait(timeout=0)
            except Exception:
                return return_code
        proc.kill()
        try:
            return proc.wait(timeout=max(float(timeout or 0.0), 0.0))
        except subprocess.TimeoutExpired:
            return proc.poll()
    except Exception:
        return None


class _WarmBattleProcess:
    def __init__(self, proc: subprocess.Popen, repo_dir: str):
        self.proc = proc
        self.repo_dir = repo_dir
        self.created_at = time.time()
        self.used = False

    def alive(self) -> bool:
        try:
            return self.proc is not None and self.proc.poll() is None and self.proc.stdin is not None and self.proc.stdout is not None
        except Exception:
            return False

    def kill(self):
        _stop_process(self.proc)


class WarmBattleProcessPool:
    """Prototype warm process pool for Pokemon Showdown simulate-battle runners.

    This intentionally does NOT modify Pokemon Showdown core. It only pre-spawns
    idle `node pokemon-showdown simulate-battle` processes so the hot battle path
    can borrow an already-started process instead of always paying spawn cost at
    the exact moment a worker slot opens. A borrowed process is used for one game
    and then retired, because the simulator protocol is treated as one-battle
    safe until a later patch proves multi-battle reuse is correct.
    """

    def __init__(self):
        self.enabled = str(os.getenv("BENCHMARK_WARM_RUNNER_POOL_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}
        self.target_size = max(int(os.getenv("BENCHMARK_WARM_RUNNER_POOL_SIZE", "2") or "2"), 0)
        self.max_age_sec = max(float(os.getenv("BENCHMARK_WARM_RUNNER_POOL_MAX_AGE_SEC", "90") or "90"), 5.0)
        self.replenish_interval_sec = max(float(os.getenv("BENCHMARK_WARM_RUNNER_POOL_REPLENISH_INTERVAL_MS", "1500") or "1500") / 1000.0, 0.0)
        self.max_spawn_batch = max(int(os.getenv("BENCHMARK_WARM_RUNNER_POOL_MAX_SPAWN_BATCH", "1") or "1"), 1)
        self.repo_dir = None
        self.lock = threading.Lock()
        self.processes: List[_WarmBattleProcess] = []
        self.spawning = 0
        self.last_spawn_request_at = 0.0
        self.stats = {
            "created": 0,
            "borrowedWarm": 0,
            "borrowedCold": 0,
            "retired": 0,
            "spawnFailed": 0,
        }

    def configure(self, repo_dir: str, enabled: Optional[bool] = None, target_size: Optional[int] = None):
        if enabled is not None:
            self.enabled = bool(enabled)
        if target_size is not None:
            self.target_size = max(int(target_size), 0)
        repo_dir = str(repo_dir or "").strip()
        with self.lock:
            if repo_dir and self.repo_dir and self.repo_dir != repo_dir:
                self._retire_locked(reason="repo-changed")
            if repo_dir:
                self.repo_dir = repo_dir
        self.ensure_target()

    def _spawn_process(self, repo_dir: str) -> _WarmBattleProcess:
        proc = subprocess.Popen(
            ["node", "pokemon-showdown", "simulate-battle"],
            cwd=repo_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            bufsize=0,
        )
        return _WarmBattleProcess(proc, repo_dir=repo_dir)

    def _retire_locked(self, reason: str = "retired"):
        current = list(self.processes)
        self.processes.clear()
        self.stats["retired"] += len(current)
        for item in current:
            item.kill()

    def _prune_locked(self):
        now = time.time()
        kept = []
        for item in self.processes:
            if not item.alive() or (now - item.created_at) > self.max_age_sec:
                self.stats["retired"] += 1
                item.kill()
            else:
                kept.append(item)
        self.processes = kept

    def ensure_target(self):
        if not self.enabled or self.target_size <= 0:
            return
        with self.lock:
            repo_dir = self.repo_dir
            if not repo_dir:
                return
            self._prune_locked()
            needed = max(self.target_size - len(self.processes) - self.spawning, 0)
            if needed <= 0:
                return
            now = time.time()
            if self.last_spawn_request_at and self.replenish_interval_sec > 0 and (now - self.last_spawn_request_at) < self.replenish_interval_sec:
                return
            needed = min(needed, self.max_spawn_batch)
            self.last_spawn_request_at = now
            self.spawning += needed
        for _ in range(needed):
            thread = threading.Thread(target=self._spawn_and_store, args=(repo_dir,), daemon=True)
            thread.start()

    def _spawn_and_store(self, repo_dir: str):
        item = None
        try:
            item = self._spawn_process(repo_dir)
            created = True
        except Exception:
            created = False
        with self.lock:
            self.spawning = max(self.spawning - 1, 0)
            if created and item is not None and self.enabled and self.repo_dir == repo_dir and len(self.processes) < self.target_size and item.alive():
                self.processes.append(item)
                self.stats["created"] += 1
            else:
                if created and item is not None:
                    item.kill()
                if not created:
                    self.stats["spawnFailed"] += 1

    def borrow(self, repo_dir: str) -> tuple[Optional[_WarmBattleProcess], str]:
        repo_dir = str(repo_dir or "").strip()
        if not self.enabled or self.target_size <= 0:
            with self.lock:
                self.stats["borrowedCold"] += 1
            return None, "disabled"
        self.configure(repo_dir=repo_dir)
        item = None
        with self.lock:
            self._prune_locked()
            if self.processes:
                item = self.processes.pop(0)
                self.stats["borrowedWarm"] += 1
            else:
                self.stats["borrowedCold"] += 1
        self.ensure_target()
        if item and item.alive():
            item.used = True
            return item, "warm"
        if item:
            item.kill()
        return None, "cold"

    def retire_used(self, item: Optional[_WarmBattleProcess]):
        if item is not None:
            item.kill()
            with self.lock:
                self.stats["retired"] += 1
        self.ensure_target()

    def snapshot(self) -> Dict[str, Any]:
        with self.lock:
            self._prune_locked()
            return {
                "enabled": bool(self.enabled),
                "targetSize": int(self.target_size),
                "ready": len(self.processes),
                "spawning": int(self.spawning),
                "repoDirConfigured": bool(self.repo_dir),
                "replenishIntervalMs": int(round(self.replenish_interval_sec * 1000)),
                "maxSpawnBatch": int(self.max_spawn_batch),
                **self.stats,
            }




class _PersistentSimWorkerProcess:
    def __init__(self, proc: subprocess.Popen, repo_dir: str):
        self.proc = proc
        self.repo_dir = repo_dir
        self.created_at = time.time()
        self.battles_run = 0
        self.last_used_at = 0.0

    def alive(self) -> bool:
        try:
            return self.proc is not None and self.proc.poll() is None and self.proc.stdin is not None and self.proc.stdout is not None
        except Exception:
            return False

    def expired(self) -> bool:
        age = time.time() - self.created_at
        return age > PERSISTENT_SIM_WORKER_MAX_AGE_SEC or self.battles_run >= PERSISTENT_SIM_WORKER_MAX_BATTLES

    def kill(self):
        _stop_process(self.proc)


class PersistentSimWorkerPool:
    """Reusable Node BattleStream workers for Matchup Report simulations.

    Unlike the disabled true batch CLI path, this does not attempt to feed multiple
    games into the `pokemon-showdown simulate-battle` CLI. Instead, each persistent
    Node worker keeps Pokemon Showdown loaded, creates a fresh BattleStream per
    request, and returns one JSON result. Any worker-level failure retires only that
    worker and falls back to the proven per-game CLI path.
    """

    def __init__(self):
        self.enabled = bool(PERSISTENT_SIM_WORKER_ENABLED)
        self.target_size = int(PERSISTENT_SIM_WORKER_POOL_SIZE)
        self.repo_dir = None
        self.lock = threading.Lock()
        self.ready: List[_PersistentSimWorkerProcess] = []
        self.spawning = 0
        self.checked_out = 0
        self.checked_out_items = {}
        self.stats = {
            "created": 0,
            "borrowedPersistent": 0,
            "reusedPersistent": 0,
            "fallbacks": 0,
            "retired": 0,
            "spawnFailed": 0,
            "requestFailed": 0,
            "borrowWaits": 0,
            "borrowWaitTimeouts": 0,
            "borrowWaitMsSamples": 0,
            "borrowWaitMsTotal": 0,
            "borrowWaitMsMax": 0,
            "lastBorrowWaitMs": 0,
            "battleRuntimeMsSamples": 0,
            "battleRuntimeMsTotal": 0,
            "battleRuntimeMsMax": 0,
            "lastBattleRuntimeMs": 0,
            "coldSpawnsDisciplined": 0,
            "staleCheckoutRecoveries": 0,
        }

    def configure(self, repo_dir: str, enabled: Optional[bool] = None, target_size: Optional[int] = None):
        if enabled is not None:
            self.enabled = bool(enabled)
        if target_size is not None:
            self.target_size = max(int(target_size), 0)
        repo_dir = str(repo_dir or "").strip()
        with self.lock:
            if repo_dir and self.repo_dir and self.repo_dir != repo_dir:
                self._retire_locked(reason="repo-changed")
            if repo_dir:
                self.repo_dir = repo_dir
            self._prune_locked()

    def _spawn_process(self, repo_dir: str) -> _PersistentSimWorkerProcess:
        if not os.path.exists(PERSISTENT_SIM_WORKER_SCRIPT):
            raise FileNotFoundError(f"Persistent simulator worker script is missing: {PERSISTENT_SIM_WORKER_SCRIPT}")
        proc = subprocess.Popen(
            ["node", PERSISTENT_SIM_WORKER_SCRIPT],
            cwd=repo_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=False,
            bufsize=0,
        )
        return _PersistentSimWorkerProcess(proc, repo_dir=repo_dir)

    def _spawn_and_store(self, repo_dir: str):
        item = None
        created = False
        try:
            item = self._spawn_process(repo_dir)
            created = True
        except Exception:
            created = False
        with self.lock:
            self.spawning = max(int(self.spawning) - 1, 0)
            if created and item is not None and self.enabled and self.repo_dir == repo_dir and len(self.ready) < self.target_size and item.alive():
                item.last_used_at = time.time()
                self.ready.append(item)
                self.stats["created"] += 1
            else:
                if created and item is not None:
                    item.kill()
                    self.stats["retired"] += 1
                if not created:
                    self.stats["spawnFailed"] += 1

    def _retire_locked(self, reason: str = "retired"):
        current = list(self.ready)
        self.ready.clear()
        self.spawning = 0
        self.stats["retired"] += len(current)
        for item in current:
            item.kill()

    def _prune_locked(self):
        kept = []
        for item in self.ready:
            if not item.alive() or item.expired():
                self.stats["retired"] += 1
                item.kill()
            else:
                kept.append(item)
        self.ready = kept

    def prewarm(self, repo_dir: str, target_ready: int, timeout_ms: int = 0, reason: str = "prewarm") -> Dict[str, Any]:
        repo_dir = str(repo_dir or "").strip()
        if not PERSISTENT_SIM_WORKER_PREWARM_ENABLED or not self.enabled or self.target_size <= 0 or not repo_dir:
            snap = self.snapshot()
            snap.update({"prewarmEnabled": bool(PERSISTENT_SIM_WORKER_PREWARM_ENABLED), "prewarmStarted": 0, "prewarmReason": reason})
            return snap
        self.configure(repo_dir=repo_dir)
        target_ready = max(min(int(target_ready or 0), int(self.target_size)), 0)
        started = 0
        deadline = time.time() + (max(int(timeout_ms or 0), 0) / 1000.0)
        while True:
            spawn_now = 0
            with self.lock:
                self._prune_locked()
                if len(self.ready) >= target_ready:
                    break
                already_planned = len(self.ready) + int(self.spawning)
                needed = max(target_ready - already_planned, 0)
                needed = min(needed, int(PERSISTENT_SIM_WORKER_PREWARM_MAX_SPAWN_BATCH))
                if needed > 0:
                    self.spawning += needed
                    started += needed
                    spawn_now = needed
            for _ in range(spawn_now):
                thread = threading.Thread(target=self._spawn_and_store, args=(repo_dir,), daemon=True)
                thread.start()
            if not timeout_ms:
                break
            if time.time() >= deadline:
                break
            with self.lock:
                if len(self.ready) >= target_ready:
                    break
            time.sleep(0.025)
        snap = self.snapshot()
        snap.update({
            "prewarmEnabled": True,
            "prewarmReason": reason,
            "prewarmTargetReady": target_ready,
            "prewarmStarted": started,
            "prewarmTimeoutMs": int(timeout_ms or 0),
        })
        return snap

    def _live_count_locked(self) -> int:
        return len(self.ready) + int(self.spawning) + int(self.checked_out)

    def _borrow_ready_locked(self) -> Optional[_PersistentSimWorkerProcess]:
        self._prune_locked()
        if not self.ready:
            return None
        item = self.ready.pop()
        self.checked_out += 1
        self.checked_out_items[id(item)] = {"item": item, "borrowedAt": time.time(), "source": "ready"}
        self.stats["borrowedPersistent"] += 1
        self.stats["reusedPersistent"] += 1
        return item

    def _record_borrow_wait_locked(self, started_at: float):
        try:
            elapsed_ms = max(int(round((time.time() - float(started_at)) * 1000)), 0)
        except Exception:
            elapsed_ms = 0
        self.stats["borrowWaitMsSamples"] += 1
        self.stats["borrowWaitMsTotal"] += elapsed_ms
        self.stats["borrowWaitMsMax"] = max(int(self.stats.get("borrowWaitMsMax") or 0), elapsed_ms)
        self.stats["lastBorrowWaitMs"] = elapsed_ms

    def _record_battle_runtime_locked(self, started_at: float):
        try:
            elapsed_ms = max(int(round((time.time() - float(started_at)) * 1000)), 0)
        except Exception:
            elapsed_ms = 0
        self.stats["battleRuntimeMsSamples"] += 1
        self.stats["battleRuntimeMsTotal"] += elapsed_ms
        self.stats["battleRuntimeMsMax"] = max(int(self.stats.get("battleRuntimeMsMax") or 0), elapsed_ms)
        self.stats["lastBattleRuntimeMs"] = elapsed_ms

    def borrow(self, repo_dir: str) -> Optional[_PersistentSimWorkerProcess]:
        borrow_started = time.time()
        repo_dir = str(repo_dir or "").strip()
        if not self.enabled or self.target_size <= 0:
            return None
        self.configure(repo_dir=repo_dir)
        with self.lock:
            item = self._borrow_ready_locked()
            if item is not None:
                self._record_borrow_wait_locked(borrow_started)
                return item

        # R6.10.0 discipline: when the warm workers are temporarily busy, wait
        # briefly for reuse instead of immediately creating an extra persistent
        # worker. This keeps 8-opponent samples from drifting from 2 warm workers
        # to 3+ workers just because several series reached the queue together.
        wait_ms = int(PERSISTENT_SIM_WORKER_BORROW_WAIT_MS if PERSISTENT_SIM_WORKER_DISCIPLINE_ENABLED else 0)
        if wait_ms > 0:
            deadline = time.time() + (wait_ms / 1000.0)
            with self.lock:
                self.stats["borrowWaits"] += 1
            while time.time() < deadline:
                with self.lock:
                    item = self._borrow_ready_locked()
                    if item is not None:
                        self._record_borrow_wait_locked(borrow_started)
                        return item
                    live_count = self._live_count_locked()
                if live_count < min(int(self.target_size), int(PERSISTENT_SIM_WORKER_DISCIPLINE_MAX_LIVE)):
                    break
                time.sleep(0.015)
            with self.lock:
                self.stats["borrowWaitTimeouts"] += 1

        with self.lock:
            live_count = self._live_count_locked()
            discipline_cap = min(int(self.target_size), int(PERSISTENT_SIM_WORKER_DISCIPLINE_MAX_LIVE))
            if PERSISTENT_SIM_WORKER_DISCIPLINE_ENABLED and live_count >= discipline_cap:
                self._record_borrow_wait_locked(borrow_started)
                return None

        try:
            item = self._spawn_process(repo_dir)
        except Exception:
            with self.lock:
                self.stats["spawnFailed"] += 1
                self._record_borrow_wait_locked(borrow_started)
            return None
        with self.lock:
            self.stats["created"] += 1
            self.stats["borrowedPersistent"] += 1
            self.stats["coldSpawnsDisciplined"] += 1
            self.checked_out += 1
            self.checked_out_items[id(item)] = {"item": item, "borrowedAt": time.time(), "source": "cold-spawn"}
            self._record_borrow_wait_locked(borrow_started)
        if item.alive():
            return item
        item.kill()
        with self.lock:
            self.checked_out_items.pop(id(item), None)
            self.checked_out = max(int(self.checked_out) - 1, 0)
            self.stats["retired"] += 1
        return None

    def release(self, item: Optional[_PersistentSimWorkerProcess], reusable: bool = True):
        if item is None:
            return
        item_key = id(item)
        with self.lock:
            was_checked_out = self.checked_out_items.pop(item_key, None) is not None
            if was_checked_out:
                self.checked_out = max(int(self.checked_out) - 1, 0)

        if not reusable or not item.alive() or item.expired() or not self.enabled or self.target_size <= 0:
            item.kill()
            with self.lock:
                self.stats["retired"] += 1
            return

        item.last_used_at = time.time()
        with self.lock:
            self._prune_locked()
            if was_checked_out and len(self.ready) < self.target_size:
                self.ready.append(item)
            else:
                item.kill()
                self.stats["retired"] += 1

    def recover_stale_checkouts(self, max_age_sec: Optional[float] = None, reason: str = "stale-checkout-finalizer") -> Dict[str, Any]:
        """Force-retire persistent simulator workers that stayed checked out too long."""
        try:
            max_age = max(float(max_age_sec if max_age_sec is not None else PERSISTENT_SIM_WORKER_STALE_CHECKOUT_SEC), 5.0)
        except Exception:
            max_age = PERSISTENT_SIM_WORKER_STALE_CHECKOUT_SEC
        now = time.time()
        recovered = []
        with self.lock:
            for key, record in list(self.checked_out_items.items()):
                borrowed_at = float(record.get("borrowedAt") or now)
                age_sec = now - borrowed_at
                if age_sec < max_age:
                    continue
                item = record.get("item")
                self.checked_out_items.pop(key, None)
                self.checked_out = max(int(self.checked_out) - 1, 0)
                self.stats["retired"] += 1
                self.stats["staleCheckoutRecoveries"] += 1
                recovered.append({
                    "ageSec": round(age_sec, 3),
                    "source": record.get("source"),
                    "pid": getattr(getattr(item, "proc", None), "pid", None),
                })
                try:
                    if item is not None:
                        item.kill()
                except Exception:
                    pass
        snap = self.snapshot()
        snap.update({
            "staleCheckoutRecovered": len(recovered),
            "staleCheckoutRecoveries": recovered,
            "staleCheckoutReason": reason,
            "staleCheckoutMaxAgeSec": max_age,
        })
        return snap

    def run_battle(self, repo_dir: str, payload: Dict[str, Any], timeout_ms: int) -> Dict[str, Any]:
        item = self.borrow(repo_dir)
        if item is None:
            with self.lock:
                self.stats["fallbacks"] += 1
            raise RuntimeError("persistent-sim-worker-unavailable")
        battle_started = time.time()
        reusable = False
        try:
            if not item.alive():
                raise RuntimeError("persistent-sim-worker-not-alive")
            request_id = f"psw-{int(time.time() * 1000)}-{random.randrange(100000, 999999)}"
            request = {"type": "battle", "requestId": request_id, **payload}
            line = json.dumps(request, separators=(",", ":")) + "\n"
            item.proc.stdin.write(line.encode("utf-8"))
            item.proc.stdin.flush()

            selector = selectors.DefaultSelector()
            selector.register(item.proc.stdout, selectors.EVENT_READ)
            deadline = time.time() + max(float(timeout_ms or 30000) / 1000.0 + 2.0, 3.0)
            buffer = bytearray()
            response = None
            try:
                while time.time() < deadline:
                    if item.proc.poll() is not None:
                        raise RuntimeError(f"persistent-sim-worker-exited:{item.proc.poll()}")
                    events = selector.select(timeout=0.1)
                    for key, _ in events:
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            continue
                        buffer.extend(chunk)
                        while b"\n" in buffer:
                            raw, buffer = buffer.split(b"\n", 1)
                            if not raw.strip():
                                continue
                            try:
                                parsed = json.loads(raw.decode("utf-8", errors="replace"))
                            except Exception:
                                continue
                            if parsed.get("requestId") == request_id:
                                response = parsed
                                break
                        if response is not None:
                            break
                    if response is not None:
                        break
            finally:
                selector.close()
            if response is None:
                raise TimeoutError("persistent-sim-worker-response-timeout")
            item.battles_run += 1
            response.setdefault("runnerVersion", BATTLE_RUNNER_VERSION)
            response.setdefault("runnerPoolMode", "persistent-sim-worker")
            response["persistentWorkerPool"] = self.snapshot()
            reusable = bool(response.get("ok")) and not bool(response.get("persistentWorkerShouldRetire"))
            if not response.get("ok"):
                with self.lock:
                    self.stats["requestFailed"] += 1
                raise RuntimeError(str(response.get("error") or response.get("timeoutSource") or "persistent-sim-worker-battle-failed")[:1000])
            return response
        finally:
            with self.lock:
                self._record_battle_runtime_locked(battle_started)
            self.release(item, reusable=reusable)

    def record_fallback(self):
        with self.lock:
            self.stats["fallbacks"] += 1

    def retire_idle(self, max_idle_sec: float, reason: str = "idle-retire") -> Dict[str, Any]:
        """Retire only workers that have been idle longer than max_idle_sec.

        This keeps quick back-to-back reports fast while letting the VPS return to a
        lower CPU/memory floor after a benchmark burst. Busy/borrowed workers are
        not tracked in ``ready`` and are therefore never killed by this method.
        """
        try:
            max_idle_sec = max(float(max_idle_sec or 0), 0.0)
        except Exception:
            max_idle_sec = 0.0
        now = time.time()
        retired = 0
        with self.lock:
            kept = []
            for item in self.ready:
                try:
                    idle_for = now - float(item.last_used_at or item.created_at or now)
                except Exception:
                    idle_for = max_idle_sec + 1.0
                if not item.alive() or item.expired() or idle_for >= max_idle_sec:
                    retired += 1
                    item.kill()
                else:
                    kept.append(item)
            self.ready = kept
            self.stats["retired"] += retired
        snap = self.snapshot()
        snap["idleRetired"] = retired
        snap["idleRetireReason"] = reason
        snap["idleRetireMaxIdleSec"] = max_idle_sec
        return snap

    def snapshot(self) -> Dict[str, Any]:
        with self.lock:
            self._prune_locked()
            checked_records = list(self.checked_out_items.values())
            now = time.time()
            oldest_checkout_sec = 0.0
            if checked_records:
                oldest_checkout_sec = max((now - float(record.get("borrowedAt") or now)) for record in checked_records)
            return {
                "enabled": bool(self.enabled),
                "targetSize": int(self.target_size),
                "ready": len(self.ready),
                "spawning": int(self.spawning),
                "checkedOut": int(self.checked_out),
                "checkedOutTracked": len(self.checked_out_items),
                "oldestCheckoutSec": round(oldest_checkout_sec, 3),
                "staleCheckoutSec": float(PERSISTENT_SIM_WORKER_STALE_CHECKOUT_SEC),
                "live": int(len(self.ready) + int(self.spawning) + int(self.checked_out)),
                "disciplineEnabled": bool(PERSISTENT_SIM_WORKER_DISCIPLINE_ENABLED),
                "disciplineMaxLive": int(PERSISTENT_SIM_WORKER_DISCIPLINE_MAX_LIVE),
                "borrowWaitMs": int(PERSISTENT_SIM_WORKER_BORROW_WAIT_MS),
                "repoDirConfigured": bool(self.repo_dir),
                "maxAgeSec": int(PERSISTENT_SIM_WORKER_MAX_AGE_SEC),
                "maxBattles": int(PERSISTENT_SIM_WORKER_MAX_BATTLES),
                **self.stats,
            }


_PERSISTENT_SIM_WORKER_POOL = PersistentSimWorkerPool()


def configure_persistent_sim_worker_pool(repo_dir: str, enabled: Optional[bool] = None, target_size: Optional[int] = None) -> Dict[str, Any]:
    _PERSISTENT_SIM_WORKER_POOL.configure(repo_dir=repo_dir, enabled=enabled, target_size=target_size)
    return _PERSISTENT_SIM_WORKER_POOL.snapshot()


def get_persistent_sim_worker_pool_snapshot() -> Dict[str, Any]:
    return _PERSISTENT_SIM_WORKER_POOL.snapshot()


def recover_stale_persistent_sim_worker_checkouts(max_age_sec: Optional[float] = None, reason: str = "stale-checkout-finalizer") -> Dict[str, Any]:
    return _PERSISTENT_SIM_WORKER_POOL.recover_stale_checkouts(max_age_sec=max_age_sec, reason=reason)


def prewarm_persistent_sim_worker_pool(repo_dir: str, target_ready: Optional[int] = None, timeout_ms: Optional[int] = None, reason: str = "prewarm") -> Dict[str, Any]:
    return _PERSISTENT_SIM_WORKER_POOL.prewarm(
        repo_dir=repo_dir,
        target_ready=PERSISTENT_SIM_WORKER_PREWARM_SIZE if target_ready is None else int(target_ready),
        timeout_ms=PERSISTENT_SIM_WORKER_PREWARM_TIMEOUT_MS if timeout_ms is None else int(timeout_ms),
        reason=reason,
    )


def retire_persistent_sim_worker_pool(reason: str = "manual-retire") -> Dict[str, Any]:
    with _PERSISTENT_SIM_WORKER_POOL.lock:
        _PERSISTENT_SIM_WORKER_POOL._retire_locked(reason=reason)
    return _PERSISTENT_SIM_WORKER_POOL.snapshot()


def retire_idle_persistent_sim_worker_pool(max_idle_sec: float, reason: str = "idle-retire") -> Dict[str, Any]:
    return _PERSISTENT_SIM_WORKER_POOL.retire_idle(max_idle_sec=max_idle_sec, reason=reason)


_WARM_BATTLE_PROCESS_POOL = WarmBattleProcessPool()


def configure_warm_runner_pool(repo_dir: str, enabled: Optional[bool] = None, target_size: Optional[int] = None) -> Dict[str, Any]:
    _WARM_BATTLE_PROCESS_POOL.configure(repo_dir=repo_dir, enabled=enabled, target_size=target_size)
    return _WARM_BATTLE_PROCESS_POOL.snapshot()


def get_warm_runner_pool_snapshot() -> Dict[str, Any]:
    return _WARM_BATTLE_PROCESS_POOL.snapshot()


def retire_warm_runner_pool(reason: str = "manual-retire") -> Dict[str, Any]:
    with _WARM_BATTLE_PROCESS_POOL.lock:
        _WARM_BATTLE_PROCESS_POOL._retire_locked(reason=reason)
    return _WARM_BATTLE_PROCESS_POOL.snapshot()


class BenchmarkSeriesRunner:
    """Per-opponent series runner. True batch reuse is disabled by default; safe per-game fallback remains active."""

    def __init__(self, repo_dir: str, format_id: str, p1_name: str, p2_name: str, p1_team: str, p2_team: str, seed_base: Optional[int] = None, metadata: Optional[Dict[str, Any]] = None, batch_enabled: Optional[bool] = None):
        self.repo_dir = repo_dir
        self.format_id = format_id
        self.p1_name = p1_name
        self.p2_name = p2_name
        self.p1_team = p1_team
        self.p2_team = p2_team
        self.metadata = metadata or {}
        self.rng = random.Random(seed_base if seed_base is not None else int(time.time() * 1000))
        self.created_at = time.time()
        self.games_started = 0
        self.process_launches = 0
        self.persistent_sim_games = 0
        self.batch_games = 0
        self.batch_fallbacks = 0
        self.batch_fail_reason = None
        self.batch_enabled = SERIES_BATCH_RUNNER_ENABLED if batch_enabled is None else bool(batch_enabled)
        self.batch_allowed_games = SERIES_BATCH_RUNNER_MAX_GAMES
        self.batch_process: Optional[subprocess.Popen] = None
        self.degraded_to_per_game = False

    def next_seed(self) -> List[int]:
        return [self.rng.randrange(1, 65535) for _ in range(4)]

    def _spawn_batch_process(self):
        self.process_launches += 1
        self.batch_process = _spawn_cold_battle_process(self.repo_dir)
        return self.batch_process

    def _retire_batch_process(self, reason: str):
        proc = self.batch_process
        if reason and not self.batch_fail_reason and proc is not None:
            self.batch_fail_reason = reason
        self.batch_process = None
        if proc is not None:
            for stream_name in ("stdin", "stdout", "stderr"):
                try:
                    stream = getattr(proc, stream_name, None)
                    if stream:
                        stream.close()
                except Exception:
                    pass
            _stop_process(proc)

    def close(self):
        self._retire_batch_process("series-runner-closed")

    def _run_per_game_fallback(self, game_number: int, timeout_ms: int, seed: List[int], fallback_reason: str, count_as_fallback: bool = True) -> Dict[str, Any]:
        if count_as_fallback:
            self.batch_fallbacks += 1
            if fallback_reason and not self.batch_fail_reason:
                self.batch_fail_reason = fallback_reason
        result = run_default_policy_battle(
            repo_dir=self.repo_dir,
            format_id=self.format_id,
            p1_name=self.p1_name,
            p2_name=self.p2_name,
            p1_team=self.p1_team,
            p2_team=self.p2_team,
            seed=seed,
            timeout_ms=timeout_ms,
        )
        runner_pool_mode = str(result.get("runnerPoolMode") or "").strip()
        if runner_pool_mode == "persistent-sim-worker":
            self.persistent_sim_games += 1
            series_mode = "persistent-sim-worker"
        else:
            self.process_launches += 1
            series_mode = "per-game-process-fallback" if count_as_fallback else "per-game-process-safe-fallback"
        result["seriesRunnerMode"] = series_mode
        result["batchEnabled"] = bool(self.batch_enabled)
        if count_as_fallback:
            result["batchFallbackReason"] = fallback_reason
        else:
            result["batchSkippedReason"] = fallback_reason
        return result

    def run_game(self, game_number: int, timeout_ms: int = 30000) -> Dict[str, Any]:
        self.games_started += 1
        seed = self.next_seed()
        use_batch = self.batch_enabled and not self.degraded_to_per_game and game_number <= self.batch_allowed_games

        if use_batch:
            try:
                proc = self.batch_process
                if proc is None or proc.poll() is not None:
                    proc = self._spawn_batch_process()
                batch_timeout_ms = min(int(timeout_ms or 30000), SERIES_BATCH_GAME_TIMEOUT_MS)
                result = _run_default_policy_battle_on_process(
                    proc=proc,
                    format_id=self.format_id,
                    p1_name=self.p1_name,
                    p2_name=self.p2_name,
                    p1_team=self.p1_team,
                    p2_team=self.p2_team,
                    seed=seed,
                    timeout_ms=batch_timeout_ms,
                    runner_pool_mode="series-batch-process",
                )
                result["seriesBatchTimeoutMs"] = batch_timeout_ms
                result["fallbackTimeoutMs"] = timeout_ms
                result["seed"] = seed
                result["gameNumber"] = game_number
                result["seriesRunnerMode"] = "series-batch-process"
                result["seriesRunnerVersion"] = BATTLE_RUNNER_VERSION
                result["seriesProcessLaunches"] = self.process_launches
                result["batchGames"] = self.batch_games + 1
                result["batchFallbacks"] = self.batch_fallbacks
                result["batchFailReason"] = self.batch_fail_reason
                if result.get("ok"):
                    self.batch_games += 1
                    if proc.poll() is not None:
                        self._retire_batch_process("batch-process-exited-after-game")
                        self.degraded_to_per_game = True
                    return result
                reason = str(result.get("failureReason") or result.get("error") or result.get("stderr") or "batch-result-not-usable")[:1000]
                self._retire_batch_process(reason)
                self.degraded_to_per_game = True
                return self._run_per_game_fallback(game_number, timeout_ms, seed, reason)
            except Exception as exc:
                reason = str(exc)[:1000] or "batch-exception"
                self._retire_batch_process(reason)
                self.degraded_to_per_game = True
                return self._run_per_game_fallback(game_number, timeout_ms, seed, reason)

        if not self.batch_enabled:
            fallback_reason = SERIES_BATCH_DISABLED_REASON
            result = self._run_per_game_fallback(game_number, timeout_ms, seed, fallback_reason, count_as_fallback=False)
        else:
            fallback_reason = self.batch_fail_reason or "batch-degraded"
            result = self._run_per_game_fallback(game_number, timeout_ms, seed, fallback_reason, count_as_fallback=True)
        result["seed"] = seed
        result["gameNumber"] = game_number
        result["seriesRunnerVersion"] = BATTLE_RUNNER_VERSION
        result["seriesProcessLaunches"] = self.process_launches
        result["batchGames"] = self.batch_games
        result["batchFallbacks"] = self.batch_fallbacks
        if self.batch_enabled:
            result["batchFailReason"] = self.batch_fail_reason or fallback_reason
        else:
            result["batchFailReason"] = self.batch_fail_reason
            result["batchSkippedReason"] = fallback_reason
        result["batchEnabled"] = bool(self.batch_enabled)
        return result

    def snapshot(self) -> Dict[str, Any]:
        if self.batch_enabled and self.batch_games > 0:
            mode = "series-batch-process"
        elif self.batch_enabled and self.degraded_to_per_game:
            mode = "per-game-process-fallback"
        elif self.batch_enabled:
            mode = "series-batch-process-ready"
        elif self.persistent_sim_games > 0 and self.process_launches <= 0:
            mode = "persistent-sim-worker"
        elif self.persistent_sim_games > 0:
            mode = "persistent-sim-worker-with-cli-fallback"
        else:
            mode = "per-game-process-safe-fallback"
        return {
            "mode": mode,
            "gamesStarted": self.games_started,
            "processLaunches": self.process_launches,
            "persistentSimGames": self.persistent_sim_games,
            "batchGames": self.batch_games,
            "batchFallbacks": self.batch_fallbacks,
            "batchFailReason": self.batch_fail_reason,
            "batchEnabled": bool(self.batch_enabled),
            "batchSkippedReason": None if self.batch_enabled else SERIES_BATCH_DISABLED_REASON,
            "batchProcessAlive": bool(self.batch_process is not None and self.batch_process.poll() is None),
            "durationMs": int(round((time.time() - self.created_at) * 1000)),
            **self.metadata,
        }


def _emit(proc: subprocess.Popen, line: str):
    if not proc.stdin:
        raise RuntimeError("Battle simulator stdin is not available.")
    proc.stdin.write((line + "\n").encode("utf-8"))
    proc.stdin.flush()


def _push_recent(target: list, value: str, limit: int = 20):
    if value is None:
        return
    value = str(value)
    if not value:
        return
    target.append(value)
    if len(target) > limit:
        del target[:-limit]


def _is_fainted(pokemon: dict) -> bool:
    if not pokemon:
        return True
    if pokemon.get("fainted") is True:
        return True
    condition = str(pokemon.get("condition") or "").lower()
    return "fnt" in condition


def _condition_hp_percent(condition):
    text = str(condition or "").lower()
    if not text:
        return None
    if "fnt" in text:
        return 0
    for token in text.split():
        if "/" not in token:
            continue
        left, right = token.split("/", 1)
        try:
            hp = float(left)
            max_hp = float(right)
        except Exception:
            continue
        if max_hp <= 0:
            continue
        return max(0, min(100, (hp / max_hp) * 100))
    return None


def _first_switchable_slot(side_pokemon, taken=None):
    taken = taken or set()
    best_slot = None
    best_score = float("-inf")
    for idx, pokemon in enumerate(side_pokemon or []):
        if idx in taken:
            continue
        if not pokemon:
            continue
        if _is_fainted(pokemon):
            continue
        if pokemon.get("active") is True:
            continue
        score = _score_switch_slot(pokemon)
        if score > best_score:
            best_slot = idx + 1
            best_score = score
    return best_slot


def _normalize_move_text(value) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _move_id_for(move: dict) -> str:
    return _normalize_move_text((move or {}).get("id") or (move or {}).get("move") or (move or {}).get("name"))


def _side_from_player(player: str):
    side = str(player or "")[:2].lower()
    return side if side in {"p1", "p2"} else None


def _active_slot_for_index(active_index: int) -> str:
    try:
        index = max(int(active_index or 0), 0)
    except Exception:
        index = 0
    return chr(ord("a") + index)


def _active_key_for(player: str, active_index: int):
    side = _side_from_player(player)
    return f"{side}{_active_slot_for_index(active_index)}" if side else None


def _create_battlebrain_state() -> dict:
    return {
        "field": {"weather": None, "terrain": None, "trickRoom": False},
        "sideConditions": {"p1": {}, "p2": {}},
        "activeMemory": {},
        "choiceMemory": [],
        "failedMemory": [],
        "lastChoiceBySlot": {},
        "lastMoveByIdent": {},
        "lastGlobalMove": None,
        "requestState": {},
        "allyPlan": {},
    }


def _ensure_battlebrain_state(state: dict) -> dict:
    if not isinstance(state, dict):
        return _create_battlebrain_state()
    brain = state.setdefault("battleBrain", _create_battlebrain_state())
    brain.setdefault("field", {"weather": None, "terrain": None, "trickRoom": False})
    side_conditions = brain.setdefault("sideConditions", {"p1": {}, "p2": {}})
    side_conditions.setdefault("p1", {})
    side_conditions.setdefault("p2", {})
    brain.setdefault("activeMemory", {})
    brain.setdefault("choiceMemory", [])
    brain.setdefault("failedMemory", [])
    brain.setdefault("lastChoiceBySlot", {})
    brain.setdefault("lastMoveByIdent", {})
    brain.setdefault("requestState", {})
    brain.setdefault("allyPlan", {})
    return brain


def _active_memory_for(state: dict, key: str) -> dict:
    if not key:
        return {}
    brain = _ensure_battlebrain_state(state)
    active_memory = brain.setdefault("activeMemory", {})
    if key not in active_memory:
        active_memory[key] = {
            "switchTurn": _context_turn(state),
            "fakeOutUsed": False,
            "protectStreak": 0,
            "protectedTurn": None,
            "lastMoveId": None,
            "lastTargetKey": None,
            "lastDamageTakenTurn": None,
            "lastDamageDealtTurn": None,
        }
    return active_memory[key]


def _trim_battlebrain_memory(brain: dict, turn: int):
    try:
        min_turn = max(0, int(turn or 0) - BATTLEBRAIN_MEMORY_TURNS)
    except Exception:
        min_turn = 0
    brain["choiceMemory"] = [entry for entry in brain.get("choiceMemory", []) if int(entry.get("turn") or 0) >= min_turn][-16:]
    brain["failedMemory"] = [entry for entry in brain.get("failedMemory", []) if int(entry.get("turn") or 0) >= min_turn][-24:]


def _memory_weight(entry: dict, turn: int) -> float:
    try:
        age = max(0, int(turn or 0) - int((entry or {}).get("turn") or 0))
    except Exception:
        age = 0
    if age > BATTLEBRAIN_MEMORY_TURNS:
        return 0
    return (BATTLEBRAIN_MEMORY_TURNS + 1 - age) / (BATTLEBRAIN_MEMORY_TURNS + 1)


def _choice_signature(player: str, active_index: int, move: dict, target_suffix: str) -> str:
    side = _side_from_player(player) or "p?"
    slot = _active_slot_for_index(active_index)
    suffix = str(target_suffix or "").strip() or "auto"
    return f"{side}{slot}:move:{_move_id_for(move)}:target:{suffix}"


def _switch_signature(player: str, switch_slot: int, active_index: int) -> str:
    side = _side_from_player(player) or "p?"
    return f"{side}{_active_slot_for_index(active_index)}:switch:{int(switch_slot or 0)}"


def _failed_choice_penalty(context: dict, signature: str, move_id: str, target_suffix: str) -> float:
    brain = _ensure_battlebrain_state(context)
    turn = _context_turn(context)
    penalty = 0
    for entry in brain.get("failedMemory", []):
        weight = _memory_weight(entry, turn)
        if weight <= 0:
            continue
        if entry.get("signature") and signature and entry.get("signature") == signature:
            penalty += 95 * weight
        if entry.get("moveId") and move_id and entry.get("moveId") == move_id:
            penalty += 35 * weight
        if entry.get("moveId") == move_id and entry.get("targetSuffix") == str(target_suffix or "").strip():
            penalty += 45 * weight
    return penalty


def _repeated_choice_penalty(context: dict, signature: str) -> float:
    brain = _ensure_battlebrain_state(context)
    turn = _context_turn(context)
    repeats = 0
    for entry in brain.get("choiceMemory", []):
        if entry.get("signature") != signature:
            continue
        weight = _memory_weight(entry, turn)
        if weight > 0:
            repeats += weight
    return min(45, repeats * 12) if repeats > 1 else 0


def _effect_id_from_parts(parts, start_index: int = 2) -> str:
    return _normalize_move_text("|".join(str(part) for part in (parts or [])[start_index:]))


def _pokemon_preview_text(pokemon: dict) -> str:
    if not pokemon:
        return ""
    moves = pokemon.get("moves")
    pieces = [
        pokemon.get("ident"),
        pokemon.get("details"),
        pokemon.get("name"),
        pokemon.get("species"),
        pokemon.get("baseSpecies"),
        pokemon.get("item"),
        pokemon.get("ability"),
        pokemon.get("condition"),
        " ".join(str(move) for move in moves) if isinstance(moves, list) else "",
    ]
    return _normalize_move_text(" ".join(str(piece) for piece in pieces if piece))


def _score_switch_slot(pokemon: dict) -> float:
    if not pokemon or _is_fainted(pokemon) or pokemon.get("active") is True:
        return float("-inf")
    text = _pokemon_preview_text(pokemon)
    condition_text = _normalize_move_text(pokemon.get("condition"))
    score = 0
    hp_percent = _condition_hp_percent(pokemon.get("condition"))

    if hp_percent is not None:
        score += hp_percent
    if "intimidate" in text:
        score += 28
    if "fakeout" in text:
        score += 22
    if "regenerator" in text:
        score += 18
    if "sitrusberry" in text or "leftovers" in text:
        score += 10
    if any(status in condition_text for status in ("par", "brn", "slp", "psn", "tox")):
        score -= 12

    return score


def _score_team_preview_slot(pokemon: dict) -> float:
    if not pokemon or _is_fainted(pokemon):
        return float("-inf")
    text = _pokemon_preview_text(pokemon)
    score = 0

    if "incineroar" in text or "rillaboom" in text or "grimmsnarl" in text:
        score += 70
    if "fakeout" in text:
        score += 72
    if "tailwind" in text or "trickroom" in text:
        score += 76
    if "icywind" in text or "electroweb" in text or "thunderwave" in text:
        score += 44
    if "intimidate" in text:
        score += 56
    if "followme" in text or "ragepowder" in text:
        score += 54
    if "wideguard" in text or "quickguard" in text:
        score += 42
    if "spore" in text or "sleeppowder" in text:
        score += 36
    if "calyrex" in text or "miraidon" in text or "koraidon" in text:
        score += 24
    if "focussash" in text or "boostenergy" in text or "choicescarf" in text:
        score += 16
    if "protect" in text:
        score += 8

    return score


def _choose_team_preview_order(pokemon) -> list:
    scored = [
        {"slot": idx + 1, "score": _score_team_preview_slot(entry)}
        for idx, entry in enumerate((pokemon or [])[:6])
    ]
    scored.sort(key=lambda entry: (-entry["score"], entry["slot"]))
    return [entry["slot"] for entry in scored]


def _normalize_forced_team_preview_slots(slots, pokemon_count: int) -> list:
    normalized = []
    for slot in list(slots or []):
        try:
            value = int(slot)
        except Exception:
            continue
        if 1 <= value <= int(pokemon_count or 0) and value not in normalized:
            normalized.append(value)
    return normalized


def _forced_team_preview_slots_for_context(context: dict = None, player: str = None, pokemon_count: int = 0) -> list:
    forced_by_player = (context or {}).get("forcedTeamPreviewSlotsByPlayer") or {}
    player_key = str(player or "")[:2].lower()
    forced = forced_by_player.get(player) or forced_by_player.get(player_key)
    return _normalize_forced_team_preview_slots(forced, pokemon_count)


def _allowed_team_preview_slots_for_context(context: dict = None, player: str = None, pokemon_count: int = 0) -> list:
    allowed_by_player = (context or {}).get("allowedTeamPreviewSlotsByPlayer") or {}
    player_key = str(player or "")[:2].lower()
    allowed = allowed_by_player.get(player) or allowed_by_player.get(player_key)
    return _normalize_forced_team_preview_slots(allowed, pokemon_count)


def _build_team_preview_choice(request: dict, context: dict = None, player: str = None) -> str:
    side = request.get("side") or {}
    pokemon = side.get("pokemon") or []
    bring = int(request.get("maxChosenTeamSize") or request.get("maxTeamSize") or min(len(pokemon), 4) or 4)
    order = _choose_team_preview_order(pokemon)
    forced = _forced_team_preview_slots_for_context(context, player, len(pokemon))
    if forced:
        order = forced + [slot for slot in order if slot not in forced]
    else:
        allowed = _allowed_team_preview_slots_for_context(context, player, len(pokemon))
        if allowed:
            allowed_set = set(allowed)
            order = [slot for slot in order if slot in allowed_set] + [slot for slot in order if slot not in allowed_set]
    chosen = order[:bring]
    return "team " + ", ".join(str(x) for x in chosen)


def _build_force_switch_choice(request: dict) -> str:
    side = request.get("side") or {}
    pokemon = side.get("pokemon") or []
    force_switch = request.get("forceSwitch") or []
    choices = []
    taken = set()

    for must_switch in force_switch:
        if not must_switch:
            choices.append("pass")
            continue

        slot = _first_switchable_slot(pokemon, taken=taken)
        if slot is None:
            choices.append("pass")
            continue

        taken.add(slot - 1)
        choices.append(f"switch {slot}")

    return ", ".join(choices) if choices else "default"


def _is_spread_move(move: dict) -> bool:
    target = str((move or {}).get("target") or "").strip()
    return target in {"allAdjacent", "allAdjacentFoes"}


def _context_turn(context: dict = None) -> int:
    try:
        return int((context or {}).get("turns") or (context or {}).get("turn") or 0)
    except Exception:
        return 0


def _speed_control_already_active(move_id: str, context: dict = None, player: str = None) -> bool:
    brain = _ensure_battlebrain_state(context)
    side = _side_from_player(player)
    if move_id == "trickroom":
        return bool((brain.get("field") or {}).get("trickRoom"))
    if move_id == "tailwind":
        return bool(side and ((brain.get("sideConditions") or {}).get(side) or {}).get("tailwind"))
    return False


def _score_deterministic_move(move: dict, active_count: int, context: dict = None, options: dict = None) -> float:
    if not move or move.get("disabled"):
        return float("-inf")

    options = options or {}
    move_id = _move_id_for(move)
    category = str(move.get("category") or "").lower()
    turn = _context_turn(context)
    player = options.get("player")
    active_index = int(options.get("activeIndex") or 0)
    target_suffix = options.get("targetSuffix")
    if target_suffix is None:
        target_suffix = _target_suffix_for_move(move, active_index, context, player)
    active_key = _active_key_for(player, active_index)
    memory = _active_memory_for(context, active_key) if active_key else {}
    signature = _choice_signature(player, active_index, move, target_suffix)
    try:
        base_power = int(move.get("basePower") or 0)
    except Exception:
        base_power = 0

    score = 0
    if category and category != "status":
        score += 100
    if base_power > 0:
        score += base_power
    if _is_spread_move(move) and active_count > 1:
        score += 20 if base_power >= 55 else 8

    if move_id in FAKE_OUT_MOVE_IDS:
        try:
            switch_turn = int(memory.get("switchTurn") or 0)
        except Exception:
            switch_turn = 0
        fake_out_window_open = turn <= 1 or (switch_turn > 0 and turn - switch_turn <= 1)
        score += 145 if fake_out_window_open and not memory.get("fakeOutUsed") else -260
    if move_id in PROTECT_MOVE_IDS:
        score += 18 if turn <= 1 else -35
        try:
            score -= min(220, int(memory.get("protectStreak") or 0) * 95)
        except Exception:
            pass
        if memory.get("protectedTurn") == turn - 1:
            score -= 45
    if move_id in {"tailwind", "trickroom"}:
        score += 78 if turn <= 3 else 36
        if _speed_control_already_active(move_id, context, player):
            score -= 120
    if move_id in {"icywind", "electroweb"}:
        score += 64
    if move_id in {"thunderwave", "willowisp", "nuzzle"}:
        score += 42
    if move_id in {"spore", "sleeppowder"}:
        score += 70
    if move_id in {"followme", "ragepowder"}:
        score += 62
    if move_id in {"wideguard", "quickguard"}:
        score += 54
    if move_id in {"helpinghand"}:
        score += 48
    if move_id in {"splash", "celebrate", "happyhour", "holdhands"}:
        score -= 200

    score -= _failed_choice_penalty(context, signature, move_id, target_suffix)
    score -= _repeated_choice_penalty(context, signature)

    return score


def _choose_deterministic_move(moves, active_count: int, context: dict = None, options: dict = None):
    options = options or {}
    best = None
    best_score = float("-inf")
    for idx, move in enumerate(moves or [], start=1):
        target_suffix = _target_suffix_for_move(move, int(options.get("activeIndex") or 0), context, options.get("player"))
        score = _score_deterministic_move(move, active_count, context, {**options, "targetSuffix": target_suffix})
        if score > best_score:
            best = (idx, move)
            best_score = score
    return best


def _parse_battle_ident(ident):
    raw = str(ident or "")
    if ":" in raw:
        side_slot, name = raw.split(":", 1)
    else:
        side_slot, name = raw, ""
    side_slot = side_slot.strip().lower()
    if len(side_slot) < 2 or side_slot[:2] not in {"p1", "p2"}:
        return None
    slot = side_slot[2:3] or "a"
    return {"side": side_slot[:2], "slot": slot, "name": name.strip()}


def _ident_key(parsed: dict):
    if not parsed or not parsed.get("side"):
        return None
    return f"{parsed.get('side')}{parsed.get('slot') or 'a'}"


def _side_from_side_condition_ident(value: str):
    raw = str(value or "").strip().lower()
    return raw[:2] if raw[:2] in {"p1", "p2"} else None


def _record_move_line(parts, state: dict):
    parsed = _parse_battle_ident(parts[2] if len(parts) > 2 else "")
    if not parsed:
        return
    key = _ident_key(parsed)
    move_id = _normalize_move_text(parts[3] if len(parts) > 3 else "")
    target = _parse_battle_ident(parts[4] if len(parts) > 4 else "")
    target_key = _ident_key(target)
    turn = _context_turn(state)
    memory = _active_memory_for(state, key)
    brain = _ensure_battlebrain_state(state)
    last_choice = (brain.get("lastChoiceBySlot") or {}).get(key)
    entry = {
        "actorKey": key,
        "actorSide": parsed.get("side"),
        "moveId": move_id,
        "targetKey": target_key,
        "targetSuffix": last_choice.get("targetSuffix") if isinstance(last_choice, dict) and last_choice.get("moveId") == move_id else "",
        "signature": last_choice.get("signature") if isinstance(last_choice, dict) and last_choice.get("moveId") == move_id else None,
        "turn": turn,
    }
    memory["lastMoveId"] = move_id
    memory["lastTargetKey"] = target_key
    if move_id in PROTECT_MOVE_IDS:
        memory["protectStreak"] = int(memory.get("protectStreak") or 0) + 1
        memory["protectedTurn"] = turn
    else:
        memory["protectStreak"] = 0
    if move_id in FAKE_OUT_MOVE_IDS:
        memory["fakeOutUsed"] = True
    if move_id in SPEED_CONTROL_MOVE_IDS or move_id in REDIRECTION_MOVE_IDS or move_id in GUARD_MOVE_IDS or move_id in SUPPORT_MOVE_IDS:
        brain.setdefault("allyPlan", {})[key] = {"moveId": move_id, "targetKey": target_key, "turn": turn}
    brain.setdefault("lastMoveByIdent", {})[key] = entry
    brain["lastGlobalMove"] = entry


def _mark_failed_memory(state: dict, source: dict = None, reason: str = "failed"):
    brain = _ensure_battlebrain_state(state)
    turn = _context_turn(state)
    entry = source or brain.get("lastGlobalMove")
    if not entry:
        return
    brain.setdefault("failedMemory", []).append({
        "signature": entry.get("signature"),
        "moveId": entry.get("moveId"),
        "targetKey": entry.get("targetKey"),
        "targetSuffix": entry.get("targetSuffix") or "",
        "reason": reason,
        "turn": turn,
    })
    _trim_battlebrain_memory(brain, turn)


def _update_known_hp(parsed: dict, condition: str, state: dict):
    key = _ident_key(parsed)
    if not key:
        return
    active_by_side = state.setdefault("activeBySide", {"p1": {}, "p2": {}})
    side_state = active_by_side.setdefault(parsed["side"], {})
    current = side_state.get(parsed["slot"], {})
    hp_percent = _condition_hp_percent(condition)
    side_state[parsed["slot"]] = {
        **current,
        "name": parsed.get("name") or current.get("name"),
        "condition": condition or current.get("condition") or "",
        "hpPercent": hp_percent,
        "fainted": hp_percent == 0 or current.get("fainted") is True,
    }
    _active_memory_for(state, key)["lastDamageTakenTurn"] = _context_turn(state)
    brain = _ensure_battlebrain_state(state)
    last_global = brain.get("lastGlobalMove")
    if last_global and last_global.get("actorKey"):
        _active_memory_for(state, last_global.get("actorKey"))["lastDamageDealtTurn"] = _context_turn(state)


def _update_field_state(parts, state: dict):
    event = parts[1] if len(parts) > 1 else ""
    brain = _ensure_battlebrain_state(state)
    effect = _effect_id_from_parts(parts, 2)
    if event == "-weather":
        brain.setdefault("field", {})["weather"] = effect if effect and "none" not in effect else None
    elif event == "-fieldstart":
        if "trickroom" in effect:
            brain.setdefault("field", {})["trickRoom"] = True
        if any(name in effect for name in ("electricterrain", "grassyterrain", "mistyterrain", "psychicterrain")):
            brain.setdefault("field", {})["terrain"] = effect
    elif event == "-fieldend":
        if "trickroom" in effect:
            brain.setdefault("field", {})["trickRoom"] = False
        if "terrain" in effect:
            brain.setdefault("field", {})["terrain"] = None
    elif event in {"-sidestart", "-sideend"}:
        side = _side_from_side_condition_ident(parts[2] if len(parts) > 2 else "")
        if not side:
            return
        side_state = brain.setdefault("sideConditions", {"p1": {}, "p2": {}}).setdefault(side, {})
        active = event == "-sidestart"
        if "tailwind" in effect:
            side_state["tailwind"] = active
        if "reflect" in effect:
            side_state["reflect"] = active
        if "lightscreen" in effect:
            side_state["lightScreen"] = active
        if "auroraveil" in effect:
            side_state["auroraVeil"] = active
        if "safeguard" in effect:
            side_state["safeguard"] = active
        if "mist" in effect:
            side_state["mist"] = active


def _update_board_state_from_line(line: str, state: dict):
    if not isinstance(state, dict):
        return
    parts = str(line or "").split("|")
    if len(parts) < 3:
        return
    event = parts[1]
    brain = _ensure_battlebrain_state(state)
    if event == "turn":
        try:
            state["turns"] = int(parts[2])
            _trim_battlebrain_memory(brain, state["turns"])
        except Exception:
            pass
        return
    if event == "move":
        _record_move_line(parts, state)
        return
    if event in {"-damage", "-heal"}:
        parsed = _parse_battle_ident(parts[2] if len(parts) > 2 else "")
        if parsed:
            _update_known_hp(parsed, parts[3] if len(parts) > 3 else "", state)
        return
    if event in {"-status", "-curestatus"}:
        parsed = _parse_battle_ident(parts[2] if len(parts) > 2 else "")
        if parsed:
            memory = _active_memory_for(state, _ident_key(parsed))
            memory["status"] = _normalize_move_text(parts[3] if len(parts) > 3 else "") if event == "-status" else None
        return
    if event in {"-weather", "-fieldstart", "-fieldend", "-sidestart", "-sideend"}:
        _update_field_state(parts, state)
        return
    if event == "-fail":
        parsed = _parse_battle_ident(parts[2] if len(parts) > 2 else "")
        key = _ident_key(parsed)
        _mark_failed_memory(state, (brain.get("lastMoveByIdent") or {}).get(key), "fail")
        return
    if event == "-miss":
        parsed = _parse_battle_ident(parts[2] if len(parts) > 2 else "")
        key = _ident_key(parsed)
        _mark_failed_memory(state, (brain.get("lastMoveByIdent") or {}).get(key), "miss")
        return
    if event == "-immune":
        _mark_failed_memory(state, brain.get("lastGlobalMove"), "immune")
        return
    if event == "-activate" and "protect" in _effect_id_from_parts(parts, 3):
        protected = _parse_battle_ident(parts[2] if len(parts) > 2 else "")
        protected_key = _ident_key(protected)
        if protected_key:
            _active_memory_for(state, protected_key)["protectedTurn"] = _context_turn(state)
        last_global = brain.get("lastGlobalMove")
        if last_global and last_global.get("actorKey") != protected_key:
            _mark_failed_memory(state, last_global, "protected")
        return
    if event == "cant":
        parsed = _parse_battle_ident(parts[2] if len(parts) > 2 else "")
        key = _ident_key(parsed)
        _mark_failed_memory(state, (brain.get("lastMoveByIdent") or {}).get(key), "cant")
        return
    if event not in {"switch", "drag", "faint"}:
        return
    parsed = _parse_battle_ident(parts[2])
    if not parsed:
        return
    active_by_side = state.setdefault("activeBySide", {"p1": {}, "p2": {}})
    side_state = active_by_side.setdefault(parsed["side"], {})
    current = side_state.get(parsed["slot"], {})
    if event == "faint":
        side_state[parsed["slot"]] = {
            **current,
            "name": parsed["name"] or current.get("name"),
            "hpPercent": 0,
            "fainted": True,
        }
        return
    key = _ident_key(parsed)
    memory = _active_memory_for(state, key)
    memory["switchTurn"] = _context_turn(state)
    memory["fakeOutUsed"] = False
    memory["protectStreak"] = 0
    memory["protectedTurn"] = None
    condition = parts[4] if len(parts) > 4 else ""
    side_state[parsed["slot"]] = {
        "name": parsed["name"],
        "details": parts[3] if len(parts) > 3 else "",
        "condition": condition,
        "hpPercent": _condition_hp_percent(condition),
        "fainted": False,
    }


def _foe_side_for_player(player: str):
    side = str(player or "")[:2].lower()
    if side == "p1":
        return "p2"
    if side == "p2":
        return "p1"
    return None


def _target_failure_penalty(context: dict = None, move_id: str = "", target_suffix: str = "") -> float:
    brain = _ensure_battlebrain_state(context)
    turn = _context_turn(context)
    penalty = 0
    for entry in brain.get("failedMemory", []):
        weight = _memory_weight(entry, turn)
        if weight <= 0:
            continue
        if entry.get("moveId") == move_id and entry.get("targetSuffix") == str(target_suffix or "").strip():
            penalty += 80 * weight
    return penalty


def _preferred_foe_target_suffix(context: dict = None, player: str = None, move: dict = None) -> str:
    foe_side = _foe_side_for_player(player)
    active_by_side = (context or {}).get("activeBySide") or {}
    foes = active_by_side.get(foe_side) if foe_side else None
    if not isinstance(foes, dict):
        return " +1"
    move_id = _move_id_for(move)
    ranked = []
    for idx, slot in enumerate(("a", "b"), start=1):
        entry = foes.get(slot)
        if not isinstance(entry, dict) or entry.get("fainted"):
            continue
        hp_percent = entry.get("hpPercent")
        try:
            hp_percent = float(hp_percent)
        except Exception:
            hp_percent = 100
        suffix = f" +{idx}"
        ranked.append({
            "slot": slot,
            "suffix": suffix,
            "hpPercent": hp_percent,
            "memoryPenalty": _target_failure_penalty(context, move_id, suffix.strip()),
        })
    if len(ranked) < 2:
        return ranked[0]["suffix"] if ranked else " +1"
    for entry in ranked:
        entry["targetScore"] = entry["hpPercent"] + entry["memoryPenalty"]
    ranked.sort(key=lambda entry: (entry["targetScore"], entry["slot"]))
    return ranked[0]["suffix"] if ranked[0]["targetScore"] + 15 <= ranked[1]["targetScore"] else " +1"


def _target_suffix_for_move(move: dict, active_index: int, context: dict = None, player: str = None) -> str:
    target = str((move or {}).get("target") or "").strip()

    if target in {
        "", "self", "all", "allAdjacent", "allAdjacentFoes", "allySide",
        "foeSide", "scripted", "randomNormal",
    }:
        return ""

    if target in {"normal", "adjacentFoe", "any"}:
        return _preferred_foe_target_suffix(context, player, move)

    if target == "adjacentAlly":
        return " -2" if active_index == 0 else " -1"

    if target == "adjacentAllyOrSelf":
        return ""

    return ""


def _is_actionable_active_slot(pokemon: dict) -> bool:
    if not pokemon:
        return False
    if pokemon.get("active") is not True:
        return False
    if pokemon.get("reviving"):
        return False
    # Commander Tatsugiri remains listed as active, but it is inside Dondozo and cannot act.
    # Showdown expects no move token for that slot; sending one causes
    # "You sent more choices than unfainted Pokemon" during Full Regulation sweeps.
    if pokemon.get("commanding"):
        return False
    return not _is_fainted(pokemon)


def _build_active_move_choice(request: dict, context: dict = None, player: str = None) -> str:
    active = request.get("active") or []
    side = request.get("side") or {}
    side_pokemon = side.get("pokemon") or []
    active_slot_states = [pokemon for pokemon in side_pokemon if pokemon and pokemon.get("active") is True]
    active_count = len(active_slot_states) or len(active)

    choices = []
    for active_index, mon in enumerate(active):
        slot_state = active_slot_states[active_index] if active_index < len(active_slot_states) else None

        # Showdown can still include an entry in request.active for a slot whose active Pokémon
        # has fainted. In that state, the simulator expects fewer move choices, not an extra
        # "pass" token, otherwise it errors with "You sent more choices than unfainted Pokémon."
        if slot_state is not None and not _is_actionable_active_slot(slot_state):
            continue

        if not mon:
            continue

        selected_move = _choose_deterministic_move(
            mon.get("moves") or [],
            active_count,
            context,
            {"player": player, "activeIndex": active_index},
        )
        if selected_move:
            idx, move = selected_move
            suffix = _target_suffix_for_move(move, active_index, context, player)
            selected = f"move {idx}{suffix}"
        else:
            selected = "move 1"
        choices.append(selected)
    return ", ".join(choices) if choices else "default"


def _build_choice_from_request(request: dict, context: dict = None, player: str = None) -> str:
    if request.get("wait"):
        return ""
    if request.get("teamPreview"):
        return _build_team_preview_choice(request, context, player)
    force_switch = request.get("forceSwitch")
    if isinstance(force_switch, list) and any(force_switch):
        return _build_force_switch_choice(request)
    if request.get("active"):
        return _build_active_move_choice(request, context, player)
    return "default"


def _parse_end_payload(lines):
    if not lines:
        return None

    first = lines[0].strip()
    if first.startswith("end "):
        raw = first[len("end "):].strip()
        if raw:
            return json.loads(raw)

    if first == "end" and len(lines) > 1:
        raw = "\n".join(lines[1:]).strip()
        if raw:
            return json.loads(raw)

    return None


def _split_choice_tokens(choice: str) -> list:
    return [part.strip() for part in str(choice or "").split(",") if part.strip()]


def _parse_team_preview_choice_slots(choice: str) -> list:
    raw = str(choice or "").strip()
    if raw.lower().startswith("team "):
        raw = raw[5:]
    slots = []
    for token in _split_choice_tokens(raw):
        try:
            value = int(token)
        except Exception:
            continue
        if value not in slots:
            slots.append(value)
    return slots


def _remember_choice_from_request(state: dict, player: str, request: dict, choice: str):
    if not isinstance(state, dict) or not isinstance(request, dict) or not choice:
        return
    brain = _ensure_battlebrain_state(state)
    turn = _context_turn(state)
    brain.setdefault("requestState", {})[player] = {
        "turn": turn,
        "teamPreview": bool(request.get("teamPreview")),
        "forceSwitch": list(request.get("forceSwitch") or []) if isinstance(request.get("forceSwitch"), list) else [],
        "activeCount": len(request.get("active") or []) if isinstance(request.get("active"), list) else 0,
    }

    if request.get("teamPreview"):
        state.setdefault("teamPreviewChoices", {})[player] = _parse_team_preview_choice_slots(choice)

    if request.get("active"):
        active = request.get("active") or []
        side = request.get("side") or {}
        side_pokemon = side.get("pokemon") or []
        active_slot_states = [pokemon for pokemon in side_pokemon if pokemon and pokemon.get("active") is True]
        tokens = _split_choice_tokens(choice)
        token_index = 0
        for active_index, mon in enumerate(active):
            slot_state = active_slot_states[active_index] if active_index < len(active_slot_states) else None
            if slot_state is not None and not _is_actionable_active_slot(slot_state):
                continue
            token = tokens[token_index] if token_index < len(tokens) else ""
            token_index += 1
            pieces = token.split()
            if len(pieces) < 2 or pieces[0].lower() != "move":
                continue
            try:
                move_index = int(pieces[1]) - 1
            except Exception:
                continue
            moves = mon.get("moves") if isinstance(mon, dict) else []
            move = moves[move_index] if isinstance(moves, list) and 0 <= move_index < len(moves) else None
            if not move:
                continue
            target_suffix = " ".join(pieces[2:]).strip()
            key = _active_key_for(player, active_index)
            entry = {
                "signature": _choice_signature(player, active_index, move, target_suffix),
                "moveId": _move_id_for(move),
                "targetSuffix": target_suffix,
                "turn": turn,
                "token": token,
            }
            if key:
                brain.setdefault("lastChoiceBySlot", {})[key] = entry
            brain.setdefault("choiceMemory", []).append(entry)
    elif isinstance(request.get("forceSwitch"), list) and any(request.get("forceSwitch")):
        for active_index, token in enumerate(_split_choice_tokens(choice)):
            pieces = token.split()
            if len(pieces) < 2 or pieces[0].lower() != "switch":
                continue
            try:
                switch_slot = int(pieces[1])
            except Exception:
                continue
            brain.setdefault("choiceMemory", []).append({
                "signature": _switch_signature(player, switch_slot, active_index),
                "moveId": "switch",
                "targetSuffix": "",
                "turn": turn,
                "token": token,
            })
    _trim_battlebrain_memory(brain, turn)


def _process_sideupdate(lines, proc: subprocess.Popen, state: dict):
    if not lines:
        return

    player = lines[1].strip() if len(lines) > 1 else ""
    body_lines = lines[2:] if len(lines) > 2 else []

    if not player:
        _push_recent(state["debugEvents"], "sideupdate-missing-player", limit=30)
        return

    for line in body_lines:
        if line.startswith("|request|"):
            raw = line[len("|request|"):]
            try:
                request = json.loads(raw)
            except Exception as exc:
                _push_recent(state["debugEvents"], f"request-json-error:{exc}", limit=30)
                continue

            choice = _build_choice_from_request(request, state, player=player)
            if not choice:
                _push_recent(state["debugEvents"], f"request-wait:{player}", limit=30)
                continue

            _emit(proc, f">{player} {choice}")
            state["requestsHandled"] += 1
            state["lastChoice"] = choice
            _remember_choice_from_request(state, player, request, choice)
            _push_recent(state["debugEvents"], f"choice:{player}:{choice}", limit=30)


def _process_message(message: str, proc: subprocess.Popen, state: dict):
    if not message:
        return

    _push_recent(state["recentMessages"], message, limit=20)

    lines = message.split("\n")
    header = lines[0].strip()

    if header == "sideupdate":
        _process_sideupdate(lines, proc, state)
        return

    if header.startswith("sideupdate "):
        player = header.split(" ", 1)[1].strip()
        body_lines = lines[1:]
        for line in body_lines:
            if line.startswith("|request|"):
                raw = line[len("|request|"):]
                try:
                    request = json.loads(raw)
                except Exception as exc:
                    _push_recent(state["debugEvents"], f"request-json-error:{exc}", limit=30)
                    continue
                choice = _build_choice_from_request(request, state, player=player)
                if not choice:
                    _push_recent(state["debugEvents"], f"request-wait:{player}", limit=30)
                    continue
                _emit(proc, f">{player} {choice}")
                state["requestsHandled"] += 1
                state["lastChoice"] = choice
                _remember_choice_from_request(state, player, request, choice)
                _push_recent(state["debugEvents"], f"choice:{player}:{choice}", limit=30)
        return

    if header == "update":
        for line in lines[1:]:
            if line.startswith("|"):
                state.setdefault("battleLogLines", []).append(line)
            _update_board_state_from_line(line, state)
            if line.startswith("|turn|"):
                try:
                    state["turns"] = int(line.split("|")[2])
                except Exception:
                    pass
            elif line.startswith("|win|"):
                try:
                    state["winner"] = line.split("|")[2]
                    _push_recent(state["debugEvents"], f"winner:{state['winner']}", limit=30)
                except Exception:
                    pass
            elif line == "|tie" or line.startswith("|tie|"):
                state["tie"] = True
                _push_recent(state["debugEvents"], "tie", limit=30)
        return

    if header == "end" or header.startswith("end "):
        try:
            end_json = _parse_end_payload(lines)
            if end_json is None:
                raise ValueError("No end payload found.")
            state["end"] = end_json
            if end_json.get("winner"):
                state["winner"] = end_json.get("winner")
                state["tie"] = False
            if isinstance(end_json.get("turns"), int):
                state["turns"] = end_json.get("turns")
            if state["winner"] is not None:
                state["tie"] = False
            state["ended"] = True
            _push_recent(state["debugEvents"], f"end:{state['winner']}:{state['turns']}", limit=30)
        except Exception as exc:
            _push_recent(state["debugEvents"], f"end-parse-error:{exc}", limit=30)
        return


def _summarize_debug(state: dict, stderr_text: str = "") -> str:
    recent_messages = state.get("recentMessages") or []
    debug_events = state.get("debugEvents") or []
    stderr_tail = stderr_text[-2000:] if stderr_text else ""
    parts = [
        f"Last choice: {state.get('lastChoice')!r}.",
        f"Requests handled: {state.get('requestsHandled', 0)}.",
    ]
    if debug_events:
        parts.append("Recent debug events: " + " || ".join(debug_events[-8:]))
    if recent_messages:
        trimmed = recent_messages[-4:]
        parts.append("Recent simulator messages: " + " ||||| ".join(trimmed))
    if stderr_tail:
        parts.append("Recent stderr: " + stderr_tail)
    return " ".join(parts)


def _drain_available_output(proc: subprocess.Popen, timeout_ms: int, state: dict):
    selector = selectors.DefaultSelector()
    stdout_buffer = bytearray()
    stderr_buffer = bytearray()
    last_activity = time.time()

    if proc.stdout:
        selector.register(proc.stdout, selectors.EVENT_READ, data="stdout")
    if proc.stderr:
        selector.register(proc.stderr, selectors.EVENT_READ, data="stderr")

    while True:
        if state["ended"]:
            break

        if proc.poll() is not None:
            while b"\n\n" in stdout_buffer:
                block, stdout_buffer = stdout_buffer.split(b"\n\n", 1)
                text = block.decode("utf-8", errors="replace").rstrip("\n")
                if text:
                    _process_message(text, proc, state)
            if stdout_buffer:
                text = stdout_buffer.decode("utf-8", errors="replace").rstrip("\n")
                if text:
                    _process_message(text, proc, state)
                stdout_buffer = bytearray()
            break

        now = time.time()
        if (now - last_activity) * 1000 > timeout_ms:
            stderr_text = stderr_buffer.decode("utf-8", errors="replace")
            debug_summary = _summarize_debug(state, stderr_text)
            elapsed_ms = int(round((now - state.get("battleStartedAt", last_activity)) * 1000))
            state["timeoutSource"] = "battle_runner_no_completed_result"
            state["elapsedMs"] = elapsed_ms
            raise TimeoutError(
                f"Battle simulation timeout source=battle_runner_no_completed_result thresholdMs={timeout_ms} elapsedMs={elapsed_ms}. {debug_summary}"
            )

        events = selector.select(timeout=0.1)
        if not events:
            continue

        for key, _ in events:
            stream_type = key.data
            chunk = os.read(key.fileobj.fileno(), 65536)
            if not chunk:
                continue

            last_activity = time.time()

            if stream_type == "stderr":
                stderr_buffer.extend(chunk)
                stderr_text = chunk.decode("utf-8", errors="replace").strip()
                if stderr_text:
                    _push_recent(state["recentStderr"], stderr_text, limit=20)
                continue

            stdout_buffer.extend(chunk)
            while b"\n\n" in stdout_buffer:
                block, stdout_buffer = stdout_buffer.split(b"\n\n", 1)
                text = block.decode("utf-8", errors="replace").rstrip("\n")
                if text:
                    _process_message(text, proc, state)

    selector.close()
    return stderr_buffer.decode("utf-8", errors="replace")


def _spawn_cold_battle_process(repo_dir: str) -> subprocess.Popen:
    return subprocess.Popen(
        ["node", "pokemon-showdown", "simulate-battle"],
        cwd=repo_dir,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        bufsize=0,
    )


def _run_default_policy_battle_on_process(
    proc: subprocess.Popen,
    format_id: str,
    p1_name: str,
    p2_name: str,
    p1_team: str,
    p2_team: str,
    seed: Optional[List[int]] = None,
    timeout_ms: int = 30000,
    runner_pool_mode: str = "series-batch-process",
):
    """Run one battle on an already-started simulate-battle process."""
    if proc is None or proc.poll() is not None:
        raise RuntimeError("Series batch process is not alive before battle start.")

    battle_started_at = time.time()
    start_payload = {"formatid": format_id}
    if seed:
        start_payload["seed"] = seed

    _emit(proc, f">start {json.dumps(start_payload, separators=(',', ':'))}")
    _emit(proc, f">player p1 {json.dumps({'name': p1_name, 'team': p1_team}, separators=(',', ':'))}")
    _emit(proc, f">player p2 {json.dumps({'name': p2_name, 'team': p2_team}, separators=(',', ':'))}")

    state = {
        "winner": None,
        "turns": 0,
        "tie": False,
        "ended": False,
        "end": None,
        "requestsHandled": 0,
        "lastChoice": None,
        "recentMessages": [],
        "recentStderr": [],
        "debugEvents": [],
        "battleLogLines": [],
        "activeBySide": {"p1": {}, "p2": {}},
        "battleBrain": _create_battlebrain_state(),
        "battleStartedAt": battle_started_at,
        "timeoutSource": None,
        "elapsedMs": None,
    }

    stderr_text = _drain_available_output(proc, timeout_ms, state)
    duration_ms = int(round((time.time() - battle_started_at) * 1000))
    return {
        "ok": bool(state["winner"] is not None or state["tie"]),
        "winner": state["winner"],
        "turns": state["turns"],
        "tie": bool(state["tie"] and state["winner"] is None),
        "end": state["end"],
        "requestsHandled": state["requestsHandled"],
        "lastChoice": state["lastChoice"],
        "returnCode": proc.poll(),
        "durationMs": duration_ms,
        "timeoutMs": timeout_ms,
        "timeoutSource": state.get("timeoutSource"),
        "stderr": stderr_text,
        "recentMessages": state["recentMessages"][-6:],
        "recentDebugEvents": state["debugEvents"][-10:],
        "battleLogData": "\n".join(state.get("battleLogLines") or []),
        "runnerVersion": BATTLE_RUNNER_VERSION,
        "runnerPoolMode": runner_pool_mode,
        "warmRunnerPool": get_warm_runner_pool_snapshot(),
        "policy": "V3 BattleBrain visible-state and anti-repeat memory policy",
        "policyVersion": "r6.20.10r-policy-v3-battlebrain-memory",
    }


def run_default_policy_battle(
    repo_dir: str,
    format_id: str,
    p1_name: str,
    p2_name: str,
    p1_team: str,
    p2_team: str,
    seed: Optional[List[int]] = None,
    timeout_ms: int = 30000,
    p1_forced_team_preview_slots: Optional[List[int]] = None,
    p1_allowed_team_preview_slots: Optional[List[int]] = None,
):
    persistent_fallback_reason = None
    forced_p1_slots = _normalize_forced_team_preview_slots(p1_forced_team_preview_slots, 6)
    allowed_p1_slots = _normalize_forced_team_preview_slots(p1_allowed_team_preview_slots, 6)
    if PERSISTENT_SIM_WORKER_ENABLED:
        try:
            persistent_payload = {
                "formatId": format_id,
                "p1Name": p1_name,
                "p2Name": p2_name,
                "p1Team": p1_team,
                "p2Team": p2_team,
                "seed": seed,
                "timeoutMs": timeout_ms,
            }
            if forced_p1_slots:
                persistent_payload["forcedTeamPreviewSlotsByPlayer"] = {"p1": forced_p1_slots}
            if allowed_p1_slots:
                persistent_payload["allowedTeamPreviewSlotsByPlayer"] = {"p1": allowed_p1_slots}
            persistent_result = _PERSISTENT_SIM_WORKER_POOL.run_battle(
                repo_dir=repo_dir,
                payload=persistent_payload,
                timeout_ms=timeout_ms,
            )
            persistent_result["runnerVersion"] = BATTLE_RUNNER_VERSION
            persistent_result["runnerPoolMode"] = "persistent-sim-worker"
            persistent_result["persistentSimWorkerEnabled"] = True
            persistent_result["persistentSimWorkerFallbackReason"] = None
            return persistent_result
        except Exception as exc:
            persistent_fallback_reason = str(exc or "persistent-sim-worker-failed")[:1000]
            _PERSISTENT_SIM_WORKER_POOL.record_fallback()
            if not PERSISTENT_SIM_WORKER_FALLBACK_ENABLED:
                raise

    battle_started_at = time.time()
    warm_item, runner_pool_mode = _WARM_BATTLE_PROCESS_POOL.borrow(repo_dir)
    if warm_item is not None and warm_item.alive():
        proc = warm_item.proc
    else:
        warm_item = None
        proc = _spawn_cold_battle_process(repo_dir)
        runner_pool_mode = "cold"

    start_payload = {"formatid": format_id}
    if seed:
        start_payload["seed"] = seed

    _emit(proc, f">start {json.dumps(start_payload, separators=(',', ':'))}")
    _emit(proc, f">player p1 {json.dumps({'name': p1_name, 'team': p1_team}, separators=(',', ':'))}")
    _emit(proc, f">player p2 {json.dumps({'name': p2_name, 'team': p2_team}, separators=(',', ':'))}")

    state = {
        "winner": None,
        "turns": 0,
        "tie": False,
        "ended": False,
        "end": None,
        "requestsHandled": 0,
        "lastChoice": None,
        "recentMessages": [],
        "recentStderr": [],
        "debugEvents": [],
        "battleLogLines": [],
        "teamPreviewChoices": {},
        "forcedTeamPreviewSlotsByPlayer": {"p1": forced_p1_slots} if forced_p1_slots else {},
        "allowedTeamPreviewSlotsByPlayer": {"p1": allowed_p1_slots} if allowed_p1_slots else {},
        "activeBySide": {"p1": {}, "p2": {}},
        "battleBrain": _create_battlebrain_state(),
        "battleStartedAt": battle_started_at,
        "timeoutSource": None,
        "elapsedMs": None,
    }

    stderr_text = ""
    return_code = None
    try:
        stderr_text = _drain_available_output(proc, timeout_ms, state)

        if state["ended"] or state["winner"] is not None or state["tie"]:
            # Once the simulator has emitted the battle result, do not spend extra user-facing
            # time waiting for the Node process to exit naturally. A short grace period keeps
            # normal cleanup cheap, then we terminate the completed simulator process.
            try:
                return_code = proc.wait(timeout=0.25)
            except subprocess.TimeoutExpired:
                return_code = proc.poll()
                if return_code is None:
                    proc.terminate()
                    try:
                        return_code = proc.wait(timeout=0.75)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        return_code = proc.wait(timeout=1)
        else:
            return_code = proc.wait(timeout=5)

        duration_ms = int(round((time.time() - battle_started_at) * 1000))
        return {
            "ok": bool(state["winner"] is not None or state["tie"]),
            "winner": state["winner"],
            "turns": state["turns"],
            "tie": bool(state["tie"] and state["winner"] is None),
            "end": state["end"],
            "requestsHandled": state["requestsHandled"],
            "lastChoice": state["lastChoice"],
            "returnCode": return_code,
            "durationMs": duration_ms,
            "timeoutMs": timeout_ms,
            "timeoutSource": state.get("timeoutSource"),
            "stderr": stderr_text,
            "recentMessages": state["recentMessages"][-6:],
            "recentDebugEvents": state["debugEvents"][-10:],
            "battleLogData": "\n".join(state.get("battleLogLines") or []),
            "teamPreviewChoices": state.get("teamPreviewChoices") or {},
            "forcedTeamPreviewSlots": {"p1": forced_p1_slots} if forced_p1_slots else {},
            "forcedTeamPreviewApplied": bool(forced_p1_slots),
            "allowedTeamPreviewSlots": {"p1": allowed_p1_slots} if allowed_p1_slots else {},
            "allowedTeamPreviewApplied": bool(allowed_p1_slots),
            "runnerVersion": BATTLE_RUNNER_VERSION,
            "runnerPoolMode": runner_pool_mode,
            "warmRunnerPool": get_warm_runner_pool_snapshot(),
            "persistentSimWorkerEnabled": bool(PERSISTENT_SIM_WORKER_ENABLED),
            "persistentSimWorkerFallbackReason": persistent_fallback_reason,
            "persistentWorkerPool": get_persistent_sim_worker_pool_snapshot(),
            "policy": "V3 BattleBrain visible-state and anti-repeat memory policy",
            "policyVersion": "r6.20.10r-policy-v3-battlebrain-memory",
        }
    finally:
        try:
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            if proc.stdout:
                proc.stdout.close()
        except Exception:
            pass
        try:
            if proc.stderr:
                proc.stderr.close()
        except Exception:
            pass
        if proc.poll() is None:
            _stop_process(proc)
        if warm_item is not None:
            _WARM_BATTLE_PROCESS_POOL.retire_used(warm_item)
        else:
            _WARM_BATTLE_PROCESS_POOL.ensure_target()


def run_default_policy_series(
    repo_dir: str,
    format_id: str,
    p1_name: str,
    p2_name: str,
    p1_team: str,
    p2_team: str,
    games: int = 5,
    timeout_ms: int = 30000,
    seed_base: Optional[int] = None,
):
    games = max(int(games or 1), 1)
    rng = random.Random(seed_base if seed_base is not None else int(time.time()))
    results = []

    for index in range(games):
        seed = [rng.randrange(1, 65535) for _ in range(4)]
        result = run_default_policy_battle(
            repo_dir=repo_dir,
            format_id=format_id,
            p1_name=p1_name,
            p2_name=p2_name,
            p1_team=p1_team,
            p2_team=p2_team,
            seed=seed,
            timeout_ms=timeout_ms,
        )
        result["seed"] = seed
        result["gameNumber"] = index + 1
        results.append(result)

    return results
