"""Shared Battle Simulator archetype classifier helpers.

This module is intentionally standalone. It does not read databases, caches, or
runtime state, so later cards can wire it into opponent hydration, reports, and
Discord UI without changing the taxonomy contract.
"""

from __future__ import annotations

import copy
import re
from collections import defaultdict


FORMAT_PROFILE_CHAMPIONS = "champions"


def _slug(value):
    text = str(value or "").strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text


def _clean_label(value):
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def _title_label(value):
    words = str(value or "").replace("-", " ").split()
    small = {"and", "or", "vs", "to"}
    result = []
    for index, word in enumerate(words):
        lower = word.lower()
        if index and lower in small:
            result.append(lower)
        elif lower == "tr":
            result.append("TR")
        else:
            result.append(lower.capitalize())
    return " ".join(result)


ARCHETYPE_TAXONOMY = {
    "rain": {
        "label": "Rain",
        "tags": ["weather", "speed", "water"],
        "glossaryEntry": "Rain teams use rain setters and rain abusers to create fast Water pressure.",
    },
    "sun": {
        "label": "Sun",
        "tags": ["weather", "speed", "fire"],
        "glossaryEntry": "Sun teams use sunlight to boost Fire pressure and enable sun-based sweepers.",
    },
    "sand": {
        "label": "Sand",
        "tags": ["weather", "chip", "rock"],
        "glossaryEntry": "Sand teams use sand chip, bulk, and sand abilities to control longer games.",
    },
    "snow": {
        "label": "Snow",
        "tags": ["weather", "bulk", "ice"],
        "glossaryEntry": "Snow teams use snow support to improve Ice-type positioning and bulk.",
    },
    "trick-room": {
        "label": "Trick Room",
        "tags": ["speed-control", "slow-mode"],
        "glossaryEntry": "Trick Room teams reverse speed order so slower attackers can move first.",
    },
    "hard-trick-room": {
        "label": "Hard Trick Room",
        "tags": ["speed-control", "slow-mode", "dedicated-mode"],
        "glossaryEntry": "Hard Trick Room teams commit heavily to slow attackers and repeated Room turns.",
    },
    "tailwind": {
        "label": "Tailwind",
        "tags": ["speed-control", "fast-mode"],
        "glossaryEntry": "Tailwind teams use temporary speed control to attack before the opponent can settle.",
    },
    "hyper-offense": {
        "label": "Hyper Offense",
        "tags": ["offense", "tempo"],
        "glossaryEntry": "Hyper Offense teams trade defensive padding for immediate pressure and fast KOs.",
    },
    "bulky-offense": {
        "label": "Bulky Offense",
        "tags": ["offense", "bulk", "positioning"],
        "glossaryEntry": "Bulky Offense teams keep strong damage while adding enough bulk to pivot safely.",
    },
    "balance": {
        "label": "Balance",
        "tags": ["positioning", "flexible"],
        "glossaryEntry": "Balance teams mix pressure, defensive tools, and flexible speed control.",
    },
    "stall": {
        "label": "Stall",
        "tags": ["defense", "attrition"],
        "glossaryEntry": "Stall teams aim to survive, recover, and win through attrition.",
    },
    "perish-trap": {
        "label": "Perish Trap",
        "tags": ["control", "win-condition"],
        "glossaryEntry": "Perish Trap teams combine Perish Song with trapping or positioning tools.",
    },
    "beat-up": {
        "label": "Beat Up",
        "tags": ["combo", "setup"],
        "glossaryEntry": "Beat Up teams use Beat Up to activate an ally or create an immediate combo threat.",
    },
    "bulky-sun": {
        "label": "Bulky Sun",
        "tags": ["weather", "bulk", "fire", "positioning"],
        "glossaryEntry": "Bulky Sun teams combine sun pressure with enough bulk to play longer positioning games.",
    },
    "hyper-sun": {
        "label": "Hyper Sun",
        "tags": ["weather", "offense", "tempo", "fire"],
        "glossaryEntry": "Hyper Sun teams use sunlight to create immediate offensive pressure.",
    },
    "trick-room-sun": {
        "label": "Trick Room Sun",
        "tags": ["weather", "speed-control", "slow-mode", "fire"],
        "glossaryEntry": "Trick Room Sun teams combine slow-mode turns with sun-boosted attackers.",
    },
    "sun-balance": {
        "label": "Sun Balance",
        "tags": ["weather", "positioning", "fire"],
        "glossaryEntry": "Sun Balance teams use sunlight as one flexible mode inside a balanced game plan.",
    },
    "rain-offense": {
        "label": "Rain Offense",
        "tags": ["weather", "offense", "speed", "water"],
        "glossaryEntry": "Rain Offense teams use rain speed and Water pressure to force fast trades.",
    },
    "rain-balance": {
        "label": "Rain Balance",
        "tags": ["weather", "positioning", "water"],
        "glossaryEntry": "Rain Balance teams use rain as a flexible mode inside a balanced game plan.",
    },
    "bulky-rain": {
        "label": "Bulky Rain",
        "tags": ["weather", "bulk", "water", "positioning"],
        "glossaryEntry": "Bulky Rain teams pair rain pressure with bulk and safer pivots.",
    },
    "balance-trick-room": {
        "label": "Balance Trick Room",
        "tags": ["positioning", "speed-control", "slow-mode"],
        "glossaryEntry": "Balance Trick Room teams use Room as an important mode without fully committing to hard Room.",
    },
    "balance-tailwind": {
        "label": "Balance Tailwind",
        "tags": ["positioning", "speed-control", "fast-mode"],
        "glossaryEntry": "Balance Tailwind teams use Tailwind as a flexible speed mode inside balanced positioning.",
    },
    "bulky-screens": {
        "label": "Bulky Screens",
        "tags": ["bulk", "support", "positioning"],
        "glossaryEntry": "Bulky Screens teams use defensive screens to create safer setup and positioning turns.",
    },
    "fast-coaching": {
        "label": "Fast Coaching",
        "tags": ["support", "tempo", "setup"],
        "glossaryEntry": "Fast Coaching teams use Coaching support to accelerate a physical attacker.",
    },
    "goodstuffs": {
        "label": "Goodstuffs",
        "tags": ["flexible", "meta"],
        "glossaryEntry": "Goodstuffs teams use individually strong Pokemon without one rigid mode.",
    },
}


