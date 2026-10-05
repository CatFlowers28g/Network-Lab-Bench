/* Network Lab Bench step-by-step explanations. MIT License.
   Deterministic: subnetting and IPv6 steps are computed, and sim hints come from comparing the learner's
   configuration with a known-good solution and from the engine's own packet trace. */

"use strict";
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
