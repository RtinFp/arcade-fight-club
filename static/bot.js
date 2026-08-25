// bot.js
import { gameState, players_velocity, players_jump, flat_point } from './core.js';
import { playerActions } from './input.js';

// Store references to player objects (needed for AI decisions)
let player_one, player_two;

export function setBotReferences(p1, p2) {
    player_one = p1;
    player_two = p2;
}

export function updateAI() {
    if (!gameState.fight) return;
    if (player_two.health <= 0 || player_one.health <= 0) return;

    const canvas = document.querySelector('canvas');
    const dx = player_one.position.x - player_two.position.x;
    const attackRange = 150;

    // Movement flags and facing
    if (Math.abs(dx) > attackRange) {
        if (dx > 0) {
            player_two.facing = 1;
            playerActions.player_two.right = true;
            playerActions.player_two.left = false;
        } else {
            player_two.facing = -1;
            playerActions.player_two.left = true;
            playerActions.player_two.right = false;
        }
    } else {
        playerActions.player_two.left = false;
        playerActions.player_two.right = false;
    }

    // Attack flags (one-shot)
    if (Math.abs(dx) < attackRange && Math.random() < 0.05) {
        playerActions.player_two.melee = true;
    }

    // Special flag
    if (player_two.power_c >= 100 && Math.random() < 0.1) {
        playerActions.player_two.special = true;
    }

    // Jump flag
    if (Math.random() < 0.01 && player_two.position.y + player_two.height >= canvas.height - flat_point) {
        playerActions.player_two.jump = true;
    }
}