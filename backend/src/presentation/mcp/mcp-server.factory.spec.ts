import { McpServerFactory } from './mcp-server.factory';
import { McpBugStatsResponseDto } from '@application/mcp/dtos/mcp-analytics.response.dto';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import type { McpActor } from '@application/mcp/use-cases';

/** `describeBugStats` reads no injected dependency, so the factory doesn't need
 *  a real constructor call — just its prototype, to reach the private method
 *  without standing up the other nineteen use-case collaborators. */
function factory(): McpServerFactory {
  return Object.create(McpServerFactory.prototype) as McpServerFactory;
}

function baseStats(overrides: Partial<McpBugStatsResponseDto>): McpBugStatsResponseDto {
  return {
    total: 3,
    teamName: '',
    since: '',
    until: '',
    dimensions: [],
    trend: [],
    trendUnit: '',
    trendSince: '',
    trendUntil: '',
    ...overrides,
  } as McpBugStatsResponseDto;
}

/**
 * Registration itself. `create` only *reads* the injected use-cases inside the
 * tool callbacks, so the prototype trick above reaches it too — which is what
 * makes it cheap to assert that every tool's schema is well-formed enough for the
 * SDK to accept it. A malformed zod shape throws here rather than at the first
 * call in production.
 */
describe('McpServerFactory.create — registered tools', () => {
  const actor: McpActor = {
    tenantId: 't1',
    keyId: 'k1',
    keyName: 'CI',
    userId: 'u1',
    scope: ApiKeyScope.READ_WRITE,
    clientName: 'claude-code/1.0',
  };
  const toolNames = (): string[] => {
    const server = factory().create({ actor });
    return Object.keys((server as unknown as { _registeredTools: object })._registeredTools);
  };

  it('exposes upload_file — the only tool that carries bytes', () => {
    expect(toolNames()).toContain('upload_file');
  });

  it('still exposes the tools it had before, so nothing was traded for it', () => {
    expect(toolNames()).toEqual(
      expect.arrayContaining(['list_workspace', 'create_issue', 'update_issue', 'add_comment']),
    );
  });
});

describe('McpServerFactory.describeBugStats — scope line date filter', () => {
  const describe_ = (s: McpBugStatsResponseDto): string =>
    (factory() as unknown as { describeBugStats(s: McpBugStatsResponseDto): string }).describeBugStats(s);

  it('states both bounds when since and until are set', () => {
    const out = describe_(baseStats({ since: '2026-01-01', until: '2026-03-31' }));
    expect(out).toContain('opened 2026-01-01 → 2026-03-31');
  });

  it('states the filter when only since is set (no dangling arrow)', () => {
    const out = describe_(baseStats({ since: '2026-01-01', until: '' }));
    expect(out).toContain('opened on or after 2026-01-01');
    expect(out).not.toContain('→');
  });

  it('states the filter when only until is set, instead of silently dropping it', () => {
    const out = describe_(baseStats({ since: '', until: '2026-03-01' }));
    expect(out).toContain('opened on or before 2026-03-01');
  });

  it('does not report the date-filtered count as the unfiltered workspace total', () => {
    const withDateFilter = describe_(baseStats({ since: '', until: '2026-03-01' }));
    const withoutFilter = describe_(baseStats({}));
    expect(withDateFilter).not.toBe(withoutFilter);
  });

  it('falls back to "whole workspace" with no date bounds and no team', () => {
    const out = describe_(baseStats({}));
    expect(out).toContain('whole workspace');
  });
});
