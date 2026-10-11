// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // next/image serves product photos as AVIF (WebP fallback) at the displayed width.
    formats: ['image/avif', 'image/webp'],
    // Keep optimized copies (.next/cache/images) for a day instead of 60 s.
    // Short enough that replacing a photo under the same filename shows up by
    // tomorrow; new filenames show up immediately.
    minimumCacheTTL: 86400,
  },
  // experimental: {
  //   serverActions: true
  // },
};

export default nextConfig;
