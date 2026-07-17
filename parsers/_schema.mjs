export const SUMMARY_SCHEMA_ID = "koad.summary.v1";
export const SESSION_SUMMARY_SCHEMA_ID = "koad.session-summary.v1";
export const FLIGHT_LOG_SCHEMA_ID = "koad.flight-log.v1";

function makeEnvelopeSchema({ id, title, parser = null, data = {} }) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    title,
    type: "object",
    required: ["schema", "generated_at", "parser", "autodetected", "target", "verbosity", "summary", "data", "warnings"],
    properties: {
      schema: { const: id },
      generated_at: { type: "string", format: "date-time" },
      parser: parser ? { const: parser } : { type: "string" },
      autodetected: { type: "boolean" },
      target: {
        type: "object",
        required: ["input", "resolved", "type", "exists"],
        properties: {
          input: { type: ["string", "null"] },
          resolved: { type: ["string", "null"] },
          type: { type: "string" },
          exists: { type: "boolean" },
          size_bytes: { type: ["number", "null"] },
        },
        additionalProperties: true,
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
                items: { type: "array", items: { type: "string" } },
              },
              additionalProperties: true,
            },
          },
          compat_footer: {
            type: "object",
            additionalProperties: {
              anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
            },
          },
        },
        additionalProperties: true,
      },
      data,
      warnings: { type: "array", items: { type: "string" } },
    },
    additionalProperties: true,
  };
}

export const SUMMARY_SCHEMA = makeEnvelopeSchema({
  id: SUMMARY_SCHEMA_ID,
  title: "koad:io summary output",
  data: { type: "object", additionalProperties: true },
});

export const SESSION_SUMMARY_SCHEMA = makeEnvelopeSchema({
  id: SESSION_SUMMARY_SCHEMA_ID,
  title: "koad:io session summary",
  parser: "session",
  data: {
    type: "object",
    properties: {
      session_id: { type: ["string", "null"] },
      cwd: { type: ["string", "null"] },
      name: { type: ["string", "null"] },
      turns: { type: "number" },
      user_turns: { type: "number" },
      assistant_turns: { type: "number" },
      role_counts: { type: "object", additionalProperties: { type: "number" } },
      tool_calls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: ["string", "null"] },
            name: { type: "string" },
            arguments: { type: ["object", "array", "string", "number", "boolean", "null"] },
          },
          required: ["name", "arguments"],
          additionalProperties: true,
        },
      },
      user_messages: { type: "array", items: { type: "string" } },
      assistant_responses: { type: "array", items: { type: "string" } },
      custom_messages: { type: "array", items: { type: "string" } },
      omitted_counts: { type: "object", additionalProperties: { type: "number" } },
      malformed_lines: { type: "number" },
      started_at: { type: ["string", "null"] },
      ended_at: { type: ["string", "null"] },
      duration_seconds: { type: ["number", "null"] },
      token_usage: {
        type: "object",
        properties: {
          total: { type: "number" },
          input: { type: "number" },
          output: { type: "number" },
          cache_read: { type: "number" },
          cache_write: { type: "number" },
        },
        additionalProperties: true,
      },
      cost_total: { type: "number" },
    },
    additionalProperties: true,
  },
});

export const FLIGHT_LOG_SCHEMA = makeEnvelopeSchema({
  id: FLIGHT_LOG_SCHEMA_ID,
  title: "koad:io flight log summary",
  parser: "flight",
  data: {
    type: "object",
    properties: {
      dispatch_id: { type: ["string", "null"] },
      entity: { type: ["string", "null"] },
      brief: { type: ["string", "null"] },
      objective: { type: ["string", "null"] },
      status: { type: ["string", "null"] },
      started_at: { type: ["string", "null"] },
      ended_at: { type: ["string", "null"] },
      elapsed_seconds: { type: ["number", "null"] },
      completion_summary: { type: ["string", "null"] },
      close_reason: { type: ["string", "null"] },
      model: { type: ["string", "null"] },
      run_id: { type: ["string", "null"] },
      run_log_kind: { type: ["string", "null"] },
      run_log_path: { type: ["string", "null"] },
      stdout_tail: { type: ["string", "null"] },
      stderr_tail: { type: ["string", "null"] },
      transcript_tail: { type: ["string", "null"] },
      final_text: { type: ["string", "null"] },
      output_files: { type: "array", items: { type: "string" } },
      missing_fields: { type: "array", items: { type: "string" } },
      stats: { type: "object", additionalProperties: true },
      lookup: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
});

export const SUMMARY_SCHEMAS = {
  [SUMMARY_SCHEMA_ID]: SUMMARY_SCHEMA,
  [SESSION_SUMMARY_SCHEMA_ID]: SESSION_SUMMARY_SCHEMA,
  [FLIGHT_LOG_SCHEMA_ID]: FLIGHT_LOG_SCHEMA,
};

export function resolveSummarySchema(id = SUMMARY_SCHEMA_ID) {
  return SUMMARY_SCHEMAS[id] || SUMMARY_SCHEMA;
}
