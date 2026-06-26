ADVICE_LIBRARY_VERSION = "2026.04.16-matchup-advice-v2"

MATCHUP_ADVICE = {
    "hard-trick-room": {
        "strong_into_it": ["Taunt pressure", "Fast offense", "Trick Room denial"],
        "why": "Stops Trick Room setup or punishes it before the board flips.",
        "lean_tags": ["setup denial", "fast pressure", "tempo control"],
    },
    "redirection-balance": {
        "strong_into_it": ["Spread offense", "Positioning pressure", "Redirect-resistant pressure"],
        "why": "Pressures both slots so redirection is less effective.",
        "lean_tags": ["spread pressure", "positioning pressure", "target flexibility"],
    },
    "bulky-balance": {
        "strong_into_it": ["Strong setup pressure", "Clean pivot punishment", "High burst damage"],
        "why": "Breaks slow, stable turns with burst damage and pivot punishment.",
        "lean_tags": ["burst pressure", "pivot punishment", "tempo control"],
    },
    "spread-heavy-offense": {
        "strong_into_it": ["Wide Guard support", "Defensive repositioning", "Immediate damage control"],
        "why": "Cuts off free spread damage and slows their snowball.",
        "lean_tags": ["spread denial", "defensive utility", "tempo control"],
    },
    "direct-pressure-offense": {
        "strong_into_it": ["Bulkier openings", "Intimidate cycles", "Strong defensive turns"],
        "why": "Makes their early damage less punishing and stabilizes the first turns.",
        "lean_tags": ["defensive utility", "bulk", "damage control"],
    },
    "fast-offense-mirrors": {
        "strong_into_it": ["Reliable speed control", "Priority pressure", "Bulkier speed control cores"],
        "why": "Helps you win the speed war and recover after the first trade.",
        "lean_tags": ["speed control", "priority", "tempo control"],
    },
}


THEME_ACTIONS = {
    "setup denial": "more setup denial tools",
    "fast pressure": "faster early pressure",
    "tempo control": "better tempo control",
    "spread pressure": "more spread pressure",
    "positioning pressure": "better positioning pressure",
    "target flexibility": "ways to punish or ignore redirection",
    "burst pressure": "stronger burst damage",
    "pivot punishment": "better pivot punishment",
    "spread denial": "more spread denial",
    "defensive utility": "more defensive utility",
    "bulk": "bulkier openings",
    "damage control": "better damage control",
    "speed control": "more reliable speed control",
    "priority": "priority pressure",
}

THEME_LABELS = {
    "setup denial": "setup denial",
    "fast pressure": "fast pressure",
    "tempo control": "tempo control",
    "spread pressure": "spread pressure",
    "positioning pressure": "positioning pressure",
    "target flexibility": "target flexibility",
    "burst pressure": "burst pressure",
    "pivot punishment": "pivot punishment",
    "spread denial": "spread denial",
    "defensive utility": "defensive utility",
    "bulk": "bulk",
    "damage control": "damage control",
    "speed control": "speed control",
    "priority": "priority pressure",
}


def get_matchup_advice(template_key):
    return MATCHUP_ADVICE.get(str(template_key or "").strip().lower())
