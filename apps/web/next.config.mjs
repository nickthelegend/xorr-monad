/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @xorr/sdk ships TypeScript source so the desk and the chain provably share one
  // pricing implementation rather than a compiled copy that can drift.
  transpilePackages: ["@xorr/sdk"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".ts": [".ts", ".tsx"],
    };
    return config;
  },
};
export default nextConfig;