TEACHING_STYLE_HINTS = {
    "Hyper": {
        "glossary": "a fast pressure shell",
        "respect": "Respect immediate damage and early tempo swings.",
        "approach": "Use a line that can trade quickly or deny its first setup turn.",
    },
    "Bulky": {
        "glossary": "a durable pressure shell",
        "respect": "Respect steady damage backed by safer switches.",
        "approach": "Use a line that wins positioning before trying to take KOs.",
    },
    "Balance": {
        "glossary": "a flexible positioning shell",
        "respect": "Respect its ability to change modes after preview.",
        "approach": "Use a line that keeps options open and does not overcommit early.",
    },
    "Fast": {
        "glossary": "a speed-focused pressure shell",
        "respect": "Respect speed control and fast double-target turns.",
        "approach": "Use a line that controls speed or survives the opening burst.",
    },
}


SIGNATURE_PLAN_HINTS = {
    "Round": "Round pressure",
    "Screens": "screen-supported setup turns",
    "Coaching": "Coaching-supported physical pressure",
    "Expanding Force": "Psychic Terrain pressure",
}


def _entry_teaching_hints(key, entry, signature_plan=None):
    label = entry.get("label") or _title_label(key)
    tags = set(entry.get("tags") or [])
    signature = signature_plan or label

    if "weather" in tags:
        respect = f"Respect {label} turns, boosted damage, and weather timing."
        approach = f"Use a line that controls the first {label} turns before its pressure snowballs."
    elif "slow-mode" in tags:
        respect = f"Respect {label} setup turns and slow attackers moving first."
        approach = f"Use a line that can deny Room or stall out its strongest turns."
    elif "fast-mode" in tags or "tempo" in tags:
        respect = f"Respect {label} speed control and fast pressure."
        approach = f"Use a line that controls speed or survives the opening burst."
    elif "bulk" in tags or "positioning" in tags:
        respect = f"Respect {label} pivots and longer positioning turns."
        approach = f"Use a line that wins positioning before committing to trades."
    elif "combo" in tags or "win-condition" in tags:
        respect = f"Respect the {label} win condition before it gets started."
        approach = f"Use a line that interrupts the setup piece or forces early trades."
    else:
        respect = f"Respect the main {label} game plan at preview."
        approach = f"Use a line that answers its first mode while keeping a backup plan."

    return {
        "glossaryEntry": entry.get("glossaryEntry") or f"{label} teams use {signature} as their main game plan.",
        "respectHint": entry.get("respectHint") or respect,
        "approachHint": entry.get("approachHint") or approach,
        "signaturePlan": signature,
        "explanationSource": entry.get("explanationSource") or "taxonomy",
    }


