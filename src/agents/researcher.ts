import { callWrapped, logCost } from "../locus";

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

export interface ResearchResult {
  articles: Article[];
  summary: string;
}

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
        "The Locus payment layer allows AI agents to transact with one another in real time using USDC, unlocking a new generation of autonomous economic activity.",
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
};

export async function runResearcher(
  topic = "AI agent economy breakthroughs"
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
  })) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
    answer?: string;
  };

  const articles: Article[] = (raw.results ?? []).map((r) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    content: r.content ?? "",
  }));

  const summary =
    raw.answer ??
    articles
      .slice(0, 3)
      .map((a) => a.content)
      .join(" ");

  logCost("researcher", 0.09, "Tavily news search");
  console.log(
    `🔍 [Researcher] Found ${articles.length} articles, summary length: ${summary.length} chars`
  );

  return { articles, summary };
}
