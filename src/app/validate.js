/* ---------- validation (for generated and imported labs) ---------- */
"use strict";
const str = (v,max=4000) => typeof v==="string" ? v.slice(0,max) : (typeof v==="number" ? String(v) : "");
const strArr = (a,max=400) => Array.isArray(a) ? a.map(x=>str(x,max)).filter(x=>x.trim()) : [];
function vChoice(t){
  const options = strArr(t.options).slice(0,8);
  let ans = Array.isArray(t.answer) ? t.answer : [t.answer];
  ans = [...new Set(ans.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<options.length))];
  if (options.length<2 || !ans.length) return null;
  return {prompt:str(t.prompt,600)||"Choose the best answer.", options, answer:ans, multi:!!t.multi || ans.length>1};
}
function validateTask(t){
  if (!t || typeof t!=="object") return null;
  const base = {type:t.type, prompt:str(t.prompt,600), explanation:str(t.explanation,1500)};
  if (t.type==="choice"){ const c=vChoice(t); return c ? {...base,...c,type:"choice"} : null; }
  if (t.type==="net"){ let n=null; try{ n = validateNet(t); }catch(e){ n = null; } return n ? {...base,...n,type:"net"} : null; }
  if (t.type==="wifi"){ let n=null; try{ n = validateWifi(t); }catch(e){ n = null; } return n ? {...base,...n,type:"wifi"} : null; }
  if (t.type==="match"){
    const targets = [...new Set(strArr(t.targets,160))].slice(0,10);
    const items = (Array.isArray(t.items)?t.items:[]).map(i=>({text:str(i&&i.text,200), target:str(i&&i.target,160)})).filter(i=>i.text && targets.includes(i.target)).slice(0,14);
    return targets.length>=2 && items.length>=2 ? {...base,targets,items} : null;
  }
  if (t.type==="order"){ const items=strArr(t.items,300).slice(0,12); return items.length>=3 ? {...base,items} : null; }
  if (t.type==="fill"){
    const columns = strArr(t.columns,60).slice(0,8);
    let fields = 0;
    const rows = (Array.isArray(t.rows)?t.rows:[]).slice(0,20).map(r => (Array.isArray(r)?r:[]).slice(0,8).map(cell=>{
      if (cell && typeof cell==="object"){
        const answer = strArr(Array.isArray(cell.answer)?cell.answer:[cell.answer],120);
        if (!answer.length) return "";
        const options = strArr(cell.options,120).slice(0,12);
        fields++;
        if (options.length>=2 && options.some(o=>answer.map(norm).includes(norm(o)))) return {answer, options};
        return {answer};
      }
      return str(cell,200);
    }));
    return fields ? {...base,columns,rows} : null;
  }
  if (t.type==="cli"){
    const commands = (Array.isArray(t.commands)?t.commands:[]).map(c=>({cmd:strArr(Array.isArray(c&&c.cmd)?c.cmd:[c&&c.cmd],120), output:str(c&&c.output,6000), startsWith:str(c&&c.startsWith,60)})).filter(c=>c.cmd.length||c.startsWith).slice(0,30);
    const question = vChoice(t.question||{});
    if (!commands.length || !question) return null;
    const shell = ["windows","linux","cisco"].includes(t.shell)?t.shell:"windows";
    const promptText = str(t.promptText,40) || ({windows:"C:\\>",linux:"tech@host:~$",cisco:"Router#"})[shell];
    return {...base,shell,promptText,intro:str(t.intro,500),commands,question};
  }
  return null;
}
function validateLab(raw){
  if (!raw || typeof raw!=="object") throw new Error("That isn't a lab object.");
  const lab = {
    id: /^[A-Za-z0-9_-]{1,60}$/.test(raw.id||"") && !String(raw.id).startsWith("b-") && !String(raw.id).startsWith("gen-") ? raw.id : newId(),
    title: str(raw.title,120) || "Untitled lab",
    domain: DOMAIN_IDS.includes(raw.domain) ? raw.domain : "concepts",
    objective: str(raw.objective,120),
    objectives: strArr(raw.objectives,8).filter(o=>OBJECTIVES[o]).concat((str(raw.objective,8).match(/^\d\.\d/)||[]).filter(o=>OBJECTIVES[o])).filter((v,i,a)=>a.indexOf(v)===i),
    difficulty: [1,2,3].includes(Number(raw.difficulty)) ? Number(raw.difficulty) : 2,
    scenario: str(raw.scenario,2500), exhibit: str(raw.exhibit,8000), source:"mine", tasks:[]
  };
  for (const t of (Array.isArray(raw.tasks)?raw.tasks:[]).slice(0,6)){ const v=validateTask(t); if (v) lab.tasks.push(v); }
  if (!lab.tasks.length) throw new Error("The lab has no usable tasks.");
  return lab;
}
const safeValidate = r => { try { return validateLab(r); } catch(e){ return null; } };


