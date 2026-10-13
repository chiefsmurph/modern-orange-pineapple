// /bag: the shopping bag (lib/bag.ts), checked out as one Stripe session.
import type { Metadata } from "next";
import BagView from "./BagView";

export const metadata: Metadata = {
  title: "Your bag | Modern Orange Pineapple",
  robots: { index: false, follow: false },
};

export default function BagPage() {
  return <BagView />;
}
