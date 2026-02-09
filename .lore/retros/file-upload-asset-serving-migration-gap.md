---
title: Missing route handlers survived migration with passing tests
date: 2026-02-08
status: complete
tags: [bug, migration, api-routes, testing-gap, next-js]
modules: [file-upload, asset-serving, use-file-upload]
related: [.lore/retros/next-js-migration.md]
---

# Retro: File Upload and Asset Serving Migration Gap

## Summary

File upload and image rendering were completely broken in production. The upload button 404'd, and all images (in chat, browse, and pair writing) showed as broken. Two route handlers were never created during the Next.js migration, and the frontend hook had a URL that didn't match the project's API convention.

## What Went Well

- The domain logic was solid. `lib/file-upload.ts` (validation, unique filenames, security checks) and all viewer components (ImageViewer, VideoViewer, etc.) worked correctly. The gap was purely at the HTTP routing layer.
- Diagnosis was fast. Logs showed `Failed to find Server Action` errors, and grepping for the endpoint URL confirmed no route existed.
- The fix was small: one new route for upload (thin glue to existing library), one new route for asset serving, one URL fix in the hook.

## What Could Improve

- Two entire features shipped without working end-to-end. The upload UI existed, the hook existed, the library existed, the viewers existed, the tests passed. But the actual HTTP endpoints connecting frontend to backend were missing.
- Tests passed because they mock `fetch`, so the hook tests never exercise the real URL. The file-upload library tests call `uploadFile()` directly, bypassing HTTP entirely. No integration test verifies that an upload request actually reaches a handler.
- The `useFileUpload` hook used `/vault/${vaultId}/upload` while every other endpoint in the project uses `/api/vaults/${vaultId}/...`. This URL mismatch survived because the test asserted the wrong URL too, making the test green but the behavior broken.

## Lessons Learned

- When migrating, each feature needs an end-to-end smoke test that hits the real HTTP layer. Unit tests that mock fetch will stay green even when the route they call doesn't exist.
- Tests that assert URLs should be validated against the actual route structure. A test that checks `fetch("/vault/id/upload")` is asserting a contract with a server that nobody verified exists.
- Migration checklists should include "for each frontend fetch call, verify the corresponding API route exists." The frontend and backend were implemented independently, and the glue between them was the gap.
- Asset serving is infrastructure, not a feature. Every viewer component depends on `/vault/:id/assets/:path` working. When this route is missing, images, videos, PDFs, and markdown-embedded media all break simultaneously. Infrastructure routes need explicit verification during migration.