/* ---- sims: keep the data, cap sizes, then let the engine prove it starts broken and the solution works ---- */
function capJson(o, depth){ if (depth>8) return null; if (Array.isArray(o)) return o.slice(0,60).map(x=>capJson(x, depth+1)); if (o && typeof o==="object"){ const r = {}; for (const [k,v] of Object.entries(o).slice(0,60)) if (!/^_/.test(k)) r[k.slice(0,40)] = capJson(v, depth+1); return r; } if (typeof o==="string") return o.slice(0,400); if (typeof o==="number" || typeof o==="boolean" || o===null) return o; return null; }
function validateNet(t){
  const devices = capJson(Array.isArray(t.devices) ? t.devices.slice(0,14) : [], 0).filter(d=>d && NET_KINDS.includes(d.kind) && /^[A-Za-z0-9_-]{1,30}$/.test(String(d.id)));
  const ids = new Set(devices.map(d=>d.id)); if (ids.size!==devices.length || devices.length<2) return null;
  devices.forEach(d=>{ d.name = str(d.name,30)||d.id; d.x = Math.max(0,Math.min(100,Number(d.x)||0)); d.y = Math.max(0,Math.min(100,Number(d.y)||0)); if (d.kind==="cloud") d.editable = false; });
  const links = (Array.isArray(t.links)?t.links:[]).slice(0,40).map(l=>Array.isArray(l) && l.length>=4 ? [str(l[0],30),str(l[1],30),str(l[2],30),str(l[3],30), l[4] && typeof l[4]==="object" ? capJson(l[4],0) : undefined].filter(x=>x!==undefined) : null).filter(l=>l && ids.has(l[0]) && ids.has(l[2]));
  const goals = capJson((Array.isArray(t.goals)?t.goals:[]).slice(0,10),0).filter(g=>g && ["ping","conn","dhcp","config","dns","perf","state"].includes(g.type)).map(g=>({...g, label:str(g.label,160)||"Requirement"}));
  const solution = capJson((Array.isArray(t.solution)?t.solution:[]).slice(0,24),0).filter(s=>s && (ids.has(s.dev) || Array.isArray(s.link)));
  if (!goals.length || !solution.length) return null;
  const out = {devices, links, goals, solution};
  const chk = checkNetTask(out);
  if (chk.startAllPass || !chk.solvedAllPass) return null;
  return out;
}
function validateWifi(t){
  const aps = capJson(Array.isArray(t.aps)?t.aps.slice(0,10):[],0).filter(a=>a && a.id && ["2.4","5","6"].includes(String(a.band)));
  aps.forEach(a=>{ a.band = String(a.band); a.name = str(a.name,30)||a.id; });
  const clients = capJson(Array.isArray(t.clients)?t.clients.slice(0,10):[],0).filter(c=>c && c.id);
  const neighbors = capJson(Array.isArray(t.neighbors)?t.neighbors.slice(0,6):[],0).filter(Boolean);
  const goals = capJson((Array.isArray(t.goals)?t.goals:[]).slice(0,8),0).filter(g=>g && /^wifi/.test(g.type)).map(g=>({...g, label:str(g.label,160)||"Requirement"}));
  const solution = capJson((Array.isArray(t.solution)?t.solution:[]).slice(0,12),0).filter(s=>s && s.ap && s.set);
  const floor = {w:Math.max(10,Math.min(200,Number(t.floor&&t.floor.w)||50)), h:Math.max(10,Math.min(150,Number(t.floor&&t.floor.h)||30))};
  if (!aps.length || !goals.length || !solution.length) return null;
  const out = {floor, aps, clients, neighbors, goals, solution};
  const chk = checkWifiTask(out);
  if (chk.startAllPass || !chk.solvedAllPass) return null;
  return out;
}
