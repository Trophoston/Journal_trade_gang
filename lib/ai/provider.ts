import { GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration, type GenerateContentResponse, type Part } from "@google/genai";
import { z } from "zod";
import { cols } from "../db/collections";
import type { Source, Usage } from "./types";

export type Thinking = "low" | "medium" | "high";

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs: number,
  ) {
    super(message);
  }
}

export class AiConfigError extends Error {}

export interface JsonRequest<T> {
  kind: string;
  model: string;
  /** Tried in order when the model is unavailable or rate-limited. */
  fallbackModels?: string[];
  system: string;
  parts: Part[];
  schema: z.ZodType<T>;
  thinking?: Thinking;
  /** Deterministic stand-in used by the mock provider. */
  mock: () => T;
}

export interface JsonResult<T> {
  data: T;
  model: string;
  usage: Usage;
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "calls"; calls: { name: string; args: Record<string, unknown> }[]; content: Content };

export interface ChatRequest {
  model: string;
  system: string;
  contents: Content[];
  tools: FunctionDeclaration[];
}

export function providerName(): "gemini" | "mock" {
  return process.env.AI_PROVIDER === "mock" ? "mock" : "gemini";
}

export function aiConfigured(): boolean {
  return providerName() === "mock" || Boolean(process.env.GEMINI_API_KEY);
}

const g = globalThis as unknown as { __tgGenai?: GoogleGenAI };
function client(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new AiConfigError("ยังไม่ได้ตั้ง GEMINI_API_KEY ใส่ใน .env.local แล้วรีสตาร์ตแอป");
  return (g.__tgGenai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

function jsonSchemaOf(schema: z.ZodType) {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

const LEVEL: Record<Thinking, ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

function statusOf(err: unknown): number {
  const e = err as { status?: number; code?: number };
  return e?.status ?? e?.code ?? 0;
}

function retryDelay(err: unknown): number {
  const m = String((err as Error)?.message ?? "").match(/retry(?:Delay)?[^0-9]{0,20}(\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) + 500 : 60_000;
}

/** Map SDK failures to errors the queue and UI can explain. */
function normalizeError(err: unknown): Error {
  const status = statusOf(err);
  const msg = String((err as Error)?.message ?? err);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return new RateLimitError("ชน rate limit ของ Gemini", retryDelay(err));
  if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED/i.test(msg))
    return new AiConfigError("Gemini ไม่รับ API key นี้ ตรวจสอบ GEMINI_API_KEY ใน .env.local");
  if (status >= 500) return new RateLimitError("Gemini ใช้งานไม่ได้ชั่วคราว", 30_000);
  return err instanceof Error ? err : new Error(msg);
}

const isRateLimit = (err: unknown) => statusOf(err) === 429 || /RESOURCE_EXHAUSTED|quota/i.test(String((err as Error)?.message));

const isModelProblem = (err: unknown) => {
  const s = statusOf(err);
  return s === 404 || /not found|not supported|does not exist|unknown model/i.test(String((err as Error)?.message));
};
const isThinkingProblem = (err: unknown) => statusOf(err) === 400 && /think/i.test(String((err as Error)?.message));

async function logUsage(kind: string, model: string, usage: Usage, err?: unknown) {
  try {
    const c = await cols();
    await c.aiUsage.insertOne({ at: new Date(), kind, model, ...usage, ...(err !== undefined ? { error: isRateLimit(err) ? "rate_limit" : "failed" } : {}) });
  } catch {
    // usage logging must never break an analysis
  }
}

function usageOf(meta: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined): Usage {
  return { input: meta?.promptTokenCount ?? 0, output: meta?.candidatesTokenCount ?? 0, total: meta?.totalTokenCount ?? 0 };
}

const NO_USAGE: Usage = { input: 0, output: 0, total: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Structured JSON generation, validated with the Zod schema. */
export async function generateJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
  if (providerName() === "mock") {
    if (process.env.AI_MOCK_DELAY !== "0") await sleep(900 + Math.random() * 900);
    const data = req.schema.parse(req.mock());
    return { data, model: "mock", usage: { input: 0, output: 0, total: 0 } };
  }
  const ai = client();
  const models = [...new Set([req.model, ...(req.fallbackModels ?? [])].filter(Boolean))];
  let lastErr: unknown;
  for (const model of models) {
    let thinking = req.thinking;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: req.parts }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchemaOf(req.schema),
            temperature: 0.4,
            ...(thinking ? { thinkingConfig: { thinkingLevel: LEVEL[thinking] } } : {}),
          },
        });
        const usage = usageOf(res.usageMetadata);
        await logUsage(req.kind, model, usage);
        const parsed = req.schema.safeParse(JSON.parse(res.text ?? "{}"));
        if (parsed.success) return { data: parsed.data, model, usage };
        lastErr = new Error(`Gemini ตอบกลับในรูปแบบที่ไม่คาดไว้: ${parsed.error.issues[0]?.message}`);
      } catch (err) {
        lastErr = err;
        await logUsage(req.kind, model, NO_USAGE, err);
        if (thinking && isThinkingProblem(err)) {
          thinking = undefined;
          continue;
        }
        // Free tier: a model out of quota (or paid-only, which reports quota 0) hands over to the next one.
        if (isModelProblem(err) || (isRateLimit(err) && model !== models.at(-1))) break;
        throw normalizeError(err);
      }
    }
  }
  throw normalizeError(lastErr);
}

