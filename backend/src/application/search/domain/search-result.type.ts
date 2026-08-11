import { SearchType } from './enums/search-type.enum';

/** Một dòng kết quả. `url` và `icon` do backend quyết định để frontend không
 *  phải tự suy đường dẫn cho từng loại. */
export interface SearchHit {
  id: string;
  /** Mã người dùng đọc được (`TSK-142`, `RM-6HCUHKX`). '' nếu loại đó không có. */
  ref: string;
  title: string;
  /** Dòng ngữ cảnh phụ ("Team Mobile · In Progress"). */
  subtitle: string;
  url: string;
  icon: string;
  /** Điểm xếp hạng — xem GlobalSearchUseCase. Không hiển thị. */
  score: number;
  updatedAt: Date;
}

export interface SearchGroup {
  type: SearchType;
  /** Tổng số khớp, có thể lớn hơn `items.length` vì bị cắt theo `limit`. */
  total: number;
  items: SearchHit[];
}

/** `q` đến đây là **đã chuẩn hoá** bằng normalizeSearchText. */
export interface SearchQuery {
  tenantId: string;
  q: string;
  limit: number;
}
