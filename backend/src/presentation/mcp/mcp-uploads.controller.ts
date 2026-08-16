import {
  BadRequestException,
  Controller,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/decorators';
import { ValidationException } from '@core/exceptions';
import { McpUploadedFileDto } from '@application/mcp/dtos/mcp.response.dto';
import {
  MCP_UPLOAD_TICKET_MAX_BYTES,
  McpRedeemUploadTicketUseCase,
} from '@application/mcp/use-cases';

/**
 * Where an upload ticket is spent — the only MCP route with no `x-api-key`.
 *
 * That is the whole reason it exists on its own controller: `McpController` and
 * `McpHttpController` both mount `ApiKeyGuard` at the class, and the caller here
 * is a bare `curl` that has never seen the key (it lives in the MCP client's
 * config). The ticket in the path carries the tenant and its own expiry instead,
 * so this is authenticated — just by the URL rather than by a header.
 *
 * It takes multipart rather than JSON because that is the point of the detour:
 * multer streams the part off the socket, so the file is not bound by the JSON
 * body limit and, more importantly, never has to be base64'd through a model's
 * context to get here.
 */
@ApiTags('MCP')
@ApiExcludeController()
@Public()
@Controller('mcp')
export class McpUploadsController {
  constructor(private readonly redeem: McpRedeemUploadTicketUseCase) {}

  @Post('uploads/ticket/:ticket')
  // Any field name, not `FileInterceptor('file')`. The caller here is an
  // assistant improvising a shell command, and multer rejects an unexpected
  // field before the handler runs — so `-F "image=@…"` came back as
  // "Unexpected field - image", which never says what the right field was.
  // Accepting whatever part arrives deletes that failure instead of describing
  // it; the tool still hands over a command that says `file`.
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MCP_UPLOAD_TICKET_MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Spend an upload ticket — multipart `file`, no auth header' })
  async upload(
    @Param('ticket') ticket: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<McpUploadedFileDto> {
    // Named so the fix is obvious from the reply: `-F "file=@…"`, not `-d`.
    const [file, ...rest] = files ?? [];
    if (!file) throw new BadRequestException('No file provided (form field "file").');
    // One reply describes one stored file, so quietly keeping the first and
    // dropping the rest would report a success that half happened.
    if (rest.length) {
      throw new BadRequestException(
        `Send one file per upload URL — this request carried ${rest.length + 1}. ` +
          'Call create_upload_url again for the next one.',
      );
    }

    const result = await this.redeem.execute({
      ticket,
      file: {
        buffer: file.buffer,
        contentType: file.mimetype,
        originalName: file.originalname,
        size: file.size,
      },
    });
    if (result.isFailure) throw new ValidationException(result.error as string);
    return result.getValue();
  }
}
