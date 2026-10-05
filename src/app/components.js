/* ---------- task components ---------- */
"use strict";
function stepsList(steps){ return h("ol",{class:"steps"}, steps.map(s=>h("li",null,s))); }
function explainBox(t){
  if (!t.explanation && !t.steps) return null;
  return h("div",{class:"explain"}, h("b",null,"Why"), t.explanation || "", t.steps ? [h("b",{style:"margin-top:8px"},"Step by step"), stepsList(t.steps)] : null, aiExplainButton(()=>labTaskContext(t)));
}

function matchComp(t){
  const order = shuffle(t.items.map((_,i)=>i));
  const place = new Map(); let sel = null, locked = false;
  const el = h("div");
  function moveTo(target){ if (locked || sel==null) return; if (target==null) place.delete(sel); else place.set(sel, target); sel = null; draw(); }
  function chip(i){
    const it = t.items[i]; const placed = place.get(i);
    let cls = "chip" + (sel===i?" sel":"");
    let fix = null;
    if (locked){ const ok = placed===it.target; cls += ok?" ok":" no"; if (!ok) fix = h("span",{class:"fix"}, "Belongs in: "+it.target); }
    return h("button",{type:"button", class:cls, draggable:locked?"false":"true", "aria-pressed":sel===i?"true":"false",
      ondragstart:e=>{ sel=i; e.dataTransfer.setData("text/plain", String(i)); },
      onclick:e=>{ e.stopPropagation(); if (locked) return; sel = sel===i ? null : i; draw(); }}, it.text, fix);
  }
  function dropZone(node, target){
    node.addEventListener("dragover", e=>{ if (!locked){ e.preventDefault(); node.classList.add("over"); }});
    node.addEventListener("dragleave", ()=>node.classList.remove("over"));
    node.addEventListener("drop", e=>{ e.preventDefault(); node.classList.remove("over"); const i=Number(e.dataTransfer.getData("text/plain")); if (!Number.isNaN(i)){ sel=i; moveTo(target); }});
    node.addEventListener("click", ()=>moveTo(target));
    node.addEventListener("keydown", e=>{ if ((e.key==="Enter"||e.key===" ") && e.target===node){ e.preventDefault(); moveTo(target); }});
  }
  function draw(){
    const unplaced = order.filter(i=>!place.has(i));
    const pool = h("div",{class:"pool"+(sel!=null&&place.has(sel)?" target":""), tabindex:locked?null:"0", role:"button", "aria-label":"Unplaced items"},
      unplaced.length ? unplaced.map(chip) : h("span",{class:"small muted"}, locked ? "" : "All items placed. Tap one to move it."));
    dropZone(pool, null);
    const buckets = h("div",{class:"buckets"}, t.targets.map(tg=>{
      const b = h("div",{class:"bucket"+(sel!=null?" armed":""), tabindex:locked?null:"0", role:"button", "aria-label":"Place in "+tg},
        h("div",{class:"bl"}, tg), h("div",{class:"bc"}, order.filter(i=>place.get(i)===tg).map(chip)));
      dropZone(b, tg); return b;
    }));
    put(el, h("p",{class:"hint"}, locked ? "" : "Tap an item, then tap where it goes. You can also drag on a computer."), pool, buckets);
  }
  draw();
  return {el, grade(){
    locked=true; sel=null; draw(); this.misses=[]; this.hits=[];
    t.items.forEach((it,i)=>{ const key="m:"+t.prompt+":"+it.text;
      if (place.get(i)===it.target) this.hits.push(key);
      else this.misses.push({key, front:`${t.prompt}\n\n${it.text}`, back:it.target}); });
    return this.hits.length / t.items.length; }};
}

function orderComp(t){
  let arr = t.items.map((_,i)=>i);
  do { arr = shuffle(arr); } while (arr.every((v,i)=>v===i) && arr.length>1);
  let locked = false; const el = h("div");
  function mv(pos, d){ const j=pos+d; [arr[pos],arr[j]]=[arr[j],arr[pos]]; draw(); const b=el.querySelectorAll(".olist li")[j]?.querySelector(d<0?".up":".down"); (b && !b.disabled ? b : el.querySelectorAll(".olist li")[j]?.querySelector("button"))?.focus(); }
  function draw(){
    put(el, h("ol",{class:"olist"}, arr.map((idx,pos)=>h("li",{class:locked?(idx===pos?"ok":"no"):""},
      h("span",{class:"pos"}, pos+1),
      h("span",null, t.items[idx]),
      locked ? h("span") : h("span",{class:"mv"},
        h("button",{type:"button",class:"up","aria-label":"Move up",disabled:pos===0, onclick:()=>mv(pos,-1)},"↑"),
        h("button",{type:"button",class:"down","aria-label":"Move down",disabled:pos===arr.length-1, onclick:()=>mv(pos,1)},"↓"))))),
      locked && arr.some((v,i)=>v!==i) ? h("div",{class:"explain"}, h("b",null,"Correct order"), h("ol",{style:"margin:4px 0 0;padding-left:22px"}, t.items.map(x=>h("li",null,x)))) : null);
  }
  draw();
  return {el, grade(){
    locked=true; draw(); const ok=arr.filter((v,i)=>v===i).length, key="o:"+t.prompt;
    this.hits = ok===arr.length ? [key] : [];
    this.misses = ok===arr.length ? [] : [{key, front:t.prompt, back:t.items.map((x,i)=>`${i+1}. ${x}`).join("\n")}];
    return ok/arr.length; }};
}

