"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Overview", href: "/executive-overview", icon: "⬛" },
  { label: "Extrapolation", href: "/extrapolation-simulator", icon: "📊" },
  { label: "Providers", href: "/provider-benchmarking", icon: "🏥" },
  { label: "Anomaly", href: "/anomaly-detection", icon: "🔍" },
  { label: "Claims", href: "/claims-explorer", icon: "📋" },
  { label: "Data Quality", href: "/data-quality", icon: "✅" },
  { label: "Risk Adjust", href: "/risk-adjustment", icon: "⚖️" },
  { label: "Fairness", href: "/sample-fairness", icon: "⚖️" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="flex items-center gap-1 overflow-x-auto px-4 py-2 scrollbar-none">
        {/* Brand */}
        <Link href="/executive-overview" className="mr-4 shrink-0">
          <span className="text-xs font-bold tracking-widest text-blue-400 uppercase">CMS Analytics</span>
        </Link>

        {/* Nav Links */}
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
                active
                  ? "bg-blue-500/15 text-blue-300 border border-blue-500/40"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
