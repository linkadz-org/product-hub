import { Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { UploadMediaUseCase } from '@application/storage/use-cases/upload-media.use-case';
import { contentTypeFromName } from '@application/storage/domain/upload-kind';
import { McpUploadFileDto } from '../dtos/mcp.dtos';
import { McpUploadedFileDto } from '../dtos/mcp.response.dto';
import type { McpActor } from './mcp.use-cases';

/**
 * Ceiling on the *decoded* bytes one tool call may carry. MCP has no streaming
 * upload: the whole file rides inside the JSON-RPC body, and base64 inflates it
 * by a third — 7MB of bytes is already ~9.4MB on the wire, just under the 10mb
 * request limit the API boots with (`MAX_REQUEST_BODY_SIZE`). Past this the
 * request would be cut off by the body parser, which an assistant reads as a
 * network fault rather than a limit, so it is refused here with a reason.
 *
 * The tenant's own per-type caps (Settings → Storage) still apply underneath and
 * are usually the stricter of the two.
 */
export const MCP_UPLOAD_MAX_BYTES = 7 * 1024 * 1024;

/** `data:image/png;base64,AAAA…` — the prefix a client may leave on the payload. */
const DATA_URL = /^data:([^;,]*)(;[^,]*)?,/i;

/** Base64 with optional padding and whitespace. Anything else is not a file. */
const BASE64 = /^[A-Za-z0-9+/\s]*={0,2}$/;

/**
 * Store a file sent over MCP and hand back its public URL.
 *
 * This is deliberately the *only* new step: it puts bytes in the tenant's bucket
 * and stops there. Attaching the URL is `update_issue` (bug attachments) or
 * `add_comment` (images) — the same two-step the web app does, so a file added by
 * an assistant is indistinguishable from one dragged into the browser.
 *
 * Everything about *what may be stored* — provider configured, accepted types,
 * per-type size caps — belongs to {@link UploadMediaUseCase} and is not
 * re-decided here; this wrapper only turns the transport (base64 text) into bytes
 * and turns a thrown 4xx into a `Result.fail` the tool can read aloud.
 */
@Injectable()
export class McpUploadFileUseCase
  implements IUsecaseExecute<{ actor: McpActor; dto: McpUploadFileDto }, Result<McpUploadedFileDto>>
{
  constructor(private readonly uploadMedia: UploadMediaUseCase) {}

  async execute({
    actor,
    dto,
  }: {
    actor: McpActor;
    dto: McpUploadFileDto;
  }): Promise<Result<McpUploadedFileDto>> {
    const decoded = decodeBase64(dto.data);
    if (decoded.isFailure) return Result.fail(decoded.error as string);
    const { buffer, dataUrlType } = decoded.getValue();

    // What the caller says, then what the data URL said, then what the file name
    // implies. The name is last but it is the one that usually answers, because
    // an assistant reading a `.png` off disk has a name and nothing else.
    const contentType =
      dto.contentType?.trim() || dataUrlType || contentTypeFromName(dto.name) || '';
    if (!contentType) {
      return Result.fail(
        `Could not tell what "${dto.name}" is — give it a file extension (bug.png, spec.pdf) ` +
          'or pass `contentType`.',
      );
    }

    try {
      const stored = await this.uploadMedia.execute(actor.tenantId, {
        buffer,
        contentType,
        originalName: dto.name,
        size: buffer.length,
      });
      return Result.ok(stored);
    } catch (err) {
      // Storage-not-configured, unsupported type and over-the-cap all arrive as
      // Nest HTTP exceptions carrying a sentence written for a person. Passing
      // that sentence through is the whole point — it tells the assistant to go
      // fix Settings → Storage instead of retrying a call that cannot succeed.
      return Result.fail((err as Error).message);
    }
  }
}

/** Base64 text → bytes, with the `data:` wrapper stripped and its type kept. */
function decodeBase64(raw: string): Result<{ buffer: Buffer; dataUrlType: string }> {
  let payload = raw.trim();
  let dataUrlType = '';

  const prefix = DATA_URL.exec(payload);
  if (prefix) {
    if (!prefix[2]?.includes('base64')) {
      return Result.fail('Only base64 data URLs are accepted — `data:<type>;base64,<bytes>`.');
    }
    dataUrlType = prefix[1] ?? '';
    payload = payload.slice(prefix[0].length);
  }

  if (!BASE64.test(payload)) {
    return Result.fail('`data` is not valid base64 — send the raw file bytes base64-encoded.');
  }

  // Checked on the *encoded* length, before allocating: 4 base64 chars carry 3
  // bytes, so this rejects an oversized payload without first copying it.
  const approxBytes = Math.floor((payload.length * 3) / 4);
  if (approxBytes > MCP_UPLOAD_MAX_BYTES) {
    return Result.fail(
      `That file is too big to send over MCP (${mb(approxBytes)}MB; the limit is ` +
        `${mb(MCP_UPLOAD_MAX_BYTES)}MB). Upload it in the app instead and pass the URL.`,
    );
  }

  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) return Result.fail('`data` decoded to an empty file.');
  return Result.ok({ buffer, dataUrlType });
}

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);
