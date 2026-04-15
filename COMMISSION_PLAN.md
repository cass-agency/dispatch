# Dispatch — Commission & Payment Plan
> Researched 2026-04-15. No code has been written yet. This is the plan.

---

## What We Know From Research

### Locus Checkout API (verified by live probing)

**Session creation** — `POST /api/checkout/sessions`
```json
{
  "amount": "0.50",        ← must be a STRING, not number
  "currency": "USDC",
  "description": "Dispatch commission: AI agents economy",
  "metadata": {            ← stored on session, returned on GET
    "topic": "...",
    "requesterAddress": "0x..."
  },
  "successUrl": "https://dispatch.../commissioned",
  "cancelUrl":  "https://dispatch.../",
  "webhookUrl": "https://dispatch.../webhook/checkout",
  "expiresInMinutes": 60
}
```

**Response:**
```json
{
  "id": "uuid",
  "checkoutUrl": "https://beta-checkout.paywithlocus.com/uuid",
  "amount": "0.5",
  "currency": "USDC",
  "status": "PENDING",
  "expiresAt": "..."
}
```

Key findings:
- `checkoutUrl` is a **hosted Locus page** — user visits it in browser and pays with their Locus wallet. No embedding needed.
- `metadata` is fully preserved and enriched on payment (Locus adds `payerWalletAddress`, `payerAgentId`, `pendingTransactionId`)
- `webhookUrl` is accepted but `webhookSecret` is NOT returned in the response (beta API gap — must use polling instead for now)
- The **seller detects payment by polling** `GET /api/checkout/sessions/{id}` and watching for `status: "PAID"`
- When PAID, the session returns: `paymentTxHash`, `payerAddress`, `paidAt`

**No native payment splits.** Locus does not split incoming payments. Dispatch receives 100% of the commission, then manually sends the revenue share via `POST /api/pay/send`.

**Wallet balance:** `GET /api/pay/balance` — returns Dispatch's own wallet only.

