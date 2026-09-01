import { describe, expect, it } from "vitest";
import { RiskLevelType, isStandardSchema } from "@reviewkit/core";

describe("arktype runtime types", () => {
  it("accepts a risk level string", () => {
    expect(RiskLevelType("low")).toBe("low");
  });
  it("exposes Standard Schema when present", () => {
    expect(typeof isStandardSchema(RiskLevelType)).toBe("boolean");
  });
});
