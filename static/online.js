import { 
    player_one, player_two, background_img, city, flat,
    players_velocity, players_jump, flat_point, gameState,
    winnerjs, loserjs
} from './core.js';
import { playerActions } from './input.js';
import { ACTIONS, STANDARD_MAPPING } from './inputMapping.js';

let socket = null;
let roomId, isHost;
let narrator_title, tyler_title;
let lastSendTime = 0;
const SEND_INTERVAL = 50; // ms

// For joiner interpolation – now includes facing
let receivedState = {
    p1: { x: 150, y: 70, health: 100, power: 0, facing: 1, sprite: 'idle' },
    p2: { x: 1640, y: 70, health: 100, power: 0, facing: -1, sprite: 'idle' },
    fightActive: false,
    gameOver: false,
    winner: null
};
let lastTimestamp = 0;
let lastSprites = { p1: '', p2: '' };

// Helper to map action to key string (for sending)
function actionToKey(action) {
    for (const [code, act] of Object.entries(STANDARD_MAPPING)) {
        if (act === action) return code.replace('Key', '').toLowerCase();
    }
    return null;
}

// Helper to map key string (e.g., 'a') to action
function keyToAction(keyStr) {
    const code = 'Key' + keyStr.toUpperCase();
    return STANDARD_MAPPING[code];
}

// Helper to get sprite name
function getSpriteName(player) {
    if (player.image === player.sprites.hit.image) return 'hit';
    if (player.image === player.sprites.kick.image) return 'kick';
    if (player.image === player.sprites.getHit.image) return 'getHit';
    if (player.image === player.sprites.run.image) return 'run';
    if (player.image === player.sprites.return.image) return 'return';
    if (player.image === player.sprites.jump.image) return 'jump';
    return 'idle';
}

export function initOnline(room, role, narrator, tyler) {
    roomId = room;
    isHost = (role === 'host');
    narrator_title = narrator;
    tyler_title = tyler;
    socket = io();

    socket.emit('join_game', { room: roomId, player: role });

    socket.on('both_joined', () => {
        gameState.fight = true;
        gameState.gameOver = false;
        document.getElementById('ready').style.display = 'none';
        document.getElementById('song').play();
    });

    if (isHost) {
        // Host: listen for opponent's actions
        socket.on('opponent_action', (actionData) => {
            if (!gameState.fight || gameState.gameOver) return;
            const { type, key } = actionData;
            const action = keyToAction(key);
            if (!action) return;
            const remoteActions = playerActions.player_two;
            if (type === 'down') {
                switch (action) {
                    case ACTIONS.LEFT: remoteActions.left = true; break;
                    case ACTIONS.RIGHT: remoteActions.right = true; break;
                    case ACTIONS.JUMP: remoteActions.jump = true; break;
                    case ACTIONS.MELEE: remoteActions.melee = true; break;
                    case ACTIONS.SPECIAL: remoteActions.special = true; break;
                }
            } else if (type === 'up') {
                switch (action) {
                    case ACTIONS.LEFT: remoteActions.left = false; break;
                    case ACTIONS.RIGHT: remoteActions.right = false; break;
                }
            }
        });

        socket.on('pause_request', () => {
            if (gameState.fight && !gameState.gameOver) {
                gameState.fight = false;
                document.getElementById('ready').style.display = 'flex';
                socket.emit('pause_sync', { room: roomId, paused: true });
            }
        });
    } else {
        // Joiner: listen for full game state (now includes facing)
        socket.on('game_state_update', (state) => {
            receivedState = state;
            // Update UI bars
            document.querySelector('#player_one_health_bar').style.width = state.p1.health + '%';
            document.querySelector('#player_two_health_bar').style.width = state.p2.health + '%';
            document.querySelector('#player_one_combo_bar').style.width = state.p1.power + '%';
            document.querySelector('#player_two_combo_bar').style.width = state.p2.power + '%';
            
            const p1Power = state.p1.power, p2Power = state.p2.power;
            if (p1Power >= 50) document.getElementById('player_one_combo_bar').style.background = 'yellow';
            if (p1Power >= 100) document.getElementById('player_one_combo_bar').style.background = 'rgb(0,255,0)';
            if (p2Power >= 50) document.getElementById('player_two_combo_bar').style.background = 'yellow';
            if (p2Power >= 100) document.getElementById('player_two_combo_bar').style.background = 'rgb(0,255,0)';
            
            gameState.fight = state.fightActive;
            gameState.gameOver = state.gameOver;
            
            if (state.gameOver && !(document.getElementById('log').style.display === 'flex')) {
                document.querySelector('#log').style.display = 'flex';
                document.querySelector('#log_title').innerHTML = state.winner + ' wins!';
                if (state.winner === narrator_title) {
                    winnerjs = narrator_title;
                    loserjs = tyler_title;
                } else {
                    winnerjs = tyler_title;
                    loserjs = narrator_title;
                }
            } else if (!state.gameOver) {
                document.querySelector('#log').style.display = 'none';
            }
            
            // Update sprites and facing
            if (state.p1.sprite !== lastSprites.p1) {
                player_one.switch_sprite(state.p1.sprite);
                lastSprites.p1 = state.p1.sprite;
            }
            if (state.p2.sprite !== lastSprites.p2) {
                player_two.switch_sprite(state.p2.sprite);
                lastSprites.p2 = state.p2.sprite;
            }
            // CRITICAL: update facing from received state
            player_one.facing = state.p1.facing;
            player_two.facing = state.p2.facing;
        });

        // Joiner sends its own inputs
        window.addEventListener('keydown', (e) => {
            const code = e.code;
            const action = STANDARD_MAPPING[code];
            if (!action && code !== 'Space') return;
            e.preventDefault();
            if (!socket || !roomId) return;
            if (code === 'Space') {
                socket.emit('pause_request', { room: roomId });
                return;
            }
            if (!gameState.fight || gameState.gameOver) return;
            const key = actionToKey(action);
            if (key) {
                socket.emit('player_action', { room: roomId, action: { type: 'down', key } });
            }
        });
        
        window.addEventListener('keyup', (e) => {
            const code = e.code;
            const action = STANDARD_MAPPING[code];
            if (!action) return;
            if (!socket || !roomId) return;
            if (!gameState.fight || gameState.gameOver) return;
            if (action === ACTIONS.LEFT || action === ACTIONS.RIGHT) {
                const key = actionToKey(action);
                if (key) {
                    socket.emit('player_action', { room: roomId, action: { type: 'up', key } });
                }
            }
        });
        
        socket.on('pause_sync', (data) => {
            if (data.paused) {
                gameState.fight = false;
                document.getElementById('ready').style.display = 'flex';
            } else {
                gameState.fight = true;
                document.getElementById('ready').style.display = 'none';
                document.getElementById('song').play();
            }
        });
    }

    window.socket = socket;
    window.ROOM_ID = roomId;
}

