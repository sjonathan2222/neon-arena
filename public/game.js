const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimap');
const miniCtx = miniCanvas.getContext('2d');
const socket = io();

const ui = {
    login: document.getElementById('login-screen'),
    hud: document.getElementById('hud'),
    leaderboard: document.getElementById('leaderboard'),
    health: document.getElementById('health-display'),
    coins: document.getElementById('coin-display'),
    mines: document.getElementById('mine-display'),
    shop: document.getElementById('shop-modal'),
    leaderList: document.getElementById('leaderboard-list'),
    chatList: document.getElementById('chat-list'),
    chatInput: document.getElementById('chat-input')
};

let myId = null;
let selectedColor = '#00ff00';
let selectedShape = 'square';
let selectedMode = 'normal'; 
let players = {}, targetPlayers = {};
let bullets = [], barriers = [], items = [], mines = [], particles = [], portals = [], aliens = [], texts = [], trails = [];
let mapSize = 3000;
let gameStarted = false;

// Physics
let justTeleported = false;
let teleportGraceTimer = 0;

// Inputs
let joyMove = { x: 0, y: 0, active: false };
let joyAim = { angle: 0, active: false };
let keys = { w: false, a: false, s: false, d: false };
let mouse = { x: 0, y: 0, down: false };
let lastShot = 0;

// --- SELECTION LOGIC ---
window.selectColor = (color) => {
    selectedColor = color;
    document.querySelectorAll('.c-opt').forEach(el => el.classList.remove('selected'));
    if(event && event.target) event.target.classList.add('selected');
};

window.selectShape = (shape) => {
    selectedShape = shape;
    document.querySelectorAll('.s-opt').forEach(el => el.classList.remove('selected'));
    if(event && event.target) event.target.classList.add('selected');
};

window.selectMode = (mode) => {
    if (mode === 'rescue') return; // LOCKED
    selectedMode = mode;
    document.querySelectorAll('.mode-btn').forEach(el => el.classList.remove('selected'));
    const btn = document.getElementById(`btn-${mode}`);
    if(btn) btn.classList.add('selected');
};

window.joinGame = () => {
    const name = document.getElementById('username').value || "Agent";
    
    try {
        let elem = document.documentElement;
        if (elem.requestFullscreen) { elem.requestFullscreen().catch(()=>{}); }
        else if (elem.webkitRequestFullscreen) { elem.webkitRequestFullscreen(); }
    } catch(e) { console.log("Fullscreen blocked or not supported"); }

    if(socket && socket.connected) {
        socket.emit('joinGame', { name: name, color: selectedColor, shape: selectedShape, mode: selectedMode });
    } else {
        socket.connect();
        socket.emit('joinGame', { name: name, color: selectedColor, shape: selectedShape, mode: selectedMode });
    }

    ui.login.style.display = 'none';
    ui.hud.style.display = 'flex';
    if(document.getElementById('chat-container')) document.getElementById('chat-container').style.display = 'block';
    
    gameStarted = true;
};

// --- CONTROLS ---
window.addEventListener('keydown', e => { 
    if(ui.chatInput && document.activeElement === ui.chatInput) return;
    if(e.key==='w') keys.w=true; if(e.key==='a') keys.a=true; if(e.key==='s') keys.s=true; if(e.key==='d') keys.d=true; 
    if(e.key==='b') toggleShop(); if(e.key===' ') placeMine();
    if(e.key==='Enter') {
        if(ui.chatInput.style.display === 'block') {
            let msg = ui.chatInput.value;
            if(msg) socket.emit('chatMsg', msg);
            ui.chatInput.value = ''; ui.chatInput.style.display = 'none';
        } else {
            ui.chatInput.style.display = 'block'; ui.chatInput.focus();
        }
    }
});
window.addEventListener('keyup', e => { if(e.key==='w') keys.w=false; if(e.key==='a') keys.a=false; if(e.key==='s') keys.s=false; if(e.key==='d') keys.d=false; });
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', () => mouse.down = true);
window.addEventListener('mouseup', () => mouse.down = false);

window.toggleShop = () => ui.shop.style.display = ui.shop.style.display === 'none' ? 'block' : 'none';
window.buy = (type) => socket.emit('buyUpgrade', type);
window.placeMine = () => socket.emit('placeMine');

