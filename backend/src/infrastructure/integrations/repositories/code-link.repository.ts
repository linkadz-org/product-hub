import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CodeLinkRecord,
  ExistingLink,
  ICodeLinkRepository,
  LinkedSubjectRef,
  UpsertCodeLinkData,
} from '@application/integrations/repositories/code-link.repository';
import {
  CodeLinkKind,
  CodeLinkMatchedBy,
  CodeLinkSubject,
  PullRequestState,
} from '@application/integrations/domain/github.types';
import { CodeLinkDoc } from '../entities/code-link.schema';

@Injectable()
export class CodeLinkRepository implements ICodeLinkRepository {
  constructor(@InjectModel('CodeLink') private readonly model: Model<CodeLinkDoc>) {}

  private toRecord(d: CodeLinkDoc): CodeLinkRecord {
    return {
      id: d._id,
      tenantId: d.tenantId,
      subjectType: d.subjectType as CodeLinkSubject,
      subjectId: d.subjectId,
      roadmapId: d.roadmapId ?? '',
      kind: d.kind as CodeLinkKind,
      repo: d.repo,
      sha: d.sha,
      number: d.number,
      title: d.title,
      branch: d.branch,
      baseBranch: d.baseBranch ?? '',
      state: d.state as PullRequestState | '',
      authorName: d.authorName,
      authorAvatarUrl: d.authorAvatarUrl,
      url: d.url,
      matchedBy: d.matchedBy as CodeLinkMatchedBy,
      occurredAt: d.occurredAt,
      createdAt: d.createdAt,
    };
  }

  async findForSubject(tenantId: string, subjectId: string): Promise<CodeLinkRecord[]> {
    const docs = await this.model
      .find({ tenantId, subjectId })
      .sort({ occurredAt: -1 })
      .lean<CodeLinkDoc[]>()
      .exec();
    return docs.map((d) => this.toRecord(d));
  }

  async countForSubjects(
    tenantId: string,
    subjectIds: string[],
  ): Promise<Record<string, number>> {
    if (!subjectIds.length) return {};
    const rows = await this.model
      .aggregate<{ _id: string; count: number }>([
        { $match: { tenantId, subjectId: { $in: subjectIds } } },
        { $group: { _id: '$subjectId', count: { $sum: 1 } } },
      ])
      .exec();
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  async findSubjectsForBranch(
    tenantId: string,
    repo: string,
    branch: string,
  ): Promise<LinkedSubjectRef[]> {
    // An empty branch would match every commit we never recorded a branch for.
    if (!repo || !branch) return [];
    return this.distinctSubjects({ tenantId, repo, branch, kind: CodeLinkKind.COMMIT });
  }

  async findSubjectsForExternalId(
    tenantId: string,
    repo: string,
    kind: CodeLinkKind,
    externalId: string,
  ): Promise<ExistingLink[]> {
    if (!repo || !externalId) return [];
    return this.distinctSubjects({ tenantId, repo, kind, externalId });
  }

  /** One row per subject out of a set of links, dropping the links themselves. */
  private async distinctSubjects(match: Record<string, unknown>): Promise<ExistingLink[]> {
    const rows = await this.model
      .aggregate<{ _id: string; subjectType: string; roadmapId: string; matchedBy: string }>([
        { $match: match },
        // A subject reached by ten commits is still one subject, and every row
        // for it carries the same type and roadmap — so $first, not a lookup.
        {
          $group: {
            _id: '$subjectId',
            subjectType: { $first: '$subjectType' },
            roadmapId: { $first: '$roadmapId' },
            matchedBy: { $first: '$matchedBy' },
          },
        },
      ])
      .exec();
    return rows.map((r) => ({
      subjectType: r.subjectType as CodeLinkSubject,
      subjectId: r._id,
      roadmapId: r.roadmapId ?? '',
      matchedBy: r.matchedBy as CodeLinkMatchedBy,
    }));
  }

  async upsert(data: UpsertCodeLinkData): Promise<void> {
    const { tenantId, repo, kind, externalId, subjectId, ...rest } = data;
    await this.model
      .updateOne(
        { tenantId, repo, kind, externalId, subjectId },
        // $set covers the mutable half only: a pull request re-arrives on every
        // edit with a new state and title, while its identity is the filter itself.
        { $set: rest, $setOnInsert: { tenantId, repo, kind, externalId, subjectId } },
        { upsert: true },
      )
      .exec();
  }
}
