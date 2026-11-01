"use client";

import { create } from "zustand";

export interface LiveAccount {
  balance: number;
  equity: number;
  floating: number;
  margin: number;
  positions: number;
  connected: boolean;
  at: number;
}

export interface JobState {
  jobId: string;
  kind: string;
  step: number;
  steps: string[];
  status: "queued" | "running" | "failed" | "done";
  error?: string;
  reportId?: string;
  /** Started by the user here, so the AI tray follows it across pages. Auto jobs stay untracked. */
  tracked?: boolean;
  /** Pathname the run was started from. */
  origin?: string;
  /** Names the job in the tray, e.g. "XAUUSD Buy · 30 ต.ค.". */
  label?: string;
  /** Result kept for jobs whose page renders it from the store (the pre-trade check). */
  result?: unknown;
}

export interface ChatTarget {
  scopeKey: string;
  reportId?: string;
  title: string;
  prompt?: string;
  threadId?: string;
}

export interface Meta {
  timezone: string;
  tags: { setups: string[]; confluences: string[]; emotions: string[]; mistakes: string[] };
  accountId?: string;
  currency: string;
}

/** Row data shown instantly while a trade's detail streams in. */
export interface TradePreview {
  id: string;
  symbol: string;
  side: "long" | "short";
  net: number;
  r: number | null;
  outcome: "win" | "loss" | "be";
  openedAt: number;
  closedAt: number;
  session: string;
}

interface Store {
  meta: Meta;
  preview: TradePreview | null;
  setPreview: (p: TradePreview | null) => void;
  setMeta: (m: Meta) => void;
  live: Record<string, LiveAccount>;
  jobs: Record<string, JobState>;
  chat: (ChatTarget & { open: boolean }) | { open: false };
  commandOpen: boolean;
  setLive: (accountId: string, patch: Partial<LiveAccount>) => void;
  setJob: (scopeKey: string, job: JobState | null) => void;
  /** Merge into a job, keeping what the client knows (tracked, origin, label). Creates it if missing. */
  patchJob: (scopeKey: string, patch: Partial<JobState> & Pick<JobState, "jobId" | "kind">) => void;
  /** Height the AI tray takes at the bottom right, so toasts stack above it. */
  trayH: number;
  setTrayH: (h: number) => void;
  openChat: (t: ChatTarget) => void;
  closeChat: () => void;
  setCommandOpen: (open: boolean) => void;
}

export const useStore = create<Store>((set) => ({
  meta: { timezone: "Asia/Bangkok", tags: { setups: [], confluences: [], emotions: [], mistakes: [] }, currency: "USD" },
  setMeta: (meta) => set({ meta }),
  preview: null,
  setPreview: (preview) => set({ preview }),
  live: {},
  jobs: {},
  chat: { open: false },
  commandOpen: false,
  setLive: (accountId, patch) =>
    set((s) => ({ live: { ...s.live, [accountId]: { ...(s.live[accountId] ?? { balance: 0, equity: 0, floating: 0, margin: 0, positions: 0, connected: false, at: 0 }), ...patch } } })),
  setJob: (scopeKey, job) =>
    set((s) => {
      const jobs = { ...s.jobs };
      if (job) jobs[scopeKey] = job;
      else delete jobs[scopeKey];
      return { jobs };
    }),
  patchJob: (scopeKey, patch) =>
    set((s) => ({ jobs: { ...s.jobs, [scopeKey]: { ...(s.jobs[scopeKey] ?? { step: 0, steps: [], status: "running" }), ...patch } } })),
  trayH: 0,
  setTrayH: (trayH) => set({ trayH }),
  openChat: (t) => set({ chat: { ...t, open: true } }),
  closeChat: () => set((s) => ({ chat: { ...s.chat, open: false } })),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
