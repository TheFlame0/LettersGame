const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const questionsFile = path.join(__dirname, 'questions.json');
let questionsData = {};
if (fs.existsSync(questionsFile)) {
  questionsData = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,   // Ping client every 10s
  pingTimeout: 30000,    // Wait 30s before considering client dead
});

// Reverse lookup: socket.id -> playerId
const socketToPlayer = {};

// Helper: find player entry by socket.id
function findPlayer(socketId) {
  const playerId = socketToPlayer[socketId];
  if (playerId && gameState.players[playerId]) {
    return { playerId, player: gameState.players[playerId] };
  }
  return null;
}

app.use(express.static(path.join(__dirname, 'public')));

// ─── Arabic Letters ───
const ARABIC_LETTERS = [
  'أ','ب','ت','ث','ج','ح','خ','د',
  'ذ','ر','ز','س','ش','ص','ض','ط',
  'ظ','ع','غ','ف','ق','ك','ل','م',
  'ن','هـ','و','ي'
];

// ─── Game State ───
let gameState = {
  phase: 'LOBBY',
  board: [],
  players: {},
  currentLetter: null,
  currentQuestion: null,
  currentTeam: null,
  buzzedPlayer: null,
  buzzedTeam: null,
  timer: null,
  timerEnd: null,
  winner: null,
  roundWins: { green: 0, orange: 0 },
  lastCorrectAction: null,
  gameSettings: { timerSeconds: 7, gridSize: 5 },
};

function initBoard() {
  const size = gameState.gameSettings.gridSize;
  const totalCells = size * size;
  const shuffled = [...ARABIC_LETTERS].sort(() => Math.random() - 0.5);
  // If grid needs more than 28 letters, cycle through them
  const letters = [];
  for (let i = 0; i < totalCells; i++) {
    letters.push(shuffled[i % shuffled.length]);
  }
  gameState.board = letters.map((letter, i) => ({ letter, owner: null, index: i }));
}

function getPublicState() {
  // Strip socketId from player data before sending to clients
  const safePlayers = {};
  for (const [pid, p] of Object.entries(gameState.players)) {
    safePlayers[pid] = {
      name: p.name,
      team: p.team,
      role: p.role,
      score: p.score,
      connected: p.connected,
    };
  }
  return {
    phase: gameState.phase,
    board: gameState.board,
    players: safePlayers,
    currentLetter: gameState.currentLetter,
    currentQuestion: gameState.currentQuestion,
    currentTeam: gameState.currentTeam,
    buzzedPlayer: gameState.buzzedPlayer,
    buzzedTeam: gameState.buzzedTeam,
    winner: gameState.winner,
    roundWins: gameState.roundWins,
    timerEnd: gameState.timerEnd,
    serverTime: Date.now(),
    canUndo: !!gameState.lastCorrectAction,
    gameSettings: gameState.gameSettings,
  };
}

function startTimer() {
  const ms = gameState.gameSettings.timerSeconds * 1000;
  gameState.timerEnd = Date.now() + ms;
  gameState.timer = setTimeout(() => {
    // Timer expired — hand control to referee (no auto-pass)
    gameState.phase = 'REFEREE_DECISION';
    gameState.timerEnd = null;
    io.emit('game_state', getPublicState());
  }, ms);
}

function clearTimer() {
  if (gameState.timer) {
    clearTimeout(gameState.timer);
    gameState.timer = null;
    gameState.timerEnd = null;
  }
}

function resetTurn(winnerTeam = null) {
  clearTimer();
  gameState.phase = 'IDLE';
  gameState.currentLetter = null;
  gameState.currentQuestion = null;
  gameState.buzzedPlayer = null;
  gameState.buzzedTeam = null;
  
  if (winnerTeam) {
    // The team that won the letter keeps the turn
    gameState.currentTeam = winnerTeam;
  } else {
    // If no one won (both failed), flip the turn to the other team
    gameState.currentTeam = gameState.currentTeam === 'green' ? 'orange' : 'green';
  }
}

