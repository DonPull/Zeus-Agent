# Economical live-model checks

Reviewed: 2026-10-28. Primary hosted connection remains **Abacus ChatLLM/RouteLLM**. This is a diagnostic selection policy, not the later automatic role-routing feature.

4 November checkpoint: the current AA leaderboard still supports evaluating
modern economical models rather than returning to old 4.x/nano defaults. A
metadata-only real Abacus preflight confirmed exact `gpt-6.1-terra`, `gpt-6-luna`,
`gpt-6.1-sol` and `mimo-v2.6-pro`; no MiMo-V2.6-Flash ID was listed. Evidence:
`.zeus/evaluations/native-diagnostic-a19642c2-a59a-4ece-a696-4e1f2435ce70`.
It sent zero inference requests. The bounded matched pilot selects Terra/low,
explicit Chat, after AA listed that setting at index 29, average $0.07/task and
one minute/task. Those are AA's own workload/API observations, not Abacus credits
or Zeus task performance. [Dated selection and limits](BENCHMARK_BASELINE_CHECKPOINT.md),
[primary leaderboard](https://artificialanalysis.ai/leaderboards/models).
Actual protocol/image behavior remains a calibration outcome; no hidden fallback
or user model-setting change is permitted. Retained Luna failures remain valid.

## Decisions

- Replace familiar old-model defaults with a dated, task-specific shortlist checked against current benchmark evidence and the actual Abacus catalogue.
- Use deterministic regression/negative controls for software contracts and current economical live models for real protocol/perception/instruction-following checks. Neither replaces the other.
- Freeze exact model ID, provider, effort, image capability, protocol, limits and fixture/grader versions before a comparison. Changing the model creates a new configuration, not a retroactive repair of a failed trial.
- Prefer expected total cost per completed task over token unit price alone. Include reasoning tokens, repeated calls, helpers and corrections; keep provider subscription credits unknown until measured.
- Preserve every failed attempt. Diagnose model, harness, evaluator and operational causes separately. No repeated model upgrades or grader changes just to obtain a green report.
- Validate the chosen adapter before broad execution. Catalogue membership does not establish image input, reasoning-effort mapping, Responses/Chat compatibility or maximum output semantics.

## Current shortlist and evidence

Artificial Analysis model pages were read directly. Their current pages use **Intelligence Index v5.0**; older cached comparison pages can show different index values. Do not mix those versions or treat the index as a Zeus capability score.

| Candidate | AA v5.0 index | Public input/output price per million tokens | AA reported average cost/index task | Intended next check |
|---|---:|---:|---:|---|
| GPT-6 Luna low | 10 | $0.10 / $0.50 | $0.01 | Small latency-sensitive protocol/conversation checks |
| GPT-6 Luna medium | 18 | $0.10 / $0.50 | $0.04 | Initial general economical actor candidate |
| GPT-6 Luna high | 21 | $0.10 / $0.50 | $0.07 | Harder cases when medium is insufficient; separate frozen cell |
| MiMo-V2.6-Flash | 27 | $0.14 / $0.28 | $0.13 | Candidate once available through Abacus and adapter-validated |

Sources: [Luna low](https://artificialanalysis.ai/models/gpt-6-luna-low), [Luna medium](https://artificialanalysis.ai/models/gpt-6-luna-medium), [Luna high](https://artificialanalysis.ai/models/gpt-6-luna-high), [MiMo-V2.6-Flash](https://artificialanalysis.ai/models/mimo-v2-6-flash). These are public provider benchmark/pricing observations, **not Abacus credit charges** or prices for this user's subscription. AA's task cost incorporates its own workload/token consumption. MiMo's lower output unit price does not make every task cheaper: its measured output/reasoning volume is substantial. A lower effort is also not free capability: Luna's measured index changes materially with effort.

The previous live vision pair was **GPT-4.1 mini plus GPT-5 nano**. AA currently lists GPT-4.1 mini at $0.40/$1.60 and GPT-5 nano at $0.05/$0.40 per million input/output tokens; both lack a current v5.0 index on those pages. Do not manufacture a same-version intelligence comparison. [GPT-4.1 mini](https://artificialanalysis.ai/models/gpt-4-1-mini), [GPT-5 nano](https://artificialanalysis.ai/models/gpt-5-nano).

## Actual connection check

A separate hidden evaluation instance queried Abacus's model catalogue without sending any inference requests. On 2026-10-28 the available catalogue had **165 IDs**, including exact **`gpt-6-luna`** and `gpt-5.6-luna`. No MiMo-V2.6-Flash ID matched the returned catalogue. This establishes listed availability only, not a claim that every unlisted custom ID is rejected. Evidence: `.zeus/evaluations/manual-review-20261028/catalogue-preflight.json` (zero inference calls).

Stabilization live validation on 2026-10-28/29 used exact `gpt-6-luna` through Abacus with explicit Responses protocol, declared image support and medium effort; one separately fingerprinted low-effort comparison is also retained. Actual image perception, tool calls and direct artifact completion were observed. Seven trials used 49 requests and 153,720 reported tokens, with no missing usage; Abacus subscription credits remain unknown. The helper route still has completion/protocol failures, and one medium run exhausted its 8,192-token response allowance. Low effort used fewer tokens but failed the artifact/response contract, so it is not established as the better default. See [the exact results](STABILIZATION_PATCH_1.md). Do not generalize these few different builds/configurations into an intelligence/cost ranking or silently change existing task routes. Recheck the catalogue before selecting MiMo; no direct-provider or expired Xiaomi fallback was used. Automatic routing remains later work.

Choose task-appropriate limits that include reasoning and output, rather than blindly inheriting old nano-model output caps. Record caps and any exhaustion; do not treat a cutoff as a model's unconstrained capability. Larger sweeps still require a bounded task/model/trial envelope.
