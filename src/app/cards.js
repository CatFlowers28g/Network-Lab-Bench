/* ---------- flashcards ---------- */
"use strict";
const ERR_COPY = {
  cancelled:"Stopped.",
  not_granted:"Claude access wasn't allowed for this page, so this feature is off here.",
  sampling_disabled:"Claude isn't available for this account, so this feature is off here.",
  rate_limited:"You've hit a usage limit. Try again in a little while.",
  invalid_json:"The response wasn't in the expected format. Try again, or ask for less at once.",
  refused:"Claude declined that request. Try a different topic.",
  session_expired:"Your session expired. Sign in to Claude again, then retry.",
  empty_completion:"Nothing came back. Try again with a simpler request.",
  no_key:"Add your Anthropic API key in Settings to use AI features.",
  bad_key:"The API key was rejected. Check it in Settings.",
  network:"Couldn't reach the API. Check your connection."
};
const errorCopy = code => ERR_COPY[code] || "Something went wrong reaching Claude. Try again.";
const ankiEsc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\t/g," ").replace(/\r?\n/g,"<br>");
function cardPriority(c){ const avg = domainMastery(c.domain) ?? 50; return (c.misses||0)*2 - (c.streak||0)*3 + (100-avg)/25; }
const cardCat = c => catOfObj(c.objective) || (LAB_META[c.labId] && LAB_META[c.labId].cat) || "troubleshooting";
function cardList(){
  let list = Object.values(store.cards).filter(c => !ui.cat || cardCat(c)===ui.cat);
  if (ui.cards.mode==="weak") list = list.filter(c => !(c.streak>0));
  if (ui.cards.mode==="new") list = list.filter(c => (c.updatedAt||0) > (store.progress.lastExport||0));
  return list.sort((a,b) => cardPriority(b)-cardPriority(a) || (b.lastMissed||0)-(a.lastMissed||0));
}
function ankiText(list){
  const lines = ["#separator:Tab","#html:true","#notetype:Basic","#deck:Network+ Weak Spots","#guid column:1","#tags column:4"];
  for (const c of list){
    const front = (c.context ? `<div style="font-size:0.85em;opacity:0.75">${ankiEsc(c.context)}</div><br>` : "") + ankiEsc(c.front);
    const back = ankiEsc(c.back) + (c.extra ? `<br><br><div style="font-size:0.85em">${ankiEsc(c.extra)}</div>` : "")
      + `<br><div style="font-size:0.75em;opacity:0.6">Network Lab Bench: ${ankiEsc(c.labTitle)}${c.objective ? ", "+ankiEsc(c.objective) : ""}</div>`;
    const obj = String(c.objective||"").match(/^\d\.\d+/);
    const tags = ["NetPlus", "NetPlus::"+dom(c.domain).name.replace(/\s+/g,"_"), obj ? "NetPlus::Obj_"+obj[0] : ""].filter(Boolean).join(" ");
    lines.push([c.id, front, back, tags].join("\t"));
  }
  return lines.join("\n") + "\n";
}
function markExported(){ store.progress.lastExport = Date.now(); store.saveProgress(); }
async function exportAnki(list){
  const C = ui.cards, text = ankiText(list);
  C.err = false;
  if (platform.downloads || !platform.inClaude){
    try{
      await platform.saveFile("network-plus-weak-spots.txt", text);
      C.status = `Saved ${list.length} card${list.length===1?"":"s"}. Import the file into Anki.`; markExported();
    }catch(e){
      const code = e && e.code;
      if (code==="declined") C.status = "Export cancelled.";
      else if (code==="rate_limited"){ C.status = "A save prompt is already open."; C.err = true; }
      else { C.fallback = text; C.status = ""; }
    }
  } else C.fallback = text;
  render();
}
function copyFallback(){
  const C = ui.cards, ta = document.querySelector(".fallback textarea");
  const done = () => { C.status = "Copied. Paste it into a .txt file and import it into Anki."; markExported(); const s=document.querySelector(".cards-status"); if (s) s.textContent = C.status; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(C.fallback).then(done, ()=>{ if (ta){ ta.focus(); ta.select(); } });
  else if (ta){ ta.focus(); ta.select(); }
}
async function improveCards(list){
  const C = ui.cards;
  if (!platform.canAsk() || C.busy) return;
  const batch = list.filter(c => !c.improved).slice(0,15);
  if (!batch.length) return;
  const payload = batch.map(c => ({id:c.id, lab:c.labTitle, context:(c.context||"").slice(0,700), question:c.front, answer:c.back, explanation:(c.extra||"").slice(0,700)}));
  C.busy = true; C.err = false; C.status = "Rewriting cards… this usually takes 20 to 40 seconds."; C.ctl = new AbortController(); render();
  try{
    const res = await platform.askJson(`You turn missed CompTIA Network+ (N10-009) practice-lab items into high-quality Anki flashcards.
For each input card write:
- front: one clear, self-contained question of at most about 35 words. Fold in whatever facts from "context" are needed so it makes sense with no lab in front of you. Never say "the scenario", "the table", "the exhibit" or "the lab". Prefer asking about the underlying concept, e.g. "Which default port does SNMP use for polling?".
- back: the concise correct answer, a few words up to one sentence.
- extra: 1-2 sentences on why, including the key distinction from the tempting wrong answer.
Every fact must be accurate for N10-009. If an original answer is wrong, correct it and begin extra with "Corrected:".
Reply with only JSON: {"cards":[{"id":"same id as the input","front":"...","back":"...","extra":"..."}]}

Input cards:
${JSON.stringify(payload)}`, {signal:C.ctl.signal});
    const arr = Array.isArray(res) ? res : (res && Array.isArray(res.cards) ? res.cards : []);
    const upd = [];
    for (const r of arr){
      const c = r && store.cards[r.id]; if (!c) continue;
      const f = str(r.front,600), b = str(r.back,400); if (!f.trim() || !b.trim()) continue;
      upd.push({...c, front:f, back:b, extra:str(r.extra,800) || c.extra, context:"", improved:true});
    }
    store.updateCards(upd);
    C.status = upd.length ? `Rewrote ${upd.length} card${upd.length===1?"":"s"}.` : "No usable rewrites came back. Try again.";
    C.err = !upd.length;
  }catch(e){
    const code = e && e.code; C.err = code!=="cancelled"; C.status = errorCopy(code);
  }finally{ C.busy = false; C.ctl = null; if (ui.view==="home") render(); }
}
function cardsTab(){
  const C = ui.cards, list = cardList(), total = Object.keys(store.cards).length;
  const head = h("p",{class:"small muted"},"Every item you miss in a lab becomes a flashcard here, weakest first. Export them to Anki to drill between labs. Cards you later get right move down the list.");
  if (!total) return h("div",null, head, h("div",{class:"list"}, h("div",{class:"empty"},"No cards yet. Miss something in a lab and it shows up here.")));
  const sel = (val, opts, on, label) => h("select",{"aria-label":label, onchange:e=>{on(e.target.value); C.showAll=false; render();}}, opts.map(([v,t])=>h("option",{value:v, selected:v===val},t)));
  const filters = h("div",{class:"filters"},
    sel(ui.cat||"all", [["all","All topics"],...CATEGORIES.map(c=>[c.id,c.name])], v=>ui.cat=v==="all"?null:v, "Topic"),
    sel(C.mode, [["weak","Still weak"],["new","New since last export"],["all","All cards"]], v=>C.mode=v, "Which cards"));
  const unimproved = list.filter(c=>!c.improved).length;
  const actions = h("div",{class:"row"},
    h("button",{class:"btn primary", disabled:!list.length || C.busy, onclick:()=>exportAnki(list)}, `Export ${list.length} to Anki`),
    platform.canAsk() && unimproved ? h("button",{class:"btn", disabled:C.busy, onclick:()=>improveCards(list)}, C.busy ? "Rewriting…" : `Rewrite ${Math.min(unimproved,15)} with Claude`) : null,
    C.busy ? h("button",{class:"btn", onclick:()=>C.ctl && C.ctl.abort()},"Stop") : null);
  const fb = C.fallback ? h("div",{class:"form fallback", style:"margin-top:10px"},
    h("p",{class:"small", style:"margin:0"},"Downloads aren't available in this view. Copy this text into a file ending in .txt, then import it into Anki."),
    h("textarea",{readonly:true,"aria-label":"Anki import text"}, C.fallback),
    h("div",{class:"row"}, h("button",{class:"btn", onclick:copyFallback},"Copy text"), h("button",{class:"btn ghost", onclick:()=>{C.fallback=""; render();}},"Close"))) : null;
  const shown = C.showAll ? list : list.slice(0,40);
  const rows = shown.map(c => h("article",{class:"fcard", style:`border-left-color:${cat(cardCat(c)).color}`},
    h("div",{class:"cf"}, c.front), h("div",{class:"cb"}, c.back),
    h("div",{class:"cm"}, h("span",null, `${cat(cardCat(c)).name}, missed ${c.misses}×${c.streak?`, right ${c.streak}× since`:""}${c.improved?", rewritten":""}`),
      h("button",{class:"btn ghost", "aria-label":"Remove this card", onclick:()=>{ store.removeCard(c.id); render(); }},"Remove"))));
  const more = !C.showAll && list.length>40 ? h("button",{class:"btn ghost", onclick:()=>{C.showAll=true; render();}}, `Show all ${list.length}`) : null;
  const howto = h("details",{class:"import"}, h("summary",null,"How to import into Anki"),
    h("p",{class:"small", style:"margin-top:8px"},"On a computer: in Anki choose File, then Import, and pick the downloaded .txt file. Everything is preset: Basic note type, a deck named Network+ Weak Spots, and tags for each domain and objective."),
    h("p",{class:"small"},"On a phone: recent AnkiMobile and AnkiDroid versions can import text files from your Files app too. If yours can't, import on a computer and sync."),
    h("p",{class:"small"},"Exporting again is safe. Each card has a stable ID, so re-importing updates existing cards instead of duplicating them."));
  return h("div",null, head, filters, actions, h("div",{class:"status cards-status"+(C.err?" err":""), role:"status"}, C.status), fb,
    h("div",{class:"cards"}, rows.length ? rows : h("div",{class:"list"}, h("div",{class:"empty"},"No cards match these filters."))), more, howto);
}
