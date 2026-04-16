// ═══════════════════════════════════════════════════════════════
// Seed each autonomous agent wallet with an initial USDC float
// so they have balance to back their first wrapped-API calls.
// Runs using the main orchestrator key (LOCUS_API_KEY).
//
// Usage: npm run seed-agents
// ═══════════════════════════════════════════════════════════════

import * as dotenv from "dotenv";
dotenv.config();

import { pay, getLocusBalance } from "../locus";
import { getAgentMode, AgentName } from "../agent-keys";

// How much to seed each agent's wallet with (one-time float)
const SEED_AMOUNT = parseFloat(process.env.SEED_AMOUNT ?? "0.25"); // USDC per agent

// Wallet address per agent — same map as pipeline.ts
const AGENT_WALLETS: Record<AgentName, string> = {
  researcher:   "0x99ea943041e186b103a160e843e3e8ef47881c5c",
  scriptwriter: "0x403760e3f06c126c687722897bf2d661cb8585a8",
  visual:       "0x16ae9ba7ea3cbf57e632d5533ff01645fc901cdd",
  voice:        "0x8fe8c382e5cbbd590e9eca04cbdf6ae17de89ed5",
  music:        "0x053f33a2a7c03f6dd9000c9e1e956e9ea5833563",
  editor:       "", // no wallet
};

async function main() {
  console.log("\n🌱 Dispatch — Agent Wallet Seeder\n");

  // Check main balance first
  const main = await getLocusBalance();
  console.log(`💼 Main treasury: $${main.balance.toFixed(2)} USDC  (${main.address})\n`);

  const agents: AgentName[] = ["researcher", "scriptwriter", "visual", "voice", "music"];
  const autonomous = agents.filter((a) => getAgentMode(a).autonomous);
  const needed = SEED_AMOUNT * autonomous.length;

  console.log(`📋 Autonomous agents: ${autonomous.length}/5`);
  autonomous.forEach((a) => {
    const mode = getAgentMode(a);
    console.log(`   ✓ ${a.padEnd(14)} ← ${mode.keyName}`);
  });
  if (autonomous.length < 5) {
    const orchestrated = agents.filter((a) => !getAgentMode(a).autonomous);
    console.log(`\n   Still orchestrator-billed (no key yet):`);
    orchestrated.forEach((a) => console.log(`   ○ ${a}`));
  }

  console.log(`\n💰 Seed plan: $${SEED_AMOUNT.toFixed(2)} × ${autonomous.length} = $${needed.toFixed(2)} USDC`);

  if (main.balance < needed) {
    console.error(`\n❌ Insufficient balance. Need $${needed.toFixed(2)}, have $${main.balance.toFixed(2)}`);
    process.exit(1);
  }

  for (const agent of autonomous) {
    const addr = AGENT_WALLETS[agent];
    process.stdout.write(`\n  → Seeding ${agent.padEnd(14)} (${addr.slice(0, 8)}…) $${SEED_AMOUNT.toFixed(2)}... `);
    try {
      await pay(addr, SEED_AMOUNT, `Dispatch seed: ${agent} autonomous float`);
      process.stdout.write("✓\n");
    } catch (e) {
      process.stdout.write(`✗\n     ${(e as Error).message}\n`);
    }
  }

  console.log("\n✅ Seeding complete.\n");
}

main().catch((e) => {
  console.error("\n❌ Fatal:", e);
  process.exit(1);
});
