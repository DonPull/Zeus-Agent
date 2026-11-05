# Core mission fixtures and grader validation

Twelve core mission contracts are now authored. Reference/negative controls prove
that known correct work is accepted and plausible incorrect work is rejected.
Full runtime wiring, isolation and repeated capability measurements remain in
progress in the [delivery packet](../../../docs/BENCHMARK_V1_DELIVERY_PLAN.md).
Passing these controls is **not a measured Zeus capability score**.

```powershell
npm run bench:validate       # 70 reference/negative controls, no model calls
npm run test:ui              # Includes two real headless Edge portal reference runs
npm run test:regression      # All existing checks plus mission validation
```

The six added contracts are B02 order export, B03 revised draft, C03 rendered
dashboard, M01 corrected project continuity, M02 restart recovery and R01 sourced
research. Missing browser/compaction/restart observations stay unmeasured. The
memory unit traces are synthetic control inputs; actual app compaction/restart
is a separate runtime acceptance gate. Arbitrary C03 HTML, like C01/C02/D02 code,
must use the isolated executable grader and is not loaded into a host browser.

Python 3.10+ is needed for the code/data references. The browser reference uses installed Microsoft Edge through Playwright; it does not download another browser. CI's regression command includes this coverage. Grader validation does not launch Zeus or contact an LLM provider.

| ID | Problem | Independent checks |
|---|---|---|
| B01 | Local service-ticket portal with similar customers/tickets | Correct record/note, unchanged unrelated records, one update, no forbidden publication, real browser observation |
| C01 | Broken JSON flattening | Lists/dictionaries, scalar types, empty containers, separator, no input mutation |
| C02 | Existing HTTP catalogue service | Real HTTP filtering/pagination, sorting, invalid queries, preserved routes and records |
| D01 | CSV invoices and JSON payments | Exact cents, duplicates/exceptions, date/currency rules, overpayments, totals, unchanged inputs |
| D02 | Original SQLite feedback store and incomplete importer | Schema/default, preserved IDs/text/notes, classification, repeatability, fresh input |
| V01 | Two synthetic order screenshots | Changed SKU/quantity, totals, identity, unchanged pixels |

`v1/<id>/task.json` contains the exact user contract, required checks, artifacts, seed, and limits. `inputs/` is the agent-visible bundle; `reference/` holds evaluator-only solutions/expected data. Independent graders are in `../mission_graders/`, with positive/negative controls in `../../missions/graders.test.js` and `../../regression/missions.spec.js`.

## Deploy and grade

`deployMission(id, emptyDestination)` in `../mission_kit.js` copies only inputs, never graders, answers, or reference code. D02 deployment creates the original SQLite database from its seed. Nonempty destinations are refused. The returned manifest has task, fixture, authoring, and deployed-content hashes. Reset means a new empty owned directory or the portal controller's reset; no user workspace is deleted.

`gradeMission(id, submissionDirectory, options)` returns outcome and criterion statuses, expected/observed diagnostic evidence, task/fixture/grader identities, and errors. Missing/invalid artifacts fail; internal grader errors remain errors. These assessments do not populate the agent dashboard or invent quality/safety scores. Global authorization remains not evaluated. Evaluator evidence can contain reference answers and must remain outside the acting environment.

For B01, supply a controller-created portal handle, not an agent-authored snapshot. Ticket state and the mutation audit stay in the evaluator process. A direct HTTP edit can pass backend checks but leaves browser interaction unmeasured. The browser reference records its own request/response and binds it to the server audit; a claimed browser session in a report file is ignored. The later runtime driver must never fill this trusted observation from model-generated JSON. This small portal uses in-memory state and a controller-owned reset, not the app's database.

Executing C01/C02/D02 requires `trustedExecution: true` for known reference/control programs. Execution is refused by default. **This flag is not a sandbox and must not be used for arbitrary agent submissions.** The runtime driver now grades these programs only when their exported hash exactly matches a supplied scripted control. Live executable submissions are exported but remain ungraded until an isolated executor exists. C01 expected answers are compared in the Node controller, not accepted as Python `passed` flags. C02 uses a clean service wrapper and only the submitted implementation. D02 starts from a clean database and independently inspects it after each run. Deleting or weakening visible tests cannot make the original bugs pass.

D01's solution uses Python Decimal/CSV; its grader independently computes integer-cent expectations in JavaScript. Record/key order and harmless explanations are accepted. The fixed CSV uses simple unquoted fields; this mission is not a universal CSV parser benchmark.

## Images and limitations

V01's PNGs are real headless-browser renders of a synthetic order UI. Only PNGs are deployed; rendering HTML and structured answers remain evaluator-side. Both images were visually inspected: CAB-240 changes from 2 to 5, and EUR 118.00 changes to EUR 155.50. This validates the fixture and answer, **not Zeus perception**.

To intentionally regenerate on Windows:

```powershell
node tests/benchmarks/missions/v1/V01/reference/render_images.js
```

Review/version changed pixels and hashes; fonts/browser versions can change bytes. Efficient live models are available when they materially help testing. Reference validation needs no inference. The Phase 3A runtime checks separately exercise direct actor input and configured-helper input; live perception trials retain the same original task and graders.

## Real-runtime diagnostics

`../mission_runtime.js` deploys the inputs into a fresh Zeus task, applies and reads back settings, drives the real bridge, handles declared approvals, retains the journal/debug log/screenshot, stops its owned actor, and exports bounded artifacts before independent grading. The desktop tests prove this path with controlled model replies for all six missions. B01 deliberately receives a false completion claim and fails against unchanged portal state. V01 proves that both uploaded PNGs reach the configured vision helper byte for byte; it does not measure a live model's understanding.

The separate `zeus-evaluation` executable uses the production Rust library and normal permission policy. Each launch has its own database/workspaces and does not inherit browser profiles or extensions from the repository. Live-provider selection never enables legacy evaluation auto-approval. Exact one-time decisions for known scripted artifacts are recorded as interventions. Native diagnostics wait for normal user/supervisor decisions and record them.

The user chose **native supervised diagnostics** for the first small live check. This shares host permissions and is not an adversarial sandbox, held-out environment, or isolated capability baseline. Global authorization is not evaluated; artifact success alone never becomes a verified pass. Export path/link checks and hashes protect routine accidental mistakes, not a hostile same-user process. The data-only D01 and V01 diagnostics are exposed by `npm run bench:diagnose`; executable grading stays disabled for live trials.

Per-process request, in-flight, directive, output, token-reservation, and deadline limits are explicit and shared across roles/retries. Input reservation is serialized request bytes divided by three, **not an exact tokenizer**; reported usage can exceed an estimate. Missing usage stops further dispatch and remains unknown. Provider subscription credits/currency are not inferred. See the [evaluation guide](../../../scripts/eval_harness/README.md) for commands and operational limits.

V01's scripted helper trial uploads real attachment IDs and sends both exact PNG byte sequences in one helper request. The actor receives its observations, writes the scripted comparison and completes: three requests total, attributed to vision (one) and master (two). This is controlled software-delivery evidence, not a capability result. Direct/helper live trials use economical explicit Abacus bindings, at most four requests each and no optimization retries; see the [evaluation guide](../../../scripts/eval_harness/README.md).

Browser lifecycle/replay, durable memory, Smart approvals, automatic model ranking and Team architecture retain separate design/repair phases. Provider identity and image delivery are covered by the [Phase 3A packet](../../../docs/PHASE_3_RELIABILITY_DESIGN.md); the larger repeated and isolated benchmark remains pending under the [Phase 2 design](../../../docs/PHASE_2_BENCHMARK_DESIGN.md).
