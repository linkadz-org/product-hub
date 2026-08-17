import { SearchGroup, SearchQuery } from '../domain/search-result.type';
import { SearchType } from '../domain/enums/search-type.enum';

/**
 * Một nguồn tìm kiếm. Mỗi collection có hình dạng riêng (issue phẳng, roadmap
 * item nhúng trong mảng, test case nhúng hai tầng) nên mỗi loại một
 * implementation — nhưng use-case chỉ thấy đúng interface này, nên thêm loại mới
 * là thêm một file, không sửa use-case.
 *
 * Đây cũng là chỗ để sau này thay ruột sang Meilisearch mà không đụng controller
 * lẫn frontend.
 */
export interface ISearchableRepository {
  readonly type: SearchType;
  search(query: SearchQuery): Promise<SearchGroup>;
}

/** DI token — mọi implementation đăng ký vào cùng token này để use-case inject
 *  được cả mảng. */
export const ISearchableRepository = Symbol('ISearchableRepository');
