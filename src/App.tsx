import { useState } from "react";
import { HomePage } from "@/components/HomePage";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

/** Fixed header height, measured from the live top bar. */
const HEADER_HEIGHT = 50;

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      data-sidebar-open={sidebarOpen}
      className="flex min-h-100dvh flex-col lg:p-3"
    >
      <Sidebar open={sidebarOpen} />

      {/* Rail offset is applied by CSS, and only at lg and above. */}
      <div
        style={{ paddingTop: HEADER_HEIGHT }}
        className="app-content flex min-h-100dvh flex-1 flex-col transition-[padding] duration-150"
      >
        <TopBar
          title="主页"
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        <HomePage />
      </div>
    </div>
  );
}
