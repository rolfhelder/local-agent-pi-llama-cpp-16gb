# Qwen27B speed improvement checklist

Goal set 2026-10-24: **at least 98,304 tokens of configured context and at least 15 generated tokens/second**, keeping the existing **Qwen3.8-27B UD-IQ4_XS** weights. Prefer 131,072 if it meets the same speed and quality gates. Completed on the development machine on 2026-10-24. The selected default is 98,304 tokens with a 19.01-TPS median in Pi App. Checked conditional items below describe their disposition; they do not imply every optional experiment was run.

## Constraints and acceptance

- [x] Pin the existing model revision and SHA256 (`4ca720788d1e01f1bff70c033e0d0028fd02e502`, SHA256 `40fac4050e940397dbf13087afd50f4734a11805bf9d65ef8ddd7483470e6199`, verified locally). No lower-bit replacement, pruning, ablation or model substitution.
- [x] Keep reasoning enabled, its effort/budget and sampling identical within each comparison. Reducing reasoning is not a TPS optimization.
- [x] Retain the current q4_0 KV baseline; do not reduce cache precision further. Label any separately approved cache-format experiment.
- [x] Run one model and one inference request at a time. Preserve each configuration and its logs; never silently enable automatic context shrinking.
- [x] Require a completed approximately 90%-full context test, exact 5/5 recall, valid JSON and no unexpected tool calls. Allocation alone is insufficient.
- [x] Require at least 15 generation TPS on representative reasoning/code output at long occupancy, not just an empty or 8k prompt. Measure 98,304 and, if practical, 131,072 separately.
- [x] Repeat promising speed conditions three times, retaining every result. Report median and token-weighted generation TPS, prompt TPS, prompt-to-answer latency, actual prompt/output tokens, and variation. Include approximately 8k, 50k and near-90%-full inputs to expose context-dependent slowdowns.
- [x] Record total GPU usage, per-process dedicated/shared GPU usage, available RAM and system commit headroom. Avoid sustained shared-GPU spill; record background-process changes rather than attributing them to a model optimization.
- [x] Recheck a fixed small coding/tool task against the unchanged baseline before promoting a winner. Speed or recall alone does not establish equivalent coding quality.

## Experiments, in order

1. [x] **Find the minimum CPU offload at 98,304 context.** Test fewer FFN layers than 12, one configuration at a time, stopping failed allocations before trying the next. Measure actual dedicated/shared GPU usage; a load that spills and becomes slow is not a useful fit. Repeat the best placement at 131,072 if memory permits.
2. [x] **Tune CPU threads on the winning placement.** Inspect physical/performance/efficiency cores, then compare a small set of generation and batch thread counts. Change no other setting. More threads are not automatically faster.
3. [x] **Improve tensor placement with the same weights.** Inventory per-layer FFN byte sizes and compare the current first-N selection with explicit largest-FFN and upper-layer placement. Keep the memory target comparable. Use supported `--override-tensor`; verify the installed engine rather than assuming a proposed `--n-cpu-mode` flag exists.
4. [x] **Test compatible MTP with the same Q4 main model.** Inspect embedded MTP first; verify revision/hash and compatibility before obtaining any external head. Compare MTP off, depth 1 and depth 2; record accepted draft tokens, main-model TPS and end-to-end time. Rebalance CPU offload if needed, and include that cost in the comparison. Reject malformed tools, instability or quality regressions.
5. [x] **Inspect CUDA graph behavior.** For CPU-offloaded MTP, compare graphs on/off only if logs show repeated graph recapture or a reproducible bottleneck. Keep rollback and record environment variables.
6. [x] **Tune prompt processing separately.** Compare a small set of batch/microbatch sizes after choosing a decode configuration. A prefill improvement does not count as meeting the 15-TPS generation target; preserve memory margin.
7. [x] **Consider a separate pinned llama.cpp build only if needed.** First identify a relevant documented fix or kernel improvement. Keep the existing executable available, use the same model and test conditions, and run correctness/tool checks. No driver or Windows-policy changes as part of this checklist.
8. [x] **Promote the measured winner.** Set both launchers to a configuration satisfying all gates. If none meets 98,304 + 15 TPS, report the shortfall and retain the best validated fallback; do not lower model precision or claim success from a short-context benchmark.

## Existing evidence

