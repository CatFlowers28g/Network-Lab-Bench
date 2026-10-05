#!/usr/bin/env node
/* Lab Bench test suite. Run: node build.js && node tests/run.js  (no dependencies) */
const E = require("../dist/engine.cjs");
let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, info) => { if (cond) pass++; else { fail++; fails.push(name + (info ? `: ${info}` : "")); } };
const section = n => console.log(`\n${n}`);

section("Network sims: each starts broken and its solution fixes it");
for (const l of E.SIM_LABS){ const c = E.checkNetTask(l.tasks[0]); ok(!c.startAllPass, `${l.id} starts broken`); ok(c.solvedAllPass, `${l.id} solution works`, c.res.filter(r=>!r.pass).map(r=>r.why).join("; ")); }
console.log(`  ${E.SIM_LABS.length} sims checked`);

section("Wireless labs");
for (const l of E.WIFI_LABS){ const c = E.checkWifiTask(l.tasks[0]); ok(!c.startAllPass, `${l.id} starts broken`); ok(c.solvedAllPass, `${l.id} solution works`, c.res.filter(r=>!r.pass).map(r=>r.why).join("; ")); }
console.log(`  ${E.WIFI_LABS.length} wireless labs checked`);

section("Random fault generator");
let gen = 0; const kinds = new Set();
for (let s=1; s<=250; s++){ const L = E.generateFaultLab(s); if (!L){ ok(false, `seed ${s} generated nothing`); continue; } gen++; L.faultIds.forEach(f=>kinds.add(f)); const c = E.checkNetTask(L.tasks[0]); ok(!c.startAllPass && c.solvedAllPass, `seed ${s} verifies`); }
ok(kinds.size >= 15, "fault variety", `${kinds.size} kinds`);
console.log(`  ${gen} generated, ${kinds.size} fault types used`);

section("Terminals answer every command on every device without errors");
const cmds = {host:["ipconfig","ipconfig /all","ipconfig /renew","ping 8.8.8.8","ping -l 8972 -f 10.0.0.1","tracert 8.8.8.8","nslookup comptia.org","nslookup -type=mx corp.local","arp -a","route print","netstat -an","tnc 10.0.0.1 -Port 443","nmap 10.0.0.1","type hosts","ip addr","ip route","dig comptia.org","ss -tuln","nc -zv 10.0.0.1 22","curl https://comptia.org","tcpdump","cat /etc/resolv.conf","help","bogus"],
  dev:["show vlan brief","show interfaces status","show interfaces trunk","show mac address-table","show spanning-tree","show etherchannel summary","show power inline","show port-security","show ip dhcp snooping","show ip arp inspection","show cdp neighbors","show lldp neighbors","show logging","show running-config","show ip interface brief","show ip route","show access-lists","show ip nat translations","show standby brief","show ip ospf neighbor","show arp","ping 8.8.8.8","traceroute 8.8.8.8","help","bogus"]};
let ran = 0;
for (const l of E.SIM_LABS){ const t = l.tasks[0]; const net = E.makeNet(E.sclone(t.devices), E.sclone(t.links));
  for (const d of net.devs){ if (d.kind==="cloud") continue; const list = ["pc","laptop","server","printer","phone","ap"].includes(d.kind) ? cmds.host : cmds.dev;
    for (const c of list){ try{ const out = E.runCommand(net, d, c); ok(typeof out==="string", `${l.id}/${d.id} "${c}" returns text`); ran++; }catch(e){ ok(false, `${l.id}/${d.id} "${c}"`, e.message); } }
    if (d.ports) for (const p of d.ports){ try{ E.runCommand(net, d, "show interfaces "+p.name); ran++; }catch(e){ ok(false, `${l.id}/${d.id} show int ${p.name}`, e.message); } } } }
console.log(`  ${ran} commands run`);

