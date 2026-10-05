"use strict";
/* Lab Bench simulation engine: core (addressing, physical layer, STP, LACP, PoE, layer 2).
   MIT License. Plain functions on purpose: this file is concatenated into the app and into the Node test bundle. */

const HOST_KINDS = ["pc","laptop","server","printer","phone","ap"];
const SWITCH_KINDS = ["switch","l3switch"];
const ROUTER_KINDS = ["router","firewall","natgw","igw"];
const NET_KINDS = [...HOST_KINDS, ...SWITCH_KINDS, ...ROUTER_KINDS, "cloud"];
const isHost = d => !!d && HOST_KINDS.includes(d.kind);
const isSwitch = d => !!d && SWITCH_KINDS.includes(d.kind);
const isRouterLike = d => !!d && (ROUTER_KINDS.includes(d.kind) || d.kind==="l3switch");
const pn = s => String(s ?? "").trim().toLowerCase();
const cn = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g," ");
const vnum = v => { const n = parseInt(v,10); return Number.isFinite(n) ? n : null; };
const sclone = o => JSON.parse(JSON.stringify(o));

/* ---- IPv4 ---- */
function ipToInt(s){
  const m = String(s ?? "").trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number); if (o.some(x=>x>255)) return null;
  return ((o[0]<<24)>>>0) + (o[1]<<16) + (o[2]<<8) + o[3];
}
const intToIp = n => [n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join(".");
const mInt = n => n===0 ? 0 : (0xFFFFFFFF << (32-n))>>>0;
function maskLen(s){
  s = String(s ?? "").trim();
  if (/^\/?\d{1,2}$/.test(s)){ const n = Number(s.replace("/","")); return n>=0 && n<=32 ? n : null; }
  const v = ipToInt(s); if (v==null) return null;
  let n = 0; while (n<32 && ((v>>>(31-n)) & 1)) n++;
  return mInt(n)===v ? n : null;
}
const netOf = (ip,n) => (ip & mInt(n))>>>0;
const bcastOf = (ip,n) => (netOf(ip,n) | (~mInt(n)>>>0))>>>0;
const inNet = (a,b,n) => netOf(a,n)===netOf(b,n);
function parseCidr(s){
  s = String(s ?? "").trim().toLowerCase();
  if (s==="any" || s==="0.0.0.0/0" || s==="") return {ip:0, n:0};
  if (s.startsWith("host ")) s = s.slice(5).trim();
  const [a,b] = s.split("/"); const ip = ipToInt(a); if (ip==null) return null;
  const n = b==null ? 32 : maskLen(b); return n==null ? null : {ip:netOf(ip,n), n};
}
const PRIVATE = [["10.0.0.0",8],["172.16.0.0",12],["192.168.0.0",16],["169.254.0.0",16],["127.0.0.0",8],["100.64.0.0",10]];
const isPrivate = i => PRIVATE.some(([p,n])=>inNet(i,ipToInt(p),n));
function parseVlans(s){
  s = String(s ?? "").trim().toLowerCase();
  if (!s || s==="all") return null;
  if (s==="none") return new Set();
  const set = new Set();
  for (const part of s.split(/[,\s]+/)){
    const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let v=a; v<=Math.min(b,4094); v++) set.add(v);
  }
  return set;
}
const vlanAllowed = (p, v) => { const s = parseVlans(p.allowed); return s==null || s.has(v); };
function macOf(d){
  if (d.mac) return d.mac;
  let h = 7; for (const c of String(d.id)) h = (h*31 + c.charCodeAt(0))>>>0;
  const hex = ("00" + h.toString(16)).padStart(8,"0").slice(-8);
  return ("00:1a:" + hex.replace(/(..)(?!$)/g,"$1:")).toLowerCase();
}
const ciscoMac = m => { const x = m.replace(/[^0-9a-f]/gi,"").toLowerCase(); return `${x.slice(0,4)}.${x.slice(4,8)}.${x.slice(8,12)}`; };
const winMac = m => m.replace(/:/g,"-").toLowerCase();

/* ---- normalization ---- */
const CABLES = {
  cat3:{name:"Cat 3", max:10, copper:true}, cat5:{name:"Cat 5", max:100, copper:true}, cat5e:{name:"Cat 5e", max:1000, copper:true},
  cat6:{name:"Cat 6", max:1000, copper:true}, cat6a:{name:"Cat 6a", max:10000, copper:true}, cat8:{name:"Cat 8", max:40000, copper:true, maxLen:30},
  smf:{name:"Single-mode fiber", fiber:"sm", max:100000}, mmf:{name:"Multimode fiber", fiber:"mm", max:10000}, dac:{name:"DAC twinax", max:10000, maxLen:7, dac:true}
};
const SFP = {
  "1000BASE-SX":{fiber:"mm", speed:1000}, "1000BASE-LX":{fiber:"sm", speed:1000},
  "10GBASE-SR":{fiber:"mm", speed:10000}, "10GBASE-LR":{fiber:"sm", speed:10000}, "1000BASE-T":{copper:true, speed:1000}
};
function fillDefaults(o, defs){ for (const k in defs) if (o[k]===undefined) o[k] = defs[k]; return o; }
function normDevice(d){
  if (d.power===undefined) d.power = true;
  if (d.editable === undefined) d.editable = true;
  if (isHost(d)){
    d.mode = d.mode==="dhcp" ? "dhcp" : "static";
    for (const k of ["ip","mask","gw","dns"]) if (d[k]==null) d[k] = "";
    d.nic = fillDefaults(d.nic||{}, {speed:"auto", duplex:"auto", mtu:1500});
    if (!d.services) d.services = [];
    if (!d.os) d.os = d.kind==="phone" || d.kind==="ap" || d.kind==="printer" ? "embedded" : "windows";
  }
  if (isSwitch(d)){
    d.ports = d.ports || [];
    d.ports.forEach(p=>fillDefaults(p, {mode:"access", vlan:1, allowed:"all", native:1, shutdown:false, speed:"auto", duplex:"auto", mtu:1500, poe:true}));
    d.stp = fillDefaults(d.stp||{}, {enabled:true, priority:32768});
    if (d.poeBudget==null) d.poeBudget = 370;
    if (!d.poeStd) d.poeStd = "at";
  }
  if (isRouterLike(d)){
    d.ifaces = d.ifaces || d.svis || [];
    d.ifaces.forEach(i=>fillDefaults(i, {vlan:null, ip:"", mask:"", helper:"", nat:"", acl:"", aclOut:"", shutdown:false, mtu:1500}));
    if (!d.routes) d.routes = [];
    if (!d.acls) d.acls = {};
    if (!d.defaultRoute) d.defaultRoute = "";
  }
  return d;
}
const POE_W = {af:15.4, at:30, bt:90};
const POE_RANK = {af:1, at:2, bt:3};

/* ---- net construction and physical precompute ---- */
function makeNet(devices, links){
  const net = {devs:devices.map(normDevice), links:links.map(l=>({a:l[0], pa:l[1], b:l[2], pb:l[3], opt:Object.assign({}, l[4]||{})})), byId:{}, cache:new Map(), dhcpDepth:0};
  for (const d of net.devs) net.byId[d.id] = d;
  net.reset = () => { net.cache.clear(); net.leases = null; net.ospf = null; };
  computePhysical(net);
  computeLacp(net);
  computeStp(net);
  return net;
}
function linkIndex(net, devId, port){ return net.links.findIndex(l=>(l.a===devId && pn(l.pa)===pn(port)) || (l.b===devId && pn(l.pb)===pn(port))); }
function linkAt(net, devId, port){
  const i = linkIndex(net, devId, port); if (i<0) return null;
  const l = net.links[i];
  return l.a===devId && pn(l.pa)===pn(port) ? {dev:l.b, port:l.pb, li:i} : {dev:l.a, port:l.pa, li:i};
}
function hostPort(net, d){ for (const l of net.links){ if (l.a===d.id) return l.pa; if (l.b===d.id) return l.pb; } return null; }
function swPort(sw, name){ return (sw.ports||[]).find(p=>pn(p.name)===pn(name)); }
const phys = i => String(i.name).split(".")[0];
function sideOf(net, devId, port){
  const d = net.byId[devId]; if (!d) return null;
  if (isSwitch(d)) return swPort(d, port) || null;
  if (isHost(d)) return d.nic;
  if (isRouterLike(d)) return (d.ifaces||[]).find(i=>pn(i.name)===pn(port)) || {name:port, shutdown:false, speed:"auto", duplex:"auto"};
  return {speed:"auto", duplex:"auto"};
}
function computePhysical(net){
  for (const sw of net.devs.filter(isSwitch)){
    for (const p of sw.ports){
      p._violation = false; p._dtpTrunk = false;
      const l = linkAt(net, sw.id, p.name); if (!l) continue;
      const nb = net.byId[l.dev];
      // DTP: a dynamic port facing a device that negotiates trunking becomes a trunk (switch spoofing)
      if (p.mode==="dynamic" && nb && (nb.dtp || (isSwitch(nb) && (swPort(nb, l.port)||{}).mode!=="access"))) p._dtpTrunk = true;
      if (!p.portSecurity || !p.portSecurity.enabled) continue;
      let macs = 0;
      if (isHost(nb)) macs = nb.macFlood ? 8192 : 1 + (nb.extraMacs||0);
      else if (isSwitch(nb)) macs = net.links.filter(x=>[x.a,x.b].includes(nb.id) && isHost(net.byId[x.a===nb.id?x.b:x.a])).length;
      const sticky = (p.portSecurity.sticky||[]).map(pn);
      const max = p.portSecurity.max || 1;
      if (macs > max || (sticky.length && isHost(nb) && !sticky.includes(pn(macOf(nb))))) p._violation = true;
      if (p._violation && (p.portSecurity.violation||"shutdown")==="shutdown" && !p.shutdown) p.errDisabled = true;
    }
  }
  const unpowered = new Set();
  for (const sw of net.devs.filter(isSwitch)){
    let used = 0; sw._poe = {};
    for (const p of sw.ports){
      const l = linkAt(net, sw.id, p.name); if (!l) continue;
      const nb = net.byId[l.dev]; if (!nb || !nb.poe || nb.poe.injector) continue;
      const std = nb.poe.std || "af", need = nb.poe.watts || POE_W[std];
      const ok = p.poe!==false && !p.shutdown && !p.errDisabled && POE_RANK[sw.poeStd] >= POE_RANK[std] && used + need <= sw.poeBudget;
      if (ok){ used += need; sw._poe[p.name] = {state:"on", watts:need, dev:nb.name}; }
      else { unpowered.add(nb.id); sw._poe[p.name] = {state: p.poe===false ? "off" : POE_RANK[sw.poeStd] < POE_RANK[std] ? "faulty" : "denied", watts:0, dev:nb.name, need}; }
    }
    sw._poeUsed = used;
  }
  for (const d of net.devs) d._off = !d.power || unpowered.has(d.id);
  for (const L of net.links){
    const A = net.byId[L.a], B = net.byId[L.b], sa = sideOf(net, L.a, L.pa) || {}, sb = sideOf(net, L.b, L.pb) || {};
    const st = {up:true, reason:"", speed:1000, loss:0, lat:0.1, mtu:Math.min(sa.mtu||1500, sb.mtu||1500), errors:{}, util:L.opt.util||0, jitter:0};
    const cable = CABLES[L.opt.cable||"cat6"] || CABLES.cat6, len = L.opt.length||10;
    const down = r => { if (st.up){ st.up = false; st.reason = r; } };
    if (!A || !B) down("missing device");
    if (A && A._off) down(`${A.name} has no power`);
    if (B && B._off) down(`${B.name} has no power`);
    if (sa.shutdown || sb.shutdown) down("administratively down");
    if (sa.errDisabled || sb.errDisabled) down("err-disabled (port security violation)");
    if (sa._suspended || sb._suspended) down("suspended (LACP mode mismatch)");
    const ends = [[sa, A],[sb, B]];
    for (const [s, dev] of ends){
      const t = s.sfp && SFP[s.sfp];
      if (t){
        if (t.fiber && cable.fiber && t.fiber!==cable.fiber) down(`${s.sfp} transceiver needs ${t.fiber==="sm"?"single-mode":"multimode"} fiber`);
        if (t.fiber && !cable.fiber) down(`${s.sfp} is a fiber transceiver but the cable is copper`);
        if (t.copper && cable.fiber) down("copper transceiver on a fiber cable");
      } else if (cable.fiber) down(`fiber cable plugged into a port on ${dev ? dev.name : "a device"} with no fiber transceiver`);
    }
    const ta = sa.sfp && SFP[sa.sfp], tb = sb.sfp && SFP[sb.sfp];
    if (ta && tb && ta.fiber && tb.fiber && ta.speed!==tb.speed) down("transceiver speed mismatch");
    if (L.opt.txrx) down("TX/RX transposed, no light received");
    if (L.opt.dbm!=null && L.opt.dbm < -20) down(`receive signal too weak (${L.opt.dbm} dBm)`);
    const caps = [sa,sb].map(s=>s.speed && s.speed!=="auto" ? Number(s.speed) : null);
    let spd = Math.min(cable.max, ta ? ta.speed : 10000, tb ? tb.speed : 10000);
    if (caps[0] && caps[1] && caps[0]!==caps[1]) down(`speed mismatch (${caps[0]} vs ${caps[1]} Mbps)`);
    const fixed = caps.find(Boolean); if (fixed) spd = Math.min(spd, fixed);
    if (!fixed && cable.copper) spd = Math.min(spd, 1000, cable.max);
    st.speed = spd; st.nominal = spd;
    const dup = [sa,sb].map(s=>s.duplex||"auto");
    let eff = dup.slice();
    if (dup[0]==="auto" && dup[1]==="auto") eff = ["full","full"];
    else if (dup[0]==="auto") eff = ["half", dup[1]];
    else if (dup[1]==="auto") eff = [dup[0], "half"];
    st.duplex = eff;
    if (eff[0]!==eff[1]){ st.loss = Math.max(st.loss, 0.25); st.dupMismatch = true; st.halfSide = eff[0]==="half" ? "a" : "b"; st.speed = Math.min(st.speed, 5); }
    else if (eff[0]==="half") st.speed = Math.round(st.speed*0.6);
    const maxLen = cable.maxLen || (cable.copper ? 100 : cable.fiber==="mm" ? 550 : 10000);
    if (len > maxLen){ st.loss = Math.max(st.loss, cable.copper ? 0.3 : 0.5); st.attenuation = true; st.errors.crc = true; }
    if (L.opt.crosstalk || L.opt.interference || L.opt.badTermination){ st.loss = Math.max(st.loss, 0.2); st.errors.crc = true; }
    if (L.opt.splitPair){ st.loss = Math.max(st.loss, 0.15); st.errors.crc = true; }
    if (st.util>0.85){ st.lat += 40*(st.util-0.85)/0.15 + 5; st.jitter = Math.round(25*(st.util-0.85)/0.15 + 3); st.loss = Math.max(st.loss, (st.util-0.85)*0.6); st.errors.drops = true; }
    if (st.mtu < Math.max(sa.mtu||1500, sb.mtu||1500)) st.errors.giants = true;
    L.st = st;
  }
}
function computeLacp(net){
  for (const sw of net.devs.filter(isSwitch)) for (const p of sw.ports){ p._suspended = false; p._bundle = null; }
  net.links.forEach(l=>{ l.bundle = null; l.bundleFail = null; l.bundleMember = false; });
  const groups = new Map();
  net.links.forEach((L,i)=>{
    const A = net.byId[L.a], B = net.byId[L.b]; if (!isSwitch(A) || !isSwitch(B)) return;
    const pa = swPort(A, L.pa), pb = swPort(B, L.pb); if (!pa || !pb || !pa.channel || !pb.channel) return;
    const key = [A.id+":"+pa.channel, B.id+":"+pb.channel].sort().join("|");
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push({i, pa, pb});
  });
  for (const [key, mem] of groups){
    const modes = mem.map(m=>[m.pa.lacp||"on", m.pb.lacp||"on"]);
    const ok = modes.every(([x,y])=> (x==="on" && y==="on") || (x!=="on" && y!=="on" && !(x==="passive" && y==="passive")));
    const consistent = mem.every(m=>m.pa.mode===mem[0].pa.mode && m.pb.mode===mem[0].pb.mode && String(m.pa.speed)===String(mem[0].pa.speed));
    if (ok && consistent) mem.forEach(m=>{ m.pa._bundle = key; m.pb._bundle = key; net.links[m.i].bundle = key; });
    else mem.forEach(m=>{
      net.links[m.i].bundleFail = modes[0].join("/");
      if (modes.some(([x,y])=>(x==="on")!==(y==="on"))){ if ((m.pa.lacp||"on")!=="on") m.pa._suspended = true; if ((m.pb.lacp||"on")!=="on") m.pb._suspended = true; }
    });
  }
  computePhysical(net);
  for (const [key] of groups){ const mem = net.links.filter(l=>l.bundle===key && l.st.up); mem.forEach(l=>{ l.st.speed = l.st.speed*mem.length; }); }
}
const bridgeId = sw => [Number(sw.stp.priority), macOf(sw)];
const bidLess = (a,b) => a[0]!==b[0] ? a[0]<b[0] : a[1]<b[1];
const stpCost = spd => spd>=10000 ? 2 : spd>=1000 ? 4 : spd>=100 ? 19 : 100;
function computeStp(net){
  net.stp = {blocked:new Set(), storm:new Set(), roles:{}};
  const sws = net.devs.filter(d=>isSwitch(d) && !d._off);
  const edges = [], seenB = new Set();
  net.links.forEach((L,i)=>{
    if (!L.st.up || !isSwitch(net.byId[L.a]) || !isSwitch(net.byId[L.b])) return;
    if (L.bundle){ if (seenB.has(L.bundle)){ L.bundleMember = true; return; } seenB.add(L.bundle); }
    edges.push({i, a:L.a, b:L.b, pa:L.pa, pb:L.pb, cost:stpCost(L.st.speed)});
  });
  const adj = {}; sws.forEach(s=>adj[s.id]=[]);
  edges.forEach(e=>{ if (adj[e.a] && adj[e.b]){ adj[e.a].push(e); adj[e.b].push(e); } });
  const seen = new Set();
  for (const s of sws){
    if (seen.has(s.id)) continue;
    const comp = [], stack = [s.id]; seen.add(s.id);
    while (stack.length){ const x = stack.pop(); comp.push(x); for (const e of adj[x]){ const y = e.a===x?e.b:e.a; if (!seen.has(y)){ seen.add(y); stack.push(y); } } }
    const compEdges = edges.filter(e=>comp.includes(e.a));
    const cyclic = compEdges.length >= comp.length;
    let root = net.byId[comp[0]]; for (const id of comp) if (bidLess(bridgeId(net.byId[id]), bridgeId(root))) root = net.byId[id];
    comp.forEach(id=>{ net.stp.roles[id] = {root:root.id, rootCost:0, rootPort:null, ports:{}}; });
    if (cyclic && comp.some(id=>!net.byId[id].stp.enabled)){ comp.forEach(id=>net.stp.storm.add(id)); continue; }
    const dist = {}, via = {}, done = new Set(); comp.forEach(id=>dist[id]=Infinity); dist[root.id]=0;
    while (done.size < comp.length){
      let u = null;
      for (const id of comp) if (!done.has(id) && dist[id]<Infinity && (u===null || dist[id]<dist[u] || (dist[id]===dist[u] && bidLess(bridgeId(net.byId[id]), bridgeId(net.byId[u]))))) u = id;
      if (u===null) break; done.add(u);
      for (const e of adj[u]){
        const v = e.a===u?e.b:e.a, nd = dist[u]+e.cost; if (done.has(v)) continue;
        if (nd < dist[v] || (nd===dist[v] && via[v] && bidLess(bridgeId(net.byId[u]), bridgeId(net.byId[via[v].from])))){ dist[v]=nd; via[v]={e, from:u}; }
      }
    }
    const tree = new Set(Object.values(via).map(x=>x.e.i));
    for (const id of comp){ const R = net.stp.roles[id]; R.rootCost = dist[id]; if (via[id]) R.rootPort = via[id].e.a===id ? via[id].e.pa : via[id].e.pb; }
    for (const e of compEdges){
      const A = {id:e.a, port:e.pa}, B = {id:e.b, port:e.pb};
      if (tree.has(e.i)){
        const child = via[e.a] && via[e.a].e.i===e.i ? A : B, parent = child===A ? B : A;
        net.stp.roles[child.id].ports[child.port] = {role:"Root", state:"FWD", cost:e.cost};
        net.stp.roles[parent.id].ports[parent.port] = {role:"Desg", state:"FWD", cost:e.cost};
      } else {
        const aBetter = dist[e.a] < dist[e.b] || (dist[e.a]===dist[e.b] && bidLess(bridgeId(net.byId[e.a]), bridgeId(net.byId[e.b])));
        const des = aBetter ? A : B, alt = aBetter ? B : A;
        net.stp.roles[des.id].ports[des.port] = {role:"Desg", state:"FWD", cost:e.cost};
        net.stp.roles[alt.id].ports[alt.port] = {role:"Altn", state:"BLK", cost:e.cost};
        net.stp.blocked.add(e.i);
      }
    }
    // bundle members follow their bundle's state
    net.links.forEach((l,j)=>{ if (l.bundleMember){ const lead = net.links.findIndex(x=>x.bundle===l.bundle && !x.bundleMember); if (net.stp.blocked.has(lead)) net.stp.blocked.add(j); } });
  }
  for (const sw of sws) for (const p of sw.ports){
    const R = net.stp.roles[sw.id]; const l = linkAt(net, sw.id, p.name);
    if (R && !R.ports[p.name] && l && net.links[l.li].st.up) R.ports[p.name] = {role:"Desg", state:"FWD", cost:stpCost(net.links[l.li].st.speed), edge:true};
  }
}
const linkUsable = (net, li) => li>=0 && net.links[li].st.up && !net.stp.blocked.has(li);

/* ---- layer 2 reachability with path metrics ---- */
function l2Domain(net, start){
  const res = [], seen = new Set(), queue = [];
  const m0 = {bw:Infinity, loss:0, lat:0, mtu:9216, snoop:false, storm:false, jitter:0};
  const fromSwitch = (sw, vlan, ingress, m) => {
    if (net.stp.storm.has(sw.id)) m = {...m, storm:true};
    if (sw.kind==="l3switch") for (const i of sw.ifaces) if (vnum(i.vlan)===vlan && !i.shutdown && /^vlan/i.test(i.name)) res.push({dev:sw, iface:i, m});
    for (const Q of sw.ports){
      if (ingress && pn(Q.name)===pn(ingress)) continue;
      const li = linkIndex(net, sw.id, Q.name); if (!linkUsable(net, li)) continue;
      const snoop = m.snoop || (!!sw.dhcpSnooping && !Q.trusted);
      const daiTgt = m.daiTgt || (sw.dai && !Q.trusted ? (sw.dhcpSnooping ? "bound" : "all") : false);
      if (Q.mode==="trunk" || Q._dtpTrunk){ if (vlanAllowed(Q, vlan)) queue.push({dev:sw.id, port:Q.name, tag: vlan===(vnum(Q.native)||1) ? null : vlan, m:{...m, snoop, daiTgt}}); }
      else if ((vnum(Q.vlan)||1)===vlan) queue.push({dev:sw.id, port:Q.name, tag:null, m:{...m, snoop, daiTgt}});
      else if (Q.voice && vnum(Q.voice)===vlan) queue.push({dev:sw.id, port:Q.name, tag:vlan, m:{...m, snoop, daiTgt}});
    }
  };
  if (start.vlan!=null){ const sw = net.byId[start.dev]; if (sw) fromSwitch(sw, start.vlan, null, m0); }
  else queue.push({dev:start.dev, port:start.port, tag:start.tag ?? null, m:m0});
  while (queue.length){
    const it = queue.shift();
    const far = linkAt(net, it.dev, it.port); if (!far || !linkUsable(net, far.li)) continue;
    const key = far.dev+"|"+pn(far.port)+"|"+it.tag; if (seen.has(key)) continue; seen.add(key);
    const st = net.links[far.li].st;
    const m = {bw:Math.min(it.m.bw, st.speed*(1-st.util)), loss:1-(1-it.m.loss)*(1-st.loss), lat:it.m.lat+st.lat, mtu:Math.min(it.m.mtu, st.mtu), snoop:it.m.snoop, storm:it.m.storm, jitter:Math.max(it.m.jitter, st.jitter||0), daiTgt:it.m.daiTgt, daiSrc:it.m.daiSrc};
    const d = net.byId[far.dev]; if (!d || d._off) continue;
    if (isHost(d) || d.kind==="cloud"){
      if (it.tag==null || (d.voiceVlan && vnum(d.voiceVlan)===it.tag) || d.dtp) res.push({dev:d, iface:null, m, tag:it.tag});
      continue;
    }
    if (isRouterLike(d) && !isSwitch(d)){
      for (const i of d.ifaces||[]){
        if (pn(phys(i))!==pn(far.port) || i.shutdown) continue;
        const v = vnum(i.vlan);
        if ((it.tag==null && v==null) || (it.tag!=null && v===it.tag)) res.push({dev:d, iface:i, m});
      }
      continue;
    }
    if (isSwitch(d)){
      const P = swPort(d, far.port); if (!P || P.shutdown || P.errDisabled) continue;
      if (d.dai && !P.trusted && !m.daiSrc) m.daiSrc = d.dhcpSnooping ? "bound" : "all";
      let vlan;
      if (P.mode==="trunk" || P._dtpTrunk){ vlan = it.tag==null ? (vnum(P.native)||1) : it.tag; if (!vlanAllowed(P, vlan)) continue; }
      else if (it.tag!=null){ if (!(P.voice && vnum(P.voice)===it.tag)) continue; vlan = it.tag; }
      else vlan = vnum(P.vlan)||1;
      fromSwitch(d, vlan, far.port, m);
    }
  }
  return res;
}
function hostDomain(net, d){ const p = hostPort(net, d); return p ? l2Domain(net, {dev:d.id, port:p, tag:d.voiceVlan ? vnum(d.voiceVlan) : null}) : []; }
function ifaceDomain(net, R, i){
  if (R.kind==="l3switch" && /^vlan/i.test(i.name)) return l2Domain(net, {dev:R.id, vlan:vnum(i.vlan)});
  return l2Domain(net, {dev:R.id, port:phys(i), tag:vnum(i.vlan)});
}

/* Lab Bench simulation engine: layer 3 and services. MIT License. */

function ifCfg(i){ const ip = ipToInt(i.ip), n = maskLen(i.mask); return ip!=null && n!=null && n>=8 ? {ip, n} : null; }
function routerIfUp(net, R, i){
  if (!ifCfg(i) || i.shutdown || R._off) return false;
  if (R.kind==="l3switch" && /^vlan/i.test(i.name)){
    const v = vnum(i.vlan);
    return R.ports.some(p=>{ const li = linkIndex(net, R.id, p.name); return li>=0 && net.links[li].st.up && !p.shutdown && ((p.mode!=="trunk" && (vnum(p.vlan)||1)===v) || (p.mode==="trunk" && vlanAllowed(p, v))); });
  }
  const physIf = (R.ifaces||[]).find(x=>pn(x.name)===pn(phys(i)));
  if (physIf && physIf.shutdown) return false;
  const li = linkIndex(net, R.id, phys(i));
  return li>=0 && net.links[li].st.up;
}
const upIfs = (net, R) => (R.ifaces||[]).map(i=>({i, c:ifCfg(i)})).filter(x=>x.c && routerIfUp(net, R, x.i));

