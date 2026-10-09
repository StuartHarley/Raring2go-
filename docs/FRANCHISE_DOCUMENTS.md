# Franchise documents (FRN-004)

- Upload: `POST /api/franchise/documents` (multipart). Needs `franchise.document/upload` within the franchise's territory; rate limited per user; 4MB cap; type sniffed from magic bytes (PDF, PNG, JPEG, DOCX), never from the file name or declared type.
- Every file is checksummed (SHA-256), stored through the storage provider, scanned, and refused (and deleted) unless the scan is clean. Source files are never overwritten: a new version is a new stored object.
- Download: `GET /app/franchisees/[id]/documents/[documentId]/download[?version=n]`. Needs `franchise.document/download`; re-checks the file reference, territory and scan status, audits `franchise.document.download`, and redirects to a short-lived attachment URL (`no-store`). Failures are a generic 404.
- Executed agreements are adopted into the vault (category `agreement`) pointing at the same artefact ids; nothing is copied.
- Migration/seed impact: none.
