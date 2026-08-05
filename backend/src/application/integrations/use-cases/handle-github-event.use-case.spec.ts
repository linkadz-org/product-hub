import { createHmac } from 'crypto';
import type { IAppSettingsRepository } from '@application/app-settings/repositories/app-settings.repository';
import type { IIssueRepository } from '@application/issues/repositories/issue.repository';
import type { IRoadmapRepository } from '@application/roadmaps/repositories/roadmap.repository';
import type {
  ExistingLink,
  ICodeLinkRepository,
  UpsertCodeLinkData,
} from '../repositories/code-link.repository';
import { CodeLinkKind, CodeLinkMatchedBy, CodeLinkSubject, PullRequestState } from '../domain/github.types';
import { HandleGitHubEventUseCase } from './handle-github-event.use-case';

const TOKEN = 'workspace-url-token';
const SECRET = 'workspace-signing-secret';
const TENANT = 'tenant-1';
const REPO = 'acme/web';

const TASK_REF = 'TSK-6HCUHKX';
const TASK_ID = 'uuid-of-task';
const ITEM_REF = 'RM-4KQP2XZ';
const ITEM_ID = 'uuid-of-item';
const ROADMAP_ID = 'uuid-of-roadmap';

/**
 * The whole inbound path with hand-rolled repositories — no Nest container and no
 * Mongo. What's under test is everything between the bytes on the wire and the row
 * we'd store: auth, dispatch, ref → subject resolution, and the shape of the link.
 */
