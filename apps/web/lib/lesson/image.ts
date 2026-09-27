import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface LoadedImage {
  dataUrl: string;
  hash: string;
}

export class ImageError extends Error {}

/**
 * Accepts a data: URL or a public https: URL, returns the image as a data URL (providers don't all
 * fetch remote URLs) and its sha256 (cache key). Remote fetches are restricted to public hostnames.
 */
export async function loadImage(input: string): Promise<LoadedImage> {
  let type: string;
  let bytes: Buffer;

  const data = input.match(/^data:([\w/+.-]+);base64,([\s\S]+)$/);
  if (data) {
    type = data[1]!.toLowerCase();
    bytes = Buffer.from(data[2]!, "base64");
  } else {
    const url = safeUrl(input);
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Kalima/1.0 (accessibility learning assistant)" },
    });
    if (!res.ok) throw new ImageError(`image fetch failed: HTTP ${res.status}`);
    type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new ImageError("image too large");
    bytes = Buffer.from(await res.arrayBuffer());
  }

  if (!TYPES.has(type)) throw new ImageError(`unsupported image type: ${type || "unknown"}`);
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new ImageError("image empty or too large");
  return {
    dataUrl: `data:${type};base64,${bytes.toString("base64")}`,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

function safeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ImageError("invalid image URL");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const internal =
    url.protocol !== "https:" ||
    isIP(host) !== 0 ||
    host === "localhost" ||
    !host.includes(".") ||
    /\.(local|internal|localhost|lan|home|corp)$/.test(host);
  if (internal) throw new ImageError("only public https image URLs are allowed");
  return url;
}
