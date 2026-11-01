import { Suspense } from "react";
import { ChatPanel } from "@/components/shell/chat-panel";
import { CommandMenu } from "@/components/shell/command-menu";
import { Dock } from "@/components/shell/dock";
import { Providers } from "@/components/shell/providers";
import { TopBar, TopBarSkeleton } from "@/components/shell/topbar";

export default function AppLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return (
    <Providers>
      <Dock />
      <div className="md:pl-[92px]">
        <Suspense fallback={<TopBarSkeleton />}>
          <TopBar />
        </Suspense>
        <main className="mx-auto w-full max-w-[1440px] px-4 pt-3 pb-28 md:px-6 md:pb-12">{children}</main>
      </div>
      {modal}
      <ChatPanel />
      <CommandMenu />
    </Providers>
  );
}
