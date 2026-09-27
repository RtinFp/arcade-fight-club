// bot.js — thin executor: apply Laya's (or local) ACTION until the next decision
import { gameState, flat_point } from './core.js';
import { playerActions } from './input.js';
import {
    getBotAction,
    isLayaConnected,
    ACTIONS,
} from './layaStrategy.js';

let player_one, player_two;
let jumpPulse = false;

const ATTACK_RANGE = 150;

export function setBotReferences(p1, p2) {
    player_one = p1;
    player_two = p2;
}

export function useClassicBot() {
    if (typeof window === 'undefined') return false;
    if (window.LAYA_BOT === 0 || window.LAYA_BOT === '0' || window.LAYA_BOT === false) {
        return true;
    }
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('classicBot') === '1') return true;
    } catch {
        /* ignore */
    }
    return false;
}

function clearBotActions() {
    playerActions.player_two.left = false;
    playerActions.player_two.right = false;
    playerActions.player_two.jump = false;
    playerActions.player_two.melee = false;
    playerActions.player_two.special = false;
    playerActions.player_two.block = false;
}

function faceAndWalk(dx, toward) {
    const goRight = toward ? dx > 0 : dx < 0;
    if (goRight) {
        player_two.facing = 1;
        playerActions.player_two.right = true;
        playerActions.player_two.left = false;
    } else {
        player_two.facing = -1;
        playerActions.player_two.left = true;
        playerActions.player_two.right = false;
    }
}

function hold(dx) {
    playerActions.player_two.left = false;
    playerActions.player_two.right = false;
    player_two.facing = dx >= 0 ? 1 : -1;
}

/**
 * Safety net: even if the model says "jab", do not swing into an active block.
 * This is the thing that should have existed from day one.
 */
function sanitizeAction(action, absDx) {
    const playerBlocking = !!player_one.blocking;
    const playerSwinging = !!(player_one.melee || player_one.combo);

    if (playerSwinging && absDx < ATTACK_RANGE + 40) return 'block';
    if (playerBlocking && absDx < ATTACK_RANGE + 30) {
        if (action === 'jab' || action === 'special' || action === 'approach') {
            return Math.random() < 0.5 ? 'wait' : 'retreat';
        }
    }
    return action;
}

function applyAction(action) {
    const dx = player_one.position.x - player_two.position.x;
    const absDx = Math.abs(dx);
    action = sanitizeAction(action, absDx);

    clearBotActions();

    switch (action) {
        case 'approach':
            if (absDx > 40) faceAndWalk(dx, true);
            else hold(dx);
            break;
        case 'retreat':
            faceAndWalk(dx, false);
            break;
        case 'jab':
            hold(dx);
            if (absDx < ATTACK_RANGE && player_two.canMelee()) {
                playerActions.player_two.melee = true;
            } else if (absDx >= ATTACK_RANGE) {
                faceAndWalk(dx, true);
            }
            break;
        case 'special':
            hold(dx);
            if (player_two.power_c >= 100 && player_two.canSpecial() && absDx < ATTACK_RANGE + 40) {
                playerActions.player_two.special = true;
            } else if (absDx >= ATTACK_RANGE) {
                faceAndWalk(dx, true);
            }
            break;
        case 'block':
            hold(dx);
            playerActions.player_two.block = true;
            break;
        case 'jump': {
            hold(dx);
            const canvas = document.querySelector('canvas');
            const onGround =
                canvas &&
                player_two.position.y + player_two.height >= canvas.height - flat_point;
            if (onGround && player_two.canJump() && !jumpPulse) {
                playerActions.player_two.jump = true;
                jumpPulse = true;
            }
            break;
        }
        case 'wait':
        default:
            hold(dx);
            break;
    }

    if (action !== 'jump') jumpPulse = false;
}

function updateLayaAI() {
    applyAction(getBotAction());
}

function updateClassicAI() {
    const canvas = document.querySelector('canvas');
    const dx = player_one.position.x - player_two.position.x;
    const absDx = Math.abs(dx);
    const playerOneSwinging = player_one.melee || player_one.combo;

    clearBotActions();

    if (playerOneSwinging && absDx < ATTACK_RANGE + 40 && !player_two.isAirborne()) {
        playerActions.player_two.block = true;
        hold(dx);
        if (player_one.combo && player_two.canJump() && Math.random() < 0.35) {
            playerActions.player_two.jump = true;
            playerActions.player_two.block = false;
        }
        return;
    }

    // Don't mash into a block (classic upgrade).
    if (player_one.blocking && absDx < ATTACK_RANGE + 20) {
        if (Math.random() < 0.5) faceAndWalk(dx, false);
        else hold(dx);
        return;
    }

    if (absDx > ATTACK_RANGE) {
        faceAndWalk(dx, true);
    } else {
        hold(dx);
        if (player_two.canMelee() && Math.random() < 0.05) {
            playerActions.player_two.melee = true;
        }
        if (player_two.power_c >= 100 && player_two.canSpecial() && Math.random() < 0.1) {
            playerActions.player_two.special = true;
        }
    }

    if (
        player_two.canJump() &&
        Math.random() < 0.01 &&
        canvas &&
        player_two.position.y + player_two.height >= canvas.height - flat_point
    ) {
        playerActions.player_two.jump = true;
    }
}

export function updateAI() {
    if (!gameState.fight) return;
    if (player_two.health <= 0 || player_one.health <= 0) return;
    if (player_two.inHitstun()) {
        clearBotActions();
        return;
    }

    if (useClassicBot()) {
        updateClassicAI();
    } else {
        updateLayaAI();
    }
}

export { getBotAction as getBotStyle, isLayaConnected, ACTIONS as STYLES };
