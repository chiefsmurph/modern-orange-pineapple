import type { Metadata } from "next";
import { shareMeta } from "@/lib/share-meta";
import Link from "next/link";
import HomeLink from "@/components/HomeLink";
import { vendorDelivery } from "@/public/products";
import styles from "../[productId]/ProductClientView.module.css";
import own from "./shipping.module.css";

export const metadata: Metadata = {
  title: "Shipping & returns | Modern Orange Pineapple",
  description: "Made to order, free US shipping, and free replacements for misprints, damage or defects.",
  ...shareMeta({
    title: "Shipping & returns · Modern Orange Pineapple",
    description: "Made to order, free US shipping, and free replacements for misprints, damage or defects.",
    path: "/shipping-returns",
  }),
};

// Set MOP_CONTACT_EMAIL on the box to show an email address; without it the
// page points to the contact form only.
const contactEmail = process.env.MOP_CONTACT_EMAIL?.trim() || null;

export default function ShippingReturnsPage() {
  return (
    <div className={`${styles.container} ${own.page}`}>
      <HomeLink className={styles.home} />
      <h1 className={own.title}>Shipping &amp; returns</h1>

      <h2 className={own.h2}>Made to order</h2>
      <p>
        Every piece is printed or embroidered just for you after you order, so nothing sits in a warehouse. Each product
        page shows its delivery time (production + shipping):
      </p>
      <ul>
        <li>Most of the shop: {vendorDelivery.printful.text.replace(/^Made to order · /, "")}.</li>
        <li>A few all-over pieces made by our other partner: {vendorDelivery.yoycol.text.replace(/^Made to order · /, "")}.</li>
      </ul>

      <h2 className={own.h2}>Shipping</h2>
      <p>Free shipping on every order. For now we ship to the US only.</p>

      <h2 className={own.h2}>Something wrong with your order?</h2>
      <p>
        <b>Misprint, damage or defect? Email us a photo within 30 days and we&apos;ll replace it free.</b>
      </p>

      <h2 className={own.h2}>Returns</h2>
      <p>
        Because everything is made to order, we can&apos;t take returns for a change of mind or the wrong size. But message
        us and we&apos;ll help you get the right size. Each product page has a size guide with the real measurements.
      </p>

      <h2 className={own.h2}>Get in touch</h2>
      <p>
        {contactEmail ? (
          <>
            Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>, or use the{" "}
          </>
        ) : (
          <>Use the </>
        )}
        <Link href="/custom">contact form</Link> and we&apos;ll get back to you within 1–2 days.
      </p>
    </div>
  );
}
