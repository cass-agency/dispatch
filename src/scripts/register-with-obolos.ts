// ═══════════════════════════════════════════════════════════════
// Register Dispatch as a seller API on obolos.tech.
//
// One-shot: upgrades OBOLOS_SELLER_ADDRESS to seller, then POSTs
// the API registration. Prints the resulting API id — share that
// with the Obolos admin to approve the listing.
//
// Usage:
//   OBOLOS_SELLER_ADDRESS=0x...           # wallet that owns the listing
//   OBOLOS_INBOUND_SECRET=...             # shared secret the proxy sends us
//   DISPATCH_PUBLIC_URL=https://dispatch.locus.tech
//   OBOLOS_API_BASE=https://obolos.tech/api  # optional override
//   npx tsx src/scripts/register-with-obolos.ts
// ═══════════════════════════════════════════════════════════════

import * as dotenv from "dotenv";
dotenv.config();

import axios from "axios";

const OBOLOS_API_BASE = process.env.OBOLOS_API_BASE ?? "https://obolos.tech/api";
const SELLER_ADDRESS = process.env.OBOLOS_SELLER_ADDRESS;
const PUBLIC_URL = process.env.DISPATCH_PUBLIC_URL;
const PRICE_PER_CALL = parseFloat(process.env.OBOLOS_PRICE_PER_CALL ?? "1.00"); // exclusive promo

async function main() {
  console.log("\n📡 Dispatch → Obolos seller registration\n");

  if (!SELLER_ADDRESS) throw new Error("OBOLOS_SELLER_ADDRESS env var required");
  if (!PUBLIC_URL) throw new Error("DISPATCH_PUBLIC_URL env var required (e.g. https://dispatch.locus.tech)");

  const headers = { Authorization: `Bearer ${SELLER_ADDRESS}` };

  // 1. Become a seller (idempotent — returns success if already a seller)
  console.log(`→ Upgrading ${SELLER_ADDRESS} to seller…`);
  const becomeRes = await axios.post(`${OBOLOS_API_BASE}/seller/become-seller`, {}, { headers });
  console.log(`  ${becomeRes.data.message ?? "ok"}\n`);

  // 2. Register the API
  const endpointUrl = `${PUBLIC_URL.replace(/\/$/, "")}/obolos/commission`;
  const exampleRequest = JSON.stringify({
    topic: "AI agents start trading commodities on autonomous Base markets",
    mode: "exclusive",
    requesterAddress: "0xYourWallet",
    callbackUrl: "https://your-agent.example.com/dispatch-webhook",
  });
  const exampleResponse = JSON.stringify({
    commissionId: "a1b2c3d4e5f6",
    statusUrl: "https://dispatch.locus.tech/obolos/commission/a1b2c3d4e5f6",
    estimatedSeconds: 240,
    mode: "exclusive",
    fee: "1.00",
  });

  console.log(`→ Registering API:`);
  console.log(`    endpointUrl: ${endpointUrl}`);
  console.log(`    pricePerCall: $${PRICE_PER_CALL.toFixed(2)}\n`);

  const createRes = await axios.post(
    `${OBOLOS_API_BASE}/seller/apis`,
    {
      name: "Dispatch — Autonomous AI News Video",
      description:
        "Commission a broadcast-quality news video from a six-agent AI swarm. " +
        "Returns immediately with a job handle; poll the statusUrl for progress. " +
        "Production takes ~4 minutes. Output: MP4 with original cinematography, " +
        "AI narration, and original score. Each agent settles its own API costs " +
        "on Base via Locus. Exclusive mode delivers a private download token.",
      endpointUrl,
      httpMethod: "POST",
      authType: "bearer",
      authKey: process.env.OBOLOS_INBOUND_SECRET ?? "",
      authHeaderName: "Authorization",
      pricePerCall: PRICE_PER_CALL,
      category: "Video",
      exampleRequest,
      exampleResponse,
      inputType: "json",
      responseType: "json",
    },
    { headers }
  );

  const api = createRes.data.api;
  console.log(`✅ API registered`);
  console.log(`    id:              ${api.id}`);
  console.log(`    slug:            ${api.slug}`);
  console.log(`    approvalStatus:  ${api.approvalStatus}`);
  console.log(`    isActive:        ${api.isActive}`);
  console.log(`\nNext steps:`);
  console.log(`  1. As Obolos admin, approve API id ${api.id}.`);
  console.log(`  2. Verify discoverability: \`obolos search "news" --json\``);
  console.log(`  3. Mint ERC-8004 identity for ${SELLER_ADDRESS} at`);
  console.log(`     app.obolos.tech/app/agent/${SELLER_ADDRESS}\n`);
}

main().catch((err) => {
  if (axios.isAxiosError(err) && err.response) {
    console.error(`\n❌ HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}\n`);
  } else {
    console.error(`\n❌ ${(err as Error).message}\n`);
  }
  process.exit(1);
});
