import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button, RichText, RichTextEditor, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t, type I18nKey } from '@/i18n';
import { timeAgo } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { htmlToPlainText, isRichHtml, mentionIdsFromHtml } from '@/lib/editorjs';
import type { CommentDto } from '@/types/dto';
import { Avatar } from '@/features/activity/Avatar';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
  type CommentSource,
} from '@/features/activity/api';
import { useMediaAttachments } from '@/features/uploads/useMediaAttachments';
import { AttachMediaButton, AttachmentStrip, CommentMedia } from '@/features/activity/CommentMedia';
import { useActivity } from '@/features/activity-log/api';
import { ActivityEntry, ActivityTruncatedNote } from '@/features/activity-log/ActivityEntry';

export interface Person {
  id: string;
  name: string;
  /** Optional: lets the `@` menu match on address as well as name. */
  email?: string;
}

/** "Activity" section title + the signed-in viewer's own avatar. */
export function ActivityHeader() {
  const { user } = useAuth();
  return (
    <div className="mb-5 flex items-center justify-between">
      <h2 className="text-xl font-bold tracking-tight">{t('activity.title')}</h2>
      {user && <Avatar name={user.name} className="size-7" />}
    </div>
  );
}

/** The section's two tabs. `history` prints as "Activity" — it holds the change
 *  log only; the conversation is next door under `comments`. */
type Tab = 'comments' | 'history';

/** Literal keys, never `` t(`activity.tab.${key}`) `` — a constructed key
 *  defeats the closed `I18nKey` union and turns a typo into a runtime blank.
 *  Same reasoning as `DocComments`' own tab map. */
const TAB_LABEL: Record<Tab, I18nKey> = {
  comments: 'activity.tab.comments',
  history: 'activity.tab.history',
};

export interface CommentThreadProps {
  /** Which thread these comments belong to — bug, task, or roadmap item. */
  source: CommentSource;
  /** People who can be @-mentioned in a comment. */
  users: Person[];
  canWrite: boolean;
  isAdmin: boolean;
  currentUserId?: string;
  /** When provided (a public read-only view), render these instead of fetching
   * the authed thread. */
  comments?: CommentDto[];
  /**
   * A row the caller owns that opens the change log — issue detail's
   * "{createdByName} created this task · 3d ago" line. It belongs to the history,
   * so it lives in the Activity tab rather than above both tabs; it stays the
   * caller's because a public viewer has no token to read the activity endpoint
   * with, and that one fact is on the issue itself.
   */
  activityLead?: ReactNode;
}

/**
 * The comment thread — the list of comments plus the composer. Shared verbatim
 * by bug, task, and roadmap-item detail so every thread reads and behaves the
 * same; the only difference is the `source` that routes its API calls and keys
 * its cache. Renders as a fragment so the caller controls the surrounding
 * spacing.
 *
 * Two tabs, not one merged stream: **Comments** (the conversation plus its
 * composer, and the tab you land on) and **Activity** (the change log, read
 * only). They used to interleave by time, which meant scrolling past a dozen
 * status changes to find a reply. The choice is deliberately not in the URL —
 * reopening an issue is a reading task, and reading starts at the conversation.
 */
