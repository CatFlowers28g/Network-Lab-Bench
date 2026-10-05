/* Network Lab Bench question generators. MIT License.
   Every question: {key, obj, prompt, options, answer:[idx], multi, explanation, source}. Keys are stable for spaced repetition. */

"use strict";
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
