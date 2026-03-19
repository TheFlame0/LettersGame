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
const io = new Server(server);

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
};

function initBoard() {
  const shuffled = [...ARABIC_LETTERS].sort(() => Math.random() - 0.5);
  // Pick exactly 25 letters for a 5x5 grid
  const selectedLetters = shuffled.slice(0, 25);
  gameState.board = selectedLetters.map((letter, i) => ({ letter, owner: null, index: i }));
}

function getPublicState() {
  return {
    phase: gameState.phase,
    board: gameState.board,
    players: gameState.players,
    currentLetter: gameState.currentLetter,
    currentQuestion: gameState.currentQuestion,
    currentTeam: gameState.currentTeam,
    buzzedPlayer: gameState.buzzedPlayer,
    buzzedTeam: gameState.buzzedTeam,
    winner: gameState.winner,
    roundWins: gameState.roundWins,
    timerEnd: gameState.timerEnd,
    serverTime: Date.now(),
  };
}

function startTimer() {
  gameState.timerEnd = Date.now() + 5000;
  gameState.timer = setTimeout(() => {
    // Timer expired — hand control to referee (no auto-pass)
    gameState.phase = 'REFEREE_DECISION';
    gameState.timerEnd = null;
    io.emit('game_state', getPublicState());
  }, 5000);
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
  const getNeighbors = (r, c) => {
    const neighbors = [[r, c - 1], [r, c + 1]];
    if (Math.abs(r) % 2 === 0) { // even row (0, 2, 4)
      neighbors.push([r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]);
    } else { // odd row (1, 3)
      neighbors.push([r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]);
    }
    return neighbors.filter(([nr, nc]) => nr >= 0 && nr < 5 && nc >= 0 && nc < 5);
  };

  const hasPath = (team, isWinNode) => {
    // Collect starting nodes
    let queue = [];
    let visited = new Set();
    
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const idx = r * 5 + c;
        if (gameState.board[idx].owner === team) {
          // Green starts from column 0 (Left)
          // Orange starts from row 0 (Top)
          if ((team === 'green' && c === 0) || (team === 'orange' && r === 0)) {
            queue.push([r, c]);
            visited.add(`${r},${c}`);
          }
        }
      }
    }

    while (queue.length > 0) {
      const [r, c] = queue.shift();
      
      // Check if we hit the winning opposite side
      if (isWinNode(r, c)) return true;

      for (const [nr, nc] of getNeighbors(r, c)) {
        const nIdx = nr * 5 + nc;
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
  if (hasPath('green', (r, c) => c === 4)) {
    roundWinner = 'green';
  } else if (hasPath('orange', (r, c) => r === 4)) {
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

  socket.on('join', ({ name, team, role }) => {
    gameState.players[socket.id] = {
      name,
      team: (role === 'referee' || role === 'display') ? null : team,
      role,
      score: 0,
    };
    io.emit('game_state', getPublicState());
  });

  socket.on('start_game', () => {
    const p = gameState.players[socket.id];
    if (!p || p.role !== 'referee') return;
    gameState.phase = 'IDLE';
    gameState.currentTeam = Math.random() < 0.5 ? 'green' : 'orange';
    io.emit('game_state', getPublicState());
  });

  socket.on('select_letter', (index) => {
    const p = gameState.players[socket.id];
    if (!p || p.role !== 'referee') return;
    if (index < 0 || index >= 25 || gameState.board[index].owner) return;

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
    const p = gameState.players[socket.id];
    if (!p || p.role === 'referee') return;
    gameState.buzzedPlayer = socket.id;
    gameState.buzzedTeam = p.team;
    gameState.phase = 'ANSWERING';
    startTimer();
    io.emit('game_state', getPublicState());
  });

  socket.on('judge', (correct) => {
    const p = gameState.players[socket.id];
    if (!p || p.role !== 'referee') return;
    if (gameState.phase !== 'ANSWERING' && gameState.phase !== 'REFEREE_DECISION') return;

    clearTimer();

    if (correct) {
      gameState.board[gameState.currentLetter].owner = gameState.buzzedTeam;
      if (gameState.buzzedPlayer && gameState.players[gameState.buzzedPlayer]) {
        gameState.players[gameState.buzzedPlayer].score++;
      }
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
    const p = gameState.players[socket.id];
    if (!p || p.role !== 'referee') return;
    if (gameState.phase !== 'REFEREE_DECISION') return;

    gameState.buzzedTeam = gameState.buzzedTeam === 'green' ? 'orange' : 'green';
    gameState.buzzedPlayer = null;
    gameState.phase = 'ANSWERING';
    startTimer();
    io.emit('game_state', getPublicState());
  });

  // Referee skips the letter entirely (no team wins it)
  socket.on('skip_letter', () => {
    const p = gameState.players[socket.id];
    if (!p || p.role !== 'referee') return;
    if (gameState.phase !== 'REFEREE_DECISION') return;

    resetTurn(); // no winner, flip turn
    io.emit('game_state', getPublicState());
  });

  // Referee changes the question for the current letter
  socket.on('change_question', () => {
    const p = gameState.players[socket.id];
    if (!p || p.role !== 'referee') return;
    if (!gameState.currentLetter && gameState.currentLetter !== 0) return;

    const letterChar = gameState.board[gameState.currentLetter].letter;
    const letterQuestions = questionsData[letterChar] || [{ q: `سؤال لحرف ${letterChar}`, a: letterChar }];
    gameState.currentQuestion = letterQuestions[Math.floor(Math.random() * letterQuestions.length)];
    io.emit('game_state', getPublicState());
  });

  socket.on('reset_game', () => {
    const p = gameState.players[socket.id];
    if (!p || p.role !== 'referee') return;
    clearTimer();
    initBoard();
    // Reset scores
    // Reset all
    Object.values(gameState.players).forEach(pl => pl.score = 0);
    gameState.roundWins = { green: 0, orange: 0 };
    gameState.phase = 'LOBBY';
    gameState.currentLetter = null;
    gameState.currentQuestion = null;
    gameState.currentTeam = null;
    gameState.buzzedPlayer = null;
    gameState.buzzedTeam = null;
    gameState.winner = null;
    initBoard();
    io.emit('game_state', getPublicState());
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    io.emit('game_state', getPublicState());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 حروف Game Server running on http://localhost:${PORT}`);
});