export function CommentThread({
  source,
  users,
  canWrite,
  isAdmin,
  currentUserId,
  comments,
  activityLead,
}: CommentThreadProps) {
  const [tab, setTab] = useState<Tab>('comments');
  // A public viewer passes `comments` directly, so skip the authed fetch entirely.
  const { data: fetched } = useComments(source, comments === undefined);
  const thread = comments ?? fetched ?? [];

  // System events (status changes, edits, …). The backend records and guards
  // all three entity kinds, so a roadmap item's own history renders here too —
  // it is the same timeline, not a second renderer. A public viewer passes
  // `comments` and has no token for an authed request, so it fetches nothing;
  // `useActivity` disables itself on an empty id.
  const isIssueSource = source.kind === 'bug' || source.kind === 'task';
  const entity = isIssueSource ? 'issue' : 'roadmap_item';
  const historyId = comments === undefined ? source.id : '';
  // `undefined` on both loading and error — defaulting to `[]` here (rather
  // than guarding the whole component) is what keeps a failed history fetch
  // from blanking comments that already loaded fine.
  const { data: history } = useActivity(entity, historyId);
  // An issue's own creation is already shown as a timeline row above this
  // thread (`IssueDetailMain`'s "{createdByName} {createdLabel}" line), so drop
  // that ONE row — matched by entity id, so a *related* object's creation (a
  // subtask being added) still shows, which a blanket `field !== 'created'`
  // filter silently swallowed. A roadmap item has no such opening line, so its
  // own creation row is the only place that fact appears and stays.
  const events = (history?.items ?? []).filter(
    (e) => !(isIssueSource && e.field === 'created' && e.entityId === source.id),
  );

  // Fold the flat list into one-level threads: each top-level comment plus the
  // replies pointing at it. A reply whose parent isn't a known top-level comment
  // (e.g. the parent was deleted) starts its own thread, so a reply is never
  // dropped. `thread` is already sorted oldest-first, so both stay chronological.
  const rootIds = new Set(thread.filter((c) => !c.parentId).map((c) => c.id));
  const repliesByRoot = new Map<string, CommentDto[]>();
  const roots: CommentDto[] = [];
  for (const c of thread) {
    if (!c.parentId || !rootIds.has(c.parentId)) {
      roots.push(c);
    } else {
      const list = repliesByRoot.get(c.parentId);
      if (list) list.push(c);
      else repliesByRoot.set(c.parentId, [c]);
    }
  }

  // Replies are counted with the thread they answer, not beside it: "3" next to
  // Comments means three conversations to read, not three keystrokes someone made.
  const tabCount: Record<Tab, number> = { comments: roots.length, history: events.length };

  return (
    <>
      {/* Wraps rather than overflowing: on a ~320px screen a label plus its
          count can lose the line. Pill tabs, matching the docs comments rail. */}
      <div className="flex flex-wrap gap-1 border-b pb-2">
        {(['comments', 'history'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              tab === key
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t(TAB_LABEL[key])}
            <span className="tabular-nums opacity-70">{tabCount[key]}</span>
          </button>
        ))}
      </div>

      {tab === 'comments' ? (
        <>
          {roots.map((root) => (
            <CommentThreadCard
              key={root.id}
              source={source}
              root={root}
              replies={repliesByRoot.get(root.id) ?? []}
              users={users}
              canWrite={canWrite}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
            />
          ))}
          {canWrite && <CommentComposer source={source} users={users} variant="root" />}
        </>
      ) : (
        <>
          {/* Says so when the backend capped the related objects it folded in —
              a partial history that looks complete is worse than none. */}
          {history?.relatedTruncated && <ActivityTruncatedNote />}
          {activityLead}
          {events.map((e) => (
            <ActivityEntry key={e.id} entry={e} />
          ))}
          {!activityLead && events.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('activityLog.empty')}</p>
          )}
        </>
      )}
    </>
  );
}

/**
 * One thread: a top-level comment with its replies indented beneath it, rendered
 * open (no card) so the comments read as part of the timeline, followed by a
 * boxed "Leave a reply" composer. Only the composer is a bordered box — the
 * comments themselves are not — matching the reference Activity layout.
 */
function CommentThreadCard({
  source,
  root,
  replies,
  users,
  canWrite,
  isAdmin,
  currentUserId,
}: {
  source: CommentSource;
  root: CommentDto;
  replies: CommentDto[];
  users: Person[];
  canWrite: boolean;
  isAdmin: boolean;
  currentUserId?: string;
}) {
  const canEdit = (c: CommentDto) => canWrite && (c.authorId === currentUserId || isAdmin);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        <CommentItem source={source} comment={root} users={users} canEdit={canEdit(root)} />
        {replies.map((r) => (
          <CommentItem
            key={r.id}
            source={source}
            comment={r}
            users={users}
            canEdit={canEdit(r)}
            isReply
          />
        ))}
      </div>
      {canWrite && (
        <CommentComposer source={source} users={users} variant="reply" parentId={root.id} />
      )}
    </div>
  );
}

/** People in the shape the editor's `@` menu wants them. */
const asMentionable = (users: Person[]) =>
  users.map((u) => ({ id: u.id, name: u.name, email: u.email ?? '' }));

