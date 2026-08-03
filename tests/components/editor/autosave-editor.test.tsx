import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlainTextEditor } from "@/components/essay/plain-text-editor";
import { draftRecoveryKey } from "@/components/essay/use-autosave";

const now = "2026-08-03T22:00:00.000Z";
const essayId = "a1000000-0000-4000-8000-000000000001";
const essay = {
  createdAt: now,
  dossierId: "a2000000-0000-4000-8000-000000000001",
  draftText: "Saved draft",
  id: essayId,
  outline: null,
  prompt: "Describe a community that shaped how you contribute today.",
  revision: 4,
  schoolId: "a3000000-0000-4000-8000-000000000001",
  season: "2026-2027",
  selectedAngleId: "a4000000-0000-4000-8000-000000000001",
  status: "DRAFTING",
  updatedAt: now,
  userId: "a0000000-0000-4000-8000-000000000001",
  wordLimit: 300,
};

function envelope(data: unknown) {
  return {
    apiVersion: "1",
    data,
    meta: { requestId: "a9000000-0000-4000-8000-000000000001" },
  };
}

function success(draftText: string, revision: number) {
  return new Response(
    JSON.stringify(envelope({ ...essay, draftText, revision })),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("plain-text autosave editor", () => {
  it("updates locally and begins one save after 750 ms", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PlainTextEditor
        essayId={essayId}
        initialRevision={3}
        initialText=""
        wordLimit={300}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Essay draft" });

    fireEvent.change(editor, {
      target: { value: "Three local words" },
    });
    expect(editor).toHaveValue("Three local words");
    expect(screen.getByText("3 / 300 words")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(749));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText("Saving")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/essays/${essayId}`,
      expect.objectContaining({
        body: JSON.stringify({ draftText: "Three local words" }),
        headers: expect.objectContaining({
          "if-match": `"essay:${essayId}:r3"`,
        }),
      }),
    );

    await act(async () => pending.resolve(success("Three local words", 4)));
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("queues a blur flush behind one in-flight save and preserves newer text", async () => {
    const first = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(success("Newer local text", 5));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PlainTextEditor
        essayId={essayId}
        initialRevision={3}
        initialText=""
        wordLimit={300}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Essay draft" });
    fireEvent.change(editor, { target: { value: "First text" } });
    await act(() => vi.advanceTimersByTimeAsync(750));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: "Newer local text" } });
    fireEvent.blur(editor);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(editor).toHaveValue("Newer local text");

    await act(async () => first.resolve(success("First text", 4)));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      draftText: "Newer local text",
    });
    expect(editor).toHaveValue("Newer local text");
  });

  it("keeps local text on 412 until the student chooses a version", async () => {
    const serverText = "Saved on another device";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 412 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify(
              envelope({
                essay: { ...essay, draftText: serverText, revision: 8 },
                school: {
                  canonicalName: "University of Michigan",
                  id: essay.schoolId,
                  officialDomain: "umich.edu",
                },
              }),
            ),
          ),
        ),
    );
    render(
      <PlainTextEditor
        essayId={essayId}
        initialRevision={3}
        initialText="Original saved text"
        wordLimit={300}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Essay draft" });
    fireEvent.change(editor, { target: { value: "My unsaved local work" } });
    fireEvent.blur(editor);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", {
        name: "This draft changed elsewhere",
      }),
    ).toBeVisible();
    expect(editor).toHaveValue("My unsaved local work");
    fireEvent.change(editor, {
      target: { value: "My still-newer unsaved local work" },
    });
    expect(
      screen.getByRole("heading", { name: "This draft changed elsewhere" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Use saved version" }));
    expect(editor).toHaveValue(serverText);
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("recovers a newer browser buffer without overwriting the server", async () => {
    window.localStorage.setItem(
      draftRecoveryKey(essayId),
      "Recovered browser text",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PlainTextEditor
        essayId={essayId}
        initialRevision={3}
        initialText="Older server text"
        wordLimit={300}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("textbox", { name: "Essay draft" })).toHaveValue(
      "Recovered browser text",
    );
    expect(screen.getByText(/Recovered unsaved text/)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
