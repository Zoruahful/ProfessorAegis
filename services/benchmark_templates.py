TEMPLATE_LIBRARY_VERSION = "2026.04.08-template-library-v4"

ARCHETYPE_TEMPLATES = [
    {
        "key": "fast-offense-mirrors",
        "name": "Fast offense mirrors",
        "summary": "High-speed pressure teams that try to win the first tempo race.",
        "cues": ["tailwind", "fake-out", "priority", "speed-control"],
        "common_pressures": ["fast mode established early", "turn-one Fake Out pressure", "cleanup via priority"],
        "evaluation_focus": ["Can you contest speed immediately?", "Can you recover if the first trade goes badly?"],
        "default_battle_count": 20,
        "simulation_notes": ["stress early tempo", "test losing the first speed exchange"],
    },
    {
        "key": "hard-trick-room",
        "name": "Hard Trick Room",
        "summary": "Dedicated room teams that force a slow-game board state quickly.",
        "cues": ["trick-room", "fake-out", "disruption", "spread"],
        "common_pressures": ["room turn protection", "bulky slow attackers", "position locking after Trick Room"],
        "evaluation_focus": ["Can you pressure the room turn?", "Can you mirror or reverse pace once room is active?"],
        "default_battle_count": 24,
        "simulation_notes": ["pressure room turns", "test midgame after Trick Room resolves"],
    },
    {
        "key": "redirection-balance",
        "name": "Redirection balance",
        "summary": "Boards that protect a partner and force you to break stable positioning.",
        "cues": ["redirection", "speed-control", "protect", "spread"],
        "common_pressures": ["partner shielding", "longer board states", "forced target inefficiency"],
        "evaluation_focus": ["Can you break positioning without wasting a turn?", "Do you have enough spread or disruption?"],
        "default_battle_count": 20,
        "simulation_notes": ["test target denial", "test breaking stable boards"],
    },
    {
        "key": "bulky-balance",
        "name": "Bulky balance",
        "summary": "Adaptable mid-speed teams that reward careful positioning and long turns.",
        "cues": ["pivot", "protect", "helping-hand", "dual-speed"],
        "common_pressures": ["long board states", "incremental positioning", "damage trading"],
        "evaluation_focus": ["Do you have enough flexibility for slower games?", "Can you avoid being pinned by pivots and Protect?"],
        "default_battle_count": 20,
        "simulation_notes": ["test long endgames", "test pivot loops"],
    },
    {
        "key": "spread-heavy-offense",
        "name": "Spread-heavy offense",
        "summary": "Teams that snowball by repeatedly attacking both slots.",
        "cues": ["spread", "speed-control", "protect"],
        "common_pressures": ["multi-target damage loops", "snowballing tempo", "position compression"],
        "evaluation_focus": ["Do you have Wide Guard or similar answers?", "Can you stop repeat spread turns from snowballing?"],
        "default_battle_count": 24,
        "simulation_notes": ["stress repeated spread turns", "check defensive compression"],
    },
    {
        "key": "direct-pressure-offense",
        "name": "Direct pressure offense",
        "summary": "Immediate damage teams that punish fragile turns and low-protection boards.",
        "cues": ["fake-out", "priority", "intimidate", "speed-control"],
        "common_pressures": ["aggressive turn one", "double-target pressure", "priority cleanup"],
        "evaluation_focus": ["Can you protect fragile turns?", "Can you survive losing the first exchange?"],
        "default_battle_count": 20,
        "simulation_notes": ["stress double-target pressure", "test low-protect lines"],
    },
]

def get_template_by_key(key):
    key = str(key or "").strip().lower()
    return next((template for template in ARCHETYPE_TEMPLATES if template["key"] == key), None)


def normalize_template_keys(keys):
    if not keys:
        return [template["key"] for template in ARCHETYPE_TEMPLATES]
    seen = set()
    normalized = []
    for key in keys:
        template = get_template_by_key(key)
        if template and template["key"] not in seen:
            normalized.append(template["key"])
            seen.add(template["key"])
    return normalized


def list_template_summaries():
    return [
        {
            "key": template["key"],
            "name": template["name"],
            "summary": template["summary"],
            "cues": template["cues"],
            "commonPressures": template["common_pressures"],
            "evaluationFocus": template["evaluation_focus"],
            "defaultBattleCount": template["default_battle_count"],
            "simulationNotes": template["simulation_notes"],
        }
        for template in ARCHETYPE_TEMPLATES
    ]
