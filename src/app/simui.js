/* ---------- network simulator UI ---------- */

"use strict";
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, ...kids){
  const el = document.createElementNS(SVGNS, tag);
  for (const [k,v] of Object.entries(attrs||{})){ if (v==null) continue; if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
  for (const c of kids.flat()){ if (c==null) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}
function devIcon(kind){
  switch (kind){
    case "pc": return [sv("rect",{x:-15,y:-13,width:30,height:20,rx:2,class:"ic"}), sv("rect",{x:-11,y:-9,width:22,height:12,class:"ic-screen"}), sv("path",{d:"M-4 7 L4 7 L6 12 L-6 12 Z",class:"ic"})];
    case "laptop": return [sv("rect",{x:-12,y:-12,width:24,height:16,rx:2,class:"ic"}), sv("rect",{x:-9,y:-9,width:18,height:10,class:"ic-screen"}), sv("path",{d:"M-17 5 L17 5 L14 10 L-14 10 Z",class:"ic"})];
    case "server": return [sv("rect",{x:-11,y:-16,width:22,height:30,rx:2,class:"ic"}), sv("path",{d:"M-7 -9 H7 M-7 -2 H7 M-7 5 H7",class:"ic-line"}), sv("circle",{cx:6,cy:10,r:1.6,class:"ic-led"})];
    case "printer": return [sv("rect",{x:-9,y:-15,width:18,height:9,class:"ic"}), sv("rect",{x:-15,y:-7,width:30,height:14,rx:2,class:"ic"}), sv("rect",{x:-9,y:7,width:18,height:6,class:"ic"})];
    case "phone": return [sv("rect",{x:-13,y:-10,width:26,height:20,rx:3,class:"ic"}), sv("rect",{x:-9,y:-6,width:10,height:7,class:"ic-screen"}), sv("path",{d:"M4 -6 H9 M4 -1 H9 M4 4 H9",class:"ic-line"})];
    case "ap": return [sv("ellipse",{cx:0,cy:4,rx:15,ry:7,class:"ic"}), sv("path",{d:"M-8 -6 Q0 -14 8 -6 M-4 -2 Q0 -6 4 -2",class:"ic-line"})];
    case "switch": return [sv("rect",{x:-22,y:-9,width:44,height:18,rx:3,class:"ic"}), ...[-14,-6,2,10].map(x=>sv("rect",{x,y:-3,width:5,height:5,class:"ic-port"}))];
    case "l3switch": return [sv("rect",{x:-22,y:-11,width:44,height:22,rx:3,class:"ic"}), sv("path",{d:"M-12 0 H12 M6 -5 L12 0 L6 5 M-6 -5 L-12 0 L-6 5",class:"ic-line"})];
    case "router": case "natgw": return [sv("circle",{r:15,class:"ic"}), sv("path",{d:"M-8 -8 L8 8 M8 -8 L-8 8 M3 -8 H8 V-3 M-3 8 H-8 V3",class:"ic-line"})];
    case "igw": return [sv("circle",{r:15,class:"ic"}), sv("path",{d:"M-10 0 H10 M0 -10 V10 M-7 -7 Q0 -2 7 -7 M-7 7 Q0 2 7 7",class:"ic-line"})];
    case "firewall": return [sv("rect",{x:-16,y:-12,width:32,height:24,rx:2,class:"ic"}), sv("path",{d:"M-16 -4 H16 M-16 4 H16 M-6 -12 V-4 M6 -4 V4 M-6 4 V12",class:"ic-line"})];
    case "cloud": return [sv("path",{d:"M-16 9 C-24 9 -24 -2 -15 -3 C-15 -12 -2 -15 3 -8 C8 -14 19 -10 17 -1 C25 0 24 9 16 9 Z",class:"ic"})];
  }
  return [sv("rect",{x:-10,y:-10,width:20,height:20,class:"ic"})];
}
const KIND_NAME = {pc:"PC", laptop:"Laptop", server:"Server", printer:"Printer", phone:"IP phone", ap:"Access point", switch:"Switch", l3switch:"Layer 3 switch", router:"Router", firewall:"Firewall", natgw:"NAT gateway", igw:"Internet gateway", cloud:"Internet / ISP"};
/* ---- small form helpers ---- */
function fld(obj, key, opts){
  opts = opts || {};
  const dis = !!opts.disabled, label = opts.label || key;
  const set = v => { obj[key] = v; opts.onChange && opts.onChange(key, v); };
  if (opts.options) return h("select",{"aria-label":label, disabled:dis, onchange:e=>{ const o = opts.options.find(x=>String(x[0])===e.target.value); set(o ? o[0] : e.target.value); opts.redraw && opts.redraw(); }}, opts.options.map(([v,t])=>h("option",{value:String(v), selected:String(obj[key] ?? opts.dflt ?? "")===String(v)}, t)));
  if (opts.check) return h("input",{type:"checkbox","aria-label":label, disabled:dis, checked:!!obj[key], onchange:e=>{ set(e.target.checked); opts.redraw && opts.redraw(); }});
  return h("input",{type:"text","aria-label":label, disabled:dis, value:obj[key]==null ? "" : (Array.isArray(obj[key]) ? obj[key].join(", ") : obj[key]), placeholder:opts.ph||"", autocomplete:"off", autocapitalize:"off", spellcheck:"false", inputmode:opts.num?"numeric":null,
    oninput:e=>{ let v = e.target.value; if (opts.num) v = v.trim()==="" ? "" : Number(v); if (opts.list) v = v.split(/[,\s]+/).filter(Boolean); set(v); }});
}
function listEditor(arr, cols, opts){
  opts = opts || {};
  const wrap = h("div",{class:"tablewrap"});
  const draw = () => {
    put(wrap, h("table",{class:"cfg"},
      h("thead",null,h("tr",null, cols.map(c=>h("th",null,c.label)), opts.disabled ? null : h("th",null,""))),
      h("tbody",null, arr.length ? arr.map((row,i)=>h("tr",null, cols.map(c=>h("td",null, fld(row, c.key, {...c, disabled:opts.disabled, label:`${c.label} ${i+1}`, onChange:opts.onChange}))),
        opts.disabled ? null : h("td",{class:"rowbtns"},
          opts.ordered ? h("button",{type:"button", class:"mini", "aria-label":"Move up", disabled:i===0, onclick:()=>{ [arr[i-1],arr[i]] = [arr[i],arr[i-1]]; opts.onChange && opts.onChange(); draw(); }},"↑") : null,
          h("button",{type:"button", class:"mini", "aria-label":"Remove row", onclick:()=>{ arr.splice(i,1); opts.onChange && opts.onChange(); draw(); }},"✕")))) :
        h("tr",null,h("td",{colspan:cols.length+1, class:"muted small"}, opts.empty || "None")))),
      opts.disabled ? null : h("button",{type:"button", class:"btn ghost small", onclick:()=>{ arr.push(clone(opts.blank||{})); opts.onChange && opts.onChange(); draw(); }}, opts.addLabel || "Add row"));
  };
  draw(); return wrap;
}
const kvRows = rows => h("div",{class:"kv"}, rows.filter(Boolean).map(([k,v])=>[h("label",null,k), v]));
const subhead = t => h("div",{class:"subhead"}, t);
const STP_PRI = [0,4096,8192,12288,16384,20480,24576,28672,32768,36864,40960,45056,49152,53248,57344,61440].map(p=>[p,String(p)]);
/* ---- the component ---- */
function netComp(t, lab, opts){
  opts = opts || {};
  let devices = clone(t.devices), links = clone(t.links);
  let sel = (devices.find(d=>d.editable!==false && d.kind!=="cloud") || devices[0]).id, tab = "config", locked = false;
  const terms = {}, open = {};
  const fresh = () => makeNet(devices, links);
  let net = fresh();
  const pos = d => ({x: 34 + d.x*3.32, y: 24 + d.y*1.9});
  const goalItems = t.goals.map(g=>h("li",null, h("span",{class:"gmark","aria-hidden":"true"}), h("span",null, g.label, h("span",{class:"gwhy"}))));
  const svgWrap = h("div",{class:"topo"}), panel = h("div",{class:"dpanel"}), solBox = h("div");
  const changed = () => { net = fresh(); drawTopo(); };
  const resetBtn = h("button",{class:"btn ghost", type:"button", onclick:()=>{ if (locked) return; devices = clone(t.devices); links = clone(t.links); for (const k in terms) delete terms[k]; changed(); drawPanel(); }},"Reset all devices");
  function select(id){ sel = id; const d = devices.find(x=>x.id===id); tab = d.editable!==false || ["cloud","printer"].includes(d.kind) ? "config" : "term"; drawTopo(); drawPanel(); }
  function drawTopo(){
    const svg = sv("svg",{viewBox:"0 0 400 250", class:"topo-svg", role:"group", "aria-label":"Network diagram"});
    net.links.forEach((L,li)=>{
      const a = net.byId[L.a], b = net.byId[L.b]; if (!a || !b) return;
      const pa = pos(a), pb = pos(b);
      const cls = !L.st.up ? " down" : net.stp.blocked.has(li) ? " blocked" : L.st.dupMismatch || L.st.loss>0.05 ? " warn" : "";
      svg.append(sv("line",{x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y,class:"lk"+cls}, sv("title",null, !L.st.up ? `Down: ${L.st.reason}` : net.stp.blocked.has(li) ? "Blocked by spanning tree" : `${L.st.nominal>=1000?L.st.nominal/1000+" Gbps":L.st.nominal+" Mbps"}${L.st.dupMismatch?", duplex mismatch":""}`)));
      for (const [d,p,o,q] of [[a,L.pa,pa,pb],[b,L.pb,pb,pa]]){
        if (isHost(d) || d.kind==="cloud") continue;
        const f = 0.3; svg.append(sv("text",{x:o.x+(q.x-o.x)*f, y:o.y+(q.y-o.y)*f-3, class:"pl", "text-anchor":"middle"}, shortIf(p)));
      }
    });
    for (const d of net.devs){
      const p = pos(d);
      const g = sv("g",{transform:`translate(${p.x} ${p.y})`, class:"dev"+(d.id===sel?" sel":"")+(d._off?" off":""), tabindex:"0", role:"button", "aria-label":`${d.name}, ${KIND_NAME[d.kind]||d.kind}${d._off?", no power":""}${d.id===sel?", selected":""}`,
        onclick:()=>select(d.id), onkeydown:e=>{ if (e.key==="Enter"||e.key===" "){ e.preventDefault(); select(d.id); } }},
        sv("rect",{x:-26,y:-20,width:52,height:52,rx:8,class:"hit"}), ...devIcon(d.kind), sv("text",{y:26,class:"dl","text-anchor":"middle"}, d.name));
      svg.append(g);
    }
    put(svgWrap, svg);
  }
  function hostConfig(d, dis){
    const r = () => drawPanel(), oc = () => changed();
    const dhcp = d.mode==="dhcp";
    const parts = [kvRows([
      ["IP assignment", fld(d,"mode",{disabled:dis, label:"IP assignment", options:[["static","Static"],["dhcp","DHCP"]], redraw:r, onChange:oc})],
      ["IPv4 address", fld(d,"ip",{disabled:dis||dhcp, label:"IPv4 address", ph:dhcp?"from DHCP":"e.g. 192.168.1.10", onChange:oc})],
      ["Subnet mask", fld(d,"mask",{disabled:dis||dhcp, label:"Subnet mask", ph:dhcp?"from DHCP":"e.g. 255.255.255.0", onChange:oc})],
      ["Default gateway", fld(d,"gw",{disabled:dis||dhcp, label:"Default gateway", ph:dhcp?"from DHCP":"", onChange:oc})],
      ["DNS server", fld(d,"dns",{disabled:dis||dhcp, label:"DNS server", ph:dhcp?"from DHCP":"", onChange:oc})],
      d.forwarder!=null ? ["DNS forwarder", fld(d,"forwarder",{disabled:dis, label:"DNS forwarder", onChange:oc})] : null,
      d.publicIp ? ["Public IP", h("span",{class:"mono"}, d.publicIp)] : null,
      d.poe ? ["PoE", h("span",null, `Needs 802.3${d.poe.std||"af"}, ${d.poe.watts||POE_W[d.poe.std||"af"]} W`, " ", h("label",{class:"inl"}, fld(d.poe,"injector",{disabled:dis, check:true, label:"Use a PoE injector", onChange:oc, redraw:r}), " Use an injector"))] : null])];
    if (dhcp){ const c = (net.reset(), hostCfg(net, d)); parts.push(h("p",{class:"small muted", style:"margin:8px 0 0"}, c.ok ? (c.apipa ? `No DHCP lease: using APIPA ${intToIp(c.ip)}` : `Leased ${intToIp(c.ip)}/${c.n} from ${c.serverName||c.server}, gateway ${c.gw!=null?intToIp(c.gw):"none"}`) : c.why)); }
    if (d.zone || d.dnsRecords){
      if (!d.zone){ d.zone = Object.entries(d.dnsRecords).map(([name,value])=>({name, type:ipToInt(value)!=null?"A":"CNAME", value})); delete d.dnsRecords; }
      parts.push(subhead("DNS zone records"), listEditor(d.zone, [{key:"name", label:"Name"},{key:"type", label:"Type", options:["A","AAAA","CNAME","MX","TXT","NS","PTR"].map(x=>[x,x])},{key:"value", label:"Value"}], {disabled:dis, onChange:oc, blank:{name:"", type:"A", value:""}, addLabel:"Add record"}));
    }
    if (Array.isArray(d.dhcp) && d.dhcp.length){
      parts.push(subhead("DHCP scopes"));
      d.dhcp.forEach((p,i)=>{
        p.reservations = p.reservations || []; 
        parts.push(h("div",{class:"scope"}, h("div",{class:"small muted"}, `Scope ${i+1}`), kvRows([
          ["Network (CIDR)", fld(p,"network",{disabled:dis, label:`Scope ${i+1} network`, onChange:oc})],
          ["Start address", fld(p,"start",{disabled:dis, label:`Scope ${i+1} start`, onChange:oc})],
          ["End address", fld(p,"end",{disabled:dis, label:`Scope ${i+1} end`, ph:"end of subnet", onChange:oc})],
          ["Router option", fld(p,"gw",{disabled:dis, label:`Scope ${i+1} router option`, onChange:oc})],
          ["DNS option", fld(p,"dns",{disabled:dis, label:`Scope ${i+1} DNS option`, onChange:oc})],
          ["Exclusions", fld(p,"exclusions",{disabled:dis, label:`Scope ${i+1} exclusions`, list:true, ph:"e.g. 10.0.0.50 or 10.0.0.50-10.0.0.60", onChange:oc})]]),
          h("div",{class:"small muted", style:"margin-top:6px"},"Reservations"),
          listEditor(p.reservations, [{key:"mac", label:"MAC address"},{key:"ip", label:"IP address"}], {disabled:dis, onChange:oc, blank:{mac:"", ip:""}, addLabel:"Add reservation"})));
      });
    }
    const more = [];
    more.push(kvRows([["NIC speed", fld(d.nic,"speed",{disabled:dis, label:"NIC speed", options:[["auto","Auto"],["10","10 Mbps"],["100","100 Mbps"],["1000","1 Gbps"]], onChange:oc, redraw:r})],["NIC duplex", fld(d.nic,"duplex",{disabled:dis, label:"NIC duplex", options:[["auto","Auto"],["full","Full"],["half","Half"]], onChange:oc, redraw:r})],["NIC MTU", fld(d.nic,"mtu",{disabled:dis, label:"NIC MTU", num:true, onChange:oc})],["Power", fld(d,"power",{disabled:dis, check:true, label:"Powered on", onChange:oc, redraw:r})]]));
    d.hostsList = d.hostsList || Object.entries(d.hosts||{}).map(([name,ip])=>({name, ip}));
    const syncHosts = () => { d.hosts = Object.fromEntries(d.hostsList.filter(x=>x.name).map(x=>[x.name, x.ip])); oc(); };
    more.push(subhead("Hosts file"), listEditor(d.hostsList, [{key:"name", label:"Name"},{key:"ip", label:"IP address"}], {disabled:dis, onChange:syncHosts, blank:{name:"", ip:""}, empty:"No entries", addLabel:"Add entry"}));
    d.fw = d.fw || {enabled:false, rules:[]};
    more.push(subhead("Host firewall / security group (inbound, stateful)"), h("label",{class:"inl"}, fld(d.fw,"enabled",{disabled:dis, check:true, label:"Firewall enabled", onChange:oc, redraw:r}), " Enabled (anything not allowed is blocked)"),
      listEditor(d.fw.rules, [{key:"action", label:"Action", options:[["allow","Allow"],["deny","Deny"]]},{key:"proto", label:"Protocol", options:[["tcp","TCP"],["udp","UDP"],["icmp","ICMP"],["ip","Any"]]},{key:"port", label:"Port"},{key:"src", label:"Source (CIDR)"}], {disabled:dis, onChange:oc, blank:{action:"allow", proto:"tcp", port:"443", src:"0.0.0.0/0"}, ordered:true, addLabel:"Add rule"}));
    parts.push(details("More host settings", more, "host-"+d.id));
    return parts;
  }
  function details(summary, kids, key){
    const el = h("details",{class:"more", open:open[key]||null}, h("summary",null, summary), ...kids);
    el.addEventListener("toggle", ()=>{ open[key] = el.open; });
    return el;
  }
  function linkFor(devId, port){ return links.find(l=>(l[0]===devId && pn(l[1])===pn(port)) || (l[2]===devId && pn(l[3])===pn(port))); }
  function portDetail(d, p, dis){
    const oc = () => changed(), r = () => drawPanel();
    const L = linkFor(d.id, p.name);
    if (L && !L[4]) L[4] = {};
    p.portSecurity = p.portSecurity || {enabled:false, max:1, violation:"shutdown"};
    const st = (()=>{ const l = linkAt(net, d.id, p.name); return l ? net.links[l.li].st : null; })();
    return h("div",{class:"portmore"},
      h("p",{class:"small muted", style:"margin:0 0 8px"}, st ? (st.up ? `Link up at ${st.nominal>=1000?st.nominal/1000+" Gbps":st.nominal+" Mbps"}, ${st.duplex[0]===st.duplex[1]?st.duplex[0]:"duplex mismatch"} duplex${st.loss?`, ${Math.round(st.loss*100)}% errors`:""}` : `Link down: ${st.reason}`) : "Nothing connected"),
      kvRows([
        ["Speed", fld(p,"speed",{disabled:dis, label:`${p.name} speed`, options:[["auto","Auto"],["10","10 Mbps"],["100","100 Mbps"],["1000","1 Gbps"],["10000","10 Gbps"]], onChange:oc, redraw:r})],
        ["Duplex", fld(p,"duplex",{disabled:dis, label:`${p.name} duplex`, options:[["auto","Auto"],["full","Full"],["half","Half"]], onChange:oc, redraw:r})],
        ["MTU", fld(p,"mtu",{disabled:dis, label:`${p.name} MTU`, options:[[1500,"1500"],[9000,"9000 (jumbo)"],[9216,"9216"]], onChange:oc, redraw:r})],
        ["Native VLAN (trunk)", fld(p,"native",{disabled:dis||p.mode!=="trunk", label:`${p.name} native VLAN`, num:true, onChange:oc})],
        ["Voice VLAN", fld(p,"voice",{disabled:dis||p.mode==="trunk", label:`${p.name} voice VLAN`, num:true, ph:"none", onChange:oc})],
        ["Transceiver", fld(p,"sfp",{disabled:dis, label:`${p.name} transceiver`, options:[["","None (copper port)"],...Object.keys(SFP).map(k=>[k,k])], onChange:oc, redraw:r})],
        L ? ["Cable", fld(L[4],"cable",{disabled:dis, label:`${p.name} cable`, options:Object.entries(CABLES).map(([k,c])=>[k,c.name]), dflt:"cat6", onChange:oc, redraw:r})] : null,
        L && L[4].length ? ["Cable length (m)", h("span",{class:"mono"}, L[4].length)] : null,
        ["PoE", fld(p,"poe",{disabled:dis, label:`${p.name} PoE`, check:true, onChange:oc, redraw:r})],
        ["DHCP snooping / DAI trust", fld(p,"trusted",{disabled:dis, label:`${p.name} trusted`, check:true, onChange:oc, redraw:r})],
        ["Port security", h("span",{class:"inl"}, fld(p.portSecurity,"enabled",{disabled:dis, check:true, label:`${p.name} port security`, onChange:oc, redraw:r}), " max ", fld(p.portSecurity,"max",{disabled:dis, num:true, label:`${p.name} max MACs`, onChange:oc}), " violation ", fld(p.portSecurity,"violation",{disabled:dis, label:`${p.name} violation`, options:[["shutdown","shutdown"],["restrict","restrict"],["protect","protect"]], onChange:oc}))],
        ["EtherChannel", h("span",{class:"inl"}, "group ", fld(p,"channel",{disabled:dis, num:true, ph:"none", label:`${p.name} channel group`, onChange:oc}), " mode ", fld(p,"lacp",{disabled:dis, label:`${p.name} channel mode`, options:[["on","on (static)"],["active","LACP active"],["passive","LACP passive"]], dflt:"on", onChange:oc, redraw:r}))]]));
  }
  function switchConfig(d, dis){
    const oc = () => changed(), r = () => drawPanel();
    const parts = [subhead("Switch settings"), kvRows([
      ["Spanning tree", h("span",{class:"inl"}, fld(d.stp,"enabled",{disabled:dis, check:true, label:"Spanning tree enabled", onChange:oc, redraw:r}), " enabled, priority ", fld(d.stp,"priority",{disabled:dis, label:"Bridge priority", options:STP_PRI, onChange:oc, redraw:r}))],
      ["DHCP snooping", fld(d,"dhcpSnooping",{disabled:dis, check:true, label:"DHCP snooping", onChange:oc, redraw:r})],
      ["Dynamic ARP Inspection", fld(d,"dai",{disabled:dis, check:true, label:"Dynamic ARP Inspection", onChange:oc, redraw:r})],
      ["PoE standard", fld(d,"poeStd",{disabled:dis, label:"PoE standard", options:[["af","802.3af (15.4 W/port)"],["at","802.3at PoE+ (30 W/port)"],["bt","802.3bt PoE++ (90 W/port)"]], onChange:oc, redraw:r})],
      ["PoE budget", fld(d,"poeBudget",{disabled:dis, label:"PoE budget", options:[[45,"45 W"],[75,"75 W"],[185,"185 W"],[370,"370 W"],[740,"740 W"]], onChange:oc, redraw:r})]])];
    parts.push(subhead("Ports"), h("div",{class:"tablewrap"}, h("table",{class:"cfg"},
      h("thead",null,h("tr",null,["Port","Connected to","Status","Mode","Access VLAN","Allowed VLANs (trunk)","Shut down",""].map(x=>h("th",null,x)))),
      h("tbody",null, d.ports.flatMap(p=>{
        const l = linkAt(net, d.id, p.name), nb = l && net.byId[l.dev], status = portStatus(net, d, p);
        const row = h("tr",{class: status==="err-disabled" || status==="suspended" ? "bad" : ""}, h("td",{class:"static"}, p.name), h("td",{class:"static"}, nb ? nb.name : "(empty)"), h("td",{class:"static"}, status),
          h("td",null, fld(p,"mode",{disabled:dis, label:`${p.name} mode`, options:[["access","Access"],["trunk","Trunk"],["dynamic","Dynamic (DTP)"]], onChange:oc, redraw:r})),
          h("td",null, fld(p,"vlan",{disabled:dis||p.mode==="trunk", label:`${p.name} access VLAN`, num:true, onChange:oc})),
          h("td",null, fld(p,"allowed",{disabled:dis||p.mode!=="trunk", label:`${p.name} allowed VLANs`, ph:"all", onChange:oc})),
          h("td",{class:"cbx"}, fld(p,"shutdown",{disabled:dis, check:true, label:`${p.name} shut down`, onChange:(k,v)=>{ if (v) p.errDisabled = false; oc(); }, redraw:r})),
          h("td",null, h("button",{type:"button", class:"mini", "aria-expanded":open[d.id+p.name]?"true":"false", onclick:()=>{ open[d.id+p.name] = !open[d.id+p.name]; drawPanel(); }}, open[d.id+p.name] ? "Less" : "More")));
        return open[d.id+p.name] ? [row, h("tr",{class:"detail"}, h("td",{colspan:8}, portDetail(d, p, dis)))] : [row];
      })))), h("p",{class:"small muted"},"Err-disabled ports recover when you shut them down and enable them again, once the cause is fixed."));
    return parts;
  }
  function routerConfig(d, dis){
    const oc = () => changed(), r = () => drawPanel();
    const aclNames = Object.keys(d.acls||{});
    const parts = [subhead(d.kind==="l3switch" ? "Routed interfaces (SVIs)" : "Interfaces"), h("div",{class:"tablewrap"}, h("table",{class:"cfg"},
      h("thead",null,h("tr",null,["Interface","802.1Q VLAN","IP address","Subnet mask","DHCP helper","Shut down",""].map(x=>h("th",null,x)))),
      h("tbody",null, d.ifaces.flatMap(i=>{
        const row = h("tr",null, h("td",{class:"static"}, i.name), h("td",{class:"static"}, i.vlan==null ? "untagged" : String(i.vlan)),
          h("td",null, fld(i,"ip",{disabled:dis, label:`${i.name} IP`, onChange:oc})), h("td",null, fld(i,"mask",{disabled:dis, label:`${i.name} mask`, onChange:oc})),
          h("td",null, fld(i,"helper",{disabled:dis, label:`${i.name} DHCP helper`, ph:"none", onChange:oc})),
          h("td",{class:"cbx"}, fld(i,"shutdown",{disabled:dis, check:true, label:`${i.name} shut down`, onChange:oc, redraw:r})),
          h("td",null, h("button",{type:"button", class:"mini", onclick:()=>{ open[d.id+i.name] = !open[d.id+i.name]; drawPanel(); }}, open[d.id+i.name] ? "Less" : "More")));
        if (!open[d.id+i.name]) return [row];
        const more = h("div",{class:"portmore"}, kvRows([
          ["NAT role", fld(i,"nat",{disabled:dis, label:`${i.name} NAT`, options:[["","None"],["inside","Inside"],["outside","Outside"]], onChange:oc, redraw:r})],
          ["Inbound ACL", fld(i,"acl",{disabled:dis, label:`${i.name} inbound ACL`, options:[["","None"],...aclNames.map(n=>[n,n])], onChange:oc, redraw:r})],
          ["Outbound ACL", fld(i,"aclOut",{disabled:dis, label:`${i.name} outbound ACL`, options:[["","None"],...aclNames.map(n=>[n,n])], onChange:oc, redraw:r})],
          ["Virtual IP (FHRP)", fld(i,"vip",{disabled:dis, label:`${i.name} virtual IP`, ph:"none", onChange:oc})],
          ["FHRP priority", fld(i,"vipPriority",{disabled:dis, num:true, label:`${i.name} FHRP priority`, ph:"100", onChange:oc})],
          ["MTU", fld(i,"mtu",{disabled:dis, label:`${i.name} MTU`, options:[[1500,"1500"],[9000,"9000"]], onChange:oc})],
          ["OSPF cost", fld(i,"ospfCost",{disabled:dis, num:true, label:`${i.name} OSPF cost`, ph:"1", onChange:oc})]]),
          Array.isArray(i.routes) ? [h("div",{class:"small muted", style:"margin-top:8px"}, `Route table for traffic arriving on ${i.name} (subnet route table)`), listEditor(i.routes, [{key:"net", label:"Destination (CIDR)"},{key:"via", label:"Next hop"}], {disabled:dis, onChange:oc, blank:{net:"0.0.0.0/0", via:""}, addLabel:"Add route"})] : null);
        return [row, h("tr",{class:"detail"}, h("td",{colspan:7}, more))];
      }))))];
    parts.push(subhead("Routing"), kvRows([["Default route next hop", fld(d,"defaultRoute",{disabled:dis, label:"Default route next hop", ph:"none", onChange:oc})]]),
      h("div",{class:"small muted", style:"margin:8px 0 4px"},"Static routes (lower administrative distance wins; use 200 for a floating backup route)"),
      listEditor(d.routes, [{key:"net", label:"Destination (CIDR)"},{key:"via", label:"Next hop"},{key:"ad", label:"Admin distance", num:true, ph:"1"}], {disabled:dis, onChange:oc, blank:{net:"", via:""}, addLabel:"Add static route", empty:"No static routes"}));
    d.ospf = d.ospf || {enabled:false, area:0, passive:[]};
    parts.push(kvRows([["OSPF", h("span",{class:"inl"}, fld(d.ospf,"enabled",{disabled:dis, check:true, label:"OSPF enabled", onChange:oc, redraw:r}), " enabled, area ", fld(d.ospf,"area",{disabled:dis, num:true, label:"OSPF area", onChange:oc}))],["Passive interfaces", fld(d.ospf,"passive",{disabled:dis, list:true, label:"OSPF passive interfaces", ph:"none", onChange:oc})]]));
    const aclBox = h("div");
    const drawAcls = () => {
      put(aclBox, subhead("Access control lists (read top-down, first match wins, implicit deny at the end)"),
        ...Object.keys(d.acls).map(n=>h("div",{class:"scope"}, h("div",{class:"row", style:"justify-content:space-between"}, h("b",null, n), dis ? null : h("button",{type:"button", class:"btn ghost small danger", onclick:()=>{ delete d.acls[n]; d.ifaces.forEach(i=>{ if (i.acl===n) i.acl=""; if (i.aclOut===n) i.aclOut=""; }); oc(); drawPanel(); }},"Delete list")),
          listEditor(d.acls[n], [{key:"action", label:"Action", options:[["permit","permit"],["deny","deny"]]},{key:"proto", label:"Protocol", options:[["ip","ip"],["icmp","icmp"],["tcp","tcp"],["udp","udp"]]},{key:"src", label:"Source"},{key:"dst", label:"Destination"},{key:"port", label:"Dst port"}], {disabled:dis, ordered:true, onChange:oc, blank:{action:"permit", proto:"ip", src:"any", dst:"any", port:"any"}, addLabel:"Add rule"}))),
        dis ? null : h("div",{class:"row", style:"margin-top:8px"}, h("input",{type:"text", placeholder:"New list name, e.g. BLOCK_GUESTS", "aria-label":"New ACL name", id:"newacl-"+d.id}), h("button",{type:"button", class:"btn small", onclick:()=>{ const v = (document.getElementById("newacl-"+d.id).value||"").trim().toUpperCase().replace(/\s+/g,"_"); if (v && !d.acls[v]){ d.acls[v] = [{action:"permit", proto:"ip", src:"any", dst:"any", port:"any"}]; drawPanel(); } }},"Create list")));
    };
    drawAcls(); parts.push(details("Access control lists", [aclBox], "acl-"+d.id));
    return parts;
  }
  function configView(d){
    const dis = locked || d.editable===false;
    if (d.kind==="cloud") return [h("p",{class:"small"}, `This represents the internet and your ISP. Its address on your WAN link is ${d.ip}. Public IP addresses are reachable through it, but only from public or translated (NAT) sources.`)];
    if (isHost(d)) return hostConfig(d, dis);
    const out = [];
    if (isSwitch(d)) out.push(...switchConfig(d, dis));
    if (isRouterLike(d)) out.push(...routerConfig(d, dis));
    return out;
  }
  function termView(d){
    if (!terms[d.id]){
      const out = h("pre",{class:"out", tabindex:"0","aria-label":`${d.name} terminal output`});
      out.append(h("span",{class:"dim"}, (isHost(d) ? (d.os==="linux" ? `${d.name.toLowerCase()} login: admin\nLinux ${d.name.toLowerCase()} 6.8.0 x86_64\n` : "Microsoft Windows [Version 10.0.22631]\n") : `${d.name} console\n`) + "Type help to see available commands.\n"));
      terms[d.id] = {out, hist:[], hi:0};
    }
    const T = terms[d.id], ps = isHost(d) ? (d.os==="linux" ? `admin@${d.name.toLowerCase()}:~$` : "C:\\Users\\tech>") : d.name+"#";
    const input = h("input",{type:"text","aria-label":`${d.name} command`, autocomplete:"off", autocapitalize:"off", spellcheck:"false", enterkeyhint:"go"});
    input.addEventListener("keydown", e=>{
      if (e.key==="Enter"){
        e.preventDefault(); const raw = input.value.trim(); input.value = ""; if (!raw) return;
        T.hist.push(raw); T.hi = T.hist.length;
        if (/^(cls|clear)$/i.test(raw)){ put(T.out); return; }
        net = fresh();
        const res = runCommand(net, net.byId[d.id], raw);
        T.out.append(h("span",{class:"cmd"}, ps+" "+raw+"\n"), document.createTextNode(res+"\n\n"));
        T.out.scrollTop = T.out.scrollHeight;
      } else if (e.key==="ArrowUp" && T.hist.length){ e.preventDefault(); T.hi=Math.max(0,T.hi-1); input.value=T.hist[T.hi]; }
      else if (e.key==="ArrowDown" && T.hist.length){ e.preventDefault(); T.hi=Math.min(T.hist.length,T.hi+1); input.value=T.hist[T.hi]||""; }
    });
    setTimeout(()=>{ T.out.scrollTop = T.out.scrollHeight; }, 0);
    const quick = (isHost(d) ? (d.os==="linux" ? ["ip addr","ip route","ping -c 4 ","dig ","cat /etc/resolv.conf"] : ["ipconfig /all","ping ","tracert ","nslookup ","arp -a"]) : isSwitch(d) ? ["show vlan brief","show interfaces status","show interfaces trunk","show spanning-tree","show logging"] : ["show ip interface brief","show ip route","show running-config","show access-lists","show logging"]);
    return h("div",null, h("div",{class:"term"}, T.out, h("label",{class:"line"}, h("span",{class:"ps"}, ps), input)),
      h("div",{class:"chips"}, quick.map(c=>h("button",{type:"button", class:"chip small", onclick:()=>{ input.value = c; input.focus(); if (!c.endsWith(" ")) input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"})); }}, c))));
  }
  function drawPanel(){
    const d = devices.find(x=>x.id===sel);
    const hasTerm = !["cloud","printer","phone","ap"].includes(d.kind);
    if (!hasTerm) tab = "config";
    const tabs = h("div",{class:"dtabs", role:"tablist"},
      h("button",{class:"tab", role:"tab", type:"button","aria-selected":tab==="config"?"true":"false", onclick:()=>{tab="config"; drawPanel();}}, d.kind==="cloud" ? "Details" : "Configure"),
      hasTerm ? h("button",{class:"tab", role:"tab", type:"button","aria-selected":tab==="term"?"true":"false", onclick:()=>{tab="term"; drawPanel(); const i=panel.querySelector(".term input"); if (i) i.focus();}}, "Terminal") : null);
    put(panel, 
      h("div",{class:"dhead"}, h("h3",null, d.name), h("span",{class:"small muted"}, (KIND_NAME[d.kind]||d.kind) + (d.editable===false && d.kind!=="cloud" ? ", locked for this lab" : "") + (d._off ? ", no power" : ""))),
      tabs, ...(tab==="term" && hasTerm ? [termView(d)] : configView(d)));
  }
  drawTopo(); drawPanel();
  const hints = opts.exam ? null : hintWidget(()=>simHints(t, devices, links));
  const el = h("div",{class:"sim"},
    subhead("Requirements"), h("ul",{class:"goals"}, goalItems), hints ? hints.el : null,
    svgWrap, h("div",{class:"legend small muted"}, h("span",{class:"lg ok"},"up"), h("span",{class:"lg warn"},"errors"), h("span",{class:"lg blocked"},"STP blocked"), h("span",{class:"lg down"},"down")),
    h("div",{class:"row", style:"justify-content:space-between"}, h("p",{class:"hint", style:"margin:0"},"Tap a device to configure it or open its terminal."), resetBtn),
    panel, solBox);
  return {el, grade(){
    locked = true; resetBtn.disabled = true; if (hints){ hints.lock(); this.hintsUsed = hints.used; }
    net = fresh();
    const res = t.goals.map(g=>evalGoal(net, g)); this.results = res;
    res.forEach((r,i)=>{ goalItems[i].className = r.pass ? "ok" : "no"; goalItems[i].querySelector(".gwhy").textContent = r.pass ? "" : ": " + r.why; });
    drawTopo(); drawPanel();
    const sol = solutionText(t);
    put(solBox, h("div",{class:"explain"}, h("b",null,"One configuration that works"), h("ul",{style:"margin:4px 0 0;padding-left:20px"}, sol.map(s=>h("li",null,s))), opts.exam ? null : aiExplainButton(()=>simContext(lab, t, res, sol))));
    this.hits = []; this.misses = [];
    t.goals.forEach((g,i)=>{ const key = "n:"+g.label;
      if (res[i].pass) this.hits.push(key);
      else this.misses.push({key, context:true, front:`Network sim: "${g.label}" failed. What was wrong, and what fixes it?`, back:`Symptom: ${res[i].why}.\nFix: ${sol.join("; ")}`}); });
    return res.filter(r=>r.pass).length / res.length;
  }};
}
