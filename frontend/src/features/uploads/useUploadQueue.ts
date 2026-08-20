import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { uploadMedia, type UploadedMedia } from './api';

/** One file on its way up — what a progress row is drawn from. */
export interface UploadTask {
  /** Stable across the task's life; the React key and the dismiss handle. */
  id: string;
  name: string;
  /** Bytes, for the "2.4 MB" beside the bar. */
  size: number;
  /** 0–100. Stays at 0 until the first chunk is acknowledged. */
  percent: number;
  status: 'queued' | 'uploading' | 'error';
  /** The API's message, on a failed task ("Video is too large — the limit is 30MB."). */
  error?: string;
}

/**
 * The upload loop every media surface shares: hand it files, it uploads them one
 * at a time and exposes a live task per file — name, percent, and the API's own
 * message if one fails.
 *
 * Sequential on purpose (it always was): a browser only gets so much upstream
 * bandwidth, and four videos racing means four bars crawling at a quarter speed
 * each, none of them finishing. It also means one rejected file doesn't cancel
 * the rest of the batch.
 *
 * A finished task **disappears** — whatever the caller does with the result (a
 * thumbnail, a block, a row in a list) is the confirmation, and a completed bar
 * lingering under it is a second one saying nothing new. A **failed** task stays
 * until dismissed: it's the only place its reason is written down, and until this
 * existed a rejected upload showed as a toast that had already gone by the time
 * you looked back at the composer wondering where your file went.
 */
/** What {@link useUploadQueue} hands back — the type to pass a queue around by. */
export type UploadQueue = ReturnType<typeof useUploadQueue>;

export function useUploadQueue() {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const seq = useRef(0);
  // One controller per in-flight task, so dismissing a row that's still going up
  // actually stops it rather than just hiding a transfer that keeps running.
  const aborts = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, next: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...next } : task)));
  }, []);

  const dismiss = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    aborts.current.delete(id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);

  // Navigating away mid-upload stops the transfer rather than leaving it pushing
  // bytes for a screen that no longer exists.
  useEffect(() => {
    const inFlight = aborts.current;
    return () => {
      inFlight.forEach((controller) => controller.abort());
      inFlight.clear();
    };
  }, []);

  /** Drop every failed row — for a composer that just posted, or a re-pick. */
  const clearErrors = useCallback(() => {
    setTasks((prev) => prev.filter((task) => task.status !== 'error'));
  }, []);

  /**
   * Upload each file in order. Resolves with everything that made it — a batch
   * where some files failed still resolves, with the survivors.
   *
   * `onEach` fires per successful file, as it lands.
   */
  const upload = useCallback(
    async (files: File[], onEach?: (media: UploadedMedia) => void): Promise<UploadedMedia[]> => {
      if (files.length === 0) return [];
      // Queue every file up front, so a batch reads as "4 files, this is #2"
      // rather than one row appearing and vanishing four times over.
      const queued = files.map((file) => {
        const id = `u${(seq.current += 1)}`;
        return {
          file,
          task: { id, name: file.name, size: file.size, percent: 0, status: 'queued' as const },
        };
      });
      // A new batch clears the last one's failures — they've been read, and the
      // user is evidently having another go.
      setTasks((prev) => [
        ...prev.filter((task) => task.status !== 'error'),
        ...queued.map((q) => q.task),
      ]);

      const done: UploadedMedia[] = [];
      for (const { task, file } of queued) {
        const controller = new AbortController();
        aborts.current.set(task.id, controller);
        patch(task.id, { status: 'uploading' });
        try {
          const media = await uploadMedia(
            file,
            (percent) => patch(task.id, { percent }),
            controller.signal,
          );
          done.push(media);
          onEach?.(media);
          dismiss(task.id);
        } catch (e) {
          // A cancel is the user's own doing — its row is already gone, and
          // turning it into a red "failed" would read as something going wrong.
          if (controller.signal.aborted) continue;
          patch(task.id, {
            status: 'error',
            error: (e as Error).message || t('uploads.failed'),
          });
        } finally {
          aborts.current.delete(task.id);
        }
      }
      return done;
    },
    [dismiss, patch],
  );

  return {
    tasks,
    upload,
    dismiss,
    clearErrors,
    /** True while anything is still going up — for disabling Post / the picker. */
    busy: tasks.some((task) => task.status === 'queued' || task.status === 'uploading'),
    /** True when at least one file in the last batch was rejected. */
    failed: tasks.some((task) => task.status === 'error'),
  };
}