/* ---- host addressing ---- */
function apipaFor(net, d){ const idx = Math.max(0, net.devs.indexOf(d)); return ipToInt(`169.254.${(23+idx*13)%254+1}.${(41+idx*7)%254+1}`); }
function hostCfg(net, d){
  if (net.cache.has("cfg:"+d.id)) return net.cache.get("cfg:"+d.id);
  let r;
  if (d.kind==="cloud"){ const ip = ipToInt(d.ip); r = {ok:ip!=null, ip, n:32}; }
  else if (d._off) r = {ok:false, why:`${d.name} is powered off`};
  else if (d.mode==="dhcp"){
    if (net.dhcpDepth>0) return {ok:false, why:"(resolving DHCP)"};
    if (!net.leases) computeLeases(net);
    const L = net.leases[d.id];
    r = L && L.ip!=null ? {ok:true, dhcp:true, ...L} : {ok:true, dhcp:true, apipa:true, exhausted:L && L.exhausted, ip:apipaFor(net, d), n:16, gw:null, dns:null};
  } else {
    const ip = ipToInt(d.ip), n = maskLen(d.mask);
    if (ip==null) r = {ok:false, why:`${d.name} doesn't have a valid IPv4 address`};
    else if (n==null || n<8) r = {ok:false, why:`${d.name} doesn't have a valid subnet mask`};
    else if (n<31 && (ip===netOf(ip,n) || ip===bcastOf(ip,n))) r = {ok:false, why:`${d.ip} is the network or broadcast address of its /${n} subnet, so ${d.name} can't use it`};
    else r = {ok:true, ip, n, gw: ipToInt(d.gw), dns: ipToInt(d.dns)};
  }
  if (r.ok && d.publicIp) r.publicIp = ipToInt(d.publicIp);
  net.cache.set("cfg:"+d.id, r); return r;
}
/* ---- DHCP ---- */
function poolNet(p){ const [a,b] = String(p.network||"").split("/"); const ip = ipToInt(a), n = maskLen(b); return ip!=null && n!=null ? {ip:netOf(ip,n), n} : null; }
function inRanges(ip, ranges){ return (ranges||[]).some(r=>{ const [a,b] = String(r).split("-").map(s=>ipToInt(s.trim())); return a!=null && ip>=a && ip<=(b??a); }); }
function dhcpSource(net, c){
  const dom = hostDomain(net, c);
  const cands = [];
  for (const e of dom){
    if (!isHost(e.dev) || !Array.isArray(e.dev.dhcp) || !e.dev.dhcp.length || e.m.storm) continue;
    const sc = hostCfg(net, e.dev); if (!sc.ok || sc.dhcp) continue;
    const idx = e.dev.dhcp.findIndex(p=>{ const q = poolNet(p); return q && inNet(sc.ip, q.ip, q.n); });
    if (idx<0) continue;
    cands.push({server:e.dev, pool:e.dev.dhcp[idx], idx, blocked:e.m.snoop, rogue:!!e.dev.rogue});
  }
  for (const e of dom){
    if (!isRouterLike(e.dev) || !e.iface || !String(e.iface.helper||"").trim() || e.m.storm) continue;
    const ic = ifCfg(e.iface); if (!ic || !routerIfUp(net, e.dev, e.iface)) continue;
    for (const h of String(e.iface.helper).split(/[,\s]+/)){
      const hip = ipToInt(h); if (hip==null) continue;
      const x = exchange(net, {src:ic.ip, dst:hip, proto:"udp", port:67}, {type:"router", dev:e.dev, inIface:null}, e.dev.id);
      if (!x.ok || !x.ep || !Array.isArray(x.ep.dev.dhcp)) continue;
      const idx = x.ep.dev.dhcp.findIndex(p=>{ const q = poolNet(p); return q && inNet(ic.ip, q.ip, q.n); });
      if (idx<0) continue;
      cands.push({server:x.ep.dev, pool:x.ep.dev.dhcp[idx], idx, blocked:e.m.snoop, relay:e.iface.name, rogue:!!x.ep.dev.rogue});
    }
  }
  const usable = cands.filter(x=>!x.blocked);
  usable.sort((a,b)=>(b.rogue?1:0)-(a.rogue?1:0));
  return usable[0] ? usable[0] : (cands.length ? {blockedOnly:true} : null);
}
function computeLeases(net){
  net.dhcpDepth++;
  try{
    const clients = net.devs.filter(d=>isHost(d) && d.mode==="dhcp" && !d._off);
    const src = {}; for (const c of clients) src[c.id] = dhcpSource(net, c);
    const used = {}, leases = {};
    const statics = new Set(net.devs.filter(d=>isHost(d) && d.mode!=="dhcp").map(d=>ipToInt(d.ip)).filter(x=>x!=null));
    for (const c of clients){
      const s = src[c.id];
      if (!s || s.blockedOnly){ leases[c.id] = s ? {snooped:true} : null; continue; }
      const q = poolNet(s.pool), key = s.server.id+"#"+s.idx; used[key] = used[key] || new Set();
      const start = ipToInt(s.pool.start) ?? (q.ip+1), end = ipToInt(s.pool.end) ?? (bcastOf(q.ip,q.n)-1);
      const reserved = (s.pool.reservations||[]).map(r=>({mac:pn(r.mac), ip:ipToInt(r.ip)}));
      const mine = reserved.find(r=>r.mac===pn(macOf(c)));
      let ip = null;
      if (mine) ip = mine.ip;
      else for (let a=start; a<=end; a++){
        if (used[key].has(a) || inRanges(a, s.pool.exclusions) || reserved.some(r=>r.ip===a)) continue;
        if (!inNet(a, q.ip, q.n)) break;
        ip = a; break;
      }
      if (ip==null){ leases[c.id] = {exhausted:true, server:s.server.name}; continue; }
      used[key].add(ip);
      leases[c.id] = {ip, n:q.n, gw:ipToInt(s.pool.gw), dns:ipToInt(s.pool.dns), server:intToIp(hostCfg(net, s.server).ip), serverId:s.server.id, serverName:s.server.name, rogue:!!s.server.rogue, relay:s.relay, lease:s.pool.lease||"8 days", conflict:statics.has(ip)};
    }
    net.leases = leases;
  } finally { net.dhcpDepth--; }
}
/* ---- address lookup inside a broadcast domain (ARP) ---- */
function vipActive(net, dom, ip){
  const cands = dom.filter(e=>isRouterLike(e.dev) && e.iface && ipToInt(e.iface.vip)===ip && routerIfUp(net, e.dev, e.iface));
  if (!cands.length) return null;
  const pri = e => { let p = Number(e.iface.vipPriority||100); if (e.iface.track){ const t = e.dev.ifaces.find(x=>pn(x.name)===pn(e.iface.track)); if (!t || !routerIfUp(net, e.dev, t)) p -= Number(e.iface.trackDecrement||10); } return p; };
  cands.sort((a,b)=>pri(b)-pri(a) || ifCfg(b.iface).ip - ifCfg(a.iface).ip);
  return cands[0];
}
function daiBlocked(net, e, srcId){
  if (!e.m) return false;
  const bound = d => !!d && isHost(d) && d.mode==="dhcp";
  if (e.m.daiTgt && (e.m.daiTgt==="all" || !bound(e.dev))) return true;
  if (e.m.daiSrc && (e.m.daiSrc==="all" || !bound(net.byId[srcId]))) return true;
  return false;
}
function findIp(net, dom, ip, excludeId){
  const hits = dom.filter(e=>{
    if (e.dev.id===excludeId) return false;
    if (daiBlocked(net, e, excludeId)) return false;
    if (isRouterLike(e.dev) && e.iface){ const c = ifCfg(e.iface); return c && c.ip===ip && routerIfUp(net, e.dev, e.iface); }
    if (e.dev.kind==="cloud") return ipToInt(e.dev.ip)===ip;
    const c = hostCfg(net, e.dev); return c.ok && c.ip===ip;
  });
  const uniq = [...new Map(hits.map(e=>[e.dev.id+(e.iface?e.iface.name:""), e])).values()];
  if (!uniq.length){ const v = vipActive(net, dom, ip); if (v) return {ep:v, dup:false, vip:true}; }
  return {ep:uniq[0]||null, dup:uniq.length>1, all:uniq};
}
/* ---- routing ---- */
function ospfRoutes(net){
  if (net.ospf) return net.ospf;
  const R = net.devs.filter(d=>isRouterLike(d) && d.ospf && d.ospf.enabled && !d._off);
  const adj = {}; R.forEach(r=>adj[r.id]=[]);
  for (const r of R) for (const x of upIfs(net, r)){
    if ((r.ospf.passive||[]).map(pn).includes(pn(x.i.name))) continue;
    for (const e of ifaceDomain(net, r, x.i)){
      if (!e.iface || e.dev===r || !R.includes(e.dev)) continue;
      const y = ifCfg(e.iface); if (!y || !inNet(y.ip, x.c.ip, x.c.n) || y.n!==x.c.n) continue;
      if ((e.dev.ospf.passive||[]).map(pn).includes(pn(e.iface.name))) continue;
      if ((e.dev.ospf.area||0)!=(r.ospf.area||0)) continue;
      if ((e.iface.ospfHello||10)!=(x.i.ospfHello||10)) continue;
      if ((e.iface.mtu||1500)!=(x.i.mtu||1500)) continue;
      adj[r.id].push({to:e.dev.id, via:y.ip, out:x.i, cost:Number(x.i.ospfCost||1)});
    }
  }
  const routes = {};
  for (const r of R){
    const dist = {[r.id]:0}, first = {}, done = new Set();
    while (true){
      let u = null; for (const k in dist) if (!done.has(k) && (u===null || dist[k]<dist[u])) u = k;
      if (u===null) break; done.add(u);
      for (const e of adj[u]||[]){ const nd = dist[u]+e.cost; if (dist[e.to]==null || nd<dist[e.to]){ dist[e.to]=nd; first[e.to] = u===r.id ? e : first[u]; } }
    }
    const best = {};
    for (const o of R){ if (o===r || dist[o.id]==null) continue;
      for (const x of upIfs(net, o)){ const k = netOf(x.c.ip,x.c.n)+"/"+x.c.n, metric = dist[o.id]+Number(x.i.ospfCost||1);
        if (!best[k] || metric < best[k].metric) best[k] = {net:netOf(x.c.ip,x.c.n), n:x.c.n, ad:110, type:"O", via:first[o.id].via, iface:first[o.id].out, metric}; }
    }
    routes[r.id] = Object.values(best);
  }
  net.ospf = {routes, adj};
  return net.ospf;
}
function routeTable(net, R, inIface){
  const rows = [];
  const ifs = upIfs(net, R);
  for (const x of ifs) rows.push({net:netOf(x.c.ip,x.c.n), n:x.c.n, ad:0, type:"C", iface:x.i});
  const statics = [...(inIface && Array.isArray(inIface.routes) ? inIface.routes : (R.routes||[]))];
  if (!(inIface && Array.isArray(inIface.routes)) && String(R.defaultRoute||"").trim()) statics.push({net:"0.0.0.0/0", via:R.defaultRoute});
  for (const s of statics){
    const c = parseCidr(s.net), via = ipToInt(s.via); if (!c || via==null) continue;
    const out = ifs.find(x=>inNet(via, x.c.ip, x.c.n)); if (!out) continue;
    rows.push({net:c.ip, n:c.n, ad:Number(s.ad||1), type: c.n===0 ? "S*" : "S", via, iface:out.i});
  }
  if (R.ospf && R.ospf.enabled) for (const o of (ospfRoutes(net).routes[R.id]||[])) if (!rows.some(r=>r.type==="C" && r.net===o.net && r.n===o.n)) rows.push(o);
  return rows;
}
function lookupRoute(net, R, dst, inIface){
  const m = routeTable(net, R, inIface).filter(r=>inNet(dst, r.net, r.n));
  m.sort((a,b)=>b.n-a.n || a.ad-b.ad || (a.metric||0)-(b.metric||0));
  return m[0] || null;
}
/* ---- ACLs ---- */
function portMatch(spec, port){
  spec = String(spec ?? "any").trim().toLowerCase();
  if (!spec || spec==="any") return true;
  return spec.split(/[,\s]+/).some(p=>{ const [a,b] = p.split("-").map(Number); return b ? port>=a && port<=b : port===a; });
}
function aclMatch(rule, pkt){
  const proto = String(rule.proto||"ip").toLowerCase();
  if (proto!=="ip" && proto!==pkt.proto) return false;
  const s = parseCidr(rule.src||"any"), d = parseCidr(rule.dst||"any");
  if (!s || !d) return false;
  if (!inNet(pkt.src, s.ip, s.n) || !inNet(pkt.dst, d.ip, d.n)) return false;
  if ((proto==="tcp" || proto==="udp") && !portMatch(rule.port, pkt.port)) return false;
  return true;
}
function aclEval(R, name, pkt){
  const rules = R.acls && R.acls[name];
  if (!rules) return {permit:true, missing:true};
  for (let k=0; k<rules.length; k++) if (aclMatch(rules[k], pkt)) return {permit: String(rules[k].action).toLowerCase()==="permit", rule:k+1};
  return {permit:false, implicit:true};
}
function fwEval(d, pkt){
  if (!d.fw || !d.fw.enabled) return {permit:true};
  for (const r of d.fw.rules||[]) if (aclMatch({...r, dst:"any"}, pkt)) return {permit:String(r.action||"allow").toLowerCase()!=="deny"};
  return {permit:false};
}
/* ---- forwarding ---- */
function addM(a, b){ return {bw:Math.min(a.bw, b.bw), loss:1-(1-a.loss)*(1-b.loss), lat:a.lat+b.lat, mtu:Math.min(a.mtu, b.mtu), jitter:Math.max(a.jitter||0, b.jitter||0)}; }
function forward(net, pkt, node, reply){
  const hops = []; let m = {bw:Infinity, loss:0, lat:0, mtu:9216, jitter:0}, ttl = 30;
  const fail = (code, why, at) => ({ok:false, code, why, at, hops, m});
  const arrive = ep => {
    if (pkt.size && pkt.df && pkt.size + 28 > m.mtu) return fail("frag", `a ${pkt.size}-byte packet with Don't Fragment set doesn't fit the path MTU of ${m.mtu}`);
    return {ok:true, ep, hops, m};
  };
  let implicitNat = false;
  if (node.type==="host"){
    const d = node.dev, c = node.cfg;
    if (pkt.dst===c.ip || inNet(pkt.dst, ipToInt("127.0.0.0"), 8)) return arrive({dev:d});
    const dom = hostDomain(net, d);
    if (dom.some(e=>e.m.storm) || net.stp.storm.size && dom.length===0 && hostPort(net,d)) {
      const p = hostPort(net, d), l = p && linkAt(net, d.id, p);
      if (l && net.stp.storm.has(l.dev)) return fail("timeout", "a broadcast storm from a switching loop (spanning tree disabled) is flooding the network");
    }
    if (dom.some(e=>e.m.storm)) return fail("timeout", "a broadcast storm from a switching loop (spanning tree disabled) is flooding the network");
    if (!hostPort(net, d)) return fail("general", `${d.name} isn't plugged in`);
    const lk = linkAt(net, d.id, hostPort(net, d));
    if (!net.links[lk.li].st.up) return fail("general", `${d.name}'s link is down: ${net.links[lk.li].st.reason}`);
    if (inNet(pkt.dst, c.ip, c.n)){
      const f = findIp(net, dom, pkt.dst, d.id);
      if (f.dup) return fail("timeout", `two devices answer for ${intToIp(pkt.dst)} (duplicate IP address)`);
      if (!f.ep) return fail("hostunreach", `${d.name} treats ${intToIp(pkt.dst)} as local, but nothing with that address answered ARP in its VLAN`, c.ip);
      m = addM(m, f.ep.m); return arrive(f.ep);
    }
    if (c.gw==null) return fail("general", `${intToIp(pkt.dst)} is on another network and ${d.name} has no default gateway`);
    if (!inNet(c.gw, c.ip, c.n)) return fail("hostunreach", `${d.name}'s gateway ${intToIp(c.gw)} isn't inside its own subnet`, c.ip);
    const g = findIp(net, dom, c.gw, d.id);
    if (!g.ep) return fail("hostunreach", `nothing answered for ${d.name}'s gateway ${intToIp(c.gw)} in its VLAN`, c.ip);
    if (!isRouterLike(g.ep.dev)) return fail("timeout", `${d.name}'s gateway ${intToIp(c.gw)} is ${g.ep.dev.name}, which isn't a router`);
    if (c.publicIp) pkt.srcPublic = true;
    m = addM(m, g.ep.m); hops.push(c.gw);
    node = {type:"router", dev:g.ep.dev, inIface:g.ep.iface};
  }
  while (true){
    if (--ttl <= 0) return fail("ttl", "the packet looped between routers until its TTL expired (routing loop)");
    const R = node.dev, inI = node.inIface;
    const inC = inI && ifCfg(inI);
    if (!reply && inI && inI.acl){ const a = aclEval(R, inI.acl, pkt); if (!a.permit) return fail("acl", `${R.name}'s access list ${inI.acl} (inbound on ${inI.name}) ${a.implicit ? "has no matching permit, so the implicit deny" : "rule "+a.rule} blocked it`, inC && inC.ip); }
    const ifs = upIfs(net, R);
    const own = ifs.find(x=>x.c.ip===pkt.dst || ipToInt(x.i.vip)===pkt.dst);
    if (own) return arrive({dev:R, iface:own.i});
    const rt = lookupRoute(net, R, pkt.dst, inI);
    if (!rt) return fail("netunreach", `${R.name} has no route to ${intToIp(pkt.dst)}`, inC ? inC.ip : (ifs[0] && ifs[0].c.ip));
    const out = rt.iface;
    if (!reply && out.aclOut){ const a = aclEval(R, out.aclOut, pkt); if (!a.permit) return fail("acl", `${R.name}'s access list ${out.aclOut} (outbound on ${out.name}) blocked it`, inC && inC.ip); }
    const natCfg = (R.ifaces||[]).some(i=>i.nat);
    if (out.nat==="outside" && inI && inI.nat==="inside") { pkt.srcPublic = true; pkt.natBy = R.id; }
    if (R.kind==="natgw" && R.publicIp) { pkt.srcPublic = true; pkt.natBy = R.id; }
    if (!natCfg && ["router","firewall","l3switch"].includes(R.kind)) implicitNat = true;
    const nh = rt.via!=null ? rt.via : pkt.dst;
    const dom = ifaceDomain(net, R, out);
    if (dom.some(e=>e.m.storm)) return fail("timeout", "a broadcast storm from a switching loop (spanning tree disabled) is flooding the network");
    const f = findIp(net, dom, nh, R.id);
    if (f.dup) return fail("timeout", `two devices answer for ${intToIp(nh)} (duplicate IP address)`);
    if (!f.ep) return fail("timeout", rt.via!=null ? `${R.name}'s next hop ${intToIp(nh)} for ${intToIp(pkt.dst)} doesn't answer` : `${R.name} sent ${intToIp(pkt.dst)} out ${out.name}, but nothing with that address answered ARP there`);
    m = addM(m, f.ep.m);
    if (f.ep.dev.kind==="cloud"){
      if (ipToInt(f.ep.dev.ip)===pkt.dst) return arrive({dev:f.ep.dev});
      if (isPrivate(pkt.dst)) return fail("timeout", `${intToIp(pkt.dst)} is a private address that isn't on any of the routers' networks, so the internet drops it`);
      const pub = pkt.srcPublic || !isPrivate(pkt.src) || (implicitNat && R.kind!=="igw");
      if (!pub && !reply) return fail("timeout", `the source ${intToIp(pkt.src)} is private and was never translated (no NAT on the way out), so replies can't come back`);
      hops.push(nh);
      if (!pkt.natBy && implicitNat) pkt.natBy = R.id;
      return arrive({dev:f.ep.dev, internet:true});
    }
    if (isRouterLike(f.ep.dev) && (rt.via!=null || !(f.ep.iface && ifCfg(f.ep.iface) && ifCfg(f.ep.iface).ip===pkt.dst))){
      hops.push(nh); node = {type:"router", dev:f.ep.dev, inIface:f.ep.iface}; continue;
    }
    if (rt.via!=null && isHost(f.ep.dev)) return fail("timeout", `${R.name}'s next hop ${intToIp(nh)} is ${f.ep.dev.name}, which isn't a router`);
    return arrive(f.ep);
  }
}
function exchange(net, pkt, srcNode, srcId){
  pkt = {...pkt};
  const f = forward(net, pkt, srcNode, false);
  if (!f.ok) return f;
  const ep = f.ep;
  if (isHost(ep.dev) && ep.dev.id!==srcId){
    const fw = fwEval(ep.dev, pkt);
    if (!fw.permit) return {...f, ok:false, code:"filtered", why:`${ep.dev.name}'s firewall (security group) doesn't allow ${pkt.proto==="icmp" ? "ICMP" : pkt.proto.toUpperCase()+" "+pkt.port} from ${intToIp(pkt.src)}`};
    if ((pkt.proto==="tcp" || pkt.proto==="udp") && !(ep.dev.services||[]).map(pn).includes(pkt.proto+"/"+pkt.port) && !(pkt.port===53 && (ep.dev.dnsRecords || ep.dev.zone || ep.dev.forwarder)) && !(pkt.port===67 && ep.dev.dhcp))
      return {...f, ok:false, code:"refused", why:`${ep.dev.name} isn't running a service on ${pkt.proto.toUpperCase()} ${pkt.port}`};
  }
  if (ep.internet || ep.dev.id===srcId) return f;
  const back = {src:pkt.dst, dst:pkt.src, proto:pkt.proto, port:pkt.port};
  let r;
  if (isRouterLike(ep.dev)) r = forward(net, back, {type:"router", dev:ep.dev, inIface:null}, true);
  else if (ep.dev.kind==="cloud") r = {ok:true, ep:{dev:net.byId[srcId]}};
  else { const ec = hostCfg(net, ep.dev); r = ec.ok ? forward(net, back, {type:"host", dev:ep.dev, cfg:ec}, true) : {ok:false, why:ec.why}; }
  if (!r.ok || !r.ep || r.ep.dev.id!==srcId) return {...f, ok:false, code:"timeout", why:`the request reached ${ep.dev.name}, but its reply can't get back${r.why ? " ("+r.why+")" : ""}`};
  return f;
}
function hostPing(net, src, dst, opt){
  opt = opt||{};
  const c = hostCfg(net, src);
  if (!c.ok) return {ok:false, code:"general", why:c.why};
  const x = exchange(net, {src:c.ip, dst, proto:"icmp", size:opt.size||32, df:!!opt.df}, {type:"host", dev:src, cfg:c}, src.id);
  return {...x, srcIp:c.ip};
}
function hostConn(net, src, dst, proto, port){
  const c = hostCfg(net, src);
  if (!c.ok) return {ok:false, code:"general", why:c.why};
  return {...exchange(net, {src:c.ip, dst, proto, port:Number(port)}, {type:"host", dev:src, cfg:c}, src.id), srcIp:c.ip};
}
/* ---- DNS ---- */
function zoneOf(d){
  const z = (d.zone||[]).map(r=>({name:pn(r.name).replace(/\.$/,""), type:String(r.type||"A").toUpperCase(), value:String(r.value)}));
  for (const [k,v] of Object.entries(d.dnsRecords||{})) z.push({name:pn(k).replace(/\.$/,""), type:ipToInt(v)!=null ? "A" : "CNAME", value:String(v)});
  for (const [k,v] of Object.entries(d.records||{})) z.push({name:pn(k).replace(/\.$/,""), type:"A", value:String(v)});
  return z;
}
function zoneLookup(z, name, type){
  let n = pn(name).replace(/\.$/,""), chain = [];
  for (let k=0; k<8; k++){
    const exact = z.filter(r=>r.name===n && r.type===type);
    if (exact.length) return {answers:exact, chain};
    const c = z.find(r=>r.name===n && r.type==="CNAME");
    if (c && type!=="CNAME"){ chain.push(c); n = pn(c.value).replace(/\.$/,""); continue; }
    return chain.length ? {answers:[], chain} : null;
  }
  return null;
}
function ptrName(ip){ return intToIp(ip).split(".").reverse().join(".")+".in-addr.arpa"; }
function resolveName(net, src, name, type, serverIp){
  type = (type||"A").toUpperCase();
  const c = hostCfg(net, src);
  if (!c.ok) return {ok:false, why:c.why};
  if (ipToInt(name)!=null){ type = "PTR"; name = ptrName(ipToInt(name)); }
  const q = pn(name).replace(/\.$/,"");
  if (type==="A" && !serverIp){
    const hf = Object.entries(src.hosts||{}).find(([k])=>pn(k)===q);
    if (hf) return {ok:true, ip:ipToInt(hf[1]), answers:[{type:"A", value:hf[1], name:q}], hostsFile:true};
  }
  const sip = serverIp!=null ? serverIp : c.dns;
  if (sip==null) return {ok:false, noServer:true, why:`${src.name} has no DNS server configured`};
  const x = exchange(net, {src:c.ip, dst:sip, proto:"udp", port:53}, {type:"host", dev:src, cfg:c}, src.id);
  if (!x.ok) return {ok:false, timeout:true, server:sip, why:`DNS server ${intToIp(sip)} is unreachable: ${x.why}`};
  const s = x.ep.dev;
  const finish = (res, nonAuth, sname) => {
    if (!res || !res.answers.length) return {ok:false, nx:true, server:sip, serverName:sname, why:`${s.name} has no ${type} record for ${q}`};
    const a = res.answers[0];
    return {ok:true, ip: a.type==="A" ? ipToInt(a.value) : null, answers:res.answers, chain:res.chain, server:sip, serverName:sname, nonAuth};
  };
  if (s.kind==="cloud" || x.ep.internet){ const cl = s.kind==="cloud" ? s : net.devs.find(d=>d.kind==="cloud"); return finish(cl ? zoneLookup(zoneOf(cl), q, type) : null, true, "dns.google"); }
  const z = zoneOf(s);
  if (!z.length && !s.forwarder) return {ok:false, timeout:true, server:sip, why:`${s.name} (${intToIp(sip)}) isn't running DNS`};
  if (s.poisoned){ const p = Object.entries(s.poisoned).find(([k])=>pn(k)===q); if (p) return {ok:true, ip:ipToInt(p[1]), answers:[{type:"A", value:p[1], name:q}], server:sip, serverName:pn(s.name), nonAuth:true, poisoned:true}; }
  const local = zoneLookup(z, q, type);
  if (local && local.answers.length) return finish(local, false, pn(s.name));
  const fwd = ipToInt(s.forwarder);
  if (fwd!=null){
    const sc = hostCfg(net, s);
    const y = sc.ok ? exchange(net, {src:sc.ip, dst:fwd, proto:"udp", port:53}, {type:"host", dev:s, cfg:sc}, s.id) : {ok:false};
    if (!y.ok) return {ok:false, servfail:true, server:sip, serverName:pn(s.name), why:`${s.name} couldn't reach its forwarder ${intToIp(fwd)}${y.why ? ": "+y.why : ""}`};
    const cl = y.ep.dev.kind==="cloud" ? y.ep.dev : net.devs.find(d=>d.kind==="cloud");
    return finish(cl ? zoneLookup(zoneOf(cl), local && local.chain.length ? local.chain.at(-1).value : q, type) : null, true, pn(s.name));
  }
  return finish(local, false, pn(s.name));
}
/* ---- security posture checks ---- */
function arpSpoofer(net, host){
  const c = hostCfg(net, host); if (!c.ok || c.gw==null) return null;
  for (const e of hostDomain(net, host)){
    if (!isHost(e.dev) || !e.dev.arpSpoof || e.dev.id===host.id) continue;
    if (ipToInt(e.dev.arpSpoof)!==c.gw) continue;
    const p = hostPort(net, e.dev), l = p && linkAt(net, e.dev.id, p), sw = l && net.byId[l.dev];
    if (sw && isSwitch(sw) && sw.dai && !(swPort(sw, l.port)||{}).trusted) continue;
    return e.dev;
  }
  return null;
}
function macFlooders(net, sw){ return sw.ports.filter(p=>{ const l = linkAt(net, sw.id, p.name); const nb = l && net.byId[l.dev]; return nb && nb.macFlood && net.links[l.li].st.up; }); }
/* ---- goals ---- */
const FIELD_LABEL = {ip:"IP address", mask:"subnet mask", gw:"default gateway", dns:"DNS server"};
function fieldEq(field, val, equals){
  const list = [].concat(equals).map(String);
  if (field==="mask") { const n = maskLen(val); return n!=null && list.some(e=>maskLen(e)===n); }
  return list.map(x=>cn(x)).includes(cn(val));
}
function resolveTarget(net, src, to){
  const ip = ipToInt(to); if (ip!=null) return {ip};
  const r = resolveName(net, src, to);
  return r.ok && r.ip!=null ? {ip:r.ip, dns:r} : {err:`name lookup for ${to} failed: ${r.why || "no address"}`};
}
function evalGoal(net, g){
  net.reset();
  const D = id => net.byId[id];
  switch (g.type){
    case "dhcp": {
      const d = D(g.host); if (!d) return {pass:false, why:"device missing"};
      const c = hostCfg(net, d);
      if (d.mode!=="dhcp") return {pass:false, why:`${d.name} isn't set to use DHCP`};
      if (!c.ok || c.apipa) return {pass:false, why: c.exhausted ? `the DHCP scope is out of addresses, so ${d.name} fell back to APIPA` : (net.leases && net.leases[d.id] && net.leases[d.id].snooped) ? `DHCP snooping dropped the offer to ${d.name} (the port toward the server isn't trusted)` : `${d.name} got no DHCP offer and fell back to an APIPA 169.254.x.x address`};
      if (g.server && c.serverId!==g.server) return {pass:false, why:`${d.name} took a lease from ${c.serverName}, not the legitimate server`};
      if (g.ip && intToIp(c.ip)!==g.ip) return {pass:false, why:`${d.name} leased ${intToIp(c.ip)} instead of its reserved address ${g.ip}`};
      if (c.conflict) return {pass:false, why:`${d.name} was leased ${intToIp(c.ip)}, which a statically addressed device already uses`};
      return {pass:true, why:`${d.name} leased ${intToIp(c.ip)}`};
    }
    case "config": {
      const d = D(g.dev); if (!d) return {pass:false, why:"device missing"};
      let obj = d; if (g.port) obj = swPort(d, g.port); else if (g.iface) obj = (d.ifaces||[]).find(i=>pn(i.name)===pn(g.iface));
      const v = obj ? obj[g.field] : undefined; const ok = obj && fieldEq(g.field, v, g.equals);
      return {pass:!!ok, why: ok ? "Set correctly" : `${d.name}${g.port?" "+g.port:""}${g.iface?" "+g.iface:""} ${FIELD_LABEL[g.field]||g.field} is ${v==null||v===""?"empty":v}`};
    }
    case "dns": {
      const src = D(g.from); if (!src) return {pass:false, why:"device missing"};
      const r = resolveName(net, src, g.name, g.rtype||"A");
      if (!r.ok) return {pass:g.expect===false, why:r.why};
      const vals = r.answers.map(a=>pn(a.value));
      const ok = g.value ? vals.includes(pn(g.value)) : true;
      return {pass: ok !== (g.expect===false), why: ok ? `${g.name} resolves to ${vals.join(", ")}` : `${g.name} resolves to ${vals.join(", ")}, not ${g.value}${r.poisoned ? " (the DNS cache has been poisoned)" : ""}`};
    }
    case "conn": case "ping": {
      const src = D(g.from); if (!src) return {pass:false, why:"device missing"};
      const expect = g.expect!==false;
      const t = resolveTarget(net, src, g.to);
      let r = t.err ? {ok:false, why:t.err} : g.type==="ping" ? hostPing(net, src, t.ip, {size:g.size, df:g.df}) : hostConn(net, src, t.ip, g.proto||"tcp", g.port);
      if (r.ok && expect){
        if (r.m && r.m.loss>=0.1) r = {ok:false, why:`only ${Math.round((1-r.m.loss)*100)}% of packets get through (${describeLoss(net, src)})`};
        const spoof = arpSpoofer(net, src);
        if (r.ok && spoof && g.secure) r = {ok:false, why:`traffic is passing through ${spoof.name}, which is ARP spoofing the gateway (on-path attack)`};
      }
      const what = g.type==="ping" ? "" : ` on ${(g.proto||"tcp").toUpperCase()} ${g.port}`;
      return {pass:r.ok===expect, why: r.ok ? `${src.name} reached ${g.to}${what}` : r.why};
    }
    case "perf": {
      const src = D(g.from); const t = resolveTarget(net, src, g.to);
      if (t.err) return {pass:false, why:t.err};
      const r = hostPing(net, src, t.ip); if (!r.ok) return {pass:false, why:r.why};
      const bw = Math.round(r.m.bw), lat = r.m.lat;
      if (g.minMbps && bw < g.minMbps) return {pass:false, why:`throughput is only about ${bw} Mbps (needs ${g.minMbps})`};
      if (g.maxLoss!=null && r.m.loss > g.maxLoss) return {pass:false, why:`${Math.round(r.m.loss*100)}% packet loss`};
      if (g.maxLatency && lat > g.maxLatency) return {pass:false, why:`latency is about ${Math.round(lat)} ms`};
      return {pass:true, why:`about ${bw} Mbps, ${Math.round(lat)} ms, ${Math.round(r.m.loss*100)}% loss`};
    }
    case "state": return evalState(net, g);
  }
  return {pass:false, why:"unknown goal"};
}
function describeLoss(net, src){
  const p = hostPort(net, src);
  const hints = [];
  for (const L of net.links){ if (L.st.dupMismatch) hints.push("a duplex mismatch"); if (L.st.attenuation) hints.push("a cable run longer than the standard allows"); if (L.st.errors.crc && !L.st.attenuation && !L.st.dupMismatch) hints.push("a damaged or badly terminated cable"); if (L.st.util>0.85) hints.push("a congested link"); }
  return [...new Set(hints)].join(", ") || "errors on the path";
}
function evalState(net, g){
  const d = net.byId[g.dev];
  switch (g.check){
    case "root": { const r = net.stp.roles[g.dev]; return r && r.root===g.dev ? {pass:true, why:`${d.name} is the root bridge`} : {pass:false, why:`the root bridge is ${r ? net.byId[r.root].name : "unknown"}, not ${d.name}`}; }
    case "noStorm": return net.stp.storm.size ? {pass:false, why:"a switching loop is causing a broadcast storm (spanning tree is disabled on a switch in the loop)"} : {pass:true, why:"no loops"};
    case "portUp": { const l = linkAt(net, g.dev, g.port); const st = l && net.links[l.li].st; return st && st.up ? {pass:true, why:`${g.port} is up`} : {pass:false, why:`${d.name} ${g.port} is down${st ? ": "+st.reason : ""}`}; }
    case "powered": return !d._off ? {pass:true, why:`${d.name} is powered`} : {pass:false, why:`${d.name} isn't getting power${d.poe ? " over Ethernet (budget or PoE standard)" : ""}`};
    case "bundle": { const ls = net.links.filter(l=>(l.a===g.dev || l.b===g.dev) && l.bundle); const want = g.members||2; return ls.filter(l=>l.st.up).length>=want ? {pass:true, why:"the port-channel is bundled"} : {pass:false, why: net.links.some(l=>(l.a===g.dev||l.b===g.dev) && l.bundleFail) ? `the port-channel didn't form (modes ${net.links.find(l=>(l.a===g.dev||l.b===g.dev) && l.bundleFail).bundleFail})` : "the links aren't bundled"}; }
    case "noVlanHop": { const bad = (d.ports||[]).filter(p=>{ const l = linkAt(net, d.id, p.name); const nb = l && net.byId[l.dev]; return nb && isHost(nb) && (p._dtpTrunk || p.mode==="trunk"); }); return bad.length ? {pass:false, why:`${bad.map(p=>p.name).join(", ")} on ${d.name} will trunk with an end device (switch spoofing / VLAN hopping)`} : {pass:true, why:"user ports can't negotiate trunks"}; }
    case "macSafe": { const f = macFlooders(net, d); return f.length ? {pass:false, why:`${d.name} ${f.map(p=>p.name).join(", ")} is flooding the MAC table`} : {pass:true, why:"no MAC flooding"}; }
    case "arpSafe": { const h = net.byId[g.host]; const s = arpSpoofer(net, h); return s ? {pass:false, why:`${s.name} is ARP spoofing ${h.name}'s gateway`} : {pass:true, why:"ARP table is clean"}; }
    case "unusedDown": { const open = (d.ports||[]).filter(p=>!linkAt(net, d.id, p.name) && !p.shutdown); return open.length ? {pass:false, why:`unused ports still enabled: ${open.map(p=>p.name).join(", ")}`} : {pass:true, why:"unused ports are shut down"}; }
    case "route": { const r = lookupRoute(net, d, ipToInt(g.to)); const want = g.via ? ipToInt(g.via) : null; return r && (want==null || r.via===want) && (!g.rtype || r.type===g.rtype) ? {pass:true, why:`${d.name} routes ${g.to} via ${r.via!=null?intToIp(r.via):r.iface.name}`} : {pass:false, why: r ? `${d.name} routes ${g.to} via ${r.via!=null ? intToIp(r.via) : r.iface.name} (${r.type})` : `${d.name} has no route to ${g.to}`}; }
    case "ospfNeighbor": { const o = ospfRoutes(net); const ok = (o.adj[g.dev]||[]).some(e=>e.to===g.peer); return ok ? {pass:true, why:"OSPF adjacency is up"} : {pass:false, why:`${d.name} and ${net.byId[g.peer].name} aren't OSPF neighbors`}; }
  }
  return {pass:false, why:"unknown check"};
}
/* ---- solutions ---- */
function applySolution(devices, steps, links){
  for (const s of steps||[]){
    if (s.link && links){ const L = links.find(l=>(l[0]===s.link[0] && pn(l[1])===pn(s.link[1])) || (l[2]===s.link[0] && pn(l[3])===pn(s.link[1]))); if (L){ L[4] = Object.assign({}, L[4]||{}, s.set); } continue; }
    const d = devices.find(x=>x.id===s.dev); if (!d) continue;
    if (s.acl){ d.acls = d.acls||{}; d.acls[s.acl] = sclone(s.rules||[]); continue; }
    if (s.routes){ d.routes = sclone(s.routes); continue; }
    if (s.zone){ d.zone = sclone(s.zone); continue; }
    if (!s.set) continue;
    let target = d;
    if (s.port) target = (d.ports||[]).find(p=>pn(p.name)===pn(s.port));
    else if (s.iface) target = (d.ifaces||[]).find(i=>pn(i.name)===pn(s.iface));
    else if (s.pool!=null) target = (d.dhcp||[])[s.pool];
    if (target){ Object.assign(target, sclone(s.set)); if (s.set.shutdown===false || s.set.errDisabled===false) target.errDisabled = false; }
  }
  return devices;
}
const SOL_FIELDS = {ip:"IP address", mask:"subnet mask", gw:"default gateway", dns:"DNS server", mode:"mode", vlan:"access VLAN", allowed:"allowed VLANs", helper:"DHCP helper (ip helper-address)", defaultRoute:"default route next hop", start:"pool start", end:"pool end", network:"pool network", native:"native VLAN", voice:"voice VLAN", speed:"speed", duplex:"duplex", priority:"priority", cable:"cable", length:"cable length", sfp:"transceiver", lacp:"LACP mode", channel:"channel-group", acl:"inbound ACL", aclOut:"outbound ACL", nat:"NAT role", mtu:"MTU", trusted:"DHCP snooping trust", dhcpSnooping:"DHCP snooping", dai:"Dynamic ARP Inspection", vip:"virtual IP", vipPriority:"FHRP priority", poeStd:"PoE standard", poeBudget:"PoE budget (W)", publicIp:"public IP", forwarder:"DNS forwarder", exclusions:"excluded range"};
function fmtVal(v){ return Array.isArray(v) ? v.join(", ") : typeof v==="object" && v ? Object.entries(v).map(([k,x])=>`${k} ${x}`).join(", ") : String(v); }
function solutionText(t){
  return (t.solution||[]).map(s=>{
    const d = t.devices.find(x=>x.id===s.dev); const name = d ? d.name : (s.link ? `Cable at ${(t.devices.find(x=>x.id===s.link[0])||{}).name||s.link[0]} ${s.link[1]}` : s.dev);
    if (s.acl) return `${name}: set access list ${s.acl} to ${s.rules.map((r,i)=>`${i+1}) ${r.action} ${r.proto||"ip"} ${r.src||"any"} ${r.dst||"any"}${r.port&&r.port!=="any"?" port "+r.port:""}`).join("; ")}`;
    if (s.routes) return `${name}: static routes ${s.routes.map(r=>`${r.net} via ${r.via}`).join("; ")}`;
    if (s.zone) return `${name}: DNS records ${s.zone.map(r=>`${r.name} ${r.type} ${r.value}`).join("; ")}`;
    const where = s.port ? ` ${s.port}` : s.iface ? ` ${s.iface}` : s.pool!=null ? ` DHCP scope ${Number(s.pool)+1}` : "";
    const sets = Object.entries(s.set||{}).map(([k,v])=>{
      if (k==="shutdown") return v ? "shut it down" : "enable it (shutdown, then no shutdown clears err-disabled)";
      if (k==="power") return v ? "power it on" : "disconnect it (power off)";
      if (k==="stp") return `set spanning tree ${v.enabled===false?"off":"on"}${v.priority!=null?`, bridge priority ${v.priority}`:""}`;
      if (k==="portSecurity") return v.enabled ? `enable port security (max ${v.max||1} MAC${(v.max||1)>1?"s":""}, violation ${v.violation||"shutdown"})` : "disable port security";
      if (k==="ospf") return v.enabled ? `enable OSPF area ${v.area||0}` : "disable OSPF";
      if (k==="fw") return `allow inbound ${(v.rules||[]).map(r=>`${r.proto}${r.port?" "+r.port:""} from ${r.src||"any"}`).join(", ")}`;
      if (k==="mode" && d && isHost(d)) return `set IP assignment to ${v==="dhcp"?"DHCP":"static"}`;
      if (s.pool!=null && k==="gw") return `set the router (default gateway) option to ${v}`;
      if (s.pool!=null && k==="dns") return `set the DNS server option to ${v}`;
      if (k==="cable") return `replace the cable with ${CABLES[v] ? CABLES[v].name : v}`;
      return `set ${SOL_FIELDS[k]||k} to ${fmtVal(v)}`;
    });
    return `${name}${where}: ${sets.join(", ")}`;
  });
}
function checkNetTask(t){
  const start = makeNet(sclone(t.devices), sclone(t.links));
  const startRes = t.goals.map(g=>evalGoal(start, g));
  const L = sclone(t.links), D = applySolution(sclone(t.devices), t.solution, L);
  const solved = makeNet(D, L);
  const res = t.goals.map(g=>evalGoal(solved, g));
  return {startAllPass: startRes.every(r=>r.pass), solvedAllPass: res.every(r=>r.pass), res, startRes};
}

/* Lab Bench simulation engine: terminals. MIT License. */

