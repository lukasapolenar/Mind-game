"use strict";

const crypto=require("node:crypto");
const GameSession=require("../outputs/game-session.js");

const CODE_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_NAMES=["Ada","Borek","Cora","Dex","Eli"];
const CHARACTERS=["hunter","cowboy","jumper"];

function roomCode() {
  return Array.from(crypto.randomBytes(6).subarray(0,6),byte=>CODE_ALPHABET[byte%CODE_ALPHABET.length]).join("");
}

function nickname(value) {
  const clean=String(value||"").trim().replace(/\s+/g," ").slice(0,18);
  if (clean.length<2) throw new Error("Přezdívka musí mít alespoň 2 znaky.");
  return clean;
}

async function snapshot(client,roomId) {
  const [{data:room,error:roomError},{data:players,error:playersError},{data:game,error:gameError}]=await Promise.all([
    client.from("rooms").select("*").eq("id",roomId).single(),
    client.from("room_players").select("*").eq("room_id",roomId).order("seat"),
    client.from("game_states").select("*").eq("room_id",roomId).maybeSingle()
  ]);
  if (roomError||playersError||gameError) throw roomError||playersError||gameError;
  return {room,players,game};
}

async function createRoom(client,user,input) {
  const hostName=nickname(input.nickname);
  const botCount=Math.max(0,Math.min(5,Number(input.botCount)||0));
  for (let attempt=0;attempt<8;attempt++) {
    const code=roomCode();
    const {data:room,error}=await client.from("rooms").insert({
      code,host_user_id:user.id,phase:"lobby",max_players:6
    }).select().single();
    if (error?.code==="23505") continue;
    if (error) throw error;
    const rows=[{
      room_id:room.id,user_id:user.id,nickname:hostName,is_host:true,is_bot:false,
      character:null,connected:true,seat:0,last_seen_at:new Date().toISOString()
    },...Array.from({length:botCount},(_,index)=>({
      room_id:room.id,user_id:null,nickname:BOT_NAMES[index],is_host:false,is_bot:true,
      character:CHARACTERS[index%CHARACTERS.length],connected:true,seat:index+1,last_seen_at:new Date().toISOString()
    }))];
    const {error:playerError}=await client.from("room_players").insert(rows);
    if (playerError) throw playerError;
    return snapshot(client,room.id);
  }
  throw new Error("Nepodařilo se vytvořit unikátní kód místnosti.");
}

async function joinRoom(client,user,input) {
  const code=String(input.code||"").trim().toUpperCase();
  const playerName=nickname(input.nickname);
  const {data:room,error}=await client.from("rooms").select("*").eq("code",code).maybeSingle();
  if (error) throw error;
  if (!room) throw Object.assign(new Error("Místnost neexistuje nebo vypršela."),{statusCode:404});
  if (new Date(room.expires_at).getTime()<=Date.now()) {
    throw Object.assign(new Error("Platnost místnosti už vypršela."),{statusCode:410});
  }
  if (!["lobby","ready","playing"].includes(room.phase)) throw new Error("Do této místnosti se už nelze připojit.");
  const {data:existing}=await client.from("room_players").select("*").eq("room_id",room.id).eq("user_id",user.id).maybeSingle();
  if (existing) {
    await client.from("room_players").update({nickname:playerName,connected:true,last_seen_at:new Date().toISOString()}).eq("id",existing.id);
    return snapshot(client,room.id);
  }
  if (room.phase!=="lobby") throw new Error("Hra už začala.");
  const {data:players,error:playersError}=await client.from("room_players").select("*").eq("room_id",room.id).order("seat");
  if (playersError) throw playersError;
  const bot=players.find(player=>player.is_bot);
  if (!bot&&players.length>=room.max_players) throw new Error("Místnost je plná.");
  if (bot) {
    const {error:updateError}=await client.from("room_players").update({
      user_id:user.id,nickname:playerName,is_bot:false,character:null,connected:true,last_seen_at:new Date().toISOString()
    }).eq("id",bot.id);
    if (updateError) throw updateError;
  } else {
    const seat=Math.max(-1,...players.map(player=>player.seat))+1;
    const {error:insertError}=await client.from("room_players").insert({
      room_id:room.id,user_id:user.id,nickname:playerName,is_host:false,is_bot:false,
      character:null,connected:true,seat,last_seen_at:new Date().toISOString()
    });
    if (insertError) throw insertError;
  }
  return snapshot(client,room.id);
}

