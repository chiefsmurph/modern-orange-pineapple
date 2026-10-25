import type { Metadata } from "next";
import { shareMeta } from "@/lib/share-meta";
import { PITCH, ROYALTY } from "@/lib/ideas";
import HomeLink from "@/components/HomeLink";
import IdeaForm from "@/components/IdeaForm";
import styles from "../[productId]/ProductClientView.module.css";
import own from "../custom/custom.module.css";

const DESCRIPTION = `${PITCH} You send the idea in words; we make the art.`;

export const metadata: Metadata = {
  title: "Submit an idea | Modern Orange Pineapple",
  description: DESCRIPTION,
  ...shareMeta({ title: "Submit a shirt idea · Modern Orange Pineapple", description: DESCRIPTION, path: "/ideas" }),
};

// /ideas: anyone sends a T-shirt idea as words (lib/ideas.ts, lib/ideas-server.ts).
export default function IdeasPage() {
  return (
    <div className={`${styles.container} ${own.page}`}>
      <HomeLink className={styles.home} />
      <h1 className={own.title}>Got a shirt idea? Send it.</h1>
      <p className={own.sub}>
        If we make it, you get {ROYALTY} for every one sold. Just describe it in words: we make the art.
      </p>
      <IdeaForm />
    </div>
  );
}
