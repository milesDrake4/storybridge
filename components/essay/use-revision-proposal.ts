"use client";

import { useRef, useState } from "react";

import { apiSuccessSchema } from "@/contracts/http/v1/envelopes";
import { essaySchema, type Essay } from "@/contracts/http/v1/essays";
import {
  continuationProposalSchema,
  rewriteProposalSchema,
  type ContinuationProposal,
  type RewriteInstruction,
  type RewriteProposal,
} from "@/contracts/http/v1/proposals";
import { codePointOffset, sliceByCodePoints } from "@/lib/essay/apply-proposal";

type Proposal = RewriteProposal | ContinuationProposal;
export type RevisionProposalOptions = {
  draftText: string;
  essayId: string;
  onAccepted(essay: Essay): void;
  revision: number;
  saved: boolean;
  selection: { end: number; start: number };
};

async function textHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function useRevisionProposal(props: RevisionProposalOptions) {
  const [mode, setMode] = useState<"REWRITE" | "CONTINUATION">("REWRITE");
  const [instruction, setInstruction] = useState<RewriteInstruction>("CLARIFY");
  const [customInstruction, setCustomInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generationKey = useRef<string | null>(null);
  const acceptanceKey = useRef<string | null>(null);
  const canGenerate =
    props.saved &&
    (mode === "CONTINUATION" || props.selection.end > props.selection.start) &&
    (instruction !== "CUSTOM" || Boolean(customInstruction.trim()));

  async function generate() {
    setWorking(true);
    setNotice(null);
    generationKey.current ??= crypto.randomUUID();
    try {
      const rewrite = mode === "REWRITE";
      const selection = {
        end: codePointOffset(props.draftText, props.selection.end),
        start: codePointOffset(props.draftText, props.selection.start),
      };
      const body = rewrite
        ? {
            ...(instruction === "CUSTOM"
              ? { customInstruction: customInstruction.trim() }
              : {}),
            instruction,
            selection: {
              ...selection,
              textHash: await textHash(
                sliceByCodePoints(
                  props.draftText,
                  selection.start,
                  selection.end,
                ),
              ),
            },
          }
        : {
            contextHash: await textHash(props.draftText),
            cursorOffset: selection.end,
          };
      const response = await fetch(
        `/api/v1/essays/${props.essayId}/${rewrite ? "rewrite" : "continuation"}-proposals`,
        {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "idempotency-key": generationKey.current,
          },
          method: "POST",
        },
      );
      const schema = rewrite
        ? rewriteProposalSchema
        : continuationProposalSchema;
      const parsed = apiSuccessSchema(schema).safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !parsed.success) throw new Error();
      generationKey.current = null;
      acceptanceKey.current = null;
      setProposal(parsed.data.data);
    } catch {
      setNotice("A proposal could not be generated. Your draft is unchanged.");
    } finally {
      setWorking(false);
    }
  }

  async function accept() {
    if (!proposal || !props.saved) return;
    setWorking(true);
    setNotice(null);
    acceptanceKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/v1/essays/${props.essayId}/proposals/${proposal.id}/accept`,
        {
          body: JSON.stringify({ expectedRevision: props.revision }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": acceptanceKey.current,
            "if-match": `"essay:${props.essayId}:r${props.revision}"`,
          },
          method: "POST",
        },
      );
      const parsed = apiSuccessSchema(essaySchema).safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !parsed.success) {
        setNotice(
          response.status === 412
            ? "The saved draft changed. Your local text is preserved; reload before accepting."
            : "This proposal can no longer be accepted. Your draft is unchanged.",
        );
        return;
      }
      acceptanceKey.current = null;
      setProposal(null);
      props.onAccepted(parsed.data.data);
    } catch {
      setNotice("The proposal could not be applied. Your draft is unchanged.");
    } finally {
      setWorking(false);
    }
  }

  return {
    accept,
    canGenerate,
    customInstruction,
    generate,
    instruction,
    mode,
    notice,
    proposal,
    setCustomInstruction,
    setInstruction,
    setMode,
    setProposal,
    working,
  };
}