async function resumeRoom(client,user,input) {
  const code=String(input.code||"").trim().toUpperCase();
  const {data:room,error}=await client.from("rooms").select("*").eq("code",code).maybeSingle();
  if (error) throw error;
  if (!room) throw Object.assign(new Error("Místnost neexistuje nebo vypršela."),{statusCode:404});
  if (new Date(room.expires_at).getTime()<=Date.now()) {
    throw Object.assign(new Error("Platnost místnosti už vypršela."),{statusCode:410});
  }
  const {data:player}=await client.from("room_players").select("id").eq("room_id",room.id).eq("user_id",user.id).maybeSingle();
  if (!player) return {needsNickname:true,room:{id:room.id,code:room.code,phase:room.phase}};
  await client.from("room_players").update({connected:true,last_seen_at:new Date().toISOString()}).eq("id",player.id);
  return snapshot(client,room.id);
}

async function heartbeat(client,user,input) {
  const now=new Date();
  const staleBefore=new Date(now.getTime()-45000).toISOString();
  const {data:player,error}=await client.from("room_players").select("id,room_id").eq("room_id",input.roomId).eq("user_id",user.id).single();
  if (error) throw Object.assign(new Error("Nejsi členem této místnosti."),{statusCode:403});
  await client.from("room_players").update({connected:true,last_seen_at:now.toISOString()}).eq("id",player.id);
  await client.from("room_players").update({connected:false})
    .eq("room_id",player.room_id).eq("is_bot",false).lt("last_seen_at",staleBefore);
  const current=await snapshot(client,player.room_id);
  const host=current.players.find(candidate=>candidate.is_host);
  if (host&&!host.connected) {
    const successor=current.players.find(candidate=>!candidate.is_bot&&candidate.connected);
    if (successor) {
      await client.from("room_players").update({is_host:false}).eq("room_id",player.room_id).eq("is_host",true);
      await client.from("room_players").update({is_host:true}).eq("id",successor.id);
      await client.from("rooms").update({host_user_id:successor.user_id,updated_at:now.toISOString()}).eq("id",player.room_id);
    }
  }
  return {roomId:player.room_id,at:now.toISOString()};
}

async function setCharacter(client,user,input) {
  if (!CHARACTERS.includes(input.character)) throw new Error("Neplatná postava.");
  const {data:player,error}=await client.from("room_players").select("id,room_id").eq("room_id",input.roomId).eq("user_id",user.id).single();
  if (error) throw Object.assign(new Error("Nejsi členem této místnosti."),{statusCode:403});
  const {data:room}=await client.from("rooms").select("phase").eq("id",player.room_id).single();
  if (room.phase!=="lobby") throw new Error("Postavu už nelze změnit.");
  const {error:updateError}=await client.from("room_players").update({character:input.character,last_seen_at:new Date().toISOString()}).eq("id",player.id);
  if (updateError) throw updateError;
  return snapshot(client,player.room_id);
}

async function prepareGame(client,user,input) {
  const roomId=input.roomId;
  const current=await snapshot(client,roomId);
  if (current.room.host_user_id!==user.id) throw Object.assign(new Error("Hru může připravit pouze hostitel."),{statusCode:403});
  if (current.room.phase!=="lobby") throw new Error("Místnost už byla připravena nebo spuštěna.");
  if (current.players.length<4||current.players.length>6) throw new Error("Hra potřebuje 4 až 6 hráčů včetně botů.");
  if (current.players.some(player=>!player.character)) throw new Error("Všichni hráči musí mít zvolenou postavu.");
  const state=GameSession.createGame(current.players);
  const {data,error}=await client.rpc("commit_game_start",{
    p_room_id:roomId,p_host_user_id:user.id,p_state:state,p_activate:false
  });
  if (error) throw error;
  return data;
}

async function activateGame(client,user,input) {
  const current=await snapshot(client,input.roomId);
  if (current.room.host_user_id!==user.id) throw Object.assign(new Error("Hru může spustit pouze hostitel."),{statusCode:403});
  if (current.room.phase!=="ready"||!current.game?.state) throw new Error("Hra není připravená.");
  const state=GameSession.advanceBots(current.game.state);
  const {data,error}=await client.rpc("activate_prepared_game",{
    p_room_id:input.roomId,p_host_user_id:user.id,p_state:state
  });
  if (error) throw error;
  return data;
}

module.exports={snapshot,createRoom,joinRoom,resumeRoom,heartbeat,setCharacter,prepareGame,activateGame};