const longIf = s => String(s).replace(/^gi(?=\d)/i,"GigabitEthernet").replace(/^fa(?=\d)/i,"FastEthernet").replace(/^te(?=\d)/i,"TenGigabitEthernet").replace(/^po(?=\d)/i,"Port-channel");
const shortIf = s => String(s).replace(/^gigabitethernet/i,"Gi").replace(/^fastethernet/i,"Fa").replace(/^tengigabitethernet/i,"Te");
const pad = (s,n) => String(s).padEnd(n);
const TTL0 = d => d.kind==="cloud" ? 117 : isRouterLike(d) ? 255 : d.os==="linux" || d.kind==="printer" || d.kind==="phone" || d.kind==="ap" ? 64 : 128;
function pingStats(r, n){
  if (!r.ok) return 0;
  const loss = r.m ? r.m.loss : 0;
  if (loss<=0) return n;
  return Math.max(0, Math.min(n-1, Math.round(n*(1-loss))));
}
function rtt(r){ const base = r.m ? r.m.lat : 0; return Math.max(0, Math.round(base + (r.ep && r.ep.internet ? 14 : r.hops && r.hops.length ? 1 : 0))); }
function parseArgs(raw){ return raw.trim().split(/\s+/).slice(1); }
function targetOf(net, src, name){
  let ip = ipToInt(name);
  if (ip!=null) return {ip, label:name};
  const r = resolveName(net, src, name);
  if (!r.ok || r.ip==null) return {err:r};
  return {ip:r.ip, label:`${name} [${intToIp(r.ip)}]`};
}
/* ---------- Windows ---------- */
function winPing(net, d, raw){
  const a = parseArgs(raw); let n = 4, size = 32, df = false, target = null;
  for (let i=0;i<a.length;i++){ const x = a[i].toLowerCase(); if (x==="-n") n = Math.min(10, Number(a[++i])||4); else if (x==="-l") size = Number(a[++i])||32; else if (x==="-f") df = true; else if (x==="-t") n = 6; else if (!x.startsWith("-")) target = a[i]; }
  if (!target) return "\nUsage: ping [-n count] [-l size] [-f] target_name";
  const t = targetOf(net, d, target);
  if (t.err) return `Ping request could not find host ${target}. Please check the name and try again.`;
  const r = hostPing(net, d, t.ip, {size, df});
  const head = `\nPinging ${t.label} with ${size} bytes of data:\n`;
  const stats = rx => `\n\nPing statistics for ${intToIp(t.ip)}:\n    Packets: Sent = ${n}, Received = ${rx}, Lost = ${n-rx} (${Math.round((n-rx)/n*100)}% loss),`;
  if (r.ok){
    const rx = pingStats(r, n), ms = rtt(r), jit = r.m ? r.m.jitter||0 : 0;
    const ttl = TTL0(r.ep.dev) - r.hops.length + (isRouterLike(r.ep.dev) && r.hops.length ? 1 : 0);
    const lines = []; let got = 0; const lostIdx = new Set(); for (let i=1; lostIdx.size < n-rx && i<n*2; i+=2) lostIdx.add(i % n);
    for (let i=0;i<n;i++){
      if (lostIdx.has(i)){ lines.push("Request timed out."); continue; }
      const t2 = Math.max(0, ms + (jit ? ((i*37)%(2*jit+1))-jit : 0));
      lines.push(`Reply from ${intToIp(t.ip)}: bytes=${Math.min(size, 65500)} time${t2<1?"<1":"="+t2}ms TTL=${ttl}`); got++;
    }
    return head + lines.join("\n") + stats(got) + (got ? `\nApproximate round trip times in milli-seconds:\n    Minimum = ${Math.max(0,ms-jit)}ms, Maximum = ${ms+jit}ms, Average = ${ms}ms` : "");
  }
  if (r.code==="frag") return head + Array(n).fill("Packet needs to be fragmented but DF set.").join("\n") + stats(0);
  if (r.code==="general") return head + Array(n).fill("PING: transmit failed. General failure.").join("\n") + stats(0);
  if (r.code==="hostunreach") return head + Array(n).fill(`Reply from ${intToIp(r.srcIp)}: Destination host unreachable.`).join("\n") + stats(n);
  if (r.code==="netunreach" && r.at!=null) return head + Array(n).fill(`Reply from ${intToIp(r.at)}: Destination net unreachable.`).join("\n") + stats(n);
  if (r.code==="ttl" && r.hops.length) return head + Array(n).fill(`Reply from ${intToIp(r.hops.at(-1))}: TTL expired in transit.`).join("\n") + stats(n);
  if (r.code==="acl" && r.at!=null) return head + Array(n).fill(`Reply from ${intToIp(r.at)}: Destination net unreachable.`).join("\n") + stats(n);
  return head + Array(n).fill("Request timed out.").join("\n") + stats(0);
}
function traceLines(net, d, ip, style){
  const r = hostPing(net, d, ip);
  const out = []; let n = 1;
  const row = (addr, ms) => style==="linux" ? ` ${String(n++).padStart(2)}  ${addr} (${addr})  ${ms} ms  ${ms} ms  ${ms} ms` : `  ${String(n++).padStart(2)}    ${ms<1?"<1":ms} ms    ${ms<1?"<1":ms} ms    ${ms<1?"<1":ms} ms  ${addr}`;
  const star = () => style==="linux" ? ` ${String(n++).padStart(2)}  * * *` : `  ${String(n++).padStart(2)}     *        *        *     Request timed out.`;
  if (r.code==="general") return null;
  const hops = r.hops || [];
  const shown = r.ok && isRouterLike(r.ep.dev) && hops.length ? hops.slice(0,-1) : hops;
  if (r.code==="ttl"){ for (let k=0;k<6;k++) out.push(row(intToIp(hops[k%Math.max(1,hops.length)]||0), k+1)); out.push(star()); return out; }
  shown.forEach((h,i)=>out.push(row(intToIp(h), i===0 ? 0 : 2+i*3)));
  if (r.ok) out.push(row(intToIp(ip), r.ep.internet ? 14 : 1));
  else for (let k=0;k<3;k++) out.push(star());
  return out;
}
function winTracert(net, d, raw){
  const target = parseArgs(raw).filter(x=>!x.startsWith("-")).pop();
  if (!target) return "\nUsage: tracert target_name";
  const t = targetOf(net, d, target);
  if (t.err) return `Unable to resolve target system name ${target}.`;
  const lines = traceLines(net, d, t.ip, "win");
  if (!lines) return "Unable to contact IP driver. General failure.";
  return `\nTracing route to ${t.label}\nover a maximum of 30 hops\n\n${lines.join("\n")}\n\nTrace complete.`;
}
function nslookupOut(net, d, raw, linux){
  const a = parseArgs(raw); let type = "A", name = null, server = null;
  for (const x of a){ const m = x.match(/^-(?:type|q|querytype)=(\w+)/i); if (m) type = m[1].toUpperCase(); else if (!name) name = x; else server = x; }
  if (!name) return "Usage: nslookup [-type=A|AAAA|MX|CNAME|NS|TXT|PTR] name [server]";
  const c = hostCfg(net, d);
  const sip = server ? ipToInt(server) : (c.ok ? c.dns : null);
  if (sip==null) return "*** Default servers are not available\nServer:  UnKnown\nAddress:  127.0.0.1\n\n*** UnKnown can't find "+name+": No response from server";
  const r = resolveName(net, d, name, type, sip);
  if (r.timeout) return `DNS request timed out.\n    timeout was 2 seconds.\nServer:  UnKnown\nAddress:  ${intToIp(sip)}\n\nDNS request timed out.\n    timeout was 2 seconds.\n*** Request to UnKnown timed-out`;
  const head = `Server:  ${r.serverName||"UnKnown"}\nAddress:  ${intToIp(sip)}\n\n`;
  if (!r.ok) return head + (r.servfail ? `*** ${r.serverName} can't find ${name}: Server failed` : `*** ${r.serverName||"UnKnown"} can't find ${name}: Non-existent domain`);
  const q = ipToInt(name)!=null ? ptrName(ipToInt(name)) : name;
  let body = r.nonAuth ? "Non-authoritative answer:\n" : "";
  const types = r.answers.map(x=>x.type);
  if (types[0]==="MX") body += r.answers.map(x=>`${q}\tMX preference = ${x.value.split(" ")[0]}, mail exchanger = ${x.value.split(" ").slice(1).join(" ")||x.value}`).join("\n");
  else if (types[0]==="PTR") body += r.answers.map(x=>`${q}\tname = ${x.value}`).join("\n");
  else if (types[0]==="TXT") body += r.answers.map(x=>`${q}\ttext =\n\n\t"${x.value}"`).join("\n");
  else if (types[0]==="NS") body += r.answers.map(x=>`${q}\tnameserver = ${x.value}`).join("\n");
  else if (types[0]==="CNAME") body += `${q}\tcanonical name = ${r.answers[0].value}`;
  else body += `Name:    ${r.chain && r.chain.length ? r.chain.at(-1).value : q}\n${r.answers.length>1?"Addresses":"Address"}:  ${r.answers.map(x=>x.value).join("\n          ")}` + (r.chain && r.chain.length ? `\nAliases:  ${q}` : "");
  return head + body;
}
function winIpconfig(net, d, all){
  const c = hostCfg(net, d);
  const L = (k,v) => `   ${(k+" ").padEnd(34,". ").slice(0,34).trimEnd()} : ${v}`;
  let s = "\nWindows IP Configuration\n\n";
  if (all) s += L("Host Name", d.name) + "\n\n";
  s += "Ethernet adapter Ethernet:\n\n";
  const p = hostPort(net, d); const li = p ? linkIndex(net, d.id, p) : -1;
  if (li<0 || !net.links[li].st.up) return s + L("Media State","Media disconnected");
  if (all) s += L("Physical Address", winMac(macOf(d)).toUpperCase()) + "\n" + L("DHCP Enabled", d.mode==="dhcp"?"Yes":"No") + "\n";
  if (!c.ok){ s += L("IPv4 Address", "(not configured)") + "\n"; return s; }
  s += L(c.apipa ? "Autoconfiguration IPv4 Address" : "IPv4 Address", intToIp(c.ip) + (all ? (c.conflict ? "(Duplicate)" : "(Preferred)") : "")) + "\n";
  s += L("Subnet Mask", intToIp(mInt(c.n))) + "\n";
  s += L("Default Gateway", c.gw!=null ? intToIp(c.gw) : "") + "\n";
  if (all){
    if (c.dhcp && !c.apipa) s += L("DHCP Server", c.server||"") + "\n" + L("Lease Obtained", "Today") + "\n";
    s += L("DNS Servers", c.dns!=null ? intToIp(c.dns) : "") + "\n";
  }
  return s;
}
function arpEntries(net, d){
  const c = hostCfg(net, d); if (!c.ok) return [];
  const dom = hostDomain(net, d); const out = [];
  const add = ip => { const f = findIp(net, dom, ip, d.id); if (f.ep){ let mac = f.ep.iface && f.ep.iface.vip && ipToInt(f.ep.iface.vip)===ip ? "00:00:0c:07:ac:01" : macOf(f.ep.dev); const sp = arpSpoofer(net, d); if (sp && ip===c.gw) mac = macOf(sp); out.push({ip, mac}); } };
  if (c.gw!=null && inNet(c.gw, c.ip, c.n)) add(c.gw);
  if (c.dns!=null && inNet(c.dns, c.ip, c.n)) add(c.dns);
  for (const e of dom) if (isHost(e.dev)){ const ec = hostCfg(net, e.dev); if (ec.ok && inNet(ec.ip, c.ip, c.n) && out.length<6 && !out.some(x=>x.ip===ec.ip)) out.push({ip:ec.ip, mac:macOf(e.dev)}); }
  const sp = arpSpoofer(net, d); if (sp){ const sc = hostCfg(net, sp); if (sc.ok && !out.some(x=>x.ip===sc.ip)) out.push({ip:sc.ip, mac:macOf(sp)}); }
  return out;
}
function winArp(net, d){
  const c = hostCfg(net, d); if (!c.ok) return "No ARP Entries Found.";
  const e = arpEntries(net, d);
  return `\nInterface: ${intToIp(c.ip)} --- 0x7\n  Internet Address      Physical Address      Type\n` + e.map(x=>`  ${pad(intToIp(x.ip),22)}${pad(winMac(x.mac),22)}dynamic`).join("\n") + `\n  ${pad(intToIp(bcastOf(c.ip,c.n)),22)}${pad("ff-ff-ff-ff-ff-ff",22)}static`;
}
function routePrint(net, d){
  const c = hostCfg(net, d); if (!c.ok) return "No IPv4 routes configured.";
  const net0 = intToIp(netOf(c.ip,c.n)), mask = intToIp(mInt(c.n));
  return `===========================================================================\nIPv4 Route Table\n===========================================================================\nActive Routes:\nNetwork Destination        Netmask          Gateway       Interface  Metric\n` +
    (c.gw!=null ? `          0.0.0.0          0.0.0.0  ${pad(intToIp(c.gw),14)}${pad(intToIp(c.ip),15)}25\n` : "") +
    `  ${pad(net0,25)}${pad(mask,17)}${pad("On-link",14)}${pad(intToIp(c.ip),15)}281\n  ${pad(intToIp(c.ip),25)}${pad("255.255.255.255",17)}${pad("On-link",14)}${pad(intToIp(c.ip),15)}281\n        127.0.0.0        255.0.0.0         On-link     127.0.0.1    331\n===========================================================================`;
}
function netstatOut(net, d, linux){
  const sv = (d.services||[]).map(s=>s.split("/"));
  if (linux) return "Netid  State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port\n" + sv.map(([p,n])=>`${pad(p,7)}${pad(p==="tcp"?"LISTEN":"UNCONN",8)}0       ${pad(p==="tcp"?128:0,9)}0.0.0.0:${pad(n,15)}0.0.0.0:*`).join("\n");
  return "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State\n" + sv.map(([p,n])=>`  ${pad(p.toUpperCase(),7)}${pad("0.0.0.0:"+n,23)}${pad(p==="tcp"?"0.0.0.0:0":"*:*",23)}${p==="tcp"?"LISTENING":""}`).join("\n");
}
function connTest(net, d, host, port, style){
  const t = targetOf(net, d, host);
  if (t.err) return style==="win" ? `WARNING: Name resolution of ${host} failed` : `nc: getaddrinfo for host "${host}" port ${port}: Name or service not known`;
  const r = hostConn(net, d, t.ip, "tcp", Number(port));
  if (style==="win") return `\nComputerName     : ${host}\nRemoteAddress    : ${intToIp(t.ip)}\nRemotePort       : ${port}\nSourceAddress    : ${r.srcIp!=null?intToIp(r.srcIp):""}\nTcpTestSucceeded : ${r.ok?"True":"False"}` + (r.ok ? "" : `\n\nWARNING: TCP connect to (${intToIp(t.ip)} : ${port}) failed`);
  return r.ok ? `Connection to ${host} ${port} port [tcp/*] succeeded!` : r.code==="refused" ? `nc: connect to ${host} port ${port} (tcp) failed: Connection refused` : `nc: connect to ${host} port ${port} (tcp) timed out: Operation now in progress`;
}
function nmapOut(net, d, raw){
  const target = parseArgs(raw).filter(x=>!x.startsWith("-")).pop();
  if (!target) return "Usage: nmap <target>";
  const t = targetOf(net, d, target); if (t.err) return `Failed to resolve "${target}".`;
  const ping = hostPing(net, d, t.ip);
  const dst = net.devs.find(x=>isHost(x) && hostCfg(net,x).ok && hostCfg(net,x).ip===t.ip);
  const common = [[21,"ftp"],[22,"ssh"],[23,"telnet"],[25,"smtp"],[53,"domain"],[80,"http"],[110,"pop3"],[143,"imap"],[443,"https"],[445,"microsoft-ds"],[1433,"ms-sql-s"],[3306,"mysql"],[3389,"ms-wbt-server"],[8080,"http-proxy"]];
  const rows = [];
  for (const [p,name] of common){ const r = hostConn(net, d, t.ip, "tcp", p); if (r.ok) rows.push(`${pad(p+"/tcp",9)}open     ${name}`); else if (r.code==="filtered" || r.code==="acl") rows.push(`${pad(p+"/tcp",9)}filtered ${name}`); }
  const head = `Starting Nmap 7.94 ( https://nmap.org )\nNmap scan report for ${t.label}\n`;
  if (!ping.ok && !rows.length) return head + "Note: Host seems down. If it is really up, but blocking our ping probes, try -Pn";
  return head + `Host is up (0.0${Math.max(1,rtt(ping))}s latency).\nNot shown: ${common.length-rows.length} closed tcp ports (reset)\nPORT     STATE    SERVICE\n` + rows.join("\n") + (dst ? `\nMAC Address: ${macOf(dst).toUpperCase()}` : "");
}
function tcpdumpOut(net, d){
  const c = hostCfg(net, d); const iface = d.os==="linux" ? "eth0" : "Ethernet";
  let s = `tcpdump: verbose output suppressed, use -v for full protocol decode\nlistening on ${iface}, link-type EN10MB (Ethernet), snapshot length 262144 bytes\n`;
  const T = k => `10:42:0${k}.${String(100000+k*13379).slice(1)}`;
  if (d.mode==="dhcp" && (!c.ok || c.apipa)) return s + [0,1,2,3].map(k=>`${T(k)} IP 0.0.0.0.68 > 255.255.255.255.67: BOOTP/DHCP, Request from ${macOf(d)}, length 300`).join("\n") + "\n4 packets captured (DHCP DISCOVER sent, no OFFER received)";
  if (!c.ok) return s + "0 packets captured";
  const lines = [];
  if (c.gw!=null){ const r = findIp(net, hostDomain(net, d), c.gw, d.id);
    lines.push(`${T(1)} ARP, Request who-has ${intToIp(c.gw)} tell ${intToIp(c.ip)}, length 28`);
    if (r.ep) lines.push(`${T(1)} ARP, Reply ${intToIp(c.gw)} is-at ${macOf(arpSpoofer(net,d) || r.ep.dev)}, length 46`); else lines.push(`${T(2)} ARP, Request who-has ${intToIp(c.gw)} tell ${intToIp(c.ip)}, length 28`);
    const sp = arpSpoofer(net, d); if (sp) lines.push(`${T(3)} ARP, Reply ${intToIp(c.gw)} is-at ${macOf(sp)}, length 46 (unsolicited, repeated every 2s)`);
  }
  if (c.dns!=null){ const r = resolveName(net, d, "example.com");
    lines.push(`${T(4)} IP ${intToIp(c.ip)}.53122 > ${intToIp(c.dns)}.53: 1+ A? example.com. (29)`);
    if (r.ok) lines.push(`${T(5)} IP ${intToIp(c.dns)}.53 > ${intToIp(c.ip)}.53122: 1 1/0/0 A ${r.answers[0].value} (45)`);
  }
  return s + lines.join("\n") + `\n${lines.length} packets captured`;
}
function curlOut(net, d, raw){
  const u = parseArgs(raw).find(x=>/^https?:/i.test(x)) || "";
  const m = u.match(/^(https?):\/\/([^/:]+)(?::(\d+))?/i);
  if (!m) return "curl: (3) URL rejected: Malformed input to a URL function";
  const port = Number(m[3] || (m[1].toLowerCase()==="https" ? 443 : 80));
  const t = targetOf(net, d, m[2]); if (t.err) return `curl: (6) Could not resolve host: ${m[2]}`;
  const r = hostConn(net, d, t.ip, "tcp", port);
  return r.ok ? `HTTP/1.1 200 OK\nServer: ${m[2]}\nContent-Type: text/html` : r.code==="refused" ? `curl: (7) Failed to connect to ${m[2]} port ${port}: Connection refused` : `curl: (28) Failed to connect to ${m[2]} port ${port}: Connection timed out`;
}
function hostsFile(d, linux){
  const e = Object.entries(d.hosts||{});
  return (linux ? "127.0.0.1\tlocalhost\n" : "# Copyright (c) 1993-2009 Microsoft Corp.\n#\n# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.\n#\n#\t127.0.0.1       localhost\n") + e.map(([k,v])=>`${v}\t${k}`).join("\n");
}
function hostCmd(net, d, raw){
  if (d.os==="linux") return linuxCmd(net, d, raw);
  const n = cn(raw), first = n.split(" ")[0];
  if (n==="help" || n==="?") return "Commands: ipconfig [/all|/renew|/release|/flushdns], ping [-n N] [-l size] [-f] <host>, tracert <host>, nslookup [-type=X] <name> [server], arp -a, route print, netstat -an, Test-NetConnection <host> -Port <n>, nmap <host>, type hosts, hostname, getmac, cls";
  if (n==="hostname") return d.name;
  if (n==="getmac") return `\nPhysical Address    Transport Name\n=================== ==========================================================\n${winMac(macOf(d)).toUpperCase()}   \\Device\\Tcpip_{4D36E972}`;
  if (n==="ipconfig") return winIpconfig(net, d, false);
  if (n==="ipconfig /all") return winIpconfig(net, d, true);
  if (n==="ipconfig /renew"){
    if (d.mode!=="dhcp") return "\nWindows IP Configuration\n\nThe operation failed as no adapter is in the state permissible for\nthis operation.";
    const c = hostCfg(net, d);
    return c.apipa ? "\nWindows IP Configuration\n\nAn error occurred while renewing interface Ethernet : unable to contact your DHCP server. Request has timed out." : winIpconfig(net, d, false);
  }
  if (n==="ipconfig /release") return d.mode!=="dhcp" ? "\nWindows IP Configuration\n\nThe operation failed as no adapter is in the state permissible for\nthis operation." : "\nWindows IP Configuration\n\nEthernet adapter Ethernet:\n\n   (Lease released. Run ipconfig /renew to request a new one.)";
  if (n==="ipconfig /flushdns") return "\nWindows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.";
  if (first==="ping") return winPing(net, d, raw);
  if (first==="tracert") return winTracert(net, d, raw);
  if (first==="nslookup") return nslookupOut(net, d, raw);
  if (n==="arp -a" || n==="arp -g") return winArp(net, d);
  if (n==="route print" || n==="netstat -r") return routePrint(net, d);
  if (/^netstat( -an| -ano| -a)?$/.test(n)) return netstatOut(net, d);
  if (first==="test-netconnection" || first==="tnc"){ const a = parseArgs(raw); const pi = a.findIndex(x=>/^-port$/i.test(x)); return pi>=0 ? connTest(net, d, a[0], a[pi+1], "win") : winPing(net, d, "ping "+a[0]); }
  if (first==="nmap") return nmapOut(net, d, raw);
  if (/^type .*hosts$/.test(n) || n==="type hosts") return hostsFile(d, false);
  if (first==="curl" || first==="iwr") return curlOut(net, d, raw);
  return `'${raw.trim().split(/\s+/)[0]}' is not recognized in this lab. Type help to see what's available.`;
}
/* ---------- Linux ---------- */
function linuxCmd(net, d, raw){
  const n = cn(raw), a = parseArgs(raw), first = n.split(" ")[0];
  const c = hostCfg(net, d);
  if (n==="help") return "Commands: ip addr, ip route, ip neigh, ifconfig, ping [-c N] [-s size] [-M do] <host>, traceroute <host>, dig [@server] <name> [type], nslookup, host <name>, cat /etc/resolv.conf, cat /etc/hosts, ss -tuln, netstat -tuln, nc -zv <host> <port>, curl <url>, tcpdump, nmap <host>, hostname, clear";
  if (n==="hostname") return d.name.toLowerCase();
  if (n==="ip addr" || n==="ip a" || n==="ip address" || n==="ip addr show"){
    const up = c.ok; return `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu ${d.nic.mtu||1500} qdisc fq_codel state UP\n    link/ether ${macOf(d)} brd ff:ff:ff:ff:ff:ff` + (up ? `\n    inet ${intToIp(c.ip)}/${c.n} brd ${intToIp(bcastOf(c.ip,c.n))} scope global ${c.dhcp?"dynamic ":""}eth0` : "");
  }
  if (n==="ifconfig") return c.ok ? `eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu ${d.nic.mtu||1500}\n        inet ${intToIp(c.ip)}  netmask ${intToIp(mInt(c.n))}  broadcast ${intToIp(bcastOf(c.ip,c.n))}\n        ether ${macOf(d)}  txqueuelen 1000  (Ethernet)` : `eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        ether ${macOf(d)}  txqueuelen 1000  (Ethernet)`;
  if (n==="ip route" || n==="ip r" || n==="route -n") return c.ok ? (c.gw!=null ? `default via ${intToIp(c.gw)} dev eth0 proto ${c.dhcp?"dhcp":"static"}\n` : "") + `${intToIp(netOf(c.ip,c.n))}/${c.n} dev eth0 proto kernel scope link src ${intToIp(c.ip)}` : "";
  if (n==="ip neigh" || n==="arp -n" || n==="arp -a") return arpEntries(net, d).map(x=>`${intToIp(x.ip)} dev eth0 lladdr ${x.mac} REACHABLE`).join("\n");
  if (n==="cat /etc/resolv.conf") return c.ok && c.dns!=null ? `# Generated by NetworkManager\nnameserver ${intToIp(c.dns)}` : "# Generated by NetworkManager";
  if (n==="cat /etc/hosts") return hostsFile(d, true);
  if (/^(ss|netstat) -tul?n?p?$/.test(n) || n==="ss -tuln" || n==="netstat -tuln") return netstatOut(net, d, true);
  if (first==="ping"){
    let cnt = 4, size = 56, df = false, target = null;
    for (let i=0;i<a.length;i++){ if (a[i]==="-c") cnt = Math.min(10, Number(a[++i])||4); else if (a[i]==="-s") size = Number(a[++i])||56; else if (a[i]==="-M"){ df = a[++i]==="do"; } else if (!a[i].startsWith("-")) target = a[i]; }
    if (!target) return "ping: usage error: Destination address required";
    const t = targetOf(net, d, target); if (t.err) return `ping: ${target}: Temporary failure in name resolution`;
    const r = hostPing(net, d, t.ip, {size, df});
    let s = `PING ${target} (${intToIp(t.ip)}) ${size}(${size+28}) bytes of data.\n`;
    if (r.ok){ const rx = pingStats(r, cnt), ms = rtt(r); for (let i=0;i<rx;i++) s += `${size+8} bytes from ${intToIp(t.ip)}: icmp_seq=${i+1} ttl=${TTL0(r.ep.dev)-r.hops.length+(isRouterLike(r.ep.dev)&&r.hops.length?1:0)} time=${ms||0.4} ms\n`;
      return s + `\n--- ${target} ping statistics ---\n${cnt} packets transmitted, ${rx} received, ${Math.round((cnt-rx)/cnt*100)}% packet loss`; }
    if (r.code==="frag") return s + `ping: local error: message too long, mtu=${r.m.mtu}`;
    if (r.code==="general") return "ping: connect: Network is unreachable";
    if (r.code==="hostunreach") return s + Array(3).fill(0).map((_,i)=>`From ${intToIp(r.srcIp)} icmp_seq=${i+1} Destination Host Unreachable`).join("\n") + `\n\n--- ${target} ping statistics ---\n${cnt} packets transmitted, 0 received, +3 errors, 100% packet loss`;
    if (r.code==="netunreach" && r.at!=null) return s + `From ${intToIp(r.at)} icmp_seq=1 Destination Net Unreachable\n\n--- ${target} ping statistics ---\n${cnt} packets transmitted, 0 received, +1 errors, 100% packet loss`;
    return s + `\n--- ${target} ping statistics ---\n${cnt} packets transmitted, 0 received, 100% packet loss`;
  }
  if (first==="traceroute" || first==="tracepath"){
    const target = a.filter(x=>!x.startsWith("-")).pop(); if (!target) return "Usage: traceroute host";
    const t = targetOf(net, d, target); if (t.err) return `${target}: Name or service not known`;
    const lines = traceLines(net, d, t.ip, "linux"); if (!lines) return "connect: Network is unreachable";
    return `traceroute to ${target} (${intToIp(t.ip)}), 30 hops max, 60 byte packets\n` + lines.join("\n");
  }
  if (first==="dig" || first==="host" || first==="nslookup"){
    if (first==="nslookup") return nslookupOut(net, d, raw, true);
    let server = null, name = null, type = "A";
    for (const x of a){ if (x.startsWith("@")) server = ipToInt(x.slice(1)); else if (/^(a|aaaa|mx|cname|ns|txt|ptr|soa)$/i.test(x)) type = x.toUpperCase(); else if (x==="-x") type = "PTR"; else if (!x.startsWith("+")) name = x; }
    if (!name) return first==="host" ? "Usage: host name" : "; <<>> DiG 9.18 <<>>\n;; global options: +cmd\n;; Got answer: root servers (try dig <name>)";
    const r = resolveName(net, d, name, type, server);
    if (first==="host") return r.ok ? r.answers.map(x=>x.type==="MX" ? `${name} mail is handled by ${x.value}` : x.type==="PTR" ? `${name} domain name pointer ${x.value}.` : `${name} has address ${x.value}`).join("\n") : r.timeout ? `;; connection timed out; no servers could be reached` : `Host ${name} not found: 3(NXDOMAIN)`;
    if (r.timeout || r.noServer) return `; <<>> DiG 9.18 <<>> ${name}\n;; global options: +cmd\n;; connection timed out; no servers could be reached`;
    const status = r.ok ? "NOERROR" : r.servfail ? "SERVFAIL" : "NXDOMAIN";
    const q = r.ok && type==="PTR" ? ptrName(ipToInt(name)) : name;
    return `; <<>> DiG 9.18 <<>> ${name}${type!=="A"?" "+type:""}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: 4211\n;; flags: qr rd ra${r.ok && !r.nonAuth ? " aa" : ""}; QUERY: 1, ANSWER: ${r.ok?r.answers.length+(r.chain||[]).length:0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;${q}.\t\t\tIN\t${type}\n` +
      (r.ok ? `\n;; ANSWER SECTION:\n` + [...(r.chain||[]).map(x=>`${x.name}.\t\t300\tIN\tCNAME\t${x.value}.`), ...r.answers.map(x=>`${x.name||q}.\t\t300\tIN\t${x.type}\t${x.value}${/^(CNAME|NS|PTR)$/.test(x.type)?".":""}`)].join("\n") : "") +
      `\n\n;; Query time: ${r.nonAuth?24:1} msec\n;; SERVER: ${intToIp(r.server)}#53(${intToIp(r.server)}) (UDP)`;
  }
  if (first==="nc"){ const x = a.filter(y=>!y.startsWith("-")); return x.length>=2 ? connTest(net, d, x[0], x[1], "linux") : "usage: nc [-zv] host port"; }
  if (first==="curl") return curlOut(net, d, raw);
  if (first==="tcpdump") return tcpdumpOut(net, d);
  if (first==="nmap") return nmapOut(net, d, raw);
  return `${raw.trim().split(/\s+/)[0]}: command not found`;
}
/* ---------- Cisco-style switches and routers ---------- */
const reShow = (n, re) => new RegExp("^sh(o|ow)?\\s+" + re + "$").test(n);
function portStatus(net, sw, p){
  const l = linkAt(net, sw.id, p.name);
  if (p.errDisabled) return "err-disabled";
  if (p.shutdown) return "disabled";
  if (p._suspended) return "suspended";
  if (!l) return "notconnect";
  return net.links[l.li].st.up ? "connected" : "notconnect";
}
function deviceLog(net, d){
  const L = [], ts = k => `*Oct  4 09:${String(12+k).padStart(2,"0")}:0${k%10}.${100+k*7}`;
  let k = 0;
  for (const p of d.ports||[]){
    const l = linkAt(net, d.id, p.name), st = l && net.links[l.li].st;
    if (p.errDisabled) L.push(`${ts(k++)}: %PM-4-ERR_DISABLE: psecure-violation error detected on ${longIf(p.name)}, putting ${longIf(p.name)} in err-disable state`);
    if (p.errDisabled) L.push(`${ts(k++)}: %PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred on port ${longIf(p.name)}`);
    if (p._suspended) L.push(`${ts(k++)}: %EC-5-L3DONTBNDL2: ${longIf(p.name)} suspended: LACP currently not enabled on the remote port.`);
    if (st && st.dupMismatch) L.push(`${ts(k++)}: %CDP-4-DUPLEX_MISMATCH: duplex mismatch discovered on ${longIf(p.name)} (not half duplex), with ${net.byId[l.dev].name} (half duplex).`);
    if (st && !st.up && !p.shutdown && !p.errDisabled) L.push(`${ts(k++)}: %LINK-3-UPDOWN: Interface ${longIf(p.name)}, changed state to down (${st.reason})`);
    if (l && isSwitch(net.byId[l.dev])){ const q = swPort(net.byId[l.dev], l.port); if (q && p.mode==="trunk" && q.mode==="trunk" && (vnum(p.native)||1)!==(vnum(q.native)||1)) L.push(`${ts(k++)}: %CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${longIf(p.name)} (${vnum(p.native)||1}), with ${net.byId[l.dev].name} ${longIf(l.port)} (${vnum(q.native)||1}).`); }
    if (d._poe && d._poe[p.name] && d._poe[p.name].state!=="on" && d._poe[p.name].state!=="off") L.push(`${ts(k++)}: %ILPOWER-5-ILPOWER_POWER_DENY: Interface ${longIf(p.name)}: inline power denied. Reason: ${d._poe[p.name].state==="faulty" ? "the device needs a higher PoE class than this switch supports" : "insufficient power budget"}`);
    if (st && st.errors.crc) L.push(`${ts(k++)}: %LINEPROTO-5-UPDOWN: CRC errors increasing on ${longIf(p.name)}`);
  }
  if (net.stp.storm.has(d.id)) L.push(`${ts(k++)}: %SW_MATM-4-MACFLAP_NOTIF: Host ${ciscoMac(macOf(d))} in vlan 1 is flapping between port ${longIf((d.ports[0]||{}).name||"Gi0/1")} and port ${longIf((d.ports[1]||{}).name||"Gi0/2")}`);
  if (d.ports && macFlooders(net, d).length) L.push(`${ts(k++)}: %SW_MATM-4-MAC_TABLE_FULL: MAC address table is full, flooding unknown unicast frames`);
  for (const i of d.ifaces||[]){ if (i.vip && !routerIfUp(net, d, i)) L.push(`${ts(k++)}: %HSRP-5-STATECHANGE: ${longIf(i.name)} Grp 1 state Active -> Init`); }
  return `Syslog logging: enabled\n    Console logging: level debugging\n    Trap logging: level informational\n\nLog Buffer (8192 bytes):\n` + (L.length ? L.join("\n") : `${ts(0)}: %SYS-5-CONFIG_I: Configured from console by admin`);
}
function cdpNeighbors(net, d, lldp){
  const rows = [];
  for (const L of net.links){ let mine, far; if (L.a===d.id){ mine = L.pa; far = {dev:L.b, port:L.pb}; } else if (L.b===d.id){ mine = L.pb; far = {dev:L.a, port:L.pa}; } else continue;
    if (!L.st.up) continue; const nb = net.byId[far.dev]; if (!nb || (!isSwitch(nb) && !isRouterLike(nb) && !["phone","ap"].includes(nb.kind))) continue;
    rows.push(lldp ? `${pad(nb.name,21)}${pad(shortIf(mine),16)}120        ${pad(isRouterLike(nb)&&!isSwitch(nb)?"R":nb.kind==="phone"?"T":nb.kind==="ap"?"W":"B",11)}${shortIf(far.port)}` : `${pad(nb.name,17)}${pad(shortIf(mine),18)}${pad(150,10)}${pad(isRouterLike(nb)&&!isSwitch(nb)?"R":nb.kind==="phone"?"H P":nb.kind==="ap"?"T":"S I",12)}${pad(nb.kind==="phone"?"IP Phone":nb.kind==="ap"?"AIR-AP":isSwitch(nb)?"WS-C9300":"ISR4331",10)}${shortIf(far.port)}`); }
  return lldp ? `Capability codes: (R) Router, (B) Bridge, (T) Telephone, (W) WLAN Access Point\n\nDevice ID            Local Intf      Hold-time  Capability  Port ID\n${rows.join("\n")}\n\nTotal entries displayed: ${rows.length}` :
    `Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone\n\nDevice ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\n${rows.join("\n")}`;
}
function ifCounters(net, d, name){
  const P = swPort(d, name) || (d.ifaces||[]).find(i=>pn(i.name)===pn(name));
  if (!P) return "% Invalid input detected at '^' marker.";
  const l = linkAt(net, d.id, phys(P)); const st = l ? net.links[l.li].st : null;
  const status = P.errDisabled ? "down (err-disabled)" : P.shutdown ? "administratively down" : st && st.up ? "up" : "down";
  const lp = P.errDisabled ? "down (err-disabled)" : st && st.up ? "up (connected)" : "down (notconnect)";
  const isA = l && net.links[l.li].a===d.id;
  const myDup = st && st.duplex ? st.duplex[isA?0:1] : "full";
  const halfHere = st && st.dupMismatch && myDup==="half", fullHere = st && st.dupMismatch && myDup==="full";
  const crc = st && st.errors.crc ? 4182 : fullHere ? 1377 : 0, runts = fullHere ? 912 : st && st.errors.crc ? 211 : 0, giants = st && st.errors.giants ? 3307 : 0;
  const drops = st && st.errors.drops ? 18233 : 0;
  return `${longIf(P.name)} is ${status}, line protocol is ${lp}\n  Hardware is Gigabit Ethernet, address is ${ciscoMac(macOf(d))}\n  MTU ${P.mtu||1500} bytes, BW ${st && st.up ? st.nominal*1000 : 1000000} Kbit/sec, DLY 10 usec,\n     reliability ${st && st.loss ? Math.round(255*(1-st.loss)) : 255}/255, txload ${st && st.util ? Math.round(st.util*255) : 1}/255, rxload ${st && st.util ? Math.round(st.util*230) : 1}/255\n  ${myDup==="half"?"Half":"Full"}-duplex, ${st && st.up ? (st.nominal>=1000?Math.round(st.nominal/1000)+"Gb/s":st.nominal+"Mb/s") : "Auto-speed"}, media type is 10/100/1000BaseTX\n  Input queue: 0/2000/${drops?Math.round(drops/7):0}/0 (size/max/drops/flushes); Total output drops: ${drops}\n  5 minute input rate ${st && st.util ? Math.round(st.util*st.speed*1e6) : 41000} bits/sec\n     ${st && st.up ? 1840211 : 0} packets input, ${st && st.up ? 221933410 : 0} bytes, 0 no buffer\n     ${runts} runts, ${giants} giants, 0 throttles\n     ${crc+runts} input errors, ${crc} CRC, 0 frame, 0 overrun, 0 ignored\n     ${st && st.up ? 2291407 : 0} packets output, ${st && st.up ? 1622093105 : 0} bytes, 0 underruns\n     0 output errors, ${halfHere ? 1893 : 0} collisions, 0 interface resets\n     0 babbles, ${halfHere ? 288 : 0} late collision, 0 deferred`;
}
function routerShow(net, d, n){
  if (reShow(n, "ip\\s+int(erface)?\\s+br(ief)?")){
    let s = "Interface                  IP-Address      OK? Method Status                Protocol\n";
    const physSet = [...new Set((d.ifaces||[]).map(phys))].filter(p=>!/^vlan/i.test(p));
    const rows = [];
    for (const p of physSet){ if (!d.ifaces.some(i=>i.name===p)) rows.push({name:p}); rows.push(...d.ifaces.filter(i=>phys(i)===p)); }
    rows.push(...(d.ifaces||[]).filter(i=>/^vlan/i.test(i.name)));
    if (isSwitch(d)) for (const p of d.ports) rows.push({name:p.name, _port:true});
    for (const i of rows){ const c = i.ip!=null && ifCfg(i); const up = i._port ? portStatus(net, d, swPort(d,i.name))==="connected" : (c ? routerIfUp(net, d, i) : !!(linkAt(net, d.id, phys(i)) && net.links[linkAt(net, d.id, phys(i)).li].st.up));
      s += `${pad(longIf(i.name),27)}${pad(c?intToIp(c.ip):"unassigned",16)}YES ${c?"manual":"unset "} ${pad(i.shutdown?"administratively down":up?"up":"down",22)}${up?"up":"down"}\n`; }
    return s;
  }
  if (reShow(n, "ip\\s+ro(ute)?")){
    const rows = routeTable(net, d), def = rows.find(r=>r.n===0);
    let s = "Codes: L - local, C - connected, S - static, O - OSPF, * - candidate default\n\n" + (def ? `Gateway of last resort is ${intToIp(def.via)} to network 0.0.0.0\n\n` : "Gateway of last resort is not set\n\n");
    const sorted = [...rows].sort((a,b)=>a.n===0?-1:b.n===0?1:a.net-b.net);
    for (const r of sorted){
      if (r.type==="C"){ s += `C        ${intToIp(r.net)}/${r.n} is directly connected, ${longIf(r.iface.name)}\nL        ${intToIp(ifCfg(r.iface).ip)}/32 is directly connected, ${longIf(r.iface.name)}\n`; }
      else s += `${pad(r.type,9)}${intToIp(r.net)}/${r.n} [${r.ad}/${r.metric||0}] via ${intToIp(r.via)}${r.type==="O" ? ", 00:12:41, "+longIf(r.iface.name) : ""}\n`;
    }
    return s;
  }
  if (reShow(n, "access-lists?")){
    const acls = Object.entries(d.acls||{}); if (!acls.length) return "";
    return acls.map(([nm, rules])=>`Extended IP access list ${nm}\n` + rules.map((r,i)=>`    ${(i+1)*10} ${r.action} ${r.proto||"ip"} ${r.src||"any"} ${r.dst||"any"}${r.port && r.port!=="any" ? " eq "+r.port : ""}`).join("\n")).join("\n");
  }
  if (reShow(n, "ip\\s+nat\\s+tr(anslations)?")){
    const ins = (d.ifaces||[]).filter(i=>i.nat==="outside" || (!d.ifaces.some(x=>x.nat) && ifCfg(i) && !isPrivate(ifCfg(i).ip)));
    const out = ins[0] && ifCfg(ins[0]); if (!out) return "";
    const hosts = net.devs.filter(h=>isHost(h) && hostCfg(net,h).ok && !h._off).slice(0,5);
    const rows = hosts.map((h,k)=>{ const r = hostPing(net, h, ipToInt("8.8.8.8")); return r.ok && r.ep.internet && r.hops.includes(r.hops[0]) ? `udp ${intToIp(out.ip)}:${1024+k}   ${intToIp(hostCfg(net,h).ip)}:${50000+k*7}  8.8.8.8:53         8.8.8.8:53` : null; }).filter(Boolean);
    return "Pro Inside global         Inside local          Outside local         Outside global\n" + rows.join("\n");
  }
  if (reShow(n, "standby(\\s+br(ief)?)?") || reShow(n, "vrrp(\\s+br(ief)?)?")){
    const vi = (d.ifaces||[]).filter(i=>i.vip); if (!vi.length) return "";
    return "                     P indicates configured to preempt.\nInterface   Grp  Pri P State   Active          Standby         Virtual IP\n" + vi.map(i=>{ const up = routerIfUp(net, d, i); const dom = ifaceDomain(net, d, i); const act = up ? vipActive(net, [{dev:d, iface:i, m:{}}, ...dom], ipToInt(i.vip)) : null; const me = act && act.dev===d; return `${pad(shortIf(i.name),12)}1    ${pad(i.vipPriority||100,4)}P ${pad(!up?"Init":me?"Active":"Standby",8)}${pad(me?"local":act?intToIp(ifCfg(act.iface).ip):"unknown",16)}${pad(me?"unknown":"local",16)}${i.vip}`; }).join("\n");
  }
  if (reShow(n, "ip\\s+ospf\\s+nei(ghbor)?")){
    if (!d.ospf || !d.ospf.enabled) return "";
    const o = ospfRoutes(net);
    return "Neighbor ID     Pri   State           Dead Time   Address         Interface\n" + (o.adj[d.id]||[]).map(e=>`${pad(intToIp(e.via),16)}1     FULL/DR         00:00:35    ${pad(intToIp(e.via),16)}${longIf(e.out.name)}`).join("\n");
  }
  if (reShow(n, "arp") || reShow(n, "ip\\s+arp")){
    let s = "Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n";
    for (const x of upIfs(net, d)){ s += `Internet  ${pad(intToIp(x.c.ip),17)}-          ${pad(ciscoMac(macOf(d)),16)}ARPA   ${longIf(x.i.name)}\n`;
      for (const e of ifaceDomain(net, d, x.i)) if (isHost(e.dev)){ const c = hostCfg(net, e.dev); if (c.ok && inNet(c.ip, x.c.ip, x.c.n)) s += `Internet  ${pad(intToIp(c.ip),17)}${pad(2,11)}${pad(ciscoMac(macOf(e.dev)),16)}ARPA   ${longIf(x.i.name)}\n`; } }
    return s;
  }
  return null;
}
function switchShow(net, d, n){
  const ports = d.ports||[];
  const vlName = v => (d.vlanNames && d.vlanNames[v]) || (v===1 ? "default" : "VLAN"+String(v).padStart(4,"0"));
  if (reShow(n, "vl(an)?(\\s+br(ief)?)?")){
    const vl = new Set([1, ...ports.filter(p=>p.mode!=="trunk").map(p=>vnum(p.vlan)||1), ...ports.filter(p=>p.voice).map(p=>vnum(p.voice)), ...Object.keys(d.vlanNames||{}).map(Number)]);
    let s = "\nVLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n";
    for (const v of [...vl].sort((a,b)=>a-b)) s += `${pad(v,5)}${pad(vlName(v),33)}active    ${ports.filter(p=>p.mode!=="trunk" && !p._dtpTrunk && ((vnum(p.vlan)||1)===v || vnum(p.voice)===v)).map(p=>shortIf(p.name)).join(", ")}\n`;
    return s;
  }
  if (reShow(n, "int(erfaces?)?\\s+stat(us)?")){
    let s = "\nPort      Name               Status       Vlan       Duplex  Speed Type\n";
    for (const p of ports){ const l = linkAt(net, d.id, p.name), nb = l && net.byId[l.dev], st = l && net.links[l.li].st, stat = portStatus(net, d, p);
      const isA = l && net.links[l.li].a===d.id; const dup = st && st.up ? (p.duplex==="auto" ? "a-" + st.duplex[isA?0:1] : p.duplex) : p.duplex==="auto" ? "auto" : p.duplex;
      const spd = st && st.up ? (p.speed==="auto" ? "a-" + st.nominal : p.speed) : p.speed;
      s += `${pad(shortIf(p.name),10)}${pad((nb?nb.name:"").slice(0,18),19)}${pad(stat,13)}${pad(p.mode==="trunk"||p._dtpTrunk?"trunk":String(vnum(p.vlan)||1),11)}${pad(dup,8)}${pad(spd,6)}${p.sfp||"10/100/1000BaseTX"}\n`; }
    return s;
  }
  if (reShow(n, "int(erfaces?)?\\s+tr(unk)?")){
    const tr = ports.filter(p=>(p.mode==="trunk" || p._dtpTrunk) && portStatus(net, d, p)==="connected");
    if (!tr.length) return "";
    let s = "\nPort        Mode             Encapsulation  Status        Native vlan\n";
    for (const p of tr) s += `${pad(shortIf(p.name),12)}${pad(p._dtpTrunk?"desirable":"on",17)}802.1q         trunking      ${vnum(p.native)||1}\n`;
    s += "\nPort        Vlans allowed on trunk\n"; for (const p of tr) s += `${pad(shortIf(p.name),12)}${parseVlans(p.allowed)==null ? "1-4094" : String(p.allowed).replace(/\s+/g,"")}\n`;
    s += "\nPort        Vlans in spanning tree forwarding state and not pruned\n"; for (const p of tr){ const li = linkIndex(net, d.id, p.name); s += `${pad(shortIf(p.name),12)}${net.stp.blocked.has(li) ? "none (blocked by STP)" : parseVlans(p.allowed)==null ? "1-4094" : String(p.allowed).replace(/\s+/g,"")}\n`; }
    return s;
  }
  if (reShow(n, "mac(\\s+|-)address-table(\\s+.*)?")){
    let s = "          Mac Address Table\n-------------------------------------------\n\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n";
    let count = 0;
    for (const p of ports){
      if (portStatus(net, d, p)!=="connected") continue;
      const l = linkAt(net, d.id, p.name), nb = net.byId[l.dev];
      if (nb && nb.macFlood){ for (let k=0;k<4;k++) s += `${pad(vnum(p.vlan)||1,8)}${pad(ciscoMac("02"+(0x1000+k*3311).toString(16).padStart(10,"0")),18)}DYNAMIC     ${shortIf(p.name)}\n`; s += `  ... 8188 more entries learned on ${shortIf(p.name)}\n`; count += 8192; continue; }
      if (net.stp.blocked.has(l.li)) continue;
      const vlan = p.mode==="trunk" || p._dtpTrunk ? null : (vnum(p.vlan)||1);
      if (isHost(nb)){ s += `${pad(vlan||1,8)}${pad(ciscoMac(macOf(nb)),18)}DYNAMIC     ${shortIf(p.name)}\n`; count++; }
      else { for (const e of l2Domain(net, {dev:d.id, port:p.name, tag:null})) if (isHost(e.dev) || isRouterLike(e.dev)){ s += `${pad(vlan||1,8)}${pad(ciscoMac(macOf(e.dev)),18)}DYNAMIC     ${shortIf(p.name)}\n`; count++; if (count>24) break; } }
    }
    return s + `Total Mac Addresses for this criterion: ${count}`;
  }
  if (reShow(n, "spanning-tree(\\s+.*)?")){
    const R = net.stp.roles[d.id]; if (!R) return "No spanning tree instance exists.";
    if (!d.stp.enabled) return "No spanning tree instance exists.\n(spanning-tree is disabled on this switch)";
    const root = net.byId[R.root];
    let s = `VLAN0001\n  Spanning tree enabled protocol rstp\n  Root ID    Priority    ${root.stp.priority}\n             Address     ${ciscoMac(macOf(root))}\n` + (R.root===d.id ? "             This bridge is the root\n" : `             Cost        ${R.rootCost}\n             Port        ${shortIf(R.rootPort)}\n`) + `\n  Bridge ID  Priority    ${d.stp.priority}\n             Address     ${ciscoMac(macOf(d))}\n\nInterface           Role Sts Cost      Prio.Nbr Type\n------------------- ---- --- --------- -------- --------------------------------\n`;
    for (const p of ports){ const r = R.ports[p.name]; if (!r) continue; s += `${pad(shortIf(p.name),20)}${pad(r.role,5)}${pad(r.state,4)}${pad(r.cost,10)}128.${pad(ports.indexOf(p)+1,5)}${r.edge?"P2p Edge":"P2p"}\n`; }
    return s;
  }
  if (reShow(n, "etherchannel(\\s+summary)?")){
    const groups = {}; ports.filter(p=>p.channel).forEach(p=>{ (groups[p.channel] = groups[p.channel]||[]).push(p); });
    let s = "Flags:  D - down        P - bundled in port-channel\n        I - stand-alone s - suspended\n        S - Layer2      U - in use\n\nGroup  Port-channel  Protocol    Ports\n------+-------------+-----------+-----------------------------------------------\n";
    for (const [g, ps] of Object.entries(groups)){ const ok = ps.every(p=>p._bundle); const proto = ps[0].lacp && ps[0].lacp!=="on" ? "LACP" : "-"; s += `${pad(g,7)}Po${g}(${ok?"SU":"SD"})${" ".repeat(Math.max(1,8-String(g).length))}${pad(proto,12)}${ps.map(p=>`${shortIf(p.name)}(${p._bundle?"P":p._suspended?"s":portStatus(net,d,p)==="connected"?"I":"D"})`).join(" ")}\n`; }
    return s;
  }
  if (reShow(n, "power(\\s+inline)?")){
    let s = `Available:${d.poeBudget.toFixed(1)}(w)  Used:${(d._poeUsed||0).toFixed(1)}(w)  Remaining:${(d.poeBudget-(d._poeUsed||0)).toFixed(1)}(w)\n\nInterface Admin  Oper       Power   Device              Class Max\n                           (Watts)\n--------- ------ ---------- ------- ------------------- ----- ----\n`;
    for (const p of ports){ const e = d._poe && d._poe[p.name]; s += `${pad(shortIf(p.name),10)}${pad(p.poe===false?"off":"auto",7)}${pad(e?e.state:"off",11)}${pad((e?e.watts:0).toFixed(1),8)}${pad(e?e.dev:"n/a",20)}${pad(e?(e.need>15.4||e.watts>15.4?"4":"3"):"n/a",6)}${d.poeStd==="bt"?"90.0":d.poeStd==="at"?"30.0":"15.4"}\n`; }
    return s;
  }
  if (reShow(n, "port-security(\\s+.*)?")){
    let s = "Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n                (Count)       (Count)          (Count)\n---------------------------------------------------------------------------\n";
    for (const p of ports.filter(p=>p.portSecurity && p.portSecurity.enabled)){ const l = linkAt(net, d.id, p.name), nb = l && net.byId[l.dev]; s += `${pad(shortIf(p.name),13)}${pad(p.portSecurity.max||1,15)}${pad(nb && nb.macFlood ? 8192 : nb ? 1 : 0,13)}${pad(p._violation||p.errDisabled ? 1 : 0,19)}${p.portSecurity.violation==="restrict"?"Restrict":p.portSecurity.violation==="protect"?"Protect":"Shutdown"}\n`; }
    return s;
  }
  if (reShow(n, "ip\\s+dhcp\\s+snooping")){
    return `Switch DHCP snooping is ${d.dhcpSnooping?"enabled":"disabled"}\nDHCP snooping is operational on following VLANs:\n${d.dhcpSnooping ? [...new Set(ports.map(p=>vnum(p.vlan)||1))].join(",") : "none"}\n\nInterface                  Trusted    Allow option    Rate limit (pps)\n-----------------------    -------    ------------    ----------------\n` + ports.map(p=>`${pad(longIf(p.name),27)}${pad(p.trusted?"yes":"no",11)}${pad(p.trusted?"yes":"no",16)}unlimited`).join("\n");
  }
  if (reShow(n, "ip\\s+arp\\s+inspection")) return `Source Mac Validation      : Disabled\nDestination Mac Validation : Disabled\nIP Address Validation      : Disabled\n\n Vlan     Configuration    Operation   ACL Match          Static ACL\n ----     -------------    ---------   ---------          ----------\n    1     ${d.dai?"Enabled          Active":"Disabled         Inactive"}`;
  return null;
}
function runningConfig(net, d){
  let s = `Building configuration...\n\nhostname ${d.name}\n!\n`;
  if (isSwitch(d)){
    if (!d.stp.enabled) s += "no spanning-tree vlan 1\n"; else s += `spanning-tree mode rapid-pvst\n${d.stp.priority!==32768?`spanning-tree vlan 1 priority ${d.stp.priority}\n`:""}`;
    if (d.dhcpSnooping) s += "ip dhcp snooping\nip dhcp snooping vlan 1-4094\n"; if (d.dai) s += "ip arp inspection vlan 1-4094\n";
    s += "!\n";
    for (const p of d.ports){
      s += `interface ${longIf(p.name)}\n`;
      if (p.mode==="trunk"){ s += " switchport mode trunk\n"; if (parseVlans(p.allowed)!=null) s += ` switchport trunk allowed vlan ${String(p.allowed).replace(/\s+/g,"")}\n`; if ((vnum(p.native)||1)!==1) s += ` switchport trunk native vlan ${p.native}\n`; }
      else if (p.mode==="dynamic") s += " switchport mode dynamic desirable\n";
      else { s += ` switchport mode access\n switchport access vlan ${vnum(p.vlan)||1}\n`; if (p.voice) s += ` switchport voice vlan ${p.voice}\n`; }
      if (p.speed!=="auto") s += ` speed ${p.speed}\n`; if (p.duplex!=="auto") s += ` duplex ${p.duplex}\n`;
      if (p.mtu && p.mtu!==1500) s += ` mtu ${p.mtu}\n`;
      if (p.channel) s += ` channel-group ${p.channel} mode ${p.lacp||"on"}\n`;
      if (p.portSecurity && p.portSecurity.enabled) s += ` switchport port-security\n switchport port-security maximum ${p.portSecurity.max||1}\n switchport port-security violation ${p.portSecurity.violation||"shutdown"}\n`;
      if (p.trusted) s += " ip dhcp snooping trust\n"; if (p.poe===false) s += " power inline never\n";
      if (p.shutdown) s += " shutdown\n";
      s += "!\n";
    }
  }
  if (isRouterLike(d)){
    const physSet = [...new Set(d.ifaces.map(phys))];
    for (const p of physSet){
      if (!d.ifaces.some(i=>i.name===p) && !/^vlan/i.test(p)) s += `interface ${longIf(p)}\n no ip address\n!\n`;
      for (const i of d.ifaces.filter(i=>phys(i)===p)){
        s += `interface ${longIf(i.name)}\n`;
        if (vnum(i.vlan)!=null && !/^vlan/i.test(i.name)) s += ` encapsulation dot1Q ${vnum(i.vlan)}\n`;
        const c = ifCfg(i); s += c ? ` ip address ${intToIp(c.ip)} ${intToIp(mInt(c.n))}\n` : " no ip address\n";
        if (String(i.helper||"").trim()) for (const h of String(i.helper).split(/[,\s]+/)) s += ` ip helper-address ${h}\n`;
        if (i.nat) s += ` ip nat ${i.nat}\n`; if (i.acl) s += ` ip access-group ${i.acl} in\n`; if (i.aclOut) s += ` ip access-group ${i.aclOut} out\n`;
        if (i.vip) s += ` standby 1 ip ${i.vip}\n standby 1 priority ${i.vipPriority||100}\n standby 1 preempt\n${i.track?` standby 1 track ${longIf(i.track)} ${i.trackDecrement||10}\n`:""}`;
        if (i.mtu && i.mtu!==1500) s += ` ip mtu ${i.mtu}\n`;
        if (i.shutdown) s += " shutdown\n";
        s += "!\n";
      }
    }
    if (d.ospf && d.ospf.enabled) s += `router ospf 1\n${(d.ospf.passive||[]).map(p=>` passive-interface ${longIf(p)}\n`).join("")}` + upIfs(net, d).map(x=>` network ${intToIp(netOf(x.c.ip,x.c.n))} ${intToIp(~mInt(x.c.n)>>>0)} area ${d.ospf.area||0}\n`).join("") + "!\n";
    if (d.ifaces.some(i=>i.nat==="outside")) s += `ip nat inside source list NAT overload interface ${longIf(d.ifaces.find(i=>i.nat==="outside").name)}\n`;
    for (const r of d.routes||[]){ const c = parseCidr(r.net); if (c) s += `ip route ${intToIp(c.ip)} ${intToIp(mInt(c.n))} ${r.via}${r.ad?" "+r.ad:""}\n`; }
    if (ipToInt(d.defaultRoute)!=null) s += `ip route 0.0.0.0 0.0.0.0 ${d.defaultRoute}\n`;
    for (const [nm, rules] of Object.entries(d.acls||{})) s += `ip access-list extended ${nm}\n` + rules.map(r=>` ${r.action} ${r.proto||"ip"} ${r.src||"any"} ${r.dst||"any"}${r.port&&r.port!=="any"?" eq "+r.port:""}\n`).join("");
  }
  return s + "end";
}
function deviceCmd(net, d, raw){
  const n = cn(raw);
  if (n==="help" || n==="?") return isSwitch(d)
    ? "Commands: show vlan brief, show interfaces status, show interfaces <port>, show interfaces trunk, show mac address-table, show spanning-tree, show etherchannel summary, show power inline, show port-security, show ip dhcp snooping, show ip arp inspection, show cdp neighbors, show lldp neighbors, show logging, show running-config" + (d.kind==="l3switch" ? ", show ip interface brief, show ip route, show arp, show access-lists" : "")
    : "Commands: show ip interface brief, show ip route, show interfaces <name>, show access-lists, show ip nat translations, show standby brief, show ip ospf neighbor, show arp, show cdp neighbors, show lldp neighbors, show logging, show running-config, ping <ip>, traceroute <ip>";
  if (reShow(n, "run(ning-config)?") || reShow(n, "config") || n==="show startup-config") return runningConfig(net, d);
  if (reShow(n, "log(ging)?")) return deviceLog(net, d);
  if (reShow(n, "cdp\\s+nei(ghbors)?(\\s+detail)?")) return cdpNeighbors(net, d, false);
  if (reShow(n, "lldp\\s+nei(ghbors)?(\\s+detail)?")) return cdpNeighbors(net, d, true);
  const mi = n.match(/^sh(?:o|ow)?\s+int(?:erfaces?)?\s+(\S+)$/);
  if (mi && !/^(status|trunk|counters)$/.test(mi[1])){ const name = (d.ports||[]).concat(d.ifaces||[]).find(p=>pn(p.name)===pn(mi[1]) || pn(longIf(p.name))===pn(mi[1]) || pn(shortIf(p.name))===pn(shortIf(mi[1]))); return name ? ifCounters(net, d, name.name) : "% Invalid input detected at '^' marker."; }
  if (isSwitch(d)){ const s = switchShow(net, d, n); if (s!=null) return s; }
  if (isRouterLike(d)){ const s = routerShow(net, d, n); if (s!=null) return s;
    const pm = n.match(/^ping\s+(\S+)$/), tm = n.match(/^trace(route)?\s+(\S+)$/);
    if (pm || tm){
      const dst = ipToInt(pm ? pm[1] : tm[2]); if (dst==null) return "% Unrecognized host or address.";
      const src = upIfs(net, d)[0]; if (!src) return "% No usable source address.";
      const r = exchange(net, {src:src.c.ip, dst, proto:"icmp"}, {type:"router", dev:d, inIface:null}, d.id);
      if (pm) return `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${intToIp(dst)}, timeout is 2 seconds:\n${r.ok ? (r.m && r.m.loss>=0.1 ? "!.!.!" : "!!!!!") : r.code==="netunreach"?"UUUUU":"....."}\nSuccess rate is ${r.ok ? (r.m && r.m.loss>=0.1 ? 60 : 100) : 0} percent (${r.ok ? (r.m && r.m.loss>=0.1 ? 3 : 5) : 0}/5)`;
      return `Type escape sequence to abort.\nTracing the route to ${intToIp(dst)}\n\n` + (r.hops||[]).map((h,i)=>`  ${i+1} ${intToIp(h)} ${1+i} msec ${1+i} msec ${2+i} msec`).join("\n") + (r.ok ? `\n  ${(r.hops||[]).length+1} ${intToIp(dst)} 2 msec 2 msec 3 msec` : "\n  " + ((r.hops||[]).length+1) + " * * *");
    }
  }
  if (/^(conf|configure)/.test(n)) return "Configuration changes are made in the Configure tab in this lab. Use show commands here to verify them.";
  return "% Invalid input detected at '^' marker. Type help to see available commands.";
}
function runCommand(net, d, raw){ net.reset(); return isHost(d) ? hostCmd(net, d, raw) : deviceCmd(net, d, raw); }

