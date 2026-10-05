/* Topic categories, plain-language lab titles and descriptions, and the Easy / Medium / Hard level system.
   Learners browse by topic. Exam domains and objective numbers stay internal (exam weighting, Anki tags, AI prompts). */
"use strict";
const CATEGORIES = [
  {id:"basics", name:"Network basics", short:"Basics", color:"#2F6FCF", desc:"The OSI model, what each kind of network device does, common ports and protocols, and network layouts.", objs:["1.1","1.2","1.4","1.6"]},
  {id:"addressing", name:"IP addressing and subnetting", short:"Addressing", color:"#7B5CC9", desc:"Subnet masks, usable host ranges, gateways, and IPv6 address types.", objs:["1.7"]},
  {id:"switching", name:"Switching and VLANs", short:"Switching", color:"#2E9457", desc:"VLANs, trunks, voice VLANs, Spanning Tree, link aggregation, jumbo frames and routing between VLANs.", objs:["2.2"]},
  {id:"routing", name:"Routing and internet access", short:"Routing", color:"#0F8A8A", desc:"Static routes, OSPF, NAT, default routes and backup gateways.", objs:["2.1"]},
  {id:"services", name:"DHCP and DNS", short:"DHCP & DNS", color:"#E07B22", desc:"Handing out addresses and resolving names: scopes, reservations, relays and DNS records.", objs:["3.4"]},
  {id:"wireless", name:"Wi-Fi", short:"Wi-Fi", color:"#C2489B", desc:"Bands, channels and channel width, roaming, antennas and wireless security.", objs:["2.3"]},
  {id:"physical", name:"Cabling and hardware", short:"Cabling", color:"#8A5A35", desc:"Copper and fiber, transceivers, cable testers, speed and duplex, and Power over Ethernet.", objs:["1.5","2.4","5.2"]},
  {id:"security", name:"Security", short:"Security", color:"#C9413A", desc:"Firewall rules and access lists, port security, and stopping attacks like rogue DHCP, ARP spoofing and VLAN hopping.", objs:["4.1","4.2","4.3"]},
  {id:"cloud", name:"Cloud and modern networks", short:"Cloud", color:"#3A9AD9", desc:"Cloud VPCs, security groups, SDN, SD-WAN and other modern designs.", objs:["1.3","1.8"]},
  {id:"operations", name:"Operations and monitoring", short:"Operations", color:"#B08A1E", desc:"Documentation, monitoring and syslog, disaster recovery and remote access.", objs:["3.1","3.2","3.3","3.5"]},
  {id:"troubleshooting", name:"Troubleshooting", short:"Troubleshoot", color:"#5F6B78", desc:"The troubleshooting method, command-line tools, and mixed problems where you don't know the cause up front.", objs:["5.1","5.3","5.4","5.5"]}
];
const CAT_BY_OBJ = {}; for (const c of CATEGORIES) for (const o of c.objs) CAT_BY_OBJ[o] = c.id;
const cat = id => CATEGORIES.find(c=>c.id===id) || CATEGORIES[CATEGORIES.length-1];
const catOfObj = o => CAT_BY_OBJ[(String(o||"").match(/^\d\.\d/)||[])[0]] || null;
const LEVELS = [[1,"Easy"],[2,"Medium"],[3,"Hard"]];
const levelName = n => ({1:"Easy",2:"Medium",3:"Hard"})[n] || "Medium";
const levelTag = n => h("span",{class:"lvl l"+(n||2)}, levelName(n));
const KINDS = {sim:"Network sim", wifi:"Wi-Fi sim", cli:"Command line", drill:"Drill"};
const KIND_FILTER = [["all","All lab types"],["sim","Network simulations"],["wifi","Wi-Fi simulations"],["cli","Command-line labs"],["drill","Drills and questions"]];
const kindOf = types => types.includes("net") ? "sim" : types.includes("wifi") ? "wifi" : types.includes("cli") ? "cli" : "drill";

