/* ---------- quiz, practice exam, progress ---------- */

"use strict";
let _pool = null;
const pool = () => _pool || (_pool = questionPool());
function dueKeys(){ const now = Date.now(); return Object.entries(store.progress.srs).filter(([k,r])=>r.due<=now).sort((a,b)=>a[1].due-b[1].due).map(([k])=>k); }
function weakWeight(o){ const m = mastery(o); return m==null ? 70 : Math.max(5, 100-m); }
function pickQuestions(scope, n, R){
  const P = pool(); let cand;
  if (scope==="due"){ const keys = new Set(dueKeys()); cand = P.filter(p=>p.key && keys.has(p.key)); if (!cand.length) cand = P; }
  else if (scope==="acronym") cand = P.filter(p=>p.obj==="acronym");
  else if (String(scope).startsWith("cat:")){ const c = String(scope).slice(4); cand = P.filter(p=>catOfObj(p.obj)===c); if (!cand.length) cand = P.filter(p=>p.obj!=="acronym"); }
  else if (OBJECTIVES[scope]) cand = P.filter(p=>p.obj===scope);
  else if (DOMAIN_WEIGHT[scope]) cand = P.filter(p=>DOMAIN_OF(p.obj)===scope);
  else cand = P.filter(p=>p.obj!=="acronym");
  const out = [], used = new Set();
  for (let k=0; k<n*6 && out.length<n; k++){
    let p;
    if (scope==="weak"){ const tot = cand.reduce((s,x)=>s+weakWeight(x.obj),0); let r = R.f()*tot; p = cand.find(x=>(r -= weakWeight(x.obj)) <= 0) || cand[0]; }
    else if (scope==="due") p = cand[out.length % cand.length];
    else p = R.pick(cand);
    const q = p.make(R); const id = q.key && !p.generated ? q.key : q.prompt;
    if (used.has(id)) continue; used.add(id); out.push(q);
  }
  return out;
}
function cardFromQuestion(q){ return {key:"q:"+(q.key||hashStr(q.prompt)), obj:q.obj, front:q.prompt + "\n\n" + q.options.map((o,i)=>`${String.fromCharCode(65+i)}. ${o}`).join("\n"), back:q.answer.map(i=>`${String.fromCharCode(65+i)}. ${q.options[i]}`).join("\n"), extra:q.explanation}; }
const QUIZ_SRC = obj => ({id:"quiz", title:"Quiz", domain:DOMAIN_OF(obj)||"concepts", objectives:[obj]});
/* ---- question widget shared by quiz and exam ---- */
function questionView(q, state, opts){
  const box = h("div",{class:"qbox"});
  const draw = () => {
    const shown = state.checked;
    put(box, 
      h("div",{class:"qmeta small muted"}, q.obj==="acronym" ? "Acronym" : OBJECTIVES[q.obj] ? `${cat(catOfObj(q.obj)).name} · ${OBJECTIVES[q.obj]}` : ""),
      h("p",{class:"qprompt"}, q.prompt),
      q.multi ? h("p",{class:"hint"},`Choose ${q.answer.length}.`) : null,
      h("div",{class:"opts", role: q.multi ? "group" : "radiogroup"}, q.options.map((o,i)=>{
        const chosen = state.chosen.includes(i);
        let cls = "opt" + (chosen ? " chosen" : "");
        if (shown){ if (q.answer.includes(i)) cls += " ok"; else if (chosen) cls += " no"; }
        return h("button",{type:"button", class:cls, role:q.multi?"checkbox":"radio", "aria-checked":chosen?"true":"false", disabled:shown,
          onclick:()=>{ if (q.multi){ state.chosen = chosen ? state.chosen.filter(x=>x!==i) : [...state.chosen, i]; } else state.chosen = [i]; draw(); opts && opts.onChange && opts.onChange(); }},
          h("span",{class:"letter"}, String.fromCharCode(65+i)), h("span",null,o));
      })),
      shown && q.explanation ? h("div",{class:"explain"}, h("b",null, state.correct ? "Correct" : "Not quite"), q.explanation,
        q.steps ? [h("b",{style:"margin-top:8px"},"Step by step"), stepsList(q.steps)] : null,
        q.steps ? null : aiExplainButton(()=>questionContext(q, state.chosen))) : null,
      !shown && q.steps && opts && opts.allowSteps ? h("details",{class:"import"}, h("summary",null,"Show me how to work it out"), stepsList(q.steps)) : null);
  };
  draw(); return {el:box, redraw:draw};
}
const isRight = (q, chosen) => chosen.length===q.answer.length && chosen.every(i=>q.answer.includes(i));
/* ---- quiz ---- */
function quizTab(){
  const Q = ui.quiz;
  if (Q && Q.items && !Q.finished) return quizRun();
  const due = dueKeys().length, total = store.progress.quiz.answered, acc = total ? Math.round(store.progress.quiz.correct/total*100) : null;
  const opt = (v,t) => h("option",{value:v, selected:(ui.quizScope||"weak")===v}, t);
  const scopeSel = h("select",{"aria-label":"Quiz topic", onchange:e=>{ ui.quizScope = e.target.value; }},
    h("optgroup",{label:"Mixed"}, opt("weak","My weak spots (adaptive)"), opt("due",`Due for review (${due})`), opt("all","Everything"), opt("acronym","Acronyms")),
    h("optgroup",{label:"By topic"}, CATEGORIES.map(c=>opt("cat:"+c.id, c.name))),
    CATEGORIES.filter(c=>c.objs.length>1).map(c=>h("optgroup",{label:`${c.name}: narrower`}, c.objs.map(o=>opt(o, OBJECTIVES[o])))));
  const countSel = h("select",{"aria-label":"Number of questions", onchange:e=>{ ui.quizCount = Number(e.target.value); }}, [10,20,30,50].map(n=>h("option",{value:n, selected:(ui.quizCount||10)===n}, `${n} questions`)));
  const last = Q && Q.finished ? quizSummary(Q) : null;
  return h("div",null,
    h("p",{class:"small muted"}, `Quick-fire questions on every Network+ topic. Answers you miss come back sooner (spaced repetition) and are added to your flashcards. ${total ? `${total} answered so far, ${acc}% correct.` : ""}`),
    h("div",{class:"form"}, h("div",{class:"row"}, scopeSel, countSel, h("button",{class:"btn primary", onclick:()=>startQuiz(ui.quizScope||"weak", ui.quizCount||10)},"Start quiz"))),
    last);
}
function startQuiz(scope, n){
  const R = genRng(Date.now() % 2147483647);
  ui.quiz = {scope, items:pickQuestions(scope, n, R).map(q=>({q, state:{chosen:[], checked:false}})), i:0, finished:false};
  ui.tab = "quiz"; render(); window.scrollTo(0,0);
}
function quizRun(){
  const Q = ui.quiz, it = Q.items[Q.i], q = it.q;
  const v = questionView(q, it.state, {allowSteps:true, onChange:()=>{ btn.disabled = !it.state.chosen.length; }});
  const btn = h("button",{class:"btn primary", disabled:!it.state.chosen.length && !it.state.checked, onclick:()=>{
    if (!it.state.checked){
      it.state.checked = true; it.state.correct = isRight(q, it.state.chosen);
      store.recordQuestion(q, it.state.correct);
      const card = cardFromQuestion(q);
      store.trackCards(QUIZ_SRC(q.obj), it.state.correct ? [] : [card], it.state.correct ? [card.key] : []);
      render(); return;
    }
    if (Q.i < Q.items.length-1){ Q.i++; render(); window.scrollTo(0,0); } else { Q.finished = true; render(); }
  }}, it.state.checked ? (Q.i < Q.items.length-1 ? "Next question" : "See results") : "Check answer");
  return h("div",null,
    h("div",{class:"row", style:"justify-content:space-between"}, h("span",{class:"small muted"}, `Question ${Q.i+1} of ${Q.items.length}`), h("button",{class:"btn ghost", onclick:()=>{ Q.finished = true; render(); }},"End quiz")),
    h("div",{class:"progressbar"}, h("span",{style:`width:${(Q.i+(it.state.checked?1:0))/Q.items.length*100}%`})),
    v.el, h("div",{class:"result"}, h("span",{class:"small muted"}, it.state.checked ? (it.state.correct ? "Nice." : "Review the explanation, then continue.") : "Pick an answer."), btn));
}
function quizSummary(Q){
  const done = Q.items.filter(x=>x.state.checked), right = done.filter(x=>x.state.correct).length;
  if (!done.length) return null;
  const miss = done.filter(x=>!x.state.correct);
  return h("div",{class:"form", style:"margin-top:14px"}, h("h3",null, `Last quiz: ${right} of ${done.length} (${Math.round(right/done.length*100)}%)`),
    miss.length ? h("div",null, h("p",{class:"small muted", style:"margin:0"},"Missed (now in your flashcards):"), h("ul",{class:"small"}, miss.map(x=>h("li",null, `${OBJECTIVES[x.q.obj] || "Acronym"}: ${x.q.prompt.split("\n").pop()} `, h("b",null, x.q.answer.map(i=>x.q.options[i]).join(", ")))))) : h("p",{class:"small"},"No misses. Try a harder topic or a practice exam."),
    h("div",{class:"row"}, h("button",{class:"btn primary", onclick:()=>startQuiz(Q.scope, Q.items.length)},"Another quiz"), miss.length ? h("button",{class:"btn", onclick:()=>startQuiz("due", Math.max(10, miss.length))},"Review due items") : null));
}
/* ---- practice exam ---- */
function examTab(){
  const E = ui.exam;
  if (E && !E.finished) return examRun();
  const hist = store.progress.exams||[];
  const lenSel = h("select",{"aria-label":"Exam length", onchange:e=>{ ui.examLen = Number(e.target.value); }}, [[30,"30 questions, 30 minutes"],[60,"60 questions, 60 minutes"],[90,"Full: up to 90 questions, 90 minutes"]].map(([v,t])=>h("option",{value:v, selected:(ui.examLen||30)===v},t)));
  return h("div",null,
    h("p",{class:"small muted"},"A timed exam with the same topic mix as the real Network+ (N10-009) test, with performance-based labs first, just like the real thing. The score is an estimate on CompTIA's 100 to 900 scale, where 720 passes."),
    h("div",{class:"form"}, h("div",{class:"row"}, lenSel, h("button",{class:"btn primary", onclick:()=>startExam(ui.examLen||30)},"Start exam"))),
    E && E.finished ? examReport(E) : null,
    hist.length ? h("div",{style:"margin-top:16px"}, subhead("Past exams"), h("div",{class:"list"}, hist.map(x=>h("div",{class:"item", style:"cursor:default"}, h("span",{class:"stripe", style:`background:var(--${x.scaled>=720?"ok":"bad"})`}), h("span",null, h("div",{class:"t"}, `${x.scaled} (${x.scaled>=720?"pass":"below passing"})`), h("div",{class:"m"}, `${new Date(x.at).toLocaleDateString()}, ${x.n} questions, ${x.pct}% correct`)), h("span",{class:"s"}, x.pct+"%"))))) : null);
}
function startExam(n){
  const R = genRng(Date.now() % 2147483647);
  const pbqN = n>=90 ? 5 : n>=60 ? 4 : 2;
  const mcN = n - pbqN;
  const counts = {}; let assigned = 0;
  for (const [d,w] of Object.entries(DOMAIN_WEIGHT)){ counts[d] = Math.round(mcN*w/100); assigned += counts[d]; }
  counts.troubleshooting += mcN - assigned;
  const items = [];
  const labs = R.shuffle([...SIM_LABS, ...WIFI_LABS, ...STATIC_LABS.filter(l=>l.tasks.some(t=>["cli","fill","match","order"].includes(t.type)))]);
  const pbqs = []; const usedDom = new Set();
  for (const l of labs){ if (pbqs.length>=pbqN) break; if (usedDom.has(l.domain) && labs.length>pbqN*2 && pbqs.length < 4) continue; usedDom.add(l.domain); pbqs.push(l); }
  for (const l of pbqs) items.push({pbq:true, lab:clone(l), state:{}});
  for (const [d,c] of Object.entries(counts)) for (const q of pickQuestions(d, c, R)) items.push({q, state:{chosen:[], checked:false}});
  const mc = R.shuffle(items.filter(x=>!x.pbq));
  ui.exam = {items:[...items.filter(x=>x.pbq), ...mc], i:0, start:Date.now(), limit:n*60e3, finished:false, flags:new Set()};
  ui.tab = "exam"; render(); window.scrollTo(0,0);
  clearInterval(ui.examTimer); ui.examTimer = setInterval(()=>{ const el = document.getElementById("exam-clock"); if (!ui.exam || ui.exam.finished){ clearInterval(ui.examTimer); return; } const left = ui.exam.limit - (Date.now()-ui.exam.start); if (left<=0){ finishExam(); return; } if (el) el.textContent = fmtClock(left); }, 1000);
}
const fmtClock = ms => { const s = Math.max(0, Math.round(ms/1000)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; };
function examRun(){
  const E = ui.exam, it = E.items[E.i];
  let body;
  if (it.pbq){
    if (!it.view){ const lab = it.lab; const comps = []; const tasks = lab.tasks.map((t,i)=>{ const comp = makeComp(t, lab, "x"+i, {exam:true}); comps.push({comp, t}); return h("section",{class:"task"}, h("div",{class:"tnum"}, TYPES[t.type]), t.prompt ? h("p",{class:"tprompt"}, t.prompt) : null, comp.el); }); it.comps = comps; it.view = h("div",null, h("h3",null, lab.title.replace(/^(Sim|Wi-Fi): /,"")), lab.scenario ? h("p",{class:"scenario"}, lab.scenario) : null, lab.exhibit ? h("pre",{class:"exhibit"}, lab.exhibit) : null, tasks); }
    body = it.view;
  } else body = questionView(it.q, it.state).el;
  const nav = h("div",{class:"examnav"}, E.items.map((x,k)=>h("button",{type:"button", class:"qn"+(k===E.i?" cur":"")+(x.pbq ? " pbq" : "")+((x.pbq ? x.touched : x.state.chosen.length) ? " done" : "")+(E.flags.has(k)?" flag":""), "aria-label":`Question ${k+1}${x.pbq?", lab":""}${E.flags.has(k)?", flagged":""}`, onclick:()=>{ if (it.pbq) it.touched = true; E.i = k; render(); window.scrollTo(0,0); }}, String(k+1))));
  return h("div",null,
    h("div",{class:"row examhead", style:"justify-content:space-between"}, h("b",null, `${it.pbq ? "Performance-based " : ""}Question ${E.i+1} of ${E.items.length}`), h("span",{class:"clock", id:"exam-clock"}, fmtClock(E.limit-(Date.now()-E.start)))),
    nav, body,
    h("div",{class:"result"},
      h("div",{class:"row"}, h("button",{class:"btn", disabled:E.i===0, onclick:()=>{ if (it.pbq) it.touched = true; E.i--; render(); window.scrollTo(0,0); }},"Back"), h("button",{class:"btn ghost", onclick:()=>{ E.flags.has(E.i) ? E.flags.delete(E.i) : E.flags.add(E.i); render(); }}, E.flags.has(E.i) ? "Unflag" : "Flag for review")),
      E.i < E.items.length-1 ? h("button",{class:"btn primary", onclick:()=>{ if (it.pbq) it.touched = true; E.i++; render(); window.scrollTo(0,0); }},"Next") : h("button",{class:"btn primary", onclick:()=>{ if (confirm("Submit the exam for scoring?")) finishExam(); }},"Submit exam")));
}
function finishExam(){
  const E = ui.exam; if (!E || E.finished) return;
  clearInterval(ui.examTimer);
  let pts = 0, max = 0; const byObj = {}, byDom = {};
  const add = (o, got, of) => { byObj[o] = byObj[o] || [0,0]; byObj[o][0] += got; byObj[o][1] += of; const d = DOMAIN_OF(o); if (d){ byDom[d] = byDom[d] || [0,0]; byDom[d][0] += got; byDom[d][1] += of; } };
  const misses = [];
  for (const it of E.items){
    if (it.pbq){
      if (!it.comps){ const lab = it.lab; it.comps = lab.tasks.map((t,i)=>({comp:makeComp(t, lab, "x"+i, {exam:true}), t})); }
      const sc = it.comps.reduce((s,c)=>s + c.comp.grade(), 0) / it.comps.length;
      it.score = sc; pts += sc*3; max += 3; for (const o of labObjectives(it.lab)) add(o, sc*3/labObjectives(it.lab).length, 3/labObjectives(it.lab).length);
      store.recordLab(it.lab, Math.round(sc*100));
    } else {
      const ok = isRight(it.q, it.state.chosen); it.state.checked = true; it.state.correct = ok;
      pts += ok ? 1 : 0; max += 1; add(it.q.obj, ok?1:0, 1);
      if (it.state.chosen.length){ store.recordQuestion(it.q, ok, true); if (!ok) misses.push(cardFromQuestion(it.q)); }
    }
  }
  const pct = Math.round(pts/max*100), scaled = Math.round(100 + 800*pts/max);
  E.finished = true; E.result = {pct, scaled, byObj, byDom};
  store.recordExam({at:Date.now(), n:E.items.length, pct, scaled});
  if (misses.length) store.trackCards({id:"exam", title:"Practice exam", domain:"concepts", objectives:[]}, misses, []);
  render(); window.scrollTo(0,0);
}
function examReport(E){
  const R = E.result;
  const weakest = Object.entries(R.byObj).filter(([o,[g,m]])=>m>0).sort((a,b)=>a[1][0]/a[1][1]-b[1][0]/b[1][1]).slice(0,5);
  return h("div",{class:"form", style:"margin-top:14px"},
    h("div",{class:"score "+(R.scaled>=720?"g":"r"), style:"font-size:40px"}, String(R.scaled), h("small",null, `${R.pct}% correct. ${R.scaled>=720 ? "At or above the 720 passing score." : "Below the 720 passing score."} This is an estimate, not CompTIA's scoring.`)),
    subhead("By topic"), h("div",{class:"bars"}, CATEGORIES.map(c=>{ let g = 0, m = 0; for (const o of c.objs){ const v = R.byObj[o]; if (v){ g += v[0]; m += v[1]; } } if (!m) return null; const p = Math.round(g/m*100); return h("div",{class:"bar"}, h("span",{class:"bl"}, c.name), h("span",{class:"bt"}, h("span",{style:`width:${p}%;background:${c.color}`})), h("span",{class:"bv"}, p+"%")); })),
    weakest.length ? [subhead("Weakest topics"), h("ul",{class:"small"}, weakest.map(([o,[g,m]])=>h("li",null, `${OBJECTIVES[o]}: ${Math.round(g/m*100)}% `, h("button",{class:"btn ghost small", onclick:()=>{ ui.exam = null; startQuiz(o, 15); }},"Quiz this"))))] : null,
    subhead("Review your answers"), h("div",{class:"review"}, E.items.map((it,k)=>it.pbq
      ? h("details",{class:"import"}, h("summary",null, `${k+1}. Lab: ${it.lab.title} (${Math.round(it.score*100)}%)`), it.view || h("p",{class:"small"},"Not opened during the exam."))
      : h("details",{class:"import"}, h("summary",null, `${k+1}. ${isRight(it.q, it.state.chosen) ? "✓" : "✕"} ${it.q.prompt.split("\n").pop().slice(0,90)}`), questionView(it.q, it.state).el))),
    h("div",{class:"row", style:"margin-top:12px"}, h("button",{class:"btn primary", onclick:()=>{ ui.exam = null; render(); }},"Done")));
}
/* ---- progress ---- */
function progressTab(){
  const P = store.progress, labsDone = Object.keys(P.labs).length, due = dueKeys().length, all = allLabEntries();
  const rows = CATEGORIES.map(c=>{
    const labsIn = all.filter(e=>e.cat===c.id && !e.gen), done = labsIn.filter(e=>passed(e.id)).length;
    return h("div",{class:"objgroup"}, h("div",{class:"objhead"}, h("span",{class:"dot", style:`background:${c.color}`}), h("b",null, c.name), h("span",{class:"small muted"}, labsIn.length ? `${done} of ${labsIn.length} labs passed` : "quiz only"),
        labsIn.length ? h("button",{class:"mini", style:"margin-left:auto", onclick:()=>{ ui.tab="labs"; ui.cat=c.id; render(); }},"See labs") : null),
      c.objs.map(o=>{ const m = mastery(o), n = P.obj[o] ? P.obj[o].n : 0;
        return h("div",{class:"objrow"}, h("span",{class:"onm"}, OBJECTIVES[o], h("span",{class:"small muted"}, n ? ` ${n} answers` : " not practiced")),
          h("span",{class:"bt"}, h("span",{class:"b "+band(m), style:`width:${m||0}%`})), h("span",{class:"bv"}, m==null?"–":m+"%"),
          h("span",{class:"oa"}, h("button",{class:"mini", onclick:()=>startQuiz(o, 10)},"Quiz"))); }));
  });
  return h("div",null,
    h("div",{class:"stats"}, stat(P.quiz.answered, "questions answered"), stat(P.quiz.answered ? Math.round(P.quiz.correct/P.quiz.answered*100)+"%" : "–", "quiz accuracy"), stat(labsDone, "labs tried"), stat(userLevel() ? levelName(userLevel()) : "All", "current level")),
    due ? h("div",{class:"row", style:"margin:4px 0 14px"}, h("button",{class:"btn primary", onclick:()=>startQuiz("due", Math.min(30, Math.max(10, due)))},`Review ${Math.min(30,due)} due items`)) : null,
    h("p",{class:"small muted"},"Mastery blends your recent quiz answers and lab scores for each topic, weighting recent results more. Green is 85% and up."),
    rows);
}
const stat = (v, l) => h("div",{class:"stat"}, h("b",null, String(v)), h("span",null, l));
