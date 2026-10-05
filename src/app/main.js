/* ---------- app shell ---------- */

"use strict";
const APP_VERSION = "1.2.0";
const ui = { view:"home", tab:"labs", cat:null, kind:"all", source:"all", run:null,
  gen:{domain:"troubleshooting", obj:"", type:"any", difficulty:2, count:1, topic:"", busy:false, status:"", err:false, added:[], ctl:null},
  importText:"", importMsg:"", cards:{mode:"weak", status:"", err:false, busy:false, ctl:null, fallback:"", showAll:false}, quizScope:"weak", quizCount:10, examLen:30 };
TYPES.wifi = "Wireless sim";
const band = s => s==null ? "" : s>=85 ? "g" : s>=60 ? "a" : "r";
const typesOf = l => [...new Set(l.tasks.map(t=>t.type))];
function allLabEntries(){
  const lv = userLevel();
  const E = l => { const types = typesOf(l); return {id:l.id, title:l.title, desc:l.desc || firstSentence(l.scenario), cat:catOfLab(l), domain:l.domain, difficulty:l.difficulty, level:l.difficulty||2, types, kind:kindOf(types), objectives:labObjectives(l), lab:l}; };
  const faults = lv || null;
  return [
    {id:"gen-fault", title:LAB_META["gen-fault"].title, desc:`A brand-new network with hidden faults every time. ${lv ? `At ${levelName(lv)} there ${lv===1?"is 1 fault":`are ${lv} faults`} to find.` : "Plants 1 to 3 faults; pick a level to control how many."}`, cat:"troubleshooting", domain:"troubleshooting", difficulty:lv||2, level:lv||2, types:["net"], kind:"sim", objectives:["5.3","2.2","2.1","3.4","5.2","4.3","1.7"], source:"builtin", gen:()=>generateFaultLab((Date.now() ^ Math.floor(Math.random()*1e9)) >>> 0, faults ? {faults} : undefined), featured:true},
    ...store.custom.map(l=>({...E(l), source:"mine"})),
    ...SIM_LABS.map(l=>({...E(l), source:"builtin"})),
    ...WIFI_LABS.map(l=>({...E(l), source:"builtin"})),
    ...GEN_LABS.map(l=>({...l, title:LAB_META[l.id].title, desc:LAB_META[l.id].desc, cat:LAB_META[l.id].cat, level:lv||l.difficulty, difficulty:lv||l.difficulty, kind:"drill", gen:()=>l.gen(lv||undefined), objectives:[l.id==="gen-ports"?"1.4":"1.7"], source:"builtin"})),
    ...STATIC_LABS.map(l=>({...E(l), source:"builtin"}))
  ];
}
function render(){
  const app = document.getElementById("app");
  put(app, ui.view==="lab" && ui.run ? labView() : homeView());
}
function openEntry(e){
  if (!e) return;
  const lab = e.gen ? e.gen() : clone(e.lab);
  if (!lab) return;
  if (e.gen){
    if (lab.id==="gen-fault") lab.title = String(lab.title||"").replace(/^Random fault hunt/, "Random troubleshooting challenge");
    else if (LAB_META[lab.id]) lab.title = LAB_META[lab.id].title;
    if (userLevel()) lab.difficulty = userLevel();
    lab.cat = e.cat;
  }
  ui.run = {entry:e, lab, comps:[], graded:false, score:null};
  ui.view = "lab"; render(); window.scrollTo(0,0);
}
function weakSpotLab(){
  const lv = userLevel();
  let all = allLabEntries().filter(e=>!e.featured);
  if (lv){ const f = all.filter(e=>e.level===lv); if (f.length) all = f; }
  const objs = Object.keys(OBJECTIVES).sort((a,b)=>(mastery(a)??-1)-(mastery(b)??-1));
  for (const o of objs){ const c = all.filter(e=>e.objectives.includes(o)); if (c.length){ const lo = Math.min(...c.map(e=>store.progress.labs[e.id] ? store.progress.labs[e.id].last : -1)); return pick(c.filter(e=>(store.progress.labs[e.id] ? store.progress.labs[e.id].last : -1)===lo)); } }
  return pick(all);
}
/* ---- home ---- */
const TABS = [["labs","Labs"],["path","My path"],["quiz","Quiz"],["exam","Practice exam"],["progress","Progress"],["cards","Flashcards"],["create","Create"],["settings","Settings"]];
function homeView(){
  const panel = h("div",{class:"panel", role:"group", "aria-label":"Topics"},
    CATEGORIES.map(c=>{ const m = catMastery(c.id);
      return h("button",{class:"port","aria-pressed":ui.cat===c.id?"true":"false", title:`${c.name}: ${m==null?"not started yet":m+"% mastery"}`, onclick:()=>{ ui.cat = ui.cat===c.id ? null : c.id; if (!["labs","quiz","progress","cards"].includes(ui.tab)) ui.tab = "labs"; if (ui.tab==="quiz") ui.quizScope = ui.cat ? "cat:"+ui.cat : "weak"; render(); }},
        h("span",{class:"led "+band(m)}), h("span",{class:"jack"}), h("span",{class:"cable", style:`background:${c.color}`}), h("span",{class:"name"}, c.short), h("span",{class:"pct"}, m==null ? "–" : m+"%")); }));
  const up = levelUpOffer(), lv = userLevel();
  const levelBar = h("div",{class:"levelbar"},
    h("span",{class:"lbl"},"Level"), levelPicker(true),
    up ? h("span",{class:"nudge"}, `You've passed most ${levelName(lv)} labs. `, h("button",{class:"btn ghost small", onclick:()=>{ setPrefs({level:up}); render(); }}, `Move up to ${levelName(up)} →`))
       : h("span",{class:"small muted"}, lv ? `Showing ${levelName(lv)} labs. Pass most of them to unlock a nudge to the next level.` : "Showing every level. Pick Easy, Medium or Hard to work your way up."));
  const due = dueKeys().length, next = nextInPath();
  const actions = h("div",{class:"row"},
    next ? h("button",{class:"btn primary", onclick:()=>openEntry(next)},"Next lab in my path") : null,
    h("button",{class:"btn"+(next?"":" primary"), onclick:()=>openEntry(weakSpotLab())},"Lab on my weak spot"),
    h("button",{class:"btn", onclick:()=>openEntry(allLabEntries()[0])},"Random challenge"),
    due ? h("button",{class:"btn", onclick:()=>startQuiz("due", Math.min(30, Math.max(10, due)))},`Review ${Math.min(30,due)} due`) : h("button",{class:"btn", onclick:()=>startQuiz("weak", 10)},"Quick quiz"));
  const pathN = (prefs().path||[]).length;
  const tabs = h("div",{class:"tabs", role:"tablist"}, TABS.map(([k,t])=>h("button",{class:"tab", role:"tab","aria-selected":ui.tab===k?"true":"false", onclick:()=>{ ui.tab=k; render(); }}, k==="cards" && Object.keys(store.cards).length ? `${t} (${Object.keys(store.cards).length})` : k==="path" && pathN ? `${t} (${pathN})` : t)));
  const body = {labs:labsTab, path:pathTab, quiz:quizTab, exam:examTab, progress:progressTab, cards:cardsTab, create:createTab, settings:settingsTab}[ui.tab]();
  return h("div",null,
    h("div",{class:"top"}, h("div",null, h("h1",null,"Network Lab Bench"), h("div",{class:"sub"},"Hands-on Network+ practice, organized by topic"))),
    panel, h("p",{class:"panel-note"},"Each port is a topic. Its light shows how you're doing: green at 85% and up, amber at 60%, red below, dark until you start. Tap a port to see just that topic."),
    levelBar, actions, tabs, body);
}
function labRow(e){
  const r = store.progress.labs[e.id], c = cat(e.cat), inPath = (prefs().path||[]).includes(e.id);
  return h("div",{class:"lrow"},
    h("button",{class:"item"+(e.featured?" featured":""), onclick:()=>openEntry(e)},
      h("span",{class:"stripe", style:`background:${c.color}`}),
      h("span",null, h("div",{class:"t"}, e.title), e.desc ? h("div",{class:"d"}, e.desc) : null,
        h("div",{class:"m"}, `${KINDS[e.kind]}${e.source==="mine"?", made by you":""} · `, levelTag(e.level))),
      r ? h("span",{class:"s", style:`color:var(--${band(r.best)==="g"?"ok":band(r.best)==="a"?"warn":"bad"})`, title:`Best ${r.best}%, last ${r.last}%`}, r.best+"%") : h("span",{class:"s new"},"New")),
    h("button",{class:"mini pathbtn"+(inPath?" on":""), "aria-pressed":inPath?"true":"false", "aria-label":`${inPath?"Remove from":"Add to"} my path: ${e.title}`, onclick:()=>{ togglePath(e.id); render(); }}, inPath ? "✓ Path" : "+ Path"));
}
function labsTab(){
  const sel = (val, opts, on, label) => h("select",{"aria-label":label, onchange:e=>{on(e.target.value); render();}}, opts.map(([v,t])=>h("option",{value:v, selected:v===val},t)));
  const lv = userLevel();
  const filters = h("div",{class:"filters"},
    sel(ui.cat || "all", [["all","All topics"],...CATEGORIES.map(c=>[c.id,c.name])], v=>{ ui.cat = v==="all" ? null : v; }, "Topic"),
    sel(ui.kind, KIND_FILTER, v=>ui.kind=v, "Lab type"),
    sel(String(lv), [["0","All levels"],...LEVELS.map(([n,t])=>[String(n),t])], v=>setPrefs({level:Number(v)}), "Level"),
    sel(ui.source, [["all","Built-in and mine"],["builtin","Built-in"],["mine","My labs"]], v=>ui.source=v, "Source"));
  const list = allLabEntries().filter(e => (!ui.cat || e.cat===ui.cat) && (ui.kind==="all" || e.kind===ui.kind) && (!lv || e.level===lv) && (ui.source==="all" || e.source===ui.source));
  const groups = CATEGORIES.map(c=>({c, items:list.filter(e=>e.cat===c.id).sort((a,b)=>(b.featured?1:0)-(a.featured?1:0) || a.level-b.level)})).filter(g=>g.items.length);
  const sections = groups.map(({c, items})=>{
    const fixed = items.filter(e=>!e.gen), done = fixed.filter(e=>passed(e.id)).length;
    return h("section",{class:"catgroup", "aria-label":c.name},
      h("div",{class:"cathead"}, h("span",{class:"dot", style:`background:${c.color}`}), h("h3",null, c.name), fixed.length ? h("span",{class:"small muted"}, `${done} of ${fixed.length} passed`) : null),
      h("p",{class:"small muted catdesc"}, c.desc),
      h("div",{class:"list"}, items.map(labRow)));
  });
  return h("div",null, filters,
    h("p",{class:"small muted"}, `${list.length} lab${list.length===1?"":"s"}${lv ? ` at ${levelName(lv)}` : ""}. Simulations are graded on whether the network actually works, so any valid fix counts. A lab counts as passed at 85%. Use “+ Path” to build your own study plan.`),
    sections.length ? sections : h("div",{class:"list"}, h("div",{class:"empty"}, lv ? `No ${levelName(lv)} labs match these filters. Try another level or topic.` : "No labs match these filters.")));
}
function diffBars(n){ return levelTag(n); }
/* ---- my path ---- */
function pathTab(){
  const P = prefs(), entries = pathEntries(), next = nextInPath();
  const B = ui.pathBuild || (ui.pathBuild = {cat:"all", levels:"1-3", skip:true, msg:""});
  const sel = (val, opts, on, label) => h("select",{"aria-label":label, onchange:e=>{on(e.target.value); B.msg=""; render();}}, opts.map(([v,t])=>h("option",{value:v, selected:v===val},t)));
  const levelRows = h("div",{class:"bars"}, LEVELS.map(([n,name])=>{ const p = levelProgress(n), pct = p.total ? Math.round(p.done/p.total*100) : 0;
    return h("div",{class:"bar"}, h("span",{class:"bl"}, name), h("span",{class:"bt"}, h("span",{style:`width:${pct}%;background:var(--${n===1?"ok":n===2?"warn":"bad"})`})), h("span",{class:"bv"}, `${p.done}/${p.total}`)); }));
  function addLabs(){
    const lvls = {"1-3":[1,2,3], "1":[1], "2":[2], "3":[3], "2-3":[2,3]}[B.levels];
    const order = id => CATEGORIES.findIndex(c=>c.id===id);
    const have = new Set(P.path||[]);
    const add = allLabEntries().filter(e=>!e.gen && (B.cat==="all" || e.cat===B.cat) && lvls.includes(e.level) && !have.has(e.id) && !(B.skip && passed(e.id)))
      .sort((a,b)=>a.level-b.level || order(a.cat)-order(b.cat));
    setPrefs({path:[...(P.path||[]), ...add.map(e=>e.id)]});
    B.msg = add.length ? `Added ${add.length} lab${add.length===1?"":"s"}.` : "Nothing new to add with those choices.";
    render();
  }
  const move = (i, d) => { const p = [...P.path]; const j = i+d; if (j<0 || j>=p.length) return; [p[i],p[j]] = [p[j],p[i]]; setPrefs({path:p}); render(); };
  const ids = P.path || [];
  const rows = entries.map(e=>{ const i = ids.indexOf(e.id), r = store.progress.labs[e.id], ok = passed(e.id), c = cat(e.cat);
    return h("div",{class:"prow"+(ok?" done":"")+(next && next.id===e.id?" next":"")},
      h("span",{class:"pn", "aria-label":ok?"Passed":`Step ${i+1}`}, ok ? "✓" : String(i+1)),
      h("button",{class:"ptitle", onclick:()=>openEntry(e)}, h("span",{class:"t"}, e.title), h("span",{class:"m"}, h("span",{class:"dot", style:`background:${c.color}`}), `${c.name} · ${KINDS[e.kind]} · `, levelTag(e.level), r ? ` · best ${r.best}%` : "")),
      h("span",{class:"rowbtns"},
        h("button",{class:"mini", disabled:i===0, "aria-label":"Move up", onclick:()=>move(i,-1)},"↑"),
        h("button",{class:"mini", disabled:i===ids.length-1, "aria-label":"Move down", onclick:()=>move(i,1)},"↓"),
        h("button",{class:"mini", "aria-label":"Remove from path", onclick:()=>{ togglePath(e.id); render(); }},"✕")));
  });
  const doneN = entries.filter(e=>passed(e.id)).length;
  return h("div",null,
    h("p",{class:"small muted"},"Design your own study plan. Add labs from any topic, put them in the order you want, and work through them one at a time. A lab is checked off once you score 85% or better."),
    h("div",{class:"form"}, h("b",null,"Your progress by level"), levelRows,
      h("div",{class:"row"}, h("span",{class:"small"},"Your level:"), levelPicker(false))),
    h("div",{class:"form", style:"margin-top:14px"}, h("b",null,"Add labs to your path"),
      h("p",{class:"small", style:"margin:0"},"Pick a topic and levels and Network Lab Bench adds the matching labs, easiest first. You can also tap “+ Path” on any lab in the Labs tab."),
      h("div",{class:"row"},
        sel(B.cat, [["all","All topics"],...CATEGORIES.map(c=>[c.id,c.name])], v=>B.cat=v, "Topic"),
        sel(B.levels, [["1-3","Easy, then Medium, then Hard"],["1","Easy only"],["2","Medium only"],["3","Hard only"],["2-3","Medium, then Hard"]], v=>B.levels=v, "Levels"),
        h("label",{class:"inl small"}, h("input",{type:"checkbox", checked:B.skip, onchange:e=>{ B.skip = e.target.checked; }}), " Skip labs I've passed"),
        h("button",{class:"btn primary", onclick:addLabs},"Add to my path")),
      B.msg ? h("span",{class:"small", role:"status"}, B.msg) : null),
    h("div",{class:"row", style:"justify-content:space-between;margin:18px 0 8px"},
      h("h3",null, entries.length ? `My path: ${doneN} of ${entries.length} done` : "My path"),
      entries.length ? h("div",{class:"row"},
        next ? h("button",{class:"btn primary", onclick:()=>openEntry(next)},"Start next lab") : null,
        h("button",{class:"btn ghost danger", onclick:()=>{ if (confirm("Clear your whole path? Your scores are kept.")){ setPrefs({path:[]}); render(); } }},"Clear path")) : null),
    h("div",{class:"list"}, rows.length ? rows : h("div",{class:"empty"},"Your path is empty. Add labs above, or tap “+ Path” on labs in the Labs tab.")),
    entries.length && !next ? h("p",{class:"small", style:"margin-top:10px"},"Every lab in your path is passed. Add more, or move up a level.") : null);
}
/* ---- settings ---- */
function settingsTab(){
  let msg = h("span",{class:"small", role:"status"});
  const key = h("input",{type:"password", value:platform.setting("apikey"), placeholder:"sk-ant-...", "aria-label":"Anthropic API key", autocomplete:"off"});
  const model = h("input",{type:"text", value:platform.setting("model") || "claude-sonnet-5-5", "aria-label":"Model"});
  const file = h("input",{type:"file", accept:".json,application/json", "aria-label":"Backup file", onchange:async e=>{ const f = e.target.files[0]; if (!f) return; try{ store.importAll(await f.text()); msg.textContent = "Backup imported and merged."; render(); }catch(err){ msg.textContent = err.message || "Couldn't read that file."; } }});
  return h("div",null,
    h("div",{class:"form", style:"margin-bottom:14px"}, h("b",null,"Level"),
      h("p",{class:"small", style:"margin:0"},"Start at Easy and work your way up. Your level filters the Labs list, picks your weak-spot labs, sets how many faults the random challenge plants, and sets how hard the subnetting and ports drills are. All levels shows everything."),
      levelPicker(false)),
    platform.inClaude ? h("div",{class:"form"}, h("b",null,"Running inside Claude"), h("p",{class:"small", style:"margin:0"},"Progress, your labs and flashcards sync to your Claude account, and AI features use your Claude plan. Nothing to configure.")) :
      h("div",{class:"form"}, h("b",null,"AI features (optional)"), h("p",{class:"small", style:"margin:0"},"Creating labs and rewriting flashcards with AI needs an Anthropic API key. It's stored only in this browser and sent only to api.anthropic.com. Everything else works without it."),
        h("div",{class:"field"}, h("label",null,"Anthropic API key"), key), h("div",{class:"field"}, h("label",null,"Model"), model),
        h("div",{class:"row"}, h("button",{class:"btn primary", onclick:()=>{ platform.setting("apikey", key.value.trim() || null); platform.setting("model", model.value.trim() || null); msg.textContent = "Saved."; }},"Save"), h("button",{class:"btn ghost", onclick:()=>{ platform.setting("apikey", null); key.value = ""; msg.textContent = "Key removed."; }},"Remove key"))),
    h("div",{class:"form", style:"margin-top:14px"}, h("b",null,"Backup and restore"), h("p",{class:"small", style:"margin:0"},"Save everything (progress, spaced-repetition schedule, your labs and flashcards) to a file, or merge a backup from another device."),
      h("div",{class:"row"}, h("button",{class:"btn", onclick:async()=>{ try{ await platform.saveFile(`lab-bench-backup-${new Date().toISOString().slice(0,10)}.json`, store.exportAll(), "application/json"); msg.textContent = "Backup saved."; }catch(e){ msg.textContent = e && e.code==="declined" ? "Cancelled." : "Downloads aren't available here."; } }},"Download backup"), h("label",{class:"btn"}, "Import backup", h("span",{class:"visually-hidden"}, file))),
      h("div",{class:"row"}, h("button",{class:"btn ghost danger", onclick:()=>{ if (confirm("Erase all progress, review schedules and flashcards? Your custom labs, level and path are kept.")){ store.resetAll(); msg.textContent = "Progress reset."; render(); } }},"Reset progress")), msg),
    h("div",{class:"form", style:"margin-top:14px"}, h("b",null,"About"),
      h("p",{class:"small", style:"margin:0"},`Network Lab Bench ${APP_VERSION} is free, open-source practice software aligned to the CompTIA Network+ N10-009 exam objectives. It is not affiliated with or endorsed by CompTIA. CompTIA and Network+ are trademarks of CompTIA, Inc. Code is MIT licensed; lab and question content is CC BY-SA 4.0.`),
      h("p",{class:"small", style:"margin:0"},`Content: ${SIM_LABS.length} network sims, ${WIFI_LABS.length} wireless labs, ${STATIC_LABS.length + GEN_LABS.length} question-style labs, an endless random fault generator, ${TERM_GROUPS.reduce((s,g)=>s+g.items.length,0)} definitions, ${SCENARIOS.length} scenario questions, ${PORTS_TABLE.length} ports and ${ACRONYMS.length} acronyms.`)));
}
/* ---- lab view ---- */
function makeComp(t, lab, name, opts){
  return t.type==="match" ? matchComp(t) : t.type==="order" ? orderComp(t) : t.type==="fill" ? fillComp(t) : t.type==="cli" ? cliComp(t,name) : t.type==="net" ? netComp(t,lab,opts) : t.type==="wifi" ? wifiComp(t,lab,opts) : choiceComp(t,name);
}
function labView(){
  const run = ui.run, lab = run.lab, c = cat(run.entry.cat || catOfLab(lab)), kind = kindOf(typesOf(lab));
  run.comps = [];
  const tasks = lab.tasks.map((t,i)=>{
    const name = "q"+i+"-"+Math.random().toString(36).slice(2,6);
    const comp = makeComp(t, lab, name);
    const scoreEl = h("span",{class:"tscore"}), exp = h("div");
    run.comps.push({comp, scoreEl, exp, t});
    return h("section",{class:"task","aria-label":`Task ${i+1}`},
      h("div",{class:"tnum"}, scoreEl, lab.tasks.length>1 ? `Task ${i+1} of ${lab.tasks.length}, ${TYPES[t.type].toLowerCase()}` : TYPES[t.type]),
      t.type!=="choice" || t.prompt ? h("p",{class:"tprompt"}, t.prompt || "") : null, comp.el, exp);
  });
  const bar = h("div",{class:"result"});
  function drawBar(){
    if (!run.graded){ put(bar, h("span",{class:"small muted"}, lab.tasks.some(t=>t.type==="net"||t.type==="wifi") ? "Make your changes, test with the terminals, then check." : "Answer every part, then check."), h("button",{class:"btn primary", onclick:gradeAll},"Check answers")); return; }
    const s = run.score;
    put(bar, 
      h("div",{class:"score "+band(s)}, s+"%", h("small",null, s>=85?"Solid. Try a harder one or a new variant.":s>=60?"Close. Read the explanations, then retry.":"Worth another pass after reading the explanations.", run.missCount ? ` ${run.missCount} miss${run.missCount===1?"":"es"} saved to Flashcards.` : "", run.hintsUsed ? ` You used ${run.hintsUsed} hint${run.hintsUsed===1?"":"s"}.` : "")),
      h("div",{class:"row"}, h("button",{class:"btn", onclick:()=>openEntry(run.entry)}, lab.variant ? "New variant" : "Try again"),
        (prefs().path||[]).includes(run.entry.id) || nextInPath() ? (()=>{ const nx = nextInPath(run.score>=85 ? null : run.entry.id); return nx ? h("button",{class:"btn primary", onclick:()=>openEntry(nx)},"Next in my path") : h("button",{class:"btn primary", onclick:()=>openEntry(weakSpotLab())},"Next weak spot"); })()
          : h("button",{class:"btn primary", onclick:()=>openEntry(weakSpotLab())},"Next weak spot"),
        !(prefs().path||[]).includes(run.entry.id) && !run.entry.gen ? h("button",{class:"btn ghost", onclick:()=>{ togglePath(run.entry.id); drawBar(); }},"+ Add to my path") : null));
  }
  function gradeAll(){
    let total = 0; const misses = [], hits = [];
    for (const c of run.comps){
      const s = c.comp.grade(); total += s;
      c.scoreEl.textContent = Math.round(s*100)+"%";
      c.scoreEl.style.color = `var(--${band(Math.round(s*100))==="g"?"ok":band(Math.round(s*100))==="a"?"warn":"bad"})`;
      if (c.t.type!=="net" && c.t.type!=="wifi") put(c.exp, explainBox(c.t) || "");
      else if (c.t.explanation) put(c.exp, h("div",{class:"explain"}, h("b",null,"Why"), c.t.explanation));
      for (const m of c.comp.misses||[]) misses.push({...m, extra:c.t.explanation||"", context: m.context ? lab.scenario||"" : ""});
      hits.push(...(c.comp.hits||[]));
    }
    run.score = Math.round(total/run.comps.length*100);
    run.missCount = misses.length; run.graded = true; run.hintsUsed = run.comps.reduce((s,c)=>s+(c.comp.hintsUsed||0),0);
    store.recordLab(lab, run.score);
    store.trackCards(lab, misses, hits);
    drawBar();
  }
  drawBar();
  const back = h("button",{class:"btn ghost", onclick:()=>{ ui.view="home"; ui.run=null; render(); window.scrollTo(0,0); }}, ui.tab==="path" ? "← My path" : "← All labs");
  const del = run.entry.source==="mine" ? h("button",{class:"btn ghost danger", onclick:()=>{ if (confirm("Delete this lab? Its score history goes too.")){ store.deleteLab(lab.id); ui.view="home"; ui.run=null; render(); } }},"Delete lab") : null;
  return h("div",null,
    h("div",{class:"row", style:"justify-content:space-between"}, back, del),
    h("header",{class:"labhead", style:`border-left-color:${c.color}`},
      h("div",{class:"meta"}, `${c.name} · ${KINDS[kind]} · `, levelTag(lab.difficulty)), h("h2",null, lab.title)),
    lab.scenario ? h("p",{class:"scenario"}, lab.scenario) : null,
    lab.exhibit ? [h("div",{class:"exlabel"},"Exhibit"), h("pre",{class:"exhibit", tabindex:"0"}, lab.exhibit)] : null,
    tasks, bar);
}
/* ---- boot ---- */
store.loadLocal();
render();
platform.init().then(()=>{ store.connect(); if (ui.view==="home") render(); });
