from benchmark_repo_teams import (
    REPO_TEAM_LOADER_VERSION,
    get_repo_opponent_by_id,
    get_repo_opponents_for_template,
    get_repo_summary,
)

OPPONENT_LIBRARY_VERSION = "2026.04.09-opponent-library-v3"

OPPONENT_LIBRARY = [
    {
        "id": "hard-trick-room-indeedee-ursaluna",
        "templateKey": "hard-trick-room",
        "name": "Hard Trick Room – Indeedee Ursaluna",
        "source": "Professor Aegis opponent library",
        "summary": "Dedicated Trick Room core with Follow Me support and bulky attackers.",
        "notes": ["Tests room-turn pressure", "Tests whether you can recover after Trick Room goes up"],
        "teamPreview": ["Indeedee-F", "Hatterene", "Ursaluna", "Torkoal", "Amoonguss", "Kingambit"],
        "validForFormat": True,
        "formatId": "gen9benchmarkdoublesag",
        "packedTeamAvailable": True,
        "packedTeam": "Indeedee-F||SafetyGoggles|PsychicSurge|FollowMe,HelpingHand,Psychic,Protect|Bold|252,,172,,84,||,0,,,,||50|,,,,,Fairy]Hatterene||LifeOrb|MagicBounce|TrickRoom,DazzlingGleam,Psychic,Protect|Quiet|252,,,252,4,||,0,,,,0||50|,,,,,Fire]Ursaluna||FlameOrb|Guts|Facade,HeadlongRush,Protect,Earthquake|Brave|252,252,,,4,||,,,,,0||50|,,,,,Ghost]Torkoal||Charcoal|Drought|Eruption,HeatWave,SolarBeam,Protect|Quiet|252,,,252,4,||,0,,,,0||50|,,,,,Fire]Amoonguss||RockyHelmet|Regenerator|Spore,RagePowder,PollenPuff,Protect|Sassy|236,,156,,116,||,0,,,,0||50|,,,,,Water]Kingambit||AssaultVest|Defiant|KowtowCleave,SuckerPunch,IronHead,LowKick|Adamant|252,252,,,4,||||50|,,,,,Flying",
        "validationMessages": "",
    },
    {
        "id": "spread-heavy-rain-arch",
        "templateKey": "spread-heavy-offense",
        "name": "Spread Heavy Offense – Rain Spread",
        "source": "Professor Aegis opponent library",
        "summary": "Rain offense that overwhelms boards with repeated spread pressure and tempo.",
        "notes": ["Tests repeated multi-target turns", "Punishes weak defensive compression"],
        "teamPreview": ["Pelipper", "Archaludon", "Basculegion", "Gholdengo", "Tornadus", "Rillaboom"],
        "validForFormat": True,
        "formatId": "gen9benchmarkdoublesag",
        "packedTeamAvailable": True,
        "packedTeam": "Pelipper||FocusSash|Drizzle|Hurricane,WeatherBall,Tailwind,Protect|Timid|4,,,252,,252||,0,,,,||50|,,,,,Ghost]Archaludon||AssaultVest|Stamina|ElectroShot,DracoMeteor,FlashCannon,BodyPress|Modest|252,,4,252,,||,0,,,,||50|,,,,,Flying]Basculegion||ChoiceScarf|Adaptability|WaveCrash,LastRespects,AquaJet,FlipTurn|Jolly|4,252,,,,252||||50|,,,,,Water]Gholdengo||LifeOrb|GoodasGold|MakeItRain,ShadowBall,Thunderbolt,Protect|Timid|4,,,252,,252||,0,,,,||50|,,,,,Steel]Tornadus||CovertCloak|Prankster|Tailwind,BleakwindStorm,Taunt,RainDance|Timid|252,,,4,,252||,0,,,,||50|,,,,,Dark]Rillaboom||MiracleSeed|GrassySurge|FakeOut,GrassyGlide,WoodHammer,Protect|Adamant|236,252,,,,20||||50|,,,,,Fire",
        "validationMessages": "",
    },
]


def _dedupe(records):
    seen = set()
    out = []
    for item in records:
        key = str(item.get("id", "")).strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def get_opponents_for_template(template_key: str, format_id: str = None):
    key = str(template_key or "").strip().lower()
    fmt = str(format_id or "").strip().lower() or None

    repo_first = get_repo_opponents_for_template(key, format_id=format_id)

    fallback = []
    for item in OPPONENT_LIBRARY:
        if item["templateKey"] != key:
            continue
        if fmt and str(item.get("formatId") or "").strip().lower() not in {"", fmt}:
            continue
        fallback.append(dict(item))

    return _dedupe([*repo_first, *fallback])


def get_opponent_by_id(opponent_id: str, format_id: str = None):
    repo_match = get_repo_opponent_by_id(opponent_id, format_id=format_id)
    if repo_match:
        return repo_match

    oid = str(opponent_id or "").strip().lower()
    fmt = str(format_id or "").strip().lower() or None
    for item in OPPONENT_LIBRARY:
        if str(item["id"]).strip().lower() != oid:
            continue
        if fmt and str(item.get("formatId") or "").strip().lower() not in {"", fmt}:
            continue
        return dict(item)
    return None


def get_opponent_source_summary(format_id: str = None):
    repo_summary = get_repo_summary(format_id=format_id)
    return {
        "opponentLibraryVersion": OPPONENT_LIBRARY_VERSION,
        "repoTeamLoaderVersion": REPO_TEAM_LOADER_VERSION,
        "customOpponentCount": len(OPPONENT_LIBRARY),
        "repo": repo_summary,
    }
