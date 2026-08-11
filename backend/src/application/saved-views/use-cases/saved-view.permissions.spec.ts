import { canMutateSavedView, sortSavedViews } from './saved-view.use-cases';
// Đã kiểm chứng: Role nằm ở @core/interfaces (issues.controller.ts:13)
import { Role } from '@core/interfaces';

const view = (ownerId: string, shared = false) => ({ ownerId, shared });

describe('canMutateSavedView', () => {
  it('chủ sở hữu sửa được view của mình', () => {
    expect(canMutateSavedView(view('u1'), { id: 'u1', role: Role.TESTER })).toBe(true);
  });

  it('người khác KHÔNG sửa được view riêng tư', () => {
    expect(canMutateSavedView(view('u1'), { id: 'u2', role: Role.TESTER })).toBe(false);
  });

  it('người khác KHÔNG sửa được view shared', () => {
    expect(canMutateSavedView(view('u1', true), { id: 'u2', role: Role.PRODUCT })).toBe(false);
  });

  it('admin sửa được mọi view', () => {
    expect(canMutateSavedView(view('u1', true), { id: 'u2', role: Role.ADMIN })).toBe(true);
  });
});

describe('sortSavedViews', () => {
  it('view của tôi trước (theo order), view shared sau (theo tên A→Z)', () => {
    const rows = [
      { id: 'c', ownerId: 'u2', shared: true, name: 'Beta', order: 0 },
      { id: 'a', ownerId: 'u1', shared: false, name: 'Zeta', order: 1 },
      { id: 'b', ownerId: 'u1', shared: false, name: 'Alpha', order: 0 },
      { id: 'd', ownerId: 'u3', shared: true, name: 'Alpha', order: 9 },
    ];
    expect(sortSavedViews(rows, 'u1').map((v) => v.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});
