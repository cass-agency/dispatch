import axios, { AxiosInstance } from "axios";

const LOCUS_BASE = "https://beta-api.paywithlocus.com";

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!_client) {
    const key = process.env.LOCUS_API_KEY;
    if (!key) throw new Error("LOCUS_API_KEY environment variable is not set");
    _client = axios.create({
      baseURL: LOCUS_BASE,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      timeout: 120_000,
    });
  }
  return _client;
}

export async function callWrapped(
  provider: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const client = getClient();
  const path = `/api/wrapped/${provider}/${endpoint}`;
  try {
    const response = await client.post(path, body);
    const envelope = response.data as { success?: boolean; data?: unknown };
    return envelope?.data ?? response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? "??";
      const detail = JSON.stringify(err.response?.data ?? err.message);
      throw new Error(`Locus wrapped call to ${path} failed (${status}): ${detail}`);
    }
    throw err;
  }
}

export async function pay(
  toAddress: string,
  amount: number,
  memo: string
): Promise<unknown> {
  const client = getClient();
  try {
    const response = await client.post("/api/pay/send", { to_address: toAddress, amount, memo });
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

export function logCost(agentName: string, cost: number, description: string): void {
  console.log(`[COST] 💰 ${agentName.padEnd(12)} $${(cost).toFixed(4)} USDC  — ${description}`);
}

