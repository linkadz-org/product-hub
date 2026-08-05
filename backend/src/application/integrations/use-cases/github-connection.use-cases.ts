import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { webhookSigningSecret, webhookUrlToken } from '@module-shared/utils/short-id.util';
import { IAppSettingsRepository } from '@application/app-settings/repositories/app-settings.repository';
import { AppSettingsEntity } from '@application/app-settings/domain/app-settings.entity';
import { defaultGitHubConnection } from '../domain/github.types';
import { ConnectedGitHubDto, GitHubConnectionDto } from '../dtos/github-connection.dtos';

export interface TenantRequest {
  tenantId: string;
}

/** Settings for a tenant, created on first touch — same contract as elsewhere. */
async function loadOrCreate(
  repo: IAppSettingsRepository,
  tenantId: string,
): Promise<AppSettingsEntity> {
  const existing = await repo.findByTenant(tenantId);
  if (existing) return existing;
  const created = AppSettingsEntity.create({ tenantId });
  if (created.isFailure) throw new Error(created.error as string);
  return created.getValue();
}

/** The connection as the settings page sees it — never the signing secret. */
function present(settings: AppSettingsEntity): GitHubConnectionDto {
  const c = settings.github;
  return {
    connected: c.enabled,
    // Not a secret on its own: without the signing key it accepts nothing. Shown
    // whenever asked, because setting the webhook up again needs it.
    token: c.token,
    secretConfigured: !!c.secret,
    connectedRepos: c.connectedRepos,
    lastEventAt: c.lastEventAt,
    lastEventRepo: c.lastEventRepo,
  };
}

/** Read the workspace's GitHub connection. */
@Injectable()
export class GetGitHubConnectionUseCase
  implements IUsecaseExecute<TenantRequest, Result<GitHubConnectionDto>>
{
  constructor(@Inject(IAppSettingsRepository) private readonly settings: IAppSettingsRepository) {}

  async execute(req: TenantRequest): Promise<Result<GitHubConnectionDto>> {
    const settings = await loadOrCreate(this.settings, req.tenantId);
    return Result.ok(present(settings));
  }
}

/**
 * Mint a fresh webhook token and signing secret, and turn the connection on.
 *
 * Also the "regenerate" path: connecting again replaces both, which is the only
 * way back from a leaked secret or a lost one. That invalidates any webhook
 * already pointing here, so the UI has to say so before calling it.
 *
 * This is the one and only time the signing secret is returned — after this it
 * exists to be compared against, never to be read.
 */
@Injectable()
export class ConnectGitHubUseCase
  implements IUsecaseExecute<TenantRequest, Result<ConnectedGitHubDto>>
{
  constructor(@Inject(IAppSettingsRepository) private readonly settings: IAppSettingsRepository) {}

  async execute(req: TenantRequest): Promise<Result<ConnectedGitHubDto>> {
    const settings = await loadOrCreate(this.settings, req.tenantId);
    const secret = webhookSigningSecret();
    settings.setGitHub({
      ...settings.github,
      token: webhookUrlToken(),
      secret,
      enabled: true,
      // Repos and delivery history belong to the old secret's deliveries; a fresh
      // connection has proven nothing yet, and saying otherwise would be a lie
      // the page tells while nothing is arriving.
      connectedRepos: [],
      lastEventAt: null,
      lastEventRepo: '',
    });
    await this.settings.save(settings);
    return Result.ok({ ...present(settings), secret });
  }
}

/** Turn the connection off and forget both secrets, so the URL stops answering. */
@Injectable()
export class DisconnectGitHubUseCase
  implements IUsecaseExecute<TenantRequest, Result<GitHubConnectionDto>>
{
  constructor(@Inject(IAppSettingsRepository) private readonly settings: IAppSettingsRepository) {}

  async execute(req: TenantRequest): Promise<Result<GitHubConnectionDto>> {
    const settings = await loadOrCreate(this.settings, req.tenantId);
    // Back to the never-connected state rather than a disabled one: a blank token
    // matches no delivery at all, so this can't be undone by flipping a flag.
    settings.setGitHub(defaultGitHubConnection());
    await this.settings.save(settings);
    return Result.ok(present(settings));
  }
}
