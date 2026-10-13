import type { Metadata } from "next";
import HomeLink from "@/components/HomeLink";
import RegisterForm from "@/components/RegisterForm";
import styles from "../[productId]/ProductClientView.module.css";
import own from "../custom/custom.module.css";

export const metadata: Metadata = {
  title: "Register your shirt | Modern Orange Pineapple",
  description: "Register your MOP piece with the code on your packing slip, and show us how you wear it.",
};

export default function RegisterPage() {
  return (
    <div className={`${styles.container} ${own.page}`}>
      <HomeLink className={styles.home} />
      <h1 className={own.title}>Register your shirt</h1>
      <p className={own.sub}>Got a code on your packing slip? Register your piece, show us how you wear it, and tell us what you think.</p>
      <RegisterForm />
    </div>
  );
}
