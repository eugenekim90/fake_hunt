(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const killsEl = document.getElementById("kills");
  const lbList = document.getElementById("lb-list");
  const toastEl = document.getElementById("toast");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const startBtn = document.getElementById("start-btn");
  const createRoomBtn = document.getElementById("create-room-btn");
  const joinRoomBtn = document.getElementById("join-room-btn");
  const roomInput = document.getElementById("room-input");
  const nameInput = document.getElementById("name-input");
  const dummyCountInput = document.getElementById("dummy-count");
  const humanBotCountInput = document.getElementById("human-bot-count");
  const netStatus = document.getElementById("net-status");
  const roomChip = document.getElementById("room-chip");

  let WORLD = 2400;
  const PLAYER_SPEED = 210;
  const SWING_RANGE = 78;
  const SWING_ARC = Math.PI * 0.95;
  const PLAYER_SWING_RANGE = 108;
  const PLAYER_SWING_ARC = Math.PI * 1.3;
  const SWING_COOLDOWN = 0.35;
  const DOUBLE_TAP_MS = 280;
  const TAP_MOVE_SLOP = 18;

  const PERSONAL_SPACE = 100;
  const HARD_SEP = 58;

  // Open world presets — scales with joined real players
  const OPEN_PRESET = {
    baseWorld: 2400,
    baseHumans: 6,
    baseFakes: 20,
    perPlayerWorld: 220,
    perPlayerHumans: 1,
    perPlayerFakes: 5,
    maxWorld: 5000,
    maxHumans: 18,
    maxFakes: 70,
  };

  const NAMES = [
    "YOU",
    "mira",
    "knox",
    "jade",
    "ren",
    "ophelia",
    "hex",
    "sol",
    "nova",
    "kade",
    "lyra",
    "orin",
  ];

  let dpr = 1;
  let width = 0;
  let height = 0;
  let running = false;
  let onlineMode = false;
  let roomMode = "solo"; // open | private | solo(local fallback)
  let roomConfig = null;
  let lastPlayerCount = 1;
  let netSendAcc = 0;
  let lastTime = 0;
  let toastTimer = 0;
  let rng = Math.random;
  let usedNames = new Set();

  try {
    const saved = localStorage.getItem("fh_name");
    if (saved && nameInput) nameInput.value = saved;
  } catch (_) {
    /* ignore */
  }

  const input = {
    active: false,
    x: 0,
    y: 0,
    pointerId: null,
  };

  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const camera = { x: 0, y: 0 };
  const entities = [];
  let player = null;
  let swingFx = null;
  let scores = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seedRng(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    rng = function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rand(min, max) {
    return min + rng() * (max - min);
  }

  function pick(arr) {
    return arr[(rng() * arr.length) | 0];
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function showToast(text, ms = 900) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    toastTimer = ms / 1000;
  }

  function makeEntity(kind, name, x, y) {
    return {
      id: Math.random().toString(36).slice(2, 9),
      kind, // player | human | fake
      name,
      x,
      y,
      vx: 0,
      vy: 0,
      angle: rand(0, Math.PI * 2),
      speed: kind === "player" ? PLAYER_SPEED : kind === "human" ? rand(195, 215) : rand(120, 145),
      radius: 22,
      alive: true,
      respawnAt: 0,
      swingCd: 0,
      swingAnim: 0,
      walkPhase: rand(0, Math.PI * 2),
      // AI memory
      ai: {
        mode: "wander",
        timer: rand(0.4, 1.6),
        targetAngle: rand(0, Math.PI * 2),
        pauseChance: kind === "human" ? 0.18 : 0,
        jitter: kind === "human" ? 1.4 : 0.25,
        followId: null,
        huntId: null,
        huntTimer: 0,
        swingReady: 0,
        burst: 0,
        speedMul: kind === "fake" ? rand(0.92, 1.0) : rand(0.9, 1.08),
      },
      killFlash: 0,
    };
  }

  function spawnAwayFromPlayer(minDist = 220) {
    return spawnSpread(minDist, 40);
  }

  function spawnSpread(minDist = 160, tries = 60) {
    for (let i = 0; i < tries; i++) {
      const x = rand(100, WORLD - 100);
      const y = rand(100, WORLD - 100);
      let ok = true;
      for (const e of entities) {
        if (!e.alive) continue;
        const need = e === player ? Math.max(minDist, 200) : minDist;
        if (dist({ x, y }, e) < need) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, y };
    }
    // fallback: farthest from nearest neighbor
    let best = { x: rand(100, WORLD - 100), y: rand(100, WORLD - 100) };
    let bestScore = -1;
    for (let i = 0; i < 30; i++) {
      const x = rand(100, WORLD - 100);
      const y = rand(100, WORLD - 100);
      let nearest = Infinity;
      for (const e of entities) {
        if (!e.alive) continue;
        nearest = Math.min(nearest, dist({ x, y }, e));
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x, y };
      }
    }
    return best;
  }

  function clampInt(v, min, max) {
    return Math.max(min, Math.min(max, (Number(v) | 0) || min));
  }

  function readName() {
    const raw = (nameInput && nameInput.value) || "";
    const clean = String(raw)
      .trim()
      .replace(/[^\w\- ]+/g, "")
      .slice(0, 14);
    if (!clean) return null;
    try {
      localStorage.setItem("fh_name", clean);
    } catch (_) {
      /* ignore */
    }
    return clean;
  }

  function readPrivateConfig() {
    return {
      world: 2200,
      humans: clampInt(humanBotCountInput && humanBotCountInput.value, 2, 30),
      dummies: clampInt(dummyCountInput && dummyCountInput.value, 5, 80),
    };
  }

  function computeDesired(playerCount, mode, cfg) {
    if (mode === "private" && cfg) {
      return {
        world: clampInt(cfg.world || 2200, 1600, 4000),
        humans: clampInt(cfg.humans, 2, 30),
        fakes: clampInt(cfg.dummies, 5, 80),
      };
    }
    // open world (and local preview) — scale with real players
    const n = Math.max(1, playerCount | 0);
    return {
      world: Math.min(
        OPEN_PRESET.maxWorld,
        OPEN_PRESET.baseWorld + (n - 1) * OPEN_PRESET.perPlayerWorld
      ),
      humans: Math.min(
        OPEN_PRESET.maxHumans,
        OPEN_PRESET.baseHumans + (n - 1) * OPEN_PRESET.perPlayerHumans
      ),
      fakes: Math.min(
        OPEN_PRESET.maxFakes,
        OPEN_PRESET.baseFakes + (n - 1) * OPEN_PRESET.perPlayerFakes
      ),
    };
  }

  function uniqueName() {
    let n = pick(NAMES.filter((x) => x !== "YOU"));
    let i = 0;
    while (usedNames.has(n) && i < 24) {
      n = `${pick(NAMES.filter((x) => x !== "YOU"))}${((rng() * 90) | 0) + 10}`;
      i++;
    }
    usedNames.add(n);
    return n;
  }

  function spawnBot(kind) {
    const p = spawnSpread(170);
    const e = makeEntity(kind, uniqueName(), p.x, p.y);
    entities.push(e);
    if (kind === "human") {
      scores.push({ id: e.id, name: e.name, kills: 0, best: 0, you: false });
    }
    return e;
  }

  function reconcilePopulation(desired) {
    if (!desired) return;
    WORLD = desired.world;

    let humans = entities.filter((e) => e.kind === "human").length;
    let fakes = entities.filter((e) => e.kind === "fake").length;

    while (humans < desired.humans) {
      spawnBot("human");
      humans++;
    }
    while (fakes < desired.fakes) {
      spawnBot("fake");
      fakes++;
    }

    // trim extras farthest from player first
    while (humans > desired.humans) {
      let worst = null;
      let bestD = -1;
      for (const e of entities) {
        if (e.kind !== "human") continue;
        const d = player ? dist(e, player) : 0;
        if (d > bestD) {
          bestD = d;
          worst = e;
        }
      }
      if (!worst) break;
      entities.splice(entities.indexOf(worst), 1);
      scores = scores.filter((s) => s.id !== worst.id);
      usedNames.delete(worst.name);
      humans--;
    }
    while (fakes > desired.fakes) {
      let worst = null;
      let bestD = -1;
      for (const e of entities) {
        if (e.kind !== "fake") continue;
        const d = player ? dist(e, player) : 0;
        if (d > bestD) {
          bestD = d;
          worst = e;
        }
      }
      if (!worst) break;
      entities.splice(entities.indexOf(worst), 1);
      usedNames.delete(worst.name);
      fakes--;
    }

    for (const e of entities) {
      e.x = clamp(e.x, 24, WORLD - 24);
      e.y = clamp(e.y, 24, WORLD - 24);
    }
    updateHud();
  }

  function initGame(opts = {}) {
    onlineMode = !!opts.online;
    roomMode = opts.mode || (onlineMode ? "open" : "solo");
    roomConfig = opts.config || null;
    lastPlayerCount = opts.playerCount || 1;
    if (opts.seed) seedRng(String(opts.seed));
    else rng = Math.random;

    const desired = computeDesired(lastPlayerCount, roomMode, roomConfig);
    WORLD = desired.world;

    entities.length = 0;
    const px = WORLD * 0.5;
    const py = WORLD * 0.5;
    const myName =
      opts.name ||
      (window.FHNet && FHNet.getMyName && FHNet.getMyName()) ||
      "YOU";
    player = makeEntity("player", myName, px, py);
    if (onlineMode && window.FHNet && FHNet.getMyId()) {
      player.id = FHNet.getMyId();
      player.name = myName;
    }
    entities.push(player);

    usedNames = new Set([player.name, "YOU"]);

    for (let i = 0; i < desired.humans; i++) spawnBot("human");
    for (let i = 0; i < desired.fakes; i++) spawnBot("fake");

    scores = entities
      .filter((e) => e.kind !== "fake")
      .map((e) => ({ id: e.id, name: e.name, kills: 0, best: 0, you: e.kind === "player" }));

    updateHud();
    camera.x = player.x;
    camera.y = player.y;
  }

  function ensureRemote(id, name) {
    let e = entities.find((x) => x.id === id);
    if (e) {
      if (name) e.name = name;
      return e;
    }
    const p = spawnSpread(200);
    e = makeEntity("remote", name || "guest", p.x, p.y);
    e.id = id;
    e.speed = PLAYER_SPEED;
    entities.push(e);
    if (!scores.find((s) => s.id === id)) {
      scores.push({ id, name: e.name, kills: 0, best: 0, you: false });
      updateHud();
    }
    return e;
  }

  function removeRemote(id) {
    const idx = entities.findIndex((x) => x.id === id && x.kind === "remote");
    if (idx >= 0) entities.splice(idx, 1);
    scores = scores.filter((s) => s.id !== id);
    updateHud();
  }

  function updateHud() {
    const you = scores.find((s) => s.you);
    killsEl.textContent = String(you ? you.kills : 0);

    const ranked = [...scores].sort((a, b) => (b.best || 0) - (a.best || 0) || b.kills - a.kills).slice(0, 8);
    lbList.innerHTML = ranked
      .map(
        (s, i) =>
          `<li class="${s.you ? "you" : ""}"><span>${i + 1}. ${s.name}</span><span>${s.best || 0}</span></li>`
      )
      .join("");
  }

  function applyScoreStats(id, { kills, best } = {}) {
    const row = scores.find((s) => s.id === id);
    if (!row) return;
    if (typeof kills === "number") row.kills = kills;
    if (typeof best === "number") row.best = Math.max(row.best || 0, best);
    // never let best fall behind current life
    row.best = Math.max(row.best || 0, row.kills || 0);
    updateHud();
  }

  function addKill(killerId) {
    const row = scores.find((s) => s.id === killerId);
    if (row) {
      row.kills += 1;
      if (row.kills > (row.best || 0)) row.best = row.kills;
      updateHud();
    }
  }

  function resetKills(id) {
    if (!id) return;
    const row = scores.find((s) => s.id === id);
    if (!row) return;
    // current life resets; personal best stays on the leaderboard
    if (row.kills !== 0) {
      row.best = Math.max(row.best || 0, row.kills);
      row.kills = 0;
      updateHud();
    }
    if (onlineMode && window.FHNet && id === FHNet.getMyId()) {
      FHNet.updatePresenceKills(0, row.best || 0);
    }
  }

  function myScorePair() {
    const you = scores.find((s) => s.you) || {};
    return { kills: you.kills || 0, best: you.best || 0 };
  }

  function worldFromScreen(sx, sy) {
    return {
      x: camera.x + (sx - width / 2),
      y: camera.y + (sy - height / 2),
    };
  }

  function trySwing() {
    if (!player || !player.alive) return;
    if (onlineMode && window.FHNet) {
      FHNet.sendSwing(player.angle, player.x, player.y);
    }
    doSwing(player, true);
  }

  function isRealHunter(e) {
    return e && (e.kind === "human" || e.kind === "player");
  }

  function isRealTarget(e) {
    return e && (e.kind === "human" || e.kind === "player" || e.kind === "remote");
  }

  function doSwing(attacker, announce, onlyTarget) {
    if (!running || !attacker || !attacker.alive) return;
    // only real hunters can swing — fakes never deal damage / kills
    if (!isRealHunter(attacker)) return;
    if (attacker.swingCd > 0) return;

    const isPlayerAtk = attacker === player;
    const range = isPlayerAtk ? PLAYER_SWING_RANGE : SWING_RANGE + 18;
    const arc = isPlayerAtk ? PLAYER_SWING_ARC : SWING_ARC;

    // snap face toward intended prey so the swing actually connects
    if (onlyTarget && onlyTarget.alive) {
      attacker.angle = Math.atan2(onlyTarget.y - attacker.y, onlyTarget.x - attacker.x);
    }

    attacker.swingCd = SWING_COOLDOWN;
    attacker.swingAnim = 0.22;

    if (isPlayerAtk) {
      swingFx = {
        x: attacker.x,
        y: attacker.y,
        angle: attacker.angle,
        t: 0.18,
      };
    }

    let hit = null;
    let best = Infinity;
    for (const e of entities) {
      if (e === attacker || !e.alive) continue;
      if (onlyTarget && e !== onlyTarget) continue;
      if (attacker.kind === "fake" && e.kind === "fake") continue;
      const d = dist(attacker, e);
      if (d > range + e.radius) continue;
      // only skip true body-overlap scrapes
      if (!isPlayerAtk && d < 22) continue;
      const ang = Math.atan2(e.y - attacker.y, e.x - attacker.x);
      const ad = Math.abs(angleDiff(ang, attacker.angle));
      if (ad > arc / 2) continue;
      if (d < best) {
        best = d;
        hit = e;
      }
    }

    if (!hit) {
      if (announce) showToast("MISS");
      return;
    }

    if (isRealTarget(hit)) {
      hit.alive = false;
      hit.respawnAt = hit === player ? 1.6 : hit.kind === "remote" ? 2.0 : 2.4;
      if (hit.ai) hit.ai.huntId = null;
      resetKills(hit.id);
      addKill(attacker.id);
      if (onlineMode && isPlayerAtk && window.FHNet) {
        const me = myScorePair();
        FHNet.sendKill(hit.id, me.kills, me.best);
        FHNet.updatePresenceKills(me.kills, me.best);
      }
      if (announce || hit === player) {
        showToast(hit === player ? "GOT YOU!" : "KILL");
      }
      if (hit === player && navigator.vibrate) navigator.vibrate([50, 30, 50]);
      else if (isPlayerAtk && navigator.vibrate) navigator.vibrate(30);
    } else if (hit.kind === "fake") {
      // Anyone who swings a dummy dies — bots don't know who's real
      attacker.alive = false;
      attacker.respawnAt = isPlayerAtk ? 1.4 : 2.2;
      if (attacker.ai) {
        attacker.ai.huntId = null;
        attacker.ai.mode = "wander";
      }
      resetKills(attacker.id);
      if (onlineMode && isPlayerAtk && window.FHNet) {
        const me = myScorePair();
        FHNet.sendDeath(me.best);
      }
      if (announce) showToast("IT WAS A DUMMY…");
      if (isPlayerAtk && navigator.vibrate) navigator.vibrate([40, 40, 80]);
    }
  }

  function pickHuntTarget(e) {
    // Hunt randomly among nearby bodies — don't know real vs dummy
    const candidates = [];
    for (const o of entities) {
      if (o === e || !o.alive) continue;
      const d = dist(o, e);
      if (d < 40 || d > 480) continue;
      candidates.push({ o, score: d + rand(0, 160) });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score);
    return pick(candidates.slice(0, Math.min(4, candidates.length))).o;
  }

  function respawnEntity(e) {
    const p = spawnSpread(e === player ? 80 : 200);
    e.x = e === player ? WORLD * 0.5 + rand(-80, 80) : p.x;
    e.y = e === player ? WORLD * 0.5 + rand(-80, 80) : p.y;
    if (e === player) {
      e.x = clamp(e.x, 80, WORLD - 80);
      e.y = clamp(e.y, 80, WORLD - 80);
    }
    e.alive = true;
    e.vx = 0;
    e.vy = 0;
    e.angle = rand(0, Math.PI * 2);
    e.ai.timer = rand(0.3, 1.2);
    e.ai.mode = "wander";
    e.ai.followId = null;
    e.ai.huntId = null;
    e.ai.huntTimer = 0;
    e.swingCd = 0;
    e.swingAnim = 0;
  }

  function separationSteer(e, ignoreId) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const o of entities) {
      if (o === e || !o.alive) continue;
      if (ignoreId && o.id === ignoreId) continue;
      const d = dist(e, o);
      if (d > 0 && d < PERSONAL_SPACE) {
        const w = (PERSONAL_SPACE - d) / PERSONAL_SPACE;
        sx += ((e.x - o.x) / d) * w;
        sy += ((e.y - o.y) / d) * w;
        count++;
      }
    }
    if (!count) return null;
    return Math.atan2(sy, sx);
  }

  function chooseFakeAngle(e) {
    // dummies: long straight drifts, slow turns, edge bounce — not hunter-like
    const margin = 180;
    if (e.x < margin) return rand(-0.25, 0.25);
    if (e.x > WORLD - margin) return Math.PI + rand(-0.25, 0.25);
    if (e.y < margin) return Math.PI * 0.5 + rand(-0.25, 0.25);
    if (e.y > WORLD - margin) return -Math.PI * 0.5 + rand(-0.25, 0.25);
    // mostly keep going, rarely nudge
    if (Math.random() < 0.7) return e.angle + rand(-0.35, 0.35);
    return rand(0, Math.PI * 2);
  }

  function chooseHumanAngle(e) {
    const sep = separationSteer(e, e.ai.huntId);
    if (sep != null && Math.random() < 0.55 && e.ai.mode !== "hunt") {
      e.ai.followId = null;
      return sep + rand(-0.25, 0.25);
    }

    if (Math.random() < 0.22) {
      return e.angle + rand(-1.2, 1.2);
    }

    if (Math.random() < 0.35) {
      let bestA = rand(0, Math.PI * 2);
      let bestScore = -Infinity;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6 + rand(-0.2, 0.2);
        const px = e.x + Math.cos(a) * 140;
        const py = e.y + Math.sin(a) * 140;
        let nearest = 400;
        for (const o of entities) {
          if (o === e || !o.alive) continue;
          nearest = Math.min(nearest, dist({ x: px, y: py }, o));
        }
        if (nearest > bestScore) {
          bestScore = nearest;
          bestA = a;
        }
      }
      return bestA;
    }

    const margin = 160;
    if (e.x < margin) return rand(-0.4, 0.4);
    if (e.x > WORLD - margin) return Math.PI + rand(-0.4, 0.4);
    if (e.y < margin) return Math.PI * 0.5 + rand(-0.4, 0.4);
    if (e.y > WORLD - margin) return -Math.PI * 0.5 + rand(-0.4, 0.4);
    return rand(0, Math.PI * 2);
  }

  function updateFakeAi(e, dt) {
    const ai = e.ai;
    ai.timer -= dt;
    // clear any leftover hunt state — fakes never hunt
    ai.huntId = null;
    ai.huntTimer = 0;
    if (ai.mode === "hunt" || ai.mode === "burst" || ai.mode === "pause") {
      ai.mode = "wander";
    }

    if (ai.timer <= 0) {
      ai.mode = "wander";
      ai.targetAngle = chooseFakeAngle(e);
      ai.timer = rand(1.8, 4.2); // long boring stretches
      ai.speedMul = rand(0.9, 1.0);
    }

    // soft unstick only
    const sep = separationSteer(e, null);
    if (sep != null) {
      ai.targetAngle = sep;
    }

    const speed = e.speed * ai.speedMul;
    const turn = sep != null ? 2.4 : 1.35; // sluggish steering = dummy feel
    const diff = angleDiff(ai.targetAngle, e.angle);
    e.angle += clamp(diff, -turn * dt, turn * dt);

    e.vx = Math.cos(e.angle) * speed;
    e.vy = Math.sin(e.angle) * speed;
  }

  function updateHumanAi(e, dt) {
    const ai = e.ai;
    ai.timer -= dt;
    ai.burst = Math.max(0, ai.burst - dt);
    ai.huntTimer = Math.max(0, ai.huntTimer - dt);
    e.swingCd = Math.max(0, e.swingCd - dt);
    e.swingAnim = Math.max(0, e.swingAnim - dt);

    // start hunt
    if (ai.mode !== "hunt" && ai.timer <= 0 && Math.random() < 0.7) {
      const t = pickHuntTarget(e);
      if (t) {
        ai.mode = "hunt";
        ai.huntId = t.id;
        ai.huntTimer = rand(3.5, 7);
        ai.timer = ai.huntTimer;
        ai.followId = null;
        ai.swingReady = 0;
      }
    }

    if (ai.timer <= 0 && ai.mode !== "hunt") {
      const roll = Math.random();
      if (roll < ai.pauseChance) {
        ai.mode = "pause";
        ai.timer = rand(0.15, 0.55);
      } else if (roll < ai.pauseChance + 0.22) {
        ai.mode = "burst";
        ai.burst = rand(0.25, 0.55);
        ai.targetAngle = chooseHumanAngle(e);
        ai.timer = rand(0.5, 1.3);
      } else {
        ai.mode = "wander";
        ai.targetAngle = chooseHumanAngle(e);
        ai.timer = rand(0.45, 1.6);
      }
    }

    let hunting = false;
    let huntTarget = null;
    let inStrike = false;
    if (ai.mode === "hunt" && ai.huntId) {
      huntTarget = entities.find((o) => o.id === ai.huntId && o.alive);
      if (!huntTarget || ai.huntTimer <= 0) {
        ai.mode = "wander";
        ai.huntId = null;
        ai.swingReady = 0;
        ai.timer = rand(0.25, 0.7);
      } else {
        hunting = true;
        const d = dist(e, huntTarget);
        const ang = Math.atan2(huntTarget.y - e.y, huntTarget.x - e.x);
        const strikeMax = SWING_RANGE + 24;

        if (d > 500) {
          ai.mode = "wander";
          ai.huntId = null;
          ai.timer = 0.35;
          hunting = false;
        } else if (d <= strikeMax) {
          // in club range: face prey and commit the swing
          inStrike = true;
          ai.targetAngle = ang;
          ai.swingReady = (ai.swingReady || 0) + dt;
          const facing = Math.abs(angleDiff(ang, e.angle));
          if (e.swingCd <= 0 && facing < 0.7) {
            // wind up briefly, then almost always swing
            if (ai.swingReady > 0.1 || d < SWING_RANGE) {
              doSwing(e, false, huntTarget);
              ai.swingReady = 0;
              // if prey still alive (miss / dummy kill path cleared us), retarget soon
              if (!e.alive) return;
              if (!huntTarget.alive) {
                ai.mode = "wander";
                ai.huntId = null;
                ai.timer = rand(0.4, 1.0);
                hunting = false;
                inStrike = false;
              }
            }
          }
        } else {
          // chase hard — slight weave only
          ai.targetAngle = ang + Math.sin(e.walkPhase * 0.55) * 0.12;
        }
      }
    }

    // ignore prey in separation so we can close and swing
    const sep = separationSteer(e, hunting ? ai.huntId : null);
    if (sep != null && !inStrike) {
      if (!hunting) {
        ai.targetAngle = sep;
        if (ai.mode === "pause") ai.mode = "wander";
      } else {
        ai.targetAngle = Math.atan2(
          Math.sin(ai.targetAngle) * 0.82 + Math.sin(sep) * 0.18,
          Math.cos(ai.targetAngle) * 0.82 + Math.cos(sep) * 0.18
        );
      }
    }

    if (!hunting && Math.random() < 0.025) {
      const nearby = entities.filter((o) => o !== e && o.alive && dist(e, o) < 220);
      if (nearby.length) {
        const pickOne = pick(nearby);
        if (Math.random() < 0.55) {
          ai.mode = "hunt";
          ai.huntId = pickOne.id;
          ai.huntTimer = rand(2.5, 5);
          ai.timer = ai.huntTimer;
          ai.swingReady = 0;
        } else {
          ai.mode = "burst";
          ai.burst = 0.45;
          ai.targetAngle = Math.atan2(pickOne.y - e.y, pickOne.x - e.x) + Math.PI;
          ai.timer = 0.6;
        }
      }
    }

    let speed = 0;
    if (hunting && inStrike) {
      speed = e.speed * 0.42; // plant feet and swing
    } else if (hunting) {
      speed = e.speed * 1.18;
    } else if (ai.mode === "pause" && sep == null) {
      speed = 0;
    } else if (sep != null) {
      speed = e.speed * 1.05;
    } else if (ai.mode === "burst" || ai.burst > 0) {
      speed = e.speed * Math.max(ai.speedMul, 1.08);
    } else {
      speed = e.speed * ai.speedMul;
    }

    if (ai.timer <= 0.016 && ai.mode === "wander") {
      ai.speedMul = rand(0.9, 1.08);
    }

    const turn = inStrike ? 9 : hunting ? 5.2 : sep != null ? 5.2 : 3.4;
    const diff = angleDiff(ai.targetAngle, e.angle);
    e.angle += clamp(diff, -turn * dt, turn * dt);

    e.vx = Math.cos(e.angle) * speed;
    e.vy = Math.sin(e.angle) * speed;
  }

  function updateAi(e, dt) {
    if (e.kind === "fake") updateFakeAi(e, dt);
    else if (e.kind === "human") updateHumanAi(e, dt);
    // remote players are driven by network, not AI
  }

  function updatePlayer(dt) {
    if (!player.alive) return;

    if (input.active) {
      const world = worldFromScreen(input.x, input.y);
      const dx = world.x - player.x;
      const dy = world.y - player.y;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        player.angle = Math.atan2(dy, dx);
        player.vx = Math.cos(player.angle) * PLAYER_SPEED;
        player.vy = Math.sin(player.angle) * PLAYER_SPEED;
      } else {
        // hold near self: keep current heading & speed (no stutter stop)
        player.vx = Math.cos(player.angle) * PLAYER_SPEED;
        player.vy = Math.sin(player.angle) * PLAYER_SPEED;
      }
    } else {
      // gentle coast stop
      player.vx *= 0.9;
      player.vy *= 0.9;
      if (Math.hypot(player.vx, player.vy) < 4) {
        player.vx = 0;
        player.vy = 0;
      }
    }

    player.swingCd = Math.max(0, player.swingCd - dt);
  }

  function integrate(e, dt) {
    if (!e.alive) return;
    e.x = clamp(e.x + e.vx * dt, 24, WORLD - 24);
    e.y = clamp(e.y + e.vy * dt, 24, WORLD - 24);
    const spd = Math.hypot(e.vx, e.vy);
    e.walkPhase += dt * (spd > 8 ? 10 : 2);

    const huntId = e.ai && e.ai.mode === "hunt" ? e.ai.huntId : null;

    // hard push when overlapping + soft personal space
    for (const o of entities) {
      if (o === e || !o.alive) continue;
      const d = dist(e, o);
      if (d <= 0.001) {
        e.x += rand(-1, 1);
        e.y += rand(-1, 1);
        continue;
      }

      // while hunting, allow closing on prey into club range
      if (huntId && o.id === huntId) {
        if (d < 28) {
          const push = ((28 - d) / 28) * 180 * dt;
          e.x += ((e.x - o.x) / d) * push;
          e.y += ((e.y - o.y) / d) * push;
        }
        continue;
      }

      if (d < HARD_SEP) {
        const push = ((HARD_SEP - d) / HARD_SEP) * 240 * dt;
        const nx = (e.x - o.x) / d;
        const ny = (e.y - o.y) / d;
        e.x += nx * push;
        e.y += ny * push;
      } else if (d < PERSONAL_SPACE) {
        const push = ((PERSONAL_SPACE - d) / PERSONAL_SPACE) * 90 * dt;
        const nx = (e.x - o.x) / d;
        const ny = (e.y - o.y) / d;
        e.x += nx * push;
        e.y += ny * push;
      }
    }
    e.x = clamp(e.x, 24, WORLD - 24);
    e.y = clamp(e.y, 24, WORLD - 24);
  }

  function update(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.remove("show");
    }

    if (swingFx) {
      swingFx.t -= dt;
      if (swingFx.t <= 0) swingFx = null;
    }

    updatePlayer(dt);

    for (const e of entities) {
      if (!e.alive) {
        e.respawnAt -= dt;
        if (e.respawnAt <= 0) respawnEntity(e);
        continue;
      }
      if (e.kind !== "player") updateAi(e, dt);
      else {
        e.swingAnim = Math.max(0, e.swingAnim - dt);
      }
      integrate(e, dt);
    }

    // camera follow
    camera.x += (player.x - camera.x) * Math.min(1, 8 * dt);
    camera.y += (player.y - camera.y) * Math.min(1, 8 * dt);

    if (onlineMode && window.FHNet && FHNet.isOnline()) {
      netSendAcc += dt;
      if (netSendAcc >= 0.05) {
        netSendAcc = 0;
        const me = myScorePair();
        FHNet.sendState(player, me.kills, me.best);
      }
    }
  }

  function drawGrid() {
    const step = 80;
    const left = camera.x - width / 2;
    const top = camera.y - height / 2;
    const right = left + width;
    const bottom = top + height;

    ctx.save();
    ctx.translate(width / 2 - camera.x, height / 2 - camera.y);

    // ground
    ctx.fillStyle = "#102018";
    ctx.fillRect(0, 0, WORLD, WORLD);

    ctx.strokeStyle = "rgba(140, 180, 155, 0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= WORLD; x += step) {
      if (x < left - step || x > right + step) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD);
    }
    for (let y = 0; y <= WORLD; y += step) {
      if (y < top - step || y > bottom + step) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD, y);
    }
    ctx.stroke();

    // border
    ctx.strokeStyle = "rgba(141, 255, 176, 0.25)";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, WORLD - 4, WORLD - 4);

    ctx.restore();
  }

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function shade(hex, amount) {
    if (typeof hex !== "string" || !hex.startsWith("#")) return hex;
    const n = hex.replace("#", "");
    const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
    const num = parseInt(full, 16);
    const r = clamp(((num >> 16) & 255) + amount, 0, 255);
    const g = clamp(((num >> 8) & 255) + amount, 0, 255);
    const b = clamp((num & 255) + amount, 0, 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function drawSphere(x, y, r, color) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, shade(color, 70));
    g.addColorStop(0.45, color);
    g.addColorStop(1, shade(color, -55));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawLimb(x1, y1, x2, y2, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    drawSphere(x2, y2, width * 0.55, color);
  }

  function drawClub(pivotX, pivotY, swingT, skin) {
    // swingT: 0 idle, 1 mid-swing forward
    const lift = -0.75 + swingT * 1.7;
    const reach = 4 + swingT * 10;

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(lift);

    // wooden handle
    const handleGrad = ctx.createLinearGradient(0, -2, 18, 2);
    handleGrad.addColorStop(0, "#8a5a32");
    handleGrad.addColorStop(0.5, "#6b4226");
    handleGrad.addColorStop(1, "#4a2c16");
    ctx.strokeStyle = handleGrad;
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(16 + reach * 0.2, -1);
    ctx.stroke();

    // wrap near hand
    ctx.strokeStyle = shade(skin, -40);
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(7, -0.5);
    ctx.stroke();

    // chubby club head
    const cx = 26 + reach * 0.35;
    const cy = -3;
    const clubGrad = ctx.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, 14);
    clubGrad.addColorStop(0, "#f0c090");
    clubGrad.addColorStop(0.4, "#d4924a");
    clubGrad.addColorStop(1, "#7a4318");
    ctx.fillStyle = clubGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 14, 10.5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#5a3010";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // highlight
    ctx.fillStyle = "rgba(255,240,210,0.5)";
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - 4, 5.5, 3, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // cute face on club
    ctx.fillStyle = "#3a2210";
    ctx.beginPath();
    ctx.arc(cx - 3, cy - 1, 1.3, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy - 1.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a2210";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 1.5, 3, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // blush
    ctx.fillStyle = "rgba(255,120,140,0.4)";
    ctx.beginPath();
    ctx.ellipse(cx - 6, cy + 2, 2.4, 1.3, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 7, cy + 1.5, 2.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawStickman(e, sx, sy) {
    const isYou = e === player;
    const skin = isYou ? "#8dffb0" : "#e4eee8";
    const limb = isYou ? "#4eaa78" : "#8f9f96";
    const outline = isYou ? "#1d4a34" : "#2a3530";
    const moving = Math.hypot(e.vx, e.vy) > 20;
    const bob = moving ? Math.sin(e.walkPhase) * 1.6 : 0;
    const stride = moving ? Math.sin(e.walkPhase) * 5.5 : 0;
    const stride2 = moving ? Math.cos(e.walkPhase) * 5.5 : 0;

    let swingT = 0;
    if (e.swingAnim > 0) {
      swingT = Math.sin(clamp(1 - e.swingAnim / 0.18, 0, 1) * Math.PI);
    } else if (swingFx && e === player && swingFx.t > 0) {
      swingT = Math.sin(clamp(1 - swingFx.t / 0.18, 0, 1) * Math.PI);
    }

    const scale = 1.35;

    ctx.save();
    ctx.translate(sx, sy);

    // soft contact shadow
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(0, 14 * scale, 16 * scale, 6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.scale(scale, scale);
    ctx.rotate(e.angle + Math.PI / 2);
    ctx.translate(0, bob);

    // legs (behind)
    drawLimb(-1, 6, -5 - stride * 0.15, 20 + Math.abs(stride) * 0.1, 5, limb);
    drawLimb(1, 6, 5 + stride2 * 0.15, 20 + Math.abs(stride2) * 0.1, 5, limb);
    // shoes as little spheres
    drawSphere(-5 - stride * 0.15, 20, 3.2, shade(limb, -25));
    drawSphere(5 + stride2 * 0.15, 20, 3.2, shade(limb, -25));

    // torso with rim light
    const torsoGrad = ctx.createLinearGradient(-8, -12, 10, 10);
    torsoGrad.addColorStop(0, shade(skin, 55));
    torsoGrad.addColorStop(0.45, skin);
    torsoGrad.addColorStop(1, shade(skin, -50));
    ctx.fillStyle = torsoGrad;
    roundRectPath(-7, -10, 14, 20, 6);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // belly highlight
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(-1.5, -1, 3.5, 5, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // back arm
    drawLimb(-3, -2, -10 - stride * 0.2, 8, 4.2, limb);

    // front arm + club
    const handX = 9 + swingT * 4;
    const handY = -2 - swingT * 6;
    drawLimb(3, -3, handX, handY, 4.4, limb);
    drawClub(handX, handY, swingT, skin);

    // head sphere
    drawSphere(0, -20, 11.5, skin);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, -20, 11.5, 0, Math.PI * 2);
    ctx.stroke();

    // face
    ctx.save();
    ctx.translate(0, -20);
    ctx.fillStyle = "#1a2420";
    ctx.beginPath();
    ctx.arc(-3.8, -0.8, 1.55, 0, Math.PI * 2);
    ctx.arc(3.8, -0.8, 1.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(-3.2, -1.4, 0.65, 0, Math.PI * 2);
    ctx.arc(4.4, -1.4, 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 120, 140, 0.4)";
    ctx.beginPath();
    ctx.ellipse(-6.2, 2.4, 2.6, 1.4, 0, 0, Math.PI * 2);
    ctx.ellipse(6.2, 2.4, 2.6, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a2420";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(0, 1.8, 3.1, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  function drawEntity(e) {
    if (!e.alive) return;
    const sx = width / 2 + (e.x - camera.x);
    const sy = height / 2 + (e.y - camera.y);
    if (sx < -60 || sy < -60 || sx > width + 60 || sy > height + 60) return;

    drawStickman(e, sx, sy);

    if (e === player) {
      ctx.fillStyle = "rgba(232,240,234,0.85)";
      ctx.font = "12px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(onlineMode ? e.name || "YOU" : "YOU", sx, sy - 52);
    } else if (e.kind === "remote") {
      ctx.fillStyle = "rgba(180,220,255,0.85)";
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(e.name || "?", sx, sy - 52);
    }
  }

  function drawSwing() {
    if (!swingFx) return;
    const sx = width / 2 + (swingFx.x - camera.x);
    const sy = height / 2 + (swingFx.y - camera.y);
    const alpha = clamp(swingFx.t / 0.18, 0, 1);
    const progress = 1 - alpha;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(swingFx.angle);
    // soft whoosh arc
    ctx.beginPath();
    ctx.arc(0, 0, SWING_RANGE - 4, -0.9 + progress * 0.3, 0.7 + progress * 0.2);
    ctx.strokeStyle = `rgba(232, 176, 120, ${0.55 * alpha})`;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 220, 180, ${0.35 * alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    drawGrid();

    // y-sort for simple depth
    const sorted = entities.filter((e) => e.alive).sort((a, b) => a.y - b.y);
    for (const e of sorted) drawEntity(e);
    drawSwing();

    if (input.active && player && player.alive) {
      ctx.beginPath();
      ctx.arc(input.x, input.y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(141,255,176,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function frame(t) {
    const now = t * 0.001;
    const dt = Math.min(0.033, now - lastTime || 0.016);
    lastTime = now;
    if (running) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function setPointer(x, y) {
    input.x = x;
    input.y = y;
  }

  function onPointerDown(e) {
    if (!running) return;
    if (e.target && e.target.closest && e.target.closest("#overlay")) return;

    const now = performance.now();
    const dx = e.clientX - lastTapX;
    const dy = e.clientY - lastTapY;
    const near = Math.hypot(dx, dy) < TAP_MOVE_SLOP * 2;

    if (near && now - lastTapTime <= DOUBLE_TAP_MS) {
      trySwing();
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    }

    // keep steering continuously — swing never interrupts move input
    input.active = true;
    input.pointerId = e.pointerId ?? 1;
    setPointer(e.clientX, e.clientY);
    try {
      if (e.pointerId != null) canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    if (e.cancelable) e.preventDefault();
  }

  function onPointerMove(e) {
    if (!running || !input.active) return;
    if (e.pointerId != null && input.pointerId != null && e.pointerId !== input.pointerId) {
      return;
    }
    setPointer(e.clientX, e.clientY);
    if (e.cancelable) e.preventDefault();
  }

  function onPointerUp(e) {
    if (e.pointerId != null && input.pointerId != null && e.pointerId !== input.pointerId) {
      return;
    }
    input.active = false;
    input.pointerId = null;
  }

  function startGame(opts = {}) {
    initGame(opts);
    overlay.classList.add("hidden");
    running = true;
    if (onlineMode && roomChip) {
      const code = FHNet.getRoomCode();
      const label = code === FHNet.OPEN_CODE ? "OPEN WORLD" : `ROOM ${code}`;
      roomChip.textContent = label;
      roomChip.classList.remove("hidden");
    } else if (roomChip) {
      roomChip.classList.add("hidden");
    }
    const toast =
      roomMode === "open"
        ? "OPEN WORLD"
        : roomMode === "private"
          ? `ROOM ${FHNet.getRoomCode()}`
          : "Find the real ones";
    showToast(toast);
  }

  async function startOpenWorld() {
    if (!window.FHNet) {
      if (netStatus) netStatus.textContent = "net.js missing";
      return;
    }
    const name = readName();
    if (!name) {
      if (netStatus) netStatus.textContent = "Enter your name first";
      if (nameInput) nameInput.focus();
      return;
    }
    if (netStatus) netStatus.textContent = "Joining open world…";
    startBtn.disabled = true;
    try {
      const info = await FHNet.joinOpenWorld(name);
      if (netStatus) netStatus.textContent = "Open world connected";
      startGame({
        online: true,
        mode: "open",
        seed: "OPEN",
        name: info.myName,
        playerCount: 1,
      });
    } catch (err) {
      if (netStatus) netStatus.textContent = String(err.message || err);
    } finally {
      startBtn.disabled = false;
    }
  }

  async function startOnlineCreate() {
    if (!window.FHNet) {
      if (netStatus) netStatus.textContent = "net.js missing";
      return;
    }
    const name = readName();
    if (!name) {
      if (netStatus) netStatus.textContent = "Enter your name first";
      if (nameInput) nameInput.focus();
      return;
    }
    const config = readPrivateConfig();
    if (netStatus) netStatus.textContent = "Creating private room…";
    createRoomBtn.disabled = true;
    try {
      const info = await FHNet.createRoom(name, config);
      if (netStatus) netStatus.textContent = `Room ${info.roomCode}`;
      startGame({
        online: true,
        mode: "private",
        seed: info.roomCode,
        name: info.myName,
        config,
        playerCount: 1,
      });
    } catch (err) {
      if (netStatus) netStatus.textContent = String(err.message || err);
    } finally {
      createRoomBtn.disabled = false;
    }
  }

  async function startOnlineJoin() {
    if (!window.FHNet) {
      if (netStatus) netStatus.textContent = "net.js missing";
      return;
    }
    const name = readName();
    if (!name) {
      if (netStatus) netStatus.textContent = "Enter your name first";
      if (nameInput) nameInput.focus();
      return;
    }
    const code = (roomInput && roomInput.value) || "";
    if (netStatus) netStatus.textContent = "Joining…";
    joinRoomBtn.disabled = true;
    try {
      const info = await FHNet.joinRoom(code, name);
      const cfg =
        info.config ||
        (window.FHNet.getRoomMeta && FHNet.getRoomMeta()) ||
        null;
      const mode = info.open || info.roomCode === FHNet.OPEN_CODE ? "open" : "private";
      if (netStatus) netStatus.textContent = `Joined ${info.roomCode}`;
      startGame({
        online: true,
        mode,
        seed: info.roomCode,
        name: info.myName,
        config: cfg,
        playerCount: 1,
      });
    } catch (err) {
      if (netStatus) netStatus.textContent = String(err.message || err);
    } finally {
      joinRoomBtn.disabled = false;
    }
  }

  function applyPresenceScale(state) {
    if (!onlineMode || !running || !window.FHNet) return;
    const count = FHNet.countPlayers(state);
    const cfg = FHNet.extractRoomConfig(state) || roomConfig;
    if (cfg) {
      roomConfig = cfg;
      FHNet.setRoomMeta(cfg);
    }
    if (roomMode === "private" && cfg) {
      const desired = computeDesired(count, "private", cfg);
      if (
        desired.humans !== entities.filter((e) => e.kind === "human").length ||
        desired.fakes !== entities.filter((e) => e.kind === "fake").length ||
        desired.world !== WORLD
      ) {
        reconcilePopulation(desired);
      }
      lastPlayerCount = count;
      return;
    }
    // open world scales with player count
    if (count !== lastPlayerCount || roomMode === "open") {
      lastPlayerCount = count;
      reconcilePopulation(computeDesired(count, "open", null));
    }
  }

  function wireNet() {
    if (!window.FHNet) return;

    FHNet.on("sync", (state) => {
      if (!onlineMode || !running) return;
      const seen = new Set();
      for (const key of Object.keys(state || {})) {
        const metas = state[key] || [];
        for (const m of metas) {
          if (!m || !m.id || m.id === FHNet.getMyId()) continue;
          seen.add(m.id);
          const remote = ensureRemote(m.id, m.name);
          applyScoreStats(m.id, {
            kills: typeof m.kills === "number" ? m.kills : undefined,
            best: typeof m.best === "number" ? m.best : m.kills,
          });
          remote._netSeen = performance.now();
        }
      }
      for (const e of [...entities]) {
        if (e.kind === "remote" && !seen.has(e.id)) removeRemote(e.id);
      }
      applyPresenceScale(state);
      updateHud();
    });

    FHNet.on("config", (cfg) => {
      if (!onlineMode || !running || !cfg) return;
      roomConfig = cfg;
      roomMode = "private";
      reconcilePopulation(computeDesired(lastPlayerCount, "private", cfg));
    });

    FHNet.on("state", (p) => {
      if (!onlineMode || !running || !p || !p.id) return;
      const remote = ensureRemote(p.id, p.name);
      remote.x = p.x;
      remote.y = p.y;
      remote.angle = p.angle;
      if (p.alive === false && remote.alive) {
        remote.alive = false;
        remote.respawnAt = 1.6;
      } else if (p.alive !== false) {
        remote.alive = true;
      }
      applyScoreStats(p.id, {
        kills: typeof p.kills === "number" ? p.kills : undefined,
        best: typeof p.best === "number" ? p.best : undefined,
      });
    });

    FHNet.on("swing", (p) => {
      if (!onlineMode || !running || !p) return;
      const remote = ensureRemote(p.id);
      remote.angle = p.angle;
      if (typeof p.x === "number") remote.x = p.x;
      if (typeof p.y === "number") remote.y = p.y;
      remote.swingAnim = 0.18;
      // authority: only killer's client resolves hits; others just show anim
    });

    FHNet.on("kill", (p) => {
      if (!onlineMode || !running || !p) return;
      if (p.victimId === (player && player.id)) {
        if (player.alive) {
          player.alive = false;
          player.respawnAt = 1.6;
          showToast("GOT YOU!");
          if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
        }
        resetKills(player.id);
      } else {
        const victim = entities.find((e) => e.id === p.victimId);
        if (victim && victim.alive) {
          victim.alive = false;
          victim.respawnAt = 2.0;
        }
        resetKills(p.victimId);
      }
      if (p.killerId) {
        if (typeof p.kills === "number" || typeof p.best === "number") {
          applyScoreStats(p.killerId, {
            kills: typeof p.kills === "number" ? p.kills : undefined,
            best: typeof p.best === "number" ? p.best : p.kills,
          });
        } else {
          addKill(p.killerId);
        }
      }
    });

    FHNet.on("death", (p) => {
      if (!onlineMode || !running || !p) return;
      const remote = entities.find((e) => e.id === p.id);
      if (remote && remote.alive) {
        remote.alive = false;
        remote.respawnAt = 1.6;
      }
      // keep best; only wipe current life
      applyScoreStats(p.id, {
        kills: 0,
        best: typeof p.best === "number" ? p.best : undefined,
      });
      resetKills(p.id);
    });
  }

  startBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startOpenWorld();
  });

  createRoomBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startOnlineCreate();
  });

  joinRoomBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startOnlineJoin();
  });

  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      startOnlineJoin();
    }
  });

  if (nameInput) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        startOpenWorld();
      }
    });
  }

  // don't auto-start when tapping UI controls
  overlay.addEventListener(
    "pointerdown",
    (e) => {
      if (
        e.target === startBtn ||
        e.target === createRoomBtn ||
        e.target === joinRoomBtn ||
        e.target === roomInput ||
        e.target === nameInput ||
        (e.target && e.target.closest && e.target.closest(".card"))
      ) {
        return;
      }
    },
    { passive: false }
  );

  wireNet();

  window.addEventListener("pointerdown", onPointerDown, { passive: false });
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  // mouse fallback only when PointerEvent is missing
  if (!window.PointerEvent) {
    window.addEventListener("mousedown", onPointerDown, { passive: false });
    window.addEventListener("mousemove", onPointerMove, { passive: false });
    window.addEventListener("mouseup", onPointerUp);
  }
  window.addEventListener("resize", resize);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (!running) startOpenWorld();
      else trySwing();
    }
    if (e.code === "Enter" && !running && document.activeElement !== roomInput) {
      startOpenWorld();
    }
  });

  resize();
  initGame({ mode: "open", playerCount: 1 });
  running = false;
  requestAnimationFrame(frame);
})();