/* Lab Bench wireless model. MIT License.
   Distances are meters on a floor plan. Signal is a simplified linear model: -35 dBm at the AP, about -75 dBm at the coverage edge. */

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

/* Lab Bench random fault generator. MIT License.
   Builds a known-good network from a template, injects 1-3 realistic faults, and keeps the result only if
   the engine confirms the faults break at least one requirement and the recorded fixes restore every one. */

function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function genRng(seed){ const r = mulberry32(seed); return {f:r, int:(a,b)=>a+Math.floor(r()*(b-a+1)), pick:arr=>arr[Math.floor(r()*arr.length)], shuffle:arr=>{ const x = arr.slice(); for (let i=x.length-1;i>0;i--){ const j = Math.floor(r()*(i+1)); [x[i],x[j]] = [x[j],x[i]]; } return x; }}; }
const NAMES = {office:["Accounting","Sales","Front-Desk","HR","Design","Support","Ops","Legal"], site:["Denver","Austin","Omaha","Tulsa","Fresno","Boise","Reno","Akron"]};
function randSubnet(R, n){
  const base = R.pick([[10, R.int(0,250), R.int(0,250)], [172, R.int(16,31), R.int(0,250)], [192,168, R.int(0,250)]]);
  const net = ((base[0]<<24)>>>0) + (base[1]<<16) + (base[2]<<8);
  const size = 2**(32-n), nets = Math.max(1, 256/size);
  return {net: (net + R.int(0, nets-1)*size)>>>0, n};
}
const hostIp = (s, k) => intToIp(s.net + k);
const maskOf = n => intToIp(mInt(n));
/* ---- templates: each returns {devices, links, goals, roles, label} that is fully working ---- */
const FAULT_TEMPLATES = {
  office(R){
    const n = R.pick([24,24,25,26]), s = randSubnet(R, n), gwK = R.pick([1, 2**(32-n)-2]);
    const gw = hostIp(s, gwK), site = R.pick(NAMES.site), pcs = R.int(2,3);
    const dev = [{id:"isp", kind:"cloud", name:"Internet", x:92, y:4, editable:false, ip:"203.0.113.1", records:{"comptia.org":"198.51.100.24","portal.example.com":"203.0.113.80"}},
      {id:"r1", kind:"router", name:`${site}-R1`, x:92, y:42, editable:true, defaultRoute:"203.0.113.1", ifaces:[{name:"Gi0/0", ip:"203.0.113.2", mask:"255.255.255.252", vlan:null, helper:""},{name:"Gi0/1", ip:gw, mask:maskOf(n), vlan:null, helper:""}]},
      {id:"sw1", kind:"switch", name:`${site}-SW1`, x:50, y:50, editable:true, ports:[]},
      {id:"srv", kind:"server", name:"DNS-01", x:8, y:28, editable:true, mode:"static", ip:hostIp(s, 10), mask:maskOf(n), gw, dns:hostIp(s,10), forwarder:"8.8.8.8", services:["tcp/443"], dnsRecords:{"intranet.local":hostIp(s,10)}}];
    const links = [["isp","WAN","r1","Gi0/0"],["r1","Gi0/1","sw1","Gi0/24"],["srv","NIC","sw1","Gi0/1"]];
    dev[2].ports.push({name:"Gi0/1", mode:"access", vlan:1},{name:"Gi0/24", mode:"access", vlan:1});
    const names = R.shuffle(NAMES.office); const goals = [];
    for (let k=0;k<pcs;k++){
      const id = "pc"+(k+1), port = "Gi0/"+(k+2);
      dev.push({id, kind:R.pick(["pc","pc","laptop"]), name:`${names[k]}-PC`, x:12+k*34, y:94, editable:true, mode:"static", ip:hostIp(s, 20+k*R.int(1,5)+k), mask:maskOf(n), gw, dns:hostIp(s,10)});
      dev[2].ports.push({name:port, mode:"access", vlan:1}); links.push([id,"NIC","sw1",port]);
      goals.push({type:"ping", from:id, to:"comptia.org", label:`${names[k]}-PC can reach comptia.org`});
    }
    goals.push({type:"conn", from:"pc1", to:"intranet.local", proto:"tcp", port:443, label:`${names[0]}-PC can open https://intranet.local`});
    goals.push({type:"perf", from:"pc1", to:hostIp(s,10), minMbps:500, maxLoss:0.01, label:`${names[0]}-PC gets 500+ Mbps to DNS-01 with no loss`});
    return {devices:dev, links, goals, label:`${site} office`, scenario:`The ${site} office has one router, one switch, a DNS server and a few PCs on ${intToIp(s.net)}/${n}. The gateway is ${gw}.`};
  },
  vlans(R){
    const v1 = R.pick([10,20,30,40]), v2 = v1 + R.pick([10,20,50]);
    const s1 = randSubnet(R, 24), s2 = {net:(s1.net + 256)>>>0, n:24};
    const dev = [{id:"r1", kind:"router", name:"R1", x:50, y:4, editable:true, defaultRoute:"", ifaces:[{name:`Gi0/0.${v1}`, vlan:v1, ip:hostIp(s1,1), mask:"255.255.255.0", helper:""},{name:`Gi0/0.${v2}`, vlan:v2, ip:hostIp(s2,1), mask:"255.255.255.0", helper:""}]},
      {id:"sw1", kind:"switch", name:"SW1", x:50, y:46, editable:true, vlanNames:{[v1]:"USERS",[v2]:"SERVERS"}, ports:[{name:"Gi0/24", mode:"trunk", vlan:1, allowed:`${v1},${v2}`},{name:"Gi0/1", mode:"access", vlan:v1},{name:"Gi0/2", mode:"access", vlan:v1},{name:"Gi0/3", mode:"access", vlan:v2}]},
      {id:"pc1", kind:"pc", name:"User-1", x:10, y:94, editable:true, mode:"static", ip:hostIp(s1,21), mask:"255.255.255.0", gw:hostIp(s1,1), dns:""},
      {id:"pc2", kind:"laptop", name:"User-2", x:45, y:94, editable:true, mode:"static", ip:hostIp(s1,22), mask:"255.255.255.0", gw:hostIp(s1,1), dns:""},
      {id:"srv", kind:"server", name:"App-01", x:88, y:94, editable:true, mode:"static", ip:hostIp(s2,10), mask:"255.255.255.0", gw:hostIp(s2,1), dns:"", services:["tcp/443"]}];
    const links = [["r1","Gi0/0","sw1","Gi0/24"],["pc1","NIC","sw1","Gi0/1"],["pc2","NIC","sw1","Gi0/2"],["srv","NIC","sw1","Gi0/3"]];
    const goals = [{type:"conn", from:"pc1", to:hostIp(s2,10), proto:"tcp", port:443, label:`User-1 can reach App-01 (${hostIp(s2,10)}) on HTTPS`},{type:"ping", from:"pc2", to:hostIp(s2,10), label:"User-2 can reach App-01"}];
    return {devices:dev, links, goals, label:"router-on-a-stick", scenario:`Users in VLAN ${v1} (${intToIp(s1.net)}/24) reach App-01 in VLAN ${v2} (${intToIp(s2.net)}/24) through R1, which routes over an 802.1Q trunk.`};
  },
  relay(R){
    const v1 = R.pick([10,100,110]), v2 = v1 + R.pick([10,20]);
    const s1 = randSubnet(R, 24), s2 = {net:(s1.net + 256*R.int(1,4))>>>0, n:24};
    const sv = hostIp(s1, R.pick([5,10,50]));
    const dev = [{id:"r1", kind:"router", name:"R1", x:50, y:4, editable:true, defaultRoute:"", ifaces:[{name:`Gi0/0.${v1}`, vlan:v1, ip:hostIp(s1,1), mask:"255.255.255.0", helper:""},{name:`Gi0/0.${v2}`, vlan:v2, ip:hostIp(s2,1), mask:"255.255.255.0", helper:sv}]},
      {id:"sw1", kind:"switch", name:"SW1", x:50, y:46, editable:true, vlanNames:{[v1]:"SERVERS",[v2]:"CLIENTS"}, ports:[{name:"Gi0/24", mode:"trunk", vlan:1, allowed:`${v1},${v2}`},{name:"Gi0/1", mode:"access", vlan:v1},{name:"Gi0/2", mode:"access", vlan:v2},{name:"Gi0/3", mode:"access", vlan:v2}]},
      {id:"srv", kind:"server", name:"DHCP-01", x:10, y:36, editable:true, mode:"static", ip:sv, mask:"255.255.255.0", gw:hostIp(s1,1), dns:sv, dnsRecords:{"files.corp.local":sv},
        dhcp:[{network:`${intToIp(s1.net)}/24`, start:hostIp(s1,100), end:hostIp(s1,199), gw:hostIp(s1,1), dns:sv},{network:`${intToIp(s2.net)}/24`, start:hostIp(s2,100), end:hostIp(s2,199), gw:hostIp(s2,1), dns:sv}]},
      {id:"c1", kind:"laptop", name:"Client-1", x:45, y:94, editable:true, mode:"dhcp", ip:"", mask:"", gw:"", dns:""},
      {id:"c2", kind:"pc", name:"Client-2", x:88, y:94, editable:true, mode:"dhcp", ip:"", mask:"", gw:"", dns:""}];
    const links = [["r1","Gi0/0","sw1","Gi0/24"],["srv","NIC","sw1","Gi0/1"],["c1","NIC","sw1","Gi0/2"],["c2","NIC","sw1","Gi0/3"]];
    const goals = [{type:"dhcp", host:"c1", label:"Client-1 gets a DHCP lease"},{type:"dhcp", host:"c2", label:"Client-2 gets a DHCP lease"},{type:"ping", from:"c1", to:"files.corp.local", label:"Client-1 can reach files.corp.local"}];
    return {devices:dev, links, goals, label:"DHCP across VLANs", scenario:`DHCP-01 (${sv}) in VLAN ${v1} hands out addresses to clients in VLAN ${v2} through R1's relay.`};
  },
  sites(R){
    const a = randSubnet(R, 24), b = {net:(a.net + 256*R.int(2,9))>>>0, n:24}, w = R.int(1,60)*4;
    const wan = n => `10.255.${R.int(0,0)+w>>8}.${(w&255)+n}`;
    const s1 = R.pick(NAMES.site), s2 = R.pick(NAMES.site.filter(x=>x!==s1));
    const wa = `10.255.0.${w+1}`, wb = `10.255.0.${w+2}`;
    const dev = [{id:"r1", kind:"router", name:`${s1}-R1`, x:25, y:28, editable:true, defaultRoute:"", ifaces:[{name:"Gi0/0", ip:wa, mask:"255.255.255.252", vlan:null, helper:""},{name:"Gi0/1", ip:hostIp(a,1), mask:"255.255.255.0", vlan:null, helper:""}], routes:[{net:`${intToIp(b.net)}/24`, via:wb}]},
      {id:"r2", kind:"router", name:`${s2}-R2`, x:75, y:28, editable:true, defaultRoute:"", ifaces:[{name:"Gi0/0", ip:wb, mask:"255.255.255.252", vlan:null, helper:""},{name:"Gi0/1", ip:hostIp(b,1), mask:"255.255.255.0", vlan:null, helper:""}], routes:[{net:`${intToIp(a.net)}/24`, via:wa}]},
      {id:"pc1", kind:"pc", name:`${s1}-PC`, x:25, y:94, editable:true, mode:"static", ip:hostIp(a,R.int(20,90)), mask:"255.255.255.0", gw:hostIp(a,1), dns:""},
      {id:"pc2", kind:"pc", name:`${s2}-PC`, x:75, y:94, editable:true, mode:"static", ip:hostIp(b,R.int(20,90)), mask:"255.255.255.0", gw:hostIp(b,1), dns:""}];
    void wan;
    const links = [["r1","Gi0/0","r2","Gi0/0"],["pc1","NIC","r1","Gi0/1"],["pc2","NIC","r2","Gi0/1"]];
    const goals = [{type:"ping", from:"pc1", to:dev[3].ip, label:`${s1}-PC can reach ${s2}-PC`},{type:"ping", from:"pc2", to:dev[2].ip, label:`${s2}-PC can reach ${s1}-PC`}];
    return {devices:dev, links, goals, label:"two sites", scenario:`${s1} (${intToIp(a.net)}/24) and ${s2} (${intToIp(b.net)}/24) connect over a point-to-point WAN link (${intToIp(ipToInt(wa)-1)}/30) using static routes.`};
  }
};
/* ---- fault injectors: f(task, R) mutates task.devices/links and returns {step(s), obj, hint} or null if not applicable ---- */
const D = (t, id) => t.devices.find(d=>d.id===id);
const hostsOf = t => t.devices.filter(d=>isHost(d) && d.mode==="static" && d.kind!=="server");
const portOf = (t, hostId) => { const l = t.links.find(l=>l[0]===hostId); return l && l[2]==="sw1" ? l[3] : null; };
const FAULTS = [
  {id:"gw", obj:"5.3", name:"incorrect default gateway", apply(t,R){ const h = R.pick(hostsOf(t)); if (!h || !h.gw) return null; const ip = ipToInt(h.gw); const bad = intToIp(netOf(ip, maskLen(h.mask)) + R.pick([254, 253, 99, 126]) % (2**(32-maskLen(h.mask))-1) || 1); if (bad===h.gw) return null; const fix = h.gw; h.gw = bad; return {steps:[{dev:h.id, set:{gw:fix}}]}; }},
  {id:"mask", obj:"1.7", name:"incorrect subnet mask", apply(t,R){ const h = R.pick(hostsOf(t)); if (!h || !h.gw) return null; const n = maskLen(h.mask), ip = ipToInt(h.ip), g = ipToInt(h.gw); for (const m of [30,29,28,27]){ if (m>n && !inNet(ip, g, m)){ const fix = h.mask; h.mask = maskOf(m); return {steps:[{dev:h.id, set:{mask:fix}}]}; } } return null; }},
  {id:"ip", obj:"5.3", name:"IP address in the wrong subnet", apply(t,R){ const h = R.pick(hostsOf(t)); if (!h) return null; const ip = ipToInt(h.ip); const fix = h.ip; h.ip = intToIp((ip + 256*R.int(1,3))>>>0); return {steps:[{dev:h.id, set:{ip:fix}}]}; }},
  {id:"dup", obj:"5.3", name:"duplicate IP address", apply(t,R){ const hs = hostsOf(t); if (hs.length<2) return null; const [a,b] = R.shuffle(hs); const fix = b.ip; b.ip = a.ip; return {steps:[{dev:b.id, set:{ip:fix}}]}; }},
  {id:"dns", obj:"3.4", name:"wrong DNS server", apply(t,R){ const hs = hostsOf(t).filter(h=>h.dns); if (!hs.length || !t.goals.some(g=>ipToInt(g.to)==null && g.to)) return null; const h = R.pick(hs); const fix = h.dns; const ip = ipToInt(h.dns); h.dns = intToIp(ip + R.int(1,9)); return {steps:[{dev:h.id, set:{dns:fix}}]}; }},
  {id:"vlan", obj:"2.2", name:"switch port in the wrong VLAN", apply(t,R){ const sw = D(t,"sw1"); if (!sw) return null; const hs = t.devices.filter(d=>isHost(d) && portOf(t, d.id)); if (!hs.length) return null; const h = R.pick(hs), p = sw.ports.find(x=>x.name===portOf(t,h.id)); if (!p || p.mode==="trunk") return null; const fix = p.vlan; p.vlan = fix===1 ? R.pick([5,99,200]) : 1; return {steps:[{dev:"sw1", port:p.name, set:{vlan:fix}}]}; }},
  {id:"shut", obj:"5.2", name:"administratively down port", apply(t,R){ const sw = D(t,"sw1"); if (!sw) return null; const p = R.pick(sw.ports.filter(x=>t.links.some(l=>l[2]==="sw1" && l[3]===x.name || l[0]==="sw1" && l[1]===x.name))); if (!p) return null; p.shutdown = true; return {steps:[{dev:"sw1", port:p.name, set:{shutdown:false}}]}; }},
  {id:"trunkmode", obj:"2.2", name:"uplink not trunking", apply(t){ const sw = D(t,"sw1"); const p = sw && sw.ports.find(x=>x.mode==="trunk"); if (!p) return null; p.mode = "access"; return {steps:[{dev:"sw1", port:p.name, set:{mode:"trunk"}}]}; }},
  {id:"allowed", obj:"2.2", name:"VLAN missing from the trunk's allowed list", apply(t,R){ const sw = D(t,"sw1"); const p = sw && sw.ports.find(x=>x.mode==="trunk" && x.allowed && x.allowed!=="all"); if (!p) return null; const vs = p.allowed.split(","); if (vs.length<2) return null; const fix = p.allowed; p.allowed = R.pick(vs); return {steps:[{dev:"sw1", port:p.name, set:{allowed:fix}}]}; }},
  {id:"subif", obj:"2.1", name:"router subinterface on the wrong VLAN tag", apply(t,R){ const r = D(t,"r1"); const i = r && R.pick(r.ifaces.filter(x=>x.vlan!=null)); if (!i) return null; const fix = i.vlan; i.vlan = fix + R.pick([1,2,100]); return {steps:[{dev:"r1", iface:i.name, set:{vlan:fix}}]}; }},
  {id:"helper", obj:"3.4", name:"missing DHCP relay (ip helper-address)", apply(t){ const r = D(t,"r1"); const i = r && r.ifaces.find(x=>x.helper); if (!i) return null; const fix = i.helper; i.helper = ""; return {steps:[{dev:"r1", iface:i.name, set:{helper:fix}}]}; }},
  {id:"scopegw", obj:"3.4", name:"wrong router option in the DHCP scope", apply(t,R){ const s = t.devices.find(d=>d.dhcp && d.dhcp.length>1); if (!s) return null; const p = s.dhcp[1]; const fix = p.gw; p.gw = intToIp(ipToInt(fix) + R.pick([253, 9, 99])); return {steps:[{dev:s.id, pool:1, set:{gw:fix}}]}; }},
  {id:"defroute", obj:"2.1", name:"wrong default route", apply(t){ const r = D(t,"r1"); if (!r || !r.defaultRoute) return null; const fix = r.defaultRoute; r.defaultRoute = "203.0.113.9"; return {steps:[{dev:"r1", set:{defaultRoute:fix}}]}; }},
  {id:"static", obj:"2.1", name:"static route with the wrong next hop", apply(t,R){ const r = R.pick([D(t,"r1"),D(t,"r2")].filter(x=>x && x.routes && x.routes.length)); if (!r) return null; const fix = sclone(r.routes); r.routes = [{net:r.routes[0].net, via:intToIp(ipToInt(r.routes[0].via) + R.pick([4,8,-2]))}]; return {steps:[{dev:r.id, routes:fix}]}; }},
  {id:"ifshut", obj:"5.3", name:"router interface shut down", apply(t,R){ const r = D(t,"r1"); const i = r && R.pick(r.ifaces.filter(x=>x.ip && !/^ext|wan/i.test(x.name))); if (!i) return null; i.shutdown = true; return {steps:[{dev:"r1", iface:i.name, set:{shutdown:false}}]}; }},
  {id:"duplex", obj:"5.2", name:"duplex mismatch", apply(t,R){ const sw = D(t,"sw1"); if (!sw) return null; const hs = t.devices.filter(d=>isHost(d) && portOf(t,d.id) && t.goals.some(g=>g.from===d.id)); if (!hs.length) return null; const p = sw.ports.find(x=>x.name===portOf(t, R.pick(hs).id)); if (!p) return null; p.speed = "100"; p.duplex = "full"; return {steps:[{dev:"sw1", port:p.name, set:{speed:"auto", duplex:"auto"}}]}; }},
  {id:"cable", obj:"5.2", name:"wrong cable category", apply(t){ if (!t.goals.some(g=>g.type==="perf")) return null; const g = t.goals.find(g=>g.type==="perf"); const l = t.links.find(l=>l[0]===g.from); if (!l) return null; l[4] = {cable:"cat3"}; return {steps:[{link:[l[0], l[1]], set:{cable:"cat6"}}]}; }},
  {id:"acl", obj:"4.3", name:"access list blocking legitimate traffic", apply(t,R){ const r = D(t,"r1"); if (!r) return null; const lan = r.ifaces.find(x=>x.ip && !/^203\./.test(x.ip) && !x.vlan) || r.ifaces.find(x=>x.vlan!=null); if (!lan) return null; r.acls = r.acls||{}; r.acls.LAN_IN = [{action:"deny", proto:R.pick(["ip","tcp","icmp"]), src:"any", dst:"any", port:"any"},{action:"permit", proto:"ip", src:"any", dst:"any"}]; lan.acl = "LAN_IN"; return {steps:[{dev:"r1", acl:"LAN_IN", rules:[{action:"permit", proto:"ip", src:"any", dst:"any"}]}]}; }}
];
function generateFaultLab(seed, opts){
  opts = opts || {};
  const R = genRng(seed);
  for (let attempt=0; attempt<40; attempt++){
    const tname = opts.template || R.pick(Object.keys(FAULT_TEMPLATES));
    const base = FAULT_TEMPLATES[tname](R);
    const t = {type:"net", prompt:"Find and fix every fault so all requirements pass.", devices:sclone(base.devices), links:sclone(base.links), goals:base.goals, solution:[]};
    const want = opts.faults || R.pick([1,2,2,3]);
    const used = [], pool = R.shuffle(FAULTS.filter(f=>!opts.only || opts.only.includes(f.id)));
    for (const f of pool){
      if (used.length>=want) break;
      const snapshot = sclone({devices:t.devices, links:t.links});
      let r = null; try { r = f.apply(t, R); } catch(e){ r = null; }
      if (!r){ t.devices = snapshot.devices; t.links = snapshot.links; continue; }
      t.solution.push(...r.steps); used.push(f);
    }
    if (!used.length) continue;
    const c = checkNetTask(t);
    if (c.startAllPass || !c.solvedAllPass) continue;
    // keep only goals so the lab is self-describing; symptoms are what users report
    const sym = c.startRes.map((r,i)=>r.pass ? null : base.goals[i].label.replace(/ can /, " can't ").replace(/ gets /," doesn't get ")).filter(Boolean);
    const objs = [...new Set(used.map(f=>f.obj).concat(["5.3"]))];
    const dom = {"1":"concepts","2":"implementation","3":"operations","4":"security","5":"troubleshooting"}[objs[0][0]];
    return {id:`gen-fault`, seed, variant:true, title:`Random fault hunt: ${base.label}`, domain:"troubleshooting", difficulty:Math.min(3, used.length), objective:"5.3", objectives:objs,
      scenario:`${base.scenario} Users report: ${sym.slice(0,3).join("; ")}.`,
      tasks:[{...t, explanation:`Faults planted: ${used.map(f=>f.name).join("; ")}. Work methodically: check addressing with ipconfig, test the gateway, then check switch ports, VLANs, trunks and router settings.`}],
      faultIds:used.map(f=>f.id), _dom:dom};
  }
  return null;
}

/* Lab Bench question generators. MIT License.
   Every question: {key, obj, prompt, options, answer:[idx], multi, explanation, source}. Keys are stable for spaced repetition. */