def _generated_teaching_hints(display_label, scores, evidence):
    style = _style_label_from_scores(scores)
    signature = evidence.get("_signaturePlan", ["Positioning"])[0] or "Positioning"
    signature_phrase = SIGNATURE_PLAN_HINTS.get(signature, f"{signature} pressure")
    style_hint = TEACHING_STYLE_HINTS.get(style) or TEACHING_STYLE_HINTS["Balance"]
    label = display_label or f"{style} {signature}"
    return {
        "glossaryEntry": f"{label} teams combine {style_hint['glossary']} with {signature_phrase}.",
        "respectHint": f"{style_hint['respect']} Respect {signature_phrase} once it appears.",
        "approachHint": f"{style_hint['approach']} Keep {signature_phrase} from becoming free.",
        "signaturePlan": signature,
        "explanationSource": "generated-display-key",
    }


def _teaching_hints_for_display(display_key, display_label, scores, evidence, taxonomy):
    if display_key in taxonomy and display_key != "goodstuffs" and not is_generic_archetype_label(display_key):
        return _entry_teaching_hints(
            display_key,
            taxonomy[display_key],
            evidence.get("_signaturePlan", [taxonomy[display_key].get("label")])[0],
        )
    return _generated_teaching_hints(display_label, scores, evidence)


ALIASES = {
    "rain-offense": "rain-offense",
    "rain-balance": "rain-balance",
    "bulky-rain": "bulky-rain",
    "sun-offense": "sun",
    "sun-balance": "sun-balance",
    "bulky-sun": "bulky-sun",
    "hyper-sun": "hyper-sun",
    "trick-room-sun": "trick-room-sun",
    "sand-balance": "sand",
    "snow-balance": "snow",
    "hail": "snow",
    "trickroom": "trick-room",
    "trick-room-offense": "trick-room",
    "balance-trick-room": "balance-trick-room",
    "balance-tr": "balance-trick-room",
    "room": "trick-room",
    "hard-tr": "hard-trick-room",
    "hard-room": "hard-trick-room",
    "tailwind-offense": "tailwind",
    "balance-tailwind": "balance-tailwind",
    "fast-offense": "hyper-offense",
    "direct-pressure": "hyper-offense",
    "direct-pressure-offense": "hyper-offense",
    "bulky-balance": "balance",
    "redirection-balance": "balance",
    "good-stuffs": "goodstuffs",
    "good-stuff": "goodstuffs",
    "standard-goodstuffs": "goodstuffs",
}


GENERIC_ARCHETYPE_KEYS = {
    "",
    "unknown",
    "none",
    "tournament",
    "generated",
    "generated-random",
    "random",
    "unlabeled",
    "unlabeled-matchup-style",
    "matchup-style",
    "speed-control",
    "direct-pressure-offense",
    "fast-offense-mirrors",
    "featured-meta",
    "dynamic-meta-pool",
    "full-regulation",
    "s-tier-top-tournament",
    "s-a-tier-top-4-tournament",
    "all-meta-all-tournament",
    "full-meta-100-random",
    "gauntlet-full-meta-200-random",
    "goodstuffs",
    "good-stuffs",
    "good-stuff",
}


