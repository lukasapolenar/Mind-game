(function (root) {
  "use strict";
  const config=root.__OKRAJOVKA_CONFIG__||{};
  const listeners=new Set();
  let client=null;
  let session=null;
  let snapshot=null;
  let channel=null;
  let heartbeatTimer=null;

  function configured() {
    return Boolean(config.supabaseUrl&&config.supabaseAnonKey&&root.supabase?.createClient);
  }
  function emit() {
    const detail={...snapshot,localUserId:session?.user?.id||null};
    listeners.forEach(listener=>listener(detail));
    root.dispatchEvent(new CustomEvent("online:snapshot",{detail}));
  }
  async function auth() {
    if (!configured()) throw new Error("Online multiplayer není nakonfigurovaný.");
    if (!client) client=root.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
    const existing=await client.auth.getSession();
    session=existing.data.session;
    if (!session) {
      const result=await client.auth.signInAnonymously();
      if (result.error) throw result.error;
      session=result.data.session;
    }
    return session;
  }
  async function api(path,payload) {
    await auth();
    const response=await fetch(path,{
      method:"POST",
      headers:{"content-type":"application/json",authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify(payload)
    });
    const result=await response.json().catch(()=>({ok:false,error:"Server vrátil neplatnou odpověď."}));
    if (!response.ok||!result.ok) throw Object.assign(new Error(result.error||"Online požadavek selhal."),{status:response.status});
    return result.data;
  }
  async function loadSnapshot(roomId) {
    const [roomResult,playersResult,gameResult]=await Promise.all([
      client.from("rooms").select("*").eq("id",roomId).single(),
      client.from("room_players").select("*").eq("room_id",roomId).order("seat"),
      client.from("game_states").select("*").eq("room_id",roomId).maybeSingle()
    ]);
    const error=roomResult.error||playersResult.error||gameResult.error;
    if (error) throw error;
    snapshot={room:roomResult.data,players:playersResult.data,game:gameResult.data};
    emit();
    return snapshot;
  }
  async function subscribe(roomId) {
    if (channel) await client.removeChannel(channel);
    channel=client.channel(`room:${roomId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"rooms",filter:`id=eq.${roomId}`},()=>loadSnapshot(roomId))
      .on("postgres_changes",{event:"*",schema:"public",table:"room_players",filter:`room_id=eq.${roomId}`},()=>loadSnapshot(roomId))
      .on("postgres_changes",{event:"*",schema:"public",table:"game_states",filter:`room_id=eq.${roomId}`},()=>loadSnapshot(roomId))
      .subscribe();
    clearInterval(heartbeatTimer);
    heartbeatTimer=setInterval(()=>api("/api/rooms",{action:"heartbeat",roomId}).catch(()=>{}),15000);
  }
  async function accept(data) {
    if (data?.needsNickname) return data;
    snapshot=data;
    await subscribe(data.room.id);
    emit();
    return data;
  }
  async function createRoom(nickname,botCount) {
    return accept(await api("/api/rooms",{action:"create",nickname,botCount}));
  }
  async function joinRoom(code,nickname) {
    return accept(await api("/api/rooms",{action:"join",code,nickname}));
  }
  async function resumeRoom(code) {
    return accept(await api("/api/rooms",{action:"resume",code}));
  }
  async function setCharacter(character) {
    return accept(await api("/api/rooms",{action:"character",roomId:snapshot.room.id,character}));
  }
  async function prepareGame() {
    await api("/api/rooms",{action:"prepare",roomId:snapshot.room.id});
    return loadSnapshot(snapshot.room.id);
  }
  async function activateGame() {
    await api("/api/rooms",{action:"activate",roomId:snapshot.room.id});
    return loadSnapshot(snapshot.room.id);
  }
  async function submitAction(action) {
    const idempotencyKey=crypto.randomUUID().replaceAll("-","_");
    await api("/api/game",{
      action:"submit",roomId:snapshot.room.id,expectedVersion:snapshot.game.version,
      idempotencyKey,action
    });
    return loadSnapshot(snapshot.room.id);
  }
  function localPlayer() {
    return snapshot?.players?.find(player=>player.user_id===session?.user?.id)||null;
  }
  function shareUrl() {
    return snapshot?`${location.origin}/game/${snapshot.room.code}`:"";
  }
  async function initializeFromLocation() {
    if (!configured()) return {configured:false};
    await auth();
    const match=/\/game\/([A-Z2-9]{6})\/?$/i.exec(location.pathname);
    if (!match) return {configured:true};
    return resumeRoom(match[1].toUpperCase());
  }
  function onSnapshot(listener) {
    listeners.add(listener);
    if (snapshot) listener({...snapshot,localUserId:session?.user?.id||null});
    return ()=>listeners.delete(listener);
  }
  root.OnlineGame=Object.freeze({
    configured,initializeFromLocation,createRoom,joinRoom,resumeRoom,setCharacter,
    prepareGame,activateGame,submitAction,onSnapshot,localPlayer,shareUrl,
    get snapshot(){return snapshot;},
    get userId(){return session?.user?.id||null;}
  });
})(globalThis);
