/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // pdfkit expects font metric files (e.g. Helvetica.afm) at runtime.
  // Ensure Next does not bundle it in a way that drops those files on Vercel.
  serverExternalPackages: ["pdfkit"],

  // Turbopack is default in Next 16; keep config explicit to avoid warnings.
  turbopack: {},
}

export default nextConfig