MOVE_GROUPS = {
    "rain": {"rain dance", "chilling water", "water spout", "wave crash", "surging strikes", "hydro pump", "muddy water"},
    "sun": {"sunny day", "heat wave", "eruption", "solar beam", "solar blade", "weather ball"},
    "sand": {"sandstorm", "rock slide", "stone edge"},
    "snow": {"snowscape", "blizzard", "aurora veil"},
    "trick_room": {"trick room"},
    "tailwind": {"tailwind"},
    "perish": {"perish song"},
    "trap": {"mean look", "block", "spider web", "whirlpool", "fire spin", "infestation", "magma storm"},
    "beat_up": {"beat up"},
    "protect": {"protect", "detect", "spiky shield", "wide guard", "quick guard", "king's shield"},
    "recovery": {"recover", "roost", "moonlight", "soft-boiled", "slack off", "synthesis", "strength sap", "wish"},
    "attrition": {"toxic", "will-o-wisp", "leech seed", "substitute", "encore", "disable", "yawn"},
    "support": {
        "fake out",
        "follow me",
        "rage powder",
        "helping hand",
        "parting shot",
        "wide guard",
        "will-o-wisp",
        "taunt",
        "encore",
        "icy wind",
        "electroweb",
        "thunder wave",
        "snarl",
    },
    "setup": {"swords dance", "nasty plot", "calm mind", "dragon dance", "bulk up", "quiver dance"},
    "spread": {"heat wave", "blizzard", "dazzling gleam", "earthquake", "rock slide", "make it rain", "hyper voice", "eruption", "water spout"},
    "priority": {"sucker punch", "extreme speed", "aqua jet", "grassy glide", "bullet punch", "ice shard", "quick attack"},
}

FALLBACK_SIGNATURE_MOVE_GROUPS = {
    "protect",
    "recovery",
    "attrition",
    "support",
    "trick_room",
    "tailwind",
    "perish",
    "trap",
}

FALLBACK_SIGNATURE_BLOCKLIST = {
    "protect",
    "detect",
    "spiky-shield",
    "wide-guard",
    "quick-guard",
    "king-s-shield",
    "helping-hand",
    "fake-out",
}

SIGNATURE_PLAN_ALIASES = {
    "aurora-veil": "Screens",
    "reflect": "Screens",
    "light-screen": "Screens",
    "coaching": "Coaching",
    "expanding-force": "Expanding Force",
    "round": "Round",
}


ABILITY_GROUPS = {
    "rain": {"drizzle", "swift swim", "rain dish"},
    "sun": {"drought", "chlorophyll", "solar power", "protosynthesis", "orichalcum pulse"},
    "sand": {"sand stream", "sand rush", "sand force", "sand veil"},
    "snow": {"snow warning", "slush rush", "ice body"},
    "trap": {"shadow tag", "arena trap"},
    "beat_up": {"justified", "stamina", "anger point"},
    "support": {"intimidate", "prankster", "friend guard", "armor tail", "hospitality"},
}


ITEM_GROUPS = {
    "offense": {"life orb", "choice band", "choice specs", "choice scarf", "focus sash", "booster energy", "expert belt"},
    "bulk": {
        "sitrus berry",
        "leftovers",
        "assault vest",
        "eviolite",
        "rocky helmet",
        "safety goggles",
        "colbur berry",
        "shuca berry",
        "clear amulet",
    },
    "room": {"room service", "iron ball"},
}


SLOW_TRICK_ROOM_SPECIES = {
    "amoonguss",
    "calyrex-ice",
    "cresselia",
    "dusclops",
    "farigiraf",
    "hatterene",
    "indeedee-f",
    "iron-hands",
    "kingambit",
    "porygon2",
    "ursaluna",
    "ursaluna-bloodmoon",
    "torkoal",
}


def get_archetype_taxonomy(format_profile=FORMAT_PROFILE_CHAMPIONS):
    """Return the supported taxonomy for a format profile."""

    profile = _slug(format_profile) or FORMAT_PROFILE_CHAMPIONS
    taxonomy = copy.deepcopy(ARCHETYPE_TAXONOMY)
    for key, entry in taxonomy.items():
        entry["key"] = key
        entry["formatProfile"] = profile
        entry.update(_entry_teaching_hints(key, entry))
    return taxonomy


def normalize_archetype_key(value):
    """Normalize an archetype-like value to a taxonomy key when possible."""

    key = _slug(value)
    if key in ARCHETYPE_TAXONOMY:
        return key
    return ALIASES.get(key, key)


def is_generic_archetype_label(value):
    """Return True when a label is source metadata, not a display archetype."""

    key = _slug(value)
    if key in GENERIC_ARCHETYPE_KEYS:
        return True
    if key.startswith("tournament-") or key.endswith("-tournament"):
        return True
    if "random" in key and key not in ARCHETYPE_TAXONOMY:
        return True
    if "all-meta" in key or "full-meta" in key:
        return True
    return False


def normalize_archetype_label(value):
    """Normalize a label for user display without returning generic labels."""

    key = normalize_archetype_key(value)
    if is_generic_archetype_label(value) or key not in ARCHETYPE_TAXONOMY:
        return "Balance Positioning"
    return ARCHETYPE_TAXONOMY[key]["label"]


