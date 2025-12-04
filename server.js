const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// CONFIG
const GAMES = {
    normal: { mapSize: 3000, barrierCount: 40, itemMax: 60, barriers: [], items: [], bullets: [], mines: [], players: {} },
    rescue: { mapSize: 4000, barrierCount: 0, itemMax: 40, barriers: [], items: [], bullets: [], mines: [], players: {}, aliens: [], bossActive: false }
};

const CLASSES = {
    square:   { name: 'Assault', health: 100, speed: 6, damage: 15, size: 40, cd: 1000 },
    tank:     { name: 'Heavy',   health: 180, speed: 4, damage: 20, size: 55, cd: 2000 },
    triangle: { name: 'Sniper',  health: 70,  speed: 7, damage: 35, size: 35, cd: 800 },
    scout:    { name: 'Speed',   health: 60,  speed: 9, damage: 10, size: 30, cd: 500 }
};

function generateArenaMap(game) {
    game.barriers = [];
    for (let i = 0; i < game.barrierCount; i++) {
        game.barriers.push({
            x: Math.floor(Math.random() * (game.mapSize - 200)),
            y: Math.floor(Math.random() * (game.mapSize - 200)),
            w: Math.floor(Math.random() * 150) + 50,
            h: Math.floor(Math.random() * 150) + 50
        });
    }
}
function generateDungeonMap(game) {
    game.barriers = [];
    game.barriers.push({x:-50,y:-50,w:game.mapSize+100,h:50}); // Top
    game.barriers.push({x:-50,y:game.mapSize,w:game.mapSize+100,h:50}); // Bot
    game.barriers.push({x:-50,y:0,w:50,h:game.mapSize}); // Left
    game.barriers.push({x:game.mapSize,y:0,w:50,h:game.mapSize}); // Right
}
generateArenaMap(GAMES.normal);
generateDungeonMap(GAMES.rescue);

function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x2 < x1 + w1 && x2 + w2 > x1 && y2 < y1 + h1 && y2 + h2 > y1;
}
function checkCollision(game, x, y, size) {
    if (x < 0 || x + size > game.mapSize || y < 0 || y + size > game.mapSize) return true;
    for (let b of game.barriers) {
        if (rectIntersect(x, y, size, size, b.x, b.y, b.w, b.h)) return true;
    }
    return false;
}
function getSafeSpawn(game) {
    let x, y, valid = false, attempts = 0;
    while(!valid && attempts < 200) {
        x = Math.random() * (game.mapSize - 100); y = Math.random() * (game.mapSize - 100);
        valid = !checkCollision(game, x, y, 40); attempts++;
    }
    return valid ? { x, y } : { x: 200, y: 200 };
}
function spawnItem(game, x, y, type) {
    if(!type) {
        let r = Math.random();
        type = r<0.35?'coin':(r<0.6?'health':(r<0.75?'speed':'shield'));
    }
    game.items.push({ id: Math.random().toString(36).substr(2,9), x: x||Math.random()*(game.mapSize-100), y: y||Math.random()*(game.mapSize-100), type: type });
}
function spawnEnemy(game, type, x, y) {
    let id = Math.random().toString(36).substr(2,9);
    let s = getSafeSpawn(game);
    game.aliens.push({
        id: id, x: x||s.x, y: y||s.y, type: type, lastShot: 0,
        speed: type==='scout'?8:4, health: type==='boss'?3000:100, maxHealth: type==='boss'?3000:100,
        size: type==='boss'?120:40, color: type==='boss'?'purple':'red' 
    });
}
for(let i=0; i<GAMES.normal.itemMax; i++) spawnItem(GAMES.normal);

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        let cls = CLASSES[data.shape] || CLASSES.square;
        let mode = (data.mode==='rescue') ? 'rescue' : 'normal';
        let game = GAMES[mode];
        socket.join(mode);
        
        let spawn = getSafeSpawn(game);
        if(mode==='rescue') { spawn.x=game.mapSize/2; spawn.y=game.mapSize-600; }

        game.players[socket.id] = {
            id: socket.id, name: (data.name||"Agent").substring(0,12), color: data.color, shape: data.shape,
            x: spawn.x, y: spawn.y, 
            health: cls.health, maxHealth: cls.health, coins: 0,
            speed: cls.speed, baseSpeed: cls.speed, damage: cls.damage,
            buffs: { speed: 0, shield: 0 }, mineCount: 0, size: cls.size, 
            dead: false, respawnTimer: 0
        };
        socket.emit('init', { id: socket.id, players: game.players, barriers: game.barriers, items: game.items, mines: game.mines, mapSize: game.mapSize });
    });

    socket.on('playerMovement', (data) => {
        let mode = GAMES.normal.players[socket.id] ? 'normal' : (GAMES.rescue.players[socket.id] ? 'rescue' : null);
        if(!mode) return;
        let game = GAMES[mode];
        let p = game.players[socket.id];
        if(!p || p.dead) return;

        let dist = Math.sqrt((data.x - p.x)**2 + (data.y - p.y)**2);
        if (dist > 50) { socket.emit('correction', { x: p.x, y: p.y }); return; }

        if (!checkCollision(game, data.x, p.y, p.size)) p.x = data.x;
        if (!checkCollision(game, p.x, data.y, p.size)) p.y = data.y;
        p.x = Math.max(0, Math.min(p.x, game.mapSize - p.size));
        p.y = Math.max(0, Math.min(p.y, game.mapSize - p.size));
    });

    socket.on('shoot', (angle) => {
        let mode = GAMES.normal.players[socket.id] ? 'normal' : (GAMES.rescue.players[socket.id] ? 'rescue' : null);
        if(!mode) return;
        let p = GAMES[mode].players[socket.id];
        if(p && !p.dead) {
            GAMES[mode].bullets.push({ x: p.x+p.size/2, y: p.y+p.size/2, dx: Math.cos(angle)*18, dy: Math.sin(angle)*18, owner: socket.id, damage: p.damage, color: p.color });
        }
    });

    socket.on('buyUpgrade', (type) => {
        let mode = GAMES.normal.players[socket.id] ? 'normal' : (GAMES.rescue.players[socket.id] ? 'rescue' : null);
        if(!mode) return;
        let p = GAMES[mode].players[socket.id];
        if(p && !p.dead && p.coins >= 50) {
             if(type==='health') { p.health+=50; p.coins-=50; }
             if(type==='damage') { p.damage+=5; p.coins-=50; }
             if(type==='mine') { p.mineCount++; p.coins-=30; }
        }
    });

    socket.on('disconnect', () => {
        delete GAMES.normal.players[socket.id];
        delete GAMES.rescue.players[socket.id];
    });
});

