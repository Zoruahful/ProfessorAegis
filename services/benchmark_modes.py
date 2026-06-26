import hashlib
import os
from benchmark_opponents import OPPONENT_LIBRARY
from benchmark_repo_teams import (
    get_repo_opponent_records,
    get_repo_opponents,
    get_repo_summary,
    hydrate_repo_opponent_records,
)

BENCHMARK_MODES_VERSION = "2026.05.10-benchmark-modes-v7-no-custom-fallback"
CHAMPIONLAB_OPPONENT_SOURCE = "championslab-public-source"

MODE_S_TIER_TOP = "s-tier-top-tournament"
MODE_SA_TIER_TOP4 = "sa-tier-top4-tournament"
MODE_ALL_META_TOURNAMENT = "all-meta-all-tournament"
MODE_FULL_META_RANDOM_100 = "full-meta-random-100"
MODE_GAUNTLET_FULL_META_200 = "gauntlet-full-meta-200"
MODE_CUSTOM_ONLY = "custom-only"

CHAMPIONLAB_TARGET_COUNTS = {
    MODE_S_TIER_TOP: 271,
    MODE_SA_TIER_TOP4: 545,
    MODE_ALL_META_TOURNAMENT: 1050,
    MODE_FULL_META_RANDOM_100: 1150,
    MODE_GAUNTLET_FULL_META_200: 1250,
}

CHAMPIONLAB_BENCHMARK_MODES = [
    MODE_S_TIER_TOP,
    MODE_SA_TIER_TOP4,
    MODE_ALL_META_TOURNAMENT,
    MODE_FULL_META_RANDOM_100,
    MODE_GAUNTLET_FULL_META_200,
]

BENCHMARK_MODE_ALIASES = {
    "featured-only": MODE_S_TIER_TOP,
    "full-reg": MODE_ALL_META_TOURNAMENT,
    "random-sample": MODE_FULL_META_RANDOM_100,
}


def _normalize_benchmark_mode(mode: str | None = None) -> str:
    value = str(mode or "").strip().lower()
    normalized = BENCHMARK_MODE_ALIASES.get(value) or value
    if normalized in CHAMPIONLAB_BENCHMARK_MODES:
        return normalized
    if normalized == MODE_CUSTOM_ONLY and _custom_only_mode_enabled():
        return normalized
    return MODE_S_TIER_TOP


def _custom_only_mode_enabled() -> bool:
    return str(os.getenv("BENCHMARK_ENABLE_CUSTOM_ONLY_MODE", "0") or "0").strip().lower() in {"1", "true", "yes", "on"}


def _stable_rng_seed(*parts) -> int:
    joined = "||".join(str(part or "") for part in parts)
    digest = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    return int(digest[:16], 16)




def _full_reg_hydration_chunk_size() -> int:
    raw = str(os.getenv("BENCHMARK_FULL_REG_HYDRATION_CHUNK_SIZE", "32") or "32").strip()
    try:
        return max(int(raw), 1)
    except Exception:
        return 32


def _hydrate_records_in_chunks(records: list[dict], format_id: str | None = None, chunk_size: int | None = None) -> list[dict]:
    records = list(records or [])
    if not records:
        return []
    size = max(int(chunk_size or _full_reg_hydration_chunk_size()), 1)
    hydrated = []
    for start in range(0, len(records), size):
        hydrated.extend(hydrate_repo_opponent_records(records[start:start + size], format_id))
    return hydrated

def _custom_opponents_for_format(format_id: str | None = None) -> list[dict]:
    if not _custom_only_mode_enabled():
        return []
    fmt = str(format_id or "").strip().lower() or None
    out = []
    for item in OPPONENT_LIBRARY:
        item_fmt = str(item.get("formatId") or "").strip().lower()
        if fmt and item_fmt not in {"", fmt}:
            continue
        out.append(dict(item))
    return out


def _parse_requested_size(sample_size: int | None) -> int | None:
    if sample_size is None:
        return None
    try:
        return max(int(sample_size), 1)
    except Exception:
        return None


def _championlab_target_count(mode: str | None = None) -> int | None:
    return CHAMPIONLAB_TARGET_COUNTS.get(_normalize_benchmark_mode(mode))


def _available_championlab_count(mode: str | None, executable_count: int) -> int:
    target = _championlab_target_count(mode)
    if not target:
        return max(int(executable_count or 0), 0)
    return min(max(int(executable_count or 0), 0), int(target))


def _championlab_recommended_sizes(mode: str | None, executable_count: int) -> list[int]:
    available = _available_championlab_count(mode, executable_count)
    return [available] if available else []


def _selection_semantics_for_mode(mode: str | None) -> str:
    chosen = _normalize_benchmark_mode(mode)
    if chosen == MODE_FULL_META_RANDOM_100:
        return "championlab-full-meta-plus-100-generated-random"
    if chosen == MODE_GAUNTLET_FULL_META_200:
        return "championlab-full-meta-plus-200-generated-random"
    if chosen == MODE_ALL_META_TOURNAMENT:
        return "championlab-all-curated-plus-all-tournament"
    if chosen in {MODE_S_TIER_TOP, MODE_SA_TIER_TOP4}:
        return "championlab-curated-tier-plus-tournament-placement"
    return "custom-selection"


