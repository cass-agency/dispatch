import axios, { AxiosInstance } from "axios";

// ============================================================
// Locus API Client
// All external API calls are routed through Locus wrapped APIs
// ============================================================

const LOCUS_BASE = "https://beta-api.paywithlocus.com";

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!_client) {
    const key = process.env.LOCUS_API_KEY;
    if (!key) {
      throw new Error("LOCUS_API_KEY environment variable is not set");
    }
    _client = axios.create({
      baseURL: LOCUS_BASE,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      timeout: 120_000,
    });
  }
  return _client;
}

/**
 * Call a Locus-wrapped third-party API.
 * @param provider  e.g. "tavily", "anthropic", "fal", "deepgram", "suno"
 * @param endpoint  path segment after /api/wrapped/{provider}/  e.g. "search"
 * @param body      request payload
 */
export async function callWrapped(
  provider: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const client = getClient();
  const path = `/api/wrapped/${provider}/${endpoint}`;
  try {
    const response = await client.post(path, body);
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? "??";
      const detail = JSON.stringify(err.response?.data ?? err.message);
      throw new Error(`Locus wrapped call to ${path} failed (${status}): ${detail}`);
    }
    throw err;
  }
}

/**
 * Send USDC to an agent address via Locus pay API.
 * @param toAddress  Ethereum address of recipient
 * @param amount     Amount in USDC
 * @param memo       Human-readable memo
 */
export async function pay(
  toAddress: string,
  amount: number,
  memo: string
): Promise<unknown> {
  const client = getClient();
  try {
    const response = await client.post("/api/pay/send", {
      to_address: toAddress,
      amount,
      memo,
    });
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? "??";
      const detail = JSON.stringify(err.response?.data ?? err.message);
      throw new Error(`Locus pay failed (${status}): ${detail}`);
    }
    throw err;
  }
}

/**
 * Log a payment / cost event to the console.
 */
export function logCost(
  agentName: string,
  cost: number,
  description: string
): void {
  const formatted = cost.toFixed(4);
  console.log(
    `[COST] 💰 ${agentName.padEnd(12)} $${formatted} USDC  — ${description}`
  );
}
