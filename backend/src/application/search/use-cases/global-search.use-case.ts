import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { normalizeSearchText } from '@module-shared/utils/search-text.util';
import { ISearchableRepository } from '../repositories/searchable.repository';
import { SearchGroup, SearchHit } from '../domain/search-result.type';
import { SearchType } from '../domain/enums/search-type.enum';

export interface GlobalSearchRequest {
  tenantId: string;
  q: string;
  types?: SearchType[];
  limit?: number;
}

const MIN_Q = 2;
const MAX_Q = 64;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const RECENT_DAYS = 7;

/** Timeout mỗi repository, tiêm qua token để test rút ngắn được.
 *  KHÔNG dùng tham số constructor kiểu `number` có giá trị mặc định: Nest resolve
 *  tham số theo kiểu, `number` không có provider nào, và app sẽ chết lúc boot. */
export const SEARCH_TIMEOUT_MS = Symbol('SEARCH_TIMEOUT_MS');
export const DEFAULT_TIMEOUT_MS = 1500;

/** Bỏ qua một promise chậm thay vì để nó giữ cả request — nhưng không lặng
 *  thinh: một repository lỗi hoặc timeout phải để lại dấu vết (warn kèm
 *  `type`), nếu không cả nhóm biến mất khỏi ⌘K mà chẳng ai biết vì sao. */
function withTimeout<T>(
  run: () => Promise<T>,
  ms: number,
  type: SearchType,
  logger: Logger,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  // `run` is a thunk, not an already-started promise: calling it inside this
  // try/catch contains a *synchronous* throw from `r.search(...)` the same
  // way `.catch` contains a rejection. Every implementation today is `async`
  // (so this can't happen in practice) but containment shouldn't depend on
  // that staying true.
  return Promise.race([
    (async () => {
      try {
        return await run();
      } catch (err) {
        logger.warn(`search repository "${type}" failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })(),
    new Promise<null>((res) => {
      timer = setTimeout(() => {
        logger.warn(`search repository "${type}" timed out after ${ms}ms`);
        res(null);
      }, ms);
    }),
    // Dọn timer, nếu không mỗi request để lại N timer sống 1,5 giây — Jest sẽ
    // cảnh báo open handle và test treo tới khi chúng hết hạn.
  ]).finally(() => clearTimeout(timer));
}

@Injectable()
export class GlobalSearchUseCase {
  private readonly logger = new Logger(GlobalSearchUseCase.name);

  constructor(
    @Inject(ISearchableRepository) private readonly repos: ISearchableRepository[],
    @Optional() @Inject(SEARCH_TIMEOUT_MS) private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async execute({ tenantId, q, types, limit }: GlobalSearchRequest): Promise<{ groups: SearchGroup[] }> {
    const needle = normalizeSearchText(q).slice(0, MAX_Q);
    // Dưới 2 ký tự thì mọi thứ đều khớp — tốn một vòng query để trả về rác.
    if (needle.length < MIN_Q) return { groups: [] };

    const capped = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const wanted = types?.length ? this.repos.filter((r) => types.includes(r.type)) : this.repos;

    const settled = await Promise.all(
      wanted.map((r) =>
        withTimeout(() => r.search({ tenantId, q: needle, limit: capped }), this.timeoutMs, r.type, this.logger),
      ),
    );

    // null = repository lỗi hoặc quá chậm. Bỏ nhóm đó, giữ phần còn lại: search
    // hỏng một loại không được phép làm hỏng cả ô tìm kiếm.
    const succeeded = settled.filter((g): g is SearchGroup => g !== null);

    // Hai repository có thể cùng `type` (vd. DocSearchRepository và
    // DocPageSearchRepository đều báo SearchType.DOC vì trang doc phải xuất
    // hiện trong nhóm Docs). Nếu key theo type vào Map/object, kết quả của
    // repository sau sẽ đè lên repository trước — mất nửa kết quả không một
    // tiếng động. Nên gộp theo type bằng cách nối items + cộng total, KHÔNG
    // gán đè.
    const merged = new Map<SearchType, SearchGroup>();
    for (const g of succeeded) {
      const existing = merged.get(g.type);
      if (existing) {
        existing.items = existing.items.concat(g.items);
        existing.total += g.total;
      } else {
        merged.set(g.type, { type: g.type, total: g.total, items: [...g.items] });
      }
    }

    const groups = [...merged.values()]
      .filter((g) => g.items.length > 0)
      .map((g) => ({
        ...g,
        items: g.items
          .map((i) => ({ ...i, score: i.score || this.score(i, needle) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, capped),
      }));

    return { groups };
  }

  /** Ba mức khớp cộng một thưởng cho thứ vừa động tới. Cố tình đơn giản: khi
   *  thứ tự ra sai, ta biết chính xác vì sao. */
  private score(hit: SearchHit, needle: string): number {
    const text = normalizeSearchText(`${hit.title} ${hit.ref}`);
    let score = 100;
    if (text.startsWith(needle)) score = 500;
    else if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) score = 300;

    const ageMs = Date.now() - new Date(hit.updatedAt).getTime();
    if (ageMs < RECENT_DAYS * 24 * 60 * 60 * 1000) score += 50;
    return score;
  }
}
