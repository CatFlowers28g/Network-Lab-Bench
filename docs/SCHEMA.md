# Lab Bench data schema

All labs are JSON-compatible objects: `{id, title, domain, difficulty (1-3), objective, objectives:[], scenario, exhibit?, tasks:[...]}`.

## Task types

| type | fields |
| --- | --- |
| `net` | `devices`, `links`, `goals`, `solution`, `explanation` (network simulator) |
| `wifi` | `floor {w,h}` in meters, `aps`, `clients`, `neighbors?`, `goals`, `solution` |
| `cli` | scripted terminal: `shell`, `promptText`, `commands [{cmd:[...], output}]`, `question` |
| `fill` | configuration table: `columns`, `rows` of fixed text or `{answer, options?}` cells |
| `match` | `targets`, `items [{text, target}]` |
| `order` | `items` in correct order |
| `choice` | `options`, `answer [indexes]`, `multi` |

## Devices (`net`)

Common: `id`, `kind`, `name`, `x`, `y` (0-100 diagram position), `editable` (default true), `power` (default true).

- **Hosts** (`pc`, `laptop`, `server`, `printer`, `phone`, `ap`): `mode` (`static`/`dhcp`), `ip`, `mask`, `gw`, `dns`, `os` (`windows`/`linux`), `nic {speed, duplex, mtu}`, `services ["tcp/443"]`, `hosts {name: ip}`, `fw {enabled, rules [{action, proto, port, src}]}` (stateful, like a security group), `publicIp`, `poe {std: af|at|bt, watts, injector}`, `voiceVlan`, `mac`.
  - DNS servers: `zone [{name, type: A|AAAA|CNAME|MX|TXT|NS|PTR, value}]`, `forwarder`.
  - DHCP servers: `dhcp [{network: "10.0.0.0/24", start, end, gw, dns, exclusions [...], reservations [{mac, ip}]}]`. `rogue: true` marks a rogue server.
  - Attack flags: `macFlood`, `arpSpoof: "<gateway ip>"`, `dtp` (negotiates trunks).
- **Switches** (`switch`, `l3switch`): `ports [{name, mode: access|trunk|dynamic, vlan, voice, allowed: "all"|"10,20", native, shutdown, speed, duplex, mtu, sfp, poe, trusted, portSecurity {enabled, max, violation}, channel, lacp: on|active|passive}]`, `stp {enabled, priority}`, `dhcpSnooping`, `dai`, `poeStd`, `poeBudget`, `vlanNames`, `mac`. Layer 3 switches also take router fields with SVIs named `Vlan10`.
- **Routers** (`router`, `firewall`, `natgw`, `igw`): `ifaces [{name, vlan (802.1Q tag) , ip, mask, helper, nat: inside|outside, acl, aclOut, vip, vipPriority, track, mtu, ospfCost, shutdown, routes? (per-subnet route table)}]`, `routes [{net, via, ad}]`, `defaultRoute`, `ospf {enabled, area, passive []}`, `acls {NAME: [{action: permit|deny, proto: ip|icmp|tcp|udp, src, dst, port}]}`, `publicIp` (NAT gateway).
- **Internet** (`cloud`): `ip` (the ISP next hop), `records {name: ip}`.

## Links

`[devA, portA, devB, portB, {cable: cat3|cat5|cat5e|cat6|cat6a|cat8|smf|mmf|dac, length (m), util (0-1), txrx, dbm, crosstalk, splitPair}]`. Host ports are `NIC`; the cloud's port is `WAN`; router subinterfaces like `Gi0/0.10` ride on `Gi0/0`.

## Goals

- `{type:"ping", from, to (IP or name), expect?, size?, df?, secure?}`
- `{type:"conn", from, to, proto, port, expect?}`
- `{type:"dhcp", host, server?, ip?}`
- `{type:"dns", from, name, rtype, value, expect?}`
- `{type:"perf", from, to, minMbps?, maxLoss?, maxLatency?}`
- `{type:"config", dev, port?, iface?, field, equals []}`
- `{type:"state", check: root|noStorm|portUp|powered|bundle|noVlanHop|macSafe|arpSafe|unusedDown|route|ospfNeighbor, ...}`

## Solution steps

`{dev, set}`, `{dev, port, set}`, `{dev, iface, set}`, `{dev, pool, set}`, `{dev, acl, rules}`, `{dev, routes}`, `{dev, zone}`, `{link:[dev, port], set}`.

## Wireless

APs: `{id, name, x, y, band: "2.4"|"5"|"6", channel, width, power: low|medium|high, ssid, security: open|owe|wpa2-psk|wpa2-ent|wpa3-sae|wpa3-ent, antenna: omni|directional, heading, enabled, captivePortal, bandSteering}`. Clients: `{id, name, x, y, bands, security [supported], ssid, path? [[x,y],...]}`. Goals: `wifiClient`, `wifiNoOverlap`, `wifiNoDfs`, `wifiRoam`, `wifiLink`, `wifiConfig`.