function fillComp(t){
  const inputs = [];
  const table = h("table",{class:"cfg"},
    t.columns.length ? h("thead",null,h("tr",null,t.columns.map(c=>h("th",null,c)))) : null,
    h("tbody",null, t.rows.map((r,ri)=>h("tr",null, r.map((cell,ci)=>{
      if (cell && typeof cell==="object"){
        const lbl = (t.columns[ci]||"Answer") + (typeof r[0]==="string" ? " for "+r[0] : "");
        const ctrl = cell.options
          ? h("select",{"aria-label":lbl}, h("option",{value:""},"Select…"), cell.options.map(o=>h("option",{value:o},o)))
          : h("input",{type:"text","aria-label":lbl, autocomplete:"off", autocapitalize:"off", spellcheck:"false"});
        const td = h("td",null,ctrl); inputs.push({cell, ctrl, td, row:r, ri, ci}); return td;
      }
      return h("td",{class:"static"}, cell);
    })))));
  return {el:h("div",{class:"tablewrap"},table), grade(){
    let ok=0; this.misses=[]; this.hits=[];
    for (const f of inputs){
      const answers = [].concat(f.cell.answer).map(String);
      const good = answers.map(norm).includes(norm(f.ctrl.value));
      f.ctrl.disabled = true; f.td.className = good?"ok":"no";
      const key = `f:${t.prompt}:${f.ri}:${f.ci}`;
      if (good){ ok++; this.hits.push(key); }
      else {
        f.td.append(h("div",{class:"fix"}, answers.join(" or ")));
        const ctx = f.row.filter(c=>typeof c==="string" && c.trim()).join(" | ");
        const col = t.columns[f.ci] || "", ask = col && !/answer/i.test(col) ? col : "";
        this.misses.push({key, context:true, front:`${t.prompt}\n\n${[ctx, ask ? ask+"?" : ""].filter(Boolean).join("\n")}`, back:answers.join(" or ")});
      }
    }
    return ok/inputs.length;
  }};
}

function choiceComp(q, name){
  const multi = q.multi;
  const labels = q.options.map((o,i)=>h("label",{class:"opt"}, h("input",{type:multi?"checkbox":"radio", name, value:String(i)}), h("span",null,o)));
  const el = h("div",null, multi ? h("p",{class:"hint"},`Select ${q.answer.length}.`) : null, h("div",{class:"opts"}, labels));
  return {el, grade(){
    const chosen = labels.map((l,i)=>l.querySelector("input").checked?i:-1).filter(i=>i>=0);
    labels.forEach((l,i)=>{ l.querySelector("input").disabled=true; if (q.answer.includes(i)) l.classList.add("ok"); else if (chosen.includes(i)) l.classList.add("no"); });
    const right = chosen.length===q.answer.length && chosen.every(i=>q.answer.includes(i));
    const key = "c:"+q.prompt, L = i=>String.fromCharCode(65+i);
    this.hits = right ? [key] : [];
    this.misses = right ? [] : [{key, context:true, front:`${q.prompt}\n\n${q.options.map((o,i)=>`${L(i)}. ${o}`).join("\n")}`, back:q.answer.map(i=>`${L(i)}. ${q.options[i]}`).join("\n")}];
    return right ? 1 : 0;
  }};
}

function cliComp(t, name){
  const out = h("pre",{class:"out", tabindex:"0", "aria-label":"Terminal output"});
  if (t.intro) out.append(h("span",{class:"dim"}, t.intro+"\n\n"));
  out.append(h("span",{class:"dim"}, "Type help to list available commands.\n"));
  const history = []; let hi = 0;
  const input = h("input",{type:"text","aria-label":"Command", autocomplete:"off", autocapitalize:"off", spellcheck:"false", enterkeyhint:"go"});
  function run(raw){
    const cmd = raw.trim(); if (!cmd) return;
    history.push(cmd); hi = history.length;
    const n = norm(cmd);
    if (n==="clear" || n==="cls"){ put(out); return; }
    out.append(h("span",{class:"cmd"}, t.promptText+" "+cmd+"\n"));
    let res;
    if (n==="help" || n==="?") res = "Available commands:\n" + t.commands.map(c=>"  "+(c.cmd[0]||c.startsWith+"…")).join("\n");
    else {
      const hit = t.commands.find(c=>c.cmd.some(x=>norm(x)===n)) || t.commands.find(c=>c.startsWith && n.startsWith(norm(c.startsWith)));
      if (hit) res = hit.output;
      else if (t.shell==="cisco") res = "% Invalid input detected at '^' marker.";
      else if (t.shell==="linux") res = `${cmd.split(" ")[0]}: command not found (or not available in this lab)`;
      else res = `'${cmd.split(" ")[0]}' is not recognized in this lab. Type help to see what's available.`;
    }
    out.append(document.createTextNode(res+"\n\n"));
    out.scrollTop = out.scrollHeight;
  }
  input.addEventListener("keydown", e=>{
    if (e.key==="Enter"){ e.preventDefault(); run(input.value); input.value=""; }
    else if (e.key==="ArrowUp" && history.length){ e.preventDefault(); hi=Math.max(0,hi-1); input.value=history[hi]; }
    else if (e.key==="ArrowDown" && history.length){ e.preventDefault(); hi=Math.min(history.length,hi+1); input.value=history[hi]||""; }
  });
  const term = h("div",{class:"term"}, out, h("label",{class:"line"}, h("span",{class:"ps"}, t.promptText), input));
  const q = choiceComp(t.question, name);
  return {el:h("div",null, term, h("p",{class:"qlabel"}, t.question.prompt), q.el), grade(){ input.disabled=true; const r=q.grade(); this.misses=q.misses; this.hits=q.hits; return r; }};
}
