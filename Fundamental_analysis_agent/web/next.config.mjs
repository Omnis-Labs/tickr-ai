/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [{ source: "/api/backend/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
