(function (root, factory) {
  const api=factory();
  if (typeof module==="object"&&module.exports) module.exports=api;
  if (root) root.GameModel=api;
})(typeof globalThis!=="undefined"?globalThis:this,function () {
  "use strict";

  const BOARD_SIZE=10;
  const MIN_PLAYERS=4;
  const MAX_PLAYERS=6;
  const CHARACTERS=Object.freeze(["jumper","hunter","cowboy"]);

  function isValidPosition(position) {
    return !!position &&
      Number.isInteger(position.row) &&
      Number.isInteger(position.column) &&
      position.row>=0 && position.row<BOARD_SIZE &&
      position.column>=0 && position.column<BOARD_SIZE;
  }

  function positionKey(position) {
    return `${position.row}:${position.column}`;
  }

  function tileId(position) {
    return `tile-${position.row}-${position.column}`;
  }

  function parseTarget(target) {
    if (typeof target==="string") {
      const match=/^tile-(\d+)-(\d+)$/.exec(target);
      return match?{row:Number(match[1]),column:Number(match[2])}:null;
    }
    return target&&typeof target==="object"
      ? {row:target.row,column:target.column}
      : null;
  }

  function obstaclePosition(obstacle) {
    return obstacle?.position||{
      row:obstacle?.row??obstacle?.y,
      column:obstacle?.column??obstacle?.x
    };
  }

  function setPlayerPosition(player,position) {
    if (!player||!isValidPosition(position)) {
      throw new Error("Postavu nelze přesunout na neplatné pole.");
    }
    player.position={row:position.row,column:position.column};
    return player.position;
  }

  function attachPlayerCompatibilityView(player) {
    Object.defineProperties(player,{
      role:{
        configurable:true,
        enumerable:false,
        get() { return this.character; },
        set(character) {
          if (!CHARACTERS.includes(character)) throw new Error("Neplatná postava hráče.");
          this.character=character;
        }
      },
      x:{
        configurable:true,
        enumerable:false,
        get() { return this.position.column; },
        set(column) { setPlayerPosition(this,{row:this.position.row,column}); }
      },
      y:{
        configurable:true,
        enumerable:false,
        get() { return this.position.row; },
        set(row) { setPlayerPosition(this,{row,column:this.position.column}); }
      }
    });
    return player;
  }

  function clonePlayer(player) {
    const clone={...player,position:{...player.position}};
    if (Array.isArray(player.inventory)) clone.inventory=[...player.inventory];
    for (const key of ["stats","shotRounds","trapPlacements","recoveryProtection"]) {
      if (player[key]&&typeof player[key]==="object") clone[key]={...player[key]};
    }
    return attachPlayerCompatibilityView(clone);
  }

  return Object.freeze({
    BOARD_SIZE,
    MIN_PLAYERS,
    MAX_PLAYERS,
    CHARACTERS,
    isValidPosition,
    positionKey,
    tileId,
    parseTarget,
    obstaclePosition,
    setPlayerPosition,
    attachPlayerCompatibilityView,
    clonePlayer
  });
});
