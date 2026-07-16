(function (root, factory) {
  const model=typeof module==="object"&&module.exports
    ? require("./game-model.js")
    : root.GameModel;
  const rules=typeof module==="object"&&module.exports
    ? require("./game-rules.js")
    : root.GameRules;
  const api=factory(model,rules);
  if (typeof module==="object"&&module.exports) module.exports=api;
  if (root) root.GameState=api;
})(typeof globalThis!=="undefined"?globalThis:this,function (Model,Rules) {
  "use strict";

  if (!Model||!Rules) throw new Error("Chybí model nebo pravidla hry.");

  const {
    BOARD_SIZE,
    MIN_PLAYERS,
    MAX_PLAYERS,
    CHARACTERS,
    isValidPosition,
    positionKey,
    setPlayerPosition,
    attachPlayerCompatibilityView
  }=Model;
  let idCounter=0;

  const START_LAYOUTS=Object.freeze({
    4:Object.freeze([
      Object.freeze({row:0,column:0}),
      Object.freeze({row:0,column:9}),
      Object.freeze({row:9,column:9}),
      Object.freeze({row:9,column:0})
    ]),
    5:Object.freeze([
      Object.freeze({row:0,column:0}),
      Object.freeze({row:0,column:9}),
      Object.freeze({row:5,column:9}),
      Object.freeze({row:9,column:5}),
      Object.freeze({row:9,column:0})
    ]),
    6:Object.freeze([
      Object.freeze({row:0,column:0}),
      Object.freeze({row:0,column:5}),
      Object.freeze({row:0,column:9}),
      Object.freeze({row:9,column:9}),
      Object.freeze({row:9,column:5}),
      Object.freeze({row:9,column:0})
    ])
  });

  function createId(prefix,random) {
    const value=Math.floor(random()*Number.MAX_SAFE_INTEGER).toString(36);
    idCounter++;
    return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${value}`;
  }

  function shuffled(values,random) {
    const result=values.map(value=>({...value}));
    for (let index=result.length-1;index>0;index--) {
      const target=Math.floor(random()*(index+1));
      [result[index],result[target]]=[result[target],result[index]];
    }
    return result;
  }

  function validateInitialState(state) {
    const errors=[];
    if (!state||!Array.isArray(state.players)) errors.push("Chybí seznam hráčů.");
    const players=state?.players||[];
    if (players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) {
      errors.push(`Hra musí mít ${MIN_PLAYERS} až ${MAX_PLAYERS} hráčů.`);
    }
    const ids=new Set();
    const occupied=new Set();
    players.forEach((player,index)=>{
      if (!player?.id||typeof player.id!=="string") errors.push(`Hráč ${index+1} nemá platné ID.`);
      else if (ids.has(player.id)) errors.push(`ID hráče ${player.id} není jedinečné.`);
      else ids.add(player.id);
      if (!CHARACTERS.includes(player?.character)) errors.push(`Hráč ${index+1} nemá platnou postavu.`);
      if (!isValidPosition(player?.position)) errors.push(`Hráč ${index+1} nemá platné startovní pole.`);
      else {
        const key=positionKey(player.position);
        if (occupied.has(key)) errors.push(`Startovní pole ${key} je obsazeno více postavami.`);
        occupied.add(key);
      }
    });
    if (!state?.activePlayerId||!players.some(player=>player.id===state.activePlayerId)) {
      errors.push("Hra nemá platného aktivního hráče.");
    }
    if (!Array.isArray(state?.turnOrder)||state.turnOrder.length!==players.length) {
      errors.push("Hra nemá úplné pořadí hráčů.");
    }
    if (state?.phase!=="planning") errors.push("Počáteční fáze hry musí být planning.");
    if (state?.round!==1) errors.push("Nová hra musí začínat prvním kolem.");
    return {valid:errors.length===0,errors};
  }

  function createInitialGameState(lobbyPlayers,options={}) {
    const random=typeof options.random==="function"?options.random:Math.random;
    if (!Array.isArray(lobbyPlayers)) throw new Error("Lobby neobsahuje seznam hráčů.");
    const layout=START_LAYOUTS[lobbyPlayers.length];
    if (!layout) throw new Error(`Hru lze spustit pouze se ${MIN_PLAYERS} až ${MAX_PLAYERS} hráči.`);
    const starts=shuffled(layout,random);
    const knownIds=new Set();
    const players=lobbyPlayers.map((draft,index)=>{
      const character=draft?.character||draft?.role;
      if (!CHARACTERS.includes(character)) {
        throw new Error(`Hráč ${index+1} nemá zvolenou platnou postavu.`);
      }
      let id=typeof draft.id==="string"&&draft.id.trim()
        ? draft.id.trim()
        : createId(`player-${index+1}`,random);
      if (knownIds.has(id)) id=createId(`player-${index+1}`,random);
      knownIds.add(id);
      return attachPlayerCompatibilityView({
        id,
        name:String(draft.name||`Hráč ${index+1}`),
        bot:!!draft.bot,
        character,
        position:{...starts[index]}
      });
    });
    const rolePriority={cowboy:0,hunter:1,jumper:2};
    const turnOrder=players
      .map((player,index)=>({player,index}))
      .sort((a,b)=>rolePriority[a.player.character]-rolePriority[b.player.character]||a.index-b.index)
      .map(entry=>entry.player.id);
    const state={
      id:createId("game",random),
      phase:"planning",
      round:1,
      activePlayerId:turnOrder[0],
      turnOrder,
      turnIndex:0,
      isResolvingTurn:false,
      obstacles:[],
      traps:[],
      players
    };
    const validation=validateInitialState(state);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    return state;
  }

  function perimeterPositions() {
    const positions=[];
    for (let row=0;row<BOARD_SIZE;row++) {
      for (let column=0;column<BOARD_SIZE;column++) {
        if (row===0||column===0||row===BOARD_SIZE-1||column===BOARD_SIZE-1) {
          positions.push({row,column});
        }
      }
    }
    return positions;
  }

  function chooseFairRandomStarts(count,random,blockedPositions=[]) {
    const blocked=new Set(blockedPositions.filter(isValidPosition).map(positionKey));
    const candidates=shuffled(perimeterPositions().filter(position=>!blocked.has(positionKey(position))),random);
    const selected=[];
    for (const candidate of candidates) {
      const separated=selected.every(position=>
        Math.abs(position.row-candidate.row)+Math.abs(position.column-candidate.column)>=3
      );
      if (!separated) continue;
      selected.push(candidate);
      if (selected.length===count) return selected;
    }
    throw new Error("Nepodarilo se najit dostatek oddelenych startovnich poli.");
  }

  function createPreparedGameState(lobbyPlayers,options={}) {
    const random=typeof options.random==="function"?options.random:Math.random;
    const maxAttempts=Number.isInteger(options.maxAttempts)?Math.max(1,options.maxAttempts):24;
    const blockedPositions=Array.isArray(options.blockedPositions)?options.blockedPositions:[];
    let lastError=null;
    for (let attempt=1;attempt<=maxAttempts;attempt++) {
      try {
        const state=createInitialGameState(lobbyPlayers,{random});
        const starts=chooseFairRandomStarts(state.players.length,random,blockedPositions);
        state.players.forEach((player,index)=>setPlayerPosition(player,starts[index]));
        const validation=validateInitialState(state);
        if (!validation.valid) throw new Error(validation.errors.join(" "));
        return state;
      } catch (error) {
        lastError=error;
      }
    }
    throw new Error(`Priprava hry selhala po ${maxAttempts} pokusech. ${lastError?.message||""}`.trim());
  }

  return Object.freeze({
    ...Model,
    ...Rules,
    START_LAYOUTS,
    createInitialGameState,
    createPreparedGameState,
    chooseFairRandomStarts,
    validateInitialState
  });
});
