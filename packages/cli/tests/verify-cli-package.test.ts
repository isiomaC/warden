import { describe, expect, it } from "vitest";

import { parsePackMetadata } from "../../../scripts/verify-cli-package.mjs";

describe("parsePackMetadata", () => {
  it("accepts npm 11's array-shaped pack metadata", () => {
    expect(parsePackMetadata('[{"filename":"stlw-warden-0.2.4.tgz"}]')).toMatchObject({
      filename: "stlw-warden-0.2.4.tgz",
    });
  });

  it("accepts npm 12's package-name-keyed pack metadata", () => {
    expect(parsePackMetadata('{"@stlw/warden":{"filename":"stlw-warden-0.2.4.tgz"}}')).toMatchObject({
      filename: "stlw-warden-0.2.4.tgz",
    });
  });

  it("rejects pack metadata without a filename", () => {
    expect(() => parsePackMetadata("{}")).toThrow("npm pack did not return package metadata with a filename");
  });
});