// --- SAFE MOBILE INIT ---
if(window.innerWidth < 1024 && typeof nipplejs !== 'undefined') {
    try {
        const leftM = nipplejs.create({ zone: document.getElementById('zone-left'), mode: 'static', position: { left: '50%', top: '50%' }, color: 'cyan', size: 100 });
        leftM.on('move', (evt, d) => { if(d.angle) { joyMove.active=true; joyMove.x=Math.cos(d.angle.radian); joyMove.y=-Math.sin(d.angle.radian); }});
        leftM.on('end', () => joyMove.active = false);

        const rightM = nipplejs.create({ zone: document.getElementById('zone-right'), mode: 'static', position: { left: '50%', top: '50%' }, color: 'red', size: 100 });
        rightM.on('move', (evt, d) => { if(d.angle) { joyAim.active=true; joyAim.angle=-d.angle.radian; }});
        rightM.on('end', () => joyAim.active = false);
    } catch(e) { console.error("Joystick Error:", e); }
}

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
window.addEventListener('resize', resize);
resize();

// --- SOCKET EVENTS ---
socket.on('init', (data) => {
    myId = data.id;
    players = data.players;
    targetPlayers = JSON.parse(JSON.stringify(data.players));
    barriers = data.barriers;
    items = data.items;
    mines = data.mines;
    portals = data.portals || [];
    mapSize = data.mapSize;
});

socket.on('stateUpdate', (data) => {
    targetPlayers = data.players;
    bullets = data.bullets; 
    aliens = data.aliens || []; 
    for(let id in players) if(!targetPlayers[id]) delete players[id];
});

socket.on('itemsUpdate', (data) => items = data);
socket.on('updateMines', (data) => mines = data);
socket.on('chatMsg', (data) => {
    let li = document.createElement('li');
    li.innerHTML = `<span style="color:${data.color}">${data.name}:</span> ${data.msg}`;
    ui.chatList.appendChild(li);
    ui.chatList.scrollTop = ui.chatList.scrollHeight;
});
socket.on('leaderboardUpdate', (list) => {
    if(ui.leaderList) ui.leaderList.innerHTML = list.map(p => `<li>${p.name}: <span style="color:#ffd700">${p.coins}</span></li>`).join('');
});
socket.on('playerDied', (data) => createExplosion(data.x, data.y, data.color));
socket.on('dmgText', (data) => {
    if(texts) texts.push({x: data.x, y: data.y, txt: data.txt, color: data.color, life: 1.0});
});
socket.on('bossSpawn', () => {
    const w = document.getElementById('boss-warning');
    if(w) { w.style.display='block'; setTimeout(()=>w.style.display='none', 4000); }
});
socket.on('correction', (data) => { 
    if(players[myId]) { 
        let dist = Math.sqrt((players[myId].x - data.x)**2 + (players[myId].y - data.y)**2);
        players[myId].x = data.x; players[myId].y = data.y; 
        if (dist > 100) { justTeleported = true; teleportGraceTimer = Date.now() + 1000; }
    } 
});

// --- HELPER FUNCTIONS ---
function checkCollision(nextX, nextY, size) {
    if (justTeleported && Date.now() < teleportGraceTimer) return false;
    for(let b of barriers) {
        if (nextX < b.x + b.w && nextX + size > b.x && nextY < b.y + b.h && nextY + size > b.y) return true;
    }
    return false;
}
function lerp(s, e, t) { return s * (1 - t) + e * t; }
function lerpAngle(s, e, t) {
    let d = e - s; while (d < -Math.PI) d += Math.PI * 2; while (d > Math.PI) d -= Math.PI * 2;
    return s + d * t;
}
function createExplosion(x, y, color) {
    for(let i=0; i<15; i++) particles.push({ x: x, y: y, vx: (Math.random()-0.5)*12, vy: (Math.random()-0.5)*12, life: 1.0, color: color });
}

function drawCharacter(ctx, x, y, size, color, shape, angle) {
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.shadowBlur = 10; ctx.shadowColor = color;

    ctx.beginPath();
    if (shape === 'circle') ctx.arc(0, 0, size/2, 0, Math.PI*2);
    else if (shape === 'triangle') { ctx.moveTo(size/2, 0); ctx.lineTo(-size/2, size/2); ctx.lineTo(-size/2, -size/2); }
    else if (shape === 'pentagon') for(let i=0;i<5;i++) ctx.lineTo(size/2*Math.cos(i*2*Math.PI/5), size/2*Math.sin(i*2*Math.PI/5));
    else ctx.rect(-size/2, -size/2, size, size); 
    
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(0, -size/4, size/2, size/2);
    ctx.restore();
}

