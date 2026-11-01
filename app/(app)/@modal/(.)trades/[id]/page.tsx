import { Suspense } from "react";
import { ModalShell, PreviewHeader } from "@/components/trades/modal-shell";
import { TradeDetailBody, TradeDetailSkeleton } from "@/components/trades/trade-detail";

type Params = Promise<{ id: string }>;

/** Soft navigation to a trade opens it over the current page; a reload opens the full page. */
export default function TradeModal({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Modal params={params} />
    </Suspense>
  );
}

async function Modal({ params }: { params: Params }) {
  const id = decodeURIComponent((await params).id);
  return (
    <ModalShell id={id}>
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <PreviewHeader id={id} />
            <TradeDetailSkeleton header={false} />
          </div>
        }
      >
        <TradeDetailBody id={id} inModal />
      </Suspense>
    </ModalShell>
  );
}
