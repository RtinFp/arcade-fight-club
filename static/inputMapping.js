// inputMapping.js

// Action names
export const ACTIONS = {
    LEFT: 'left',
    RIGHT: 'right',
    JUMP: 'jump',
    MELEE: 'melee',
    SPECIAL: 'special'
};

// Standard mapping (used for online mode & bot mode, for both players)
export const STANDARD_MAPPING = {
    'KeyA': ACTIONS.LEFT,
    'KeyD': ACTIONS.RIGHT,
    'KeyW': ACTIONS.JUMP,
    'KeyL': ACTIONS.MELEE,
    'KeyK': ACTIONS.SPECIAL
};

// Local co-op: Player One mapping
export const LOCAL_P1_MAPPING = {
    'KeyA': ACTIONS.LEFT,
    'KeyF': ACTIONS.RIGHT,   // F for right (instead of D)
    'KeyW': ACTIONS.JUMP,
    'KeyD': ACTIONS.MELEE,   // D for punch
    'KeyS': ACTIONS.SPECIAL  // S for combo
};

// Local co-op: Player Two mapping
export const LOCAL_P2_MAPPING = {
    'KeyJ': ACTIONS.LEFT,
    'Semicolon': ACTIONS.RIGHT,
    'KeyO': ACTIONS.JUMP,
    'KeyK': ACTIONS.MELEE,
    'KeyL': ACTIONS.SPECIAL
};

// Helper to get the appropriate mapping for a player in a given mode
export function getMapping(gameMode, playerIndex) {
    // playerIndex: 0 for player_one, 1 for player_two
    if (gameMode === 'local') {
        return playerIndex === 0 ? LOCAL_P1_MAPPING : LOCAL_P2_MAPPING;
    } else {
        // online or bot: both players use standard mapping
        return STANDARD_MAPPING;
    }
}