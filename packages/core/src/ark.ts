import { type } from "arktype";

export const RiskLevelType = type("string");

export const IdentityType = type({
  id: "string",
  "name?": "string",
  "kind?": "string",
  "email?": "string",
});

export const ContentHashType = type("string");

export function isStandardSchema(schema: { "~standard"?: unknown }): boolean {
  return Boolean(schema["~standard"]);
}
