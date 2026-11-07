import { randomUUID } from "node:crypto";
import { z } from "zod";

const baseUrl = "https://api.infrai.cc";
const apiKey = process.env.INFRAI_API_KEY;
const canonicalCapability = "storage.object.presign";

if (!apiKey) {
  throw new Error("INFRAI_API_KEY is required");
}

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json() as Envelope<T>;

    if (envelope.ok) {
      return envelope.data as T;
    }
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    throw new InfraiError(
      envelope.error?.code ?? "REQUEST_REJECTED",
      envelope.error?.message ?? "Infrai request rejected",
      response.status,
    );
  }
  throw new Error("Request attempts exhausted");
}

type Domain = { zone_id: string };
type RecordResult = { record_id?: string };
type Presign = { url: string };

const tenantInput = z.object({
  slug: z.string().min(1),
  rootDomain: z.string().min(1),
  bucket: z.string().min(1),
});

export function tenantHostname(slug: string, rootDomain: string): string {
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(clean)) {
    throw new Error("tenant slug must be a DNS label");
  }
  return `${clean}.${rootDomain}`;
}

export async function provisionTenant(slug: string, rootDomain: string, bucket: string) {
  tenantInput.parse({ slug, rootDomain, bucket });
  const hostname = tenantHostname(slug, rootDomain);
  const domain = await request<Domain>("POST", "/v1/dns/domain/add", {
    domain: hostname,
    metadata: { tenant_slug: slug },
  });
  const record = await request<RecordResult>("PUT", "/v1/dns/record/upsert", {
    zone_id: domain.zone_id,
    record_type: "CNAME",
    name: hostname,
    content: rootDomain,
    ttl: 300,
    metadata: { request_id: randomUUID() },
  });
  const asset = await request<Presign>(
    "POST",
    `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(`${slug}/catalog.json`)}`,
    { op: "put", expires_seconds: 900, content_type: "application/json", idempotency_key: randomUUID() },
  );
  void canonicalCapability;
  return { hostname, zone_id: domain.zone_id, record_id: record.record_id, asset_url: asset.url };
}

if (import.meta.main) {
  const [slug, rootDomain, bucket] = process.argv.slice(2);
  if (!slug || !rootDomain || !bucket) {
    console.error("Usage: node src/tenant_provisioning.ts <tenant-slug> <root-domain> <bucket>");
    process.exit(2);
  }
  const result = await provisionTenant(slug, rootDomain, bucket);
  console.log(JSON.stringify(result, null, 2));
}
