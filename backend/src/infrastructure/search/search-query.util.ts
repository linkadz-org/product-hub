/**
 * Helpers dùng chung cho mọi `ISearchableRepository` implementation
 * (`infrastructure/search/repositories/*.repository.ts`). Không có phụ thuộc
 * riêng cho loại nào — issue, doc, roadmap item, project, report, testcase đều
 * cần escape input và kẹp `limit` giống hệt nhau, nên sống ở đây thay vì bị
 * copy sáu lần hoặc import chéo từ repository ra đời trước.
 */

/** Trần cứng cho mỗi nhóm kết quả — không tin `SearchQuery.limit` vì kiểu của
 *  nó không ràng buộc giá trị này (xem Task 7). */
export const SEARCH_GROUP_LIMIT_MAX = 20;

/** Kẹp `limit` người dùng/caller truyền vào trong khoảng hợp lệ. */
export function clampSearchLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return SEARCH_GROUP_LIMIT_MAX;
  return Math.min(limit, SEARCH_GROUP_LIMIT_MAX);
}

/** Escape để chuỗi tự do từ ô tìm kiếm không làm vỡ regex (`(`, `[`, `*`…).
 *  Không escape `/` — nó không có ý nghĩa đặc biệt khi đi qua constructor
 *  `new RegExp(string)` (chỉ literal `/re/` mới cần), nên escape nó là thừa. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bội số ứng viên cho ba repository phải post-filter trong bộ nhớ (report,
 *  test case, roadmap item): chúng không thể `.limit(clampedLimit)` thẳng vì
 *  hàng bị loại *sau* khi đọc (project đã xoá mềm, item không khớp), nên trần
 *  DB phải rộng hơn số muốn trả về. 10x là một biên rộng rãi có chủ đích: đủ
 *  chỗ cho một tỷ lệ loại bỏ cao (nhiều report thuộc project đã xoá, nhiều
 *  roadmap chỉ khớp 1/N item) mà vẫn chặn được trường hợp xấu nhất — một
 *  workspace có hàng chục nghìn report/roadmap khớp `searchText` — không kéo
 *  hết vào heap của Node. Không tinh chỉnh theo dữ liệu thật; đổi nếu đo được
 *  cần khác. */
export const SEARCH_CANDIDATE_MULTIPLIER = 10;

/** Trần số dòng đọc từ DB cho repository phải post-filter — xem
 *  `SEARCH_CANDIDATE_MULTIPLIER`. */
export function boundedCandidateLimit(clampedLimit: number): number {
  return clampedLimit * SEARCH_CANDIDATE_MULTIPLIER;
}

/** Điểm cộng cho một hit khớp *chính xác* một mã ref (`exactRefSearch` hoặc
 *  tương đương của từng loại) — đủ lớn để luôn nổi lên đầu trên điểm nền 0..~vài
 *  chục của một match theo văn bản thường. Named ở đây để sáu repository dùng
 *  chung một con số thay vì mỗi cái tự bịa một hằng số ma thuật. */
export const EXACT_MATCH_SCORE = 1000;
