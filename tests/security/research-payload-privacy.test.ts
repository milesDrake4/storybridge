import { describe, expect, it, vi } from "vitest";

import type { OpenAiTransport } from "@/adapters/openai/client";
import { createSchoolResearchAdapter } from "@/adapters/openai/school-research";
import type { SchoolId, UserId } from "@/contracts/domain/ids";

describe("school research payload privacy", () => {
  it("cannot serialize prompt, profile, draft, interview, or identity fields", async () => {
    const createResponse = vi.fn().mockResolvedValue({
      id: "resp_private_payload",
      model: "gpt-synthetic",
      output: [
        {
          action: {
            sources: [
              {
                type: "url",
                url: "https://example.edu/residential-learning",
              },
            ],
            type: "search",
          },
          id: "ws_private_payload",
          status: "completed",
          type: "web_search_call",
        },
        {
          content: [
            {
              text: JSON.stringify({
                schemaVersion: "1",
                sources: [
                  {
                    category: "CULTURE",
                    claim:
                      "Example University supports residential learning communities.",
                    retrievedAt: "2026-08-02T23:30:00.000Z",
                    supportingExcerpt:
                      "Residential learning communities support students at Example University.",
                    title: "Residential learning communities",
                    url: "https://example.edu/residential-learning",
                  },
                ],
                summary: "Public institutional information.",
              }),
              type: "output_text",
            },
          ],
          type: "message",
        },
      ],
      status: "completed",
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    });
    const adapter = createSchoolResearchAdapter(
      {
        contentHmacSecret: "content-secret-at-least-32-characters",
        maxOutputTokens: 4_000,
        model: "gpt-5.6-terra",
      },
      { createModeration: vi.fn(), createResponse } satisfies OpenAiTransport,
      {
        resolve: vi
          .fn()
          .mockResolvedValue("https://example.edu/residential-learning"),
      },
    );
    const privateMarkers = {
      draft: "PRIVATE_DRAFT_MARKER_5f9921",
      interviewAnswer: "PRIVATE_INTERVIEW_MARKER_87a011",
      profile: "PRIVATE_PROFILE_MARKER_2db651",
      prompt: "PRIVATE_PROMPT_MARKER_b83920",
      rawEmail: "private-user@example.test",
    };

    await adapter.research({
      ...privateMarkers,
      school: {
        canonicalName: "Example University",
        id: "a9100000-0000-4000-8000-000000000001" as SchoolId,
        officialDomain: "example.edu",
      },
      userId: "a9000000-0000-4000-8000-000000000001" as UserId,
    } as unknown as Parameters<typeof adapter.research>[0]);

    const serialized = JSON.stringify(createResponse.mock.calls[0]?.[0]);
    for (const marker of Object.values(privateMarkers)) {
      expect(serialized).not.toContain(marker);
    }
    expect(serialized).toContain("Example University");
    expect(serialized).toContain("example.edu");
  });
});
