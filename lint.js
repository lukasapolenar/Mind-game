"use strict";

const {execFileSync}=require("node:child_process");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const files=[
  "outputs/board-calibration.js","outputs/board-geometry.js","outputs/game-model.js",
  "outputs/game-rules.js","outputs/game-state.js","outputs/game-session.js","outputs/online-client.js",
  "server/supabase.js","server/http.js","server/room-service.js","server/game-service.js",
  "api/rooms.js","api/game.js",
  "tests/initialization.test.js"
];
for (const file of files) execFileSync(process.execPath,["--check",path.join(root,file)],{stdio:"inherit"});
require("./check-html.js");
