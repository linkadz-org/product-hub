import { ApiProperty } from '@nestjs/swagger';

/** The workspace's GitHub link, as the settings page reads it. */
export class GitHubConnectionDto {
  @ApiProperty({ description: 'Whether a webhook URL is live for this workspace' })
  connected!: boolean;

  @ApiProperty({
    description: 'The token in the webhook URL. Useless without the signing secret.',
  })
  token!: string;

  @ApiProperty({ description: 'True when a signing secret is stored (never returned)' })
  secretConfigured!: boolean;

  @ApiProperty({ type: [String], description: 'Repos we have accepted a delivery from' })
  connectedRepos!: string[];

  @ApiProperty({ nullable: true, description: 'When the last delivery arrived' })
  lastEventAt!: Date | null;

  @ApiProperty({ description: 'Repo of the last delivery' })
  lastEventRepo!: string;
}

/** The connect response — the only time the signing secret is ever returned. */
export class ConnectedGitHubDto extends GitHubConnectionDto {
  @ApiProperty({ description: 'Paste into the GitHub webhook Secret field. Shown once.' })
  secret!: string;
}

/** What a delivery did, echoed back into GitHub's delivery log. */
export class GitHubWebhookResultDto {
  @ApiProperty()
  message!: string;

  @ApiProperty({ description: 'Links created or refreshed by this delivery' })
  linked!: number;
}
