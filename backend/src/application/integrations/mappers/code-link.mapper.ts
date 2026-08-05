import { CodeLinkRecord } from '../repositories/code-link.repository';
import { CodeLinkResponseDto } from '../dtos/code-link.dtos';

export class CodeLinkMapper {
  static toResponseDto(record: CodeLinkRecord): CodeLinkResponseDto {
    return {
      id: record.id,
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      kind: record.kind,
      repo: record.repo,
      sha: record.sha,
      // Derived here rather than in the client, so every surface abbreviates a
      // sha the same way.
      shortSha: record.sha.slice(0, 7),
      number: record.number,
      title: record.title,
      branch: record.branch,
      baseBranch: record.baseBranch,
      state: record.state,
      authorName: record.authorName,
      authorAvatarUrl: record.authorAvatarUrl,
      url: record.url,
      matchedBy: record.matchedBy,
      occurredAt: record.occurredAt,
      ciState: record.ciState,
      ciContext: record.ciContext,
      ciBranch: record.ciBranch,
      ciUrl: record.ciUrl,
      ciAt: record.ciAt,
    };
  }
}
