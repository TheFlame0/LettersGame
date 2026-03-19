// ═══════════════════════════════════════════
//  حروف - Letters Game Client
// ═══════════════════════════════════════════

const socket = io();

let myInfo = null;
let state = null;
let timerInterval = null;
let serverOffset = 0; // ms difference between server and client clock

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

// 5x5 slanted block = 25 letters
const BOARD_LAYOUT = [5, 5, 5, 5, 5];

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

  const totalW = 8.5 * COL_STEP;
  const totalH = 7 * ROW_STEP + HEX_SIZE + 40;
  svgEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

  let cellIndex = 0;

  for (let r = -1; r <= 5; r++) {
    const isOffsetRow = Math.abs(r) % 2 === 1; // Alternating rows are shifted right

    // Base X offset + shift for odd rows
    const offsetX = COL_STEP + (isOffsetRow ? COL_STEP / 2 : 0) + 10;

    for (let c = -1; c <= 5; c++) {
      const cx = offsetX + (c + 1) * COL_STEP;
      const cy = HEX_SIZE + 20 + (r + 1) * ROW_STEP;

      const isPlayable = (r >= 0 && r < 5 && c >= 0 && c < 5);

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

        // Referee can click unowned cells during IDLE, or click selected cell to deselect during BUZZING
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
        // Border Hexes
        // User requested: Left/Right = Green, Top/Bottom = Orange.
        g.classList.add('border-hex'); // specific styling if needed
        if (c === -1 || c === 5) {
          g.classList.add('owner-green');
        } else if (r === -1 || r === 5) {
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
  socket.emit('join', myInfo);
  lobbyScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  render();
}

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

// ─── Timer ───
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 52;

function updateTimerCircle(circleEl, textEl) {
  if (!state || !state.timerEnd) return;
  
  // Calculate remaining time using synchronized clock
  const nowAdjusted = Date.now() + serverOffset;
  const remaining = Math.max(0, state.timerEnd - nowAdjusted) / 1000;
  
  const fraction = remaining / 5;
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
  judgeControls.classList.toggle('hidden', state.phase !== 'ANSWERING' && state.phase !== 'REFEREE_DECISION');
  decisionControls.classList.toggle('hidden', state.phase !== 'REFEREE_DECISION');
  changeQuestionBtn.classList.toggle('hidden', state.phase !== 'BUZZING' && state.phase !== 'REFEREE_DECISION');
  resetGameBtn.classList.toggle('hidden', state.phase === 'LOBBY');

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
  if (oldPhase === 'ANSWERING' && state.phase === 'REFEREE_DECISION') showToast('إجابة خاطئة', 'error');

  if (myInfo) render();
  renderLobbyPlayers(state.players);
});

// Init timer circles
document.querySelectorAll('.timer-progress').forEach(c => {
  c.style.strokeDasharray = TIMER_CIRCUMFERENCE;
});
