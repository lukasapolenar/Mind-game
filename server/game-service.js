"use strict";

const GameSession=require("../outputs/game-session.js");
const {snapshot}=require("./room-service.js");

async function submitAction(client,user,input) {
  const current=await snapshot(client,input.roomId);
  if (current.room.phase!=="playing"||!current.game) throw new Error("Hra právě neprobíhá.");
  const player=current.players.find(candidate=>candidate.user_id===user.id);
  if (!player) throw Object.assign(new Error("Nejsi členem této hry."),{statusCode:403});
  if (Number(input.expectedVersion)!==Number(current.game.version)) {
    throw Object.assign(new Error("Herní stav se mezitím změnil. Načítám aktuální tah."),{statusCode:409});
  }
  let result=GameSession.applyAction(current.game.state,player.id,input.action);
  if (!result.ok) throw new Error(result.error);
  const humanEvent=result.state.lastAction;
  result.state=GameSession.advanceBots(result.state);
  result.state.replay=[humanEvent,...(result.state.replay||[])];
  const idempotencyKey=String(input.idempotencyKey||"");
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(idempotencyKey)) throw new Error("Akce nemá platný identifikátor.");
  const {data,error}=await client.rpc("commit_game_action",{
    p_room_id:input.roomId,
    p_actor_user_id:user.id,
    p_expected_version:Number(input.expectedVersion),
    p_idempotency_key:idempotencyKey,
    p_action:input.action,
    p_state:result.state
  });
  if (error) {
    if (error.message?.includes("version_conflict")) throw Object.assign(new Error("Tah už byl změněn jiným klientem."),{statusCode:409});
    throw error;
  }
  return data;
}

module.exports={submitAction};