/* Clear titles, one-line descriptions, topic and (where re-rated) level for every built-in lab. */
const LAB_META = {
  "gen-fault":{cat:"troubleshooting", title:"Random troubleshooting challenge"},
  "s-branch":{cat:"troubleshooting", title:"Fix a branch office that can't browse", desc:"Two PCs can't reach the web while a third works. Compare them, check the switch, and find what's different."},
  "b-method":{cat:"troubleshooting", title:"Put the troubleshooting steps in order", desc:"Arrange the CompTIA troubleshooting method, from identifying the problem to documenting what you found."},
  "b-osi":{cat:"basics", title:"Place protocols and devices on the OSI model", desc:"Sort common protocols and network gear into the seven OSI layers."},
  "gen-ports":{cat:"basics", title:"Ports and protocols drill", desc:"Match well-known services to their port numbers. You get a fresh set every time; higher levels give you more to match."},
  "s-slash27":{cat:"addressing", title:"Address a new /27 subnet", desc:"Work out the usable range of 10.20.30.0/27, then give the desks and the server valid addresses that reach the internet."},
  "gen-subnet":{cat:"addressing", title:"Subnetting drill", desc:"Find the network, broadcast and host range for a random address. Easy sticks to simple prefixes; Hard uses tricky ones."},
  "b-ipv6":{cat:"addressing", title:"Identify IPv6 address types", desc:"Tell link-local, global unicast, unique local, multicast and loopback addresses apart in a packet capture."},
  "s-trunk":{cat:"switching", level:1, title:"Carry VLANs between two switches (trunking)", desc:"Two VLANs span two switches. Set up the trunk and access ports so each VLAN works end to end."},
  "s-voice":{cat:"switching", level:1, title:"Set up a voice VLAN for a desk phone", desc:"A phone and a PC share one switch port. Add the voice VLAN so the phone can reach the call manager."},
  "s-jumbo":{cat:"switching", level:1, title:"Turn on jumbo frames end to end (MTU)", desc:"Storage traffic fails with 9000-byte frames. Make every hop on the path support the larger MTU."},
  "b-vlan":{cat:"switching", title:"Fill in an access switch's VLAN settings", desc:"Set the data, voice, guest and management VLANs, plus the trunk to the router, on a new switch."},
  "s-svi":{cat:"switching", title:"Route between VLANs on a Layer 3 switch", desc:"Staff can reach their gateway but not the printing VLAN. Finish the switch's VLAN interfaces (SVIs)."},
  "s-lacp":{cat:"switching", title:"Fix a link-aggregation bundle (LACP)", desc:"Two uplinks should act as one 2 Gbps link. Find the mismatch that keeps the bundle down."},
  "s-roas":{cat:"switching", title:"Build router-on-a-stick", desc:"Route between two VLANs over a single router link using 802.1Q subinterfaces so staff can print."},
  "s-stp":{cat:"switching", title:"Stop a broadcast storm (Spanning Tree)", desc:"Three switches cabled in a loop took the network down. Get STP running and make Core-1 the root bridge."},
  "s-native":{cat:"switching", title:"Fix a native VLAN mismatch on a trunk", desc:"Management traffic leaks into VLAN 1 and two management PCs can't talk. Fix the trunk between the switches."},
  "s-static":{cat:"routing", level:1, title:"Connect two sites with static routes", desc:"Add the missing routes on both routers so HQ and the branch can reach each other over the WAN link."},
  "s-nat":{cat:"routing", title:"Get an office back online with NAT", desc:"A replacement router has no internet. Set the ISP addressing, the default route and address translation (PAT)."},
  "s-fhrp":{cat:"routing", title:"Keep users online when a router fails (FHRP)", desc:"Two routers share a virtual gateway. Fix it so users stay connected now that the primary has lost power."},
  "s-ospf":{cat:"routing", title:"Steer traffic with OSPF costs", desc:"Three routers run OSPF. Make traffic take the fast path and keep an old static route only as a backup."},
  "s-dns":{cat:"services", title:"Fix DNS after a server move", desc:"The intranet moved to a new server. Fix the DNS records, reverse lookups and one PC that still goes to the old one."},
  "s-scope":{cat:"services", title:"Grow a full DHCP scope and add a reservation", desc:"PCs get APIPA addresses and one conflicts with a printer. Resize the scope and reserve an address for the badge printer."},
  "b-dns-cli":{cat:"services", title:"Websites won't load: troubleshoot from the command line", desc:"Use ipconfig, ping and nslookup on a user's PC to find out why names don't resolve."},
  "s-dhcp":{cat:"services", title:"Get DHCP working on a second subnet (relay)", desc:"Contractor laptops get 169.254 addresses. Get the DHCP server answering across the router."},
  "b-wireless":{cat:"wireless", title:"Pick channels and security for three access points", desc:"Choose a non-overlapping channel for the middle AP and the right authentication and encryption."},
  "w-channels":{cat:"wireless", title:"Fix overlapping 2.4 GHz channels", desc:"Three warehouse APs interfere with each other. Pick channels that don't overlap so scanners stay connected."},
  "w-roam":{cat:"wireless", title:"Fix Wi-Fi drops while walking (roaming)", desc:"Tablets lose Wi-Fi in a long hallway. Enable the missing AP and match its network settings so clients roam."},
  "w-sec":{cat:"wireless", title:"Secure corporate and guest Wi-Fi", desc:"Move Corp to 802.1X with RADIUS and set up an open guest network with a captive portal."},
  "w-bridge":{cat:"wireless", title:"Link two buildings with a wireless bridge", desc:"Pick the right antennas and a shared channel for a 100 m point-to-point link."},
  "w-dfs":{cat:"wireless", title:"Stop radar-triggered channel changes (DFS)", desc:"APs near an airport keep jumping channels. Move them off DFS channels without creating overlap."},
  "w-5ghz":{cat:"wireless", title:"Move an office to 5 GHz", desc:"Put every AP on 5 GHz with channel widths that don't overlap, while avoiding DFS channels."},
  "b-wiremap":{cat:"physical", title:"Read a cable tester's wire map", desc:"Interpret the tester's results to find out why a newly made patch cable won't link."},
  "s-poe":{cat:"physical", title:"Power IP phones and an access point (PoE)", desc:"Some phones and a Wi-Fi 6 AP won't boot. Choose a switch with the right PoE standard and power budget."},
  "b-duplex-cli":{cat:"physical", title:"Fix a slow printer (speed and duplex)", desc:"Use switch show commands to find and fix a duplex mismatch on the printer's port."},
  "s-phys":{cat:"physical", title:"Fix a fiber uplink and slow PCs", desc:"Choose optics for a 400 m single-mode run and clear up speed and cabling problems at the remote closet."},
  "b-acl":{cat:"security", title:"Write firewall rules for a DMZ", desc:"Allow HTTPS, DNS and admin SSH to two public servers and block everything else."},
  "b-topology":{cat:"security", title:"Place devices in a secure network design", desc:"Decide what goes at the internet edge, in the screened subnet, on the LAN and on the management network."},
  "s-portsec":{cat:"security", title:"Lock down switch ports (port security)", desc:"Allow two devices on a meeting-room port, stop a MAC-flooding device, and shut unused ports."},
  "s-vlanhop":{cat:"security", title:"Prevent VLAN hopping", desc:"A kiosk port can negotiate a trunk. Turn off DTP, put the kiosk in the guest VLAN and shut unused ports."},
  "s-acl":{cat:"security", title:"Block guests from internal networks (ACL)", desc:"Fix an access list so guests only reach the internet while staff keep HTTPS to the app server."},
  "s-rogue":{cat:"security", title:"Stop a rogue DHCP server (DHCP snooping)", desc:"Users get a fake gateway from an unauthorized DHCP server. Block it without breaking real DHCP."},
  "s-arp":{cat:"security", title:"Stop ARP spoofing (Dynamic ARP Inspection)", desc:"A kiosk is pretending to be the gateway. Turn on DAI so fake ARP replies are dropped and users stay online."},
  "s-vpc":{cat:"cloud", title:"Build a cloud VPC", desc:"Give a public web server and a private database the right routes, NAT gateway access and security-group rules."},
  "b-syslog":{cat:"operations", title:"Learn the syslog severity levels", desc:"Match the eight syslog severity levels and decide which ones deserve an alert."},
  "b-dr":{cat:"operations", title:"Disaster recovery terms (RPO, RTO and site types)", desc:"Match recovery metrics and hot, warm and cold sites to what they mean."}
};
function applyLabMeta(l){ const m = LAB_META[l.id]; if (!m) return l; if (m.title) l.title = m.title; if (m.level) l.difficulty = m.level; if (m.desc) l.desc = m.desc; l.cat = m.cat; return l; }
[...SIM_LABS, ...WIFI_LABS, ...STATIC_LABS, ...GEN_LABS].forEach(applyLabMeta);
function catOfLab(l){ return (LAB_META[l.id] && LAB_META[l.id].cat) || l.cat || catOfObj(labObjectives(l)[0]) || "troubleshooting"; }
const firstSentence = s => { const t = String(s||"").trim(); const m = t.match(/^.{20,170}?[.!?](\s|$)/); return m ? m[0].trim() : t.slice(0,160); };

