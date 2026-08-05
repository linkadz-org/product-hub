import { AggregateRoot, UniqueEntityID } from '@core/domain';
import { Result } from '@shared/logic/result';
import { Guard } from '@shared/logic/guard';
import { BugStatusConfig, DEFAULT_BUG_STATUSES } from '@application/bugs/domain/enums/bug.enums';
import { TaskStatusConfig, DEFAULT_TASK_STATUSES } from '@application/tasks/domain/enums/task.enums';
import {
  GitHubConnection,
  normalizeGitHubConnection,
} from '@application/integrations/domain/github.types';
import { WebhookConfig, normalizeWebhook } from './webhook.types';
import { CloudStorageConfig, defaultStorageConfig } from './storage.types';

interface AppSettingsProps {
  tenantId: string;
  webhooks: WebhookConfig[];
  bugStatuses: BugStatusConfig[];
  taskStatuses: TaskStatusConfig[];
  storage: CloudStorageConfig;
  github: GitHubConnection;
  createdAt: Date;
  updatedAt: Date;
}

/** Per-tenant settings singleton. Holds outbound webhook config (Phase 5); bug
 * statuses/fields configuration will live here too as the product grows. */
export class AppSettingsEntity extends AggregateRoot<AppSettingsProps> {
  private constructor(props: AppSettingsProps, id?: UniqueEntityID) {
    super(props, id);
  }

  static create(
    props: {
      tenantId: string;
      webhooks?: WebhookConfig[];
      bugStatuses?: BugStatusConfig[];
      taskStatuses?: TaskStatusConfig[];
      storage?: CloudStorageConfig;
      github?: GitHubConnection;
      createdAt?: Date;
      updatedAt?: Date;
    },
    id?: UniqueEntityID,
  ): Result<AppSettingsEntity> {
    const guard = Guard.againstNullOrUndefined(props.tenantId, 'tenantId');
    if (!guard.succeeded) return Result.fail(guard.message);
    const now = new Date();
    return Result.ok(
      new AppSettingsEntity(
        {
          tenantId: props.tenantId,
          webhooks: (props.webhooks ?? []).map(normalizeWebhook),
          // Fall back to the shipped defaults for tenants that predate the field.
          bugStatuses: props.bugStatuses?.length ? props.bugStatuses : DEFAULT_BUG_STATUSES,
          taskStatuses: props.taskStatuses?.length ? props.taskStatuses : DEFAULT_TASK_STATUSES,
          // Merge over defaults so provider + size caps are always present, even
          // for docs that predate the storage field or persist a partial config.
          storage: props.storage
            ? { ...defaultStorageConfig(), ...props.storage }
            : defaultStorageConfig(),
          // Same treatment: a tenant that predates the GitHub link reads as
          // "never connected" rather than as a doc with holes in it.
          github: normalizeGitHubConnection(props.github),
          createdAt: props.createdAt || now,
          updatedAt: props.updatedAt || now,
        },
        id,
      ),
    );
  }

  get id(): UniqueEntityID {
    return this._id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get webhooks(): WebhookConfig[] {
    return this.props.webhooks;
  }
  get bugStatuses(): BugStatusConfig[] {
    return this.props.bugStatuses;
  }
  get taskStatuses(): TaskStatusConfig[] {
    return this.props.taskStatuses;
  }
  get storage(): CloudStorageConfig {
    return this.props.storage;
  }
  get github(): GitHubConnection {
    return this.props.github;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  setWebhooks(webhooks: WebhookConfig[]): void {
    this.props.webhooks = webhooks;
    this.props.updatedAt = new Date();
  }

  setBugStatuses(bugStatuses: BugStatusConfig[]): void {
    this.props.bugStatuses = bugStatuses;
    this.props.updatedAt = new Date();
  }

  setTaskStatuses(taskStatuses: TaskStatusConfig[]): void {
    this.props.taskStatuses = taskStatuses;
    this.props.updatedAt = new Date();
  }

  setStorage(storage: CloudStorageConfig): void {
    this.props.storage = storage;
    this.props.updatedAt = new Date();
  }

  setGitHub(github: GitHubConnection): void {
    this.props.github = github;
    this.props.updatedAt = new Date();
  }

  /**
   * Record an accepted delivery: when it arrived and which repo it came from,
   * plus the repo in the connected list the first time we see it. This is what
   * turns Settings from "here is a URL, good luck" into a page that can say the
   * link is working.
   */
  recordGitHubDelivery(repo: string, at: Date): void {
    const github = this.props.github;
    this.props.github = {
      ...github,
      lastEventAt: at,
      lastEventRepo: repo || github.lastEventRepo,
      connectedRepos:
        repo && !github.connectedRepos.includes(repo)
          ? [...github.connectedRepos, repo]
          : github.connectedRepos,
    };
    this.props.updatedAt = new Date();
  }
}
