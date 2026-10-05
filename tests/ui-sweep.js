#!/usr/bin/env node
/* Clicks through every screen, quiz, exam item, lab, device panel and hint, and fails on any stray "null", "undefined" or "NaN" text or script error. Needs jsdom: npm install, then npm run test:ui */
const {JSDOM}=require("jsdom");const fs=require("fs");
const html=fs.readFileSync(require("path").join(__dirname,"../dist/lab-bench.html"),"utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://x.test/"});
const w=dom.window; w.scrollTo=()=>{}; w.confirm=()=>true; const d=w.document; const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
const click=el=>el && el.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
const bad=[]; const scan=where=>{ const t=d.getElementById("app").textContent; const m=t.match(/null|undefined|NaN/g); if (m) bad.push(`${where}: ${[...new Set(m)].join(",")} ... "${t.slice(Math.max(0,t.search(/null|undefined|NaN/)-50), t.search(/null|undefined|NaN/)+20).replace(/\s+/g," ")}"`); };
setTimeout(async()=>{
 w.eval(`platform.sample = {json: async ()=>({steps:["A","B"], tip:"T"})}`);
 for (const [k] of w.eval("TABS")){ w.eval(`ui.view="home"; ui.tab="${k}"; render()`); scan("tab "+k); }
 // quiz in several scopes, before and after checking each question
 for (const scope of ["weak","1.7","1.8","5.5","acronym","security"]){
   w.eval(`ui.view="home"; startQuiz("${scope}", 8)`);
   for (let i=0;i<8;i++){ scan(`quiz ${scope} q${i} before`); click(d.querySelector(".qbox .opt")); scan(`quiz ${scope} q${i} chosen`); click(d.querySelector(".result .btn.primary")); scan(`quiz ${scope} q${i} checked`); const ai=d.querySelector(".aiexp .btn"); if (ai){ click(ai); await new Promise(r=>setTimeout(r,10)); scan(`quiz ${scope} q${i} ai`); } click(d.querySelector(".result .btn.primary")); }
   scan(`quiz ${scope} summary`);
 }
 // exam: every item, then report
 w.eval(`ui.view="home"; startExam(30)`); const n=w.eval("ui.exam.items.length");
 for (let i=0;i<n;i++){ w.eval(`ui.exam.i=${i}; render()`); scan(`exam item ${i}`); click(d.querySelector(".qbox .opt")); }
 w.eval("finishExam()"); scan("exam report"); d.querySelectorAll("details").forEach(x=>x.open=true); scan("exam review");
 // every lab: every device panel (config + terminal + expanded rows), hints, graded state
 const ids=w.eval("allLabEntries().map(e=>e.id)");
 for (const id of ids){
   w.eval(`openEntry(allLabEntries().find(e=>e.id==="${id}"))`); scan(`lab ${id}`);
   for (const g of [...d.querySelectorAll(".topo-svg .dev")]){ click(g); d.querySelectorAll(".dpanel .mini").forEach(b=>{ if (b.textContent==="More") click(b); }); d.querySelectorAll(".dpanel details").forEach(x=>x.open=true); scan(`lab ${id} device`); const tt=[...d.querySelectorAll(".dtabs .tab")].find(b=>b.textContent==="Terminal"); if (tt){ click(tt); scan(`lab ${id} terminal`); } }
   const hb=d.querySelector(".hints .btn"); if (hb){ click(hb); click(hb); click(hb); scan(`lab ${id} hints`); }
   click([...d.querySelectorAll(".result .btn.primary")].find(b=>b.textContent==="Check answers")); scan(`lab ${id} graded`);
 }
 w.eval(`ui.view="home"; ui.tab="progress"; render()`); scan("progress after work");
 w.eval(`ui.tab="cards"; render()`); scan("cards after work");
 console.log(`UI sweep: ${bad.length} stray null/undefined/NaN, ${errs.length} script errors`); if (bad.length || errs.length){ console.log(bad.slice(0,15).concat(errs.slice(0,5)).join("\n")); process.exit(1); } process.exit(0);
},300);
