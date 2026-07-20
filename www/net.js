(() => {
  const url = window.FH_SUPABASE_URL;
  const key = window.FH_SUPABASE_ANON_KEY;
  const OPEN_CODE = "OPEN";

  let client = null;
  let channel = null;
  let roomCode = null;
  let myId = null;
  let myName = null;
  let online = false;
  let roomMeta = null;
  let lastPresence = {};

  const handlers = {
    join: [],
    leave: [],
    state: [],
    swing: [],
    kill: [],
    death: [],
    sync: [],
    status: [],
    config: [],
    feed: [],
  };

  function emit(type, payload) {
    for (const fn of handlers[type] || []) fn(payload);
  }

  function on(type, fn) {
    handlers[type].push(fn);
  }

  function ensureClient() {
    if (client) return client;
    if (!url || !key) throw new Error("Missing Fake Hunt Supabase config");
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("supabase-js not loaded");
    }
    client = window.supabase.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client;
  }

  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
    return s;
  }

  function sanitizeName(name) {
    const clean = String(name || "")
      .trim()
      .replace(/[^\w\- ]+/g, "")
      .slice(0, 14);
    return clean || null;
  }

  async function leave() {
    if (channel) {
      try {
        await channel.unsubscribe();
      } catch (_) {
        /* ignore */
      }
      channel = null;
    }
    roomCode = null;
    roomMeta = null;
    online = false;
    lastPresence = {};
    emit("status", { online: false, room: null });
  }

  function presencePayload(extra = {}) {
    return {
      id: myId,
      name: myName,
      kills: extra.kills || 0,
      best: extra.best || 0,
      x: typeof extra.x === "number" ? extra.x : null,
      y: typeof extra.y === "number" ? extra.y : null,
      angle: typeof extra.angle === "number" ? extra.angle : null,
      alive: extra.alive !== false,
      joinedAt: Date.now(),
      host: !!extra.host,
      open: roomCode === OPEN_CODE,
      config: roomMeta,
    };
  }

  async function connect(code, name, meta = {}) {
    const cleanName = sanitizeName(name);
    if (!cleanName) throw new Error("Enter your name");

    await leave();
    ensureClient();
    myId = `p_${Math.random().toString(36).slice(2, 10)}`;
    myName = cleanName;
    roomCode = String(code).toUpperCase();
    roomMeta = meta.config || null;
    online = true;

    // Public realtime room — same topic = same lobby for every client/build
    channel = client.channel(`fh:${roomCode}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: myId },
      },
    });

    channel.on("presence", { event: "sync" }, () => {
      lastPresence = channel.presenceState() || {};
      emit("sync", lastPresence);
    });

    channel.on("broadcast", { event: "state" }, ({ payload }) => {
      if (!payload || payload.id === myId) return;
      emit("state", payload);
    });

    channel.on("broadcast", { event: "hello" }, ({ payload }) => {
      if (!payload || payload.id === myId) return;
      emit("state", payload);
      emit("sync", channel.presenceState() || lastPresence);
    });

    channel.on("broadcast", { event: "swing" }, ({ payload }) => {
      if (!payload || payload.id === myId) return;
      emit("swing", payload);
    });

    channel.on("broadcast", { event: "kill" }, ({ payload }) => {
      if (!payload) return;
      emit("kill", payload);
    });

    channel.on("broadcast", { event: "death" }, ({ payload }) => {
      if (!payload || payload.id === myId) return;
      emit("death", payload);
    });

    channel.on("broadcast", { event: "config" }, ({ payload }) => {
      if (!payload) return;
      roomMeta = payload;
      emit("config", payload);
    });

    channel.on("broadcast", { event: "feed" }, ({ payload }) => {
      if (!payload || !payload.line) return;
      emit("feed", payload);
    });

    await new Promise((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track(
            presencePayload({
              host: !!meta.host,
              kills: 0,
              best: 0,
            })
          );
          lastPresence = channel.presenceState() || {};
          if (meta.host && meta.config) {
            channel.send({ type: "broadcast", event: "config", payload: meta.config });
          }
          emit("status", {
            online: true,
            room: roomCode,
            id: myId,
            name: myName,
            open: roomCode === OPEN_CODE,
            config: meta.config || null,
          });
          emit("sync", lastPresence);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(new Error(status));
        }
      });
    });

    return {
      roomCode,
      myId,
      myName,
      open: roomCode === OPEN_CODE,
      config: meta.config || null,
      players: countPlayers(lastPresence),
    };
  }

  async function joinOpenWorld(name) {
    return connect(OPEN_CODE, name, { open: true });
  }

  async function createRoom(name, config) {
    return connect(randomCode(), name, { host: true, config });
  }

  async function joinRoom(code, name) {
    const clean = String(code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (clean.length < 3) throw new Error("Invalid room code");
    if (clean === OPEN_CODE) return joinOpenWorld(name);
    return connect(clean, name, {});
  }

  function send(event, payload) {
    if (!channel || !online) return;
    channel.send({ type: "broadcast", event, payload });
  }

  function sendState(player, kills, best) {
    if (!player) return;
    const payload = {
      id: myId,
      name: myName,
      x: player.x,
      y: player.y,
      angle: player.angle,
      alive: !!player.alive,
      kills: kills || 0,
      best: best || 0,
    };
    send("state", payload);
  }

  function announce(player, kills, best) {
    if (!player || !channel || !online) return;
    const payload = {
      id: myId,
      name: myName,
      x: player.x,
      y: player.y,
      angle: player.angle,
      alive: !!player.alive,
      kills: kills || 0,
      best: best || 0,
    };
    send("hello", payload);
    send("state", payload);
    channel.track(
      presencePayload({
        kills: kills || 0,
        best: best || 0,
        x: player.x,
        y: player.y,
        angle: player.angle,
        alive: !!player.alive,
      })
    );
  }

  function sendSwing(angle, x, y) {
    send("swing", { id: myId, angle, x, y });
  }

  function sendKill(victimId, killerKills, killerBest, meta = {}) {
    send("kill", {
      killerId: myId,
      victimId,
      kills: killerKills || 0,
      best: killerBest || 0,
      killerName: meta.killerName || myName,
      victimName: meta.victimName || null,
      line: meta.line || null,
    });
  }

  function sendDeath(best, meta = {}) {
    send("death", {
      id: myId,
      best: best || 0,
      kills: 0,
      name: meta.name || myName,
      reason: meta.reason || null,
      line: meta.line || null,
    });
  }

  function sendFeed(line) {
    send("feed", { id: myId, line });
  }

  function updatePresenceKills(kills, best, player) {
    if (!channel || !online) return;
    channel.track(
      presencePayload({
        kills: kills || 0,
        best: best || 0,
        x: player && typeof player.x === "number" ? player.x : null,
        y: player && typeof player.y === "number" ? player.y : null,
        angle: player && typeof player.angle === "number" ? player.angle : null,
        alive: !player || player.alive !== false,
      })
    );
  }

  function countPlayers(presenceState) {
    const ids = new Set();
    for (const key of Object.keys(presenceState || {})) {
      for (const m of presenceState[key] || []) {
        if (m && m.id) ids.add(m.id);
      }
    }
    return Math.max(1, ids.size);
  }

  function extractRoomConfig(presenceState) {
    for (const key of Object.keys(presenceState || {})) {
      for (const m of presenceState[key] || []) {
        if (m && m.config) return m.config;
      }
    }
    return roomMeta;
  }

  function getPresenceState() {
    if (channel) lastPresence = channel.presenceState() || lastPresence;
    return lastPresence;
  }

  window.FHNet = {
    on,
    OPEN_CODE,
    joinOpenWorld,
    createRoom,
    joinRoom,
    leave,
    isOnline: () => online,
    getRoomCode: () => roomCode,
    getMyId: () => myId,
    getMyName: () => myName,
    getRoomMeta: () => roomMeta,
    setRoomMeta: (c) => {
      roomMeta = c;
    },
    sendState,
    announce,
    sendSwing,
    sendKill,
    sendDeath,
    sendFeed,
    updatePresenceKills,
    countPlayers,
    extractRoomConfig,
    getPresenceState,
  };
})();
