# Security policy

StoryBridge handles private student writing, authentication, AI-provider usage,
and payments. Please report suspected vulnerabilities privately and do not test
against another person's account or data.

## Supported versions

Security fixes are applied to the current production deployment and the latest
commit on `main`. Older commits, previews, and local development environments
are not supported releases.

## Report a vulnerability

Use [GitHub private vulnerability reporting][private-report] when it is
available. If you are an invited beta participant, you may instead reply to
your invitation email and ask to continue the conversation through the private
security channel.

If neither private route is available, open a GitHub issue containing only the
words **Security contact requested**. Do not include vulnerability details in
that issue. A maintainer will provide a private reporting route.

Include only the minimum safe diagnostic information:

- the affected route or component;
- the vulnerability category and potential impact;
- reproducible steps using synthetic data;
- the approximate time and a StoryBridge request ID, when applicable; and
- a suggested remediation, if you have one.

Never include student writing, interview answers, names, email addresses,
passwords, magic links, authentication values, API keys, webhook bodies,
payment-card or bank details, provider credentials, or complete production
request/response bodies. Redact screenshots and logs before sharing them.

## Safe research rules

- Use only an account and synthetic content you control.
- Do not access, modify, retain, or disclose another person's data.
- Do not perform denial-of-service, automated high-volume, social-engineering,
  spam, or destructive testing.
- Do not trigger real charges, refunds, provider spend, or account invitations
  without written authorization.
- Stop testing and report immediately if you encounter private data or a secret.

We will acknowledge a complete private report as soon as practical, coordinate
validation and remediation privately, and disclose a resolution only after a
fix is available. This policy does not authorize testing beyond these rules or
promise a bug bounty.

[private-report]: https://github.com/milesDrake4/storybridge/security/advisories/new
