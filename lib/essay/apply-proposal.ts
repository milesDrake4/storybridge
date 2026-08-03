import type {
  ContinuationProposal,
  RewriteProposal,
} from "@/contracts/http/v1/proposals";

export function applyRewriteProposal(
  draftText: string,
  proposal: RewriteProposal,
): string {
  const points = Array.from(draftText);
  return `${points.slice(0, proposal.selection.start).join("")}${proposal.proposedText}${points.slice(proposal.selection.end).join("")}`;
}

export function codePointOffset(value: string, utf16Offset: number): number {
  return Array.from(value.slice(0, utf16Offset)).length;
}

export function sliceByCodePoints(
  value: string,
  start: number,
  end?: number,
): string {
  return Array.from(value).slice(start, end).join("");
}

export function continuationText(proposal: ContinuationProposal): string {
  return proposal.suggestions
    .map((suggestion) => suggestion.proposedText)
    .join("\n\n");
}

export function applyContinuationProposal(
  draftText: string,
  proposal: ContinuationProposal,
): string {
  const before = sliceByCodePoints(draftText, 0, proposal.cursorOffset);
  const after = sliceByCodePoints(draftText, proposal.cursorOffset);
  const proposed = continuationText(proposal);
  const leading = before && !/[ \n]$/u.test(before) ? " " : "";
  const trailing = after && !/^[ \n,.;:!?)]/u.test(after) ? " " : "";
  return `${before}${leading}${proposed}${trailing}${after}`;
}
