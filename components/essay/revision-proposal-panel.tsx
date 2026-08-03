import { ProposalDiff } from "@/components/essay/proposal-diff";
import {
  useRevisionProposal,
  type RevisionProposalOptions,
} from "@/components/essay/use-revision-proposal";
import { rewriteInstructionSchema } from "@/contracts/http/v1/proposals";

export function RevisionProposalPanel(props: RevisionProposalOptions) {
  const state = useRevisionProposal(props);

  return (
    <section
      className="revision-proposal-panel"
      aria-labelledby="revision-tools-heading"
    >
      <p className="eyebrow">Optional AI changes</p>
      <h3 id="revision-tools-heading">Preview before anything changes</h3>
      <p>
        Select saved text for a rewrite, or place the cursor for a continuation.
      </p>
      {!props.saved ? (
        <p className="research-notice" role="status">
          Finish saving your current draft before generating a proposal.
        </p>
      ) : null}
      <div className="essay-workspace-actions">
        <button
          aria-pressed={state.mode === "REWRITE"}
          className="button button-secondary"
          onClick={() => state.setMode("REWRITE")}
          type="button"
        >
          Rewrite selection
        </button>
        <button
          aria-pressed={state.mode === "CONTINUATION"}
          className="button button-secondary"
          onClick={() => state.setMode("CONTINUATION")}
          type="button"
        >
          Continue at cursor
        </button>
      </div>
      {state.mode === "REWRITE" ? (
        <>
          <label>
            Rewrite goal
            <select
              onChange={(event) =>
                state.setInstruction(
                  rewriteInstructionSchema.parse(event.target.value),
                )
              }
              value={state.instruction}
            >
              <option value="CLARIFY">Clarify</option>
              <option value="TIGHTEN">Tighten</option>
              <option value="EXPAND">Expand</option>
              <option value="STRENGTHEN_EVIDENCE">Strengthen evidence</option>
              <option value="IMPROVE_TRANSITION">Improve transition</option>
              <option value="PRESERVE_VOICE">Preserve voice</option>
              <option value="CUSTOM">Custom instruction</option>
            </select>
          </label>
          {state.instruction === "CUSTOM" ? (
            <label>
              Custom instruction
              <input
                maxLength={500}
                onChange={(event) =>
                  state.setCustomInstruction(event.target.value)
                }
                value={state.customInstruction}
              />
            </label>
          ) : null}
        </>
      ) : null}
      <button
        className="button button-secondary"
        disabled={!state.canGenerate || state.working}
        onClick={() => void state.generate()}
        type="button"
      >
        {state.working && !state.proposal ? "Generating…" : "Generate preview"}
      </button>
      {state.notice ? <p role="alert">{state.notice}</p> : null}
      {state.proposal ? (
        <ProposalDiff
          acceptDisabled={!props.saved}
          draftText={props.draftText}
          onAccept={() => void state.accept()}
          onDismiss={() => state.setProposal(null)}
          proposal={state.proposal}
          working={state.working}
        />
      ) : null}
    </section>
  );
}
