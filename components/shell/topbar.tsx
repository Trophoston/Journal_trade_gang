import { connection } from "next/server";
import { activeJobs } from "@/lib/ai/queue";
import { displayCurrency, listAccounts, moneyScale } from "@/lib/queries/core";
import { getSettings } from "@/lib/settings";
import { TopBarClient } from "./topbar-client";

export async function TopBar() {
  await connection();
  const [settings, accounts] = await Promise.all([getSettings(), listAccounts()]);
  const active = accounts.find((a) => a._id === settings.activeAccountId) ?? accounts[0] ?? null;
  const jobs = await activeJobs(active?._id);
  const scale = moneyScale(active);
  return (
    <TopBarClient
      timezone={settings.timezone}
      tags={settings.tags}
      queued={jobs.length}
      userJobs={jobs.filter((j) => !j.auto).map((j) => ({ jobId: String(j._id), scopeKey: j.scopeKey, kind: j.kind, status: j.status === "running" ? "running" : "queued", step: j.step ?? 0, steps: j.steps }))}
      accounts={accounts.map((a) => ({ id: a._id, name: a.name || `#${a.login}`, login: a.login, server: a.server, source: a.source, tradeMode: a.tradeMode }))}
      active={
        active
          ? {
              id: active._id,
              name: active.name || `#${active.login}`,
              login: active.login,
              server: active.server,
              source: active.source,
              currency: displayCurrency(active),
              scale,
              balance: active.balance,
              equity: active.equity,
              floating: active.floating,
              lastSeenAt: active.lastSeenAt?.getTime() ?? 0,
            }
          : null
      }
    />
  );
}

export function TopBarSkeleton() {
  return <div className="h-[68px]" />;
}
