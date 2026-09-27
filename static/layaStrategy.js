// layaStrategy.js — Laya picks the next ACTION (Tetris/Dino pattern), not a "style"

export const ACTIONS = [
    'approach',
    'retreat',
    'jab',
    'special',
    'block',
    'jump',
    'wait',
];

const LAYA_URL = 'http://127.0.0.1:8765/decide';
// Inference on a 2060 is often >700ms — old timeout aborted every call → forever yellow LOCAL.
const POLL_MS = 1200;
const FETCH_TIMEOUT_MS = 5000;
const FAIL_BEFORE_LOCAL = 3;

let currentAction = 'wait';
let layaConnected = false;
let pollTimer = null;
let inFlight = false;
let player_one = null;
let player_two = null;
let started = false;
let lastActionAt = 0;
let consecutiveFails = 0;

export function packState(p1, p2) {
    const dx = p1.position.x - p2.position.x;
    const absDx = Math.abs(dx);
    let band = 'very far';
    if (absDx < 120) band = 'close (melee range)';
    else if (absDx < 180) band = 'near';
    else if (absDx < 300) band = 'mid';
    else if (absDx < 450) band = 'far';

    const playerBlocking = !!p1.blocking;
    const playerSwinging = !!(p1.melee || p1.combo);
    const meterReady = p2.power_c >= 100;

    return [
        'Arcade 1v1 fighting game. Choose ONE next action for the bot.',
        `Bot HP ${Math.round(p2.health)}, player HP ${Math.round(p1.health)}.`,
        `Distance: ${band} (${Math.round(absDx)} px).`,
        `Player is blocking: ${playerBlocking ? 'YES — do not jab or special into the shield; wait or retreat' : 'no'}.`,
        `Player is attacking: ${playerSwinging ? 'YES — prefer block' : 'no'}.`,
        `Bot special meter ready: ${meterReady ? 'yes' : 'no'}.`,
        `Bot airborne: ${p2.isAirborne() ? 'yes' : 'no'}.`,
        `Last action was: ${currentAction}.`,
        playerBlocking && absDx < 180
            ? 'CRITICAL: Player shield is up in your face. Pick wait or retreat. Not jab. Not approach into block.'
            : '',
        !playerBlocking && absDx < 150
            ? 'Player is open in melee range — jab or special if meter ready is fine.'
            : '',
        absDx > 200 && !playerSwinging ? 'You are far — approach is reasonable.' : '',
    ]
        .filter(Boolean)
        .join(' ');
}

export function getBotAction() {
    return currentAction;
}

export function isLayaConnected() {
    return layaConnected;
}

export function updateStrategyHud() {
    const el = document.getElementById('bot_strategy_hud');
    if (!el) return;
    const classic =
        typeof window !== 'undefined' &&
        (window.LAYA_BOT === 0 ||
            window.LAYA_BOT === '0' ||
            new URLSearchParams(window.location.search).get('classicBot') === '1');
    if (classic) {
        el.textContent = 'BOT: CLASSIC';
        el.dataset.source = 'classic';
        return;
    }
    const label = currentAction.toUpperCase();
    el.textContent = layaConnected ? `BOT: ${label}` : `BOT: ${label} (LOCAL)`;
    el.dataset.source = layaConnected ? 'laya' : 'local';
    el.dataset.action = currentAction;
}

/** Simple local brain when sidecar is down — still respects blocking. */
export function pickLocalAction(p1, p2) {
    if (!p1 || !p2) return 'wait';
    const absDx = Math.abs(p1.position.x - p2.position.x);
    const swinging = p1.melee || p1.combo;
    const blocking = p1.blocking;

    if (swinging && absDx < 190) return 'block';
    if (blocking && absDx < 180) return Math.random() < 0.55 ? 'wait' : 'retreat';
    if (p2.health < 28 && absDx < 220) return 'retreat';
    if (absDx > 160) return 'approach';
    if (p2.power_c >= 100 && !blocking && absDx < 160) return 'special';
    if (!blocking && absDx < 150) return 'jab';
    return 'wait';
}

function setAction(action, fromLaya) {
    if (!ACTIONS.includes(action)) return;
    currentAction = action;
    lastActionAt = Date.now();
    if (fromLaya) layaConnected = true;
    updateStrategyHud();
}

async function requestLayaDecision() {
    if (inFlight || !player_one || !player_two) return;
    if (typeof window !== 'undefined' && (window.LAYA_BOT === 0 || window.LAYA_BOT === '0')) {
        return;
    }

    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const state = packState(player_one, player_two);
        const res = await fetch(LAYA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const action =
            data.action ||
            data.answers?.action?.choice ||
            null;
        if (ACTIONS.includes(action)) {
            consecutiveFails = 0;
            setAction(action, true);
        } else {
            throw new Error('bad action payload');
        }
    } catch {
        consecutiveFails += 1;
        // Keep last Laya action through brief slowdowns; only drop to LOCAL after repeated fails.
        if (consecutiveFails >= FAIL_BEFORE_LOCAL) {
            layaConnected = false;
            setAction(pickLocalAction(player_one, player_two), false);
        }
    } finally {
        clearTimeout(timeout);
        inFlight = false;
    }
}

export function startLayaStrategy(p1, p2) {
    if (started) return;
    started = true;
    player_one = p1;
    player_two = p2;
    updateStrategyHud();

    const classic =
        typeof window !== 'undefined' &&
        (window.LAYA_BOT === 0 ||
            window.LAYA_BOT === '0' ||
            new URLSearchParams(window.location.search).get('classicBot') === '1');
    if (classic) {
        updateStrategyHud();
        return;
    }

    requestLayaDecision();
    pollTimer = setInterval(requestLayaDecision, POLL_MS);
}

export function stopLayaStrategy() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    started = false;
    inFlight = false;
}

// Back-compat names used by older bot.js imports during transition
export const STYLES = ACTIONS;
export function getBotStyle() {
    return currentAction;
}
export function getBotIntent() {
    return {};
}
