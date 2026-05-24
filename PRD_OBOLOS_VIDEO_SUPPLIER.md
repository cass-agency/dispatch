# PRD — Obolos as a video supplier inside the visual agent

**Layer touched:** Agent layer — `src/agents/visual.ts` and a new `src/suppliers/obolos.ts`. No new HTTP surface, no DB changes.
**Owner:** Dispatch team. No Obolos-team coordination required (we are the client).
**Status:** Ready to implement once §1 open questions are answered.

---

## 0. Why

The visual agent currently calls `fal.ai/flux/dev` through Locus-wrapped APIs. That's good enough for $0.50 public commissions, but exclusive commissions ($2) should look noticeably better — and Obolos's native catalog has Veo 3 (cinematic video with native audio, $4) and Kling 1.6 ($0.35) right there.

Routing the *premium frame* of exclusive commissions through Obolos:
- Gives exclusive commissioners a tangibly nicer artifact (motion vs. Ken Burns pan over a still)
- Sends real USDC to Obolos as a customer, not just a partner
- Proves the dispatch agents can be cross-platform spenders without re-architecting

The $75 of Locus credit is irrelevant to this PRD — Obolos calls are paid in USDC from the visual agent's wallet, not from Locus credits. (Different PRD; different flow.)

---

## 1. Open questions — must be resolved before coding

### 1.1 Wallet provenance — **RESOLVED**

The Obolos skill confirms `OBOLOS_PRIVATE_KEY` env var is the standard setup path (or `obolos setup --generate` produces one in `~/.obolos/config.json`). The wallet just needs USDC on Base.

**Decision:** Path B — mint a new wallet dedicated to the visual agent's Obolos calls (`obolos setup --generate` from the Dispatch operator's machine), seed it with ~$50 USDC, store the key in env as `OBOLOS_PRIVATE_KEY_VISUAL`. Reasons:

- Locus `claw_` keys don't expose underlying private keys (would be a security violation of the wrapped-API model).
- A separate Obolos wallet is easier to mint an ERC-8004 identity for (§1.4) and easier to track P&L on.
- Keeps the Locus visual wallet `0x16ae...1cdd` doing exactly what it does today.

The split-identity concern is real but small — both wallets can publish ERC-8004 identity cards that point to the same Dispatch metadata, so external observers can correlate them.

### 1.2 Veo 3 prompt format

Visual director currently emits stills-style prompts ("dark background, neon blue and gold, dramatic lighting"). Veo 3 takes ~8s motion prompts. Does our existing prompt produce coherent video on Veo 3, or does it need a motion-aware reformatter?

**Action:** Run one test call to Veo 3 with an existing visual-director prompt before writing the integration. If output is incoherent, the director needs a second Haiku pass to add motion description — adds ~$0.002 per exclusive video. Acceptable.

### 1.3 Asset handling

Veo 3 returns an MP4 URL with native audio. The editor currently expects a still PNG and applies Ken Burns + the voice agent's narration. How does motion video integrate?

**Recommendation (locked unless §1.3 testing surprises us):** Use Veo only for the **intro frame** (segment 0). Use Flux stills for segments 1-3. Editor places the Veo clip at the start, strips Veo's native audio (replaced by our narration). No editor refactor — the existing segment-0 slot accepts a video file as readily as a still.

### 1.4 ERC-8004 identity for the new Obolos wallet — **NEW**

