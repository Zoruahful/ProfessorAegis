"""Structured coaching payload builder for Matchup Report replays.

This file owns replay coaching extraction so the renderer can stay presentation-only.
The payload is designed to be easy to render today and easy to feed into future
LLM / VGC-bench style post-processing later.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


SPEED_CONTROL_MOVES = {'Tailwind', 'Icy Wind', 'Electroweb', 'Thunder Wave'}
TRICK_ROOM_MOVES = {'Trick Room'}
REDIRECTION_MOVES = {'Follow Me', 'Rage Powder'}
DISRUPTION_MOVES = {'Fake Out', 'Spore', 'Taunt', 'Encore', 'Protect', 'Will-O-Wisp', 'Disable'}
PIVOT_MOVES = {'U-turn', 'Volt Switch', 'Parting Shot', 'Flip Turn', 'Baton Pass', 'Teleport'}
FIELD_CONTROL_MOVES = SPEED_CONTROL_MOVES | TRICK_ROOM_MOVES | REDIRECTION_MOVES | {'Fake Out', 'Spore', 'Wide Guard', 'Quick Guard', 'Helping Hand'}


def _pretty_actor(token: Any) -> str:
    token = str(token or '')
    if ': ' in token:
        _, label = token.split(': ', 1)
        return label
    return token or 'Pokémon'


def _side_from_actor(token: Any) -> Optional[str]:
    token = str(token or '')
    if token.startswith('p1'):
        return 'p1'
    if token.startswith('p2'):
        return 'p2'
    return None


def _push_turn_tag(turn_tags: Dict[int, List[str]], turn: int, tag: str) -> None:
    if not turn:
        return
    bucket = turn_tags.setdefault(int(turn), [])
    if tag not in bucket:
        bucket.append(tag)


def _append_unique_text(bucket: List[str], seen: set, text: str, *, limit: int = 6) -> None:
    text = str(text or '').strip()
    if not text or text in seen or len(bucket) >= limit:
        return
    seen.add(text)
    bucket.append(text)


def _format_turn_tags(tags: List[str]) -> str:
    pretty = []
    for tag in tags:
        part = str(tag or '').strip()
        if not part:
            continue
        pretty.append(part.replace('-', ' ').title())
    return ', '.join(pretty)


def build_coaching_payload(battle_log_data: Any, result_label: str) -> Dict[str, Any]:
    lines = [ln for ln in str(battle_log_data or '').splitlines() if ln]
    current_turn = 0
    max_turn = 0
    first_faint_turn: Optional[int] = None
    first_faint_side: Optional[str] = None
    first_speed_control: Optional[Dict[str, Any]] = None
    first_redirection: Optional[Dict[str, Any]] = None
    first_protect: Optional[Dict[str, Any]] = None
    first_switch: Optional[Dict[str, Any]] = None
    last_switch: Optional[Dict[str, Any]] = None
    last_faint_turn: Optional[int] = None
    first_trick_room: Optional[Dict[str, Any]] = None
    first_pivot_move: Optional[Dict[str, Any]] = None
    turn_event_counts: Dict[int, int] = {}
    threats_faced: List[str] = []
    threat_seen = set()
    field_effects: List[str] = []
    field_seen = set()
    pivot_turns: List[int] = []
    board_control_swings: List[Dict[str, Any]] = []
    turn_tags: Dict[int, List[str]] = {}
    p1_control = 0
    p2_control = 0

    for raw in lines:
        parts = raw.split('|')
        tag = parts[1] if len(parts) > 1 else ''
        if not tag:
            continue

        if tag == 'turn':
            try:
                current_turn = int(parts[2])
                max_turn = max(max_turn, current_turn)
            except Exception:
                pass
            continue

        if current_turn:
            turn_event_counts[current_turn] = turn_event_counts.get(current_turn, 0) + 1

        if tag == 'move':
            actor = str(parts[2] if len(parts) > 2 else '')
            move = str(parts[3] if len(parts) > 3 else '')
            target = str(parts[4] if len(parts) > 4 else '')
            actor_name = _pretty_actor(actor)
            actor_side = _side_from_actor(actor)

            if actor_side == 'p2':
                if move in SPEED_CONTROL_MOVES:
                    _append_unique_text(threats_faced, threat_seen, f"{move} speed control")
                elif move in TRICK_ROOM_MOVES:
                    _append_unique_text(threats_faced, threat_seen, 'Trick Room pressure')
                elif move in REDIRECTION_MOVES:
                    _append_unique_text(threats_faced, threat_seen, f"{move} redirection")
                elif move in {'Spore', 'Taunt', 'Encore', 'Fake Out', 'Will-O-Wisp'}:
                    _append_unique_text(threats_faced, threat_seen, f"{move} disruption")
                elif move in {'Wide Guard', 'Quick Guard'}:
                    _append_unique_text(threats_faced, threat_seen, f"{move} denial")

            if move in SPEED_CONTROL_MOVES and not first_speed_control:
                first_speed_control = {
                    'turn': current_turn or 1,
                    'move': move,
                    'actor': actor_name,
                    'target': _pretty_actor(target),
                    'side': actor_side,
                }
            if move in TRICK_ROOM_MOVES and not first_trick_room:
                first_trick_room = {
                    'turn': current_turn or 1,
                    'move': move,
                    'actor': actor_name,
                    'side': actor_side,
                }
            if move in REDIRECTION_MOVES and not first_redirection:
                first_redirection = {
                    'turn': current_turn or 1,
                    'move': move,
                    'actor': actor_name,
                    'side': actor_side,
                }
            if move == 'Protect' and not first_protect:
                first_protect = {
                    'turn': current_turn or 1,
                    'actor': actor_name,
                    'side': actor_side,
                }
            if move in PIVOT_MOVES:
                if not first_pivot_move:
                    first_pivot_move = {
                        'turn': current_turn or 1,
                        'move': move,
                        'actor': actor_name,
                        'side': actor_side,
                    }
                pivot_turns.append(current_turn or 1)
                _push_turn_tag(turn_tags, current_turn or 1, 'pivot-turn')
            if move in FIELD_CONTROL_MOVES:
                _push_turn_tag(turn_tags, current_turn or 1, 'board-control')
            if move in SPEED_CONTROL_MOVES:
                _push_turn_tag(turn_tags, current_turn or 1, 'speed-control')
                _push_turn_tag(turn_tags, current_turn or 1, 'tempo-swing')
            if move in TRICK_ROOM_MOVES:
                _push_turn_tag(turn_tags, current_turn or 1, 'trick-room')
                _push_turn_tag(turn_tags, current_turn or 1, 'tempo-swing')
            if move in REDIRECTION_MOVES:
                _push_turn_tag(turn_tags, current_turn or 1, 'redirection')
            if move in DISRUPTION_MOVES:
                _push_turn_tag(turn_tags, current_turn or 1, 'disruption')

            continue

        if tag == 'switch':
            actor = str(parts[2] if len(parts) > 2 else '')
            last_switch = {
                'turn': current_turn or 1,
                'actor': _pretty_actor(actor),
                'side': _side_from_actor(actor),
            }
            if not first_switch:
                first_switch = dict(last_switch)
            pivot_turns.append(current_turn or 1)
            _push_turn_tag(turn_tags, current_turn or 1, 'pivot-turn')
            continue

        if tag == 'faint':
            actor = str(parts[2] if len(parts) > 2 else '')
            side = _side_from_actor(actor)
            if first_faint_turn is None:
                first_faint_turn = current_turn or 1
                first_faint_side = side
                _push_turn_tag(turn_tags, current_turn or 1, 'first-ko')
            last_faint_turn = current_turn or last_faint_turn or 1
            _push_turn_tag(turn_tags, current_turn or last_faint_turn or 1, 'ko')
            continue

        if tag in {'-fieldstart', '-weather'}:
            effect = str(parts[2] if len(parts) > 2 else '').replace('move: ', '')
            if effect and effect not in field_seen and effect != 'none':
                field_seen.add(effect)
                field_effects.append(effect)
                _push_turn_tag(turn_tags, current_turn or 1, 'field-pressure')
            continue

    if first_speed_control:
        if first_speed_control.get('side') == 'p1':
            p1_control += 1
        elif first_speed_control.get('side') == 'p2':
            p2_control += 1
    if first_trick_room:
        if first_trick_room.get('side') == 'p1':
            p1_control += 1
        elif first_trick_room.get('side') == 'p2':
            p2_control += 1
    if first_redirection:
        if first_redirection.get('side') == 'p1':
            p1_control += 1
        elif first_redirection.get('side') == 'p2':
            p2_control += 1
    if first_faint_side == 'p2':
        p1_control += 2
    elif first_faint_side == 'p1':
        p2_control += 2

    if first_faint_side == 'p2':
        lead_verdict = 'Good lead pressure'
        lead_matchup = 'You won the opening exchange and took tempo.'
    elif first_faint_side == 'p1':
        lead_verdict = 'Risky lead start'
        lead_matchup = 'The opening trade went against you and made recovery harder.'
    elif first_speed_control and first_speed_control.get('side') == 'p1':
        lead_verdict = 'Playable lead with speed pressure'
        lead_matchup = f"You got speed first with {first_speed_control['move']}."
    elif first_trick_room and first_trick_room.get('side') == 'p1':
        lead_verdict = 'Playable lead into room setup'
        lead_matchup = 'You got room up before the board slipped.'
    else:
        lead_verdict = 'Even lead opening'
        lead_matchup = 'Neither side found an early edge.'

    if first_speed_control:
        if first_speed_control.get('side') == 'p1':
            speed_control_state = f"You established speed control first with {first_speed_control['move']} on Turn {first_speed_control['turn']}."
        else:
            speed_control_state = f"The opponent established speed control first with {first_speed_control['move']} on Turn {first_speed_control['turn']}."
    else:
        speed_control_state = 'No early speed control showed up.'

    if first_trick_room:
        if first_trick_room.get('side') == 'p1':
            trick_room_state = f"You got Trick Room up on Turn {first_trick_room['turn']}."
        else:
            trick_room_state = f"The opponent got Trick Room up on Turn {first_trick_room['turn']}."
    else:
        trick_room_state = 'No Trick Room went up.'

    first_ko = None
    if first_faint_turn is not None:
        first_ko = {
            'turn': first_faint_turn,
            'side': first_faint_side,
            'summary': 'You scored the first knockout.' if first_faint_side == 'p2' else 'The opponent scored the first knockout.' if first_faint_side == 'p1' else 'The first knockout landed.',
        }

    if first_speed_control:
        board_control_swings.append({
            'turn': int(first_speed_control['turn']),
            'type': 'speed-control',
            'summary': f"{first_speed_control['move']} decided the first speed race.",
            'side': first_speed_control.get('side'),
        })
    if first_trick_room:
        board_control_swings.append({
            'turn': int(first_trick_room['turn']),
            'type': 'trick-room',
            'summary': 'Trick Room changed the order of play.',
            'side': first_trick_room.get('side'),
        })
    if first_redirection:
        board_control_swings.append({
            'turn': int(first_redirection['turn']),
            'type': 'redirection',
            'summary': f"{first_redirection['move']} changed targeting flow.",
            'side': first_redirection.get('side'),
        })
    if first_ko:
        board_control_swings.append({
            'turn': int(first_ko['turn']),
            'type': 'first-ko',
            'summary': first_ko['summary'],
            'side': first_ko.get('side'),
        })
    if first_pivot_move:
        board_control_swings.append({
            'turn': int(first_pivot_move['turn']),
            'type': 'pivot',
            'summary': f"{first_pivot_move['move']} created a reposition window.",
            'side': first_pivot_move.get('side'),
        })

    board_control_swings = sorted(board_control_swings, key=lambda item: (int(item.get('turn') or 0), str(item.get('type') or '')))

    if p1_control > p2_control:
        endgame_advantage = 'You controlled more key tempo points.'
    elif p2_control > p1_control:
        endgame_advantage = 'The opponent controlled more key tempo points.'
    elif result_label == 'WIN':
        endgame_advantage = 'You closed a tight game cleanly.'
    elif result_label == 'LOSS':
        endgame_advantage = 'The game stayed close, but the finish favored the opponent.'
    else:
        endgame_advantage = 'The game stayed close on tempo and positioning.'

    if result_label == 'WIN':
        if first_speed_control and first_speed_control.get('side') == 'p1':
            win_path = f"Won speed control with {first_speed_control['move']} and converted it."
        elif first_trick_room and first_trick_room.get('side') == 'p1':
            win_path = 'Used Trick Room timing to flip the board.'
        elif first_faint_side == 'p2':
            win_path = 'Converted first KO into tempo.'
        else:
            win_path = 'Held board position and closed cleanly.'

        if first_redirection and first_redirection.get('side') == 'p2':
            loss_cause = 'Opponent redirection forced awkward turns early.'
        else:
            loss_cause = 'No major collapse point.'

        next_adjustment = 'Repeat the winning line and clean up damage routes.'
    elif result_label == 'LOSS':
        if first_trick_room and first_trick_room.get('side') == 'p2':
            win_path = 'You needed to deny Trick Room earlier.'
        else:
            win_path = 'You needed a cleaner tempo swing earlier.'
        if first_speed_control and first_speed_control.get('side') == 'p2':
            loss_cause = f"Lost early tempo around {first_speed_control['move']}."
        elif first_trick_room and first_trick_room.get('side') == 'p2':
            loss_cause = 'Room went up and the board got harder to reset.'
        elif first_faint_side == 'p1':
            loss_cause = 'Lost first KO and fell behind on board control.'
        elif first_redirection and first_redirection.get('side') == 'p2':
            loss_cause = 'Redirection bought the opponent too much space.'
        else:
            loss_cause = 'Board position slipped before endgame.'

        next_adjustment = 'Look for a safer lead or stronger turn-one pressure.'
    else:
        win_path = 'The game stayed playable throughout.'
        loss_cause = 'Neither side found a clean finishing swing.'
        next_adjustment = 'Look for small midgame efficiency gains.'

    critical_turn = 1
    critical_note = 'Opening turns decided the pace here.'
    markers: List[Dict[str, Any]] = []

    if first_faint_turn is not None:
        critical_turn = first_faint_turn
        critical_note = 'First KO changed the tempo.'
        markers.append({'turn': first_faint_turn, 'label': critical_note, 'kind': 'critical'})

    first_swing_turn = None
    first_swing_note = None
    if first_speed_control:
        first_swing_turn = int(first_speed_control['turn'])
        first_swing_note = f"{first_speed_control['move']} set the speed race"
    elif first_trick_room:
        first_swing_turn = int(first_trick_room['turn'])
        first_swing_note = 'Trick Room changed the board order'
    elif first_redirection:
        first_swing_turn = int(first_redirection['turn'])
        first_swing_note = f"{first_redirection['move']} redirected pressure"
    elif first_switch:
        first_swing_turn = int(first_switch['turn'])
        first_swing_note = f"{first_switch['actor']} repositioned the board"
    if first_swing_turn is not None:
        markers.append({'turn': first_swing_turn, 'label': first_swing_note or 'First swing turn', 'kind': 'first-swing'})

    if max_turn:
        endgame_turn = max(1, max_turn - 1 if max_turn > 2 else max_turn)
        markers.append({'turn': endgame_turn, 'label': 'Endgame setup starts here', 'kind': 'endgame-setup'})
        closing_turn = last_faint_turn or max_turn
        markers.append({'turn': closing_turn, 'label': 'Closing sequence starts here', 'kind': 'closing-turn'})

    seen = set()
    deduped_markers = []
    for marker in markers:
        key = (int(marker.get('turn') or 0), str(marker.get('kind') or ''))
        if not key[0] or key in seen:
            continue
        seen.add(key)
        deduped_markers.append(marker)

    tempo_swings: List[str] = []
    if first_speed_control:
        tempo_swings.append(f"Turn {first_speed_control['turn']}: {first_speed_control['move']} decided the speed race.")
    if first_trick_room:
        tempo_swings.append(f"Turn {first_trick_room['turn']}: Trick Room changed move order pressure.")
    if first_faint_turn is not None:
        side_text = 'you lost a Pokémon first' if first_faint_side == 'p1' else 'the opponent lost a Pokémon first' if first_faint_side == 'p2' else 'the first knockout landed'
        tempo_swings.append(f"Turn {first_faint_turn}: {side_text}.")
    if first_redirection:
        tempo_swings.append(f"Turn {first_redirection['turn']}: {first_redirection['move']} changed target flow.")
    if not tempo_swings:
        tempo_swings.append('No single early swing stood out; positioning decided it.')

    endgame_state = f"Game ended on Turn {max_turn}." if max_turn else 'Endgame timing was not clearly detected.'
    if last_switch and max_turn and last_switch['turn'] >= max(1, max_turn - 2):
        endgame_state += f" Late repositioning appeared on Turn {last_switch['turn']}."
    if field_effects:
        endgame_state += f" Field pressure included {', '.join(field_effects[:2])}."
    endgame_state += f" {endgame_advantage}"

    adjustment_notes: List[str] = []
    if result_label == 'LOSS':
        adjustment_notes.append('Respect the first tempo loss more in preview and turn one.')
    else:
        adjustment_notes.append('Keep the line that gave you tempo and avoid extra trades.')
    if first_redirection:
        adjustment_notes.append('Bring more spread damage or redirect-proof pressure.')
    if first_speed_control and first_speed_control['move'] in {'Tailwind', 'Trick Room'}:
        adjustment_notes.append(f"Plan an answer to {first_speed_control['move']} before the board flips.")
    if first_trick_room and first_trick_room['side'] == 'p2':
        adjustment_notes.append('Have a room-denial or stall line ready.')
    if first_faint_side == 'p1':
        adjustment_notes.append('Protect the first threatened slot earlier.')
    if first_switch and first_switch.get('turn') == 1:
        adjustment_notes.append('Check whether the early reposition helped or just gave away tempo.')
    if not adjustment_notes:
        adjustment_notes.append(next_adjustment)

    adjustment_notes = list(dict.fromkeys([note for note in adjustment_notes if str(note).strip()]))[:6]

    advanced_points = [
        f"Game length: {max_turn or 'Unknown'} turns",
        f"First knockout: Turn {first_faint_turn}" if first_faint_turn is not None else 'First knockout: No clear early knockout found',
        f"Speed control: Turn {first_speed_control['turn']} via {first_speed_control['move']}" if first_speed_control else 'Speed control: No major speed control event detected early',
        f"Trick Room: Turn {first_trick_room['turn']}" if first_trick_room else 'Trick Room: No Trick Room event detected',
        f"Redirection: Turn {first_redirection['turn']} via {first_redirection['move']}" if first_redirection else 'Redirection: No early redirection marker found',
    ]

    sorted_turn_tags = [
        {'turn': int(turn), 'tags': tags}
        for turn, tags in sorted(turn_tags.items(), key=lambda item: int(item[0]))
    ]

    turn_coaching: List[Dict[str, Any]] = []
    marker_by_turn = {int(marker.get('turn') or 0): marker for marker in deduped_markers if int(marker.get('turn') or 0) > 0}
    turn_tags_lookup = {int(item['turn']): list(item['tags']) for item in sorted_turn_tags}
    turns_to_cover = sorted({int(t) for t in turn_event_counts.keys() if int(t) > 0} | set(turn_tags_lookup.keys()) | set(marker_by_turn.keys()))

    def _join_bits(bits: List[str], fallback: str) -> str:
        cleaned = [str(bit).strip() for bit in bits if str(bit or '').strip()]
        return '; '.join(cleaned) if cleaned else fallback

    for turn in turns_to_cover:
        tags = turn_tags_lookup.get(turn, [])
        facts: List[str] = []
        impact: List[str] = []
        adjust: List[str] = []

        marker = marker_by_turn.get(turn)
        if marker:
            facts.append(str(marker.get('label') or 'A key sequence happened here.'))

        if first_speed_control and int(first_speed_control.get('turn') or 0) == turn:
            facts.append(f"{first_speed_control['actor']} used {first_speed_control['move']} to shape the speed race.")
            impact.append('Speed order changed and that affected damage pacing.')
            adjust.append('Have an answer ready for the speed-control turn.')

        if first_trick_room and int(first_trick_room.get('turn') or 0) == turn:
            facts.append(f"{first_trick_room['actor']} set Trick Room.")
            impact.append('Move order flipped and the board became harder to navigate.')
            adjust.append('Pressure Trick Room earlier or stall it cleaner.')

        if first_redirection and int(first_redirection.get('turn') or 0) == turn:
            facts.append(f"{first_redirection['actor']} used {first_redirection['move']} to redirect pressure.")
            impact.append('Targeting tightened and damage routes got narrower.')
            adjust.append('Use spread pressure or punish the redirect slot faster.')

        if first_ko and int(first_ko.get('turn') or 0) == turn:
            facts.append(first_ko.get('summary') or 'The first knockout landed.')
            impact.append('First KO created the main tempo swing.')
            adjust.append('Respect the first-KO turn more in positioning.')

        if turn in {int(t) for t in pivot_turns if int(t) > 0}:
            facts.append('A pivot or reposition happened here.')
            impact.append('Board position changed and opened a new damage route.')
            adjust.append('Check whether the pivot improved board control.')

        if 'tempo-swing' in tags and not any('tempo' in item.lower() for item in impact):
            impact.append('Tempo moved noticeably on this turn.')
        if 'board-control' in tags and not any('board' in item.lower() for item in impact):
            impact.append('Board control shifted through utility or field pressure.')
        if 'ko' in tags and not any('knockout' in item.lower() for item in facts):
            facts.append('A knockout happened during this sequence.')
        if 'redirection' in tags and not any('redirect' in item.lower() for item in facts):
            facts.append('Redirection influenced targeting on this turn.')
        if 'speed-control' in tags and not any('speed' in item.lower() for item in facts):
            facts.append('Speed control pressure showed up here.')
        if 'trick-room' in tags and not any('trick room' in item.lower() for item in facts):
            facts.append('Trick Room pressure mattered on this turn.')
        if 'protect' in tags or 'disruption' in tags:
            adjust.append('Ask whether a safer line cut the disruption value.')
        if 'field-pressure' in tags:
            impact.append('Field conditions added extra pressure.')

        event_count = int(turn_event_counts.get(turn) or 0)
        if event_count >= 8 and not any('busy turn' in item.lower() for item in impact):
            impact.append('A lot happened on this turn.')

        turn_coaching.append({
            'turn': turn,
            'whatHappened': _join_bits(facts, 'Key actions happened here.'),
            'whyItMattered': _join_bits(impact, 'This turn changed the board and tempo.'),
            'nextAdjustment': _join_bits(adjust, next_adjustment),
            'tags': tags,
        })


    if not threats_faced:
        fallback_threats = []
        if first_redirection:
            fallback_threats.append(f"Redirection appeared on Turn {first_redirection['turn']} via {first_redirection['move']}.")
        if first_speed_control:
            fallback_threats.append(f"Speed control started on Turn {first_speed_control['turn']} via {first_speed_control['move']}.")
        if first_trick_room:
            fallback_threats.append(f"Trick Room pressure showed up on Turn {first_trick_room['turn']}.")
        if first_protect:
            fallback_threats.append(f"Protect sequencing mattered early on Turn {first_protect['turn']}.")
        threats_faced = fallback_threats[:6]

    if not tempo_swings:
        fallback_swings = []
        if first_faint_turn is not None:
            if first_faint_side == 'p1':
                fallback_swings.append(f"Turn {first_faint_turn}: you lost the first knockout and tempo dipped immediately.")
            elif first_faint_side == 'p2':
                fallback_swings.append(f"Turn {first_faint_turn}: you claimed the first knockout and gained early tempo.")
            else:
                fallback_swings.append(f"Turn {first_faint_turn}: the first knockout changed board pressure.")
        if first_speed_control:
            fallback_swings.append(f"Turn {first_speed_control['turn']}: speed control altered move order through {first_speed_control['move']}.")
        if first_trick_room:
            fallback_swings.append(f"Turn {first_trick_room['turn']}: Trick Room changed the speed landscape.")
        tempo_swings = fallback_swings[:6]

    if not board_control_swings:
        fallback_board_swings = []
        if first_faint_turn is not None:
            fallback_board_swings.append({
                'turn': first_faint_turn,
                'summary': 'The first knockout shifted board control.' if first_faint_side is None else (
                    'Losing the first knockout made positioning harder.' if first_faint_side == 'p1' else 'Getting the first knockout opened the board.'
                ),
            })
        if first_pivot_move:
            fallback_board_swings.append({
                'turn': int(first_pivot_move.get('turn') or 0),
                'summary': f"Pivot move {first_pivot_move.get('move') or 'used'} changed positioning.",
            })
        board_control_swings = [item for item in fallback_board_swings if int(item.get('turn') or 0) > 0][:8]

    if not endgame_state:
        if endgame_advantage:
            endgame_state = str(endgame_advantage)
        elif result == 'win':
            endgame_state = 'You reached a winning endgame once the board stabilized.'
        elif result == 'loss':
            endgame_state = 'The endgame was losing once the early pressure was not recovered.'
        else:
            endgame_state = 'The endgame stayed contested without a clean advantage.'

    if not adjustment_notes:
        adjustment_notes = [next_adjustment] if str(next_adjustment or '').strip() else []

    if not sorted_turn_tags:
        fallback_turn_tags = []
        if first_faint_turn is not None:
            fallback_turn_tags.append({'turn': int(first_faint_turn), 'tags': ['first-ko']})
        if first_speed_control:
            fallback_turn_tags.append({'turn': int(first_speed_control.get('turn') or 0), 'tags': ['speed-control']})
        if first_trick_room:
            fallback_turn_tags.append({'turn': int(first_trick_room.get('turn') or 0), 'tags': ['trick-room']})
        sorted_turn_tags = [item for item in fallback_turn_tags if int(item.get('turn') or 0) > 0]

    structured_signals = {
        'leadMatchup': lead_matchup,
        'speedControlState': speed_control_state,
        'trickRoomState': trick_room_state,
        'firstKO': first_ko,
        'pivotTurns': sorted({int(t) for t in pivot_turns if int(t) > 0}),
        'boardControlSwings': board_control_swings[:8],
        'endgameAdvantage': endgame_advantage,
        'turnTags': sorted_turn_tags,
        'turnCoaching': turn_coaching,
    }

    return {
        'schemaVersion': 'coach-payload-v4',
        'leadVerdict': lead_verdict,
        'leadMatchup': lead_matchup,
        'winPath': win_path,
        'lossCause': loss_cause,
        'criticalTurn': critical_turn,
        'criticalNote': critical_note,
        'criticalTurns': deduped_markers,
        'nextAdjustment': next_adjustment,
        'speedControlState': speed_control_state,
        'trickRoomState': trick_room_state,
        'firstKO': first_ko,
        'pivotTurns': structured_signals['pivotTurns'],
        'boardControlSwings': structured_signals['boardControlSwings'],
        'endgameAdvantage': endgame_advantage,
        'turnTags': structured_signals['turnTags'],
        'turnCoaching': structured_signals['turnCoaching'],
        'advancedNotes': {
            'gameLength': max_turn or None,
            'firstKnockoutTurn': first_faint_turn,
            'firstKnockoutSide': first_faint_side,
            'firstSpeedControl': first_speed_control,
            'firstTrickRoom': first_trick_room,
            'firstRedirection': first_redirection,
            'firstProtect': first_protect,
            'firstSwitch': first_switch,
            'firstPivotMove': first_pivot_move,
            'lastSwitch': last_switch,
            'lastFaintTurn': last_faint_turn,
            'turnEventCounts': turn_event_counts,
            'structuredSignals': structured_signals,
        },
        'advancedPoints': advanced_points,
        'threatsFaced': threats_faced[:6],
        'tempoSwings': tempo_swings[:6],
        'endgameState': endgame_state,
        'adjustmentNotes': adjustment_notes[:6],
        'tags': [
            tag for tag in [
                'speed-control' if first_speed_control else None,
                'trick-room' if first_trick_room else None,
                'redirection' if first_redirection else None,
                'protect' if first_protect else None,
                'first-ko' if first_faint_turn is not None else None,
                'pivot' if first_pivot_move or pivot_turns else None,
            ] if tag
        ],
    }
