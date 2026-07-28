var winnerjs = null;
var loserjs = null;
document.addEventListener('DOMContentLoaded', function() {
    const canvas = document.querySelector('canvas');

    // Set context to 2d game
    const c = canvas.getContext('2d');
    // Some variables for easy changable values in game
    const gravity = 1;
    const players_velocity = 15;
    const players_jump = -25;
    const melee_damage = 1;
    const combo_damage = 20;
    const flat_point = 106;
    const city_speed = 2;
    // Another variables
    const audio = new Audio();
    let fight = false;
    var narrator_title = document.querySelector(".narrator_title").innerHTML;
    var tyler_title = document.querySelector(".tyler_title").innerHTML;

    // Create background-sprite class
    class Background {
        constructor({ position, img, scale = 1, frames_max = 1 }) {
            this.position = position;
            this.width = 50;
            this.height = 150;
            this.image = new Image();
            this.image.src = img;
            this.scale = scale;
            this.frames_max = frames_max;
            this.frames_current = 0;
            this.frames_elapsed = 0;
            this.frames_hold = 5;
        }
        draw(){
            c.drawImage(
                this.image,
                this.frames_current * (this.image.width / this.frames_max),
                0,
                this.image.width / this.frames_max,
                this.image.height, 
                this.position.x, 
                this.position.y,
                (this.image.width / this.frames_max) * this.scale,
                this.image.height * this.scale
                );
        }
        animate_frames()
        {
            this.frames_elapsed++;
            if (this.frames_elapsed % this.frames_hold === 0)
            {
                if (this.frames_current < this.frames_max - 1)
                {
                    this.frames_current++;
                }
                else
                {
                    this.frames_current = 0;
                }
            }
        }
        update() {
            this.draw();
            this.animate_frames();
        }
        // Loop animation of the city behind the palm trees
        buildings()
        {
            this.position.x += city_speed;
            if (this.position.x >= 0)
            {
                this.position.x = -1920;
            }
        }
    }
    
    // Create sprite class
    class Sprite extends Background {
        constructor({position, velocity, offset, offset2, color = 'red', img, scale= 1, frames_max = 1, sprites}) {
            super({img, scale, frames_max, position})
            // this.position = position;
            this.velocity = velocity;
            this.width = 150;
            this.height = 350;
            this.last_key;
            this.color = color;
            this.health = 100;
            this.power_c = 0;
            // Melee
            this.melee_env = 
            {
                position: {x: this.position.x, y: this.position.y}, 
                offset,
                width: 280, height: 50
            };
            this.melee;
            // Combo
            this.combo_env =
            {
                position: {x: this.position.x, y: this.position.y},
                offset2,
                width: 600, height: 600
            };
            this.combo_env;
            this.frames_current = 0;
            this.frames_elapsed = 0;
            this.frames_hold = 10;
            this.sprites = sprites;
            for (const sprite in this.sprites)
            {
                sprites[sprite].image = new Image();
                sprites[sprite].image.src = sprites[sprite].img;
            }
        }
        update() {
            this.draw();
            this.animate_frames();
            this.melee_env.position.x = this.position.x + this.melee_env.offset.x;
            this.melee_env.position.y = this.position.y + this.melee_env.offset.y;
            this.combo_env.position.x = this.position.x + this.combo_env.offset2.x;
            this.combo_env.position.y = this.position.y + this.combo_env.offset2.y;
            this.position.x += this.velocity.x;
            this.position.y += this.velocity.y;

            // Setting gravity
            if (this.position.y + this.height + this.velocity.y >= canvas.height - flat_point)
            {
                this.velocity.y = 0;
            }
            else
            {
                this.velocity.y += gravity;
            }
        }
        attack()
        {
            this.switch_sprite('hit')
            this.melee = true;
            setTimeout(() => {
                this.melee = false;
            }, 100);
        }
        power()
        {
            this.power_c = 0;
            this.switch_sprite('kick')
            this.combo = true;
            setTimeout(() => {
                this.combo = false;
            }, 100);
        }
        hit()
        {
            this.switch_sprite('getHit');
            this.health -= melee_damage;
            audio.src = "./static/sfx/hit.mp3";
            audio.play();
        }
        heavyHit()
        {
            this.switch_sprite('getHit');
            this.health -= combo_damage;
            audio.src = "./static/sfx/combo.wav";
            audio.play();
        }
        switch_sprite(sprite)
        {
            if (this.image === this.sprites.hit.image && this.frames_current < this.sprites.hit.frames_max - 1) return;
            if (this.image === this.sprites.kick.image && this.frames_current < this.sprites.kick.frames_max - 1) return;
            if (this.image === this.sprites.getHit.image && this.frames_current < this.sprites.getHit.frames_max - 1) return;
            switch (sprite)
            {
                case 'idle':
                    if (this.image !== this.sprites.idle.image)
                    {
                        this.image = this.sprites.idle.image;
                        this.frames_max = this.sprites.idle.frames_max;
                        this.frames_current = 0;
                        this.frames_hold = 25;
                    }
                    break;
                case 'run':
                    if (this.image !== this.sprites.run.image)
                    {
                        this.image = this.sprites.run.image;
                        this.frames_max = this.sprites.run.frames_max;
                        this.frames_current = 0;
                        this.frames_hold = 10;
                    }
                    break;
                case 'return':
                    if (this.image !== this.sprites.return.image)
                    {
                        this.image = this.sprites.return.image;
                        this.frames_max = this.sprites.return.frames_max;
                        this.frames_current = 0;
                        this.frames_hold = 10;
                    }
                    break;
                case 'hit':
                    if (this.image !== this.sprites.hit.image)
                    {
                        this.image = this.sprites.hit.image;
                        this.frames_max = this.sprites.hit.frames_max;
                        this.frames_current = 0;
                        this.frames_hold = 25;
                    }
                    break;
                case 'kick':
                    if (this.image !== this.sprites.kick.image)
                    {
                        this.image = this.sprites.kick.image;
                        this.frames_max = this.sprites.kick.frames_max;
                        this.frames_current = 0;
                        this.frames_hold = 25;
                    }
                    break;
                case 'jump':
                    if (this.image !== this.sprites.jump.image)
                    {
                        this.image = this.sprites.jump.image;
                        this.frames_max = this.sprites.jump.frames_max;
                        this.frames_current = 0;
                        this.frames_hold = 25;
                    }
                    break;
                case 'getHit':
                    if (this.image !== this.sprites.getHit.image)
                    {
                        this.image = this.sprites.getHit.image;
                        this.frames_max = this.sprites.getHit.frames_max;
                        this.frames_current = 0;
                        this.frames_hold = 5;
                    }
                    break;
            }
        }
    }

    // Create background object
    const background_img = new Background({
        position: {x: 0, y: 0},
        img: './static/img/back.png'
    })

    const city = new Background({
        position: {x: -1920, y: 450},
        img: './static/img/cityPartCom.png'
    })

    const flat = new Background({
        position: {x: 0, y: 560},
        img: './static/img/flat.png'
    })

    // Create player_one object
    const player_one = new Sprite({
        position: {x: 150, y: 70},
        velocity: {x: 0, y: 3},
        offset: {x: 0, y: 60},
        offset2: {x: -250, y: -250},
        img: './static/img/narratorIdle.png',
        frames_max: 2,
        scale: 1.06,
        sprites: {
            idle: {
                img: './static/img/narratorIdle.png',
                frames_max: 2
            },
            run: {
                img: './static/img/narratorRun.png',
                frames_max: 4
            },
            return: {
                img: './static/img/narratorReturn.png',
                frames_max: 4
            },
            hit: {
                img: './static/img/narratorHit.png',
                frames_max: 2
            },
            kick: {
                img: './static/img/narratorCombo.png',
                frames_max: 2
            },
            jump: {
                img: './static/img/narratorJump.png',
                frames_max: 2
            },
            getHit: {
                img: './static/img/narratorgetHit.png',
                frames_max: 3
            }
        }
    });
    // player_one.draw();

    // Create player_two object
    const player_two = new Sprite({
        position: {x: 1640, y: 70},
        velocity: {x: 0, y: 3},
        offset: {x: -130, y: 60},
        offset2: {x: -250, y: -250},
        img: './static/img/tylerIdle.png',
        frames_max: 2,
        scale: 1.06,
        sprites: {
            idle: {
                img: './static/img/tylerIdle.png',
                frames_max: 2
            },
            run: {
                img: './static/img/tylerRun.png',
                frames_max: 4
            },
            return: {
                img: './static/img/tylerReturn.png',
                frames_max: 4
            },
            hit: {
                img: './static/img/tylerHit.png',
                frames_max: 2
            },
            kick: {
                img: './static/img/tylerCombo.png',
                frames_max: 2
            },
            jump: {
                img: './static/img/tylerJump.png',
                frames_max: 2
            },
            getHit: {
                img: './static/img/tylergetHit.png',
                frames_max: 3
            }
        }
    });
    // player_two.draw();

    // console.log(player_one);

    // Better player movement experience
    const keys = {
        // Player_one keys
        a: {pressed: false},
        f: {pressed: false},
        // Player_two keys
        j: {pressed: false},
        semicolon: {pressed: false}
    }
    // Melee
    function melee_box({box1, box2})
    {
        return ((box1.melee_env.position.x + box1.melee_env.width) >= (box2.position.x) && 
        (box1.melee_env.position.x) <= (box2.position.x + box2.width) &&
        (box1.melee_env.position.y + box1.melee_env.height) >= (box2.position.y) &&
        (box1.melee_env.position.y) <= (box2.position.y + box2.height))
    }
    // Combo
    function combo_box({box1, box2})
    {
        return ((box1.combo_env.position.x + box1.combo_env.width) >= (box2.position.x) && 
        (box1.combo_env.position.x) <= (box2.position.x + box2.width) &&
        (box1.combo_env.position.y + box1.combo_env.height) >= (box2.position.y) &&
        (box1.combo_env.position.y) <= (box2.position.y + box2.height))
    }

    function animate() {
        window.requestAnimationFrame(animate);
        c.clearRect(0, 0, canvas.width, canvas.height);
        background_img.update();
        city.update();
        city.buildings();
        flat.update();
        player_one.update();
        player_two.update();
        player_one.velocity.x = 0;
        player_two.velocity.x = 0;
        document.getElementById('fight').addEventListener('click', function() {
            fight = true;
            document.getElementById('ready').style.display = 'none';
            document.getElementById('song').play();
        });
        // Player_one movements
        if (keys.a.pressed && player_one.last_key === 'a')
        {
            player_one.velocity.x = (-1) * players_velocity;
            player_one.switch_sprite('return');
        }
        else if (keys.f.pressed && player_one.last_key === 'f')
        {
            player_one.velocity.x = players_velocity;
            player_one.switch_sprite('run');
        }
        else
        {
            player_one.switch_sprite('idle');
        }
        if (player_one.velocity.y < 0)
        {
            player_one.switch_sprite('jump');
        }
        // Player_two movements
        if (keys.j.pressed && player_two.last_key === 'j')
        {
            player_two.velocity.x = (-1) * players_velocity;
            player_two.switch_sprite('run');
        }
        else if (keys.semicolon.pressed && player_two.last_key === ';')
        {
            player_two.velocity.x = players_velocity;
            player_two.switch_sprite('return');
        }
        else 
        {
            player_two.switch_sprite('idle');
        }
        if (player_two.velocity.y < 0)
        {
            player_two.switch_sprite('jump');
        }
        // Player_one melee
        if (melee_box({box1: player_one, box2: player_two}) && player_one.melee)
        {
            player_two.hit();
            player_one.melee = false;
            player_one.power_c += 10;
            document.querySelector('#player_one_combo_bar').style.width = player_one.power_c + '%';
            document.querySelector('#player_two_health_bar').style.width = player_two.health + '%';
        }
        // Player_two melee
        if (melee_box({box1: player_two, box2: player_one}) && player_two.melee)
        {
            player_one.hit();
            player_two.melee = false;
            player_two.power_c += 10;
            document.querySelector('#player_two_combo_bar').style.width = player_two.power_c + '%';
            document.querySelector('#player_one_health_bar').style.width = player_one.health + '%';
        }
        // Player_one combo bar active
        if (player_one.power_c >= 50)
        {
            document.getElementById('player_one_combo_bar').style.background = 'yellow';
        }
        if (player_one.power_c >= 100)
        {
            document.getElementById('player_one_combo_bar').style.background = 'rgb(0, 255, 0)';
        }
        // Player_two combo bar active
        if (player_two.power_c >= 50)
        {
            document.getElementById('player_two_combo_bar').style.background = 'yellow';
        }
        if (player_two.power_c >= 100)
        {
            document.getElementById('player_two_combo_bar').style.background = 'rgb(0, 255, 0)';
        }
        // Player_one combo
        if (combo_box({box1: player_one, box2: player_two}) && player_one.combo)
        {
            player_one.combo = false;
            player_two.heavyHit();
            document.querySelector('#player_two_health_bar').style.width = player_two.health + '%';
        }
        // Player_two combo
        if (combo_box({box1: player_two, box2: player_one}) && player_two.combo)
        {
            player_two.combo = false;
            player_one.heavyHit();
            document.querySelector('#player_one_health_bar').style.width = player_one.health + '%';
        }
        // Results and game over
        if (player_one.health <= 0 || player_two.health <= 0)
        {
            document.querySelector('#log').style.display = 'flex';
            // document.getElementById('song').pause();
            if (player_one.health === player_two.health)
            {
                document.querySelector('#log_title').innerHTML = 'Tie!';
            }
            else if (player_one.health > player_two.health)
            {
                document.querySelector('#log_title').innerHTML = narrator_title + ' wins!';
                winnerjs = narrator_title;
                loserjs = tyler_title;
            }
            else if (player_two.health > player_one.health)
            {
                document.querySelector('#log_title').innerHTML = tyler_title + ' wins!';
                winnerjs = tyler_title;
                loserjs = narrator_title;
            }
        }
    }
    animate();

    // Character movements and controls
    // - When key pressed
    window.addEventListener('keydown', function(event) {
        // When "game-over" deactive all keys
        if (player_one.health > 0 && player_two.health > 0 && fight === true)
        {
            switch (event.key)
            {
                // Player_one controls
                case 'f':
                    // Keep player_one in canvas environment part1
                    if (player_one.position.x >= canvas.width)
                    {
                        keys.f.pressed = false;
                        break;
                    }
                    else
                    {
                        keys.f.pressed = true;
                        player_one.last_key = 'f';
                        break;
                    }
                case 'a':
                    // Keep player_one in canvas environment part2
                    if (player_one.position.x <= 0)
                    {
                        keys.a.pressed = false;
                        break;
                    }
                    else 
                    {
                        keys.a.pressed = true;
                        player_one.last_key = 'a';
                        break;
                    }
                case 'w':
                    // Prevention of flying for player_one!
                    if (player_one.position.y + player_one.height + player_one.velocity.y >= canvas.height - flat_point)
                    {
                        player_one.velocity.y = players_jump;
                        audio.src = "./static/sfx/jump.wav";
                        audio.play();
                    }
                    break;
                case 'd':
                    player_one.attack();
                    break;
                case 's':
                    if (player_one.power_c >= 100)
                    {
                        document.getElementById('player_one_combo_bar').style.background = 'red';
                        document.getElementById('player_one_combo_bar').style.width = '0%';
                        player_one.power();
                    }
                    break;
                // Player_two controls
                case 'j':
                    // Keep player_two in canvas environment part1
                    if (player_two.position.x <= 0)
                    {
                        keys.j.pressed = false;
                        break;
                    }
                    else 
                    {
                        keys.j.pressed = true;
                        player_two.last_key = 'j';
                        break;   
                    }
                case ';':
                    // Keep player_two in canvas environment part2
                    if (player_two.position.x >= canvas.width)
                    {
                        keys.semicolon.pressed = false;
                        break;
                    }
                    else 
                    {
                        keys.semicolon.pressed = true;
                        player_two.last_key = ';';
                        break;
                    }
                case 'o':
                    // Prevention of flying for player_two!
                    if (player_two.position.y + player_two.height + player_two.velocity.y >= canvas.height - flat_point)
                    {
                        player_two.velocity.y = players_jump;
                        audio.src = "./static/sfx/jump.wav";
                        audio.play();
                    }
                    break;
                case 'k':
                    player_two.attack();
                    break;
                case 'l':
                    if (player_two.power_c >= 100)
                    {
                        document.getElementById('player_two_combo_bar').style.background = 'red';
                        document.getElementById('player_two_combo_bar').style.width = '0%';
                        player_two.power();
                    }
                    break;
                // Pause menu
                case " ":
                    fight = false;
                    document.getElementById('ready').style.display = 'flex';
                    break;
            }
            // console.log("key_pressed: ", event.key);
        }
    });
    // - When key released
    window.addEventListener('keyup', function(event) {
        switch (event.key)
        {
            // Player_one controls
            case 'f':
                keys.f.pressed = false;
                break;
            case 'a':
                keys.a.pressed = false;
                break;
            // Player_two controls
            case 'j':
                keys.j.pressed = false;
                break;
            case ';':
                keys.semicolon.pressed = false;
                break;
        }
        // console.log("key_unpressed: ", event.key);
    });
});
export {winnerjs, loserjs};