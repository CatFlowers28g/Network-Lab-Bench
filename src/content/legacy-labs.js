/* Lab Bench built-in question-style labs. Content: CC BY-SA 4.0. */
"use strict";
/* ---------- built-in labs ---------- */
function pingOk(ip, ms, ttl){
  const line = `Reply from ${ip}: bytes=32 time${ms<1?"<1":"="+ms}ms TTL=${ttl}`;
  return `\nPinging ${ip} with 32 bytes of data:\n${[line,line,line,line].join("\n")}\n\nPing statistics for ${ip}:\n    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),`;
}
const L = (layer) => ({1:"Layer 1: Physical",2:"Layer 2: Data link",3:"Layer 3: Network",4:"Layer 4: Transport",5:"Layer 5: Session",6:"Layer 6: Presentation",7:"Layer 7: Application"})[layer];

const STATIC_LABS = [
{ id:"b-osi", title:"Map it to the OSI model", domain:"concepts", difficulty:1, objective:"1.1 OSI reference model",
  scenario:"A junior tech is labeling gear and protocols for a training wiki. Place each item at the OSI layer where it primarily operates.",
  tasks:[{type:"match", prompt:"Place each item on its OSI layer.", targets:[1,2,3,4,5,6,7].map(L),
    items:[["Hub",1],["Repeater",1],["Unmanaged switch",2],["MAC address",2],["Router",3],["IPv4 address",3],["TCP segment",4],["Port numbers",4],["Character encoding and data formatting",6],["HTTP",7]].map(([text,l])=>({text,target:L(l)})),
    explanation:"Hubs and repeaters only regenerate bits (L1). Switches forward frames by MAC address (L2). Routers forward packets by IP address (L3). TCP and port numbers handle end-to-end delivery (L4). Encoding and formatting belong to presentation (L6), and HTTP is an application protocol (L7). Layer 5 is a distractor here."}]},

{ id:"b-method", title:"Troubleshooting methodology", domain:"troubleshooting", difficulty:1, objective:"5.1 Troubleshooting methodology",
  scenario:"Your manager wants the help desk to follow the CompTIA troubleshooting methodology on every ticket, and asks you to post the steps by the door.",
  tasks:[
    {type:"order", prompt:"Put the steps in order, first step at the top.", items:["Identify the problem","Establish a theory of probable cause","Test the theory to determine the cause","Establish a plan of action to resolve the problem and identify potential effects","Implement the solution or escalate as necessary","Verify full system functionality and implement preventive measures if applicable","Document findings, actions, outcomes, and lessons learned"],
     explanation:"Identify, theorize, test, plan, implement, verify, document. If a theory is disproven, you loop back and establish a new theory (or escalate)."},
    {type:"choice", prompt:"A tech swaps a faulty patch cable and the user can browse again. What should the tech do next?", options:["Close the ticket immediately","Verify full system functionality and implement preventive measures","Establish a new theory of probable cause","Escalate to the network team"], answer:[1],
     explanation:"After implementing a fix, confirm everything works (and prevent a repeat) before documenting and closing."}]},

{ id:"b-dns-cli", title:"Websites won't load, but the network is up", domain:"troubleshooting", difficulty:2, objective:"5.3 Network service issues",
  scenario:"A user on the 3rd floor says no websites or intranet pages will load. Their softphone, which connects to the PBX by IP address, still works. A desktop tech recently 're-did the network settings' on this PC. Use the command line on the user's workstation to investigate.",
  tasks:[
    {type:"cli", prompt:"Investigate from the user's workstation, then answer the question.", shell:"windows", promptText:"C:\\Users\\jlee>",
     intro:"Microsoft Windows [Version 10.0.22631]\n(c) Microsoft Corporation. All rights reserved.",
     commands:[
      {cmd:["ipconfig"], output:"\nWindows IP Configuration\n\nEthernet adapter Ethernet:\n\n   Connection-specific DNS Suffix  . :\n   IPv4 Address. . . . . . . . . . . : 192.168.10.57\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.10.1"},
      {cmd:["ipconfig /all"], output:"\nWindows IP Configuration\n\n   Host Name . . . . . . . . . . . . : WS-3F-114\n   Primary Dns Suffix  . . . . . . . : corp.local\n\nEthernet adapter Ethernet:\n\n   Description . . . . . . . . . . . : Intel(R) Ethernet Connection I219-LM\n   Physical Address. . . . . . . . . : 3C-52-82-1A-77-0E\n   DHCP Enabled. . . . . . . . . . . : No\n   Autoconfiguration Enabled . . . . : Yes\n   IPv4 Address. . . . . . . . . . . : 192.168.10.57(Preferred)\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.10.1\n   DNS Servers . . . . . . . . . . . : 192.168.1.53\n   NetBIOS over Tcpip. . . . . . . . : Enabled"},
      {cmd:["ping 192.168.10.1"], output:pingOk("192.168.10.1",0,255)},
      {cmd:["ping 8.8.8.8"], output:pingOk("8.8.8.8",14,117)},
      {cmd:["ping 192.168.10.53"], output:pingOk("192.168.10.53",0,128)},
      {cmd:["ping 192.168.1.53"], output:"\nPinging 192.168.1.53 with 32 bytes of data:\nRequest timed out.\nRequest timed out.\nRequest timed out.\nRequest timed out.\n\nPing statistics for 192.168.1.53:\n    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),"},
      ...["comptia.org","www.comptia.org","intranet","intranet.corp.local","google.com","www.google.com"].map(n=>({cmd:["ping "+n], output:`Ping request could not find host ${n}. Please check the name and try again.`})),
      {cmd:["nslookup comptia.org","nslookup www.comptia.org","nslookup google.com","nslookup intranet.corp.local"], output:"DNS request timed out.\n    timeout was 2 seconds.\nServer:  UnKnown\nAddress:  192.168.1.53\n\nDNS request timed out.\n    timeout was 2 seconds.\n*** Request to UnKnown timed-out"},
      {cmd:["nslookup comptia.org 192.168.10.53","nslookup www.comptia.org 192.168.10.53","nslookup google.com 192.168.10.53"], output:"Server:  dc01.corp.local\nAddress:  192.168.10.53\n\nNon-authoritative answer:\nName:    comptia.org\nAddress:  198.51.100.24"},
      {cmd:["tracert 8.8.8.8"], output:"\nTracing route to 8.8.8.8 over a maximum of 30 hops\n\n  1    <1 ms    <1 ms    <1 ms  192.168.10.1\n  2     2 ms     1 ms     1 ms  10.200.0.1\n  3     9 ms     8 ms     9 ms  203.0.113.9\n  4    14 ms    13 ms    14 ms  8.8.8.8\n\nTrace complete."},
      {cmd:["arp -a"], output:"\nInterface: 192.168.10.57 --- 0x7\n  Internet Address      Physical Address      Type\n  192.168.10.1          00-1a-2b-3c-4d-01     dynamic\n  192.168.10.53         00-50-56-9a-12-0c     dynamic\n  192.168.10.255        ff-ff-ff-ff-ff-ff     static"},
      {cmd:["ipconfig /flushdns"], output:"\nWindows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache."},
      {cmd:["ipconfig /release","ipconfig /renew"], output:"\nWindows IP Configuration\n\nThe operation failed as no adapter is in the state permissible for\nthis operation."}],
     question:{prompt:"What is the most likely cause of the problem?", options:["The default gateway is misconfigured","The workstation has a static DNS server address that is wrong","DHCP failed and the PC has an APIPA address","There is a duplicate IP address on the subnet"], answer:[1]},
     explanation:"Pings to the gateway and to 8.8.8.8 succeed, so IP routing works. Name resolution fails because the static DNS entry points at 192.168.1.53, which doesn't answer. Querying the real DNS server (192.168.10.53) directly works. DHCP is disabled, so /renew fails, which also rules out APIPA."},
    {type:"choice", prompt:"Which fix best resolves the issue and prevents it from happening again on this PC?", options:["Run ipconfig /flushdns","Set the adapter to obtain IP and DNS settings automatically from DHCP","Add a hosts file entry for each website","Change the default gateway to 192.168.10.53"], answer:[1],
     explanation:"Returning the adapter to DHCP hands it the correct DNS server, and future changes are handled centrally. Flushing the cache won't help when the configured server is unreachable."}]},

{ id:"b-duplex-cli", title:"The slow printer on 2F", domain:"troubleshooting", difficulty:3, objective:"5.2 Cabling and physical interface issues",
  scenario:"Print jobs to the 2nd-floor printer are slow and frequently time out. Other devices on the same switch are fine. The printer's own configuration page shows its NIC is manually set to 100BASE-TX, full duplex. You're consoled into the access switch.",
  tasks:[
    {type:"cli", prompt:"Investigate on the switch, then answer the question.", shell:"cisco", promptText:"SW-2F#",
     commands:[
      {cmd:["show interfaces status","sh int status","sh int stat","show int status"], output:"\nPort      Name         Status       Vlan       Duplex  Speed Type\nGi0/1     Accounting   connected    10         a-full a-1000 10/100/1000BaseTX\nGi0/2     Printer-2F   connected    10           half    100 10/100/1000BaseTX\nGi0/3     Staff-PC-14  connected    10         a-full a-1000 10/100/1000BaseTX\nGi0/4     Staff-PC-15  notconnect   10           auto   auto 10/100/1000BaseTX\nGi0/24    Uplink       connected    trunk      a-full a-1000 10/100/1000BaseTX"},
      {cmd:["show interfaces gi0/2","sh int gi0/2","show int gi0/2","show interfaces gigabitethernet0/2","sh int g0/2"], output:"GigabitEthernet0/2 is up, line protocol is up (connected)\n  Hardware is Gigabit Ethernet, address is 0011.2233.4402 (bia 0011.2233.4402)\n  Description: Printer-2F\n  MTU 1500 bytes, BW 100000 Kbit/sec, DLY 100 usec,\n     reliability 241/255, txload 1/255, rxload 1/255\n  Half-duplex, 100Mb/s, media type is 10/100/1000BaseTX\n  input flow-control is off, output flow-control is unsupported\n  5 minute input rate 41000 bits/sec, 35 packets/sec\n  5 minute output rate 112000 bits/sec, 48 packets/sec\n     18233 packets input, 2219334 bytes, 0 no buffer\n     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored\n     22914 packets output, 16220931 bytes, 0 underruns\n     0 output errors, 1893 collisions, 0 interface resets\n     0 babbles, 288 late collision, 0 deferred"},
      {cmd:["show interfaces gi0/3","sh int gi0/3","show int gi0/3"], output:"GigabitEthernet0/3 is up, line protocol is up (connected)\n  Description: Staff-PC-14\n  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX\n     402210 packets input, 311204553 bytes, 0 no buffer\n     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored\n     0 output errors, 0 collisions, 0 interface resets\n     0 babbles, 0 late collision, 0 deferred"},
      {cmd:["show running-config interface gi0/2","sh run int gi0/2","show run int gi0/2","show run interface gi0/2"], output:"Building configuration...\n\nCurrent configuration : 162 bytes\n!\ninterface GigabitEthernet0/2\n description Printer-2F\n switchport access vlan 10\n switchport mode access\n speed 100\n duplex half\nend"},
      {cmd:["show vlan brief","sh vlan brief","sh vlan br"], output:"\nVLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n1    default                          active\n10   STAFF                            active    Gi0/1, Gi0/2, Gi0/3, Gi0/4\n20   VOICE                            active\n99   MGMT                             active"},
      {cmd:["show mac address-table interface gi0/2","sh mac add int gi0/2","show mac address-table"], output:"          Mac Address Table\n-------------------------------------------\n\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n  10    a4c3.f0e1.22b9    DYNAMIC     Gi0/2"},
      {cmd:["show ip interface brief","sh ip int br","sh ip int brief"], output:"Interface              IP-Address      OK? Method Status                Protocol\nVlan99                 10.99.0.12      YES NVRAM  up                    up\nGigabitEthernet0/1     unassigned      YES unset  up                    up\nGigabitEthernet0/2     unassigned      YES unset  up                    up\nGigabitEthernet0/3     unassigned      YES unset  up                    up\nGigabitEthernet0/4     unassigned      YES unset  down                  down\nGigabitEthernet0/24    unassigned      YES unset  up                    up"}],
     question:{prompt:"What is causing the printer's problems?", options:["The printer is in the wrong VLAN","A duplex mismatch between the switch port and the printer","A bad patch cable causing an incorrect pinout","The printer's MAC address is blocked by port security"], answer:[1]},
     explanation:"Gi0/2 is hard-coded to 100 Mbps half duplex while the printer is set to full duplex. The half-duplex switch port logs collisions and late collisions; the full-duplex printer would be the side logging CRC errors and runts. The VLAN and MAC table look normal, which rules out the other options."},
    {type:"choice", prompt:"Which change on the switch fixes it, given the printer stays at 100 Mbps full duplex?", options:["switchport access vlan 20","duplex full (keeping speed 100)","spanning-tree portfast","shutdown, then no shutdown"], answer:[1],
     explanation:"Both ends must match. Because the printer is manually set, the switch port must also be manually set to 100/full. (Setting one side to auto against a hard-coded side typically falls back to half duplex.)"}]},

{ id:"b-wireless", title:"Three APs, one floor", domain:"implementation", difficulty:2, objective:"2.3 Wireless devices and technologies",
  scenario:"A small office is adding three 2.4 GHz access points in adjacent rooms. AP-1 is locked to channel 1 and AP-3 to channel 11 by the landlord's building controller. Corporate policy requires 802.1X authentication against a central server and the strongest available encryption.",
  tasks:[
    {type:"fill", prompt:"Complete the AP configuration.", columns:["Access point","Channel","Security mode","Auth server"],
     rows:[
      ["AP-1","1",{answer:"WPA3-Enterprise",options:["Open","WEP","WPA2-Personal","WPA3-Personal","WPA3-Enterprise"]},{answer:"RADIUS",options:["RADIUS","TACACS+","Kerberos","NTP"]}],
      ["AP-2",{answer:"6",options:["1","3","6","9","11"]},{answer:"WPA3-Enterprise",options:["Open","WEP","WPA2-Personal","WPA3-Personal","WPA3-Enterprise"]},{answer:"RADIUS",options:["RADIUS","TACACS+","Kerberos","NTP"]}],
      ["AP-3","11",{answer:"WPA3-Enterprise",options:["Open","WEP","WPA2-Personal","WPA3-Personal","WPA3-Enterprise"]},{answer:"RADIUS",options:["RADIUS","TACACS+","Kerberos","NTP"]}]],
     explanation:"In 2.4 GHz only channels 1, 6 and 11 don't overlap, so AP-2 goes on 6. 802.1X for wireless uses an Enterprise mode with a RADIUS server; WPA3-Enterprise is the strongest option. TACACS+ is for device administration, not wireless client auth."},
    {type:"choice", prompt:"Users near AP-2 report slow speeds even after the change. A Wi-Fi analyzer shows a neighbor's AP on channel 4. What's the most likely issue?", options:["Co-channel interference","Adjacent-channel (overlapping channel) interference","Incorrect antenna polarization","Insufficient DHCP scope"], answer:[1],
     explanation:"In 2.4 GHz, channels need to be 5 apart to avoid overlap. Channel 4 overlaps everything from 1 to 8, including AP-2's channel 6. That's adjacent (overlapping) channel interference; co-channel interference would mean both used channel 6."}]},

{ id:"b-acl", title:"Write the DMZ firewall rules", domain:"security", difficulty:2, objective:"4.3 Network security features",
  scenario:"A screened subnet (DMZ) holds a public web server (10.0.5.10) and a public DNS server (10.0.5.53). Admins on 10.0.1.0/24 need SSH to the web server. Anyone on the internet should reach the website securely and use the DNS server for queries. Everything else must be blocked. Rules are processed top-down; first match wins.",
  tasks:[
    {type:"fill", prompt:"Complete the inbound ACL.", columns:["#","Source","Destination","Protocol","Port","Action"],
     rows:[
      ["1","any","10.0.5.10","TCP",{answer:"443",options:["22","53","80","443","3389"]},{answer:"Allow",options:["Allow","Deny"]}],
      ["2",{answer:"10.0.1.0/24",options:["any","10.0.1.0/24","10.0.5.0/24"]},"10.0.5.10","TCP",{answer:"22",options:["22","23","443","3389"]},{answer:"Allow",options:["Allow","Deny"]}],
      ["3","any","10.0.5.53",{answer:"UDP",options:["TCP","UDP","ICMP"]},"53",{answer:"Allow",options:["Allow","Deny"]}],
      ["4","any","any","any","any",{answer:"Deny",options:["Allow","Deny"]}]],
     explanation:"Secure web traffic is HTTPS on TCP 443. SSH is TCP 22 and should only be allowed from the admin subnet. Standard DNS queries use UDP 53 (TCP 53 is used for zone transfers and large responses). The final rule is an explicit deny-all."},
    {type:"choice", prompt:"If rule 4 were moved to the top of the list, what would happen?", options:["Nothing changes because Allow rules take precedence","All traffic to the DMZ would be blocked","Only SSH would be blocked","DNS would still work because it uses UDP"], answer:[1],
     explanation:"With first-match processing, a deny-any at the top matches every packet, so no later Allow rule is ever reached."}]},

{ id:"b-topology", title:"Place devices in the network", domain:"security", difficulty:2, objective:"4.3 Network security features and defense",
  scenario:"You're drawing the network diagram for a new branch with an internet edge, a screened subnet for public services, an internal LAN, and an out-of-band management network.",
  tasks:[
    {type:"match", prompt:"Place each device in the zone where it belongs.", targets:["Internet edge","Screened subnet (DMZ)","Internal LAN","Out-of-band management"],
     items:[["Border router","Internet edge"],["Next-generation firewall","Internet edge"],["Public web server","Screened subnet (DMZ)"],["Reverse proxy","Screened subnet (DMZ)"],["Domain controller","Internal LAN"],["Database server","Internal LAN"],["Employee workstations","Internal LAN"],["Console server","Out-of-band management"]].map(([text,target])=>({text,target})),
     explanation:"Edge devices sit between the ISP and the network. Anything the public must reach lives in the screened subnet. Directory, database and user systems stay internal. A console server provides out-of-band access to device consoles when the production network is down."},
    {type:"choice", prompt:"Admins must reach internal servers from home without exposing RDP to the internet. What should be placed so admins connect through it?", options:["A honeypot","A jump box reachable over VPN","A load balancer","A proxy server in the LAN"], answer:[1],
     explanation:"A jump box (bastion host), reached over a VPN, gives a single hardened, monitored path to internal systems."}]},

{ id:"b-vlan", title:"Configure the access switch", domain:"implementation", difficulty:2, objective:"2.2 Switching technologies",
  scenario:"The new access switch uses VLAN 10 for staff, VLAN 20 for voice, VLAN 30 for the guest Wi-Fi AP (single SSID), and VLAN 99 for management. Gi0/24 connects to a router doing router-on-a-stick for all VLANs.",
  tasks:[
    {type:"fill", prompt:"Set the mode and VLAN for each port.", columns:["Port","Connected device","Mode","Access VLAN"],
     rows:[
      ["Gi0/1","Staff PC",{answer:"Access",options:["Access","Trunk"]},{answer:"10"}],
      ["Gi0/2","Staff printer",{answer:"Access",options:["Access","Trunk"]},{answer:"10"}],
      ["Gi0/3","Guest AP",{answer:"Access",options:["Access","Trunk"]},{answer:"30"}],
      ["Gi0/24","Router uplink",{answer:"Trunk",options:["Access","Trunk"]},"(allowed 10,20,30,99)"]],
     explanation:"End devices go on access ports in their VLAN. An AP broadcasting a single guest SSID only needs the guest VLAN. The router uplink carries every VLAN, so it's an 802.1Q trunk."},
    {type:"choice", prompt:"An IP phone with a staff PC daisy-chained behind it is connected to Gi0/5. How should the port be configured?", options:["Trunk with native VLAN 20","Access VLAN 10 with voice VLAN 20","Access VLAN 20 only","Access VLAN 99 with voice VLAN 10"], answer:[1],
     explanation:"The PC's untagged traffic uses the access (data) VLAN 10, while the phone tags its traffic for the voice VLAN 20."}]},

{ id:"b-wiremap", title:"Read the cable tester", domain:"troubleshooting", difficulty:2, objective:"5.2 Cabling and physical interface issues",
  scenario:"A newly terminated patch cable connects a PC to a wall jack, but the link light never comes on with an older switch that doesn't support auto-MDIX. You run a cable tester.",
  exhibit:"Wire map\nNear end  ->  Far end\n  1  --------  3\n  2  --------  6\n  3  --------  1\n  4  --------  4\n  5  --------  5\n  6  --------  2\n  7  --------  7\n  8  --------  8",
  tasks:[
    {type:"choice", prompt:"What does the wire map show?", options:["A straight-through T568B cable","A crossover cable (T568A on one end, T568B on the other)","A rollover (console) cable","A split pair"], answer:[1],
     explanation:"Pins 1 and 2 swap with 3 and 6, the classic crossover. A rollover reverses all eight pins (1 to 8, 2 to 7 and so on). A split pair still tests continuous pin-to-pin but mixes wires from different pairs."},
    {type:"choice", prompt:"Another cable in the patch panel is unlabeled. Which tool finds its far end?", options:["Cable tester","Toner and probe","Loopback plug","Optical time-domain reflectometer"], answer:[1],
     explanation:"A toner puts a signal on the wire and the probe picks it up at the other end, which is ideal for tracing unlabeled copper runs."}]},

{ id:"b-syslog", title:"Syslog severity and monitoring", domain:"operations", difficulty:1, objective:"3.2 Network monitoring",
  scenario:"You're setting up a syslog server and want alerts only for serious events, so you need to know the severity scale cold.",
  tasks:[
    {type:"order", prompt:"Order the syslog severity levels from 0 (most severe) to 7.", items:["Emergency","Alert","Critical","Error","Warning","Notice","Informational","Debug"],
     explanation:"0 Emergency, 1 Alert, 2 Critical, 3 Error, 4 Warning, 5 Notice, 6 Informational (also written Information), 7 Debug (also Debugging). A mnemonic: Every Alley Cat Eats Watery Noodles In Dishes."},
    {type:"choice", prompt:"You also poll the switches with SNMP. Which version adds authentication and encryption?", options:["SNMPv1","SNMPv2c","SNMPv3","SNMP traps"], answer:[2],
     explanation:"SNMPv3 adds user-based authentication and encryption. v1 and v2c send community strings in cleartext."}]},

{ id:"b-dr", title:"Disaster recovery metrics", domain:"operations", difficulty:1, objective:"3.3 Disaster recovery",
  scenario:"Leadership asks for a one-page summary of the DR plan. Match each metric and site type to its definition.",
  tasks:[
    {type:"match", prompt:"Match each definition to the right term.", targets:["RPO","RTO","MTTR","MTBF","Hot site","Cold site"],
     items:[["Maximum acceptable amount of data loss, measured in time","RPO"],["Maximum acceptable time to restore a service after an outage","RTO"],["Average time it takes to repair a failed component","MTTR"],["Average time a repairable system runs between failures","MTBF"],["Fully equipped, data replicated, ready to take over almost immediately","Hot site"],["Space and power only; equipment must be brought in","Cold site"]].map(([text,target])=>({text,target})),
     explanation:"RPO is about data (how far back you can afford to restore). RTO is about downtime. MTTR and MTBF describe component reliability. A warm site, not listed here, sits between hot and cold."}]},

{ id:"b-ipv6", title:"Identify IPv6 address types", domain:"concepts", difficulty:2, objective:"1.8 Modern environments: IPv6 addressing",
  scenario:"While reviewing a packet capture you see a mix of IPv6 addresses and need to know what each one is.",
  tasks:[
    {type:"match", prompt:"Match each address to its type.", targets:["Loopback","Link-local","Unique local","Global unicast","Multicast"],
     items:[["::1","Loopback"],["fe80::1c2a:7ff:fe41:9b02","Link-local"],["fd12:3456:789a::10","Unique local"],["2600:1f18:24e6::5","Global unicast"],["ff02::1","Multicast"],["ff02::2","Multicast"]].map(([text,target])=>({text,target})),
     explanation:"::1 is loopback, like 127.0.0.1. fe80 addresses are link-local and never routed. fd addresses (fc00::/7) are unique local, the IPv6 version of RFC 1918. Global unicast starts with 2 or 3 (2000::/3). Anything starting with ff is multicast: ff02::1 is all nodes and ff02::2 is all routers."},
    {type:"fill", prompt:"Write the shortest valid form of 2001:0db8:0000:0000:0000:ff00:0042:8329", columns:["Field","Your answer"],
     rows:[["Compressed address",{answer:["2001:db8::ff00:42:8329"]}]],
     explanation:"Drop leading zeros in each hextet (0db8 to db8, 0042 to 42), then replace the one longest run of all-zero hextets with ::."}]}
];

