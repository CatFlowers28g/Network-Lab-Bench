/* ---------- step-by-step explanations: computed steps, sim hints, and optional AI walkthroughs ---------- */

"use strict";
const aiCache = new Map();
const L_ = i => String.fromCharCode(65+i);
function questionContext(q, chosen){
  return `Question (objective ${q.obj}): ${q.prompt}\nOptions:\n${q.options.map((o,i)=>`${L_(i)}. ${o}`).join("\n")}\nCorrect answer: ${q.answer.map(i=>`${L_(i)}. ${q.options[i]}`).join("; ")}\n` +
    (chosen && chosen.length ? `Learner chose: ${chosen.map(i=>`${L_(i)}. ${q.options[i]}`).join("; ")} (${isRight(q, chosen) ? "correct" : "incorrect"})\n` : "") + (q.explanation ? `Reference explanation: ${q.explanation}\n` : "");
}
function labTaskContext(t){
  const lab = ui.run && ui.run.lab;
  let body = "";
  if (t.type==="choice" || t.type==="cli"){ const q = t.type==="cli" ? t.question : t; body = `Question: ${q.prompt}\nOptions:\n${q.options.map((o,i)=>`${L_(i)}. ${o}`).join("\n")}\nCorrect answer: ${q.answer.map(i=>q.options[i]).join("; ")}\n`; if (t.type==="cli") body += `The learner investigated with commands such as: ${t.commands.slice(0,6).map(c=>c.cmd[0]).join(", ")}.\n`; }
  else if (t.type==="fill") body = `Configuration table (${t.columns.join(" | ")}), correct values:\n${t.rows.map(r=>r.map(c=>c && typeof c==="object" ? `[${[].concat(c.answer)[0]}]` : c).join(" | ")).join("\n")}\n`;
  else if (t.type==="match") body = `Correct matches:\n${t.items.map(i=>`${i.text} -> ${i.target}`).join("\n")}\n`;
  else if (t.type==="order") body = `Correct order:\n${t.items.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n`;
  return `${lab ? `Lab: ${lab.title}\nScenario: ${lab.scenario}\n${lab.exhibit ? "Exhibit:\n"+lab.exhibit+"\n" : ""}` : ""}Task: ${t.prompt||""}\n${body}${t.explanation ? "Reference explanation: "+t.explanation+"\n" : ""}`;
}
function simContext(lab, t, res, sol){
  return `Network lab: ${lab.title}\nScenario: ${lab.scenario}\nRequirements and the learner's result:\n${t.goals.map((g,i)=>`- ${g.label}: ${res && res[i] ? (res[i].pass ? "passed" : "FAILED ("+res[i].why+")") : "not graded"}`).join("\n")}\nOne configuration that satisfies every requirement (the answer key):\n${sol.map(s=>"- "+s).join("\n")}\n${t.explanation ? "Reference explanation: "+t.explanation+"\n" : ""}Explain how a technician would troubleshoot this step by step: which command to run on which device, what the output would reveal, and what to change, in the order they'd find it.`;
}
function aiExplainButton(getCtx){
  if (!platform.canAsk()) return null;
  const box = h("div",{class:"aiexp"});
  const show = r => put(box, h("b",null,"Step-by-step walkthrough"), stepsList(r.steps), r.tip ? h("p",{class:"small", style:"margin:6px 0 0"}, h("b",null,"Remember: "), r.tip) : null, h("p",{class:"small muted", style:"margin:6px 0 0"},"Written by AI from the answer key. If something looks off, trust the answer key and the simulator."));
  const btn = h("button",{class:"btn small", type:"button", onclick:async()=>{
    const ctx = getCtx(), key = hashStr(ctx);
    if (aiCache.has(key)) return show(aiCache.get(key));
    btn.disabled = true; btn.textContent = "Thinking…";
    try{
      const res = await platform.askJson(`You are a patient CompTIA Network+ (N10-009) tutor. Explain step by step how to reach the correct answer below.
The answer key is authoritative: explain why it is correct and never contradict it. If the learner chose a wrong option, explain specifically why that option is wrong.
Use 3 to 7 short steps in plain language, with concrete values, commands or rules where they help. Plain text only, no markdown.
Reply with only JSON: {"steps":["...","..."],"tip":"one short rule of thumb or memory aid"}

${ctx}`, {});
      const steps = Array.isArray(res && res.steps) ? res.steps.map(s=>String(s).slice(0,600)).filter(Boolean).slice(0,10) : [];
      if (!steps.length) throw {code:"invalid_json"};
      const r = {steps, tip:String(res.tip||"").slice(0,300)}; aiCache.set(key, r); show(r);
    }catch(e){ btn.disabled = false; btn.textContent = "Explain step by step"; box.append(h("p",{class:"small", style:"color:var(--bad);margin:6px 0 0"}, errorCopy(e && e.code))); }
  }}, "Explain step by step");
  box.append(btn); return box;
}
/* hint ladder widget shared by network and wireless sims */
function hintWidget(compute){
  let level = 0, key = "", used = 0;
  const box = h("div",{class:"hints"}), list = h("ol",{class:"hintlist"}), btn = h("button",{class:"btn small", type:"button"}, "Get a hint");
  btn.addEventListener("click", ()=>{
    const r = compute();
    if (r.done){ put(list, h("li",{class:"good"},"Every requirement passes now. Check your answers.")); btn.textContent = "Get a hint"; return; }
    const k = r.hints[r.hints.length-1];
    if (k!==key){ key = k; level = 0; }
    if (level < r.hints.length){ level++; used++; }
    put(list, ...r.hints.slice(0, level).map((x,i)=>h("li",null, h("b",null, ["Where to look: ","How to confirm: ","The fix: "][i] || ""), x)));
    btn.textContent = level < r.hints.length ? "Next hint" : (r.remaining>1 ? "Hint for the next problem" : "Check again");
    widget.used = used;
  });
  box.append(btn, list);
  const widget = {el:box, used:0, lock(){ btn.disabled = true; }};
  return widget;
}
