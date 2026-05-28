import type { NextConfig } from "next";

const SEQUENCER_API_URL = process.env.SEQUENCER_API_URL || "http://stage.sqn.cr";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/adminapi/:path*",
        destination: `${SEQUENCER_API_URL}/adminapi/:path*`,
      },
      {
        source: "/apiserver2/:path*",
        destination: `${SEQUENCER_API_URL}/apiserver2/:path*`,
      },
    ];
  },
};

export default nextConfig;