def _normalize_move(line):
    move = str(line or "").strip()
    if move.startswith("-"):
        move = move[1:].strip()
    return _clean_label(move)


def _parse_header_species(header_line):
    raw = str(header_line or "").split(" @ ")[0].strip()
    if not raw:
        return "Unknown"
    if "(" in raw and ")" in raw:
        last_open = raw.rfind("(")
        last_close = raw.rfind(")")
        if last_open >= 0 and last_close > last_open:
            inside = raw[last_open + 1 : last_close].strip()
            return inside or raw
    return raw


def _parse_team_export(team_export):
    normalized = str(team_export or "").replace("\r\n", "\n").strip()
    blocks = [block.strip() for block in re.split(r"\n\s*\n", normalized) if block.strip()]
    pokemon = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        header = lines[0] if lines else ""
        species = _parse_header_species(header)
        item = header.split(" @ ", 1)[1].strip() if " @ " in header else None
        ability_line = next((line for line in lines if re.match(r"^Ability:", line, re.I)), "")
        ability = re.sub(r"^Ability:\s*", "", ability_line, flags=re.I).strip() if ability_line else None
        moves = [_normalize_move(line) for line in lines if line.startswith("- ")]
        pokemon.append(
            {
                "header": header,
                "species": species,
                "speciesKey": _slug(species),
                "item": item,
                "itemKey": _slug(item),
                "ability": ability,
                "abilityKey": _slug(ability),
                "moves": moves,
                "moveKeys": {_slug(move) for move in moves},
                "lines": lines,
            }
        )
    return {"normalized": normalized, "pokemon": pokemon}


def _members_from_input(pokemon_or_export):
    if isinstance(pokemon_or_export, str):
        return _parse_team_export(pokemon_or_export).get("pokemon", [])
    if isinstance(pokemon_or_export, dict):
        if isinstance(pokemon_or_export.get("pokemon"), list):
            return pokemon_or_export.get("pokemon", [])
        pokemon_or_export = [pokemon_or_export]
    members = []
    for mon in pokemon_or_export or []:
        current = dict(mon or {})
        species = current.get("species") or current.get("name") or "Unknown"
        moves = [_clean_label(move) for move in current.get("moves") or []]
        current["species"] = species
        current["speciesKey"] = _slug(species)
        current["itemKey"] = _slug(current.get("item"))
        current["abilityKey"] = _slug(current.get("ability"))
        current["moveKeys"] = {_slug(move) for move in moves}
        current["moves"] = moves
        members.append(current)
    return members


def _has_move(mon, group):
    move_keys = set(mon.get("moveKeys") or [])
    return any(_slug(move) in move_keys for move in MOVE_GROUPS[group])


def _has_ability(mon, group):
    ability = mon.get("abilityKey") or _slug(mon.get("ability"))
    return ability in {_slug(value) for value in ABILITY_GROUPS[group]}


def _has_item(mon, group):
    item = mon.get("itemKey") or _slug(mon.get("item"))
    return item in {_slug(value) for value in ITEM_GROUPS[group]}


def _add_score(scores, key, amount, evidence, evidence_type, value, pokemon=None):
    if amount <= 0:
        return
    scores[key] += amount
    note = {"type": evidence_type, "value": value, "weight": amount}
    if pokemon:
        note["pokemon"] = pokemon
    evidence[key].append(note)


def _best_signature_plan(members):
    blocked = set(FALLBACK_SIGNATURE_BLOCKLIST)
    for group in FALLBACK_SIGNATURE_MOVE_GROUPS:
        blocked.update(_slug(move) for move in MOVE_GROUPS[group])

    counts = defaultdict(int)
    labels = {}
    for mon in members:
        for move in mon.get("moves") or []:
            key = _slug(move)
            if not key or key in blocked:
                continue
            label = SIGNATURE_PLAN_ALIASES.get(key) or _title_label(move)
            if not label or _slug(label) in blocked:
                continue
            counts[key] += 1
            labels[key] = label

    if not counts:
        return "Positioning"

    best_key = sorted(counts, key=lambda key: (-counts[key], labels.get(key, key)))[0]
    return labels.get(best_key) or "Positioning"


def _score_value(scores, key):
    return float(scores.get(key, 0) or 0)


