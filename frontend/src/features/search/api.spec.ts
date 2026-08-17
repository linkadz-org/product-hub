import { describe, expect, it } from 'vitest';
import { MIN_QUERY_LENGTH, shouldSearch } from './api';

describe('shouldSearch', () => {
  it(`không tìm khi q ngắn hơn ${MIN_QUERY_LENGTH} ký tự — backend 400 dưới ngưỡng này`, () => {
    expect(shouldSearch('')).toBe(false);
    expect(shouldSearch('a')).toBe(false);
  });

  it('không tìm khi q chỉ toàn khoảng trắng, kể cả khi đủ độ dài thô', () => {
    expect(shouldSearch('  ')).toBe(false);
  });

  it(`tìm khi q đủ ${MIN_QUERY_LENGTH} ký tự trở lên`, () => {
    expect(shouldSearch('ab')).toBe(true);
    expect(shouldSearch('abc')).toBe(true);
  });
});
