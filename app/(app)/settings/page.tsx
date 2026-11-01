import { Activity, Bot, Cable, Database, Palette, SlidersHorizontal, Tags, Wallet } from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountsSettings, AiSettings, AppearanceSettings, ConnectionSettings, DataSettings, JournalSettings, TagSettings } from "@/components/settings/settings-client";
import { Page, Reveal } from "@/components/shell/page";
import { Card, CardHead } from "@/components/ui/card";
import { AiUsagePanel } from "@/components/settings/ai-usage";
import { CardSkeleton } from "@/components/ui/skeleton";
import { settingsPage } from "@/lib/queries/settings";

export const metadata = { title: "ตั้งค่า" };

const SECTIONS = [
  { id: "connection", label: "เชื่อมต่อ MT5", icon: Cable },
  { id: "accounts", label: "บัญชี", icon: Wallet },
  { id: "journal", label: "กฎและ Symbol", icon: SlidersHorizontal },
  { id: "tags", label: "Tag และ Playbook", icon: Tags },
  { id: "ai", label: "โค้ช AI", icon: Bot },
  { id: "usage", label: "การใช้ AI", icon: Activity },
  { id: "appearance", label: "การแสดงผล", icon: Palette },
  { id: "data", label: "ข้อมูล", icon: Database },
] as const;

export default function SettingsPage() {
  return (
    <Page title="ตั้งค่า" subtitle="ทุกอย่างบันทึกอัตโนมัติเมื่อคุณเปลี่ยน">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="หมวดการตั้งค่า" className="hidden lg:block">
          <ul className="sticky top-24 flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] text-fg-2 transition-colors hover:bg-surface-3/60 hover:text-fg">
                  <s.icon className="size-4 text-fg-3" />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Suspense fallback={<CardSkeleton className="h-[640px]" lines={10} />}>
          <Reveal>
            <SettingsData />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  );
}

function Section({ id, i, children, note }: { id: (typeof SECTIONS)[number]["id"]; i: number; children: React.ReactNode; note?: string }) {
  const s = SECTIONS.find((x) => x.id === id)!;
  return (
    <Card i={i} as="section" id={id} className="scroll-mt-24 p-5 sm:p-6">
      <CardHead label={<span className="text-[15px] text-fg">{s.label}</span>} icon={<s.icon className="size-4 text-fg-3" />} />
      {note && <p className="-mt-2 mb-4 text-[13px] text-fg-3">{note}</p>}
      {children}
    </Card>
  );
}

async function SettingsData() {
  await connection();
  const d = await settingsPage();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Section id="connection" i={0} note="เชื่อมต่อแบบอ่านอย่างเดียวได้ 3 วิธี: EA ในแอป MT5, ล็อกอินผ่าน cloud ของ MetaApi หรือ API key ของ Exness ไม่มีวิธีไหนเปิด แก้ หรือปิดออเดอร์ได้">
        <ConnectionSettings token={d.token} accounts={d.accounts} metaapi={d.metaapi} />
      </Section>
      <Section id="accounts" i={1} note="ตั้งค่าแยกรายบัญชี ช่องที่ว่างจะใช้ค่าเริ่มต้นในหมวดกฎ">
        <AccountsSettings accounts={d.accounts} activeId={d.settings.activeAccountId} />
      </Section>
      <Section id="journal" i={2}>
        <JournalSettings s={d.settings} />
      </Section>
      <Section id="tags" i={3}>
        <TagSettings s={d.settings} />
      </Section>
      <Section id="ai" i={4}>
        <AiSettings s={d.settings} ai={d.ai} />
      </Section>
      <Section id="usage" i={5} note="Trade Gang ใช้ Gemini API key ของคุณไปเท่าไร">
        <AiUsagePanel u={d.usage} />
      </Section>
      <Section id="appearance" i={6}>
        <AppearanceSettings />
      </Section>
      <Section id="data" i={7}>
        <DataSettings hasDemo={d.accounts.some((a) => a.source === "demo")} />
      </Section>
    </div>
  );
}