def _style_label_from_scores(scores):
    if _score_value(scores, "hyper-offense") >= 6:
        return "Hyper"
    if _score_value(scores, "bulky-offense") >= 3:
        return "Bulky"
    if _score_value(scores, "balance") >= 4:
        return "Balance"
    if _score_value(scores, "tailwind") >= 5:
        return "Fast"
    return "Balance"


def _compact_display_key(primary_key, secondary_key, scores, evidence):
    perish_score = _score_value(scores, "perish-trap")
    beat_up_score = _score_value(scores, "beat-up")
    if primary_key == "perish-trap" or perish_score >= 7:
        return "perish-trap"
    if primary_key == "beat-up" or beat_up_score >= 7:
        return "beat-up"

    hard_room_score = _score_value(scores, "hard-trick-room")
    room_score = _score_value(scores, "trick-room")
    hyper_score = _score_value(scores, "hyper-offense")
    bulky_score = _score_value(scores, "bulky-offense")
    balance_score = _score_value(scores, "balance")
    tailwind_score = _score_value(scores, "tailwind")

    weather_scores = {
        key: _score_value(scores, key)
        for key in ("sun", "rain", "sand", "snow")
    }
    weather_key, weather_score = max(weather_scores.items(), key=lambda item: item[1])
    if weather_score >= 4:
        if weather_key == "sun":
            if hard_room_score >= 10 or room_score >= 8:
                return "trick-room-sun"
            if hyper_score >= 6:
                return "hyper-sun"
            if bulky_score >= 3:
                return "bulky-sun"
            return "sun-balance"
        if weather_key == "rain":
            if hyper_score >= 6:
                return "rain-offense"
            if balance_score >= 6:
                return "rain-balance"
            if bulky_score >= 3:
                return "bulky-rain"
            return "rain-balance"
        return weather_key

    if primary_key == "hard-trick-room" or hard_room_score >= 10:
        return "hard-trick-room"
    if primary_key == "trick-room" or room_score >= 5:
        if balance_score >= 3 or bulky_score >= 3 or secondary_key in {"balance", "bulky-offense"}:
            return "balance-trick-room"
        return "hard-trick-room"
    if primary_key == "tailwind" or tailwind_score >= 5:
        if balance_score >= 4 or bulky_score >= 5:
            return "balance-tailwind"
        return "tailwind"

    signature = evidence.get("_signaturePlan", ["Positioning"])[0] or "Positioning"
    if primary_key in {"hyper-offense", "bulky-offense", "balance"} and signature != "Positioning":
        style = _style_label_from_scores(scores)
        return f"{_slug(style)}-{_slug(signature)}"

    if (
        primary_key
        and primary_key in ARCHETYPE_TAXONOMY
        and not is_generic_archetype_label(primary_key)
        and primary_key != "goodstuffs"
        and _score_value(scores, primary_key) >= 5
    ):
        return primary_key

    style = _style_label_from_scores(scores)
    return f"{_slug(style)}-{_slug(signature)}"


def _compact_display_label(display_key, scores, evidence):
    if display_key in ARCHETYPE_TAXONOMY and not is_generic_archetype_label(display_key):
        return ARCHETYPE_TAXONOMY[display_key]["label"]
    style = _style_label_from_scores(scores)
    signature = evidence.get("_signaturePlan", ["Positioning"])[0] or "Positioning"
    return f"{style} {signature}"


def _weather_scores(mon, scores, evidence):
    species = mon.get("species")
    for key in ("rain", "sun", "sand", "snow"):
        if _has_ability(mon, key):
            _add_score(scores, key, 4, evidence, "ability", mon.get("ability"), species)
        if _has_move(mon, key):
            _add_score(scores, key, 2, evidence, "move", ", ".join(sorted(MOVE_GROUPS[key])), species)