describe('HandleGitHubEventUseCase', () => {
  /** Builds the use-case over fakes, and hands back what the fakes recorded. */
  function build(opts: { enabled?: boolean; secret?: string } = {}) {
    const upserts: UpsertCodeLinkData[] = [];
    const deliveries: { repo: string; at: Date }[] = [];

    const settings = {
      tenantId: TENANT,
      github: {
        token: TOKEN,
        secret: opts.secret ?? SECRET,
        enabled: opts.enabled ?? true,
        connectedRepos: [] as string[],
        lastEventAt: null as Date | null,
        lastEventRepo: '',
      },
      recordGitHubDelivery: (repo: string, at: Date) => deliveries.push({ repo, at }),
    };

    const settingsRepo = {
      findByGitHubToken: (token: string) => Promise.resolve(token === TOKEN ? settings : null),
      save: () => Promise.resolve(settings),
    } as unknown as IAppSettingsRepository;

    const issues = {
      findByRef: (_tenantId: string, ref: string) =>
        Promise.resolve(ref === TASK_REF ? { id: { toString: () => TASK_ID } } : null),
    } as unknown as IIssueRepository;

    const roadmaps = {
      findItemByRef: (_tenantId: string, ref: string) =>
        Promise.resolve(ref === ITEM_REF ? { roadmapId: ROADMAP_ID, itemId: ITEM_ID } : null),
    } as unknown as IRoadmapRepository;

    /** The rows behind a set of links, one per subject — what the aggregation does. */
    const distinct = (rows: UpsertCodeLinkData[]) => {
      const seen = new Map<string, ExistingLink>();
      for (const r of rows) {
        if (!seen.has(r.subjectId)) {
          seen.set(r.subjectId, {
            subjectType: r.subjectType,
            subjectId: r.subjectId,
            roadmapId: r.roadmapId,
            matchedBy: r.matchedBy,
          });
        }
      }
      return Promise.resolve([...seen.values()]);
    };

    // A store rather than a log: a pull request now reads back the commits an
    // earlier delivery wrote, so collapsing on the unique key is part of what's
    // under test — not an implementation detail of Mongo.
    const links = {
      upsert: (data: UpsertCodeLinkData) => {
        const at = upserts.findIndex(
          (u) =>
            u.repo === data.repo &&
            u.kind === data.kind &&
            u.externalId === data.externalId &&
            u.subjectId === data.subjectId,
        );
        if (at >= 0) upserts[at] = data;
        else upserts.push(data);
        return Promise.resolve();
      },
      findSubjectsForBranch: (tenantId: string, repo: string, branch: string) =>
        !repo || !branch
          ? Promise.resolve([])
          : distinct(
              upserts.filter(
                (u) =>
                  u.tenantId === tenantId &&
                  u.repo === repo &&
                  u.branch === branch &&
                  u.kind === CodeLinkKind.COMMIT,
              ),
            ),
      findSubjectsForExternalId: (
        tenantId: string,
        repo: string,
        kind: CodeLinkKind,
        externalId: string,
      ) =>
        distinct(
          upserts.filter(
            (u) =>
              u.tenantId === tenantId &&
              u.repo === repo &&
              u.kind === kind &&
              u.externalId === externalId,
          ),
        ),
    } as unknown as ICodeLinkRepository;

    const usecase = new HandleGitHubEventUseCase(settingsRepo, issues, roadmaps, links);
    return { usecase, upserts, deliveries, settings };
  }

  /** Send a payload the way GitHub would — signed over the exact bytes. */
  const deliver = (
    usecase: HandleGitHubEventUseCase,
    event: string,
    payload: unknown,
    overrides: { token?: string; secret?: string } = {},
  ) => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const digest = createHmac('sha256', overrides.secret ?? SECRET).update(rawBody).digest('hex');
    return usecase.execute({
      token: overrides.token ?? TOKEN,
      event,
      signature: `sha256=${digest}`,
      rawBody,
      payload,
    });
  };

  const push = (commits: unknown[], ref = 'refs/heads/feature/login') => ({
    ref,
    deleted: false,
    repository: { full_name: REPO },
    commits,
  });

  const commit = (message: string, id = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2') => ({
    id,
    message,
    timestamp: '2026-08-05T09:00:00Z',
    url: `https://github.com/${REPO}/commit/${id}`,
    author: { name: 'Dat Tran', username: 'dattran' },
  });

  describe('authentication', () => {
    it('refuses a token no workspace owns', async () => {
      const { usecase } = build();
      const result = await deliver(usecase, 'ping', { repository: { full_name: REPO } }, {
        token: 'not-a-real-token',
      });
      expect(result.isFailure).toBe(true);
    });

    it('refuses a delivery signed with the wrong secret', async () => {
      const { usecase, upserts } = build();
      const result = await deliver(usecase, 'push', push([commit(`${TASK_REF} fix login`)]), {
        secret: 'guessed-secret',
      });
      expect(result.isFailure).toBe(true);
      expect(upserts).toHaveLength(0);
    });

    it('refuses a workspace that has disconnected, even with the old secret', async () => {
      const { usecase } = build({ enabled: false });
      const result = await deliver(usecase, 'ping', { repository: { full_name: REPO } });
      expect(result.isFailure).toBe(true);
    });
  });

  describe('ping', () => {
    it('accepts the setup ping and records the repo it came from', async () => {
      const { usecase, deliveries } = build();
      const result = await deliver(usecase, 'ping', { repository: { full_name: REPO } });
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().linked).toBe(0);
      // The proof Settings shows — "receiving from acme/web" — is stamped by a
      // ping, before any commit has ever been pushed.
      expect(deliveries).toEqual([{ repo: REPO, at: expect.any(Date) }]);
    });
  });

  describe('push', () => {
    it('links a commit whose message names a task', async () => {
      const { usecase, upserts } = build();
      const result = await deliver(usecase, 'push', push([commit(`${TASK_REF} fix login redirect`)]));

      expect(result.getValue().linked).toBe(1);
      expect(upserts).toHaveLength(1);
      expect(upserts[0]).toMatchObject({
        tenantId: TENANT,
        repo: REPO,
        kind: CodeLinkKind.COMMIT,
        subjectType: CodeLinkSubject.ISSUE,
        subjectId: TASK_ID,
        roadmapId: '',
        matchedBy: CodeLinkMatchedBy.MESSAGE,
        branch: 'feature/login',
        number: 0,
        state: '',
        title: `${TASK_REF} fix login redirect`,
        authorName: 'Dat Tran',
      });
      // The dedup key: GitHub retries deliveries, and the sha is what makes the
      // second attempt update the same row instead of adding another.
      expect(upserts[0].externalId).toBe(upserts[0].sha);
    });

    it('falls back to the branch name when the message says nothing', async () => {
      const { usecase, upserts } = build();
      await deliver(usecase, 'push', push([commit('wip')], `refs/heads/${TASK_REF}-fix-login`));

      expect(upserts).toHaveLength(1);
      expect(upserts[0]).toMatchObject({
        subjectId: TASK_ID,
        matchedBy: CodeLinkMatchedBy.BRANCH,
        branch: `${TASK_REF}-fix-login`,
      });
    });

    it('counts a ref named in both the message and the branch once', async () => {
      const { usecase, upserts } = build();
      await deliver(
        usecase,
        'push',
        push([commit(`${TASK_REF} fix login`)], `refs/heads/${TASK_REF}-fix-login`),
      );
      expect(upserts).toHaveLength(1);
      expect(upserts[0].matchedBy).toBe(CodeLinkMatchedBy.MESSAGE);
    });

    it('links a backlog item, carrying the roadmap it is embedded in', async () => {
      const { usecase, upserts } = build();
      await deliver(usecase, 'push', push([commit(`groundwork for ${ITEM_REF}`)]));

      expect(upserts).toHaveLength(1);
      expect(upserts[0]).toMatchObject({
        subjectType: CodeLinkSubject.ROADMAP_ITEM,
        subjectId: ITEM_ID,
        roadmapId: ROADMAP_ID,
      });
    });

    it('links one commit to every item it names', async () => {
      const { usecase, upserts } = build();
      await deliver(usecase, 'push', push([commit(`${TASK_REF} towards ${ITEM_REF}`)]));
      expect(upserts.map((u) => u.subjectId).sort()).toEqual([ITEM_ID, TASK_ID].sort());
    });

    it('shows only the subject line, even when the ref was in the body', async () => {
      const { usecase, upserts } = build();
      await deliver(usecase, 'push', push([commit(`fix login redirect\n\nFixes ${TASK_REF}`)]));

      expect(upserts).toHaveLength(1);
      expect(upserts[0].title).toBe('fix login redirect');
    });

    it('ignores a ref that names nothing in this workspace', async () => {
      const { usecase, upserts } = build();
      const result = await deliver(usecase, 'push', push([commit('TSK-ZZZZZZZ nothing here')]));
      // Accepted, not rejected: a non-2xx would make GitHub retry and eventually
      // disable the webhook over a typo in someone's commit message.
      expect(result.isSuccess).toBe(true);
      expect(upserts).toHaveLength(0);
    });

    it('ignores a tag push, which has no branch', async () => {
      const { usecase, upserts } = build();
      const result = await deliver(usecase, 'push', push([commit(`${TASK_REF} release`)], 'refs/tags/v1.2.0'));
      expect(result.isSuccess).toBe(true);
      expect(upserts).toHaveLength(0);
    });

    it('ignores a branch deletion, which replays commits already linked', async () => {
      const { usecase, upserts } = build();
      const payload = { ...push([commit(`${TASK_REF} fix login`)]), deleted: true };
      const result = await deliver(usecase, 'push', payload);
      expect(result.isSuccess).toBe(true);
      expect(upserts).toHaveLength(0);
    });
  });

  describe('pull_request', () => {
    const pullRequest = (pr: Record<string, unknown>) => ({
      action: 'opened',
      repository: { full_name: REPO },
      pull_request: {
        number: 42,
        title: `${TASK_REF} Fix login redirect`,
        body: '',
        state: 'open',
        html_url: `https://github.com/${REPO}/pull/42`,
        created_at: '2026-08-05T09:00:00Z',
        head: { ref: `${TASK_REF}-fix-login` },
        base: { ref: 'dev' },
        user: { login: 'dattran', avatar_url: 'https://avatars.example/dattran' },
        ...pr,
      },
    });

    it('links a pull request named in its title', async () => {
      const { usecase, upserts } = build();
      const result = await deliver(usecase, 'pull_request', pullRequest({}));

      expect(result.getValue().linked).toBe(1);
      expect(upserts[0]).toMatchObject({
        kind: CodeLinkKind.PULL_REQUEST,
        subjectId: TASK_ID,
        number: 42,
        sha: '',
        state: PullRequestState.OPEN,
        matchedBy: CodeLinkMatchedBy.TITLE,
        authorName: 'dattran',
        authorAvatarUrl: 'https://avatars.example/dattran',
      });
      // Keyed by number, not sha — so the same PR edited five times is one row.
      expect(upserts[0].externalId).toBe('pr-42');
    });

    it('reads merged, draft and closed out of GitHub’s three flags', async () => {
      const cases: [Record<string, unknown>, PullRequestState][] = [
        [{ state: 'closed', merged: true }, PullRequestState.MERGED],
        [{ state: 'closed', merged: false }, PullRequestState.CLOSED],
        [{ state: 'open', draft: true }, PullRequestState.DRAFT],
        [{ state: 'open', draft: false }, PullRequestState.OPEN],
      ];
      for (const [flags, expected] of cases) {
        const { usecase, upserts } = build();
        await deliver(usecase, 'pull_request', pullRequest(flags));
        expect(upserts[0].state).toBe(expected);
      }
    });

    it('falls back to the head branch when the title says nothing', async () => {
      const { usecase, upserts } = build();
      await deliver(usecase, 'pull_request', pullRequest({ title: 'Fix login redirect' }));
      expect(upserts[0]).toMatchObject({
        subjectId: TASK_ID,
        matchedBy: CodeLinkMatchedBy.BRANCH,
      });
    });

    it('reads a "Closes RM-…" line out of the description', async () => {
      const { usecase, upserts } = build();
      await deliver(
        usecase,
        'pull_request',
        pullRequest({ title: 'Groundwork', body: `Closes ${ITEM_REF}`, head: { ref: 'groundwork' } }),
      );
      expect(upserts[0]).toMatchObject({
        subjectType: CodeLinkSubject.ROADMAP_ITEM,
        subjectId: ITEM_ID,
        roadmapId: ROADMAP_ID,
      });
    });

    it('records the branch it merges into, and leaves it empty on a commit', async () => {
      const { usecase, upserts } = build();
      await deliver(usecase, 'push', push([commit(`${TASK_REF} fix login`)], 'refs/heads/dev-felix'));
      await deliver(usecase, 'pull_request', pullRequest({ head: { ref: 'dev-felix' } }));

      // The environment the work ships to — the thing the panel is answering.
      expect(upserts.find((u) => u.kind === CodeLinkKind.PULL_REQUEST)).toMatchObject({
        branch: 'dev-felix',
        baseBranch: 'dev',
      });
      // A commit has no target of its own: its branch already says where it is.
      expect(upserts.find((u) => u.kind === CodeLinkKind.COMMIT)).toMatchObject({
        branch: 'dev-felix',
        baseBranch: '',
      });
    });

    it('links a pull request whose own text says nothing, through its commits', async () => {
      const { usecase, upserts } = build();
      // The normal way to work: the ref is written once, in the commit, and the
      // pull request keeps whatever title GitHub suggested from the branch.
      await deliver(usecase, 'push', push([commit(`${TASK_REF} fix login`)], 'refs/heads/dev-felix'));
      const result = await deliver(
        usecase,
        'pull_request',
        pullRequest({ title: 'Dev felix', head: { ref: 'dev-felix' } }),
      );

      expect(result.getValue().linked).toBe(1);
      expect(upserts.find((u) => u.kind === CodeLinkKind.PULL_REQUEST)).toMatchObject({
        externalId: 'pr-42',
        subjectId: TASK_ID,
        matchedBy: CodeLinkMatchedBy.COMMIT,
      });
    });

    it('keeps a merged pull request current once its commits move to the base branch', async () => {
      const { usecase, upserts } = build();
      await deliver(usecase, 'push', push([commit(`${TASK_REF} fix login`)], 'refs/heads/dev-felix'));
      const open = pullRequest({ title: 'Dev felix', head: { ref: 'dev-felix' } });
      await deliver(usecase, 'pull_request', open);

      // Merging re-delivers the same commits under `dev`, so the head branch no
      // longer has them — and is usually deleted moments later.
      await deliver(usecase, 'push', push([commit(`${TASK_REF} fix login`)], 'refs/heads/dev'));
      await deliver(
        usecase,
        'pull_request',
        pullRequest({ title: 'Dev felix', head: { ref: 'dev-felix' }, state: 'closed', merged: true }),
      );

      const prs = upserts.filter((u) => u.kind === CodeLinkKind.PULL_REQUEST);
      expect(prs).toHaveLength(1);
      expect(prs[0].state).toBe(PullRequestState.MERGED);
    });

    it('stops standing in for the commits once a branch is evidently long-lived', async () => {
      /** `count` tasks already merged into `branch`, each by its own commit. */
      const seed = (upserts: UpsertCodeLinkData[], count: number, branch: string) => {
        for (let i = 0; i < count; i++) {
          upserts.push({
            tenantId: TENANT,
            subjectType: CodeLinkSubject.ISSUE,
            subjectId: `task-${i}`,
            roadmapId: '',
            kind: CodeLinkKind.COMMIT,
            repo: REPO,
            externalId: `sha-${i}`,
            sha: `sha-${i}`,
            number: 0,
            title: 'earlier work',
            branch,
            baseBranch: '',
            state: '',
            authorName: '',
            authorAvatarUrl: '',
            url: '',
            matchedBy: CodeLinkMatchedBy.MESSAGE,
            occurredAt: new Date('2026-08-01T00:00:00Z'),
          });
        }
      };
      const release = pullRequest({ title: 'Release', head: { ref: 'dev' }, base: { ref: 'main' } });

      const feature = build();
      seed(feature.upserts, 20, 'dev');
      expect((await deliver(feature.usecase, 'pull_request', release)).getValue().linked).toBe(20);

      // One more and it is a release branch, not one unit of work: a dev → main
      // pull request must not land on every task the workspace ever shipped.
      const longLived = build();
      seed(longLived.upserts, 21, 'dev');
      expect((await deliver(longLived.usecase, 'pull_request', release)).getValue().linked).toBe(0);
    });
  });

  it('accepts an event it does not handle rather than making GitHub retry', async () => {
    const { usecase, upserts } = build();
    const result = await deliver(usecase, 'issue_comment', { repository: { full_name: REPO } });
    expect(result.isSuccess).toBe(true);
    expect(result.getValue().message).toContain('issue_comment');
    expect(upserts).toHaveLength(0);
  });
});
