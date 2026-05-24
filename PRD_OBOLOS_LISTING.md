# PRD — Dispatch as a native API on Obolos

**Layer touched:** Obolos / payments / public HTTP surface. No agent-pipeline changes.
**Owner:** Dispatch team. Coordination required with Obolos team.
**Status:** Planning. **Do not start coding until the open questions in §1 are answered.**

---

## 0. Why

We won 3rd at Locus Paygentic and received $75 of Locus credits. The credits live on Locus, but Dispatch is the bridge that turns them into Obolos value.

This PRD lists Dispatch as an agent-callable endpoint on the Obolos marketplace, alongside Kling / Pika / Veo. Obolos benefits in three ways:

1. **A first-of-its-kind native API.** Every existing Obolos native API is a single-model wrapper. Dispatch is a *workflow* — six agents, on-chain settlement, finished MP4. Differentiates the catalog.
2. **Volume + reputation evidence.** The $75 subsidizes ~150 commissions priced at promo rates, so the listing launches with calls > 0 and a real rating.
3. **Marketing artifacts.** First five launch episodes are *about Obolos itself* (the marketplace, x402, the reputation system), published on obolos.tech.

---

## 1. Open questions — must be resolved before any code is written

These are not implementation details; they change the architecture.

### 1.1 How does Dispatch get listed as a native API? — **RESOLVED**

Confirmed by reading the Obolos agent skill (`obolos/public/agent/skill.md` v4.0.0): **the `obolos` CLI has no `publish-api` command.** The CLI covers consumers (`call`, `search`), ANP/ACP negotiation (`listing`, `anp`, `job`), and reputation — but registering a new recurring paid endpoint is an out-of-band operation handled by the Obolos team.

**Decision:** Path B — operator (us) coordinates directly with the Obolos team to add Dispatch to the native catalog. We expose an x402-compliant HTTP endpoint built to the reference spec; they catalog it.

**Action:** Operator opens a thread with the Obolos team asking for:
- The exact x402 server-side reference (their preferred Node/TS server SDK, or a written spec)
- The catalog entry format (icon, description, input JSON Schema, output shape, pricing display)
- Whether they prefer Dispatch hosted under `dispatch.locus.tech` or a new `dispatch.obolos.tech` subdomain

### 1.2 Where does Obolos payment land? — **RESOLVED**

**Decision: reuse the existing orchestrator treasury wallet** (the one behind `LOCUS_API_KEY` — already receives Locus commissions, pays agents, plumbed everywhere). Set `OBOLOS_SELLER_ADDRESS` = that wallet's address when running the registration script.

The earlier draft of this PRD recommended a separate `obolos-treasury` wallet for P&L cleanliness. Reasons that no longer hold:

- We added an `origin` column to the `commissions` table; the dashboard can filter by channel without needing wallet separation.
- Obolos doesn't pay per-transaction — payments accrue in a seller balance, withdrawn in batches. Per-tx "mixing" doesn't really happen.
- **ERC-8004 reputation accrues to a single address.** Splitting wallets splits Dispatch's provider track record across two identities; worse for discoverability across other marketplaces that read the same registry.

Revisit only if Dispatch and Obolos ever need clean financial separation for ownership/audit/tax reasons. Rotation is cheap when that day comes.

### 1.3 x402 protocol spec — **PARTIALLY RESOLVED**

Confirmed from the Obolos skill: x402 challenges are handled via EIP-3009 `TransferWithAuthorization`, the Obolos CLI client handles 402 → settle → retry automatically. What we don't yet know is the *server-side* shape — Obolos must point us at:
- Their preferred x402 server middleware (Node/TS — there is published reference middleware in the wider x402 ecosystem; need to confirm which they accept)
- The required `X-PAYMENT` header format and the payment-verification endpoint URL

**Action:** Bundle with §1.1 in the Obolos-team thread. Single conversation resolves both.

### 1.4 ERC-8004 identity for Dispatch — **NEW**

