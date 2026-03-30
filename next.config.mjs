/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    // pdfkit expects font metric files (e.g. Helvetica.afm) at runtime.
    // On Vercel, bundling can omit those files, causing PDF generation to crash.
    serverComponentsExternalPackages: ["pdfkit"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({ pdfkit: "commonjs pdfkit" });
    }
    return config;
  },
}

export default nextConfig
