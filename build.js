"use strict";

const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const outputs=path.join(root,"outputs");
const checks=["board-calibration.js","board-geometry.js","game-model.js","game-rules.js","game-state.js","game-session.js"];

async function main() {
  for (const file of checks) require("node:child_process").execFileSync(process.execPath,["--check",path.join(outputs,file)],{stdio:"inherit"});
  require("./check-html.js");
  const publicConfig={
    supabaseUrl:process.env.SUPABASE_URL||"",
    supabaseAnonKey:process.env.SUPABASE_ANON_KEY||"",
    appUrl:process.env.PUBLIC_APP_URL||""
  };
  fs.writeFileSync(path.join(outputs,"runtime-config.js"),`globalThis.__OKRAJOVKA_CONFIG__=${JSON.stringify(publicConfig)};\n`);
}

main().catch(error=>{console.error(error);process.exitCode=1;});