function checkWinner() {
  const size = gameState.gameSettings.gridSize;
  
  const getNeighbors = (r, c) => {
    const neighbors = [[r, c - 1], [r, c + 1]];
    if (Math.abs(r) % 2 === 0) {
      neighbors.push([r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]);
    } else {
      neighbors.push([r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]);
    }
    return neighbors.filter(([nr, nc]) => nr >= 0 && nr < size && nc >= 0 && nc < size);
  };

  const hasPath = (team, isWinNode) => {
    let queue = [];
    let visited = new Set();
    
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        if (gameState.board[idx].owner === team) {
          if ((team === 'green' && c === 0) || (team === 'orange' && r === 0)) {
            queue.push([r, c]);
            visited.add(`${r},${c}`);
          }
        }
      }
    }

    while (queue.length > 0) {
      const [r, c] = queue.shift();
      if (isWinNode(r, c)) return true;

      for (const [nr, nc] of getNeighbors(r, c)) {
        const nIdx = nr * size + nc;
        if (gameState.board[nIdx].owner === team) {
          const key = `${nr},${nc}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push([nr, nc]);
          }
        }
      }
    }
    return false;
  };

  let roundWinner = null;
  if (hasPath('green', (r, c) => c === size - 1)) {
    roundWinner = 'green';
  } else if (hasPath('orange', (r, c) => r === size - 1)) {
    roundWinner = 'orange';
  }

  if (roundWinner) {
    gameState.roundWins[roundWinner]++;
    
    // Check if total game winner
    if (gameState.roundWins[roundWinner] >= 3) {
      gameState.winner = roundWinner;
      gameState.phase = 'GAME_OVER';
    } else {
      // Refresh board for new round but keep overall state
      initBoard();
      // Round winner starts the next round?
      gameState.currentTeam = roundWinner; 
      gameState.phase = 'IDLE'; 
      // Individual player scores are NOT reset here (as per user: "still show how many a player answer how many question")
    }
  }
}

initBoard();

// ─── Socket Handlers ───
io.on('connection', (socket) => {
  // Send current state on connect
  socket.emit('game_state', getPublicState());

  socket.on('join', ({ name, team, role, playerId }) => {
    const resolvedTeam = (role === 'referee' || role === 'display') ? null : team;
    
    if (playerId && gameState.players[playerId]) {
      // ── Reconnection: restore existing player ──
      const existing = gameState.players[playerId];
      existing.socketId = socket.id;
      existing.connected = true;
      // Update name/team/role in case they changed (unlikely but safe)
      existing.name = name;
      // Don't reset score!
      socketToPlayer[socket.id] = playerId;
      console.log(`🔄 Player reconnected: ${name} (${playerId})`);
    } else {
      // ── New player ──
      const pid = playerId || `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      gameState.players[pid] = {
        name,
        team: resolvedTeam,
        role,
        score: 0,
        socketId: socket.id,
        connected: true,
      };
      socketToPlayer[socket.id] = pid;
      // Tell the client their assigned playerId
      socket.emit('assigned_id', pid);
      console.log(`🆕 New player joined: ${name} (${pid})`);
    }
    io.emit('game_state', getPublicState());
  });

  // Referee changes game settings (only in LOBBY)
  socket.on('update_settings', (settings) => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    if (gameState.phase !== 'LOBBY') return;

    if (settings.timerSeconds && [5, 7].includes(settings.timerSeconds)) {
      gameState.gameSettings.timerSeconds = settings.timerSeconds;
    }
    if (settings.gridSize && [4, 5, 6, 7].includes(settings.gridSize)) {
      gameState.gameSettings.gridSize = settings.gridSize;
      initBoard(); // Regenerate board with new size
    }
    io.emit('game_state', getPublicState());
  });

  socket.on('start_game', () => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    initBoard(); // Ensure board matches current settings
    gameState.phase = 'IDLE';
    gameState.currentTeam = Math.random() < 0.5 ? 'green' : 'orange';
    io.emit('game_state', getPublicState());
  });

  socket.on('select_letter', (index) => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    if (index < 0 || index >= gameState.board.length || gameState.board[index].owner) return;

    // De-select: click same letter again or click during BUZZING
    if (gameState.phase === 'BUZZING' || (gameState.phase === 'IDLE' && gameState.currentLetter === index)) {
      gameState.currentLetter = null;
      gameState.currentQuestion = null;
      gameState.phase = 'IDLE';
      io.emit('game_state', getPublicState());
      return;
    }

    if (gameState.phase !== 'IDLE') return;
    gameState.currentLetter = index;
    gameState.phase = 'BUZZING';
    
    // Pick random question for this letter
    const letterChar = gameState.board[index].letter;
    const letterQuestions = questionsData[letterChar] || [{ q: `سؤال لحرف ${letterChar}`, a: letterChar }];
    gameState.currentQuestion = letterQuestions[Math.floor(Math.random() * letterQuestions.length)];

    io.emit('game_state', getPublicState());
  });

  socket.on('buzz', () => {
    if (gameState.phase !== 'BUZZING') return;
    const found = findPlayer(socket.id);
    if (!found || found.player.role === 'referee') return;
    gameState.buzzedPlayer = found.playerId; // Store persistent ID
    gameState.buzzedTeam = found.player.team;
    gameState.phase = 'ANSWERING';
    startTimer();
    // Play buzz sound only on: buzzer's phone, referees, and display screens
    socket.emit('buzz_alert'); // The buzzer themselves
    for (const [pid, p] of Object.entries(gameState.players)) {
      if ((p.role === 'referee' || p.role === 'display') && p.connected && p.socketId) {
        io.to(p.socketId).emit('buzz_alert');
      }
    }
    io.emit('game_state', getPublicState());
  });

  socket.on('judge', (correct) => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    if (gameState.phase !== 'ANSWERING' && gameState.phase !== 'REFEREE_DECISION') return;

    clearTimer();

    if (correct) {
      gameState.board[gameState.currentLetter].owner = gameState.buzzedTeam;
      // buzzedPlayer is now a playerId, not socket.id
      if (gameState.buzzedPlayer && gameState.players[gameState.buzzedPlayer]) {
        gameState.players[gameState.buzzedPlayer].score++;
      }
      // Save for potential undo
      gameState.lastCorrectAction = {
        cellIndex: gameState.currentLetter,
        team: gameState.buzzedTeam,
        playerId: gameState.buzzedPlayer,
      };
      checkWinner();
      if (gameState.phase !== 'GAME_OVER') {
        resetTurn(gameState.buzzedTeam);
      }
    } else {
      // Wrong — go to REFEREE_DECISION, referee decides what to do next
      gameState.phase = 'REFEREE_DECISION';
      gameState.timerEnd = null;
    }
    io.emit('game_state', getPublicState());
  });

  // Referee passes the question to the other team
  socket.on('pass_to_other', () => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    if (gameState.phase !== 'REFEREE_DECISION') return;

    gameState.buzzedTeam = gameState.buzzedTeam === 'green' ? 'orange' : 'green';
    gameState.buzzedPlayer = null;
    gameState.phase = 'ANSWERING';
    startTimer();
    io.emit('game_state', getPublicState());
  });

  // Referee skips the letter entirely (no team wins it)
  socket.on('skip_letter', () => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    if (gameState.phase !== 'REFEREE_DECISION') return;

    resetTurn(); // no winner, flip turn
    io.emit('game_state', getPublicState());
  });

  // Referee changes the question for the current letter
  socket.on('change_question', () => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    if (!gameState.currentLetter && gameState.currentLetter !== 0) return;

    const letterChar = gameState.board[gameState.currentLetter].letter;
    const letterQuestions = questionsData[letterChar] || [{ q: `سؤال لحرف ${letterChar}`, a: letterChar }];
    gameState.currentQuestion = letterQuestions[Math.floor(Math.random() * letterQuestions.length)];
    io.emit('game_state', getPublicState());
  });

  // Referee undoes the last correct answer
  socket.on('undo_correct', () => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    if (!gameState.lastCorrectAction) return;

    const action = gameState.lastCorrectAction;
    // Remove ownership from the cell
    if (gameState.board[action.cellIndex]) {
      gameState.board[action.cellIndex].owner = null;
    }
    // Decrement the player's score
    if (action.playerId && gameState.players[action.playerId]) {
      gameState.players[action.playerId].score = Math.max(0, gameState.players[action.playerId].score - 1);
    }
    gameState.lastCorrectAction = null;
    // Re-check winner state (the undo might invalidate a previous round win)
    // For simplicity, just broadcast updated state
    io.emit('game_state', getPublicState());
  });

  socket.on('reset_game', () => {
    const found = findPlayer(socket.id);
    if (!found || found.player.role !== 'referee') return;
    clearTimer();
    initBoard();
    // Reset scores but keep players
    Object.values(gameState.players).forEach(pl => pl.score = 0);
    gameState.roundWins = { green: 0, orange: 0 };
    gameState.phase = 'LOBBY';
    gameState.currentLetter = null;
    gameState.currentQuestion = null;
    gameState.currentTeam = null;
    gameState.buzzedPlayer = null;
    gameState.buzzedTeam = null;
    gameState.winner = null;
    gameState.lastCorrectAction = null;
    io.emit('game_state', getPublicState());
  });

  socket.on('disconnect', () => {
    // Mark player offline instead of deleting
    const found = findPlayer(socket.id);
    if (found) {
      found.player.connected = false;
      found.player.socketId = null;
      console.log(`📴 Player disconnected: ${found.player.name} (${found.playerId})`);
    }
    delete socketToPlayer[socket.id];
    io.emit('game_state', getPublicState());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 حروف Game Server running on http://localhost:${PORT}`);
});
