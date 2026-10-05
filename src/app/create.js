/* ---------- create ---------- */
"use strict";
function seg(val, opts, on, label){
  return h("div",{class:"seg", role:"group","aria-label":label}, opts.map(([v,t])=>h("button",{type:"button","aria-pressed":v===val?"true":"false", onclick:()=>{on(v); render();}}, t)));
}
function createTab(){
  const g = ui.gen;
  const available = platform.canAsk();
  const form = h("div",{class:"form"},
    h("div",{class:"field"}, h("label",{for:"g-dom"},"Topic"),
      h("select",{id:"g-dom", onchange:e=>{ const v = e.target.value; if (OBJECTIVES[v]){ g.obj = v; g.domain = DOMAIN_OF(v); } else { g.obj = ""; g.domain = v; } }},
        h("optgroup",{label:"Broad mix"}, DOMAINS.map(d=>h("option",{value:d.id, selected:d.id===(g.obj||g.domain)}, `Any ${d.name.replace(/^Network(ing)? /,"").toLowerCase()} topic`))),
        CATEGORIES.map(c=>h("optgroup",{label:c.name}, c.objs.map(o=>h("option",{value:o, selected:o===(g.obj||g.domain)}, OBJECTIVES[o])))))),
    h("div",{class:"field"}, h("label",{for:"g-topic"},"Topic (optional)"),
      h("input",{id:"g-topic", type:"text", value:g.topic, placeholder:"e.g. OSPF, 802.1X, /27 subnets, evil twin", oninput:e=>{g.topic=e.target.value;}})),
    h("div",{class:"field"}, h("label",{for:"g-type"},"Task type"),
      h("select",{id:"g-type", onchange:e=>{g.type=e.target.value;}}, [["any","Mix it up"],...Object.entries(TYPES)].map(([v,t])=>h("option",{value:v, selected:v===g.type},t)))),
    h("div",{class:"row"},
      h("div",{class:"field"}, h("span",{class:"lbl"},"Difficulty"), seg(g.difficulty, [[1,"Easy"],[2,"Medium"],[3,"Hard"]], v=>g.difficulty=v, "Difficulty")),
      h("div",{class:"field"}, h("span",{class:"lbl"},"How many"), seg(g.count, [[1,"1"],[2,"2"],[3,"3"]], v=>g.count=v, "How many labs"))),
    h("div",{class:"row"},
      h("button",{class:"btn primary", disabled:!available||g.busy, onclick:generate}, g.busy ? "Creating…" : g.count>1 ? `Create ${g.count} labs` : "Create lab"),
      g.busy ? h("button",{class:"btn", onclick:()=>g.ctl&&g.ctl.abort()},"Stop") : null),
    h("div",{class:"status"+(g.err?" err":""), role:"status"},
      !available ? (platform.inClaude ? "Connecting to Claude…" : "To create labs with AI, add your Anthropic API key in Settings. You can still import labs below.") : g.status),
    g.added.length ? h("div",{class:"added"}, g.added.map(l=>h("button",{class:"item", onclick:()=>openEntry({id:l.id,title:l.title,domain:l.domain,difficulty:l.difficulty,types:[],source:"mine",lab:l})},
      h("span",{class:"stripe", style:`background:${cat(catOfLab(l)).color}`}),
      h("span",null,h("div",{class:"t"},l.title),h("div",{class:"m"},`${cat(catOfLab(l)).name}, ${[...new Set(l.tasks.map(t=>TYPES[t.type]))].join(" + ")}`)),
      h("span",{class:"s new"},"Open")))) : null);

  const imp = h("details",{class:"import"},
    h("summary",null,"Import a lab from JSON"),
    h("p",{class:"small muted", style:"margin-top:8px"},"Paste a lab (or a list of labs) in the Lab Bench format, for example one Claude wrote for you in chat."),
    h("textarea",{"aria-label":"Lab JSON", oninput:e=>{ui.importText=e.target.value;}}, ui.importText),
    h("div",{class:"row", style:"margin-top:8px"}, h("button",{class:"btn", onclick:doImport},"Import"), h("span",{class:"small", role:"status"}, ui.importMsg)));
  return h("div",null, h("p",{class:"small muted"}, "Describe what you want to practice and Claude writes new labs. Network and wireless sims are checked by the simulator before they're saved; question-style labs are checked for format only, so stay critical."), form, imp);
}
function doImport(){
  let data;
  try{ data = JSON.parse(ui.importText); }catch(e){ ui.importMsg = "That isn't valid JSON. Check for a missing bracket or quote."; render(); return; }
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.labs) ? data.labs : [data]);
  let ok = 0, bad = 0;
  for (const raw of arr){ const l = safeValidate(raw); if (l){ l.id = newId(); store.addLab(l); ok++; } else bad++; }
  ui.importMsg = ok ? `Imported ${ok} lab${ok===1?"":"s"}${bad?`, skipped ${bad} that weren't usable`:""}.` : "Nothing imported: no usable labs found.";
  if (ok) ui.importText = "";
  render();
}
function genPrompt(g){
  const d = dom(g.domain);
  const existing = allLabEntries().filter(e=>e.domain===g.domain).map(e=>e.title).slice(0,40);
  const typeRule = g.type==="any" ? "Choose the task types that best fit the topic and favor hands-on work: for routing, switching, addressing, DHCP, DNS and connectivity troubleshooting use a \"net\" simulation; for diagnosis from command output use \"cli\"; mix in other types as follow-ups." : `Every lab must center on a "${g.type}" task (you may add one short "choice" follow-up task).`;
  return `You write CompTIA Network+ (N10-009) performance-based practice labs, like exam PBQs, for a learner who passed the exam and wants hands-on retention practice.

Create ${g.count} lab${g.count>1?"s, each on a different topic":""}.
Domain: ${d.name}. Topics in this domain: ${d.hint}.${g.obj ? `
Objective: N10-009 ${g.obj} ${OBJECTIVES[g.obj]}. Every lab must target this objective and set "objective" to "${g.obj}".` : ""}
Topic focus: ${g.topic.trim() ? g.topic.trim().slice(0,200) : "pick a high-yield topic from this domain that isn't already covered by the existing titles below"}.
${typeRule}
Difficulty: ${g.difficulty} (1 = recall, 2 = applied workplace scenario, 3 = multi-step troubleshooting with plausible distractors).
Existing lab titles to avoid duplicating: ${existing.join("; ") || "none"}.

Reply with only JSON in this shape: {"labs":[LAB, ...]}

LAB = {"title": short title, "objective": "N10-009 objective number and name, e.g. 2.2 Switching technologies", "difficulty": 1|2|3, "scenario": "2-4 sentence realistic workplace scenario", "exhibit": "optional monospace exhibit (wire map, config, log, table) using \\n line breaks; omit if not needed", "tasks": [TASK, ...] (1-4 tasks)}

TASK is one of:
{"type":"match","prompt":"...","targets":["bucket label", ...],"items":[{"text":"...","target":"exact bucket label"}],"explanation":"..."}
{"type":"order","prompt":"...","items":["step in CORRECT order", ...],"explanation":"..."}
{"type":"fill","prompt":"...","columns":["header", ...],"rows":[[CELL, ...], ...],"explanation":"..."}
  CELL = "fixed text" | {"answer":"x"} or {"answer":["x","accepted alternative"]} for a typed box | {"answer":"x","options":["x","y","z"]} for a dropdown (answer must be one of the options)
{"type":"choice","prompt":"...","options":["...","...","...","..."],"answer":[0-based index, ...],"multi":false,"explanation":"..."}
{"type":"net", ...see NET below...}
{"type":"wifi", ...see WIFI below...}
{"type":"cli","prompt":"...","shell":"windows"|"linux"|"cisco","promptText":"e.g. C:\\\\Users\\\\tech> or tech@web01:~$ or R1#","intro":"optional banner","commands":[{"cmd":["exact command","common variant or abbreviation", ...],"output":"realistic output"}],"question":{"prompt":"...","options":["...","...","...","..."],"answer":[index],"multi":false},"explanation":"..."}

Rules:
- Every fact must be correct for N10-009, and every graded answer must be unambiguous. If more than one answer would be valid, list all of them as alternatives or rewrite the task.
- match: 5-10 items and 3-7 targets; extra distractor targets are welcome. Each item's target must exactly equal one of the targets strings.
- order: 4-8 items.
- fill: typed answers must be short (IP addresses, masks, prefix lengths, numbers, VLAN IDs, single words). Use dropdowns for anything wordy or with multiple valid spellings. 3-12 answer cells. Every row has the same number of cells as columns.
- cli: 6-12 commands whose realistic output contains the evidence needed, including some commands that rule out wrong answers. Include common abbreviations as variants. Don't reveal the answer in the scenario.
- choice: exactly 4 options; set multi true only if the prompt says how many to select.
- Explanations: 1-3 sentences that teach why, including why tempting wrong answers are wrong.
- Plain text only, no markdown.

NET is a live network simulation the learner configures by clicking devices, with real ping/ipconfig/nslookup/tracert on hosts and show commands on switches and routers. Grading checks whether the network actually works.
{"type":"net","prompt":"Make every requirement pass.","devices":[DEVICE,...],"links":[["devId","port","devId","port"],...],"goals":[GOAL,...],"solution":[STEP,...],"explanation":"..."}
DEVICE (x and y are 0-100 diagram positions; put the internet/router at the top and hosts at y 90-95; "editable": false locks a device):
 host: {"id":"pc1","kind":"pc"|"laptop"|"server"|"printer","name":"PC-1","x":10,"y":94,"editable":true,"mode":"static"|"dhcp","ip":"","mask":"","gw":"","dns":""}
   a DNS server host also has "dnsRecords":{"name":"ip"} and optionally "forwarder":"8.8.8.8"; a DHCP server host also has "dhcp":[{"network":"192.168.30.0/24","start":"192.168.30.100","gw":"192.168.30.1","dns":"192.168.10.5"}]
 switch: {"id":"sw1","kind":"switch","name":"SW1","x":50,"y":50,"editable":true,"vlanNames":{"10":"STAFF"},"ports":[{"name":"Gi0/1","mode":"access"|"trunk","vlan":10,"allowed":"all" or "10,20","shutdown":false}]}
 router (at most one): {"id":"r1","kind":"router","name":"R1","x":50,"y":5,"editable":true,"ifaces":[{"name":"Gi0/0.10","vlan":10 or null,"ip":"","mask":"","helper":""}],"defaultRoute":""}
 internet: {"id":"isp","kind":"cloud","name":"Internet","x":90,"y":4,"ip":"203.0.113.1","records":{"comptia.org":"198.51.100.24"}}
Links: a host's port is "NIC", the cloud's is "WAN", a router's is the physical interface (subinterface Gi0/0.10 rides on Gi0/0), and switch ports must exist in that switch's ports list. Each host has exactly one link.
GOAL: {"type":"ping","from":"pc1","to":"IP or DNS name","expect":true,"label":"..."} | {"type":"dhcp","host":"pc2","label":"..."} | {"type":"config","dev":"pc1","field":"ip"|"mask"|"gw"|"dns","equals":["accepted value", ...],"label":"..."}
STEP (one working fix): {"dev":"sw1","port":"Gi0/3","set":{"vlan":20}} | {"dev":"sw1","port":"Gi0/24","set":{"mode":"trunk","allowed":"10,20"}} | {"dev":"r1","iface":"Gi0/0.20","set":{"ip":"192.168.20.1","mask":"255.255.255.0"}} | {"dev":"r1","iface":"Gi0/0.30","set":{"helper":"192.168.10.5"}} | {"dev":"r1","set":{"defaultRoute":"203.0.113.1"}} | {"dev":"srv","pool":0,"set":{"gw":"192.168.30.1"}} | {"dev":"pc2","set":{"gw":"192.168.1.1"}}
How the simulator behaves: hosts need a valid IP, mask and gateway, and the replying device needs a working path back too. Access ports carry one VLAN untagged; trunks carry their allowed VLANs tagged, with VLAN 1 untagged as native; both ends of a trunk must allow a VLAN. A router subinterface with vlan N works over a trunk allowing N; an untagged router interface plugs into an access port. The router routes between its connected subnets and sends everything else to defaultRoute, which must be the cloud's ip on a connected subnet; public IPs are then reachable. DHCP works on the DHCP server's own subnet, or for another subnet via that router interface's helper address; with no lease a client gets 169.254.x.x. DNS: hosts query their dns server, which answers from dnsRecords or asks its forwarder over the internet, where the cloud answers from its records.
Every net task is verified automatically before it's saved: at least one goal must FAIL in the starting configuration, and applying the solution steps must make EVERY goal pass. Plant 1-3 realistic faults (wrong gateway, wrong mask, port in the wrong VLAN, access port where a trunk is needed, VLAN missing from a trunk's allowed list, shut-down port, missing helper address, wrong DHCP scope option, missing default route, wrong DNS server). Use 3-8 devices. Lock devices the learner shouldn't touch. Don't reveal the faults in the scenario; describe symptoms.
More sim features you may use: switch ports also take speed ("auto","100","1000"), duplex ("auto","full","half"), mtu, voice (voice VLAN), native, sfp ("1000BASE-SX","1000BASE-LX","10GBASE-SR","10GBASE-LR"), poe (bool), trusted (bool), portSecurity {enabled,max,violation}, channel (number) and lacp ("on","active","passive"); a switch takes stp {enabled, priority}, dhcpSnooping, dai, poeStd ("af","at","bt") and poeBudget; links take a 5th element {cable:"cat3"|"cat5e"|"cat6"|"smf"|"mmf", length}; kind "l3switch" has ports plus ifaces named "Vlan10" with vlan 10 (SVIs); routers take routes [{net, via, ad}], ospf {enabled, area, passive:[]}, acls {NAME:[{action:"permit"|"deny", proto:"ip"|"icmp"|"tcp"|"udp", src, dst, port}]}, and ifaces take acl (inbound list name), nat ("inside"|"outside"), vip and vipPriority (FHRP); hosts take services ["tcp/443"], hosts {name:ip} (hosts file), fw {enabled, rules:[{action:"allow", proto, port, src}]}, os ("windows"|"linux"), zone [{name,type,value}] for DNS servers, and dhcp scopes may include end, exclusions [], reservations [{mac, ip}]. Goal types also include {"type":"conn","from","to","proto":"tcp","port":443}, {"type":"dns","from","name","rtype":"A","value"}, {"type":"perf","from","to","minMbps"}, and {"type":"state","check":"root"|"noStorm"|"portUp"|"powered"|"bundle"|"noVlanHop"|"macSafe"|"arpSafe"|"unusedDown"|"route", "dev", ...}. Solution steps may also be {"dev","acl":"NAME","rules":[...]}, {"dev","routes":[...]}, {"dev","zone":[...]} or {"link":["devId","port"],"set":{"cable":"cat6"}}.

WIFI is a floor-plan wireless lab graded by a simple model (coverage radius by band and power; channels overlap if their frequency blocks overlap; DFS is 5 GHz channels 52 to 144):
{"type":"wifi","prompt":"...","floor":{"w":meters,"h":meters},"aps":[{"id","name","x","y","band":"2.4"|"5"|"6","channel","width":20|40|80|160,"power":"low"|"medium"|"high","ssid","security":"open"|"owe"|"wpa2-psk"|"wpa2-ent"|"wpa3-sae"|"wpa3-ent","antenna":"omni"|"directional","heading":0,"enabled":true,"captivePortal":false,"bandSteering":false}],"clients":[{"id","name","x","y","bands":["2.4","5"],"security":[...supported],"ssid","path":[[x,y],...] (optional)}],"goals":[{"type":"wifiClient","client","minRssi":-67,"band"?} | {"type":"wifiNoOverlap"} | {"type":"wifiNoDfs"} | {"type":"wifiRoam","client"} | {"type":"wifiLink","a","b"} | {"type":"wifiConfig","ap","field","equals":[...]}],"solution":[{"ap":"id","set":{...}}],"explanation":"..."}
Wifi labs are verified the same way: at least one goal fails at the start and the solution makes all pass.`;
}
async function generate(){
  const g = ui.gen;
  if (!platform.canAsk() || g.busy) return;
  g.busy = true; g.err = false; g.status = "Thinking… this usually takes 20 to 60 seconds."; g.added = [];
  g.ctl = new AbortController();
  render();
  try{
    const res = await platform.askJson(genPrompt(g), {signal:g.ctl.signal,
      onText:({text})=>{ g.status = `Writing lab${g.count>1?"s":""}… ${text.length.toLocaleString()} characters`; const s=document.querySelector(".status"); if (s) s.textContent = g.status; }});
    const arr = Array.isArray(res) ? res : (res && Array.isArray(res.labs) ? res.labs : [res]);
    let skipped = 0;
    for (const raw of arr){
      if (raw && typeof raw==="object"){ raw.domain = g.domain; if (g.obj && !raw.objective) raw.objective = g.obj; }
      const l = safeValidate(raw);
      if (l){ l.id = newId(); store.addLab(l); g.added.push(l); } else skipped++;
    }
    g.status = g.added.length ? `Added ${g.added.length} lab${g.added.length===1?"":"s"} to My labs${skipped?` (${skipped} came back unusable and was skipped)`:""}.` : "The response didn't contain a usable lab. Try again.";
    g.err = !g.added.length;
  }catch(e){
    const code = e && e.code;
    g.err = code!=="cancelled";
    g.status = errorCopy(code);

  }finally{
    g.busy = false; g.ctl = null; if (ui.view==="home") render();
  }
}