const OBJECTIVES = {
  "1.1":"OSI model","1.2":"Appliances, applications and functions","1.3":"Cloud concepts","1.4":"Ports, protocols and traffic types","1.5":"Media and transceivers","1.6":"Topologies and architectures","1.7":"IPv4 addressing","1.8":"Modern network environments",
  "2.1":"Routing technologies","2.2":"Switching technologies","2.3":"Wireless technologies","2.4":"Physical installations",
  "3.1":"Organizational processes and documentation","3.2":"Network monitoring","3.3":"Disaster recovery","3.4":"IPv4 and IPv6 network services","3.5":"Access and management methods",
  "4.1":"Security concepts","4.2":"Attacks","4.3":"Security features and defenses",
  "5.1":"Troubleshooting methodology","5.2":"Cabling and physical interface issues","5.3":"Network service issues","5.4":"Performance issues","5.5":"Tools and commands"
};
const DOMAIN_OF = o => ({"1":"concepts","2":"implementation","3":"operations","4":"security","5":"troubleshooting"})[String(o)[0]];
const DOMAIN_WEIGHT = {concepts:23, implementation:20, operations:19, security:14, troubleshooting:24};
function mkChoice(R, key, obj, prompt, correct, distractors, explanation, source){
  const opts = R.shuffle([correct, ...distractors.slice(0,3)]);
  return {key, obj, prompt, options:opts, answer:[opts.indexOf(correct)], multi:false, explanation, source};
}
function termQuestion(R, g, idx, dir){
  const [term, def] = g.items[idx];
  const others = R.shuffle(g.items.filter((_,i)=>i!==idx));
  if (others.length < 3){ const more = TERM_GROUPS.filter(x=>x.obj===g.obj && x!==g).flatMap(x=>x.items); others.push(...R.shuffle(more)); }
  const key = `t:${g.obj}:${g.name}:${term}:${dir}`;
  if (dir==="def") return mkChoice(R, key, g.obj, `Which term matches this description?\n\n${def}`, term, others.map(x=>x[0]), `${term}: ${def}.`, "terms");
  return mkChoice(R, key, g.obj, `What best describes ${term}?`, def, others.map(x=>x[1]), `${term}: ${def}.`, "terms");
}
const allTermKeys = () => TERM_GROUPS.flatMap((g,gi)=>g.items.flatMap((_,i)=>[["def",gi,i],["term",gi,i]]));
function portQuestion(R, i, dir){
  const [proto, port, tx] = PORTS_TABLE[i];
  const others = R.shuffle(PORTS_TABLE.filter(p=>p[1]!==port && p[0]!==proto));
  if (dir==="port") return mkChoice(R, `p:${proto}:port`, "1.4", `What is the default port for ${proto}?`, port, others.map(p=>p[1]).filter((v,j,a)=>a.indexOf(v)===j), `${proto} uses ${tx} ${port}.`, "ports");
  const same = PORTS_TABLE.filter(p=>p[1]===port).map(p=>p[0]);
  if (same.length>1){ const pick = R.pick(same); return mkChoice(R, `p:${port}:proto:${pick}`, "1.4", `Which protocol uses port ${port} by default?`, pick, others.map(p=>p[0]).filter(x=>!same.includes(x)), `Port ${port} is used by ${same.join(" and ")}.`, "ports"); }
  return mkChoice(R, `p:${port}:proto`, "1.4", `Which protocol uses port ${port} by default?`, proto, others.map(p=>p[0]), `${proto} uses ${tx} ${port}.`, "ports");
}
function acronymQuestion(R, i){
  const [a, full] = ACRONYMS[i];
  const others = R.shuffle(ACRONYMS.filter((_,j)=>j!==i)).map(x=>x[1]);
  return mkChoice(R, `a:${a}`, "acronym", `What does ${a} stand for?`, full, others, `${a}: ${full}.`, "acronyms");
}
function scenarioQuestion(R, i){
  const [obj, q, opts, ans, expl] = SCENARIOS[i];
  const order = R.shuffle(opts.map((_,k)=>k));
  const answers = [].concat(ans);
  return {key:`s:${i}`, obj, prompt:q, options:order.map(k=>opts[k]), answer:answers.map(a=>order.indexOf(a)), multi:answers.length>1, explanation:expl, source:"scenarios"};
}
/* ---- generated math questions (1.7, 1.8) ---- */
function subnetQuestion(R){
  const kind = R.pick(["hosts","prefixFor","network","broadcast","same","mask","class"]);
  const n = R.int(17,30), ip = (R.pick([10<<24, (172<<24)+(R.int(16,31)<<16), (192<<24)+(168<<16)]) + R.int(0,65535)*R.pick([1,256]) + R.int(1,254))>>>0;
  const hosts = n>=31 ? 0 : 2**(32-n)-2;
  const withSteps = (q, steps) => { q.steps = steps; return q; };
  if (kind==="hosts"){ const d = R.shuffle([2**(32-n), hosts*2+2, Math.max(2,hosts/2-1), hosts+1].filter(x=>x!==hosts)); return withSteps(mkChoice(R, `g:hosts`, "1.7", `How many usable host addresses does a /${n} subnet provide?`, String(hosts), d.map(String), `/${n} leaves ${32-n} host bits: 2^${32-n} = ${2**(32-n)} addresses, minus network and broadcast = ${hosts}.`, "generated"), hostsSteps(n)); }
  if (kind==="prefixFor"){ const need = R.int(5, 2000); let p = 30; while (p>0 && 2**(32-p)-2 < need) p--; return withSteps(mkChoice(R, `g:prefix`, "1.7", `Which prefix gives at least ${need} usable hosts with the fewest wasted addresses?`, `/${p}`, [`/${p+1}`,`/${p-1}`,`/${p-2}`].filter(x=>x!==`/${p}` && x!=="/31" && x!=="/32"), `/${p} gives ${2**(32-p)-2} hosts; /${p+1} gives only ${2**(31-p)-2}.`, "generated"), prefixForSteps(need, p)); }
  if (kind==="network"||kind==="broadcast"){ const net = netOf(ip,n), bc = bcastOf(ip,n); const right = kind==="network" ? net : bc; const d = [net, bc, net+1, bc-1, net+2**(32-n), net-2**(32-n)].filter(x=>x!==right && x>0).map(intToIp); return withSteps(mkChoice(R, `g:${kind}`, "1.7", `What is the ${kind} address of ${intToIp(ip)}/${n}?`, intToIp(right), R.shuffle([...new Set(d)]), `${intToIp(ip)}/${n}: network ${intToIp(net)}, broadcast ${intToIp(bc)}, block size ${2**(32-n)}${n>=24?"":" spread across octets"}.`, "generated"), subnetSteps(ip, n)); }
  if (kind==="same"){ const net = netOf(ip,n), size = 2**(32-n); const inside = intToIp(net + R.int(1, Math.max(1,size-2))); const outs = [intToIp(bcastOf(ip,n)+1+R.int(0,5)), intToIp(net-1-R.int(0,5)), intToIp(bcastOf(ip,n))]; return withSteps(mkChoice(R, `g:same`, "1.7", `Which address can be used by another host in the same subnet as ${intToIp(ip)}/${n}?`, inside, outs, `Usable hosts run from ${intToIp(net+1)} to ${intToIp(bcastOf(ip,n)-1)}; ${intToIp(bcastOf(ip,n))} is the broadcast.`, "generated"), subnetSteps(ip, n)); }
  if (kind==="mask"){ const m = intToIp(mInt(n)); return withSteps(mkChoice(R, `g:mask`, "1.7", `Which subnet mask equals /${n}?`, m, [intToIp(mInt(n+1)), intToIp(mInt(n-1)), intToIp(mInt(Math.max(8,n-8)))].filter(x=>x!==m), `/${n} = ${n} one bits = ${m}.`, "generated"), subnetSteps(ip, n).slice(0,1).concat(n%8 ? [`Octet values: each full octet of ones is 255; the partial octet has ${n%8} ones, worth ${[128,64,32,16,8,4,2,1].slice(0,n%8).join(" + ")} = ${256-2**(8-n%8)}.`] : [])); }
  const samples = [["10.20.1.5","Private (RFC 1918)"],["172.18.4.4","Private (RFC 1918)"],["192.168.9.9","Private (RFC 1918)"],["169.254.12.3","APIPA (link-local)"],["127.0.0.1","Loopback"],["224.0.0.5","Multicast (Class D)"],["8.8.4.4","Public"],["172.33.1.1","Public"],["203.0.113.7","Public"],["239.1.1.1","Multicast (Class D)"],["240.0.0.9","Reserved (Class E)"]];
  const [addr, right] = R.pick(samples);
  return mkChoice(R, `g:class:${addr}`, "1.7", `How should ${addr} be classified?`, right, R.shuffle(["Private (RFC 1918)","APIPA (link-local)","Loopback","Multicast (Class D)","Public","Reserved (Class E)"].filter(x=>x!==right)), `${addr} is ${right}. RFC 1918: 10/8, 172.16/12, 192.168/16. APIPA: 169.254/16. Loopback: 127/8. Multicast: 224 to 239.`, "generated");
}
function ipv6Question(R){
  const s = [["fe80::a1b2:3c4d:5e6f:7788","Link-local"],["::1","Loopback"],["ff02::1","Multicast"],["ff02::2","Multicast"],["2001:4860:4860::8888","Global unicast"],["2600:1f18::10","Global unicast"],["fd00:abcd:12::7","Unique local"],["fc00:1::1","Unique local"]];
  if (R.f()<0.35){
    const full = R.pick(["2001:0db8:0000:0000:0000:ff00:0042:8329|2001:db8::ff00:42:8329","fe80:0000:0000:0000:0204:61ff:fe9d:f156|fe80::204:61ff:fe9d:f156","2001:0db8:0000:0001:0000:0000:0000:0001|2001:db8:0:1::1","2001:0db8:85a3:0000:0000:8a2e:0370:7334|2001:db8:85a3::8a2e:370:7334"]).split("|");
    const q6 = mkChoice(R, `g:v6c:${full[0]}`, "1.8", `What is the shortest valid form of ${full[0]}?`, full[1], [full[1].replace("::",":0::"), full[1].replace(/::/,":0:0:"), full[0].replace(/0000/g,"0").replace(/:0:0:/,"::").replace(/^(.*)::(.*)::(.*)$/,"$1::$2:0:$3")+"::"].filter(x=>x!==full[1]).concat(["::"+full[1].split("::").pop()]), "Drop leading zeros in each hextet, then replace one (only one) longest run of all-zero hextets with ::.", "generated");
    q6.steps = ipv6Steps(full[0]); return q6;
  }
  const [a, right] = R.pick(s);
  return mkChoice(R, `g:v6:${a}`, "1.8", `What type of IPv6 address is ${a}?`, right, ["Link-local","Loopback","Multicast","Global unicast","Unique local"].filter(x=>x!==right), "fe80::/10 link-local, ::1 loopback, ff00::/8 multicast, fc00::/7 unique local, 2000::/3 global unicast.", "generated");
}
/* ---- catalog of static items for review and objective pools ---- */
function questionPool(){
  const pool = [];
  TERM_GROUPS.forEach((g,gi)=>g.items.forEach((_,i)=>{ pool.push({obj:g.obj, make:R=>termQuestion(R, g, i, "def"), key:`t:${g.obj}:${g.name}:${g.items[i][0]}:def`}); pool.push({obj:g.obj, make:R=>termQuestion(R, g, i, "term"), key:`t:${g.obj}:${g.name}:${g.items[i][0]}:term`}); }));
  PORTS_TABLE.forEach((p,i)=>{ pool.push({obj:"1.4", make:R=>portQuestion(R, i, "port"), key:`p:${p[0]}:port`}); pool.push({obj:"1.4", make:R=>portQuestion(R, i, "proto"), key:`p:${p[1]}:proto`}); });
  SCENARIOS.forEach((s,i)=>pool.push({obj:s[0], make:R=>scenarioQuestion(R, i), key:`s:${i}`}));
  ACRONYMS.forEach((a,i)=>pool.push({obj:"acronym", make:R=>acronymQuestion(R, i), key:`a:${a[0]}`}));
  for (let k=0;k<12;k++) pool.push({obj:"1.7", make:R=>subnetQuestion(R), key:null, generated:true});
  for (let k=0;k<5;k++) pool.push({obj:"1.8", make:R=>ipv6Question(R), key:null, generated:true});
  return pool;
}
/* ---- spaced repetition (Leitner) ---- */
const SRS_DAYS = [0, 1, 3, 7, 16, 35, 80];
function srsUpdate(rec, correct, now){
  rec = rec || {box:0, due:0, seen:0, right:0};
  rec.seen++; if (correct) rec.right++;
  rec.box = correct ? Math.min(SRS_DAYS.length-1, rec.box+1) : 0;
  rec.due = now + SRS_DAYS[rec.box]*864e5 + (correct ? 0 : 10*60e3);
  return rec;
}

/* Lab Bench step-by-step explanations. MIT License.
   Deterministic: subnetting and IPv6 steps are computed, and sim hints come from comparing the learner's
   configuration with a known-good solution and from the engine's own packet trace. */

const bin8 = n => n.toString(2).padStart(8,"0");
const dottedBin = n => [n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].map(bin8).join(".");
function subnetSteps(ip, n){
  const mask = mInt(n), net = netOf(ip, n), bc = bcastOf(ip, n), hosts = n>=31 ? 0 : 2**(32-n)-2;
  const steps = [];
  steps.push(`Write /${n} as a mask: ${n} ones followed by ${32-n} zeros, ${dottedBin(mask)}, which is ${intToIp(mask)}.`);
  if (n % 8 === 0){
    steps.push(`The mask ends exactly on an octet boundary, so the network keeps the first ${n/8} octet${n/8>1?"s":""} of ${intToIp(ip)} and sets the rest to 0: ${intToIp(net)}.`);
  } else {
    const oct = Math.floor(n/8), mv = (mask >>> (24-8*oct)) & 255, block = 256 - mv, val = (ip >>> (24-8*oct)) & 255;
    const starts = []; for (let s=0; s<256 && starts.length<7; s+=block) starts.push(s);
    steps.push(`Find the "interesting" octet, the first one where the mask isn't 255: octet ${oct+1}, where the mask is ${mv}.`);
    steps.push(`Block size = 256 - ${mv} = ${block}. Subnets in octet ${oct+1} start at multiples of ${block}: ${starts.join(", ")}${256/block>7?", and so on":""}.`);
    const start = Math.floor(val/block)*block;
    steps.push(`${intToIp(ip)} has ${val} in octet ${oct+1}, which falls in the block starting at ${start}. Keep the octets before it, use ${start}, and set any octets after it to 0: the network address is ${intToIp(net)}.`);
  }
  steps.push(`The broadcast is the last address before the next block: ${intToIp(bc)}.`);
  if (hosts) steps.push(`Usable hosts run from ${intToIp(net+1)} to ${intToIp(bc-1)}: 2^${32-n} - 2 = ${hosts} addresses (the network and broadcast can't be assigned).`);
  return steps;
}
function hostsSteps(n){ return [`/${n} leaves 32 - ${n} = ${32-n} host bits.`, `2^${32-n} = ${2**(32-n)} total addresses in the subnet.`, `Subtract the network and broadcast addresses: ${2**(32-n)} - 2 = ${2**(32-n)-2} usable hosts.`]; }
function prefixForSteps(need, p){ const bits = 32-p; return [`You need ${need} hosts, plus 2 for the network and broadcast: ${need+2} addresses.`, `Find the smallest power of 2 at least that big: 2^${bits} = ${2**bits}${bits>1?` (2^${bits-1} = ${2**(bits-1)} is too small)`:""}.`, `That's ${bits} host bits, so the prefix is 32 - ${bits} = /${p}, giving ${2**bits-2} usable hosts.`]; }
function ipv6Steps(full){
  const parts = full.split(":"), trimmed = parts.map(p=>p.replace(/^0+(?=.)/,""));
  let best = {i:-1, len:0}, cur = {i:-1, len:0};
  trimmed.forEach((p,i)=>{ if (p==="0"){ if (cur.i<0) cur = {i, len:0}; cur.len++; if (cur.len>best.len) best = {...cur}; } else cur = {i:-1, len:0}; });
  const steps = [`Drop leading zeros in each group: ${trimmed.join(":")}.`];
  if (best.len>=2){
    const out = [...trimmed.slice(0,best.i), "", ...trimmed.slice(best.i+best.len)].join(":").replace(/^:(?!:)/,"::").replace(/(?<!:):$/,"::").replace(/:{3,}/,"::");
    steps.push(`Find the longest run of all-zero groups: ${best.len} groups starting at group ${best.i+1}.`, `Replace that one run with "::" (only once, or the address becomes ambiguous): ${out}.`);
  } else steps.push("There's no run of two or more zero groups, so no :: is used.");
  return steps;
}
/* ---- sim hint ladders ---- */
const HINT_FIELDS = {
  gw:{label:"default gateway", why:"A host sends everything off its own subnet to its default gateway, which must be the router's address on that same subnet."},
  ip:{label:"IP address", why:"Each address must be unique and inside the subnet that the rest of the segment uses."},
  mask:{label:"subnet mask", why:"The mask decides which addresses the host treats as local, so it must match the subnet everyone else on the segment uses."},
  dns:{label:"DNS server", why:"Names only resolve if the host points at a reachable DNS server."},
  vlan:{label:"access VLAN", why:"An access port places its device in exactly one VLAN, which must match the device's subnet and gateway."},
  mode:{label:"port mode", why:"Links that carry several VLANs (to routers or other switches) must be 802.1Q trunks; end devices belong on access ports. Dynamic (DTP) ports can be tricked into trunking."},
  allowed:{label:"allowed VLAN list", why:"A trunk only carries VLANs on its allowed list, and both ends must allow a VLAN for it to cross."},
  native:{label:"native VLAN", why:"Untagged frames on a trunk belong to the native VLAN, which must match on both ends or two VLANs get merged."},
  voice:{label:"voice VLAN", why:"A voice VLAN lets an IP phone's tagged traffic share an access port with the PC's untagged data."},
  helper:{label:"DHCP helper address", why:"DHCP discovers are broadcasts that routers don't forward; ip helper-address relays them to the server as unicast."},
  defaultRoute:{label:"default route", why:"Without a default route a router only knows its directly connected networks."},
  routes:{label:"static routes", why:"Routers need a route to every remote network, and each next hop must be on a directly connected subnet. When two routes are equally specific, the lower administrative distance wins."},
  ospf:{label:"OSPF settings", why:"OSPF neighbors must agree on area, timers and MTU, and passive interfaces never form adjacencies."},
  acl:{label:"access list", why:"ACLs are read top-down, the first match wins, and anything not permitted hits the implicit deny."},
  nat:{label:"NAT role", why:"PAT only translates traffic that arrives on an inside interface and leaves an outside one."},
  vip:{label:"virtual gateway (FHRP)", why:"Every router in an FHRP group must share the same virtual IP, and hosts should use it rather than a router's real address."},
  stp:{label:"spanning tree", why:"STP must run wherever there are redundant links, and the lowest bridge ID (priority, then MAC) becomes root."},
  lacp:{label:"EtherChannel mode", why:"Both ends of a bundle must agree: active with active or passive, or on with on. Passive with passive never forms."},
  speed:{label:"speed", why:"If one side is hard-coded while the other autonegotiates, the autonegotiating side falls back to half duplex: a duplex mismatch."},
  duplex:{label:"duplex", why:"Both ends must use the same duplex; leaving both on auto is safest."},
  sfp:{label:"transceiver", why:"Optics must match the fiber: SR and SX for multimode, LR and LX for single-mode, and both ends must match."},
  cable:{label:"cable", why:"Cable category limits speed and distance: Cat 3 tops out at 10 Mbps, while Cat 5e and Cat 6 carry 1 Gbps up to 100 m."},
  mtu:{label:"MTU", why:"Every hop must support the frame size; jumbo frames need an MTU of 9000 end to end."},
  poeStd:{label:"PoE standard", why:"The switch must support the device's PoE class: 802.3af 15.4 W, 802.3at 30 W, 802.3bt up to 90 W."},
  poeBudget:{label:"PoE budget", why:"Devices only power on while the switch has budget left."},
  injector:{label:"power source", why:"A PoE injector powers a device that the switch can't."},
  portSecurity:{label:"port security", why:"Port security limits MAC addresses per port and err-disables the port on a violation; fix the cause, then shut and re-enable the port."},
  shutdown:{label:"administrative state", why:"A port or interface that's shut down passes no traffic; unused ports should be shut down for hardening."},
  errDisabled:{label:"err-disabled state", why:"An err-disabled port stays down until you fix the cause and bounce it (shutdown, then no shutdown)."},
  dhcpSnooping:{label:"DHCP snooping", why:"DHCP snooping drops server messages from untrusted ports, stopping rogue DHCP servers."},
  trusted:{label:"snooping/DAI trust", why:"Trust only ports that lead to legitimate DHCP servers, routers and uplinks; everything else stays untrusted."},
  dai:{label:"Dynamic ARP Inspection", why:"DAI drops ARP replies that don't match the DHCP snooping bindings, stopping ARP spoofing."},
  zone:{label:"DNS records", why:"A CNAME needs an A record for its target, and reverse lookups need a PTR record in the in-addr.arpa zone."},
  hosts:{label:"hosts file", why:"A hosts file entry overrides DNS on that one machine."},
  fw:{label:"firewall / security group", why:"Security groups allow only what's listed, so scope each rule's source as tightly as the requirement allows."},
  power:{label:"power", why:"A failed or unauthorized device may need to be powered off or disconnected."},
  end:{label:"DHCP scope range", why:"The scope must contain enough addresses for every client."},
  exclusions:{label:"DHCP exclusions", why:"Exclude statically assigned addresses so the server never leases them again."},
  reservations:{label:"DHCP reservations", why:"A reservation always gives one MAC address the same IP."},
  start:{label:"DHCP scope start", why:"The scope range must sit inside the subnet."},
  network:{label:"DHCP scope network", why:"The scope must match the subnet its clients are on."},
  publicIp:{label:"public IP", why:"Only instances with public IPs can use an internet gateway directly."},
  channel:{label:"channel", why:"Neighboring APs need non-overlapping channels: 1, 6 and 11 at 2.4 GHz, or separate 20/40/80 MHz blocks at 5 GHz."},
  width:{label:"channel width", why:"Wider channels bond more 20 MHz channels together, leaving fewer that don't overlap."},
  band:{label:"band", why:"5 and 6 GHz offer far more non-overlapping channels than 2.4 GHz."},
  security:{label:"security mode", why:"Enterprise modes authenticate each user with 802.1X and RADIUS; open or OWE suits guest networks."},
  ssid:{label:"SSID", why:"Every AP in a roaming network must broadcast the same SSID with the same security."},
  enabled:{label:"radio", why:"A disabled radio leaves a coverage gap."},
  antenna:{label:"antenna", why:"Directional antennas focus signal for long point-to-point links."},
  heading:{label:"antenna aim", why:"Directional antennas must point at each other."},
  captivePortal:{label:"captive portal", why:"A captive portal makes guests accept the terms before they get access."}
};
function hintCommand(d, field, s){
  const linux = d && d.os==="linux";
  if (!d) return "";
  if (isHost(d)){
    if (field==="hosts") return linux ? "cat /etc/hosts" : "type hosts";
    if (field==="dns") return linux ? "cat /etc/resolv.conf" : "ipconfig /all";
    if (field==="zone") return "nslookup <name>";
    if (field==="fw") return "nmap <its IP> (from another host)";
    if (["end","exclusions","reservations","start","network"].includes(field) || s.pool!=null) return "ipconfig /all (on a DHCP client)";
    return linux ? "ip addr" : "ipconfig /all";
  }
  const map = {vlan:"show vlan brief", voice:"show vlan brief", mode:"show interfaces status", allowed:"show interfaces trunk", native:"show interfaces trunk (and show logging)", speed:`show interfaces ${s.port||""}`, duplex:`show interfaces ${s.port||""}`, sfp:"show interfaces status", cable:`show interfaces ${s.port||""}`, mtu:`show interfaces ${s.port||""}`, poeStd:"show power inline", poeBudget:"show power inline", portSecurity:"show port-security", shutdown:"show interfaces status", errDisabled:"show logging", stp:"show spanning-tree", lacp:"show etherchannel summary", channel:"show etherchannel summary", dhcpSnooping:"show ip dhcp snooping", trusted:"show ip dhcp snooping", dai:"show ip arp inspection", helper:"show running-config", ip:"show ip interface brief", mask:"show running-config", nat:"show ip nat translations", vip:"show standby brief", vipPriority:"show standby brief", defaultRoute:"show ip route", routes:"show ip route", ospf:"show ip ospf neighbor", acl:"show access-lists", power:"show cdp neighbors"};
  return (map[field] || "show running-config").trim();
}
function stepField(s){ if (s.acl) return "acl"; if (s.routes) return "routes"; if (s.zone) return "zone"; if (s.link) return Object.keys(s.set||{})[0] || "cable"; const k = Object.keys(s.set||{}); return k.find(x=>HINT_FIELDS[x]) || k[0]; }
function looseEq(a, b){
  if (Array.isArray(b)) return JSON.stringify((a||[]).map(x=>typeof x==="object" ? JSON.stringify(x) : String(x))) === JSON.stringify(b.map(x=>typeof x==="object" ? JSON.stringify(x) : String(x)));
  if (b && typeof b==="object"){ if (!a || typeof a!=="object") return false; return Object.keys(b).every(k=>looseEq(a[k], b[k])); }
  if (typeof b==="boolean") return !!a===b;
  return String(a ?? "").trim().toLowerCase()===String(b ?? "").trim().toLowerCase();
}
function stepSatisfied(devices, links, s){
  if (s.link){ const L = links.find(l=>(l[0]===s.link[0] && pn(l[1])===pn(s.link[1])) || (l[2]===s.link[0] && pn(l[3])===pn(s.link[1]))); return !!L && Object.entries(s.set||{}).every(([k,v])=>looseEq((L[4]||{})[k] ?? (k==="cable" ? "cat6" : undefined), v)); }
  const d = devices.find(x=>x.id===s.dev); if (!d) return true;
  if (s.acl){ const cur = (d.acls||{})[s.acl] || []; return looseEq(cur.map(r=>({action:r.action, proto:r.proto||"ip", src:r.src||"any", dst:r.dst||"any"})), s.rules.map(r=>({action:r.action, proto:r.proto||"ip", src:r.src||"any", dst:r.dst||"any"}))); }
  if (s.routes) return s.routes.every(r=>(d.routes||[]).some(x=>pn(x.net)===pn(r.net) && pn(x.via)===pn(r.via) && Number(x.ad||1)===Number(r.ad||1)));
  if (s.zone) return s.zone.every(r=>(d.zone||[]).some(x=>pn(x.name)===pn(r.name) && pn(x.type)===pn(r.type) && pn(x.value)===pn(r.value)));
  let target = d;
  if (s.port) target = (d.ports||[]).find(p=>pn(p.name)===pn(s.port));
  else if (s.iface) target = (d.ifaces||[]).find(i=>pn(i.name)===pn(s.iface));
  else if (s.pool!=null) target = (d.dhcp||[])[s.pool];
  if (!target) return true;
  return Object.entries(s.set||{}).every(([k,v])=>{
    if (k==="errDisabled") return !target.errDisabled;
    if (k==="hosts") return Object.keys(target.hosts||{}).length===Object.keys(v).length;
    return looseEq(target[k], v);
  });
}
function simHints(t, devices, links){
  const net = makeNet(sclone(devices), sclone(links));
  const failing = t.goals.map(g=>({g, r:evalGoal(net, g)})).filter(x=>!x.r.pass);
  if (!failing.length) return {done:true, hints:[]};
  const pending = (t.solution||[]).filter(s=>!stepSatisfied(devices, links, s));
  const s = pending[0];
  const first = failing[0];
  const symptom = first.g.expect===false ? `${first.r.why}, but that traffic should be blocked` : first.r.why;
  if (!s) return {done:false, hints:[`Every change in the reference solution is in place, but "${first.g.label}" still fails: ${first.r.why}. Something else you changed is getting in the way. Try Reset all devices and compare.`]};
  const field = stepField(s), info = HINT_FIELDS[field] || {label:field, why:""};
  const d = s.dev ? devices.find(x=>x.id===s.dev) : devices.find(x=>x.id===s.link[0]);
  const where = s.port ? ` port ${s.port}` : s.iface ? ` interface ${s.iface}` : s.pool!=null ? ` DHCP scope ${Number(s.pool)+1}` : s.link ? ` (the cable on ${s.link[1]})` : "";
  const cmd = hintCommand(d, field, s);
  const fix = solutionText({devices, solution:[s]})[0];
  return {done:false, remaining:pending.length, failing:failing.map(x=>x.g.label), hints:[
    `Start with "${first.g.label}". Focus on ${d ? d.name : "the device"}${where}.`,
    `Check its ${info.label}${cmd ? `: run "${cmd}" ${["zone","fw"].includes(field) || s.pool!=null ? "from a client" : "on "+(d ? d.name : "it")}` : ""}. Right now the engine sees this: ${symptom}.`,
    `${fix}. ${info.why}`]};
}
function wifiHints(t, st){
  const failing = t.goals.map(g=>({g, r:wifiEval(st, g)})).filter(x=>!x.r.pass);
  if (!failing.length) return {done:true, hints:[]};
  const pending = (t.solution||[]).filter(s=>{ const a = st.aps.find(x=>x.id===s.ap); return a && !Object.entries(s.set).every(([k,v])=>looseEq(a[k], v)); });
  const s = pending[0], first = failing[0];
  if (!s) return {done:false, hints:[`The reference changes are in place, but "${first.g.label}" still fails: ${first.r.why}.`]};
  const a = st.aps.find(x=>x.id===s.ap), field = Object.keys(s.set)[0], info = HINT_FIELDS[field] || {label:field, why:""};
  return {done:false, remaining:pending.length, failing:failing.map(x=>x.g.label), hints:[
    `Start with "${first.g.label}". Focus on ${a.name}.`,
    `Check its ${info.label}. Tap a client to see what a Wi-Fi analyzer reads there. Right now: ${first.r.why}.`,
    `${wifiSolutionText({aps:st.aps, solution:[s]})[0]}. ${info.why}`]};
}

/* Lab Bench knowledge base: original definitions grouped by objective. Content: CC BY-SA 4.0.
   Each group generates questions both ways (definition -> term, term -> definition) with distractors from the same group. */