def list_benchmark_modes(format_id: str | None = None) -> list[dict]:
    repo_summary = get_repo_summary(format_id=format_id)
    team_count = int(repo_summary.get("teamCount") or 0)

    modes = [
        {
            "mode": MODE_S_TIER_TOP,
            "label": "S-Tier + Top Tournament",
            "source": CHAMPIONLAB_OPPONENT_SOURCE,
            "description": "ChampionsLab S-tier curated teams plus top 2 tournament finishes.",
            "targetOpponentCount": CHAMPIONLAB_TARGET_COUNTS[MODE_S_TIER_TOP],
            "availableOpponents": _available_championlab_count(MODE_S_TIER_TOP, team_count),
            "recommendedSizes": _championlab_recommended_sizes(MODE_S_TIER_TOP, team_count),
            "selectionSemantics": _selection_semantics_for_mode(MODE_S_TIER_TOP),
        },
        {
            "mode": MODE_SA_TIER_TOP4,
            "label": "S/A Tier + Top 4 Tournament",
            "source": CHAMPIONLAB_OPPONENT_SOURCE,
            "description": "ChampionsLab S/A curated teams plus top 4 tournament finishes.",
            "targetOpponentCount": CHAMPIONLAB_TARGET_COUNTS[MODE_SA_TIER_TOP4],
            "availableOpponents": _available_championlab_count(MODE_SA_TIER_TOP4, team_count),
            "recommendedSizes": _championlab_recommended_sizes(MODE_SA_TIER_TOP4, team_count),
            "selectionSemantics": _selection_semantics_for_mode(MODE_SA_TIER_TOP4),
        },
        {
            "mode": MODE_ALL_META_TOURNAMENT,
            "label": "All Meta + All Tournament",
            "source": CHAMPIONLAB_OPPONENT_SOURCE,
            "description": "ChampionsLab curated meta teams plus all tournament teams.",
            "targetOpponentCount": CHAMPIONLAB_TARGET_COUNTS[MODE_ALL_META_TOURNAMENT],
            "availableOpponents": _available_championlab_count(MODE_ALL_META_TOURNAMENT, team_count),
            "recommendedSizes": _championlab_recommended_sizes(MODE_ALL_META_TOURNAMENT, team_count),
            "selectionSemantics": _selection_semantics_for_mode(MODE_ALL_META_TOURNAMENT),
        },
        {
            "mode": MODE_FULL_META_RANDOM_100,
            "label": "Full Meta + 100 Random",
            "source": CHAMPIONLAB_OPPONENT_SOURCE,
            "description": "ChampionsLab full meta pool plus 100 generated random teams.",
            "targetOpponentCount": CHAMPIONLAB_TARGET_COUNTS[MODE_FULL_META_RANDOM_100],
            "availableOpponents": _available_championlab_count(MODE_FULL_META_RANDOM_100, team_count),
            "recommendedSizes": _championlab_recommended_sizes(MODE_FULL_META_RANDOM_100, team_count),
            "selectionSemantics": _selection_semantics_for_mode(MODE_FULL_META_RANDOM_100),
        },
        {
            "mode": MODE_GAUNTLET_FULL_META_200,
            "label": "GAUNTLET - Full Meta + 200 Random",
            "source": CHAMPIONLAB_OPPONENT_SOURCE,
            "description": "ChampionsLab full meta pool plus 200 generated random teams.",
            "targetOpponentCount": CHAMPIONLAB_TARGET_COUNTS[MODE_GAUNTLET_FULL_META_200],
            "availableOpponents": _available_championlab_count(MODE_GAUNTLET_FULL_META_200, team_count),
            "recommendedSizes": _championlab_recommended_sizes(MODE_GAUNTLET_FULL_META_200, team_count),
            "selectionSemantics": _selection_semantics_for_mode(MODE_GAUNTLET_FULL_META_200),
        },
    ]
    if _custom_only_mode_enabled():
        custom_count = len(_custom_opponents_for_format(format_id=format_id))
        modes.append({
            "mode": MODE_CUSTOM_ONLY,
            "label": "Custom only",
            "source": "professor-aegis-custom",
            "description": "Use only the hand-picked Professor Aegis custom opponents.",
            "availableOpponents": custom_count,
            "recommendedSizes": [size for size in (1, 2, 4) if size <= custom_count] or ([custom_count] if custom_count else []),
        })
    return modes


