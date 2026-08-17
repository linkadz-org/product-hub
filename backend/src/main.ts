import 'reflect-metadata';
import type { IncomingMessage } from 'http';
// Load the per-environment config from /config before anything reads env.
import '@shared/utils/dotenv';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './app.module';
import {
  reportIndexBuildFailures,
  reportSearchTextBackfillHazard,
} from './infrastructure/database/mongoose/mongoose.module';

async function bootstrap() {
  // `bodyParser: false` skips Express's default JSON parser (a 100kb limit that
  // would 413 before ours ran); we re-register it below with a larger cap.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  // Rich-text descriptions can inline an image as a base64 data URL when no
  // cloud storage is configured, so a single request may carry a few hundred KB.
  // Raise the JSON/form body limit accordingly (overridable via env for prod).
  const bodyLimit = config.get<string>('MAX_REQUEST_BODY_SIZE', '10mb');
  app.useBodyParser('json', {
    limit: bodyLimit,
    // An inbound webhook is signed over the bytes on the wire, and re-serialising
    // the parsed object gives a different string and so a different digest. Keep
    // the original buffer for those routes only — every other request would just
    // be holding a second copy of its body for no reason.
    verify: (req: IncomingMessage & { rawBody?: Buffer }, _res, buf: Buffer) => {
      if (req.url?.includes('/integrations/')) req.rawBody = buf;
    },
  });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );

  const allowedOrigins = (config.get<string>('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // `*` can't be sent as a literal header value alongside `credentials: true`,
  // and inside an array it's matched literally so it never hits a real origin.
  // `origin: true` reflects the caller's Origin back instead — same "allow
  // everyone" effect, but spec-compliant with credentials.
  const corsOrigin = allowedOrigins.includes('*')
    ? true
    : allowedOrigins.length
      ? allowedOrigins
      : ['http://localhost:3001', 'http://127.0.0.1:3001'];
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept-Language',
      'X-Api-Key',
      // Streamable HTTP MCP (/v1/mcp): the session id is sent back on every
      // call after `initialize`, and browser-hosted clients can only read it
      // off the response if it's exposed.
      'Mcp-Session-Id',
      'Mcp-Protocol-Version',
      'X-Mcp-Client',
    ],
    exposedHeaders: ['Mcp-Session-Id'],
  });

  // URI versioning → every route is served under /v1 by default.
  // prefix:'' means the version literal ('v1') is used verbatim (no extra 'v'),
  // giving /v1/... rather than the default /vv1/...
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: 'v1',
    prefix: '',
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('product-hub API')
    .setDescription(
      'Product-management hub — projects, reports, test cases, bugs, roadmaps, milestones',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { in: 'header', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT-auth',
    )
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    // A second bearer scheme, because /v1/platform tokens are signed with a
    // different secret and are not interchangeable with workspace tokens.
    .addBearerAuth(
      { in: 'header', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'platform-auth',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('swagger', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Every model is registered by now, so this is the first moment their index
  // builds can be awaited. Reported, never fatal — see `reportIndexBuildFailures`
  // for why, and the deploy runbook for the check that goes with it. Awaited
  // before `listen` so the verdict is in the log above the "running on" line
  // rather than interleaved with the first requests.
  await reportIndexBuildFailures(app.get<Connection>(getConnectionToken()));
  // Same "boot, then verify" spot — see `reportSearchTextBackfillHazard` for
  // the deploy-order hazard this guards against.
  await reportSearchTextBackfillHazard(app.get<Connection>(getConnectionToken()));

  await app.listen(port);
  Logger.log(
    `product-hub API running on http://localhost:${port}/v1  (Swagger: /swagger)`,
    'Bootstrap',
  );
}
bootstrap();