/* ---- level and study path preferences (kept in progress so they back up and sync) ---- */
const prefs = () => store.progress.prefs || (store.progress.prefs = {level:0, path:[], at:0});
function setPrefs(p){ store.progress.prefs = {...prefs(), ...p, at:Date.now()}; store.saveProgress(); }
const userLevel = () => Number(prefs().level) || 0;   /* 0 = all levels */
const passed = id => ((store.progress.labs[id]||{}).best || 0) >= 85;
function levelProgress(n){ const es = allLabEntries().filter(e=>!e.gen && e.level===n); return {done:es.filter(e=>passed(e.id)).length, total:es.length}; }
function levelUpOffer(){
  const lv = userLevel(); if (lv!==1 && lv!==2) return null;
  const p = levelProgress(lv); if (!p.total || p.done/p.total < 0.75) return null;
  return lv+1;
}
function pathEntries(){ const all = new Map(allLabEntries().map(e=>[e.id,e])); return prefs().path.map(id=>all.get(id)).filter(Boolean); }
const nextInPath = (skip) => pathEntries().find(e=>!passed(e.id) && e.id!==skip) || null;
function togglePath(id){ const p = prefs().path || []; setPrefs({path: p.includes(id) ? p.filter(x=>x!==id) : [...p, id]}); }
function catMastery(id){
  const os = cat(id).objs, vals = os.map(mastery).filter(v=>v!=null);
  if (!vals.length) return null;
  return Math.round(os.reduce((s,o)=>s + (mastery(o) ?? 0), 0) / os.length);
}
function levelPicker(compact){
  return h("div",{class:"seg lvlpick", role:"group", "aria-label":"Level"},
    [[0,"All levels"],...LEVELS].map(([v,t])=>h("button",{type:"button","aria-pressed":userLevel()===v?"true":"false", onclick:()=>{ setPrefs({level:v}); render(); }}, compact && v===0 ? "All" : t)));
}