const TERM_GROUPS = [
{obj:"1.1", name:"OSI layers", items:[
 ["Layer 1 (Physical)","Moves raw bits as electrical, light or radio signals; cables, connectors, hubs and repeaters live here"],
 ["Layer 2 (Data link)","Frames and MAC addressing on the local segment; switches and bridges forward here"],
 ["Layer 3 (Network)","Logical addressing and path selection between networks; IP addresses and routers"],
 ["Layer 4 (Transport)","End-to-end delivery using segments or datagrams, port numbers, and TCP reliability"],
 ["Layer 5 (Session)","Sets up, maintains and tears down dialogs between applications"],
 ["Layer 6 (Presentation)","Formats, encodes, compresses and encrypts data so applications can read it"],
 ["Layer 7 (Application)","Network services that applications use directly, such as HTTP, DNS and SMTP"]]},
{obj:"1.1", name:"PDUs", items:[["Bits","Protocol data unit at the physical layer"],["Frame","Protocol data unit at the data link layer"],["Packet","Protocol data unit at the network layer"],["Segment","Protocol data unit for TCP at the transport layer"],["Datagram","Protocol data unit for UDP at the transport layer"]]},
{obj:"1.2", name:"Appliances", items:[
 ["Router","Forwards packets between different IP networks using a routing table"],
 ["Switch","Forwards frames within a LAN using a MAC address table"],
 ["Firewall","Permits or denies traffic between zones based on rules"],
 ["IDS","Monitors traffic and alerts on suspicious activity without blocking it"],
 ["IPS","Sits inline and actively blocks traffic that matches attack signatures"],
 ["Load balancer","Distributes client requests across a pool of servers"],
 ["Proxy server","Makes requests on behalf of clients, often caching and filtering content"],
 ["NAS","File-level storage appliance shared over the network with SMB or NFS"],
 ["SAN","Dedicated high-speed network providing block-level storage, often over Fibre Channel or iSCSI"],
 ["Wireless LAN controller","Centrally configures and manages lightweight access points"],
 ["Access point","Bridges wireless clients onto the wired network"]]},
{obj:"1.2", name:"Applications and functions", items:[
 ["CDN","Geographically distributed servers that cache content close to users"],
 ["VPN","Encrypted tunnel across an untrusted network such as the internet"],
 ["QoS","Prioritizes latency-sensitive traffic such as voice over bulk traffic"],
 ["TTL","Hop counter in an IP packet that is decremented by each router to prevent endless loops"]]},
{obj:"1.3", name:"Cloud networking", items:[
 ["NFV","Runs network functions such as routers and firewalls as software on standard servers"],
 ["VPC","Logically isolated private network inside a public cloud"],
 ["Network security group","Stateful allow rules applied to cloud instances or interfaces"],
 ["Network security list","Subnet-level cloud rules, often stateless, that filter traffic in and out"],
 ["Internet gateway","Lets resources with public IPs in a VPC communicate with the internet"],
 ["NAT gateway","Lets private-subnet cloud resources reach the internet without accepting inbound connections"],
 ["Direct Connect","Dedicated private circuit between an on-premises network and a cloud provider"],
 ["Site-to-site VPN to the cloud","Encrypted tunnel over the internet linking an on-premises network to a VPC"]]},
{obj:"1.3", name:"Cloud models", items:[
 ["Public cloud","Infrastructure owned by a provider and shared by many customers"],
 ["Private cloud","Cloud infrastructure dedicated to a single organization"],
 ["Hybrid cloud","Combines on-premises or private resources with public cloud services"],
 ["SaaS","Provider delivers a complete application; the customer only uses it"],
 ["PaaS","Provider manages the platform and runtime; the customer deploys code"],
 ["IaaS","Provider supplies virtual servers, storage and networking; the customer manages the OS and up"],
 ["Scalability","Ability to add capacity to handle more load, planned ahead"],
 ["Elasticity","Automatically adding and removing resources as demand changes"],
 ["Multitenancy","Many customers share the same physical infrastructure while staying isolated"]]},
{obj:"1.4", name:"IP protocol types", items:[
 ["ICMP","Carries error and diagnostic messages; used by ping and traceroute"],
 ["TCP","Connection-oriented transport with a three-way handshake and guaranteed, ordered delivery"],
 ["UDP","Connectionless transport with low overhead and no delivery guarantee"],
 ["GRE","Tunneling protocol that encapsulates other protocols, without encryption"],
 ["IPsec AH","Provides integrity and authentication for IP packets but no encryption"],
 ["IPsec ESP","Provides encryption, integrity and authentication for IP packets"],
 ["IKE","Negotiates the keys and security associations used by IPsec"]]},
{obj:"1.4", name:"Traffic types", items:[
 ["Unicast","One sender to one specific receiver"],
 ["Multicast","One sender to a group of interested receivers"],
 ["Anycast","One address shared by several nodes; traffic goes to the nearest one"],
 ["Broadcast","One sender to every host on the local network segment"]]},
{obj:"1.5", name:"Copper and fiber media", items:[
 ["Single-mode fiber","Narrow core with a laser light source for long distances, measured in kilometers"],
 ["Multimode fiber","Wider core using LEDs or VCSELs for shorter runs, typically within a building or campus"],
 ["DAC (twinax)","Short copper cable with transceivers attached, used between switches and servers in a rack"],
 ["Coaxial cable","Copper center conductor with shielding, used for cable internet and older networks"],
 ["Plenum cable","Fire-resistant jacket required in air-handling spaces above ceilings"],
 ["Non-plenum (PVC) cable","Cheaper jacket that can release toxic smoke, not allowed in air-handling spaces"],
 ["Cat 6a","Twisted pair rated for 10 Gbps up to 100 m"],
 ["Cat 8","Twisted pair rated for 25 to 40 Gbps over short data center runs up to 30 m"]]},
{obj:"1.5", name:"Transceivers and connectors", items:[
 ["SFP","Hot-pluggable transceiver commonly used for 1 Gbps links"],
 ["QSFP","Four-lane hot-pluggable transceiver for 40 or 100 Gbps links"],
 ["LC connector","Small push-pull fiber connector common on SFPs"],
 ["SC connector","Square push-pull fiber connector"],
 ["ST connector","Round bayonet-style fiber connector that twists to lock"],
 ["MPO connector","Multi-fiber connector carrying 12 or more fibers in one ferrule"],
 ["RJ11","Small connector used for telephone lines"],
 ["RJ45","8-pin connector used for Ethernet twisted pair"],
 ["F-type","Threaded coaxial connector used for cable modems and TV"],
 ["BNC","Bayonet coaxial connector used with older Ethernet and video equipment"]]},
{obj:"1.5", name:"Wireless media", items:[
 ["802.11a","5 GHz, up to 54 Mbps"],["802.11b","2.4 GHz, up to 11 Mbps"],["802.11g","2.4 GHz, up to 54 Mbps"],
 ["802.11n (Wi-Fi 4)","2.4 and 5 GHz with MIMO, up to about 600 Mbps"],["802.11ac (Wi-Fi 5)","5 GHz only with MU-MIMO and wide channels"],
 ["802.11ax (Wi-Fi 6/6E)","2.4, 5 and 6 GHz with OFDMA for dense environments"],
 ["Cellular","Mobile carrier networks such as 4G LTE and 5G used for WAN backup or remote sites"],
 ["Satellite","WAN link with wide coverage but high latency, especially from geostationary orbit"]]},
{obj:"1.6", name:"Topologies and architectures", items:[
 ["Mesh topology","Every node connects to several or all others for maximum redundancy"],
 ["Star (hub and spoke)","All nodes connect to a central device; a central failure affects everyone"],
 ["Hybrid topology","Combines two or more topology types"],
 ["Point to point","A direct link between exactly two endpoints"],
 ["Spine and leaf","Every leaf switch connects to every spine switch, giving predictable east-west latency in data centers"],
 ["Three-tier model","Core, distribution and access layers in a hierarchical campus design"],
 ["Collapsed core","Combines the core and distribution layers into one layer for smaller networks"],
 ["Access layer","Where end devices connect to the network"],
 ["Distribution layer","Aggregates access switches and applies policy and routing between VLANs"],
 ["Core layer","High-speed backbone that moves traffic between distribution blocks"],
 ["North-south traffic","Traffic entering or leaving the data center"],
 ["East-west traffic","Traffic between servers inside the data center"]]},
{obj:"1.7", name:"Special IPv4 ranges", items:[
 ["APIPA (169.254.0.0/16)","Self-assigned address a host uses when DHCP fails"],
 ["RFC 1918","Private ranges 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16"],
 ["Loopback (127.0.0.0/8)","Addresses that always refer to the local host"],
 ["Class D (224.0.0.0 to 239.255.255.255)","IPv4 multicast range"],
 ["Class E (240.0.0.0 and up)","Reserved experimental range"],
 ["CIDR","Classless notation that writes the mask as a prefix length, such as /26"],
 ["VLSM","Using different mask lengths within one address block to size subnets efficiently"]]},
{obj:"1.8", name:"Modern environments", items:[
 ["SDN","Separates the control plane from the data plane so a controller programs network devices"],
 ["SD-WAN","Centrally managed WAN that steers traffic across any transport by application policy"],
 ["Zero-touch provisioning","New devices pull their configuration automatically when first connected"],
 ["VXLAN","Encapsulates Layer 2 frames in UDP to stretch networks across Layer 3, such as between data centers"],
 ["Zero trust architecture","Never trust by location; authenticate and authorize every request with least privilege"],
 ["SASE","Converges SD-WAN with cloud-delivered security services at the edge"],
 ["SSE","The cloud-delivered security part of SASE: secure web gateway, CASB and zero trust network access"],
 ["Infrastructure as code","Defines infrastructure in version-controlled files that tools apply automatically"],
 ["Configuration drift","Devices gradually departing from their approved baseline configuration"],
 ["Dual stack","Running IPv4 and IPv6 at the same time on the same devices"],
 ["Tunneling (IPv6)","Carrying IPv6 packets inside IPv4 to cross networks that only support IPv4"],
 ["NAT64","Translates between IPv6-only clients and IPv4 servers"]]},
{obj:"2.1", name:"Routing", items:[
 ["Static routing","Routes entered manually by an administrator; no protocol overhead"],
 ["OSPF","Link-state interior routing protocol using cost, areas and Dijkstra's algorithm"],
 ["EIGRP","Cisco advanced distance-vector protocol using a composite metric of bandwidth and delay"],
 ["BGP","Path-vector exterior protocol that routes between autonomous systems on the internet"],
 ["Administrative distance","Trust value used to choose between routes from different sources; lower wins"],
 ["Longest prefix match","The most specific matching route is chosen before anything else"],
 ["Metric","Value a single routing protocol uses to choose its best path"],
 ["PAT (NAT overload)","Many private hosts share one public IP, distinguished by port numbers"],
 ["Static NAT","One private address is mapped permanently to one public address"],
 ["FHRP","Gives hosts a virtual default gateway shared by two or more routers for redundancy"],
 ["Virtual IP (VIP)","Address shared by redundant devices that answers whichever device is active"],
 ["Subinterface","Logical interface on one physical port, often one per VLAN for router-on-a-stick"]]},
{obj:"2.1", name:"Administrative distances", items:[["0","Default administrative distance of a connected route"],["1","Default administrative distance of a static route"],["20","Default administrative distance of eBGP"],["90","Default administrative distance of internal EIGRP"],["110","Default administrative distance of OSPF"],["120","Default administrative distance of RIP"]]},
{obj:"2.2", name:"Switching", items:[
 ["VLAN","Logically separate broadcast domain on a switch"],
 ["SVI","Virtual routed interface for a VLAN on a Layer 3 switch"],
 ["Native VLAN","VLAN whose frames cross an 802.1Q trunk untagged"],
 ["Voice VLAN","Separate tagged VLAN on an access port for IP phone traffic"],
 ["802.1Q","Standard that inserts a VLAN tag into Ethernet frames on trunks"],
 ["Link aggregation (LACP)","Bundles several physical links into one logical link for bandwidth and redundancy"],
 ["Spanning Tree Protocol","Blocks redundant switch paths to prevent Layer 2 loops"],
 ["Root bridge","STP reference switch, elected by the lowest bridge ID (priority, then MAC)"],
 ["Jumbo frames","Ethernet frames with an MTU above 1500 bytes, typically 9000, used for storage"],
 ["MTU","Largest frame payload an interface will send without fragmenting"],
 ["Port mirroring (SPAN)","Copies traffic from one or more ports to a monitoring port"]]},
{obj:"2.2", name:"STP port states", items:[["Blocking","STP state that discards frames to prevent a loop but still hears BPDUs"],["Listening","STP state that processes BPDUs while deciding the topology, no learning yet"],["Learning","STP state that builds the MAC table but doesn't forward yet"],["Forwarding","STP state that sends and receives frames normally"],["Disabled","Port is administratively down and not participating in STP"]]},
{obj:"2.3", name:"Wireless", items:[
 ["Channels 1, 6 and 11","The only non-overlapping 20 MHz channels in 2.4 GHz"],
 ["Channel bonding","Combining adjacent channels into a wider channel for more throughput, at the cost of fewer non-overlapping channels"],
 ["802.11h","Requires DFS and transmit power control in 5 GHz to avoid interfering with radar"],
 ["Band steering","Nudges dual-band clients onto 5 or 6 GHz"],
 ["BSSID","MAC address identifying a single access point radio"],
 ["ESSID","Network name shared by several APs so clients can roam"],
 ["Ad hoc network","Wireless devices connect directly without an access point"],
 ["Infrastructure mode","Clients connect through an access point"],
 ["Mesh network","APs connect to each other wirelessly to extend coverage"],
 ["WPA3-Personal (SAE)","Passphrase security using Simultaneous Authentication of Equals, resistant to offline guessing"],
 ["WPA2/WPA3-Enterprise","Per-user authentication through 802.1X and a RADIUS server"],
 ["Captive portal","Web page that guests must accept or log into before getting access"],
 ["Omnidirectional antenna","Radiates evenly in all horizontal directions for general coverage"],
 ["Directional antenna","Focuses signal in one direction for long point-to-point links"],
 ["Autonomous AP","Configured and managed individually"],
 ["Lightweight AP","Managed by a wireless LAN controller"]]},
{obj:"2.4", name:"Physical installations", items:[
 ["MDF","Main distribution frame where the building's core equipment and carrier connections live"],
 ["IDF","Intermediate distribution frame serving a floor or area, uplinked to the MDF"],
 ["Rack unit (U)","1.75-inch unit of vertical rack space"],
 ["Port-side exhaust/intake","Airflow direction that must match the hot aisle/cold aisle layout"],
 ["Patch panel","Terminates horizontal cabling so ports can be cross-connected with patch cables"],
 ["Fiber distribution panel","Terminates and organizes fiber runs"],
 ["UPS","Battery backup that keeps equipment running through short outages and conditions power"],
 ["PDU","Distributes power to devices in a rack, sometimes with remote monitoring"],
 ["Power load","Total draw of equipment, which must stay within circuit and UPS capacity"],
 ["Humidity control","Too low causes static discharge; too high causes condensation and corrosion"],
 ["Clean-agent fire suppression","Puts out fires without water damage to electronics"]]},
{obj:"3.1", name:"Documentation", items:[
 ["Physical diagram","Shows where devices, racks and cables physically are"],
 ["Logical diagram","Shows how traffic flows: subnets, VLANs and routing"],
 ["Layer 1 diagram","Documents cabling, ports and physical connections"],
 ["Layer 2 diagram","Documents switches, VLANs and trunks"],
 ["Layer 3 diagram","Documents IP subnets, routers and routing"],
 ["Rack diagram","Shows what is mounted in each rack unit"],
 ["IPAM","Tracks and manages IP address assignments, DHCP and DNS"],
 ["SLA","Agreement defining the level of service a provider must deliver, such as uptime"],
 ["Wireless survey/heat map","Measured map of Wi-Fi signal strength across a site"],
 ["Asset inventory","Record of hardware, software, licensing and warranty details"]]},
{obj:"3.1", name:"Life cycle and change management", items:[
 ["End of life (EOL)","Vendor stops selling a product"],
 ["End of support (EOS)","Vendor stops providing patches and support"],
 ["Decommissioning","Securely retiring equipment, including wiping data and updating records"],
 ["Change management","Formal request, review, approval and documentation process before changes"],
 ["Baseline (golden) configuration","Approved standard configuration that devices are compared against"],
 ["Backup configuration","Saved copy of a device's configuration used to restore it"],
 ["Production configuration","The configuration currently running on live devices"]]},
{obj:"3.2", name:"Monitoring", items:[
 ["SNMP trap","Unsolicited alert a device sends to the management station"],
 ["MIB","Database of objects that SNMP can query on a device"],
 ["SNMP community string","Shared plain-text password used by SNMPv1 and v2c"],
 ["SNMPv3","SNMP version adding authentication and encryption"],
 ["Flow data (NetFlow)","Summary records of who talked to whom, how much and on which ports"],
 ["Packet capture","Full copy of packets for detailed protocol analysis"],
 ["Baseline","Normal performance measurements used to spot anomalies"],
 ["Syslog collector","Central server that receives log messages from many devices"],
 ["SIEM","Aggregates and correlates logs to detect security events and alert"],
 ["Port mirroring","Sends a copy of traffic to a monitoring tool"],
 ["Availability monitoring","Checks whether devices and services are up"],
 ["Configuration monitoring","Detects unauthorized or unexpected configuration changes"]]},
{obj:"3.2", name:"Syslog levels", items:[["0 Emergency","Syslog level: system is unusable"],["1 Alert","Syslog level: action must be taken immediately"],["2 Critical","Syslog level: critical conditions"],["3 Error","Syslog level: error conditions"],["4 Warning","Syslog level: warning conditions"],["5 Notice","Syslog level: normal but significant condition"],["6 Informational","Syslog level: informational messages"],["7 Debug","Syslog level: debugging messages"]]},
{obj:"3.3", name:"Disaster recovery", items:[
 ["RPO","Maximum acceptable data loss, measured in time"],
 ["RTO","Maximum acceptable time to restore a service"],
 ["MTTR","Average time to repair a failed component"],
 ["MTBF","Average time a repairable system runs between failures"],
 ["Hot site","Fully equipped with current data, ready almost immediately"],
 ["Warm site","Has equipment and connectivity but needs data restored first"],
 ["Cold site","Space and power only; equipment must be brought in"],
 ["Active-active","All nodes serve traffic at the same time"],
 ["Active-passive","A standby node takes over only when the active node fails"],
 ["Tabletop exercise","Team talks through a disaster scenario without touching systems"],
 ["Validation test","Actually performs recovery steps to prove they work"]]},
{obj:"3.4", name:"DHCP", items:[
 ["DHCP scope","Range of addresses and options a server hands out for a subnet"],
 ["DHCP reservation","Always gives a specific device the same address, based on its MAC"],
 ["DHCP exclusion","Addresses inside a scope that the server will never lease"],
 ["Lease time","How long a client may use an address before renewing"],
 ["DHCP option","Extra setting sent with a lease, such as the default gateway or DNS server"],
 ["DHCP relay (IP helper)","Forwards DHCP broadcasts from one subnet to a server on another"],
 ["SLAAC","IPv6 hosts build their own address from the router's prefix with no DHCP server"],
 ["DORA","Discover, Offer, Request, Acknowledge: the DHCP lease exchange"]]},
{obj:"3.4", name:"DNS records", items:[
 ["A record","Maps a name to an IPv4 address"],["AAAA record","Maps a name to an IPv6 address"],["CNAME record","Alias pointing one name at another name"],
 ["MX record","Identifies the mail server for a domain"],["TXT record","Free text, often used for SPF, DKIM and domain verification"],
 ["NS record","Identifies the authoritative name servers for a zone"],["PTR record","Maps an IP address back to a name in a reverse zone"],["SOA record","Holds a zone's primary server, admin contact and serial number"]]},
{obj:"3.4", name:"DNS and time concepts", items:[
 ["Forward lookup zone","Resolves names to IP addresses"],["Reverse lookup zone","Resolves IP addresses to names"],
 ["Authoritative answer","Response from a server that hosts the zone itself"],["Non-authoritative answer","Response from a server's cache or forwarding, not the zone owner"],
 ["Primary DNS server","Holds the writable copy of a zone"],["Secondary DNS server","Holds a read-only copy received by zone transfer"],
 ["Recursive lookup","Server chases the answer through other servers on the client's behalf"],["Hosts file","Local name-to-address file checked before DNS"],
 ["DNSSEC","Signs DNS records so resolvers can verify they weren't forged"],["DoH / DoT","Encrypts DNS queries inside HTTPS or TLS"],
 ["NTP","Synchronizes clocks over UDP 123"],["PTP","Precision Time Protocol for sub-microsecond synchronization"],["NTS","Adds cryptographic authentication to NTP"]]},
{obj:"3.5", name:"Access and management", items:[
 ["Site-to-site VPN","Permanent tunnel joining two networks through their gateways"],
 ["Client-to-site VPN","Individual remote users connect to the corporate network"],
 ["Clientless VPN","Remote access through a web browser using TLS, with no installed client"],
 ["Split tunnel","Only corporate traffic uses the VPN; internet traffic goes directly"],
 ["Full tunnel","All of the client's traffic goes through the VPN"],
 ["Jump box","Hardened host administrators connect through to reach protected systems"],
 ["Out-of-band management","Managing devices over a separate path such as a console server or cellular modem"],
 ["In-band management","Managing devices over the same network that carries user traffic"],
 ["Console connection","Direct serial connection to a device's console port"]]},
{obj:"4.1", name:"Security concepts", items:[
 ["Confidentiality","Keeping data secret from unauthorized people, mainly through encryption"],
 ["Integrity","Ensuring data isn't altered, mainly through hashing and signatures"],
 ["Availability","Keeping systems accessible, through redundancy and resiliency"],
 ["Risk","Likelihood that a threat exploits a vulnerability, times the impact"],
 ["Vulnerability","Weakness that could be exploited"],["Exploit","Code or technique that takes advantage of a vulnerability"],["Threat","Anything that could cause harm, such as an attacker or disaster"],
 ["Data in transit","Data moving across a network, protected with TLS or IPsec"],["Data at rest","Stored data, protected with disk or database encryption"],
 ["PKI","System of certificate authorities and certificates that binds public keys to identities"],
 ["Self-signed certificate","Certificate not issued by a trusted CA, so clients warn by default"],
 ["Geofencing","Allowing or blocking access based on location"],
 ["Honeypot","Decoy system that attracts and records attackers"],["Honeynet","Network of decoy systems"],
 ["Data locality","Requirement that data stays within certain geographic or legal boundaries"],
 ["PCI DSS","Security standard for organizations that handle payment card data"],
 ["GDPR","EU regulation protecting personal data and privacy"]]},
{obj:"4.1", name:"Identity and access", items:[
 ["MFA","Requires two or more factor types, such as something you know and something you have"],
 ["SSO","One login grants access to many applications"],
 ["RADIUS","AAA protocol over UDP, commonly used for network access and 802.1X"],
 ["TACACS+","Cisco AAA protocol over TCP that separates authentication, authorization and accounting; used for device admin"],
 ["LDAP","Protocol for querying and modifying directory services"],
 ["SAML","XML-based standard for exchanging authentication between an identity provider and service"],
 ["Time-based authentication","Access or one-time codes valid only within certain times"],
 ["Least privilege","Users get only the access their job requires"],
 ["Role-based access control","Permissions assigned to roles, and users assigned to roles"]]},
{obj:"4.2", name:"Attacks", items:[
 ["DDoS","Many compromised systems flood a target to make it unavailable"],
 ["VLAN hopping","Gaining access to another VLAN by switch spoofing or double tagging"],
 ["MAC flooding","Filling a switch's MAC table so it floods traffic out every port"],
 ["ARP poisoning","Corrupting ARP caches so traffic for an IP goes to the attacker's MAC"],
 ["ARP spoofing","Sending forged ARP replies that claim another device's IP address"],
 ["DNS poisoning","Corrupting a DNS server or cache so names resolve to malicious addresses"],
 ["DNS spoofing","Forging DNS responses to redirect a victim"],
 ["Rogue DHCP server","Unauthorized DHCP server handing out bad gateways or DNS"],
 ["Rogue access point","Unauthorized AP connected to the wired network"],
 ["Evil twin","Malicious AP impersonating a legitimate SSID to capture users"],
 ["On-path attack","Attacker secretly relays and possibly alters communication between two parties"],
 ["Phishing","Fraudulent messages that trick people into revealing information or running malware"],
 ["Dumpster diving","Searching trash for sensitive information"],
 ["Shoulder surfing","Watching someone enter passwords or view sensitive data"],
 ["Tailgating","Following an authorized person through a secured door"],
 ["Malware","Malicious software such as viruses, worms, ransomware and trojans"]]},
{obj:"4.3", name:"Defenses", items:[
 ["Port security","Limits which or how many MAC addresses may use a switch port"],
 ["802.1X","Port-based network access control that authenticates devices before granting access"],
 ["MAC filtering","Allows or blocks devices by MAC address, easily bypassed by spoofing"],
 ["NAC","Checks identity and device posture before allowing network access"],
 ["DHCP snooping","Blocks DHCP server messages from untrusted ports and builds a binding table"],
 ["Dynamic ARP Inspection","Drops ARP packets that don't match the DHCP snooping binding table"],
 ["ACL","Ordered permit and deny rules evaluated top-down with an implicit deny"],
 ["URL filtering","Blocks web access by address or category"],
 ["Content filtering","Blocks traffic based on what it contains"],
 ["Screened subnet (DMZ)","Network between the internet and the internal network for public-facing servers"],
 ["Key management","Generating, distributing, rotating and revoking cryptographic keys"],
 ["Device hardening","Disabling unused ports and services and changing default passwords"]]},
{obj:"5.1", name:"Troubleshooting methodology", items:[
 ["Identify the problem","Step 1: gather information, question users, identify symptoms, find what changed, duplicate the problem"],
 ["Establish a theory","Step 2: question the obvious and consider top-down, bottom-up or divide-and-conquer approaches"],
 ["Test the theory","Step 3: confirm the cause, or form a new theory or escalate"],
 ["Establish a plan of action","Step 4: plan the fix and identify its potential effects"],
 ["Implement or escalate","Step 5: apply the fix or hand it to someone who can"],
 ["Verify functionality","Step 6: confirm everything works and add preventive measures"],
 ["Document","Step 7: record findings, actions, outcomes and lessons learned"]]},
{obj:"5.2", name:"Cable and interface issues", items:[
 ["Crosstalk","Signal bleeding between wire pairs, often from untwisted wires at terminations"],
 ["Attenuation","Signal weakening over distance, such as copper runs beyond 100 m"],
 ["Interference (EMI)","Noise from motors, lights or power lines corrupting signals"],
 ["Improper termination","Badly crimped or punched-down connectors causing errors or no link"],
 ["TX/RX transposed","Fiber strands swapped so no light reaches the receiver"],
 ["CRC errors","Frames failing the checksum, usually from cabling problems or a duplex mismatch"],
 ["Runts","Frames smaller than 64 bytes, often from collisions or a duplex mismatch"],
 ["Giants","Frames larger than the MTU, often from MTU mismatches"],
 ["Drops","Frames discarded, usually because buffers are full from congestion"],
 ["Err-disabled","Port shut down automatically by the switch after a violation such as port security"],
 ["Administratively down","Port disabled with the shutdown command"],
 ["Suspended","Port-channel member disabled because of an LACP mismatch"],
 ["PoE budget exceeded","Switch has no more power to give, so new devices don't power on"],
 ["Transceiver mismatch","Optics of different types or wavelengths on each end"]]},
{obj:"5.2", name:"PoE standards", items:[["802.3af (PoE)","Up to 15.4 W per port"],["802.3at (PoE+)","Up to 30 W per port"],["802.3bt (PoE++)","Up to 60 W (Type 3) or 90 W (Type 4) per port"]]},
{obj:"5.3", name:"Network service issues", items:[
 ["Switching loop","Redundant links without STP cause broadcast storms and MAC table flapping"],
 ["Incorrect VLAN assignment","Port in the wrong VLAN, so the host can't reach its gateway or peers"],
 ["Address pool exhaustion","DHCP scope out of addresses, so new clients get APIPA"],
 ["Incorrect default gateway","Host can reach its own subnet but nothing beyond it"],
 ["Duplicate IP address","Two hosts with the same address cause intermittent connectivity and conflict warnings"],
 ["Incorrect subnet mask","Host misjudges which addresses are local, breaking some destinations"],
 ["Missing default route","Router can reach its connected networks but not the internet"]]},
{obj:"5.4", name:"Performance issues", items:[
 ["Latency","Delay for a packet to travel from source to destination"],
 ["Jitter","Variation in latency between packets, harmful to voice and video"],
 ["Packet loss","Packets that never arrive, often from congestion or errors"],
 ["Bottleneck","The slowest link or device limiting overall throughput"],
 ["Bandwidth","Maximum theoretical capacity of a link"],["Throughput","Actual data rate achieved"],
 ["Congestion","More traffic than a link or device can handle"],
 ["Channel overlap","Nearby APs on overlapping frequencies degrade each other"],
 ["Client disassociation","Clients repeatedly dropped from an AP, from interference, roaming or attacks"],
 ["Roaming misconfiguration","APs with mismatched SSIDs or security, or poor overlap, break handoffs"]]},
{obj:"5.5", name:"Tools", items:[
 ["ping","Tests reachability and round-trip time with ICMP echo"],["traceroute / tracert","Lists each router hop to a destination"],
 ["nslookup","Queries DNS servers interactively, on Windows and Linux"],["dig","Detailed DNS query tool common on Linux"],
 ["tcpdump","Command-line packet capture"],["netstat","Shows connections and listening ports"],["ipconfig / ip / ifconfig","Shows and manages interface addressing"],
 ["arp","Shows or edits the IP-to-MAC cache"],["Nmap","Scans hosts for open ports and services"],["LLDP / CDP","Neighbor discovery protocols showing what is connected to each port"],
 ["Protocol analyzer","Captures and decodes packets in detail, such as Wireshark"],["Speed tester","Measures actual throughput to a test server"],
 ["Toner and probe","Traces an unlabeled cable to its other end"],["Cable tester","Verifies wire map, continuity and shorts"],["Tap","Hardware device that copies traffic from a link for monitoring"],
 ["Wi-Fi analyzer","Shows nearby networks, channels and signal strength"],["Visual fault locator","Shines visible light into fiber to find breaks"],["Optical power meter","Measures light level on a fiber in dBm"]]},
{obj:"5.5", name:"Device commands", items:[
 ["show mac address-table","Lists learned MAC addresses with their VLANs and ports"],["show ip route","Displays the routing table"],["show interfaces","Shows status, errors and counters for interfaces"],
 ["show running-config","Displays the active configuration"],["show arp","Lists IP-to-MAC mappings on a router or Layer 3 switch"],["show vlan","Lists VLANs and their access ports"],
 ["show power inline","Shows PoE budget and per-port power"],["show spanning-tree","Shows the root bridge and each port's STP role and state"]]}
];
const PORTS_TABLE = [["FTP","20/21","TCP"],["SFTP","22","TCP"],["SSH","22","TCP"],["Telnet","23","TCP"],["SMTP","25","TCP"],["DNS","53","TCP and UDP"],["DHCP","67/68","UDP"],["TFTP","69","UDP"],["HTTP","80","TCP"],["NTP","123","UDP"],["SNMP","161/162","UDP"],["LDAP","389","TCP"],["HTTPS","443","TCP"],["SMB","445","TCP"],["Syslog","514","UDP"],["SMTPS","587","TCP"],["LDAPS","636","TCP"],["SQL Server","1433","TCP"],["RDP","3389","TCP"],["SIP","5060/5061","TCP and UDP"]];
const ACRONYMS = [["ACL","Access control list"],["APIPA","Automatic Private IP Addressing"],["ARP","Address Resolution Protocol"],["BGP","Border Gateway Protocol"],["BSSID","Basic service set identifier"],["CAM","Content-addressable memory"],["CIDR","Classless Inter-Domain Routing"],["CRC","Cyclic redundancy check"],["DAI","Dynamic ARP Inspection"],["DHCP","Dynamic Host Configuration Protocol"],["DNSSEC","Domain Name System Security Extensions"],["EIGRP","Enhanced Interior Gateway Routing Protocol"],["ESP","Encapsulating Security Payload"],["FHRP","First Hop Redundancy Protocol"],["GRE","Generic Routing Encapsulation"],["IaC","Infrastructure as code"],["IDF","Intermediate distribution frame"],["IKE","Internet Key Exchange"],["IPAM","IP address management"],["LACP","Link Aggregation Control Protocol"],["LLDP","Link Layer Discovery Protocol"],["MDF","Main distribution frame"],["MDIX","Medium dependent interface crossover"],["MIB","Management information base"],["MTBF","Mean time between failures"],["MTTR","Mean time to repair"],["MTU","Maximum transmission unit"],["NAC","Network access control"],["NFV","Network functions virtualization"],["NTS","Network Time Security"],["OSPF","Open Shortest Path First"],["PAT","Port address translation"],["PDU","Power distribution unit (or protocol data unit)"],["PoE","Power over Ethernet"],["PTP","Precision Time Protocol"],["QSFP","Quad small form-factor pluggable"],["RADIUS","Remote Authentication Dial-In User Service"],["RPO","Recovery point objective"],["RSTP","Rapid Spanning Tree Protocol"],["RTO","Recovery time objective"],["SAML","Security Assertion Markup Language"],["SASE","Secure access service edge"],["SD-WAN","Software-defined wide area network"],["SFP","Small form-factor pluggable"],["SIEM","Security information and event management"],["SLA","Service-level agreement"],["SLAAC","Stateless address autoconfiguration"],["SNMP","Simple Network Management Protocol"],["SSE","Security service edge"],["SVI","Switch virtual interface"],["TACACS+","Terminal Access Controller Access-Control System Plus"],["UPS","Uninterruptible power supply"],["VIP","Virtual IP"],["VLSM","Variable-length subnet mask"],["VPC","Virtual private cloud"],["VXLAN","Virtual Extensible LAN"],["WPA","Wi-Fi Protected Access"],["ZTA","Zero trust architecture"]];

/* Lab Bench scenario questions: original, objective-tagged. Content: CC BY-SA 4.0.
   Format: [objective, question, options, correct index (or array for multi-select), explanation] */

const SCENARIOS = [
["1.1","A user's NIC link light is off. At which OSI layer should troubleshooting start with a bottom-to-top approach?",["Physical","Data link","Network","Transport"],0,"Bottom-to-top starts at Layer 1: cables, link lights and power."],
["1.1","Which device decision is based on destination MAC addresses?",["Router","Switch","Firewall","Hub"],1,"Switches forward frames by MAC address at Layer 2. Hubs don't make forwarding decisions at all."],
["1.2","A web farm must stay up if one of its four servers fails, and traffic should be shared evenly. What should be deployed in front of the servers?",["Proxy server","Load balancer","IDS","NAS"],1,"A load balancer spreads requests across healthy servers and stops sending to failed ones."],
["1.2","Security wants suspicious traffic blocked automatically, not just reported. Which appliance meets this?",["IDS","IPS","SIEM","Honeypot"],1,"An IPS sits inline and can drop traffic; an IDS only alerts."],
["1.2","Video calls stutter when large backups run over the WAN. Which function addresses this without adding bandwidth?",["QoS","TTL","CDN","NAT"],0,"Quality of service prioritizes latency-sensitive voice and video over bulk traffic."],
["1.3","A company runs its own email servers on rented virtual machines and patches the OS itself. Which service model is this?",["SaaS","PaaS","IaaS","DaaS"],2,"With IaaS the provider supplies VMs; the customer manages the OS and everything above it."],
["1.3","Database servers in a private cloud subnet need OS updates from the internet but must never accept inbound connections from it. What should the private subnet's default route point to?",["Internet gateway","NAT gateway","VPC peering connection","Direct Connect"],1,"A NAT gateway allows outbound-initiated connections only. An internet gateway requires public IPs and allows inbound."],
["1.3","A retailer's web tier automatically adds servers during holiday traffic spikes and removes them afterward. Which cloud characteristic is this?",["Multitenancy","Elasticity","Hybrid deployment","Direct Connect"],1,"Elasticity is automatic scaling up and down with demand."],
["1.4","A firewall must allow secure file transfers using SSH. Which port must be open?",["21","22","69","990"],1,"SFTP runs over SSH on TCP 22. FTP uses 20/21 and TFTP uses UDP 69."],
["1.4","Which traffic type does a DHCP DISCOVER use?",["Unicast","Multicast","Anycast","Broadcast"],3,"A client with no address broadcasts its DISCOVER to 255.255.255.255."],
["1.4","An IPsec VPN must encrypt payloads, not just authenticate them. Which protocol must be used?",["AH","ESP","GRE","IKE"],1,"ESP provides encryption plus integrity. AH provides integrity and authentication only."],
["1.5","Two buildings 2 km apart need a 10 Gbps link. Which media is most appropriate?",["Cat 6a","Multimode fiber","Single-mode fiber","Coaxial cable"],2,"Single-mode fiber covers kilometers; multimode is for shorter runs and Cat 6a stops at 100 m."],
["1.5","Cable must be run through the air-handling space above a drop ceiling. What type is required?",["Plenum","PVC","Shielded twisted pair","Direct burial"],0,"Plenum-rated jackets resist fire and produce less toxic smoke in air-handling spaces."],
["1.5","A server needs a 3 m 10 Gbps connection to a top-of-rack switch at the lowest cost. What is best?",["DAC twinax cable","Single-mode fiber with LR optics","Cat 5e","QSFP with MPO cabling"],0,"Direct attach copper is cheap and ideal for short in-rack runs."],
["1.6","A data center needs consistent low latency for traffic between servers no matter where they sit. Which design fits best?",["Three-tier","Spine and leaf","Star","Point to point"],1,"In spine and leaf every leaf is one spine hop from every other leaf, giving predictable east-west latency."],
["1.6","A small campus combines the core and distribution layers on one pair of switches. What is this design called?",["Collapsed core","Spine and leaf","Hybrid mesh","Hub and spoke"],0,"A collapsed core merges the core and distribution layers."],
["1.7","A host shows 169.254.33.7. What does this most likely mean?",["The host has a static address","DHCP failed","The host is using IPv6","The address is from RFC 1918"],1,"169.254.0.0/16 is APIPA, self-assigned when no DHCP server answers."],
["1.7","How many usable hosts does a /26 provide?",["30","62","64","126"],1,"A /26 has 6 host bits: 64 addresses minus network and broadcast is 62."],
["1.7","Which subnet mask provides at least 500 usable hosts while wasting the fewest addresses?",["255.255.254.0","255.255.252.0","255.255.255.0","255.255.248.0"],0,"/23 gives 510 usable hosts; /24 gives only 254."],
["1.7","Which address is publicly routable?",["10.4.4.4","172.20.1.1","192.168.100.1","172.32.1.1"],3,"172.16.0.0/12 runs only to 172.31.255.255, so 172.32.1.1 is public."],
["1.8","A branch must reach headquarters over an IPv4-only ISP while running IPv6 internally. Which technique carries the IPv6 traffic?",["NAT64","Tunneling IPv6 over IPv4","Dual stack","SLAAC"],1,"Tunneling encapsulates IPv6 inside IPv4 to cross IPv4-only networks."],
["1.8","An admin wants switch configurations stored in Git and applied automatically, with any manual change flagged. What approach is this?",["Infrastructure as code","Zero-touch provisioning","SASE","VXLAN"],0,"IaC keeps configuration in version control and detects drift from it."],
["1.8","Which principle best describes zero trust?",["Trust the internal network, inspect the edge","Authenticate and authorize every request regardless of location","Encrypt only data at rest","Use a single perimeter firewall"],1,"Zero trust removes implicit trust based on network location."],
["2.1","A router has routes to 10.1.0.0/16 via OSPF and 10.1.5.0/24 via a static route. Which is used for traffic to 10.1.5.9?",["The OSPF route, because it's dynamic","The static route, because it's the longest prefix match","Both, with load balancing","Neither; the router drops it"],1,"Longest prefix match is checked first; administrative distance only breaks ties between equally specific routes."],
["2.1","A backup static route should be used only if OSPF loses the route. How is it configured?",["With administrative distance 1","With administrative distance higher than 110","With a /32 prefix","As a default route"],1,"A floating static route has an AD above the dynamic protocol's (OSPF 110) so it's only installed when OSPF's route disappears."],
["2.1","Which protocol exchanges routes between internet service providers?",["OSPF","EIGRP","RIP","BGP"],3,"BGP is the path-vector exterior gateway protocol used between autonomous systems."],
["2.1","Hosts must keep a working default gateway if either of two routers fails. What provides this?",["Link aggregation","FHRP with a virtual IP","Static NAT","Subinterfaces"],1,"First hop redundancy protocols such as HSRP and VRRP share a virtual gateway address."],
["2.2","An IP phone and a PC share one switch port. How should the port be configured?",["Trunk with the PC's VLAN as native","Access VLAN for data plus a voice VLAN","Access port in the voice VLAN only","Two access VLANs"],1,"The PC's untagged traffic uses the access VLAN while the phone tags voice traffic for the voice VLAN."],
["2.2","After adding a redundant link between two switches, the network slows to a crawl and MAC addresses flap. What is the likely cause?",["Duplex mismatch","A switching loop with spanning tree disabled","Native VLAN mismatch","Port security violation"],1,"Redundant links without STP create broadcast storms and MAC flapping."],
["2.2","A switch should always be the STP root. What do you change?",["Lower its bridge priority","Raise its bridge priority","Increase port cost","Disable STP on other switches"],0,"The lowest bridge ID wins; lowering priority (for example to 4096) makes it root."],
["2.2","Which statement about the native VLAN is correct?",["It is always tagged","Frames in it cross trunks untagged and it must match on both ends","It carries only voice traffic","It must be VLAN 1"],1,"Mismatched native VLANs merge two VLANs and generate CDP warnings."],
["2.3","An office in a crowded building suffers 2.4 GHz interference from neighbors. Which change helps most?",["Use 40 MHz channels on 2.4 GHz","Move capable clients to 5 or 6 GHz","Raise AP power to maximum","Use channel 3"],1,"5 and 6 GHz offer many more non-overlapping channels. Wider 2.4 GHz channels make overlap worse."],
["2.3","Employees should authenticate to Wi-Fi with their directory credentials, not a shared passphrase. Which setting is needed?",["WPA2-Personal","WPA3-Personal","WPA3-Enterprise with RADIUS","Open with MAC filtering"],2,"Enterprise mode uses 802.1X and a RADIUS server to authenticate each user."],
["2.3","Fifty APs must be configured consistently and updated together. Which approach fits?",["Autonomous APs","Lightweight APs with a wireless LAN controller","Ad hoc mode","Mesh with omnidirectional antennas"],1,"A WLAN controller centrally manages lightweight APs."],
["2.4","A new rack's switches pull cool air from the front, but they're mounted with ports facing the hot aisle. What problem results?",["PoE budget exceeded","Equipment draws hot exhaust air and overheats","Fiber attenuation","Humidity drops"],1,"Port-side intake/exhaust must match the hot aisle/cold aisle layout."],
["2.4","Servers must stay up through a two-second power flicker and shut down gracefully during long outages. What is required?",["PDU","UPS","Generator only","Surge suppressor"],1,"A UPS bridges short outages and supports graceful shutdown."],
["3.1","An admin needs to know which switch port and patch panel position serves desk 4B. Which document helps?",["Logical network diagram","Cable map / physical diagram","SLA","Change request"],1,"Physical diagrams and cable maps record where cables run and terminate."],
["3.1","A switch firmware update is planned. What must happen before making the change in production?",["Nothing if it's urgent","Submit and get approval through change management","Tell users afterward","Update the asset inventory only"],1,"Change management requires a request, review and approval, with a rollback plan."],
["3.1","Auditors want to know which routers no longer receive security patches. Which status matters?",["End of life","End of support","Decommissioned","Golden configuration"],1,"End of support means no more patches; end of life means the product is no longer sold."],
["3.2","Which SNMP setup provides authentication and encryption?",["v1 with a community string","v2c with traps","v3 with authPriv","v2c with a read-only community"],2,"SNMPv3 with authPriv authenticates and encrypts."],
["3.2","Security needs logs from firewalls, servers and switches correlated to detect attacks. What is needed?",["Syslog collector only","SIEM","NetFlow","Port mirroring"],1,"A SIEM aggregates and correlates events across sources and alerts."],
["3.2","An admin wants to know which hosts are using the most bandwidth without capturing full packets. What should they use?",["Flow data such as NetFlow","Packet capture","SNMP traps","Syslog"],0,"Flow records summarize conversations, bytes and ports without payloads."],
["3.3","The business can lose at most 15 minutes of data. Which metric is this?",["RTO","RPO","MTTR","MTBF"],1,"The recovery point objective is maximum tolerable data loss measured in time."],
["3.3","A DR site has servers and network gear, but data must be restored from backup before use. What kind of site is it?",["Hot","Warm","Cold","Active-active"],1,"A warm site has equipment ready but not current data."],
["3.4","A printer must always receive 10.1.1.50 from DHCP. What should be configured?",["Exclusion for 10.1.1.50","Reservation for the printer's MAC","Shorter lease time","A second scope"],1,"A reservation maps a MAC address to a fixed address."],
["3.4","Clients in a new VLAN get APIPA addresses, but the DHCP server is on another subnet and works for others. What is missing?",["A DHCP reservation","A relay (IP helper) on the new VLAN's gateway","An MX record","A longer lease"],1,"DHCP broadcasts don't cross routers unless a relay forwards them."],
["3.4","mail.example.com is the mail server. Which record tells other servers where to deliver example.com mail?",["A","CNAME","MX","PTR"],2,"The MX record identifies the domain's mail exchanger."],
["3.4","An IPv6 host builds its own global address from the router advertisement with no server. What is this?",["DHCPv6 stateful","SLAAC","APIPA","NAT64"],1,"Stateless address autoconfiguration uses the advertised prefix."],
["3.5","Remote staff should reach corporate apps through the VPN while web browsing goes straight to the internet. Which setting?",["Full tunnel","Split tunnel","Site-to-site","Clientless only"],1,"Split tunneling sends only corporate traffic through the VPN."],
["3.5","Admins must reach switch consoles even when the production network is down. What provides this?",["In-band SSH","Out-of-band management via a console server","SNMP","A jump box on the production LAN"],1,"Out-of-band management uses a separate path such as a console server or cellular link."],
["4.1","A hash is used to confirm a downloaded file wasn't altered. Which part of the CIA triad does this support?",["Confidentiality","Integrity","Availability","Accounting"],1,"Hashing verifies integrity."],
["4.1","Network admins' switch logins must use a protocol that encrypts the whole payload and separates authorization from authentication. Which one?",["RADIUS","TACACS+","LDAP","SAML"],1,"TACACS+ uses TCP, encrypts the entire payload and separates AAA functions."],
["4.1","Which is an example of multifactor authentication?",["Password and PIN","Password and smart card","Fingerprint and face scan","Two passwords"],1,"MFA combines different factor types: something you know plus something you have."],
["4.1","Smart building sensors should be isolated from the corporate network. Which control applies?",["Network segmentation for IoT","Geofencing","Honeypot","SSO"],0,"Segmenting IoT devices into their own VLAN or zone limits what a compromised device can reach."],
["4.2","Users connect to 'CoffeeShop-WiFi' broadcast by an attacker's laptop near the real AP. What attack is this?",["Rogue DHCP","Evil twin","MAC flooding","VLAN hopping"],1,"An evil twin impersonates a legitimate SSID."],
["4.2","Clients suddenly get a default gateway pointing at an unknown host. Which attack is likely?",["DNS poisoning","Rogue DHCP server","DDoS","Shoulder surfing"],1,"A rogue DHCP server hands out its own address as the gateway to intercept traffic."],
["4.2","arp -a shows the gateway and another host sharing the same MAC address. What does this indicate?",["Duplicate IP","ARP spoofing / on-path attack","DHCP exhaustion","Normal behavior"],1,"Two IPs with one MAC, one being the gateway, is a classic ARP spoofing sign."],
["4.2","Someone follows an employee through a badge-controlled door. What is this?",["Phishing","Tailgating","Dumpster diving","Shoulder surfing"],1,"Tailgating is following an authorized person through a secured entrance."],
["4.3","Rules on an ACL are 1) permit ip any any 2) deny tcp any host 10.1.1.5 eq 23. What happens to Telnet traffic to 10.1.1.5?",["Denied by rule 2","Permitted by rule 1","Denied by the implicit deny","Logged and dropped"],1,"ACLs stop at the first match, so rule 1 permits everything and rule 2 never runs."],
["4.3","Only the PC currently connected to a conference room port should be allowed, and the port should shut down if another device appears. What feature does this?",["DHCP snooping","Port security with sticky MAC and shutdown","802.1X guest VLAN","MAC filtering on the AP"],1,"Port security can learn (sticky) the current MAC and err-disable the port on violation."],
["4.3","Devices must authenticate with certificates before getting switch access, with failed devices placed in a remediation VLAN. What provides this?",["802.1X NAC","Port mirroring","Static ARP","URL filtering"],0,"802.1X authenticates devices at the port; NAC can assign VLANs by result."],
["4.3","Public web servers should be reachable from the internet but isolated from the internal LAN. Where do they belong?",["Internal LAN","Screened subnet","Management VLAN","Out-of-band network"],1,"A screened subnet (DMZ) separates public-facing servers from internal systems."],
["5.1","A user reports no internet. The tech confirms the cable is unplugged and plugs it back in. What should happen next?",["Document and close","Verify full functionality","Escalate","Establish a new theory"],1,"After implementing a fix, verify full system functionality before documenting."],
["5.1","Several users report different problems at once. What does the methodology say?",["Fix the easiest first","Approach multiple problems individually","Reboot the core switch","Escalate all of them"],1,"Identifying the problem includes approaching multiple problems individually."],
["5.2","A switch interface shows rising late collisions and the port is set to half duplex. What is the likely cause?",["Bad SFP","Duplex mismatch","Wrong VLAN","PoE budget exceeded"],1,"Late collisions on the half-duplex side are the hallmark of a duplex mismatch."],
["5.2","A new 120 m Cat 6 run shows CRC errors and intermittent drops. What is the most likely cause?",["Attenuation from exceeding 100 m","Crosstalk from plenum jacket","TX/RX transposed","Wrong VLAN"],0,"Copper Ethernet is limited to 100 m; longer runs suffer attenuation and errors."],
["5.2","A new fiber link shows no light at either end, although both optics and the cable test fine individually. What is the likely cause?",["Attenuation","TX/RX transposed","Duplex mismatch","Crosstalk"],1,"Swapped strands send transmit into transmit; rolling the strands fixes it."],
["5.2","A new access point won't power on but works with an injector. The switch reports power denied. What should be checked?",["VLAN assignment","The switch's PoE budget and supported standard","DNS settings","STP state"],1,"The AP may need PoE+ (802.3at) or more power than remains in the switch's budget."],
["5.3","A PC can ping hosts on its own subnet but nothing beyond it. Which setting is most likely wrong?",["DNS server","Default gateway","MAC address","Hosts file"],1,"Local traffic doesn't use the gateway, so a bad gateway breaks only remote destinations."],
["5.3","A PC can browse by IP address but not by name. What is the likely cause?",["Wrong default gateway","DNS misconfiguration","Duplex mismatch","Wrong subnet mask"],1,"Working IP connectivity with failing names points to DNS."],
["5.3","New laptops in one area get 169.254.x.x addresses while existing ones work until their leases expire. What is likely?",["Rogue DHCP","DHCP scope exhaustion","DNS failure","Wrong VLAN on the router"],1,"An exhausted scope can't give new or renewing clients an address."],
["5.4","Voice calls are choppy, and pings to the call server vary between 5 and 180 ms with no loss. What is the problem?",["Jitter","Packet loss","Attenuation","Duplex mismatch"],0,"Large variation in delay is jitter, which hurts real-time traffic."],
["5.4","Users near AP-3 have strong signal but poor throughput, and a Wi-Fi analyzer shows a neighbor AP on the same channel. What is the issue?",["Co-channel interference","Low RSSI","Roaming misconfiguration","Captive portal failure"],0,"APs sharing a channel must take turns, cutting throughput."],
["5.4","Throughput across the network never exceeds 100 Mbps even though all links are gigabit except one 100 Mbps uplink. What is this?",["Jitter","A bottleneck","Latency","Packet loss"],1,"The slowest link limits end-to-end throughput."],
["5.5","Which command shows which switch port a given MAC address was learned on?",["show vlan","show mac address-table","show ip route","show interfaces trunk"],1,"The MAC address table maps MACs to ports and VLANs."],
["5.5","A tech must find which patch panel port an unlabeled cable from desk 12 lands on. Which tool?",["Cable tester","Toner and probe","Optical power meter","Wi-Fi analyzer"],1,"The toner injects a signal the probe can find at the far end."],
["5.5","Which Linux command shows detailed DNS answers including record types and TTLs?",["ping","dig","netstat","ip route"],1,"dig shows full DNS response sections."],
["5.5","Which tool finds a break in a fiber strand by shining visible red light through it?",["OTDR","Visual fault locator","Toner","Tap"],1,"A visual fault locator's light leaks out at breaks and tight bends."],
["5.5","Which command shows the ports a Windows server is listening on?",["ipconfig /all","netstat -an","tracert","arp -a"],1,"netstat -an lists connections and listening ports."]
];

