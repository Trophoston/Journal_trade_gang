import type { ObjectId } from "mongodb";

export type ReportKind = "trade" | "daily" | "weekly" | "brief" | "pretrade";

export interface Source {
  title: string;
  uri: string;
}

export interface Usage {
  input: number;
  output: number;
  total: number;
}

export interface AiReport {
  _id: string;
  kind: ReportKind;
  scopeKey: string;
  version: number;
  accountId: string;
  title: string;
  model: string;
  promptVersion: number;
  inputHash: string;
  lang: "th" | "en";
  content: unknown;
  sources: Source[];
  usage: Usage;
  auto: boolean;
  createdAt: Date;
}

export interface AiJob {
  _id?: ObjectId;
  kind: ReportKind;
  scopeKey: string;
  accountId: string;
  payload: Record<string, string>;
  status: "queued" | "running" | "done" | "failed";
  active: boolean;
  auto: boolean;
  force: boolean;
  runAfter: Date;
  attempts: number;
  error?: string;
  step?: number;
  steps: string[];
  reportId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadMessage {
  role: "user" | "model";
  text: string;
  tools?: { name: string; args: unknown; summary: string }[];
  at: Date;
}

export interface AiThread {
  _id: string;
  scopeKey: string;
  reportId?: string;
  accountId: string;
  title: string;
  messages: ThreadMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AiUsage {
  at: Date;
  kind: string;
  model: string;
  input: number;
  output: number;
  total: number;
  /** Set when the call failed; failed calls still count toward Gemini's per-minute limits. */
  error?: "rate_limit" | "failed";
}
