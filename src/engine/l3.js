/* Network Lab Bench simulation engine: layer 3 and services. MIT License. */

"use strict";
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