def _score_members(members):
    scores = defaultdict(float)
    evidence = defaultdict(list)
    trick_room_users = 0
    tailwind_users = 0
    slow_members = 0
    offense_members = 0
    bulk_members = 0
    support_members = 0
    protect_users = 0
    recovery_users = 0
    attrition_users = 0
    setup_users = 0
    spread_users = 0
    priority_users = 0
    perish_users = 0
    trap_users = 0
    beat_up_users = 0
    beat_up_targets = 0

    for mon in members:
        species = mon.get("species") or "Unknown"
        species_key = mon.get("speciesKey") or _slug(species)
        moves = list(mon.get("moves") or [])
        attack_count = 0
        support_count = 0

        _weather_scores(mon, scores, evidence)

        if _has_move(mon, "trick_room"):
            trick_room_users += 1
            _add_score(scores, "trick-room", 5, evidence, "move", "Trick Room", species)
        if _has_move(mon, "tailwind"):
            tailwind_users += 1
            _add_score(scores, "tailwind", 5, evidence, "move", "Tailwind", species)
        if _has_move(mon, "perish"):
            perish_users += 1
            _add_score(scores, "perish-trap", 4, evidence, "move", "Perish Song", species)
        if _has_move(mon, "trap") or _has_ability(mon, "trap"):
            trap_users += 1
            _add_score(scores, "perish-trap", 3, evidence, "trap", mon.get("ability") or "trapping move", species)
        if _has_move(mon, "beat_up"):
            beat_up_users += 1
            _add_score(scores, "beat-up", 4, evidence, "move", "Beat Up", species)
        if _has_ability(mon, "beat_up"):
            beat_up_targets += 1
            _add_score(scores, "beat-up", 3, evidence, "ability", mon.get("ability"), species)
        if species_key in SLOW_TRICK_ROOM_SPECIES or _has_item(mon, "room"):
            slow_members += 1
            _add_score(scores, "trick-room", 1, evidence, "slow-member", species, species)

        if _has_move(mon, "protect"):
            protect_users += 1
            support_count += 1
        if _has_move(mon, "recovery"):
            recovery_users += 1
            support_count += 1
        if _has_move(mon, "attrition"):
            attrition_users += 1
            support_count += 1
        if _has_move(mon, "support") or _has_ability(mon, "support"):
            support_members += 1
            support_count += 1
        if _has_move(mon, "setup"):
            setup_users += 1
            attack_count += 1
        if _has_move(mon, "spread"):
            spread_users += 1
            attack_count += 1
        if _has_move(mon, "priority"):
            priority_users += 1
            attack_count += 1
        if _has_item(mon, "offense"):
            attack_count += 1
        if _has_item(mon, "bulk"):
            bulk_members += 1

        plain_moves = [_slug(move) for move in moves]
        support_move_keys = set()
        for group in ("protect", "recovery", "attrition", "support", "trick_room", "tailwind", "perish", "trap"):
            support_move_keys.update(_slug(move) for move in MOVE_GROUPS[group])
        attack_count += sum(1 for move in plain_moves if move and move not in support_move_keys)

        if attack_count >= 3 or _has_item(mon, "offense"):
            offense_members += 1

    if trick_room_users >= 2 or (trick_room_users and slow_members >= 3):
        _add_score(scores, "hard-trick-room", 18, evidence, "team-structure", "multiple Trick Room or slow attackers")
    if trick_room_users and slow_members:
        _add_score(scores, "trick-room", min(3, slow_members), evidence, "team-structure", "slow attackers support Trick Room")
    if tailwind_users and offense_members >= 3:
        _add_score(scores, "tailwind", 2, evidence, "team-structure", "Tailwind plus attackers")

    if perish_users and trap_users:
        _add_score(scores, "perish-trap", 7, evidence, "team-structure", "Perish Song plus trapping")
    if beat_up_users and beat_up_targets:
        _add_score(scores, "beat-up", 7, evidence, "team-structure", "Beat Up plus activation target")

    if protect_users >= 4 and (recovery_users + attrition_users) >= 3:
        _add_score(scores, "stall", 8, evidence, "team-structure", "Protect plus recovery or attrition")
    elif recovery_users + attrition_users >= 4:
        _add_score(scores, "stall", 5, evidence, "team-structure", "recovery and attrition tools")

    if offense_members >= 5 and support_members <= 2:
        _add_score(scores, "hyper-offense", 8, evidence, "team-structure", "many attackers with limited support")
    elif offense_members >= 4 and (setup_users + spread_users + priority_users) >= 3:
        _add_score(scores, "hyper-offense", 6, evidence, "team-structure", "setup, spread, or priority pressure")

    if offense_members >= 2 and (bulk_members + support_members) >= 3:
        _add_score(scores, "bulky-offense", 7, evidence, "team-structure", "attackers backed by bulk or support")
    if support_members >= 3 and offense_members >= 2:
        _add_score(scores, "balance", 6, evidence, "team-structure", "support and attackers are both present")
    if protect_users >= 3 and support_members >= 2:
        _add_score(scores, "balance", 3, evidence, "team-structure", "Protect and positioning tools")
    if bulk_members >= 3:
        _add_score(scores, "bulky-offense", 3, evidence, "team-structure", "multiple bulky items")

    evidence["_signaturePlan"] = [_best_signature_plan(members)]
    if not scores:
        _add_score(scores, "balance", 2, evidence, "fallback", "no strong mode detected")
    return scores, evidence


