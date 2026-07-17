export const SUMMARY_SCHEMA_ID = "koad.summary.v1";

export const SUMMARY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SUMMARY_SCHEMA_ID,
  title: "koad:io summary output",
  type: "object",
  required: ["schema", "generated_at", "parser", "autodetected", "target", "verbosity", "summary", "data", "warnings"],
  properties: {
    schema: { type: "string" },
    generated_at: { type: "string", format: "date-time" },
    parser: { type: "string" },
    autodetected: { type: "boolean" },
    target: {
      type: "object",
      required: ["input", "resolved", "type", "exists"],
      properties: {
        input: { type: "string" },
        resolved: { type: ["string", "null"] },
        type: { type: "string" },
        exists: { type: "boolean" },
        size_bytes: { type: ["number", "null"] }
      },
      additionalProperties: true
    },
    verbosity: { type: "number" },
    summary: {
      type: "object",
      required: ["title", "headline", "metrics", "sections"],
      properties: {
        title: { type: "string" },
        headline: { type: "string" },
        metrics: { type: "object", additionalProperties: true },
        sections: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "items"],
            properties: {
              title: { type: "string" },
              items: { type: "array", items: { type: "string" } }
            },
            additionalProperties: true
          }
        },
        compat_footer: {
          type: "object",
          additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] }
        }
      },
      additionalProperties: true
    },
    data: { type: "object", additionalProperties: true },
    warnings: { type: "array", items: { type: "string" } }
  },
  additionalProperties: true
};
