# Contributing to Lab Bench

Thanks for helping. The two most valuable contributions are **new labs** and **accuracy fixes**.

## Ground rules for content

1. **Write everything yourself.** Never copy exam questions, the CompTIA objectives text, study guides or training materials. Reference objectives by number only (for example `"objective": "2.2"`).
2. **Be correct and unambiguous.** If more than one answer could be right, rewrite the question.
3. **Tag every item** with its N10-009 objective numbers.
4. **Run the tests** (`node build.js && node tests/run.js`) before opening a pull request.

## Adding a network sim

Add an object to `SIM_LABS` in `src/content/sims.js`:

```js
{ id:"s-example", title:"Sim: short title", domain:"troubleshooting", difficulty:2, objective:"5.3", objectives:["5.3","2.2"],
  scenario:"Symptoms the user reports. Don't reveal the faults.",
  tasks:[NET(null, {
    devices:[ /* hosts, switches, routers, cloud; see docs/SCHEMA.md */ ],
    links:[ ["pc1","NIC","sw1","Gi0/1"], ["r1","Gi0/0","sw1","Gi0/24", {cable:"cat6"}] ],
    goals:[ {type:"ping", from:"pc1", to:"8.8.8.8", label:"PC-1 can reach the internet"} ],
    solution:[ {dev:"pc1", set:{gw:"10.0.0.1"}} ],
    explanation:"Why the faults broke things and how the fix works."
  })]}
```

The tests require that at least one goal **fails** in the starting configuration and that applying `solution` makes **every** goal pass. Because grading checks real behavior, learners can fix things any valid way.

## Adding wireless labs, questions and definitions

- Wireless labs: `src/content/wifi-labs.js` (verified the same way).
- Definitions: add `[term, definition]` pairs to a group in `src/content/terms.js`. Each pair becomes two questions with distractors from the same group, so keep groups to one category.
- Scenario questions: add `[objective, question, options, correctIndex, explanation]` to `src/content/scenarios.js`.

## Extending the engine

The engine has no UI and no dependencies, so it's easy to test. If you add a feature (for example a new protocol or `show` command), add a case to `tests/run.js`. See `docs/SCHEMA.md` for every device, link, goal and solution field.
