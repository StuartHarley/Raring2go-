import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import { assertSafeStorageKey } from "@raring2go/storage";

// Development-only local disk backend for the "development" StorageProvider
// (packages/storage/src/index.ts::createDevelopmentStorageProvider), whose
// upload/download URLs point at this route. Not used in production — R2 or a
// signed-url backend replaces it there (STORAGE_PROVIDER env var).
const STORAGE_ROOT = join(tmpdir(), "raring2go-dev-storage");

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

function resolveStorageKey(pathSegments: string[]): { action: "upload" | "download"; storageKey: string; filePath: string } {
  const [action, ...keyParts] = pathSegments;

  if (action !== "upload" && action !== "download") {
    throw new Error("Unknown development storage action.");
  }

  const storageKey = decodeURIComponent(keyParts.join("/"));
  assertSafeStorageKey(storageKey);

  return { action, storageKey, filePath: join(STORAGE_ROOT, storageKey) };
}

export async function PUT(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { action, filePath } = resolveStorageKey((await params).path);

  if (action !== "upload") {
    return NextResponse.json({ error: "Use PUT on the upload path." }, { status: 405 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);

  return NextResponse.json({ ok: true });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { action, storageKey, filePath } = resolveStorageKey((await params).path);

  if (action !== "download") {
    return NextResponse.json({ error: "Use GET on the download path." }, { status: 405 });
  }

  try {
    const bytes = await readFile(filePath);
    const contentType = CONTENT_TYPES[extname(storageKey).toLowerCase()] ?? "application/octet-stream";

    return new NextResponse(bytes, { headers: { "content-type": contentType } });
  } catch {
    return NextResponse.json({ error: "File not found in development storage." }, { status: 404 });
  }
}
