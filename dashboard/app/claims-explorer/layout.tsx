import { Suspense } from "react";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400 text-sm">Loading...</div>}>{children}</Suspense>;
}
