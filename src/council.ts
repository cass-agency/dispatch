// ═══════════════════════════════════════════════════════════════
// Council — pre-flight + recovery multi-agent conversation
// Each agent takes a turn via Claude Haiku, debits its OWN
// wallet for its own chatter (via its claw_ key), and speaks
// in-character about scope, cost, and handoffs.
// ═══════════════════════════════════════════════════════════════

import { callWrapped } from "./locus";
import { AgentName, getAgentKey } from "./agent-keys";

export type AgentColor = "yellow" | "lime" | "coral" | "sky" | "lavender" | "paper" | "black";

export interface Persona {
  role: string;
  apis: Array<{ name: string; cost: number }>;
  typicalTotal: number;
  style: string;
  color: AgentColor;
}

export const PERSONAS: Record<AgentName, Persona> = {
  researcher: {
    role: "head of research and editorial direction",
    apis: [
      { name: "Tavily news search", cost: 0.09 },
      { name: "Claude Haiku (editorial brief)", cost: 0.002 },
    ],
    typicalTotal: 0.09,
    style: "analytical, terse, newsroom staffer",
    color: "yellow",
  },
  scriptwriter: {
    role: "head writer of broadcast scripts",
    apis: [{ name: "Claude Haiku", cost: 0.002 }],
    typicalTotal: 0.01,
    style: "literary, clipped, rhythm-focused",
    color: "lime",
  },
  visual: {
    role: "visual director and cinematographer",
    apis: [
      { name: "Claude Haiku (visual direction)", cost: 0.002 },
      { name: "fal.ai Flux image generation x4", cost: 0.08 },
    ],
    typicalTotal: 0.09,
    style: "visual, moody, a film director",
    color: "coral",
  },
  voice: {
    role: "voice director and narrator",
    apis: [
      { name: "Claude Haiku (voice direction)", cost: 0.002 },
      { name: "Deepgram TTS", cost: 0.02 },
    ],
    typicalTotal: 0.03,
    style: "warm, sonorous, anchor-booth authority",
    color: "sky",
  },
  music: {
    role: "composer and music director",
    apis: [
      { name: "Claude Haiku (composition brief)", cost: 0.002 },
      { name: "Suno AI music", cost: 0.10 },
    ],
    typicalTotal: 0.10,
    style: "moody, descriptive, uses musical terms",
    color: "lavender",
  },
  editor: {
    role: "post-production editor",
    apis: [{ name: "FFmpeg local assembly (no API cost)", cost: 0 }],
    typicalTotal: 0,
    style: "technical, confident, cut-oriented",
    color: "paper",
  },
};

export interface ChatMessage {
  from: AgentName | "orchestrator" | "treasury";
  color: AgentColor;
  text: string;
  ts: number;
  estimate?: number;
  balance?: number;
  kind: "status" | "council" | "handoff" | "error" | "recovery" | "orchestrator";
}

export type ChatCallback = (msg: ChatMessage) => void;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function colorFor(agent: AgentName | "orchestrator" | "treasury"): AgentColor {
  if (agent === "orchestrator" || agent === "treasury") return "black";
  return PERSONAS[agent].color;
}