def _confidence(score, top_score):
    if top_score >= 11:
        return 0.9
    if top_score >= 8:
        return 0.78
    if top_score >= 5:
        return 0.62
    if top_score >= 3:
        return 0.45
    return 0.32


def _confidence_band(value):
    if value >= 0.8:
        return "High"
    if value >= 0.55:
        return "Medium"
    if value >= 0.35:
        return "Low"
    return "Unknown"


def _result_for_key(primary_key, secondary_key, scores, evidence, format_profile, source_label, source_kind):
    taxonomy = get_archetype_taxonomy(format_profile)
    primary = taxonomy.get(primary_key) or taxonomy["balance"]
    secondary = taxonomy.get(secondary_key) if secondary_key else None
    confidence = _confidence(scores.get(primary_key, 0), scores.get(primary_key, 0))
    display_key = _compact_display_key(primary_key, secondary_key, scores, evidence)
    display_label = _compact_display_label(display_key, scores, evidence)
    teaching = _teaching_hints_for_display(display_key, display_label, scores, evidence, taxonomy)
    return {
        "primaryKey": primary["key"],
        "primaryLabel": primary["label"],
        "secondaryKey": secondary["key"] if secondary else None,
        "secondaryLabel": secondary["label"] if secondary else None,
        "displayKey": display_key,
        "displayLabel": display_label,
        "tags": list(primary.get("tags") or []),
        "confidence": confidence,
        "confidenceBand": _confidence_band(confidence),
        "formatProfile": _slug(format_profile) or FORMAT_PROFILE_CHAMPIONS,
        "source": {
            "kind": source_kind or "team-export",
            "label": _clean_label(source_label),
            "labelKey": _slug(source_label),
            "genericLabel": is_generic_archetype_label(source_label),
        },
        "evidence": list(evidence.get(primary["key"]) or []),
        "signaturePlan": teaching["signaturePlan"],
        "glossaryEntry": teaching["glossaryEntry"],
        "respectHint": teaching["respectHint"],
        "approachHint": teaching["approachHint"],
        "explanationSource": teaching["explanationSource"],
    }


def classify_team_members(pokemon, format_profile=FORMAT_PROFILE_CHAMPIONS, source_label=None, source_kind=None):
    """Classify already parsed team members into a clean archetype result."""

    members = _members_from_input(pokemon)
    scores, evidence = _score_members(members)

    source_key = normalize_archetype_key(source_label)
    if source_label and not is_generic_archetype_label(source_label) and source_key in ARCHETYPE_TAXONOMY:
        _add_score(scores, source_key, 3, evidence, "source-label", _clean_label(source_label))

    ranked = sorted(scores.items(), key=lambda item: (-item[1], ARCHETYPE_TAXONOMY.get(item[0], {}).get("label", item[0])))
    primary_key = ranked[0][0] if ranked else "balance"
    if primary_key not in ARCHETYPE_TAXONOMY or is_generic_archetype_label(primary_key):
        primary_key = "balance"

    secondary_key = None
    for key, score in ranked[1:]:
        if key in ARCHETYPE_TAXONOMY and key != primary_key and score >= 4:
            secondary_key = key
            break

    return _result_for_key(primary_key, secondary_key, scores, evidence, format_profile, source_label, source_kind)


def classify_team_archetype(team_export, format_profile=FORMAT_PROFILE_CHAMPIONS, source_label=None, source_kind=None):
    """Classify a Showdown team export into a clean Champions-style archetype."""

    parsed = _parse_team_export(team_export)
    return classify_team_members(
        parsed.get("pokemon", []),
        format_profile=format_profile,
        source_label=source_label,
        source_kind=source_kind or "team-export",
    )


__all__ = [
    "classify_team_archetype",
    "classify_team_members",
    "get_archetype_taxonomy",
    "is_generic_archetype_label",
    "normalize_archetype_key",
    "normalize_archetype_label",
]