/* Lab Bench built-in network simulations. Content: CC BY-SA 4.0. Every sim is verified by tests/run.js:
   it must start with at least one failing requirement, and its solution must make every requirement pass. */

const P = (name, mode, vlan, extra) => ({name, mode, vlan, allowed:"all", native:1, shutdown:false, ...(extra||{})});
const H = (id, kind, name, x, y, cfg, editable=true) => ({id, kind, name, x, y, editable, mode:"static", ip:"", mask:"", gw:"", dns:"", ...cfg});
const IF = (name, ip, mask, extra) => ({name, vlan:null, ip, mask, helper:"", ...(extra||{})});
const M24 = "255.255.255.0", M30 = "255.255.255.252";
const SW = (id, name, x, y, ports, extra) => ({id, kind:"switch", name, x, y, editable:true, ports, ...(extra||{})});
const RT = (id, name, x, y, ifaces, extra) => ({id, kind:"router", name, x, y, editable:true, ifaces, defaultRoute:"", ...(extra||{})});
const NET = (prompt, o) => ({type:"net", prompt: prompt || "Make every requirement pass.", ...o});
const ISP = (x, y, ip) => ({id:"isp", kind:"cloud", name:"Internet", x, y, editable:false, ip, records:{"comptia.org":"198.51.100.24","www.comptia.org":"198.51.100.24","updates.example.com":"203.0.113.80"}});

const SIM_LABS = [
{ id:"s-branch", title:"Sim: get the branch back online", domain:"troubleshooting", difficulty:2, objective:"5.3", objectives:["5.3","5.5"],
  scenario:"Users on PC-2 and PC-3 can't browse the web. PC-1 works fine. R1 and DNS-01 are managed by the WAN team and are locked. Investigate from the PCs and the switch, then fix the configuration.",
  tasks:[NET(null,{
    devices:[ISP(92,4,"203.0.113.1"),
      RT("r1","R1",92,42,[IF("Gi0/0","203.0.113.2",M30),IF("Gi0/1","192.168.50.1",M24)],{editable:false, defaultRoute:"203.0.113.1"}),
      SW("sw1","SW1",50,52,[P("Gi0/1","access",50),P("Gi0/2","access",50),P("Gi0/3","access",1),P("Gi0/4","access",50),P("Gi0/24","access",50)],{vlanNames:{"50":"BRANCH"}}),
      H("srv","server","DNS-01",8,30,{ip:"192.168.50.5", mask:M24, gw:"192.168.50.1", dns:"192.168.50.5", forwarder:"8.8.8.8", dnsRecords:{"intranet.branch.local":"192.168.50.5","dns-01.branch.local":"192.168.50.5"}}, false),
      H("pc1","pc","PC-1",8,94,{ip:"192.168.50.11", mask:M24, gw:"192.168.50.1", dns:"192.168.50.5"}),
      H("pc2","pc","PC-2",42,94,{ip:"192.168.50.12", mask:M24, gw:"192.168.50.254", dns:"192.168.50.5"}),
      H("pc3","pc","PC-3",76,94,{ip:"192.168.50.13", mask:M24, gw:"192.168.50.1", dns:"192.168.50.5"})],
    links:[["isp","WAN","r1","Gi0/0"],["r1","Gi0/1","sw1","Gi0/24"],["srv","NIC","sw1","Gi0/4"],["pc1","NIC","sw1","Gi0/1"],["pc2","NIC","sw1","Gi0/2"],["pc3","NIC","sw1","Gi0/3"]],
    goals:[{type:"ping", from:"pc1", to:"comptia.org", label:"PC-1 can reach comptia.org"},{type:"ping", from:"pc2", to:"comptia.org", label:"PC-2 can reach comptia.org"},{type:"ping", from:"pc3", to:"comptia.org", label:"PC-3 can reach comptia.org"},{type:"ping", from:"pc3", to:"intranet.branch.local", label:"PC-3 can reach intranet.branch.local"}],
    solution:[{dev:"pc2", set:{gw:"192.168.50.1"}},{dev:"sw1", port:"Gi0/3", set:{vlan:50}}],
    explanation:"PC-2's default gateway was 192.168.50.254, which nothing answers, so anything off-subnet failed while local traffic (including DNS) still worked. PC-3's switch port was in VLAN 1 instead of 50, cutting it off entirely. Compare ipconfig with a working PC, ping the gateway, and run show vlan brief."})]},

{ id:"s-roas", title:"Sim: build router-on-a-stick", domain:"implementation", difficulty:3, objective:"2.2", objectives:["2.2","2.1"],
  scenario:"Staff PCs in VLAN 10 must print to Printer-1 in VLAN 20. R1 routes between the VLANs over one link to SW1. The PCs and printer already use the .1 address of their subnet as the gateway. Finish R1 and SW1.",
  tasks:[NET(null,{
    devices:[RT("r1","R1",50,4,[IF("Gi0/0.10","","",{vlan:10}),IF("Gi0/0.20","","",{vlan:20})]),
      SW("sw1","SW1",50,48,[P("Gi0/1","access",10),P("Gi0/2","access",1),P("Gi0/3","access",10),P("Gi0/24","access",1)],{vlanNames:{"10":"STAFF","20":"PRINTERS"}}),
      H("pca","pc","Staff-1",8,94,{ip:"192.168.10.10", mask:M24, gw:"192.168.10.1"}, false),
      H("pcb","pc","Staff-2",50,94,{ip:"192.168.10.11", mask:M24, gw:"192.168.10.1"}, false),
      H("prn","printer","Printer-1",92,94,{ip:"192.168.20.50", mask:M24, gw:"192.168.20.1"}, false)],
    links:[["r1","Gi0/0","sw1","Gi0/24"],["pca","NIC","sw1","Gi0/1"],["prn","NIC","sw1","Gi0/2"],["pcb","NIC","sw1","Gi0/3"]],
    goals:[{type:"ping", from:"pca", to:"192.168.10.1", label:"Staff-1 can reach its gateway, 192.168.10.1"},{type:"ping", from:"pca", to:"192.168.20.50", label:"Staff-1 can reach Printer-1"},{type:"ping", from:"pcb", to:"192.168.20.50", label:"Staff-2 can reach Printer-1"}],
    solution:[{dev:"r1", iface:"Gi0/0.10", set:{ip:"192.168.10.1", mask:M24}},{dev:"r1", iface:"Gi0/0.20", set:{ip:"192.168.20.1", mask:M24}},{dev:"sw1", port:"Gi0/24", set:{mode:"trunk"}},{dev:"sw1", port:"Gi0/2", set:{vlan:20}}],
    explanation:"Each 802.1Q subinterface needs the gateway address for its VLAN. The switch port facing R1 must be a trunk so both VLANs arrive tagged, and the printer's access port belongs in VLAN 20."})]},

{ id:"s-dhcp", title:"Sim: contractors get 169.254 addresses", domain:"operations", difficulty:3, objective:"3.4", objectives:["3.4","5.3"],
  scenario:"Contractor laptops in VLAN 30 end up with 169.254.x.x addresses and can't reach anything. Devices in VLAN 10 work. DHCP-01 is supposed to serve both subnets.",
  tasks:[NET(null,{
    devices:[RT("r1","R1",50,4,[IF("Gi0/0.10","192.168.10.1",M24,{vlan:10}),IF("Gi0/0.30","192.168.30.1",M24,{vlan:30})]),
      SW("sw1","SW1",50,48,[P("Gi0/1","access",10),P("Gi0/2","access",10),P("Gi0/3","access",30),P("Gi0/24","trunk",1,{allowed:"10,30"})],{vlanNames:{"10":"SERVERS","30":"CONTRACTORS"}}),
      H("srv","server","DHCP-01",8,40,{ip:"192.168.10.5", mask:M24, gw:"192.168.10.1", dns:"192.168.10.5", dnsRecords:{"files.corp.local":"192.168.10.5","dhcp-01.corp.local":"192.168.10.5"},
        dhcp:[{network:"192.168.10.0/24", start:"192.168.10.100", gw:"192.168.10.1", dns:"192.168.10.5"},{network:"192.168.30.0/24", start:"192.168.30.100", gw:"192.168.30.254", dns:"192.168.10.5"}]}),
      H("pc","pc","PC-10",40,94,{mode:"dhcp"}, false), H("lap","laptop","Laptop-30",85,94,{mode:"dhcp"}, false)],
    links:[["r1","Gi0/0","sw1","Gi0/24"],["srv","NIC","sw1","Gi0/1"],["pc","NIC","sw1","Gi0/2"],["lap","NIC","sw1","Gi0/3"]],
    goals:[{type:"dhcp", host:"lap", label:"Laptop-30 gets a DHCP lease"},{type:"ping", from:"lap", to:"files.corp.local", label:"Laptop-30 can reach files.corp.local"},{type:"ping", from:"pc", to:"files.corp.local", label:"PC-10 can still reach files.corp.local"}],
    solution:[{dev:"r1", iface:"Gi0/0.30", set:{helper:"192.168.10.5"}},{dev:"srv", pool:1, set:{gw:"192.168.30.1"}}],
    explanation:"DHCP discovers are broadcasts and never leave VLAN 30 unless R1 relays them with an ip helper-address pointing at DHCP-01. The VLAN 30 scope also handed out the wrong router option (.254), so leases worked but nothing off-subnet did."})]},

{ id:"s-trunk", title:"Sim: stretch VLANs across two switches", domain:"implementation", difficulty:2, objective:"2.2", objectives:["2.2"],
  scenario:"Engineering (VLAN 20) and Users (VLAN 10) span two switches joined by a trunk. Eng-B can't reach ENG-FS, and User-C can't reach User-A. There's no router, and the VLANs must stay separate.",
  tasks:[NET(null,{
    devices:[SW("sw1","SW1",25,40,[P("Gi0/1","access",20),P("Gi0/2","access",10),P("Gi0/24","trunk",1,{allowed:"10"})],{vlanNames:{"10":"USERS","20":"ENGINEERING"}}),
      SW("sw2","SW2",75,40,[P("Gi0/1","access",20),P("Gi0/2","access",1),P("Gi0/24","trunk",1,{allowed:"10,20"})],{vlanNames:{"10":"USERS","20":"ENGINEERING"}}),
      H("fs","server","ENG-FS",5,94,{ip:"172.16.20.10", mask:M24}, false), H("pca","pc","User-A",38,94,{ip:"172.16.10.21", mask:M24}, false),
      H("pcb","pc","Eng-B",62,94,{ip:"172.16.20.22", mask:M24}, false), H("pcc","pc","User-C",95,94,{ip:"172.16.10.23", mask:M24}, false)],
    links:[["sw1","Gi0/24","sw2","Gi0/24"],["fs","NIC","sw1","Gi0/1"],["pca","NIC","sw1","Gi0/2"],["pcb","NIC","sw2","Gi0/1"],["pcc","NIC","sw2","Gi0/2"]],
    goals:[{type:"ping", from:"pcb", to:"172.16.20.10", label:"Eng-B can reach ENG-FS"},{type:"ping", from:"pcc", to:"172.16.10.21", label:"User-C can reach User-A"},{type:"ping", from:"pca", to:"172.16.20.10", expect:false, label:"User-A still can't reach ENG-FS"}],
    solution:[{dev:"sw1", port:"Gi0/24", set:{allowed:"10,20"}},{dev:"sw2", port:"Gi0/2", set:{vlan:10}}],
    explanation:"A trunk carries only the VLANs on its allowed list, and both ends must allow a VLAN. User-C's port was left in the default VLAN 1. show interfaces trunk on both switches reveals the mismatch."})]},

{ id:"s-slash27", title:"Sim: address the new /27", domain:"concepts", difficulty:2, objective:"1.7", objectives:["1.7"],
  scenario:"A new office was assigned 10.20.30.0/27. R1 uses the first usable address as the gateway. Give both desks any unused valid host address, give App-01 the last usable address, and make sure everything reaches the internet.",
  tasks:[NET(null,{
    devices:[ISP(92,4,"203.0.113.5"), RT("r1","R1",92,44,[IF("Gi0/0","203.0.113.6",M30),IF("Gi0/1","10.20.30.1","255.255.255.224")],{editable:false, defaultRoute:"203.0.113.5"}),
      SW("sw1","SW1",50,52,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1),P("Gi0/24","access",1)],{editable:false}),
      H("pc1","pc","Desk-1",8,94,{}), H("pc2","pc","Desk-2",45,94,{}), H("app","server","App-01",82,94,{})],
    links:[["isp","WAN","r1","Gi0/0"],["r1","Gi0/1","sw1","Gi0/24"],["pc1","NIC","sw1","Gi0/1"],["pc2","NIC","sw1","Gi0/2"],["app","NIC","sw1","Gi0/3"]],
    goals:[{type:"config", dev:"app", field:"ip", equals:["10.20.30.30"], label:"App-01 uses the last usable address"},{type:"config", dev:"pc1", field:"mask", equals:["255.255.255.224"], label:"Desk-1 uses the correct subnet mask"},{type:"config", dev:"pc2", field:"mask", equals:["255.255.255.224"], label:"Desk-2 uses the correct subnet mask"},
      {type:"ping", from:"pc1", to:"8.8.8.8", label:"Desk-1 can reach 8.8.8.8"},{type:"ping", from:"pc2", to:"8.8.8.8", label:"Desk-2 can reach 8.8.8.8"},{type:"ping", from:"app", to:"8.8.8.8", label:"App-01 can reach 8.8.8.8"}],
    solution:[{dev:"pc1", set:{ip:"10.20.30.10", mask:"255.255.255.224", gw:"10.20.30.1"}},{dev:"pc2", set:{ip:"10.20.30.11", mask:"255.255.255.224", gw:"10.20.30.1"}},{dev:"app", set:{ip:"10.20.30.30", mask:"255.255.255.224", gw:"10.20.30.1"}}],
    explanation:"A /27 is 255.255.255.224, blocks of 32: .0 is the network and .31 the broadcast, so hosts are .1 to .30. Any unique .2 to .29 works for the desks, App-01 takes .30, and everyone uses .1 as the gateway."})]},

{ id:"s-static", title:"Sim: static routes between two sites", domain:"implementation", difficulty:2, objective:"2.1", objectives:["2.1","5.3"],
  scenario:"HQ and the branch are joined by a point-to-point WAN link (10.0.12.0/30). Users at each site can reach their own router but not the other site. Fix the routing on HQ-R1 and BR-R2.",
  tasks:[NET(null,{
    devices:[RT("r1","HQ-R1",25,28,[IF("Gi0/0","10.0.12.1",M30),IF("Gi0/1","10.1.0.1",M24)],{routes:[{net:"10.2.0.0/24", via:"10.0.12.6"}]}),
      RT("r2","BR-R2",75,28,[IF("Gi0/0","10.0.12.2",M30),IF("Gi0/1","10.2.0.1",M24)]),
      SW("sw1","HQ-SW",25,62,[P("Gi0/1","access",1),P("Gi0/24","access",1)],{editable:false}), SW("sw2","BR-SW",75,62,[P("Gi0/1","access",1),P("Gi0/24","access",1)],{editable:false}),
      H("pc1","pc","HQ-PC",25,95,{ip:"10.1.0.10", mask:M24, gw:"10.1.0.1"}, false), H("pc2","pc","BR-PC",75,95,{ip:"10.2.0.10", mask:M24, gw:"10.2.0.1"}, false)],
    links:[["r1","Gi0/0","r2","Gi0/0"],["r1","Gi0/1","sw1","Gi0/24"],["r2","Gi0/1","sw2","Gi0/24"],["pc1","NIC","sw1","Gi0/1"],["pc2","NIC","sw2","Gi0/1"]],
    goals:[{type:"ping", from:"pc1", to:"10.2.0.10", label:"HQ-PC can reach BR-PC"},{type:"ping", from:"pc2", to:"10.1.0.10", label:"BR-PC can reach HQ-PC"},{type:"state", check:"route", dev:"r1", to:"10.2.0.10", via:"10.0.12.2", label:"HQ-R1 routes 10.2.0.0/24 to BR-R2"}],
    solution:[{dev:"r1", routes:[{net:"10.2.0.0/24", via:"10.0.12.2"}]},{dev:"r2", routes:[{net:"10.1.0.0/24", via:"10.0.12.1"}]}],
    explanation:"A static route's next hop must be an address on a directly connected network; 10.0.12.6 isn't in 10.0.12.0/30 (hosts .1 and .2), so HQ-R1 ignored the route. BR-R2 had no route back at all, and both directions are needed."})]},

{ id:"s-ospf", title:"Sim: OSPF and route selection", domain:"implementation", difficulty:3, objective:"2.1", objectives:["2.1","5.3"],
  scenario:"Three routers run OSPF. The direct R1 to R3 link is a slow backup (OSPF cost 10). Traffic between the R1 and R3 LANs should use the fast path through R2, and an old static route on R1 should stay only as a backup. Right now R3's LAN is unreachable over the fast path.",
  tasks:[NET(null,{
    devices:[RT("r1","R1",15,30,[IF("Gi0/0","10.0.12.1",M30),IF("Gi0/2","10.0.13.1",M30,{ospfCost:10}),IF("Gi0/1","10.1.0.1",M24)],{ospf:{enabled:true, area:0}, routes:[{net:"10.3.0.0/24", via:"10.0.13.2"}]}),
      RT("r2","R2",50,6,[IF("Gi0/0","10.0.12.2",M30),IF("Gi0/1","10.0.23.1",M30)],{ospf:{enabled:true, area:0, passive:["Gi0/1"]}}),
      RT("r3","R3",85,30,[IF("Gi0/0","10.0.23.2",M30),IF("Gi0/2","10.0.13.2",M30,{ospfCost:10}),IF("Gi0/1","10.3.0.1",M24)],{ospf:{enabled:true, area:1}}),
      H("pc1","pc","LAN-1 PC",15,94,{ip:"10.1.0.10", mask:M24, gw:"10.1.0.1"}, false), H("pc3","pc","LAN-3 PC",85,94,{ip:"10.3.0.10", mask:M24, gw:"10.3.0.1"}, false)],
    links:[["r1","Gi0/0","r2","Gi0/0"],["r2","Gi0/1","r3","Gi0/0"],["r1","Gi0/2","r3","Gi0/2",{cable:"cat5"}],["pc1","NIC","r1","Gi0/1"],["pc3","NIC","r3","Gi0/1"]],
    goals:[{type:"ping", from:"pc1", to:"10.3.0.10", label:"LAN-1 PC can reach LAN-3 PC"},{type:"state", check:"route", dev:"r1", to:"10.3.0.10", via:"10.0.12.2", rtype:"O", label:"R1 reaches 10.3.0.0/24 through R2 using OSPF"},{type:"state", check:"route", dev:"r3", to:"10.1.0.10", via:"10.0.23.1", rtype:"O", label:"R3 reaches 10.1.0.0/24 through R2 using OSPF"}],
    solution:[{dev:"r3", set:{ospf:{enabled:true, area:0}}},{dev:"r2", set:{ospf:{enabled:true, area:0, passive:[]}}},{dev:"r1", routes:[{net:"10.3.0.0/24", via:"10.0.13.2", ad:200}]}],
    explanation:"Neighbors must agree on the area, and a passive interface never forms adjacencies. Even with OSPF working, R1's static route (administrative distance 1) beats OSPF (110) for the same /24, so it's turned into a floating static with AD 200."})]},

{ id:"s-nat", title:"Sim: nobody can reach the internet", domain:"implementation", difficulty:2, objective:"2.1", objectives:["2.1","5.3"],
  scenario:"The office router was replaced and now nobody can reach the internet. The ISP assigned 203.0.113.8/29 with their gateway at .9; the router uses .10. Internal hosts use private addresses and must share the router's public address.",
  tasks:[NET(null,{
    devices:[ISP(92,4,"203.0.113.9"),
      RT("r1","Edge",92,44,[IF("Gi0/0","203.0.113.10","255.255.255.248",{nat:"outside"}),IF("Gi0/1","192.168.1.1",M24)],{defaultRoute:"203.0.113.1"}),
      SW("sw1","SW1",50,52,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/24","access",1)],{editable:false}),
      H("pc1","pc","Office-1",15,94,{ip:"192.168.1.20", mask:M24, gw:"192.168.1.1", dns:"8.8.8.8"}, false), H("pc2","laptop","Office-2",60,94,{ip:"192.168.1.21", mask:M24, gw:"192.168.1.1", dns:"8.8.8.8"}, false)],
    links:[["isp","WAN","r1","Gi0/0"],["r1","Gi0/1","sw1","Gi0/24"],["pc1","NIC","sw1","Gi0/1"],["pc2","NIC","sw1","Gi0/2"]],
    goals:[{type:"ping", from:"pc1", to:"8.8.8.8", label:"Office-1 can reach 8.8.8.8"},{type:"ping", from:"pc1", to:"comptia.org", label:"Office-1 can reach comptia.org by name"},{type:"conn", from:"pc2", to:"comptia.org", proto:"tcp", port:443, label:"Office-2 can open https://comptia.org"}],
    solution:[{dev:"r1", set:{defaultRoute:"203.0.113.9"}},{dev:"r1", iface:"Gi0/1", set:{nat:"inside"}}],
    explanation:"The default route pointed at .1, which isn't on the router's 203.0.113.8/29 network (usable .9 to .14). Port address translation (PAT, NAT overload) only translates traffic arriving on an inside interface and leaving an outside one, so Gi0/1 must be marked inside."})]},

{ id:"s-acl", title:"Sim: keep guests out of the server VLAN", domain:"security", difficulty:3, objective:"4.3", objectives:["4.3","5.3"],
  scenario:"Guests on 10.20.0.0/24 must reach the internet but must not reach staff (10.10.0.0/24) or servers (10.30.0.0/24). Staff need HTTPS to App-01. An access list GUEST_IN is applied inbound on the guest interface, but guests can currently reach everything.",
  tasks:[NET(null,{
    devices:[ISP(92,4,"203.0.113.1"),
      RT("r1","Core-R1",55,36,[IF("Gi0/0","10.10.0.1",M24),IF("Gi0/1","10.20.0.1",M24,{acl:"GUEST_IN"}),IF("Gi0/2","10.30.0.1",M24),IF("Gi0/3","203.0.113.2",M30)],{defaultRoute:"203.0.113.1", acls:{GUEST_IN:[{action:"permit", proto:"ip", src:"any", dst:"any"},{action:"deny", proto:"ip", src:"10.20.0.0/24", dst:"10.30.0.0/24"}]}}),
      H("staff","pc","Staff-PC",10,94,{ip:"10.10.0.10", mask:M24, gw:"10.10.0.1", dns:"8.8.8.8"}, false),
      H("guest","laptop","Guest-Laptop",50,94,{ip:"10.20.0.50", mask:M24, gw:"10.20.0.1", dns:"8.8.8.8"}, false),
      H("app","server","App-01",90,94,{ip:"10.30.0.10", mask:M24, gw:"10.30.0.1", services:["tcp/443","tcp/22"]}, false)],
    links:[["isp","WAN","r1","Gi0/3"],["staff","NIC","r1","Gi0/0"],["guest","NIC","r1","Gi0/1"],["app","NIC","r1","Gi0/2"]],
    goals:[{type:"conn", from:"staff", to:"10.30.0.10", proto:"tcp", port:443, label:"Staff-PC can reach App-01 on HTTPS"},{type:"ping", from:"guest", to:"8.8.8.8", label:"Guests can reach the internet"},
      {type:"conn", from:"guest", to:"10.30.0.10", proto:"tcp", port:443, expect:false, label:"Guests can't reach App-01"},{type:"ping", from:"guest", to:"10.10.0.10", expect:false, label:"Guests can't reach the staff network"}],
    solution:[{dev:"r1", acl:"GUEST_IN", rules:[{action:"deny", proto:"ip", src:"10.20.0.0/24", dst:"10.10.0.0/24"},{action:"deny", proto:"ip", src:"10.20.0.0/24", dst:"10.30.0.0/24"},{action:"permit", proto:"ip", src:"any", dst:"any"}]}],
    explanation:"ACLs are read top-down and stop at the first match. A permit any at the top matches everything, so the deny under it never runs. Put the specific denies first and the broad permit last; without that final permit, the implicit deny would also block the internet."})]},

{ id:"s-fhrp", title:"Sim: the primary router died", domain:"implementation", difficulty:2, objective:"2.1", objectives:["2.1","3.3"],
  scenario:"R1 and R2 share a virtual gateway (FHRP) on both subnets so either can fail. R1 just lost power. One user is down and the other is too, even though R2 is fine. Fix it so the network survives R1 being offline.",
  tasks:[NET(null,{
    devices:[RT("r1","R1",30,40,[IF("Gi0/0","10.99.0.2",M24,{vip:"10.99.0.1", vipPriority:110}),IF("Gi0/1","10.5.0.2",M24,{vip:"10.5.0.1", vipPriority:110})],{power:false, editable:false}),
      RT("r2","R2",70,40,[IF("Gi0/0","10.99.0.3",M24,{vip:"10.99.0.1"}),IF("Gi0/1","10.5.0.3",M24,{vip:"10.5.0.11"})]),
      SW("swc","SW-Core",50,6,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1)],{editable:false}),
      SW("swa","SW-Access",50,68,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1),P("Gi0/4","access",1)],{editable:false}),
      H("fs","server","Files",88,6,{ip:"10.99.0.20", mask:M24, gw:"10.99.0.1"}, false),
      H("pc1","pc","User-1",25,95,{ip:"10.5.0.21", mask:M24, gw:"10.5.0.2"}), H("pc2","pc","User-2",75,95,{ip:"10.5.0.22", mask:M24, gw:"10.5.0.1"})],
    links:[["r1","Gi0/0","swc","Gi0/1"],["r2","Gi0/0","swc","Gi0/2"],["fs","NIC","swc","Gi0/3"],["r1","Gi0/1","swa","Gi0/1"],["r2","Gi0/1","swa","Gi0/2"],["pc1","NIC","swa","Gi0/3"],["pc2","NIC","swa","Gi0/4"]],
    goals:[{type:"ping", from:"pc1", to:"10.99.0.20", label:"User-1 can reach Files"},{type:"ping", from:"pc2", to:"10.99.0.20", label:"User-2 can reach Files"},{type:"config", dev:"pc1", field:"gw", equals:["10.5.0.1"], label:"User-1 uses the virtual gateway"}],
    solution:[{dev:"r2", iface:"Gi0/1", set:{vip:"10.5.0.1"}},{dev:"pc1", set:{gw:"10.5.0.1"}}],
    explanation:"Hosts must point at the virtual IP, not a router's real address, or they lose their gateway when that router fails. Both routers in the group also need the same virtual IP; R2 had a typo, so it never took over 10.5.0.1."})]},

{ id:"s-stp", title:"Sim: the network melted down", domain:"troubleshooting", difficulty:3, objective:"5.3", objectives:["5.3","2.2"],
  scenario:"Right after Acc-3 was installed, the whole network stopped responding and switch CPUs spiked. The three switches are cabled in a triangle for redundancy. Core-1 is supposed to be the root bridge.",
  tasks:[NET(null,{
    devices:[SW("core","Core-1",50,8,[P("Gi1/0/1","trunk",1),P("Gi1/0/2","trunk",1),P("Gi1/0/10","access",1)],{mac:"00:1a:2b:00:00:50"}),
      SW("dist","Dist-2",18,50,[P("Gi1/0/1","trunk",1),P("Gi1/0/2","trunk",1),P("Gi1/0/10","access",1)],{mac:"00:1a:2b:00:00:40"}),
      SW("acc","Acc-3",82,50,[P("Gi1/0/1","trunk",1),P("Gi1/0/2","trunk",1),P("Gi1/0/10","access",1)],{mac:"00:1a:2b:00:00:10", stp:{enabled:false, priority:32768}}),
      H("srv","server","Server",88,8,{ip:"10.0.0.5", mask:M24}, false), H("pc1","pc","PC-Dist",18,94,{ip:"10.0.0.21", mask:M24}, false), H("pc2","pc","PC-Acc",82,94,{ip:"10.0.0.22", mask:M24}, false)],
    links:[["core","Gi1/0/1","dist","Gi1/0/1"],["core","Gi1/0/2","acc","Gi1/0/1"],["dist","Gi1/0/2","acc","Gi1/0/2"],["srv","NIC","core","Gi1/0/10"],["pc1","NIC","dist","Gi1/0/10"],["pc2","NIC","acc","Gi1/0/10"]],
    goals:[{type:"state", check:"noStorm", label:"No switching loop (no broadcast storm)"},{type:"state", check:"root", dev:"core", label:"Core-1 is the root bridge"},{type:"ping", from:"pc1", to:"10.0.0.5", label:"PC-Dist can reach Server"},{type:"ping", from:"pc2", to:"10.0.0.5", label:"PC-Acc can reach Server"}],
    solution:[{dev:"acc", set:{stp:{enabled:true, priority:32768}}},{dev:"core", set:{stp:{enabled:true, priority:4096}}}],
    explanation:"With spanning tree disabled on Acc-3, the triangle forms a loop and broadcasts circle forever. Once STP is on, the lowest bridge ID wins the root election; with default priorities that's the lowest MAC (Acc-3). Set Core-1's priority lower (4096) so it's root."})]},

{ id:"s-lacp", title:"Sim: the uplink bundle won't come up", domain:"implementation", difficulty:2, objective:"2.2", objectives:["2.2","5.2"],
  scenario:"Two 1 Gbps links between SW1 and SW2 should form one 2 Gbps port-channel using LACP. Since the change window, users on SW2 can't reach the server on SW1.",
  tasks:[NET(null,{
    devices:[SW("sw1","SW1",25,40,[P("Gi0/1","access",1),P("Gi0/23","trunk",1,{channel:1, lacp:"active"}),P("Gi0/24","trunk",1,{channel:1, lacp:"active"})]),
      SW("sw2","SW2",75,40,[P("Gi0/1","access",1),P("Gi0/23","trunk",1,{channel:1, lacp:"on"}),P("Gi0/24","trunk",1,{channel:1, lacp:"on"})]),
      H("srv","server","Server",25,94,{ip:"10.8.0.5", mask:M24}, false), H("pc","pc","User-PC",75,94,{ip:"10.8.0.30", mask:M24}, false)],
    links:[["sw1","Gi0/23","sw2","Gi0/23"],["sw1","Gi0/24","sw2","Gi0/24"],["srv","NIC","sw1","Gi0/1"],["pc","NIC","sw2","Gi0/1"]],
    goals:[{type:"ping", from:"pc", to:"10.8.0.5", label:"User-PC can reach Server"},{type:"state", check:"bundle", dev:"sw1", members:2, label:"Both links are bundled in Port-channel 1"}],
    solution:[{dev:"sw2", port:"Gi0/23", set:{lacp:"passive"}},{dev:"sw2", port:"Gi0/24", set:{lacp:"passive"}}],
    explanation:"Mode on forces a static channel with no LACP, while active sends LACP. An LACP port that hears nothing back is suspended, so both links went down. Active with active or passive forms the bundle; passive with passive never does."})]},

{ id:"s-phys", title:"Sim: slow and flaky in the IDF", domain:"troubleshooting", difficulty:3, objective:"5.2", objectives:["5.2","1.5"],
  scenario:"A new IDF switch connects to the MDF over 400 m of single-mode fiber. Nobody in the IDF can reach the file server. Earlier, before the uplink was moved, PC-1 complained of slowness and PC-2 could barely get 10 Mbps. Fix the physical layer so both PCs get at least 500 Mbps to the server.",
  tasks:[NET(null,{
    devices:[SW("mdf","SW-MDF",28,30,[P("Gi1/0/1","access",1),P("Te1/1","access",1,{sfp:"10GBASE-LR"})]),
      SW("idf","SW-IDF",72,30,[P("Gi1/0/1","access",1,{speed:"100", duplex:"full"}),P("Gi1/0/2","access",1),P("Te1/1","access",1,{sfp:"10GBASE-SR"})]),
      H("srv","server","File-Server",28,90,{ip:"10.50.0.5", mask:M24}, false), H("pc1","pc","PC-1",60,94,{ip:"10.50.0.21", mask:M24}, false), H("pc2","pc","PC-2",90,94,{ip:"10.50.0.22", mask:M24}, false)],
    links:[["mdf","Te1/1","idf","Te1/1",{cable:"smf", length:400}],["srv","NIC","mdf","Gi1/0/1"],["pc1","NIC","idf","Gi1/0/1"],["pc2","NIC","idf","Gi1/0/2",{cable:"cat3", length:40}]],
    goals:[{type:"state", check:"portUp", dev:"idf", port:"Te1/1", label:"The fiber uplink is up"},{type:"perf", from:"pc1", to:"10.50.0.5", minMbps:500, maxLoss:0.01, label:"PC-1 gets 500+ Mbps with no loss"},{type:"perf", from:"pc2", to:"10.50.0.5", minMbps:500, maxLoss:0.01, label:"PC-2 gets 500+ Mbps with no loss"}],
    solution:[{dev:"idf", port:"Te1/1", set:{sfp:"10GBASE-LR"}},{dev:"idf", port:"Gi1/0/1", set:{speed:"auto", duplex:"auto"}},{link:["pc2","NIC"], set:{cable:"cat6"}}],
    explanation:"10GBASE-SR optics are for multimode fiber; single-mode needs LR, and both ends must match. Gi1/0/1 was hard-set to 100/full while the PC autonegotiated, so the PC fell back to half duplex (a duplex mismatch: late collisions on one side, CRC errors and runts on the other). Cat 3 cable can't carry more than 10 Mbps."})]},