// Host: send full state including facing
export function updateOnlineHost() {
    if (!isHost) return;
    const now = Date.now();
    if (now - lastSendTime >= SEND_INTERVAL) {
        lastSendTime = now;
        
        let winner = null;
        if (player_one.health <= 0) winner = tyler_title;
        else if (player_two.health <= 0) winner = narrator_title;
        
        const state = {
            p1: {
                x: player_one.position.x,
                y: player_one.position.y,
                health: player_one.health,
                power: player_one.power_c,
                facing: player_one.facing,
                sprite: getSpriteName(player_one)
            },
            p2: {
                x: player_two.position.x,
                y: player_two.position.y,
                health: player_two.health,
                power: player_two.power_c,
                facing: player_two.facing,
                sprite: getSpriteName(player_two)
            },
            fightActive: gameState.fight,
            gameOver: (player_one.health <= 0 || player_two.health <= 0),
            winner: winner
        };
        socket.emit('game_state', { room: roomId, state });
        
        if (state.gameOver && !(document.getElementById('log').style.display === 'flex')) {
            document.querySelector('#log').style.display = 'flex';
            document.querySelector('#log_title').innerHTML = winner + ' wins!';
            if (winner === narrator_title) {
                winnerjs = narrator_title;
                loserjs = tyler_title;
            } else {
                winnerjs = tyler_title;
                loserjs = narrator_title;
            }
            gameState.fight = false;
            gameState.gameOver = true;
        }
    }
}

// Joiner: interpolate positions and apply facing from received state
export function updateOnlineJoiner() {
    if (isHost) return;
    const now = performance.now();
    if (!lastTimestamp) lastTimestamp = now;
    const delta = Math.min(0.033, (now - lastTimestamp) / 1000);
    lastTimestamp = now;
    const factor = Math.min(1, delta * 15);
    player_one.position.x += (receivedState.p1.x - player_one.position.x) * factor;
    player_one.position.y += (receivedState.p1.y - player_one.position.y) * factor;
    player_two.position.x += (receivedState.p2.x - player_two.position.x) * factor;
    player_two.position.y += (receivedState.p2.y - player_two.position.y) * factor;
    player_one.health = receivedState.p1.health;
    player_one.power_c = receivedState.p1.power;
    player_two.health = receivedState.p2.health;
    player_two.power_c = receivedState.p2.power;
    // Also update facing from received state (though already done in event handler, this ensures it's updated every frame)
    player_one.facing = receivedState.p1.facing;
    player_two.facing = receivedState.p2.facing;
}