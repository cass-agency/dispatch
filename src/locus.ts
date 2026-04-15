import axios, { AxiosInstance } from "axios";

const LOCUS_BASE = "https://beta-api.paywithlocus.com";

// ──────────────────────────────────────────────────────────────
// Per-key client cache
// Each agent can own its own claw_ key → its own Locus wallet.
// All wrapped-API calls made with that key bill the agent's wallet.
// ──────────────────────────────────────────────────────────────

const _clients = new Map<string, AxiosInstance>();

function resolveKey(apiKey?: string): string {
  const key = apiKey ?? process.env.LOCUS_API_KEY;
  if (!key) throw new Error("LOCUS_API_KEY environment variable is not set");
  return key;
}

function getClient(apiKey?: string): AxiosInstance {
  const key = resolveKey(apiKey);
  let client = _clients.get(key);
  if (!client) {
    client = axios.create({
      baseURL: LOCUS_BASE,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      timeout: 120_000,
    });
    _clients.set(key, client);
  }
  return client;
}

// ──────────────────────────────────────────────────────────────
// Wrapped API calls — debited to whichever wallet backs apiKey
// ──────────────────────────────────────────────────────────────

export async function callWrapped(
  provider: string,
  endpoint: string,
  body: Record<string, unknown>,
  apiKey?: string
): Promise<unknown> {
  const client = getClient(apiKey);
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

export async function callWrappedStream(
  provider: string,
  endpoint: string,
  body: Record<string, unknown>,
  onToken: (t: string) => void,
  apiKey?: string
): Promise<string> {
  const key = resolveKey(apiKey);
  const path = `/api/wrapped/${provider}/${endpoint}`;
  const url = `${LOCUS_BASE}${path}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ ...body, stream: true }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      throw new Error(`Non-SSE response: ${contentType}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body reader");

    const decoder = new TextDecoder();
    let accumulated = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;
        try {
          const event = JSON.parse(dataStr) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (event.type === "content_block_delta" && event.delta?.text) {
            onToken(event.delta.text);
            accumulated += event.delta.text;
          }
        } catch {}
      }
    }
    return accumulated;
  } catch (err) {
    console.warn(`[locus] callWrappedStream falling back to callWrapped: ${(err as Error).message}`);
    const result = await callWrapped(provider, endpoint, body, apiKey);
    const raw = result as { content?: Array<{ text?: string }> };
    const text = raw.content?.[0]?.text ?? String(result);
    onToken(text);
    return text;
  }
}

// ──────────────────────────────────────────────────────────────
// Pay — sends USDC from the wallet backing apiKey
// ──────────────────────────────────────────────────────────────

export async function pay(
  toAddress: string,
  amount: number,
  memo: string,
  apiKey?: string
): Promise<unknown> {
  const client = getClient(apiKey);
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

// ──────────────────────────────────────────────────────────────
// Checkout
// ──────────────────────────────────────────────────────────────

export interface CheckoutSession {
  id: string;
  checkoutUrl: string;
  amount: string;
  currency: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  metadata?: Record<string, string>;
  paymentTxHash?: string;
  payerAddress?: string;
  paidAt?: string;
  expiresAt: string;
}

export async function createCheckoutSession(params: {
  amount: string;
  description: string;
  metadata?: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}, apiKey?: string): Promise<CheckoutSession> {
  const client = getClient(apiKey);
  try {
    const response = await client.post("/api/checkout/sessions", {
      amount: params.amount,
      currency: "USDC",
      description: params.description,
      metadata: params.metadata ?? {},
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      expiresInMinutes: 60,
    });
    const envelope = response.data as { success?: boolean; data?: CheckoutSession };
    return envelope.data!;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? "??";
      const detail = JSON.stringify(err.response?.data ?? err.message);
      throw new Error(`Locus checkout session creation failed (${status}): ${detail}`);
    }
    throw err;
  }
}

export async function getCheckoutSession(sessionId: string, apiKey?: string): Promise<CheckoutSession> {
  const client = getClient(apiKey);
  try {
    const response = await client.get(`/api/checkout/sessions/${sessionId}`);
    const envelope = response.data as { success?: boolean; data?: CheckoutSession };
    return envelope.data!;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? "??";
      const detail = JSON.stringify(err.response?.data ?? err.message);
      throw new Error(`Locus checkout session fetch failed (${status}): ${detail}`);
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────
// Balance & transactions
// ──────────────────────────────────────────────────────────────

export interface BalanceInfo {
  balance: number;
  address: string;
}

export async function getLocusBalance(apiKey?: string): Promise<BalanceInfo> {
  const client = getClient(apiKey);
  try {
    const response = await client.get("/api/pay/balance");
    const envelope = response.data as {
      success?: boolean;
      data?: {
        wallet_address?: string;
        usdc_balance?: string;
        address?: string;
        balance?: number;
      };
    };
    const d = envelope.data ?? {};
    return {
      address: d.wallet_address ?? d.address ?? "",
      balance: parseFloat(d.usdc_balance ?? String(d.balance ?? 0)) || 0,
    };
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      throw new Error(`Locus balance check failed: ${err.response?.status}`);
    }
    throw err;
  }
}

export async function getLocusTransactions(limit = 20, apiKey?: string): Promise<unknown[]> {
  const client = getClient(apiKey);
  try {
    const response = await client.get(`/api/pay/transactions?limit=${limit}`);
    const envelope = response.data as {
      success?: boolean;
      data?: { transactions: unknown[] };
    };
    return envelope.data?.transactions ?? [];
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      throw new Error(`Locus transactions fetch failed: ${err.response?.status}`);
    }
    throw err;
  }
}

export function logCost(agentName: string, cost: number, description: string): void {
  console.log(`[COST] 💰 ${agentName.padEnd(12)} $${cost.toFixed(4)} USDC  — ${description}`);
}
