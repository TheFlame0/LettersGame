// ═══════════════════════════════════════════
//  حروف - Letters Game Client
// ═══════════════════════════════════════════

// Aggressive reconnection config — keeps players connected
const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,  // Never give up
  reconnectionDelay: 500,          // Start retrying after 500ms
  reconnectionDelayMax: 3000,      // Max 3s between retry attempts
  timeout: 30000,                  // 30s connection timeout
});

let myInfo = null;
let state = null;
let timerInterval = null;
let serverOffset = 0;
let myPlayerId = localStorage.getItem('lettersGamePlayerId') || null;

// ─── DOM ───
const lobbyScreen = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const nameInput = document.getElementById('nameInput');
const playersList = document.getElementById('playersList');
const statusText = document.getElementById('statusText');

// Views
const refereeView = document.getElementById('refereeView');
const playerView = document.getElementById('playerView');
const displayView = document.getElementById('displayView');

// Referee
const turnIndicator = document.getElementById('turnIndicator');
const hexBoard = document.getElementById('hexBoard');
const refLamp = document.getElementById('refLamp');
const refLampText = document.getElementById('refLampText');
const refTimerArea = document.getElementById('refTimerArea');
const startGameBtn = document.getElementById('startGameBtn');
const judgeControls = document.getElementById('judgeControls');
const correctBtn = document.getElementById('correctBtn');
const incorrectBtn = document.getElementById('incorrectBtn');
const decisionControls = document.getElementById('decisionControls');
const passBtn = document.getElementById('passBtn');
const skipBtn = document.getElementById('skipBtn');
const changeQuestionBtn = document.getElementById('changeQuestionBtn');
const resetGameBtn = document.getElementById('resetGameBtn');
const undoCorrectBtn = document.getElementById('undoCorrectBtn');

// Player
const playerLamp = document.getElementById('playerLamp');
const playerLampText = document.getElementById('playerLampText');
const playerTimerArea = document.getElementById('playerTimerArea');
const buzzBtn = document.getElementById('buzzBtn');

// Display
const displayTurnIndicator = document.getElementById('displayTurnIndicator');
const displayHexBoard = document.getElementById('displayHexBoard');
const displayLamp = document.getElementById('displayLamp');
const displayLampText = document.getElementById('displayLampText');
const displayTimerArea = document.getElementById('displayTimerArea');
const greenScores = document.getElementById('greenScores');
const orangeScores = document.getElementById('orangeScores');
const greenRounds = document.getElementById('greenRounds');
const orangeRounds = document.getElementById('orangeRounds');

// UX Overlays
const waitingRoomOverlay = document.getElementById('waitingRoomOverlay');
const waitingPlayerName = document.getElementById('waitingPlayerName');
const waitingTeamBadge = document.getElementById('waitingTeamBadge');
const playerActiveView = document.querySelector('.player-center');

const tvLobbyScreen = document.getElementById('tvLobbyScreen');
const displayActiveView = document.getElementById('displayActiveView');
const tvLobbyOrange = document.getElementById('tvLobbyOrange');
const tvLobbyGreen = document.getElementById('tvLobbyGreen');

const toastNotification = document.getElementById('toastNotification');
const toastIcon = document.getElementById('toastIcon');
const toastMessage = document.getElementById('toastMessage');

// Settings DOM
const settingsPanel = document.getElementById('settingsPanel');
const timerBlocks = document.getElementById('timerBlocks');
const gridBlocks = document.getElementById('gridBlocks');

const HEX_SIZE = 44;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const COL_STEP = HEX_W;
const ROW_STEP = HEX_SIZE * 1.5;

