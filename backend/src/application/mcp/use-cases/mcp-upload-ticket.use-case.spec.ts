import { JwtService } from '@nestjs/jwt';
import { BadRequestException } from '@nestjs/common';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import { UploadMediaUseCase } from '@application/storage/use-cases/upload-media.use-case';
import { CreateUploadUrlUseCase } from '@application/storage/use-cases/create-upload-url.use-case';
import {
  MCP_UPLOAD_TICKET_SECRET,
  McpCreateUploadUrlUseCase,
  McpRedeemUploadTicketUseCase,
} from './mcp-upload-ticket.use-case';
import type { McpActor } from './mcp.use-cases';

/**
 * The two halves of the ticket flow, with a real `JwtService` so the signature
 * is actually exercised — a ticket that verifies against a *mock* would prove
 * nothing about the part that matters, which is that only tickets this server
 * signed are spendable and that they stop working when they expire.
 */

const actor: McpActor = {
  tenantId: 't1',
  keyId: 'k1',
  keyName: 'CI',
  userId: 'u1',
  scope: ApiKeyScope.READ_WRITE,
  clientName: 'claude-code/1.0',
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const jwt = new JwtService({ secret: MCP_UPLOAD_TICKET_SECRET });

const stored = {
  url: 'https://cdn.test/uploads/2026-08-13/abc-shot.png',
  name: 'shot.png',
  contentType: 'image/png',
  size: PNG.length,
};

const signedPut = {
  uploadUrl: 'https://bucket.s3.test/uploads/2026-11-12/abc-demo.mp4?X-Amz-Signature=sig&X-Amz-Expires=3600',
  url: 'https://bucket.s3.test/uploads/2026-11-12/abc-demo.mp4',
  name: 'demo.mp4',
  contentType: 'video/mp4',
  size: 150 * 1024 * 1024,
  headers: { 'Content-Type': 'video/mp4' },
  expiresInSeconds: 3600,
  uploadId: '',
  key: '',
  partSize: 0,
  partUrls: [],
};

function build(mediaResult?: unknown, presignResult: unknown = signedPut) {
  const uploadMedia = {
    execute: jest.fn().mockResolvedValue(mediaResult ?? stored),
  };
  const presign = {
    execute: jest.fn().mockImplementation(async () => {
      if (presignResult instanceof Error) throw presignResult;
      return presignResult;
    }),
  };
  return {
    presign,
    create: new McpCreateUploadUrlUseCase(jwt, presign as unknown as CreateUploadUrlUseCase),
    redeem: new McpRedeemUploadTicketUseCase(
      jwt,
      uploadMedia as unknown as UploadMediaUseCase,
    ),
    uploadMedia,
  };
}

const file = (overrides: Partial<Parameters<McpRedeemUploadTicketUseCase['execute']>[0]['file']>) => ({
  buffer: PNG,
  contentType: 'image/png',
  originalName: 'shot.png',
  size: PNG.length,
  ...overrides,
});

async function ticketFor(create: McpCreateUploadUrlUseCase): Promise<string> {
  const result = await create.execute({ actor, dto: {}, baseUrl: 'https://api.test/v1/mcp' });
  return result.getValue().uploadUrl.split('/uploads/ticket/')[1];
}

describe('McpCreateUploadUrlUseCase', () => {
  it('hangs the ticket off the base URL it was given, not a configured host', async () => {
    const { create } = build();
    const result = await create.execute({
      actor,
      dto: {},
      baseUrl: 'https://team-api.example.com/v1/mcp',
    });
    expect(result.getValue().uploadUrl).toMatch(
      /^https:\/\/team-api\.example\.com\/v1\/mcp\/uploads\/ticket\/.+/,
    );
  });

  it('returns a runnable command with the multipart field name already right', async () => {
    const { create } = build();
    const result = await create.execute({
      actor,
      dto: { name: 'checkout-500.png' },
      baseUrl: 'https://api.test/v1/mcp',
    });
    const { curl, uploadUrl } = result.getValue();
    expect(curl).toContain('-F "file=@checkout-500.png"');
    expect(curl).toContain(uploadUrl);
  });

  // The CDN in front of the API 413s any body over ~100MB, so a recording sent
  // through the ticket route never reached us. With a size, it skips the API.
  describe('with a size — straight to storage', () => {
    it('signs a single PUT for the exact size and hands back the stored URL up front', async () => {
      const { create, presign } = build();
      const result = await create.execute({
        actor,
        dto: { name: 'demo.mp4', size: 150 * 1024 * 1024 },
        baseUrl: 'https://api.test/v1/mcp',
      });

      expect(presign.execute).toHaveBeenCalledWith(
        't1',
        { originalName: 'demo.mp4', contentType: '', size: 150 * 1024 * 1024 },
        { singlePut: true },
      );
      const t = result.getValue();
      expect(t.uploadUrl).toBe(signedPut.uploadUrl);
      expect(t.url).toBe(signedPut.url);
      expect(t.curl).toBe(
        `curl -sS --fail-with-body -T "demo.mp4" -H "Content-Type: video/mp4" "${signedPut.uploadUrl}" ` +
          `&& echo "${signedPut.url}"`,
      );
    });

    it('passes the storage rules’ own sentence back when the file is refused', async () => {
      const { create } = build(undefined, new Error('Video is too large — the limit is 30MB.'));
      const result = await create.execute({
        actor,
        dto: { name: 'demo.mp4', size: 150 * 1024 * 1024 },
        baseUrl: 'https://api.test/v1/mcp',
      });
      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Video is too large — the limit is 30MB.');
    });

    it('needs the name too — the extension is what types a signed upload', async () => {
      const { create, presign } = build();
      const result = await create.execute({ actor, dto: { size: 1024 }, baseUrl: 'https://api.test/v1/mcp' });
      expect(result.isFailure).toBe(true);
      expect(presign.execute).not.toHaveBeenCalled();
    });

    it('falls back to the ticket route when the provider cannot sign (Azure)', async () => {
      const { create } = build(undefined, { ...signedPut, uploadUrl: '', url: '', headers: {} });
      const result = await create.execute({
        actor,
        dto: { name: 'demo.mp4', size: 1024 },
        baseUrl: 'https://api.test/v1/mcp',
      });
      const t = result.getValue();
      expect(t.uploadUrl).toContain('/uploads/ticket/');
      expect(t.url).toBe('');
    });
  });
});

describe('McpRedeemUploadTicketUseCase', () => {
  it('spends a freshly issued ticket and stores the bytes against its tenant', async () => {
    const { create, redeem, uploadMedia } = build();
    const result = await redeem.execute({ ticket: await ticketFor(create), file: file({}) });

    expect(result.isFailure).toBe(false);
    expect(result.getValue()).toEqual(stored);
    expect(uploadMedia.execute).toHaveBeenCalledWith('t1', {
      buffer: PNG,
      contentType: 'image/png',
      originalName: 'shot.png',
      size: PNG.length,
    });
  });

  it('refuses a ticket signed with another secret instead of trusting its claims', async () => {
    const { redeem, uploadMedia } = build();
    const forged = await new JwtService({ secret: 'not-our-secret' }).signAsync({
      pur: 'mcp-upload',
      tnt: 'someone-else',
    });

    const result = await redeem.execute({ ticket: forged, file: file({}) });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('invalid or has expired');
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  it('refuses an expired ticket, so a URL left in a transcript is not reusable', async () => {
    const { redeem, uploadMedia } = build();
    const stale = await jwt.signAsync(
      { pur: 'mcp-upload', tnt: 't1' },
      { secret: MCP_UPLOAD_TICKET_SECRET, expiresIn: -10 },
    );

    const result = await redeem.execute({ ticket: stale, file: file({}) });

    expect(result.isFailure).toBe(true);
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  it('refuses a validly signed token that was not minted as an upload ticket', async () => {
    const { redeem, uploadMedia } = build();
    const wrongPurpose = await jwt.signAsync(
      { pur: 'something-else', tnt: 't1' },
      { secret: MCP_UPLOAD_TICKET_SECRET },
    );

    const result = await redeem.execute({ ticket: wrongPurpose, file: file({}) });

    expect(result.isFailure).toBe(true);
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  it('reads the type off the file name when curl labelled the part octet-stream', async () => {
    const { create, redeem, uploadMedia } = build();
    await redeem.execute({
      ticket: await ticketFor(create),
      file: file({ contentType: 'application/octet-stream', originalName: 'spec.pdf' }),
    });

    expect(uploadMedia.execute).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
  });

  it('keeps a real declared type rather than second-guessing it from the name', async () => {
    const { create, redeem, uploadMedia } = build();
    await redeem.execute({
      ticket: await ticketFor(create),
      file: file({ contentType: 'image/webp', originalName: 'shot.png' }),
    });

    expect(uploadMedia.execute).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ contentType: 'image/webp' }),
    );
  });

  it('passes a storage misconfiguration through as the sentence a person can act on', async () => {
    const { create, redeem, uploadMedia } = build();
    uploadMedia.execute.mockRejectedValueOnce(
      new BadRequestException(
        'Media storage is not configured. Ask an admin to set it up in Settings → Storage.',
      ),
    );

    const result = await redeem.execute({ ticket: await ticketFor(create), file: file({}) });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Settings → Storage');
  });
});
