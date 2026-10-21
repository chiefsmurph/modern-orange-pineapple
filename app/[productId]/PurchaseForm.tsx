import { trackOnce } from "@/lib/umami";
import { getTotalPrice, Product } from "@/public/products";
import StripeButton from "./StripeButton";
import { Options } from "./ProductClientView";

import styles from "./PurchaseForm.module.css";
import { Dispatch, SetStateAction } from "react";

type PurchaseFormProps = {
  product: Product;
  options: Options;
  setOptions: Dispatch<SetStateAction<Options>>;
};
export default function PurchaseForm(props: PurchaseFormProps) {
  const { product, options, setOptions } = props;

  const missing = Object.entries(product.options).filter(
    ([key]) => !options[key as keyof typeof options]
  );

  const handleSelect =
    (key: "color" | "size") => (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      trackOnce(`pick|${product.id}|${key}|${value}`, "pick", { slug: product.id, option: key, value });
      setOptions((prev) => ({ ...prev, [key]: value }));
    };
  return (
    <div className={styles.purchaseForm}>
      {Object.entries(product.options).map(([key, values]) => (
        <label key={key} className={styles.label}>
          {key.charAt(0).toUpperCase() + key.slice(1)}&nbsp;&nbsp;
          <select
            value={options[key as "color" | "size"] ?? ""}
            onChange={handleSelect(key as "color" | "size")}
            className={styles.select}
          >
            <option value="">Select {key}</option>
            {values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}

      <StripeButton
        productId={product.id}
        title={product.title}
        value={getTotalPrice(product, options.size)}
        disabled={missing.length > 0}
        options={options}
      />
    </div>
  );
}
