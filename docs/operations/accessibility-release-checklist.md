# Accessibility release checklist

Run this checklist against the release candidate after automated tests pass. Record the browser/assistive-technology version, tester, date, result, and issue link for every failure. A blocking failure must be fixed and rechecked before invitations open.

## Automated baseline

- [ ] `npm run test -- tests/components/accessibility/core-journey.test.tsx`
- [ ] `npm run test:e2e -- --project=chromium e2e/accessibility.spec.ts`
- [ ] Chromium axe checks report no critical or serious WCAG 2 A/AA, 2.1 AA, or 2.2 AA violations.
- [ ] The home page has no horizontal document overflow at a 320 × 720 CSS-pixel viewport.

## Keyboard-only journey

Use browser defaults with no mouse or trackpad.

- [ ] On every route, the first Tab reveals “Skip to main content”; Enter moves focus to the main landmark.
- [ ] Focus is always visible and follows a logical order through sign-in, consent, interview, Story Vault, essay setup, research, strategy, outline, editor, review, export, and settings.
- [ ] Native disclosure summaries in the essay workspace open and close with Enter and Space without losing focus.
- [ ] Dialogs place focus on their heading, keep interaction within the decision until closed, and return focus to the invoking control.
- [ ] All destructive actions require an explicit confirmation and can be canceled by keyboard.
- [ ] Draft selection, rewrite preview, acceptance, conflict recovery, reference-claim decisions, final review, and export remain keyboard-complete.

## Screen reader smoke test

Test Safari with VoiceOver on macOS. Repeat the critical sign-in-to-export path with NVDA + Firefox or JAWS + Chrome when a Windows test device is available.

- [ ] Each page announces one main landmark and a descriptive level-one heading.
- [ ] Navigation landmarks have distinct names; repeated links have understandable names in context.
- [ ] Every form control announces its label, required state, instructions, and error relationship.
- [ ] Blocking errors move focus to a named error summary; background progress and saved states announce once without interrupting typing.
- [ ] Interview progress, autosave, proposal creation, deletion status, and export results are understandable without visual position or color.
- [ ] Read-only reference-draft status and the inability to accept/export it are announced before its text.
- [ ] Citations announce meaningful link text rather than a raw URL alone.

## Responsive and zoom checks

- [ ] Safari and Firefox at 320, 375, 768, 1280, and 1440 CSS pixels show no clipped controls or horizontal page scrolling.
- [ ] At 1280–1440 pixels, coaching, reference-draft, and final-review panels can be collapsed with native disclosure controls.
- [ ] At 200% browser zoom, content reflows without loss of information or two-dimensional scrolling, except intrinsically scrollable draft/version text regions.
- [ ] Text spacing overrides (1.5 line height, 0.12 em word spacing, 0.16 em letter spacing, 2× paragraph spacing) do not clip or overlap content.
- [ ] Landscape mobile layout preserves access to primary navigation, form errors, and action buttons.

## Motion, color, and forced settings

- [ ] With “Reduce motion” enabled, scrolling and state changes do not rely on animation.
- [ ] With macOS Increase Contrast or Windows forced colors enabled, focus, borders, selected controls, errors, and disabled controls remain distinguishable.
- [ ] Information conveyed by red/green status also has text and programmatic status.
- [ ] Light-mode text and controls maintain WCAG 2.2 AA contrast; focus indicators are visible against adjacent colors.

## Browser sign-off record

| Surface | Browser / assistive technology | Version | Tester / date | Result | Issue |
| --- | --- | --- | --- | --- | --- |
| Public + sign-in | Safari + VoiceOver |  |  |  |  |
| Core product journey | Safari + VoiceOver |  |  |  |  |
| Core product journey | Firefox + keyboard |  |  |  |  |
| Critical journey | NVDA + Firefox (Windows) |  |  |  |  |
| Responsive 320–1440 | Safari + Firefox |  |  |  |  |

## Release decision

- [ ] No open critical or serious accessibility defect remains.
- [ ] Any lower-severity exception has an owner, documented user impact, workaround, and target date.
- [ ] The completed record is attached to the Task 42 release evidence.
