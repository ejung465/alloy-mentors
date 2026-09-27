// Shrinks a picked photo before upload. A raw phone photo is 2–4 MB; the
// free Supabase tier has 1 GB of storage and 5 GB/month of egress, so
// uploading originals would exhaust it after a few hundred chat images.
// Resizing also converts HEIC → JPEG, which Android can't display.
//
// Loaded lazily (same pattern as expo-image-picker in chat.tsx) so an older
// dev-client without the native module falls back to the original file
// instead of crashing.

type ManipulatorModule = typeof import('expo-image-manipulator');
let _manipulator: ManipulatorModule | null | undefined;
function getManipulator(): ManipulatorModule | null {
  if (_manipulator !== undefined) return _manipulator;
  try {
    _manipulator = require('expo-image-manipulator') as ManipulatorModule;
  } catch {
    _manipulator = null;
  }
  return _manipulator;
}

/**
 * Returns a JPEG uri whose longest side is at most `maxDim` px. Falls back to
 * the original uri if the manipulator is unavailable or fails — an oversized
 * upload is better than a failed one.
 */
export async function shrinkImage(
  uri: string,
  opts: { width?: number; height?: number; maxDim?: number; quality?: number } = {},
): Promise<{ uri: string; ext: string }> {
  const { width, height, maxDim = 1600, quality = 0.7 } = opts;
  const originalExt = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const M = getManipulator();
  if (!M) return { uri, ext: originalExt };
  try {
    // Only downscale; if dimensions are unknown, constrain the width.
    const actions: any[] = [];
    if (width && height) {
      if (Math.max(width, height) > maxDim) {
        actions.push({ resize: width >= height ? { width: maxDim } : { height: maxDim } });
      }
    } else {
      actions.push({ resize: { width: maxDim } });
    }
    const out = await M.manipulateAsync(uri, actions, { compress: quality, format: M.SaveFormat.JPEG });
    return { uri: out.uri, ext: 'jpg' };
  } catch (e: any) {
    console.warn('[shrinkImage] failed, uploading original:', e?.message);
    return { uri, ext: originalExt };
  }
}