def resolve_benchmark_mode_selection(
    format_id: str | None = None,
    mode: str = MODE_S_TIER_TOP,
    sample_size: int | None = None,
    sample_seed: str | None = None,
):
    chosen_mode = _normalize_benchmark_mode(mode)

    requested_size = _parse_requested_size(sample_size)
    repo_summary = get_repo_summary(format_id=format_id)
    total_repo_opponents = int(repo_summary.get("teamCount") or 0)

    selection_seed = None
    available_opponents = 0

    if chosen_mode in CHAMPIONLAB_TARGET_COUNTS:
        target_count = CHAMPIONLAB_TARGET_COUNTS[chosen_mode]
        available_opponents = _available_championlab_count(chosen_mode, total_repo_opponents)
        candidate_records = get_repo_opponent_records(format_id=format_id, featured_only=False, limit=None)
        candidate_records = candidate_records[: min(target_count, len(candidate_records))]
        selected = []
    elif chosen_mode == MODE_CUSTOM_ONLY:
        selected = _custom_opponents_for_format(format_id=format_id)
        available_opponents = len(selected)
        if requested_size:
            selected = selected[: min(requested_size, len(selected))]
        target_count = None
        candidate_records = []
    else:
        target_count = None
        available_opponents = total_repo_opponents
        candidate_records = get_repo_opponent_records(format_id=format_id, featured_only=False, limit=requested_size)
        selected = hydrate_repo_opponent_records(candidate_records, format_id)

    is_championlab_fixed_pool = chosen_mode in CHAMPIONLAB_TARGET_COUNTS
    is_full_reg_sweep = chosen_mode in {MODE_ALL_META_TOURNAMENT, MODE_FULL_META_RANDOM_100, MODE_GAUNTLET_FULL_META_200}
    sample_size_ignored = bool(is_championlab_fixed_pool)
    return {
        "mode": chosen_mode,
        "formatId": format_id or None,
        "requestedSampleSize": None if sample_size_ignored else requested_size,
        "sampleSizeIgnored": sample_size_ignored,
        "selectionSeed": selection_seed,
        "availableOpponents": available_opponents,
        "totalRegulationOpponents": total_repo_opponents if is_full_reg_sweep else None,
        "selectedOpponentRecords": list(candidate_records) if is_championlab_fixed_pool else None,
        "selectedOpponents": selected,
        "selectedCount": (len(candidate_records) if is_championlab_fixed_pool else len(selected)),
        "targetOpponentCount": target_count,
        "targetCountReached": bool(target_count and len(candidate_records) >= target_count),
        "selectionSemantics": _selection_semantics_for_mode(chosen_mode),
        "lazyHydration": bool(is_championlab_fixed_pool),
        "sweepMode": bool(is_full_reg_sweep),
        "sweepModeLabel": f"{chosen_mode}-sweep" if is_full_reg_sweep else None,
        "opponentSource": CHAMPIONLAB_OPPONENT_SOURCE if is_championlab_fixed_pool else None,
        "excludesUserTeams": bool(is_championlab_fixed_pool),
        "hydrationChunkSize": _full_reg_hydration_chunk_size() if is_championlab_fixed_pool else None,
    }


def build_benchmark_mode_plan(
    format_id: str | None = None,
    priority_templates: list[str] | None = None,
):
    repo_summary = get_repo_summary(format_id=format_id)
    featured_count = int(repo_summary.get("featuredCount") or 0)
    team_count = int(repo_summary.get("teamCount") or 0)
    reg = repo_summary.get("reg")

    quick_size = 4 if featured_count >= 4 else featured_count
    mid_size = 16 if team_count >= 16 else team_count
    full_size = team_count

    plans = []
    if quick_size:
        plans.append(
            {
                "id": f"s-tier-top-{quick_size}",
                "label": f"S-Tier + Top Tournament ({quick_size})",
                "mode": MODE_S_TIER_TOP,
                "sampleSize": quick_size,
                "reg": reg,
                "why": "Fast check against ChampionsLab S-tier curated and top tournament teams.",
            }
        )
    if mid_size:
        plans.append(
            {
                "id": f"full-meta-random-100-{mid_size}",
                "label": "Full Meta + 100 Random",
                "mode": MODE_FULL_META_RANDOM_100,
                "sampleSize": 100,
                "reg": reg,
                "why": "Broader ChampionsLab full meta coverage plus generated random teams.",
            }
        )
    if full_size:
        plans.append(
            {
                "id": f"all-meta-all-tournament-{full_size}",
                "label": f"All Meta + All Tournament ({full_size})",
                "mode": MODE_ALL_META_TOURNAMENT,
                "sampleSize": full_size,
                "reg": reg,
                "why": "ChampionsLab curated meta teams plus all tournament teams.",
            }
        )

    if priority_templates:
        plans.append(
            {
                "id": "template-priority",
                "label": "Template-priority follow-up",
                "mode": "template-priority",
                "sampleSize": None,
                "reg": reg,
                "priorityTemplates": list(priority_templates),
                "why": "Use the structural read to focus on shakier matchup styles first.",
            }
        )

    return {
        "version": BENCHMARK_MODES_VERSION,
        "reg": reg,
        "plans": plans,
    }
