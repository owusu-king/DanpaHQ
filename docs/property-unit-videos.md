# Optional Property and Unit videos

Implemented 4 November 2026.

## Behaviour

- One optional video per Property and per Unit, first in the existing Photos step. No new creation step.
- Web and mobile provide preview, playback, replacement, removal and retry. Existing creation and submission work without a video.
- Video attachments remain separate from photo evidence: required photo counts, amenities, verification prerequisites and publication rules are unchanged.
- Upload controls prevent advancing between creation steps while their video operation is running.
- Provider detail pages, public rental and sale detail pages, and management verification reviews display the appropriate video. Rental listings distinguish Unit and Property videos.

## Validation and security

- Source formats: MP4, MOV and WebM; source size: 30 MiB maximum; duration: 10 seconds maximum.
- Clients check file type, actual source size and playable duration before reserving storage. Mobile reads duration from the player instead of trusting optional picker metadata.
- Server checks declared type/size, actual bytes and size, container streams and duration. It decodes and independently checks the canonical output duration, including tests for forged source-duration metadata.
- FFmpeg normalises video to H.264/AAC MP4, up to 1280 pixels on the long edge and 30 fps, with metadata removed and fast-start playback. Output must be no larger than 3.3 MB and no longer than 10 seconds.
- The canonical bytes pass the existing malware-scan, checksum and immutable sealing pipeline before attachment or playback. Scanner failure never releases a file; retry reuses the same upload.
- Owner checks, record-management permissions, billing restrictions, occupied-Unit protections and review/approval locks apply on the server. A video cannot be reused across different records or substituted for a required photo.
- Public playback requires an approved condition check and the existing listing/sale visibility gate. Playback uses private storage and signed inline URLs lasting five minutes; local storage also supports byte-range requests.
- Submission freezes the video reference in the review record. Re-checks and later replacements cannot change the video associated with an earlier submitted review.
- Reservation retries use the existing idempotency infrastructure. Transfer, completion and attachment retries reuse the file; attachment updates one nullable relationship rather than adding media rows.

## Storage and deployment

- Reuses the existing private local/S3 storage infrastructure; no public bucket or separate media service.
- Adds two nullable one-to-one file relationships and two upload purposes. Apply the new Django migrations.
- Rebuild and deploy the backend image: the Docker runtime now includes FFmpeg/FFprobe. No JavaScript or Python package dependency was added. Both API and worker should use the updated image.
- Transcoding runs during upload completion with bounded tool execution, fixed server-controlled paths and restricted input protocols. Allow the existing API its normal 60-second worker timeout; clients allow up to 90 seconds for completion.
- Source uploads can reach 30 MiB even when the scanner has a smaller limit, because only the compressed canonical copy (maximum 3.3 MB) reaches the scanner. Other upload-purpose limits are unchanged.
- The original source object is discarded after preparation. Unattached videos expire through the existing seven-day retention/purge mechanism. Removed or replaced videos receive the same retention period unless a submitted verification references them; reviewed assets are retained with the review history.

## Verification

- Backend: 108 video/upload/storage tests and 198 existing creation/photo/verification regression tests passed (306 total). Ruff and migration consistency checks passed.
- Web: 583 tests, lint, TypeScript and production build passed.
- Mobile: 475 tests, lint and TypeScript passed.
- Browser: upload and playback checks at 360, 390, 430, 768 and 1440 px; Unit creation sheet also checked at tablet, desktop and landscape sizes. No horizontal overflow or runtime errors in the tested surfaces.
- Exercised rejection before upload, preview, playback, replacement, removal, a simulated attachment failure and retry without another reservation. Played videos on Property, Unit, rental and sale detail pages.
- Actual-file backend cases cover MP4, MOV, WebM, the ten-second boundary, long/corrupt videos, forged duration metadata, scan/seal completion, authorization, review locking, idempotency, retained review snapshots and local byte ranges.
- Browser tests used synthetic accounts and mocked API responses. Native physical-device playback, live S3 and the external malware-scanning service were not exercised. No deployment was performed.
- Browser titles and metadata were unchanged; diff whitespace checks passed.

## Files changed

### backend

- `backend/Dockerfile`
- `backend/apps/api/urls.py`
- `backend/apps/files/migrations/0004_property_unit_video_purposes.py`
- `backend/apps/files/models.py`
- `backend/apps/files/services.py`
- `backend/apps/files/storage.py`
- `backend/apps/files/validation.py`
- `backend/apps/files/videos.py`
- `backend/apps/files/views.py`
- `backend/apps/listing/serializers.py`
- `backend/apps/property/migrations/0002_property_unit_video.py`
- `backend/apps/property/models.py`
- `backend/apps/property/read_models.py`
- `backend/apps/property/serializers.py`
- `backend/apps/property/services.py`
- `backend/apps/property/videos.py`
- `backend/apps/property/views.py`
- `backend/apps/sale/serializers.py`
- `backend/apps/trust/condition.py`
- `backend/apps/trust/serializers.py`
- `backend/tests/integration/test_property_videos.py`

### web

- `web/app/management/verifications/page.tsx`
- `web/app/record/listing/page.tsx`
- `web/app/record/property/page.tsx`
- `web/app/record/sale/page.tsx`
- `web/app/record/space/page.tsx`
- `web/src/components/property/PropertyWizard.tsx`
- `web/src/components/property/SpacePhotos.tsx`
- `web/src/components/property/UnitWizard.tsx`
- `web/src/components/property/VerificationPanel.tsx`
- `web/src/components/property/WalkthroughVideo.tsx`
- `web/src/lib/console.ts`
- `web/src/lib/listings.ts`
- `web/src/lib/modalPerformance.test.mjs`
- `web/src/lib/propertyCreation.contract.test.mjs`
- `web/src/lib/propertyVideo.test.mjs`
- `web/src/lib/propertyVideo.ts`
- `web/src/lib/sales.ts`
- `web/src/lib/unitSetupModal.test.mjs`
- `web/src/lib/verification.ts`
- `web/src/lib/videoClip.ts`

### mobile

- `mobile/app/(app)/listing/[id].tsx`
- `mobile/app/(app)/provider-property.tsx`
- `mobile/app/(app)/sale/[id].tsx`
- `mobile/app/(app)/space.tsx`
- `mobile/src/components/property/PropertyWizard.tsx`
- `mobile/src/components/property/SpacePhotos.tsx`
- `mobile/src/components/property/UnitWizard.tsx`
- `mobile/src/components/property/VerificationPanel.tsx`
- `mobile/src/components/property/WalkthroughVideo.tsx`
- `mobile/src/listings.ts`
- `mobile/src/propertyVideo.test.mjs`
- `mobile/src/propertyVideo.ts`
- `mobile/src/provider.ts`
- `mobile/src/sales.ts`
- `mobile/src/verification.ts`

