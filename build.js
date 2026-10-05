#!/usr/bin/env node
/* Builds dist/lab-bench.html (single offline file) and dist/engine.cjs (Node bundle for tests and tooling). No dependencies. */
const fs = require("fs"), path = require("path");
const R = p => fs.readFileSync(path.join(__dirname, p), "utf8");
const ENGINE = ["src/engine/core.js","src/engine/l3.js","src/engine/cli.js","src/engine/wifi.js","src/engine/faults.js","src/engine/questions.js","src/engine/steps.js"];
const CONTENT = ["src/content/terms.js","src/content/scenarios.js","src/content/sims.js","src/content/wifi-labs.js"];
const APP = ["src/app/helpers.js","src/content/legacy-labs.js","src/app/validate.js","src/app/platform.js","src/app/store.js","src/app/cards.js","src/app/components.js","src/app/simui.js","src/app/wifiui.js","src/app/practice.js","src/app/explain.js","src/app/create.js","src/app/categories.js","src/app/main.js"];
const strip = s => s.replace(/^\s*"use strict";\s*$/gm, "");
const js = '"use strict";\n' + [...ENGINE, ...CONTENT, ...APP].map(f=>`/* ==== ${f} ==== */\n` + strip(R(f))).join("\n");
fs.mkdirSync(path.join(__dirname, "dist"), {recursive:true});
const html = R("src/app/index.html").replace("/*CSS*/", () => R("src/app/style.css")).replace("/*JS*/", () => js.replace(/<\/script/gi, "<\\/script"));
fs.writeFileSync(path.join(__dirname, "dist/lab-bench.html"), html);
const exportsList = ["makeNet","evalGoal","checkNetTask","applySolution","solutionText","runCommand","hostCfg","hostPing","resolveName","generateFaultLab","checkWifiTask","wifiEval","wifiAnalyzer","questionPool","genRng","srsUpdate","OBJECTIVES","DOMAIN_OF","TERM_GROUPS","SCENARIOS","PORTS_TABLE","ACRONYMS","SIM_LABS","WIFI_LABS","sclone","subnetSteps","ipv6Steps","simHints","wifiHints","ipToInt","intToIp"];
const node = '"use strict";\n' + [...ENGINE, ...CONTENT].map(f=>strip(R(f))).join("\n") + `\nmodule.exports = {${exportsList.join(", ")}};\n`;
fs.writeFileSync(path.join(__dirname, "dist/engine.cjs"), node);
console.log(`Built dist/lab-bench.html (${(html.length/1024).toFixed(0)} KB) and dist/engine.cjs`);
