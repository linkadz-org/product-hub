import { Inject, Injectable, Logger } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { IAppSettingsRepository } from '@application/app-settings/repositories/app-settings.repository';
import { IIssueRepository } from '@application/issues/repositories/issue.repository';
import { IRoadmapRepository } from '@application/roadmaps/repositories/roadmap.repository';
import {
  ExistingLink,
  ICodeLinkRepository,
  UpsertCodeLinkData,
} from '../repositories/code-link.repository';
import { ParsedRef, parseRefs } from '../domain/issue-ref.parser';
import { verifyGitHubSignature } from '../domain/github-signature';
import {
  CodeLinkKind,
  CodeLinkMatchedBy,
  CodeLinkSubject,
  PullRequestState,
  pullRequestState,
} from '../domain/github.types';
import {
  GitHubEvent,
  GitHubPullRequestPayload,
  GitHubPushPayload,
  branchFromRef,
  commitSubject,
} from '../domain/github-payload.types';

export interface HandleGitHubEventRequest {
  /** The opaque workspace token from the webhook path. */
  token: string;
  /** `X-GitHub-Event`. */
  event: string;
  /** `X-Hub-Signature-256`. */
  signature: string | undefined;
  /** The untouched request body — what the signature was computed over. */
  rawBody: Buffer | undefined;
  payload: unknown;
}

export interface HandleGitHubEventResponse {
  /** Human-readable outcome. GitHub shows it in the delivery log, which is the
   *  first place anyone debugging a silent integration will look. */
  message: string;
  /** How many links this delivery created or refreshed. */
  linked: number;
}

/** A ref found in a payload, with the reason it was found. */
interface RefHit extends ParsedRef {
  matchedBy: CodeLinkMatchedBy;
}

/** Where a resolved ref points, in storage terms. */
interface SubjectLocation {
  subjectId: string;
  roadmapId: string;
}

/** A resolved place to write a link, and the reason it's being written there. */
type LinkTarget = ExistingLink;

/**
 * How many distinct items a branch may already touch before its commits stop
 * standing in for a pull request's contents.
 *
 * The rule below — "a PR contains the work that was pushed to its head branch" —
 * holds for a feature branch and breaks for a long-lived one. A release PR from
 * `dev` into `main` has every task ever merged to `dev` behind it, and attaching
 * that PR to two hundred tasks at once is noise, not information. Past this, the
 * branch is evidently not one unit of work and only the PR's own text counts.
 */
const MAX_BRANCH_SUBJECTS = 20;

/** Refs from a primary source, then a fallback, without duplicates. */
function refHits(
  primary: { texts: (string | undefined)[]; matchedBy: CodeLinkMatchedBy },
  fallback: { texts: (string | undefined)[]; matchedBy: CodeLinkMatchedBy },
): RefHit[] {
  const first = parseRefs(...primary.texts);
  const hits: RefHit[] = first.map((r) => ({ ...r, matchedBy: primary.matchedBy }));
  for (const r of parseRefs(...fallback.texts)) {
    // A branch named for an issue *and* a message naming it is one link, and it's
    // the message that says what the author meant by it.
    if (!first.some((f) => f.ref === r.ref)) hits.push({ ...r, matchedBy: fallback.matchedBy });
  }
  return hits;
}

/**
 * Turns an inbound GitHub webhook into links on tasks, bugs and backlog items.
 *
 * Everything hangs off two secrets: the token in the URL says which workspace
 * this is, and the HMAC secret proves GitHub sent it. Neither is optional — with
 * only the first, anyone who saw the URL could write into a workspace.
 *
 * Failure is quiet by design. An unparsable payload, a ref pointing at something
 * deleted, an event we don't handle — all end in an accepted 200 whose message
 * says what happened, because a non-2xx teaches GitHub to retry and eventually
 * disables the webhook. The two exceptions are a bad token and a bad signature:
 * there, the caller is genuinely wrong and has to be told.
 */
