import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import {
  CodeLinkCiState,
  CodeLinkKind,
  CodeLinkMatchedBy,
  CodeLinkSubject,
  PullRequestState,
} from '../domain/github.types';

export class GetCodeLinksQueryDto {
  @ApiProperty({ description: 'Issue id, or backlog item id' })
  @IsString()
  subjectId!: string;
}

/** One commit or pull request, as the detail panel renders it. */
export class CodeLinkResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CodeLinkSubject })
  subjectType!: CodeLinkSubject;

  @ApiProperty()
  subjectId!: string;

  @ApiProperty({ enum: CodeLinkKind })
  kind!: CodeLinkKind;

  @ApiProperty({ description: 'owner/repo' })
  repo!: string;

  @ApiProperty({ description: 'Full commit sha; empty on a pull request' })
  sha!: string;

  @ApiProperty({ description: 'First 7 characters of the sha — what a card shows' })
  shortSha!: string;

  @ApiProperty({ description: 'Pull request number; 0 on a commit' })
  number!: number;

  @ApiProperty({ description: 'Commit subject, or pull request title' })
  title!: string;

  @ApiProperty({ description: "Commit's branch, or the PR's source branch" })
  branch!: string;

  @ApiProperty({ description: "PR's target branch — dev, main; empty on a commit" })
  baseBranch!: string;

  @ApiProperty({ enum: PullRequestState, description: 'Empty on a commit' })
  state!: PullRequestState | '';

  @ApiProperty()
  authorName!: string;

  @ApiProperty()
  authorAvatarUrl!: string;

  @ApiProperty({ description: 'Link to the commit or PR on GitHub' })
  url!: string;

  @ApiProperty({ enum: CodeLinkMatchedBy, description: 'Where the ref was found' })
  matchedBy!: CodeLinkMatchedBy;

  @ApiProperty({ description: 'When the work happened, not when it was stored' })
  occurredAt!: Date;

  @ApiProperty({ enum: CodeLinkCiState, description: "CI's last word; empty until it reports" })
  ciState!: CodeLinkCiState | '';

  @ApiProperty({ description: 'The reporting job, e.g. "ci/circleci: deploy-2"' })
  ciContext!: string;

  @ApiProperty({ description: 'Branch CI ran on — dev, main: the environment' })
  ciBranch!: string;

  @ApiProperty({ description: 'Deep link to the build log' })
  ciUrl!: string;

  @ApiProperty({ description: 'When CI last reported; null if never', nullable: true })
  ciAt!: Date | null;
}
