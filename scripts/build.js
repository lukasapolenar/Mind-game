"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputs = path.join(root, "outputs");

async function main() {
  if (!fs.existsSync(path.join(outputs, "index.html"))) {
    throw new Error("Chybí outputs/index.html.");
  }

  const publicConfig = {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    appUrl: process.env.PUBLIC_APP_URL || ""
  };

  fs.writeFileSync(
    path.join(outputs, "runtime-config.js"),
    `globalThis.__OKRAJOVKA_CONFIG__=${JSON.stringify(publicConfig)};\n`
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
