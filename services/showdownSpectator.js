let WebSocketImpl = globalThis.WebSocket;
try {
  // eslint-disable-next-line global-require
  WebSocketImpl = require('ws');
} catch (error) {
  if (!WebSocketImpl) WebSocketImpl = null;
}

const SHOWDOWN_SOCKET_URLS = [
  'wss://sim3.psim.us/showdown/websocket',
  'wss://sim.smogon.com/showdown/websocket',
  'ws://sim.smogon.com:8000/showdown/websocket',
];

const activeSessions = new Map();

function toShowdownId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseShowdownBattleLink(link) {
  const raw = String(link || '').trim();
  if (!raw) throw new Error('Showdown battle link is required.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('That battle link is not a valid URL.');
  }
  const host = String(parsed.hostname || '').toLowerCase();
  if (!host.includes('pokemonshowdown.com')) {
    throw new Error('Please paste a live Pokémon Showdown battle link.');
  }
  const path = String(parsed.pathname || '').replace(/^\/+/, '');
  const roomId = path.startsWith('battle-') ? path : path.split('/').find((part) => part.startsWith('battle-'));
  if (!roomId) throw new Error('Professor Aegis could not find a live battle room ID in that link.');
  return { url: `${parsed.origin}/${roomId}`, roomId };
}

function parseRoomPayload(message) {
  const text = String(message || '');
  const payloads = [];
  let roomId = '';
  const lines = text.split('\n');
  if (lines[0]?.startsWith('>')) {
    roomId = lines.shift().slice(1).trim();
  }
  for (const line of lines) {
    if (!line) continue;
    payloads.push({ roomId, line });
  }
  return payloads;
}

function attachWsListener(socket, eventName, handler) {
  if (typeof socket.on === 'function') {
    socket.on(eventName, handler);
    return;
  }
  socket[`on${eventName}`] = handler;
}

function cleanBattleName(raw) {
  const value = String(raw || '');
  const idx = value.indexOf(':');
  return idx >= 0 ? value.slice(idx + 1).trim() : value.trim();
}

