import { connection } from "next/server";
import { Suspense } from "react";
import { Onboarding } from "@/components/settings/onboarding";
import { Page, Reveal } from "@/components/shell/page";
import { CardSkeleton } from "@/components/ui/skeleton";
import { TradesTable } from "@/components/trades/trades-table";
import { tradeList, type TradeQuery } from "@/lib/queries/trades";

export const metadata = { title: "เทรด" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const KEYS = ["symbol", "setup", "session", "side", "outcome", "review", "from", "to"] as const;

export default function TradesPage({ searchParams }: { searchParams: SP }) {
  return (
    <Page title="เทรด" subtitle="ทุกออเดอร์ที่ปิดแล้วจาก MT5 คลิกเพื่อดูกราฟ หลักฐาน และบทวิเคราะห์จาก AI">
      <Suspense fallback={<CardSkeleton className="h-[640px]" lines={10} />}>
        <Reveal>
          <TradesData searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </Page>
  );
}

async function TradesData({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const q: TradeQuery = {};
  for (const k of KEYS) {
    const v = sp[k];
    if (typeof v === "string" && v.length <= 80) q[k] = v;
  }
  const data = await tradeList(q);
  if (!data) return <Onboarding />;
  return <TradesTable rows={data.rows} currency={data.ctx.currency} tz={data.ctx.tz} symbols={data.symbols} setups={data.setups} />;
}
