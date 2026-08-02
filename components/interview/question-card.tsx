import type { FormEvent } from "react";

type QuestionCardProps = {
  answer: string;
  disabled: boolean;
  onAnswerChange(answer: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  question: string;
  questionNumber: number;
};

export function QuestionCard({
  answer,
  disabled,
  onAnswerChange,
  onSubmit,
  question,
  questionNumber,
}: QuestionCardProps) {
  return (
    <form className="question-card" onSubmit={onSubmit}>
      <p className="eyebrow">Question {questionNumber} of 9</p>
      <h1 id="interview-question">{question}</h1>
      <div className="interview-answer-field">
        <label className="field-label" htmlFor="interview-answer">
          Your answer
        </label>
        <textarea
          aria-describedby="answer-guidance"
          autoFocus
          disabled={disabled}
          id="interview-answer"
          maxLength={4000}
          onChange={(event) => onAnswerChange(event.target.value)}
          placeholder="Write in your own words. A few sentences is enough."
          rows={8}
          value={answer}
        />
        <div className="answer-meta" id="answer-guidance">
          <span>Your answer saves when you continue.</span>
          <span>{answer.length.toLocaleString()} / 4,000</span>
        </div>
      </div>
      <button
        className="button button-primary"
        disabled={disabled || answer.trim().length === 0}
        type="submit"
      >
        {disabled ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
