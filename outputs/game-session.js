(function (root,factory) {
  const state=typeof module==="object"&&module.exports?require("./game-state.js"):root.GameState;
  const api=factory(state);
  if (typeof module==="object"&&module.exports) module.exports=api;
  if (root) root.GameSession=api;
})(typeof globalThis!=="undefined"?globalThis:this,function (GameState) {
  "use strict";

  const palette=["#ff6b6b","#5eead4","#ffd166","#8b7cff","#65d46e","#ff8bd1"];

  function randomFreeCell(occupied,random,interior=true) {
    for (let attempt=0;attempt<300;attempt++) {
      const minimum=interior?1:0;
      const width=interior?8:10;
      const column=minimum+Math.floor(random()*width);
      const row=minimum+Math.floor(random()*width);
      const key=`${column}:${row}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        return {x:column,y:row};
      }
    }
    throw new Error("Na mapě už není možné bezpečně rozmístit další objekt.");
  }

  function initializeRuntime(state) {
    state.players.forEach((player,index)=>Object.assign(player,{
      color:palette[index],
      initial:player.name[0]?.toUpperCase()||"?",
      move:null,
      ready:false,
      score:0,
      action:"move",
      skipRounds:0,
      shieldActive:false,
      pendingShield:false,
      shieldUntilRound:0,
      inventory:player.character==="jumper"?["obstacle"]:["shield","obstacle"],
      shotRounds:{},
      trapPlacements:{},
      recoveryProtection:{},
      disabledReason:null,
      disabledBy:null,
      stats:{rewards:0,itemsUsed:0,trapsTriggered:0,missedRounds:0,largestReward:0,specialActions:0}
    }));
    return state;
  }

  function generateObjects(state,random=Math.random) {
    const occupied=new Set(state.players.map(player=>`${player.position.column}:${player.position.row}`));
    const rewardDefinitions=[
      ...Array(7).fill(null).map(()=>({value:5,unlockRound:1})),
      ...Array(4).fill(null).map(()=>({value:15,unlockRound:1})),
      {value:15,unlockRound:3},{value:15,unlockRound:6},
      {value:50,unlockRound:4},{value:50,unlockRound:8},
      {value:15,unlockRound:4},{value:15,unlockRound:10}
    ];
    const rewards=rewardDefinitions.map((definition,id)=>({
      id,...randomFreeCell(occupied,random),...definition,
      collected:false,unlocked:definition.unlockRound===1
    }));
    const obstacles=Array.from({length:8},(_,index)=>({
      id:`rock-${index}`,...randomFreeCell(occupied,random),
      expired:false,expiresRound:null
    }));
    const types=["teleport","teleport","teleport","teleport","teleport","teleport",
      "ladder","ladder","ladder","shield","shield","shield","shield"];
    const items=types.map((type,id)=>({id,type,...randomFreeCell(occupied,random),collected:false}));
    return {rewards,obstacles,items,traps:[]};
  }

  function createGame(roomPlayers,options={}) {
    const random=options.random||Math.random;
    const drafts=roomPlayers.map(player=>({
      id:player.id,
      name:player.nickname||player.name,
      bot:!!player.is_bot,
      character:player.character
    }));
    const state=initializeRuntime(GameState.createPreparedGameState(drafts,{random,maxAttempts:32}));
    Object.assign(state,generateObjects(state,random),{
      serverVersion:1,
      lastAction:null,
      finished:false
    });
    return state;
  }

  function resolveLanding(state,player) {
    const position={x:player.position.column,y:player.position.row};
    const item=state.items?.find(candidate=>!candidate.collected&&candidate.x===position.x&&candidate.y===position.y);
    if (item) {
      item.collected=true;
      if (!(player.character==="jumper"&&item.type==="shield")&&player.inventory.length<8) {
        player.inventory.push(item.type);
      }
    }
    const reward=state.rewards?.find(candidate=>!candidate.collected&&candidate.unlocked&&candidate.x===position.x&&candidate.y===position.y);
    if (reward) {
      reward.collected=true;
      player.score+=reward.value;
      player.stats.rewards++;
      player.stats.largestReward=Math.max(player.stats.largestReward,reward.value);
    }
    const trap=state.traps?.find(candidate=>!candidate.used&&
      (!candidate.expiresRound||state.round<candidate.expiresRound)&&
      candidate.x===position.x&&candidate.y===position.y&&candidate.ownerId!==player.id);
    if (trap&&player.character!=="hunter") {
      trap.used=true;
      if (player.shieldActive) player.shieldActive=false;
      else {
        player.skipRounds=Math.max(player.skipRounds||0,2);
        player.disabledReason="trap";
      }
      const owner=state.players.find(candidate=>candidate.id===trap.ownerId);
      if (owner) {
        owner.score=(owner.score||0)+15;
        owner.stats.trapsTriggered++;
      }
    }
  }

  function normalizeRoundObjects(state) {
    for (const reward of state.rewards||[]) {
      if (!reward.collected&&state.round>=reward.unlockRound) reward.unlocked=true;
    }
    for (const trap of state.traps||[]) {
      if (!trap.used&&trap.expiresRound&&state.round>=trap.expiresRound) trap.used=true;
    }
  }

  function applyItem(current,playerId,action) {
    const next={
      ...current,
      players:current.players.map(GameState.clonePlayer),
      obstacles:(current.obstacles||[]).map(object=>({...object})),
      traps:(current.traps||[]).map(object=>({...object})),
      rewards:(current.rewards||[]).map(object=>({...object})),
      items:(current.items||[]).map(object=>({...object}))
    };
    const player=next.players.find(candidate=>candidate.id===playerId);
    const itemIndex=player.inventory.indexOf(action.itemType);
    if (itemIndex<0) return {ok:false,error:"Hráč tento předmět nemá.",state:current};
    const target=GameState.parseTarget(action.target);
    if (action.itemType==="shield") {
      if (player.character==="jumper") return {ok:false,error:"Jumper nemůže použít štít.",state:current};
      player.shieldActive=true;
      player.shieldUntilRound=next.round+2;
      player.skipRounds=0;
    } else {
      if (!GameState.isValidPosition(target)) return {ok:false,error:"Předmět nemá platný cíl.",state:current};
      const obstacleKeys=new Set(next.obstacles.filter(object=>!object.expired)
        .map(object=>`${object.y}:${object.x}`));
      const occupied=new Set(next.players.filter(candidate=>candidate.id!==playerId)
        .map(candidate=>GameState.positionKey(candidate.position)));
      if (action.itemType==="teleport") {
        if (obstacleKeys.has(`${target.row}:${target.column}`)||occupied.has(GameState.positionKey(target))) {
          return {ok:false,error:"Teleport míří na obsazené nebo zablokované pole.",state:current};
        }
        GameState.setPlayerPosition(player,target);
      } else if (action.itemType==="ladder") {
        const distance=Math.abs(target.row-player.position.row)+Math.abs(target.column-player.position.column);
        const straight=target.row===player.position.row||target.column===player.position.column;
        if (!straight||distance<1||distance>3||GameState.lineHasObstacle(next,player.position,target)||
            obstacleKeys.has(`${target.row}:${target.column}`)||occupied.has(GameState.positionKey(target))) {
          return {ok:false,error:"Žebřík nelze použít na zvolené pole.",state:current};
        }
        GameState.setPlayerPosition(player,target);
      } else if (action.itemType==="obstacle") {
        if (obstacleKeys.has(`${target.row}:${target.column}`)||occupied.has(GameState.positionKey(target))||
            GameState.positionKey(player.position)===GameState.positionKey(target)) {
          return {ok:false,error:"Překážku zde nelze postavit.",state:current};
        }
        next.obstacles.push({
          id:`obstacle-${next.id}-${next.round}-${playerId}-${target.row}-${target.column}`,
          x:target.column,y:target.row,ownerId:playerId,expired:false,expiresRound:null
        });
      } else return {ok:false,error:"Neznámý předmět.",state:current};
    }
    player.inventory.splice(itemIndex,1);
    player.stats.itemsUsed++;
    player.stats.specialActions++;
    next.phase="resolving";
    next.isResolvingTurn=true;
    return {ok:true,state:next,effect:{type:`item-${action.itemType}`,playerId,target}};
  }

  function applyAction(current,playerId,action) {
    if (!current||current.finished) return {ok:false,error:"Hra už skončila.",state:current};
    const actor=current.players.find(player=>player.id===playerId);
    if (!actor) return {ok:false,error:"Hráč není součástí této hry.",state:current};
    if (current.activePlayerId!==playerId) return {ok:false,error:"Hráč není na tahu.",state:current};
    let result;
    if (action.type==="move") result=GameState.applyMove(current,playerId,action.target);
    else if (action.type==="ability") result=GameState.applyAbility(current,playerId,action.abilityId,action.target);
    else if (action.type==="item") result=applyItem(current,playerId,action);
    else if (action.type==="wait") {
      result={ok:true,state:{...current,players:current.players.map(GameState.clonePlayer),phase:"resolving",isResolvingTurn:true},effect:{type:"wait"}};
    } else return {ok:false,error:"Neznámý typ akce.",state:current};
    if (!result.ok) return result;
    const next=result.state;
    const nextActor=next.players.find(player=>player.id===playerId);
    resolveLanding(next,nextActor);
    for (const candidate of next.players) {
      if (candidate.id!==nextActor.id) resolveLanding(next,candidate);
    }
    const completion=GameState.completeTurn(next);
    if (!completion.ok) return completion;
    normalizeRoundObjects(completion.state);
    completion.state.lastAction={playerId,action,effect:result.effect||result.move||null,at:new Date().toISOString()};
    completion.state.finished=completion.state.round>12||
      (completion.state.rewards?.length>0&&completion.state.rewards.every(reward=>reward.collected));
    if (completion.state.finished) completion.state.phase="finished";
    return {ok:true,state:completion.state,effect:result.effect||result.move||null};
  }

  function chooseBotAction(state,bot) {
    if (bot.character==="cowboy") {
      const target=GameState.getAbilityTargets(state,bot.id,"shoot")[0];
      if (target) return {type:"ability",abilityId:"shoot",target};
    }
    if (bot.character==="hunter") {
      const target=GameState.getTrapTargets(state,bot.id).find(candidate=>
        state.players.some(player=>player.id!==bot.id&&
          player.position.row===candidate.row&&player.position.column===candidate.column)
      );
      if (target) return {type:"ability",abilityId:"place-trap",target};
    }
    if (bot.character==="jumper") {
      const rewards=(state.rewards||[]).filter(reward=>!reward.collected&&reward.unlocked)
        .sort((a,b)=>b.value-a.value);
      const valid=GameState.getJumpTargets(state,bot.id);
      const reward=rewards.find(candidate=>valid.some(target=>target.row===candidate.y&&target.column===candidate.x));
      if (reward) return {type:"ability",abilityId:"jump",target:{row:reward.y,column:reward.x}};
    }
    const moves=GameState.getValidMoves(state,bot.id);
    if (!moves.length) return {type:"wait"};
    const rewards=(state.rewards||[]).filter(reward=>!reward.collected&&reward.unlocked);
    const score=position=>Math.max(0,...rewards.map(reward=>
      reward.value/(1+Math.abs(position.row-reward.y)+Math.abs(position.column-reward.x))
    ));
    return {type:"move",target:[...moves].sort((a,b)=>score(b)-score(a))[0]};
  }

  function advanceBots(state,maxActions=6) {
    let next=state;
    const replay=[];
    for (let guard=0;guard<maxActions&&!next.finished;guard++) {
      const active=next.players.find(candidate=>candidate.id===next.activePlayerId);
      if (!active?.bot) break;
      let result=applyAction(next,active.id,chooseBotAction(next,active));
      if (!result.ok) result=applyAction(next,active.id,{type:"wait"});
      if (!result.ok) break;
      next=result.state;
      replay.push(next.lastAction);
    }
    next.replay=replay;
    return next;
  }

  return Object.freeze({
    palette,initializeRuntime,generateObjects,createGame,applyAction,chooseBotAction,advanceBots
  });
});
