# Railway ClamAV Scanner

This service is the private HTTP scanner used by `SCANNER_PROVIDER=clamav-http`.
It is a deployment component, not a product feature or public file endpoint.

## Service

Location: `services/clamav-scanner`

The service:

- runs `clamd` in the same container;
- updates ClamAV definitions with `freshclam` on startup;
- exposes `GET /health` for Railway health checks;
- exposes authenticated `POST /scan`;
- accepts only the existing app adapter shape:

```json
{
  "fileId": "file_123",
  "storageKey": "private/object/key.pdf",
  "contentType": "application/pdf",
  "checksum": "optional-checksum"
}
```

The service fetches the object from the private R2 bucket, streams it to ClamAV with `INSTREAM`, and returns:

```json
{
  "fileId": "file_123",
  "status": "clean",
  "providerKey": "clamav-http",
  "scannedAt": "2026-08-11T12:00:00.000Z",
  "signature": null,
  "findings": []
}
```

Statuses are `clean`, `infected` or `failed`. The app maps `infected` to a rejected/blocked file state. The scanner never logs file bodies and never returns file contents.

## Railway Setup

1. Create a new Railway service from the GitHub repo.
2. Set the service root/build context to the repository root.
3. Set Dockerfile path to `services/clamav-scanner/Dockerfile`.
4. Configure the Railway health check path as `/health`.
5. Configure the environment variables below.
6. Deploy.
7. Confirm `/health` returns `{"ok":true}`.
8. Run a controlled scan against a harmless test object in the private R2 bucket.
9. Run a controlled EICAR test object only in the approved UAT bucket/path, then delete it.

## Railway Environment Variables

Do not commit real values.

```text
PORT=3000
SCANNER_API_KEY=
MAX_FILE_BYTES=26214400
SCAN_TIMEOUT_MS=30000
CLAMD_HOST=127.0.0.1
CLAMD_PORT=3310
R2_ACCOUNT_ID=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

Generate `SCANNER_API_KEY` as a high-entropy random value, for example:

```bash
openssl rand -base64 48
```

Store it only in Railway and the app environment that calls the scanner.

## Expected Scanner URL

Railway will provide a service URL similar to:

```text
https://<railway-service>.up.railway.app/scan
```

Use the full `/scan` URL as `CLAMAV_SCANNER_ENDPOINT`.

## Vercel / Local App Configuration

Configure these values in Vercel and local `.env` when testing scanning:

```text
SCANNER_PROVIDER=clamav-http
CLAMAV_SCANNER_ENDPOINT=https://<railway-service>.up.railway.app/scan
CLAMAV_SCANNER_API_KEY=<secret>
```

`CLAMAV_SCANNER_WEBHOOK_SECRET` is not required for this minimal synchronous scanner.

## Definition Updates

The container runs `freshclam` during startup. For pilot UAT, redeploy or restart the Railway service regularly if it runs long-lived.

Production hardening can later add a scheduled `freshclam` refresh side process or split ClamAV into a dedicated scanner image. Until definitions are available and `clamd` accepts scans, the service fails closed with `failed`.

## Safe Test Procedure

Clean file:

1. Upload a harmless text file to the private R2 UAT bucket.
2. Send `POST /scan` with the file metadata and `Authorization: Bearer <SCANNER_API_KEY>`.
3. Expect `status: "clean"`.

EICAR:

1. Create the standard EICAR antivirus test file only in the approved UAT bucket/path.
2. Send `POST /scan` for that object.
3. Expect `status: "infected"` and signature `Eicar-Test-Signature`.
4. Delete the object immediately after the test.

Do not send real customer files to public malware-analysis services.

## Failure Behaviour

- Missing/invalid API key: HTTP 401.
- Invalid request shape: HTTP 400 with safe message.
- R2 fetch failure: provider-neutral `failed`.
- ClamAV unavailable: provider-neutral `failed`.
- Oversized file: provider-neutral `failed`.
- Timeout: provider-neutral `failed`.

No file body, R2 secret, scanner API key or object contents should appear in logs or responses.
