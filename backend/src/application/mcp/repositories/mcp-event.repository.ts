import { PaginationDto } from '@module-shared/modules/pagination/pagination.dto';
import { McpEventEntity } from '../domain/entities/mcp-event.entity';

export interface McpEventPaginationResponse {
  data: McpEventEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Port for the append-only log of everything MCP created. */
export abstract class IMcpEventRepository {
  append: (event: McpEventEntity) => Promise<void>;
  /** `userId`, when given, scopes the log to events attributed to that user. */
  findByTenant: (
    tenantId: string,
    query: PaginationDto,
    userId?: string,
  ) => Promise<McpEventPaginationResponse>;
}