function drawMinimap(p) {
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    miniCtx.fillStyle = '#001'; miniCtx.fillRect(0,0,miniCanvas.width,miniCanvas.height);
    const s = miniCanvas.width / mapSize;
    
    miniCtx.fillStyle = '#444'; 
    for(let b of barriers) miniCtx.fillRect(b.x*s, b.y*s, b.w*s, b.h*s);
    
    for(let id in players) {
        if(players[id].dead) continue;
        miniCtx.fillStyle = (id === myId) ? '#fff' : players[id].color;
        let x = players[id].x*s, y = players[id].y*s;
        miniCtx.beginPath(); miniCtx.arc(x, y, (id===myId?3:2), 0, Math.PI*2); miniCtx.fill();
    }
    
    miniCtx.strokeStyle = 'rgba(255,255,255,0.2)'; miniCtx.lineWidth=1;
    miniCtx.strokeRect((p.x*s) - (canvas.width/2*s), (p.y*s) - (canvas.height/2*s), canvas.width*s, canvas.height*s);
}

function update() {
    if (!gameStarted || !myId || !players[myId]) return;
    let p = players[myId];
    let t = targetPlayers[myId];

    if (t) {
        p.dead = t.dead; p.respawnTimer = t.respawnTimer;
        p.health = t.health; p.coins = t.coins; p.maxHealth = t.maxHealth;
        p.mineCount = t.mineCount;
    }
    if (p.dead) return;

    if (typeof p.vx === 'undefined') { p.vx=0; p.vy=0; p.aimAngle=0; }
    let inputX = 0, inputY = 0;
    
    if (joyMove.active) { inputX = joyMove.x; inputY = joyMove.y; } 
    else { 
        if (keys.w) inputY -= 1; if (keys.s) inputY += 1;
        if (keys.a) inputX -= 1; if (keys.d) inputX += 1;
        if (inputX !== 0 || inputY !== 0) { let l = Math.sqrt(inputX**2+inputY**2); inputX/=l; inputY/=l; }
    }

    p.vx += inputX * 1.5; p.vy += inputY * 1.5;
    p.vx *= 0.85; p.vy *= 0.85;

    let nextX = Math.max(0, Math.min(p.x + p.vx, mapSize - p.size));
    if (!checkCollision(nextX, p.y, p.size)) p.x = nextX; else p.vx = 0;
    
    let nextY = Math.max(0, Math.min(p.y + p.vy, mapSize - p.size));
    if (!checkCollision(p.x, nextY, p.size)) p.y = nextY; else p.vy = 0;

    if (Math.abs(p.vx)>0.1 || Math.abs(p.vy)>0.1) socket.emit('playerMovement', { x: p.x, y: p.y });

    let targetAngle = p.aimAngle;
    if (joyAim.active) targetAngle = joyAim.angle;
    else if (window.innerWidth >= 1024) {
        let camX = (p.x + p.size/2) - canvas.width/2;
        let camY = (p.y + p.size/2) - canvas.height/2;
        targetAngle = Math.atan2((mouse.y + camY) - (p.y+p.size/2), (mouse.x + camX) - (p.x+p.size/2));
    }
    p.aimAngle = lerpAngle(p.aimAngle, targetAngle, 0.3);

    let shooting = joyAim.active || (window.innerWidth >= 1024 && mouse.down);
    if (shooting && Date.now() - lastShot > 150) {
        socket.emit('shoot', targetAngle);
        bullets.push({ x: p.x+p.size/2, y: p.y+p.size/2, dx: Math.cos(targetAngle)*18, dy: Math.sin(targetAngle)*18, color: p.color, local: true });
        lastShot = Date.now();
    }

    if ((Math.abs(p.vx) + Math.abs(p.vy)) > 3) {
        trails.push({ x: p.x, y: p.y, size: p.size, color: p.color, shape: p.shape, life: 0.4 });
    }

    ui.health.innerText = Math.ceil(p.health) + "/" + p.maxHealth;
    ui.coins.innerText = p.coins;
    ui.mines.innerText = p.mineCount;

    for(let id in targetPlayers) {
        if(id !== myId) {
            let cur = players[id] = players[id] || targetPlayers[id];
            cur.x = lerp(cur.x, targetPlayers[id].x, 0.2);
            cur.y = lerp(cur.y, targetPlayers[id].y, 0.2);
            cur.aimAngle = lerpAngle(cur.aimAngle || 0, targetPlayers[id].aimAngle || 0, 0.2);
            if (targetPlayers[id].x !== cur.x || targetPlayers[id].y !== cur.y) {
                 trails.push({ x: cur.x, y: cur.y, size: cur.size, color: cur.color, shape: cur.shape, life: 0.4 });
            }
        }
    }
}

// Manually bind events
window.addEventListener('DOMContentLoaded', () => {
    const btnNormal = document.getElementById('btn-normal');
    if(btnNormal) {
        btnNormal.ontouchstart = (e) => { e.preventDefault(); selectMode('normal'); };
        btnNormal.onclick = () => selectMode('normal');
    }
});

