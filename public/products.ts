export type ProductOptions = Partial<Record<"color" | "size", string[]>>;
export type Product = {
  id: string;
  title: string;
  description: string;
  options: ProductOptions;
  price: number;
  vendor:
    | {
        platform: "yoycol";
        productId: string;
      }
    | {
        platform: "printful";
        productTemplate: string;
      };
  images: string[] | Record<string, string[]>;
  shipping: {
    name: string;
    cost: number;
    estDelivery: string;
  };
  freeShippingMode?: boolean;
};

export const getProductImages = (
  { images, options: { color: colorOptions = [] } }: Product,
  color: string | undefined = colorOptions[0]
) => (Array.isArray(images) ? images : images[color]);

export const getTotalPrice = ({ shipping, price }: Product) =>
  parseFloat((shipping.cost / 100 + price).toFixed(2));

const products: { products: Product[] } = {
  products: [
    {
      id: "clouds-in-sky-shirt",
      title: "Clouds In Sky Shirt",
      description:
        "Bring the sky everywhere you go with this all‑over cloud print T‑shirt!\n\n- Fabric: 100% cotton\n- Regular fit with classic O‑neck\n- Fabric weight: 190 g/m²",
      options: {
        size: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"],
      },
      price: 28.48,
      vendor: {
        platform: "yoycol",
        productId: "ID LRVV1",
      },
      images: [
        "/images/clouds-in-sky-shirt/erasebg-transformed(3).png",
        "/images/clouds-in-sky-shirt/erasebg-transformed (2).png",

        // "/images/clouds-in-sky-shirt/erasebg-transformed.png",
        // "/images/clouds-in-sky-shirt/erasebg-transformed (5).png",

        // "/images/clouds-in-sky-shirt/0.jpeg",
        // "/images/clouds-in-sky-shirt/1.jpeg",
        // "/images/clouds-in-sky-shirt/2.jpeg",
        // "/images/clouds-in-sky-shirt/3.jpeg",
        // "/images/clouds-in-sky-shirt/4.jpeg",
        // "/images/clouds-in-sky-shirt/5.jpeg",
        // "/images/clouds-in-sky-shirt/6.jpeg",
        // "/images/clouds-in-sky-shirt/7.jpeg",
      ],
      shipping: {
        name: "Standard Shipping",
        cost: 752,
        estDelivery: "8-15",
      },
      freeShippingMode: true,
    },
    {
      id: "clouds-skater-dress",
      title: "All‑Over Clouds Skater Dress",
      description:
        "Dress to impress with this all‑over cloud print skater dress!\n\n- 82% polyester / 18% spandex\n- Fabric weight: 6.78 oz/yd² (230 g/m²) — may vary ±5%\n- Smooth, elastic fabric\n- Mid‑thigh flared skirt with elastic waistline\n- Overlock seams & cover‑stitch hem",
      options: {
        size: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
      },
      price: 51.01,
      vendor: {
        platform: "printful",
        productTemplate: "73677360",
      },
      images: [
        "/images/clouds-skater-dress/all-over-print-skater-dress-white-front.png",
        "/images/clouds-skater-dress/all-over-print-skater-dress-white-back.png",
        // "/images/clouds-skater-dress/erasebg-transformed(8).png",
        // "/images/clouds-skater-dress/erasebg-transformed.png",
        // "/images/clouds-skater-dress/erasebg-transformed (6).png",
        // "/images/clouds-skater-dress/erasebg-transformed (4).png",
        // "/images/clouds-skater-dress/erasebg-transformed (7).png",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a62ed.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a643a.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a6395.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a6759.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a5cd6.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a5e53.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a5f8a.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a60b4.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a656f.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a6612.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-left-6817d7c9a64da.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-right-6817d7c9a61ef.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-right-6817d7c9a66b8.jpg",
      ],
      shipping: {
        name: "Flat Rate",
        cost: 399,
        estDelivery: "7-10",
      },
      freeShippingMode: true,
    },
    {
      id: "pelican-beanie-t-shirt",
      title: "Pelican With Beanie T Shirt",
      description:
        "Yes, this really is the coolest Pelican you have ever met.  Wearing a beanie and with a sly, devilish grin this shirt will surely have heads turning!\n\n- Fabric: 100% cotton\n-  Taped neck and shoulders\n- Fabric weight: 170-180 g/m²",
      options: {
        size: ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"],
        color: ["Yellow", "Light Blue", "White"],
      },
      price: 22.31,
      vendor: {
        platform: "printful",
        productTemplate: "85446338",
      },
      images: {
        Yellow: [
          "/images/pelican-beanie-t-shirt/erasebg-transformed(11).png",
          // "/images/pelican-beanie-t-shirt/daisy/il_1588xN.6686801694_cpd5.webp",
          // "/images/pelican-beanie-t-shirt/daisy/il_1588xN.6686801682_bqee.webp",
        ],
        "Light Blue": [
          "/images/pelican-beanie-t-shirt/erasebg-transformed(10).png",
          // "/images/pelican-beanie-t-shirt/light-blue/il_1588xN.6734837877_7y1l.webp",
          // "/images/pelican-beanie-t-shirt/light-blue/il_1588xN.6734837865_ht7s.webp",
        ],
        White: [
          "/images/pelican-beanie-t-shirt/erasebg-transformed(9).png",
          // "/images/pelican-beanie-t-shirt/white/il_1588xN.6686801766_2ahp.webp",
          // "/images/pelican-beanie-t-shirt/white/il_1588xN.6686801752_4apr.webp",
        ],
      },
      shipping: {
        name: "Flat Rate",
        cost: 469,
        estDelivery: "7-10",
      },
      freeShippingMode: true,
    },
    {
      id: "blue-sky-cotton-shorts",
      title: "Blue Sky Cotton Shorts",
      description:
        "Made of natural fiber fabric, it is comfortable and breathable, and will not tighten when worn against the skin.  Pair it with casual tops or sweatshirts to wear in many scenarios.\n\n- Fabric: 100% cotton\n- Regular fit\n- Side pocket, back pocket, waist elastic\n- Fabric: 245 g/m²",
      options: {
        size: ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"],
      },
      price: 25.47,
      vendor: {
        platform: "yoycol",
        productId: "ID LRWGN",
      },
      images: [
        "/images/blue-sky-cotton-shorts/erasebg-transformed(3).webp",
        "/images/blue-sky-cotton-shorts/erasebg-transformed (1).webp",
        "/images/blue-sky-cotton-shorts/erasebg-transformed.webp",
        "/images/blue-sky-cotton-shorts/erasebg-transformed (2).webp",

        // "/images/blue-sky-cotton-shorts/267961-7c8b62ac-0a77-4665-b3ba-88f31ad038e4.webp",
        // "/images/blue-sky-cotton-shorts/267961-044d27a7-62d2-47a2-abd2-2939d8963afe.webp",
        // "/images/blue-sky-cotton-shorts/267961-18563b72-bc8a-4dce-a9d3-ce81e047be97.webp",
        // "/images/blue-sky-cotton-shorts/267961-d3ce8cb8-61cc-40c5-bac2-d8274f65c48b.webp"
      ],
      shipping: {
        name: "Standard Shipping",
        cost: 1453,
        estDelivery: "8-15",
      },
      freeShippingMode: true,
    },
  ],
};

export default products;
