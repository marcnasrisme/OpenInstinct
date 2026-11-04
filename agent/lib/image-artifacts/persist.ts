import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import {
  finalizeBrowserImageArtifact,
  type BrowserImageArtifactReservation,
} from "@db/services/browser-images";
import {
  maximumBrowserImageBytes,
  sniffBrowserImageMediaType,
} from "@shared/browser/artifact";
import { env } from "@shared/environment";
import type { AccessScope } from "@shared/identity/access-scope";

// Stores image bytes in private Blob storage and marks the reserved artifact
// ready, for browser captures and for images the assistant renders itself.
export async function persistImageArtifact(
  scope: AccessScope,
  reservation: BrowserImageArtifactReservation,
  input: {
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly sourceKind: string;
  },
  signal?: AbortSignal
) {
  const mediaType = sniffBrowserImageMediaType(input.bytes);
  if (!mediaType) throw new Error("The image is not a supported image type.");
  const contentHash = createHash("sha256").update(input.bytes).digest("hex");
  const storagePathname = `${reservation.storagePathname}/${contentHash}`;
  if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Image storage is not configured.");
  }

  await put(storagePathname, Buffer.from(input.bytes), {
    access: "private",
    abortSignal: signal,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 30 * 24 * 60 * 60,
    contentType: mediaType,
    maximumSizeInBytes: maximumBrowserImageBytes,
  });
  try {
    const finalized = await finalizeBrowserImageArtifact(scope, reservation, {
      byteSize: input.bytes.byteLength,
      contentHash,
      filename: input.filename,
      mediaType,
      sourceKind: input.sourceKind,
      storagePathname,
    });
    if (finalized.storagePathname !== storagePathname) {
      await del(storagePathname).catch(() => undefined);
    }
    return finalized.image;
  } catch (error) {
    await del(storagePathname).catch(() => undefined);
    throw error;
  }
}

export function safeImageFilename(
  label: string,
  mediaType: NonNullable<ReturnType<typeof sniffBrowserImageMediaType>>
) {
  const extension = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[mediaType];
  const stem = label
    .normalize("NFKD")
    .replace(/(?:\.\.[/\\])+/gu, "")
    .replace(/\p{Cc}+/gu, "")
    .replace(/[^\p{L}\p{N}._() -]+/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\.+|\.+$/gu, "")
    .slice(0, 160);
  return `${stem || "browser-image"}.${extension}`;
}