setInterval(() => {
    ['normal', 'rescue'].forEach(mode => {
        let game = GAMES[mode];
        
        // NPC Logic
        if (mode === 'rescue') {
            if (Math.random() < 0.01 && game.aliens.length < 15 && !game.bossActive) {
                let pIds = Object.keys(game.players);
                if (pIds.length > 0) {
                    let type = Math.random() > 0.8 ? 'tank' : 'scout';
                    spawnEnemy(game, type);
                }
            }
            if (!game.bossActive && Object.values(game.players).some(p => p.y < 600)) {
                spawnEnemy(game, 'boss', game.mapSize/2, 200);
                game.bossActive = true;
                io.to(mode).emit('bossSpawn');
            }
            game.aliens.forEach(alien => {
                let nearest = null, minDst = 2000;
                for(let pid in game.players) {
                    let p = game.players[pid];
                    if(p.dead) continue;
                    let d = Math.hypot(p.x-alien.x, p.y-alien.y);
                    if(d < minDst) { minDst = d; nearest = p; }
                }
                if(nearest) {
                    let angle = Math.atan2(nearest.y-alien.y, nearest.x-alien.x);
                    let nx = alien.x + Math.cos(angle)*alien.speed;
                    let ny = alien.y + Math.sin(angle)*alien.speed;
                    if(!checkCollision(game, nx, ny, alien.size)) { alien.x=nx; alien.y=ny; }
                }
            });
        }

        // Bullets
        for(let i=game.bullets.length-1; i>=0; i--) {
            let b = game.bullets[i];
            b.x += b.dx; b.y += b.dy;
            if(checkCollision(game, b.x, b.y, 5)) { game.bullets.splice(i,1); continue; }
            
            // Hit Players
            for(let pid in game.players) {
                let p = game.players[pid];
                if(!p.dead && b.owner !== pid && Math.hypot(b.x-(p.x+p.size/2), b.y-(p.y+p.size/2)) < p.size/2) {
                    p.health -= b.damage;
                    game.bullets.splice(i,1);
                    io.to(mode).emit('dmgText', { x:p.x, y:p.y, txt:-b.damage, color:'red' });
                    if(p.health<=0) {
                        p.dead=true; p.respawnTimer=Date.now()+3000;
                        io.to(mode).emit('playerDied', { x:p.x, y:p.y, color:p.color });
                    }
                    break;
                }
            }
            // Hit Aliens
            if(mode==='rescue') {
                for(let j=game.aliens.length-1; j>=0; j--) {
                    let a = game.aliens[j];
                    if(Math.hypot(b.x-(a.x+a.size/2), b.y-(a.y+a.size/2)) < a.size/2) {
                        a.health -= b.damage;
                        game.bullets.splice(i,1);
                        io.to(mode).emit('dmgText', { x:a.x, y:a.y, txt:-b.damage, color:'white' });
                        if(a.health<=0) {
                            if(a.type==='boss') game.bossActive=false;
                            game.aliens.splice(j,1);
                            if(game.players[b.owner]) game.players[b.owner].coins+=20;
                        }
                        break;
                    }
                }
            }
        }

        // Respawn
        for(let pid in game.players) {
            let p = game.players[pid];
            if(p.dead && Date.now() > p.respawnTimer) {
                p.dead = false; p.health = p.maxHealth;
                let s = getSafeSpawn(game);
                if(mode==='rescue') { s.x=game.mapSize/2; s.y=game.mapSize-600; }
                p.x = s.x; p.y = s.y;
                io.to(pid).emit('correction', { x: p.x, y: p.y });
            }
        }

        io.to(mode).emit('stateUpdate', { players: game.players, bullets: game.bullets, aliens: game.aliens });
    });
}, 1000/30);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Running on ${PORT}`));