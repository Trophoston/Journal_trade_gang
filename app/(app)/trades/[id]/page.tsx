import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Page } from "@/components/shell/page";
import { buttonClass } from "@/components/ui/button";
import { TradeDetailBody, TradeDetailSkeleton } from "@/components/trades/trade-detail";

export const metadata = { title: "เทรด" };

export default function TradePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Page
      title="เทรด"
      actions={
        <Link href="/trades" className={buttonClass("ghost", "sm")}>
          <ArrowLeft /> เทรดทั้งหมด
        </Link>
      }
    >
      <Suspense fallback={<TradeDetailSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </Page>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TradeDetailBody id={decodeURIComponent(id)} />;
}
