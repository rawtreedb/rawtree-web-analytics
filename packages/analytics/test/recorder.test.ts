import assert from "node:assert/strict";
import { it } from "node:test";
import { sanitizeRecordingEvent } from "../src/recorder.ts";

it("removes URL secrets and attribute PII from Meta, snapshot, and mutation events", () => {
  const meta = sanitizeRecordingEvent({
    type: 4,
    timestamp: 1,
    data: { href: "https://shop.example/pricing?email=a%40b.test&utm_source=news#plans", width: 1, height: 1 },
  });
  assert.equal((meta.data as { href: string }).href, "https://shop.example/pricing?utm_source=news");

  const snapshot = sanitizeRecordingEvent({
    type: 2,
    timestamp: 1,
    data: {
      node: {
        type: 0,
        childNodes: [
          {
            type: 2,
            tagName: "a",
            attributes: { href: "https://shop.example/docs?token=SECRET#x", class: "nav", "data-state": "open" },
            childNodes: [
              { type: 2, tagName: "img", attributes: { src: "/avatar.png?sig=SECRET", alt: "Jane Doe", rr_width: "10px" }, childNodes: [] },
              { type: 2, tagName: "p", attributes: { "data-user-email": "jane@example.com", title: "Jane" }, childNodes: [] },
            ],
          },
        ],
      },
    },
  });
  const json = JSON.stringify(snapshot);
  for (const secret of ["SECRET", "jane@example.com", "Jane"]) assert.ok(!json.includes(secret), `${secret} removed`);
  assert.ok(json.includes('"href":"https://shop.example/docs"'));
  assert.ok(json.includes('"data-state":"open"'), "non-sensitive attributes are kept for replay styling");
  assert.ok(json.includes('"rr_width":"10px"'), "rrweb internal attributes are untouched");

  const mutation = sanitizeRecordingEvent({
    type: 3,
    timestamp: 2,
    data: {
      source: 0,
      adds: [{ parentId: 1, node: { type: 2, tagName: "a", attributes: { href: "/reset?token=SECRET" }, childNodes: [] } }],
      attributes: [{ id: 5, attributes: { "aria-label": "Jane Doe", "data-x": "ok" } }],
      texts: [],
      removes: [],
    },
  });
  assert.ok(!JSON.stringify(mutation).includes("SECRET"));
  assert.deepEqual((mutation.data as { attributes: { attributes: object }[] }).attributes[0].attributes, {
    "aria-label": "**** ***",
    "data-x": "ok",
  });
});
