(() => {
  'use strict';

  // ─── Canvas Setup ───
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── Constants ───
  const LANE_COUNT = 4;
  const SONG_DURATION = 45; // seconds
  const NOTE_SPEED_FACTOR = 0.45; // portion of screen height per second
  const HIT_ZONE_OFFSET = 0.88; // fraction from top
  const NOTE_RADIUS_FACTOR = 0.035; // relative to canvas width
  const LANE_KEYS = ['d', 'f', 'j', 'k'];
  const LANE_COLORS = ['#ff2d95', '#00e5ff', '#bf5af2', '#ffd700'];
  const TIMING = {
    PERFECT: 50,
    GREAT: 100,
    GOOD: 200
  };

  // ─── State ───
  let state = 'title'; // title | playing | result
  let audioCtx = null;
  let gameStartTime = 0;
  let notes = [];
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  let totalNotes = 0;
  let bgImageIndex = 0;
  let hitCount = 0;
  let feedbacks = []; // floating text
  let particles = [];
  let laneGlows = [0, 0, 0, 0]; // glow intensity per lane
  let bgPulse = 0;

  // ─── Images ───
  const noteImages = [];
  const bgImages = [];
  let imagesLoaded = 0;
  const TOTAL_IMAGES = 10;

  for (let i = 1; i <= TOTAL_IMAGES; i++) {
    const img = new Image();
    img.src = `images/img${i}.png`;
    img.onload = () => imagesLoaded++;
    noteImages.push(img);
    const bg = new Image();
    bg.src = `images/img${i}.png`;
    bgImages.push(bg);
  }

  // ─── Audio ───
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function playHitSound(timing) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (timing === 'perfect') {
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.15;
    } else if (timing === 'great') {
      osc.frequency.value = 660;
      osc.type = 'triangle';
      gain.gain.value = 0.12;
    } else if (timing === 'good') {
      osc.frequency.value = 440;
      osc.type = 'triangle';
      gain.gain.value = 0.08;
    } else {
      osc.frequency.value = 150;
      osc.type = 'sawtooth';
      gain.gain.value = 0.1;
    }

    const now = audioCtx.currentTime;
    osc.start(now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.stop(now + 0.15);
  }

  // Drum beat scheduler
  let drumInterval = null;
  let nextBeatTime = 0;
  const BPM = 130;
  const BEAT_SEC = 60 / BPM;

  function scheduleDrumBeat(time, accent) {
    if (!audioCtx) return;

    // Kick
    const kickOsc = audioCtx.createOscillator();
    const kickGain = audioCtx.createGain();
    kickOsc.connect(kickGain);
    kickGain.connect(audioCtx.destination);
    kickOsc.frequency.setValueAtTime(accent ? 160 : 120, time);
    kickOsc.frequency.exponentialRampToValueAtTime(30, time + 0.12);
    kickOsc.type = 'sine';
    kickGain.gain.setValueAtTime(accent ? 0.35 : 0.2, time);
    kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    kickOsc.start(time);
    kickOsc.stop(time + 0.15);

    // Hi-hat on every beat
    const bufferSize = audioCtx.sampleRate * 0.05;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const hihatGain = audioCtx.createGain();
    const hihatFilter = audioCtx.createBiquadFilter();
    hihatFilter.type = 'highpass';
    hihatFilter.frequency.value = 8000;
    noise.connect(hihatFilter);
    hihatFilter.connect(hihatGain);
    hihatGain.connect(audioCtx.destination);
    hihatGain.gain.setValueAtTime(0.08, time);
    hihatGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.start(time);
    noise.stop(time + 0.05);
  }

  function startDrumLoop() {
    if (!audioCtx) return;
    nextBeatTime = audioCtx.currentTime + 0.1;
    let beatIndex = 0;

    function schedule() {
      while (nextBeatTime < audioCtx.currentTime + 0.2) {
        const accent = beatIndex % 4 === 0;
        scheduleDrumBeat(nextBeatTime, accent);
        nextBeatTime += BEAT_SEC / 2; // eighth notes
        beatIndex++;
      }
    }

    drumInterval = setInterval(schedule, 50);
    schedule();
  }

  function stopDrumLoop() {
    if (drumInterval) {
      clearInterval(drumInterval);
      drumInterval = null;
    }
  }

  // ─── Note Generation ───
  function generateNotes() {
    notes = [];
    const eighthNote = BEAT_SEC / 2;
    const totalEighths = Math.floor(SONG_DURATION / eighthNote);

    // Procedural pattern: mix of rhythmic patterns
    // Seed-based pseudo-random for variety
    let seed = Date.now() % 10000;
    function seededRandom() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    // Generate patterns in chunks of 8 eighths (1 measure)
    for (let i = 0; i < totalEighths; i++) {
      const time = i * eighthNote + 1.5; // 1.5s lead-in
      if (time > SONG_DURATION) break;

      const r = seededRandom();
      const measureBeat = i % 8;

      // Pattern rules for musical feel
      let shouldPlace = false;
      if (measureBeat === 0) shouldPlace = r < 0.85; // downbeat
      else if (measureBeat === 4) shouldPlace = r < 0.75; // beat 3
      else if (measureBeat === 2 || measureBeat === 6) shouldPlace = r < 0.5; // beats 2,4
      else shouldPlace = r < 0.25; // offbeats

      // Increase density over time
      const progress = time / SONG_DURATION;
      if (progress > 0.5) shouldPlace = shouldPlace || r < 0.15;
      if (progress > 0.75) shouldPlace = shouldPlace || r < 0.2;

      if (shouldPlace) {
        const lane = Math.floor(seededRandom() * LANE_COUNT);
        // Sometimes add double notes
        const lanes = [lane];
        if (progress > 0.3 && seededRandom() < 0.15) {
          let lane2 = (lane + 1 + Math.floor(seededRandom() * 3)) % LANE_COUNT;
          lanes.push(lane2);
        }

        for (const l of lanes) {
          notes.push({
            lane: l,
            time: time,
            imgIndex: Math.floor(seededRandom() * TOTAL_IMAGES),
            hit: false,
            missed: false
          });
        }
      }
    }

    totalNotes = notes.length;
  }

  // ─── Layout Helpers ───
  function getLaneWidth() {
    const playAreaWidth = Math.min(canvas.width * 0.6, 400);
    return playAreaWidth / LANE_COUNT;
  }

  function getPlayAreaLeft() {
    const playAreaWidth = Math.min(canvas.width * 0.6, 400);
    return (canvas.width - playAreaWidth) / 2;
  }

  function getLaneX(lane) {
    return getPlayAreaLeft() + getLaneWidth() * lane + getLaneWidth() / 2;
  }

  function getHitY() {
    return canvas.height * HIT_ZONE_OFFSET;
  }

  function getNoteRadius() {
    return Math.max(18, canvas.width * NOTE_RADIUS_FACTOR);
  }

  // ─── Game Logic ───
  function getCurrentTime() {
    return (performance.now() - gameStartTime) / 1000;
  }

  function getNoteY(note) {
    const elapsed = getCurrentTime();
    const travelTime = canvas.height * HIT_ZONE_OFFSET / (canvas.height * NOTE_SPEED_FACTOR);
    const spawnTime = note.time - travelTime;
    const progress = (elapsed - spawnTime) / travelTime;
    return progress * getHitY();
  }

  function handleHit(lane) {
    const currentTime = getCurrentTime();
    const hitY = getHitY();

    // Find closest unhit note in this lane
    let closest = null;
    let closestDiff = Infinity;

    for (const note of notes) {
      if (note.lane !== lane || note.hit || note.missed) continue;
      const diff = Math.abs(note.time - currentTime) * 1000; // ms
      if (diff < closestDiff && diff < TIMING.GOOD + 50) {
        closest = note;
        closestDiff = diff;
      }
    }

    if (!closest) return;

    closest.hit = true;
    const diff = closestDiff;
    let timing, pts, color;

    if (diff <= TIMING.PERFECT) {
      timing = 'PERFECT'; pts = 100; color = '#ffd700';
      counts.perfect++;
      spawnParticles(getLaneX(lane), hitY, color, 20);
    } else if (diff <= TIMING.GREAT) {
      timing = 'GREAT'; pts = 50; color = '#00e5ff';
      counts.great++;
      spawnParticles(getLaneX(lane), hitY, color, 10);
    } else {
      timing = 'GOOD'; pts = 25; color = '#bf5af2';
      counts.good++;
      spawnParticles(getLaneX(lane), hitY, color, 5);
    }

    combo++;
    if (combo > maxCombo) maxCombo = combo;
    const multiplier = 1 + Math.floor(combo / 10) * 0.1;
    score += Math.floor(pts * multiplier);

    hitCount++;
    if (hitCount % 20 === 0) {
      bgImageIndex = (bgImageIndex + 1) % TOTAL_IMAGES;
    }

    laneGlows[lane] = 1.0;
    bgPulse = 0.3;

    playHitSound(timing.toLowerCase());

    feedbacks.push({
      text: timing,
      x: getLaneX(lane),
      y: hitY - 40,
      color: color,
      alpha: 1,
      vy: -2,
      life: 60
    });

    // Combo feedback
    if (combo > 0 && combo % 10 === 0) {
      feedbacks.push({
        text: `${combo} COMBO!`,
        x: canvas.width / 2,
        y: canvas.height / 2,
        color: '#ff2d95',
        alpha: 1,
        vy: -1,
        life: 90,
        big: true
      });
    }
  }

  function handleMiss(note) {
    note.missed = true;
    counts.miss++;
    combo = 0;
    playHitSound('miss');
    feedbacks.push({
      text: 'MISS',
      x: getLaneX(note.lane),
      y: getHitY(),
      color: '#ff4466',
      alpha: 1,
      vy: -1.5,
      life: 45
    });
  }

  // ─── Particles ───
  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        color,
        alpha: 1,
        radius: 2 + Math.random() * 4,
        life: 30 + Math.random() * 30
      });
    }
  }

  // ─── Drawing ───
  function drawBackground() {
    // Dark base
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Background image with low opacity
    const bgImg = bgImages[bgImageIndex];
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.12 + bgPulse * 0.15;
      const scale = Math.max(canvas.width / bgImg.width, canvas.height / bgImg.height);
      const w = bgImg.width * scale;
      const h = bgImg.height * scale;
      ctx.drawImage(bgImg, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      ctx.restore();
    }

    // Vignette
    const grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.3,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.8
    );
    grad.addColorStop(0, 'rgba(10,10,15,0)');
    grad.addColorStop(1, 'rgba(10,10,15,0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawLanes() {
    const lw = getLaneWidth();
    const left = getPlayAreaLeft();
    const hitY = getHitY();

    // Lane backgrounds
    for (let i = 0; i < LANE_COUNT; i++) {
      const x = left + i * lw;

      // Lane stripe
      ctx.fillStyle = `rgba(255,255,255,0.03)`;
      ctx.fillRect(x + 2, 0, lw - 4, canvas.height);

      // Lane borders
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      // Lane glow
      if (laneGlows[i] > 0.01) {
        const glowGrad = ctx.createLinearGradient(x, hitY - 100, x, hitY + 30);
        const col = LANE_COLORS[i];
        glowGrad.addColorStop(0, `rgba(${hexToRgb(col)},0)`);
        glowGrad.addColorStop(0.5, `rgba(${hexToRgb(col)},${laneGlows[i] * 0.3})`);
        glowGrad.addColorStop(1, `rgba(${hexToRgb(col)},0)`);
        ctx.fillStyle = glowGrad;
        ctx.fillRect(x, hitY - 100, lw, 130);
      }
    }

    // Right border of last lane
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(left + LANE_COUNT * lw, 0);
    ctx.lineTo(left + LANE_COUNT * lw, canvas.height);
    ctx.stroke();
  }

  function drawHitZone() {
    const hitY = getHitY();
    const nr = getNoteRadius();

    // Hit line
    ctx.strokeStyle = 'rgba(255, 45, 149, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(getPlayAreaLeft(), hitY);
    ctx.lineTo(getPlayAreaLeft() + getLaneWidth() * LANE_COUNT, hitY);
    ctx.stroke();

    // Target circles
    for (let i = 0; i < LANE_COUNT; i++) {
      const x = getLaneX(i);
      ctx.beginPath();
      ctx.arc(x, hitY, nr + 4, 0, Math.PI * 2);
      ctx.strokeStyle = LANE_COLORS[i];
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4 + laneGlows[i] * 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Key labels
      ctx.fillStyle = `rgba(255,255,255,${0.3 + laneGlows[i] * 0.7})`;
      ctx.font = `bold ${Math.max(14, nr * 0.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LANE_KEYS[i].toUpperCase(), x, hitY + nr + 20);
    }
  }

  function drawNotes() {
    const hitY = getHitY();
    const nr = getNoteRadius();

    for (const note of notes) {
      if (note.hit || note.missed) continue;
      const y = getNoteY(note);
      if (y < -nr * 2 || y > canvas.height + nr) continue;

      const x = getLaneX(note.lane);
      const img = noteImages[note.imgIndex];

      ctx.save();

      // Glow behind note
      ctx.shadowColor = LANE_COLORS[note.lane];
      ctx.shadowBlur = 12;

      // Clip to circle
      ctx.beginPath();
      ctx.arc(x, y, nr, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, x - nr, y - nr, nr * 2, nr * 2);
      } else {
        ctx.fillStyle = LANE_COLORS[note.lane];
        ctx.fill();
      }

      ctx.restore();

      // Border
      ctx.beginPath();
      ctx.arc(x, y, nr, 0, Math.PI * 2);
      ctx.strokeStyle = LANE_COLORS[note.lane];
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawFeedbacks() {
    for (let i = feedbacks.length - 1; i >= 0; i--) {
      const fb = feedbacks[i];
      ctx.save();
      ctx.globalAlpha = fb.alpha;
      ctx.fillStyle = fb.color;
      ctx.textAlign = 'center';
      ctx.font = fb.big ? 'bold 2rem sans-serif' : 'bold 1.2rem sans-serif';
      ctx.shadowColor = fb.color;
      ctx.shadowBlur = 10;
      ctx.fillText(fb.text, fb.x, fb.y);
      ctx.restore();

      fb.y += fb.vy;
      fb.alpha -= 1 / fb.life;
      fb.life--;
      if (fb.life <= 0) feedbacks.splice(i, 1);
    }
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.alpha -= 1 / p.life;
      p.radius *= 0.98;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawHUD() {
    const currentTime = getCurrentTime();
    const progress = Math.min(currentTime / SONG_DURATION, 1);

    // Score
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 1.4rem sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${score}`, 20, 40);

    // Combo
    if (combo > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = combo >= 50 ? '#ffd700' : combo >= 20 ? '#ff2d95' : '#00e5ff';
      ctx.font = `bold ${Math.min(1.5 + combo * 0.01, 2.5)}rem sans-serif`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = combo >= 20 ? 15 : 5;
      ctx.fillText(`${combo}`, canvas.width - 20, 40);
      ctx.font = '0.8rem sans-serif';
      ctx.fillText('COMBO', canvas.width - 20, 60);
      ctx.shadowBlur = 0;
    }

    // Progress bar
    const barW = canvas.width * 0.3;
    const barH = 4;
    const barX = (canvas.width - barW) / 2;
    const barY = 15;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barW, barH);
    const grad = ctx.createLinearGradient(barX, 0, barX + barW * progress, 0);
    grad.addColorStop(0, '#ff2d95');
    grad.addColorStop(1, '#00e5ff');
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, barW * progress, barH);

    // Time
    const remaining = Math.max(0, SONG_DURATION - currentTime);
    ctx.fillStyle = '#888';
    ctx.font = '0.8rem sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.ceil(remaining)}s`, canvas.width / 2, 35);
  }

  // ─── Utilities ───
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }

  // ─── Game Loop ───
  function update() {
    if (state !== 'playing') return;

    const currentTime = getCurrentTime();

    // Check for misses (notes that passed the hit zone)
    for (const note of notes) {
      if (note.hit || note.missed) continue;
      if (currentTime - note.time > 0.25) {
        handleMiss(note);
      }
    }

    // Decay glows
    for (let i = 0; i < LANE_COUNT; i++) {
      laneGlows[i] *= 0.9;
    }
    bgPulse *= 0.95;

    // End of song
    if (currentTime >= SONG_DURATION + 1) {
      endGame();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state === 'playing') {
      drawBackground();
      drawLanes();
      drawHitZone();
      drawNotes();
      drawParticles();
      drawFeedbacks();
      drawHUD();
    } else if (state === 'title' || state === 'result') {
      drawBackground();
    }

    requestAnimationFrame(draw);
  }

  function startGame() {
    initAudio();
    score = 0;
    combo = 0;
    maxCombo = 0;
    hitCount = 0;
    bgImageIndex = 0;
    counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    feedbacks = [];
    particles = [];
    laneGlows = [0, 0, 0, 0];
    bgPulse = 0;

    generateNotes();
    gameStartTime = performance.now();
    state = 'playing';

    document.getElementById('titleScreen').style.display = 'none';
    document.getElementById('resultScreen').style.display = 'none';

    startDrumLoop();

    function tick() {
      if (state === 'playing') {
        update();
        requestAnimationFrame(tick);
      }
    }
    tick();
  }

  function endGame() {
    state = 'result';
    stopDrumLoop();

    const accuracy = totalNotes > 0
      ? ((counts.perfect * 100 + counts.great * 75 + counts.good * 50) / (totalNotes * 100) * 100)
      : 0;

    let rank, rankClass;
    if (accuracy >= 95) { rank = 'S'; rankClass = 'rank-S'; }
    else if (accuracy >= 85) { rank = 'A'; rankClass = 'rank-A'; }
    else if (accuracy >= 70) { rank = 'B'; rankClass = 'rank-B'; }
    else if (accuracy >= 50) { rank = 'C'; rankClass = 'rank-C'; }
    else { rank = 'D'; rankClass = 'rank-D'; }

    document.getElementById('finalScore').textContent = score.toLocaleString();
    document.getElementById('finalCombo').textContent = maxCombo;
    document.getElementById('finalAccuracy').textContent = accuracy.toFixed(1) + '%';
    document.getElementById('perfectCount').textContent = counts.perfect;
    document.getElementById('greatCount').textContent = counts.great;
    document.getElementById('goodCount').textContent = counts.good;
    document.getElementById('missCount').textContent = counts.miss;

    const rankEl = document.getElementById('rankDisplay');
    rankEl.textContent = rank;
    rankEl.className = 'rank-display ' + rankClass;

    document.getElementById('resultScreen').style.display = 'flex';

    // Share button
    const shareBtn = document.getElementById('shareBtn');
    shareBtn.onclick = () => {
      const text = `【筋肉リズム】スコア${score.toLocaleString()} ランク${rank}！💪\n正確度: ${accuracy.toFixed(1)}% | 最大コンボ: ${maxCombo}\n#MuscleLove #筋肉リズム`;
      const url = 'https://www.patreon.com/cw/MuscleLove';
      window.open(
        `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        '_blank'
      );
    };
  }

  // ─── Input Handling ───
  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (state !== 'playing') return;
    const lane = LANE_KEYS.indexOf(e.key.toLowerCase());
    if (lane !== -1) {
      handleHit(lane);
    }
  });

  // Touch / Click on lanes
  function getLaneFromX(clientX) {
    const left = getPlayAreaLeft();
    const lw = getLaneWidth();
    const x = clientX;
    if (x < left || x > left + lw * LANE_COUNT) return -1;
    return Math.floor((x - left) / lw);
  }

  canvas.addEventListener('touchstart', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    for (const touch of e.changedTouches) {
      const lane = getLaneFromX(touch.clientX);
      if (lane >= 0) handleHit(lane);
    }
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (state !== 'playing') return;
    const lane = getLaneFromX(e.clientX);
    if (lane >= 0) handleHit(lane);
  });

  // ─── UI Buttons ───
  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('retryBtn').addEventListener('click', startGame);

  // ─── Start Render Loop ───
  draw();
})();
