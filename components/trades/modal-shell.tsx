"use client";

import { Maximize2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { ViewTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { useStore } from "@/lib/ui/store";
import { TradeHeader } from "./trade-header";

/**
 * The trade detail over the list. Shares its view-transition name with the table row,
 * so the row grows into the sheet and shrinks back on close.
 */
export function ModalShell({ id, children }: { id: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Dialog.Root open onOpenChange={(open) => !open && router.back()}>
      <Dialog.Portal>
        <Dialog.Overlay className="tg-overlay fixed inset-0 z-[45] bg-[rgb(8_12_20/0.32)] backdrop-blur-[2px]" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-[45] flex justify-center overflow-y-auto overscroll-contain p-2 outline-none sm:p-6" onClick={(e) => e.target === e.currentTarget && router.back()}>
          <ViewTransition name={`trade-${id}`} share="morph" default="none">
            <div className="glass-chrome relative h-fit w-full max-w-[1280px] rounded-[28px] p-4 sm:p-6">
              <div className="relative z-[2]">
                <Dialog.Title className="sr-only">เทรด {id}</Dialog.Title>
                <div className="absolute -top-1 -right-1 z-10 flex items-center gap-1 sm:-top-2 sm:-right-2">
                  <a href={`/trades/${encodeURIComponent(id)}`} className={buttonClass("ghost", "icon-sm")} aria-label="เปิดเป็นหน้าเต็ม" title="เปิดเป็นหน้าเต็ม">
                    <Maximize2 />
                  </a>
                  <Dialog.Close className={buttonClass("ghost", "icon-sm")} aria-label="ปิด">
                    <X />
                  </Dialog.Close>
                </div>
                <div className="pt-8">{children}</div>
              </div>
            </div>
          </ViewTransition>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Shown while the detail streams: the clicked row's own data, so the header never flashes. */
export function PreviewHeader({ id }: { id: string }) {
  const p = useStore((s) => (s.preview?.id === id ? s.preview : null));
  const meta = useStore((s) => s.meta);
  if (!p) return null;
  return <TradeHeader symbol={p.symbol} side={p.side} outcome={p.outcome} net={p.net} r={p.r} currency={meta.currency} openedAt={p.openedAt} closedAt={p.closedAt} tz={meta.timezone} session={p.session} />;
}