/**
 * The comment box: viewer's avatar, the block editor in its short-form mode
 * (formatting and `@` mentions, no headings or tables), drag / paste / pick media.
 * `root` is the standalone composer at the foot of the thread (posts a new
 * top-level comment); `reply` sits under a thread's comments and posts a reply to
 * that thread's `parentId`. Both are their own bordered box; the comments they
 * attach to are not.
 *
 * A reply's editor is only built once someone means to write in it — a long
 * thread list would otherwise mount one Editor.js per thread on page load.
 */
function CommentComposer({
  source,
  users,
  variant = 'root',
  parentId,
}: {
  source: CommentSource;
  users: Person[];
  variant?: 'root' | 'reply';
  parentId?: string;
}) {
  const { user } = useAuth();
  const create = useCreateComment(source);
  const [body, setBody] = useState('');
  // Editor.js reads its value at mount and owns the content after that, so
  // emptying the box after posting means handing it a new key.
  const [nonce, setNonce] = useState(0);
  const media = useMediaAttachments();
  const isReply = variant === 'reply';
  const [open, setOpen] = useState(!isReply);
  const placeholder = isReply ? t('activity.reply') : t('activity.placeholder');

  // Attaching, dropping or pasting a file into the collapsed row means "I'm
  // writing here" — without this the staged file has no send button to reach.
  useEffect(() => {
    if (media.items.length > 0) setOpen(true);
  }, [media.items.length]);

  // Formatting markup isn't content: an empty editor still emits `<p></p>`.
  const canPost = (!!htmlToPlainText(body).trim() || media.items.length > 0) && !media.busy;

  function post() {
    if (!canPost) return;
    create.mutate(
      {
        body: body.trim(),
        // Read back off the chips in the text, so deleting a chip drops its mention.
        mentions: mentionIdsFromHtml(body),
        images: media.urls,
        ...(parentId ? { parentId } : {}),
      },
      {
        onSuccess: () => {
          setBody('');
          setNonce((n) => n + 1);
          media.clear();
          if (isReply) setOpen(false);
        },
      },
    );
  }

  const editor = (
    <RichTextEditor
      key={nonce}
      value=""
      onChange={setBody}
      placeholder={placeholder}
      // Editor.js pads the bottom of the writing area by this much — a reply is
      // one line until it isn't, so it gets none.
      minHeight={isReply ? 0 : 24}
      minimal
      mentions
      people={asMentionable(users)}
      // The reply box was just opened by a click that meant "write here".
      autoFocus={isReply}
      className="rte-bare"
    />
  );
  const attachBtn = <AttachMediaButton onFiles={media.addFiles} disabled={media.busy} />;
  const sendBtn = (
    <button
      type="button"
      aria-label={isReply ? t('activity.replyAction') : t('activity.comment')}
      title={isReply ? t('activity.replyAction') : t('activity.comment')}
      disabled={!canPost || create.isPending}
      onClick={post}
      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {create.isPending ? <Spinner className="size-4" /> : <ArrowUp className="size-4" />}
    </button>
  );

  // Reply: a bordered box under a thread's comments — avatar · field · attach ·
  // send. Closed it's one row that reads like a field; open it grows to the
  // editor, with the actions dropping to their own row beneath it.
  if (isReply) {
    return (
      <div
        className={cn(
          'rounded-xl border bg-card px-4 py-2.5 transition-colors focus-within:border-primary',
          media.dragging && 'border-primary ring-2 ring-primary/30',
        )}
        {...media.dropHandlers}
      >
        <div className={cn('flex gap-3', open ? 'items-start' : 'items-center')}>
          {user && <Avatar name={user.name} className={open ? 'mt-0.5' : undefined} />}
          <div className="min-w-0 flex-1">
            {open ? (
              editor
            ) : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full py-0.5 text-left text-base text-muted-foreground"
              >
                {placeholder}
              </button>
            )}
          </div>
          {!open && attachBtn}
        </div>
        <AttachmentStrip
          items={media.items}
          tasks={media.tasks}
          onRemove={media.remove}
          onDismissTask={media.dismissUpload}
          className="mt-2 pl-9"
        />
        {open && (
          <div className="mt-1 flex items-center justify-end gap-1">
            {media.dragging && (
              <span className="mr-auto truncate text-xs text-muted-foreground">
                {t('activity.dropHint')}
              </span>
            )}
            {attachBtn}
            {sendBtn}
          </div>
        )}
      </div>
    );
  }

  // Root: the standalone composer at the foot of the thread — a taller, avatar-less
  // box with the actions pinned to the bottom-right.
  return (
    <div
      className={cn(
        'rounded-xl border bg-card px-4 py-3 shadow-sm transition-colors focus-within:border-primary',
        media.dragging && 'border-primary ring-2 ring-primary/30',
      )}
      {...media.dropHandlers}
    >
      {editor}
      <AttachmentStrip
        items={media.items}
        tasks={media.tasks}
        onRemove={media.remove}
        onDismissTask={media.dismissUpload}
        className="mt-2"
      />
      <div className="mt-1 flex items-center justify-end gap-1">
        {media.dragging && (
          <span className="mr-auto truncate text-xs text-muted-foreground">{t('activity.dropHint')}</span>
        )}
        {attachBtn}
        {sendBtn}
      </div>
    </div>
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A stored body as the editor wants it. Comments were plain text long before they
 * had an editor, so an old one is escaped and split a paragraph per line — feeding
 * it through as-is would swallow its line breaks and read `<` as markup.
 */
export function toEditorValue(body: string): string {
  if (isRichHtml(body)) return body;
  return body
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p></p>'))
    .join('');
}

/**
 * One comment inside a thread card — avatar, inline edit / delete, and any media.
 * The surrounding card owns the border; a reply gets a top divider and is
 * indented under its parent.
 */
function CommentItem({
  source,
  comment,
  users,
  canEdit,
  isReply,
}: {
  source: CommentSource;
  comment: CommentDto;
  users: Person[];
  canEdit: boolean;
  isReply?: boolean;
}) {
  // Both the draft and the editor start from the same value, so "unchanged"
  // compares like with like even for a comment that was stored as plain text.
  const editorValue = toEditorValue(comment.body);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editorValue);
  const update = useUpdateComment(source);
  const remove = useDeleteComment(source);
  const edited = comment.updatedAt && comment.updatedAt !== comment.createdAt;

  function saveEdit() {
    const body = draft.trim();
    // Nothing typed, or nothing changed — close rather than write an empty comment.
    if (!htmlToPlainText(body).trim() || body === editorValue.trim()) {
      setEditing(false);
      return;
    }
    update.mutate(
      { commentId: comment.id, input: { body, mentions: mentionIdsFromHtml(body) } },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <div className={cn('group', isReply && 'mt-3 border-t pt-3')}>
      <div className="mb-1.5 flex items-center gap-3">
        <Avatar name={comment.authorName} />
        <span className="text-sm font-semibold">{comment.authorName}</span>
        <span className="text-sm text-muted-foreground">
          {timeAgo(comment.createdAt)}
          {edited && ` (${t('activity.edited')})`}
        </span>
        {canEdit && !editing && (
          <span className="ml-auto flex gap-2.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDraft(editorValue);
                setEditing(true);
              }}
            >
              {t('common.edit')}
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() => confirm(t('activity.confirmDelete')) && remove.mutate(comment.id)}
            >
              {t('common.delete')}
            </button>
          </span>
        )}
      </div>
      {/* A reply's body is indented to sit under the author name (the avatar and
          header stay aligned with the parent), giving the nested-reply read. */}
      <div className={cn(isReply && 'pl-9')}>
        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="rounded-xl border bg-card px-4 py-3 transition-colors focus-within:border-primary">
              <RichTextEditor
                value={editorValue}
                onChange={setDraft}
                minHeight={44}
                minimal
                mentions
                people={asMentionable(users)}
                autoFocus
                className="rte-bare"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={saveEdit} loading={update.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* A long comment scrolls in place instead of pushing the rest of the
                thread off the screen. The cap is generous, so an ordinary comment
                never scrolls — and `overflow-y-auto` makes the other axis auto
                too, so a wide table or an unbroken URL scrolls rather than
                bleeding out of the column. Media stays outside: its thumbnails
                are already capped and wrap on their own. */}
            <div className="max-h-96 overflow-y-auto">
              {/* Comments written before the editor existed are plain text, and
                  would lose their line breaks rendered as markup. */}
              {isRichHtml(comment.body) ? (
                <RichText className="text-base text-foreground" html={comment.body} />
              ) : (
                <p className="whitespace-pre-wrap text-base text-foreground">{comment.body}</p>
              )}
            </div>
            <CommentMedia urls={comment.images} />
          </>
        )}
      </div>
    </div>
  );
}