function parseJsonSafe<T = Record<string, unknown>>(raw: unknown): T | null {
  const text = (raw as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
  const cleaned = text.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Single council turn — one agent speaks via their own Haiku key
// ──────────────────────────────────────────────────────────────

async function runCouncilTurn(
  agent: AgentName,
  topic: string,
  transcript: string[]
): Promise<{ text: string; estimate: number }> {
  const persona = PERSONAS[agent];
  const transcriptText = transcript.length > 0
    ? transcript.join("\n\n")
    : "(you are the first to speak)";

  const prompt = `You are ${agent.toUpperCase()}, the ${persona.role} on Dispatch's autonomous news production team.

COMMISSION TOPIC: "${topic}"

YOUR CAPABILITIES:
${persona.apis.map((a) => `- ${a.name} (~$${a.cost.toFixed(3)} per call)`).join("\n")}
Your typical total per production: ~$${persona.typicalTotal.toFixed(2)} USDC.

PRIOR COUNCIL DISCUSSION:
${transcriptText}

Speak IN CHARACTER. Your voice: ${persona.style}.
Write 1-2 sentences (max 40 words) stating:
- What you'll specifically do for THIS topic
- Your cost estimate for this job (you may adjust up/down from your typical based on the brief)

Return ONLY valid JSON, no markdown:
{"text": "your 1-2 sentence message in first person", "estimatedCost": 0.XX}`;

  try {
    const raw = await callWrapped(
      "anthropic",
      "chat",
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 220,
      },
      getAgentKey(agent)
    );
    const parsed = parseJsonSafe<{ text: string; estimatedCost: number }>(raw);
    if (parsed && parsed.text) {
      return {
        text: parsed.text.trim(),
        estimate: typeof parsed.estimatedCost === "number" ? parsed.estimatedCost : persona.typicalTotal,
      };
    }
  } catch (e) {
    // fall through
  }
  return {
    text: `${agent} online. Budgeting $${persona.typicalTotal.toFixed(2)} for this job.`,
    estimate: persona.typicalTotal,
  };
}

// ──────────────────────────────────────────────────────────────
// The council session
// ──────────────────────────────────────────────────────────────

export interface CouncilOutcome {
  estimates: Partial<Record<AgentName, number>>;
  totalEstimate: number;
  commissionFee: number;
  approved: boolean;
  underfundedAgents: AgentName[];
}

export async function runCouncil(
  topic: string,
  balances: Partial<Record<AgentName, number>>,
  commissionFee: number,
  onChat: ChatCallback
): Promise<CouncilOutcome> {
  const orderedAgents: AgentName[] = ["researcher", "scriptwriter", "visual", "voice", "music"];
  const transcript: string[] = [];
  const estimates: Partial<Record<AgentName, number>> = {};
  const underfunded: AgentName[] = [];

  // Orchestrator opens the session
  onChat({
    from: "orchestrator",
    color: "black",
    kind: "orchestrator",
    text: `New commission: "${topic}". Commission pool: $${commissionFee.toFixed(2)}. Agents — declare your scope and your number.`,
    ts: Date.now(),
  });

  for (const agent of orderedAgents) {
    const balance = balances[agent] ?? 0;
    const persona = PERSONAS[agent];

    // Typing indicator
    onChat({
      from: agent,
      color: persona.color,
      kind: "status",
      text: "is typing...",
      ts: Date.now(),
    });

    const msg = await runCouncilTurn(agent, topic, transcript);
    estimates[agent] = msg.estimate;
    transcript.push(`${agent.toUpperCase()}: ${msg.text} (estimate: $${msg.estimate.toFixed(3)})`);

    onChat({
      from: agent,
      color: persona.color,
      kind: "council",
      text: msg.text,
      estimate: msg.estimate,
      balance,
      ts: Date.now(),
    });

    // Underfunded check
    if (balance < msg.estimate) {
      underfunded.push(agent);
      onChat({
        from: "treasury",
        color: "black",
        kind: "orchestrator",
        text: `${agent.toUpperCase()} balance $${balance.toFixed(3)} < needed $${msg.estimate.toFixed(3)} — flagging for top-up.`,
        ts: Date.now(),
      });
    }
  }

  const totalEstimate = Object.values(estimates).reduce((a, b) => a + (b ?? 0), 0);
  const approved = totalEstimate <= commissionFee;
  const margin = commissionFee - totalEstimate;

  onChat({
    from: "orchestrator",
    color: "black",
    kind: "orchestrator",
    text: approved
      ? `Budget locked. Total production cost: $${totalEstimate.toFixed(3)}. Margin: $${margin.toFixed(3)}. Rolling production.`
      : `Budget over by $${(-margin).toFixed(3)}. Proceeding best-effort; retaining retry buffer.`,
    ts: Date.now(),
  });

  return { estimates, totalEstimate, commissionFee, approved, underfundedAgents: underfunded };
}

// ──────────────────────────────────────────────────────────────
// Handoff messages between pipeline steps
// ──────────────────────────────────────────────────────────────

export async function announceHandoff(
  fromAgent: AgentName,
  toAgent: AgentName,
  productJson: string,
  onChat: ChatCallback
): Promise<void> {
  const persona = PERSONAS[fromAgent];
  const prompt = `You are ${fromAgent.toUpperCase()} (${persona.role}). You just finished your work. You're handing off to ${toAgent.toUpperCase()} (${PERSONAS[toAgent].role}).

What you produced (summary):
${productJson.slice(0, 400)}

Write ONE short sentence (max 18 words) addressed to ${toAgent}, in your voice (${persona.style}). State what you're handing over. No greeting, no JSON — just the sentence.`;

  try {
    const raw = await callWrapped(
      "anthropic",
      "chat",
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
      },
      getAgentKey(fromAgent)
    );
    const text = (raw as { content?: Array<{ text?: string }> }).content?.[0]?.text?.trim() ?? "";
    if (text) {
      onChat({
        from: fromAgent,
        color: persona.color,
        kind: "handoff",
        text: text.replace(/^"/, "").replace(/"$/, ""),
        ts: Date.now(),
      });
    }
  } catch {
    // ignore — handoff messages are nice-to-have
  }
}

