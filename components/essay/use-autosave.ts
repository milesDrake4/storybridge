"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import {
  essaySchema,
  essayWorkspaceSchema,
  type Essay,
} from "@/contracts/http/v1/essays";

export type AutosaveState = "IDLE" | "SAVING" | "SAVED" | "FAILED" | "CONFLICT";

type Conflict = { essay: Essay; revision: number; serverText: string };

type Options = {
  essayId: string;
  initialRevision: number;
  initialText: string;
  onSaved?(essay: Essay): void;
};

export function draftRecoveryKey(essayId: string): string {
  return `storybridge:draft:${essayId}`;
}

async function json(response: Response) {
  return response.json().catch(() => null);
}

export function useAutosave({
  essayId,
  initialRevision,
  initialText,
  onSaved,
}: Options) {
  const [text, setTextState] = useState(initialText);
  const [state, setState] = useState<AutosaveState>("SAVED");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [currentRevision, setCurrentRevision] = useState(initialRevision);
  const textRef = useRef(initialText);
  const savedText = useRef(initialText);
  const revision = useRef(initialRevision);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const flushPending = useRef(false);
  const mounted = useRef(true);
  const stateRef = useRef<AutosaveState>("SAVED");

  const transition = useCallback((next: AutosaveState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const persistRecovery = useCallback(
    (value: string) => {
      try {
        if (value === savedText.current) {
          window.localStorage.removeItem(draftRecoveryKey(essayId));
        } else {
          window.localStorage.setItem(draftRecoveryKey(essayId), value);
        }
      } catch {
        // Persistence is best-effort; the in-memory draft remains canonical locally.
      }
    },
    [essayId],
  );

  const loadConflict = useCallback(async (): Promise<Conflict | null> => {
    try {
      const response = await fetch(`/api/v1/essays/${essayId}`, {
        cache: "no-store",
      });
      const parsed = apiSuccessSchema(essayWorkspaceSchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) return null;
      return {
        essay: parsed.data.data.essay,
        revision: parsed.data.data.essay.revision,
        serverText: parsed.data.data.essay.draftText,
      };
    } catch {
      return null;
    }
  }, [essayId]);

  async function save() {
    if (inFlight.current || stateRef.current === "CONFLICT") {
      flushPending.current = true;
      return;
    }
    const value = textRef.current;
    if (value === savedText.current) {
      transition("SAVED");
      return;
    }
    inFlight.current = true;
    flushPending.current = false;
    transition("SAVING");
    const savingRevision = revision.current;
    let completed = false;
    try {
      const response = await fetch(`/api/v1/essays/${essayId}`, {
        body: JSON.stringify({ draftText: value }),
        headers: {
          "content-type": "application/json",
          "if-match": `"essay:${essayId}:r${savingRevision}"`,
        },
        method: "PATCH",
      });
      if (response.status === 412) {
        const latest = await loadConflict();
        if (!mounted.current) return;
        setConflict(latest);
        transition("CONFLICT");
        return;
      }
      const parsed = apiSuccessSchema(essaySchema).safeParse(
        await json(response),
      );
      if (!response.ok || !parsed.success) throw new Error();
      if (!mounted.current) return;
      savedText.current = value;
      revision.current = parsed.data.data.revision;
      setCurrentRevision(parsed.data.data.revision);
      completed = true;
      onSaved?.(parsed.data.data);
      persistRecovery(textRef.current);
      if (textRef.current === value) setRecovered(false);
      transition(textRef.current === value ? "SAVED" : "IDLE");
    } catch {
      if (mounted.current) transition("FAILED");
    } finally {
      inFlight.current = false;
      if (
        mounted.current &&
        completed &&
        (flushPending.current || textRef.current !== savedText.current)
      ) {
        flushPending.current = false;
        window.setTimeout(() => void save(), 0);
      }
    }
  }

  useEffect(() => {
    revision.current = Math.max(revision.current, initialRevision);
  }, [initialRevision]);

  useEffect(() => {
    mounted.current = true;
    const recoveryTimer = window.setTimeout(() => {
      setRecovered(false);
      try {
        const buffered = window.localStorage.getItem(draftRecoveryKey(essayId));
        if (buffered !== null && buffered !== initialText) {
          textRef.current = buffered;
          setTextState(buffered);
          setRecovered(true);
          transition("IDLE");
        }
      } catch {
        // Private browsing may disable storage; editing still works in memory.
      }
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(recoveryTimer);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [essayId, initialText, transition]);

  function setText(value: string) {
    textRef.current = value;
    setTextState(value);
    persistRecovery(value);
    if (stateRef.current === "CONFLICT") return;
    transition("IDLE");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 750);
  }

  function flush() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    void save();
  }

  function useServerVersion() {
    if (!conflict) return;
    revision.current = conflict.revision;
    setCurrentRevision(conflict.revision);
    savedText.current = conflict.serverText;
    textRef.current = conflict.serverText;
    setTextState(conflict.serverText);
    persistRecovery(conflict.serverText);
    onSaved?.(conflict.essay);
    setConflict(null);
    setRecovered(false);
    transition("SAVED");
  }

  function retryLocalVersion() {
    if (conflict) revision.current = conflict.revision;
    setConflict(null);
    transition("IDLE");
    window.setTimeout(() => void save(), 0);
  }

  async function refreshConflict() {
    const latest = await loadConflict();
    if (latest) setConflict(latest);
  }

  function adoptServerEssay(essay: Essay) {
    revision.current = essay.revision;
    setCurrentRevision(essay.revision);
    savedText.current = essay.draftText;
    textRef.current = essay.draftText;
    setTextState(essay.draftText);
    persistRecovery(essay.draftText);
    setConflict(null);
    setRecovered(false);
    transition("SAVED");
    onSaved?.(essay);
  }

  return {
    adoptServerEssay,
    conflict,
    currentRevision: Math.max(currentRevision, initialRevision),
    flush,
    recovered,
    refreshConflict,
    retry: flush,
    retryLocalVersion,
    setText,
    state,
    text,
    useServerVersion,
  };
}
