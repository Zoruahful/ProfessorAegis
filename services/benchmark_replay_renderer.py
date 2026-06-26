"""Replay HTML renderer for Matchup Report archives.

This file only owns replay presentation.
It is intentionally separated from benchmark_engine so future layout work
can happen here without touching report generation logic.
"""

from __future__ import annotations

import html
import json
import re
from typing import Any, Dict, Optional

from benchmark_coach_payload import build_coaching_payload

# ============================================================
# Theme / display variables
# Edit these first if you want to change replay appearance later.
# ============================================================
DEFAULT_PAGE_STYLE = (
    "html,body {font-family:Verdana, sans-serif;font-size:10pt;margin:0;padding:0;}"
    "body{padding:12px 0;}"
    " .battle-log {font-family:Verdana, sans-serif;font-size:10pt;}"
    " .battle-log-inline {border:1px solid #AAAAAA;background:#EEF2F5;color:black;max-width:640px;margin:0 auto 80px;padding-bottom:5px;}"
    " .battle-log .inner {padding:4px 8px 0px 8px;}"
    " .battle-log .inner-preempt {padding:0 8px 4px 8px;}"
    " .battle-log .inner-after {margin-top:0.5em;}"
    " .battle-log h2 {margin:0.5em -8px;padding:4px 8px;border:1px solid #AAAAAA;background:#E0E7EA;border-left:0;border-right:0;font-family:Verdana, sans-serif;font-size:13pt;}"
    " .battle-log .chat {vertical-align:middle;padding:3px 0 3px 0;font-size:8pt;}"
    " .battle-log .chat strong {color:#40576A;}"
    " .battle-log .chat em {padding:1px 4px 1px 3px;color:#000000;font-style:normal;}"
    " .chat.mine {background:rgba(0,0,0,0.05);margin-left:-8px;margin-right:-8px;padding-left:8px;padding-right:8px;}"
    " .spoiler {color:#BBBBBB;background:#BBBBBB;padding:0px 3px;}"
    " .spoiler:hover, .spoiler:active, .spoiler-shown {color:#000000;background:#E2E2E2;padding:0px 3px;}"
    " .spoiler a {color:#BBBBBB;}"
    " .spoiler:hover a, .spoiler:active a, .spoiler-shown a {color:#2288CC;}"
    " .chat code, .chat .spoiler:hover code, .chat .spoiler:active code, .chat .spoiler-shown code {border:1px solid #C0C0C0;background:#EEEEEE;color:black;padding:0 2px;}"
    " .chat .spoiler code {border:1px solid #CCCCCC;background:#CCCCCC;color:#CCCCCC;}"
    " .battle-log .rated {padding:3px 4px;}"
    " .battle-log .rated strong {color:white;background:#89A;padding:1px 4px;border-radius:4px;}"
    " .spacer {margin-top:0.5em;}"
    " .message-announce {background:#6688AA;color:white;padding:1px 4px 2px;}"
    " .message-announce a, .broadcast-green a, .broadcast-blue a, .broadcast-red a {color:#DDEEFF;}"
    " .broadcast-green {background-color:#559955;color:white;padding:2px 4px;}"
    " .broadcast-blue {background-color:#6688AA;color:white;padding:2px 4px;}"
    " .infobox {border:1px solid #6688AA;padding:2px 4px;}"
    " .infobox-limited {max-height:200px;overflow:auto;overflow-x:hidden;}"
    " .broadcast-red {background-color:#AA5544;color:white;padding:2px 4px;}"
    " .message-learn-canlearn {font-weight:bold;color:#228822;text-decoration:underline;}"
    " .message-learn-cannotlearn {font-weight:bold;color:#CC2222;text-decoration:underline;}"
    " .message-effect-weak {font-weight:bold;color:#CC2222;}"
    " .message-effect-resist {font-weight:bold;color:#6688AA;}"
    " .message-effect-immune {font-weight:bold;color:#666666;}"
    " .message-learn-list {margin-top:0;margin-bottom:0;}"
    " .message-throttle-notice, .message-error {color:#992222;}"
    " .message-overflow, .chat small.message-overflow {font-size:0pt;}"
    " .message-overflow::before {font-size:9pt;content:'...';}"
    " .subtle {color:#3A4A66;}"
    " body{padding:12px 0;background:linear-gradient(180deg,#151a22 0%,#1a212c 52%,#161c25 100%);color:#E8ECF3;} body.dark{background:linear-gradient(180deg,#151a22 0%,#1a212c 52%,#161c25 100%)!important;color:#E8ECF3;}"
    " .wrapper.replay-wrapper{max-width:1180px;margin:-20px auto 0 auto;padding:0 16px 28px;}"
    " .replay-stage-shell{position:sticky;top:14px;z-index:25;max-width:1220px;margin:0 auto 18px;padding:20px 18px 16px;background:linear-gradient(180deg,#23272e 0%,#1f242c 100%);border:1px solid #3b4250;border-radius:28px;box-shadow:0 18px 44px rgba(0,0,0,.28);}"
    " .replay-stage-shell .battle,.replay-stage-shell .battle-log,.replay-stage-shell .replay-controls,.replay-stage-shell .replay-controls-2{position:relative;z-index:1;}"
    " .replay-stage-shell .battle{max-width:640px;margin:0 auto;border-radius:18px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.22);}"
    " .replay-stage-shell .battle-log{display:none!important;height:0!important;min-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;}"
    " .replay-stage-shell .replay-controls,.replay-stage-shell .replay-controls-2{max-width:640px;margin:10px auto 0 auto;text-align:center;}"
    " .replay-stage-shell .replay-controls-2{padding-top:0;}"
    " .replay-stage-shell h1{margin:16px 0 0;text-align:center;font-weight:normal;color:#F4F7FB;}"
    " .replay-stage-shell .subtle{color:#AEBED1;}"
    " .replay-stage-shell button,.replay-stage-shell .button,.replay-stage-shell input[type=button]{border-radius:12px!important;border:1px solid rgba(110,160,230,.26)!important;background:#142033!important;color:#eaf2ff!important;box-shadow:none!important;}"
    " .replay-stage-shell button:hover,.replay-stage-shell .button:hover,.replay-stage-shell input[type=button]:hover{background:#192845!important;border-color:rgba(110,160,230,.46)!important;}"
    " .replay-shell-divider{max-width:760px;margin:14px auto;border:0;border-top:1px solid #515966;}"
    " @media (max-width:1100px){.replay-stage-shell{position:static;padding:14px 14px 10px;border-radius:22px;}.replay-stage-shell .battle,.replay-stage-shell .replay-controls,.replay-stage-shell .replay-controls-2{max-width:100%;}}"
    " .coach-panel{max-width:760px;margin:0 auto 14px;background:#23272e;border:1px solid #3b4250;border-radius:16px;padding:18px 20px;box-shadow:0 10px 24px rgba(0,0,0,0.18);color:#E8ECF3;}"
    " .coach-panel-header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;flex-wrap:wrap;}"
    " .coach-panel-title{font-size:16px;font-weight:bold;color:#FFFFFF;}"
    " .coach-panel-subtitle{font-size:11px;color:#9AA7B8;}"
    " .coach-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:10px;}"
    " .coach-grid-secondary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}"
    " .coach-card{background:linear-gradient(180deg,rgba(11,18,30,.96),rgba(10,16,27,.96));border:1px solid rgba(95,130,180,.28);border-radius:12px;padding:10px 12px;min-height:74px;}"
    " .coach-label{font-size:10px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#8FA1B5;margin-bottom:6px;}"
    " .coach-value{font-size:14px;line-height:1.35;color:#F4F7FB;}"
    " .coach-value a{color:#8CC8FF;text-decoration:none;font-weight:bold;}"
    " .coach-value a:hover{text-decoration:underline;}"
    " .coach-toggle{background:#2D3644;border:1px solid #4A5568;color:#EAF2FF;border-radius:999px;padding:6px 12px;cursor:pointer;font-size:11px;font-weight:bold;}"
    " .section-collapse-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;border:1px solid rgba(110,160,230,.26);background:#142033;color:#EAF2FF;border-radius:999px;padding:7px 12px;cursor:pointer;font:inherit;font-size:11px;font-weight:700;line-height:1;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 8px 18px rgba(0,0,0,.16);transition:background .15s ease,border-color .15s ease,transform .15s ease,box-shadow .15s ease;}"
    " .section-collapse-button:hover{border-color:rgba(110,160,230,.46);background:#192845;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 22px rgba(0,0,0,.2);transform:translateY(-1px);}"
    " .section-collapse-button:active{transform:translateY(0);}"
    " .section-collapse-button:focus-visible{outline:none;border-color:#4da3ff;box-shadow:0 0 0 1px rgba(77,163,255,.22) inset,0 0 0 3px rgba(77,163,255,.18);}"
    " .section-collapse-button .section-collapse-chevron{display:inline-block;transition:transform .2s ease;}"
    " .section-collapse-button.is-collapsed .section-collapse-chevron{transform:rotate(-90deg);}"
    " .section-collapsible-body{display:block;overflow:hidden;max-height:4000px;opacity:1;transition:max-height .26s ease,opacity .2s ease,margin-top .2s ease;}"
    " .section-collapsible-body.is-collapsed{max-height:0!important;opacity:0;pointer-events:none;overflow:hidden;margin-top:0!important;}"
    " .coach-toggle{min-height:36px;line-height:1;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 8px 18px rgba(0,0,0,.16);transition:background .15s ease,border-color .15s ease,transform .15s ease,box-shadow .15s ease;}"
    " .coach-toggle:hover{background:#344154;border-color:#5b6c86;transform:translateY(-1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 22px rgba(0,0,0,.2);}"
    " .coach-toggle:active{transform:translateY(0);}"
    " .coach-toggle.is-open{background:#244064;border-color:#5ea7ff;box-shadow:0 0 0 1px rgba(94,167,255,.22) inset,0 8px 18px rgba(0,0,0,.16);}"
    " .coach-advanced{display:block;overflow:hidden;max-height:0;opacity:0;transform:translateY(-6px);pointer-events:none;margin-top:12px;background:linear-gradient(180deg,rgba(11,18,30,.96),rgba(10,16,27,.96));border:1px solid rgba(95,130,180,.28);border-radius:12px;padding:0 14px;transition:max-height .28s ease,opacity .2s ease,transform .22s ease,padding .22s ease;}"
    " .coach-advanced.open{max-height:2200px;opacity:1;transform:translateY(0);pointer-events:auto;padding:12px 14px;margin-top:14px;} .coach-markers{margin-top:18px;padding:16px 18px;border:1px solid rgba(120,160,220,.22);border-radius:18px;background:linear-gradient(180deg,rgba(11,19,33,.92),rgba(9,15,26,.88));} .coach-markers-header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;} .coach-marker-nav{display:flex;gap:8px;flex-wrap:wrap;} .coach-nav-button,.coach-marker-button{appearance:none;border:1px solid rgba(110,160,230,.26);background:#142033;color:#eaf2ff;border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit;} .coach-nav-button:hover,.coach-marker-button:hover{border-color:rgba(110,160,230,.46);background:#192845;} .coach-marker-list{display:flex;gap:10px;flex-wrap:wrap;} .coach-marker-button{display:flex;flex-direction:column;align-items:flex-start;min-width:180px;} .coach-marker-button.active{background:#203459;border-color:#4da3ff;box-shadow:0 0 0 1px rgba(77,163,255,.25) inset;} .coach-marker-turn{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#7fb7ff;} .coach-marker-label{margin-top:6px;font-size:14px;line-height:1.35;color:#f4f8ff;} .coach-turn-flash{box-shadow:0 0 0 2px rgba(77,163,255,.65),0 0 32px rgba(77,163,255,.18);border-color:rgba(77,163,255,.72)!important;}"
    " .coach-advanced ul{margin:0;padding-left:18px;}"
    " .team-sheet-panel{max-width:760px;margin:0 auto 14px;background:#23272e;border:1px solid #3b4250;border-radius:14px;padding:14px 16px;box-shadow:0 10px 24px rgba(0,0,0,0.16);color:#E8ECF3;}"
    " .team-sheet-header{display:flex;justify-content:space-between;align-items:center;gap:12px;}"
    " .team-sheet-title{font-size:16px;font-weight:bold;color:#FFFFFF;}"
    " .team-sheet-subtitle{font-size:11px;color:#9AA7B8;margin-top:4px;}"
    " .team-sheet-toggle{background:#2D3644;border:1px solid #4A5568;color:#EAF2FF;border-radius:999px;padding:6px 12px;cursor:pointer;font-size:11px;font-weight:bold;}"
    " .team-sheet-body{display:block;overflow:hidden;max-height:0;opacity:0;transform:translateY(-4px);pointer-events:none;margin-top:0;transition:max-height .28s ease,opacity .2s ease,transform .22s ease,margin-top .22s ease;} .team-sheet-body.open{max-height:1200px;opacity:1;transform:translateY(0);pointer-events:auto;margin-top:12px;}"
    " .team-sheet-pre{margin:0;white-space:pre-wrap;word-break:break-word;background:#111A26;border:1px solid #2B394C;border-radius:12px;padding:14px 16px;color:#F4F7FB;line-height:1.5;font-family:Consolas,\'Courier New\',monospace;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.24);}"
    " .pretty-log-team-card{position:relative;}"
    " .pretty-log-team-toggle-row{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 14px 0;}"
    " .pretty-log-copy-button,.pretty-log-team-toggle{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;border:1px solid rgba(110,160,230,.26);background:#142033;color:#EAF2FF;border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit;font-size:12px;font-weight:700;letter-spacing:.01em;line-height:1;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 8px 18px rgba(0,0,0,.16);transition:background .15s ease,border-color .15s ease,transform .15s ease,box-shadow .15s ease;}"
    " .pretty-log-copy-button:hover,.pretty-log-team-toggle:hover{border-color:rgba(110,160,230,.46);background:#192845;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 22px rgba(0,0,0,.2);transform:translateY(-1px);}"
    " .pretty-log-copy-button:active,.pretty-log-team-toggle:active{transform:translateY(0);box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 6px 14px rgba(0,0,0,.18);}"
    " .pretty-log-copy-button:focus-visible,.pretty-log-team-toggle:focus-visible{outline:none;border-color:#4da3ff;box-shadow:0 0 0 1px rgba(77,163,255,.22) inset,0 0 0 3px rgba(77,163,255,.18);}"
    " .pretty-log-team-sheet{display:none;margin-top:12px;} .pretty-log-team-sheet.open{display:block;}"
    " .pretty-log-team-pre{margin:0;white-space:pre-wrap;word-break:break-word;background:#111A26;border:1px solid #2B394C;border-radius:12px;padding:14px 16px;color:#F4F7FB;line-height:1.5;font-family:Consolas,\'Courier New\',monospace;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.24);max-height:420px;overflow:auto;}"
    " .coach-advanced li{margin:0 0 6px 0;color:#D7DFEA;}"
    " .battle-log-inline{border:0;background:transparent;max-width:760px;margin:0 auto 80px;padding-bottom:0;}"
    " .battle-log-inline .inner{padding:0;}"
    " .battle-log-inline .message-log{padding:0 !important;}"
    " .pretty-log{max-width:760px;margin:0 auto;color:#E8ECF3;}"
    " .pretty-log-top{background:linear-gradient(180deg,rgba(22,31,44,.94),rgba(16,24,36,.94));border:1px solid rgba(95,130,180,.32);border-radius:16px;padding:16px 18px;box-shadow:0 10px 24px rgba(0,0,0,0.18);margin-bottom:12px;}"
    " .pretty-log-title{font-size:16px;font-weight:bold;color:#FFFFFF;margin-bottom:10px;}"
    " .pretty-log-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;}"
    " .pretty-log-meta-card{background:linear-gradient(180deg,rgba(11,18,30,.96),rgba(10,16,27,.96));border:1px solid rgba(95,130,180,.28);border-radius:14px;padding:12px 14px;min-width:0;overflow:hidden;}"
    " .pretty-log-meta-card strong{display:block;color:#8FA1B5;font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;}"
    " .pretty-log-meta-card span{color:#F4F7FB;line-height:1.45;}"
    " .turn-card{background:linear-gradient(180deg,rgba(22,31,44,.94),rgba(16,24,36,.94));border:1px solid rgba(95,130,180,.32);border-radius:14px;box-shadow:0 10px 24px rgba(0,0,0,0.16);margin-bottom:12px;overflow:hidden;}"
    " .turn-card.turn-highlight{box-shadow:0 0 0 2px rgba(140,200,255,0.55),0 10px 24px rgba(0,0,0,0.18);}"
    " .turn-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;background:linear-gradient(180deg,rgba(13,21,34,.98),rgba(11,18,30,.98));border-bottom:1px solid rgba(95,130,180,.22);}"
    " .turn-header-left{display:flex;align-items:center;gap:10px;}"
    " .turn-anchor{color:#8CC8FF;text-decoration:none;font-weight:bold;font-size:20px;line-height:1;}"
    " .turn-anchor:hover{text-decoration:underline;}"
    " .turn-title{font-size:20px;font-weight:bold;color:#FFFFFF;line-height:1.1;}"
    " .turn-subtitle{font-size:11px;color:#93A1B5;}"
    " .turn-body{padding:12px 14px;}"
    " .event-row{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(95,130,180,.16);}"
    " .event-row:last-child{border-bottom:0;padding-bottom:0;}"
    " .event-tag{flex:0 0 auto;min-width:72px;text-align:center;background:#2D3644;border:1px solid #4A5568;color:#EAF2FF;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;}"
    " .event-tag.tag-ko{background:#4a1f24;border-color:#7e2f3a;}"
    " .event-tag.tag-control{background:#21354a;border-color:#2e5f88;}"
    " .event-tag.tag-info{background:#243327;border-color:#36533c;}"
    " .event-tag.tag-switch{background:#3a2c1d;border-color:#6f5532;}"
    " .event-text{flex:1;color:#F4F7FB;line-height:1.45;}"
    " .event-text small{color:#9FB0C4;}"
    " .coach-advanced-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}"
    " .coach-advanced-card{background:#111A26;border:1px solid #2B394C;border-radius:14px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.24);}"
    " .coach-advanced-title{font-size:12px;font-weight:bold;letter-spacing:.05em;text-transform:uppercase;color:#9FB3D1;margin-bottom:8px;}"
    " .coach-advanced-card ul{margin:0;padding-left:18px;color:#F4F7FB;}"
    " .coach-advanced-card li{margin:0 0 8px 0;line-height:1.45;color:#EAF2FF;} .coach-empty-state{padding:12px 14px;border:1px dashed rgba(120,160,220,.28);border-radius:12px;background:rgba(12,20,32,.55);color:#9fb3d1;line-height:1.45;} .coach-empty-state strong{color:#eaf2ff;} .coach-marker-empty{width:100%;} .filter-empty-state{display:none;width:100%;padding:12px 14px;border:1px dashed rgba(120,160,220,.24);border-radius:12px;background:rgba(12,20,32,.45);color:#9fb3d1;line-height:1.45;margin-top:12px;} .filter-empty-state.open{display:block;}"
    " .coach-advanced-text{color:#EAF2FF;line-height:1.5;}"
    " .coaching-view-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 12px 0;padding:12px 14px;background:linear-gradient(180deg,rgba(11,18,30,.96),rgba(10,16,27,.96));border:1px solid rgba(95,130,180,.28);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.16);flex-wrap:wrap;}"
    " .coaching-view-label{font-size:11px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#9FB3D1;margin-bottom:12px;}"
    " .coaching-view-buttons{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}"
    " .coaching-view-filters{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center;}"
    " .coaching-filter-chip{appearance:none;border:1px solid rgba(95,130,180,.34);background:linear-gradient(180deg,rgba(19,31,48,.98),rgba(15,24,38,.98));color:#EAF2FF;border-radius:999px;padding:7px 12px;cursor:pointer;font:inherit;font-size:11px;font-weight:bold;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 8px 18px rgba(0,0,0,.16);}"
    " .coaching-filter-chip.active{background:linear-gradient(180deg,rgba(33,74,122,.98),rgba(25,57,96,.98));border-color:#5ea7ff;box-shadow:0 0 0 1px rgba(94,167,255,.22) inset,0 10px 22px rgba(0,0,0,.18);}.coaching-view-button:hover,.coaching-filter-chip:hover{border-color:rgba(118,166,229,.52);background:linear-gradient(180deg,rgba(24,39,60,.98),rgba(17,28,43,.98));}"
    " "
    " "
    " .pretty-log.filter-ko .event-row,.pretty-log.filter-damage .event-row,.pretty-log.filter-switch .event-row,.pretty-log.filter-field .event-row,.pretty-log.filter-ability .event-row,.pretty-log.filter-boost .event-row,.pretty-log.filter-status .event-row,.pretty-log.filter-info .event-row{display:none;}"
    " .pretty-log.filter-ko .event-row[data-event-type='ko'],.pretty-log.filter-damage .event-row[data-event-type='damage'],.pretty-log.filter-switch .event-row[data-event-type='switch'],.pretty-log.filter-field .event-row[data-event-type='field'],.pretty-log.filter-ability .event-row[data-event-type='ability'],.pretty-log.filter-boost .event-row[data-event-type='boost'],.pretty-log.filter-status .event-row[data-event-type='status'],.pretty-log.filter-info .event-row[data-event-type='info']{display:flex;}"
    " .pretty-log.filter-ko .turn-card,.pretty-log.filter-damage .turn-card,.pretty-log.filter-switch .turn-card,.pretty-log.filter-field .turn-card,.pretty-log.filter-ability .turn-card,.pretty-log.filter-boost .turn-card,.pretty-log.filter-status .turn-card,.pretty-log.filter-info .turn-card{display:none;}"
    " .pretty-log.filter-ko .turn-card.has-visible-events,.pretty-log.filter-damage .turn-card.has-visible-events,.pretty-log.filter-switch .turn-card.has-visible-events,.pretty-log.filter-field .turn-card.has-visible-events,.pretty-log.filter-ability .turn-card.has-visible-events,.pretty-log.filter-boost .turn-card.has-visible-events,.pretty-log.filter-status .turn-card.has-visible-events,.pretty-log.filter-info .turn-card.has-visible-events{display:block;}"
    " .coaching-view-button{appearance:none;border:1px solid rgba(95,130,180,.34);background:linear-gradient(180deg,rgba(19,31,48,.98),rgba(15,24,38,.98));color:#EAF2FF;border-radius:999px;padding:7px 12px;cursor:pointer;font:inherit;font-size:11px;font-weight:bold;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 8px 18px rgba(0,0,0,.16);}"
    " .coaching-view-button.active{background:linear-gradient(180deg,rgba(33,74,122,.98),rgba(25,57,96,.98));border-color:#5ea7ff;box-shadow:0 0 0 1px rgba(94,167,255,.22) inset,0 10px 22px rgba(0,0,0,.18);}"
    " .turn-coaching-panel{display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(143,161,181,0.16);}"
    " .turn-coaching-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}"
    " .turn-coaching-card{background:#111A26;border:1px solid #2B394C;border-radius:12px;padding:12px 13px;box-shadow:0 8px 24px rgba(0,0,0,0.22);}"
    " .turn-coaching-title{font-size:11px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#9FB3D1;margin-bottom:8px;}"
    " .turn-coaching-text{color:#F1F6FF;line-height:1.5;}"
    " .pretty-log.coaching-view .turn-coaching-panel{display:block;}"
    " .pretty-log.coaching-view .turn-subtitle{color:#B4C5DA;}"
    " @media (max-width: 820px){.coach-grid,.coach-grid-secondary,.pretty-log-meta,.coach-advanced-grid,.turn-coaching-grid{grid-template-columns:1fr;}.event-row,.coaching-view-toolbar{flex-direction:column;align-items:flex-start;}.event-tag{min-width:0;}.coach-panel,.pretty-log-top{padding:16px;}.coach-marker-button,.pretty-log-copy-button,.pretty-log-team-toggle,.coaching-view-button,.coaching-filter-chip{width:100%;justify-content:center;}.pretty-log-team-toggle-row,.coaching-view-buttons,.coaching-view-filters,.coach-marker-nav,.coach-marker-list{width:100%;}.turn-header{align-items:flex-start;}}"
)