Per the Obolos skill, Obolos writes job feedback to the canonical ERC-8004 ReputationRegistry on Base, but only for wallets with a minted identity. Since reputation here is for *us as a buyer*, not as a provider, the value of minting is lower than PRD-1 — buyers don't get bid on. **Skip the mint** unless Obolos's `rep check` factors buyer history into provider trust decisions (it doesn't, per the skill). Revisit if that changes.

---

## 2. Goal-driven success criteria

The feature is done when **all** of these are verifiable:

1. ✅ Generate an exclusive commission. Verify the visual agent's Obolos wallet shows one outbound USDC payment (~$4) to a Veo 3 API endpoint, timestamped within the commission window. Verify via `mcp__obolos__get_balance` or Base block explorer.
2. ✅ Generate a public commission. Verify zero Obolos transactions for that commission. Existing Flux flow unchanged.
3. ✅ Treasury UI's cost breakdown row for the exclusive commission shows a line `obolos/veo3 — $4.00` distinct from the existing `fal.ai flux/dev` lines.
4. ✅ Pull `OBOLOS_PRIVATE_KEY` from env. Re-run an exclusive commission. It completes (falls back to Flux for segment 0) with a `console.warn` log but no pipeline failure.
5. ✅ Re-run all existing public commissions in the test fixture. Output is bit-identical to before this PRD. (Surgical-changes test.)

---

## 3. Routing policy — locked

Hardcoded in `src/agents/visual.ts`. Not configurable. Not LLM-driven.

```ts
// In runVisual, immediately before the per-segment generation loop:
const useObolosVeo = commission.mode === "exclusive"
  && segments.length >= 1
  && process.env.OBOLOS_PRIVATE_KEY;

for (let i = 0; i < segments.length; i++) {
  if (i === 0 && useObolosVeo) {
    images.push(await generateVideoViaObolos(imagePrompts[i], 0));
  } else {
    images.push(await generateImage(imagePrompts[i], i));
  }
}
```

That's the entire routing logic. Three conditions, AND-ed. No supplier-selection table, no per-tier price-aware optimizer, no admin UI knob.

---

## 4. New code

### 4.1 `src/suppliers/obolos.ts` (new file, ~40 lines) — **drastically simplified**

The Obolos skill confirms the `obolos` CLI handles x402 (EIP-3009 `TransferWithAuthorization`, 402 challenge, retry) automatically. We do **not** need a custom HTTP client, `viem`, or any cryptographic code. We just shell out.

```ts
import { spawn } from "child_process";

export async function obolosCall(
  apiId: string,
  body: object
): Promise<{ url: string; txHash: string; costUsd: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("obolos", [
      "call", apiId,
      "--method", "POST",
      "--body", JSON.stringify(body),
      "--json",
    ], { env: { ...process.env, OBOLOS_PRIVATE_KEY: process.env.OBOLOS_PRIVATE_KEY_VISUAL } });

    let stdout = ""; let stderr = "";
    proc.stdout.on("data", (d) => stdout += d);
    proc.stderr.on("data", (d) => stderr += d);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`obolos call failed (exit ${code}): ${stderr}`));
      try {
        const parsed = JSON.parse(stdout);
        // Shape verified against `obolos call --help` in §9 step 1
        resolve({ url: parsed.result.url, txHash: parsed.payment.txHash, costUsd: Number(parsed.payment.amount) });
      } catch (e) { reject(new Error(`obolos call: bad JSON: ${stdout.slice(0, 200)}`)); }
    });
  });
}
```

That's the whole file. No abstraction, no class, no retry logic (CLI handles it), no payment plumbing.

**Dependency footprint:** zero new npm deps. One new system dep: `@obolos_tech/cli` installed globally in the Docker image. Add one line to the Dockerfile:

```dockerfile
RUN npm install -g @obolos_tech/cli
```

**No abstraction layer for future suppliers.** One supplier today; generalize when there are two. (Karpathy.)

### 4.2 `src/agents/visual.ts` modifications

Add one function:
```ts
async function generateVideoViaObolos(prompt: string, segmentIndex: number): Promise<VisualImage> {
  const veoApiId = "0552e4ed-2915-4819-a1ef-517d50d6fe9b"; // Veo 3 Image-to-Video (from `obolos search "veo"`)
  const { url, txHash, costUsd } = await obolosCall(veoApiId, { prompt, duration: 8 });
  logCost("visual", costUsd, `obolos/veo3 — segment ${segmentIndex} (tx ${txHash.slice(0, 10)})`);
  return { url, segmentIndex };
}
```

Reuse the existing `VisualImage` type — the editor branches on file extension (§5), so the `url` field carries either a PNG or an MP4. The `segmentIndex` semantics carry over.

Add the routing block from §3. Add `import { obolosCall } from "../suppliers/obolos"` at the top.

The fallback path is automatic: if `OBOLOS_PRIVATE_KEY_VISUAL` is unset, the CLI exits non-zero with a wallet error, our `obolosCall` throws, the visual agent catches and falls back to `generateImage` (Flux). Wrap the Obolos call in a try/catch for this. ~5 lines.

No changes to `runVisualExtra` (supplementary frames stay on Flux — keeps the dynamic-top-up math the same). No changes to `animator.ts`. No changes to the council, pipeline.

### 4.3 `logCost` signature

Currently: `logCost(agentName, cost, description)`. Already string-typed for description — no signature change needed. The new line:

```ts
logCost("visual", actualCost, `obolos/veo3 — segment 0 (tx ${txHash.slice(0, 10)})`);
```

§2 criterion 3 reads this string. No DB schema change, no new event type.

---

## 5. Editor integration check

The editor (`src/editor.ts`) currently does Ken Burns pan-and-zoom on stills via FFmpeg. When segment 0 is an MP4 instead:

- Ken Burns filter must be skipped for that segment (the video already has motion)
- Veo's native audio must be muted or ducked under our narration

**Estimated editor work:** ~20 lines in `src/editor.ts` — one branch on input file extension. Counts toward this PRD's scope.

Open question: does the existing FFmpeg concat handle mixed inputs (one MP4 segment + three image-derived MP4 segments) cleanly? The current pipeline already normalizes each segment to an intermediate MP4 before concat (Ken Burns produces MP4s), so the final concat is MP4-to-MP4 either way. **Should just work.** Verify in §9 step 3.

---

## 6. Cost math

Exclusive commission today: ~$0.65 production + ~$1.35 margin on $2 fee.
Exclusive commission with this PRD: ~$0.65 + $4.00 (Veo 3) = $4.65 production. **Margin: -$2.65 per commission.**

That is intentional during the launch period. Two ways to recoup:

- **Raise exclusive price.** Out of scope for this PRD. Would be a one-line constant change in `pipeline.ts`.
- **Use Kling 1.6 instead of Veo 3.** $0.35 → margin: +$1.00. Loses the "premium" angle.

**Recommendation:** ship as-is for the launch period (the negative margin is a marketing budget line, paid for by Locus credits indirectly — see Q below). After 30 days, evaluate whether premium signal is worth the cost.

(Q for operator: the Locus credits cover the orchestrator-side API spend, but Obolos x402 payments come from the *visual agent wallet's USDC balance*, not from Locus credits. So strictly speaking the $75 doesn't fund this PRD's downside. Needs a separate seed of ~$50 USDC into the visual wallet to run ~12 exclusive commissions. Confirm before launch.)

---

## 7. What this PRD explicitly does NOT do

- ❌ Replace fal.ai globally.
- ❌ Route public commissions to Obolos. ($0.35 × 4 stills = $1.40 against a $0.50 fee. Math fails.)
- ❌ Add a per-frame supplier-selection LLM ("which model is best for this prompt"). Speculative.
- ❌ Wire `animator.ts` to Obolos. Separate work, different decision criteria.
- ❌ Add benchmarking / quality scoring across suppliers.
- ❌ Build an abstract `Supplier` interface. One supplier today; generalize when there are two.
- ❌ Surface supplier choice to the commissioner ("would you like Veo or Flux?"). They get the tier; we make the call.
- ❌ Cache or deduplicate Veo outputs.

---

## 8. Files touched

| File | Lines changed | Nature |
|------|--------------|--------|
| `src/suppliers/obolos.ts` | +40 | New file — single function shelling out to `obolos call --json` |
| `src/agents/visual.ts` | +25 | New function + 6-line routing block + try/catch fallback |
| `src/editor.ts` | +20 | One branch on input file extension for segment 0 |
| `Dockerfile` | +1 line | `RUN npm install -g @obolos_tech/cli` |
| `.env.example` | +1 line | `OBOLOS_PRIVATE_KEY_VISUAL=` |

**Total: ~85 lines of code change. Zero new npm deps. One new system dep. No DB migration. No new tables. No HTTP surface. No agent additions.**

---

## 9. Implementation order

1. Operator installs CLI + mints visual wallet: `npm i -g @obolos_tech/cli && obolos setup --generate && obolos balance --json`. Seed wallet with $50 USDC on Base. Run `obolos call --help` and confirm the `--json` output shape matches what `src/suppliers/obolos.ts` expects (fix the field names in `parsed.result.url` / `parsed.payment.txHash` if reality differs).
2. Run the §1.2 prompt-format test: `obolos call 0552e4ed-2915-4819-a1ef-517d50d6fe9b --method POST --body '{"prompt":"<existing visual director output>","duration":8}' --json`. Inspect the MP4. If output is incoherent, plan the Haiku motion-reformat pass.
3. Write `src/suppliers/obolos.ts` per §4.1.
4. Modify `src/agents/visual.ts` — add the routing block + try/catch fallback. Verify with `DEMO_MODE=true` that the path-selection logic fires correctly (no actual API call).
5. Apply §5 editor branch. Verify locally with a test MP4 + 3 stills that the final concat plays cleanly.
6. Run one real exclusive commission end-to-end. Verify §2 criteria 1, 3, 5.
7. Test the fallback path: unset `OBOLOS_PRIVATE_KEY_VISUAL`, run exclusive again. Verify §2 criterion 4.
8. Test the public path is unchanged. Verify §2 criterion 2.

---

## 10. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Veo 3 output is incoherent with stills-style prompts | Med | §1.2 pre-test catches this. Add a Haiku motion-reformat pass if needed. |
| Veo 3 native audio bleeds through our narration | Med | Editor ducks/strips audio in the segment-0 branch. ~5 lines of FFmpeg flags. |
| Mixed-segment concat produces visual jank at the cut | Low | Existing pipeline normalizes; FFmpeg fade-at-cut transitions already exist. |
| Visual wallet runs out of USDC mid-commission | Med | Same `runRecovery` path as existing agent-balance-low flag in `council.ts`. Treasury tops up. |
| x402 settlement timing exceeds Veo's generation window | Low | Standard x402 protocol — pay before generate. Not a race. |
| Obolos changes Veo 3 pricing | Low | Read price from `get_api_details` at call time rather than hardcoding $4. (Adds 1 RTT but is correct.) |
