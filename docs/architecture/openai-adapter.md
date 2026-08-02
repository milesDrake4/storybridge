# OpenAI adapter boundary

The StoryBridge domain exposes provider-neutral structured-generation and
moderation ports. Only `adapters/openai` imports the OpenAI SDK or knows the
provider request and response shapes.

## Verified provider behavior

- Responses use `store: false`, a keyed pseudonymous `safety_identifier`, an
  explicit `max_output_tokens`, and `text.format.type: "json_schema"`. These
  fields are defined by the official
  [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create).
- Zod schemas are converted with the official SDK's `zodTextFormat` helper and
  validated again after JSON parsing. Strict Structured Outputs require every
  field, require `additionalProperties: false`, and can still return refusals
  or incomplete output; see the official
  [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).
- Moderation uses `omni-moderation-latest` and normalizes only the provider
  request ID, model, flag, category names, and scores into the domain port. Application policy—not a
  raw score alone—decides the user experience, following the official
  [Moderation guide](https://developers.openai.com/api/docs/guides/moderation).
- The SDK defaults to two retries and a ten-minute timeout. StoryBridge still
  sends explicit per-purpose retry and timeout options so deadlines remain
  visible and testable; see the official
  [OpenAI Node SDK retry and timeout documentation](https://github.com/openai/openai-node#retries).

Provider messages and objects do not cross the adapter. Schema errors,
refusals, deadlines, and transport failures become stable typed errors without
including provider detail or student content.
