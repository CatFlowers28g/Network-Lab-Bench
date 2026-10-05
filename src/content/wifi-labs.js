/* Lab Bench built-in wireless labs. Content: CC BY-SA 4.0. Verified by tests/run.js. */

"use strict";
const AP = (id, name, x, y, o) => ({id, name, x, y, band:"2.4", channel:1, width:20, power:"medium", ssid:"Corp", security:"wpa2-psk", antenna:"omni", heading:0, enabled:true, editable:true, ...o});
const CL = (id, name, x, y, o) => ({id, name, x, y, bands:["2.4","5"], security:["wpa2-psk","wpa3-sae","wpa2-ent","wpa3-ent"], ssid:"Corp", ...o});
const WIFI = o => ({type:"wifi", prompt:"Configure the access points so every requirement passes.", ...o});
const WIFI_LABS = [
{ id:"w-channels", title:"Wi-Fi: three APs stepping on each other", domain:"implementation", difficulty:2, objective:"2.3", objectives:["2.3","5.4"],
  scenario:"A warehouse runs three 2.4 GHz access points because its handheld scanners only support 2.4 GHz. Scanners drop off constantly. A Wi-Fi survey shows heavy channel overlap.",
  tasks:[WIFI({floor:{w:60, h:30}, aps:[AP("ap1","AP-1",10,15,{channel:1}),AP("ap2","AP-2",30,15,{channel:3}),AP("ap3","AP-3",50,15,{channel:6, width:40})],
    clients:[CL("c1","Scanner-A",12,22,{bands:["2.4"]}),CL("c2","Scanner-B",48,8,{bands:["2.4"]})],
    goals:[{type:"wifiNoOverlap", label:"No AP overlaps another AP's channel"},{type:"wifiClient", client:"c1", label:"Scanner-A has a clean signal of -67 dBm or better"},{type:"wifiClient", client:"c2", label:"Scanner-B has a clean signal of -67 dBm or better"}],
    solution:[{ap:"ap2", set:{channel:6}},{ap:"ap3", set:{channel:11, width:20}}],
    explanation:"Only channels 1, 6 and 11 don't overlap in 2.4 GHz, and only at 20 MHz. Channel 3 overlaps both 1 and 6, and 40 MHz in 2.4 GHz consumes most of the band."})]},
{ id:"w-5ghz", title:"Wi-Fi: move the office to 5 GHz", domain:"implementation", difficulty:3, objective:"2.3", objectives:["2.3"],
  scenario:"The office laptops support 5 GHz, but AP-1 still runs on 2.4 GHz and AP-2 and AP-3 use 80 MHz channels that overlap. Policy: avoid DFS channels (52 to 144). Get every laptop on 5 GHz with no overlap.",
  tasks:[WIFI({floor:{w:50, h:30}, aps:[AP("ap1","AP-1",8,15,{channel:6}),AP("ap2","AP-2",25,15,{band:"5", channel:36, width:80}),AP("ap3","AP-3",42,15,{band:"5", channel:44, width:80})],
    clients:[CL("c1","Laptop-1",8,22),CL("c2","Laptop-2",25,8),CL("c3","Laptop-3",42,22)],
    goals:[{type:"wifiNoOverlap", label:"No channel overlap"},{type:"wifiNoDfs", label:"No DFS channels"},{type:"wifiClient", client:"c1", band:"5", label:"Laptop-1 is on 5 GHz with a clean signal"},{type:"wifiClient", client:"c2", band:"5", label:"Laptop-2 is on 5 GHz with a clean signal"},{type:"wifiClient", client:"c3", band:"5", label:"Laptop-3 is on 5 GHz with a clean signal"}],
    solution:[{ap:"ap1", set:{band:"5", channel:149, width:40}},{ap:"ap2", set:{width:40}},{ap:"ap3", set:{width:40}}],
    explanation:"Wider channels bond 20 MHz channels together: at 80 MHz, 36 and 44 sit in the same 36 to 48 block. Outside the DFS range there are only two 80 MHz blocks (36 to 48 and 149 to 161), so 40 MHz is the practical width for three neighboring APs."})]},
{ id:"w-roam", title:"Wi-Fi: tablets drop in the hallway", domain:"troubleshooting", difficulty:2, objective:"5.4", objectives:["5.4","2.3"],
  scenario:"Nurses' tablets lose Wi-Fi walking down the 80 m ward hallway. AP-2 in the middle was installed but never enabled, and AP-3 was set up by a contractor. All APs should provide the same Corp network with WPA2-Enterprise.",
  tasks:[WIFI({floor:{w:80, h:20}, aps:[AP("ap1","AP-1",10,10,{band:"5", channel:36, ssid:"Corp", security:"wpa2-ent"}),AP("ap2","AP-2",40,10,{band:"5", channel:44, ssid:"Corp", security:"wpa2-ent", enabled:false}),AP("ap3","AP-3",70,10,{band:"5", channel:149, ssid:"Corp-5G", security:"wpa3-ent"})],
    clients:[CL("t","Nurse-Tablet",5,10,{security:["wpa2-ent","wpa3-ent"], path:[[5,10],[20,10],[40,10],[60,10],[75,10]]})],
    goals:[{type:"wifiRoam", client:"t", label:"Nurse-Tablet stays connected the whole way down the hallway"},{type:"wifiNoOverlap", label:"No channel overlap"}],
    solution:[{ap:"ap2", set:{enabled:true}},{ap:"ap3", set:{ssid:"Corp", security:"wpa2-ent"}}],
    explanation:"Seamless roaming needs overlapping coverage (about 15 to 20 percent) and identical SSID and security settings on every AP; a different SSID is a different network to the client."})]},
{ id:"w-sec", title:"Wi-Fi: lock down corporate and guest access", domain:"security", difficulty:2, objective:"2.3", objectives:["2.3","4.1"],
  scenario:"Corp Wi-Fi still uses a shared passphrase that former employees know. Policy: Corp must use 802.1X with the RADIUS server and the strongest encryption. Guest Wi-Fi must not need a password but must show the acceptable use policy on a captive portal first.",
  tasks:[WIFI({floor:{w:40, h:30}, aps:[AP("corp","AP-Corp",12,15,{band:"5", channel:36, ssid:"Corp", security:"wpa2-psk"}),AP("guest","AP-Guest",30,15,{band:"5", channel:149, ssid:"Guest", security:"wpa2-psk", captivePortal:false})],
    clients:[CL("lap","Corp-Laptop",14,22,{security:["wpa2-ent","wpa3-ent"]}),CL("ph","Visitor-Phone",30,22,{ssid:"Guest", security:["open","owe","wpa2-psk","wpa3-sae"]})],
    goals:[{type:"wifiConfig", ap:"corp", field:"security", equals:["wpa3-ent"], label:"Corp uses WPA3-Enterprise (802.1X)"},{type:"wifiConfig", ap:"guest", field:"captivePortal", equals:["true"], label:"Guest uses a captive portal"},{type:"wifiConfig", ap:"guest", field:"security", equals:["open","owe"], label:"Guest needs no password"},{type:"wifiClient", client:"lap", label:"Corp-Laptop connects"},{type:"wifiClient", client:"ph", label:"Visitor-Phone connects"}],
    solution:[{ap:"corp", set:{security:"wpa3-ent"}},{ap:"guest", set:{security:"owe", captivePortal:true}}],
    explanation:"Enterprise modes authenticate each user through 802.1X and RADIUS, so access ends when an account is disabled. Enhanced Open (OWE) encrypts guest traffic without a password; open plus a captive portal also satisfies the requirement."})]},
{ id:"w-bridge", title:"Wi-Fi: link the two buildings", domain:"implementation", difficulty:2, objective:"2.3", objectives:["2.3"],
  scenario:"A point-to-point wireless bridge must join the main office and the warehouse 100 m away. The two bridge radios came with omnidirectional antennas and the installer set them to different channels.",
  tasks:[WIFI({floor:{w:110, h:40}, aps:[AP("a","Bridge-Main",5,20,{band:"5", channel:149, width:40, power:"high", ssid:"Bridge", security:"wpa3-sae"}),AP("b","Bridge-Warehouse",105,20,{band:"5", channel:157, width:40, power:"high", ssid:"Bridge", security:"wpa3-sae", heading:180})],
    clients:[], goals:[{type:"wifiLink", a:"a", b:"b", label:"The bridge link is up at -70 dBm or better"}],
    solution:[{ap:"a", set:{antenna:"directional", heading:0}},{ap:"b", set:{antenna:"directional", heading:180, channel:149}}],
    explanation:"Directional antennas focus energy in one direction for long point-to-point links; omnidirectional antennas spread it in all directions for client coverage. Both ends must also share the channel."})]},
{ id:"w-dfs", title:"Wi-Fi: disconnects near the airport", domain:"troubleshooting", difficulty:2, objective:"2.3", objectives:["2.3","5.4"],
  scenario:"A clinic near an airport reports clients randomly disconnecting several times a day. Logs show the APs abruptly changing channels after radar detection. Move every AP off DFS channels without creating overlap.",
  tasks:[WIFI({floor:{w:50, h:30}, aps:[AP("ap1","AP-1",8,15,{band:"5", channel:52}),AP("ap2","AP-2",25,15,{band:"5", channel:100}),AP("ap3","AP-3",42,15,{band:"5", channel:36})],
    clients:[CL("c1","Exam-1",8,22),CL("c2","Exam-2",25,22),CL("c3","Exam-3",42,22)],
    goals:[{type:"wifiNoDfs", label:"No AP uses a DFS channel"},{type:"wifiNoOverlap", label:"No channel overlap"},{type:"wifiClient", client:"c1", label:"Exam-1 connects cleanly"},{type:"wifiClient", client:"c2", label:"Exam-2 connects cleanly"}],
    solution:[{ap:"ap1", set:{channel:44}},{ap:"ap2", set:{channel:149}}],
    explanation:"Channels 52 to 144 are DFS channels. Under 802.11h, an AP must leave the channel when it detects radar, which drops clients. Channels 36 to 48 and 149 to 165 don't require DFS."})]}
];
