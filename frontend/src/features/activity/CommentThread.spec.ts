// The Activity section's two tabs, rendered for real and clicked for real.
//
// The whole point of the split is *exclusion* — Comments must not show change
// rows, Activity must not show comments — so every assertion here is paired with
// its negative. A test that only checked "the Comments tab shows the comment"
// would have passed against the old merged stream, which showed everything at
// once; each `not.toContain` below is what actually pins the change.
//
// Rendered with react-dom/client into happy-dom (this repo has no
// @testing-library/react) and written with `createElement` rather than JSX so it
// stays a `.spec.ts` and is picked up by the existing `src/**/*.spec.ts` include.
//
// The data hooks are mocked: they are react-query calls needing a provider and a
// network, and none of them is what this file is about.
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const COMMENT_BODY = 'Reproduced on staging';
const REPLY_BODY = 'Nice find';

const comments = [
  {
    id: 'c1',
    body: COMMENT_BODY,
    authorId: 'u1',
    authorName: 'Felix',
    createdAt: '2026-08-02T10:00:00Z',
    updatedAt: '2026-08-02T10:00:00Z',
    images: [],
  },
  {
    id: 'c2',
    body: REPLY_BODY,
    parentId: 'c1',
    authorId: 'u2',
    authorName: 'Lucas',
    createdAt: '2026-08-02T11:00:00Z',
    updatedAt: '2026-08-02T11:00:00Z',
    images: [],
  },
];

const events = [
  {
    id: 'a1',
    entity: 'issue',
    entityId: 'i1',
    entityRef: 'QC-10',
    field: 'status',
    oldValue: 'Backlog',
    newValue: 'Done',
    actorType: 'user',
    actorId: 'u1',
    actorName: 'Felix',
    automated: false,
    createdAt: '2026-08-02T09:00:00Z',
    relationLabel: '',
  },
];

/** The sentence `ActivityEntry` renders for the event above, in English. */
const EVENT_TEXT = 'changed status';

/** Visible text with every space dropped: the rows are built from adjacent
 *  spans, so `textContent` runs their words together and a spaced needle would
 *  never match. Comparing both sides squashed keeps the needles readable. */
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Me' }, isAdmin: false }),
}));

vi.mock('@/features/activity/api', () => ({
  useComments: () => ({ data: comments }),
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/activity-log/api', () => ({
  useActivity: () => ({ data: { items: events, relatedTruncated: false } }),
}));

// Editor.js owns real DOM and a mount lifecycle happy-dom has no reason to
// survive; the composer's *presence* is what these tests assert, not its innards.
vi.mock('@/components/ui', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  RichTextEditor: ({ placeholder }: { placeholder?: string }) =>
    createElement('div', { 'data-editor': '' }, placeholder ?? ''),
}));

vi.mock('@/features/uploads/useMediaAttachments', () => ({
  useMediaAttachments: () => ({
    items: [],
    urls: [],
    busy: false,
    dragging: false,
    dropHandlers: {},
    addFiles: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  }),
}));

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;

/** Mount the thread and hand back the live container plus a click helper. */
async function mount(props: Record<string, unknown> = {}) {
  const { CommentThread } = await import('./CommentThread');
  await act(async () => {
    root.render(
      createElement(CommentThread, {
        source: { kind: 'task', id: 'i1' },
        users: [],
        canWrite: true,
        isAdmin: false,
        currentUserId: 'u1',
        ...props,
      } as never),
    );
  });
  return host;
}

/** The tab button whose visible label starts with `label`. */
function tab(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').trim().startsWith(label),
  );
  if (!found) throw new Error(`no tab labelled "${label}" — buttons: ${
    [...host.querySelectorAll('button')].map((b) => b.textContent).join(' | ')
  }`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('CommentThread — Comments / Activity tabs', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem('ph_locale', 'en');
    vi.resetModules();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  });

  // Fails against the merged stream: it showed the change row here too.
  it('opens on Comments, showing comments and NOT change rows', async () => {
    const el = await mount();
    expect(squash(el.textContent)).toContain(squash(COMMENT_BODY));
    expect(squash(el.textContent)).toContain(squash(REPLY_BODY));
    expect(squash(el.textContent)).not.toContain(squash(EVENT_TEXT));
    expect(squash(el.textContent)).not.toContain(squash('Backlog'));
    // Comments is the tab you land on, not Activity.
    expect(tab('Comments').getAttribute('aria-pressed')).toBe('true');
    expect(tab('Activity').getAttribute('aria-pressed')).toBe('false');
  });

  // Fails against the merged stream twice over: there is no Activity tab to
  // click, and the comment stayed on screen when there was.
  it('shows change rows and NOT comments on Activity', async () => {
    const el = await mount();
    await click(tab('Activity'));
    expect(squash(el.textContent)).toContain(squash(EVENT_TEXT));
    expect(squash(el.textContent)).toContain(squash('Backlog'));
    expect(squash(el.textContent)).not.toContain(squash(COMMENT_BODY));
    expect(squash(el.textContent)).not.toContain(squash(REPLY_BODY));
  });

  // The composer is the Comments tab's; Activity is a log, and a log is read-only.
  it('puts the composer in Comments only', async () => {
    const el = await mount();
    const composers = () => el.querySelectorAll('[data-editor]').length;
    expect(composers()).toBeGreaterThan(0);
    await click(tab('Activity'));
    expect(composers()).toBe(0);
    await click(tab('Comments'));
    expect(composers()).toBeGreaterThan(0);
  });

  // A reply is part of the conversation it answers, not a second one: two
  // comments, one of them a reply, must read as "1".
  it('counts root comments and loaded history rows', async () => {
    await mount();
    expect(squash(tab('Comments').textContent)).toBe('Comments1');
    expect(squash(tab('Activity').textContent)).toBe('Activity1');
  });

  // The issue's "created this task" line is history, so it belongs behind the
  // Activity tab — never on top of the conversation.
  it('keeps the caller’s creation row in Activity only', async () => {
    const lead: ReactNode = createElement('div', null, 'Felix created this task');
    const el = await mount({ activityLead: lead });
    expect(squash(el.textContent)).not.toContain(squash('created this task'));
    await click(tab('Activity'));
    expect(squash(el.textContent)).toContain(squash('created this task'));
  });
});
