import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/decorators';
import { UnauthorizedDomainException } from '@core/exceptions';
import { HandleGitHubEventUseCase } from '@application/integrations/use-cases';
import { GitHubWebhookResultDto } from '@application/integrations/dtos/github-connection.dtos';

/** Express request with the raw body kept aside for signature checking. */
interface RawBodyRequest {
  rawBody?: Buffer;
}

/**
 * Where GitHub delivers. Unauthenticated in the usual sense — there's no user
 * and no API key — so the two path/header secrets do that job instead: the token
 * in the URL names the workspace, and `X-Hub-Signature-256` proves GitHub sent it.
 *
 * Always answers 200 once those two check out, whatever we made of the payload.
 * GitHub retries non-2xx deliveries and eventually disables a webhook that keeps
 * failing, so "this push mentioned no issues" must not look like an outage.
 */
@ApiTags('Integrations')
@Public()
@Controller('integrations/github')
export class GitHubWebhookController {
  constructor(private readonly handle: HandleGitHubEventUseCase) {}

  @Post('webhook/:token')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receive a GitHub push / pull_request webhook' })
  async receive(
    @Param('token') token: string,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: RawBodyRequest,
    @Body() payload: unknown,
  ): Promise<GitHubWebhookResultDto> {
    const result = await this.handle.execute({
      token,
      event: event ?? '',
      signature,
      rawBody: req.rawBody,
      payload,
    });
    // Only a wrong token or a failed signature lands here, and both mean the
    // sender is misconfigured — a 401 is what tells them so.
    if (result.isFailure) throw new UnauthorizedDomainException(result.error as string);
    return result.getValue();
  }
}