function hexPoints(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${cx + HEX_SIZE * Math.cos(angle)},${cy + HEX_SIZE * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

function buildBoardSVG(svgEl, clickable) {
  svgEl.innerHTML = '';
  if (!state) return;

  const size = state.gameSettings ? state.gameSettings.gridSize : 5;

  const totalW = (size + 3.5) * COL_STEP;
  const totalH = (size + 2) * ROW_STEP + HEX_SIZE + 40;
  svgEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

  let cellIndex = 0;

  for (let r = -1; r <= size; r++) {
    const isOffsetRow = Math.abs(r) % 2 === 1;
    const offsetX = COL_STEP + (isOffsetRow ? COL_STEP / 2 : 0) + 10;

    for (let c = -1; c <= size; c++) {
      const cx = offsetX + (c + 1) * COL_STEP;
      const cy = HEX_SIZE + 20 + (r + 1) * ROW_STEP;

      const isPlayable = (r >= 0 && r < size && c >= 0 && c < size);

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'hex-cell');

      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', hexPoints(cx, cy));
      g.appendChild(poly);

      if (isPlayable) {
        const cell = state.board[cellIndex];
        if (!cell) continue;

        if (cell.owner === 'green') g.classList.add('owner-green');
        else if (cell.owner === 'orange') g.classList.add('owner-orange');

        if (state.currentLetter === cellIndex && state.phase !== 'GAME_OVER') g.classList.add('selected');

        const canClick = clickable && !cell.owner && (state.phase === 'IDLE' || (state.phase === 'BUZZING' && state.currentLetter === cellIndex));
        if (canClick && state.phase !== 'GAME_OVER') g.classList.add('clickable');

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', cx);
        txt.setAttribute('y', cy + 2);
        txt.textContent = cell.letter;
        g.appendChild(txt);

        if (canClick) {
          const idx = cellIndex;
          g.addEventListener('click', () => {
            socket.emit('select_letter', idx);
          });
        }
        cellIndex++;
      } else {
        g.classList.add('border-hex');
        if (c === -1 || c === size) {
          g.classList.add('owner-green');
        } else if (r === -1 || r === size) {
          g.classList.add('owner-orange');
        }
      }

      svgEl.appendChild(g);
    }
  }
}

// ─── Lobby & Auto-Reconnect ───
function joinGame(name, team, role) {
  myInfo = { name: name || 'شاشة العرض', team, role };
  localStorage.setItem('lettersGameUser', JSON.stringify(myInfo));
  socket.emit('join', { ...myInfo, playerId: myPlayerId });
  lobbyScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  render();
}

// Server assigns a persistent ID on first join
socket.on('assigned_id', (id) => {
  myPlayerId = id;
  localStorage.setItem('lettersGamePlayerId', id);
});

// Auto-rejoin when socket reconnects after a drop
socket.on('connect', () => {
  if (myInfo) {
    // Re-send join with persistent ID to restore session
    socket.emit('join', { ...myInfo, playerId: myPlayerId });
  }
});

// Wake-up detection: when screen wakes, force reconnect if needed
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && myInfo) {
    if (!socket.connected) {
      socket.connect(); // Force reconnect attempt
    } else {
      // Already connected but might be stale — re-join to be safe
      socket.emit('join', { ...myInfo, playerId: myPlayerId });
    }
  }
});

document.querySelectorAll('.role-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const role = btn.dataset.role;
    if (role !== 'display' && !name) {
      nameInput.style.borderColor = '#ef4444';
      nameInput.focus();
      return;
    }
    const team = btn.dataset.team || null;
    joinGame(name, team, role);
  });
});

nameInput.addEventListener('input', () => { nameInput.style.borderColor = 'var(--border)'; });

// Restore active session on reload
window.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('lettersGameUser');
  if (savedUser) {
    try {
      const parsedUser = JSON.parse(savedUser);
      if (parsedUser.role) {
        joinGame(parsedUser.name, parsedUser.team, parsedUser.role);
      }
    } catch (e) {
      localStorage.removeItem('lettersGameUser');
    }
  }
});

// ─── Buttons ───
const leaveBtn = document.getElementById('leaveBtn');
if (leaveBtn) {
  leaveBtn.addEventListener('click', () => {
    localStorage.removeItem('lettersGameUser');
    localStorage.removeItem('lettersGamePlayerId');
    window.location.reload(); // Reload cleans state and puts user back in lobby
  });
}

buzzBtn.addEventListener('click', () => socket.emit('buzz'));
startGameBtn.addEventListener('click', () => socket.emit('start_game'));
correctBtn.addEventListener('click', () => socket.emit('judge', true));
incorrectBtn.addEventListener('click', () => socket.emit('judge', false));
passBtn.addEventListener('click', () => socket.emit('pass_to_other'));
skipBtn.addEventListener('click', () => socket.emit('skip_letter'));
changeQuestionBtn.addEventListener('click', () => socket.emit('change_question'));
resetGameBtn.addEventListener('click', () => {
  if (confirm('هل أنت متأكد من رغبتك في تصفير اللعبة وإعادة توزيع الحروف؟')) {
    socket.emit('reset_game');
  }
});

