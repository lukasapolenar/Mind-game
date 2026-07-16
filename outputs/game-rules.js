(function (root, factory) {
  const model=typeof module==="object"&&module.exports
    ? require("./game-model.js")
    : root.GameModel;
  const api=factory(model);
  if (typeof module==="object"&&module.exports) module.exports=api;
  if (root) root.GameRules=api;
})(typeof globalThis!=="undefined"?globalThis:this,function (Model) {
  "use strict";

  if (!Model) throw new Error("Chybí datový model hry.");

  const {
    BOARD_SIZE,
    isValidPosition,
    positionKey,
    tileId,
    parseTarget,
    obstaclePosition,
    setPlayerPosition,
    clonePlayer
  }=Model;

  const ABILITY_BY_CHARACTER=Object.freeze({
    jumper:"jump",
    hunter:"place-trap",
    cowboy:"shoot"
  });

  function getValidMoves(state,playerId) {
    if (!state||!Array.isArray(state.players)) return [];
    if (state.phase!=="planning"||state.isResolvingTurn||state.activePlayerId!==playerId) return [];
    const player=state.players.find(candidate=>candidate.id===playerId);
    if (!player||!isValidPosition(player.position)) return [];
    const blocked=new Set((state.obstacles||[])
      .filter(obstacle=>!obstacle.expired)
      .map(obstaclePosition)
      .filter(isValidPosition)
      .map(positionKey));
    const occupied=new Set(state.players
      .filter(candidate=>candidate.id!==playerId&&isValidPosition(candidate.position))
      .map(candidate=>positionKey(candidate.position)));
    return [[-1,0],[0,1],[1,0],[0,-1]]
      .map(([rowDelta,columnDelta])=>({
        row:player.position.row+rowDelta,
        column:player.position.column+columnDelta
      }))
      .filter(isValidPosition)
      .filter(position=>!blocked.has(positionKey(position)))
      .filter(position=>!occupied.has(positionKey(position)))
      .map(position=>({...position,tileId:tileId(position)}));
  }

  function applyMove(state,playerId,target) {
    if (!state||!Array.isArray(state.players)) {
      return {ok:false,error:"Chybí platný herní stav.",state};
    }
    if (state.isResolvingTurn) return {ok:false,error:"Tah se právě vyhodnocuje.",state};
    if (state.phase!=="planning") return {ok:false,error:"V této fázi nelze táhnout.",state};
    if (state.activePlayerId!==playerId) {
      return {ok:false,error:"Tento hráč právě není na tahu.",state};
    }
    const position=parseTarget(target);
    if (!isValidPosition(position)) return {ok:false,error:"Cílové pole neexistuje.",state};
    const validMoves=getValidMoves(state,playerId);
    if (!validMoves.some(move=>move.row===position.row&&move.column===position.column)) {
      return {ok:false,error:"Na zvolené pole se nelze přesunout.",state};
    }
    const players=state.players.map(clonePlayer);
    const player=players.find(candidate=>candidate.id===playerId);
    const from={...player.position};
    setPlayerPosition(player,position);
    return {
      ok:true,
      state:{...state,players,phase:"resolving",isResolvingTurn:true},
      move:{playerId,from,to:{...position}}
    };
  }

  function completeTurn(state) {
    if (!state||!Array.isArray(state.players)||!state.players.length) {
      return {ok:false,error:"Nelze ukončit tah bez hráčů.",state};
    }
    if (!Array.isArray(state.turnOrder)||state.turnOrder.length!==state.players.length) {
      return {ok:false,error:"Pořadí hráčů není platně inicializované.",state};
    }
    const playerIds=new Set(state.players.map(player=>player.id));
    if (new Set(state.turnOrder).size!==state.turnOrder.length||
        state.turnOrder.some(id=>!playerIds.has(id))) {
      return {ok:false,error:"Pořadí hráčů obsahuje neplatné ID.",state};
    }
    const currentIndex=state.turnOrder.indexOf(state.activePlayerId);
    if (currentIndex<0) return {ok:false,error:"Aktivní hráč není v pořadí tahu.",state};
    const nextIndex=(currentIndex+1)%state.turnOrder.length;
    const completedRound=nextIndex===0;
    return {
      ok:true,
      state:{
        ...state,
        phase:"planning",
        isResolvingTurn:false,
        activePlayerId:state.turnOrder[nextIndex],
        turnIndex:nextIndex,
        round:state.round+(completedRound?1:0)
      },
      completedRound
    };
  }

  function getAvailableAbilities(state,playerId) {
    if (!state||state.phase!=="planning"||state.isResolvingTurn||state.activePlayerId!==playerId) return [];
    const player=state.players?.find(candidate=>candidate.id===playerId);
    if (!player||player.skipRounds>0) return [];
    const abilityId=ABILITY_BY_CHARACTER[player.character];
    return abilityId?[{id:abilityId,character:player.character}]:[];
  }

  function abilityObstacleSet(state) {
    return new Set((state.obstacles||[])
      .filter(obstacle=>!obstacle.expired)
      .map(obstaclePosition)
      .filter(isValidPosition)
      .map(positionKey));
  }

  function recoveryBlocks(target,attacker,state) {
    const attackerIndex=state.players.findIndex(player=>player.id===attacker.id);
    const protection=target.recoveryProtection||{};
    return (protection[attacker.id]||protection[attackerIndex]||0)>=state.round;
  }

  function lineHasObstacle(state,from,to,ignoredObstacleId=null) {
    if (from.row!==to.row&&from.column!==to.column) return true;
    const rowStep=Math.sign(to.row-from.row);
    const columnStep=Math.sign(to.column-from.column);
    let row=from.row+rowStep;
    let column=from.column+columnStep;
    while (row!==to.row||column!==to.column) {
      if ((state.obstacles||[]).some(obstacle=>{
        if (obstacle.expired||obstacle.id===ignoredObstacleId) return false;
        const position=obstaclePosition(obstacle);
        return position.row===row&&position.column===column;
      })) return true;
      row+=rowStep;
      column+=columnStep;
    }
    return false;
  }

  function abilityMayRun(state,playerId,abilityId) {
    return getAvailableAbilities(state,playerId).some(ability=>ability.id===abilityId);
  }

  function getJumpTargets(state,playerId) {
    if (!abilityMayRun(state,playerId,"jump")) return [];
    const player=state.players.find(candidate=>candidate.id===playerId);
    const blocked=abilityObstacleSet(state);
    const occupied=new Set(state.players
      .filter(candidate=>candidate.id!==playerId)
      .map(candidate=>positionKey(candidate.position)));
    const targets=[];
    for (let row=0;row<BOARD_SIZE;row++) {
      for (let column=0;column<BOARD_SIZE;column++) {
        const position={row,column};
        const key=positionKey(position);
        if (key===positionKey(player.position)||blocked.has(key)||occupied.has(key)) continue;
        targets.push({...position,tileId:tileId(position),kind:"tile"});
      }
    }
    return targets;
  }

  function getTrapTargets(state,playerId) {
    if (!abilityMayRun(state,playerId,"place-trap")) return [];
    const player=state.players.find(candidate=>candidate.id===playerId);
    const blocked=abilityObstacleSet(state);
    const existingTraps=new Set((state.traps||[])
      .filter(trap=>!trap.used&&(!trap.expiresRound||state.round<trap.expiresRound))
      .map(trap=>positionKey({row:trap.y,column:trap.x})));
    const used=player.trapPlacements||{};
    const targets=[];
    for (let row=0;row<BOARD_SIZE;row++) {
      for (let column=0;column<BOARD_SIZE;column++) {
        const position={row,column};
        const key=positionKey(position);
        if (blocked.has(key)||existingTraps.has(key)||used[`${column}:${row}`]!==undefined) continue;
        const protectedPlayer=state.players.find(candidate=>
          candidate.id!==player.id &&
          positionKey(candidate.position)===key &&
          recoveryBlocks(candidate,player,state)
        );
        if (!protectedPlayer) targets.push({...position,tileId:tileId(position),kind:"tile"});
      }
    }
    return targets;
  }

  function getAbilityTargets(state,playerId,abilityId) {
    if (abilityId==="jump") return getJumpTargets(state,playerId);
    if (abilityId==="place-trap") return getTrapTargets(state,playerId);
    if (!abilityMayRun(state,playerId,abilityId)) return [];
    const player=state.players.find(candidate=>candidate.id===playerId);
    if (abilityId==="shoot") {
      const targets=[];
      state.players.forEach((target,targetIndex)=>{
        if (target.id===playerId) return;
        const sameLine=target.position.row===player.position.row||
          target.position.column===player.position.column;
        if (!sameLine||recoveryBlocks(target,player,state)) return;
        const lastRound=player.shotRounds?.[target.id]??player.shotRounds?.[targetIndex]??-99;
        if (state.round-lastRound<2||lineHasObstacle(state,player.position,target.position)) return;
        targets.push({
          ...target.position,
          tileId:tileId(target.position),
          kind:"player",
          targetPlayerId:target.id,
          targetIndex
        });
      });
      (state.obstacles||[]).forEach(obstacle=>{
        if (obstacle.expired) return;
        const position=obstaclePosition(obstacle);
        const sameLine=position.row===player.position.row||position.column===player.position.column;
        if (sameLine&&!lineHasObstacle(state,player.position,position,obstacle.id)) {
          targets.push({...position,tileId:tileId(position),kind:"obstacle",obstacleId:obstacle.id});
        }
      });
      return targets;
    }
    return [];
  }

  function getAbilityTargetMap(state,playerId,abilityId) {
    const player=state?.players?.find(candidate=>candidate.id===playerId);
    const validTargets=getAbilityTargets(state,playerId,abilityId);
    const validIds=new Set(validTargets.map(target=>target.tileId));
    const obstacles=abilityObstacleSet(state||{});
    const occupied=new Set((state?.players||[])
      .filter(candidate=>candidate.id!==playerId)
      .map(candidate=>positionKey(candidate.position)));
    const traps=new Set((state?.traps||[])
      .filter(trap=>!trap.used&&(!trap.expiresRound||state.round<trap.expiresRound))
      .map(trap=>positionKey({row:trap.y,column:trap.x})));
    const used=player?.trapPlacements||{};
    const available=abilityMayRun(state,playerId,abilityId);
    const result=[];
    for (let row=0;row<BOARD_SIZE;row++) {
      for (let column=0;column<BOARD_SIZE;column++) {
        const position={row,column};
        const id=tileId(position);
        const key=positionKey(position);
        let reason="rule";
        if (!available) reason="ability-unavailable";
        else if (validIds.has(id)) reason="valid";
        else if (obstacles.has(key)) reason="obstacle";
        else if (abilityId==="jump"&&occupied.has(key)) reason="occupied";
        else if (player&&key===positionKey(player.position)) reason="current-position";
        else if (abilityId==="place-trap"&&traps.has(key)) reason="existing-trap";
        else if (abilityId==="place-trap"&&used[`${column}:${row}`]!==undefined) reason="previously-used";
        result.push({...position,tileId:id,valid:validIds.has(id),reason});
      }
    }
    return result;
  }

  function cloneAbilityState(state) {
    return {
      ...state,
      players:state.players.map(clonePlayer),
      obstacles:(state.obstacles||[]).map(obstacle=>({
        ...obstacle,
        position:obstacle.position?{...obstacle.position}:undefined
      })),
      traps:(state.traps||[]).map(trap=>({...trap}))
    };
  }

  function applyAbility(state,playerId,abilityId,targetInput) {
    if (!getAvailableAbilities(state,playerId).some(ability=>ability.id===abilityId)) {
      return {ok:false,error:"Schopnost nyní nelze použít.",state};
    }
    const parsedTarget=parseTarget(targetInput);
    const requestedTile=typeof targetInput==="string"
      ? targetInput
      : targetInput?.tileId||(isValidPosition(parsedTarget)?tileId(parsedTarget):null);
    if (!requestedTile) return {ok:false,error:"Schopnost nemá platný cíl.",state};
    const requested=getAbilityTargets(state,playerId,abilityId).find(target=>
      target.tileId===requestedTile &&
      (!targetInput?.targetPlayerId||target.targetPlayerId===targetInput.targetPlayerId) &&
      (!targetInput?.obstacleId||target.obstacleId===targetInput.obstacleId)
    );
    if (!requested) return {ok:false,error:"Pro schopnost byl zvolen neplatný cíl.",state};
    const next=cloneAbilityState(state);
    const playerIndex=next.players.findIndex(candidate=>candidate.id===playerId);
    const player=next.players[playerIndex];
    next.phase="resolving";
    next.isResolvingTurn=true;

    if (abilityId==="jump") {
      const from={...player.position};
      setPlayerPosition(player,requested);
      return {ok:true,state:next,effect:{type:"jump",playerId,from,to:{row:requested.row,column:requested.column}}};
    }
    if (abilityId==="place-trap") {
      const targetIndex=next.players.findIndex(candidate=>
        candidate.id!==playerId&&positionKey(candidate.position)===positionKey(requested)
      );
      player.trapPlacements={...(player.trapPlacements||{}),[`${requested.column}:${requested.row}`]:next.round};
      const trap={
        id:`trap-${next.id}-${next.round}-${playerId}-${requested.row}-${requested.column}`,
        x:requested.column,
        y:requested.row,
        owner:playerIndex,
        ownerId:playerId,
        used:false,
        revealed:playerIndex===0,
        placedRound:next.round,
        expiresRound:next.round+2,
        directVictimIndex:targetIndex>=0?targetIndex:undefined,
        directVictimId:targetIndex>=0?next.players[targetIndex].id:undefined
      };
      next.traps.push(trap);
      return {ok:true,state:next,effect:{type:"place-trap",trap}};
    }
    if (abilityId==="shoot"&&requested.kind==="obstacle") {
      const obstacle=next.obstacles.find(candidate=>candidate.id===requested.obstacleId);
      obstacle.expired=true;
      return {
        ok:true,
        state:next,
        effect:{type:"destroy-obstacle",obstacleId:obstacle.id,position:{row:requested.row,column:requested.column}}
      };
    }
    if (abilityId==="shoot"&&requested.kind==="player") {
      const targetIndex=next.players.findIndex(candidate=>candidate.id===requested.targetPlayerId);
      const target=next.players[targetIndex];
      if (target.shieldActive||target.pendingShield) {
        return {ok:true,state:next,effect:{type:"shot-blocked",targetPlayerId:target.id,targetIndex}};
      }
      const from={...target.position};
      const rowStep=Math.sign(target.position.row-player.position.row);
      const columnStep=Math.sign(target.position.column-player.position.column);
      let destination={...target.position};
      while (true) {
        const candidate={row:destination.row+rowStep,column:destination.column+columnStep};
        if (!isValidPosition(candidate)||abilityObstacleSet(next).has(positionKey(candidate))) break;
        destination=candidate;
      }
      setPlayerPosition(target,destination);
      target.skipRounds=Math.max(target.skipRounds||0,1);
      target.disabledReason="bullet";
      target.disabledBy=playerIndex;
      target.recoveryProtection={...(target.recoveryProtection||{}),[playerId]:next.round+2};
      player.shotRounds={...(player.shotRounds||{}),[target.id]:next.round};
      player.score=(player.score||0)+15;
      return {
        ok:true,
        state:next,
        effect:{type:"shoot-player",targetPlayerId:target.id,targetIndex,from,to:{...destination},points:15}
      };
    }
    return {ok:false,error:"Schopnost nemá platné vyhodnocení.",state};
  }

  return Object.freeze({
    ABILITY_BY_CHARACTER,
    getValidMoves,
    applyMove,
    completeTurn,
    getAvailableAbilities,
    getJumpTargets,
    getTrapTargets,
    getAbilityTargets,
    getAbilityTargetMap,
    applyAbility,
    lineHasObstacle
  });
});