function draw() {
    if (!gameStarted || !myId || !players[myId]) return;
    let p = players[myId];
    let camX = (p.x + p.size/2) - canvas.width/2;
    let camY = (p.y + p.size/2) - canvas.height/2;

    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = '#112222'; ctx.lineWidth = 1;
    let gs = 100, ox = -camX % gs, oy = -camY % gs;
    ctx.beginPath();
    for (let x=ox; x<canvas.width; x+=gs) { ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); }
    for (let y=oy; y<canvas.height; y+=gs) { ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); }
    ctx.stroke();

    ctx.strokeStyle = 'red'; ctx.lineWidth = 5; ctx.strokeRect(-camX, -camY, mapSize, mapSize);

    for(let i=trails.length-1; i>=0; i--) {
        let t = trails[i]; t.life -= 0.05;
        if(t.life <= 0) { trails.splice(i,1); continue; }
        ctx.globalAlpha = t.life * 0.4;
        drawCharacter(ctx, t.x-camX, t.y-camY, t.size, t.color, t.shape, 0);
    }
    ctx.globalAlpha = 1;

    ctx.shadowBlur = 10; ctx.shadowColor = '#00ffff'; ctx.fillStyle = '#002'; ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 2;
    for(let b of barriers) { ctx.fillRect(b.x-camX, b.y-camY, b.w, b.h); ctx.strokeRect(b.x-camX, b.y-camY, b.w, b.h); }
    ctx.shadowBlur = 0;

    for(let i of items) {
        ctx.fillStyle = (i.type==='coin'?'gold':(i.type==='health'?'red':'cyan'));
        ctx.beginPath(); ctx.arc(i.x-camX, i.y-camY, 8, 0, Math.PI*2); ctx.fill();
    }

    for(let m of mines) { ctx.fillStyle = (m.owner===myId?'lime':'red'); ctx.beginPath(); ctx.arc(m.x-camX, m.y-camY, 8, 0, Math.PI*2); ctx.fill(); }

    for(let pt of particles) { pt.x+=pt.vx; pt.y+=pt.vy; pt.life-=0.05; ctx.globalAlpha=pt.life; ctx.fillStyle=pt.color; ctx.fillRect(pt.x-camX, pt.y-camY, 4, 4); }
    ctx.globalAlpha=1;

    for(let b of bullets) {
        ctx.fillStyle = b.color || '#fff'; 
        ctx.beginPath(); ctx.arc(b.x-camX, b.y-camY, 4, 0, Math.PI*2); ctx.fill();
        if(b.local) { b.x+=b.dx; b.y+=b.dy; }
    }

    for(let a of aliens) {
        drawCharacter(ctx, a.x-camX, a.y-camY, a.size, a.color, (a.type==='boss'?'octagon':'square'), 0);
        ctx.fillStyle='red'; ctx.fillRect(a.x-camX, a.y-camY-10, a.size, 4);
        ctx.fillStyle='#0f0'; ctx.fillRect(a.x-camX, a.y-camY-10, a.size*(a.health/a.maxHealth), 4);
    }

    for(let id in players) {
        let pl = players[id]; if(pl.dead) continue;
        drawCharacter(ctx, pl.x-camX, pl.y-camY, pl.size, pl.color, pl.shape, pl.aimAngle);
        ctx.shadowBlur=0;
        ctx.fillStyle='white'; ctx.font='10px Arial'; ctx.fillText(pl.name, pl.x-camX, pl.y-camY-15);
        ctx.fillStyle='red'; ctx.fillRect(pl.x-camX, pl.y-camY-10, pl.size, 4);
        ctx.fillStyle='#0f0'; ctx.fillRect(pl.x-camX, pl.y-camY-10, pl.size*(pl.health/pl.maxHealth), 4);
    }

    for(let i=texts.length-1; i>=0; i--) {
        let t = texts[i]; t.y-=0.5; t.life-=0.02;
        if(t.life<=0) texts.splice(i,1);
        else { ctx.fillStyle=t.color; ctx.font='bold 14px Arial'; ctx.fillText(t.txt, t.x-camX, t.y-camY); }
    }

    if(p.dead) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = 'red'; ctx.font='30px Orbitron'; ctx.fillText("CRITICAL FAILURE", canvas.width/2-140, canvas.height/2);
        ctx.fillStyle = 'white'; ctx.font='16px Orbitron'; 
        let t = Math.ceil((p.respawnTimer - Date.now())/1000);
        ctx.fillText(`Rebooting system in ${Math.max(0,t)}...`, canvas.width/2-100, canvas.height/2+40);
    }

    drawMinimap(p);
}

function loop() { update(); draw(); requestAnimationFrame(loop); }
loop();