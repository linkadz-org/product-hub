/** What kind of thing changed. */
export enum AuditEntity {
  TESTCASE = 'testcase',
  REPORT = 'report',
  ISSUE = 'issue',
  DOC_PAGE = 'doc_page',
  ROADMAP_ITEM = 'roadmap_item',
}

/** Who made the change.
 *
 * `SYSTEM` is reserved for date-driven cascades that genuinely have no human
 * behind them — cycle rollover is the only one today. It runs lazily whenever
 * somebody next reads the issue list, so the person who "triggered" it is
 * whoever happened to open the board; naming them would be actively misleading.
 *
 * A change a person or an API key caused is never SYSTEM, even when it cascades
 * — those carry the real actor plus `automated: true`. */
export enum AuditActor {
  USER = 'user',
  API = 'api',
  SYSTEM = 'system',
}
