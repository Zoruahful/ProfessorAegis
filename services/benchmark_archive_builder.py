import copy
import base64
import html
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List

from benchmark_coach_payload import build_coaching_payload
from benchmark_archetypes import classify_team_archetype
from benchmark_replay_renderer import build_replay_html, extract_replay_winner, prettify_template_name, result_from_winner, slugify_filename
from benchmark_repo_teams import get_champions_sp_display_export, get_repo_opponent_records, hydrate_repo_opponent_records

# ============================================================
# Archive builder metadata
# Edit these when you want to version or rename archive output.
# ============================================================
ARCHIVE_BUILDER_VERSION = "2026.04.23-archive-builder-v3-phase1-stable"
ARCHIVE_ROOT = "matchup-report"


def _display_team_export(format_id: Any, team_export: Any) -> str:
    raw = str(team_export or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not raw:
        return ""
    try:
        return str(get_champions_sp_display_export(raw, str(format_id or "").strip().lower())).replace("\r\n", "\n").replace("\r", "\n").strip()
    except Exception:
        return raw


def _series_result_label(series_result: Any) -> str:
    value = str(series_result or "").strip().lower()
    if value == "win":
        return "Wins"
    if value == "loss":
        return "Losses"
    return "Ties"


def _individual_game_result_label(game_result: Any) -> str:
    value = str(game_result or "").strip().lower()
    if value in {"win", "loss", "tie"}:
        return value
    return "unknown"


def _clean_archive_label(value: Any) -> str:
    return str(value or "").strip()


def _archive_label_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")


def _is_generic_archetype_label(value: Any) -> bool:
    key = _archive_label_key(value)
    if not key:
        return True
    generic = {
        "unknown",
        "unknown-archetype",
        "unknown-matchup",
        "tournament",
        "generated",
        "generated-random",
        "random",
        "all-meta",
        "all-meta-all-tournament",
        "goodstuffs",
        "good-stuffs",
        "good-stuff",
        "featured-meta",
        "dynamic-meta-pool",
        "full-regulation",
        "s-tier-top-tournament",
        "s-a-tier-top-4-tournament",
        "full-meta-100-random",
        "gauntlet-full-meta-200-random",
    }
    if key in generic:
        return True
    if key.startswith("tournament-") or key.endswith("-tournament"):
        return True
    if "generated-random" in key or "all-meta" in key or "full-meta" in key:
        return True
    return False


def _clean_final_archetype_label(value: Any) -> str:
    label = _clean_archive_label(value)
    if not label or _is_generic_archetype_label(label):
        return ""
    return prettify_template_name(label)


def _metadata_archetype_label(record: Dict[str, Any] | None) -> str:
    if not isinstance(record, dict):
        return ""
    direct_keys = (
        "finalArchetypeLabel",
        "final_archetype_label",
        "displayLabel",
        "display_label",
    )
    for key in direct_keys:
        label = _clean_final_archetype_label(record.get(key))
        if label:
            return label

    metadata_keys = (
        "archetypeMetadata",
        "opponentArchetypeMetadata",
        "matchupArchetypeMetadata",
        "templateArchetypeMetadata",
    )
    for key in metadata_keys:
        metadata = record.get(key)
        if not isinstance(metadata, dict):
            continue
        for label_key in ("displayLabel", "display_label", "primaryLabel", "primary_label", "compactHybridLabel", "hybridLabel"):
            label = _clean_final_archetype_label(metadata.get(label_key))
            if label:
                return label
    return ""


def _classify_archetype_label_from_records(*records: Dict[str, Any]) -> str:
    for record in records:
        if not isinstance(record, dict):
            continue
        team_export = (
            record.get("opponentTeamExport")
            or record.get("teamExport")
            or record.get("team_export")
            or record.get("pokemonShowdownExport")
            or ""
        )
        if not _clean_archive_label(team_export):
            continue
        source_label = (
            record.get("finalArchetypeLabel")
            or record.get("archetype")
            or record.get("opponentArchetype")
            or record.get("templateLabel")
            or record.get("templateKey")
            or ""
        )
        try:
            result = classify_team_archetype(team_export, source_label=source_label, source_kind="archive-source")
            label = _clean_final_archetype_label((result or {}).get("displayLabel") or (result or {}).get("primaryLabel"))
            if label:
                return label
        except Exception:
            continue
    return ""


def _source_archetype_label(*records: Dict[str, Any]) -> str:
    for record in records:
        label = _metadata_archetype_label(record)
        if label:
            return label

    keys = (
        ("championLabArchetype", False),
        ("championlabArchetype", False),
        ("sourceArchetype", False),
        ("archetype", False),
        ("opponentArchetype", False),
        ("templateLabel", False),
        ("templateKey", True),
    )
    for record in records:
        if not isinstance(record, dict):
            continue
        for key, should_prettify in keys:
            label = _clean_archive_label(record.get(key))
            label = prettify_template_name(label) if should_prettify else label
            label = _clean_final_archetype_label(label)
            if label:
                return label

    classified = _classify_archetype_label_from_records(*records)
    if classified:
        return classified
    return "Battle Team"


def _is_generic_team_name(value: Any, archetype_label: Any = None) -> bool:
    text = _clean_archive_label(value)
    if not text:
        return True
    key = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    archetype_key = re.sub(r"[^a-z0-9]+", "-", str(archetype_label or "").lower()).strip("-")
    generic = {
        "opponent",
        "benchmark-opponent",
        "tournament",
        "tournament-team",
        "team",
        "unknown",
        "unknown-team",
        "unknown-opponent",
    }
    if key in generic:
        return True
    if re.fullmatch(r"tournament-team-\d+", key):
        return True
    if archetype_key and key == archetype_key:
        return True
    return False


def _source_team_name(opponent: Dict[str, Any] | None = None, game: Dict[str, Any] | None = None, source: Dict[str, Any] | None = None, archetype_label: Any = None) -> str:
    candidates = []
    for record in (opponent, game, source):
        if not isinstance(record, dict):
            continue
        candidates.extend([
            record.get("teamName"),
            record.get("team_name"),
            record.get("displayName"),
            record.get("display_name"),
            record.get("opponentTeamName"),
            record.get("opponent_team_name"),
            record.get("player"),
            record.get("name"),
            record.get("opponentName"),
        ])
    for candidate in candidates:
        label = _clean_archive_label(candidate)
        if label and not _is_generic_team_name(label, archetype_label):
            return label
    return ""


def _build_opponent_folder_name(opponent_registry_id: Any, archetype_label: Any) -> str:
    return _sanitize_archive_folder_label(archetype_label or "Unknown Archetype", "Unknown Archetype")


def _build_opponent_file_name(game_number: Any = 1, game_result: Any = None, team_name: Any = None, opponent_registry_id: Any = None, archetype_label: Any = None) -> str:
    game_number = int(game_number or 1)
    archetype_slug = slugify_filename(archetype_label or "unknown-archetype") or "unknown-archetype"
    result_label = _individual_game_result_label(game_result)
    if team_name and not _is_generic_team_name(team_name, archetype_label):
        stem = slugify_filename(team_name) or archetype_slug
    else:
        opponent_id = int(opponent_registry_id or 0)
        stem = f"{opponent_id}-{archetype_slug}" if opponent_id > 0 else archetype_slug
    return f"{stem}-{result_label}-game-{game_number}.html"


def _with_collision_safe_relative_path(source: Dict[str, Any], used_paths: Dict[str, int]) -> Dict[str, Any]:
    source = dict(source or {})
    relative_path = str(source.get("relativePath") or "").replace("\\", "/").lstrip("/")
    if not relative_path:
        return source
    key = relative_path.lower()
    if key not in used_paths:
        used_paths[key] = 1
        return source

    path = Path(relative_path)
    counter = used_paths[key] + 1
    candidate = str(path.with_name(f"{path.stem}-copy-{counter}{path.suffix}")).replace("\\", "/")
    candidate_key = candidate.lower()
    while candidate_key in used_paths:
        counter += 1
        candidate = str(path.with_name(f"{path.stem}-copy-{counter}{path.suffix}")).replace("\\", "/")
        candidate_key = candidate.lower()
    used_paths[key] = counter
    used_paths[candidate_key] = 1
    source["relativePath"] = candidate
    source["filename"] = candidate.split("/")[-1]
    return source


def _sanitize_archive_folder_label(value: Any, fallback: str = "Folder", max_length: int = 96) -> str:
    text = str(value or fallback).strip() or fallback
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    if not text:
        text = fallback
    if len(text) > max_length:
        text = text[:max_length].rstrip(" .")
    return text or fallback


def _lead_pair_folder_name(rank: Any, label: Any) -> str:
    rank_number = int(rank or 0)
    pair_label = _sanitize_archive_folder_label(label or "Lead Pair", "Lead Pair", max_length=88)
    return f"[#{rank_number}] {pair_label}"


def _core_folder_name(rank: Any, label: Any) -> str:
    rank_number = int(rank or 0)
    core_label = _sanitize_archive_folder_label(label or "Core", "Core", max_length=88)
    return f"[#{rank_number}] {core_label}"


def _extract_battle_log_from_legacy_html(html_text: Any) -> str:
    text = str(html_text or "")
    match = re.search(r'<script[^>]*class="battle-log-data"[^>]*>\s*(.*?)\s*</script>', text, re.S | re.I)
    return html.unescape(match.group(1)).strip() if match else ""


def _extract_opponent_registry_id_from_legacy_html(html_text: Any) -> int:
    text = str(html_text or "")
    match = re.search(r'vs\.\s*.*?\[(\d+)\]', text, re.I | re.S)
    return int(match.group(1)) if match else 0


def _infer_game_result_from_source(source: Dict[str, Any]) -> str:
    explicit = _individual_game_result_label(source.get("result") or source.get("verdict"))
    if explicit != "unknown":
        return explicit

    winner = str(source.get("winner") or "").strip()
    if not winner and source.get("battleLogData"):
        winner = extract_replay_winner(source.get("battleLogData"))

    p1_name = str(source.get("playerName") or "You").strip() or "You"
    p2_name = str(source.get("opponentName") or source.get("archetype") or "Opponent").strip() or "Opponent"

    winner_key = winner.lower()
    p1_key = p1_name.lower()
    p2_key = p2_name.lower()

    if winner_key == p1_key:
        return "win"
    if winner_key == p2_key:
        return "loss"

    player_aliases = {
        "you",
        "player",
        "p1",
        "professor aegis user",
    }
    opponent_aliases = {
        "opponent",
        "benchmark opponent",
        "cpu",
        "ai",
        "p2",
    }

    if winner_key in player_aliases:
        return "win"
    if winner_key in opponent_aliases:
        return "loss"

    if winner:
        return "tie"
    return "unknown"


def _infer_series_result_from_games(games: List[Dict[str, Any]]) -> str:
    wins = sum(1 for game in games if _infer_game_result_from_source(game) == "win")
    losses = sum(1 for game in games if _infer_game_result_from_source(game) == "loss")
    ties = sum(1 for game in games if _infer_game_result_from_source(game) == "tie")
    if wins > losses and wins >= ties:
        return "win"
    if losses > wins and losses >= ties:
        return "loss"
    return "tie"




def _find_repo_opponent_team_export(format_id: Any, opponent_registry_id: Any, archetype_label: Any) -> str:
    target_id = int(opponent_registry_id or 0)
    target_name = prettify_template_name(archetype_label or "Opponent").strip().lower()

    def converted_export(record: Dict[str, Any]) -> str:
        raw_export = str((record or {}).get("teamExport") or "").replace("\r\n", "\n").strip()
        try:
            hydrated = hydrate_repo_opponent_records([dict(record or {})], format_id=format_id)
        except Exception:
            return _display_team_export(format_id, raw_export)
        for item in hydrated:
            export = str((item or {}).get("teamExport") or "").replace("\r\n", "\n").strip()
            if export:
                return _display_team_export(format_id, export)
        return _display_team_export(format_id, raw_export)

    try:
        records = get_repo_opponent_records(format_id=format_id, featured_only=False, limit=None)
    except Exception:
        return ""
    for record in records:
        if target_id and int(record.get("opponentRegistryId") or 0) == target_id:
            return converted_export(record)
    for record in records:
        if prettify_template_name(record.get("name") or "").strip().lower() == target_name:
            return converted_export(record)
    return ""


def _hydrate_missing_team_exports(report: Dict[str, Any], source: Dict[str, Any]) -> Dict[str, Any]:
    # SQLite fallback was intentionally removed here so archive rebuilding no longer depends on the legacy runtime database.
    source = dict(source or {})
    player_export = str(source.get("playerTeamExport") or "").replace("\r\n", "\n").strip()
    if not player_export:
        player_export = (
            str(report.get("playerTeamExport") or report.get("userTeamExport") or "").replace("\r\n", "\n").strip()
            or str((report.get("request") or {}).get("teamExport") or (report.get("request") or {}).get("team_export") or "").replace("\r\n", "\n").strip()
            or str((report.get("savedReport") or {}).get("playerTeamExport") or (report.get("savedReport") or {}).get("userTeamExport") or (report.get("savedReport") or {}).get("teamExport") or (report.get("savedReport") or {}).get("team_export") or "").replace("\r\n", "\n").strip()
        )
    opponent_export = str(source.get("opponentTeamExport") or "").replace("\r\n", "\n").strip()
    if not opponent_export:
        opponent_export = _find_repo_opponent_team_export(
            source.get("formatId") or report.get("formatId"),
            source.get("opponentRegistryId"),
            source.get("archetype") or source.get("opponentName"),
        )
    format_id = source.get("formatId") or report.get("formatId")
    source["playerTeamExport"] = _display_team_export(format_id, player_export)
    source["opponentTeamExport"] = _display_team_export(format_id, opponent_export)
    return source

# ============================================================
# Small path/source helpers
# Keep archive naming logic in this section.
# ============================================================
def _build_archive_filename(
    game_number: Any,
    game_result: Any = None,
    team_name: Any = None,
    opponent_registry_id: Any = None,
    archetype_label: Any = None,
) -> str:
    return _build_opponent_file_name(game_number, game_result, team_name, opponent_registry_id, archetype_label)


def _build_archive_relative_path(series_result: Any, opponent_registry_id: Any, archetype_label: Any, game_number: Any, game_result: Any = None, opponent_name: Any = None, team_name: Any = None) -> str:
    result_folder = _series_result_label(series_result)
    opponent_folder = _build_opponent_folder_name(opponent_registry_id, archetype_label)
    return f"Main Simulation/{result_folder}/{opponent_folder}/{_build_opponent_file_name(game_number, game_result, team_name or opponent_name, opponent_registry_id, archetype_label)}"


def _build_lead_pair_relative_path(rank: Any, lead_pair_label: Any, game_number: Any, game_result: Any = None, opponent_name: Any = None, opponent_registry_id: Any = None, archetype_label: Any = None) -> str:
    result_folder = _series_result_label(game_result)
    pair_folder = _lead_pair_folder_name(rank, lead_pair_label)
    return f"Lead Pair Sweep/{pair_folder}/{result_folder}/{_build_archive_filename(game_number, game_result, opponent_name, opponent_registry_id, archetype_label)}"


def _build_core_relative_path(rank: Any, core_label: Any, game_number: Any, game_result: Any = None, opponent_name: Any = None, opponent_registry_id: Any = None, archetype_label: Any = None) -> str:
    result_folder = _series_result_label(game_result)
    core_folder = _core_folder_name(rank, core_label)
    return f"Core Sweep/{core_folder}/{result_folder}/{_build_archive_filename(game_number, game_result, opponent_name, opponent_registry_id, archetype_label)}"


def _archive_file_sort_key(entry: Dict[str, Any]) -> tuple:
    relative_path = str((entry or {}).get("relativePath") or "").replace("\\", "/")
    if relative_path == "PaperReport.pdf":
        return (0, 0, "", 0, 0, relative_path)
    parts = relative_path.split("/")
    root_order = {"main simulation": 1, "lead pair sweep": 2, "core sweep": 3}
    result_order = {"wins": 1, "losses": 2, "ties": 3}
    root_rank = root_order.get(parts[0].lower() if parts else "", 9)
    if (parts[0].lower() if parts else "") in {"lead pair sweep", "core sweep"}:
        rank_match = re.search(r"\[#(\d+)\]", parts[1] if len(parts) > 1 else "")
        sweep_rank = int(rank_match.group(1)) if rank_match else 999
        result_rank = result_order.get(parts[2].lower() if len(parts) > 2 else "", 9)
        game_number = int((entry or {}).get("gameNumber") or 0)
        return (root_rank, sweep_rank, result_rank, 0, game_number, relative_path.lower())
    result_rank = result_order.get(parts[1].lower() if len(parts) > 1 else "", 9)
    opponent_id = int((entry or {}).get("opponentRegistryId") or 0)
    opponent_folder = parts[2].lower() if len(parts) > 2 else ""
    game_number = int((entry or {}).get("gameNumber") or 0)
    return (root_rank, result_rank, opponent_folder, opponent_id, game_number, relative_path.lower())


def _build_source_entry(
    format_id: Any,
    opponent: Dict[str, Any],
    game: Dict[str, Any],
    series_result: Any = None,
    player_team_export: Any = "",
    include_coach_payload: bool = True,
) -> Dict[str, Any]:
    game_number = int((game or {}).get("gameNumber") or 1)
    archetype_label = _source_archetype_label(opponent, game)
    team_name = _source_team_name(opponent, game, archetype_label=archetype_label)
    opponent_registry_id = int((opponent or {}).get("opponentRegistryId") or (game or {}).get("opponentRegistryId") or 0)
    game_result = (game or {}).get("result") or (game or {}).get("verdict")
    series_result = series_result or game_result
    entry = {
        "formatId": format_id,
        "archetype": archetype_label,
        "opponentRegistryId": opponent_registry_id,
        "gameNumber": game_number,
        "relativePath": _build_archive_relative_path(
            series_result,
            opponent_registry_id,
            archetype_label,
            game_number,
            game_result,
            (game or {}).get("opponentName") or archetype_label,
            team_name,
        ),
        "filename": _build_opponent_file_name(game_number, game_result, team_name, opponent_registry_id, archetype_label),
        "seriesResult": str(series_result or "").strip().lower() or "tie",
        "battleLogData": (game or {}).get("battleLogData") or (game or {}).get("archiveBattleLogData") or "",
        "winner": (game or {}).get("winner"),
        "result": (game or {}).get("result"),
        "turns": (game or {}).get("turns"),
        "seed": (game or {}).get("seed"),
        "playerName": (game or {}).get("playerName") or "You",
        "opponentName": (game or {}).get("opponentName") or team_name or prettify_template_name(archetype_label or "Opponent"),
        "opponentTeamName": team_name,
        "playerTeamExport": _display_team_export(format_id, (game or {}).get("playerTeamExport") or (game or {}).get("userTeamExport") or player_team_export or ""),
        "opponentTeamExport": _display_team_export(format_id, (opponent or {}).get("teamExport") or (game or {}).get("opponentTeamExport") or ""),
    }
    if include_coach_payload and entry["battleLogData"]:
        winner = entry["winner"] or extract_replay_winner(entry["battleLogData"])
        result_label, _ = result_from_winner(winner, p1_name=entry["playerName"], p2_name=entry["opponentName"])
        entry["coachPayload"] = build_coaching_payload(entry["battleLogData"], result_label)
    return entry


def _render_file_from_source(source: Dict[str, Any]) -> Dict[str, Any] | None:
    html_text = build_replay_html(source.get("formatId"), source.get("archetype"), source, opponent_registry_id=source.get("opponentRegistryId"))
    if not html_text:
        return None
    return {
        "archetype": source.get("archetype"),
        "opponentRegistryId": int(source.get("opponentRegistryId") or 0),
        "gameNumber": int(source.get("gameNumber") or 1),
        "filename": source.get("filename") or _build_opponent_file_name(source.get("gameNumber"), source.get("result"), _source_team_name(source=source, archetype_label=source.get("archetype")), source.get("opponentRegistryId"), source.get("archetype")),
        "relativePath": source.get("relativePath") or _build_archive_relative_path(
            source.get("seriesResult"),
            source.get("opponentRegistryId"),
            source.get("archetype"),
            source.get("gameNumber"),
            source.get("result"),
            source.get("opponentName"),
            _source_team_name(source=source, archetype_label=source.get("archetype")),
        ),
        "html": html_text,
        "includesPaperReportPdf": False,
    }


def _lead_pair_label_from_row(row: Dict[str, Any]) -> str:
    label = str((row or {}).get("label") or (row or {}).get("pairName") or (row or {}).get("name") or "").strip()
    if label:
        return label
    pair = (row or {}).get("pair")
    if isinstance(pair, list):
        names = []
        for item in pair[:2]:
            if isinstance(item, str):
                names.append(item)
            elif isinstance(item, dict):
                names.append(str(item.get("species") or item.get("name") or item.get("pokemon") or "").strip())
        names = [name for name in names if name]
        if len(names) >= 2:
            return " + ".join(names[:2])
    return "Lead Pair"


def _pokemon_name_from_row_item(item: Any) -> str:
    if isinstance(item, str):
        return str(item).strip()
    if isinstance(item, dict):
        return str(item.get("species") or item.get("name") or item.get("pokemon") or item.get("pokemonName") or "").strip()
    return ""


def _core_members_from_row(row: Dict[str, Any]) -> List[Any]:
    for key in ("actualSelectedCore", "core", "members", "pokemon"):
        value = (row or {}).get(key)
        if isinstance(value, list) and len(value) >= 4:
            return value[:4]
    value = (row or {}).get("plannedCore")
    if (row or {}).get("coreMatched") is True and isinstance(value, list) and len(value) >= 4:
        return value[:4]
    return []


def _core_label_from_row(row: Dict[str, Any]) -> str:
    members = _core_members_from_row(row)
    names = [_pokemon_name_from_row_item(member) for member in members[:4]]
    names = [name for name in names if name]
    if len(names) >= 4:
        return " + ".join(names[:4])
    label = str((row or {}).get("label") or (row or {}).get("coreName") or (row or {}).get("name") or "").strip()
    return label or "Core"


def _lead_pair_rows_from_report(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    compact_summary = report.get("compactSummary") if isinstance(report.get("compactSummary"), dict) else {}
    lead_rows = compact_summary.get("bestLeadPairs")
    if not isinstance(lead_rows, list) or not lead_rows:
        summary = report.get("summary") if isinstance(report.get("summary"), dict) else {}
        lead_rows = summary.get("bestLeadPairs")
    if not isinstance(lead_rows, list) or not lead_rows:
        lead_rows = report.get("bestLeadPairs")
    if not isinstance(lead_rows, list) or not lead_rows:
        sweep = report.get("leadPairSweep") if isinstance(report.get("leadPairSweep"), dict) else {}
        lead_rows = sweep.get("results")
    if not isinstance(lead_rows, list):
        return []
    ranked = []
    for index, row in enumerate(lead_rows, start=1):
        if not isinstance(row, dict):
            continue
        rank = int(row.get("rank") or row.get("leadPairRank") or index)
        if rank <= 0:
            continue
        ranked.append((rank, index, row))
    ranked.sort(key=lambda item: (item[0], item[1]))
    return [row for _, _, row in ranked[:5]]


def _core_rows_from_report(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    compact_summary = report.get("compactSummary") if isinstance(report.get("compactSummary"), dict) else {}
    core_rows = compact_summary.get("bestCores")
    if not isinstance(core_rows, list) or not core_rows:
        summary = report.get("summary") if isinstance(report.get("summary"), dict) else {}
        core_rows = summary.get("bestCores")
    if not isinstance(core_rows, list) or not core_rows:
        core_rows = report.get("bestCores")
    if not isinstance(core_rows, list) or not core_rows:
        sweep = report.get("coreSweep") if isinstance(report.get("coreSweep"), dict) else {}
        core_rows = sweep.get("results")
    if not isinstance(core_rows, list):
        return []
    ranked = []
    for index, row in enumerate(core_rows, start=1):
        if not isinstance(row, dict):
            continue
        if row.get("coreMatched") is not True:
            continue
        rank = int(row.get("coreRank") or row.get("rank") or index)
        if rank <= 0:
            continue
        if not _core_members_from_row(row):
            continue
        ranked.append((rank, index, row))
    ranked.sort(key=lambda item: (item[0], item[1]))
    return [row for _, _, row in ranked[:2]]


def _lead_pair_replay_refs_for_row(report: Dict[str, Any], row: Dict[str, Any]) -> List[Dict[str, Any]]:
    refs = row.get("replayRefs")
    if isinstance(refs, list) and refs:
        return [dict(ref or {}) for ref in refs if isinstance(ref, dict)]
    pair_id = str(row.get("pairId") or "").strip()
    if not pair_id:
        return []
    sweep = report.get("leadPairSweep") if isinstance(report.get("leadPairSweep"), dict) else {}
    for sweep_row in list(sweep.get("results") or []):
        if not isinstance(sweep_row, dict):
            continue
        if str(sweep_row.get("pairId") or "").strip() == pair_id and isinstance(sweep_row.get("replayRefs"), list):
            return [dict(ref or {}) for ref in sweep_row.get("replayRefs") if isinstance(ref, dict)]
    return []


def _core_replay_refs_for_row(report: Dict[str, Any], row: Dict[str, Any]) -> List[Dict[str, Any]]:
    refs = row.get("coreReplayRefs")
    if isinstance(refs, list) and refs:
        return [dict(ref or {}) for ref in refs if isinstance(ref, dict)]
    refs = row.get("replayRefs")
    if isinstance(refs, list) and refs:
        return [dict(ref or {}) for ref in refs if isinstance(ref, dict)]
    core_id = str(row.get("coreId") or "").strip()
    if not core_id:
        return []
    sweep = report.get("coreSweep") if isinstance(report.get("coreSweep"), dict) else {}
    for sweep_row in list(sweep.get("results") or []):
        if not isinstance(sweep_row, dict):
            continue
        if str(sweep_row.get("coreId") or "").strip() != core_id:
            continue
        refs = sweep_row.get("coreReplayRefs")
        if isinstance(refs, list) and refs:
            return [dict(ref or {}) for ref in refs if isinstance(ref, dict)]
        refs = sweep_row.get("replayRefs")
        if isinstance(refs, list):
            return [dict(ref or {}) for ref in refs if isinstance(ref, dict)]
    return []


def _build_lead_pair_sweep_sources(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    sources: List[Dict[str, Any]] = []
    for row_index, row in enumerate(_lead_pair_rows_from_report(report), start=1):
        rank = int(row.get("rank") or row.get("leadPairRank") or row_index)
        if rank <= 0 or rank > 5:
            continue
        lead_pair_label = _lead_pair_label_from_row(row)
        for index, ref in enumerate(_lead_pair_replay_refs_for_row(report, row), start=1):
            source = copy.deepcopy(dict(ref or {}))
            if not source.get("battleLogData") and not source.get("html"):
                continue
            source["sourceKind"] = "lead-pair-sweep"
            source["leadPairRank"] = rank
            source["leadPairName"] = lead_pair_label
            source["formatId"] = source.get("formatId") or report.get("formatId") or report.get("savedReport", {}).get("formatId") or "Benchmark Format"
            source["gameNumber"] = int(source.get("gameNumber") or index)
            source["playerName"] = source.get("playerName") or "You"
            source["archetype"] = _source_archetype_label(source, row, report)
            source["opponentName"] = source.get("opponentName") or source.get("archetype") or "Opponent"
            source["opponentRegistryId"] = int(source.get("opponentRegistryId") or 0)
            source["winner"] = source.get("winner") or (extract_replay_winner(source.get("battleLogData")) if source.get("battleLogData") else None)
            game_result = _infer_game_result_from_source(source)
            if game_result == "unknown":
                continue
            source["result"] = game_result
            source["seriesResult"] = game_result
            source = _hydrate_missing_team_exports(report, source)
            team_name = _source_team_name(source=source, archetype_label=source.get("archetype"))
            source["opponentTeamName"] = team_name
            source["filename"] = _build_archive_filename(source.get("gameNumber"), game_result, team_name or source.get("opponentName"), source.get("opponentRegistryId"), source.get("archetype"))
            source["relativePath"] = _build_lead_pair_relative_path(rank, lead_pair_label, source.get("gameNumber"), game_result, team_name or source.get("opponentName"), source.get("opponentRegistryId"), source.get("archetype"))
            if source.get("battleLogData") and not source.get("coachPayload"):
                result_label, _ = result_from_winner(source.get("winner"), p1_name=source.get("playerName") or "You", p2_name=source.get("opponentName") or "Opponent")
                source["coachPayload"] = build_coaching_payload(source.get("battleLogData"), result_label)
            sources.append(source)
    return sources


def _build_core_sweep_sources(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    sources: List[Dict[str, Any]] = []
    for row_index, row in enumerate(_core_rows_from_report(report), start=1):
        rank = int(row.get("coreRank") or row.get("rank") or row_index)
        if rank <= 0 or rank > 2:
            continue
        core_label = _core_label_from_row(row)
        for index, ref in enumerate(_core_replay_refs_for_row(report, row), start=1):
            source = copy.deepcopy(dict(ref or {}))
            if source.get("coreMatched") is not True and row.get("coreMatched") is not True:
                continue
            if not source.get("battleLogData") and not source.get("html"):
                continue
            source["sourceKind"] = "core-sweep"
            source["coreRank"] = rank
            source["coreName"] = core_label
            source["actualSelectedCore"] = source.get("actualSelectedCore") or row.get("actualSelectedCore") or []
            source["plannedCore"] = source.get("plannedCore") or row.get("plannedCore") or row.get("core") or []
            source["coreMatched"] = True
            source["formatId"] = source.get("formatId") or report.get("formatId") or report.get("savedReport", {}).get("formatId") or "Benchmark Format"
            source["gameNumber"] = int(source.get("gameNumber") or index)
            source["playerName"] = source.get("playerName") or "You"
            source["archetype"] = _source_archetype_label(source, row, report)
            source["opponentName"] = source.get("opponentName") or source.get("archetype") or "Opponent"
            source["opponentRegistryId"] = int(source.get("opponentRegistryId") or 0)
            source["winner"] = source.get("winner") or (extract_replay_winner(source.get("battleLogData")) if source.get("battleLogData") else None)
            game_result = _infer_game_result_from_source(source)
            if game_result == "unknown":
                continue
            source["result"] = game_result
            source["seriesResult"] = game_result
            source = _hydrate_missing_team_exports(report, source)
            team_name = _source_team_name(source=source, archetype_label=source.get("archetype"))
            source["opponentTeamName"] = team_name
            source["filename"] = _build_archive_filename(source.get("gameNumber"), game_result, team_name or source.get("opponentName"), source.get("opponentRegistryId"), source.get("archetype"))
            source["relativePath"] = _build_core_relative_path(rank, core_label, source.get("gameNumber"), game_result, team_name or source.get("opponentName"), source.get("opponentRegistryId"), source.get("archetype"))
            if source.get("battleLogData") and not source.get("coachPayload"):
                result_label, _ = result_from_winner(source.get("winner"), p1_name=source.get("playerName") or "You", p2_name=source.get("opponentName") or "Opponent")
                source["coachPayload"] = build_coaching_payload(source.get("battleLogData"), result_label)
            sources.append(source)
    return sources


# ============================================================
# Build archive from fresh suite results
# This runs when a Matchup Report completes.
# ============================================================
def build_match_archive(
    format_id: Any,
    suite_results: List[Dict[str, Any]] | None,
    player_team_export: Any = "",
    sources_only: bool = False,
) -> Dict[str, Any]:
    sources: List[Dict[str, Any]] = []
    files: List[Dict[str, Any]] = []
    used_paths: Dict[str, int] = {}
    player_team_export_text = str(player_team_export or "").replace("\r\n", "\n").strip()

    for suite_entry in list(suite_results or []):
        opponent = dict((suite_entry or {}).get("opponent") or {})
        wins = int((suite_entry or {}).get("wins") or 0)
        losses = int((suite_entry or {}).get("losses") or 0)
        ties = int((suite_entry or {}).get("ties") or 0)
        if wins > losses and wins >= ties:
            series_result = "win"
        elif losses > wins and losses >= ties:
            series_result = "loss"
        else:
            series_result = "tie"
        for game in list((suite_entry or {}).get("games") or []):
            source = _build_source_entry(
                format_id,
                opponent,
                game,
                series_result=series_result,
                player_team_export=player_team_export_text,
                include_coach_payload=not sources_only,
            )
            source["playerTeamExport"] = _display_team_export(format_id, (game or {}).get("playerTeamExport") or (suite_entry or {}).get("playerTeamExport") or (suite_entry or {}).get("userTeamExport") or (suite_entry or {}).get("teamExport") or player_team_export_text or source.get("playerTeamExport") or "")
            source = _with_collision_safe_relative_path(source, used_paths)
            if sources_only:
                if source.get("battleLogData"):
                    sources.append(source)
                continue
            rendered = _render_file_from_source(source)
            if not rendered:
                continue
            sources.append(source)
            files.append(rendered)

    return {
        "ready": bool(sources if sources_only else files),
        "builderVersion": ARCHIVE_BUILDER_VERSION,
        "archiveRoot": ARCHIVE_ROOT,
        "files": sorted(files, key=_archive_file_sort_key),
        "sources": sources,
        "sourceCount": len(sources),
        "renderedCount": len(files),
        "storagePolicy": "sources-only-rebuild-on-download" if sources_only else "rendered-files",
        "includesPaperReportPdf": False,
    }


# ============================================================
# Dynamic rebuild from saved report data
# This is the bridge used by the download button.
# Edit this section if saved report source wiring changes later.
# ============================================================
def rebuild_match_archive_from_saved_report(report: Dict[str, Any] | None) -> Dict[str, Any]:
    report = dict(report or {})
    match_archive = dict(report.get("matchArchive") or {})
    raw_sources = [
        source for source in list(match_archive.get("sources") or [])
        if str((source or {}).get("sourceKind") or "").strip().lower() not in {"lead-pair-sweep", "core-sweep"}
    ]

    if not raw_sources:
        legacy_files = list(match_archive.get("files") or [])
        for entry in legacy_files:
            html_text = (entry or {}).get("html") or ""
            if not html_text:
                continue
            battle_log_data = _extract_battle_log_from_legacy_html(html_text)
            opponent_name = (entry or {}).get("archetype") or "Opponent"
            raw_sources.append({
                "formatId": report.get("formatId") or report.get("savedReport", {}).get("formatId") or "Benchmark Format",
                "archetype": opponent_name,
                "gameNumber": (entry or {}).get("gameNumber") or 1,
                "battleLogData": battle_log_data,
                "winner": extract_replay_winner(battle_log_data) if battle_log_data else None,
                "result": None,
                "turns": None,
                "seed": None,
                "playerName": "You",
                "opponentName": opponent_name,
                "playerTeamExport": report.get("playerTeamExport") or report.get("userTeamExport") or (report.get("request") or {}).get("teamExport") or (report.get("request") or {}).get("team_export") or (report.get("savedReport") or {}).get("playerTeamExport") or (report.get("savedReport") or {}).get("userTeamExport") or (report.get("savedReport") or {}).get("teamExport") or (report.get("savedReport") or {}).get("team_export") or "",
                "opponentRegistryId": _extract_opponent_registry_id_from_legacy_html(html_text),
                "opponentTeamExport": (entry or {}).get("opponentTeamExport") or "",
                "html": html_text,
            })

    deduped_sources: Dict[tuple, Dict[str, Any]] = {}
    for raw_source in raw_sources:
        source = copy.deepcopy(dict(raw_source or {}))
        source["archetype"] = _source_archetype_label(source, report)
        source["formatId"] = source.get("formatId") or report.get("formatId") or report.get("savedReport", {}).get("formatId") or "Benchmark Format"
        source["gameNumber"] = int(source.get("gameNumber") or 1)
        source["opponentRegistryId"] = int(source.get("opponentRegistryId") or 0)
        source["playerName"] = source.get("playerName") or "You"
        source = _hydrate_missing_team_exports(report, source)
        source["opponentName"] = source.get("opponentName") or source.get("archetype") or "Opponent"
        source["opponentTeamName"] = _source_team_name(source=source, archetype_label=source.get("archetype"))
        source["winner"] = source.get("winner") or (extract_replay_winner(source.get("battleLogData")) if source.get("battleLogData") else None)
        if source.get("battleLogData") and not source.get("coachPayload"):
            result_label, _ = result_from_winner(source.get("winner"), p1_name=source.get("playerName") or "You", p2_name=source.get("opponentName") or "Opponent")
            source["coachPayload"] = build_coaching_payload(source.get("battleLogData"), result_label)
        dedupe_key = (source.get("opponentRegistryId") or 0, source.get("archetype") or "Opponent", source.get("gameNumber") or 1)
        deduped_sources[dedupe_key] = source

    grouped: Dict[tuple, List[Dict[str, Any]]] = {}
    for source in deduped_sources.values():
        key = (source.get("opponentRegistryId") or 0, source.get("archetype") or "Opponent")
        grouped.setdefault(key, []).append(source)

    files: List[Dict[str, Any]] = []
    sources: List[Dict[str, Any]] = []
    used_paths: Dict[str, int] = {}
    for _, group_sources in grouped.items():
        series_result = _infer_series_result_from_games(group_sources)
        for source in sorted(group_sources, key=lambda item: int(item.get("gameNumber") or 1)):
            game_result = _infer_game_result_from_source(source)
            source["result"] = None if game_result == "unknown" else game_result
            source["seriesResult"] = series_result
            source = _hydrate_missing_team_exports(report, source)
            team_name = _source_team_name(source=source, archetype_label=source.get("archetype"))
            source["opponentTeamName"] = team_name
            source["filename"] = _build_opponent_file_name(source.get("gameNumber"), source.get("result"), team_name, source.get("opponentRegistryId"), source.get("archetype"))
            source["relativePath"] = _build_archive_relative_path(
                series_result,
                source.get("opponentRegistryId"),
                source.get("archetype"),
                source.get("gameNumber"),
                source.get("result"),
                source.get("opponentName"),
                team_name,
            )
            source = _with_collision_safe_relative_path(source, used_paths)

            if source.get("battleLogData"):
                rendered = _render_file_from_source(source)
            else:
                html_text = source.get("html") or ""
                rendered = None if not html_text else {
                    "archetype": source.get("archetype"),
                    "opponentRegistryId": int(source.get("opponentRegistryId") or 0),
                    "gameNumber": source.get("gameNumber"),
                    "filename": source.get("filename"),
                    "relativePath": source.get("relativePath"),
                    "html": html_text,
                    "includesPaperReportPdf": False,
                }
            if not rendered:
                continue
            rendered["includesPaperReportPdf"] = False
            sources.append(source)
            files.append(rendered)

    for source in _build_lead_pair_sweep_sources(report):
        if source.get("battleLogData"):
            rendered = _render_file_from_source(source)
        else:
            html_text = source.get("html") or ""
            rendered = None if not html_text else {
                "archetype": source.get("archetype"),
                "opponentRegistryId": int(source.get("opponentRegistryId") or 0),
                "gameNumber": source.get("gameNumber"),
                "filename": source.get("filename"),
                "relativePath": source.get("relativePath"),
                "html": html_text,
                "includesPaperReportPdf": False,
            }
        if not rendered:
            continue
        rendered["includesPaperReportPdf"] = False
        rendered["sourceKind"] = "lead-pair-sweep"
        rendered["leadPairRank"] = int(source.get("leadPairRank") or 0)
        sources.append(source)
        files.append(rendered)

    for source in _build_core_sweep_sources(report):
        if source.get("battleLogData"):
            rendered = _render_file_from_source(source)
        else:
            html_text = source.get("html") or ""
            rendered = None if not html_text else {
                "archetype": source.get("archetype"),
                "opponentRegistryId": int(source.get("opponentRegistryId") or 0),
                "gameNumber": source.get("gameNumber"),
                "filename": source.get("filename"),
                "relativePath": source.get("relativePath"),
                "html": html_text,
                "includesPaperReportPdf": False,
            }
        if not rendered:
            continue
        rendered["includesPaperReportPdf"] = False
        rendered["sourceKind"] = "core-sweep"
        rendered["coreRank"] = int(source.get("coreRank") or 0)
        sources.append(source)
        files.append(rendered)

    return {
        "ready": bool(files),
        "builderVersion": ARCHIVE_BUILDER_VERSION,
        "archiveRoot": ARCHIVE_ROOT,
        "files": sorted(files, key=_archive_file_sort_key),
        "sources": sources,
        "includesPaperReportPdf": False,
    }


def _extract_paper_report_pdf_bytes(report: Dict[str, Any] | None) -> bytes | None:
    report = dict(report or {})
    raw_base64 = str(
        report.get("__paperReportPdfBase64")
        or report.get("paperReportPdfBase64")
        or (report.get("paperReport") or {}).get("pdfBase64")
        or ""
    ).strip()
    if not raw_base64:
        return None
    try:
        pdf_bytes = base64.b64decode(raw_base64, validate=True)
    except Exception:
        return None
    return pdf_bytes if pdf_bytes.startswith(b"%PDF") else None


def _build_zip_entries(archive: Dict[str, Any], report: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    pdf_bytes = _extract_paper_report_pdf_bytes(report)
    if pdf_bytes:
        entries.append({
            "relativePath": "PaperReport.pdf",
            "bytes": pdf_bytes,
            "includesPaperReportPdf": True,
        })
    for entry in sorted(list((archive or {}).get("files") or []), key=_archive_file_sort_key):
        relative_path = str((entry or {}).get("relativePath") or "").replace("\\", "/").lstrip("/")
        html_text = str((entry or {}).get("html") or "")
        if not relative_path or not html_text:
            continue
        entries.append({
            "relativePath": relative_path,
            "text": html_text,
            "opponentRegistryId": int((entry or {}).get("opponentRegistryId") or 0),
            "gameNumber": int((entry or {}).get("gameNumber") or 0),
            "includesPaperReportPdf": False,
        })
    return sorted(entries, key=_archive_file_sort_key)


def write_match_archive_zip_from_saved_report(report: Dict[str, Any] | None, zip_path: Any) -> Dict[str, Any]:
    archive = rebuild_match_archive_from_saved_report(report)
    entries = _build_zip_entries(archive, report)
    replay_entries = [entry for entry in entries if str(entry.get("relativePath") or "") != "PaperReport.pdf"]
    includes_paper_report_pdf = any(str(entry.get("relativePath") or "") == "PaperReport.pdf" for entry in entries)
    zip_target = Path(str(zip_path or "")).expanduser()
    if not replay_entries or not zip_target:
        return {
            "ready": False,
            "builderVersion": archive.get("builderVersion"),
            "archiveRoot": archive.get("archiveRoot"),
            "sourceCount": len(list(archive.get("sources") or [])),
            "renderedCount": len(replay_entries),
            "zipCreated": False,
            "includesPaperReportPdf": includes_paper_report_pdf,
        }

    zip_target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(str(zip_target), "w", zipfile.ZIP_DEFLATED) as zf:
        for entry in entries:
            relative_path = str((entry or {}).get("relativePath") or "").replace("\\", "/").lstrip("/")
            if not relative_path:
                continue
            if entry.get("bytes") is not None:
                zf.writestr(relative_path, entry.get("bytes") or b"")
            else:
                zf.writestr(relative_path, str(entry.get("text") or ""))

    return {
        "ready": bool(replay_entries),
        "builderVersion": archive.get("builderVersion"),
        "archiveRoot": archive.get("archiveRoot"),
        "sourceCount": len(list(archive.get("sources") or [])),
        "renderedCount": len(replay_entries),
        "zipCreated": zip_target.exists(),
        "zipPath": str(zip_target),
        "includesPaperReportPdf": includes_paper_report_pdf,
    }