| Condition | Observation | Limitation |
|---|---|---|
| 64k, 8 CPU FFN layers | Approximately 14.5 generation TPS in earlier localization runs | Below the requested context; different workload |
| 131,072, 12 CPU FFN layers | 5/5 recall at 117,732 input tokens; 368.71 prompt TPS, 9.01 generation TPS; peak GPU 15,880 MiB | One short generated answer, not a sustained speed benchmark |
| 163,840, 12 CPU FFN layers | Loads, but observed roughly 1 GB shared GPU memory and sharply slower prefill | Failed the ten-minute inference bound; recall unassessed |

## Measured profile (2026-10-24)

The unchanged GGUF contains an embedded MTP head, so no additional weights were needed. All following runs retained q4_0 KV, enabled medium reasoning with a 2048-token budget, and used the installed b11669 engine. Speed runs deliberately stop at 512 generated tokens; they measure throughput and do not grade the unfinished program.

| Context | CPU FFN placement | Microbatch | Actual input | Generation TPS, three repeats | Outcome |
|---:|---|---:|---:|---|---|
| 98,304 | Largest four groups | 128 | 88,146 | 17.83 / 17.82 / 17.87 | Speed floor met |
| 98,304 | Largest four groups | 64 | 88,146 | 17.81 / 17.84 / 17.84 | Less GPU buffer memory |
| 98,304 | Largest two groups | 64 | 88,146 | 16.93 / 16.99 / 16.95 | More shared GPU memory |
| 98,304 | Largest three: 58, 59, 63 | 64 | 88,146 | 19.03 / 19.08 / 19.08 | Selected; recall, repair and Pi App passed |
| 98,304 | Same three, 24 threads | 64 | 7,866 | 23.92 / 23.90 / 23.98 | Short-input control |
| 98,304 | Same three, 24 threads | 64 | 49,674 | 21.14 / 21.17 / 21.22 | Intermediate-input control |
| 98,304 | Same three, 32 threads | 64 | 88,146 | 18.71 / 18.68 / 18.64 | Slower than 24 threads |
| 131,072 | Largest six groups | 64 | 117,638 | 12.70 / 12.75 / 12.64 | Below speed floor |

MTP depth 1 and 2 reached 13.95 and 25.48 TPS respectively in short-input screens with eight CPU groups. Depth 2 with twelve CPU groups at 131,072 did not finish prefill within ten minutes; no generation score or quality conclusion follows. A separate early 131k run hit a benchmark HTTP-client timeout and is excluded; the client was repaired before the completed three-repeat result above.

The leading three-group run peaked at 15,936 MiB total adapter use, with 100,663,296 bytes of process shared GPU allocation and at least 7.08 GB free system RAM. Its cold prefill took 177.34 seconds (497.06 prompt TPS). Those gates subsequently passed as recorded below. Short-input screens are not substitutes for these long-input measurements.

## Final acceptance and limits

Both `local-ai` and `local-ai-app` now select the measured Qwen profile by default. Native context remains 262144 in model metadata; the operating slot is 98304. Explicit larger-context overrides are experimental and need a different validated offload placement. This is the winning tested speed profile, not a global maximum.

| Input occupancy | Generation median / weighted TPS | Range | Cold prompt TPS | Cold prefill | Cold request through 512 output tokens |
|---|---:|---:|---:|---:|---:|
| 7,866 tokens, CLI/API | 23.92 / 23.93 | 23.90–23.98 | 623.66 | 12.61 s | 34.03 s |
| 49,674 tokens, CLI/API | 21.17 / 21.18 | 21.14–21.22 | 569.29 | 87.26 s | 111.53 s |
| 88,146 tokens, CLI/API | 19.08 / 19.06 | 19.03–19.08 | 497.06 | 177.34 s | 204.38 s |
| 88,146 tokens, Pi App open | 19.01 / 19.01 | 19.00–19.02 | 507.70 | 173.62 s | 200.70 s |

Each row contains three 512-token generations. Only the first request is cold; subsequent requests reuse 88,142 prompt tokens in the long-context condition. Weighted TPS is `sum(generated tokens - 1) / sum(generation seconds)`, following this engine's timing convention. The generations include reasoning and partial code and end at their deliberate output cap. They are not completed LRU implementations. Full per-run usage, cache counts, timings and failed alternatives are in the [sanitized measurement data](../evaluation/QWEN38-PERFORMANCE-2026-10-24.json).

Exact recall through native Pi passed **5/5**, valid JSON and no tools, at **88,237 input tokens** (about 90% of the slot). Reasoning stayed enabled. The separate repair task passed under both the first-eight-FFN baseline and selected placement: each observed the initial failing test, inspected and minimally edited the source, preserved the public checks, reran them, passed **1,785 hidden assertions**, and ended normally. Each used six tool calls. Prompt-to-answer times were 79.56 s and 39.44 s respectively. This is one small regression case, not proof of unchanged quality on arbitrary coding tasks or useful reasoning across the full context.

