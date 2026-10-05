/* Network Lab Bench simulation engine: core (addressing, physical layer, STP, LACP, PoE, layer 2).
   MIT License. Plain functions on purpose: this file is concatenated into the app and into the Node test bundle. */

"use strict";
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
