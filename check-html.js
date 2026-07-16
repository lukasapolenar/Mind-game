"use strict";

const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"outputs","index.html"),"utf8");
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
if (!scripts.length) throw new Error("V index.html chybí aktivní inline skript.");
scripts.forEach((source,index)=>new vm.Script(source,{filename:`index.inline.${index+1}.js`}));

const externalScripts=[...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)]
  .map(match=>match[1]);
const expectedScripts=[
  "board-calibration.js",
  "board-geometry.js",
  "game-model.js",
  "game-rules.js",
  "game-state.js",
  "game-session.js",
  "runtime-config.js",
  "online-client.js"
];
if (JSON.stringify(externalScripts)!==JSON.stringify(expectedScripts)) {
  throw new Error(`Moduly hry nejsou načtené ve správném pořadí: ${externalScripts.join(", ")}.`);
}
externalScripts.forEach(source=>{
  const filename=path.join(root,"outputs",source);
  if (!fs.existsSync(filename)) throw new Error(`Chybí modul ${source}.`);
  new vm.Script(fs.readFileSync(filename,"utf8"),{filename:source});
});

function createElementStub(id="") {
  return {
    id,
    value:id==="botCount"?"3":id==="hostName"?"Hostitel":"",
    textContent:"",
    innerHTML:"",
    dataset:{},
    className:"",
    classList:{add(){},remove(){},toggle(){return false;},contains(){return false;}},
    style:{setProperty(){},removeProperty(){}},
    setAttribute(){},
    addEventListener(){},
    appendChild(){},
    remove(){},
    querySelector(){return null;},
    querySelectorAll(){return [];},
    getBoundingClientRect(){return {left:0,top:0,width:0,height:0};},
    animate(){return {finished:Promise.resolve()};}
  };
}

const elementStubs=new Map();
const documentStub={
  addEventListener(){},
  getElementById(id) {
    if (!elementStubs.has(id)) elementStubs.set(id,createElementStub(id));
    return elementStubs.get(id);
  },
  querySelector(){return null;},
  querySelectorAll(){return [];},
  createElement(){return createElementStub();}
};
const runtime=vm.createContext({
  document:documentStub,
  navigator:{clipboard:{writeText:async()=>{}}},
  setTimeout(){return 1;},
  clearTimeout(){},
  setInterval(){return 1;},
  clearInterval(){},
  URLSearchParams,
  Promise,
  console
});
externalScripts.forEach(source=>{
  const filename=path.join(root,"outputs",source);
  new vm.Script(fs.readFileSync(filename,"utf8"),{filename:source}).runInContext(runtime);
});
scripts.forEach((source,index)=>
  new vm.Script(source,{filename:`index.inline.${index+1}.js`}).runInContext(runtime)
);
new vm.Script(`
  preparedSelection=gamePlayers.map(player=>({name:player.name,bot:player.bot,character:player.role}));
  createPreparedSession();
  setSetupPhase("ready");
  startPreparedGame();
`,{filename:"index.smoke-start.js"}).runInContext(runtime);
const renderedBoard=documentStub.getElementById("board").innerHTML;
const renderedCells=(renderedBoard.match(/<polygon class="cell/g)||[]).length;
if (renderedCells!==100) {
  throw new Error(`Start hry vytvořil ${renderedCells} polí místo očekávaných 100.`);
}

const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||"";
const opens=(css.match(/{/g)||[]).length;
const closes=(css.match(/}/g)||[]).length;
if (opens!==closes) throw new Error(`CSS bloky nejsou vyvážené: ${opens}/${closes}.`);

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const duplicates=ids.filter((id,index)=>ids.indexOf(id)!==index);
if (duplicates.length) throw new Error(`Duplicitní HTML ID: ${[...new Set(duplicates)].join(", ")}`);

if (/Number\([^)]*\|\|\s*0\)/.test(scripts.at(-1))) {
  throw new Error("Aktivní hra stále obsahuje tiché nahrazení chybějící souřadnice nulou.");
}

console.log("HTML, inline JavaScript a CSS prošly kontrolou.");
