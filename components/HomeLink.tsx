"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { planReturnHome } from "@/lib/home-scroll";

// "← Home" on product pages: back to the same place in the grid when the
// visitor came from it (lib/home-scroll.ts), else a plain link to the top.
export default function HomeLink({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Link
      href="/"
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab etc.
        let plan;
        try {
          plan = planReturnHome(window.sessionStorage, window.location.pathname, window.history.length);
        } catch {
          return; // no storage: plain link
        }
        if (plan === "back") {
          e.preventDefault();
          router.back();
        }
      }}
    >
      ←&nbsp;Home
    </Link>
  );
}
