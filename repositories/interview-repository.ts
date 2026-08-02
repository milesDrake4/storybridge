import type {
  InterviewMessageId,
  InterviewSessionId,
  UserId,
} from "@/contracts/domain/ids";
import type {
  InterviewQuestionKey,
  InterviewSession,
  InterviewSessionWithMessages,
  InterviewTurn,
} from "@/contracts/http/v1/interviews";

export class InterviewSequenceError extends Error {
  constructor() {
    super("Interview answer is out of sequence");
    this.name = "InterviewSequenceError";
  }
}

export interface InterviewRepository {
  start(userId: UserId, now: Date): Promise<InterviewSession>;
  getCurrent(userId: UserId): Promise<InterviewSessionWithMessages | null>;
  getTurn(
    userId: UserId,
    answerId: InterviewMessageId,
  ): Promise<InterviewTurn | null>;
  recordAnswer(input: {
    answer: string;
    now: Date;
    questionKey: InterviewQuestionKey;
    sessionId: InterviewSessionId;
    userId: UserId;
  }): Promise<InterviewTurn | null>;
}