function parseHpPercent(hpText) {
  const raw = String(hpText || '').trim();
  if (!raw) return null;
  if (raw.includes('fnt')) return 0;
  const hpPart = raw.split(' ')[0];
  if (hpPart.endsWith('%')) {
    const numeric = Number(hpPart.replace('%', ''));
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : null;
  }
  const [current, total] = hpPart.split('/').map(Number);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function describeDelta(delta) {
  const abs = Math.abs(delta);
  if (abs >= 70) return 'massive';
  if (abs >= 40) return 'heavy';
  if (abs >= 20) return 'solid';
  if (abs >= 10) return 'light';
  return 'minor';
}

function createSessionState({ battleId, gameId, roomId, showdownLinkUrl }) {
  return {
    battleId,
    gameId,
    roomId,
    showdownLinkUrl,
    connected: false,
    handshakeSeen: false,
    joinSent: false,
    joined: false,
    completed: false,
    closed: false,
    websocket: null,
    readyTimeout: null,
    updateTimer: null,
    endpointIndex: 0,
    endpointUrl: null,
    challengerShowdownName: null,
    opponentShowdownName: null,
    detectedFormat: null,
    winnerShowdownName: null,
    lastReplayUrl: null,
    lastRawLine: null,
    hpBySlot: new Map(),
    fullHistoryLines: [],
    currentTurn: 0,
    currentTurnEvents: [],
    previewLines: [],
    lastEmittedPreview: '',
  };
}

function queueReadableLine(session, line, { preview = false } = {}) {
  if (!line) return;
  session.fullHistoryLines.push(line);
  if (preview) {
    session.previewLines.push(line);
    if (session.previewLines.length > 18) {
      session.previewLines = session.previewLines.slice(-18);
    }
  }
}

function pushTurnEvent(session, line) {
  if (!line) return;
  const last = session.currentTurnEvents[session.currentTurnEvents.length - 1];
  if (last === line) return;
  session.currentTurnEvents.push(line);
}

function flushTurnSummary(session) {
  if (!session.currentTurn || !session.currentTurnEvents.length) return false;
  queueReadableLine(session, `Turn ${session.currentTurn}`, { preview: true });
  for (const event of session.currentTurnEvents) {
    queueReadableLine(session, `• ${event}`, { preview: true });
  }
  session.currentTurnEvents = [];
  return true;
}

function captureBattleEvent(session, line) {
  const parts = String(line || '').split('|');
  const tag = parts[1] || '';

  if (tag === 'turn') {
    const changed = flushTurnSummary(session);
    session.currentTurn = Number(parts[2] || 0) || session.currentTurn;
    return changed;
  }
  if (tag === 'move') {
    const actor = cleanBattleName(parts[2]);
    const move = parts[3] || 'Unknown Move';
    if (actor) pushTurnEvent(session, `${actor} used ${move}.`);
    return false;
  }
  if (tag === 'switch' || tag === 'drag') {
    const actor = cleanBattleName(parts[2]);
    if (actor) pushTurnEvent(session, `${actor} entered the field.`);
    return false;
  }
  if (tag === 'faint') {
    const actor = cleanBattleName(parts[2]);
    if (actor) pushTurnEvent(session, `${actor} fainted.`);
    return false;
  }
  if (tag === '-terastallize') {
    const actor = cleanBattleName(parts[2]);
    const teraType = parts[3] || 'Unknown';
    if (actor) pushTurnEvent(session, `${actor} Terastallized into ${teraType}.`);
    return false;
  }
  if (tag === '-weather') {
    const weather = parts[2] || 'Unknown weather';
    pushTurnEvent(session, `Weather shifted to ${weather}.`);
    return false;
  }
  if (tag === '-fieldstart') {
    pushTurnEvent(session, `Field effect started: ${parts[2] || 'Unknown effect'}.`);
    return false;
  }
  if (tag === '-fieldend') {
    pushTurnEvent(session, `Field effect ended: ${parts[2] || 'Unknown effect'}.`);
    return false;
  }
  if (tag === '-sidestart') {
    pushTurnEvent(session, `Side effect started: ${parts[3] || 'Unknown effect'}.`);
    return false;
  }
  if (tag === '-sideend') {
    pushTurnEvent(session, `Side effect ended: ${parts[3] || 'Unknown effect'}.`);
    return false;
  }
  if (tag === '-status') {
    const actor = cleanBattleName(parts[2]);
    const status = parts[3] || 'status';
    if (actor) pushTurnEvent(session, `${actor} was afflicted with ${status}.`);
    return false;
  }
  if (tag === '-curestatus') {
    const actor = cleanBattleName(parts[2]);
    const status = parts[3] || 'status';
    if (actor) pushTurnEvent(session, `${actor} recovered from ${status}.`);
    return false;
  }
  if (tag === '-damage' || tag === '-heal') {
    const slot = parts[2] || '';
    const actor = cleanBattleName(slot);
    const hpText = parts[3] || '';
    const nextPercent = parseHpPercent(hpText);
    const previousPercent = session.hpBySlot.get(slot);
    if (nextPercent !== null) session.hpBySlot.set(slot, nextPercent);
    if (actor && nextPercent !== null && previousPercent !== undefined && previousPercent !== null) {
      const delta = nextPercent - previousPercent;
      if (tag === '-damage' && delta < 0) {
        pushTurnEvent(session, `${actor} took ${Math.abs(delta)}% damage (${describeDelta(delta)}).`);
      } else if (tag === '-heal' && delta > 0) {
        pushTurnEvent(session, `${actor} recovered ${delta}% HP.`);
      }
    }
    return false;
  }
  if (tag === 'win') {
    session.winnerShowdownName = parts[2] || null;
    const changed = flushTurnSummary(session);
    if (session.winnerShowdownName) {
      queueReadableLine(session, `Winner: ${session.winnerShowdownName}`, { preview: true });
    }
    return changed || true;
  }
  return false;
}

function stopSpectatorSession(gameId, reason = 'manual stop') {
  const session = activeSessions.get(String(gameId));
  if (!session) return;
  activeSessions.delete(String(gameId));
  session.closed = true;
  if (session.readyTimeout) clearTimeout(session.readyTimeout);
  if (session.updateTimer) clearTimeout(session.updateTimer);
  if (session.websocket && session.websocket.readyState <= 1) {
    try {
      session.websocket.close(1000, reason);
    } catch {}
  }
}

function getActiveSpectatorSession(gameId) {
  return activeSessions.get(String(gameId)) || null;
}

function extractReplayUrlFromLine(line) {
  const match = String(line || '').match(/https?:\/\/replay\.pokemonshowdown\.com\/[\w-]+/i);
  return match ? match[0] : null;
}

function sendJoinRequest(session) {
  if (session.closed || !session.websocket || session.joinSent || session.joined) return;
  session.websocket.send(`|/join ${session.roomId}`);
  session.joinSent = true;
}

function scheduleUpdate(session, extra = {}, onUpdate) {
  if (typeof onUpdate !== 'function' || session.closed || session.completed) return;
  const previewText = session.previewLines.join('\n');
  const force = Boolean(extra.force);
  if (!force && previewText === session.lastEmittedPreview && !extra.replayUrl) return;
  if (session.updateTimer) clearTimeout(session.updateTimer);
  session.updateTimer = setTimeout(async () => {
    session.updateTimer = null;
    session.lastEmittedPreview = previewText;
    await onUpdate({
      battleId: session.battleId,
      gameId: session.gameId,
      roomId: session.roomId,
      showdownLinkUrl: session.showdownLinkUrl,
      detectedFormat: session.detectedFormat,
      challengerShowdownName: session.challengerShowdownName,
      opponentShowdownName: session.opponentShowdownName,
      battleLogText: session.fullHistoryLines.join('\n'),
      replayUrl: session.lastReplayUrl || undefined,
      previewText,
      previewChanged: true,
      turnNumber: session.currentTurn || null,
      ...extra,
    });
  }, force ? 0 : 700);
}

function startSpectatorSession({ battleId, gameId, showdownLinkUrl, roomId, onConnected, onUpdate, onCompleted, onError }) {
  if (!WebSocketImpl) {
    throw new Error('No WebSocket implementation is available. Install the ws package for live spectating.');
  }

  stopSpectatorSession(gameId, 'restart');
  const session = createSessionState({ battleId, gameId, roomId, showdownLinkUrl });
  activeSessions.set(String(gameId), session);

  async function finalizeComplete() {
    if (session.completed || session.closed) return;
    session.completed = true;
    activeSessions.delete(String(gameId));
    if (session.readyTimeout) clearTimeout(session.readyTimeout);
    if (session.updateTimer) clearTimeout(session.updateTimer);
    if (typeof onCompleted === 'function') {
      await onCompleted({
        battleId,
        gameId,
        roomId,
        showdownLinkUrl,
        winnerShowdownName: session.winnerShowdownName,
        challengerShowdownName: session.challengerShowdownName,
        opponentShowdownName: session.opponentShowdownName,
        detectedFormat: session.detectedFormat,
        battleLogText: session.fullHistoryLines.join('\n'),
        replayUrl: session.lastReplayUrl || null,
      });
    }
    try { session.websocket?.close(1000, 'battle complete'); } catch {}
  }

  async function finalizeError(message) {
    if (session.closed || session.completed) return;
    activeSessions.delete(String(gameId));
    session.closed = true;
    if (session.readyTimeout) clearTimeout(session.readyTimeout);
    if (session.updateTimer) clearTimeout(session.updateTimer);
    if (typeof onError === 'function') {
      await onError({
        battleId,
        gameId,
        roomId,
        showdownLinkUrl,
        error: message,
        battleLogText: session.fullHistoryLines.join('\n'),
      });
    }
    try { session.websocket?.close(1011, String(message).slice(0, 120)); } catch {}
  }

  function connectAtIndex(endpointIndex) {
    const endpointUrl = SHOWDOWN_SOCKET_URLS[endpointIndex];
    if (!endpointUrl) {
      finalizeError('Professor Aegis could not connect to Pokémon Showdown live spectating.').catch(() => null);
      return;
    }

    session.endpointIndex = endpointIndex;
    session.endpointUrl = endpointUrl;
    session.handshakeSeen = false;
    session.joinSent = false;
    session.joined = false;

    const websocket = new WebSocketImpl(endpointUrl, {
      headers: {
        Origin: 'https://play.pokemonshowdown.com',
        'User-Agent': 'ProfessorAegis/1.0',
      },
      perMessageDeflate: false,
    });
    session.websocket = websocket;

    const tryFallback = (reason) => {
      if (session.closed || session.completed) return;
      console.error(`[Showdown Spectator] ${reason} | game=${gameId} room=${roomId} endpoint=${endpointUrl}`);
      try { websocket.close(); } catch {}
      connectAtIndex(endpointIndex + 1);
    };

    attachWsListener(websocket, 'open', () => {
      session.connected = true;
      if (session.readyTimeout) clearTimeout(session.readyTimeout);
      session.readyTimeout = setTimeout(() => {
        if (!session.joined) {
          tryFallback(`Join timed out before battle room initialization. handshake=${session.handshakeSeen} joinSent=${session.joinSent}`);
        }
      }, 15000);
    });

    attachWsListener(websocket, 'error', (event) => {
      const detail = event?.message || event?.error?.message || 'socket error';
      if (endpointIndex + 1 < SHOWDOWN_SOCKET_URLS.length) {
        tryFallback(`WebSocket error: ${detail}`);
        return;
      }
      finalizeError(`Professor Aegis could not connect to Pokémon Showdown live spectating. (${detail})`).catch(() => null);
    });

    attachWsListener(websocket, 'close', (code, reasonBuffer) => {
      const reason = typeof reasonBuffer === 'string' ? reasonBuffer : reasonBuffer?.toString?.() || '';
      if (!session.completed && !session.closed) {
        if (!session.joined && endpointIndex + 1 < SHOWDOWN_SOCKET_URLS.length) {
          tryFallback(`Socket closed before joining. code=${code} reason=${reason || 'none'}`);
          return;
        }
        finalizeError(`The live spectator connection closed before the battle finished. (code ${code}${reason ? `, ${reason}` : ''})`).catch(() => null);
      }
    });

    attachWsListener(websocket, 'unexpected-response', (_req, res) => {
      if (endpointIndex + 1 < SHOWDOWN_SOCKET_URLS.length) {
        tryFallback(`Unexpected HTTP response: ${res?.statusCode || 'unknown'}`);
        return;
      }
      finalizeError(`Professor Aegis could not connect to Pokémon Showdown live spectating. (HTTP ${res?.statusCode || 'unknown'})`).catch(() => null);
    });

    attachWsListener(websocket, 'message', async (event) => {
      const raw = typeof event === 'string'
        ? event
        : typeof event?.data === 'string'
          ? event.data
          : event?.toString?.('utf8') || event?.data?.toString?.('utf8') || '';
      const payloads = parseRoomPayload(raw);
      for (const { roomId: payloadRoomId, line } of payloads) {
        if (line.startsWith('|challstr|') || line.startsWith('|updateuser|')) {
          session.handshakeSeen = true;
          if (!session.joinSent) {
            try {
              sendJoinRequest(session);
            } catch (error) {
              await finalizeError(`Failed to join the live Showdown room. (${error?.message || error})`);
              return;
            }
          }
          continue;
        }
        if (payloadRoomId && payloadRoomId !== roomId) continue;

        if (!session.joined && payloadRoomId === roomId && (line.startsWith('|init|battle') || line.startsWith('|title|') || line.startsWith('|player|'))) {
          session.joined = true;
          if (typeof onConnected === 'function') {
            await onConnected({ battleId, gameId, roomId, showdownLinkUrl });
          }
        }

        if (!session.joined) continue;
        if (line === session.lastRawLine) continue;
        session.lastRawLine = line;

        if (line.startsWith('|player|p1|')) {
          session.challengerShowdownName = line.split('|')[3] || session.challengerShowdownName;
        } else if (line.startsWith('|player|p2|')) {
          session.opponentShowdownName = line.split('|')[3] || session.opponentShowdownName;
        } else if (line.startsWith('|tier|')) {
          session.detectedFormat = line.split('|')[2] || session.detectedFormat;
        } else if (line.startsWith('|win|')) {
          session.winnerShowdownName = line.split('|')[2] || null;
        } else if (line.startsWith('|tie')) {
          await finalizeError('The live battle ended in a tie. Use an admin override for this game.');
          return;
        }

        const replayUrl = extractReplayUrlFromLine(line);
        if (replayUrl) {
          session.lastReplayUrl = replayUrl;
        }

        const previewChanged = captureBattleEvent(session, line);
        if (previewChanged || replayUrl || line.startsWith('|player|') || line.startsWith('|tier|')) {
          scheduleUpdate(session, { replayUrl: replayUrl || undefined }, onUpdate);
        }

        if (line.startsWith('|win|')) {
          scheduleUpdate(session, { force: true, replayUrl: replayUrl || undefined }, onUpdate);
          if (session.updateTimer) {
            clearTimeout(session.updateTimer);
            session.updateTimer = null;
          }
          await finalizeComplete();
          return;
        }
      }
    });
  }

  connectAtIndex(0);
  return session;
}

module.exports = {
  SHOWDOWN_SOCKET_URLS,
  toShowdownId,
  parseShowdownBattleLink,
  startSpectatorSession,
  stopSpectatorSession,
  getActiveSpectatorSession,
};
