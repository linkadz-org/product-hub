import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Result of a successful upload — the stored file's public URL + metadata. */
export interface UploadedMedia {
  url: string;
  name: string;
  contentType: string;
  size: number;
}

/**
 * Called as the bytes go up, with 0–100. Fires once with `0` before the first
 * byte, so a caller can show the bar immediately rather than after the first
 * chunk lands — a big video otherwise looks frozen for its first second.
 *
 * Note it measures the *upload*, not the round trip: it reaches 100 when the
 * last byte leaves the browser, while the server is still storing the file. So
 * treat 100 as "sent, finishing" — the promise resolving is what means done.
 */
export type UploadProgressFn = (percent: number) => void;

/**
 * Upload one image or short video to the workspace's configured storage and get
 * back its public URL. Plain async (not a hook) so it works anywhere — including
 * the rich-text editor's image tool. Multipart; axios sets the boundary. Errors
 * surface the API message (e.g. "Video is too large — the limit is 30MB.").
 *
 * Pass `onProgress` to drive a progress bar, and `signal` to let it be cancelled
 * mid-flight. Without either nothing changes — every existing call site is a
 * plain `uploadMedia(file)`.
 */
export async function uploadMedia(
  file: File,
  onProgress?: UploadProgressFn,
  signal?: AbortSignal,
): Promise<UploadedMedia> {
  const body = new FormData();
  body.append('file', file);
  onProgress?.(0);
  const res = await api.post('/uploads', body, {
    signal,
    onUploadProgress: onProgress
      ? (e) => {
          // `total` is absent on some proxies/browsers; without it there's no
          // percentage to report, so leave the bar where it is rather than
          // jumping it to a number we made up.
          if (!e.total) return;
          onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        }
      : undefined,
  });
  return res.data.data as UploadedMedia;
}

/** Mutation wrapper for components that want pending/error state. */
export function useUploadMedia() {
  // Wrapped, not passed straight through: TanStack hands the mutation function a
  // context object as its second argument, which would land in `onProgress`.
  return useMutation({ mutationFn: (file: File) => uploadMedia(file) });
}