section("Engine behavior");
const H = (id, ip, gw, extra) => ({id, kind:"pc", name:id, x:0, y:0, ip, mask:"255.255.255.0", gw, ...extra});
const sw = ports => ({id:"sw", kind:"switch", name:"sw", x:0, y:0, ports:ports.map(n=>({name:n, mode:"access", vlan:1}))});
{ const net = E.makeNet([H("a","10.0.0.1",""), H("b","10.0.0.2",""), sw(["p1","p2"])], [["a","NIC","sw","p1"],["b","NIC","sw","p2"]]);
  ok(E.hostPing(net, net.byId.a, 167772162).ok, "same-subnet ping works"); }
{ const net = E.makeNet([H("a","10.0.0.1",""), H("b","10.0.0.1",""), H("c","10.0.0.3",""), sw(["p1","p2","p3"])], [["a","NIC","sw","p1"],["b","NIC","sw","p2"],["c","NIC","sw","p3"]]);
  const r = E.hostPing(net, net.byId.c, 167772161); ok(!r.ok && /duplicate/.test(r.why), "duplicate IP detected"); }
{ const R = {id:"r", kind:"router", name:"r", x:0, y:0, ifaces:[{name:"g0", ip:"10.0.0.254", mask:"255.255.255.0"},{name:"g1", ip:"10.1.0.1", mask:"255.255.255.252"},{name:"g2", ip:"10.2.0.1", mask:"255.255.255.252"}], routes:[{net:"172.16.0.0/16", via:"10.1.0.2"},{net:"172.16.5.0/24", via:"10.2.0.2", ad:250}]};
  const net = E.makeNet([R, H("x","10.1.0.2",""), H("y","10.2.0.2","")], [["r","g1","x","NIC"],["r","g2","y","NIC"]]);
  const rt = require("../dist/engine.cjs"); void rt;
  const evalR = E.evalGoal(net, {type:"state", check:"route", dev:"r", to:"172.16.5.9", via:"10.2.0.2"}); ok(evalR.pass, "longest prefix beats administrative distance", evalR.why); }
{ const S = (id, mac) => ({id, kind:"switch", name:id, x:0, y:0, mac, ports:[{name:"a", mode:"trunk"},{name:"b", mode:"trunk"}]});
  const net = E.makeNet([S("s1","00:00:00:00:00:30"), S("s2","00:00:00:00:00:10"), S("s3","00:00:00:00:00:20")], [["s1","a","s2","a"],["s2","b","s3","a"],["s3","b","s1","b"]]);
  ok(net.stp.roles.s1.root==="s2", "lowest MAC wins root election"); ok(net.stp.blocked.size===1, "exactly one link blocked in a triangle"); }
{ const net = E.makeNet([H("a","10.0.0.1",""), sw(["p1"])], [["a","NIC","sw","p1"]]); net.byId.sw.ports[0].duplex = "full"; net.byId.sw.ports[0].speed = "100";
  const n2 = E.makeNet(net.devs, [["a","NIC","sw","p1"]]); ok(n2.links[0].st.dupMismatch, "auto vs forced full gives a duplex mismatch"); }
{ const srv = {id:"d", kind:"server", name:"d", x:0, y:0, ip:"10.0.0.5", mask:"255.255.255.0", dhcp:[{network:"10.0.0.0/24", start:"10.0.0.100", end:"10.0.0.100"}]};
  const net = E.makeNet([srv, {...H("c1","","" ), mode:"dhcp"}, {...H("c2","",""), mode:"dhcp"}, sw(["p1","p2","p3"])], [["d","NIC","sw","p1"],["c1","NIC","sw","p2"],["c2","NIC","sw","p3"]]);
  ok(E.evalGoal(net, {type:"dhcp", host:"c1"}).pass && !E.evalGoal(net, {type:"dhcp", host:"c2"}).pass, "one-address scope exhausts on the second client"); }
