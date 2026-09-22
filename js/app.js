(() => {
  'use strict';

  const MAX_ENTRIES = 355;
  const STORAGE_KEY = 'safarnama_wheel_state_v1';

  const PALETTE = ['#e7c374', '#191410', '#b3862f', '#241d12', '#f2dca0', '#100c08'];
  const FX_COLORS = ['#f6dc9b', '#d9ae53', '#a67c2e', '#ffffff', '#c96a4a', '#f2e6c4'];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  const setupScreen = $('setupScreen');
  const wheelScreen = $('wheelScreen');
  const entriesInput = $('entriesInput');
  const countBadge = $('countBadge');
  const inputHint = $('inputHint');
  const startDrawBtn = $('startDrawBtn');
  const rangeStart = $('rangeStart');
  const rangeEnd = $('rangeEnd');
  const fillRangeBtn = $('fillRangeBtn');
  const shuffleInputBtn = $('shuffleInputBtn');
  const clearInputBtn = $('clearInputBtn');

  const navEdit = $('navEdit');
  const navReset = $('navReset');

  const wheelCanvas = $('wheelCanvas');
  const spinBtn = $('spinBtn');
  const remainingBadge = $('remainingBadge');
  const wheelEmptyMsg = $('wheelEmptyMsg');
  const winnersList = $('winnersList');

  const revealOverlay = $('revealOverlay');
  const revealValue = $('revealValue');
  const continueBtn = $('continueBtn');
  const fxCanvas = $('fxCanvas');

  const wheelCtx = wheelCanvas.getContext('2d');
  const fxCtx = fxCanvas.getContext('2d');

  // ---------- State ----------
  const state = {
    pool: [],
    winners: [],
    rotation: 0,
    spinning: false,
    pendingWinnerIndex: -1,
  };

  // ---------- Persistence ----------
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rawInput: entriesInput.value,
        pool: state.pool,
        winners: state.winners,
        onWheelScreen: wheelScreen.classList.contains('active'),
      }));
    } catch (e) { /* storage unavailable, ignore */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.rawInput) entriesInput.value = data.rawInput;
      if (Array.isArray(data.winners)) state.winners = data.winners;
      if (Array.isArray(data.pool) && data.pool.length) {
        state.pool = data.pool;
        renderWinnersList();
        showScreen('wheel');
        updateRemainingBadge();
        return;
      }
      if (Array.isArray(data.winners) && data.winners.length) {
        renderWinnersList();
      }
      updateCount();
    } catch (e) { /* ignore corrupt state */ }
  }

  // ---------- Helpers ----------
  function parseEntries(text) {
    return text
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

  function showScreen(name) {
    setupScreen.classList.toggle('active', name === 'setup');
    wheelScreen.classList.toggle('active', name === 'wheel');
    navEdit.hidden = name !== 'wheel';
    navReset.hidden = name !== 'wheel';
    if (name === 'wheel') {
      requestAnimationFrame(() => { setupWheelCanvasHiDPI(); drawWheel(); });
    }
  }

  // ---------- Setup screen logic ----------
  function updateCount() {
    const entries = parseEntries(entriesInput.value);
    const n = entries.length;
    countBadge.textContent = `${n} / ${MAX_ENTRIES}`;
    countBadge.classList.toggle('over-limit', n > MAX_ENTRIES);
    if (n > MAX_ENTRIES) {
      inputHint.textContent = `You have ${n} entries — please remove ${n - MAX_ENTRIES} to stay within the ${MAX_ENTRIES} limit.`;
      inputHint.classList.add('warn');
      startDrawBtn.disabled = true;
    } else if (n < 2) {
      inputHint.textContent = 'Enter at least 2 entries to start the draw. Maximum 355 entries.';
      inputHint.classList.remove('warn');
      startDrawBtn.disabled = true;
    } else {
      inputHint.textContent = `Ready! ${n} entries loaded. Maximum ${MAX_ENTRIES}.`;
      inputHint.classList.remove('warn');
      startDrawBtn.disabled = false;
    }
    return entries;
  }

  entriesInput.addEventListener('input', () => { updateCount(); persist(); });

  fillRangeBtn.addEventListener('click', () => {
    let start = parseInt(rangeStart.value, 10);
    let end = parseInt(rangeEnd.value, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) return;
    if (end < start) [start, end] = [end, start];
    if (end - start + 1 > MAX_ENTRIES) end = start + MAX_ENTRIES - 1;
    const nums = [];
    for (let i = start; i <= end; i++) nums.push(i);
    entriesInput.value = nums.join('\n');
    updateCount();
    persist();
  });

  shuffleInputBtn.addEventListener('click', () => {
    const entries = parseEntries(entriesInput.value);
    entriesInput.value = shuffleArray(entries).join('\n');
    persist();
  });

  clearInputBtn.addEventListener('click', () => {
    if (entriesInput.value.trim() && !confirm('Clear the entire entry list?')) return;
    entriesInput.value = '';
    updateCount();
    persist();
  });

  startDrawBtn.addEventListener('click', () => {
    const entries = updateCount();
    if (entries.length < 2 || entries.length > MAX_ENTRIES) return;
    state.pool = entries.slice();
    state.rotation = 0;
    wheelEmptyMsg.hidden = true;
    spinBtn.hidden = false;
    spinBtn.disabled = false;
    persist();
    showScreen('wheel');
    updateRemainingBadge();
  });

  navEdit.addEventListener('click', () => {
    if (state.pool.length && state.winners.length &&
        !confirm('Return to editing the list? Your current wheel progress stays saved, but the wheel will rebuild from the entries you save here.')) return;
    showScreen('setup');
  });

  navReset.addEventListener('click', () => {
    if (!confirm('Reset everything — entries, wheel and winners? This cannot be undone.')) return;
    state.pool = [];
    state.winners = [];
    state.rotation = 0;
    entriesInput.value = '';
    renderWinnersList();
    updateCount();
    persist();
    showScreen('setup');
  });

  // ---------- Wheel rendering ----------
  function setupWheelCanvasHiDPI() {
    const rect = wheelCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    wheelCanvas.width = Math.round(rect.width * dpr);
    wheelCanvas.height = Math.round(rect.height * dpr);
    wheelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawWheel() {
    const rect = wheelCanvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(cx, cy) - 4;
    const n = state.pool.length;

    wheelCtx.clearRect(0, 0, w, h);

    if (n === 0) {
      wheelCtx.beginPath();
      wheelCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      wheelCtx.fillStyle = '#171310';
      wheelCtx.fill();
      return;
    }

    const segAngle = (Math.PI * 2) / n;
    const showLabels = n <= 60;
    const maxChars = n <= 12 ? 22 : n <= 24 ? 16 : n <= 40 ? 10 : 7;
    const fontSize = n <= 12 ? 20 : n <= 24 ? 16 : n <= 40 ? 13 : 11;

    for (let i = 0; i < n; i++) {
      const start = state.rotation + i * segAngle;
      const end = start + segAngle;
      wheelCtx.beginPath();
      wheelCtx.moveTo(cx, cy);
      wheelCtx.arc(cx, cy, radius, start, end);
      wheelCtx.closePath();
      wheelCtx.fillStyle = PALETTE[i % PALETTE.length];
      wheelCtx.fill();
      wheelCtx.strokeStyle = 'rgba(217,174,83,0.35)';
      wheelCtx.lineWidth = 1;
      wheelCtx.stroke();

      if (showLabels) {
        const mid = start + segAngle / 2;
        let label = String(state.pool[i]);
        if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '…';

        const bgIndex = i % PALETTE.length;
        const isDarkBg = bgIndex === 1 || bgIndex === 3 || bgIndex === 5;
        wheelCtx.save();
        wheelCtx.translate(cx, cy);
        wheelCtx.rotate(mid);
        wheelCtx.textAlign = 'right';
        wheelCtx.textBaseline = 'middle';
        wheelCtx.font = `600 ${fontSize}px Poppins, sans-serif`;
        wheelCtx.fillStyle = isDarkBg ? '#f3ecd9' : '#20180a';
        wheelCtx.fillText(label, radius - 16, 0);
        wheelCtx.restore();
      }
    }

    // outer rim highlight
    wheelCtx.beginPath();
    wheelCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    wheelCtx.lineWidth = 3;
    wheelCtx.strokeStyle = 'rgba(217,174,83,0.5)';
    wheelCtx.stroke();
  }

  function updateRemainingBadge() {
    remainingBadge.textContent = `${state.pool.length} remaining`;
  }

  window.addEventListener('resize', debounce(() => {
    if (wheelScreen.classList.contains('active')) {
      setupWheelCanvasHiDPI();
      drawWheel();
    }
  }, 150));

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- Spin logic ----------
  function spin() {
    if (state.spinning || state.pool.length === 0) return;
    state.spinning = true;
    spinBtn.disabled = true;

    const n = state.pool.length;
    const winnerIndex = Math.floor(Math.random() * n);
    const segAngle = (Math.PI * 2) / n;
    const winnerCenter = winnerIndex * segAngle + segAngle / 2;
    const pointerAngle = -Math.PI / 2;

    let currentMod = state.rotation % (Math.PI * 2);
    if (currentMod < 0) currentMod += Math.PI * 2;

    let desiredMod = pointerAngle - winnerCenter;
    desiredMod = ((desiredMod % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    let deltaMod = desiredMod - currentMod;
    deltaMod = ((deltaMod % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const extraSpins = 6 + Math.floor(Math.random() * 4);
    const totalDelta = extraSpins * Math.PI * 2 + deltaMod;
    const fromRotation = state.rotation;
    const duration = 5200 + Math.random() * 900;
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeOutQuint(t);
      state.rotation = fromRotation + totalDelta * eased;
      drawWheel();
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        finishSpin(winnerIndex);
      }
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(winnerIndex) {
    state.pendingWinnerIndex = winnerIndex;
    const winnerText = state.pool[winnerIndex];
    showReveal(winnerText);
  }

  spinBtn.addEventListener('click', spin);

  document.addEventListener('keydown', (e) => {
    if (revealOverlay.classList.contains('show')) {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') {
        e.preventDefault();
        confirmWinner();
      }
      return;
    }
    if (wheelScreen.classList.contains('active') && e.code === 'Space') {
      const tag = document.activeElement.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      e.preventDefault();
      spin();
    }
  });

  // ---------- Reveal overlay + FX ----------
  function showReveal(text) {
    revealValue.textContent = text;
    revealOverlay.classList.add('show');
    resizeFxCanvas();
    startFX();
  }

  function hideReveal() {
    revealOverlay.classList.remove('show');
    stopFX();
  }

  function confirmWinner() {
    if (state.pendingWinnerIndex < 0) return;
    const winnerText = state.pool[state.pendingWinnerIndex];
    state.pool.splice(state.pendingWinnerIndex, 1);
    state.winners.unshift({ text: winnerText, time: Date.now() });
    state.pendingWinnerIndex = -1;

    hideReveal();
    renderWinnersList();
    updateRemainingBadge();
    persist();

    state.spinning = false;
    if (state.pool.length === 0) {
      spinBtn.hidden = true;
      wheelEmptyMsg.hidden = false;
      wheelCtx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);
    } else {
      spinBtn.disabled = false;
      state.rotation = 0;
      drawWheel();
    }
  }

  continueBtn.addEventListener('click', confirmWinner);

  function renderWinnersList() {
    if (state.winners.length === 0) {
      winnersList.innerHTML = '<li class="winners-empty">No winners yet — spin to begin!</li>';
      return;
    }
    winnersList.innerHTML = state.winners.map((w, idx) => {
      const rank = state.winners.length - idx;
      return `<li><span class="wn-rank">${rank}</span><span class="wn-name">${escapeHtml(w.text)}</span></li>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- Fireworks / confetti particle FX ----------
  let fxRunning = false;
  let fxAnimHandle = null;
  let confetti = [];
  let fireworks = [];
  let lastFireworkTime = 0;

  function resizeFxCanvas() {
    const dpr = window.devicePixelRatio || 1;
    fxCanvas.width = Math.round(window.innerWidth * dpr);
    fxCanvas.height = Math.round(window.innerHeight * dpr);
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function startFX() {
    fxRunning = true;
    confetti = [];
    fireworks = [];
    lastFireworkTime = 0;
    spawnConfettiBatch(90);
    if (fxAnimHandle) cancelAnimationFrame(fxAnimHandle);
    fxAnimHandle = requestAnimationFrame(fxLoop);
  }

  function stopFX() {
    fxRunning = false;
    if (fxAnimHandle) cancelAnimationFrame(fxAnimHandle);
    fxAnimHandle = null;
    confetti = [];
    fireworks = [];
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  }

  function spawnConfettiBatch(count) {
    const w = window.innerWidth;
    for (let i = 0; i < count; i++) {
      confetti.push({
        x: Math.random() * w,
        y: -20 - Math.random() * window.innerHeight * 0.6,
        w: 6 + Math.random() * 7,
        h: 8 + Math.random() * 10,
        vy: 2 + Math.random() * 3,
        vx: (Math.random() - 0.5) * 2.2,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.25,
        color: FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)],
        sway: Math.random() * Math.PI * 2,
      });
    }
  }

  function launchFirework() {
    const w = window.innerWidth, h = window.innerHeight;
    const x = w * (0.15 + Math.random() * 0.7);
    const targetY = h * (0.18 + Math.random() * 0.32);
    fireworks.push({
      x, y: h, targetY,
      vy: -(9 + Math.random() * 3),
      exploded: false,
      particles: [],
      color: FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)],
    });
  }

  function explodeFirework(fw) {
    fw.exploded = true;
    const count = 46 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 2 + Math.random() * 4.5;
      fw.particles.push({
        x: fw.x, y: fw.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.010 + Math.random() * 0.012,
        color: Math.random() < 0.5 ? fw.color : FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)],
        size: 2 + Math.random() * 2.2,
      });
    }
  }

  function fxLoop(now) {
    if (!fxRunning) return;
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    if (now - lastFireworkTime > 480) {
      launchFirework();
      lastFireworkTime = now;
    }

    // confetti
    const w = window.innerWidth, h = window.innerHeight;
    for (const c of confetti) {
      c.y += c.vy;
      c.sway += 0.05;
      c.x += c.vx + Math.sin(c.sway) * 0.6;
      c.rot += c.vr;
      if (c.y > h + 20) {
        c.y = -20;
        c.x = Math.random() * w;
      }
      fxCtx.save();
      fxCtx.translate(c.x, c.y);
      fxCtx.rotate(c.rot);
      fxCtx.fillStyle = c.color;
      fxCtx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      fxCtx.restore();
    }

    // fireworks
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const fw = fireworks[i];
      if (!fw.exploded) {
        fw.y += fw.vy;
        fw.vy += 0.12;
        fxCtx.beginPath();
        fxCtx.arc(fw.x, fw.y, 3, 0, Math.PI * 2);
        fxCtx.fillStyle = fw.color;
        fxCtx.shadowColor = fw.color;
        fxCtx.shadowBlur = 12;
        fxCtx.fill();
        fxCtx.shadowBlur = 0;
        if (fw.vy >= 0 || fw.y <= fw.targetY) explodeFirework(fw);
      } else {
        let alive = false;
        for (const p of fw.particles) {
          if (p.life <= 0) continue;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.045;
          p.vx *= 0.985;
          p.life -= p.decay;
          if (p.life > 0) {
            alive = true;
            fxCtx.globalAlpha = Math.max(p.life, 0);
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            fxCtx.fillStyle = p.color;
            fxCtx.shadowColor = p.color;
            fxCtx.shadowBlur = 8;
            fxCtx.fill();
            fxCtx.shadowBlur = 0;
            fxCtx.globalAlpha = 1;
          }
        }
        if (!alive) fireworks.splice(i, 1);
      }
    }

    fxAnimHandle = requestAnimationFrame(fxLoop);
  }

  window.addEventListener('resize', debounce(() => {
    if (revealOverlay.classList.contains('show')) resizeFxCanvas();
  }, 150));

  // ---------- Init ----------
  restore();
  updateCount();
})();
