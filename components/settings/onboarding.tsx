import { Cable, Database } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";

export function Onboarding() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card i={0} className="p-6">
        <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-blue-soft text-blue-ink">
          <Cable className="size-5" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">เชื่อมต่อ MetaTrader 5</h2>
        <p className="mt-1.5 text-sm text-fg-2">ลาก Trade Gang EA (อ่านอย่างเดียว) ไปวางบนกราฟไหนก็ได้ มันจะส่งประวัติทั้งหมดครั้งแรก แล้วส่งทุกเทรดแบบ live ต่อไป และจะไม่เปิดออเดอร์เด็ดขาด</p>
        <Link href="/settings#connection" className={buttonClass("primary", "md", "mt-5 self-start")}>
          ตั้งค่าการเชื่อมต่อ
        </Link>
      </Card>
      <Card i={1} className="p-6">
        <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-violet-soft text-violet-ink">
          <Database className="size-5" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">หรือลองเล่นด้วยข้อมูลตัวอย่าง</h2>
        <p className="mt-1.5 text-sm text-fg-2">เทรด XAUUSD, EURUSD และ NAS100 ย้อนหลัง 3 เดือน พร้อมแท่งเทียน ข่าว และรีวิวจาก AI</p>
        <pre className="mt-5 rounded-[12px] bg-surface-3 px-3 py-2 font-mono text-[13px]">pnpm seed</pre>
      </Card>
    </div>
  );
}
