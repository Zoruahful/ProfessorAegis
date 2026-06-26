import json
import re
import html
from datetime import datetime, timezone
from itertools import combinations

from benchmark_templates import (
    ARCHETYPE_TEMPLATES,
    TEMPLATE_LIBRARY_VERSION,
    get_template_by_key,
    normalize_template_keys,
)
from benchmark_opponents import get_opponents_for_template, get_opponent_by_id, OPPONENT_LIBRARY_VERSION
from benchmark_modes import (
    BENCHMARK_MODES_VERSION,
    build_benchmark_mode_plan,
    list_benchmark_modes,
)
from benchmark_advice import ADVICE_LIBRARY_VERSION, THEME_LABELS, get_matchup_advice

ENGINE_VERSION = "2026.04.26-python-engine-v15-full-reg-sweep-summary"

LEAD_PAIR_SWEEP_PROFILE = {
    "profileId": "aegis-lead-pair-sweep-v1",
    "gamesPerPair": 25,
    "seriesLength": "BO1",
    "pairGeneration": "all-6c2",
    "sampleSource": "aegis-controlled-approved-pool",
}

CORE_SWEEP_PROFILE = {
    "profileId": "aegis-core-sweep-v1",
    "gamesPerCore": 25,
    "seriesLength": "BO1",
    "coreGeneration": "all-6c4",
    "sampleSource": "aegis-controlled-approved-pool",
}

LEAD_PAIR_PRE_SCORE_FINALIST_LIMIT = 5
CORE_SWEEP_PRE_SCORE_FINALIST_LIMIT = 2


def clean_text(value):
    return str(value or "").strip()


MOVE_PATTERNS = {
    "trick_room": re.compile(r"^(trick room)$", re.I),
    "tailwind": re.compile(r"^(tailwind)$", re.I),
    "fake_out": re.compile(r"^(fake out)$", re.I),
    "redirection": re.compile(r"^(follow me|rage powder)$", re.I),
    "protect": re.compile(r"^(protect|detect|spiky shield|baneful bunker|silk trap|burning bulwark|obstruct)$", re.I),
    "priority": re.compile(r"^(sucker punch|aqua jet|ice shard|shadow sneak|extreme speed|mach punch|jet punch|vacuum wave|grassy glide)$", re.I),
    "speed_control": re.compile(r"^(tailwind|trick room|icy wind|electroweb|thunder wave|string shot|bulldoze|scary face)$", re.I),
    "pivot": re.compile(r"^(u-turn|volt switch|parting shot|flip turn|baton pass)$", re.I),
    "setup": re.compile(r"^(nasty plot|swords dance|dragon dance|bulk up|calm mind|quiver dance|belly drum|curse)$", re.I),
    "spread": re.compile(r"^(rock slide|heat wave|dazzling gleam|hyper voice|earthquake|discharge|blizzard|eruption|surf|snarl|bleakwind storm|icy wind|electroweb|muddy water|expanding force|make it rain)$", re.I),
    "disruption": re.compile(r"^(taunt|encore|haze|clear smog|disable|will-o-wisp|thunder wave|spore|yawn)$", re.I),
    "wide_guard": re.compile(r"^(wide guard)$", re.I),
    "helping_hand": re.compile(r"^(helping hand)$", re.I),
    "weather": re.compile(r"^(rain dance|sunny day|sandstorm|snowscape)$", re.I),
    "terrain": re.compile(r"^(electric terrain|grassy terrain|misty terrain|psychic terrain)$", re.I),
}

ITEM_PATTERNS = {
    "sash": re.compile(r"focus sash", re.I),
    "scarf": re.compile(r"choice scarf", re.I),
    "specs": re.compile(r"choice specs", re.I),
    "band": re.compile(r"choice band", re.I),
    "assault_vest": re.compile(r"assault vest", re.I),
    "booster": re.compile(r"booster energy", re.I),
    "eviolite": re.compile(r"eviolite", re.I),
    "life_orb": re.compile(r"life orb", re.I),
}

ABILITY_PATTERNS = {
    "intimidate": re.compile(r"^intimidate$", re.I),
    "prankster": re.compile(r"^prankster$", re.I),
    "drizzle": re.compile(r"^drizzle$", re.I),
    "drought": re.compile(r"^drought$", re.I),
    "armor_tail": re.compile(r"^armor tail$", re.I),
}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_move(line):
    return re.sub(r"^- ", "", str(line or "")).strip()


def parse_header_species(header_line):
    raw = str(header_line or "").split(" @ ")[0].strip()
    if not raw:
        return "Unknown"
    if "(" in raw and ")" in raw:
        last_open = raw.rfind("(")
        last_close = raw.rfind(")")
        if last_open >= 0 and last_close > last_open:
            inside = raw[last_open + 1:last_close].strip()
            return inside or raw
    return raw


def parse_team_export(team_export):
    normalized = str(team_export or "").replace("\r\n", "\n").strip()
    blocks = [block.strip() for block in re.split(r"\n\s*\n", normalized) if block.strip()]
    pokemon = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        header = lines[0] if lines else ""
        species = parse_header_species(header)
        item = header.split(" @ ", 1)[1].strip() if " @ " in header else None
        ability_line = next((line for line in lines if re.match(r"^Ability:", line, re.I)), "")
        ability = re.sub(r"^Ability:\s*", "", ability_line, flags=re.I).strip() if ability_line else None
        moves = [normalize_move(line) for line in lines if line.startswith("- ")]
        pokemon.append(
            {"header": header, "species": species, "item": item, "ability": ability, "moves": moves, "lines": lines}
        )
    team_names = [mon["species"] for mon in pokemon if mon.get("species")][:6]
    return {"normalized": normalized, "pokemon": pokemon, "teamNames": team_names}


def get_lead_pair_sweep_profile():
    return dict(LEAD_PAIR_SWEEP_PROFILE)


def get_core_sweep_profile():
    return dict(CORE_SWEEP_PROFILE)


def _lead_pair_pokemon_summary(mon, slot):
    mon = dict(mon or {})
    species = clean_text(mon.get("species") or mon.get("name") or f"Slot {slot}")
    return {
        "slot": int(slot),
        "name": species,
        "species": species,
        "types": [],
    }


def build_lead_pair_sweep_candidates(team_export):
    parsed = parse_team_export(team_export)
    pokemon = list(parsed.get("pokemon") or [])[:6]
    candidates = []
    for left_index, right_index in combinations(range(len(pokemon)), 2):
        left = _lead_pair_pokemon_summary(pokemon[left_index], left_index + 1)
        right = _lead_pair_pokemon_summary(pokemon[right_index], right_index + 1)
        candidates.append(
            {
                "pairId": f"lead-{left_index + 1:02d}-{right_index + 1:02d}",
                "pairIndexes": [left_index, right_index],
                "pair": [left, right],
                "label": f"{left['species']} + {right['species']}",
            }
        )
    return candidates


def _sweep_candidate_id(prefix, indexes):
    return f"{prefix}-" + "-".join(f"{int(index) + 1:02d}" for index in indexes)


def _sweep_candidate_members(pokemon, indexes):
    return [_lead_pair_pokemon_summary(pokemon[index], index + 1) for index in indexes]


def _sweep_candidate_label(members):
    return " + ".join(clean_text(mon.get("species") or mon.get("name") or f"Slot {mon.get('slot')}") for mon in members)


def build_core_sweep_candidates(team_export):
    parsed = parse_team_export(team_export)
    pokemon = list(parsed.get("pokemon") or [])[:6]
    candidates = []
    for indexes in combinations(range(len(pokemon)), 4):
        members = _sweep_candidate_members(pokemon, indexes)
        candidates.append(
            {
                "coreId": _sweep_candidate_id("core", indexes),
                "coreIndexes": list(indexes),
                "core": members,
                "label": _sweep_candidate_label(members),
            }
        )
    return candidates


SWEEP_PRE_SCORE_RULES = (
    ("tailwind", "hasTailwind", 8, "Tailwind speed control"),
    ("trick_room", "hasTrickRoom", 8, "Trick Room speed control"),
    ("fake_out", "hasFakeOut", 6, "Fake Out pressure"),
    ("redirection", "hasRedirection", 5, "redirection support"),
    ("wide_guard", "hasWideGuard", 5, "Wide Guard coverage"),
    ("prankster", "hasPrankster", 4, "Prankster utility"),
    ("intimidate", "hasIntimidate", 4, "Intimidate support"),
    ("spread", "hasSpread", 4, "spread damage"),
    ("disruption", "hasDisruption", 4, "disruption"),
    ("pivot", "hasPivot", 3, "pivoting"),
    ("priority", "hasPriority", 3, "priority cleanup"),
    ("setup", "hasSetup", 3, "setup pressure"),
    ("helping_hand", "hasHelpingHand", 2, "Helping Hand support"),
    ("weather", "hasWeather", 2, "weather control"),
    ("terrain", "hasTerrain", 2, "terrain control"),
    ("protect", "hasProtect", 1, "Protect coverage"),
)


def _sweep_role_tags(profile):
    tags = []
    for key, attr, _weight, _label in SWEEP_PRE_SCORE_RULES:
        if profile.get(attr):
            tags.append(key)
    if profile.get("isAttacker"):
        tags.append("attacker")
    return tags