{ id:"s-poe", title:"Sim: phones and the AP won't power on", domain:"troubleshooting", difficulty:2, objective:"5.2", objectives:["5.2","2.4"],
  scenario:"Floor 2 got four new IP phones and a Wi-Fi 6 access point on an old switch. Only some phones boot and the AP never comes up. The AP needs 802.3at (PoE+). Choose the switch settings that represent the right replacement switch, or another valid fix.",
  tasks:[NET(null,{
    devices:[SW("sw","SW-Floor2",50,30,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1),P("Gi0/4","access",1),P("Gi0/5","access",1),P("Gi0/24","access",1)],{poeStd:"af", poeBudget:45}),
      H("cm","server","Call-Mgr",92,8,{ip:"10.30.0.5", mask:M24}, false),
      H("ph1","phone","Phone-1",5,94,{ip:"10.30.0.41", mask:M24, poe:{std:"af", watts:12}}, false), H("ph2","phone","Phone-2",25,94,{ip:"10.30.0.42", mask:M24, poe:{std:"af", watts:12}}, false),
      H("ph3","phone","Phone-3",45,94,{ip:"10.30.0.43", mask:M24, poe:{std:"af", watts:12}}, false), H("ph4","phone","Phone-4",65,94,{ip:"10.30.0.44", mask:M24, poe:{std:"af", watts:12}}, false),
      H("ap","ap","AP-2F",88,94,{ip:"10.30.0.60", mask:M24, poe:{std:"at", watts:25}})],
    links:[["cm","NIC","sw","Gi0/24"],["ph1","NIC","sw","Gi0/1"],["ph2","NIC","sw","Gi0/2"],["ph3","NIC","sw","Gi0/3"],["ph4","NIC","sw","Gi0/4"],["ap","NIC","sw","Gi0/5"]],
    goals:[{type:"state", check:"powered", dev:"ph4", label:"Phone-4 is powered"},{type:"state", check:"powered", dev:"ap", label:"AP-2F is powered"},{type:"ping", from:"ap", to:"10.30.0.5", label:"AP-2F can reach Call-Mgr"},{type:"ping", from:"ph4", to:"10.30.0.5", label:"Phone-4 can reach Call-Mgr"}],
    solution:[{dev:"sw", set:{poeStd:"at", poeBudget:370}}],
    explanation:"The switch supports only 802.3af (15.4 W per port) with a 45 W budget. Four 12 W phones need 48 W, so the last one is denied, and the AP needs PoE+ (802.3at, 30 W). A PoE+ switch with a larger budget fixes both; a PoE+ injector for the AP plus a bigger budget would also work."})]},

{ id:"s-portsec", title:"Sim: harden the third-floor switch", domain:"security", difficulty:2, objective:"4.3", objectives:["4.3","5.2","4.2"],
  scenario:"The conference-room port (Gi0/2) went err-disabled after someone connected a small switch for two laptops; policy allows two devices there. A device on Gi0/3 is flooding the switch with fake MAC addresses. Unused ports Gi0/4 to Gi0/6 are still enabled. Fix all three.",
  tasks:[NET(null,{
    devices:[SW("sw","SW-3F",50,30,[P("Gi0/1","access",1),P("Gi0/2","access",1,{portSecurity:{enabled:true, max:1, violation:"shutdown"}, errDisabled:true}),P("Gi0/3","access",1),P("Gi0/4","access",1),P("Gi0/5","access",1),P("Gi0/6","access",1),P("Gi0/24","access",1)]),
      SW("mini","Mini-SW",62,62,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1)],{editable:false}),
      H("srv","server","Server",92,8,{ip:"10.40.0.5", mask:M24}, false), H("desk","pc","Desk-1",8,94,{ip:"10.40.0.21", mask:M24}, false),
      H("lap1","laptop","Conf-Laptop-1",50,95,{ip:"10.40.0.31", mask:M24}, false), H("lap2","laptop","Conf-Laptop-2",74,95,{ip:"10.40.0.32", mask:M24}, false),
      H("bad","pc","Unknown-PC",28,94,{ip:"10.40.0.66", mask:M24, macFlood:true}, false)],
    links:[["srv","NIC","sw","Gi0/24"],["desk","NIC","sw","Gi0/1"],["mini","Gi0/1","sw","Gi0/2"],["lap1","NIC","mini","Gi0/2"],["lap2","NIC","mini","Gi0/3"],["bad","NIC","sw","Gi0/3"]],
    goals:[{type:"ping", from:"lap1", to:"10.40.0.5", label:"Conf-Laptop-1 can reach Server"},{type:"ping", from:"lap2", to:"10.40.0.5", label:"Conf-Laptop-2 can reach Server"},{type:"state", check:"macSafe", dev:"sw", label:"Nothing is flooding SW-3F's MAC table"},{type:"state", check:"unusedDown", dev:"sw", label:"Unused ports are shut down"}],
    solution:[{dev:"sw", port:"Gi0/2", set:{portSecurity:{enabled:true, max:2, violation:"shutdown"}, shutdown:false, errDisabled:false}},{dev:"sw", port:"Gi0/3", set:{portSecurity:{enabled:true, max:1, violation:"shutdown"}}},{dev:"sw", port:"Gi0/4", set:{shutdown:true}},{dev:"sw", port:"Gi0/5", set:{shutdown:true}},{dev:"sw", port:"Gi0/6", set:{shutdown:true}}],
    explanation:"Port security counts MAC addresses per port. Raising Gi0/2's maximum to 2 and bouncing it (shutdown, then no shutdown) recovers it from err-disabled. Port security on Gi0/3 shuts the flooding port, and disabling unused ports is basic device hardening."})]},

{ id:"s-rogue", title:"Sim: users get the wrong gateway", domain:"security", difficulty:3, objective:"4.2", objectives:["4.2","4.3","3.4"],
  scenario:"Some users suddenly get addresses like 10.40.0.200 with a gateway of 10.40.0.66 and can't browse. The legitimate DHCP server is DHCP-01 (10.40.0.5) on Gi0/2. Stop the rogue DHCP server from handing out leases without breaking legitimate DHCP.",
  tasks:[NET(null,{
    devices:[ISP(92,4,"203.0.113.1"), RT("r1","R1",92,40,[IF("Gi0/0","203.0.113.2",M30),IF("Gi0/1","10.40.0.1",M24)],{editable:false, defaultRoute:"203.0.113.1"}),
      SW("sw","SW1",50,40,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1),P("Gi0/4","access",1),P("Gi0/5","access",1)]),
      H("dhcp","server","DHCP-01",8,30,{ip:"10.40.0.5", mask:M24, gw:"10.40.0.1", dhcp:[{network:"10.40.0.0/24", start:"10.40.0.100", gw:"10.40.0.1", dns:"8.8.8.8"}]}, false),
      H("pc1","pc","User-1",20,94,{mode:"dhcp"}, false), H("pc2","pc","User-2",50,94,{mode:"dhcp"}, false),
      H("rogue","server","Lab-Pi",80,94,{ip:"10.40.0.66", mask:M24, rogue:true, dhcp:[{network:"10.40.0.0/24", start:"10.40.0.200", gw:"10.40.0.66", dns:"10.40.0.66"}]}, false)],
    links:[["isp","WAN","r1","Gi0/0"],["r1","Gi0/1","sw","Gi0/1"],["dhcp","NIC","sw","Gi0/2"],["pc1","NIC","sw","Gi0/3"],["pc2","NIC","sw","Gi0/4"],["rogue","NIC","sw","Gi0/5"]],
    goals:[{type:"dhcp", host:"pc1", server:"dhcp", label:"User-1 gets its lease from DHCP-01"},{type:"dhcp", host:"pc2", server:"dhcp", label:"User-2 gets its lease from DHCP-01"},{type:"ping", from:"pc1", to:"8.8.8.8", label:"User-1 can reach the internet"}],
    solution:[{dev:"sw", set:{dhcpSnooping:true}},{dev:"sw", port:"Gi0/2", set:{trusted:true}}],
    explanation:"DHCP snooping drops server messages (offers) arriving on untrusted ports, so only the port toward the real server is trusted. Turning snooping on without trusting Gi0/2 would block the legitimate server too. Shutting the rogue's port also works, but snooping prevents the next one."})]},

{ id:"s-arp", title:"Sim: an on-path attacker at the kiosk", domain:"security", difficulty:3, objective:"4.2", objectives:["4.2","4.3"],
  scenario:"Users get their addresses from DHCP-01. A kiosk PC on Gi0/5 is sending ARP replies claiming to be the gateway (10.60.0.1), so traffic flows through it. Enable Dynamic ARP Inspection so spoofed ARP is dropped, without cutting users off from the gateway.",
  tasks:[NET(null,{
    devices:[ISP(92,4,"203.0.113.1"), RT("r1","R1",92,40,[IF("Gi0/0","203.0.113.2",M30),IF("Gi0/1","10.60.0.1",M24)],{editable:false, defaultRoute:"203.0.113.1"}),
      SW("sw","SW1",50,40,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1),P("Gi0/4","access",1),P("Gi0/5","access",1)]),
      H("dhcp","server","DHCP-01",8,30,{ip:"10.60.0.5", mask:M24, gw:"10.60.0.1", dhcp:[{network:"10.60.0.0/24", start:"10.60.0.100", gw:"10.60.0.1", dns:"8.8.8.8"}]}, false),
      H("pc1","pc","User-1",20,94,{mode:"dhcp"}, false), H("pc2","pc","User-2",50,94,{mode:"dhcp"}, false),
      H("kiosk","pc","Kiosk-7",80,94,{ip:"10.60.0.77", mask:M24, gw:"10.60.0.1", arpSpoof:"10.60.0.1"}, false)],
    links:[["isp","WAN","r1","Gi0/0"],["r1","Gi0/1","sw","Gi0/1"],["dhcp","NIC","sw","Gi0/2"],["pc1","NIC","sw","Gi0/3"],["pc2","NIC","sw","Gi0/4"],["kiosk","NIC","sw","Gi0/5"]],
    goals:[{type:"state", check:"arpSafe", host:"pc1", dev:"sw", label:"User-1's ARP entry for the gateway is genuine"},{type:"ping", from:"pc1", to:"8.8.8.8", secure:true, label:"User-1 reaches the internet without going through the attacker"},{type:"dhcp", host:"pc2", server:"dhcp", label:"User-2 still gets DHCP"},{type:"state", check:"portUp", dev:"sw", port:"Gi0/5", label:"Kiosk-7's port stays up (it's needed for the kiosk app)"}],
    solution:[{dev:"sw", set:{dhcpSnooping:true, dai:true}},{dev:"sw", port:"Gi0/1", set:{trusted:true}},{dev:"sw", port:"Gi0/2", set:{trusted:true}}],
    explanation:"DAI checks ARP on untrusted ports against the DHCP snooping binding table, so snooping must be on. Ports toward statically addressed infrastructure (the router and DHCP-01) must be trusted or their ARP is dropped too."})]},

{ id:"s-vlanhop", title:"Sim: lock down the lobby switch", domain:"security", difficulty:2, objective:"4.3", objectives:["4.3","4.2"],
  scenario:"A security scan found that the lobby kiosk's port can negotiate a trunk (DTP), letting it hop into any VLAN, and that unused ports are live. The kiosk belongs in the guest VLAN 30.",
  tasks:[NET(null,{
    devices:[RT("r1","R1",50,4,[IF("Gi0/0.10","10.10.0.1",M24,{vlan:10}),IF("Gi0/0.30","10.30.0.1",M24,{vlan:30})],{editable:false}),
      SW("sw","SW-Lobby",50,44,[P("Gi0/1","access",10),P("Gi0/2","dynamic",1),P("Gi0/3","access",1),P("Gi0/4","access",1),P("Gi0/24","trunk",1,{allowed:"10,30"})],{vlanNames:{"10":"STAFF","30":"GUEST"}}),
      H("pc","pc","Front-Desk",20,94,{ip:"10.10.0.20", mask:M24, gw:"10.10.0.1"}, false), H("kiosk","pc","Lobby-Kiosk",75,94,{ip:"10.30.0.50", mask:M24, gw:"10.30.0.1", dtp:true}, false)],
    links:[["r1","Gi0/0","sw","Gi0/24"],["pc","NIC","sw","Gi0/1"],["kiosk","NIC","sw","Gi0/2"]],
    goals:[{type:"state", check:"noVlanHop", dev:"sw", label:"No user port can form a trunk"},{type:"state", check:"unusedDown", dev:"sw", label:"Unused ports are shut down"},{type:"ping", from:"kiosk", to:"10.30.0.1", label:"Lobby-Kiosk reaches the guest gateway"},{type:"ping", from:"pc", to:"10.10.0.1", label:"Front-Desk reaches the staff gateway"}],
    solution:[{dev:"sw", port:"Gi0/2", set:{mode:"access", vlan:30}},{dev:"sw", port:"Gi0/3", set:{shutdown:true}},{dev:"sw", port:"Gi0/4", set:{shutdown:true}}],
    explanation:"Dynamic (DTP) ports trunk with anything that asks, which is switch spoofing. Hard-code user ports as access ports in the right VLAN and shut what isn't used."})]},

{ id:"s-dns", title:"Sim: the intranet points to the old server", domain:"operations", difficulty:2, objective:"3.4", objectives:["3.4","5.3"],
  scenario:"The intranet moved to Web-01 (10.70.0.80). intranet.corp.local is a CNAME for web01.corp.local. Desk-4 still opens the old server, nobody else can resolve it, and reverse lookups of 10.70.0.80 fail.",
  tasks:[NET(null,{
    devices:[SW("sw","SW1",50,40,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1),P("Gi0/4","access",1)],{editable:false}),
      H("dns","server","DNS-01",10,30,{ip:"10.70.0.53", mask:M24, zone:[{name:"corp.local", type:"MX", value:"10 mail.corp.local"},{name:"mail.corp.local", type:"A", value:"10.70.0.25"},{name:"intranet.corp.local", type:"CNAME", value:"web01.corp.local"}]}),
      H("web","server","Web-01",90,30,{ip:"10.70.0.80", mask:M24, services:["tcp/443","tcp/80"]}, false),
      H("desk","pc","Desk-4",25,94,{ip:"10.70.0.104", mask:M24, dns:"10.70.0.53", hosts:{"intranet.corp.local":"10.70.0.99"}}),
      H("desk2","pc","Desk-5",75,94,{ip:"10.70.0.105", mask:M24, dns:"10.70.0.53", os:"linux"}, false)],
    links:[["dns","NIC","sw","Gi0/1"],["web","NIC","sw","Gi0/2"],["desk","NIC","sw","Gi0/3"],["desk2","NIC","sw","Gi0/4"]],
    goals:[{type:"conn", from:"desk", to:"intranet.corp.local", proto:"tcp", port:443, label:"Desk-4 opens https://intranet.corp.local"},{type:"conn", from:"desk2", to:"intranet.corp.local", proto:"tcp", port:443, label:"Desk-5 opens https://intranet.corp.local"},{type:"dns", from:"desk2", name:"10.70.0.80", rtype:"PTR", value:"web01.corp.local", label:"A reverse lookup of 10.70.0.80 returns web01.corp.local"}],
    solution:[{dev:"dns", zone:[{name:"corp.local", type:"MX", value:"10 mail.corp.local"},{name:"mail.corp.local", type:"A", value:"10.70.0.25"},{name:"intranet.corp.local", type:"CNAME", value:"web01.corp.local"},{name:"web01.corp.local", type:"A", value:"10.70.0.80"},{name:"80.0.70.10.in-addr.arpa", type:"PTR", value:"web01.corp.local"}]},{dev:"desk", set:{hosts:{}}}],
    explanation:"A CNAME only works if its target has an A record. Reverse lookups need a PTR record in the reverse zone (80.0.70.10.in-addr.arpa). A hosts file entry overrides DNS on that one machine, which is why Desk-4 kept going to the old address."})]},

{ id:"s-scope", title:"Sim: the DHCP scope is too small", domain:"operations", difficulty:2, objective:"3.4", objectives:["3.4","5.3"],
  scenario:"The finance floor added PCs and a badge printer. Some PCs get APIPA addresses and one shows an address conflict with Printer-1 (static 192.168.20.101). Badge-Printer must always receive 192.168.20.50 (its MAC is 00:1b:63:84:45:e6).",
  tasks:[NET(null,{
    devices:[SW("sw","SW-Finance",50,30,[P("Gi0/1","access",1),P("Gi0/2","access",1),P("Gi0/3","access",1),P("Gi0/4","access",1),P("Gi0/5","access",1),P("Gi0/6","access",1),P("Gi0/7","access",1),P("Gi0/8","access",1)],{editable:false}),
      H("dhcp","server","DHCP-01",8,8,{ip:"192.168.20.5", mask:M24, dhcp:[{network:"192.168.20.0/24", start:"192.168.20.100", end:"192.168.20.103", gw:"192.168.20.1", dns:"192.168.20.5", exclusions:[], reservations:[]}]}),
      H("prn","printer","Printer-1",92,8,{ip:"192.168.20.101", mask:M24}, false),
      H("f1","pc","Fin-1",5,94,{mode:"dhcp"}, false), H("f2","pc","Fin-2",22,94,{mode:"dhcp"}, false), H("f3","pc","Fin-3",39,94,{mode:"dhcp"}, false),
      H("f4","pc","Fin-4",56,94,{mode:"dhcp"}, false), H("f5","pc","Fin-5",73,94,{mode:"dhcp"}, false), H("badge","printer","Badge-Printer",92,94,{mode:"dhcp", mac:"00:1b:63:84:45:e6"}, false)],
    links:[["dhcp","NIC","sw","Gi0/1"],["prn","NIC","sw","Gi0/2"],["f1","NIC","sw","Gi0/3"],["f2","NIC","sw","Gi0/4"],["f3","NIC","sw","Gi0/5"],["f4","NIC","sw","Gi0/6"],["f5","NIC","sw","Gi0/7"],["badge","NIC","sw","Gi0/8"]],
    goals:[{type:"dhcp", host:"f2", label:"Fin-2 gets a unique lease"},{type:"dhcp", host:"f5", label:"Fin-5 gets a lease"},{type:"dhcp", host:"badge", ip:"192.168.20.50", label:"Badge-Printer gets 192.168.20.50"},{type:"ping", from:"f5", to:"192.168.20.101", label:"Fin-5 can reach Printer-1"}],
    solution:[{dev:"dhcp", pool:0, set:{end:"192.168.20.199", exclusions:["192.168.20.101"], reservations:[{mac:"00:1b:63:84:45:e6", ip:"192.168.20.50"}]}}],
    explanation:"The scope had only four addresses (.100 to .103) for six clients, so it ran out. Printer-1's static address sat inside the range without an exclusion, so the server leased it again. A reservation ties an address to a MAC address."})]},

{ id:"s-jumbo", title:"Sim: storage traffic stalls on jumbo frames", domain:"implementation", difficulty:2, objective:"2.2", objectives:["2.2","5.2"],
  scenario:"The hypervisor and the iSCSI SAN both use 9000-byte jumbo frames. Small pings work, but storage traffic with full-size frames fails. Make the whole path support jumbo frames.",
  tasks:[NET(null,{
    devices:[SW("sw","SW-Storage",50,30,[P("Gi0/1","access",50,{mtu:9000}),P("Gi0/2","access",50)],{vlanNames:{"50":"ISCSI"}}),
      H("esx","server","ESXi-01",15,90,{ip:"10.50.50.11", mask:M24, nic:{mtu:9000}, os:"linux"}, false), H("san","server","SAN-01",85,90,{ip:"10.50.50.20", mask:M24, nic:{mtu:9000}, os:"linux", services:["tcp/3260"]}, false)],
    links:[["esx","NIC","sw","Gi0/1"],["san","NIC","sw","Gi0/2"]],
    goals:[{type:"ping", from:"esx", to:"10.50.50.20", label:"ESXi-01 can reach SAN-01"},{type:"ping", from:"esx", to:"10.50.50.20", size:8972, df:true, label:"An 8972-byte ping with Don't Fragment set gets through"}],
    solution:[{dev:"sw", port:"Gi0/2", set:{mtu:9000}}],
    explanation:"Every hop must support the larger MTU. Test with ping -s 8972 -M do (Linux) or ping -l 8972 -f (Windows): 8972 bytes of data plus 28 bytes of IP and ICMP headers is exactly 9000."})]},

{ id:"s-svi", title:"Sim: route VLANs on a Layer 3 switch", domain:"implementation", difficulty:2, objective:"2.2", objectives:["2.2","2.1"],
  scenario:"Core-SW is a Layer 3 switch that routes between VLAN 10 (staff) and VLAN 20 (printing) using SVIs. Staff can reach their gateway but nothing in VLAN 20.",
  tasks:[NET(null,{
    devices:[{id:"core", kind:"l3switch", name:"Core-SW", x:50, y:30, editable:true, vlanNames:{"10":"STAFF","20":"PRINT"},
        ports:[P("Gi1/0/1","access",10),P("Gi1/0/2","access",20),P("Gi1/0/3","access",1)], ifaces:[IF("Vlan10","10.10.0.1",M24,{vlan:10}),IF("Vlan20","10.20.0.1",M24,{vlan:20, shutdown:true})]},
      H("pc","pc","Staff-PC",12,92,{ip:"10.10.0.30", mask:M24, gw:"10.10.0.1"}, false), H("prn","printer","Printer-A",50,94,{ip:"10.20.0.40", mask:M24, gw:"10.20.0.1"}, false),
      H("prn2","printer","Printer-B",88,92,{ip:"10.20.0.41", mask:M24, gw:"10.20.0.1"}, false)],
    links:[["pc","NIC","core","Gi1/0/1"],["prn","NIC","core","Gi1/0/2"],["prn2","NIC","core","Gi1/0/3"]],
    goals:[{type:"ping", from:"pc", to:"10.20.0.40", label:"Staff-PC can reach Printer-A"},{type:"ping", from:"pc", to:"10.20.0.41", label:"Staff-PC can reach Printer-B"}],
    solution:[{dev:"core", iface:"Vlan20", set:{shutdown:false}},{dev:"core", port:"Gi1/0/3", set:{vlan:20}}],
    explanation:"A switch virtual interface (SVI) is the routed gateway for its VLAN; it was administratively shut down. Printer-B's port was also left in VLAN 1. An SVI only comes up when at least one port in its VLAN is up."})]},

{ id:"s-voice", title:"Sim: the desk phone can't register", domain:"implementation", difficulty:2, objective:"2.2", objectives:["2.2"],
  scenario:"Phone-12 tags its traffic for the voice VLAN 20 while the desk PC uses data VLAN 10. The phone powers up but can't reach Call-Mgr in VLAN 20.",
  tasks:[NET(null,{
    devices:[{id:"core", kind:"l3switch", name:"Core-SW", x:50, y:30, editable:true, vlanNames:{"10":"DATA","20":"VOICE"},
        ports:[P("Gi1/0/1","access",10),P("Gi1/0/2","access",10),P("Gi1/0/3","access",20)], ifaces:[IF("Vlan10","10.10.0.1",M24,{vlan:10}),IF("Vlan20","10.20.0.1",M24,{vlan:20})]},
      H("pc","pc","Desk-PC",12,92,{ip:"10.10.0.30", mask:M24, gw:"10.10.0.1"}, false),
      H("ph","phone","Phone-12",50,94,{ip:"10.20.0.112", mask:M24, gw:"10.20.0.1", voiceVlan:20, poe:{std:"af", watts:6}}, false),
      H("cm","server","Call-Mgr",88,92,{ip:"10.20.0.5", mask:M24, gw:"10.20.0.1"}, false)],
    links:[["pc","NIC","core","Gi1/0/1"],["ph","NIC","core","Gi1/0/2"],["cm","NIC","core","Gi1/0/3"]],
    goals:[{type:"ping", from:"ph", to:"10.20.0.5", label:"Phone-12 can reach Call-Mgr"},{type:"ping", from:"pc", to:"10.20.0.5", label:"Desk-PC can reach Call-Mgr"}],
    solution:[{dev:"core", port:"Gi1/0/2", set:{voice:20}}],
    explanation:"With switchport voice vlan 20, the access port accepts the phone's 802.1Q-tagged voice frames while untagged data stays in VLAN 10. Without it, tagged voice frames are dropped."})]},

{ id:"s-native", title:"Sim: management traffic is leaking", domain:"troubleshooting", difficulty:3, objective:"5.3", objectives:["5.3","2.2","4.2"],
  scenario:"Management VLAN 99 spans both switches and uses 10.99.0.0/24. A visitor laptop in VLAN 1 on SW2 can reach the switch management network, while Mgmt-2 on SW2 can't reach Mgmt-1. The trunk between the switches is the problem.",
  tasks:[NET(null,{
    devices:[SW("sw1","SW1",25,35,[P("Gi0/1","access",99),P("Gi0/24","trunk",1,{native:99})],{vlanNames:{"99":"MGMT"}}),
      SW("sw2","SW2",75,35,[P("Gi0/1","access",99),P("Gi0/2","access",1),P("Gi0/24","trunk",1,{native:1})],{vlanNames:{"99":"MGMT"}}),
      H("m1","pc","Mgmt-1",15,92,{ip:"10.99.0.11", mask:M24}, false), H("m2","pc","Mgmt-2",60,94,{ip:"10.99.0.12", mask:M24}, false),
      H("v","laptop","Visitor",90,92,{ip:"10.99.0.200", mask:M24}, false)],
    links:[["sw1","Gi0/24","sw2","Gi0/24"],["m1","NIC","sw1","Gi0/1"],["m2","NIC","sw2","Gi0/1"],["v","NIC","sw2","Gi0/2"]],
    goals:[{type:"ping", from:"m2", to:"10.99.0.11", label:"Mgmt-2 can reach Mgmt-1"},{type:"ping", from:"v", to:"10.99.0.11", expect:false, label:"Visitor can't reach Mgmt-1"}],
    solution:[{dev:"sw2", port:"Gi0/24", set:{native:99}}],
    explanation:"Untagged frames on a trunk belong to the native VLAN, which must match on both ends. SW1 sent VLAN 99 untagged and SW2 put it in VLAN 1, joining two VLANs. The CDP native VLAN mismatch message in show logging points right at it."})]},

{ id:"s-vpc", title:"Sim: build out a cloud VPC", domain:"concepts", difficulty:3, objective:"1.3", objectives:["1.3","4.3"],
  scenario:"In this VPC, Web-01 sits in the public subnet with a public IP. DB-01 and Batch-02 sit in the private subnet with no public IPs. DB-01 needs outbound HTTPS for updates through the NAT gateway, and its security group should accept MySQL (3306) only from the public subnet.",
  tasks:[NET(null,{
    devices:[{id:"isp", kind:"cloud", name:"Internet", x:50, y:4, editable:false, ip:"198.51.100.1", records:{}},
      {id:"igw", kind:"igw", name:"Internet gateway", x:50, y:24, editable:false, ifaces:[IF("ext","198.51.100.2",M24),IF("vpc","10.0.0.1","255.255.255.240")], defaultRoute:"198.51.100.1"},
      RT("vr","VPC router",50,46,[IF("igw","10.0.0.2","255.255.255.240"),IF("public","10.0.1.1",M24,{routes:[{net:"0.0.0.0/0", via:"10.0.0.1"}]}),IF("private","10.0.2.1",M24,{routes:[{net:"0.0.0.0/0", via:"10.0.0.1"}]})]),
      SW("pub","Public subnet",22,66,[P("p1","access",1),P("p2","access",1),P("up","access",1)],{editable:false}),
      SW("prv","Private subnet",78,66,[P("p1","access",1),P("p2","access",1),P("up","access",1)],{editable:false}),
      {id:"nat", kind:"natgw", name:"NAT gateway", x:5, y:94, editable:false, ifaces:[IF("eni","10.0.1.10",M24)], defaultRoute:"10.0.1.1", publicIp:"198.51.100.20"},
      H("web","server","Web-01",38,94,{ip:"10.0.1.20", mask:M24, gw:"10.0.1.1", publicIp:"198.51.100.21", services:["tcp/443"]}, false),
      H("db","server","DB-01",62,94,{ip:"10.0.2.30", mask:M24, gw:"10.0.2.1", services:["tcp/3306"], fw:{enabled:true, rules:[{action:"allow", proto:"tcp", port:"3306", src:"0.0.0.0/0"}]}}),
      H("batch","server","Batch-02",95,94,{ip:"10.0.2.40", mask:M24, gw:"10.0.2.1"}, false)],
    links:[["isp","WAN","igw","ext"],["igw","vpc","vr","igw"],["vr","public","pub","up"],["vr","private","prv","up"],["nat","eni","pub","p1"],["web","NIC","pub","p2"],["db","NIC","prv","p1"],["batch","NIC","prv","p2"]],
    goals:[{type:"conn", from:"web", to:"10.0.2.30", proto:"tcp", port:3306, label:"Web-01 can reach DB-01 on 3306"},{type:"conn", from:"batch", to:"10.0.2.30", proto:"tcp", port:3306, expect:false, label:"Batch-02 can't reach DB-01 on 3306 (least privilege)"},{type:"conn", from:"db", to:"8.8.8.8", proto:"tcp", port:443, label:"DB-01 can reach the internet for updates"},{type:"ping", from:"web", to:"8.8.8.8", label:"Web-01 can reach the internet"}],
    solution:[{dev:"vr", iface:"private", set:{routes:[{net:"0.0.0.0/0", via:"10.0.1.10"}]}},{dev:"db", set:{fw:{enabled:true, rules:[{action:"allow", proto:"tcp", port:"3306", src:"10.0.1.0/24"}]}}}],
    explanation:"An internet gateway only passes traffic for instances with public IPs. Private subnets send 0.0.0.0/0 to a NAT gateway in a public subnet instead. Security groups are stateful allow lists, so scope the source to the subnet that needs access."})]}
];

/* Lab Bench built-in wireless labs. Content: CC BY-SA 4.0. Verified by tests/run.js. */

const AP = (id, name, x, y, o) => ({id, name, x, y, band:"2.4", channel:1, width:20, power:"medium", ssid:"Corp", security:"wpa2-psk", antenna:"omni", heading:0, enabled:true, editable:true, ...o});
const CL = (id, name, x, y, o) => ({id, name, x, y, bands:["2.4","5"], security:["wpa2-psk","wpa3-sae","wpa2-ent","wpa3-ent"], ssid:"Corp", ...o});
const WIFI = o => ({type:"wifi", prompt:"Configure the access points so every requirement passes.", ...o});
const WIFI_LABS = [
{ id:"w-channels", title:"Wi-Fi: three APs stepping on each other", domain:"implementation", difficulty:2, objective:"2.3", objectives:["2.3","5.4"],
  scenario:"A warehouse runs three 2.4 GHz access points because its handheld scanners only support 2.4 GHz. Scanners drop off constantly. A Wi-Fi survey shows heavy channel overlap.",
  tasks:[WIFI({floor:{w:60, h:30}, aps:[AP("ap1","AP-1",10,15,{channel:1}),AP("ap2","AP-2",30,15,{channel:3}),AP("ap3","AP-3",50,15,{channel:6, width:40})],
    clients:[CL("c1","Scanner-A",12,22,{bands:["2.4"]}),CL("c2","Scanner-B",48,8,{bands:["2.4"]})],
    goals:[{type:"wifiNoOverlap", label:"No AP overlaps another AP's channel"},{type:"wifiClient", client:"c1", label:"Scanner-A has a clean signal of -67 dBm or better"},{type:"wifiClient", client:"c2", label:"Scanner-B has a clean signal of -67 dBm or better"}],
    solution:[{ap:"ap2", set:{channel:6}},{ap:"ap3", set:{channel:11, width:20}}],
    explanation:"Only channels 1, 6 and 11 don't overlap in 2.4 GHz, and only at 20 MHz. Channel 3 overlaps both 1 and 6, and 40 MHz in 2.4 GHz consumes most of the band."})]},
{ id:"w-5ghz", title:"Wi-Fi: move the office to 5 GHz", domain:"implementation", difficulty:3, objective:"2.3", objectives:["2.3"],
  scenario:"The office laptops support 5 GHz, but AP-1 still runs on 2.4 GHz and AP-2 and AP-3 use 80 MHz channels that overlap. Policy: avoid DFS channels (52 to 144). Get every laptop on 5 GHz with no overlap.",
  tasks:[WIFI({floor:{w:50, h:30}, aps:[AP("ap1","AP-1",8,15,{channel:6}),AP("ap2","AP-2",25,15,{band:"5", channel:36, width:80}),AP("ap3","AP-3",42,15,{band:"5", channel:44, width:80})],
    clients:[CL("c1","Laptop-1",8,22),CL("c2","Laptop-2",25,8),CL("c3","Laptop-3",42,22)],
    goals:[{type:"wifiNoOverlap", label:"No channel overlap"},{type:"wifiNoDfs", label:"No DFS channels"},{type:"wifiClient", client:"c1", band:"5", label:"Laptop-1 is on 5 GHz with a clean signal"},{type:"wifiClient", client:"c2", band:"5", label:"Laptop-2 is on 5 GHz with a clean signal"},{type:"wifiClient", client:"c3", band:"5", label:"Laptop-3 is on 5 GHz with a clean signal"}],
    solution:[{ap:"ap1", set:{band:"5", channel:149, width:40}},{ap:"ap2", set:{width:40}},{ap:"ap3", set:{width:40}}],
    explanation:"Wider channels bond 20 MHz channels together: at 80 MHz, 36 and 44 sit in the same 36 to 48 block. Outside the DFS range there are only two 80 MHz blocks (36 to 48 and 149 to 161), so 40 MHz is the practical width for three neighboring APs."})]},
{ id:"w-roam", title:"Wi-Fi: tablets drop in the hallway", domain:"troubleshooting", difficulty:2, objective:"5.4", objectives:["5.4","2.3"],
  scenario:"Nurses' tablets lose Wi-Fi walking down the 80 m ward hallway. AP-2 in the middle was installed but never enabled, and AP-3 was set up by a contractor. All APs should provide the same Corp network with WPA2-Enterprise.",
  tasks:[WIFI({floor:{w:80, h:20}, aps:[AP("ap1","AP-1",10,10,{band:"5", channel:36, ssid:"Corp", security:"wpa2-ent"}),AP("ap2","AP-2",40,10,{band:"5", channel:44, ssid:"Corp", security:"wpa2-ent", enabled:false}),AP("ap3","AP-3",70,10,{band:"5", channel:149, ssid:"Corp-5G", security:"wpa3-ent"})],
    clients:[CL("t","Nurse-Tablet",5,10,{security:["wpa2-ent","wpa3-ent"], path:[[5,10],[20,10],[40,10],[60,10],[75,10]]})],
    goals:[{type:"wifiRoam", client:"t", label:"Nurse-Tablet stays connected the whole way down the hallway"},{type:"wifiNoOverlap", label:"No channel overlap"}],
    solution:[{ap:"ap2", set:{enabled:true}},{ap:"ap3", set:{ssid:"Corp", security:"wpa2-ent"}}],
    explanation:"Seamless roaming needs overlapping coverage (about 15 to 20 percent) and identical SSID and security settings on every AP; a different SSID is a different network to the client."})]},
{ id:"w-sec", title:"Wi-Fi: lock down corporate and guest access", domain:"security", difficulty:2, objective:"2.3", objectives:["2.3","4.1"],
  scenario:"Corp Wi-Fi still uses a shared passphrase that former employees know. Policy: Corp must use 802.1X with the RADIUS server and the strongest encryption. Guest Wi-Fi must not need a password but must show the acceptable use policy on a captive portal first.",
  tasks:[WIFI({floor:{w:40, h:30}, aps:[AP("corp","AP-Corp",12,15,{band:"5", channel:36, ssid:"Corp", security:"wpa2-psk"}),AP("guest","AP-Guest",30,15,{band:"5", channel:149, ssid:"Guest", security:"wpa2-psk", captivePortal:false})],
    clients:[CL("lap","Corp-Laptop",14,22,{security:["wpa2-ent","wpa3-ent"]}),CL("ph","Visitor-Phone",30,22,{ssid:"Guest", security:["open","owe","wpa2-psk","wpa3-sae"]})],
    goals:[{type:"wifiConfig", ap:"corp", field:"security", equals:["wpa3-ent"], label:"Corp uses WPA3-Enterprise (802.1X)"},{type:"wifiConfig", ap:"guest", field:"captivePortal", equals:["true"], label:"Guest uses a captive portal"},{type:"wifiConfig", ap:"guest", field:"security", equals:["open","owe"], label:"Guest needs no password"},{type:"wifiClient", client:"lap", label:"Corp-Laptop connects"},{type:"wifiClient", client:"ph", label:"Visitor-Phone connects"}],
    solution:[{ap:"corp", set:{security:"wpa3-ent"}},{ap:"guest", set:{security:"owe", captivePortal:true}}],
    explanation:"Enterprise modes authenticate each user through 802.1X and RADIUS, so access ends when an account is disabled. Enhanced Open (OWE) encrypts guest traffic without a password; open plus a captive portal also satisfies the requirement."})]},
{ id:"w-bridge", title:"Wi-Fi: link the two buildings", domain:"implementation", difficulty:2, objective:"2.3", objectives:["2.3"],
  scenario:"A point-to-point wireless bridge must join the main office and the warehouse 100 m away. The two bridge radios came with omnidirectional antennas and the installer set them to different channels.",
  tasks:[WIFI({floor:{w:110, h:40}, aps:[AP("a","Bridge-Main",5,20,{band:"5", channel:149, width:40, power:"high", ssid:"Bridge", security:"wpa3-sae"}),AP("b","Bridge-Warehouse",105,20,{band:"5", channel:157, width:40, power:"high", ssid:"Bridge", security:"wpa3-sae", heading:180})],
    clients:[], goals:[{type:"wifiLink", a:"a", b:"b", label:"The bridge link is up at -70 dBm or better"}],
    solution:[{ap:"a", set:{antenna:"directional", heading:0}},{ap:"b", set:{antenna:"directional", heading:180, channel:149}}],
    explanation:"Directional antennas focus energy in one direction for long point-to-point links; omnidirectional antennas spread it in all directions for client coverage. Both ends must also share the channel."})]},
{ id:"w-dfs", title:"Wi-Fi: disconnects near the airport", domain:"troubleshooting", difficulty:2, objective:"2.3", objectives:["2.3","5.4"],
  scenario:"A clinic near an airport reports clients randomly disconnecting several times a day. Logs show the APs abruptly changing channels after radar detection. Move every AP off DFS channels without creating overlap.",
  tasks:[WIFI({floor:{w:50, h:30}, aps:[AP("ap1","AP-1",8,15,{band:"5", channel:52}),AP("ap2","AP-2",25,15,{band:"5", channel:100}),AP("ap3","AP-3",42,15,{band:"5", channel:36})],
    clients:[CL("c1","Exam-1",8,22),CL("c2","Exam-2",25,22),CL("c3","Exam-3",42,22)],
    goals:[{type:"wifiNoDfs", label:"No AP uses a DFS channel"},{type:"wifiNoOverlap", label:"No channel overlap"},{type:"wifiClient", client:"c1", label:"Exam-1 connects cleanly"},{type:"wifiClient", client:"c2", label:"Exam-2 connects cleanly"}],
    solution:[{ap:"ap1", set:{channel:44}},{ap:"ap2", set:{channel:149}}],
    explanation:"Channels 52 to 144 are DFS channels. Under 802.11h, an AP must leave the channel when it detects radar, which drops clients. Channels 36 to 48 and 149 to 165 don't require DFS."})]}
];

module.exports = {makeNet, evalGoal, checkNetTask, applySolution, solutionText, runCommand, hostCfg, hostPing, resolveName, generateFaultLab, checkWifiTask, wifiEval, wifiAnalyzer, questionPool, genRng, srsUpdate, OBJECTIVES, DOMAIN_OF, TERM_GROUPS, SCENARIOS, PORTS_TABLE, ACRONYMS, SIM_LABS, WIFI_LABS, sclone, subnetSteps, ipv6Steps, simHints, wifiHints, ipToInt, intToIp};
