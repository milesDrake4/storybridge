# Story Vault extraction

Story Vault extraction runs only for an owned, complete interview with minimum
coverage. A profile already bound to the interview is returned before an AI
reservation, so completion retries cannot consume another provider operation.
Same-key retries that reach the reservation layer return the persisted profile
resource and never call the provider again.

The structured-output contract permits only explicit, non-sensitive facts.
Every candidate must cite one or more user-answer message IDs; the service
checks those IDs against the owned transcript before persistence. The database
repeats the ownership check with composite foreign keys tying each fact source
to the same user, profile, interview session, and message.

Persistence is one transaction. It creates a versioned profile, unverified
facts, and their source joins together or creates nothing. Fact content receives
a keyed HMAC before it crosses the repository boundary. Raw transcript and fact
content are never written to AI-operation or usage records.
