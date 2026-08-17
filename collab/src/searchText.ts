/* GENERATED FILE — do not edit here.
 *
 * Copied verbatim from backend/src/shared/utils/search-text.util.ts by `npm run sync`.
 * Edit the source, run the script, commit both. `npm run typecheck` fails if
 * this copy and its source have drifted.
 */
/**
 * Chuẩn hoá chuỗi để tìm kiếm: bỏ dấu tiếng Việt, hạ chữ thường, gộp khoảng
 * trắng. Chữ Hàn/CJK đi qua nguyên vẹn (không có dấu để bỏ).
 *
 * ⚠️ FILE NÀY BỊ COPY VERBATIM SANG `collab/src/searchText.ts` bởi
 * `collab/scripts/sync-shared.ts`. TUYỆT ĐỐI KHÔNG THÊM IMPORT — bản copy nằm ở
 * thư mục khác nên mọi đường dẫn import sẽ vỡ. `npm run typecheck` của collab sẽ
 * fail nếu hai bản lệch nhau.
 */

/** Số ký tự tối đa lưu vào `searchBody` của một doc page. */
export const SEARCH_BODY_MAX = 5000;

export function normalizeSearchText(input: string): string {
  if (!input) return '';
  return input
    // NFD tách nguyên âm khỏi dấu thanh: "ậ" → "a" + U+0323 + U+0302
    .normalize('NFD')
    // Bỏ mọi dấu thanh vừa tách ra.
    .replace(/[̀-ͯ]/g, '')
    // NFC để tái thành phố các ký tự đã bị tách (tiếng Hàn/CJK).
    .normalize('NFC')
    // NFD KHÔNG tách được "đ" — nó là một ký tự riêng, không phải d + dấu.
    // Đây là chỗ mọi implementation tiếng Việt hay sai.
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nối nhiều phần thành một chuỗi tìm kiếm, bỏ qua phần rỗng. */
export function buildSearchText(...parts: (string | undefined | null)[]): string {
  return normalizeSearchText(parts.filter(Boolean).join(' '));
}
