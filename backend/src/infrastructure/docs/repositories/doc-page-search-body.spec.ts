import { SEARCH_BODY_MAX } from '@module-shared/utils/search-text.util';
import { DocPageEntity } from '@application/docs/domain/entities/doc-page.entity';
import { DocPageRepository } from './doc-page.repository';

/**
 * `DocPageRepository.toDocument()` is a second, independent writer of
 * `searchBody` alongside the collab server's raw-Mongo mirror (Task 5) — the
 * `saveMany`/`updateMany` bulkWrite paths (duplicating or reordering pages)
 * never touch collab at all, so this repository must compute the same field or
 * a duplicated tree's pages go unsearchable. These tests exercise
 * `toDocument()` directly (no Mongo connection needed — it's a pure mapper).
 */
describe('DocPageRepository.toDocument searchBody', () => {
  // `DocPageRepository`'s constructor only stores the injected model on
  // `this.model` for use by the async methods; `toDocument` never touches it.
  const repo = new DocPageRepository({} as never);

  function page(content: string) {
    const result = DocPageEntity.create({
      tenantId: 't1',
      docId: 'd1',
      title: 'Trang test',
      content,
    });
    if (result.isFailure) throw new Error(result.error as string);
    return result.getValue();
  }

  it('bóc HTML trước khi chuẩn hoá — markup không lọt vào searchBody', () => {
    const doc = repo.toDocument(page('<p>Đăng nhập</p><p>bằng OTP</p>'));
    expect(doc.searchBody).toBe('dang nhap bang otp');
    expect(doc.searchBody).not.toContain('<');
    expect(doc.searchBody).not.toContain('>');
  });

  it('cắt tại SEARCH_BODY_MAX ký tự trước khi chuẩn hoá', () => {
    const html = `<p>Đăng nhập</p><p>${'x'.repeat(SEARCH_BODY_MAX)}</p>`;
    const doc = repo.toDocument(page(html));
    expect(doc.searchBody!.startsWith('dang nhap')).toBe(true);
    expect(doc.searchBody!.length).toBeLessThanOrEqual(SEARCH_BODY_MAX);
  });

  it('content rỗng cho searchBody rỗng', () => {
    const doc = repo.toDocument(page(''));
    expect(doc.searchBody).toBe('');
  });
});
