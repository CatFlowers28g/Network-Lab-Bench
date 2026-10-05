
/* ---------- helpers ---------- */
"use strict";
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const [k,v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)){
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
/* Replace an element's children, skipping null/false so nothing prints "null" on screen. */
function put(el, ...kids){ el.replaceChildren(...kids.flat(Infinity).filter(k=>k!=null && k!==false).map(k=>k instanceof Node ? k : document.createTextNode(String(k)))); return el; }
const rnd = (a,b) => a + Math.floor(Math.random()*(b-a+1));
const pick = a => a[Math.floor(Math.random()*a.length)];
function shuffle(a){ a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
const norm = s => String(s ?? "").toLowerCase().replace(/\s+/g," ").trim().replace(/\s*([\/,:;=])\s*/g,"$1");
const newId = () => "g-" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const clone = o => JSON.parse(JSON.stringify(o));
function hashStr(str){ let x=5381; for (let i=0;i<str.length;i++) x=((x<<5)+x+str.charCodeAt(i))>>>0; let y=0; for (let i=str.length-1;i>=0;i--) y=((y<<5)-y+str.charCodeAt(i))>>>0; return x.toString(36)+y.toString(36); }

const DOMAINS = [
  {id:"concepts", name:"Networking concepts", short:"Concepts", color:"var(--c-blue)", hint:"OSI model, appliances and functions, cloud concepts, ports and protocols, traffic types, transmission media and transceivers, topologies, IPv4/IPv6 addressing and subnetting, modern environments (SDN, SD-WAN, VXLAN, zero trust, SASE, IaC)"},
  {id:"implementation", name:"Network implementation", short:"Implement", color:"var(--c-green)", hint:"routing (static, OSPF, BGP, EIGRP, NAT/PAT, FHRP), switching (VLANs, 802.1Q trunking, voice VLAN, STP, link aggregation, MTU/jumbo frames), wireless (bands, channels, channel width, SSID, encryption, antennas, autonomous vs controller), physical installation (racks, patch panels, power, environmental)"},
  {id:"operations", name:"Network operations", short:"Operations", color:"var(--c-orange)", hint:"documentation (diagrams, asset inventory, IPAM, SLAs), life-cycle and change management, configuration management, monitoring (SNMP, syslog, flow data, packet capture, baselines, alerts), disaster recovery (RPO, RTO, MTTR, MTBF, hot/warm/cold sites, HA), DHCP, DNS, NTP/PTP, access and management (VPN, jump box, out-of-band, API)"},
  {id:"security", name:"Network security", short:"Security", color:"var(--c-red)", hint:"CIA triad, encryption, PKI, IAM (MFA, SSO, RADIUS, TACACS+, LDAP, SAML), segmentation, attacks (DDoS, VLAN hopping, MAC flooding, ARP and DNS poisoning, rogue DHCP, rogue AP, evil twin, on-path, social engineering), hardening (port security, ACLs, 802.1X, NAC, screened subnet, honeypot, key management)"},
  {id:"troubleshooting", name:"Network troubleshooting", short:"Troubleshoot", color:"var(--c-brown)", hint:"troubleshooting methodology, cabling and physical interface issues, switching/routing/addressing issues, performance issues (congestion, latency, jitter, packet loss, interference), tools and commands (ping, tracert/traceroute, nslookup, dig, tcpdump, netstat, ipconfig, ip, arp, show commands, cable tester, toner, Wi-Fi analyzer, protocol analyzer)"}
];
const DOMAIN_IDS = DOMAINS.map(d=>d.id);
const dom = id => DOMAINS.find(d=>d.id===id) || DOMAINS[0];
const TYPES = {net:"Network sim", cli:"Command line", fill:"Configuration", match:"Matching", order:"Ordering", choice:"Scenario question"};
