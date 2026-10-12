// next.config.ts
import type { NextConfig } from 'next';
import products from './public/products.ts';

const nextConfig: NextConfig = {
  images: {
    // next/image serves product photos as AVIF (WebP fallback) at the displayed width.
    formats: ['image/avif', 'image/webp'],
    // Keep optimized copies (.next/cache/images) for a day instead of 60 s.
    // Short enough that replacing a photo under the same filename shows up by
    // tomorrow; new filenames show up immediately.
    minimumCacheTTL: 86400,
  },
  // The private artist previews (app/preview) are never indexed, page or images.
  async headers() {
    return [
      {
        source: "/preview/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  // Retired products (public/products.ts `retired`) move permanently to their
  // replacement, so old links and QR codes still land somewhere. Query strings
  // (e.g. Stripe's ?status=success) are passed through.
  async redirects() {
    return products.products
      .filter((p) => p.retired)
      .map((p) => ({
        source: `/${p.id}`,
        destination: p.retired!.redirectTo,
        statusCode: 301 as const,
      }));
  },
  // experimental: {
  //   serverActions: true
  // },
};

export default nextConfig;