// ──────────────────────────────────────────────────────────────
// Recovery council — agent asks for help on failure
// ──────────────────────────────────────────────────────────────

export async function runRecovery(
  failingAgent: AgentName,
  errorMessage: string,
  inputContext: string,
  helperAgent: AgentName,
  onChat: ChatCallback
): Promise<string | null> {
  const persona = PERSONAS[failingAgent];

  // Failing agent posts the distress call
  const shortErr = errorMessage.replace(/\s+/g, " ").slice(0, 200);
  onChat({
    from: failingAgent,
    color: persona.color,
    kind: "error",
    text: `Hit an error: ${shortErr} — @${helperAgent} can you help?`,
    ts: Date.now(),
  });

  const helperPersona = PERSONAS[helperAgent];
  const prompt = `You are ${helperAgent.toUpperCase()} (${helperPersona.role}). Your teammate ${failingAgent.toUpperCase()} (${persona.role}) just hit an error and is asking for your help to amend their input so it will succeed on retry.

ERROR: ${shortErr}

THEIR INPUT CONTEXT:
${inputContext.slice(0, 500)}

Propose a concrete revised input for ${failingAgent}. Keep your advice tight and specific — they will literally use your suggestion as the new input.

Return ONLY valid JSON:
{"message": "your 1-sentence reply in your voice (${helperPersona.style})", "revisedInput": "the concrete revised input they should use"}`;

  try {
    const raw = await callWrapped(
      "anthropic",
      "chat",
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
      },
      getAgentKey(helperAgent)
    );
    const parsed = parseJsonSafe<{ message?: string; revisedInput?: string }>(raw);
    if (parsed?.message) {
      onChat({
        from: helperAgent,
        color: helperPersona.color,
        kind: "recovery",
        text: parsed.message,
        ts: Date.now(),
      });
    }
    if (parsed?.revisedInput) {
      onChat({
        from: failingAgent,
        color: persona.color,
        kind: "recovery",
        text: `Got it — retrying with ${helperAgent}'s suggestion.`,
        ts: Date.now(),
      });
      return parsed.revisedInput;
    }
  } catch {
    /* ignore */
  }
  onChat({
    from: helperAgent,
    color: helperPersona.color,
    kind: "recovery",
    text: "Can't unblock this one — sorry.",
    ts: Date.now(),
  });
  return null;
}