EXTRA_REPLAY_SHELL_STYLE = """
.replay-wrapper{overflow:visible!important;}
.replay-stage-anchor{position:relative;min-height:0;}
.replay-stage-shell{position:sticky;top:14px;overflow:visible;}
.replay-stage-shell.replay-stage-shell--fixed{position:fixed!important;top:14px;left:50%;transform:translateX(-50%);width:min(1220px,calc(100vw - 32px));margin:0;}
.replay-stage-shell.replay-stage-shell--fixed.replay-stage-shell--compact{width:min(1040px,calc(100vw - 28px));}
.replay-stage-shell.replay-stage-shell--fixed.replay-stage-shell--compact{width:min(1040px,calc(100vw - 28px));}
.replay-stage-shell.replay-stage-shell--compact{top:10px;padding:8px 10px 8px;border-radius:20px;box-shadow:0 12px 28px rgba(0,0,0,.34);}
.replay-stage-spacer{display:none;}
.replay-stage-spacer.active{display:block;}
.replay-stage-layout{display:grid;grid-template-columns:188px minmax(0,1fr) 188px;gap:16px;align-items:start;}
.replay-side-panel{display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(4,15,32,.98),rgba(1,10,22,.98));border:1px solid rgba(74,116,170,.34);border-radius:22px;padding:12px 12px 14px;box-shadow:inset 0 0 0 1px rgba(43,87,145,.08);min-height:0;height:auto;max-height:none;overflow:hidden;}
.replay-side-heading{margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#d8e7ff;line-height:1.3;}
.replay-control-grid,.replay-speed-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
.replay-speed-grid{margin-top:0;}
.replay-control-button,.replay-speed-button,.replay-marker-nav-button,.replay-marker-card{appearance:none;width:100%;border:1px solid rgba(103,154,219,.32);background:#13233a;color:#eef5ff;border-radius:14px;cursor:pointer;box-shadow:none;transition:background .18s ease,border-color .18s ease,color .18s ease,transform .18s ease;font-family:Inter,"Segoe UI",Verdana,sans-serif;}
.replay-control-button,.replay-speed-button,.replay-marker-nav-button{display:flex;align-items:center;justify-content:center;min-height:42px;padding:0 12px;font-size:14px;font-weight:750;line-height:1.08;letter-spacing:.01em;text-align:center;}
.replay-control-button:hover,.replay-speed-button:hover,.replay-marker-nav-button:hover,.replay-marker-card:hover{background:#183050;border-color:rgba(123,182,255,.52);}
.replay-stage-shell .replay-control-button.is-live{background:#11361f!important;border-color:#31b86b!important;color:#dfffe9!important;box-shadow:0 0 0 1px rgba(49,184,107,.18) inset,0 10px 22px rgba(0,0,0,.18)!important;}
.replay-stage-shell .replay-control-button.is-stopped{background:#3a1016!important;border-color:#d94b5f!important;color:#ffe8eb!important;box-shadow:0 0 0 1px rgba(217,75,95,.16) inset,0 10px 22px rgba(0,0,0,.18)!important;}
.replay-stage-shell .replay-speed-button.is-active{background:#133d22!important;border-color:#33c26f!important;color:#dcffe8!important;box-shadow:0 0 0 1px rgba(51,194,111,.16) inset,0 10px 22px rgba(0,0,0,.18)!important;}
.replay-center-column{min-width:0;padding-top:2px;}
.replay-battle-frame{max-width:640px;margin:0 auto;padding:0;background:transparent;border:0;border-radius:0;box-shadow:none;}
.replay-stage-shell .battle{max-width:640px;margin:0 auto;border-radius:18px;overflow:hidden;box-shadow:0 16px 32px rgba(0,0,0,.28);}
.replay-title-block{max-width:760px;margin:10px auto 0;text-align:center;}
.replay-title-line{display:block;font-size:26px;line-height:1.08;color:#f4f7fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.replay-title-line .subtle{color:#f4f7fb;}
.replay-result-line{margin-top:8px;}
.replay-result-pill{display:inline-flex;align-items:center;justify-content:center;min-width:88px;padding:8px 18px;border-radius:999px;background:#09121f;border:1px solid rgba(84,120,172,.24);font-size:14px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;}
.replay-stage-shell.replay-stage-shell--compact .replay-stage-layout{grid-template-columns:132px minmax(0,1fr) 132px;gap:8px;}
.replay-stage-shell.replay-stage-shell--compact .replay-side-panel{padding:8px 8px 10px;border-radius:16px;}
.replay-stage-shell.replay-stage-shell--compact .replay-side-heading{margin-bottom:6px;font-size:10px;letter-spacing:.12em;}
.replay-stage-shell.replay-stage-shell--compact .replay-control-grid,.replay-stage-shell.replay-stage-shell--compact .replay-speed-grid,.replay-stage-shell.replay-stage-shell--compact .replay-marker-list{gap:5px;}
.replay-stage-shell.replay-stage-shell--compact .replay-control-button,.replay-stage-shell.replay-stage-shell--compact .replay-speed-button,.replay-stage-shell.replay-stage-shell--compact .replay-marker-nav-button{min-height:33px;padding:0 8px;font-size:11px;border-radius:11px;}
.replay-stage-shell.replay-stage-shell--compact .replay-marker-card{gap:3px;padding:8px 8px 9px;min-height:68px;border-radius:11px;}
.replay-stage-shell.replay-stage-shell--compact .replay-marker-card .coach-marker-turn{font-size:9px;}
.replay-stage-shell.replay-stage-shell--compact .replay-marker-card .coach-marker-label{font-size:11px;line-height:1.2;}
.replay-stage-shell.replay-stage-shell--compact .replay-battle-frame{max-width:544px;}
.replay-stage-shell.replay-stage-shell--compact .battle{max-width:544px;box-shadow:0 10px 20px rgba(0,0,0,.22);}
.replay-stage-shell.replay-stage-shell--compact .replay-title-block{margin-top:6px;}
.replay-stage-shell.replay-stage-shell--compact .replay-title-line{font-size:18px;line-height:1.02;transform:none;}
.replay-stage-shell.replay-stage-shell--compact .replay-result-line{margin-top:4px;}
.replay-stage-shell.replay-stage-shell--compact .replay-result-pill{min-width:66px;padding:5px 12px;font-size:11px;letter-spacing:.14em;}
.replay-stage-shell.replay-stage-shell--compact .replay-sticky-toggle{min-height:30px;margin-top:8px;padding:0 8px;font-size:10px;border-radius:11px;}
.replay-stage-shell .replay-controls,.replay-stage-shell .replay-controls-2,.replay-stage-shell .battle-options,.battle-log-inline .battle-options{display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important;margin:0!important;padding:0!important;border:0!important;}
.replay-side-panel .replay-section-label{margin:12px 0 8px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#d8e7ff;}
.replay-sticky-toggle{margin-top:10px;display:flex;align-items:center;justify-content:center;min-height:36px;padding:0 10px;font-size:11px;font-weight:800;letter-spacing:.03em;text-align:center;}
.replay-sticky-toggle.is-off{background:#2c2430!important;border-color:#8f6bb3!important;color:#f2e8ff!important;box-shadow:0 0 0 1px rgba(143,107,179,.16) inset,0 10px 22px rgba(0,0,0,.18)!important;}
.replay-marker-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px;}
 .replay-marker-nav-button{font-size:13px;padding:0 8px;min-height:40px;}
.replay-marker-list{display:grid;grid-template-columns:1fr;gap:10px;}
.replay-marker-card{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:12px 12px 14px;text-align:left;min-height:96px;}
.replay-marker-card.is-active{background:#203459;border-color:#4da3ff;box-shadow:0 0 0 1px rgba(77,163,255,.25) inset;}
.replay-marker-card .coach-marker-turn{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7fb7ff;}
.replay-marker-card .coach-marker-label{font-size:16px;line-height:1.2;color:#f4f8ff;}
#coach-markers{display:none!important;}
@media (max-width:1100px){
  .replay-stage-shell.replay-stage-shell--fixed{position:static!important;transform:none;width:auto;}
  .replay-stage-layout{grid-template-columns:1fr;}
  .replay-title-line{white-space:normal;}
}
"""



