# Lab Bench

**Free, open-source, hands-on practice for the CompTIA Network+ (N10-009) exam.**

Lab Bench is a network simulator and study app in a single HTML file. Open it in any browser, on a phone or a computer, with no install and no account. It works offline.

> Lab Bench is independent study software aligned to the N10-009 exam objectives. It is not affiliated with, endorsed by, or sponsored by CompTIA. CompTIA and Network+ are trademarks of CompTIA, Inc. It contains no CompTIA exam questions or copyrighted CompTIA text.

## What's inside

- **Learn by topic and level.** Labs are grouped into 11 topics (Basics, Addressing, Switching, Routing, DHCP & DNS, Wi-Fi, Cabling, Security, Cloud, Operations, Troubleshooting) with Easy, Medium and Hard levels, and you can build your own learning path.

- **Network simulator.** Click a PC, switch, router or firewall to configure it, then open its terminal and run real commands: `ipconfig`, `ping`, `tracert`, `nslookup`, `arp -a`, `netstat`, `ip addr`, `dig`, `tcpdump`, `nmap`, and about 20 Cisco-style `show` commands. Grading checks whether the network *actually works*, so any valid fix counts.
- **25 built-in network sims** covering VLANs and trunks, router-on-a-stick, Layer 3 switches, static routes, OSPF and route selection, NAT/PAT, ACLs, FHRP, spanning tree, LACP, duplex, cabling and transceivers, PoE, port security, DHCP scopes and relays, DNS records, jumbo frames, rogue DHCP, ARP spoofing, VLAN hopping, native VLAN leaks and a cloud VPC.
- **Endless random fault hunts.** A generator builds a working network, plants 1 to 3 realistic faults, and keeps the lab only if the engine proves it's broken and fixable.
- **6 wireless labs** on a floor plan: channel overlap, 5 GHz migration, roaming, enterprise and guest security, point-to-point bridges and DFS, with a Wi-Fi analyzer.
- **Question practice** for all 25 objectives: about 400 original definitions, 82 scenario questions, all 20 exam ports, acronyms, and endless subnetting and IPv6 questions, with spaced repetition.
- **Timed practice exams** weighted like the real exam, with performance-based labs first and a score report by domain and objective.
- **Step-by-step help.** Sims have a three-level hint ladder (where to look, which command confirms it, the fix and why) built from the engine's own diagnosis. Subnetting and IPv6 questions show the exact working. With AI enabled, any question or lab gets a walkthrough of its answer key.
- **Progress tracking** by objective, and **Anki export** of everything you get wrong.
- **Optional AI lab creation** with your own Anthropic API key. AI-made sims are verified by the simulator before they're saved.

## Use it

Download `dist/lab-bench.html` and open it, or use the hosted copy if this repository has GitHub Pages turned on (the root `index.html` opens the app). That's it. Progress is saved in your browser; use **Settings, Download backup** to move it between devices.

To host it, put `dist/lab-bench.html` on any static host (GitHub Pages works).

## Build and test

Node 18 or newer, no dependencies:

```
node build.js        # builds dist/lab-bench.html and dist/engine.cjs
node tests/run.js    # verifies every sim, 250 generated labs, every terminal command and the question bank
npm install && npm run test:ui   # optional: clicks through every screen looking for display bugs
```

## Project layout

```
src/engine/   simulation engine (no UI): core.js (addressing, physical layer, STP, LACP, PoE, layer 2),
              l3.js (routing, OSPF, NAT, ACLs, FHRP, DHCP, DNS, goals), cli.js (terminals), wifi.js,
              faults.js (random fault generator), questions.js (question generators, spaced repetition)
src/content/  sims.js, wifi-labs.js, legacy-labs.js, terms.js, scenarios.js
src/app/      user interface
tests/        test suite
docs/         contributor and schema docs
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New labs are plain JavaScript objects; the test suite proves each sim starts broken and that its solution fixes it.

## License

Code: MIT ([LICENSE](LICENSE)). Lab and question content in `src/content/`: CC BY-SA 4.0 ([CONTENT-LICENSE.md](CONTENT-LICENSE.md)).
