import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ReadScope } from "../search/filters.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function registerAuth(app: FastifyInstance) {
  const admin = process.env.SHARDLY_ADMIN_TOKEN;
  const raw: unknown = JSON.parse(process.env.SHARDLY_READ_KEYS ?? "{}");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("SHARDLY_READ_KEYS must be a token-to-scope JSON object");
  const readers = Object.entries(raw).map(([key, value]) => {
    if (key.length < 24 || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("read tokens must have at least 24 characters and a scope object");
    const scope = value as ReadScope;
    if (Object.keys(scope).some(k => !["tenant", "principals", "sources"].includes(k)) || scope.tenant !== undefined && typeof scope.tenant !== "string" || [scope.principals, scope.sources].some(v => v !== undefined && (!Array.isArray(v) || v.length > 100 || v.some(s => typeof s !== "string" || s.length > 256)))) throw new Error("invalid read-token scope");
    return { digest: digest(key), scope };
  });
  if (admin !== undefined && admin.length < 24) throw new Error("SHARDLY_ADMIN_TOKEN must have at least 24 characters");
  if (readers.length && !admin) throw new Error("read keys require SHARDLY_ADMIN_TOKEN");
  const readPosts = new Set(["/search", "/retrieve", "/fetch", "/search/batch"]);
  const readGets = new Set(["/retrieval/status", "/ready"]);
  app.addHook("onRequest", async (request, reply) => {
    if (!admin || request.method === "OPTIONS") return;
    const token = request.headers.authorization?.replace(/^Bearer /i, "") ?? "";
    const hash = digest(token);
    if (timingSafeEqual(hash, digest(admin))) return;
    const reader = readers.find(key => timingSafeEqual(hash, key.digest));
    if (!reader) return reply.code(401).header("www-authenticate", "Bearer").send({ error: "authentication required" });
    const route = request.url.split("?")[0]!;
    if (!(request.method === "POST" && readPosts.has(route) || request.method === "GET" && readGets.has(route))) return reply.code(403).send({ error: "read token is restricted to retrieval routes" });
    request.readScope = reader.scope;
  });
}