// Settings block click handlers
timerBlocks.querySelectorAll('.setting-block').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('update_settings', { timerSeconds: parseInt(btn.dataset.value) });
  });
});
gridBlocks.querySelectorAll('.setting-block').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('update_settings', { gridSize: parseInt(btn.dataset.value) });
  });
});
undoCorrectBtn.addEventListener('click', () => {
  if (confirm('هل تريد سحب الاجابه؟')) {
    socket.emit('undo_correct');
  }
});

// ─── Buzz Sound (Web Audio API — works on all devices, no file needed) ───
function playBuzzSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(800, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) { /* Audio not supported */ }
}

// Listen for buzz events from the server
socket.on('buzz_alert', () => {
  playBuzzSound();
});

// ─── Timer ───
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 52;

function updateTimerCircle(circleEl, textEl) {
  if (!state || !state.timerEnd) return;
  
  // Calculate remaining time using synchronized clock
  const nowAdjusted = Date.now() + serverOffset;
  const remaining = Math.max(0, state.timerEnd - nowAdjusted) / 1000;
  
  const timerSecs = state.gameSettings ? state.gameSettings.timerSeconds : 7;
  const fraction = remaining / timerSecs;
  const offset = TIMER_CIRCUMFERENCE * (1 - fraction);

  circleEl.style.strokeDashoffset = offset;
  
  // Display numbers 5, 4, 3, 2, 1. If 0, keep as 1 or empty.
  textEl.textContent = remaining > 0 ? Math.ceil(remaining) : '';

  circleEl.classList.remove('green', 'orange', 'danger');
  if (remaining <= 2) circleEl.classList.add('danger');
  else if (state.buzzedTeam === 'orange') circleEl.classList.add('orange');
  else circleEl.classList.add('green');
}

function updateAllTimers() {
  document.querySelectorAll('.timer-progress').forEach(circle => {
    const ring = circle.closest('.timer-ring');
    if (!ring) return;
    const textEl = ring.querySelector('.timer-text');
    updateTimerCircle(circle, textEl);
  });
}

function startTimerUI() {
  if (timerInterval) return; // Already running
  if (!state || !state.timerEnd) return;
  
  // Initial immediate update
  updateAllTimers();

  timerInterval = setInterval(() => {
    updateAllTimers();
    
    const nowAdjusted = Date.now() + serverOffset;
    if (state.timerEnd && nowAdjusted >= (state.timerEnd + 100)) {
      stopTimerUI();
    }
  }, 50);
}

function stopTimerUI() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ─── Render ───
function render() {
  if (!state || !myInfo) return;

  // Show the correct view
  refereeView.classList.add('hidden');
  playerView.classList.add('hidden');
  displayView.classList.add('hidden');

  if (myInfo.role === 'referee') {
    refereeView.classList.remove('hidden');
    renderReferee();
  } else if (myInfo.role === 'display') {
    displayView.classList.remove('hidden');
    renderDisplay();
  } else {
    playerView.classList.remove('hidden');
    renderPlayer();
  }

  updateStatus();

  // Timer
  const isTimerPhase = state.phase === 'ANSWERING';
  if (isTimerPhase) startTimerUI();
  else stopTimerUI();
}

