/* ---------- storage: browser always, plus Claude cloud sync when available ---------- */

"use strict";
const store = {
  uid:null, progress:{labs:{}, obj:{}, srs:{}, lastExport:0, exams:[], quiz:{answered:0, correct:0}}, custom:[], cards:{}, q:Promise.resolve(),
  loadLocal(){
    try{
      const p = JSON.parse(localStorage.getItem("labbench.progress")||"null"); if (p && p.labs) this.progress = Object.assign(this.progress, p);
      const c = JSON.parse(localStorage.getItem("labbench.custom")||"null"); if (Array.isArray(c)) this.custom = c.map(safeValidate).filter(Boolean);
      const k = JSON.parse(localStorage.getItem("labbench.cards")||"null"); if (k && typeof k==="object") this.cards = k;
    }catch(e){}
  },
  saveLocal(){ try{ localStorage.setItem("labbench.progress",JSON.stringify(this.progress)); localStorage.setItem("labbench.custom",JSON.stringify(this.custom)); localStorage.setItem("labbench.cards",JSON.stringify(this.cards)); }catch(e){} },
  enqueue(fn){ this.q = this.q.then(fn).catch(e=>console.warn("Sync failed", e)); return this.q; },
  get db(){ return platform.db && this.uid ? platform.db : null; },
  pref(){ return platform.db.doc(`data/users/${this.uid}/progress`); },
  async connect(){
    if (!platform.db || !platform.user) return;
    try{
      const uid = await platform.user.id(); if (!uid) return; this.uid = uid;
      const pref = this.pref();
      const [snap, labsSnap, cardsSnap] = await Promise.all([pref.get(), pref.collection("labs").limit(1000).get(), pref.collection("cards").limit(1000).get()]);
      const cloud = snap.exists ? (snap.data()||{}) : {};
      this.progress = mergeProgress(cloud, this.progress);
      const cloudLabs = labsSnap.docs.map(d=>{ const b = d.data(); const l = b && safeValidate(b.lab); if (l){ l.id = d.id; l.createdAt = b.createdAt; } return l; }).filter(Boolean);
      const ids = new Set(cloudLabs.map(l=>l.id)); const localOnly = this.custom.filter(l=>!ids.has(l.id));
      this.custom = [...cloudLabs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)), ...localOnly];
      const cc = {}; for (const d of cardsSnap.docs){ const b = d.data(); if (b && b.front) cc[d.id] = {...b}; }
      const push = []; for (const [id,c] of Object.entries(this.cards)) if (!cc[id] || (c.updatedAt||0) > (cc[id].updatedAt||0)){ cc[id] = c; push.push(id); }
      this.cards = cc;
      this.saveLocal();
      this.saveProgress();
      for (const l of localOnly) this.enqueue(()=>pref.collection("labs").doc(l.id).set({lab:clone(l), createdAt:l.createdAt||Date.now()}));
      this.pushCards(push);
      if (ui.view==="home") render();
    }catch(e){ console.warn("Sync unavailable", e); this.uid = null; }
  },
  saveProgress(){ this.saveLocal(); if (this.db){ const data = clone(this.progress); this.enqueue(()=>this.pref().set(data)); } },
  objPush(o, v){ if (!OBJECTIVES[o]) return; const r = this.progress.obj[o] = this.progress.obj[o] || {hist:[], n:0}; r.hist.push(Math.round(v*100)/100); if (r.hist.length>30) r.hist = r.hist.slice(-30); r.n++; },
  recordLab(lab, score){
    const r = this.progress.labs[lab.id] || {attempts:0, best:0};
    this.progress.labs[lab.id] = {attempts:r.attempts+1, best:Math.max(r.best||0,score), last:score, at:Date.now(), domain:lab.domain};
    for (const o of labObjectives(lab)){ this.objPush(o, score/100); this.objPush(o, score/100); }
    this.saveProgress();
  },
  recordQuestion(q, correct, noSave){
    this.objPush(q.obj, correct?1:0);
    this.progress.quiz.answered++; if (correct) this.progress.quiz.correct++;
    if (q.key) this.progress.srs[q.key] = srsUpdate(this.progress.srs[q.key], correct, Date.now());
    if (!noSave) this.saveProgress();
  },
  recordExam(rec){ this.progress.exams = [rec, ...(this.progress.exams||[])].slice(0,20); this.saveProgress(); },
  addLab(lab){ lab.createdAt = Date.now(); this.custom.unshift(lab); this.saveLocal(); if (this.db) this.enqueue(()=>this.pref().collection("labs").doc(lab.id).set({lab:clone(lab), createdAt:lab.createdAt})); },
  deleteLab(id){ this.custom = this.custom.filter(l=>l.id!==id); delete this.progress.labs[id]; this.saveProgress(); if (this.db) this.enqueue(()=>this.pref().collection("labs").doc(id).delete()); },
  pushCards(ids){ if (!this.db) return; for (const id of ids){ const c = this.cards[id], ref = this.pref().collection("cards").doc(id), data = c ? clone(c) : null; this.enqueue(()=> data ? ref.set(data) : ref.delete()); } },
  trackCards(src, misses, hits){
    const now = Date.now(), changed = [];
    for (const m of misses){
      const id = "k"+hashStr(src.id+"|"+m.key), c = this.cards[id];
      if (c){ c.misses++; c.streak = 0; c.lastMissed = now; c.updatedAt = now; if (!c.improved){ c.front = m.front; c.back = m.back; c.extra = m.extra; c.context = m.context; } }
      else this.cards[id] = {id, labId:src.id, labTitle:src.title, domain:src.domain, objective:m.obj || (labObjectives(src)[0]||""), context:m.context||"", front:m.front, back:m.back, extra:m.extra||"", misses:1, streak:0, lastMissed:now, updatedAt:now, improved:false};
      changed.push(id);
    }
    for (const key of hits){ const id = "k"+hashStr(src.id+"|"+key), c = this.cards[id]; if (c){ c.streak = (c.streak||0)+1; c.updatedAt = now; changed.push(id); } }
    const all = Object.values(this.cards);
    if (all.length > 900){ all.sort((a,b)=>(b.streak||0)-(a.streak||0) || a.lastMissed-b.lastMissed); for (const c of all.slice(0, all.length-900)){ delete this.cards[c.id]; changed.push(c.id); } }
    this.saveLocal(); this.pushCards([...new Set(changed)]);
  },
  updateCards(list){ const now = Date.now(); for (const c of list){ c.updatedAt = now; this.cards[c.id] = c; } this.saveLocal(); this.pushCards(list.map(c=>c.id)); },
  removeCard(id){ delete this.cards[id]; this.saveLocal(); this.pushCards([id]); },
  exportAll(){ return JSON.stringify({app:"lab-bench", version:1, exportedAt:new Date().toISOString(), progress:this.progress, custom:this.custom, cards:this.cards}, null, 1); },
  importAll(text){
    const d = JSON.parse(text); if (!d || d.app!=="lab-bench") throw new Error("That file isn't a Lab Bench backup.");
    this.progress = mergeProgress(d.progress||{}, this.progress);
    const ids = new Set(this.custom.map(l=>l.id)); for (const l of (d.custom||[]).map(safeValidate).filter(Boolean)) if (!ids.has(l.id)) this.custom.push(l);
    for (const [id,c] of Object.entries(d.cards||{})) if (!this.cards[id] || (c.updatedAt||0) > (this.cards[id].updatedAt||0)) this.cards[id] = c;
    this.saveProgress(); this.pushCards(Object.keys(d.cards||{}));
  },
  resetAll(){ this.progress = {labs:{}, obj:{}, srs:{}, lastExport:0, exams:[], quiz:{answered:0, correct:0}, prefs:this.progress.prefs || {level:0, path:[], at:0}}; this.cards = {}; this.saveProgress(); }
};
function mergeProgress(a, b){
  const out = {labs:{}, obj:{}, srs:{}, lastExport:Math.max(a.lastExport||0, b.lastExport||0), exams:[], quiz:{answered:0, correct:0}};
  for (const src of [a,b]) for (const [id,r] of Object.entries(src.labs||{})) if (!out.labs[id] || (r.attempts||0) > (out.labs[id].attempts||0)) out.labs[id] = r;
  for (const src of [a,b]) for (const [o,r] of Object.entries(src.obj||{})) if (!out.obj[o] || (r.n||0) > (out.obj[o].n||0)) out.obj[o] = r;
  for (const src of [a,b]) for (const [k,r] of Object.entries(src.srs||{})) if (!out.srs[k] || (r.seen||0) > (out.srs[k].seen||0)) out.srs[k] = r;
  const ex = new Map(); for (const src of [a,b]) for (const e of src.exams||[]) ex.set(e.at, e); out.exams = [...ex.values()].sort((x,y)=>y.at-x.at).slice(0,20);
  for (const src of [a,b]) if (src.quiz && (src.quiz.answered||0) > out.quiz.answered) out.quiz = {...src.quiz};
  const pa = a.prefs, pb = b.prefs;
  out.prefs = pa && pb ? ((pa.at||0) > (pb.at||0) ? pa : pb) : (pa || pb || {level:0, path:[], at:0});
  return out;
}
/* ---- mastery ---- */
function mastery(o){
  const r = store.progress.obj[o]; if (!r || !r.hist.length) return null;
  const h = r.hist.slice(-20); let w = 0, s = 0; h.forEach((v,i)=>{ const wt = 1 + i/h.length; w += wt; s += v*wt; });
  return Math.round(s/w*100);
}
function domainMastery(d){
  const os = Object.keys(OBJECTIVES).filter(o=>DOMAIN_OF(o)===d), vals = os.map(mastery).filter(v=>v!=null);
  if (!vals.length) return null;
  return Math.round(os.reduce((s,o)=>s + (mastery(o) ?? 0), 0) / os.length);
}
function labObjectives(lab){ const o = (lab.objectives && lab.objectives.length ? lab.objectives : [String(lab.objective||"").match(/^\d\.\d/)?.[0]]).filter(x=>x && OBJECTIVES[x]); return o.length ? o : [{concepts:"1.1",implementation:"2.2",operations:"3.4",security:"4.3",troubleshooting:"5.3"}[lab.domain]]; }
