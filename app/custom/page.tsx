import type { Metadata } from "next";
import { shareMeta } from "@/lib/share-meta";
import HomeLink from "@/components/HomeLink";
import CustomRequestForm from "@/components/CustomRequestForm";
import styles from "../[productId]/ProductClientView.module.css";
import own from "./custom.module.css";

export const metadata: Metadata = {
  title: "Custom orders | Modern Orange Pineapple",
  description: "Your own custom shirt, or custom clothing for your company. From one shirt to a whole team.",
  ...shareMeta({
    title: "Custom orders · Modern Orange Pineapple",
    description: "Your own custom shirt, or custom clothing for your company. From one shirt to a whole team.",
    path: "/custom",
  }),
};

export default function CustomPage() {
  return (
    <div className={`${styles.container} ${own.page}`}>
      <HomeLink className={styles.home} />
      <h1 className={own.title}>Your own custom shirt, or custom clothing for your company.</h1>
      <p className={own.sub}>
        From one shirt to a whole team. Tell us what you want and we&apos;ll get back to you within 1–2 days.
      </p>
      <CustomRequestForm />
    </div>
  );
}