With Pi App and its idle Code-local worker loaded, peak total GPU use was **15,973 / 16,376 MiB**. The server's sampled dedicated allocation was 15,487,082,496 bytes and shared allocation 100,663,296 bytes, consistent with the selected placement's before/after counters. A small shared allocation does not prove active paging; no zero-paging claim is made. At least **5.47 GB** RAM was available, peak system commit was **48.58 GB**, and minimum commit headroom **14.53 GB**. Commit includes allocations beyond physically resident RAM. OneDrive stayed off throughout these comparisons; its earlier removal is not credited to tensor placement. Other GPU applications can consume the roughly 400 MiB remaining adapter margin.

### Disposition of each experiment

1. **Offload size:** screened zero, two, four, six and eight first CPU FFN groups and explicit placements. Long runs compared two, three and four largest groups at 96k. Three won among these completed conditions. At 131k, six largest groups completed at about 12.7 TPS; twelve first groups had earlier passed recall at 9.01 TPS. Larger allocation alone did not meet the speed target.
2. **Threads:** Windows CPU-set enumeration reported 16 logical processors on sixteen efficiency-class-0 cores and 16 logical processors on eight class-1 cores. Screening used 4/8/12/24/32 threads; the winning placement was then repeated at 24 and 32. Their long-input medians were 19.08 and 18.68 TPS. No affinity or Windows scheduling policy was changed.
3. **Placement:** inventoried tensor byte sizes, compared first-N, largest and upper-layer groups, and verified actual CPU model buffers in engine logs. Production uses an anchored tensor rule for groups 58, 59 and 63, excluding attention tensors and embedded MTP layer 64. Unit checks verify that rule.
4. **MTP:** used the embedded head in the same hash-verified GGUF, avoiding an extra download. Depth-1/depth-2 short screens reached 13.95/25.48 TPS with eight CPU groups. Depth 2 accepted 153 of 203 draft tokens across 102 calls. The 131k/twelve-largest-group depth-2 run hit the explicit ten-minute prefill deadline before generation. MTP was rejected for this default; its coding quality was not assessed or claimed. The selected profile has MTP off.
5. **CUDA graphs:** inspected logs. The short MTP run recorded graph transitions around prefill/decode, with only two reallocations after prefill across 102 draft calls. This did not establish the reported per-step recapture bottleneck. The conditional graphs-off experiment was therefore not triggered; graphs remain enabled.
6. **Microbatch:** 128 and 64 at the same four-group placement both reached about 17.8 TPS; 64 lowered peak total GPU use from 15,943 to 15,807 MiB. The selected three-group configuration retained 64. Prefill and decode are reported separately.
7. **Engine build:** a separate build was unnecessary: the installed pinned b11669 passed the target and regression gates. No driver, Windows-policy or pagefile changes were made.
8. **Promotion:** both launcher previews and actual Pi App startup reported 98,304 context, q4 KV, the exact three-group rule and 24 threads. Native Pi recall/repair passed; the desktop had three stable long-input generations. All 23 runtime/UI/effort unit checks passed. Model SHA256 was reverified after testing. The app and owned server exited; ports were released and total GPU use returned to 1,076 MiB. Raw private traces remain local; no push was performed.

An early non-streaming benchmark request encountered an HTTP-client timeout while the server was still working; it remains excluded from model grading. The client was given an explicit ten-minute deadline before the completed rerun. The desktop close command lost its CDP reply during shutdown, but the launcher exited successfully and independent port/GPU checks confirmed cleanup; this was not an inference failure.

Pre-push verification also passed the complete repository unit suite: **130 tests, zero failures**. The POSIX dry-run assertion now checks the new Qwen default; this remains argument/configuration verification on Windows, not native macOS/Linux inference validation.

## Research basis

An upstream contributor measured better speed per byte offloaded by selecting different FFN bands, especially with MTP. The proposed convenience flag is a feature request; the useful experiment is explicit placement. [FFN placement measurements](https://github.com/ggml-org/llama.cpp/issues/27987).

A separate report uses our exact IQ4_XS model revision with an external MTP head and reports a substantial speedup. Its headline 50.2 TPS used only an 8k window with full GPU offload, so it is motivation to test, not a prediction for our long-context CPU-offloaded configuration. [MTP configuration and limitations](https://github.com/ggml-org/llama.cpp/discussions/30328).
