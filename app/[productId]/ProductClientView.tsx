"use client";

import { useEffect, useState } from "react";
import {
  getTotalPrice,
  getProductImages,
  getDelivery,
  getProductDesignId,
  type Product,
} from "@/public/products";
import Link from "next/link";
import ProductPageBackground from "./ProductPageBackground";
import PurchaseForm from "./PurchaseForm";
import ProductGallery from "@/components/ProductGallery";
import ArtistCredit from "@/components/ArtistCredit";
import styles from "./ProductClientView.module.css";

export type Options = { color?: string; size?: string };

export default function ProductClientView({
  product,
  defaultImages,
}: {
  product: Product;
  defaultImages: string[];
}) {
  const [options, setOptions] = useState<Options>({});

  const selectedImages = options.color
    ? getProductImages(product, options.color)
    : defaultImages;

  useEffect(() => {
    document.title = `${product.title} | Modern Orange Pineapple`;
  }, [product.title]);
  return (
    <div className={styles.container}>
      <Link
        href="/"
        className={styles.home}
        onClick={() => sessionStorage.setItem("fromClientNav", "true")}
      >
        ← Home
      </Link>

      <h1 className={styles.title}>{product.title}</h1>
      <p className={styles.price}>${getTotalPrice(product)}</p>
      {product.fabricNote && (
        <p className={styles.fabricNote}>{product.fabricNote}</p>
      )}
      <div className={styles.productPage}>
        <div className={styles.textSide}>
          <p
            className={styles.desc}
            dangerouslySetInnerHTML={{
              __html: product.description.split("\n").join("<br/>"),
            }}
          />
          {/* follows the selected option when the product maps one to designs */}
          <ArtistCredit
            design={getProductDesignId(product, options)}
            className={styles.credit}
          />
          {/* price, sizes, buy button etc */}
        </div>
        <div className={styles.gallerySide}>
          <ProductGallery
            images={getProductImages(product, options["color"])}
          />
        </div>
      </div>

      <p className={styles.shipping}>
        Shipping: $
        {product.freeShippingMode ? "0.00 (free)" : product.shipping.cost / 100}{" "}
        — {getDelivery(product).text}
      </p>

      <PurchaseForm
        product={product}
        options={options}
        setOptions={setOptions}
      />
      {/* <div className={styles.gallery}>
        {selectedImages.map((src) => (
          <img key={src} src={src} alt="" className={styles.img} />
        ))}
      </div> */}

      <ProductPageBackground src={selectedImages[0]} side="left" />
      <ProductPageBackground src={selectedImages[1]} side="right" />
    </div>
  );
}
