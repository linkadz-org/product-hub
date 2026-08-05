import { Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, Roles } from '@core/decorators';
import { JwtPayload, Role } from '@core/interfaces';
import {
  ConnectGitHubUseCase,
  DisconnectGitHubUseCase,
  GetCodeLinksUseCase,
  GetGitHubConnectionUseCase,
} from '@application/integrations/use-cases';
import {
  CodeLinkResponseDto,
  GetCodeLinksQueryDto,
} from '@application/integrations/dtos/code-link.dtos';
import {
  ConnectedGitHubDto,
  GitHubConnectionDto,
} from '@application/integrations/dtos/github-connection.dtos';

/**
 * The workspace-facing half of the GitHub link: reading what arrived, and the
 * admin screen that sets it up.
 *
 * Reads are open to any authenticated member — linked commits are shown on the
 * detail pages everyone already uses. Managing the connection is admin-only,
 * matching the other credential sections in Settings.
 */
@ApiTags('Integrations')
@ApiBearerAuth('JWT-auth')
@Controller('code-links')
export class CodeLinksController {
  constructor(
    private readonly getLinks: GetCodeLinksUseCase,
    private readonly getConnection: GetGitHubConnectionUseCase,
    private readonly connect: ConnectGitHubUseCase,
    private readonly disconnect: DisconnectGitHubUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Commits and pull requests linked to an issue or backlog item' })
  async list(
    @AuthUser() auth: JwtPayload,
    @Query() query: GetCodeLinksQueryDto,
  ): Promise<CodeLinkResponseDto[]> {
    const result = await this.getLinks.execute({
      tenantId: auth.tenantId,
      subjectId: query.subjectId,
    });
    return result.getValue();
  }

  @Get('github')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "The workspace's GitHub connection (admin)" })
  async github(@AuthUser() auth: JwtPayload): Promise<GitHubConnectionDto> {
    const result = await this.getConnection.execute({ tenantId: auth.tenantId });
    return result.getValue();
  }

  @Post('github/connect')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Mint a webhook URL and signing secret (admin). Repeating this replaces both.',
  })
  async connectGitHub(@AuthUser() auth: JwtPayload): Promise<ConnectedGitHubDto> {
    const result = await this.connect.execute({ tenantId: auth.tenantId });
    return result.getValue();
  }

  @Delete('github')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Disconnect GitHub — the webhook URL stops answering (admin)' })
  async disconnectGitHub(@AuthUser() auth: JwtPayload): Promise<GitHubConnectionDto> {
    const result = await this.disconnect.execute({ tenantId: auth.tenantId });
    return result.getValue();
  }
}
