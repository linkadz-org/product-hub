import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@core/interfaces';
import {
  CollabResetRequest,
  CollabResetResult,
  ICollabSync,
} from '@application/docs/collab-sync.port';

/**
 * Hard ceiling on the refresh call. The write has already committed and the
 * caller is waiting on a tool reply, so a collab server that is wedged must cost
 * a couple of seconds and an honest warning — never a hung request.
 */
const RESET_TIMEOUT_MS = 3000;

/**
 * The minted token lives just long enough to make one call. It is a *machine*
 * credential for a write the API already performed, so anything longer is a
 * bearer token lying around for no reason.
 */
const TOKEN_TTL = '60s';

/**
 * The collab server gates `/reset` with `canWrite(role)`, which admits admin,
 * tester and product (collab/src/auth.ts). PRODUCT is the least privileged of
 * the three: the token must be accepted, and nothing here needs more.
 */
const RESET_ROLE = Role.PRODUCT;

/**
 * Calls the collab server's `/reset` over HTTP.
 *
 * Authentication is the ordinary API access token: `collab/src/env.ts` documents
 * `JWT_SECRET` as byte-identical to the API's, and `verifyToken` wants only
 * `userId`, `tenantId` and `role`, so the API can mint one the collab server
 * accepts without any second shared secret to keep in sync.
 *
 * `COLLAB_HTTP_URL` unset means this deployment does not run collab at all —
 * that is a supported shape, so it is a clean no-op rather than an error.
 */
@Injectable()
export class CollabSyncService implements ICollabSync {
  private readonly logger = new Logger(CollabSyncService.name);
  /** Base URL of the collab server's HTTP side, without a trailing slash. */
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.baseUrl = (config.get<string>('COLLAB_HTTP_URL') ?? '').trim().replace(/\/+$/, '');
    this.secret = config.get<string>('JWT_SECRET') ?? '';
  }

  async resetPage({
    tenantId,
    pageId,
    userId,
    userName,
  }: CollabResetRequest): Promise<CollabResetResult> {
    if (!this.baseUrl) return { status: 'not-configured' };

    try {
      const token = await this.jwt.signAsync(
        { userId, tenantId, email: '', name: userName, role: RESET_ROLE },
        { secret: this.secret, expiresIn: TOKEN_TTL },
      );
      const response = await fetch(
        `${this.baseUrl}/reset?page=${encodeURIComponent(pageId)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(RESET_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const error = `collab server answered ${response.status}`;
        this.logger.warn(`collab reset failed for page ${pageId}: ${error}`);
        return { status: 'failed', error };
      }
      return { status: 'refreshed' };
    } catch (err) {
      const error = (err as Error).message || 'collab server unreachable';
      this.logger.warn(`collab reset failed for page ${pageId}: ${error}`);
      return { status: 'failed', error };
    }
  }
}
