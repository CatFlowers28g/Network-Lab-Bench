/* Lab Bench wireless model. MIT License.
   Distances are meters on a floor plan. Signal is a simplified linear model: -35 dBm at the AP, about -75 dBm at the coverage edge. */

"use strict";
const WIFI_RANGE = {"2.4":{low:16, medium:26, high:36}, "5":{low:12, medium:19, high:27}, "6":{low:10, medium:16, high:22}};
const SEC_NAMES = {"open":"Open", "owe":"Enhanced Open (OWE)", "wep":"WEP", "wpa2-psk":"WPA2-Personal", "wpa2-ent":"WPA2-Enterprise", "wpa3-sae":"WPA3-Personal", "wpa3-ent":"WPA3-Enterprise"};
const DFS = ch => ch>=52 && ch<=144;
function wifiBlock(band, ch, width){
  ch = Number(ch); width = Number(width)||20;
  if (band==="2.4"){ const f = 2407 + 5*ch; return width>=40 ? [f-11, f+31] : [f-11, f+11]; }
  const base = band==="6" ? 1 : ch<100 ? 36 : ch<149 ? 100 : 149;
  const k = width/20, step = 4*k;
  const start = base + Math.floor((ch-base)/step)*step;
  const f0 = (band==="6" ? 5950 : 5000) + 5*start - 10;
  return [f0, f0 + width];
}
function apRange(ap, toward){
  const r = (WIFI_RANGE[ap.band]||WIFI_RANGE["2.4"])[ap.power||"medium"];
  if (ap.antenna==="directional"){
    if (!toward) return r*1.8;
    const ang = Math.atan2(toward.y-ap.y, toward.x-ap.x)*180/Math.PI;
    let diff = Math.abs(((ang - (Number(ap.heading)||0)) % 360 + 540) % 360 - 180);
    return diff <= 35 ? r*1.8*2.5 : r*0.35;
  }
  return r;
}
const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
function rssiAt(ap, pt){
  const d = dist(ap, pt), r = apRange(ap, pt);
  return Math.round(-35 - 40*(d/r) - (pt.walls||0));
}
function wifiOverlaps(t){
  const radios = [...t.aps.map(a=>({...a, own:true})), ...(t.neighbors||[]).map(n=>({...n, own:false}))].filter(a=>a.enabled!==false);
  const out = [];
  for (let i=0;i<radios.length;i++) for (let j=i+1;j<radios.length;j++){
    const a = radios[i], b = radios[j];
    if (!a.own && !b.own) continue;
    if (a.band!==b.band) continue;
    const hear = dist(a,b) < Math.max(apRange(a,b), apRange(b,a))*1.15;
    if (!hear) continue;
    const A = wifiBlock(a.band, a.channel, a.width), B = wifiBlock(b.band, b.channel, b.width);
    if (A[0] < B[1] && B[0] < A[1]){
      const co = Number(a.channel)===Number(b.channel) && Number(a.width||20)===Number(b.width||20);
      out.push({a, b, kind: co ? "co-channel" : "adjacent-channel"});
    }
  }
  return out;
}
function wifiAssociate(t, client, pt){
  pt = pt || client;
  const cands = t.aps.filter(ap=>ap.enabled!==false && (!client.ssid || ap.ssid===client.ssid) && (client.bands||["2.4","5"]).includes(ap.band) && (client.security||["wpa2-psk","wpa2-ent","wpa3-sae","wpa3-ent","open"]).includes(ap.security))
    .map(ap=>({ap, rssi:rssiAt(ap, pt)})).filter(x=>x.rssi>=-80);
  if (!cands.length) return null;
  cands.sort((a,b)=>b.rssi-a.rssi);
  const best = cands[0];
  const steer = cands.find(c=>c.ap.bandSteering && c.ap.band!=="2.4" && c.rssi>=-70);
  return steer && best.ap.band==="2.4" ? steer : best;
}
function wifiEval(t, g){
  const ov = wifiOverlaps(t);
  const C = id => (t.clients||[]).find(c=>c.id===id), A = id => t.aps.find(a=>a.id===id);
  switch (g.type){
    case "wifiClient": {
      const c = C(g.client); const as = wifiAssociate(t, c);
      if (!as) return {pass:false, why:`${c.name} can't find a compatible network (check SSID, band and security) in range`};
      const min = g.minRssi ?? -67;
      if (as.rssi < min) return {pass:false, why:`${c.name} connects to ${as.ap.name} at ${as.rssi} dBm, weaker than ${min} dBm`};
      const bad = ov.find(o=>o.a.id===as.ap.id || o.b.id===as.ap.id);
      if (bad) return {pass:false, why:`${as.ap.name} suffers ${bad.kind} interference from ${(bad.a.id===as.ap.id?bad.b:bad.a).name}`};
      if (g.band && as.ap.band!==g.band) return {pass:false, why:`${c.name} is on ${as.ap.band} GHz, not ${g.band} GHz`};
      return {pass:true, why:`${c.name} uses ${as.ap.name} on ${as.ap.band} GHz channel ${as.ap.channel} at ${as.rssi} dBm`};
    }
    case "wifiNoOverlap": return ov.length ? {pass:false, why: ov.map(o=>`${o.a.name} and ${o.b.name}: ${o.kind} interference (${o.a.band} GHz ch ${o.a.channel}/${o.a.width||20} vs ch ${o.b.channel}/${o.b.width||20})`).join("; ")} : {pass:true, why:"no overlapping channels"};
    case "wifiRoam": {
      const c = C(g.client);
      for (const p of c.path||[]){ const as = wifiAssociate(t, c, {x:p[0], y:p[1]}); if (!as || as.rssi < (g.minRssi ?? -70)) return {pass:false, why:`at (${p[0]} m, ${p[1]} m) ${c.name} ${as ? `only gets ${as.rssi} dBm` : "finds no usable network with the same SSID and security"}`}; }
      const ssids = new Set(t.aps.filter(a=>a.ssid===c.ssid).map(a=>a.security));
      if (ssids.size>1) return {pass:false, why:"APs broadcasting the same SSID use different security settings, which breaks roaming"};
      return {pass:true, why:`${c.name} stays connected along the whole route`};
    }
    case "wifiConfig": { const a = A(g.ap); const v = a[g.field]; const ok = [].concat(g.equals).map(String).map(pn).includes(pn(v)); return {pass:ok, why: ok ? "set correctly" : `${a.name} ${g.field} is ${v}`}; }
    case "wifiLink": { const a = A(g.a), b = A(g.b); const r1 = rssiAt(a, b), r2 = rssiAt(b, a), min = g.minRssi ?? -70; const ok = r1>=min && r2>=min && a.channel==b.channel && a.band===b.band; return {pass:ok, why: ok ? `bridge link at ${Math.min(r1,r2)} dBm` : a.band!==b.band || a.channel!=b.channel ? "both ends of a point-to-point link must use the same band and channel" : `the link only reaches ${Math.min(r1,r2)} dBm`}; }
    case "wifiNoDfs": { const bad = t.aps.filter(a=>a.band==="5" && DFS(Number(a.channel))); return bad.length ? {pass:false, why:`${bad.map(a=>`${a.name} (ch ${a.channel})`).join(", ")} use DFS channels that must vacate when radar is detected (802.11h)`} : {pass:true, why:"no DFS channels in use"}; }
  }
  return {pass:false, why:"unknown goal"};
}
function wifiAnalyzer(t, pt){
  const rows = [...t.aps, ...(t.neighbors||[])].filter(a=>a.enabled!==false).map(a=>({a, rssi:rssiAt(a, pt)})).filter(x=>x.rssi>=-90).sort((x,y)=>y.rssi-x.rssi);
  return "SSID              BSSID              Band   Ch   Width  Signal   Security\n" + rows.map(({a, rssi})=>`${(a.ssid||"(hidden)").padEnd(18)}${(a.bssid || macOf({id:a.id||a.name})).padEnd(19)}${(a.band+" GHz").padEnd(8)}${String(a.channel).padEnd(5)}${String((a.width||20)+" MHz").padEnd(7)}${String(rssi+" dBm").padEnd(9)}${SEC_NAMES[a.security]||a.security}${DFS(Number(a.channel)) && a.band==="5" ? "  (DFS)" : ""}`).join("\n");
}
function applyWifiSolution(t, steps){
  for (const s of steps||[]){ const a = t.aps.find(x=>x.id===s.ap); if (a && s.set) Object.assign(a, sclone(s.set)); }
  return t;
}
function checkWifiTask(t){
  const start = sclone(t), solved = applyWifiSolution(sclone(t), t.solution);
  const startRes = t.goals.map(g=>wifiEval(start, g)), res = t.goals.map(g=>wifiEval(solved, g));
  return {startAllPass:startRes.every(r=>r.pass), solvedAllPass:res.every(r=>r.pass), startRes, res};
}
function wifiSolutionText(t){
  return (t.solution||[]).map(s=>{ const a = t.aps.find(x=>x.id===s.ap); return `${a ? a.name : s.ap}: ` + Object.entries(s.set).map(([k,v])=>k==="security" ? `security ${SEC_NAMES[v]||v}` : k==="band" ? `band ${v} GHz` : k==="width" ? `channel width ${v} MHz` : `${k} ${v}`).join(", "); });
}
