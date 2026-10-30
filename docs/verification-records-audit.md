# Compact unit photos and verification-record semantics

Updated 28 October 2026. Implemented locally; no commit, push, deployment or
live property/verification data change was performed.

## Unit photos

Web and mobile SpacePhotos now render 80 × 64 image thumbnails beside the slot
label, requirement guidance and existing controls. Original files and evidence
associations are untouched. Add, remove and primary-photo actions remain; primary
status is shown in the caption. The layout wraps long text and keeps controls
accessible rather than shrinking their touch targets.

## Ambiguities and logical errors found

1. **Review type used the ownership relationship.** A property row displayed
   Owner/Agent under Review while a unit row displayed Unit photos. The table
   now has separate Review type and Claimed role columns. Types are Property
   verification and Unit verification. Unit review records have no separate
   ownership claim; their role cell says Not applicable.
2. **Server status filtering used different values from the UI.** Property
   applications store values such as approved, while the whole property package
   can display verified. The raw application filter ran before computing that
   status, incorrectly hiding matching rows. Filtering now uses the displayed
   states within the same recent-record window as the client.
3. **Dates were fabricated as submission dates.** Unit records fell back to
   decision/creation timestamps when no queue entry existed. Submitted dates are
   now returned only when known from the queue; actual decision dates remain
   separate. The main date column is Last activity, computed from recorded
   update/submission/decision times and used consistently for ordering.
4. **Drafts could appear as historical submissions.** Never-submitted property
   drafts and not-started/unqueued pending unit checks are excluded. Previously
   submitted property records and actual unit reviews remain available.
5. **Historical approval was confused with current validity.** Unit rows now
   expose their actual stored review status, e.g. approved, rather than deriving
   a new historical verdict from is_current. Current unit eligibility and
   publication gates are unchanged. The UI distinguishes current property
   submission summaries from unit review records.
6. **The person column could imply the actual sender.** A unit review's
   submitted_by is set when its draft opens and may identify the original photo
   uploader. The table now labels that person Review author, and property
   applicants Applicant, rather than presenting both as Submitted by.
7. **The bounded response looked like an exhaustive history.** The endpoint now
   declares its limit, recent-record scope and whether older rows exist. The UI
   explains that search/filters cover the displayed records when truncated.
   Row keys include subject type so polymorphic record IDs cannot clash.

The navigation and page are now called **Verification records**. This remains a
recent-record view: latest property submission summaries plus unit review
records, not an immutable event archive of every property transition. The audit
log remains the source for complete recorded transitions. The existing endpoint
`/api/v1/management/providers/` and permission are retained. Additive fields
include review/relationship labels, status scope, person label, recorded_at,
limit, has_more and scope. Unit status values now use actual review statuses
(approved rather than synthesized verified); property package states remain.

## Validation

- Focused backend suite: 182 passed, including new tests for separate role/type
  fields, computed property status filters, unknown submission dates, recorded
  approvals, draft exclusion and bounded-window metadata.
- Web tests: 529 passed. TypeScript passed. ESLint: no errors, one existing warning.
- Mobile tests: 456 passed. TypeScript passed. ESLint: no errors, 227 existing warnings.
- Backend Ruff passed. `git diff --check` passed.
- Web production build passed. Android/iOS Expo bundle exports passed for both platforms.

No physical-device interaction or authenticated browser acceptance was run for
these changes. The image dimensions/layout are explicit in the shared components;
mobile compilation and bundle checks do not establish physical-device rendering.
The full backend suite was not rerun for this turn; the relevant unit, condition,
Management and provider-approval suites were run. Logs: ignored
`tmp/photo-history-*`.
