import { Check, CloudAlert, Loader2 } from "lucide-react";
import type { SaveState } from "@/lib/ui/use-autosave";

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return <span className="text-[11px] text-fg-3">บันทึกอัตโนมัติ</span>;
  if (state === "saving")
    return (
      <span className="flex items-center gap-1 text-[11px] text-fg-3">
        <Loader2 className="size-3 animate-spin" /> กำลังบันทึก
      </span>
    );
  if (state === "error")
    return (
      <span className="flex items-center gap-1 text-[11px] text-red-ink">
        <CloudAlert className="size-3" /> ยังไม่ได้บันทึก
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[11px] text-green-ink">
      <Check className="size-3" /> บันทึกแล้ว
    </span>
  );
}
