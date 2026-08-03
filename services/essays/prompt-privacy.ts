const DIRECT_DRAFT_MARKERS = [
  /\b(?:here(?:'s| is)|below is) my (?:draft|essay|response)\b/iu,
  /\bmy (?:college essay|essay draft|personal statement)\b/iu,
  /\b(?:draft|notes?) (?:about|for) me\b/iu,
];

const PERSONAL_NARRATIVE_MARKERS = [
  /\bi (?:am|was|have|had|grew|learned|led|moved|created|founded|volunteer(?:ed)?)\b/iu,
  /\bmy (?:family|mother|father|parent|school|gpa|grade|experience|story|life|team)\b/iu,
];

export function hasPromptPrivacyRisk(prompt: string): boolean {
  const normalized = prompt.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return [...DIRECT_DRAFT_MARKERS, ...PERSONAL_NARRATIVE_MARKERS].some(
    (pattern) => pattern.test(normalized),
  );
}
