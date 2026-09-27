const MAX_SIDE = 1024;

/**
 * Downloads a page image (the extension's host permission avoids CORS) and returns a downscaled
 * JPEG data URL, small enough for the API. Null when the image can't be read.
 */
export async function toDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src, { credentials: 'include' }); // LMS images often need the login cookie
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // transparent PNGs → white, not black, in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