function renderReferee() {
  buildBoardSVG(hexBoard, true);

  // Turn indicator
  turnIndicator.className = 'team-indicator';
  if (state.phase === 'IDLE' && state.currentTeam) {
    turnIndicator.classList.add(state.currentTeam);
    turnIndicator.textContent = state.currentTeam === 'green' ? '🟢 دور الأخضر — اختاروا حرفاً' : '🟠 دور البرتقالي — اختاروا حرفاً';
  } else { turnIndicator.textContent = ''; }

  // Lamp
  setLamp(refLamp, refLampText);

  // Timer
  const isTimerPhase = state.phase === 'ANSWERING';
  refTimerArea.classList.toggle('hidden', !isTimerPhase);

  // Controls visibility
  startGameBtn.classList.toggle('hidden', state.phase !== 'LOBBY');
  settingsPanel.classList.toggle('hidden', state.phase !== 'LOBBY');
  judgeControls.classList.toggle('hidden', state.phase !== 'ANSWERING' && state.phase !== 'REFEREE_DECISION');
  decisionControls.classList.toggle('hidden', state.phase !== 'REFEREE_DECISION');
  changeQuestionBtn.classList.toggle('hidden', state.phase !== 'BUZZING' && state.phase !== 'REFEREE_DECISION');
  resetGameBtn.classList.toggle('hidden', state.phase === 'LOBBY');
  undoCorrectBtn.classList.toggle('hidden', !state.canUndo || state.phase === 'LOBBY');

  // Sync setting blocks with server state
  if (state.gameSettings) {
    timerBlocks.querySelectorAll('.setting-block').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.value) === state.gameSettings.timerSeconds);
    });
    gridBlocks.querySelectorAll('.setting-block').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.value) === state.gameSettings.gridSize);
    });
  }

  // Question Box
  const qBox = document.getElementById('questionBox');
  const qText = document.getElementById('questionText');
  const aText = document.getElementById('answerText');

  if (state.currentQuestion) {
    qBox.classList.remove('hidden');
    qText.textContent = 'السؤال: ' + state.currentQuestion.q;
    aText.textContent = 'الإجابة: ' + state.currentQuestion.a;
  } else {
    qBox.classList.add('hidden');
  }
}

function renderPlayer() {
  if (state.phase === 'LOBBY') {
    waitingRoomOverlay.classList.remove('hidden');
    playerActiveView.classList.add('hidden');

    waitingPlayerName.textContent = `مرحباً يا ${myInfo.name}!`;
    waitingTeamBadge.textContent = myInfo.team === 'green' ? 'الفريق الأخضر' : 'الفريق البرتقالي';
    waitingTeamBadge.className = `team-badge ${myInfo.team}`;
    return; // Stop rendering active view
  } else {
    waitingRoomOverlay.classList.add('hidden');
    playerActiveView.classList.remove('hidden');
  }

  // Lamp
  setLamp(playerLamp, playerLampText);

  // Timer
  const isTimerPhase = state.phase === 'ANSWERING';
  playerTimerArea.classList.toggle('hidden', !isTimerPhase);

  // Buzz button
  buzzBtn.classList.toggle('hidden', state.phase !== 'BUZZING');
}

function renderDisplay() {
  if (state.phase === 'LOBBY') {
    tvLobbyScreen.classList.remove('hidden');
    displayActiveView.classList.add('hidden');

    // Render joined players in TV lobby
    const greens = [], oranges = [];
    Object.values(state.players).forEach(p => {
      if (p.team === 'green') greens.push(p);
      if (p.team === 'orange') oranges.push(p);
    });
    tvLobbyGreen.innerHTML = greens.map(p => `<div class="player-tag">${p.name}</div>`).join('');
    tvLobbyOrange.innerHTML = oranges.map(p => `<div class="player-tag">${p.name}</div>`).join('');

    return; // Don't render board
  } else {
    tvLobbyScreen.classList.add('hidden');
    displayActiveView.classList.remove('hidden');
  }

  buildBoardSVG(displayHexBoard, false);

  // Turn indicator
  displayTurnIndicator.className = 'team-indicator';
  if (state.phase === 'IDLE' && state.currentTeam) {
    displayTurnIndicator.classList.add(state.currentTeam);
    displayTurnIndicator.textContent = state.currentTeam === 'green' ? '🟢 دور الفريق الأخضر' : '🟠 دور الفريق البرتقالي';
  } else { displayTurnIndicator.textContent = ''; }

  // Lamp
  setLamp(displayLamp, displayLampText);

  // Timer
  const isTimerPhase = state.phase === 'ANSWERING';
  displayTimerArea.classList.toggle('hidden', !isTimerPhase);

  // Scoreboard
  updateScoreboard();
}

function setLamp(lampEl, textEl) {
  lampEl.className = lampEl.classList.contains('lamp-large') ? 'lamp lamp-large' : 'lamp';
  textEl.textContent = '';

  if (state.phase === 'GAME_OVER') {
    lampEl.classList.add(state.winner);
    lampEl.classList.add('winner-glow');
    textEl.textContent = state.winner === 'green' ? 'الأخضر بطل!' : 'البرتقالي بطل!';
    return;
  }

  if (state.phase === 'ANSWERING' || state.phase === 'REFEREE_DECISION') {
    lampEl.classList.add(state.buzzedTeam);
    if (state.buzzedPlayer && state.players[state.buzzedPlayer]) {
      textEl.textContent = state.players[state.buzzedPlayer].name;
    } else {
      textEl.textContent = state.buzzedTeam === 'green' ? 'الفريق الأخضر' : 'الفريق البرتقالي';
    }
  }
}

