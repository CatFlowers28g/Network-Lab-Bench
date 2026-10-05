/* Lab Bench random fault generator. MIT License.
   Builds a known-good network from a template, injects 1-3 realistic faults, and keeps the result only if
   the engine confirms the faults break at least one requirement and the recorded fixes restore every one. */

"use strict";
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