def prettify_template_name(value: Any) -> str:
    text = str(value or '').strip()
    if not text:
        return 'Unknown matchup'
    text = text.replace('_', ' ').replace('-', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return ' '.join(part.capitalize() for part in text.split(' '))


def slugify_filename(value: Any) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    return text.strip("-") or "matchup"


def build_replay_id(format_id: Any, archetype_label: Any, game_number: Any, opponent_registry_id: Any = None) -> str:
    format_part = slugify_filename(format_id or 'matchup-report')
    archetype_part = slugify_filename(archetype_label or 'opponent')
    game_part = int(game_number or 1)
    prefix = f"{int(opponent_registry_id)}-" if int(opponent_registry_id or 0) > 0 else ""
    return f"{format_part}-{prefix}{archetype_part}-game-{game_part}"


def rewrite_replay_player_names(
    battle_log_data: Any,
    p1_name: str = 'You',
    p2_name: str = 'Opponent',
) -> str:
    out = []
    last_nonempty = None
    pending_split = False
    for raw_line in str(battle_log_data or '').splitlines():
        line = str(raw_line or '').rstrip('\r')
        if not line or line.startswith('|debug|'):
            continue
        if line.startswith('|split|'):
            pending_split = True
            continue
        if line.startswith('|player|p1|'):
            parts = line.split('|')
            if len(parts) >= 5:
                parts[3] = p1_name
                line = '|'.join(parts)
        elif line.startswith('|player|p2|'):
            parts = line.split('|')
            if len(parts) >= 5:
                parts[3] = p2_name
                line = '|'.join(parts)
        elif line.startswith('|win|'):
            parts = line.split('|')
            if len(parts) >= 3:
                winner = parts[2]
                if winner == 'Professor Aegis User':
                    parts[2] = p1_name
                elif winner == 'Benchmark Opponent':
                    parts[2] = p2_name
                line = '|'.join(parts)
        if pending_split and line == last_nonempty:
            pending_split = False
            continue
        pending_split = False
        if line == last_nonempty and (line.startswith('|switch|') or line.startswith('|-damage|') or line.startswith('|move|')):
            continue
        out.append(line)
        if line:
            last_nonempty = line
    return '\n'.join(out).strip()


def extract_replay_winner(battle_log_data: Any) -> str:
    for raw_line in reversed(str(battle_log_data or '').splitlines()):
        line = raw_line.strip()
        if line.startswith('|win|'):
            parts = line.split('|')
            if len(parts) >= 3:
                return parts[2].strip()
    return ''


def result_from_winner(winner: str, p1_name: str = 'You', p2_name: str = 'Opponent') -> tuple[str, str]:
    if not winner:
        return ('TIE', '#888888')
    if winner == p1_name:
        return ('WIN', '#2da44e')
    if winner == p2_name:
        return ('LOSS', '#d1242f')
    return ('TIE', '#888888')


def _pretty_actor(token: Any) -> str:
    token = str(token or '')
    if ': ' in token:
        _, label = token.split(': ', 1)
        return label
    return token or 'Pokémon'


def _species_from_details(details: Any) -> str:
    head = str(details or '').split('|')[0]
    head = head.split(',')[0].strip()
    return head or 'Pokémon'


def _hp_percent_from_fraction(frac: str) -> Optional[float]:
    try:
        cur, total = frac.split('/', 1)
        cur = float(re.sub(r'[^0-9.]', '', cur) or 0)
        total = float(re.sub(r'[^0-9.]', '', total) or 0)
        if total <= 0:
            return None
        return round((cur / total) * 100, 1)
    except Exception:
        return None


def build_bottom_replay_log_html(battle_log_data: Any, format_id: Any, p1_name: str, p2_name: str, coach_payload: Optional[Dict[str, Any]] = None, player_team_export: Any = '', opponent_team_export: Any = '') -> str:
    lines = [ln for ln in str(battle_log_data or '').splitlines() if ln]
    p1_team = []
    p2_team = []
    turns = []
    current_turn = None

    def ensure_turn(turn_no: int) -> Dict[str, Any]:
        nonlocal current_turn
        if current_turn is None or current_turn.get('turn') != turn_no:
            current_turn = {'turn': turn_no, 'events': []}
            turns.append(current_turn)
        return current_turn

    def add_event(label: str, content: str, tag_class: str = '') -> None:
        bucket = current_turn or ensure_turn(0)
        bucket['events'].append({'label': label, 'content': content, 'tagClass': tag_class})

    for raw in lines:
        if raw.startswith('|poke|'):
            parts = raw.split('|')
            if len(parts) >= 4:
                side = parts[2]
                species = _species_from_details(parts[3])
                if side == 'p1':
                    p1_team.append(species)
                elif side == 'p2':
                    p2_team.append(species)

    for raw in lines:
        parts = raw.split('|')
        tag = parts[1] if len(parts) > 1 else ''
        if not tag:
            continue
        if tag == 'turn':
            try:
                ensure_turn(int(parts[2]))
            except Exception:
                ensure_turn(len(turns) + 1)
            continue
        if tag == 'switch':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            details = parts[3] if len(parts) > 3 else ''
            hp = parts[4] if len(parts) > 4 else ''
            pct = _hp_percent_from_fraction(hp)
            hp_text = f' ({pct}%)' if pct is not None else ''
            add_event('Switch', f'<strong>{html.escape(actor)}</strong> entered the field. <small>{html.escape(details)}{html.escape(hp_text)}</small>', 'tag-switch')
            continue
        if tag == 'move':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            move = parts[3] if len(parts) > 3 else ''
            target = _pretty_actor(parts[4] if len(parts) > 4 else '')
            target_text = f' on <strong>{html.escape(target)}</strong>' if target else ''
            label = 'Control' if move in {'Tailwind', 'Trick Room', 'Icy Wind', 'Electroweb', 'Thunder Wave'} else ('Protect' if move == 'Protect' else 'Move')
            tag_class = 'tag-control' if label == 'Control' else 'tag-info'
            add_event(label, f'<strong>{html.escape(actor)}</strong> used <strong>{html.escape(move)}</strong>{target_text}.', tag_class)
            continue
        if tag == '-damage':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            hp = parts[3] if len(parts) > 3 else ''
            pct = _hp_percent_from_fraction(hp)
            if pct is not None:
                add_event('Damage', f'<strong>{html.escape(actor)}</strong> took damage. <small>Remaining HP ({html.escape(str(pct))}%)</small>')
            else:
                add_event('Damage', f'<strong>{html.escape(actor)}</strong> took damage.')
            continue
        if tag == '-heal':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            hp = parts[3] if len(parts) > 3 else ''
            pct = _hp_percent_from_fraction(hp)
            if pct is not None:
                add_event('Heal', f'<strong>{html.escape(actor)}</strong> recovered health. <small>Current HP ({html.escape(str(pct))}%)</small>', 'tag-info')
            else:
                add_event('Heal', f'<strong>{html.escape(actor)}</strong> recovered health.', 'tag-info')
            continue
        if tag == '-supereffective':
            add_event('Damage', 'The hit was <strong>super effective</strong>.', 'tag-ko')
            continue
        if tag == '-resisted':
            add_event('Info', 'The hit was resisted.', 'tag-info')
            continue
        if tag == '-immune':
            add_event('Info', 'The attack had no effect.', 'tag-info')
            continue
        if tag == '-status':
            target = _pretty_actor(parts[2] if len(parts) > 2 else '')
            status = parts[3] if len(parts) > 3 else ''
            add_event('Status', f'<strong>{html.escape(target)}</strong> was afflicted with <strong>{html.escape(status)}</strong>.', 'tag-control')
            continue
        if tag == '-fieldstart':
            move = parts[2].replace('move: ', '') if len(parts) > 2 else ''
            text = 'The battlefield got weird!' if move == 'Psychic Terrain' else f'<strong>{html.escape(move)}</strong> began.'
            add_event('Field', text, 'tag-control')
            continue
        if tag == '-weather':
            weather = parts[2] if len(parts) > 2 else ''
            text = 'The weather cleared.' if weather == 'none' else f'<strong>{html.escape(weather)}</strong> is active.'
            add_event('Field', text, 'tag-control')
            continue
        if tag == '-ability':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            ability = parts[3] if len(parts) > 3 else ''
            if ability == 'As One':
                text = f'The opposing <strong>{html.escape(actor)}</strong> activated <strong>As One</strong>. It has two abilities.'
            elif ability == 'Unnerve':
                text = f'The opposing <strong>{html.escape(actor)}</strong> activated <strong>Unnerve</strong>. Your team is too nervous to eat Berries.'
            else:
                text = f'<strong>{html.escape(actor)}</strong> activated <strong>{html.escape(ability)}</strong>.'
            add_event('Ability', text, 'tag-info')
            continue
        if tag == '-end':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            effect = parts[3] if len(parts) > 3 else ''
            if effect == 'Illusion':
                add_event('Info', f'<strong>{html.escape(actor)}</strong>&#39;s illusion wore off.', 'tag-info')
            continue
        if tag == '-boost':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            stat = parts[3] if len(parts) > 3 else ''
            amount = int(parts[4]) if len(parts) > 4 and str(parts[4]).lstrip('-').isdigit() else 1
            word = 'rose sharply' if amount >= 2 else 'rose'
            add_event('Boost', f'<strong>{html.escape(actor)}</strong>&#39;s <strong>{html.escape(stat.title())}</strong> {word}.', 'tag-control')
            continue
        if tag == '-activate':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            reason = parts[3] if len(parts) > 3 else ''
            if 'Electric Terrain' in reason:
                add_event('Field', f'<strong>{html.escape(actor)}</strong> was protected by Electric Terrain.', 'tag-control')
            continue
        if tag == '-hitcount':
            count = parts[3] if len(parts) > 3 else ''
            add_event('Info', f'The Pokémon was hit <strong>{html.escape(count)}</strong> times.', 'tag-info')
            continue
        if tag == 'faint':
            actor = _pretty_actor(parts[2] if len(parts) > 2 else '')
            add_event('KO', f'<strong>{html.escape(actor)}</strong> fainted.', 'tag-ko')
            continue
        if tag == 'replace':
            continue
        if tag == 'win':
            winner = parts[2] if len(parts) > 2 else ''
            add_event('Result', f'<strong>{html.escape(winner)}</strong> won the battle.', 'tag-ko')
            continue

    player_team_export_text = str(player_team_export or '').replace('\r\n', '\n').strip()
    opponent_team_export_text = str(opponent_team_export or '').replace('\r\n', '\n').strip()

    def build_team_meta_card(title: str, summary: str, export_text: str, panel_id: str) -> str:
        summary_html = html.escape(summary or 'Unknown team')
        if not export_text:
            return f'<div class="pretty-log-meta-card"><strong>{html.escape(title)}</strong><span>{summary_html}</span></div>'
        escaped_export = html.escape(export_text)
        return (
            f'<div class="pretty-log-meta-card pretty-log-team-card">'
            f'<strong>{html.escape(title)}</strong>'
            f'<span>{summary_html}</span>'
            f'<div id="{panel_id}" class="pretty-log-team-sheet"><pre class="pretty-log-team-pre">{escaped_export}</pre></div>'
            f'</div>'
        )

    team_toggle_html = ''
    if player_team_export_text or opponent_team_export_text:
        player_copy_attr = html.escape(player_team_export_text, quote=True)
        opponent_copy_attr = html.escape(opponent_team_export_text, quote=True)
        buttons = [
            '<button type="button" class="pretty-log-team-toggle" onclick="return toggleReplayTeamSheets(this);">Show Full Exports</button>'
        ]
        if player_team_export_text:
            buttons.append(
                f'<button type="button" class="pretty-log-copy-button" data-copy-export="{player_copy_attr}" data-default-label="Copy Your Team" onclick="return copyReplayTeamExports(this);">Copy Your Team</button>'
            )
        if opponent_team_export_text:
            buttons.append(
                f'<button type="button" class="pretty-log-copy-button" data-copy-export="{opponent_copy_attr}" data-default-label="Copy Opponent Team" onclick="return copyReplayTeamExports(this);">Copy Opponent Team</button>'
            )
        team_toggle_html = '<div class="pretty-log-team-toggle-row">' + ''.join(buttons) + '</div>'

    meta_html = f"""<div class="pretty-log-top">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div class="pretty-log-title" style="margin-bottom:0;">Battle Log</div>
        <button type="button" class="section-collapse-button" id="battle-log-collapse-button" onclick="return toggleSectionCollapse(event, 'battle-log');"><span>Collapse Battle Log</span><span class="section-collapse-chevron">▾</span></button>
      </div>
      <div class="section-collapsible-body" id="battle-log-body" style="margin-top:12px;">
      {team_toggle_html}
      <div class="pretty-log-meta">
        <div class="pretty-log-meta-card"><strong>Format</strong><span>{html.escape(str(format_id or 'Benchmark Format'))}</span></div>
        <div class="pretty-log-meta-card"><strong>Matchup</strong><span>{html.escape(p1_name)} vs. {html.escape(p2_name)}</span></div>
        {build_team_meta_card(f"{p1_name}'s team", ' / '.join(p1_team) or 'Unknown team', player_team_export_text, 'player-team-sheet-body')}
        {build_team_meta_card(f"{p2_name}'s team", ' / '.join(p2_team) or 'Unknown team', opponent_team_export_text, 'opponent-team-sheet-body')}
      </div>
      </div>
    </div>"""

    turn_html_parts = []
    visible_turns = [turn for turn in turns if turn.get('turn') != 0 or turn.get('events')]
    for turn in visible_turns:
        turn_no = int(turn.get('turn') or 0)
        subtitle = 'Critical sequence' if turn_no == 1 else 'Key event flow'
        events_html = ''.join(
            f'<div class="event-row" data-event-type="{html.escape(str((event.get("label") or "info")).lower().replace(" ", "-"))}"><div class="event-tag {html.escape(event.get("tagClass") or "")}">{html.escape(event.get("label") or "Info")}</div><div class="event-text">{event.get("content") or ""}</div></div>'
            for event in turn.get('events') or []
        ) or "<div class=\"event-row\" data-event-type=\"info\"><div class=\"event-tag\">Info</div><div class=\"event-text\">No notable events captured for this turn.</div></div>"
        turn_html_parts.append(f"""<section class=\"turn-card\" data-turn-card=\"{turn_no}\">
          <div class=\"turn-header\">
            <div class=\"turn-header-left\">
              <a class=\"turn-anchor\" href=\"#\" onclick=\"return jumpReplayTurn(event, {turn_no});\">#</a>
              <div>
                <div class=\"turn-title\">Turn {turn_no}</div>
                <div class=\"turn-subtitle\">{subtitle}</div>
              </div>
            </div>
          </div>
          <div class=\"turn-body\">{events_html}</div>
        </section>""")

    coaching_lookup = {}
    if isinstance(coach_payload, dict):
        for item in coach_payload.get('turnCoaching') or []:
            turn_no = int(item.get('turn') or 0)
            if turn_no > 0:
                coaching_lookup[turn_no] = item

    event_counts = {'all': 0, 'ko': 0, 'damage': 0, 'switch': 0, 'field': 0, 'ability': 0, 'boost': 0, 'status': 0, 'info': 0}
    for turn in visible_turns:
        for event in turn.get('events') or []:
            raw_label = str(event.get('label') or 'info').lower().replace(' ', '-')
            event_counts['all'] += 1
            if raw_label in event_counts:
                event_counts[raw_label] += 1
            elif raw_label == 'heal':
                event_counts['info'] += 1
            elif raw_label in {'control', 'protect', 'result'}:
                event_counts['info'] += 1
            else:
                event_counts['info'] += 1

    toolbar_html = f'''<div class="coaching-view-toolbar"><div style="width:100%;"><div class="coaching-view-label">Battle Log View</div><div class="coaching-view-buttons"><button type="button" class="coaching-view-button active" data-coaching-view="standard" onclick="return setCoachingView(event, 'standard');">Standard View</button><button type="button" class="coaching-view-button" data-coaching-view="coaching" onclick="return setCoachingView(event, 'coaching');">Coaching View</button></div><div class="coaching-view-filters"><button type="button" class="coaching-filter-chip active" data-event-filter="all" onclick="return setReplayEventFilter(event, 'all');">All</button><button type="button" class="coaching-filter-chip" data-event-filter="ko" onclick="return setReplayEventFilter(event, 'ko');">KO</button><button type="button" class="coaching-filter-chip" data-event-filter="damage" onclick="return setReplayEventFilter(event, 'damage');">Damage</button><button type="button" class="coaching-filter-chip" data-event-filter="switch" onclick="return setReplayEventFilter(event, 'switch');">Switch</button><button type="button" class="coaching-filter-chip" data-event-filter="field" onclick="return setReplayEventFilter(event, 'field');">Field</button><button type="button" class="coaching-filter-chip" data-event-filter="ability" onclick="return setReplayEventFilter(event, 'ability');">Ability</button><button type="button" class="coaching-filter-chip" data-event-filter="boost" onclick="return setReplayEventFilter(event, 'boost');">Boost</button><button type="button" class="coaching-filter-chip" data-event-filter="status" onclick="return setReplayEventFilter(event, 'status');">Status</button><button type="button" class="coaching-filter-chip" data-event-filter="info" onclick="return setReplayEventFilter(event, 'info');">Info</button></div></div><div id="filter-empty-state" class="filter-empty-state">No events match this filter for this replay.</div></div>'''

    enhanced_parts = []
    for turn in visible_turns:
        turn_no = int(turn.get('turn') or 0)
        coaching = coaching_lookup.get(turn_no, {})
        what = html.escape(str(coaching.get('whatHappened') or 'Key actions were captured on this turn.'))
        why = html.escape(str(coaching.get('whyItMattered') or 'This turn affected tempo or board position.'))
        adj = html.escape(str(coaching.get('nextAdjustment') or 'Review whether a safer line existed here.'))
        base = turn_html_parts[visible_turns.index(turn)]
        coaching_html = f'''<div class="turn-coaching-panel"><div class="turn-coaching-grid"><div class="turn-coaching-card"><div class="turn-coaching-title">What happened</div><div class="turn-coaching-text">{what}</div></div><div class="turn-coaching-card"><div class="turn-coaching-title">Why it mattered</div><div class="turn-coaching-text">{why}</div></div><div class="turn-coaching-card"><div class="turn-coaching-title">Next adjustment</div><div class="turn-coaching-text">{adj}</div></div></div></div>'''
        enhanced_parts.append(base.replace('</section>', f'{coaching_html}</section>'))

    return f'<div class="pretty-log">{meta_html}{toolbar_html}{"".join(enhanced_parts)}</div>'



def build_replay_html(format_id: Any, archetype_label: Any, game: Optional[Dict[str, Any]], opponent_registry_id: Any = None) -> Optional[str]:
    game = dict(game or {})
    pretty_archetype = prettify_template_name(archetype_label or game.get('opponentName') or 'Opponent')
    battle_log_data = rewrite_replay_player_names(
        game.get('battleLogData'),
        p1_name='You',
        p2_name=pretty_archetype,
    )
    if not battle_log_data:
        return None

    game_number = int(game.get('gameNumber') or 1)
    replay_id = html.escape(build_replay_id(format_id, pretty_archetype, game_number, opponent_registry_id=opponent_registry_id))
    title = html.escape(
        f"[{format_id or 'Benchmark Format'}] Matchup Report replay: You vs. {pretty_archetype}"
    )
    winner = extract_replay_winner(battle_log_data)
    result_label, result_color = result_from_winner(winner, p1_name='You', p2_name=pretty_archetype)
    id_suffix = f" [{int(opponent_registry_id)}]" if int(opponent_registry_id or 0) > 0 else ''
    safe_archetype = html.escape(pretty_archetype)
    coach = build_coaching_payload(battle_log_data, result_label)
    player_team_export = str(game.get('playerTeamExport') or game.get('userTeamExport') or '').replace('\r\n', '\n').strip()
    opponent_team_export = str(game.get('opponentTeamExport') or '').replace('\r\n', '\n').strip()
    bottom_html = build_bottom_replay_log_html(battle_log_data, format_id, 'You', pretty_archetype, coach, player_team_export=player_team_export, opponent_team_export=opponent_team_export)
    coach_payload_json = json.dumps(coach, ensure_ascii=False).replace('</', '<\/')
    opponent_team_panel_html = ''

    return f'''<!DOCTYPE html>
<meta charset="utf-8" />
<!-- version 3 -->
<title>{title}</title>
<style>{DEFAULT_PAGE_STYLE}{EXTRA_REPLAY_SHELL_STYLE}</style>
<div class="wrapper replay-wrapper;">
<input type="hidden" name="replayid" value="{replay_id}" />
<div class="replay-stage-anchor" id="replay-stage-anchor">
<div class="replay-stage-spacer" id="replay-stage-spacer"></div>
<div class="replay-stage-shell" id="replay-stage-shell">
  <div class="replay-stage-layout">
    <aside class="replay-side-panel replay-controls-panel">
      <div class="replay-side-heading">Replay<br />Controls</div>
      <div class="replay-control-grid">
        <button type="button" class="replay-control-button is-stopped" id="custom-play-button" onclick="return toggleReplayPlay(event);">Play</button>
        <button type="button" class="replay-control-button" onclick="return triggerReplayControl(event, 'reset');">Reset</button>
        <button type="button" class="replay-control-button" onclick="return triggerReplayControl(event, 'last');">Last Turn</button>
        <button type="button" class="replay-control-button" onclick="return triggerReplayControl(event, 'next');">Next Turn</button>
        <button type="button" class="replay-control-button" onclick="return triggerReplayControl(event, 'switch');">Switch Sides</button>
      </div>
      <div class="replay-section-label">Speed</div>
      <div class="replay-speed-grid">
        <button type="button" class="replay-speed-button" data-speed-key="0.5x" onclick="return setReplaySpeed(event, '0.5x');">0.5x</button>
        <button type="button" class="replay-speed-button is-active" data-speed-key="1x" onclick="return setReplaySpeed(event, '1x');">1x</button>
        <button type="button" class="replay-speed-button" data-speed-key="2x" onclick="return setReplaySpeed(event, '2x');">2x</button>
        <button type="button" class="replay-speed-button" data-speed-key="4x" onclick="return setReplaySpeed(event, '4x');">4x</button>
      </div>
      <button type="button" class="replay-control-button replay-sticky-toggle" id="replay-sticky-toggle" onclick="return toggleReplaySticky(event);">Keep Replay at Top</button>
    </aside>
    <div class="replay-center-column">
      <div class="replay-battle-frame">
        <div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
      </div>
      <div class="replay-title-block">
        <span class="replay-title-line"><span class="subtle">You</span> vs. <span class="subtle">{safe_archetype}{html.escape(id_suffix)}</span></span>
        <div class="replay-result-line"><span class="replay-result-pill" style="color:{result_color};">{result_label}</span></div>
      </div>
    </div>
    <aside class="replay-side-panel replay-markers-panel">
      <div class="replay-side-heading">Replay Markers</div>
      <div class="replay-marker-nav">
        <button type="button" class="replay-marker-nav-button" onclick="return stepReplayMarker(-1);">Previous</button>
        <button type="button" class="replay-marker-nav-button" onclick="return stepReplayMarker(1);">Next</button>
      </div>
      <div class="replay-marker-list" id="coach-marker-list"></div>
      <div id="coach-marker-empty" class="coach-empty-state coach-marker-empty" style="display:none;"><strong>No replay markers found.</strong><br />This replay only produced the main critical turn.</div>
    </aside>
  </div>
</div>
</div>
<hr class="replay-shell-divider" />
<div class="coach-panel">
  <div class="coach-panel-header">
    <div>
      <div class="coach-panel-title">Coach Panel</div>
      <div class="coach-panel-subtitle">Fast replay summary. Advanced notes expand below.</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button type="button" class="coach-toggle" onclick="return toggleAdvancedCoaching(this);">Expand Advanced Coaching</button>
      <button type="button" class="section-collapse-button" id="coach-panel-collapse-button" onclick="return toggleSectionCollapse(event, 'coach-panel');"><span>Collapse Coach Panel</span><span class="section-collapse-chevron">▾</span></button>
    </div>
  </div>
  <div class="section-collapsible-body" id="coach-panel-body">
  <div class="coach-grid">
    <div class="coach-card"><div class="coach-label">Lead Verdict</div><div class="coach-value">{html.escape(str(coach['leadVerdict']))}</div></div>
    <div class="coach-card"><div class="coach-label">Win Path</div><div class="coach-value">{html.escape(str(coach['winPath']))}</div></div>
    <div class="coach-card"><div class="coach-label">Loss Cause</div><div class="coach-value">{html.escape(str(coach['lossCause']))}</div></div>
  </div>
  <div class="coach-grid-secondary">
    <div class="coach-card"><div class="coach-label">Critical Turn</div><div class="coach-value" id="coach-critical-turn"><a href="#" data-turn="{int(coach['criticalTurn'])}" onclick="return jumpReplayTurn(event, {int(coach['criticalTurn'])});">Turn {int(coach['criticalTurn'])}</a> — {html.escape(str(coach['criticalNote']))}</div></div>
    <div class="coach-card"><div class="coach-label">Next Adjustment</div><div class="coach-value" id="coach-next-adjustment">{html.escape(str(coach['nextAdjustment']))}</div></div>
  </div>
  <div id="coach-advanced" class="coach-advanced">
    <div class="coach-label" style="margin-bottom:8px;">Advanced Coaching</div>
    <div id="coach-advanced-empty" class="coach-empty-state" style="display:none;"><strong>No advanced coaching signals found.</strong><br />This replay still shows the core coaching summary above, but it did not produce deeper coaching tags.</div>
    <div class="coach-advanced-grid">
      <div class="coach-advanced-card" data-coach-section="threats">
        <div class="coach-advanced-title">Threats Faced</div>
        <ul id="coach-threats-list"></ul>
      </div>
      <div class="coach-advanced-card" data-coach-section="tempo">
        <div class="coach-advanced-title">Tempo Swings</div>
        <ul id="coach-tempo-list"></ul>
      </div>
      <div class="coach-advanced-card" data-coach-section="lead">
        <div class="coach-advanced-title">Lead Matchup</div>
        <div id="coach-lead-matchup-text" class="coach-advanced-text"></div>
      </div>
      <div class="coach-advanced-card" data-coach-section="control">
        <div class="coach-advanced-title">Control States</div>
        <ul id="coach-control-list"></ul>
      </div>
      <div class="coach-advanced-card" data-coach-section="board">
        <div class="coach-advanced-title">Board Control Swings</div>
        <ul id="coach-board-swings-list"></ul>
      </div>
      <div class="coach-advanced-card" data-coach-section="tags">
        <div class="coach-advanced-title">Turn Tags</div>
        <ul id="coach-turn-tags-list"></ul>
      </div>
      <div class="coach-advanced-card" data-coach-section="endgame">
        <div class="coach-advanced-title">Endgame State</div>
        <div id="coach-endgame-text" class="coach-advanced-text"></div>
      </div>
      <div class="coach-advanced-card" data-coach-section="adjustments">
        <div class="coach-advanced-title">Adjustment Notes</div>
        <ul id="coach-adjustments-list"></ul>
      </div>
    </div>
  </div>
</div>
</div>
<script id="coach-payload-data" type="application/json">{coach_payload_json}</script>
<hr class="replay-shell-divider" />
<script type="text/plain" class="battle-log-data">
{battle_log_data}

</script>
</div>
<div class="battle-log battle-log-inline"><div class="inner"><div class="battle-options"></div><div class="inner message-log">{bottom_html}</div><div class="inner-preempt message-log"></div></div></div>
<script>
var coachPayload = null;
var coachMarkers = [];
var activeMarkerIndex = -1;
var replayUiStateKey = 'aegisReplayUiState:v1:' + [window.location.pathname || '', document.title || ''].join('|');

function loadReplayUiState() {{
  try {{
    return JSON.parse(localStorage.getItem(replayUiStateKey) || '{{}}') || {{}};
  }} catch (e) {{
    return {{}};
  }}
}}

function saveReplayUiState(patch) {{
  try {{
    var next = Object.assign({{}}, loadReplayUiState(), patch || {{}});
    localStorage.setItem(replayUiStateKey, JSON.stringify(next));
    return next;
  }} catch (e) {{
    return patch || {{}};
  }}
}}

function getTurnCard(turn) {{
  return document.querySelector('.turn-card[data-turn-card="' + turn + '"]');
}}

function highlightTurnCard(turn) {{
  var card = getTurnCard(turn);
  if (!card) return;
  card.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
  card.classList.add('coach-turn-flash');
  setTimeout(function () {{ card.classList.remove('coach-turn-flash'); }}, 2200);
}}

function toggleReplayTeamSheets(button, forceOpen) {{
  try {{
    var panels = Array.prototype.slice.call(document.querySelectorAll('.pretty-log-team-sheet'));
    if (!panels.length) return false;
    var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panels.some(function(panel) {{ return !panel.classList.contains('open'); }});
    panels.forEach(function(panel) {{
      if (shouldOpen) panel.classList.add('open');
      else panel.classList.remove('open');
    }});
    if (button) button.textContent = shouldOpen ? 'Hide Full Exports' : 'Show Full Exports';
    saveReplayUiState({{ teamSheetsOpen: shouldOpen }});
  }} catch (e) {{}}
  return false;
}}

function copyReplayTeamExports(button) {{
  try {{
    var payload = button ? (button.getAttribute('data-copy-export') || '') : '';
    if (!payload) return false;
    var setCopiedState = function() {{
      if (!button) return;
      var original = button.getAttribute('data-default-label') || button.textContent || 'Copy Exports';
      button.textContent = 'Copied';
      setTimeout(function() {{ button.textContent = original; }}, 1600);
    }};
    if (navigator.clipboard && navigator.clipboard.writeText) {{
      navigator.clipboard.writeText(payload).then(setCopiedState).catch(function() {{}});
      return false;
    }}
    var textarea = document.createElement('textarea');
    textarea.value = payload;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    setCopiedState();
  }} catch (e) {{}}
  return false;
}}



var currentReplaySpeedKey = '1x';

function findReplayControlButtons() {{
  return Array.prototype.slice.call(document.querySelectorAll('.replay-controls button, .replay-controls input[type="button"], .replay-controls-2 button, .replay-controls-2 input[type="button"]'));
}}

function findReplayControlButton(pattern) {{
  var matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern), 'i');
  return findReplayControlButtons().find(function(node) {{
    var label = String(node.textContent || node.value || '').trim();
    return matcher.test(label);
  }}) || null;
}}

function syncReplayPlayState() {{
  var playButton = document.getElementById('custom-play-button');
  if (!playButton) return false;
  var nativePlay = findReplayControlButton(/play|pause/i);
  var label = String(nativePlay ? (nativePlay.textContent || nativePlay.value || '') : '').trim().toLowerCase();
  var isPlaying = /pause/.test(label);
  playButton.classList.toggle('is-live', isPlaying);
  playButton.classList.toggle('is-stopped', !isPlaying);
  playButton.textContent = 'Play';
  return isPlaying;
}}

function syncReplaySpeedState() {{
  document.querySelectorAll('.replay-speed-button').forEach(function(btn) {{
    btn.classList.toggle('is-active', btn.getAttribute('data-speed-key') === currentReplaySpeedKey);
  }});
}}

function triggerReplayControl(event, action) {{
  if (event) event.preventDefault();
  var nativeButton = null;
  if (action === 'reset') nativeButton = findReplayControlButton(/reset/i);
  else if (action === 'last') nativeButton = findReplayControlButton(/last turn/i);
  else if (action === 'next') nativeButton = findReplayControlButton(/next turn/i);
  else if (action === 'switch') nativeButton = findReplayControlButton(/switch sides/i);
  if (nativeButton) nativeButton.click();
  if (action === 'reset' || action === 'switch') window.setTimeout(syncReplayPlayState, 60);
  return false;
}}

function toggleReplayPlay(event) {{
  if (event) event.preventDefault();
  var nativeButton = findReplayControlButton(/play|pause/i);
  if (nativeButton) nativeButton.click();
  window.setTimeout(syncReplayPlayState, 60);
  return false;
}}

function setReplaySpeed(event, speedKey) {{
  if (event) event.preventDefault();
  var labelMap = {{
    '0.5x': /really\s*slow|slowest/i,
    '1x': /normal/i,
    '2x': /fast(?!.*hyper)/i,
    '4x': /hyper\s*fast|hyperfast|very\s*fast/i,
  }};
  var nativeButton = findReplayControlButton(labelMap[speedKey] || /normal/i);
  if (nativeButton) {{
    nativeButton.click();
    currentReplaySpeedKey = speedKey;
    syncReplaySpeedState();
    saveReplayUiState({{ replaySpeed: speedKey }});
  }}
  return false;
}}

function syncReplayStickyToggleState() {{
  var button = document.getElementById('replay-sticky-toggle');
  if (!button) return;
  var state = loadReplayUiState();
  var stickyOff = !!state.stickyDisabled;
  button.classList.toggle('is-off', stickyOff);
  button.textContent = stickyOff ? 'Sticky Disabled' : 'Keep Replay at Top';
}}

function toggleReplaySticky(event) {{
  if (event) event.preventDefault();
  var state = loadReplayUiState();
  var stickyOff = !state.stickyDisabled;
  saveReplayUiState({{ stickyDisabled: stickyOff }});
  syncReplayStickyToggleState();
  syncReplayShellSticky();
  syncReplayPanelHeights();
  setReplayMarkerHighlightForTurn(getCurrentReplayTurn());
  return false;
}}

function syncReplayShellSticky() {{
  var shell = document.getElementById('replay-stage-shell');
  var anchor = document.getElementById('replay-stage-anchor');
  var spacer = document.getElementById('replay-stage-spacer');
  if (!shell || !anchor || !spacer) return;
  var state = loadReplayUiState();
  var stickyOff = !!state.stickyDisabled;
  var desktop = window.innerWidth > 1100;
  if (!desktop || stickyOff) {{
    shell.classList.remove('replay-stage-shell--fixed', 'replay-stage-shell--compact');
    spacer.classList.remove('active');
    spacer.style.height = '0px';
    return;
  }}
  var anchorTop = anchor.getBoundingClientRect().top;
  var shouldFix = anchorTop <= 14;
  var shouldCompact = anchorTop <= -48;
  shell.classList.toggle('replay-stage-shell--fixed', shouldFix);
  shell.classList.toggle('replay-stage-shell--compact', shouldCompact);
  spacer.classList.toggle('active', shouldFix);
  spacer.style.height = shouldFix ? (shell.offsetHeight + 4) + 'px' : '0px';
}}

function syncReplayPanelHeights() {{
  var left = document.querySelector('.replay-controls-panel');
  var right = document.querySelector('.replay-markers-panel');
  var center = document.querySelector('.replay-center-column');
  if (!left || !right || !center) return;
  left.style.height = 'auto';
  right.style.height = 'auto';
  if (window.innerWidth <= 1100) return;
  var target = Math.min(center.offsetHeight, Math.max(left.scrollHeight, right.scrollHeight));
  if (target > 0) {{
    left.style.height = target + 'px';
    right.style.height = target + 'px';
  }}
}}

function initReplayShell() {{
  var state = loadReplayUiState();
  currentReplaySpeedKey = state.replaySpeed || '1x';
  syncReplaySpeedState();
  syncReplayPlayState();
  syncReplayStickyToggleState();
  syncReplayShellSticky();
  syncReplayPanelHeights();
  window.addEventListener('scroll', syncReplayShellSticky, {{ passive: true }});
  window.addEventListener('resize', function() {{ syncReplayShellSticky(); syncReplayPanelHeights(); }});
  window.addEventListener('load', function() {{ syncReplayPlayState(); syncReplayShellSticky(); syncReplayPanelHeights(); }});
  window.setInterval(function() {{ syncReplayPlayState(); syncReplayPanelHeights(); setReplayMarkerHighlightForTurn(getCurrentReplayTurn()); }}, 500);
}}

function safeParseReplayPayload(rawText) {{
  try {{
    var text = String(rawText == null ? '' : rawText).trim();
    if (!text) return {{}};
    if (text.indexOf('&quot;') !== -1 || text.indexOf('&#') !== -1) {{
      var decodeNode = document.createElement('textarea');
      decodeNode.innerHTML = text;
      text = decodeNode.value;
    }}
    try {{
      return JSON.parse(text);
    }} catch (directErr) {{
      var start = text.indexOf('{{');
      var end = text.lastIndexOf('}}');
      if (start !== -1 && end !== -1 && end >= start) {{
        return JSON.parse(text.slice(start, end + 1));
      }}
      throw directErr;
    }}
  }} catch (err) {{
    console.error('coach payload parse failed', err);
    return null;
  }}
}}




function refreshReplayEventFilterVisibility() {{
  try {{
    var root = document.querySelector('.pretty-log');
    if (!root) return;
    var selected = 'all';
    document.querySelectorAll('.coaching-filter-chip').forEach(function(btn) {{
      if (btn.classList.contains('active')) selected = String(btn.getAttribute('data-event-filter') || 'all').toLowerCase();
    }});
    document.querySelectorAll('.turn-card').forEach(function(card) {{
      var visibleCount = 0;
      Array.prototype.slice.call(card.querySelectorAll('.event-row')).forEach(function(row) {{
        var type = String(row.getAttribute('data-event-type') || '').toLowerCase();
        var show = selected === 'all' || type === selected;
        row.style.display = show ? 'flex' : 'none';
        if (show) visibleCount += 1;
      }});
      card.classList.toggle('has-visible-events', visibleCount > 0);
      card.style.display = visibleCount > 0 ? 'block' : 'none';
    }});
  }} catch (e) {{}}
}}

function setReplayEventFilter(event, filterName) {{
  if (event) event.preventDefault();
  try {{
    var root = document.querySelector('.pretty-log');
    if (!root) return false;
    var selected = filterName || 'all';
    ['filter-ko','filter-damage','filter-switch','filter-field','filter-ability','filter-boost','filter-status','filter-info'].forEach(function(cls) {{
      root.classList.remove(cls);
    }});
    if (selected && selected !== 'all') root.classList.add('filter-' + selected);
    document.querySelectorAll('.coaching-filter-chip').forEach(function(btn) {{
      btn.classList.toggle('active', btn.getAttribute('data-event-filter') === selected);
    }});
    refreshReplayEventFilterVisibility();
    saveReplayUiState({{ eventFilter: selected }});
  }} catch (e) {{}}
  return false;
}}

function jumpReplayTurn(event, turn) {{
  if (event) event.preventDefault();
  try {{
    turn = parseInt(turn, 10);
    var input = document.querySelector('.replay-controls input[type="text"]');
    var buttons = Array.from(document.querySelectorAll('.replay-controls button, .replay-controls input[type="button"]'));
    var button = buttons.find(function(node) {{ return /go to turn/i.test(node.textContent || node.value || ''); }});
    if (input) {{
      input.value = turn;
      input.dispatchEvent(new Event('input', {{ bubbles: true }}));
      input.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', bubbles: true }}));
      input.dispatchEvent(new KeyboardEvent('keyup', {{ key: 'Enter', bubbles: true }}));
      if (button) button.click();
    }}
    highlightTurnCard(turn);
  }} catch (err) {{
    console.error('jumpReplayTurn failed', err);
  }}
  return false;
}}

function setActiveMarker(index) {{
  if (!coachMarkers.length) return false;
  if (index < 0) index = coachMarkers.length - 1;
  if (index >= coachMarkers.length) index = 0;
  activeMarkerIndex = index;
  var marker = coachMarkers[index];
  document.querySelectorAll('.replay-marker-card').forEach(function(btn, idx) {{
    btn.classList.toggle('active', idx === index);
  }});
  return jumpReplayTurn(null, marker.turn);
}}

function stepReplayMarker(direction) {{
  if (!coachMarkers.length) return false;
  if (activeMarkerIndex === -1) {{
    return setActiveMarker(direction > 0 ? 0 : coachMarkers.length - 1);
  }}
  return setActiveMarker(activeMarkerIndex + direction);
}}

function escapeHtml(value) {{
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}}

function setReplayMarkerHighlightForTurn(turn) {{
  try {{
    var parsedTurn = parseInt(turn, 10);
    if (!Number.isFinite(parsedTurn)) return;
    var bestIndex = -1;
    coachMarkers.forEach(function(marker, index) {{
      if (parseInt(marker && marker.turn, 10) === parsedTurn) bestIndex = index;
    }});
    document.querySelectorAll('.replay-marker-card').forEach(function(btn, idx) {{
      btn.classList.toggle('is-active', idx === bestIndex);
    }});
    activeMarkerIndex = bestIndex;
  }} catch (e) {{}}
}}

function getCurrentReplayTurn() {{
  var candidates = Array.prototype.slice.call(document.querySelectorAll('.replay-controls, .replay-controls-2'));
  for (var i = 0; i < candidates.length; i += 1) {{
    var scope = candidates[i];
    var label = String(scope.textContent || '').replace(/\s+/g, ' ').trim();
    var match = label.match(/Turn\s+(\d+)/i);
    if (match) return parseInt(match[1], 10);
  }}
  var battle = document.querySelector('.battle');
  if (battle) {{
    var battleText = String(battle.textContent || '').replace(/\s+/g, ' ').trim();
    var battleMatch = battleText.match(/Turn\s+(\d+)/i);
    if (battleMatch) return parseInt(battleMatch[1], 10);
  }}
  return null;
}}

function renderCoachMarkers(payload) {{
  var list = document.getElementById('coach-marker-list');
  var empty = document.getElementById('coach-marker-empty');
  if (!list) return;
  coachMarkers = Array.isArray(payload && payload.criticalTurns) ? payload.criticalTurns.filter(function(marker) {{
    return marker && Number.isFinite(parseInt(marker.turn, 10));
  }}).slice(0, 3) : [];
  if (!coachMarkers.length && payload && Number.isFinite(parseInt(payload.criticalTurn, 10))) {{
    coachMarkers = [{{ turn: parseInt(payload.criticalTurn, 10), label: payload.criticalNote || 'Critical turn', kind: 'critical' }}];
  }}
  list.innerHTML = '';
  if (empty) empty.style.display = coachMarkers.length ? 'none' : 'block';
  coachMarkers.forEach(function(marker, index) {{
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'replay-marker-card';
    btn.innerHTML = '<span class="coach-marker-turn">Turn ' + marker.turn + '</span><span class="coach-marker-label">' + escapeHtml(marker.label || 'Marker') + '</span>';
    btn.addEventListener('click', function() {{ setActiveMarker(index); }});
    list.appendChild(btn);
  }});
  setReplayMarkerHighlightForTurn(getCurrentReplayTurn());
}}

function renderAdvancedCoaching(payload) {{
  if (!payload) return;

  var sectionHasContent = function(items) {{
    return Array.isArray(items) && items.some(function(item) {{
      return String(item || '').trim();
    }});
  }};

  var setSectionVisible = function(sectionKey, visible) {{
    var card = document.querySelector('.coach-advanced-card[data-coach-section="' + sectionKey + '"]');
    if (!card) return;
    card.style.display = visible ? '' : 'none';
  }};

  var renderList = function(id, items, sectionKey) {{
    var node = document.getElementById(id);
    if (!node) return false;
    var safeItems = (Array.isArray(items) ? items : []).map(function(item) {{
      return String(item || '').trim();
    }}).filter(Boolean);
    node.innerHTML = safeItems.map(function(item) {{
      return '<li>' + escapeHtml(item) + '</li>';
    }}).join('');
    var visible = safeItems.length > 0;
    if (sectionKey) setSectionVisible(sectionKey, visible);
    return visible;
  }};

  var renderText = function(id, value, sectionKey) {{
    var node = document.getElementById(id);
    if (!node) return false;
    var text = String(value || '').trim();
    node.textContent = text;
    var visible = !!text;
    if (sectionKey) setSectionVisible(sectionKey, visible);
    return visible;
  }};

  renderList('coach-threats-list', payload.threatsFaced, 'threats');
  renderList('coach-tempo-list', payload.tempoSwings, 'tempo');
  renderList('coach-adjustments-list', payload.adjustmentNotes, 'adjustments');

  var controlItems = [];
  if (payload.speedControlState) controlItems.push(payload.speedControlState);
  if (payload.trickRoomState) controlItems.push(payload.trickRoomState);
  if (payload.firstKO && payload.firstKO.summary) controlItems.push('First KO: ' + payload.firstKO.summary + ' (Turn ' + payload.firstKO.turn + ')');
  if (Array.isArray(payload.pivotTurns) && payload.pivotTurns.length) controlItems.push('Pivot turns: ' + payload.pivotTurns.join(', '));
  if (payload.endgameAdvantage) controlItems.push('Endgame edge: ' + payload.endgameAdvantage);
  renderList('coach-control-list', controlItems, 'control');

  var boardSwings = Array.isArray(payload.boardControlSwings) ? payload.boardControlSwings.map(function(item) {{
    var turn = parseInt(item && item.turn, 10);
    var prefix = Number.isFinite(turn) ? 'Turn ' + turn + ': ' : '';
    return prefix + (item && item.summary ? item.summary : 'Board control shifted.');
  }}) : [];
  renderList('coach-board-swings-list', boardSwings, 'board');

  var formatTag = function(tag) {{
    return String(tag || '').split('-').map(function(part) {{
      return part ? part.charAt(0).toUpperCase() + part.slice(1) : '';
    }}).join(' ');
  }};
  var tagItems = Array.isArray(payload.turnTags) ? payload.turnTags.map(function(item) {{
    var turn = parseInt(item && item.turn, 10);
    var tags = Array.isArray(item && item.tags) ? item.tags : [];
    if (!Number.isFinite(turn) || !tags.length) return null;
    return 'Turn ' + turn + ': ' + tags.map(formatTag).join(', ');
  }}).filter(Boolean) : [];
  renderList('coach-turn-tags-list', tagItems, 'tags');

  renderText('coach-lead-matchup-text', payload.leadMatchup || payload.leadVerdict || '', 'lead');
  renderText('coach-endgame-text', payload.endgameState || '', 'endgame');

  var anyVisible = Array.prototype.some.call(document.querySelectorAll('.coach-advanced-card[data-coach-section]'), function(card) {{
    return card.style.display !== 'none';
  }});
  var advanced = document.getElementById('coach-advanced');
  var advancedEmpty = document.getElementById('coach-advanced-empty');
  if (advancedEmpty) advancedEmpty.style.display = anyVisible ? 'none' : 'block';
  if (advanced) advanced.style.display = '';
}}


function setCoachingView(event, view) {{
  if (event) event.preventDefault();
  var log = document.querySelector('.pretty-log');
  if (!log) return false;
  var coaching = view === 'coaching';
  log.classList.toggle('coaching-view', coaching);
  document.querySelectorAll('.coaching-view-button').forEach(function(btn) {{
    btn.classList.toggle('active', btn.getAttribute('data-coaching-view') === view);
  }});
  refreshReplayEventFilterVisibility();
  saveReplayUiState({{ coachingView: coaching ? 'coaching' : 'standard' }});
  return false;
}}

function toggleAdvancedCoaching(button, forceOpen) {{
  try {{
    var panel = document.getElementById('coach-advanced');
    var targetButton = button || document.querySelector('.coach-toggle');
    if (!panel) return false;
    var open = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    if (targetButton) {{
      targetButton.textContent = open ? 'Hide Advanced Coaching' : 'Expand Advanced Coaching';
      targetButton.classList.toggle('is-open', open);
    }}
    saveReplayUiState({{ advancedOpen: open }});
  }} catch (e) {{}}
  return false;
}}

function applySectionCollapsedState(sectionKey, collapsed) {{
  var body = document.getElementById(sectionKey + '-body');
  var button = document.getElementById(sectionKey + '-collapse-button');
  if (!body || !button) return false;
  body.classList.toggle('is-collapsed', !!collapsed);
  button.classList.toggle('is-collapsed', !!collapsed);
  var label = button.querySelector('span');
  if (label) label.textContent = collapsed ? ('Expand ' + (sectionKey === 'coach-panel' ? 'Coach Panel' : 'Battle Log')) : ('Collapse ' + (sectionKey === 'coach-panel' ? 'Coach Panel' : 'Battle Log'));
  return false;
}}

function toggleSectionCollapse(event, sectionKey) {{
  if (event) event.preventDefault();
  var state = loadReplayUiState();
  var key = sectionKey === 'coach-panel' ? 'coachPanelCollapsed' : 'battleLogCollapsed';
  var collapsed = !state[key];
  saveReplayUiState({{ [key]: collapsed }});
  applySectionCollapsedState(sectionKey, collapsed);
  return false;
}}

function initCoachPanel() {{
  var node = document.getElementById('coach-payload-data');
  if (!node) return;
  coachPayload = safeParseReplayPayload(node.textContent || '{{}}');
  if (!coachPayload || typeof coachPayload !== 'object') return;
  renderCoachMarkers(coachPayload);
  renderAdvancedCoaching(coachPayload);
  refreshReplayEventFilterVisibility();
  var state = loadReplayUiState();
  setCoachingView(null, state.coachingView === 'coaching' ? 'coaching' : 'standard');
  setReplayEventFilter(null, state.eventFilter || 'all');
  var teamButton = document.querySelector('.pretty-log-team-toggle');
  if (state.teamSheetsOpen) toggleReplayTeamSheets(teamButton, true);
  else if (teamButton) teamButton.textContent = 'Show Full Exports';
  var advancedButton = document.querySelector('.coach-toggle');
  if (state.advancedOpen) toggleAdvancedCoaching(advancedButton, true);
  else {{
    var advancedPanel = document.getElementById('coach-advanced');
    if (advancedPanel) advancedPanel.classList.remove('open');
    if (advancedButton) {{
      advancedButton.textContent = 'Expand Advanced Coaching';
      advancedButton.classList.remove('is-open');
    }}
  }}
  applySectionCollapsedState('coach-panel', !!state.coachPanelCollapsed);
  applySectionCollapsedState('battle-log', !!state.battleLogCollapsed);
}}

initCoachPanel();
initReplayShell();
let daily = Math.floor(Date.now()/1000/60/60/24);document.write('<script src="https://play.pokemonshowdown.com/js/replay-embed.js?version='+daily+'"><'+'/script>');
</script>
'''