**Agent wallet balances on Base** (via public RPC, no Locus API needed):
- visual: $0.60 USDC
- voice: $0.20 USDC
- music: $0.60 USDC
- (They're accumulating real on-chain earnings.)

---

## The Full Money Flow

```
COMMISSION FLOW ($0.50)
────────────────────────────────────────────────────────
Commissioning user pays $0.50 → Locus Checkout → Dispatch main wallet
                                                        │
                        ┌───────────────────────────────┤
                        │ Pipeline API costs (~$0.30)   │ (auto-deducted
                        │ billed by Locus wrapped APIs  │  by Locus)
                        └───────────────────────────────┤
                                                        │
                        ┌───────────────────────────────┤
                        │ Agent wallet payouts ($0.33)  │ (we send manually)
                        │  scriptwriter: $0.02          │
                        │  visual:       $0.12          │
                        │  voice:        $0.04          │
                        │  music:        $0.15          │
                        └───────────────────────────────┤
                                                        │
  ← video is ready →                                    │
                                                        │
PAY-TO-WATCH FLOW ($0.05/view)                          │
────────────────────────────────────────────────────────│
Viewer pays $0.05 → Locus Checkout → Dispatch wallet    │
       ↓                                                │
  40% = $0.02 → requester wallet (Dispatch sends)       │
  60% = $0.03 → stays in Dispatch                       │
```

Note: At current pricing ($0.50 commission, $0.33 agent payouts, ~$0.30 API costs), Dispatch runs at a slight loss per video. This is a demo — sustainability is out of scope. The flows are architecturally correct and the payments are real.

---

## Planned Architecture

### New server endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /commission` | POST | Create checkout session, return {sessionId, checkoutUrl} |
| `GET /commission/:sessionId` | GET | Poll commission status (pending_payment → generating → done) |
| `POST /webhook/checkout` | POST | Receive Locus webhook (future, when webhookSecret is returned) |
| `GET /api/balance` | GET | Return Dispatch wallet balance + agent wallet balances on-chain |
| `GET /api/ledger` | GET | Return transaction history (incoming commissions, agent payouts) |
| `POST /videos/:id/watch` | POST | Create pay-to-watch checkout, return {checkoutUrl} |
| `GET /videos/:id/watch/:sessionId` | GET | Poll watch session, return video URL when paid |

### New in-memory records

```typescript
interface Commission {
  sessionId: string;
  topic: string;
  requesterAddress: string;   // wallet to receive revenue share
  checkoutUrl: string;
  status: 'pending_payment' | 'generating' | 'done' | 'error';
  createdAt: string;
  paidAt?: string;
  payerAddress?: string;
  paymentTxHash?: string;     // on-chain proof of payment
  jobId?: string;             // pipeline job ID
  videoId?: string;           // filename when done
  revenueSent: boolean;
  revenueTxHash?: string;     // on-chain proof of revenue share payment
}
```

### Commission flow step-by-step

**1. User submits commission**
- UI: form with `topic` text input + `requesterAddress` wallet field
- `POST /commission` → backend calls Locus checkout session creation
- Response: `{ sessionId, checkoutUrl, expiresAt }`
- Frontend: shows button linking to `checkoutUrl` + starts polling `/commission/:sessionId`
- Backend: starts 5-second polling loop on `GET /api/checkout/sessions/{sessionId}`

**2. User pays at Locus hosted page**
- User clicks link → opens `https://beta-checkout.paywithlocus.com/{sessionId}`
- Standard Locus wallet payment UI (no custom code needed)
- Locus confirms payment on Base (~10-30 seconds typical)

**3. Dispatch detects payment**
- Polling job sees `session.status === "PAID"`
- Records `payerAddress`, `paymentTxHash`, `paidAt`
- Commission status → `"generating"`
- Starts `runPipeline(topic)` as usual
- Frontend poll sees `generating` + shows live pipeline visualization

**4. Pipeline completes**
- Video assembled, stored in /tmp
- Revenue share: `pay/send($0.20 → requesterAddress, "Dispatch revenue share — [headline]")`
- Commission status → `"done"`, `revenueSent: true`, `videoId: filename`
- Frontend poll sees `done` + shows video player

**5. Pay-to-watch (optional second monetization layer)**
- Video is gated: each view requires a $0.05 checkout payment
- `POST /videos/:id/watch` creates a new $0.05 checkout session with `metadata: {videoId, requesterAddress}`
- On payment: send $0.02 to requester, return `/video/{filename}` URL
- Free preview: first 5 seconds auto-plays for everyone

### Balance & transparency panel

**Dispatch wallet:**
- Balance: `GET /api/pay/balance` → live USDC balance
- Transaction history: `GET /api/pay/transactions?limit=20` → all sends/receives

**Agent wallets:**
- Balance via Base public RPC (`eth_call` → USDC `balanceOf`)
- RPC: `https://mainnet.base.org`
- USDC contract on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- No Locus API key needed — public read

**What to display in UI:**
```
┌─────────────────────────────────────────────────────────┐
│  💼 DISPATCH TREASURY                                    │
│                                                          │
│  Main wallet:  $1.46 USDC   0x70e0...bedf               │
│                                                          │
│  Agent wallets:                                          │
│  ✍️  Scriptwriter  $0.00    0xA86e...1598               │
│  🎨 Visual         $0.60   0xF46F...0617               │
│  🎙️  Voice          $0.20   0x51fF...56c8               │
│  🎵 Music          $0.60   0x60Be...0a50               │
│                                                          │
│  Total agent earnings: $1.40 USDC across 4+ videos      │
└─────────────────────────────────────────────────────────┘
```

Each agent wallet balance links to its BaseScan address page.
Each payment in the history shows a BaseScan tx_hash link for on-chain verification.

---

## Key Design Decisions

### Why polling instead of webhooks
The `webhookUrl` field is accepted by Locus but `webhookSecret` is not returned in the session creation response (confirmed by testing). Without the secret, we can't verify webhook authenticity. Polling `GET /api/checkout/sessions/{id}` every 5 seconds is reliable and adds ~2.5 seconds average detection lag — acceptable for a demo.

When Locus fixes the webhookSecret response, we can switch to push-based detection with:
- HMAC-SHA256 verification of `x-locus-signature` header
- Immediate pipeline start on `checkout.session.paid` event

### No native payment splits
Locus has no built-in split functionality. All revenue share is handled by Dispatch making a separate `pay/send` after pipeline completion. This means:
- If the service crashes between video completion and revenue share payment → requester doesn't get paid
- Mitigation: do the `pay/send` call as the FIRST thing after pipeline completes (before updating status), and store `revenueSent` flag
- For demo purposes, this is acceptable

### The `requesterAddress` field
The user must provide their Locus wallet address to receive revenue share. Options:
1. Required field in commission form (simplest, what we'll do)
2. Optional — revenue accumulates in Dispatch until claimed (more complex)
3. Email-based escrow via `pay/send-email` — send revenue share to an email address instead

For the demo: required wallet address field.

### Pay-to-watch gating
Two possible implementations:
- **Checkout gate**: each watch creates a new $0.05 session (proves payment, clean UX)
- **Token gate**: one-time payment generates a JWT that unlocks the video URL

For demo: checkout gate (simpler, uses existing Locus infrastructure, each view generates on-chain proof).

---

## What the UI Should Show

### Commission form (replaces simple "Generate" form)
```
┌─────────────────────────────────────────────────────────┐
│  COMMISSION A BROADCAST                                  │
│                                                          │
│  Topic: [_______________________________________]        │
│                                                          │
│  Your wallet address (to receive 40% of view revenue):  │
│  [_______________________________________]               │
│                                                          │
│  Commission fee: $0.50 USDC                             │
│  Agent payouts: $0.33 USDC                              │
│  Your revenue share: 40% of all views ($0.02/view)      │
│                                                          │
│  [💳 Pay & Commission — Opens Locus Checkout]           │
└─────────────────────────────────────────────────────────┘
```

After payment detected:
- Show live pipeline (already built) with "💰 Commission received" badge
- Show `paymentTxHash` link to BaseScan as proof

### Video display with pay-to-watch
```
┌─────────────────────────────────────────────────────────┐
│  ▶️  [5-second preview plays automatically]              │
│                                                          │
│  "AI Agents Reshape Global Finance" — 2:34              │
│  Commissioned by 0xABC...123                            │
│                                                          │
│  [🔓 Watch Full Video — $0.05 USDC]                     │
│  Opens Locus Checkout                                    │
│                                                          │
│  Revenue: $X.XX paid to commissioner across N views     │
└─────────────────────────────────────────────────────────┘
```

---

## Confirmed Decisions (2026-04-15)

All open questions resolved by Kilián:

1. **Pay-to-watch: ✅ IN SCOPE.** Build the full second payment loop. Each view is a $0.05 checkout session.

2. **External wallets: ❌ NOT NEEDED.** Locus-only. No MetaMask/external wallet support required. Commissioner submits their Locus wallet address directly.

3. **Revenue share: ✅ 40% confirmed.** $0.02 per view to commissioner. Break-even for commissioner at 25 views ($0.50 ÷ $0.02).

4. **Pipeline failure: Retry once automatically.** If the pipeline fails, re-run it one time with the same job context. If it fails again → manual refund via `POST /api/pay/send` back to the `payerAddress` recorded on the checkout session. The operator must manually trigger the refund; the UI should show a "REFUND NEEDED" state so it's visible.

---

## Implementation Order

When we write code:

1. `POST /commission` + checkout session creation
2. Background poller for session `PAID` status
3. Auto-pipeline trigger on payment confirmation
4. `GET /commission/:sessionId` status polling endpoint
5. Revenue share `pay/send` after pipeline completes
6. `POST /videos/:id/watch` + $0.05 checkout session
7. Watch session poller + video URL unlock
8. `GET /api/balance` — Dispatch wallet + agent wallets on-chain
9. `GET /api/ledger` — transaction history
10. UI: commission form, balance panel, pay-to-watch gate, transparent tx log
