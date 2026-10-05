/* ---------- wireless lab UI ---------- */

"use strict";
const WIFI_CH = {"2.4":[1,2,3,4,5,6,7,8,9,10,11], "5":[36,40,44,48,52,56,60,64,100,104,108,112,116,120,124,128,132,136,140,144,149,153,157,161,165], "6":Array.from({length:59},(_,i)=>1+i*4)};
function wifiComp(t, lab, opts){
  opts = opts || {};
  const st = clone(t); let sel = (st.aps.find(a=>a.editable!==false)||st.aps[0]).id, locked = false;
  const W = 400, H = Math.round(400*st.floor.h/st.floor.w), sx = W/st.floor.w;
  const goalItems = st.goals.map(g=>h("li",null, h("span",{class:"gmark","aria-hidden":"true"}), h("span",null, g.label, h("span",{class:"gwhy"}))));
  const svgWrap = h("div",{class:"topo floor"}), panel = h("div",{class:"dpanel"}), solBox = h("div");
  const hue = a => a.band==="2.4" ? "var(--c-orange)" : a.band==="5" ? "var(--c-blue)" : "var(--c-green)";
  function draw(){
    const svg = sv("svg",{viewBox:`0 0 ${W} ${H}`, class:"topo-svg", role:"group","aria-label":"Floor plan"});
    svg.append(sv("rect",{x:1,y:1,width:W-2,height:H-2,class:"floor-bg"}));
    for (let m=10; m<st.floor.w; m+=10) svg.append(sv("line",{x1:m*sx, y1:0, x2:m*sx, y2:H, class:"grid"}));
    for (const n of st.neighbors||[]) svg.append(sv("circle",{cx:n.x*sx, cy:n.y*sx, r:apRange(n)*sx, class:"cov nb"}));
    for (const a of st.aps){ if (a.enabled===false) continue;
      if (a.antenna==="directional"){ const r = apRange(a,{x:a.x+Math.cos((a.heading||0)*Math.PI/180), y:a.y+Math.sin((a.heading||0)*Math.PI/180)})*sx, h0 = (a.heading||0)*Math.PI/180;
        const p = (ang) => `${a.x*sx + r*Math.cos(h0+ang)} ${a.y*sx + r*Math.sin(h0+ang)}`;
        svg.append(sv("path",{d:`M${a.x*sx} ${a.y*sx} L${p(-0.61)} A${r} ${r} 0 0 1 ${p(0.61)} Z`, class:"cov", style:`fill:${hue(a)};stroke:${hue(a)}`}));
      } else svg.append(sv("circle",{cx:a.x*sx, cy:a.y*sx, r:apRange(a)*sx, class:"cov", style:`fill:${hue(a)};stroke:${hue(a)}`}));
    }
    for (const c of st.clients||[]){
      if (c.path) svg.append(sv("polyline",{points:c.path.map(p=>`${p[0]*sx},${p[1]*sx}`).join(" "), class:"path"}));
      svg.append(sv("g",{transform:`translate(${c.x*sx} ${c.y*sx})`, class:"dev client"+(sel===c.id?" sel":""), tabindex:"0", role:"button","aria-label":`${c.name}, wireless client`, onclick:()=>{ sel=c.id; draw(); drawPanel(); }, onkeydown:e=>{ if (e.key==="Enter"){ sel=c.id; draw(); drawPanel(); } }},
        sv("circle",{r:12,class:"hit"}), sv("rect",{x:-5,y:-8,width:10,height:16,rx:2,class:"ic"}), sv("text",{y:20,class:"dl","text-anchor":"middle"}, c.name)));
    }
    for (const a of st.aps) svg.append(sv("g",{transform:`translate(${a.x*sx} ${a.y*sx})`, class:"dev"+(sel===a.id?" sel":"")+(a.enabled===false?" off":""), tabindex:"0", role:"button","aria-label":`${a.name}, access point, ${a.band} GHz channel ${a.channel}`, onclick:()=>{ sel=a.id; draw(); drawPanel(); }, onkeydown:e=>{ if (e.key==="Enter"){ sel=a.id; draw(); drawPanel(); } }},
      sv("circle",{r:14,class:"hit"}), ...devIcon("ap"), sv("text",{y:22,class:"dl","text-anchor":"middle"}, `${a.name} ch${a.channel}`)));
    put(svgWrap, svg);
  }
  function drawPanel(){
    const a = st.aps.find(x=>x.id===sel), c = (st.clients||[]).find(x=>x.id===sel);
    if (c){
      const as = wifiAssociate(st, c);
      put(panel, h("div",{class:"dhead"}, h("h3",null, c.name), h("span",{class:"small muted"},"Wireless client")),
        h("p",{class:"small"}, `Supports ${c.bands.map(b=>b+" GHz").join(", ")}; security ${c.security.map(s=>SEC_NAMES[s]||s).join(", ")}; wants SSID "${c.ssid}".`),
        h("p",{class:"small"}, as ? `Connected to ${as.ap.name} on ${as.ap.band} GHz channel ${as.ap.channel} at ${as.rssi} dBm.` : "Not connected: no compatible network in range."),
        subhead("Wi-Fi analyzer at this spot"), h("pre",{class:"exhibit"}, wifiAnalyzer(st, c)));
      return;
    }
    const dis = locked || a.editable===false, r = () => { draw(); drawPanel(); };
    const ch = WIFI_CH[a.band] || WIFI_CH["2.4"];
    put(panel, h("div",{class:"dhead"}, h("h3",null, a.name), h("span",{class:"small muted"}, "Access point" + (a.editable===false ? ", locked" : ""))),
      kvRows([
        ["Enabled", fld(a,"enabled",{disabled:dis, check:true, label:"Radio enabled", redraw:r})],
        ["Band", fld(a,"band",{disabled:dis, label:"Band", options:[["2.4","2.4 GHz"],["5","5 GHz"],["6","6 GHz"]], redraw:()=>{ const list = WIFI_CH[a.band]; if (!list.includes(Number(a.channel))) a.channel = list[0]; r(); }})],
        ["Channel", fld(a,"channel",{disabled:dis, label:"Channel", options:ch.map(x=>[x, String(x)+(a.band==="5" && DFS(x) ? " (DFS)" : "")]), redraw:r})],
        ["Channel width", fld(a,"width",{disabled:dis, label:"Channel width", options:[[20,"20 MHz"],[40,"40 MHz"],[80,"80 MHz"],[160,"160 MHz"]], redraw:r})],
        ["Transmit power", fld(a,"power",{disabled:dis, label:"Transmit power", options:[["low","Low"],["medium","Medium"],["high","High"]], redraw:r})],
        ["SSID", fld(a,"ssid",{disabled:dis, label:"SSID", onChange:()=>draw()})],
        ["Security", fld(a,"security",{disabled:dis, label:"Security", options:Object.entries(SEC_NAMES), redraw:r})],
        ["Captive portal", fld(a,"captivePortal",{disabled:dis, check:true, label:"Captive portal", redraw:r})],
        ["Band steering", fld(a,"bandSteering",{disabled:dis, check:true, label:"Band steering", redraw:r})],
        ["Antenna", fld(a,"antenna",{disabled:dis, label:"Antenna", options:[["omni","Omnidirectional"],["directional","Directional"]], redraw:r})],
        a.antenna==="directional" ? ["Aim (degrees, 0 = east)", fld(a,"heading",{disabled:dis, label:"Heading", options:[[0,"0 (east)"],[90,"90 (south)"],[180,"180 (west)"],[270,"270 (north)"]], redraw:r})] : null]),
      h("p",{class:"small muted"}, `Coverage radius about ${Math.round(apRange(a))} m. Tap a client to see what a Wi-Fi analyzer reads there.`));
  }
  draw(); drawPanel();
  const hints = opts.exam ? null : hintWidget(()=>wifiHints(t, st));
  const el = h("div",{class:"sim"}, subhead("Requirements"), h("ul",{class:"goals"}, goalItems), hints ? hints.el : null, svgWrap,
    h("div",{class:"legend small muted"}, h("span",{class:"lg b24"},"2.4 GHz"), h("span",{class:"lg b5"},"5 GHz"), h("span",{class:"lg b6"},"6 GHz"), (st.neighbors||[]).length ? h("span",{class:"lg nb"},"neighbor networks") : null, ` Grid lines every 10 m.`),
    panel, solBox);
  return {el, grade(){
    locked = true; if (hints){ hints.lock(); this.hintsUsed = hints.used; } const res = st.goals.map(g=>wifiEval(st, g)); this.results = res;
    res.forEach((r,i)=>{ goalItems[i].className = r.pass ? "ok" : "no"; goalItems[i].querySelector(".gwhy").textContent = r.pass ? "" : ": "+r.why; });
    draw(); drawPanel();
    const sol = wifiSolutionText(t);
    put(solBox, h("div",{class:"explain"}, h("b",null,"One configuration that works"), h("ul",{style:"margin:4px 0 0;padding-left:20px"}, sol.map(s=>h("li",null,s))), opts.exam ? null : aiExplainButton(()=>simContext(lab, t, res, sol))));
    this.hits = []; this.misses = [];
    st.goals.forEach((g,i)=>{ const key = "w:"+g.label; if (res[i].pass) this.hits.push(key); else this.misses.push({key, context:true, front:`Wireless lab: "${g.label}" failed. What fixes it?`, back:`Symptom: ${res[i].why}.\nFix: ${sol.join("; ")}`}); });
    return res.filter(r=>r.pass).length/res.length;
  }};
}
