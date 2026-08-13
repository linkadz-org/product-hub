import { BadRequestException } from '@nestjs/common';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import { UploadMediaUseCase } from '@application/storage/use-cases/upload-media.use-case';
import { McpUploadFileUseCase, MCP_UPLOAD_MAX_BYTES } from './mcp-upload.use-case';
import type { McpActor } from './mcp.use-cases';

/**
 * Pure unit tests for the one MCP tool that carries bytes. The storage use-case
 * is a mock: what matters here is the transport layer around it — base64 in,
 * a content type inferred from the file *name*, and a refusal that reads as a
 * sentence rather than a 500, since a tool reply is the only thing the assistant
 * ever sees.
 */

const actor: McpActor = {
  tenantId: 't1',
  keyId: 'k1',
  keyName: 'CI',
  userId: 'u1',
  scope: ApiKeyScope.READ_WRITE,
  clientName: 'claude-code/1.0',
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_B64 = PNG_BYTES.toString('base64');

function build(result?: unknown) {
  const uploadMedia = {
    execute: jest.fn().mockResolvedValue(
      result ?? {
        url: 'https://cdn.test/uploads/2026-08-13/abc-shot.png',
        name: 'shot.png',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      },
    ),
  };
  const useCase = new McpUploadFileUseCase(uploadMedia as unknown as UploadMediaUseCase);
  return { useCase, uploadMedia };
}

describe('McpUploadFileUseCase', () => {
  it('decodes base64 and hands the storage use-case the real bytes', async () => {
    const { useCase, uploadMedia } = build();

    const result = await useCase.execute({
      actor,
      dto: { name: 'shot.png', data: PNG_B64 },
    });

    expect(result.isSuccess).toBe(true);
    expect(uploadMedia.execute).toHaveBeenCalledWith('t1', {
      buffer: PNG_BYTES,
      contentType: 'image/png',
      originalName: 'shot.png',
      size: PNG_BYTES.length,
    });
    expect(result.getValue().url).toContain('shot.png');
  });

  it('accepts a data URL and strips the wrapper before decoding', async () => {
    const { useCase, uploadMedia } = build();

    await useCase.execute({
      actor,
      dto: { name: 'shot.png', data: `data:image/png;base64,${PNG_B64}` },
    });

    expect(uploadMedia.execute.mock.calls[0][1].buffer).toEqual(PNG_BYTES);
  });

  // The name is usually all an assistant has — it read a file off disk, it has no
  // browser to declare a MIME type. Without this the upload would be refused as
  // an unknown file type.
  it('infers the content type from the file name when none is given', async () => {
    const { useCase, uploadMedia } = build();

    await useCase.execute({ actor, dto: { name: 'spec.pdf', data: PNG_B64 } });

    expect(uploadMedia.execute.mock.calls[0][1].contentType).toBe('application/pdf');
  });

  it('prefers an explicit contentType over the one the name implies', async () => {
    const { useCase, uploadMedia } = build();

    await useCase.execute({
      actor,
      dto: { name: 'clip.mp4', data: PNG_B64, contentType: 'video/webm' },
    });

    expect(uploadMedia.execute.mock.calls[0][1].contentType).toBe('video/webm');
  });

  it('refuses a name it cannot type, instead of storing an unreadable blob', async () => {
    const { useCase, uploadMedia } = build();

    const result = await useCase.execute({ actor, dto: { name: 'dump', data: PNG_B64 } });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('file extension');
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  it('refuses payloads that are not base64', async () => {
    const { useCase, uploadMedia } = build();

    const result = await useCase.execute({ actor, dto: { name: 'shot.png', data: '<binary>' } });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('base64');
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  // Over the wire this would be truncated by the body parser and read as a
  // network fault, so it has to be refused here with the reason and the ceiling.
  it('refuses a file past the transport ceiling before allocating it', async () => {
    const { useCase, uploadMedia } = build();
    const oversized = 'A'.repeat(Math.ceil(((MCP_UPLOAD_MAX_BYTES + 1024 * 1024) * 4) / 3));

    const result = await useCase.execute({ actor, dto: { name: 'big.mp4', data: oversized } });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('too big');
    expect(uploadMedia.execute).not.toHaveBeenCalled();
  });

  it('reads a storage misconfiguration back as guidance, not a crash', async () => {
    const { useCase } = build();
    const uploadMedia = {
      execute: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            'Media storage is not configured. Ask an admin to set it up in Settings → Storage.',
          ),
        ),
    };
    const failing = new McpUploadFileUseCase(uploadMedia as unknown as UploadMediaUseCase);

    const result = await failing.execute({ actor, dto: { name: 'shot.png', data: PNG_B64 } });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Settings → Storage');
    // The healthy path is untouched by the failure above.
    expect((await useCase.execute({ actor, dto: { name: 'shot.png', data: PNG_B64 } })).isSuccess).toBe(
      true,
    );
  });
});
