import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export default { reactStrictMode: true, outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)) };
