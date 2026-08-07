/**
 * Reaching the live editing session after the API has written a page body.
 *
 * A doc page body is co-edited through the collab server (Hocuspocus/Yjs). While
 * anyone has the page open, the Y.Doc in that room — not `docpages.content` — is
 * what they are looking at, and `collab/src/mirror.ts` writes the Y.Doc back over
 * the column on every store. So a write that only touched Mongo is silently
 * reverted the moment an open session stores: the caller was told it saved, and
 * it is gone.
 *
 * The collab server already solves this for version restore: `POST /reset?page=…`
 * re-reads the stored HTML into the live room as Yjs operations, which every
 * connected editor receives as an ordinary update. This port is how the API asks
 * for that, so a write made outside the editor (today: MCP `update_doc`) reaches
 * the people who are mid-sentence.
 */

/** What happened when we tried to refresh the live room. */
export type CollabResetStatus =
  /** The room was re-read from the stored body — everyone connected now sees it. */
  | 'refreshed'
  /** No collab server is configured for this deployment; there is no room to refresh. */
  | 'not-configured'
  /** The collab server is configured but did not accept or complete the refresh. */
  | 'failed';

export interface CollabResetResult {
  status: CollabResetStatus;
  /** Why it failed, for a caller that has to report it. Only set on `failed`. */
  error?: string;
}

export interface CollabResetRequest {
  tenantId: string;
  pageId: string;
  /** Who the write is attributed to — the collab server logs it like any editor. */
  userId: string;
  userName: string;
}

/**
 * Never throws and never rejects: the body write has already committed by the
 * time anyone calls this, so a refresh problem is something to *report*, not
 * something that can undo the write.
 */
export abstract class ICollabSync {
  resetPage: (request: CollabResetRequest) => Promise<CollabResetResult>;
}
