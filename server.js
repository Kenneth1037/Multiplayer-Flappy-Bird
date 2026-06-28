const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve index.html from root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const COLORS = ['#f5c842','#ff6b6b','#6bcbff','#a8ff6b','#ff9f43','#d98fff','#ff6bce','#6bffda'];
const GAME_STATE = { LOBBY: 'lobby', PLAYING: 'playing', SCOREBOARD: 'scoreboard' };

let room = createRoom();

function createRoom() {
  return { state: GAME_STATE.LOBBY, players: {}, hostId: null, pipeSeed: 0, gameStartTime: 0, colorIndex: 0 };
}
function getPlayer(id) { return room.players[id]; }
function assignColor() { const c = COLORS[room.colorIndex % COLORS.length]; room.colorIndex++; return c; }

function broadcastLobby() {
  const playerList = Object.values(room.players).map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready }));
  io.emit('lobby_update', { players: playerList, hostId: room.hostId, state: room.state });
}

function checkAllDead() {
  const alive = Object.values(room.players).filter(p => p.alive);
  if (alive.length === 0) {
    room.state = GAME_STATE.SCOREBOARD;
    const scores = Object.values(room.players).map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })).sort((a, b) => b.score - a.score);
    io.emit('game_over', { scores });
  }
}

io.on('connection', (socket) => {
  const isSpectator = room.state === GAME_STATE.PLAYING;
  const player = { id: socket.id, name: 'Bird ' + (Object.keys(room.players).length + 1), color: assignColor(), ready: false, alive: false, score: 0, y: 256, angle: 0, spectator: isSpectator };
  room.players[socket.id] = player;
  if (!room.hostId) room.hostId = socket.id;
  socket.emit('welcome', { id: socket.id, color: player.color, isHost: room.hostId === socket.id, isSpectator, state: room.state });
  broadcastLobby();

  socket.on('set_name', (name) => {
    if (!getPlayer(socket.id)) return;
    getPlayer(socket.id).name = String(name).slice(0, 20) || player.name;
    broadcastLobby();
  });

  socket.on('start_game', () => {
    if (socket.id !== room.hostId) return;
    if (room.state !== GAME_STATE.LOBBY && room.state !== GAME_STATE.SCOREBOARD) return;
    room.state = GAME_STATE.PLAYING;
    room.pipeSeed = Math.floor(Math.random() * 1e9);
    room.colorIndex = 0;
    Object.values(room.players).forEach(p => { p.alive = true; p.score = 0; p.y = 256; p.angle = 0; p.spectator = false; p.color = assignColor(); });
    room.colorIndex = Object.keys(room.players).length;
    io.emit('game_start', { pipeSeed: room.pipeSeed, serverTime: Date.now() });
    broadcastLobby();
  });

  socket.on('position', ({ y, angle, score }) => {
    const p = getPlayer(socket.id);
    if (!p || !p.alive) return;
    p.y = y; p.angle = angle; p.score = score;
    socket.broadcast.emit('player_update', { id: socket.id, y, angle, score });
  });

  socket.on('player_died', ({ score }) => {
    const p = getPlayer(socket.id);
    if (!p || !p.alive) return;
    p.alive = false; p.score = score;
    io.emit('player_died', { id: socket.id, score });
    checkAllDead();
  });

  socket.on('back_to_lobby', () => {
    if (socket.id !== room.hostId) return;
    room.state = GAME_STATE.LOBBY;
    broadcastLobby();
  });

  socket.on('disconnect', () => {
    delete room.players[socket.id];
    if (room.hostId === socket.id) {
      const remaining = Object.keys(room.players);
      room.hostId = remaining.length > 0 ? remaining[0] : null;
      if (room.hostId) io.to(room.hostId).emit('you_are_host');
    }
    if (room.state === GAME_STATE.PLAYING) checkAllDead();
    io.emit('player_left', { id: socket.id });
    broadcastLobby();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Flappy Bird server running on port ' + PORT));