The Obolos skill is explicit: every completed job's review is written to the canonical **ERC-8004 ReputationRegistry on Base**, but *only for agents that have minted a canonical identity*. Without minting, reputation accrues nowhere and §2 criterion 3 ("Obolos wallet shows ≥ 5 incoming USDC transactions" + reputation visible) is meaningless.

**Action:** Before launching, mint an ERC-8004 identity for the new `obolos-treasury` wallet via `app.obolos.tech/app/agent/<address>`. Pin Dispatch's agent card to IPFS (description, capabilities, link to dispatch.locus.tech). One-time cost: gas only (~$0.05 on Base).

Past `job_reviews` publish retroactively on the next publisher tick (~60s) once the identity exists — so the order is: launch the listing → run promo commissions → mint identity → all prior reviews backfill automatically. Or mint first and let them publish in real time. Either works.

---

## 2. Goal-driven success criteria

The feature is done when **all** of these are verifiable:

1. ✅ A fresh wallet, with no prior Dispatch interaction, can call the Obolos-listed Dispatch API, pay $2 USDC via x402, and receive an MP4 URL within 5 minutes. (Run from a separate machine, fresh wallet, no whitelisting.)
2. ✅ `mcp__obolos__search_apis({query: "news"})` returns the Dispatch listing in its results.
3. ✅ The Obolos-treasury wallet shows ≥ 5 incoming USDC transactions within 7 days of launch.
4. ✅ The existing Locus checkout flow on `dispatch.locus.tech` is byte-for-byte unchanged — same prices, same UI, same revenue accounting.
5. ✅ 5 launch episodes about Obolos are published to obolos.tech (or linked from it).

If any of these can't be verified, the feature is incomplete.

---

## 3. Data model

New columns on `commissions`:

```sql
ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS origin           TEXT NOT NULL DEFAULT 'locus',  -- 'locus' | 'obolos'
  ADD COLUMN IF NOT EXISTS x402_tx_hash     TEXT,                            -- payment settlement hash
  ADD COLUMN IF NOT EXISTS callback_url     TEXT;                            -- where to POST when done (if Obolos client provided one)
```

No new tables. Reuses existing `pay_outbox` for any outbound revenue share to Obolos client wallets (40% rule still applies — Obolos commissioners get the same deal as Locus commissioners on public videos; exclusive remains zero-share).

---

## 4. New HTTP surface

Single file: `src/obolos.ts`. Mounted from `src/server.ts` as a sub-router.

### 4.1 `POST /obolos/commission`

Request:
```json
{
  "topic": "string, required",
  "mode": "'public' | 'exclusive', default 'public'",
  "callbackUrl": "string, optional — POSTed when video is done",
  "requesterAddress": "0x..., the paying wallet"
}
```

Headers: `X-PAYMENT: <x402 payload>` (per §1.3 once spec is known).

Response (immediate, 202):
```json
{
  "commissionId": "uuid",
  "statusUrl": "/obolos/commission/<id>",
  "estimatedSeconds": 240
}
```

### 4.2 `GET /obolos/commission/:id`

Response:
```json
{
  "status": "'pending' | 'generating' | 'done' | 'error'",
  "step": "researcher | scriptwriter | ...",
  "videoUrl": "string, present when status=done",
  "downloadToken": "string, present when status=done AND mode=exclusive",
  "watchToken": "string, present when status=done AND mode=public"
}
```

### 4.3 Webhook (optional)

When `callbackUrl` provided: on completion, `POST <callbackUrl>` with the same JSON as the GET response. One retry, exponential backoff, then drop. Failure to deliver doesn't fail the commission.

---

## 5. Pricing

Promo period (first 30 days or first $75 of Locus credits exhausted, whichever first):

| Mode | Standard | Promo |
|------|----------|-------|
| Public | $0.50 | **$0.25** |
| Exclusive | $2.00 | **$1.00** |

After promo: same as Locus checkout prices. The $75 in Locus credits funds the differential (each promo public costs us $0.25 in subsidized API spend; each promo exclusive costs $1.00). ~$75 ÷ $0.65 production cost ≈ 115 fully-subsidized commissions, or split across promo rates.

Locked. No "configurable" subsidy logic. Pricing is two constants in `src/obolos.ts` that flip when the promo window ends.