ok(E.wifiEval({aps:[{id:"a",name:"a",x:0,y:0,band:"2.4",channel:1,width:20,power:"medium"},{id:"b",name:"b",x:10,y:0,band:"2.4",channel:6,width:20,power:"medium"}], clients:[]}, {type:"wifiNoOverlap"}).pass, "channels 1 and 6 don't overlap");
ok(!E.wifiEval({aps:[{id:"a",name:"a",x:0,y:0,band:"2.4",channel:1,width:20,power:"medium"},{id:"b",name:"b",x:10,y:0,band:"2.4",channel:4,width:20,power:"medium"}], clients:[]}, {type:"wifiNoOverlap"}).pass, "channels 1 and 4 overlap");

section("Step-by-step explanations and hints");
{ const R2 = E.genRng(99);
  for (let k=0;k<300;k++){ const n = R2.int(17,30), ip = ((10<<24) + R2.int(0, 2**24-1))>>>0; const st = E.subnetSteps(ip, n).join(" ");
    const mask = n===0?0:(0xFFFFFFFF << (32-n))>>>0, net = (ip & mask)>>>0, bc = (net | (~mask>>>0))>>>0;
    ok(st.includes(E.intToIp(net)) && st.includes(E.intToIp(bc)), `subnet steps for ${E.intToIp(ip)}/${n} reach the right network and broadcast`); } }
for (const [full, short] of [["2001:0db8:0000:0000:0000:ff00:0042:8329","2001:db8::ff00:42:8329"],["fe80:0000:0000:0000:0204:61ff:fe9d:f156","fe80::204:61ff:fe9d:f156"],["2001:0db8:0000:0001:0000:0000:0000:0001","2001:db8:0:1::1"],["2001:0db8:85a3:0000:0000:8a2e:0370:7334","2001:db8:85a3::8a2e:370:7334"]])
  ok(E.ipv6Steps(full).join(" ").includes(short+"."), `IPv6 steps compress ${full}`, E.ipv6Steps(full).join(" | "));
const walk = (t, label) => {
  let devices = E.sclone(t.devices), links = E.sclone(t.links), guard = 0;
  let r = E.simHints(t, devices, links); ok(!r.done && r.hints.length===3, `${label} gives 3 hint levels at the start`);
  for (const step of t.solution){ E.applySolution(devices, [step], links); if (++guard>40) break; }
  r = E.simHints(t, devices, links); ok(r.done, `${label} hints finish once the fix is applied`, r.hints && r.hints[0]);
};
for (const l of E.SIM_LABS) walk(l.tasks[0], l.id);
for (let s=1; s<=60; s++){ const L = E.generateFaultLab(s); if (L) walk(L.tasks[0], `fault seed ${s}`); }
for (const l of E.WIFI_LABS){ const t = l.tasks[0]; const st = E.sclone(t); const r = E.wifiHints(t, st); ok(!r.done && r.hints.length===3, `${l.id} wireless hints at the start`);
  for (const s of t.solution){ const a = st.aps.find(x=>x.id===s.ap); Object.assign(a, s.set); } ok(E.wifiHints(t, st).done, `${l.id} wireless hints finish`); }

section("Question bank");
const R = E.genRng(7), pool = E.questionPool(); let made = 0; const per = {};
for (const p of pool) for (let k=0; k<(p.generated?25:1); k++){ const q = p.make(R); made++; per[q.obj] = (per[q.obj]||0)+1;
  ok(q.options.length>=2 && new Set(q.options).size===q.options.length, `${q.key||q.prompt.slice(0,30)} has distinct options`);
  ok(q.answer.length>=1 && q.answer.every(a=>a>=0 && a<q.options.length), `${q.key||q.prompt.slice(0,30)} answer in range`);
  if (q.steps) ok(q.steps.every(x=>typeof x==="string" && x.length>10), `${q.key} steps are text`); }
for (const o of Object.keys(E.OBJECTIVES)) ok((per[o]||0) >= 10, `objective ${o} has at least 10 questions`, String(per[o]||0));
console.log(`  ${pool.length} sources, ${made} questions generated`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail){ console.log(fails.slice(0,40).map(f=>"  FAIL "+f).join("\n")); process.exit(1); }
