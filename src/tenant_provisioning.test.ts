import test from "node:test";
import assert from "node:assert/strict";
import { tenantHostname } from "./tenant_provisioning.ts";

test("tenant hostname is a DNS label under the marketplace domain", () => {
  assert.equal(tenantHostname("Acme-Books", "market.example"), "acme-books.market.example");
  assert.throws(() => tenantHostname("bad/tenant", "market.example"), /DNS label/);
});
