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
    emit("status", { online: false, room: null });
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

    channel = client.channel(`fh:${roomCode}`, {
      config: { presence: { key: myId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      emit("sync", state);
    });

    channel.on("broadcast", { event: "state" }, ({ payload }) => {
      if (!payload || payload.id === myId) return;
      emit("state", payload);
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

    await new Promise((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            id: myId,
            name: myName,
            kills: 0,
            joinedAt: Date.now(),
            host: !!meta.host,
            open: roomCode === OPEN_CODE,
            config: meta.config || null,
          });
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
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(new Error(status));
        }
      });
    });

    return { roomCode, myId, myName, open: roomCode === OPEN_CODE, config: meta.config || null };
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

  function sendState(player, kills) {
    if (!player || !player.alive) return;
    send("state", {
      id: myId,
      name: myName,
      x: player.x,
      y: player.y,
      angle: player.angle,
      alive: player.alive,
      kills: kills || 0,
    });
  }

  function sendSwing(angle, x, y) {
    send("swing", { id: myId, angle, x, y });
  }

  function sendKill(victimId, killerKills) {
    send("kill", { killerId: myId, victimId, kills: killerKills || 0 });
  }

  function sendDeath() {
    send("death", { id: myId });
  }

  function updatePresenceKills(kills) {
    if (!channel || !online) return;
    channel.track({
      id: myId,
      name: myName,
      kills: kills || 0,
      joinedAt: Date.now(),
      open: roomCode === OPEN_CODE,
      config: roomMeta,
    });
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
    sendSwing,
    sendKill,
    sendDeath,
    updatePresenceKills,
    countPlayers,
    extractRoomConfig,
  };
})();
