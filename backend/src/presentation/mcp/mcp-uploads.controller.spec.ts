import { AddressInfo } from 'node:net';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@core/presentation/guards/jwt-auth.guard';
import { RolesGuard } from '@core/presentation/guards/roles.guard';
import { UploadMediaUseCase } from '@application/storage/use-cases/upload-media.use-case';
import {
  MCP_UPLOAD_TICKET_SECRET,
  McpCreateUploadUrlUseCase,
  McpRedeemUploadTicketUseCase,
} from '@application/mcp/use-cases';
import { McpUploadsController } from './mcp-uploads.controller';

/**
 * The redeem route over a real socket, because every interesting thing about it
 * is invisible to the type checker: that `@Public()` actually gets it past the
 * global JWT guard even though it carries no `x-api-key`, that multer is reading
 * the `file` part the returned command sends, and that the ticket in the path
 * survives being a JWT (which contains dots, and would 404 against a stricter
 * route pattern). Node's own fetch/FormData stand in for curl.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const stored = {
  url: 'https://cdn.test/uploads/2026-08-13/abc-shot.png',
  name: 'shot.png',
  contentType: 'image/png',
  size: PNG.length,
};

describe('POST mcp/uploads/ticket/:ticket', () => {
  let app: NestExpressApplication;
  let origin: string;
  const uploadMedia = { execute: jest.fn() };

  beforeAll(async () => {
    const jwt = new JwtService({ secret: MCP_UPLOAD_TICKET_SECRET });
    const moduleRef = await Test.createTestingModule({
      controllers: [McpUploadsController],
      providers: [
        { provide: JwtService, useValue: jwt },
        { provide: UploadMediaUseCase, useValue: uploadMedia },
        McpCreateUploadUrlUseCase,
        McpRedeemUploadTicketUseCase,
        // The real global guards: without them "@Public() lets this through"
        // would be an assertion about nothing.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Loopback only, and an OS-assigned port, so the test never opens a socket
    // to the network or collides with a running dev server.
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    uploadMedia.execute.mockReset().mockResolvedValue(stored);
  });

  /** Exactly what `create_upload_url` hands the assistant, minus the host. */
  const ticketUrl = async (): Promise<string> => {
    const create = app.get(McpCreateUploadUrlUseCase);
    const result = await create.execute({
      actor: { tenantId: 't1' } as never,
      dto: {},
      baseUrl: `${origin}/mcp`,
    });
    return result.getValue().uploadUrl;
  };

  const post = async (url: string, body: FormData): Promise<Response> =>
    fetch(url, { method: 'POST', body });

  it('accepts a multipart file with no auth header at all', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'shot.png');

    const res = await post(await ticketUrl(), form);

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual(stored);
    expect(uploadMedia.execute).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ contentType: 'image/png', originalName: 'shot.png' }),
    );
  });

  it('sends the real bytes, not a base64 rendering of them', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'shot.png');

    await post(await ticketUrl(), form);

    const [, file] = uploadMedia.execute.mock.calls[0] as [string, { buffer: Buffer }];
    expect(Buffer.compare(file.buffer, PNG)).toBe(0);
  });

  it('takes the file under any field name, since the caller is improvising curl', async () => {
    const form = new FormData();
    form.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'shot.png');

    const res = await post(await ticketUrl(), form);

    expect(res.status).toBe(201);
    expect(uploadMedia.execute).toHaveBeenCalled();
  });

  it('names the field when no file part arrived at all', async () => {
    const form = new FormData();
    form.append('note', 'no file here');

    const res = await post(await ticketUrl(), form);

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('file');
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  it('refuses a batch rather than storing one file and reporting success', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'one.png');
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'two.png');

    const res = await post(await ticketUrl(), form);

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('one file per upload URL');
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  it('does not store anything for a ticket it never signed', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'shot.png');

    const res = await post(`${origin}/mcp/uploads/ticket/not.a.ticket`, form);

    expect(res.ok).toBe(false);
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });
});
