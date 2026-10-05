/* Network Lab Bench simulation engine: terminals. MIT License. */

"use strict";
const longIf = s => String(s).replace(/^gi(?=\d)/i,"GigabitEthernet").replace(/^fa(?=\d)/i,"FastEthernet").replace(/^te(?=\d)/i,"TenGigabitEthernet").replace(/^po(?=\d)/i,"Port-channel");
const shortIf = s => String(s).replace(/^gigabitethernet/i,"Gi").replace(/^fastethernet/i,"Fa").replace(/^tengigabitethernet/i,"Te");
const pad = (s,n) => String(s).padEnd(n);
const TTL0 = d => d.kind==="cloud" ? 117 : isRouterLike(d) ? 255 : d.os==="linux" || d.kind==="printer" || d.kind==="phone" || d.kind==="ap" ? 64 : 128;
function pingStats(r, n){
  if (!r.ok) return 0;
  const loss = r.m ? r.m.loss : 0;
  if (loss<=0) return n;
  return Math.max(0, Math.min(n-1, Math.round(n*(1-loss))));
}
function rtt(r){ const base = r.m ? r.m.lat : 0; return Math.max(0, Math.round(base + (r.ep && r.ep.internet ? 14 : r.hops && r.hops.length ? 1 : 0))); }
function parseArgs(raw){ return raw.trim().split(/\s+/).slice(1); }
function targetOf(net, src, name){
  let ip = ipToInt(name);
  if (ip!=null) return {ip, label:name};
  const r = resolveName(net, src, name);
  if (!r.ok || r.ip==null) return {err:r};
  return {ip:r.ip, label:`${name} [${intToIp(r.ip)}]`};
}
/* ---------- Windows ---------- */
function winPing(net, d, raw){
  const a = parseArgs(raw); let n = 4, size = 32, df = false, target = null;
  for (let i=0;i<a.length;i++){ const x = a[i].toLowerCase(); if (x==="-n") n = Math.min(10, Number(a[++i])||4); else if (x==="-l") size = Number(a[++i])||32; else if (x==="-f") df = true; else if (x==="-t") n = 6; else if (!x.startsWith("-")) target = a[i]; }
  if (!target) return "\nUsage: ping [-n count] [-l size] [-f] target_name";
  const t = targetOf(net, d, target);
  if (t.err) return `Ping request could not find host ${target}. Please check the name and try again.`;
  const r = hostPing(net, d, t.ip, {size, df});
  const head = `\nPinging ${t.label} with ${size} bytes of data:\n`;
  const stats = rx => `\n\nPing statistics for ${intToIp(t.ip)}:\n    Packets: Sent = ${n}, Received = ${rx}, Lost = ${n-rx} (${Math.round((n-rx)/n*100)}% loss),`;
  if (r.ok){
    const rx = pingStats(r, n), ms = rtt(r), jit = r.m ? r.m.jitter||0 : 0;
    const ttl = TTL0(r.ep.dev) - r.hops.length + (isRouterLike(r.ep.dev) && r.hops.length ? 1 : 0);
    const lines = []; let got = 0; const lostIdx = new Set(); for (let i=1; lostIdx.size < n-rx && i<n*2; i+=2) lostIdx.add(i % n);
    for (let i=0;i<n;i++){
      if (lostIdx.has(i)){ lines.push("Request timed out."); continue; }
      const t2 = Math.max(0, ms + (jit ? ((i*37)%(2*jit+1))-jit : 0));
      lines.push(`Reply from ${intToIp(t.ip)}: bytes=${Math.min(size, 65500)} time${t2<1?"<1":"="+t2}ms TTL=${ttl}`); got++;
    }
    return head + lines.join("\n") + stats(got) + (got ? `\nApproximate round trip times in milli-seconds:\n    Minimum = ${Math.max(0,ms-jit)}ms, Maximum = ${ms+jit}ms, Average = ${ms}ms` : "");
  }
  if (r.code==="frag") return head + Array(n).fill("Packet needs to be fragmented but DF set.").join("\n") + stats(0);
  if (r.code==="general") return head + Array(n).fill("PING: transmit failed. General failure.").join("\n") + stats(0);
  if (r.code==="hostunreach") return head + Array(n).fill(`Reply from ${intToIp(r.srcIp)}: Destination host unreachable.`).join("\n") + stats(n);
  if (r.code==="netunreach" && r.at!=null) return head + Array(n).fill(`Reply from ${intToIp(r.at)}: Destination net unreachable.`).join("\n") + stats(n);
  if (r.code==="ttl" && r.hops.length) return head + Array(n).fill(`Reply from ${intToIp(r.hops.at(-1))}: TTL expired in transit.`).join("\n") + stats(n);
  if (r.code==="acl" && r.at!=null) return head + Array(n).fill(`Reply from ${intToIp(r.at)}: Destination net unreachable.`).join("\n") + stats(n);
  return head + Array(n).fill("Request timed out.").join("\n") + stats(0);
}
function traceLines(net, d, ip, style){
  const r = hostPing(net, d, ip);
  const out = []; let n = 1;
  const row = (addr, ms) => style==="linux" ? ` ${String(n++).padStart(2)}  ${addr} (${addr})  ${ms} ms  ${ms} ms  ${ms} ms` : `  ${String(n++).padStart(2)}    ${ms<1?"<1":ms} ms    ${ms<1?"<1":ms} ms    ${ms<1?"<1":ms} ms  ${addr}`;
  const star = () => style==="linux" ? ` ${String(n++).padStart(2)}  * * *` : `  ${String(n++).padStart(2)}     *        *        *     Request timed out.`;
  if (r.code==="general") return null;
  const hops = r.hops || [];
  const shown = r.ok && isRouterLike(r.ep.dev) && hops.length ? hops.slice(0,-1) : hops;
  if (r.code==="ttl"){ for (let k=0;k<6;k++) out.push(row(intToIp(hops[k%Math.max(1,hops.length)]||0), k+1)); out.push(star()); return out; }
  shown.forEach((h,i)=>out.push(row(intToIp(h), i===0 ? 0 : 2+i*3)));
  if (r.ok) out.push(row(intToIp(ip), r.ep.internet ? 14 : 1));
  else for (let k=0;k<3;k++) out.push(star());
  return out;
}
function winTracert(net, d, raw){
  const target = parseArgs(raw).filter(x=>!x.startsWith("-")).pop();
  if (!target) return "\nUsage: tracert target_name";
  const t = targetOf(net, d, target);
  if (t.err) return `Unable to resolve target system name ${target}.`;
  const lines = traceLines(net, d, t.ip, "win");
  if (!lines) return "Unable to contact IP driver. General failure.";
  return `\nTracing route to ${t.label}\nover a maximum of 30 hops\n\n${lines.join("\n")}\n\nTrace complete.`;
}
function nslookupOut(net, d, raw, linux){
  const a = parseArgs(raw); let type = "A", name = null, server = null;
  for (const x of a){ const m = x.match(/^-(?:type|q|querytype)=(\w+)/i); if (m) type = m[1].toUpperCase(); else if (!name) name = x; else server = x; }
  if (!name) return "Usage: nslookup [-type=A|AAAA|MX|CNAME|NS|TXT|PTR] name [server]";
  const c = hostCfg(net, d);
  const sip = server ? ipToInt(server) : (c.ok ? c.dns : null);
  if (sip==null) return "*** Default servers are not available\nServer:  UnKnown\nAddress:  127.0.0.1\n\n*** UnKnown can't find "+name+": No response from server";
  const r = resolveName(net, d, name, type, sip);
  if (r.timeout) return `DNS request timed out.\n    timeout was 2 seconds.\nServer:  UnKnown\nAddress:  ${intToIp(sip)}\n\nDNS request timed out.\n    timeout was 2 seconds.\n*** Request to UnKnown timed-out`;
  const head = `Server:  ${r.serverName||"UnKnown"}\nAddress:  ${intToIp(sip)}\n\n`;
  if (!r.ok) return head + (r.servfail ? `*** ${r.serverName} can't find ${name}: Server failed` : `*** ${r.serverName||"UnKnown"} can't find ${name}: Non-existent domain`);
  const q = ipToInt(name)!=null ? ptrName(ipToInt(name)) : name;
  let body = r.nonAuth ? "Non-authoritative answer:\n" : "";
  const types = r.answers.map(x=>x.type);
  if (types[0]==="MX") body += r.answers.map(x=>`${q}\tMX preference = ${x.value.split(" ")[0]}, mail exchanger = ${x.value.split(" ").slice(1).join(" ")||x.value}`).join("\n");
  else if (types[0]==="PTR") body += r.answers.map(x=>`${q}\tname = ${x.value}`).join("\n");
  else if (types[0]==="TXT") body += r.answers.map(x=>`${q}\ttext =\n\n\t"${x.value}"`).join("\n");
  else if (types[0]==="NS") body += r.answers.map(x=>`${q}\tnameserver = ${x.value}`).join("\n");
  else if (types[0]==="CNAME") body += `${q}\tcanonical name = ${r.answers[0].value}`;
  else body += `Name:    ${r.chain && r.chain.length ? r.chain.at(-1).value : q}\n${r.answers.length>1?"Addresses":"Address"}:  ${r.answers.map(x=>x.value).join("\n          ")}` + (r.chain && r.chain.length ? `\nAliases:  ${q}` : "");
  return head + body;
}
function winIpconfig(net, d, all){
  const c = hostCfg(net, d);
  const L = (k,v) => `   ${(k+" ").padEnd(34,". ").slice(0,34).trimEnd()} : ${v}`;
  let s = "\nWindows IP Configuration\n\n";
  if (all) s += L("Host Name", d.name) + "\n\n";
  s += "Ethernet adapter Ethernet:\n\n";
  const p = hostPort(net, d); const li = p ? linkIndex(net, d.id, p) : -1;
  if (li<0 || !net.links[li].st.up) return s + L("Media State","Media disconnected");
  if (all) s += L("Physical Address", winMac(macOf(d)).toUpperCase()) + "\n" + L("DHCP Enabled", d.mode==="dhcp"?"Yes":"No") + "\n";
  if (!c.ok){ s += L("IPv4 Address", "(not configured)") + "\n"; return s; }
  s += L(c.apipa ? "Autoconfiguration IPv4 Address" : "IPv4 Address", intToIp(c.ip) + (all ? (c.conflict ? "(Duplicate)" : "(Preferred)") : "")) + "\n";
  s += L("Subnet Mask", intToIp(mInt(c.n))) + "\n";
  s += L("Default Gateway", c.gw!=null ? intToIp(c.gw) : "") + "\n";
  if (all){
    if (c.dhcp && !c.apipa) s += L("DHCP Server", c.server||"") + "\n" + L("Lease Obtained", "Today") + "\n";
    s += L("DNS Servers", c.dns!=null ? intToIp(c.dns) : "") + "\n";
  }
  return s;
}
function arpEntries(net, d){
  const c = hostCfg(net, d); if (!c.ok) return [];
  const dom = hostDomain(net, d); const out = [];
  const add = ip => { const f = findIp(net, dom, ip, d.id); if (f.ep){ let mac = f.ep.iface && f.ep.iface.vip && ipToInt(f.ep.iface.vip)===ip ? "00:00:0c:07:ac:01" : macOf(f.ep.dev); const sp = arpSpoofer(net, d); if (sp && ip===c.gw) mac = macOf(sp); out.push({ip, mac}); } };
  if (c.gw!=null && inNet(c.gw, c.ip, c.n)) add(c.gw);
  if (c.dns!=null && inNet(c.dns, c.ip, c.n)) add(c.dns);
  for (const e of dom) if (isHost(e.dev)){ const ec = hostCfg(net, e.dev); if (ec.ok && inNet(ec.ip, c.ip, c.n) && out.length<6 && !out.some(x=>x.ip===ec.ip)) out.push({ip:ec.ip, mac:macOf(e.dev)}); }
  const sp = arpSpoofer(net, d); if (sp){ const sc = hostCfg(net, sp); if (sc.ok && !out.some(x=>x.ip===sc.ip)) out.push({ip:sc.ip, mac:macOf(sp)}); }
  return out;
}
function winArp(net, d){
  const c = hostCfg(net, d); if (!c.ok) return "No ARP Entries Found.";
  const e = arpEntries(net, d);
  return `\nInterface: ${intToIp(c.ip)} --- 0x7\n  Internet Address      Physical Address      Type\n` + e.map(x=>`  ${pad(intToIp(x.ip),22)}${pad(winMac(x.mac),22)}dynamic`).join("\n") + `\n  ${pad(intToIp(bcastOf(c.ip,c.n)),22)}${pad("ff-ff-ff-ff-ff-ff",22)}static`;
}
function routePrint(net, d){
  const c = hostCfg(net, d); if (!c.ok) return "No IPv4 routes configured.";
  const net0 = intToIp(netOf(c.ip,c.n)), mask = intToIp(mInt(c.n));
  return `===========================================================================\nIPv4 Route Table\n===========================================================================\nActive Routes:\nNetwork Destination        Netmask          Gateway       Interface  Metric\n` +
    (c.gw!=null ? `          0.0.0.0          0.0.0.0  ${pad(intToIp(c.gw),14)}${pad(intToIp(c.ip),15)}25\n` : "") +
    `  ${pad(net0,25)}${pad(mask,17)}${pad("On-link",14)}${pad(intToIp(c.ip),15)}281\n  ${pad(intToIp(c.ip),25)}${pad("255.255.255.255",17)}${pad("On-link",14)}${pad(intToIp(c.ip),15)}281\n        127.0.0.0        255.0.0.0         On-link     127.0.0.1    331\n===========================================================================`;
}
function netstatOut(net, d, linux){
  const sv = (d.services||[]).map(s=>s.split("/"));
  if (linux) return "Netid  State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port\n" + sv.map(([p,n])=>`${pad(p,7)}${pad(p==="tcp"?"LISTEN":"UNCONN",8)}0       ${pad(p==="tcp"?128:0,9)}0.0.0.0:${pad(n,15)}0.0.0.0:*`).join("\n");
  return "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State\n" + sv.map(([p,n])=>`  ${pad(p.toUpperCase(),7)}${pad("0.0.0.0:"+n,23)}${pad(p==="tcp"?"0.0.0.0:0":"*:*",23)}${p==="tcp"?"LISTENING":""}`).join("\n");
}
function connTest(net, d, host, port, style){
  const t = targetOf(net, d, host);
  if (t.err) return style==="win" ? `WARNING: Name resolution of ${host} failed` : `nc: getaddrinfo for host "${host}" port ${port}: Name or service not known`;
  const r = hostConn(net, d, t.ip, "tcp", Number(port));
  if (style==="win") return `\nComputerName     : ${host}\nRemoteAddress    : ${intToIp(t.ip)}\nRemotePort       : ${port}\nSourceAddress    : ${r.srcIp!=null?intToIp(r.srcIp):""}\nTcpTestSucceeded : ${r.ok?"True":"False"}` + (r.ok ? "" : `\n\nWARNING: TCP connect to (${intToIp(t.ip)} : ${port}) failed`);
  return r.ok ? `Connection to ${host} ${port} port [tcp/*] succeeded!` : r.code==="refused" ? `nc: connect to ${host} port ${port} (tcp) failed: Connection refused` : `nc: connect to ${host} port ${port} (tcp) timed out: Operation now in progress`;
}
function nmapOut(net, d, raw){
  const target = parseArgs(raw).filter(x=>!x.startsWith("-")).pop();
  if (!target) return "Usage: nmap <target>";
  const t = targetOf(net, d, target); if (t.err) return `Failed to resolve "${target}".`;
  const ping = hostPing(net, d, t.ip);
  const dst = net.devs.find(x=>isHost(x) && hostCfg(net,x).ok && hostCfg(net,x).ip===t.ip);
  const common = [[21,"ftp"],[22,"ssh"],[23,"telnet"],[25,"smtp"],[53,"domain"],[80,"http"],[110,"pop3"],[143,"imap"],[443,"https"],[445,"microsoft-ds"],[1433,"ms-sql-s"],[3306,"mysql"],[3389,"ms-wbt-server"],[8080,"http-proxy"]];
  const rows = [];
  for (const [p,name] of common){ const r = hostConn(net, d, t.ip, "tcp", p); if (r.ok) rows.push(`${pad(p+"/tcp",9)}open     ${name}`); else if (r.code==="filtered" || r.code==="acl") rows.push(`${pad(p+"/tcp",9)}filtered ${name}`); }
  const head = `Starting Nmap 7.94 ( https://nmap.org )\nNmap scan report for ${t.label}\n`;
  if (!ping.ok && !rows.length) return head + "Note: Host seems down. If it is really up, but blocking our ping probes, try -Pn";
  return head + `Host is up (0.0${Math.max(1,rtt(ping))}s latency).\nNot shown: ${common.length-rows.length} closed tcp ports (reset)\nPORT     STATE    SERVICE\n` + rows.join("\n") + (dst ? `\nMAC Address: ${macOf(dst).toUpperCase()}` : "");
}
function tcpdumpOut(net, d){
  const c = hostCfg(net, d); const iface = d.os==="linux" ? "eth0" : "Ethernet";
  let s = `tcpdump: verbose output suppressed, use -v for full protocol decode\nlistening on ${iface}, link-type EN10MB (Ethernet), snapshot length 262144 bytes\n`;
  const T = k => `10:42:0${k}.${String(100000+k*13379).slice(1)}`;
  if (d.mode==="dhcp" && (!c.ok || c.apipa)) return s + [0,1,2,3].map(k=>`${T(k)} IP 0.0.0.0.68 > 255.255.255.255.67: BOOTP/DHCP, Request from ${macOf(d)}, length 300`).join("\n") + "\n4 packets captured (DHCP DISCOVER sent, no OFFER received)";
  if (!c.ok) return s + "0 packets captured";
  const lines = [];
  if (c.gw!=null){ const r = findIp(net, hostDomain(net, d), c.gw, d.id);
    lines.push(`${T(1)} ARP, Request who-has ${intToIp(c.gw)} tell ${intToIp(c.ip)}, length 28`);
    if (r.ep) lines.push(`${T(1)} ARP, Reply ${intToIp(c.gw)} is-at ${macOf(arpSpoofer(net,d) || r.ep.dev)}, length 46`); else lines.push(`${T(2)} ARP, Request who-has ${intToIp(c.gw)} tell ${intToIp(c.ip)}, length 28`);
    const sp = arpSpoofer(net, d); if (sp) lines.push(`${T(3)} ARP, Reply ${intToIp(c.gw)} is-at ${macOf(sp)}, length 46 (unsolicited, repeated every 2s)`);
  }
  if (c.dns!=null){ const r = resolveName(net, d, "example.com");
    lines.push(`${T(4)} IP ${intToIp(c.ip)}.53122 > ${intToIp(c.dns)}.53: 1+ A? example.com. (29)`);
    if (r.ok) lines.push(`${T(5)} IP ${intToIp(c.dns)}.53 > ${intToIp(c.ip)}.53122: 1 1/0/0 A ${r.answers[0].value} (45)`);
  }
  return s + lines.join("\n") + `\n${lines.length} packets captured`;
}
function curlOut(net, d, raw){
  const u = parseArgs(raw).find(x=>/^https?:/i.test(x)) || "";
  const m = u.match(/^(https?):\/\/([^/:]+)(?::(\d+))?/i);
  if (!m) return "curl: (3) URL rejected: Malformed input to a URL function";
  const port = Number(m[3] || (m[1].toLowerCase()==="https" ? 443 : 80));
  const t = targetOf(net, d, m[2]); if (t.err) return `curl: (6) Could not resolve host: ${m[2]}`;
  const r = hostConn(net, d, t.ip, "tcp", port);
  return r.ok ? `HTTP/1.1 200 OK\nServer: ${m[2]}\nContent-Type: text/html` : r.code==="refused" ? `curl: (7) Failed to connect to ${m[2]} port ${port}: Connection refused` : `curl: (28) Failed to connect to ${m[2]} port ${port}: Connection timed out`;
}
function hostsFile(d, linux){
  const e = Object.entries(d.hosts||{});
  return (linux ? "127.0.0.1\tlocalhost\n" : "# Copyright (c) 1993-2009 Microsoft Corp.\n#\n# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.\n#\n#\t127.0.0.1       localhost\n") + e.map(([k,v])=>`${v}\t${k}`).join("\n");
}
function hostCmd(net, d, raw){
  if (d.os==="linux") return linuxCmd(net, d, raw);
  const n = cn(raw), first = n.split(" ")[0];
  if (n==="help" || n==="?") return "Commands: ipconfig [/all|/renew|/release|/flushdns], ping [-n N] [-l size] [-f] <host>, tracert <host>, nslookup [-type=X] <name> [server], arp -a, route print, netstat -an, Test-NetConnection <host> -Port <n>, nmap <host>, type hosts, hostname, getmac, cls";
  if (n==="hostname") return d.name;
  if (n==="getmac") return `\nPhysical Address    Transport Name\n=================== ==========================================================\n${winMac(macOf(d)).toUpperCase()}   \\Device\\Tcpip_{4D36E972}`;
  if (n==="ipconfig") return winIpconfig(net, d, false);
  if (n==="ipconfig /all") return winIpconfig(net, d, true);
  if (n==="ipconfig /renew"){
    if (d.mode!=="dhcp") return "\nWindows IP Configuration\n\nThe operation failed as no adapter is in the state permissible for\nthis operation.";
    const c = hostCfg(net, d);
    return c.apipa ? "\nWindows IP Configuration\n\nAn error occurred while renewing interface Ethernet : unable to contact your DHCP server. Request has timed out." : winIpconfig(net, d, false);
  }
  if (n==="ipconfig /release") return d.mode!=="dhcp" ? "\nWindows IP Configuration\n\nThe operation failed as no adapter is in the state permissible for\nthis operation." : "\nWindows IP Configuration\n\nEthernet adapter Ethernet:\n\n   (Lease released. Run ipconfig /renew to request a new one.)";
  if (n==="ipconfig /flushdns") return "\nWindows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.";
  if (first==="ping") return winPing(net, d, raw);
  if (first==="tracert") return winTracert(net, d, raw);
  if (first==="nslookup") return nslookupOut(net, d, raw);
  if (n==="arp -a" || n==="arp -g") return winArp(net, d);
  if (n==="route print" || n==="netstat -r") return routePrint(net, d);
  if (/^netstat( -an| -ano| -a)?$/.test(n)) return netstatOut(net, d);
  if (first==="test-netconnection" || first==="tnc"){ const a = parseArgs(raw); const pi = a.findIndex(x=>/^-port$/i.test(x)); return pi>=0 ? connTest(net, d, a[0], a[pi+1], "win") : winPing(net, d, "ping "+a[0]); }
  if (first==="nmap") return nmapOut(net, d, raw);
  if (/^type .*hosts$/.test(n) || n==="type hosts") return hostsFile(d, false);
  if (first==="curl" || first==="iwr") return curlOut(net, d, raw);
  return `'${raw.trim().split(/\s+/)[0]}' is not recognized in this lab. Type help to see what's available.`;
}
/* ---------- Linux ---------- */
function linuxCmd(net, d, raw){
  const n = cn(raw), a = parseArgs(raw), first = n.split(" ")[0];
  const c = hostCfg(net, d);
  if (n==="help") return "Commands: ip addr, ip route, ip neigh, ifconfig, ping [-c N] [-s size] [-M do] <host>, traceroute <host>, dig [@server] <name> [type], nslookup, host <name>, cat /etc/resolv.conf, cat /etc/hosts, ss -tuln, netstat -tuln, nc -zv <host> <port>, curl <url>, tcpdump, nmap <host>, hostname, clear";
  if (n==="hostname") return d.name.toLowerCase();
  if (n==="ip addr" || n==="ip a" || n==="ip address" || n==="ip addr show"){
    const up = c.ok; return `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu ${d.nic.mtu||1500} qdisc fq_codel state UP\n    link/ether ${macOf(d)} brd ff:ff:ff:ff:ff:ff` + (up ? `\n    inet ${intToIp(c.ip)}/${c.n} brd ${intToIp(bcastOf(c.ip,c.n))} scope global ${c.dhcp?"dynamic ":""}eth0` : "");
  }
  if (n==="ifconfig") return c.ok ? `eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu ${d.nic.mtu||1500}\n        inet ${intToIp(c.ip)}  netmask ${intToIp(mInt(c.n))}  broadcast ${intToIp(bcastOf(c.ip,c.n))}\n        ether ${macOf(d)}  txqueuelen 1000  (Ethernet)` : `eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        ether ${macOf(d)}  txqueuelen 1000  (Ethernet)`;
  if (n==="ip route" || n==="ip r" || n==="route -n") return c.ok ? (c.gw!=null ? `default via ${intToIp(c.gw)} dev eth0 proto ${c.dhcp?"dhcp":"static"}\n` : "") + `${intToIp(netOf(c.ip,c.n))}/${c.n} dev eth0 proto kernel scope link src ${intToIp(c.ip)}` : "";
  if (n==="ip neigh" || n==="arp -n" || n==="arp -a") return arpEntries(net, d).map(x=>`${intToIp(x.ip)} dev eth0 lladdr ${x.mac} REACHABLE`).join("\n");
  if (n==="cat /etc/resolv.conf") return c.ok && c.dns!=null ? `# Generated by NetworkManager\nnameserver ${intToIp(c.dns)}` : "# Generated by NetworkManager";
  if (n==="cat /etc/hosts") return hostsFile(d, true);
  if (/^(ss|netstat) -tul?n?p?$/.test(n) || n==="ss -tuln" || n==="netstat -tuln") return netstatOut(net, d, true);
  if (first==="ping"){
    let cnt = 4, size = 56, df = false, target = null;
    for (let i=0;i<a.length;i++){ if (a[i]==="-c") cnt = Math.min(10, Number(a[++i])||4); else if (a[i]==="-s") size = Number(a[++i])||56; else if (a[i]==="-M"){ df = a[++i]==="do"; } else if (!a[i].startsWith("-")) target = a[i]; }
    if (!target) return "ping: usage error: Destination address required";
    const t = targetOf(net, d, target); if (t.err) return `ping: ${target}: Temporary failure in name resolution`;
    const r = hostPing(net, d, t.ip, {size, df});
    let s = `PING ${target} (${intToIp(t.ip)}) ${size}(${size+28}) bytes of data.\n`;
    if (r.ok){ const rx = pingStats(r, cnt), ms = rtt(r); for (let i=0;i<rx;i++) s += `${size+8} bytes from ${intToIp(t.ip)}: icmp_seq=${i+1} ttl=${TTL0(r.ep.dev)-r.hops.length+(isRouterLike(r.ep.dev)&&r.hops.length?1:0)} time=${ms||0.4} ms\n`;
      return s + `\n--- ${target} ping statistics ---\n${cnt} packets transmitted, ${rx} received, ${Math.round((cnt-rx)/cnt*100)}% packet loss`; }
    if (r.code==="frag") return s + `ping: local error: message too long, mtu=${r.m.mtu}`;
    if (r.code==="general") return "ping: connect: Network is unreachable";
    if (r.code==="hostunreach") return s + Array(3).fill(0).map((_,i)=>`From ${intToIp(r.srcIp)} icmp_seq=${i+1} Destination Host Unreachable`).join("\n") + `\n\n--- ${target} ping statistics ---\n${cnt} packets transmitted, 0 received, +3 errors, 100% packet loss`;
    if (r.code==="netunreach" && r.at!=null) return s + `From ${intToIp(r.at)} icmp_seq=1 Destination Net Unreachable\n\n--- ${target} ping statistics ---\n${cnt} packets transmitted, 0 received, +1 errors, 100% packet loss`;
    return s + `\n--- ${target} ping statistics ---\n${cnt} packets transmitted, 0 received, 100% packet loss`;
  }
  if (first==="traceroute" || first==="tracepath"){
    const target = a.filter(x=>!x.startsWith("-")).pop(); if (!target) return "Usage: traceroute host";
    const t = targetOf(net, d, target); if (t.err) return `${target}: Name or service not known`;
    const lines = traceLines(net, d, t.ip, "linux"); if (!lines) return "connect: Network is unreachable";
    return `traceroute to ${target} (${intToIp(t.ip)}), 30 hops max, 60 byte packets\n` + lines.join("\n");
  }
  if (first==="dig" || first==="host" || first==="nslookup"){
    if (first==="nslookup") return nslookupOut(net, d, raw, true);
    let server = null, name = null, type = "A";
    for (const x of a){ if (x.startsWith("@")) server = ipToInt(x.slice(1)); else if (/^(a|aaaa|mx|cname|ns|txt|ptr|soa)$/i.test(x)) type = x.toUpperCase(); else if (x==="-x") type = "PTR"; else if (!x.startsWith("+")) name = x; }
    if (!name) return first==="host" ? "Usage: host name" : "; <<>> DiG 9.18 <<>>\n;; global options: +cmd\n;; Got answer: root servers (try dig <name>)";
    const r = resolveName(net, d, name, type, server);
    if (first==="host") return r.ok ? r.answers.map(x=>x.type==="MX" ? `${name} mail is handled by ${x.value}` : x.type==="PTR" ? `${name} domain name pointer ${x.value}.` : `${name} has address ${x.value}`).join("\n") : r.timeout ? `;; connection timed out; no servers could be reached` : `Host ${name} not found: 3(NXDOMAIN)`;
    if (r.timeout || r.noServer) return `; <<>> DiG 9.18 <<>> ${name}\n;; global options: +cmd\n;; connection timed out; no servers could be reached`;
    const status = r.ok ? "NOERROR" : r.servfail ? "SERVFAIL" : "NXDOMAIN";
    const q = r.ok && type==="PTR" ? ptrName(ipToInt(name)) : name;
    return `; <<>> DiG 9.18 <<>> ${name}${type!=="A"?" "+type:""}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: 4211\n;; flags: qr rd ra${r.ok && !r.nonAuth ? " aa" : ""}; QUERY: 1, ANSWER: ${r.ok?r.answers.length+(r.chain||[]).length:0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;${q}.\t\t\tIN\t${type}\n` +
      (r.ok ? `\n;; ANSWER SECTION:\n` + [...(r.chain||[]).map(x=>`${x.name}.\t\t300\tIN\tCNAME\t${x.value}.`), ...r.answers.map(x=>`${x.name||q}.\t\t300\tIN\t${x.type}\t${x.value}${/^(CNAME|NS|PTR)$/.test(x.type)?".":""}`)].join("\n") : "") +
      `\n\n;; Query time: ${r.nonAuth?24:1} msec\n;; SERVER: ${intToIp(r.server)}#53(${intToIp(r.server)}) (UDP)`;
  }
  if (first==="nc"){ const x = a.filter(y=>!y.startsWith("-")); return x.length>=2 ? connTest(net, d, x[0], x[1], "linux") : "usage: nc [-zv] host port"; }
  if (first==="curl") return curlOut(net, d, raw);
  if (first==="tcpdump") return tcpdumpOut(net, d);
  if (first==="nmap") return nmapOut(net, d, raw);
  return `${raw.trim().split(/\s+/)[0]}: command not found`;
}
/* ---------- Cisco-style switches and routers ---------- */
const reShow = (n, re) => new RegExp("^sh(o|ow)?\\s+" + re + "$").test(n);
function portStatus(net, sw, p){
  const l = linkAt(net, sw.id, p.name);
  if (p.errDisabled) return "err-disabled";
  if (p.shutdown) return "disabled";
  if (p._suspended) return "suspended";
  if (!l) return "notconnect";
  return net.links[l.li].st.up ? "connected" : "notconnect";
}
function deviceLog(net, d){
  const L = [], ts = k => `*Oct  4 09:${String(12+k).padStart(2,"0")}:0${k%10}.${100+k*7}`;
  let k = 0;
  for (const p of d.ports||[]){
    const l = linkAt(net, d.id, p.name), st = l && net.links[l.li].st;
    if (p.errDisabled) L.push(`${ts(k++)}: %PM-4-ERR_DISABLE: psecure-violation error detected on ${longIf(p.name)}, putting ${longIf(p.name)} in err-disable state`);
    if (p.errDisabled) L.push(`${ts(k++)}: %PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred on port ${longIf(p.name)}`);
    if (p._suspended) L.push(`${ts(k++)}: %EC-5-L3DONTBNDL2: ${longIf(p.name)} suspended: LACP currently not enabled on the remote port.`);
    if (st && st.dupMismatch) L.push(`${ts(k++)}: %CDP-4-DUPLEX_MISMATCH: duplex mismatch discovered on ${longIf(p.name)} (not half duplex), with ${net.byId[l.dev].name} (half duplex).`);
    if (st && !st.up && !p.shutdown && !p.errDisabled) L.push(`${ts(k++)}: %LINK-3-UPDOWN: Interface ${longIf(p.name)}, changed state to down (${st.reason})`);
    if (l && isSwitch(net.byId[l.dev])){ const q = swPort(net.byId[l.dev], l.port); if (q && p.mode==="trunk" && q.mode==="trunk" && (vnum(p.native)||1)!==(vnum(q.native)||1)) L.push(`${ts(k++)}: %CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${longIf(p.name)} (${vnum(p.native)||1}), with ${net.byId[l.dev].name} ${longIf(l.port)} (${vnum(q.native)||1}).`); }
    if (d._poe && d._poe[p.name] && d._poe[p.name].state!=="on" && d._poe[p.name].state!=="off") L.push(`${ts(k++)}: %ILPOWER-5-ILPOWER_POWER_DENY: Interface ${longIf(p.name)}: inline power denied. Reason: ${d._poe[p.name].state==="faulty" ? "the device needs a higher PoE class than this switch supports" : "insufficient power budget"}`);
    if (st && st.errors.crc) L.push(`${ts(k++)}: %LINEPROTO-5-UPDOWN: CRC errors increasing on ${longIf(p.name)}`);
  }
  if (net.stp.storm.has(d.id)) L.push(`${ts(k++)}: %SW_MATM-4-MACFLAP_NOTIF: Host ${ciscoMac(macOf(d))} in vlan 1 is flapping between port ${longIf((d.ports[0]||{}).name||"Gi0/1")} and port ${longIf((d.ports[1]||{}).name||"Gi0/2")}`);
  if (d.ports && macFlooders(net, d).length) L.push(`${ts(k++)}: %SW_MATM-4-MAC_TABLE_FULL: MAC address table is full, flooding unknown unicast frames`);
  for (const i of d.ifaces||[]){ if (i.vip && !routerIfUp(net, d, i)) L.push(`${ts(k++)}: %HSRP-5-STATECHANGE: ${longIf(i.name)} Grp 1 state Active -> Init`); }
  return `Syslog logging: enabled\n    Console logging: level debugging\n    Trap logging: level informational\n\nLog Buffer (8192 bytes):\n` + (L.length ? L.join("\n") : `${ts(0)}: %SYS-5-CONFIG_I: Configured from console by admin`);
}
function cdpNeighbors(net, d, lldp){
  const rows = [];
  for (const L of net.links){ let mine, far; if (L.a===d.id){ mine = L.pa; far = {dev:L.b, port:L.pb}; } else if (L.b===d.id){ mine = L.pb; far = {dev:L.a, port:L.pa}; } else continue;
    if (!L.st.up) continue; const nb = net.byId[far.dev]; if (!nb || (!isSwitch(nb) && !isRouterLike(nb) && !["phone","ap"].includes(nb.kind))) continue;
    rows.push(lldp ? `${pad(nb.name,21)}${pad(shortIf(mine),16)}120        ${pad(isRouterLike(nb)&&!isSwitch(nb)?"R":nb.kind==="phone"?"T":nb.kind==="ap"?"W":"B",11)}${shortIf(far.port)}` : `${pad(nb.name,17)}${pad(shortIf(mine),18)}${pad(150,10)}${pad(isRouterLike(nb)&&!isSwitch(nb)?"R":nb.kind==="phone"?"H P":nb.kind==="ap"?"T":"S I",12)}${pad(nb.kind==="phone"?"IP Phone":nb.kind==="ap"?"AIR-AP":isSwitch(nb)?"WS-C9300":"ISR4331",10)}${shortIf(far.port)}`); }
  return lldp ? `Capability codes: (R) Router, (B) Bridge, (T) Telephone, (W) WLAN Access Point\n\nDevice ID            Local Intf      Hold-time  Capability  Port ID\n${rows.join("\n")}\n\nTotal entries displayed: ${rows.length}` :
    `Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone\n\nDevice ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\n${rows.join("\n")}`;
}
function ifCounters(net, d, name){
  const P = swPort(d, name) || (d.ifaces||[]).find(i=>pn(i.name)===pn(name));
  if (!P) return "% Invalid input detected at '^' marker.";
  const l = linkAt(net, d.id, phys(P)); const st = l ? net.links[l.li].st : null;
  const status = P.errDisabled ? "down (err-disabled)" : P.shutdown ? "administratively down" : st && st.up ? "up" : "down";
  const lp = P.errDisabled ? "down (err-disabled)" : st && st.up ? "up (connected)" : "down (notconnect)";
  const isA = l && net.links[l.li].a===d.id;
  const myDup = st && st.duplex ? st.duplex[isA?0:1] : "full";
  const halfHere = st && st.dupMismatch && myDup==="half", fullHere = st && st.dupMismatch && myDup==="full";
  const crc = st && st.errors.crc ? 4182 : fullHere ? 1377 : 0, runts = fullHere ? 912 : st && st.errors.crc ? 211 : 0, giants = st && st.errors.giants ? 3307 : 0;
  const drops = st && st.errors.drops ? 18233 : 0;
  return `${longIf(P.name)} is ${status}, line protocol is ${lp}\n  Hardware is Gigabit Ethernet, address is ${ciscoMac(macOf(d))}\n  MTU ${P.mtu||1500} bytes, BW ${st && st.up ? st.nominal*1000 : 1000000} Kbit/sec, DLY 10 usec,\n     reliability ${st && st.loss ? Math.round(255*(1-st.loss)) : 255}/255, txload ${st && st.util ? Math.round(st.util*255) : 1}/255, rxload ${st && st.util ? Math.round(st.util*230) : 1}/255\n  ${myDup==="half"?"Half":"Full"}-duplex, ${st && st.up ? (st.nominal>=1000?Math.round(st.nominal/1000)+"Gb/s":st.nominal+"Mb/s") : "Auto-speed"}, media type is 10/100/1000BaseTX\n  Input queue: 0/2000/${drops?Math.round(drops/7):0}/0 (size/max/drops/flushes); Total output drops: ${drops}\n  5 minute input rate ${st && st.util ? Math.round(st.util*st.speed*1e6) : 41000} bits/sec\n     ${st && st.up ? 1840211 : 0} packets input, ${st && st.up ? 221933410 : 0} bytes, 0 no buffer\n     ${runts} runts, ${giants} giants, 0 throttles\n     ${crc+runts} input errors, ${crc} CRC, 0 frame, 0 overrun, 0 ignored\n     ${st && st.up ? 2291407 : 0} packets output, ${st && st.up ? 1622093105 : 0} bytes, 0 underruns\n     0 output errors, ${halfHere ? 1893 : 0} collisions, 0 interface resets\n     0 babbles, ${halfHere ? 288 : 0} late collision, 0 deferred`;
}
function routerShow(net, d, n){
  if (reShow(n, "ip\\s+int(erface)?\\s+br(ief)?")){
    let s = "Interface                  IP-Address      OK? Method Status                Protocol\n";
    const physSet = [...new Set((d.ifaces||[]).map(phys))].filter(p=>!/^vlan/i.test(p));
    const rows = [];
    for (const p of physSet){ if (!d.ifaces.some(i=>i.name===p)) rows.push({name:p}); rows.push(...d.ifaces.filter(i=>phys(i)===p)); }
    rows.push(...(d.ifaces||[]).filter(i=>/^vlan/i.test(i.name)));
    if (isSwitch(d)) for (const p of d.ports) rows.push({name:p.name, _port:true});
    for (const i of rows){ const c = i.ip!=null && ifCfg(i); const up = i._port ? portStatus(net, d, swPort(d,i.name))==="connected" : (c ? routerIfUp(net, d, i) : !!(linkAt(net, d.id, phys(i)) && net.links[linkAt(net, d.id, phys(i)).li].st.up));
      s += `${pad(longIf(i.name),27)}${pad(c?intToIp(c.ip):"unassigned",16)}YES ${c?"manual":"unset "} ${pad(i.shutdown?"administratively down":up?"up":"down",22)}${up?"up":"down"}\n`; }
    return s;
  }
  if (reShow(n, "ip\\s+ro(ute)?")){
    const rows = routeTable(net, d), def = rows.find(r=>r.n===0);
    let s = "Codes: L - local, C - connected, S - static, O - OSPF, * - candidate default\n\n" + (def ? `Gateway of last resort is ${intToIp(def.via)} to network 0.0.0.0\n\n` : "Gateway of last resort is not set\n\n");
    const sorted = [...rows].sort((a,b)=>a.n===0?-1:b.n===0?1:a.net-b.net);
    for (const r of sorted){
      if (r.type==="C"){ s += `C        ${intToIp(r.net)}/${r.n} is directly connected, ${longIf(r.iface.name)}\nL        ${intToIp(ifCfg(r.iface).ip)}/32 is directly connected, ${longIf(r.iface.name)}\n`; }
      else s += `${pad(r.type,9)}${intToIp(r.net)}/${r.n} [${r.ad}/${r.metric||0}] via ${intToIp(r.via)}${r.type==="O" ? ", 00:12:41, "+longIf(r.iface.name) : ""}\n`;
    }
    return s;
  }
  if (reShow(n, "access-lists?")){
    const acls = Object.entries(d.acls||{}); if (!acls.length) return "";
    return acls.map(([nm, rules])=>`Extended IP access list ${nm}\n` + rules.map((r,i)=>`    ${(i+1)*10} ${r.action} ${r.proto||"ip"} ${r.src||"any"} ${r.dst||"any"}${r.port && r.port!=="any" ? " eq "+r.port : ""}`).join("\n")).join("\n");
  }
  if (reShow(n, "ip\\s+nat\\s+tr(anslations)?")){
    const ins = (d.ifaces||[]).filter(i=>i.nat==="outside" || (!d.ifaces.some(x=>x.nat) && ifCfg(i) && !isPrivate(ifCfg(i).ip)));
    const out = ins[0] && ifCfg(ins[0]); if (!out) return "";
    const hosts = net.devs.filter(h=>isHost(h) && hostCfg(net,h).ok && !h._off).slice(0,5);
    const rows = hosts.map((h,k)=>{ const r = hostPing(net, h, ipToInt("8.8.8.8")); return r.ok && r.ep.internet && r.hops.includes(r.hops[0]) ? `udp ${intToIp(out.ip)}:${1024+k}   ${intToIp(hostCfg(net,h).ip)}:${50000+k*7}  8.8.8.8:53         8.8.8.8:53` : null; }).filter(Boolean);
    return "Pro Inside global         Inside local          Outside local         Outside global\n" + rows.join("\n");
  }
  if (reShow(n, "standby(\\s+br(ief)?)?") || reShow(n, "vrrp(\\s+br(ief)?)?")){
    const vi = (d.ifaces||[]).filter(i=>i.vip); if (!vi.length) return "";
    return "                     P indicates configured to preempt.\nInterface   Grp  Pri P State   Active          Standby         Virtual IP\n" + vi.map(i=>{ const up = routerIfUp(net, d, i); const dom = ifaceDomain(net, d, i); const act = up ? vipActive(net, [{dev:d, iface:i, m:{}}, ...dom], ipToInt(i.vip)) : null; const me = act && act.dev===d; return `${pad(shortIf(i.name),12)}1    ${pad(i.vipPriority||100,4)}P ${pad(!up?"Init":me?"Active":"Standby",8)}${pad(me?"local":act?intToIp(ifCfg(act.iface).ip):"unknown",16)}${pad(me?"unknown":"local",16)}${i.vip}`; }).join("\n");
  }
  if (reShow(n, "ip\\s+ospf\\s+nei(ghbor)?")){
    if (!d.ospf || !d.ospf.enabled) return "";
    const o = ospfRoutes(net);
    return "Neighbor ID     Pri   State           Dead Time   Address         Interface\n" + (o.adj[d.id]||[]).map(e=>`${pad(intToIp(e.via),16)}1     FULL/DR         00:00:35    ${pad(intToIp(e.via),16)}${longIf(e.out.name)}`).join("\n");
  }
  if (reShow(n, "arp") || reShow(n, "ip\\s+arp")){
    let s = "Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n";
    for (const x of upIfs(net, d)){ s += `Internet  ${pad(intToIp(x.c.ip),17)}-          ${pad(ciscoMac(macOf(d)),16)}ARPA   ${longIf(x.i.name)}\n`;
      for (const e of ifaceDomain(net, d, x.i)) if (isHost(e.dev)){ const c = hostCfg(net, e.dev); if (c.ok && inNet(c.ip, x.c.ip, x.c.n)) s += `Internet  ${pad(intToIp(c.ip),17)}${pad(2,11)}${pad(ciscoMac(macOf(e.dev)),16)}ARPA   ${longIf(x.i.name)}\n`; } }
    return s;
  }
  return null;
}
function switchShow(net, d, n){
  const ports = d.ports||[];
  const vlName = v => (d.vlanNames && d.vlanNames[v]) || (v===1 ? "default" : "VLAN"+String(v).padStart(4,"0"));
  if (reShow(n, "vl(an)?(\\s+br(ief)?)?")){
    const vl = new Set([1, ...ports.filter(p=>p.mode!=="trunk").map(p=>vnum(p.vlan)||1), ...ports.filter(p=>p.voice).map(p=>vnum(p.voice)), ...Object.keys(d.vlanNames||{}).map(Number)]);
    let s = "\nVLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n";
    for (const v of [...vl].sort((a,b)=>a-b)) s += `${pad(v,5)}${pad(vlName(v),33)}active    ${ports.filter(p=>p.mode!=="trunk" && !p._dtpTrunk && ((vnum(p.vlan)||1)===v || vnum(p.voice)===v)).map(p=>shortIf(p.name)).join(", ")}\n`;
    return s;
  }
  if (reShow(n, "int(erfaces?)?\\s+stat(us)?")){
    let s = "\nPort      Name               Status       Vlan       Duplex  Speed Type\n";
    for (const p of ports){ const l = linkAt(net, d.id, p.name), nb = l && net.byId[l.dev], st = l && net.links[l.li].st, stat = portStatus(net, d, p);
      const isA = l && net.links[l.li].a===d.id; const dup = st && st.up ? (p.duplex==="auto" ? "a-" + st.duplex[isA?0:1] : p.duplex) : p.duplex==="auto" ? "auto" : p.duplex;
      const spd = st && st.up ? (p.speed==="auto" ? "a-" + st.nominal : p.speed) : p.speed;
      s += `${pad(shortIf(p.name),10)}${pad((nb?nb.name:"").slice(0,18),19)}${pad(stat,13)}${pad(p.mode==="trunk"||p._dtpTrunk?"trunk":String(vnum(p.vlan)||1),11)}${pad(dup,8)}${pad(spd,6)}${p.sfp||"10/100/1000BaseTX"}\n`; }
    return s;
  }
  if (reShow(n, "int(erfaces?)?\\s+tr(unk)?")){
    const tr = ports.filter(p=>(p.mode==="trunk" || p._dtpTrunk) && portStatus(net, d, p)==="connected");
    if (!tr.length) return "";
    let s = "\nPort        Mode             Encapsulation  Status        Native vlan\n";
    for (const p of tr) s += `${pad(shortIf(p.name),12)}${pad(p._dtpTrunk?"desirable":"on",17)}802.1q         trunking      ${vnum(p.native)||1}\n`;
    s += "\nPort        Vlans allowed on trunk\n"; for (const p of tr) s += `${pad(shortIf(p.name),12)}${parseVlans(p.allowed)==null ? "1-4094" : String(p.allowed).replace(/\s+/g,"")}\n`;
    s += "\nPort        Vlans in spanning tree forwarding state and not pruned\n"; for (const p of tr){ const li = linkIndex(net, d.id, p.name); s += `${pad(shortIf(p.name),12)}${net.stp.blocked.has(li) ? "none (blocked by STP)" : parseVlans(p.allowed)==null ? "1-4094" : String(p.allowed).replace(/\s+/g,"")}\n`; }
    return s;
  }
  if (reShow(n, "mac(\\s+|-)address-table(\\s+.*)?")){
    let s = "          Mac Address Table\n-------------------------------------------\n\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n";
    let count = 0;
    for (const p of ports){
      if (portStatus(net, d, p)!=="connected") continue;
      const l = linkAt(net, d.id, p.name), nb = net.byId[l.dev];
      if (nb && nb.macFlood){ for (let k=0;k<4;k++) s += `${pad(vnum(p.vlan)||1,8)}${pad(ciscoMac("02"+(0x1000+k*3311).toString(16).padStart(10,"0")),18)}DYNAMIC     ${shortIf(p.name)}\n`; s += `  ... 8188 more entries learned on ${shortIf(p.name)}\n`; count += 8192; continue; }
      if (net.stp.blocked.has(l.li)) continue;
      const vlan = p.mode==="trunk" || p._dtpTrunk ? null : (vnum(p.vlan)||1);
      if (isHost(nb)){ s += `${pad(vlan||1,8)}${pad(ciscoMac(macOf(nb)),18)}DYNAMIC     ${shortIf(p.name)}\n`; count++; }
      else { for (const e of l2Domain(net, {dev:d.id, port:p.name, tag:null})) if (isHost(e.dev) || isRouterLike(e.dev)){ s += `${pad(vlan||1,8)}${pad(ciscoMac(macOf(e.dev)),18)}DYNAMIC     ${shortIf(p.name)}\n`; count++; if (count>24) break; } }
    }
    return s + `Total Mac Addresses for this criterion: ${count}`;
  }
  if (reShow(n, "spanning-tree(\\s+.*)?")){
    const R = net.stp.roles[d.id]; if (!R) return "No spanning tree instance exists.";
    if (!d.stp.enabled) return "No spanning tree instance exists.\n(spanning-tree is disabled on this switch)";
    const root = net.byId[R.root];
    let s = `VLAN0001\n  Spanning tree enabled protocol rstp\n  Root ID    Priority    ${root.stp.priority}\n             Address     ${ciscoMac(macOf(root))}\n` + (R.root===d.id ? "             This bridge is the root\n" : `             Cost        ${R.rootCost}\n             Port        ${shortIf(R.rootPort)}\n`) + `\n  Bridge ID  Priority    ${d.stp.priority}\n             Address     ${ciscoMac(macOf(d))}\n\nInterface           Role Sts Cost      Prio.Nbr Type\n------------------- ---- --- --------- -------- --------------------------------\n`;
    for (const p of ports){ const r = R.ports[p.name]; if (!r) continue; s += `${pad(shortIf(p.name),20)}${pad(r.role,5)}${pad(r.state,4)}${pad(r.cost,10)}128.${pad(ports.indexOf(p)+1,5)}${r.edge?"P2p Edge":"P2p"}\n`; }
    return s;
  }
  if (reShow(n, "etherchannel(\\s+summary)?")){
    const groups = {}; ports.filter(p=>p.channel).forEach(p=>{ (groups[p.channel] = groups[p.channel]||[]).push(p); });
    let s = "Flags:  D - down        P - bundled in port-channel\n        I - stand-alone s - suspended\n        S - Layer2      U - in use\n\nGroup  Port-channel  Protocol    Ports\n------+-------------+-----------+-----------------------------------------------\n";
    for (const [g, ps] of Object.entries(groups)){ const ok = ps.every(p=>p._bundle); const proto = ps[0].lacp && ps[0].lacp!=="on" ? "LACP" : "-"; s += `${pad(g,7)}Po${g}(${ok?"SU":"SD"})${" ".repeat(Math.max(1,8-String(g).length))}${pad(proto,12)}${ps.map(p=>`${shortIf(p.name)}(${p._bundle?"P":p._suspended?"s":portStatus(net,d,p)==="connected"?"I":"D"})`).join(" ")}\n`; }
    return s;
  }
  if (reShow(n, "power(\\s+inline)?")){
    let s = `Available:${d.poeBudget.toFixed(1)}(w)  Used:${(d._poeUsed||0).toFixed(1)}(w)  Remaining:${(d.poeBudget-(d._poeUsed||0)).toFixed(1)}(w)\n\nInterface Admin  Oper       Power   Device              Class Max\n                           (Watts)\n--------- ------ ---------- ------- ------------------- ----- ----\n`;
    for (const p of ports){ const e = d._poe && d._poe[p.name]; s += `${pad(shortIf(p.name),10)}${pad(p.poe===false?"off":"auto",7)}${pad(e?e.state:"off",11)}${pad((e?e.watts:0).toFixed(1),8)}${pad(e?e.dev:"n/a",20)}${pad(e?(e.need>15.4||e.watts>15.4?"4":"3"):"n/a",6)}${d.poeStd==="bt"?"90.0":d.poeStd==="at"?"30.0":"15.4"}\n`; }
    return s;
  }
  if (reShow(n, "port-security(\\s+.*)?")){
    let s = "Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n                (Count)       (Count)          (Count)\n---------------------------------------------------------------------------\n";
    for (const p of ports.filter(p=>p.portSecurity && p.portSecurity.enabled)){ const l = linkAt(net, d.id, p.name), nb = l && net.byId[l.dev]; s += `${pad(shortIf(p.name),13)}${pad(p.portSecurity.max||1,15)}${pad(nb && nb.macFlood ? 8192 : nb ? 1 : 0,13)}${pad(p._violation||p.errDisabled ? 1 : 0,19)}${p.portSecurity.violation==="restrict"?"Restrict":p.portSecurity.violation==="protect"?"Protect":"Shutdown"}\n`; }
    return s;
  }
  if (reShow(n, "ip\\s+dhcp\\s+snooping")){
    return `Switch DHCP snooping is ${d.dhcpSnooping?"enabled":"disabled"}\nDHCP snooping is operational on following VLANs:\n${d.dhcpSnooping ? [...new Set(ports.map(p=>vnum(p.vlan)||1))].join(",") : "none"}\n\nInterface                  Trusted    Allow option    Rate limit (pps)\n-----------------------    -------    ------------    ----------------\n` + ports.map(p=>`${pad(longIf(p.name),27)}${pad(p.trusted?"yes":"no",11)}${pad(p.trusted?"yes":"no",16)}unlimited`).join("\n");
  }
  if (reShow(n, "ip\\s+arp\\s+inspection")) return `Source Mac Validation      : Disabled\nDestination Mac Validation : Disabled\nIP Address Validation      : Disabled\n\n Vlan     Configuration    Operation   ACL Match          Static ACL\n ----     -------------    ---------   ---------          ----------\n    1     ${d.dai?"Enabled          Active":"Disabled         Inactive"}`;
  return null;
}
function runningConfig(net, d){
  let s = `Building configuration...\n\nhostname ${d.name}\n!\n`;
  if (isSwitch(d)){
    if (!d.stp.enabled) s += "no spanning-tree vlan 1\n"; else s += `spanning-tree mode rapid-pvst\n${d.stp.priority!==32768?`spanning-tree vlan 1 priority ${d.stp.priority}\n`:""}`;
    if (d.dhcpSnooping) s += "ip dhcp snooping\nip dhcp snooping vlan 1-4094\n"; if (d.dai) s += "ip arp inspection vlan 1-4094\n";
    s += "!\n";
    for (const p of d.ports){
      s += `interface ${longIf(p.name)}\n`;
      if (p.mode==="trunk"){ s += " switchport mode trunk\n"; if (parseVlans(p.allowed)!=null) s += ` switchport trunk allowed vlan ${String(p.allowed).replace(/\s+/g,"")}\n`; if ((vnum(p.native)||1)!==1) s += ` switchport trunk native vlan ${p.native}\n`; }
      else if (p.mode==="dynamic") s += " switchport mode dynamic desirable\n";
      else { s += ` switchport mode access\n switchport access vlan ${vnum(p.vlan)||1}\n`; if (p.voice) s += ` switchport voice vlan ${p.voice}\n`; }
      if (p.speed!=="auto") s += ` speed ${p.speed}\n`; if (p.duplex!=="auto") s += ` duplex ${p.duplex}\n`;
      if (p.mtu && p.mtu!==1500) s += ` mtu ${p.mtu}\n`;
      if (p.channel) s += ` channel-group ${p.channel} mode ${p.lacp||"on"}\n`;
      if (p.portSecurity && p.portSecurity.enabled) s += ` switchport port-security\n switchport port-security maximum ${p.portSecurity.max||1}\n switchport port-security violation ${p.portSecurity.violation||"shutdown"}\n`;
      if (p.trusted) s += " ip dhcp snooping trust\n"; if (p.poe===false) s += " power inline never\n";
      if (p.shutdown) s += " shutdown\n";
      s += "!\n";
    }
  }
  if (isRouterLike(d)){
    const physSet = [...new Set(d.ifaces.map(phys))];
    for (const p of physSet){
      if (!d.ifaces.some(i=>i.name===p) && !/^vlan/i.test(p)) s += `interface ${longIf(p)}\n no ip address\n!\n`;
      for (const i of d.ifaces.filter(i=>phys(i)===p)){
        s += `interface ${longIf(i.name)}\n`;
        if (vnum(i.vlan)!=null && !/^vlan/i.test(i.name)) s += ` encapsulation dot1Q ${vnum(i.vlan)}\n`;
        const c = ifCfg(i); s += c ? ` ip address ${intToIp(c.ip)} ${intToIp(mInt(c.n))}\n` : " no ip address\n";
        if (String(i.helper||"").trim()) for (const h of String(i.helper).split(/[,\s]+/)) s += ` ip helper-address ${h}\n`;
        if (i.nat) s += ` ip nat ${i.nat}\n`; if (i.acl) s += ` ip access-group ${i.acl} in\n`; if (i.aclOut) s += ` ip access-group ${i.aclOut} out\n`;
        if (i.vip) s += ` standby 1 ip ${i.vip}\n standby 1 priority ${i.vipPriority||100}\n standby 1 preempt\n${i.track?` standby 1 track ${longIf(i.track)} ${i.trackDecrement||10}\n`:""}`;
        if (i.mtu && i.mtu!==1500) s += ` ip mtu ${i.mtu}\n`;
        if (i.shutdown) s += " shutdown\n";
        s += "!\n";
      }
    }
    if (d.ospf && d.ospf.enabled) s += `router ospf 1\n${(d.ospf.passive||[]).map(p=>` passive-interface ${longIf(p)}\n`).join("")}` + upIfs(net, d).map(x=>` network ${intToIp(netOf(x.c.ip,x.c.n))} ${intToIp(~mInt(x.c.n)>>>0)} area ${d.ospf.area||0}\n`).join("") + "!\n";
    if (d.ifaces.some(i=>i.nat==="outside")) s += `ip nat inside source list NAT overload interface ${longIf(d.ifaces.find(i=>i.nat==="outside").name)}\n`;
    for (const r of d.routes||[]){ const c = parseCidr(r.net); if (c) s += `ip route ${intToIp(c.ip)} ${intToIp(mInt(c.n))} ${r.via}${r.ad?" "+r.ad:""}\n`; }
    if (ipToInt(d.defaultRoute)!=null) s += `ip route 0.0.0.0 0.0.0.0 ${d.defaultRoute}\n`;
    for (const [nm, rules] of Object.entries(d.acls||{})) s += `ip access-list extended ${nm}\n` + rules.map(r=>` ${r.action} ${r.proto||"ip"} ${r.src||"any"} ${r.dst||"any"}${r.port&&r.port!=="any"?" eq "+r.port:""}\n`).join("");
  }
  return s + "end";
}
function deviceCmd(net, d, raw){
  const n = cn(raw);
  if (n==="help" || n==="?") return isSwitch(d)
    ? "Commands: show vlan brief, show interfaces status, show interfaces <port>, show interfaces trunk, show mac address-table, show spanning-tree, show etherchannel summary, show power inline, show port-security, show ip dhcp snooping, show ip arp inspection, show cdp neighbors, show lldp neighbors, show logging, show running-config" + (d.kind==="l3switch" ? ", show ip interface brief, show ip route, show arp, show access-lists" : "")
    : "Commands: show ip interface brief, show ip route, show interfaces <name>, show access-lists, show ip nat translations, show standby brief, show ip ospf neighbor, show arp, show cdp neighbors, show lldp neighbors, show logging, show running-config, ping <ip>, traceroute <ip>";
  if (reShow(n, "run(ning-config)?") || reShow(n, "config") || n==="show startup-config") return runningConfig(net, d);
  if (reShow(n, "log(ging)?")) return deviceLog(net, d);
  if (reShow(n, "cdp\\s+nei(ghbors)?(\\s+detail)?")) return cdpNeighbors(net, d, false);
  if (reShow(n, "lldp\\s+nei(ghbors)?(\\s+detail)?")) return cdpNeighbors(net, d, true);
  const mi = n.match(/^sh(?:o|ow)?\s+int(?:erfaces?)?\s+(\S+)$/);
  if (mi && !/^(status|trunk|counters)$/.test(mi[1])){ const name = (d.ports||[]).concat(d.ifaces||[]).find(p=>pn(p.name)===pn(mi[1]) || pn(longIf(p.name))===pn(mi[1]) || pn(shortIf(p.name))===pn(shortIf(mi[1]))); return name ? ifCounters(net, d, name.name) : "% Invalid input detected at '^' marker."; }
  if (isSwitch(d)){ const s = switchShow(net, d, n); if (s!=null) return s; }
  if (isRouterLike(d)){ const s = routerShow(net, d, n); if (s!=null) return s;
    const pm = n.match(/^ping\s+(\S+)$/), tm = n.match(/^trace(route)?\s+(\S+)$/);
    if (pm || tm){
      const dst = ipToInt(pm ? pm[1] : tm[2]); if (dst==null) return "% Unrecognized host or address.";
      const src = upIfs(net, d)[0]; if (!src) return "% No usable source address.";
      const r = exchange(net, {src:src.c.ip, dst, proto:"icmp"}, {type:"router", dev:d, inIface:null}, d.id);
      if (pm) return `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${intToIp(dst)}, timeout is 2 seconds:\n${r.ok ? (r.m && r.m.loss>=0.1 ? "!.!.!" : "!!!!!") : r.code==="netunreach"?"UUUUU":"....."}\nSuccess rate is ${r.ok ? (r.m && r.m.loss>=0.1 ? 60 : 100) : 0} percent (${r.ok ? (r.m && r.m.loss>=0.1 ? 3 : 5) : 0}/5)`;
      return `Type escape sequence to abort.\nTracing the route to ${intToIp(dst)}\n\n` + (r.hops||[]).map((h,i)=>`  ${i+1} ${intToIp(h)} ${1+i} msec ${1+i} msec ${2+i} msec`).join("\n") + (r.ok ? `\n  ${(r.hops||[]).length+1} ${intToIp(dst)} 2 msec 2 msec 3 msec` : "\n  " + ((r.hops||[]).length+1) + " * * *");
    }
  }
  if (/^(conf|configure)/.test(n)) return "Configuration changes are made in the Configure tab in this lab. Use show commands here to verify them.";
  return "% Invalid input detected at '^' marker. Type help to see available commands.";
}
function runCommand(net, d, raw){ net.reset(); return isHost(d) ? hostCmd(net, d, raw) : deviceCmd(net, d, raw); }