@Injectable()
export class HandleGitHubEventUseCase
  implements IUsecaseExecute<HandleGitHubEventRequest, Result<HandleGitHubEventResponse>>
{
  private readonly logger = new Logger(HandleGitHubEventUseCase.name);

  constructor(
    @Inject(IAppSettingsRepository) private readonly settings: IAppSettingsRepository,
    @Inject(IIssueRepository) private readonly issues: IIssueRepository,
    @Inject(IRoadmapRepository) private readonly roadmaps: IRoadmapRepository,
    @Inject(ICodeLinkRepository) private readonly links: ICodeLinkRepository,
  ) {}

  async execute(req: HandleGitHubEventRequest): Promise<Result<HandleGitHubEventResponse>> {
    const settings = await this.settings.findByGitHubToken(req.token);
    if (!settings) return Result.fail('Unknown webhook URL for this workspace');

    const connection = settings.github;
    if (!connection.enabled) return Result.fail('This workspace has disconnected GitHub');
    if (!verifyGitHubSignature(req.rawBody, connection.secret, req.signature)) {
      // Almost always a mistyped secret in the GitHub form rather than an attack,
      // so the message names the field to go and fix.
      return Result.fail('Signature mismatch — check the Secret field on the GitHub webhook');
    }

    const repo = this.repoOf(req.payload);
    // Stamped for every verified delivery, including ones we take no action on:
    // "we are receiving from this repo" is exactly what a ping is for.
    settings.recordGitHubDelivery(repo, new Date());
    await this.settings.save(settings);

    const tenantId = settings.tenantId;
    switch (req.event) {
      case GitHubEvent.PING:
        return Result.ok({ message: `Connected to ${repo || 'GitHub'}`, linked: 0 });
      case GitHubEvent.PUSH:
        return Result.ok(await this.handlePush(tenantId, repo, req.payload as GitHubPushPayload));
      case GitHubEvent.PULL_REQUEST:
        return Result.ok(
          await this.handlePullRequest(tenantId, repo, req.payload as GitHubPullRequestPayload),
        );
      default:
        return Result.ok({ message: `Ignored event "${req.event}"`, linked: 0 });
    }
  }

  private repoOf(payload: unknown): string {
    return (payload as { repository?: { full_name?: string } })?.repository?.full_name ?? '';
  }

  private async handlePush(
    tenantId: string,
    repo: string,
    payload: GitHubPushPayload,
  ): Promise<HandleGitHubEventResponse> {
    // A branch deletion replays commits that are already linked, and a tag push
    // carries no branch — neither is new work.
    if (payload.deleted) return { message: 'Branch deleted — nothing to link', linked: 0 };
    const branch = branchFromRef(payload.ref);
    if (!branch) return { message: 'Not a branch push — ignored', linked: 0 };

    const commits = payload.commits ?? [];
    // One cache per delivery: a 40-commit push off one branch would otherwise
    // resolve that branch's ref 40 times.
    const cache = new Map<string, SubjectLocation | null>();
    let linked = 0;

    for (const commit of commits) {
      const sha = commit.id ?? '';
      if (!sha) continue;
      const hits = refHits(
        { texts: [commit.message], matchedBy: CodeLinkMatchedBy.MESSAGE },
        { texts: [branch], matchedBy: CodeLinkMatchedBy.BRANCH },
      );
      for (const hit of hits) {
        const at = await this.resolve(tenantId, hit, cache);
        if (!at) continue;
        const target: LinkTarget = { subjectType: hit.subjectType, ...at, matchedBy: hit.matchedBy };
        await this.links.upsert(
          this.link(tenantId, repo, target, {
            kind: CodeLinkKind.COMMIT,
            externalId: sha,
            sha,
            number: 0,
            title: commitSubject(commit.message),
            branch,
            // A commit has no destination of its own: `branch` is already where
            // it ended up, and a merge into `dev` re-delivers it saying so.
            baseBranch: '',
            state: '',
            authorName: commit.author?.name || commit.author?.username || '',
            authorAvatarUrl: '',
            url: commit.url ?? '',
            occurredAt: this.dateOf(commit.timestamp),
          }),
        );
        linked++;
      }
    }
    return {
      message: linked
        ? `Linked ${linked} reference(s) from ${commits.length} commit(s)`
        : `No refs found in ${commits.length} commit(s) on ${branch}`,
      linked,
    };
  }

  private async handlePullRequest(
    tenantId: string,
    repo: string,
    payload: GitHubPullRequestPayload,
  ): Promise<HandleGitHubEventResponse> {
    const pr = payload.pull_request;
    if (!pr?.number) return { message: 'No pull request in payload', linked: 0 };

    const head = pr.head?.ref ?? '';
    const externalId = `pr-${pr.number}`;
    const state: PullRequestState = pullRequestState({
      state: pr.state ?? 'open',
      merged: pr.merged,
      draft: pr.draft,
    });

    const targets = await this.pullRequestTargets(tenantId, repo, pr, head, externalId);
    for (const target of targets) {
      await this.links.upsert(
        this.link(tenantId, repo, target, {
          kind: CodeLinkKind.PULL_REQUEST,
          externalId,
          sha: '',
          number: pr.number,
          title: pr.title ?? '',
          branch: head,
          baseBranch: pr.base?.ref ?? '',
          state,
          authorName: pr.user?.login ?? '',
          authorAvatarUrl: pr.user?.avatar_url ?? '',
          url: pr.html_url ?? '',
          occurredAt: this.dateOf(pr.created_at),
        }),
      );
    }
    return {
      message: targets.length
        ? `Pull request #${pr.number} (${state}) linked to ${targets.length} item(s)`
        : `No refs found on pull request #${pr.number} or its commits`,
      linked: targets.length,
    };
  }

  /**
   * Everything a pull request should attach itself to, in order of how directly
   * it was said.
   *
   * The first source is the PR's own words. The second is the point of this
   * method: **a PR whose title and body name nothing still belongs on the tasks
   * its commits named.** That is the normal case, not the exception — a dev
   * writes the ref once, in the commit, and the PR gets whatever title GitHub
   * suggested. We can't read the PR's commits out of the delivery (GitHub sends
   * a count, not a list) and won't ask their API for them, because that needs a
   * token that can read the repository and this integration has none. The push
   * events that carried those commits already told us, so the head branch is the
   * join: the work pushed to it *is* the work in the PR.
   *
   * The third source keeps rows we already wrote correct. Once merged, a branch
   * is usually deleted and its commits re-delivered under `dev` — so a PR that
   * was only ever matched through its commits would go looking for a branch that
   * no longer has them and quietly stop updating, leaving "Open" on a merged PR.
   */
  private async pullRequestTargets(
    tenantId: string,
    repo: string,
    pr: NonNullable<GitHubPullRequestPayload['pull_request']>,
    head: string,
    externalId: string,
  ): Promise<LinkTarget[]> {
    const targets: LinkTarget[] = [];
    const add = (found: LinkTarget[]) => {
      for (const one of found) {
        if (!targets.some((t) => t.subjectId === one.subjectId)) targets.push(one);
      }
    };

    const cache = new Map<string, SubjectLocation | null>();
    for (const hit of refHits(
      { texts: [pr.title, pr.body], matchedBy: CodeLinkMatchedBy.TITLE },
      { texts: [head], matchedBy: CodeLinkMatchedBy.BRANCH },
    )) {
      const at = await this.resolve(tenantId, hit, cache);
      if (at) add([{ subjectType: hit.subjectType, ...at, matchedBy: hit.matchedBy }]);
    }

    const onBranch = await this.links.findSubjectsForBranch(tenantId, repo, head);
    if (onBranch.length > MAX_BRANCH_SUBJECTS) {
      this.logger.debug(
        `GitHub webhook: ${head} touches ${onBranch.length} items — too many for one pull request`,
      );
    } else {
      add(onBranch.map((s) => ({ ...s, matchedBy: CodeLinkMatchedBy.COMMIT })));
    }

    // Already carrying this PR's own matchedBy, so a state change doesn't
    // rewrite the reason the link exists.
    add(
      await this.links.findSubjectsForExternalId(
        tenantId,
        repo,
        CodeLinkKind.PULL_REQUEST,
        externalId,
      ),
    );
    return targets;
  }

  /** Assemble a row from the parts that vary by event and the parts that don't. */
  private link(
    tenantId: string,
    repo: string,
    target: LinkTarget,
    rest: Omit<
      UpsertCodeLinkData,
      'tenantId' | 'repo' | 'subjectType' | 'subjectId' | 'roadmapId' | 'matchedBy'
    >,
  ): UpsertCodeLinkData {
    return {
      tenantId,
      repo,
      subjectType: target.subjectType,
      subjectId: target.subjectId,
      roadmapId: target.roadmapId,
      matchedBy: target.matchedBy,
      ...rest,
    };
  }

  /**
   * Ref → the thing it names, memoised per delivery. Null when nothing matches:
   * a ref-shaped string in prose, or an item that has since been deleted. The
   * prefix already decided which store to ask, so this is one lookup, not a hunt.
   */
  private async resolve(
    tenantId: string,
    hit: ParsedRef,
    cache: Map<string, SubjectLocation | null>,
  ): Promise<SubjectLocation | null> {
    const cached = cache.get(hit.ref);
    if (cached !== undefined) return cached;

    let at: SubjectLocation | null = null;
    if (hit.subjectType === CodeLinkSubject.ROADMAP_ITEM) {
      const found = await this.roadmaps.findItemByRef(tenantId, hit.ref);
      if (found) at = { subjectId: found.itemId, roadmapId: found.roadmapId };
    } else {
      const issue = await this.issues.findByRef(tenantId, hit.ref);
      if (issue) at = { subjectId: issue.id.toString(), roadmapId: '' };
    }

    if (!at) this.logger.debug(`GitHub webhook: nothing found for ref ${hit.ref}`);
    cache.set(hit.ref, at);
    return at;
  }

  /** GitHub's ISO timestamps, with "now" as the fallback for a missing or
   *  unparsable one — an undated row would sort to the epoch and hide. */
  private dateOf(iso: string | undefined): Date {
    const d = iso ? new Date(iso) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
}
