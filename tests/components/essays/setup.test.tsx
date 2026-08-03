import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EssayDashboard } from "@/components/essay/essay-dashboard";
import { EssaySetupForm } from "@/components/essay/essay-setup-form";
import { SchoolPicker } from "@/components/essay/school-picker";
import type { EssaySummary } from "@/contracts/http/v1/essays";
import type { SchoolSummary } from "@/contracts/http/v1/schools";

const now = "2026-08-03T16:00:00.000Z";
const school = {
  canonicalName: "University of Michigan",
  id: "f1000000-0000-4000-8000-000000000001",
  officialDomain: "umich.edu",
} as SchoolSummary;
const essay = {
  createdAt: now,
  id: "f2000000-0000-4000-8000-000000000001",
  school,
  status: "STRATEGY",
  updatedAt: now,
  wordLimit: 300,
} as EssaySummary;

afterEach(() => vi.unstubAllGlobals());

function success(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      data,
      meta: { requestId: "f9000000-0000-4000-8000-000000000001" },
    }),
    { headers: { "content-type": "application/json" }, status },
  );
}

function failure(code: string, status: number) {
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      error: { code, message: "Safe test error", retryable: false },
      meta: { requestId: "f9000000-0000-4000-8000-000000000002" },
    }),
    { headers: { "content-type": "application/json" }, status },
  );
}

describe("essay dashboard", () => {
  it("links an existing essay by registry name without exposing a domain prompt", () => {
    render(
      <EssayDashboard initialPage={{ items: [essay], nextCursor: null }} />,
    );

    expect(
      screen.getByRole("heading", { name: "University of Michigan" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /Open essay/i })).toHaveAttribute(
      "href",
      `/essays/${essay.id}`,
    );
    expect(screen.queryByLabelText(/domain/i)).not.toBeInTheDocument();
  });

  it("renders a useful empty state with one clear next action", () => {
    render(<EssayDashboard initialPage={{ items: [], nextCursor: null }} />);

    expect(
      screen.getByRole("heading", { name: "No essays yet" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Set up your first essay" }),
    ).toHaveAttribute("href", "/essays/new");
  });
});

describe("essay setup", () => {
  it("selects a registry school by keyboard and submits no caller-controlled domain", async () => {
    const workspace = {
      essay: {
        createdAt: now,
        dossierId: null,
        draftText: "",
        id: essay.id,
        outline: null,
        prompt: "Describe a community that has shaped your perspective.",
        revision: 0,
        schoolId: school.id,
        selectedAngleId: null,
        season: "2026-2027",
        status: "STRATEGY",
        updatedAt: now,
        userId: "f0000000-0000-4000-8000-000000000001",
        wordLimit: 300,
      },
      school,
    };
    const fetchMock = vi.fn().mockResolvedValue(success(workspace, 201));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<EssaySetupForm initialSchools={[school]} onCreated={onCreated} />);

    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByLabelText("Official application prompt"),
      workspace.essay.prompt,
    );
    await user.clear(screen.getByLabelText("Word limit"));
    await user.type(screen.getByLabelText("Word limit"), "300");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(onCreated).toHaveBeenCalledWith(essay.id);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/essays",
      expect.objectContaining({
        body: JSON.stringify({
          prompt: workspace.essay.prompt,
          schoolId: school.id,
          wordLimit: 300,
        }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
        }),
        method: "POST",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toContain("umich.edu");
  });

  it("blocks personal prose locally and preserves every safe form choice", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<EssaySetupForm initialSchools={[school]} />);

    await user.click(
      screen.getByRole("button", { name: /University of Michigan/i }),
    );
    const prompt = screen.getByLabelText("Official application prompt");
    await user.type(
      prompt,
      "Here is my essay draft: I grew up translating for my parents.",
    );
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Paste only the school's official prompt",
    );
    expect(prompt).toHaveValue(
      "Here is my essay draft: I grew up translating for my parents.",
    );
    expect(
      screen.getByRole("button", { name: /University of Michigan/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the prompt and offers recovery when the free limit is reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failure("QUOTA_EXCEEDED", 429)),
    );
    const user = userEvent.setup();
    render(<EssaySetupForm initialSchools={[school]} />);

    await user.click(
      screen.getByRole("button", { name: /University of Michigan/i }),
    );
    const prompt = screen.getByLabelText("Official application prompt");
    await user.type(
      prompt,
      "Describe a community that has shaped your perspective.",
    );
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your current essay allowance is already in use",
    );
    expect(
      screen.getByRole("link", { name: "Open your essays" }),
    ).toHaveAttribute("href", "/essays");
    expect(prompt).toHaveValue(
      "Describe a community that has shaped your perspective.",
    );
  });
});

describe("unsupported school recovery", () => {
  it("requests review using a school name without asking the student for a domain", async () => {
    const request = {
      createdAt: now,
      id: "f3000000-0000-4000-8000-000000000001",
      name: "Example College",
      status: "PENDING",
      updatedAt: now,
      url: null,
      userId: "f0000000-0000-4000-8000-000000000001",
    };
    const fetchMock = vi.fn().mockResolvedValue(success(request, 202));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <SchoolPicker initialSchools={[]} onSelect={vi.fn()} value={null} />,
    );

    await user.click(screen.getByRole("button", { name: "Request a school" }));
    await user.type(screen.getByLabelText("School name"), "Example College");
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Request received",
    );
    expect(screen.queryByLabelText(/domain/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/school-requests",
      expect.objectContaining({
        body: JSON.stringify({ name: "Example College" }),
        method: "POST",
      }),
    );
  });
});
