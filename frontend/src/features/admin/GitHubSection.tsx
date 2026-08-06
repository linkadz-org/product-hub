import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Copy, GitBranch } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
} from '@/components/ui';
import { RowsSkeleton } from '@/components/Skeletons';
import { t } from '@/i18n';
import { env } from '@/lib/env';
import { timeAgo } from '@/lib/format';
import type { ConnectedGitHubDto } from '@/types/dto';
import { useConnectGitHub, useDisconnectGitHub, useGitHubConnection } from '@/features/integrations/api';

/** Remembers an edited base URL, so the tab doesn't forget the public host. */
const BASE_KEY = 'ph_github_webhook_base';

/** The URL this browser talks to — right whenever the API is publicly reachable. */
const defaultBase = () => env.apiUrl.replace(/\/$/, '');

const webhookUrl = (base: string, token: string) =>
  `${base.replace(/\/$/, '') || defaultBase()}/integrations/github/webhook/${token}`;

/**
 * Settings → GitHub.
 *
 * Turns commit messages into links on a detail page: write `TSK-6HCUHKX` in a
 * commit, a branch name or a PR title and the commit shows up on that task.
 *
 * Setup is two secrets with two different jobs, which is why they're presented
 * as one URL and one Secret rather than a pile of fields. The URL names the
 * workspace (a GitHub delivery carries nothing that identifies us) and is safe
 * to show whenever it's asked for; the Secret proves the delivery really came
 * from GitHub, and — like an API key — is shown once and never again.
 */
export function GitHubSection() {
  const { data, isLoading } = useGitHubConnection();
  const connect = useConnectGitHub();
  const disconnect = useDisconnectGitHub();
  const [created, setCreated] = useState<ConnectedGitHubDto | null>(null);
  const [base, setBase] = useState(() => localStorage.getItem(BASE_KEY) || defaultBase());
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const connected = !!data?.connected;
  const url = data?.token ? webhookUrl(base, data.token) : '';

  function onBaseChange(value: string) {
    setBase(value);
    localStorage.setItem(BASE_KEY, value);
  }

  function onConnect() {
    setConfirmRegen(false);
    connect.mutate(undefined, { onSuccess: setCreated });
  }

  function onDisconnect() {
    setConfirmOff(false);
    disconnect.mutate(undefined, {
      onSuccess: () => toast.success(t('settings.githubDisconnected')),
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.github')}</CardTitle>
        </CardHeader>
        <CardContent>
          <RowsSkeleton />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-4" aria-hidden />
            {t('settings.github')}
          </CardTitle>
          <CardDescription>{t('settings.githubHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Step n={1} title={t('settings.githubStep1')} hint={t('settings.githubStep1Hint')}>
            {connected ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  {t('settings.githubConnected')}
                </span>
                {/* Confirmed, unlike the first Connect: this one *replaces* a URL
                    and secret that repos are delivering to right now, and the
                    breakage is silent — GitHub 401s into its own delivery log
                    while the app just stops receiving. */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRegen(true)}
                  loading={connect.isPending}
                >
                  {t('settings.githubRegenerate')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>
                  {t('settings.githubDisconnect')}
                </Button>
              </div>
            ) : (
              <Button onClick={onConnect} loading={connect.isPending}>
                {t('settings.githubConnect')}
              </Button>
            )}
            {connected && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t('settings.githubRegenerateHint')}
              </p>
            )}
          </Step>

          <Step n={2} title={t('settings.githubStep2')} hint={t('settings.githubStep2Hint')}>
            {connected ? (
              <div className="space-y-4">
                <div className="sm:max-w-lg">
                  <label
                    htmlFor="gh-base"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
                  >
                    {t('settings.githubBase')}
                  </label>
                  <Input
                    id="gh-base"
                    value={base}
                    onChange={(e) => onBaseChange(e.target.value)}
                    placeholder={defaultBase()}
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {t('settings.githubBaseHint')}
                  </p>
                </div>
                <Labelled label={t('settings.githubPayloadUrl')}>
                  <Snippet code={url} />
                </Labelled>
                <div className="grid gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <p>{t('settings.githubContentType')}</p>
                  <p>{t('settings.githubEvents')}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('settings.githubStep2Locked')}</p>
            )}
          </Step>

          <Step n={3} title={t('settings.githubStep3')} hint={t('settings.githubStep3Hint')}>
            <pre className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed">
              <code>{'git commit -m "TSK-6HCUHKX fix the login redirect"'}</code>
            </pre>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t('settings.githubRefsHint')}
            </p>
          </Step>
        </CardContent>
      </Card>

      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.githubActivity')}</CardTitle>
            <CardDescription>{t('settings.githubActivityHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data?.lastEventAt ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  {t('settings.githubReceiving')}
                </span>
                <span className="text-muted-foreground">
                  {[data.lastEventRepo, timeAgo(data.lastEventAt)].filter(Boolean).join(' · ')}
                </span>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t('settings.githubWaiting')}
              </div>
            )}

            {(data?.connectedRepos.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data!.connectedRepos.map((repo) => (
                  <span
                    key={repo}
                    className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
                  >
                    {repo}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* The one moment the signing secret exists in the clear — so it comes with
          the URL it belongs beside, not just the string on its own. */}
      <Dialog
        open={!!created}
        onClose={() => setCreated(null)}
        title={t('settings.githubReady')}
        footer={<Button onClick={() => setCreated(null)}>{t('common.done')}</Button>}
      >
        <p className="text-sm text-muted-foreground">{t('settings.githubReadyHint')}</p>
        <div className="mt-3 space-y-4">
          <Labelled label={t('settings.githubPayloadUrl')}>
            <Snippet code={created ? webhookUrl(base, created.token) : ''} />
          </Labelled>
          <Labelled label={t('settings.githubSecret')}>
            <Snippet code={created?.secret ?? ''} />
          </Labelled>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('settings.githubSecretOnce')}
          </p>
        </div>
      </Dialog>

      {/* Names the repos that are about to go quiet, when we know them — a list of
          three is what turns "update the webhook after" into a job with a size.
          A workspace that has received nothing yet has none to name, and the
          warning stands on its own text. */}
      <Dialog
        open={confirmRegen}
        onClose={() => setConfirmRegen(false)}
        title={t('settings.githubRegenerate')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRegen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={onConnect} loading={connect.isPending}>
              {t('settings.githubRegenerate')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t('settings.githubRegenerateConfirm')}</p>
        {(data?.connectedRepos.length ?? 0) > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t('settings.githubRegenerateRepos')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {data!.connectedRepos.map((repo) => (
                <span
                  key={repo}
                  className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {repo}
                </span>
              ))}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title={t('settings.githubDisconnect')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOff(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={onDisconnect} loading={disconnect.isPending}>
              {t('settings.githubDisconnect')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t('settings.githubDisconnectConfirm')}</p>
      </Dialog>
    </div>
  );
}

/** One numbered setup step — the badge keeps the sequence readable on mobile. */
function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="flex gap-3 sm:gap-4">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mb-3 mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        {children}
      </div>
    </section>
  );
}

/** A snippet under the name of the GitHub field it goes into. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** A copyable code block. Horizontally scrollable so a long URL never stretches
 *  the settings column on a phone. */
function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="shrink-0" onClick={copy}>
          <Copy className="mr-1.5 size-3.5" />
          {copied ? t('settings.copied') : t('settings.copy')}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
        <code className="break-all">{code}</code>
      </pre>
    </div>
  );
}
