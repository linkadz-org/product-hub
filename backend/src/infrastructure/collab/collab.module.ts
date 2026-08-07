import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ICollabSync } from '@application/docs/collab-sync.port';
import { CollabSyncService } from './collab-sync.service';

/**
 * The API's outbound half of the realtime editing setup.
 *
 * `JwtModule.register({})` on purpose: the secret is passed per call from
 * `JWT_SECRET`, so this module carries no signing defaults that could drift from
 * the ones auth uses.
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [{ provide: ICollabSync, useClass: CollabSyncService }],
  exports: [ICollabSync],
})
export class InfrastructureCollabModule {}
