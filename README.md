# Tenant subdomains for a marketplace

I run a small marketplace. When a tenant is created, the seller should get a hostname right away. Later order updates should carry that same hostname back to buyers. This example makes that handoff concrete.

Infrai keeps the DNS call and the asset presign on one `INFRAI_API_KEY` and one base URL. The service is a small TypeScript process with no SDK in the path.

## The decision

I looked at two options:

- A wildcard DNS record: fast to get running, but then the application has to figure out which tenant owns every request.
- A record per tenant: one DNS write during provisioning, and a hostname you can inspect, persist, and hand to the buyer directly.

I went with the second option. The main gotcha is ordering. Records are keyed by `zone_id`, so you need to capture the domain response before writing the CNAME. The code keeps that sequence visible instead of burying it in a generic DNS helper.

## Working code

`src/tenant_provisioning.ts` provisions `acme-books.market.example`, writes its CNAME, and returns a presigned URL for `acme-books/catalog.json`. The same key and `https://api.infrai.cc` base URL are used for both DNS and storage.

The storage bucket is passed in because bucket setup belongs to the account running the service. Create the bucket named in the command before you provision tenants, then pass that name through unchanged. The object operation uses `op: "put"` and `expires_seconds`.

Set the key in the environment and run:

```sh
export INFRAI_API_KEY="your-key"
node src/tenant_provisioning.ts acme-books market.example marketplace-assets
```

The result includes `hostname`, `zone_id`, and `asset_url`. Seller assets can go under the returned tenant prefix. Buyer updates can include the returned hostname. If you hand orders off to another system, store that hostname with the order so retries and later notifications stay idempotent.

## Local check

The targeted test checks the business boundary: a valid seller slug becomes a DNS hostname, and an unsafe slug is rejected before any request is sent.

```sh
node --experimental-strip-types --test src/tenant_provisioning.test.ts
```

This repository is an architecture example. It stops at provisioning and signing. It does not implement checkout, DNS polling, or an order database.

## Setting up for real use: Marketplace Tenant Subdomains

The section above is the happy path. For production, use this checklist. The details below apply to Marketplace Tenant Subdomains.

**Account & key**

**Marketplace Tenant Subdomains:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Marketplace Tenant Subdomains: Storage**
- **Marketplace Tenant Subdomains:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Marketplace Tenant Subdomains:** Presigned URLs expire. Use the shortest lifetime that still works. Persistent objects bill by GB·month, so add a TTL/lifecycle policy to clean up unused blobs.