function updateStatus() {
  const tn = (t) => t === 'green' ? 'الأخضر' : 'البرتقالي';
  switch (state.phase) {
    case 'LOBBY': statusText.textContent = '🏠 في انتظار بدء اللعبة...'; break;
    case 'IDLE':
      if (myInfo.role !== 'referee' && myInfo.role !== 'display') {
        if (myInfo.team === state.currentTeam) {
          statusText.textContent = `🎯 دور فريقك! اختاروا حرف`;
        } else {
          statusText.textContent = `🚫 دور الفريق الآخر. انتظروا اختيارهم`;
        }
      } else {
        statusText.textContent = `📝 دور الفريق ${tn(state.currentTeam)} — اختاروا حرفاً`;
      }
      break;
    case 'BUZZING': statusText.textContent = '🔔 الحكم يقرأ السؤال — اضغط الزر!'; break;
    case 'ANSWERING': {
      const b = state.players[state.buzzedPlayer];
      statusText.textContent = `⏱️ ${b ? b.name : 'الفريق ' + tn(state.buzzedTeam)} يجاوب — ٥ ثوان!`;
      break;
    }
    case 'REFEREE_DECISION': statusText.textContent = `⚖️ الحكم يقرر — تمرير أو تخطي؟`; break;
    case 'GAME_OVER': {
      statusText.innerHTML = `🎉🎉 المباراة انتهت! بطل حروف هو <b>الفريق ${tn(state.winner)}</b> بـ 3 انتصارات 🎉🎉`;
      break;
    }
  }
}

function updateScoreboard() {
  const greens = [], oranges = [];
  Object.values(state.players).forEach(p => {
    if (p.team === 'green') greens.push(p);
    if (p.team === 'orange') oranges.push(p);
  });
  greens.sort((a, b) => b.score - a.score);
  oranges.sort((a, b) => b.score - a.score);

  greenRounds.textContent = `الانتصارات: ${state.roundWins.green}`;
  orangeRounds.textContent = `الانتصارات: ${state.roundWins.orange}`;

  greenScores.innerHTML = greens.map(p =>
    `<div class="score-item"><span>${p.name}</span><span class="score-val">${p.score}</span></div>`
  ).join('');
  orangeScores.innerHTML = oranges.map(p =>
    `<div class="score-item"><span>${p.name}</span><span class="score-val">${p.score}</span></div>`
  ).join('');
}

function renderLobbyPlayers(players) {
  playersList.innerHTML = Object.values(players).map(p => {
    const cls = p.role === 'referee' ? 'referee' : (p.role === 'display' ? 'display' : p.team);
    const label = p.role === 'referee' ? '⚖️ حكم' : (p.role === 'display' ? '📺' : (p.team === 'green' ? '🟢' : '🟠'));
    return `<div class="player-tag ${cls}">${label} ${p.name}</div>`;
  }).join('');
}

function showToast(msg, type = 'success') {
  if (!toastNotification) return;
  toastIcon.textContent = type === 'success' ? '✅' : '❌';
  toastMessage.textContent = msg;
  toastNotification.className = `toast show ${type}`;
  setTimeout(() => {
    toastNotification.classList.remove('show');
  }, 2500);
}

// ─── Socket ───
socket.on('game_state', (newState) => {
  const oldPhase = state ? state.phase : null;
  state = newState;
  
  // Sync server clock
  if (state.serverTime) {
    serverOffset = state.serverTime - Date.now();
  }

  if (oldPhase === 'ANSWERING' && state.phase === 'IDLE') showToast('إجابة صحيحة!', 'success');
  if (oldPhase === 'ANSWERING' && state.phase === 'REFEREE_DECISION') {
    if (!state.timerEnd) {
      showToast('⏰ انتهى الوقت، لم يتم الاجابه', 'error');
    } else {
      showToast('إجابة خاطئة', 'error');
    }
  }

  if (myInfo) render();
  renderLobbyPlayers(state.players);
});

// Init timer circles
document.querySelectorAll('.timer-progress').forEach(c => {
  c.style.strokeDasharray = TIMER_CIRCUMFERENCE;
});