/* ---------- procedural labs ---------- */
const PORTS = [["FTP","20/21"],["SSH","22"],["Telnet","23"],["SMTP","25"],["DNS","53"],["DHCP","67/68"],["TFTP","69"],["HTTP","80"],["NTP","123"],["SNMP","161/162"],["LDAP","389"],["HTTPS","443"],["SMB","445"],["Syslog","514"],["SMTPS","587"],["LDAPS","636"],["SQL Server","1433"],["RDP","3389"],["SIP","5060/5061"]];
function genPorts(level){
  const chosen = shuffle(PORTS).slice(0, level===1 ? 5 : level===3 ? 9 : 7);
  const extra = shuffle(PORTS.filter(p=>!chosen.includes(p))).slice(0,2);
  const udpRight = pick(["TFTP","NTP","SNMP","DHCP"]);
  const udpWrong = shuffle(["SSH","Telnet","SMTP","SMB","SQL Server","LDAPS"]).slice(0,3);
  const opts = shuffle([udpRight,...udpWrong]);
  return { id:"gen-ports", title:"Ports and protocols", domain:"concepts", difficulty:1, objective:"1.4 Common ports and protocols", variant:true,
    scenario:"You're building firewall rules and need the well-known ports straight. Every attempt draws a fresh set.",
    tasks:[
      {type:"match", prompt:"Drop each protocol onto its default port.", targets:shuffle([...chosen,...extra].map(p=>p[1])), items:chosen.map(p=>({text:p[0],target:p[1]})),
       explanation:chosen.map(p=>`${p[0]} ${p[1]}`).join(", ")+"."},
      {type:"choice", prompt:"Which of these protocols uses UDP by default?", options:opts, answer:[opts.indexOf(udpRight)],
       explanation:`${udpRight} runs over UDP. ${udpWrong.join(", ")} use TCP.`}]};
}
const toIp = n => [n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join(".");
function genSubnet(level){
  const c = level===1 ? rnd(24,27) : level===3 ? rnd(17,30) : rnd(20,29);
  const f = pick([[10,rnd(0,255)],[172,rnd(16,31)],[192,168]]);
  const ip = [f[0],f[1],rnd(0,255),rnd(1,254)];
  const ipInt = ((ip[0]<<24)>>>0) + (ip[1]<<16) + (ip[2]<<8) + ip[3];
  const mask = (0xFFFFFFFF << (32-c))>>>0;
  const net = (ipInt & mask)>>>0, bc = (net | (~mask>>>0))>>>0, size = 2**(32-c);
  const host = toIp(ipInt);
  const inside = toIp(net + rnd(1, size-2));
  const wrong = [toIp(bc + 1 + rnd(0,40)), toIp(net - 1 - rnd(0,40)), toIp(bc)];
  const opts = shuffle([inside, ...wrong]);
  return { id:"gen-subnet", title:"Subnet calculator", domain:"concepts", difficulty:2, objective:"1.7 IPv4 addressing and subnetting", variant:true,
    scenario:`A host is configured as ${host}/${c}. Work out its subnet by hand, no calculator. Every attempt draws a new address and prefix.`,
    tasks:[
      {type:"fill", prompt:`Complete the table for ${host}/${c}.`, columns:["Value","Your answer"],
       rows:[["Network address",{answer:toIp(net)}],["Subnet mask",{answer:[toIp(mask),"/"+c]}],["Broadcast address",{answer:toIp(bc)}],["First usable host",{answer:toIp(net+1)}],["Last usable host",{answer:toIp(bc-1)}],["Usable hosts",{answer:String(size-2)}]],
       steps:subnetSteps(ipInt, c),
       explanation:`/${c} leaves ${32-c} host bits: 2^${32-c} = ${size} addresses, minus the network and broadcast = ${size-2} usable. The mask is ${toIp(mask)}; the network is ${toIp(net)} and the broadcast is ${toIp(bc)}.`},
      {type:"choice", prompt:`Which address could another host on the same subnet use?`, options:opts, answer:[opts.indexOf(inside)],
       explanation:`Usable hosts run from ${toIp(net+1)} to ${toIp(bc-1)}. ${toIp(bc)} is the broadcast address, and the others fall outside the subnet.`}]};
}
const GEN_LABS = [
  {id:"gen-ports", title:"Ports and protocols", domain:"concepts", difficulty:1, types:["match","choice"], gen:genPorts},
  {id:"gen-subnet", title:"Subnet calculator", domain:"concepts", difficulty:2, types:["fill","choice"], gen:genSubnet}
];