def _score_sweep_profiles(profiles, candidate_kind):
    score = 0
    reasons = []
    role_keys = set()
    attacker_count = sum(1 for profile in profiles if profile.get("isAttacker"))
    protect_count = sum(1 for profile in profiles if profile.get("hasProtect"))
    has_speed_mode = any(profile.get("hasTailwind") or profile.get("hasTrickRoom") for profile in profiles)
    has_turn_one_control = any(
        profile.get("hasFakeOut")
        or profile.get("hasPrankster")
        or profile.get("hasDisruption")
        or profile.get("hasIntimidate")
        for profile in profiles
    )
    has_defensive_support = any(
        profile.get("hasRedirection")
        or profile.get("hasWideGuard")
        or profile.get("hasArmorTail")
        for profile in profiles
    )

    for profile in profiles:
        for key, attr, weight, label in SWEEP_PRE_SCORE_RULES:
            if not profile.get(attr):
                continue
            score += weight if key not in role_keys else max(1, weight // 2)
            role_keys.add(key)
            push_unique(reasons, label)
        if profile.get("isAttacker"):
            score += 4
            push_unique(reasons, "immediate damage")

    if has_speed_mode and attacker_count:
        score += 6
        push_unique(reasons, "speed control plus damage")
    if has_turn_one_control and (has_speed_mode or attacker_count >= 2):
        score += 4
        push_unique(reasons, "turn-one control")
    if has_defensive_support and attacker_count:
        score += 3
        push_unique(reasons, "protected damage plan")
    if protect_count >= min(2, len(profiles)):
        score += 2
        push_unique(reasons, "multiple Protect users")

    if candidate_kind == "core":
        if attacker_count >= 2:
            score += 5
            push_unique(reasons, "two or more attackers")
        if has_speed_mode and has_turn_one_control and has_defensive_support:
            score += 5
            push_unique(reasons, "complete four-Pokemon game plan")
        if len(role_keys) >= 5:
            score += 3
            push_unique(reasons, "role diversity")
    else:
        if not has_speed_mode and not has_turn_one_control:
            score -= 4
            push_unique(reasons, "limited opening control")
        if attacker_count == 0:
            score -= 4
            push_unique(reasons, "low immediate pressure")

    return {"score": score, "reasons": reasons[:5], "roleKeys": sorted(role_keys)}


def _rank_sweep_pre_score_candidates(team_export, candidates, candidate_kind, finalist_limit):
    parsed = parse_team_export(team_export)
    pokemon = list(parsed.get("pokemon") or [])[:6]
    finalist_limit = max(0, int(finalist_limit or 0))
    rows = []

    for candidate in list(candidates or []):
        indexes = list(candidate.get("pairIndexes") or candidate.get("coreIndexes") or [])
        profiles = [build_mon_profile(pokemon[index]) for index in indexes if 0 <= int(index) < len(pokemon)]
        scored = _score_sweep_profiles(profiles, candidate_kind)
        role_tags = [
            {"slot": int(index) + 1, "species": pokemon[index].get("species"), "roles": _sweep_role_tags(profile)}
            for index, profile in zip(indexes, profiles)
            if 0 <= int(index) < len(pokemon)
        ]
        row = dict(candidate)
        row.update(
            {
                "preScore": int(scored["score"]),
                "preScoreReasons": scored["reasons"],
                "preScoreRoleKeys": scored["roleKeys"],
                "preScoreRoleTags": role_tags,
                "preScoreCandidateKind": candidate_kind,
                "preScoreFinalistLimit": finalist_limit,
                "selectedForBattle": False,
                "preScoreRank": None,
            }
        )
        rows.append(row)

    ranked_rows = sorted(
        rows,
        key=lambda row: (
            -int(row.get("preScore") or 0),
            tuple(int(index) for index in (row.get("pairIndexes") or row.get("coreIndexes") or [])),
            clean_text(row.get("label")).lower(),
        ),
    )
    for rank, row in enumerate(ranked_rows, 1):
        row["preScoreRank"] = rank
        row["selectedForBattle"] = rank <= finalist_limit
    return ranked_rows


def select_sweep_pre_score_finalists(ranked_candidates, finalist_limit):
    finalist_limit = max(0, int(finalist_limit or 0))
    return [dict(row) for row in list(ranked_candidates or []) if row.get("selectedForBattle")][:finalist_limit]


def build_lead_pair_pre_score_candidates(team_export, finalist_limit=LEAD_PAIR_PRE_SCORE_FINALIST_LIMIT):
    return _rank_sweep_pre_score_candidates(
        team_export,
        build_lead_pair_sweep_candidates(team_export),
        "lead-pair",
        finalist_limit,
    )


def build_lead_pair_pre_score_finalists(team_export, finalist_limit=LEAD_PAIR_PRE_SCORE_FINALIST_LIMIT):
    return select_sweep_pre_score_finalists(build_lead_pair_pre_score_candidates(team_export, finalist_limit), finalist_limit)


def build_core_pre_score_candidates(team_export, finalist_limit=CORE_SWEEP_PRE_SCORE_FINALIST_LIMIT):
    return _rank_sweep_pre_score_candidates(
        team_export,
        build_core_sweep_candidates(team_export),
        "core",
        finalist_limit,
    )


def build_core_pre_score_finalists(team_export, finalist_limit=CORE_SWEEP_PRE_SCORE_FINALIST_LIMIT):
    return select_sweep_pre_score_finalists(build_core_pre_score_candidates(team_export, finalist_limit), finalist_limit)


def _lead_pair_game_result(game):
    value = clean_text((game or {}).get("result") or (game or {}).get("verdict")).lower()
    if value in {"win", "loss", "tie"}:
        return value
    if (game or {}).get("tie") and not (game or {}).get("winner"):
        return "tie"
    winner = clean_text((game or {}).get("winner")).lower()
    if winner == "professor aegis user":
        return "win"
    if winner == "benchmark opponent":
        return "loss"
    return "unknown"


def _sweep_matchup_key_label(game, raw=None):
    game = game if isinstance(game, dict) else {}
    raw = raw if isinstance(raw, dict) else {}
    metadata = _sweep_matchup_archetype_metadata(game, raw)
    if metadata:
        label = clean_text(metadata.get("displayLabel") or metadata.get("primaryLabel"))
        key = clean_text(metadata.get("primaryKey") or _slug_key(label))
        if key and label:
            return key, label, metadata
    key = clean_text(
        game.get("templateKey")
        or game.get("opponentTemplate")
        or game.get("opponentArchetype")
        or raw.get("templateKey")
        or raw.get("opponentTemplate")
        or raw.get("opponentArchetype")
        or game.get("opponentName")
        or raw.get("opponentName")
    )
    label = clean_text(
        game.get("templateLabel")
        or game.get("opponentArchetype")
        or raw.get("templateLabel")
        or raw.get("opponentArchetype")
        or game.get("opponentName")
        or raw.get("opponentName")
        or key
    )
    if not key:
        key = _slug_key(label or "unknown-matchup")
    if not label:
        label = prettify_template_name(key)
    if _is_generic_sweep_matchup_label(label) or _is_generic_sweep_matchup_label(key):
        return key, "", None
    return key, label, None


def _sweep_matchup_archetype_metadata(game=None, raw=None):
    for source in (game if isinstance(game, dict) else {}, raw if isinstance(raw, dict) else {}):
        for field in ("archetypeMetadata", "opponentArchetypeMetadata", "matchupArchetypeMetadata", "templateArchetypeMetadata"):
            metadata = source.get(field)
            if not isinstance(metadata, dict):
                continue
            label = clean_text(metadata.get("displayLabel") or metadata.get("primaryLabel"))
            key = clean_text(metadata.get("primaryKey"))
            if label and not _is_generic_sweep_matchup_label(label):
                copied = dict(metadata)
                if key:
                    copied["primaryKey"] = key
                copied["displayLabel"] = label
                copied.setdefault("primaryLabel", label)
                return copied
    return None


def _is_generic_sweep_matchup_label(value):
    normalized = re.sub(r"[_-]+", " ", clean_text(value).lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return True
    if normalized in {
        "unknown",
        "unknown matchup",
        "unknown template",
        "unlabeled matchup",
        "unlabeled matchup style",
        "opponent",
        "benchmark opponent",
        "tournament",
        "generated",
        "generated random",
        "random",
        "speed control",
        "direct pressure offense",
        "fast offense mirrors",
    }:
        return True
    return " tournament" in normalized or "generated random" in normalized


def _sweep_matchup_confidence(games_played):
    try:
        games = int(games_played or 0)
    except Exception:
        games = 0
    if games >= 10:
        return "High"
    if games >= 4:
        return "Medium"
    return "Low"


def _sweep_matchup_recommendation(win_rate, games_played):
    try:
        games = int(games_played or 0)
        rate = float(win_rate or 0)
    except Exception:
        games = 0
        rate = 0.0
    if games < 2:
        return "neutral"
    if rate >= 60:
        return "use"
    if rate <= 40:
        return "avoid"
    return "neutral"


def _build_sweep_matchup_guide(games, raw=None):
    buckets = {}
    for game in list(games or []):
        if not isinstance(game, dict):
            continue
        verdict = _lead_pair_game_result(game)
        if verdict not in {"win", "loss", "tie"}:
            continue
        key, label, archetype_metadata = _sweep_matchup_key_label(game, raw)
        if not label:
            continue
        bucket = buckets.setdefault(
            key,
            {
                "archetypeKey": key,
                "archetypeLabel": label,
                "templateKey": key,
                "templateLabel": label,
                "archetypeMetadata": dict(archetype_metadata) if archetype_metadata else None,
                "wins": 0,
                "losses": 0,
                "ties": 0,
            },
        )
        if label and bucket.get("archetypeLabel") in {"", "Unknown matchup"}:
            bucket["archetypeLabel"] = label
            bucket["templateLabel"] = label
        if archetype_metadata and not bucket.get("archetypeMetadata"):
            bucket["archetypeMetadata"] = dict(archetype_metadata)
        if verdict == "win":
            bucket["wins"] += 1
        elif verdict == "loss":
            bucket["losses"] += 1
        else:
            bucket["ties"] += 1

    guide = []
    for row in buckets.values():
        games_played = int(row["wins"] + row["losses"] + row["ties"])
        win_rate = round((float(row["wins"]) / games_played) * 100, 2) if games_played else 0
        guide.append(
            {
                **row,
                "gamesPlayed": games_played,
                "winRate": win_rate,
                "confidence": _sweep_matchup_confidence(games_played),
                "recommendation": _sweep_matchup_recommendation(win_rate, games_played),
            }
        )
    return sorted(
        guide,
        key=lambda item: (
            {"use": 0, "neutral": 1, "avoid": 2}.get(item.get("recommendation"), 1),
            -float(item.get("winRate") or 0),
            -int(item.get("gamesPlayed") or 0),
            clean_text(item.get("archetypeLabel")).lower(),
        ),
    )


def _lead_pair_replay_artifact_refs(candidate, raw, games, profile):
    existing_refs = []
    for ref in list((raw or {}).get("replayRefs") or []):
        if not isinstance(ref, dict):
            continue
        battle_log_data = clean_text(ref.get("battleLogData") or ref.get("archiveBattleLogData"))
        if not battle_log_data:
            continue
        copied = dict(ref)
        copied["sourceKind"] = copied.get("sourceKind") or "lead-pair-sweep"
        copied["leadPairId"] = copied.get("leadPairId") or copied.get("pairId") or candidate.get("pairId")
        copied["leadPairName"] = copied.get("leadPairName") or candidate.get("label") or copied.get("leadPairId") or "Lead Pair"
        copied["pairIndexes"] = copied.get("pairIndexes") or list(candidate.get("pairIndexes") or [])
        copied["pair"] = copied.get("pair") or list(candidate.get("pair") or [])
        copied["plannedLeadPair"] = copied.get("plannedLeadPair") or raw.get("plannedLeadPair") or list(candidate.get("pair") or [])
        copied["actualLeadPair"] = copied.get("actualLeadPair") or raw.get("actualLeadPair") or []
        copied["actualLeadPairSource"] = copied.get("actualLeadPairSource") or raw.get("actualLeadPairSource")
        copied["leadPairMatched"] = copied.get("leadPairMatched") if copied.get("leadPairMatched") is not None else raw.get("leadPairMatched")
        copied["mismatchReason"] = copied.get("mismatchReason") or raw.get("mismatchReason")
        copied["templateKey"] = copied.get("templateKey") or raw.get("templateKey") or copied.get("opponentArchetype") or copied.get("opponentName")
        copied["templateLabel"] = copied.get("templateLabel") or raw.get("templateLabel") or copied.get("opponentArchetype") or copied.get("opponentName")
        copied["opponentArchetype"] = copied.get("opponentArchetype") or copied.get("templateLabel") or copied.get("templateKey")
        copied["archetypeMetadata"] = copied.get("archetypeMetadata") or raw.get("archetypeMetadata")
        copied["battleLogData"] = battle_log_data
        copied["sourcePath"] = copied.get("sourcePath") or copied.get("relativePath") or copied.get("value")
        copied["relativePath"] = copied.get("relativePath") or copied.get("sourcePath")
        copied["filename"] = copied.get("filename") or str(copied.get("relativePath") or "").split("/")[-1]
        copied["profileId"] = copied.get("profileId") or profile.get("profileId")
        copied["sampleSource"] = copied.get("sampleSource") or profile.get("sampleSource")
        copied["seriesLength"] = copied.get("seriesLength") or profile.get("seriesLength")
        copied["gamesPerPair"] = copied.get("gamesPerPair") or profile.get("gamesPerPair")
        existing_refs.append(copied)
    if existing_refs:
        return existing_refs

    refs = []
    pair_id = candidate.get("pairId")
    pair_label = candidate.get("label") or pair_id or "Lead Pair"
    for index, game in enumerate(games or [], 1):
        game = dict(game or {})
        battle_log_data = clean_text(game.get("battleLogData") or game.get("archiveBattleLogData"))
        if not battle_log_data:
            continue
        game_number = int(game.get("gameNumber") or index)
        result = _lead_pair_game_result(game)
        opponent_name = clean_text(
            game.get("opponentName")
            or game.get("opponent")
            or raw.get("opponentName")
            or raw.get("archetype")
            or raw.get("templateKey")
            or "Opponent"
        )
        opponent_key = clean_text(
            game.get("templateKey")
            or game.get("opponentTemplate")
            or raw.get("templateKey")
            or raw.get("opponentTemplate")
            or opponent_name
        )
        opponent_registry_id = game.get("opponentRegistryId") or game.get("teamId") or raw.get("opponentRegistryId") or raw.get("teamId")
        source_path = f"lead-pair-sweep/{pair_id or 'unknown-pair'}/game-{game_number}-{result}.html"
        refs.append(
            {
                "sourceKind": "lead-pair-sweep",
                "leadPairId": pair_id,
                "leadPairName": pair_label,
                "leadPairRank": None,
                "leadPairRankCandidate": None,
                "pairIndexes": list(candidate.get("pairIndexes") or []),
                "pair": list(candidate.get("pair") or []),
                "plannedLeadPair": game.get("plannedLeadPair") or raw.get("plannedLeadPair") or list(candidate.get("pair") or []),
                "actualLeadPair": game.get("actualLeadPair") or raw.get("actualLeadPair") or [],
                "actualLeadPairSource": game.get("actualLeadPairSource") or raw.get("actualLeadPairSource"),
                "leadPairMatched": game.get("leadPairMatched") if game.get("leadPairMatched") is not None else raw.get("leadPairMatched"),
                "mismatchReason": game.get("mismatchReason") or raw.get("mismatchReason"),
                "gameNumber": game_number,
                "result": result,
                "winner": game.get("winner"),
                "turns": game.get("turns"),
                "seed": game.get("seed"),
                "opponentName": opponent_name,
                "opponentArchetype": opponent_key,
                "templateKey": opponent_key,
                "archetypeMetadata": game.get("archetypeMetadata") or raw.get("archetypeMetadata"),
                "opponentRegistryId": opponent_registry_id,
                "opponentTeamExport": game.get("opponentTeamExport") or raw.get("opponentTeamExport") or "",
                "playerTeamExport": game.get("playerTeamExport") or game.get("userTeamExport") or raw.get("playerTeamExport") or raw.get("userTeamExport") or "",
                "battleLogData": battle_log_data,
                "sourcePath": source_path,
                "relativePath": source_path,
                "filename": source_path.split("/")[-1],
                "profileId": profile.get("profileId"),
                "sampleSource": profile.get("sampleSource"),
                "seriesLength": profile.get("seriesLength"),
                "gamesPerPair": profile.get("gamesPerPair"),
            }
        )
    return refs


def build_lead_pair_sweep_report(team_export, lead_pair_results=None, started_at=None, completed_at=None, runtime_ms=None, status=None, error=None):
    profile = get_lead_pair_sweep_profile()
    all_candidates = build_lead_pair_pre_score_candidates(team_export)
    result_by_pair_id = {
        str(row.get("pairId")): dict(row)
        for row in list(lead_pair_results or [])
        if isinstance(row, dict) and row.get("pairId")
    }
    if result_by_pair_id:
        candidates = [candidate for candidate in all_candidates if candidate.get("pairId") in result_by_pair_id]
    else:
        candidates = [candidate for candidate in all_candidates if candidate.get("selectedForBattle")]
    rows = []

    for candidate in candidates:
        raw = result_by_pair_id.get(candidate["pairId"], {})
        raw_games = list(raw.get("games") or [])
        games = [game for game in raw_games if not (isinstance(game, dict) and game.get("leadPairMatched") is False)]
        rejected_games = len(raw_games) - len(games)
        wins = int(raw.get("wins") if raw.get("wins") is not None else sum(1 for game in games if game.get("winner") == "Professor Aegis User"))
        losses = int(raw.get("losses") if raw.get("losses") is not None else sum(1 for game in games if game.get("winner") == "Benchmark Opponent"))
        ties = int(raw.get("ties") if raw.get("ties") is not None else sum(1 for game in games if game.get("tie") and not game.get("winner")))
        games_played = int(raw.get("gamesPlayed") if raw.get("gamesPlayed") is not None else (len(games) or (wins + losses + ties)))
        games_attempted = int(raw.get("gamesAttempted") or raw.get("gamesRequested") or profile["gamesPerPair"])
        turns = sum(int(game.get("turns") or 0) for game in games)
        average_turns = round(turns / len(games), 2) if games else round(float(raw.get("averageTurns") or 0), 2)
        win_rate = round((wins / games_played) * 100, 2) if games_played else 0
        replay_refs = _lead_pair_replay_artifact_refs(candidate, raw, games, profile)
        matchup_guide = _build_sweep_matchup_guide(replay_refs or games, raw)

        rows.append(
            {
                "rank": None,
                "pairId": candidate["pairId"],
                "pairIndexes": list(candidate.get("pairIndexes") or []),
                "pair": candidate["pair"],
                "label": candidate["label"],
                "preScore": candidate.get("preScore"),
                "preScoreRank": candidate.get("preScoreRank"),
                "preScoreReasons": list(candidate.get("preScoreReasons") or raw.get("preScoreReasons") or []),
                "selectedForBattle": True,
                "plannedLeadPair": raw.get("plannedLeadPair") or candidate["pair"],
                "actualLeadPair": raw.get("actualLeadPair") or [],
                "actualLeadPairSource": raw.get("actualLeadPairSource"),
                "leadPairMatched": raw.get("leadPairMatched") if raw.get("leadPairMatched") is not None else (games_played > 0 and rejected_games == 0),
                "mismatchReason": raw.get("mismatchReason"),
                "winRate": win_rate,
                "gamesPlayed": games_played,
                "gamesCompleted": int(raw.get("gamesCompleted") or len(raw_games) or games_played),
                "gamesValidated": int(raw.get("gamesValidated") if raw.get("gamesValidated") is not None else games_played),
                "gamesRejected": int(raw.get("gamesRejected") or rejected_games),
                "gamesAttempted": games_attempted,
                "gamesRequested": games_attempted,
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "averageTurns": average_turns,
                "runtimeMs": int(raw.get("runtimeMs") or 0),
                "sourceKind": "lead-pair-sweep",
                "why": "Best tested opening pair from the fixed Aegis sweep profile.",
                "matchupGuide": matchup_guide,
                "replayRefs": replay_refs,
            }
        )

    ranked_rows = sorted(rows, key=lambda row: (-float(row.get("winRate") or 0), -int(row.get("gamesPlayed") or 0), str(row.get("label") or "")))
    for index, row in enumerate(ranked_rows, 1):
        row["rank"] = index
        for replay_ref in list(row.get("replayRefs") or []):
            if isinstance(replay_ref, dict):
                replay_ref["leadPairRank"] = index
                replay_ref["leadPairRankCandidate"] = index

    pairs_tested = sum(1 for row in ranked_rows if int(row.get("gamesPlayed") or 0) > 0)
    games_completed = sum(int(row.get("gamesPlayed") or 0) for row in ranked_rows)
    games_requested = len(candidates) * int(profile["gamesPerPair"])
    replay_artifacts_count = sum(len(list(row.get("replayRefs") or [])) for row in ranked_rows)
    missing_replay_artifacts_count = max(games_completed - replay_artifacts_count, 0)
    completed = pairs_tested == len(candidates) and games_completed >= games_requested and not error
    final_status = status or ("completed" if completed else "incomplete")

    return {
        "enabled": True,
        "status": final_status,
        "profile": profile,
        "startedAt": started_at,
        "completedAt": completed_at,
        "runtimeMs": int(runtime_ms or 0),
        "pairsGenerated": len(all_candidates),
        "pairsSelected": len(candidates),
        "finalistLimit": LEAD_PAIR_PRE_SCORE_FINALIST_LIMIT,
        "selectionSource": "pre-score-top-5",
        "pairsTested": pairs_tested,
        "gamesRequested": games_requested,
        "gamesCompleted": games_completed,
        "gamesFailed": max(games_requested - games_completed, 0) if final_status != "completed" else 0,
        "replayArtifactsReady": replay_artifacts_count >= games_completed and games_completed > 0,
        "replayArtifactsCount": replay_artifacts_count,
        "missingReplayArtifactsCount": missing_replay_artifacts_count,
        "replayArtifactSource": "leadPairSweep.results[].games[].battleLogData",
        "error": error,
        "results": ranked_rows,
    }


def _core_game_result(game):
    return _lead_pair_game_result(game)


def _core_replay_artifact_refs(candidate, raw, games, profile):
    existing_refs = []
    for ref in list((raw or {}).get("coreReplayRefs") or (raw or {}).get("replayRefs") or []):
        if not isinstance(ref, dict):
            continue
        battle_log_data = clean_text(ref.get("battleLogData") or ref.get("archiveBattleLogData"))
        if not battle_log_data:
            continue
        copied = dict(ref)
        copied["sourceKind"] = copied.get("sourceKind") or "core-sweep"
        copied["coreId"] = copied.get("coreId") or candidate.get("coreId")
        copied["coreName"] = copied.get("coreName") or candidate.get("label") or copied.get("coreId") or "Core"
        copied["coreIndexes"] = copied.get("coreIndexes") or list(candidate.get("coreIndexes") or [])
        copied["core"] = copied.get("core") or list(candidate.get("core") or [])
        copied["plannedCore"] = copied.get("plannedCore") or raw.get("plannedCore") or list(candidate.get("core") or [])
        copied["actualSelectedCore"] = copied.get("actualSelectedCore") or raw.get("actualSelectedCore") or []
        copied["actualLeadPair"] = copied.get("actualLeadPair") or raw.get("actualLeadPair") or []
        copied["actualCoreSource"] = copied.get("actualCoreSource") or raw.get("actualCoreSource")
        copied["coreMatched"] = copied.get("coreMatched") if copied.get("coreMatched") is not None else raw.get("coreMatched")
        copied["mismatchReason"] = copied.get("mismatchReason") or raw.get("mismatchReason")
        copied["templateKey"] = copied.get("templateKey") or raw.get("templateKey") or copied.get("opponentArchetype") or copied.get("opponentName")
        copied["templateLabel"] = copied.get("templateLabel") or raw.get("templateLabel") or copied.get("opponentArchetype") or copied.get("opponentName")
        copied["opponentArchetype"] = copied.get("opponentArchetype") or copied.get("templateLabel") or copied.get("templateKey")
        copied["archetypeMetadata"] = copied.get("archetypeMetadata") or raw.get("archetypeMetadata")
        copied["battleLogData"] = battle_log_data
        copied["sourcePath"] = copied.get("sourcePath") or copied.get("relativePath") or copied.get("value")
        copied["relativePath"] = copied.get("relativePath") or copied.get("sourcePath")
        copied["filename"] = copied.get("filename") or str(copied.get("relativePath") or "").split("/")[-1]
        copied["profileId"] = copied.get("profileId") or profile.get("profileId")
        copied["sampleSource"] = copied.get("sampleSource") or profile.get("sampleSource")
        copied["seriesLength"] = copied.get("seriesLength") or profile.get("seriesLength")
        copied["gamesPerCore"] = copied.get("gamesPerCore") or profile.get("gamesPerCore")
        existing_refs.append(copied)
    if existing_refs:
        return existing_refs

    refs = []
    core_id = candidate.get("coreId")
    core_label = candidate.get("label") or core_id or "Core"
    for index, game in enumerate(games or [], 1):
        game = dict(game or {})
        battle_log_data = clean_text(game.get("battleLogData") or game.get("archiveBattleLogData"))
        if not battle_log_data:
            continue
        game_number = int(game.get("gameNumber") or index)
        result = _core_game_result(game)
        opponent_name = clean_text(
            game.get("opponentName")
            or game.get("opponent")
            or raw.get("opponentName")
            or raw.get("archetype")
            or raw.get("templateKey")
            or "Opponent"
        )
        opponent_key = clean_text(
            game.get("templateKey")
            or game.get("opponentTemplate")
            or raw.get("templateKey")
            or raw.get("opponentTemplate")
            or opponent_name
        )
        opponent_registry_id = game.get("opponentRegistryId") or game.get("teamId") or raw.get("opponentRegistryId") or raw.get("teamId")
        source_path = f"core-sweep/{core_id or 'unknown-core'}/game-{game_number}-{result}.html"
        refs.append(
            {
                "sourceKind": "core-sweep",
                "coreId": core_id,
                "coreName": core_label,
                "coreRank": None,
                "coreRankCandidate": None,
                "coreIndexes": list(candidate.get("coreIndexes") or []),
                "core": list(candidate.get("core") or []),
                "plannedCore": game.get("plannedCore") or raw.get("plannedCore") or list(candidate.get("core") or []),
                "actualSelectedCore": game.get("actualSelectedCore") or raw.get("actualSelectedCore") or [],
                "actualLeadPair": game.get("actualLeadPair") or raw.get("actualLeadPair") or [],
                "actualCoreSource": game.get("actualCoreSource") or raw.get("actualCoreSource"),
                "coreMatched": game.get("coreMatched") if game.get("coreMatched") is not None else raw.get("coreMatched"),
                "mismatchReason": game.get("mismatchReason") or raw.get("mismatchReason"),
                "gameNumber": game_number,
                "result": result,
                "winner": game.get("winner"),
                "turns": game.get("turns"),
                "seed": game.get("seed"),
                "opponentName": opponent_name,
                "opponentArchetype": opponent_key,
                "templateKey": opponent_key,
                "archetypeMetadata": game.get("archetypeMetadata") or raw.get("archetypeMetadata"),
                "opponentRegistryId": opponent_registry_id,
                "opponentTeamExport": game.get("opponentTeamExport") or raw.get("opponentTeamExport") or "",
                "playerTeamExport": game.get("playerTeamExport") or game.get("userTeamExport") or raw.get("playerTeamExport") or raw.get("userTeamExport") or "",
                "battleLogData": battle_log_data,
                "sourcePath": source_path,
                "relativePath": source_path,
                "filename": source_path.split("/")[-1],
                "profileId": profile.get("profileId"),
                "sampleSource": profile.get("sampleSource"),
                "seriesLength": profile.get("seriesLength"),
                "gamesPerCore": profile.get("gamesPerCore"),
            }
        )
    return refs


def build_core_sweep_report(team_export, core_results=None, started_at=None, completed_at=None, runtime_ms=None, status=None, error=None):
    profile = get_core_sweep_profile()
    all_candidates = build_core_pre_score_candidates(team_export)
    result_by_core_id = {
        str(row.get("coreId")): dict(row)
        for row in list(core_results or [])
        if isinstance(row, dict) and row.get("coreId")
    }
    if result_by_core_id:
        candidates = [candidate for candidate in all_candidates if candidate.get("coreId") in result_by_core_id]
    else:
        candidates = [candidate for candidate in all_candidates if candidate.get("selectedForBattle")]
    rows = []

    for candidate in candidates:
        raw = result_by_core_id.get(candidate["coreId"], {})
        raw_games = list(raw.get("games") or [])
        games = [game for game in raw_games if not (isinstance(game, dict) and game.get("coreMatched") is False)]
        rejected_games = len(raw_games) - len(games)
        wins = int(raw.get("wins") if raw.get("wins") is not None else sum(1 for game in games if game.get("winner") == "Professor Aegis User"))
        losses = int(raw.get("losses") if raw.get("losses") is not None else sum(1 for game in games if game.get("winner") == "Benchmark Opponent"))
        ties = int(raw.get("ties") if raw.get("ties") is not None else sum(1 for game in games if game.get("tie") and not game.get("winner")))
        games_played = int(raw.get("gamesPlayed") if raw.get("gamesPlayed") is not None else (len(games) or (wins + losses + ties)))
        games_attempted = int(raw.get("gamesAttempted") or raw.get("gamesRequested") or profile["gamesPerCore"])
        turns = sum(int(game.get("turns") or 0) for game in games)
        average_turns = round(turns / len(games), 2) if games else round(float(raw.get("averageTurns") or 0), 2)
        win_rate = round((wins / games_played) * 100, 2) if games_played else 0
        replay_refs = _core_replay_artifact_refs(candidate, raw, games, profile)
        matchup_guide = _build_sweep_matchup_guide(replay_refs or games, raw)

        rows.append(
            {
                "rank": None,
                "coreRank": None,
                "coreId": candidate["coreId"],
                "coreIndexes": list(candidate.get("coreIndexes") or []),
                "core": candidate["core"],
                "label": candidate["label"],
                "coreScore": candidate.get("preScore"),
                "preScore": candidate.get("preScore"),
                "preScoreRank": candidate.get("preScoreRank"),
                "preScoreReasons": list(candidate.get("preScoreReasons") or raw.get("preScoreReasons") or []),
                "selectedForBattle": True,
                "plannedCore": raw.get("plannedCore") or candidate["core"],
                "actualSelectedCore": raw.get("actualSelectedCore") or [],
                "actualLeadPair": raw.get("actualLeadPair") or [],
                "actualCoreSource": raw.get("actualCoreSource"),
                "coreMatched": raw.get("coreMatched") if raw.get("coreMatched") is not None else (games_played > 0 and rejected_games == 0),
                "mismatchReason": raw.get("mismatchReason"),
                "winRate": win_rate,
                "gamesPlayed": games_played,
                "gamesCompleted": int(raw.get("gamesCompleted") or len(raw_games) or games_played),
                "gamesValidated": int(raw.get("gamesValidated") if raw.get("gamesValidated") is not None else games_played),
                "gamesRejected": int(raw.get("gamesRejected") or rejected_games),
                "gamesAttempted": games_attempted,
                "gamesRequested": games_attempted,
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "averageTurns": average_turns,
                "runtimeMs": int(raw.get("runtimeMs") or 0),
                "sourceKind": "core-sweep",
                "why": "Best tested four-Pokemon core from the fixed Aegis sweep profile.",
                "matchupGuide": matchup_guide,
                "coreReplayRefs": replay_refs,
                "replayRefs": replay_refs,
            }
        )

    ranked_rows = sorted(rows, key=lambda row: (-float(row.get("winRate") or 0), -int(row.get("gamesPlayed") or 0), str(row.get("label") or "")))
    for index, row in enumerate(ranked_rows, 1):
        row["rank"] = index
        row["coreRank"] = index
        for replay_ref in list(row.get("coreReplayRefs") or []):
            if isinstance(replay_ref, dict):
                replay_ref["coreRank"] = index
                replay_ref["coreRankCandidate"] = index

    cores_tested = sum(1 for row in ranked_rows if int(row.get("gamesPlayed") or 0) > 0)
    games_completed = sum(int(row.get("gamesPlayed") or 0) for row in ranked_rows)
    games_requested = len(candidates) * int(profile["gamesPerCore"])
    replay_artifacts_count = sum(len(list(row.get("coreReplayRefs") or [])) for row in ranked_rows)
    missing_replay_artifacts_count = max(games_completed - replay_artifacts_count, 0)
    completed = cores_tested == len(candidates) and games_completed >= games_requested and not error
    final_status = status or ("completed" if completed else "incomplete")

    return {
        "enabled": True,
        "status": final_status,
        "profile": profile,
        "startedAt": started_at,
        "completedAt": completed_at,
        "runtimeMs": int(runtime_ms or 0),
        "coresGenerated": len(all_candidates),
        "coresSelected": len(candidates),
        "finalistLimit": CORE_SWEEP_PRE_SCORE_FINALIST_LIMIT,
        "selectionSource": "battle-tested-all-cores-display-top-2",
        "coresTested": cores_tested,
        "gamesRequested": games_requested,
        "gamesCompleted": games_completed,
        "gamesFailed": max(games_requested - games_completed, 0) if final_status != "completed" else 0,
        "replayArtifactsReady": replay_artifacts_count >= games_completed and games_completed > 0,
        "replayArtifactsCount": replay_artifacts_count,
        "missingReplayArtifactsCount": missing_replay_artifacts_count,
        "replayArtifactSource": "coreSweep.results[].games[].battleLogData",
        "error": error,
        "results": ranked_rows,
    }


def looks_like_team_export(team_export):
    normalized = str(team_export or "").replace("\r\n", "\n").strip()
    if not normalized or len(normalized) < 20:
        return False
    lines = [line.strip() for line in normalized.split("\n") if line.strip()]
    has_ability_line = any(line.startswith("Ability:") for line in lines)
    has_move_line = any(line.startswith("- ") for line in lines)
    has_header_line = any(" @ " in line for line in lines)
    return len(lines) >= 4 and (has_ability_line or has_move_line or has_header_line)


def mon_has_move(mon, pattern):
    return any(pattern.search(move) for move in mon.get("moves", []))


def mon_has_ability(mon, pattern):
    return bool(pattern.search(clean_text(mon.get("ability"))))


def mon_has_item(mon, pattern):
    return bool(pattern.search(clean_text(mon.get("item"))))


def has_any_move(pokemon, pattern):
    return any(mon_has_move(mon, pattern) for mon in pokemon)


def count_move_users(pokemon, pattern):
    return sum(1 for mon in pokemon if mon_has_move(mon, pattern))


def count_ability_users(pokemon, pattern):
    return sum(1 for mon in pokemon if mon_has_ability(mon, pattern))


def count_item_users(pokemon, pattern):
    return sum(1 for mon in pokemon if mon_has_item(mon, pattern))


def push_unique(target, text):
    if text and text not in target:
        target.append(text)


def clamp(value, min_value, max_value):
    return min(max(value, min_value), max_value)


def score_to_percent(score):
    return clamp(round(50 + score * 4), 35, 65)


def support_move_count(mon):
    support_keys = (
        "trick_room", "tailwind", "fake_out", "redirection", "protect",
        "speed_control", "pivot", "setup", "disruption", "wide_guard",
        "helping_hand", "weather", "terrain",
    )
    return sum(1 for move in mon.get("moves", []) if any(MOVE_PATTERNS[key].search(move) for key in support_keys))


def build_mon_profile(mon):
    profile = {
        "species": mon["species"],
        "hasTailwind": mon_has_move(mon, MOVE_PATTERNS["tailwind"]),
        "hasTrickRoom": mon_has_move(mon, MOVE_PATTERNS["trick_room"]),
        "hasFakeOut": mon_has_move(mon, MOVE_PATTERNS["fake_out"]),
        "hasRedirection": mon_has_move(mon, MOVE_PATTERNS["redirection"]),
        "hasProtect": mon_has_move(mon, MOVE_PATTERNS["protect"]),
        "hasPriority": mon_has_move(mon, MOVE_PATTERNS["priority"]),
        "hasSpeedControl": mon_has_move(mon, MOVE_PATTERNS["speed_control"]),
        "hasPivot": mon_has_move(mon, MOVE_PATTERNS["pivot"]),
        "hasSetup": mon_has_move(mon, MOVE_PATTERNS["setup"]),
        "hasSpread": mon_has_move(mon, MOVE_PATTERNS["spread"]),
        "hasDisruption": mon_has_move(mon, MOVE_PATTERNS["disruption"]),
        "hasWideGuard": mon_has_move(mon, MOVE_PATTERNS["wide_guard"]),
        "hasHelpingHand": mon_has_move(mon, MOVE_PATTERNS["helping_hand"]),
        "hasWeather": mon_has_move(mon, MOVE_PATTERNS["weather"]),
        "hasTerrain": mon_has_move(mon, MOVE_PATTERNS["terrain"]),
        "hasPrankster": mon_has_ability(mon, ABILITY_PATTERNS["prankster"]),
        "hasIntimidate": mon_has_ability(mon, ABILITY_PATTERNS["intimidate"]),
        "hasArmorTail": mon_has_ability(mon, ABILITY_PATTERNS["armor_tail"]),
        "hasChoiceItem": mon_has_item(mon, ITEM_PATTERNS["scarf"]) or mon_has_item(mon, ITEM_PATTERNS["specs"]) or mon_has_item(mon, ITEM_PATTERNS["band"]),
        "hasBoosterItem": mon_has_item(mon, ITEM_PATTERNS["booster"]),
        "hasSash": mon_has_item(mon, ITEM_PATTERNS["sash"]),
    }
    support_count = support_move_count(mon)
    attack_count = max(0, len(mon.get("moves", [])) - support_count)
    profile["attackCount"] = attack_count
    profile["isAttacker"] = attack_count >= 2 or profile["hasChoiceItem"] or profile["hasBoosterItem"]
    profile["hasTurnOneControl"] = profile["hasFakeOut"] or profile["hasPrankster"] or profile["hasDisruption"] or profile["hasIntimidate"]
    profile["hasProtection"] = profile["hasProtect"] or profile["hasRedirection"] or profile["hasWideGuard"] or profile["hasArmorTail"]
    return profile


def build_signals(pokemon):
    profiles = [build_mon_profile(mon) for mon in pokemon]
    signals = {
        "hasTrickRoom": has_any_move(pokemon, MOVE_PATTERNS["trick_room"]),
        "hasTailwind": has_any_move(pokemon, MOVE_PATTERNS["tailwind"]),
        "fakeOutUsers": count_move_users(pokemon, MOVE_PATTERNS["fake_out"]),
        "redirectionUsers": count_move_users(pokemon, MOVE_PATTERNS["redirection"]),
        "protectUsers": count_move_users(pokemon, MOVE_PATTERNS["protect"]),
        "priorityUsers": count_move_users(pokemon, MOVE_PATTERNS["priority"]),
        "speedControlUsers": count_move_users(pokemon, MOVE_PATTERNS["speed_control"]),
        "pivotUsers": count_move_users(pokemon, MOVE_PATTERNS["pivot"]),
        "setupUsers": count_move_users(pokemon, MOVE_PATTERNS["setup"]),
        "spreadUsers": count_move_users(pokemon, MOVE_PATTERNS["spread"]),
        "disruptionUsers": count_move_users(pokemon, MOVE_PATTERNS["disruption"]),
        "wideGuardUsers": count_move_users(pokemon, MOVE_PATTERNS["wide_guard"]),
        "helpingHandUsers": count_move_users(pokemon, MOVE_PATTERNS["helping_hand"]),
        "terrainUsers": count_move_users(pokemon, MOVE_PATTERNS["terrain"]),
        "weatherUsers": count_move_users(pokemon, MOVE_PATTERNS["weather"]),
        "intimidateUsers": count_ability_users(pokemon, ABILITY_PATTERNS["intimidate"]),
        "pranksterUsers": count_ability_users(pokemon, ABILITY_PATTERNS["prankster"]),
        "drizzleUsers": count_ability_users(pokemon, ABILITY_PATTERNS["drizzle"]),
        "droughtUsers": count_ability_users(pokemon, ABILITY_PATTERNS["drought"]),
        "choiceUsers": count_item_users(pokemon, ITEM_PATTERNS["scarf"]) + count_item_users(pokemon, ITEM_PATTERNS["specs"]) + count_item_users(pokemon, ITEM_PATTERNS["band"]),
        "sashUsers": count_item_users(pokemon, ITEM_PATTERNS["sash"]),
        "boosterUsers": count_item_users(pokemon, ITEM_PATTERNS["booster"]),
        "evioliteUsers": count_item_users(pokemon, ITEM_PATTERNS["eviolite"]),
        "lifeOrbUsers": count_item_users(pokemon, ITEM_PATTERNS["life_orb"]),
        "profiles": profiles,
    }
    signals["weatherMode"] = signals["weatherUsers"] > 0 or signals["drizzleUsers"] > 0 or signals["droughtUsers"] > 0
    signals["turnOneControlScore"] = (2 if signals["fakeOutUsers"] > 0 else 0) + (1 if signals["pranksterUsers"] > 0 else 0) + (1 if signals["intimidateUsers"] > 0 else 0) + (1 if signals["disruptionUsers"] > 0 else 0)
    signals["positioningScore"] = (1 if signals["pivotUsers"] > 0 else 0) + (2 if signals["redirectionUsers"] > 0 else 0) + (1 if signals["protectUsers"] >= 4 else 0) + (1 if signals["wideGuardUsers"] > 0 else 0)
    return signals


def build_overall_read(signals):
    if signals["hasTrickRoom"] and signals["hasTailwind"]:
        return "Flexible speed control with more than one pace option"
    if signals["hasTrickRoom"] and signals["redirectionUsers"] > 0:
        return "Supported Trick Room structure"
    if signals["hasTailwind"] and signals["fakeOutUsers"] > 0:
        return "Fast tempo offense with strong early-turn pressure"
    if signals["hasTailwind"]:
        return "Fast offense leaning"
    if signals["hasTrickRoom"]:
        return "Room-mode leaning"
    if signals["weatherMode"]:
        return "Weather-enabled offense"
    if signals["speedControlUsers"] >= 2 and signals["disruptionUsers"] >= 2:
        return "Balance-style support shell"
    if signals["setupUsers"] >= 2:
        return "Setup-focused offense"
    return "Unclear speed profile with mixed support signals"


def build_plain_language_summary(signals, archetype_summary):
    pieces = [f"This export reads most like {archetype_summary}."]
    if signals["hasTailwind"] and signals["hasTrickRoom"]:
        pieces.append("Your team shows more than one speed plan, so it may be able to play both fast and slow games depending on the matchup.")
    elif signals["hasTailwind"]:
        pieces.append("Your team looks built to play faster games and try to attack before the opponent settles in.")
    elif signals["hasTrickRoom"]:
        pieces.append("Your team looks like it wants to slow the game down and let slower attackers move first.")
    else:
        pieces.append("Your team does not show one obvious speed plan yet, so some matchups may feel awkward when tempo matters.")
    if signals["fakeOutUsers"] > 0:
        pieces.append("You also show Fake Out support, which usually helps with safer turn-one positioning.")
    elif signals["turnOneControlScore"] <= 1:
        pieces.append("The export shows fewer true turn-one control tools, so some opening turns may feel more fragile.")
    if signals["redirectionUsers"] > 0:
        pieces.append("Redirection support is present too, so setup or partner-protection turns may feel more stable.")
    else:
        pieces.append("There is no clear redirection support, so fragile positioning turns may be harder to protect.")
    if signals["protectUsers"] <= 2:
        pieces.append("Protect usage looks a little light, which can matter a lot in doubles endgames.")
    return " ".join(pieces)


def evaluate_archetypes(signals):
    scores = {}
    for template in ARCHETYPE_TEMPLATES:
        score = 0
        notes = []
        key = template["key"]

        if key == "fast-offense-mirrors":
            if signals["hasTailwind"]:
                score += 2; notes.append("you can actually contest raw speed")
            if signals["fakeOutUsers"] > 0:
                score += 1; notes.append("Fake Out helps stabilize turn one")
            if signals["hasTrickRoom"]:
                score += 1; notes.append("a secondary Trick Room line helps if the race goes badly")
            if signals["priorityUsers"] > 0:
                score += 1; notes.append("priority can help clean up after speed trades")
            if not signals["hasTailwind"] and not signals["hasTrickRoom"]:
                score -= 3
            if signals["protectUsers"] <= 2:
                score -= 1

        elif key == "hard-trick-room":
            if signals["hasTrickRoom"]:
                score += 2; notes.append("you can mirror Trick Room instead of only trying to stop it")
            if signals["fakeOutUsers"] > 0:
                score += 1; notes.append("Fake Out can pressure the room turn")
            if signals["disruptionUsers"] > 0 or signals["pranksterUsers"] > 0:
                score += 1; notes.append("support disruption gives you ways to interfere with setup")
            if signals["spreadUsers"] > 0 or signals["choiceUsers"] > 0 or signals["lifeOrbUsers"] > 0:
                score += 1; notes.append("you show enough pressure to punish passive room turns")
            if not signals["hasTrickRoom"] and signals["fakeOutUsers"] == 0 and signals["disruptionUsers"] == 0:
                score -= 3

        elif key == "redirection-balance":
            if signals["spreadUsers"] > 0:
                score += 1; notes.append("spread pressure helps punish boards that hide behind Follow Me or Rage Powder")
            if signals["fakeOutUsers"] > 0:
                score += 1; notes.append("turn-one control helps stop redirection partners from moving freely")
            if signals["hasTailwind"] or signals["hasTrickRoom"]:
                score += 1; notes.append("you can still contest pace instead of playing their slow game")
            if signals["redirectionUsers"] > 0:
                score += 1; notes.append("your own redirection support lets you fight for the same kind of board control")
            if signals["redirectionUsers"] == 0:
                score -= 2
            if signals["protectUsers"] <= 2:
                score -= 1

        elif key == "bulky-balance":
            if signals["hasTailwind"] and signals["hasTrickRoom"]:
                score += 2; notes.append("dual speed control helps against slower, adaptable teams")
            if signals["pivotUsers"] > 0:
                score += 1; notes.append("pivot tools help you reposition around bulky cores")
            if signals["helpingHandUsers"] > 0 or signals["setupUsers"] > 0:
                score += 1; notes.append("you have ways to create extra pressure instead of only trading hits")
            if signals["protectUsers"] >= 4:
                score += 1; notes.append("strong Protect coverage helps in longer board states")
            if signals["choiceUsers"] >= 2:
                score -= 1
            if signals["protectUsers"] <= 2 and signals["pivotUsers"] == 0:
                score -= 2

        elif key == "spread-heavy-offense":
            if signals["wideGuardUsers"] > 0:
                score += 3; notes.append("Wide Guard is a direct answer to spread pressure")
            if signals["protectUsers"] >= 4:
                score += 1; notes.append("good Protect coverage helps you scout and reduce spread damage cycles")
            if signals["hasTailwind"] or signals["hasTrickRoom"]:
                score += 1; notes.append("clear speed control helps you stop repeated spread turns from snowballing")
            if signals["wideGuardUsers"] == 0:
                score -= 2
            if signals["protectUsers"] <= 2:
                score -= 2

        elif key == "direct-pressure-offense":
            if signals["fakeOutUsers"] > 0:
                score += 1; notes.append("Fake Out helps blunt immediate pressure")
            if signals["intimidateUsers"] > 0:
                score += 1; notes.append("Intimidate softens physical pressure teams")
            if signals["hasTailwind"]:
                score += 1; notes.append("Tailwind helps stop opponents from freely snowballing speed")
            if signals["priorityUsers"] > 0:
                score += 1; notes.append("priority helps finish threats before they get another turn")
            if signals["redirectionUsers"] == 0 and signals["protectUsers"] <= 2:
                score -= 2

        scores[key] = {
            "key": template["key"],
            "name": template["name"],
            "score": score,
            "winRate": score_to_percent(score),
            "summary": template["summary"],
            "notes": notes,
            "commonPressures": template["common_pressures"],
            "evaluationFocus": template["evaluation_focus"],
            "defaultBattleCount": template["default_battle_count"],
            "simulationNotes": template["simulation_notes"],
        }
    return [scores[t["key"]] for t in ARCHETYPE_TEMPLATES]


def evaluate_lead_pair(pair, signals):
    a, b = pair
    pair_name = f'{a["species"]} + {b["species"]}'
    reasons = []
    risks = []
    strong_score = 0
    risk_score = 0

    if a["hasTailwind"] or b["hasTailwind"]:
        strong_score += 2
        push_unique(reasons, f'{a["species"] if a["hasTailwind"] else b["species"]} gives Tailwind speed control')
    if a["hasTrickRoom"] or b["hasTrickRoom"]:
        strong_score += 2
        push_unique(reasons, f'{a["species"] if a["hasTrickRoom"] else b["species"]} threatens Trick Room')
    if a["hasFakeOut"] or b["hasFakeOut"]:
        strong_score += 1
        push_unique(reasons, f'{a["species"] if a["hasFakeOut"] else b["species"]} adds Fake Out pressure for a safer first turn')
    if a["hasPrankster"] or b["hasPrankster"]:
        strong_score += 1
        push_unique(reasons, f'{a["species"] if a["hasPrankster"] else b["species"]} gives faster utility through Prankster')
    if a["hasRedirection"] or b["hasRedirection"]:
        strong_score += 1
        push_unique(reasons, f'{a["species"] if a["hasRedirection"] else b["species"]} can shield the partner with redirection')
    if a["hasHelpingHand"] or b["hasHelpingHand"]:
        strong_score += 1
        push_unique(reasons, f'{a["species"] if a["hasHelpingHand"] else b["species"]} can convert that board immediately with Helping Hand')
    if a["hasPivot"] or b["hasPivot"]:
        strong_score += 1
        push_unique(reasons, f'{a["species"] if a["hasPivot"] else b["species"]} gives you a pivot option if the lead goes badly')

    attackers = [mon for mon in (a, b) if mon["isAttacker"]]
    if attackers:
        strong_score += 1
        push_unique(reasons, f'{attackers[0]["species"]} keeps immediate offensive pressure on the field')

    pair_has_speed_mode = a["hasTailwind"] or b["hasTailwind"] or a["hasTrickRoom"] or b["hasTrickRoom"]
    if not pair_has_speed_mode and (signals["hasTailwind"] or signals["hasTrickRoom"]):
        risk_score += 2
        push_unique(risks, "this pair does not directly establish either of your main speed modes")

    pair_has_turn_one_control = a["hasTurnOneControl"] or b["hasTurnOneControl"] or a["hasPrankster"] or b["hasPrankster"]
    if not pair_has_turn_one_control and signals["turnOneControlScore"] >= 2:
        risk_score += 1
        push_unique(risks, "the lead shows little immediate turn-one control")

    pair_has_protection = a["hasProtection"] or b["hasProtection"] or a["hasPivot"] or b["hasPivot"]
    if not pair_has_protection and (signals["redirectionUsers"] == 0 or signals["protectUsers"] <= 2):
        risk_score += 1
        push_unique(risks, "it can get punished quickly if the opponent pressures both slots at once")

    if not attackers:
        risk_score += 1
        push_unique(risks, "it does not keep much immediate damage pressure on the field")

    return {
        "pairName": pair_name,
        "strongScore": strong_score,
        "riskScore": risk_score,
        "strongText": f'{pair_name} looks stronger because {", ".join(reasons[:3])}.' if len(reasons) >= 2 else None,
        "riskText": f'{pair_name} looks riskier because {", ".join(risks[:3])}.' if risks else None,
    }


def build_strengths(signals, archetypes):
    strengths = []
    if signals["hasTailwind"]:
        push_unique(strengths, "You show Tailwind, which gives the team a clear way to win speed wars in faster matchups.")
    if signals["hasTrickRoom"]:
        push_unique(strengths, "You show Trick Room, so the team has a way to flip speed order and punish faster teams.")
    if signals["fakeOutUsers"] > 0:
        push_unique(strengths, "Fake Out support gives you stronger turn-one disruption and safer positioning.")
    if signals["redirectionUsers"] > 0:
        push_unique(strengths, "Redirection support can make setup turns and partner protection feel more stable.")
    if signals["pivotUsers"] > 0:
        push_unique(strengths, "Pivot tools give you ways to salvage awkward openings instead of losing momentum immediately.")
    if signals["wideGuardUsers"] > 0:
        push_unique(strengths, "Wide Guard gives the team a real answer into spread-heavy boards.")
    best_archetype = archetypes[0] if archetypes else None
    if best_archetype and best_archetype["winRate"] >= 56:
        push_unique(strengths, f'Your structure should feel more comfortable into {best_archetype["name"].lower()} than into average boards.')
    return strengths[:4]


def build_weaknesses(signals, sorted_worst_archetypes):
    weaknesses = []
    if not signals["hasTrickRoom"]:
        push_unique(weaknesses, "Hard Trick Room may be awkward because the team does not show a direct way to reverse or mirror that mode.")
    if not signals["hasTailwind"] and not signals["hasTrickRoom"] and signals["speedControlUsers"] < 2:
        push_unique(weaknesses, "The team does not show one obvious speed plan, so faster teams may control the pace more easily.")
    if signals["redirectionUsers"] == 0:
        push_unique(weaknesses, "Without redirection, fragile positioning turns may be easier for opponents to break up.")
    if signals["priorityUsers"] == 0:
        push_unique(weaknesses, "No clear priority means it may be harder to finish off very fast or boosted targets once they get ahead.")
    if signals["protectUsers"] <= 2:
        push_unique(weaknesses, "Protect coverage looks limited, which can make doubles endgames and target-avoidance turns less flexible.")
    if signals["wideGuardUsers"] == 0 and signals["protectUsers"] <= 2:
        push_unique(weaknesses, "Spread-heavy boards may get awkward because the export shows limited ways to blunt repeated multi-target damage.")
    worst_archetype = sorted_worst_archetypes[0] if sorted_worst_archetypes else None
    if worst_archetype and worst_archetype["winRate"] <= 45:
        push_unique(weaknesses, f'{worst_archetype["name"]} currently looks like one of the shakier matchup styles for this build.')
    return weaknesses[:4]


def build_coach_notes(signals, worst_archetypes):
    coach_notes = []
    issue_notes = []
    if signals["protectUsers"] <= 2:
        push_unique(coach_notes, "Limited Protect usage usually matters more in doubles than newer players expect.")
        issue_notes.append("Protect coverage looks limited, which may reduce flexibility in endgames and scouting turns.")
    if signals["redirectionUsers"] == 0:
        push_unique(coach_notes, "If your plan needs a safe setup or positioning turn, the team may need to earn that turn rather than force it.")
        issue_notes.append("No Follow Me or Rage Powder support detected, which can make fragile turns less stable.")
    if signals["fakeOutUsers"] == 0:
        push_unique(coach_notes, "Without Fake Out, your turn-one pressure may depend more on board position and raw damage.")
        issue_notes.append("No Fake Out pressure detected, so early-turn disruption may be less consistent.")
    if signals["pranksterUsers"] > 0:
        push_unique(coach_notes, "Prankster utility can help smooth out difficult turns, so look for lines where support moves matter more than raw damage.")
    if signals["pivotUsers"] > 0:
        push_unique(coach_notes, "Pivot moves give you repositioning options, which can help weaker leads recover rather than collapse immediately.")
    if signals["hasTailwind"] and signals["hasTrickRoom"]:
        push_unique(coach_notes, "Dual-speed teams are strongest when you already know before team preview which speed mode matters more in that matchup.")
    worst = worst_archetypes[0] if worst_archetypes else None
    if worst and worst["name"] == "Hard Trick Room" and not signals["hasTrickRoom"] and signals["fakeOutUsers"] == 0 and signals["disruptionUsers"] == 0:
        push_unique(coach_notes, "Into hard Trick Room, your first question should be how you pressure the room turn, because the export does not show many natural tools for that job.")
    if worst and worst["name"] == "Spread-heavy offense" and signals["wideGuardUsers"] == 0:
        push_unique(coach_notes, "Into spread-heavy teams, your boards may need cleaner positioning because the export does not show a direct Wide Guard answer.")
    return {"coachNotes": coach_notes[:5], "issueNotes": issue_notes[:5]}


def build_glossary(signals):
    glossary = []
    if signals["hasTailwind"]:
        glossary.append("Tailwind: A move that doubles your side’s Speed for a few turns.")
    if signals["hasTrickRoom"]:
        glossary.append("Trick Room: A move that makes slower Pokémon move first for a few turns.")
    if signals["redirectionUsers"] > 0:
        glossary.append("Redirection: Moves like Follow Me or Rage Powder that pull attacks toward one Pokémon.")
    if signals["wideGuardUsers"] > 0:
        glossary.append("Wide Guard: A move that blocks many spread attacks for your side for that turn.")
    return glossary[:3]


def dedupe_list(items):
    seen = set()
    out = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _annotate_template_selection(evaluations):
    if not evaluations:
        return [], []

    ordered_by_risk = sorted(evaluations, key=lambda item: (item["estimatedWinRate"], item["name"]))
    ordered_by_strength = sorted(evaluations, key=lambda item: (-item["estimatedWinRate"], item["name"]))

    risk_key = ordered_by_risk[0]["key"]
    strength_key = ordered_by_strength[0]["key"]

    annotated = []
    for item in evaluations:
        record = dict(item)
        if record["key"] == risk_key:
            record["recommendedPriority"] = 1
            record["selectionBucket"] = "priority"
            record["testPurpose"] = "risk-check"
            record["isLikelyWeakness"] = True
            record["isLikelyStrength"] = False
            record["selectionReason"] = "Selected as a likely weakness check because the structural read is below neutral."
            record["whyThisWasSelected"] = "This style graded below neutral in the current structural read, so it should be tested early as a probable risk area."
        elif record["key"] == strength_key:
            record["recommendedPriority"] = 2
            record["selectionBucket"] = "priority"
            record["testPurpose"] = "sanity-check"
            record["isLikelyWeakness"] = False
            record["isLikelyStrength"] = True
            record["selectionReason"] = "Selected as a positive-control matchup so the benchmark can verify a style the structural read currently favors."
            record["whyThisWasSelected"] = "This style graded as one of the strongest structural reads for the team, so it should be tested to confirm the expected strength is real."
        else:
            record["recommendedPriority"] = 3
            record["selectionBucket"] = "coverage"
            record["testPurpose"] = "coverage-check"
            record["isLikelyWeakness"] = False
            record["isLikelyStrength"] = False
            record["selectionReason"] = "Selected as broader benchmark coverage."
            record["whyThisWasSelected"] = "This style helps broaden coverage beyond the first risk and sanity checks."
        annotated.append(record)

    priority_details = [
        {
            "key": item["key"],
            "recommendedPriority": item["recommendedPriority"],
            "testPurpose": item["testPurpose"],
            "isLikelyWeakness": item["isLikelyWeakness"],
            "isLikelyStrength": item["isLikelyStrength"],
            "selectionReason": item["selectionReason"],
        }
        for item in sorted(annotated, key=lambda entry: (entry["recommendedPriority"], entry["name"]))
        if entry["selectionBucket"] == "priority"
    ]
    return annotated, priority_details


def build_matchup_eval_from_team(team_export, template_keys=None, battle_count=20, showdown_ready=False, format_id=None, progress_callback=None):
    parsed = parse_team_export(team_export)
    pokemon = parsed["pokemon"]
    signals = build_signals(pokemon)

    normalized_keys = normalize_template_keys(template_keys)
    if not normalized_keys:
        normalized_keys = [template["key"] for template in ARCHETYPE_TEMPLATES]

    all_archetypes = {entry["key"]: entry for entry in evaluate_archetypes(signals)}
    evaluations = []
    total_templates = len(normalized_keys)

    for index, key in enumerate(normalized_keys, start=1):
        template = get_template_by_key(key)
        if not template:
            continue
        entry = all_archetypes[key]
        planned_battles = max(int(battle_count or template["default_battle_count"]), 1)
        verdict = "favored" if entry["winRate"] >= 55 else "shaky" if entry["winRate"] <= 45 else "unclear"

        if progress_callback:
            progress_callback(
                {
                    "phase": "resolving-template-opponents",
                    "currentStep": f"Loading opponents for {entry['name']} ({index}/{total_templates})",
                    "currentTemplate": entry["key"],
                    "currentEstimatedWinRate": entry["winRate"],
                    "processedTemplates": index - 1,
                    "totalTemplates": total_templates,
                    "percent": 10 + int(((index - 1) / max(total_templates, 1)) * 60),
                }
            )

        opponents = get_opponents_for_template(entry["key"], format_id=format_id)

        if progress_callback:
            progress_callback(
                {
                    "phase": "resolving-template-opponents",
                    "currentStep": f"Loaded opponents for {entry['name']} ({index}/{total_templates})",
                    "currentTemplate": entry["key"],
                    "currentEstimatedWinRate": entry["winRate"],
                    "processedTemplates": index,
                    "totalTemplates": total_templates,
                    "percent": 10 + int((index / max(total_templates, 1)) * 60),
                }
            )

        evaluations.append(
            {
                "key": entry["key"],
                "name": entry["name"],
                "estimatedWinRate": entry["winRate"],
                "structuralVerdict": verdict,
                "plannedBattles": planned_battles,
                "summary": entry["summary"],
                "notes": entry["notes"][:3],
                "commonPressures": entry["commonPressures"][:3],
                "evaluationFocus": entry["evaluationFocus"][:3],
                "simulationNotes": entry["simulationNotes"][:3],
                "showdownReady": bool(showdown_ready),
                "evaluationMode": "showdown-ready-scaffold" if showdown_ready else "template-only-fallback",
                "opponentCandidateCount": len(opponents),
                "opponentCandidates": opponents,
            }
        )

    evaluations, priority_details = _annotate_template_selection(evaluations)

    sorted_worst = sorted(evaluations, key=lambda item: item["estimatedWinRate"])[:2]
    sorted_best = sorted(evaluations, key=lambda item: -item["estimatedWinRate"])[:1]
    priority_templates = dedupe_list([item["key"] for item in (sorted_worst + sorted_best)])

    return {
        "engineVersion": ENGINE_VERSION,
        "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "benchmarkModesVersion": BENCHMARK_MODES_VERSION,
        "adviceLibraryVersion": ADVICE_LIBRARY_VERSION,
        "evaluationMode": "showdown-ready-scaffold" if showdown_ready else "template-only-fallback",
        "requestedTemplates": normalized_keys,
        "recommendedBattleCount": int(battle_count or 20),
        "showdownReady": bool(showdown_ready),
        "templates": evaluations,
        "priorityTemplates": priority_templates,
        "priorityTemplateDetails": priority_details,
        "benchmarkModes": list_benchmark_modes(format_id=format_id),
        "benchmarkModePlan": build_benchmark_mode_plan(format_id=format_id, priority_templates=priority_templates),
        "noteText": "This matchup-eval layer plans concrete template checks and is ready to sit on top of local Showdown validation.",
        "generatedAt": utc_now_iso(),
    }


def build_sim_matchup_scaffold_from_team(
    team_export,
    template_keys=None,
    battle_count=20,
    showdown_ready=False,
    format_id=None,
    validation_result=None,
    packed_team=None,
    progress_callback=None,
):
    if progress_callback:
        progress_callback(
            {
                "phase": "building-scaffold",
                "currentStep": "Starting scaffold build",
                "currentTemplate": None,
                "currentEstimatedWinRate": None,
                "processedTemplates": 0,
                "totalTemplates": 0,
                "percent": 5,
            }
        )

    matchup_eval = build_matchup_eval_from_team(
        team_export,
        template_keys=template_keys,
        battle_count=battle_count,
        showdown_ready=showdown_ready,
        format_id=format_id,
        progress_callback=progress_callback,
    )
    format_label = str(format_id or "").strip() or None

    templates = []
    total_ready_opponents = 0
    total_templates = len(matchup_eval["templates"])

    for index, item in enumerate(matchup_eval["templates"], start=1):
        if progress_callback:
            progress_callback(
                {
                    "phase": "finalizing-scaffold",
                    "currentStep": f"Finalizing scaffold for {item['name']} ({index}/{total_templates})",
                    "currentTemplate": item["key"],
                    "currentEstimatedWinRate": item["estimatedWinRate"],
                    "processedTemplates": index - 1,
                    "totalTemplates": total_templates,
                    "percent": 75 + int(((index - 1) / max(total_templates, 1)) * 20),
                }
            )

        ready_opponents = [
            candidate for candidate in item.get("opponentCandidates", [])
            if candidate.get("validForFormat") and candidate.get("packedTeamAvailable")
        ]
        total_ready_opponents += len(ready_opponents)
        templates.append(
            {
                **item,
                "simBattlePlan": {
                    "formatId": format_label,
                    "plannedBattles": item["plannedBattles"],
                    "requiresOpponentTemplateTeam": len(ready_opponents) == 0,
                    "simulator": "pokemon-showdown-cli",
                    "status": "ready-for-opponent-selection" if showdown_ready and len(ready_opponents) else "blocked-by-opponent-library",
                    "readyOpponentCount": len(ready_opponents),
                },
            }
        )

    if progress_callback:
        progress_callback(
            {
                "phase": "completed",
                "currentStep": "Scaffold build completed",
                "currentTemplate": None,
                "currentEstimatedWinRate": None,
                "processedTemplates": total_templates,
                "totalTemplates": total_templates,
                "percent": 100,
            }
        )

    return {
        "engineVersion": ENGINE_VERSION,
        "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "benchmarkModesVersion": BENCHMARK_MODES_VERSION,
        "reportType": "Python Showdown Simulation Scaffold",
        "simulationMode": "showdown-cli-bridge",
        "showdownReady": bool(showdown_ready),
        "formatId": format_label,
        "teamValidation": validation_result or {
            "valid": False,
            "messages": "No validation result was provided.",
        },
        "packedTeamAvailable": bool(packed_team),
        "packedTeam": packed_team if packed_team else None,
        "templatePlans": templates,
        "priorityTemplates": matchup_eval["priorityTemplates"],
        "priorityTemplateDetails": matchup_eval["priorityTemplateDetails"],
        "readyOpponentCount": total_ready_opponents,
        "benchmarkModes": matchup_eval["benchmarkModes"],
        "benchmarkModePlan": matchup_eval["benchmarkModePlan"],
        "noteText": "This simulation scaffold validates your team through local Showdown, packs it, and attaches real opponent template teams as simulation-ready inputs. It still does not run full battle outcomes yet.",
        "generatedAt": utc_now_iso(),
    }


def _unique_ordered(values):
    seen = set()
    output = []
    for value in values:
        marker = json.dumps(value, sort_keys=True) if isinstance(value, (dict, list)) else str(value)
        if not marker or marker in seen:
            continue
        seen.add(marker)
        output.append(value)
    return output


def _policy_metrics_from_games(games, games_per_opponent=None, benchmark_mode=None, mode_selection=None):
    games = list(games or [])
    mode_selection = mode_selection if isinstance(mode_selection, dict) else {}
    seeds = [game.get("seed") for game in games if game.get("seed") is not None]
    policies = [game.get("policy") for game in games if game.get("policy")]
    policy_versions = [game.get("policyVersion") for game in games if game.get("policyVersion")]
    runner_modes = [game.get("runnerPoolMode") for game in games if game.get("runnerPoolMode")]
    requested_games = int(games_per_opponent or len(games) or 0)
    uses_battle_budget = mode_selection.get("battleBudget") is not None
    best_of = 1 if uses_battle_budget else (requested_games if requested_games > 0 else None)

    return {
        "policyVersion": policy_versions[0] if policy_versions else None,
        "policyVersions": _unique_ordered(policy_versions),
        "policies": _unique_ordered(policies),
        "runnerPoolModes": _unique_ordered(runner_modes),
        "seeds": seeds,
        "seedCount": len(seeds),
        "runtimeMs": sum(int(game.get("durationMs") or 0) for game in games),
        "boExperiment": {
            "benchmarkMode": benchmark_mode,
            "bestOf": best_of,
            "experimentType": "BO1" if uses_battle_budget else ("BO3" if int(best_of or 0) >= 3 else "BO1"),
            "gamesRequested": requested_games,
            "gamesCompleted": len(games),
            "selectionSeed": mode_selection.get("selectionSeed"),
            "battleBudget": mode_selection.get("battleBudget"),
            "battlesPerMatchup": mode_selection.get("battlesPerMatchup"),
            "battleBudgetAllocationRule": mode_selection.get("battleBudgetAllocationRule"),
            "allocatedGamesPerOpponent": mode_selection.get("allocatedGamesPerOpponent"),
            "expectedTotalGames": mode_selection.get("expectedTotalGames"),
        },
    }


def build_battle_series_report(
    format_id,
    opponent,
    series_results,
    user_team_validation,
    user_packed_team,
    games_requested,
):
    games_completed = len(series_results)

    def _is_true_tie(game):
        return bool(game.get("tie")) and not game.get("winner")

    wins = sum(1 for game in series_results if game.get("winner") == "Professor Aegis User")
    losses = sum(1 for game in series_results if game.get("winner") == "Benchmark Opponent")
    ties = sum(1 for game in series_results if _is_true_tie(game))
    avg_turns = round(sum((game.get("turns") or 0) for game in series_results) / games_completed, 2) if games_completed else 0
    completed_ok = all(game.get("ok") for game in series_results)

    game_summaries = []
    for game in series_results:
        winner = game.get("winner")
        if winner == "Professor Aegis User":
            verdict = "win"
        elif winner == "Benchmark Opponent":
            verdict = "loss"
        elif _is_true_tie(game):
            verdict = "tie"
        else:
            verdict = "unknown"

        game_summaries.append(
            {
                "gameNumber": game.get("gameNumber"),
                "winner": winner,
                "turns": game.get("turns"),
                "verdict": verdict,
                "seed": game.get("seed"),
                "policy": game.get("policy"),
                "requestsHandled": game.get("requestsHandled"),
                "stderr": game.get("stderr"),
            }
        )

    policy_metrics = _policy_metrics_from_games(series_results, games_requested)

    return {
        "engineVersion": ENGINE_VERSION,
        "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "benchmarkModesVersion": BENCHMARK_MODES_VERSION,
        "reportType": "Python Showdown Battle Series",
        "simulationMode": "showdown-cli-deterministic-policy",
        "formatId": format_id,
        "showdownReady": True,
        "opponentId": opponent.get("id"),
        "opponentName": opponent.get("name"),
        "opponentSummary": opponent.get("summary"),
        "userTeamValidation": user_team_validation,
        "packedTeamAvailable": bool(user_packed_team),
        "packedTeam": user_packed_team,
        "gamesRequested": int(games_requested),
        "gamesCompleted": games_completed,
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "winRate": round((wins / games_completed) * 100, 2) if games_completed else 0,
        "averageTurns": avg_turns,
        "policy": "deterministic preview and active-turn policy for both sides",
        "policyVersion": policy_metrics.get("policyVersion"),
        "policyMetrics": policy_metrics,
        "completedOk": completed_ok,
        "games": game_summaries,
        "noteText": "This battle runner uses Pokémon Showdown with deterministic preview and active-turn choices on both sides, so it produces actual winners and turn counts while staying lightweight.",
        "generatedAt": utc_now_iso(),
    }



def _collect_opponent_template_keys(opponent):
    keys = []
    raw_keys = opponent.get("templateKeys") or []
    for key in raw_keys:
        text = str(key or "").strip()
        if text and text not in keys:
            keys.append(text)
    primary = str(opponent.get("templateKey") or "").strip()
    if primary and primary not in keys:
        keys.insert(0, primary)
    if not keys:
        keys = ["unknown"]
    return keys


def _slug_key(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")


def _championlab_archetype_label_for_key(opponent, template_key):
    archetype = str(opponent.get("archetype") or opponent.get("championLabArchetype") or "").strip()
    if not archetype:
        return prettify_template_name(template_key)
    primary = str(opponent.get("templateKey") or "").strip()
    if template_key == primary or template_key == _slug_key(archetype):
        return archetype
    return prettify_template_name(template_key)







def prettify_template_name(value):
    text = str(value or "").strip()
    if not text:
        return "Unknown matchup"
    text = text.replace("_", " ").replace("-", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return " ".join(part.capitalize() for part in text.split(" "))


def _slugify_filename(value):
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    return text.strip("-") or "matchup"


def _build_replay_id(format_id, archetype_label, game_number, opponent_registry_id=None):
    format_part = _slugify_filename(format_id or "matchup-report")
    archetype_part = _slugify_filename(archetype_label or "opponent")
    game_part = int(game_number or 1)
    prefix = f"{int(opponent_registry_id)}-" if opponent_registry_id else ""
    return f"{format_part}-{prefix}{archetype_part}-game-{game_part}"


def _rewrite_replay_player_names(battle_log_data, p1_name="You", p2_name="Opponent"):
    out = []
    last_nonempty = None
    pending_split = False
    for raw_line in str(battle_log_data or "").splitlines():
        line = str(raw_line or "").rstrip("\r")
        if not line or line.startswith("|debug|"):
            continue
        if line.startswith("|split|"):
            pending_split = True
            continue
        if line.startswith("|player|p1|"):
            parts = line.split("|")
            if len(parts) >= 5:
                parts[3] = p1_name
                line = "|".join(parts)
        elif line.startswith("|player|p2|"):
            parts = line.split("|")
            if len(parts) >= 5:
                parts[3] = p2_name
                line = "|".join(parts)
        elif line.startswith("|win|"):
            parts = line.split("|")
            if len(parts) >= 3:
                winner = parts[2]
                if winner == "Professor Aegis User":
                    parts[2] = p1_name
                elif winner == "Benchmark Opponent":
                    parts[2] = p2_name
                line = "|".join(parts)
        if pending_split and line == last_nonempty:
            pending_split = False
            continue
        pending_split = False
        if line == last_nonempty and (line.startswith("|switch|") or line.startswith("|-damage|") or line.startswith("|move|")):
            continue
        out.append(line)
        if line:
            last_nonempty = line
    return "\n".join(out).strip()


def _extract_replay_winner(battle_log_data):
    for raw_line in reversed(str(battle_log_data or "").splitlines()):
        line = raw_line.strip()
        if line.startswith("|win|"):
            parts = line.split("|")
            if len(parts) >= 3:
                return parts[2].strip()
    return ""


def _result_from_winner(winner, p1_name="You", p2_name="Opponent"):
    if not winner:
        return ("TIE", "#888888")
    if winner == p1_name:
        return ("WIN", "#2da44e")
    if winner == p2_name:
        return ("LOSS", "#d1242f")
    return ("TIE", "#888888")


def _pretty_actor(token):
    token = str(token or "")
    if ": " in token:
        _, label = token.split(": ", 1)
        return label
    return token or "Pokémon"


def _species_from_details(details):
    head = str(details or "").split("|")[0]
    head = head.split(",")[0].strip()
    return head or "Pokémon"


def _hp_percent_from_fraction(frac):
    try:
        cur, total = frac.split("/", 1)
        cur = float(re.sub(r"[^0-9.]", "", cur) or 0)
        total = float(re.sub(r"[^0-9.]", "", total) or 0)
        if total <= 0:
            return None
        return round((cur / total) * 100, 1)
    except Exception:
        return None


def _build_bottom_replay_log_html(battle_log_data, format_id, p1_name, p2_name):
    lines = [ln for ln in str(battle_log_data or "").splitlines() if ln]
    html_parts = []
    p1_team = []
    p2_team = []

    def add(block):
        html_parts.append(block)

    for raw in lines:
        if raw.startswith("|poke|"):
            parts = raw.split("|")
            if len(parts) >= 4:
                side = parts[2]
                species = _species_from_details(parts[3])
                if side == "p1":
                    p1_team.append(species)
                elif side == "p2":
                    p2_team.append(species)

    add(f'<div class=""><small>Format:</small> <br><strong>{html.escape(str(format_id or "Benchmark Format"))}</strong></div>')
    add(f"<div class='chat battle-history'><strong>{html.escape(p1_name)}&#39;s team:</strong> <em style='color:#445566;display:block;'>{html.escape(' / '.join(p1_team))}</em></div>")
    add(f"<div class='chat battle-history'><strong>{html.escape(p2_name)}&#39;s team:</strong> <em style='color:#445566;display:block;'>{html.escape(' / '.join(p2_team))}</em></div>")

    started = False
    for raw in lines:
        parts = raw.split("|")
        tag = parts[1] if len(parts) > 1 else ""
        if tag in {"t:", "gametype", "gen", "tier", "teampreview", "teamsize", "clearpoke", ""}:
            continue
        if tag == "rule":
            add(f'<div class=""><small><em>{html.escape(parts[2].split(":")[0] + ":")}</em> {html.escape(":".join(parts[2].split(":")[1:]).strip())}</small></div>')
            continue
        if tag == "start" and not started:
            add('<div class="spacer battle-history"><br></div>')
            add(f'<div class="battle-history">Battle started between {html.escape(p1_name)} and {html.escape(p2_name)}!<br></div>')
            add('<div class="spacer battle-history"><br></div>')
            started = True
            continue
        if tag == "turn":
            add(f'<h2 class="battle-history">Turn {html.escape(parts[2])}</h2>')
            continue
        if tag == "switch":
            actor = parts[2] if len(parts) > 2 else ""
            details = parts[3] if len(parts) > 3 else ""
            species = _species_from_details(details)
            if actor.startswith("p1"):
                text = f'Go! <strong>{html.escape(species)}</strong>!'
            else:
                text = f'{html.escape(p2_name)} sent out <strong>{html.escape(species)}</strong>!'
            add(f'<div class="battle-history">{text}<br></div>')
            add('<div class="spacer battle-history"><br></div>')
            continue
        if tag == "move":
            actor = _pretty_actor(parts[2] if len(parts) > 2 else "")
            move = parts[3] if len(parts) > 3 else ""
            prefix = "The opposing " if str(parts[2]).startswith("p2") else ""
            add(f'<div class="battle-history">{html.escape(prefix + actor)} used <strong>{html.escape(move)}</strong>!<br></div>')
            continue
        if tag == "-supereffective":
            target = _pretty_actor(parts[2] if len(parts) > 2 else "")
            suffix = f" on {target}" if target else ""
            add(f"<div class='battle-history'><small>It's super effective{html.escape(suffix)}!</small><br></div>")
            continue
        if tag == "-resisted":
            target = _pretty_actor(parts[2] if len(parts) > 2 else "")
            suffix = f" on {target}" if target else ""
            add(f"<div class='battle-history'><small>It's not very effective{html.escape(suffix)}...</small><br></div>")
            continue
        if tag == "-immune":
            add("<div class='battle-history'><small>It doesn't affect the target...</small><br></div>")
            continue
        if tag == "-crit":
            add('<div class="battle-history"><small>A critical hit!</small><br></div>')
            continue
        if tag == "-damage":
            target = _pretty_actor(parts[2] if len(parts) > 2 else "")
            hp = parts[3] if len(parts) > 3 else ""
            pct = _hp_percent_from_fraction(hp)
            if hp.endswith(" fnt"):
                continue
            if pct is not None:
                add(f'<div class="battle-history"><small>({html.escape(target)} lost {pct}% of its health!)</small><br></div>')
            continue
        if tag == "-heal":
            target = _pretty_actor(parts[2] if len(parts) > 2 else "")
            add(f'<div class="battle-history"><small>{html.escape(target)} restored a little HP!</small><br></div>')
            continue
        if tag == "-status":
            target = _pretty_actor(parts[2] if len(parts) > 2 else "")
            status = parts[3] if len(parts) > 3 else ""
            add(f'<div class="battle-history"><small>{html.escape(target)} was afflicted with {html.escape(status)}!</small><br></div>')
            continue
        if tag == "-fieldstart":
            move = parts[2].replace("move: ", "") if len(parts) > 2 else ""
            if move == "Psychic Terrain":
                add('<div class="battle-history"><small>The battlefield got weird!</small><br></div>')
            else:
                add(f'<div class="battle-history"><small>{html.escape(move)} began!</small><br></div>')
            continue
        if tag == "-weather":
            weather = parts[2] if len(parts) > 2 else ""
            if weather == "none":
                add('<div class="battle-history"><small>The weather cleared.</small><br></div>')
            else:
                add(f'<div class="battle-history"><small>{html.escape(weather)} is active.</small><br></div>')
            continue
        if tag == "-ability":
            actor = _pretty_actor(parts[2] if len(parts) > 2 else "")
            ability = parts[3] if len(parts) > 3 else ""
            if ability == "As One":
                add(f"<div class='battle-history'>[The opposing {html.escape(actor)}&#39;s As One]<br></div>")
                add(f"<div class='battle-history'><small>The opposing {html.escape(actor)} has two Abilities!</small><br></div>")
            elif ability == "Unnerve":
                add(f"<div class='battle-history'>[The opposing {html.escape(actor)}&#39;s Unnerve]<br></div>")
                add("<div class='battle-history'><small>Your team is too nervous to eat Berries!</small><br></div>")
            else:
                prefix = "The opposing " if str(parts[2]).startswith("p2") else ""
                add(f"<div class='battle-history'>[{html.escape(prefix + actor)}&#39;s {html.escape(ability)}]<br></div>")
            continue
        if tag == "-end":
            actor = _pretty_actor(parts[2] if len(parts) > 2 else "")
            effect = parts[3] if len(parts) > 3 else ""
            if effect == "Illusion":
                add(f'<div class="battle-history"><small>{html.escape(actor)}&#39;s illusion wore off!</small><br></div>')
            continue
        if tag == "-boost":
            actor = _pretty_actor(parts[2] if len(parts) > 2 else "")
            stat = parts[3] if len(parts) > 3 else ""
            amount = int(parts[4]) if len(parts) > 4 and str(parts[4]).lstrip("-").isdigit() else 1
            word = "rose sharply" if amount >= 2 else "rose"
            add(f'<div class="battle-history"><small>{html.escape(actor)}&#39;s {html.escape(stat.title())} {word}!</small><br></div>')
            continue
        if tag == "-activate":
            actor = _pretty_actor(parts[2] if len(parts) > 2 else "")
            reason = parts[3] if len(parts) > 3 else ""
            if "Electric Terrain" in reason:
                add(f'<div class="battle-history"><small>{html.escape(actor)} was protected by Electric Terrain!</small><br></div>')
            continue
        if tag == "-hitcount":
            count = parts[3] if len(parts) > 3 else ""
            add(f'<div class="battle-history"><small>The Pokémon was hit {html.escape(count)} times!</small><br></div>')
            continue
        if tag == "faint":
            actor = _pretty_actor(parts[2] if len(parts) > 2 else "")
            add(f'<div class="battle-history">{html.escape(actor)} fainted!<br></div>')
            continue
        if tag == "replace":
            continue
        if tag == "win":
            winner = parts[2] if len(parts) > 2 else ""
            add(f'<div class="battle-history"><strong>{html.escape(winner)}</strong> won the battle!<br></div>')
            continue

    return "".join(html_parts)


def _build_replay_html(format_id, archetype_label, game, opponent_registry_id=None):
    battle_log_data = _rewrite_replay_player_names(game.get("battleLogData"), p1_name="You", p2_name=archetype_label)
    if not battle_log_data:
        return None
    safe_archetype = html.escape(prettify_template_name(archetype_label or "Opponent"))
    game_number = int(game.get("gameNumber") or 1)
    replay_id = html.escape(_build_replay_id(format_id, archetype_label, game_number, opponent_registry_id=opponent_registry_id))
    title = html.escape(f"[{format_id or 'Benchmark Format'}] Matchup Report replay: You vs. {prettify_template_name(archetype_label or 'Opponent')}")
    winner = _extract_replay_winner(battle_log_data)
    result_label, result_color = _result_from_winner(winner, p1_name="You", p2_name=archetype_label)
    id_suffix = f" [{int(opponent_registry_id)}]" if opponent_registry_id else ""
    style = """html,body {font-family:Verdana, sans-serif;font-size:10pt;margin:0;padding:0;}body{padding:12px 0;}
.battle-log {font-family:Verdana, sans-serif;font-size:10pt;}
.battle-log-inline {border:1px solid #AAAAAA;background:#EEF2F5;color:black;max-width:640px;margin:0 auto 80px;padding-bottom:5px;}
.battle-log .inner {padding:4px 8px 0px 8px;}
.battle-log .inner-preempt {padding:0 8px 4px 8px;}
.battle-log .inner-after {margin-top:0.5em;}
.battle-log h2 {margin:0.5em -8px;padding:4px 8px;border:1px solid #AAAAAA;background:#E0E7EA;border-left:0;border-right:0;font-family:Verdana, sans-serif;font-size:13pt;}
.battle-log .chat {vertical-align:middle;padding:3px 0 3px 0;font-size:8pt;}
.battle-log .chat strong {color:#40576A;}
.battle-log .chat em {padding:1px 4px 1px 3px;color:#000000;font-style:normal;}
.chat.mine {background:rgba(0,0,0,0.05);margin-left:-8px;margin-right:-8px;padding-left:8px;padding-right:8px;}
.spoiler {color:#BBBBBB;background:#BBBBBB;padding:0px 3px;}
.spoiler:hover, .spoiler:active, .spoiler-shown {color:#000000;background:#E2E2E2;padding:0px 3px;}
.spoiler a {color:#BBBBBB;}
.spoiler:hover a, .spoiler:active a, .spoiler-shown a {color:#2288CC;}
.chat code, .chat .spoiler:hover code, .chat .spoiler:active code, .chat .spoiler-shown code {border:1px solid #C0C0C0;background:#EEEEEE;color:black;padding:0 2px;}
.chat .spoiler code {border:1px solid #CCCCCC;background:#CCCCCC;color:#CCCCCC;}
.battle-log .rated {padding:3px 4px;}
.battle-log .rated strong {color:white;background:#89A;padding:1px 4px;border-radius:4px;}
.spacer {margin-top:0.5em;}
.message-announce {background:#6688AA;color:white;padding:1px 4px 2px;}
.message-announce a, .broadcast-green a, .broadcast-blue a, .broadcast-red a {color:#DDEEFF;}
.broadcast-green {background-color:#559955;color:white;padding:2px 4px;}
.broadcast-blue {background-color:#6688AA;color:white;padding:2px 4px;}
.infobox {border:1px solid #6688AA;padding:2px 4px;}
.infobox-limited {max-height:200px;overflow:auto;overflow-x:hidden;}
.broadcast-red {background-color:#AA5544;color:white;padding:2px 4px;}
.message-effect-weak {font-weight:bold;color:#CC2222;}
.message-effect-resist {font-weight:bold;color:#6688AA;}
.message-effect-immune {font-weight:bold;color:#666666;}
.subtle {color:#3A4A66;}"""
    bottom_html = _build_bottom_replay_log_html(battle_log_data, format_id, "You", prettify_template_name(archetype_label or "Opponent"))
    return f"""<!DOCTYPE html>
<meta charset="utf-8" />
<!-- version 1 -->
<title>{title}</title>
<style>{style}</style>
<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">
<input type="hidden" name="replayid" value="{replay_id}" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<h1 style="font-weight:normal;text-align:center"><span class="subtle">You</span> vs. <span class="subtle">{safe_archetype}{html.escape(id_suffix)}</span><br /><span style="display:inline-block;margin-top:6px;font-weight:bold;color:{result_color}">{result_label}</span></h1>
<script type="text/plain" class="battle-log-data">
{battle_log_data}

</script>
</div>
<div class="battle-log battle-log-inline"><div class="inner"><div class="battle-options"></div><div class="inner message-log">{bottom_html}</div><div class="inner-preempt message-log"></div></div></div>
<script>
let daily = Math.floor(Date.now()/1000/60/60/24);document.write('<script src="https://play.pokemonshowdown.com/js/replay-embed.js?version'+daily+'"><'+'/script>');
</script>
"""


def _build_match_archive(format_id, suite_results, user_team_export=None):
    from benchmark_archive_builder import build_match_archive

    archive = build_match_archive(format_id, suite_results, player_team_export=user_team_export, sources_only=True)
    sources = []
    for source in list(archive.get("sources") or []):
        saved_source = dict(source or {})
        saved_source.pop("coachPayload", None)
        sources.append(saved_source)
    return {
        "ready": bool(sources),
        "builderVersion": archive.get("builderVersion"),
        "archiveRoot": archive.get("archiveRoot"),
        "files": [],
        "sources": sources,
        "sourceCount": int(archive.get("sourceCount") or len(sources)),
        "renderedCount": int(archive.get("renderedCount") or 0),
        "storagePolicy": archive.get("storagePolicy") or "sources-only-rebuild-on-download",
    }


def build_suite_danger_advice(template_rows_sorted_worst):
    danger_rows = [row for row in (template_rows_sorted_worst or []) if float(row.get("winRate") or 0) < 40][:3]
    advice_rows = []
    theme_counts = {}

    for row in danger_rows:
        advice = get_matchup_advice(row.get("templateKey")) or {}
        strong_into_it = list(advice.get("strong_into_it") or [])[:3]
        why = str(advice.get("why") or "").strip()
        lean_tags = list(advice.get("lean_tags") or [])
        for tag in lean_tags:
            theme_counts[tag] = int(theme_counts.get(tag) or 0) + 1
        advice_rows.append({
            "templateKey": row.get("templateKey"),
            "templateLabel": row.get("name") or row.get("templateKey") or "Unknown matchup",
            "winRate": float(row.get("winRate") or 0),
            "wins": int(row.get("wins") or 0),
            "losses": int(row.get("losses") or 0),
            "ties": int(row.get("ties") or 0),
            "strongIntoIt": strong_into_it,
            "why": why or "No matchup explanation has been added yet.",
            "themes": lean_tags,
        })

    ordered_themes = sorted(theme_counts.items(), key=lambda item: (-item[1], item[0]))
    common_themes = [THEME_LABELS.get(key, key) for key, _count in ordered_themes[:2]]

    if common_themes:
        if len(common_themes) == 1:
            common_thread = common_themes[0]
            suggested_direction = f"Add more {common_thread}."
        else:
            common_thread = f"{common_themes[0]} and {common_themes[1]}"
            suggested_direction = f"Lean into {common_themes[0]} + {common_themes[1]}."
    else:
        common_thread = None
        suggested_direction = None

    text_lines = []
    for item in advice_rows:
        label = item["templateLabel"]
        strong_text = ", ".join(item["strongIntoIt"]) if item["strongIntoIt"] else "No guidance added yet"
        text_lines.append(f"• {label}")
        text_lines.append(f"  Strong into it: {strong_text}")
        text_lines.append(f"  Why: {item['why']}")
    if suggested_direction:
        text_lines.append(f"• Suggested direction: {suggested_direction}")

    return {
        "dangerMatchups": advice_rows,
        "commonThread": common_thread,
        "suggestedDirection": suggested_direction,
        "noteText": "\n".join(text_lines) if text_lines else None,
    }

def build_benchmark_suite_report(
    format_id,
    benchmark_mode,
    mode_selection,
    suite_results,
    games_per_opponent,
    user_team_validation,
    user_packed_team,
    user_team_export=None,
    lead_pair_sweep=None,
    core_sweep=None,
):
    def _is_true_tie(game):
        return bool(game.get("tie")) and not game.get("winner")

    total_games_completed = 0
    total_turns = 0
    total_wins = 0
    total_losses = 0
    total_ties = 0
    total_failed = 0
    completed_ok = True

    opponent_rows = []
    template_totals = {}

    for suite_entry in suite_results:
        opponent = dict(suite_entry.get("opponent") or {})
        games = list(suite_entry.get("games") or [])

        wins = sum(1 for game in games if game.get("winner") == "Professor Aegis User")
        losses = sum(1 for game in games if game.get("winner") == "Benchmark Opponent")
        ties = sum(1 for game in games if _is_true_tie(game))
        failed = sum(1 for game in games if game.get("failed") or game.get("failureContained"))
        turns = sum(int(game.get("turns") or 0) for game in games)
        average_turns = round(turns / len(games), 2) if games else 0
        win_rate = round((wins / len(games)) * 100, 2) if games else 0
        template_keys = _collect_opponent_template_keys(opponent)

        opponent_rows.append(
            {
                "opponentId": opponent.get("id"),
                "opponentName": opponent.get("name"),
                "archetype": opponent.get("archetype"),
                "templateKey": opponent.get("templateKey"),
                "templateKeys": template_keys,
                "source": opponent.get("source"),
                "featured": bool(opponent.get("featured")),
                "gamesPlayed": len(games),
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "failed": failed,
                "winRate": win_rate,
                "averageTurns": average_turns,
                "summary": opponent.get("summary"),
                "sourcePath": opponent.get("sourcePath"),
            }
        )

        total_games_completed += len(games)
        total_turns += turns
        total_wins += wins
        total_losses += losses
        total_ties += ties
        total_failed += failed
        completed_ok = completed_ok and all(bool(game.get("ok")) for game in games if not (game.get("failed") or game.get("failureContained")))

        for template_key in template_keys:
            stats = template_totals.setdefault(
                template_key,
                {
                    "templateKey": template_key,
                    "templateLabel": _championlab_archetype_label_for_key(opponent, template_key),
                    "opponents": 0,
                    "gamesPlayed": 0,
                    "wins": 0,
                    "losses": 0,
                    "ties": 0,
                    "failed": 0,
                    "totalTurns": 0,
                },
            )
            stats["opponents"] += 1
            stats["gamesPlayed"] += len(games)
            stats["wins"] += wins
            stats["losses"] += losses
            stats["ties"] += ties
            stats["failed"] += failed
            stats["totalTurns"] += turns

    template_rows = []
    for stats in template_totals.values():
        games_played = int(stats["gamesPlayed"] or 0)
        wins = int(stats["wins"] or 0)
        avg_turns = round((stats["totalTurns"] / games_played), 2) if games_played else 0
        win_rate = round((wins / games_played) * 100, 2) if games_played else 0
        template_rows.append(
            {
                "templateKey": stats["templateKey"],
                "templateLabel": stats.get("templateLabel") or prettify_template_name(stats["templateKey"]),
                "opponents": stats["opponents"],
                "gamesPlayed": games_played,
                "wins": wins,
                "losses": stats["losses"],
                "ties": stats["ties"],
                "failed": stats.get("failed", 0),
                "winRate": win_rate,
                "averageTurns": avg_turns,
            }
        )

    opponent_rows_sorted_best = sorted(opponent_rows, key=lambda row: (-row["winRate"], -row["gamesPlayed"], row["opponentName"] or ""))
    opponent_rows_sorted_worst = sorted(opponent_rows, key=lambda row: (row["winRate"], -row["gamesPlayed"], row["opponentName"] or ""))
    template_rows_sorted_best = sorted(template_rows, key=lambda row: (-row["winRate"], -row["gamesPlayed"], row["templateKey"]))
    template_rows_sorted_worst = sorted(template_rows, key=lambda row: (row["winRate"], -row["gamesPlayed"], row["templateKey"]))

    selection = mode_selection if isinstance(mode_selection, dict) else {}
    battle_budget = selection.get("battleBudget")
    battles_per_matchup = selection.get("battlesPerMatchup") or battle_budget
    allocated_games_per_opponent = selection.get("allocatedGamesPerOpponent")
    expected_total_games = selection.get("expectedTotalGames")
    total_games_requested = int(expected_total_games or (int(selection.get("selectedCount") or 0) * int(games_per_opponent or 0)))
    average_turns = round((total_turns / total_games_completed), 2) if total_games_completed else 0
    overall_win_rate = round((total_wins / total_games_completed) * 100, 2) if total_games_completed else 0
    danger_advice = build_suite_danger_advice(template_rows_sorted_worst)
    user_team_export_text = str(user_team_export or '').replace('\r\n', '\n').strip()
    match_archive = _build_match_archive(format_id, suite_results, user_team_export=user_team_export_text)
    all_games = []
    for suite_entry in suite_results:
        all_games.extend(list((suite_entry or {}).get("games") or []))
    policy_metrics = _policy_metrics_from_games(
        all_games,
        games_per_opponent=games_per_opponent,
        benchmark_mode=benchmark_mode,
        mode_selection=mode_selection,
    )

    return {
        "engineVersion": ENGINE_VERSION,
        "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "benchmarkModesVersion": BENCHMARK_MODES_VERSION,
        "reportType": "Python Benchmark Suite Report",
        "simulationMode": "showdown-cli-deterministic-policy",
        "formatId": format_id,
        "showdownReady": True,
        "benchmarkMode": benchmark_mode,
        "selectionSummary": {
            "mode": selection.get("mode"),
            "requestedSampleSize": selection.get("requestedSampleSize"),
            "sampleSizeIgnored": bool(selection.get("sampleSizeIgnored")),
            "selectionSeed": selection.get("selectionSeed"),
            "selectedCount": selection.get("selectedCount"),
            "availableOpponents": selection.get("availableOpponents"),
            "totalRegulationOpponents": selection.get("totalRegulationOpponents"),
            "battleBudget": battle_budget,
            "battlesPerMatchup": battles_per_matchup,
            "battleBudgetAllocationRule": selection.get("battleBudgetAllocationRule"),
            "allocatedGamesPerOpponent": allocated_games_per_opponent,
            "expectedTotalGames": expected_total_games,
            "seriesLength": selection.get("seriesLength"),
            "boStyle": selection.get("boStyle"),
            "earlySeriesCutoff": selection.get("earlySeriesCutoff"),
            "sweepMode": bool(selection.get("sweepMode")),
            "sweepModeLabel": selection.get("sweepModeLabel"),
            "opponentSource": selection.get("opponentSource"),
            "excludesUserTeams": bool(selection.get("excludesUserTeams")),
            "hydrationChunkSize": selection.get("hydrationChunkSize"),
        },
        "userTeamValidation": user_team_validation,
        "playerTeamExport": user_team_export_text,
        "userTeamExport": user_team_export_text,
        "packedTeamAvailable": bool(user_packed_team),
        "packedTeam": user_packed_team,
        "battleBudget": battle_budget,
        "battlesPerMatchup": battles_per_matchup,
        "battleBudgetAllocationRule": selection.get("battleBudgetAllocationRule"),
        "allocatedGamesPerOpponent": allocated_games_per_opponent,
        "battleBudgetExpectedTotalGames": expected_total_games,
        "gamesPerOpponent": int(games_per_opponent),
        "policy": "deterministic preview and active-turn policy for both sides",
        "policyVersion": policy_metrics.get("policyVersion"),
        "policyMetrics": policy_metrics,
        "opponentsRequested": int(selection.get("selectedCount") or 0),
        "opponentsCompleted": len(opponent_rows),
        "totalGamesRequested": total_games_requested,
        "totalGamesCompleted": total_games_completed,
        "totalGamesAttempted": total_games_completed,
        "totalGamesEffective": total_games_completed,
        "totalGamesFailed": total_failed,
        "wins": total_wins,
        "losses": total_losses,
        "ties": total_ties,
        "winRate": overall_win_rate,
        "averageTurns": average_turns,
        "completedOk": completed_ok,
        "resultsByOpponent": opponent_rows,
        "resultsByTemplate": template_rows,
        "bestOpponents": opponent_rows_sorted_best[:5],
        "worstOpponents": opponent_rows_sorted_worst[:5],
        "bestTemplates": template_rows_sorted_best[:3],
        "worstTemplates": template_rows_sorted_worst[:3],
        "dangerAdvice": danger_advice["dangerMatchups"],
        "commonThread": danger_advice["commonThread"],
        "suggestedDirection": danger_advice["suggestedDirection"],
        "noteText": danger_advice["noteText"] or "This matchup report aggregates actual Showdown battle results across the selected benchmark pool.",
        "matchArchive": match_archive,
        "leadPairSweep": lead_pair_sweep if isinstance(lead_pair_sweep, dict) else build_lead_pair_sweep_report(user_team_export_text, status="not-run"),
        "coreSweep": core_sweep if isinstance(core_sweep, dict) else build_core_sweep_report(user_team_export_text, status="not-run"),
        "generatedAt": utc_now_iso(),
    }


def build_benchmark_suite_plan_from_team(team_export, format_id=None):
    matchup_eval = build_matchup_eval_from_team(team_export, template_keys=None, battle_count=20, showdown_ready=True, format_id=format_id)
    return {
        "engineVersion": ENGINE_VERSION,
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "benchmarkModesVersion": BENCHMARK_MODES_VERSION,
        "formatId": format_id or None,
        "priorityTemplates": matchup_eval["priorityTemplates"],
        "priorityTemplateDetails": matchup_eval["priorityTemplateDetails"],
        "benchmarkModes": matchup_eval["benchmarkModes"],
        "benchmarkModePlan": matchup_eval["benchmarkModePlan"],
        "generatedAt": utc_now_iso(),
    }


def build_weakness_report_from_team(team_export):
    parsed = parse_team_export(team_export)
    pokemon = parsed["pokemon"]
    signals = build_signals(pokemon)
    archetype_evaluations = evaluate_archetypes(signals)
    best_archetypes = sorted(archetype_evaluations, key=lambda a: (-a["winRate"], -a["score"]))[:3]
    worst_archetypes = sorted(archetype_evaluations, key=lambda a: (a["winRate"], a["score"]))[:3]

    lead_evaluations = [evaluate_lead_pair([a, b], signals) for a, b in combinations(signals["profiles"], 2)]
    strongest_leads = sorted(
        [entry for entry in lead_evaluations if entry["strongText"] and entry["strongScore"] >= 2],
        key=lambda a: (-a["strongScore"], a["riskScore"]),
    )[:3]
    strong_pair_names = {entry["pairName"] for entry in strongest_leads}
    weak_leads = sorted(
        [entry for entry in lead_evaluations if entry["riskText"] and entry["pairName"] not in strong_pair_names],
        key=lambda a: (-a["riskScore"], a["strongScore"]),
    )[:3]

    overall_read = build_overall_read(signals)
    coach_bundle = build_coach_notes(signals, worst_archetypes)
    matchup_eval = build_matchup_eval_from_team(team_export, template_keys=None, battle_count=20, showdown_ready=False, format_id=None)

    return {
        "analyzerVersion": ENGINE_VERSION,
        "templateLibraryVersion": TEMPLATE_LIBRARY_VERSION,
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "benchmarkModesVersion": BENCHMARK_MODES_VERSION,
        "reportType": "Python Showdown-Ready Weakness Report",
        "overallSpread": overall_read,
        "summaryHeadline": overall_read,
        "summaryBody": build_plain_language_summary(signals, overall_read.lower()),
        "strengths": build_strengths(signals, best_archetypes),
        "weaknesses": build_weaknesses(signals, worst_archetypes),
        "bestLeads": [entry["strongText"] for entry in strongest_leads],
        "leadWarnings": [entry["riskText"] for entry in weak_leads],
        "coachNotes": coach_bundle["coachNotes"],
        "glossaryNotes": build_glossary(signals),
        "bestArchetypes": [{"key": item["key"], "name": item["name"], "winRate": item["winRate"]} for item in best_archetypes],
        "worstArchetypes": [{"key": item["key"], "name": item["name"], "winRate": item["winRate"]} for item in worst_archetypes],
        "weakLeads": [entry["riskText"] for entry in weak_leads],
        "issueNotes": coach_bundle["issueNotes"],
        "templateMatchNotes": [
            {
                "key": item["key"],
                "name": item["name"],
                "summary": item["summary"],
                "notes": item["notes"][:2],
                "commonPressures": item["commonPressures"][:2],
                "evaluationFocus": item["evaluationFocus"][:2],
            }
            for item in best_archetypes
        ],
        "matchupEvalPlan": {
            "readyForShowdownEval": True,
            "recommendedBattleCount": 20,
            "priorityTemplates": matchup_eval["priorityTemplates"],
            "priorityTemplateDetails": matchup_eval["priorityTemplateDetails"],
            "benchmarkModes": matchup_eval["benchmarkModes"],
            "benchmarkModePlan": matchup_eval["benchmarkModePlan"],
            "why": "Focus eval time first on the archetypes your structural read says are shakiest, then validate one favorable archetype as a sanity check.",
        },
        "generatedAt": utc_now_iso(),
    }