/** One grounded Google Search call: short text + sources. */
export async function groundedSearch(model: string, prompt: string): Promise<{ text: string; sources: Source[] }> {
  if (providerName() === "mock") return { text: "", sources: [] };
  try {
    const res = await client().models.generateContent({ model, contents: prompt, config: { tools: [{ googleSearch: {} }], temperature: 0.2 } });
    await logUsage("search", model, usageOf(res.usageMetadata));
    const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c) => ({ title: c.web?.title ?? "", uri: c.web?.uri ?? "" }))
      .filter((s) => s.uri)
      .slice(0, 6);
    return { text: res.text ?? "", sources };
  } catch (err) {
    await logUsage("search", model, NO_USAGE, err);
    throw normalizeError(err);
  }
}

/** Streaming chat turn. Yields text deltas, and the function calls (with the full model content) when the model asks for tools. */
const CHAT_FIRST_CHUNK_MS = 90_000;
const CHAT_IDLE_MS = 45_000;
const STALLED = new Error("stalled");

export async function* chatStream(req: ChatRequest, mock: () => AsyncGenerator<ChatEvent>): AsyncGenerator<ChatEvent> {
  if (providerName() === "mock") {
    yield* mock();
    return;
  }
  // A stream that stops sending would leave the chat spinning forever. The SDK's abort signal
  // doesn't reach a stream that's already reading, so every wait races a timer of its own.
  const ac = new AbortController();
  const stalled = () => new Error("Gemini ไม่ตอบภายในเวลาที่กำหนด ลองถามใหม่อีกครั้ง");
  const within = async <T,>(p: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(STALLED), ms)))]);
    } finally {
      clearTimeout(timer);
    }
  };
  const parts: Part[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let usage: Usage | undefined;
  let it: AsyncIterator<GenerateContentResponse> | undefined;
  try {
    console.log("[chat] request", req.contents.length);
    const stream = await within(
      client().models.generateContentStream({
        model: req.model,
        contents: req.contents,
        config: { systemInstruction: req.system, tools: [{ functionDeclarations: req.tools }], temperature: 0.5, abortSignal: ac.signal },
      }),
      CHAT_FIRST_CHUNK_MS,
    );
    it = stream[Symbol.asyncIterator]();
    for (let first = true; ; first = false) {
      const next = await within(it.next(), first ? CHAT_FIRST_CHUNK_MS : CHAT_IDLE_MS);
      console.log("[chat] chunk", next.done ? "done" : (next.value.candidates?.[0]?.content?.parts ?? []).map((p) => Object.keys(p).join("+")).join(","));
      if (next.done) break;
      const chunk = next.value;
      for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(p);
        if (p.functionCall?.name) calls.push({ name: p.functionCall.name, args: (p.functionCall.args ?? {}) as Record<string, unknown> });
        else if (p.text && !p.thought) yield { type: "text", delta: p.text };
      }
      if (chunk.usageMetadata) usage = usageOf(chunk.usageMetadata);
    }
  } catch (err) {
    console.log("[chat] error", err === STALLED ? "stalled" : err);
    await logUsage("chat", req.model, usage ?? NO_USAGE, err);
    if (err !== STALLED) throw normalizeError(err);
    ac.abort();
    void it?.return?.();
    throw stalled();
  }
  if (usage) await logUsage("chat", req.model, usage);
  if (calls.length) yield { type: "calls", calls, content: { role: "model", parts } };
}

/** Models available to this key, for the Settings dropdowns. */
export async function listModels(): Promise<string[]> {
  if (providerName() === "mock") return ["mock"];
  const out: string[] = [];
  const pager = await client().models.list({ config: { pageSize: 100 } });
  for await (const m of pager) {
    const name = m.name?.replace(/^models\//, "");
    if (name && /^gemini/.test(name) && (m.supportedActions ?? ["generateContent"]).includes("generateContent")) out.push(name);
  }
  return out.sort();
}