---

## 6. Reuse, not rewrite

Every step beyond payment + HTTP intake reuses existing code:

- Pipeline orchestration: `runPipeline()` in `src/pipeline.ts` — unchanged.
- Council, agents, editor: unchanged.
- DB persistence: `commissions` row with `origin='obolos'`.
- SSE stream: existing `/api/jobs/:id/stream` works as-is (Obolos client can subscribe).
- Video serving: existing `/video/:filename` + token middleware.

**The only new code is the HTTP intake + payment verification + (optional) callback dispatcher.** ~250 lines.

---

## 7. Launch campaign (the $75 spend)

Five episodes, in order, hand-commissioned by the operator:

1. "Obolos hits 1000 APIs — what an agent marketplace looks like at scale"
2. "x402 explained — micropayments without merchant accounts"
3. "Portable reputation — why every agent platform will need it"
4. "We built Dispatch on Locus. Today it's also on Obolos. Here's how."
5. "The first cross-platform agent — Dispatch's six-agent swarm now spends on both networks"

Each is an exclusive ($1 promo each). Total spend: $5. Production cost: ~$3.25. Net subsidy: $1.75. Remaining $73.25 of credit funds organic commissions through the promo window.

---

## 8. What this PRD explicitly does NOT do

(Karpathy: simplicity first.)

- ❌ Build a separate Obolos frontend. Obolos discovery is via `search_apis`; consumption is via HTTP.
- ❌ Add new agents.
- ❌ Change the Locus checkout flow.
- ❌ Build a payments dashboard split by origin (the existing treasury UI is fine — `origin` column makes it filterable later if anyone cares).
- ❌ Implement on-chain settlement ourselves if Obolos provides a facilitator.
- ❌ Build a backoff/retry queue for callback webhooks beyond one retry. If the Obolos client cares, they can poll.
- ❌ Add Obolos as a payment option for the Locus-hosted UI. This is the *other* direction: Obolos clients pay Dispatch.

---

## 9. Implementation order

1. Operator opens Obolos-team thread covering §1.1 (catalog onboarding), §1.3 (x402 server spec), §1.4 (ERC-8004 mint flow confirmation). **Block on this.**
2. Mint ERC-8004 identity for the new `obolos-treasury` wallet (§1.4). One-time, ~5 min via app.obolos.tech.
3. Write `src/obolos.ts` skeleton with the two HTTP endpoints, payment verification stubbed to "accept all" behind `OBOLOS_DEV_MODE=true`.
4. Wire to the existing pipeline. Verify locally: a POST creates a commission, the GET reflects progress, the video plays.
5. Replace payment stub with real x402 verification using whatever middleware Obolos points us at. Verify against a fresh wallet calling via `obolos call <our-api-id>` from another machine.
6. Add DB migration. Verify against staging Postgres.
7. Coordinate listing in Obolos's catalog. Verify §2 criterion 2 (`obolos search "news"` returns Dispatch).
8. Operator runs the five launch episodes manually. Verify §2 criterion 5.
9. Open the floodgates. Monitor for 7 days. Verify §2 criterion 3 *and* check `obolos rep check <our-agent-id>` shows accumulating feedback.

---

## 10. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Obolos has no self-serve listing mechanism, and team is slow to onboard | Med | We're sibling projects — should be fast. Worst case, build endpoint anyway; ship it as standalone `dispatch.obolos.tech` even if not catalogued. |
| x402 spec is in flux | Med | Use Obolos's reference client if they have one. |
| Commission completes but callback URL is unreachable | Low | One retry, then drop. Client can poll. |
| Pipeline failure on an Obolos commission → no refund mechanism | High | Refunds are handled by existing `commission.status='refund_needed'` + the `pay_outbox`. Reuse it; just enqueue refunds with `to_address = requesterAddress` and `reason='refund'`. Already implemented for Locus. |
| Voice / image API failure mid-pipeline burns the Obolos client's $2 with no output | High | Existing pipeline recovery handles this. If it can't recover, refund via pay_outbox. Verify the path works for Obolos origin in §9 step 3. |
