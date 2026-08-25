import { 
    winnerjs, loserjs, melee_box, combo_box,
    background_img, city, flat, player_one, player_two,
    initGameObjects, flat_point, gameState, players_velocity, players_jump
} from './core.js';
import { initInput, playerActions, resetJumpFlag, resetActionFlags } from './input.js';
import { updateAI, setBotReferences } from './bot.js';
import { initOnline, updateOnlineHost, updateOnlineJoiner } from './online.js';

let gameMode, narrator_title, tyler_title;

document.addEventListener('DOMContentLoaded', () => {
    gameMode = window.GAME_MODE || 'local';
    narrator_title = window.PLAYER_ONE_NAME || document.querySelector(".narrator_title").innerHTML;
    tyler_title = window.PLAYER_TWO_NAME || document.querySelector(".tyler_title").innerHTML;
    console.log("Game mode from:", gameMode);

    initGameObjects();
    setBotReferences(player_one, player_two);

    const isHost = (window.PLAYER_ROLE === 'host');
    // Pass player objects so input.js can access them for jump/attack checks if needed
    initInput(gameMode, isHost, window.PLAYER_ROLE, player_one, player_two);

    const fightButton = document.getElementById('fight');
    if (fightButton) {
        fightButton.addEventListener('click', () => {
            gameState.fight = true;
            gameState.gameOver = false;
            document.getElementById('ready').style.display = 'none';
            document.getElementById('song').play();
        });
    }

    // Global pause handler (space)
    window.addEventListener('keydown', (e) => {
        if (e.key !== ' ') return;
        e.preventDefault();
        if (gameMode === 'online') {
            if (window.PLAYER_ROLE === 'host') {
                gameState.fight = !gameState.fight;
                if (!gameState.fight) {
                    document.getElementById('ready').style.display = 'flex';
                    if (window.socket) window.socket.emit('pause_sync', { room: window.ROOM_ID, paused: true });
                } else {
                    document.getElementById('ready').style.display = 'none';
                    document.getElementById('song').play();
                    if (window.socket) window.socket.emit('pause_sync', { room: window.ROOM_ID, paused: false });
                }
            }
            // Joiner's space handled inside online.js
        } else {
            gameState.fight = !gameState.fight;
            if (!gameState.fight) document.getElementById('ready').style.display = 'flex';
            else {
                document.getElementById('ready').style.display = 'none';
                document.getElementById('song').play();
            }
        }
    });

    // Initialize online if needed
    if (gameMode === 'online') {
        initOnline(window.ROOM_ID, window.PLAYER_ROLE, narrator_title, tyler_title);
        // Hack to expose socket for pause broadcast (will be set by online.js)
    }

    // Helper to apply movement and actions for a player
    function processPlayer(player, actions, isHuman, playerIndex) {
        // Reset horizontal velocity (will be set by movement flags)
        player.velocity.x = 0;

        // Movement
        if (actions.left) {
            player.velocity.x = -players_velocity;
            player.switch_sprite('return');
            player.facing = -1;
        } else if (actions.right) {
            player.velocity.x = players_velocity;
            player.switch_sprite('run');
            player.facing = 1;
        } else {
            // Only switch to idle if not in an attack/jump animation that should persist
            if (!player.melee && !player.combo && player.velocity.y === 0) {
                player.switch_sprite('idle');
            }
        }

        // Jump (one-shot)
        if (actions.jump) {
            const canvas = document.querySelector('canvas');
            if (player.position.y + player.height >= canvas.height - flat_point) {
                player.velocity.y = players_jump;
                const audio = new Audio();
                audio.src = "./static/sfx/jump.wav";
                audio.play();
            }
            resetJumpFlag(playerIndex === 0 ? 'one' : 'two');
        }

        // Melee
        if (actions.melee) {
            player.attack();
            resetActionFlags(playerIndex === 0 ? 'one' : 'two');
        }

        // Special
        if (actions.special) {
            if (player.power_c >= 100) {
                if (playerIndex === 0) {
                    document.getElementById('player_one_combo_bar').style.background = 'red';
                    document.getElementById('player_one_combo_bar').style.width = '0%';
                } else {
                    document.getElementById('player_two_combo_bar').style.background = 'red';
                    document.getElementById('player_two_combo_bar').style.width = '0%';
                }
                player.power();
            }
            resetActionFlags(playerIndex === 0 ? 'one' : 'two');
        }

        // Jump sprite override
        if (player.velocity.y < 0) player.switch_sprite('jump');
    }

    // Single animation loop
    function animate() {
        requestAnimationFrame(animate);

        const isJoinerOnline = (gameMode === 'online' && window.PLAYER_ROLE !== 'host');

        if (!isJoinerOnline) {
            // --- Host (or local/bot) does full logic ---
            const canvas = document.querySelector('canvas');
            const c = canvas.getContext('2d');
            c.clearRect(0, 0, canvas.width, canvas.height);
            
            background_img.update();
            city.update();
            city.buildings();
            flat.update();

            player_one.update();
            player_two.update();

            // Process player one (always human or AI? In bot mode player one is human)
            processPlayer(player_one, playerActions.player_one, true, 0);

            // Process player two
            if (gameMode === 'bot') {
                // AI sets action flags for player_two, then process normally
                updateAI();
                processPlayer(player_two, playerActions.player_two, false, 1);
            } else if (gameMode === 'online' && window.PLAYER_ROLE === 'host') {
                // Online host: player_two is remote, actions come via socket
                processPlayer(player_two, playerActions.player_two, false, 1);
            } else if (gameMode === 'local') {
                // Local co-op: both players are human, actions already set by input.js
                processPlayer(player_two, playerActions.player_two, true, 1);
            }

            // --- Combat (only host processes hits) ---
            if (gameMode !== 'online' || window.PLAYER_ROLE === 'host') {
                // Melee attacks
                if (melee_box({box1: player_one, box2: player_two}) && player_one.melee) {
                    player_two.hit();
                    player_one.melee = false;
                    player_one.power_c += 10;
                    document.querySelector('#player_one_combo_bar').style.width = player_one.power_c + '%';
                    document.querySelector('#player_two_health_bar').style.width = player_two.health + '%';
                }
                if (melee_box({box1: player_two, box2: player_one}) && player_two.melee) {
                    player_one.hit();
                    player_two.melee = false;
                    player_two.power_c += 10;
                    document.querySelector('#player_two_combo_bar').style.width = player_two.power_c + '%';
                    document.querySelector('#player_one_health_bar').style.width = player_one.health + '%';
                }

                // Combo attacks
                if (combo_box({box1: player_one, box2: player_two}) && player_one.combo) {
                    player_one.combo = false;
                    player_two.heavyHit();
                    document.querySelector('#player_two_health_bar').style.width = player_two.health + '%';
                }
                if (combo_box({box1: player_two, box2: player_one}) && player_two.combo) {
                    player_two.combo = false;
                    player_one.heavyHit();
                    document.querySelector('#player_one_health_bar').style.width = player_one.health + '%';
                }

                // Update combo bar colors
                if (player_one.power_c >= 50) document.getElementById('player_one_combo_bar').style.background = 'yellow';
                if (player_one.power_c >= 100) document.getElementById('player_one_combo_bar').style.background = 'rgb(0, 255, 0)';
                if (player_two.power_c >= 50) document.getElementById('player_two_combo_bar').style.background = 'yellow';
                if (player_two.power_c >= 100) document.getElementById('player_two_combo_bar').style.background = 'rgb(0, 255, 0)';

                // Game over
                if (player_one.health <= 0 || player_two.health <= 0) {
                    if (!gameState.gameOver) {
                        gameState.gameOver = true;
                        gameState.fight = false;
                        let winner = (player_one.health <= 0) ? tyler_title : narrator_title;
                        document.querySelector('#log').style.display = 'flex';
                        document.querySelector('#log_title').innerHTML = winner + ' wins!';
                        if (winner === narrator_title) {
                            winnerjs = narrator_title;
                            loserjs = tyler_title;
                        } else {
                            winnerjs = tyler_title;
                            loserjs = narrator_title;
                        }
                    }
                }
            }

            // Online host: send state to joiner
            if (gameMode === 'online' && window.PLAYER_ROLE === 'host') {
                updateOnlineHost();
            }
        } else {
            // --- Joiner online: just render interpolated state ---
            updateOnlineJoiner();
            const canvas = document.querySelector('canvas');
            const c = canvas.getContext('2d');
            c.clearRect(0, 0, canvas.width, canvas.height);
            background_img.update();
            city.update();
            city.buildings();
            flat.update();
            player_one.update();
            player_two.update();
        }
    }

    animate();
});

export { winnerjs, loserjs };