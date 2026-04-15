// ═══════════════════════════════════════════════════════════════
// Agent-key resolver
// Each agent can be assigned a dedicated Locus claw_ key via env.
// If set, the agent's wrapped-API calls debit its own wallet
// (AUTONOMOUS mode). If unset, it falls back to the orchestrator's
// main key (ORCHESTRATOR-BILLED mode).
// ═══════════════════════════════════════════════════════════════

export type AgentName =
  | "researcher"
  | "scriptwriter"
  | "visual"
  | "voice"
  | "music"
  | "editor";

const AGENT_KEY_ENV: Record<AgentName, string> = {
  researcher:   "LOCUS_API_KEY_RESEARCHER",
  scriptwriter: "LOCUS_API_KEY_SCRIPTWRITER",
  visual:       "LOCUS_API_KEY_VISUAL",
  voice:        "LOCUS_API_KEY_VOICE",
  music:        "LOCUS_API_KEY_MUSIC",
  editor:       "LOCUS_API_KEY_EDITOR", // never used (no paid APIs) but slot reserved
};

/**
 * Returns the agent's dedicated key if set, or undefined to fall back
 * to the orchestrator's main LOCUS_API_KEY.
 */
export function getAgentKey(agent: AgentName): string | undefined {
  const envName = AGENT_KEY_ENV[agent];
  const val = process.env[envName];
  return val && val.trim().length > 0 ? val.trim() : undefined;
}

export function isAutonomous(agent: AgentName): boolean {
  return getAgentKey(agent) !== undefined;
}

export interface AgentMode {
  agent: AgentName;
  autonomous: boolean;
  keyName: string;
}

export function getAgentMode(agent: AgentName): AgentMode {
  return {
    agent,
    autonomous: isAutonomous(agent),
    keyName: AGENT_KEY_ENV[agent],
  };
}

export function getAllAgentModes(): AgentMode[] {
  return (Object.keys(AGENT_KEY_ENV) as AgentName[]).map(getAgentMode);
}
