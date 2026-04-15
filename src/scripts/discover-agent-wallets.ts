// Walk each per-agent key and print the wallet address it controls.
// Run: npx tsx src/scripts/discover-agent-wallets.ts

import * as dotenv from "dotenv";
dotenv.config();

import { getLocusBalance } from "../locus";
import { getAgentKey, AgentName } from "../agent-keys";

async function main() {
  const main = await getLocusBalance();
  console.log(`\n💼 Main treasury     ${main.address}  $${main.balance.toFixed(4)}\n`);

  const agents: AgentName[] = ["researcher", "scriptwriter", "visual", "voice", "music"];
  console.log("Agent          Autonomous key → wallet address                     Balance");
  console.log("─".repeat(90));
  for (const a of agents) {
    const key = getAgentKey(a);
    if (!key) {
      console.log(`${a.padEnd(14)} (no dedicated key — orchestrator-billed)`);
      continue;
    }
    try {
      const info = await getLocusBalance(key);
      console.log(`${a.padEnd(14)} ${info.address}  $${info.balance.toFixed(4)}`);
    } catch (e) {
      console.log(`${a.padEnd(14)} FAILED: ${(e as Error).message}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
