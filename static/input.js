// input.js
import { gameState } from './core.js';
import { getMapping, ACTIONS, STANDARD_MAPPING, LOCAL_P1_MAPPING, LOCAL_P2_MAPPING } from './inputMapping.js';

// Store active actions for each player (will be set by key events)
// These flags are consumed by the main loop.
export const playerActions = {
    player_one: {
        left: false,
        right: false,
        jump: false,
        melee: false,
        special: false
    },
    player_two: {
        left: false,
        right: false,
        jump: false,
        melee: false,
        special: false
    }
};

// For debouncing melee/special (prevent multiple triggers per key press)
const actionTriggered = {
    player_one: { melee: false, special: false },
    player_two: { melee: false, special: false }
};

export function initInput(gameMode, isHost, playerRole, playerOneObj, playerTwoObj) {
    // Store references if needed (not strictly required now)
    window._p1 = playerOneObj;
    window._p2 = playerTwoObj;

    function handleKeyEvent(event, type) {
        if (!gameState.fight) return;

        const code = event.code;
        let playerIndex = null;
        let mapping = null;

        if (gameMode === 'local') {
            // Try mapping for player_one
            const p1Map = getMapping('local', 0);
            if (p1Map[code]) {
                playerIndex = 0;
                mapping = p1Map;
            } else {
                const p2Map = getMapping('local', 1);
                if (p2Map[code]) {
                    playerIndex = 1;
                    mapping = p2Map;
                }
            }
        } 
        else if (gameMode === 'online') {
            // In online mode, only the local player's keys are handled here.
            if (isHost && playerRole === 'host') {
                playerIndex = 0;
                mapping = getMapping('online', 0);
            } else if (!isHost && playerRole === 'joiner') {
                playerIndex = 1;
                mapping = getMapping('online', 1);
            }
            if (mapping && !mapping[code]) return;
        }
        else if (gameMode === 'bot') {
            playerIndex = 0;
            mapping = getMapping('bot', 0);
            if (!mapping[code]) return;
        }

        if (playerIndex === null) return;

        const action = mapping[code];
        if (!action) return;

        const playerActionsRef = (playerIndex === 0) ? playerActions.player_one : playerActions.player_two;
        const triggerRef = (playerIndex === 0) ? actionTriggered.player_one : actionTriggered.player_two;

        if (type === 'keydown') {
            switch (action) {
                case ACTIONS.LEFT:
                    playerActionsRef.left = true;
                    break;
                case ACTIONS.RIGHT:
                    playerActionsRef.right = true;
                    break;
                case ACTIONS.JUMP:
                    if (!playerActionsRef.jump) {
                        playerActionsRef.jump = true;
                    }
                    break;
                case ACTIONS.MELEE:
                    if (!triggerRef.melee) {
                        triggerRef.melee = true;
                        playerActionsRef.melee = true;
                    }
                    break;
                case ACTIONS.SPECIAL:
                    if (!triggerRef.special) {
                        triggerRef.special = true;
                        playerActionsRef.special = true;
                    }
                    break;
            }
        } 
        else if (type === 'keyup') {
            switch (action) {
                case ACTIONS.LEFT:
                    playerActionsRef.left = false;
                    break;
                case ACTIONS.RIGHT:
                    playerActionsRef.right = false;
                    break;
                case ACTIONS.JUMP:
                    playerActionsRef.jump = false;
                    break;
                case ACTIONS.MELEE:
                    playerActionsRef.melee = false;
                    triggerRef.melee = false;
                    break;
                case ACTIONS.SPECIAL:
                    playerActionsRef.special = false;
                    triggerRef.special = false;
                    break;
            }
        }
    }

    window.addEventListener('keydown', (e) => {
        // Prevent default for game keys
        const code = e.code;
        if (gameMode === 'local') {
            if (LOCAL_P1_MAPPING[code] || LOCAL_P2_MAPPING[code]) e.preventDefault();
        } else {
            if (STANDARD_MAPPING[code]) e.preventDefault();
        }
        handleKeyEvent(e, 'keydown');
    });

    window.addEventListener('keyup', (e) => {
        handleKeyEvent(e, 'keyup');
    });
}

// Helper to reset jump flag after processing (called from main loop)
export function resetJumpFlag(player) {
    if (player === 'one') {
        playerActions.player_one.jump = false;
    } else {
        playerActions.player_two.jump = false;
    }
}

// Helper to reset melee/special flags after processing
export function resetActionFlags(player) {
    if (player === 'one') {
        playerActions.player_one.melee = false;
        playerActions.player_one.special = false;
        actionTriggered.player_one.melee = false;
        actionTriggered.player_one.special = false;
    } else {
        playerActions.player_two.melee = false;
        playerActions.player_two.special = false;
        actionTriggered.player_two.melee = false;
        actionTriggered.player_two.special = false;
    }
}