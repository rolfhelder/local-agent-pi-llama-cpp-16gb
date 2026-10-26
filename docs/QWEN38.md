# Qwen3.8 27B on a 16 GB GPU

This is the main model setup path. It applies the profile measured on Windows, RTX 4090 Laptop (16,376 MiB VRAM), i9-14900HX and 32 GB RAM, with llama.cpp b11669 and Pi 1.3.0. A different CPU, display workload or GPU can change the result.

## 1. Install the core stack

Run `local-ai install` after cloning, or `.\bin\local-ai.cmd install` before the command is registered. Choose a working folder and finish the core installation. Follow the [installation checklist](INSTALL.md) if starting from a clean machine. Model weights and Pi App are separate downloads.

## 2. Get the exact Q4 file

Download [Qwen3.8-27B-UD-IQ4_XS.gguf at the tested revision](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/blob/4ca720788d1e01f1bff70c033e0d0028fd02e502/Qwen3.8-27B-UD-IQ4_XS.gguf). It is **14,252,845,984 bytes (14.25 GB)**. The model card's generic examples may select a different quantization; choose this exact file for this recipe.

The [single-model manifest](../manifests/qwen38-download.json) pins revision `4ca720788d1e01f1bff70c033e0d0028fd02e502` and SHA256:

```text
40fac4050e940397dbf13087afd50f4734a11805bf9d65ef8ddd7483470e6199
```

Save it anywhere and supply its path to the optimizer. Alternatively, the resumable Windows downloader uses your configured primary model folder and the alias's expected nested layout:

```powershell
./scripts/Download-CodingModels.ps1 -RateLimit 10M -Manifest qwen38-download.json -StatusName qwen38-download
```

`10M` caps transfer at 10 MiB/s. Append `-Unlimited` only for an uncapped download. This manifest contains one file, not the old four-model queue. The model stays outside Git and retains its upstream license.

## 3. Apply the measured profile

Close existing local model sessions, then run:

```powershell
local-ai optimize qwen38 --model-file "D:/AI/models/Qwen3.8-27B-UD-IQ4_XS.gguf"
```

For a model already found through the registered layout or a previously saved path:

```powershell
local-ai optimize qwen38
```

The command shows a loading bar and checksum progress in GB. It verifies size and SHA256 **before modifying configuration**, saves an exact backup under ignored `.state/config-backups/`, and records the Qwen-specific file and context in ignored `machine.local.json`. Existing unrelated local configuration and the working folder are preserved. No model is downloaded or loaded, and no driver/pagefile/Windows policy is changed. Invalid or missing weights leave the configuration unchanged.

This command **applies the measured recipe**; it does not run an automatic tuning sweep or promise 19 TPS on another computer. Use `--json` for structured output or `--no-color --ascii` for a plain terminal.

Saved effort preferences are preserved. Select **medium** in Pi App or use `/effort medium` in Pi to reproduce the measured reasoning condition. Pi low/medium/high map to Qwen's native **low/medium/xhigh**; `high` is never sent as Qwen's native effort. These presets also use local thinking-token caps (512/2048/4096), so high is not an unlimited creator-recommended reasoning budget. Off disables thinking. The response cap remains 8192 unless explicitly changed.

## 4. Check, then start

```powershell
local-ai test --model qwen38 --run
local-ai
# Optional desktop, installed separately:
local-ai-app
```

Acceptance is a small 32k functional smoke test. It is not the 96k long-input benchmark. Normal startup uses the saved 98,304-token Qwen slot. One model/request runs at a time; closing Pi or quitting Pi App stops the server owned by that launcher. An already open application needs a restart before new configuration takes effect.

Use `local-ai --dry-run` to inspect effective flags without loading weights; `local-ai doctor --verify-model` checks local health and the file hash. The [evaluation guide](TESTING.md) explains long-context and coding tests separately.

## The settings behind approximately 19 TPS

The shared model registry in `scripts/local-runtime.mjs` is the source of the CPU/GPU recipe for both launchers. You do not need to copy a long llama-server command.

| Setting | Value | Why this value |
|---|---|---|
| Weight quantization | UD-IQ4_XS, unchanged | Keeps the tested Q4 main model |
| Context | 98,304 | Passed the 96k + 15-TPS target |
| CPU FFN groups | 58, 59, 63 | Better measured speed/headroom than tested first-N and two/four-group placements |
| GPU layers | 999, with the tensor override below | Keeps other supported tensors on GPU |
| KV types | Keys `q4_0`, values `q4_0` | Reduces cache memory; separate from weight quantization |
| Flash Attention | `on` | Tested CUDA path |
| CPU threads | Generation 24, batch 24 | 32 threads was slower on this hybrid CPU |
| Batch / microbatch | 512 / 64 | Smaller compute buffers; similar decode speed to 128 microbatch |
| Reasoning | Enabled, medium; 2,048-token budget | Same condition as tuning, not reasoning disabled to inflate speed |
| Total response cap | 8,192 tokens | Leaves room for reasoning and visible output |
| Sampling | Temperature 1.0, top-p 0.95, top-k 20, min-p 0 | Held constant across measured comparisons |
| Parallel / fit / context shift | 1 / off / off | One fixed slot; no automatic context shrinking |
| MTP / vision | Off / text-only | Neither established a better validated default here |

The exact `--override-tensor` argument is single-quoted in PowerShell:

```powershell
'^blk\.(58|59|63)\.ffn_(gate|up|down)\.weight$=CPU'
```

It moves only these FFN weights, excluding attention tensors and embedded MTP layer 64. It does not offload twelve complete transformer layers.

With 88,146 input tokens, Pi App open and its worker loaded, three 512-token generations reached **19.01, 19.00 and 19.02 TPS**. Cold prompt ingestion still took about **174 seconds**. Peak total adapter use was 15,973 MiB, about **97.5%**, leaving roughly 400 MiB; at least 5.47 GB system RAM remained available. CPU offloading trades GPU memory for RAM and CPU work, so fewer offloaded groups do not automatically mean higher speed.

The selected profile passed five-value exact recall at 88,237 input tokens and a small native-Pi coding/tool regression. These are limited checks, not a broad coding-quality guarantee. A 131k profile completed at about 12.7 TPS; the earlier twelve-group capacity profile ran near 9 TPS. Raising context without rebalancing memory can make the system dramatically slower even when allocation succeeds.

The [full tuning record](QWEN38-PERFORMANCE-TODO.md) contains repetitions, memory, latency, failed alternatives, MTP findings and sanitized raw measurements.

## Manual configuration and recovery

The optimizer records mappings like these, using **your** paths:

```json
{
  "ModelFiles": {
    "qwen38": "D:/AI/models/Qwen3.8-27B-UD-IQ4_XS.gguf"
  },
  "ModelContextSizes": {
    "qwen38": 98304
  },
  "Reasoning": true,
  "ReasoningBudget": 2048,
  "MaxTokens": 8192
}
```

Merge these fields into the existing `machine.local.json`; do not replace runtime paths or the working folder. The **`qwen38` alias** receives this Qwen-specific tuning. A bare GGUF path passed to `--model` instead uses the conservative custom-model path and is not this supported profile.

If the optimizer fails verification, obtain the exact pinned file rather than changing the expected hash. To undo a saved configuration, close model sessions and restore the reported backup to `machine.local.json`; this does not remove the model or any sessions. Machine configuration and backups remain ignored by Git.

The reported speed assumes the tested background workload; other GPU applications can consume the small remaining margin. On different hardware, start with acceptance, inspect effective settings and measure occupied-context throughput before raising context. Windows tuning is not validated on macOS/Metal or Linux/CUDA.
