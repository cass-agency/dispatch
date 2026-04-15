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

// ── Checkout ─────────────────────────────────────────────────

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
}): Promise<CheckoutSession> {
  const client = getClient();
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

export async function getCheckoutSession(sessionId: string): Promise<CheckoutSession> {
  const client = getClient();
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

// ── Balance & Transactions ────────────────────────────────────

export interface BalanceInfo {
  balance: number;
  address: string;
}

export async function getLocusBalance(): Promise<BalanceInfo> {
  const client = getClient();
  try {
    const response = await client.get("/api/pay/balance");
    const envelope = response.data as {
      success?: boolean;
      data?: {
        wallet_address?: string;
        usdc_balance?: string;
        // legacy field names just in case
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

export async function getLocusTransactions(limit = 20): Promise<unknown[]> {
  const client = getClient();
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
  console.log(`[COST] 💰 ${agentName.padEnd(12)} $${(cost).toFixed(4)} USDC  — ${description}`);
}

export async function callWrappedStream(
  provider: string,
  endpoint: string,
  body: Record<string, unknown>,
  onToken: (t: string) => void
): Promise<string> {
  const key = process.env.LOCUS_API_KEY;
  if (!key) throw new Error("LOCUS_API_KEY environment variable is not set");

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
      // Not SSE — fall back to regular call
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
        } catch {
          // ignore parse errors for non-JSON lines
        }
      }
    }

    return accumulated;
  } catch (err) {
    // Fall back to regular callWrapped
    console.warn(`[locus] callWrappedStream falling back to callWrapped: ${(err as Error).message}`);
    const result = await callWrapped(provider, endpoint, body);
    // Extract text from Anthropic-style response
    const raw = result as { content?: Array<{ text?: string }> };
    const text = raw.content?.[0]?.text ?? String(result);
    onToken(text);
    return text;
  }
}

