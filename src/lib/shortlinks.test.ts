import assert from "node:assert/strict";
import test from "node:test";

import { SITE_URL } from "./seo";
import { executeLocalShortLinkRpc, isUpstreamOriginError, shortLinkDb } from "./shortlinks.server";

const TEST_OWNER = "a1b2c3d4-e5f6-4789-abcd-ef0123456789-a1b2c3d4-e5f6-4789-abcd-ef0123456789";

test("identifies Cloudflare 1016 and upstream DNS errors accurately", () => {
  assert.equal(isUpstreamOriginError("error code: 1016"), true);
  assert.equal(isUpstreamOriginError("HTTP 530 Origin DNS Error"), true);
  assert.equal(
    isUpstreamOriginError("getaddrinfo ENOTFOUND pweqfkragyaklgkkkwhr.supabase.co"),
    true,
  );
  assert.equal(isUpstreamOriginError("TypeError: fetch failed"), true);
  assert.equal(
    isUpstreamOriginError('duplicate key value violates unique constraint "short_links_slug_key"'),
    false,
  );
});

test("short link lifecycle: create, list, resolve, click count, analytics, and delete", async () => {
  const slug = `test-${Date.now().toString(36)}`;
  const destination = "https://example.com/offer?utm_source=crosx";

  // 1. Create short link via shortLinkDb() (fails over cleanly from 1016)
  const db = shortLinkDb();
  const createdRes = await db.rpc("create_short_link", {
    p_slug: slug,
    p_destination: destination,
    p_owner: TEST_OWNER,
  });
  assert.equal(createdRes.error, null);
  const created = createdRes.data as {
    id: string;
    slug: string;
    destination: string;
    clicks: number;
    enabled: boolean;
  };
  assert.equal(created.slug, slug);
  assert.equal(created.destination, destination);
  assert.equal(created.clicks, 0);
  assert.equal(`${SITE_URL}/s/${created.slug}`, `https://rca.crosx.in/s/${slug}`);

  // 2. Duplicate slug returns Postgres 23505
  const dupRes = executeLocalShortLinkRpc("create_short_link", {
    p_slug: slug,
    p_destination: destination,
    p_owner: TEST_OWNER,
  });
  assert.equal(dupRes.error?.code, "23505");

  // 3. List short links for owner
  const listRes = await db.rpc("list_short_links", { p_owner: TEST_OWNER });
  assert.equal(listRes.error, null);
  const list = listRes.data as { id: string; slug: string; clicks: number }[];
  assert.equal(
    list.some((l) => l.id === created.id && l.slug === slug),
    true,
  );

  // 4. Resolve redirect target & record click
  const targetRes = await db.rpc("get_redirect_target", { p_slug: slug });
  assert.equal(targetRes.error, null);
  const targets = targetRes.data as { id: string; destination: string }[];
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.destination, destination);

  const clickRes = await db.rpc("record_link_click", {
    p_link_id: created.id,
    p_visitor: "visitor-hash-123",
    p_referrer: "rca.crosx.in",
    p_country: "IN",
    p_region: "MH",
    p_device: "desktop",
    p_browser: "Chrome",
    p_os: "Linux",
    p_utm_source: "crosx",
    p_utm_medium: "cpc",
    p_utm_campaign: "launch",
    p_is_bot: false,
    p_rule: null,
  });
  assert.equal(clickRes.error, null);

  // 5. Verify click count incremented
  const afterClickList = (await db.rpc("list_short_links", { p_owner: TEST_OWNER })).data as {
    id: string;
    clicks: number;
    last_clicked_at: string | null;
  }[];
  const updated = afterClickList.find((l) => l.id === created.id);
  assert.equal(updated?.clicks, 1);
  assert.equal(Boolean(updated?.last_clicked_at), true);

  // 6. Verify analytics aggregation
  const analyticsRes = await db.rpc("link_analytics", {
    p_id: created.id,
    p_owner: TEST_OWNER,
    p_from: new Date(Date.now() - 86_400_000).toISOString(),
    p_to: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(analyticsRes.error, null);
  const analytics = analyticsRes.data as { total: number; unique: number };
  assert.equal(analytics.total, 1);
  assert.equal(analytics.unique, 1);

  // 7. Clean up test link
  const delRes = await db.rpc("delete_short_link", {
    p_id: created.id,
    p_owner: TEST_OWNER,
  });
  assert.equal(delRes.error, null);
  assert.equal(delRes.data, true);
});
