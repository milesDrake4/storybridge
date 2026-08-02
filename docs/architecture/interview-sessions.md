# Interview session boundary

Interview questions and message ordering are server-owned. The database keeps a
single active session per user, assigns every sequence number while holding the
session lock, and rejects unknown, completed, replayed, or out-of-order turns.
Clients may select their own transcript through RLS but cannot read the fixed
question catalog or mutate interview tables and RPCs directly.

The application checks current invitation, consent, and age eligibility before
every operation. Answer requests require a same-origin cookie request and an
idempotency key. They reserve AI usage before moderation, never persist blocked
answer text, finalize the content-free usage record, and persist a turn only
after moderation succeeds. Same-key/same-body retries load the already-created
turn without calling the provider again; changed-body reuse fails with 409.

Repository reads always include the authenticated user ID even though server
credentials bypass RLS. Consequently, a missing session and another user's
session produce the same public 404 response.
