import { callWrapped, callWrappedStream, logCost } from "../locus";
import { getAgentKey } from "../agent-keys";

const AGENT_KEY = () => getAgentKey("researcher");

// ============================================================
// Researcher Agent
// Uses Tavily search to find AI agent economy news
// Cost: ~$0.09 (Tavily basic search)
// ============================================================

// DEMO MODE: set to true to skip API calls and use placeholder data
const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface Article {
  title: string;
  url: string;
  content: string;
}

export interface ResearchBrief {
  headline: string;
  angle: string;
  keyFacts: string[];
  emotionalRegister: string;
  mood: string;
  context: string;
  summary: string;
}

export interface ResearchResult {
  articles: Article[];
  summary: string;
  brief: ResearchBrief;
}

const DEMO_BRIEF: ResearchBrief = {
  headline: "AI Agents Are Rewriting the Rules of the Global Economy",
  angle: "Autonomous AI agents are crossing the threshold from experimental to essential infrastructure, fundamentally disrupting labor markets and financial systems.",
  keyFacts: [
    "AI agent deployments have driven 30% productivity gains in sectors like finance and logistics",
    "Locus network enables real-time USDC payments between AI agents with zero human intermediaries",
    "OpenAI's Operator framework lets GPT-4 class models execute complex multi-step autonomous tasks",
  ],
  emotionalRegister: "urgent",
  mood: "urgent, optimistic, cinematic",
  context: "The AI agent economy has moved from theoretical to operational. Major infrastructure layers like Locus now enable direct agent-to-agent commerce, while enterprise deployments are already demonstrating measurable economic impact.",
  summary: "This story is about the tipping point moment for autonomous AI agents. The angle is economic transformation: not just that agents are capable, but that they are now embedded in real financial infrastructure, earning and spending real money. The scriptwriter should convey both the technical milestone and the human stakes — jobs, markets, and power structures are all in flux. The tone should feel like a watershed moment being reported live.",
};

const DEMO_RESULT: ResearchResult = {
  articles: [
    {
      title: "AI Agents Are Reshaping the Global Economy",
      url: "https://example.com/ai-agents-economy",
      content:
        "Autonomous AI agents are increasingly taking on complex tasks in finance, logistics, and healthcare, driving productivity gains unseen since the industrial revolution.",
    },
    {
      title: "Locus Network Enables Agent-to-Agent Payments",
      url: "https://example.com/locus-a2a-payments",
      content:
        "The Locus payment layer allows AI agents to transact with one another in real time using USDC stablecoins, unlocking a new generation of autonomous economic activity.",
    },
    {
      title: "OpenAI Launches Operator Framework for Autonomous Tasks",
      url: "https://example.com/openai-operator",
      content:
        "OpenAI's new Operator framework lets GPT-4 class models browse the web, run code, and complete multi-step tasks with minimal human oversight.",
    },
  ],
  summary:
    "The AI agent economy is rapidly maturing. Autonomous agents are transacting, collaborating, and producing value across industries. Infrastructure layers like Locus are enabling frictionless USDC payments between agents, while major AI labs release operator-style frameworks that push AI further into real-world workflows.",
  brief: DEMO_BRIEF,
};

export async function runResearcher(
  topic = "AI agent economy breakthroughs",
  onToken?: (t: string) => void
): Promise<ResearchResult> {
  console.log("🔍 [Researcher] Starting news search for:", topic);

  if (DEMO_MODE) {
    console.log("🔍 [Researcher] DEMO MODE — returning placeholder data");
    logCost("researcher", 0.09, "Tavily search (demo)");
    return DEMO_RESULT;
  }

  const raw = (await callWrapped("tavily", "search", {
    query: topic,
    topic: "news",
    max_results: 5,
    days: 1,
    include_answer: true,
  }, AGENT_KEY())) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
    answer?: string;
  };

  const articles: Article[] = (raw.results ?? []).map((r) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    content: r.content ?? "",
  }));

  const rawSummary =
    raw.answer ??
    articles
      .slice(0, 3)
      .map((a) => a.content)
      .join(" ");

  logCost("researcher", 0.09, "Tavily news search");
  console.log(
    `🔍 [Researcher] Found ${articles.length} articles, summary length: ${rawSummary.length} chars`
  );

  // Editorial LLM reasoning
  console.log("🔍 [Researcher] Running editorial LLM reasoning...");
  const editorialPrompt = `You are the editorial director of Dispatch, an autonomous AI news network. Tavily has returned search results about "${topic}". Your job is editorial judgment: decide what's actually newsworthy, what angle serves the audience, and brief the scriptwriter.

Raw search results:
${articles.map((a) => `TITLE: ${a.title}\n${a.content}`).join("\n---\n")}

Tavily summary: ${rawSummary}

Return ONLY valid JSON (no markdown):
{
  "headline": "punchy proposed headline, 8-12 words",
  "angle": "the primary narrative angle that makes this newsworthy",
  "keyFacts": ["most important fact", "second fact", "third fact"],
  "emotionalRegister": "single word: urgent/hopeful/alarming/inspiring/analytical/tense",
  "mood": "three comma-separated mood words",
  "context": "One or two sentences of background context for the scriptwriter.",
  "summary": "A paragraph-length editorial brief describing the story and how to tell it."
}`;

  let brief: ResearchBrief = DEMO_BRIEF;
  try {
    const briefText = await callWrappedStream(
      "anthropic",
      "chat",
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: editorialPrompt }],
        max_tokens: 600,
      },
      onToken ?? (() => {}),
      AGENT_KEY()
    );
    const cleaned = briefText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    brief = JSON.parse(cleaned) as ResearchBrief;
  } catch (err) {
    console.warn("🔍 [Researcher] Failed to parse editorial brief, using fallback:", (err as Error).message);
    brief = {
      headline: articles[0]?.title ?? topic,
      angle: rawSummary.slice(0, 200),
      keyFacts: articles.slice(0, 3).map((a) => a.title),
      emotionalRegister: "analytical",
      mood: "informative, clear, urgent",
      context: rawSummary.slice(0, 300),
      summary: rawSummary,
    };
  }

  console.log(`🔍 [Researcher] Editorial brief ready: "${brief.headline}"`);

  return { articles, summary: rawSummary, brief };
}
