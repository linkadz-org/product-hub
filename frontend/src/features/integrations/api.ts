import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import type { CodeLinkDto, ConnectedGitHubDto, GitHubConnectionDto } from '@/types/dto';

// Keyed by subject id alone. A link's subject is a task, a bug or a backlog item
// and ids are globally unique, so one key serves all three detail pages.
const key = (subjectId: string) => ['code-links', subjectId];

const CONNECTION_KEY = ['github-connection'];

/**
 * The commits and pull requests that named this record, newest first.
 *
 * There is no invalidation to pair with this: links arrive from GitHub, not from
 * anything the user does here, so the list refreshes on the next mount like the
 * rest of the read-only panels.
 */
export function useCodeLinks(subjectId: string | undefined) {
  return useQuery({
    queryKey: key(subjectId ?? ''),
    queryFn: () => apiGet<CodeLinkDto[]>('/code-links', { subjectId }),
    enabled: !!subjectId,
  });
}

/** The workspace's GitHub connection (admin). Never carries the signing secret. */
export function useGitHubConnection(enabled = true) {
  return useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: () => apiGet<GitHubConnectionDto>('/code-links/github'),
    enabled,
  });
}

/**
 * Mint a webhook URL and signing secret. Repeating this replaces both, which is
 * how a leaked secret is rotated — the caller has to show the new secret to the
 * admin immediately, because the API will never return it again.
 */
export function useConnectGitHub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<ConnectedGitHubDto>('/code-links/github/connect', {}),
    // Refetch rather than seeding the cache from the response: that response is
    // the one shape carrying the secret, and it has no business in a query cache
    // the devtools will happily print. The caller holds it in local state for as
    // long as the dialog is open.
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTION_KEY }),
  });
}

/** Disconnect — the webhook URL stops answering and both secrets are cleared. */
export function useDisconnectGitHub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete<GitHubConnectionDto>('/code-links/github'),
    onSuccess: (data) => qc.setQueryData(CONNECTION_KEY, data),
  });
}
