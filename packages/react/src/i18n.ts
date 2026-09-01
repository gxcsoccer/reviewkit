/**
 * Basic internationalization (PRD 9.1: "theme variables, dark mode and basic i18n").
 *
 * Deliberately tiny: a flat message record, `{placeholder}` interpolation, and no
 * dependency on an i18n framework. Hosts either pick a bundled locale or pass
 * `messages` to override individual keys — partial overrides fall back to English,
 * so an upgrade that adds keys never renders blank labels.
 */

export const en = {
  'action.approve': 'Approve',
  'action.approveSelected': 'Approve {count} selected',
  'action.approveEdited': 'Approve edited version',
  'action.reject': 'Reject',
  'action.rejectSelected': 'Reject {count} selected',
  'action.defer': 'Defer',
  'action.requestChanges': 'Request changes',
  'action.edit': 'Edit',
  'action.save': 'Save changes',
  'action.cancel': 'Cancel',
  'action.execute': 'Send to host for execution',
  'action.clearSelection': 'Clear selection',
  'action.selectAll': 'Select all',
  'action.showRaw': 'Show raw parameters',
  'action.hideRaw': 'Hide raw parameters',
  'action.onlyChanges': 'Only changed fields',
  'action.allFields': 'All fields',
  'action.onlyHighRisk': 'Only high risk',
  'action.onlyProblems': 'Only problem items',
  'action.acknowledgeHighRisk': 'I reviewed each high-risk item',
  'action.refresh': 'Refresh source data',
  'action.dismiss': 'Dismiss',
  'action.retry': 'Retry',
  'action.open': 'Open',

  'label.proposal': 'Proposal',
  'label.summary': 'What will happen',
  'label.impact': 'How many objects',
  'label.reason': "Agent's reason",
  'label.evidence': 'Evidence',
  'label.risk': 'Risk',
  'label.status': 'Status',
  'label.items': 'Items',
  'label.changes': 'Changes',
  'label.created': 'Created',
  'label.expires': 'Expires',
  'label.version': 'Version',
  'label.contentHash': 'Content hash',
  'label.target': 'Target',
  'label.initiatedBy': 'Requested by',
  'label.before': 'Before',
  'label.after': 'After',
  'label.field': 'Field',
  'label.rawParams': 'Raw parameters (exact execution payload)',
  'label.diff': 'Changes',
  'label.decision': 'Decision',
  'label.reviewer': 'Reviewer',
  'label.rejectReason': 'Why are you rejecting this?',
  'label.deferUntil': 'Defer until',
  'label.note': 'Note',
  'label.filters': 'Filters',
  'label.search': 'Search',
  'label.rows': 'Records',
  'label.columns': 'Columns',
  'label.selected': '{count} selected',
  'label.masked': '{count} masked field(s) in this item',
  'label.executionResult': 'Execution result',
  'label.externalRef': 'External reference',
  'label.keyboard': 'Keyboard shortcuts',

  'rejectTag.wrong_scope': 'Wrong scope',
  'rejectTag.wrong_data': 'Wrong data',
  'rejectTag.too_risky': 'Too risky',
  'rejectTag.not_now': 'Not now',
  'rejectTag.duplicate': 'Duplicate',
  'rejectTag.policy': 'Against policy',
  'rejectTag.other': 'Other',

  'status.draft': 'Draft',
  'status.pending_review': 'Pending review',
  'status.reviewing': 'In review',
  'status.changes_requested': 'Changes requested',
  'status.approved': 'Approved',
  'status.rejected': 'Rejected',
  'status.expired': 'Expired',
  'status.cancelled': 'Cancelled',
  'status.superseded': 'Superseded',
  'status.invalidated': 'Invalidated',

  'itemStatus.pending': 'Pending',
  'itemStatus.approved': 'Approved',
  'itemStatus.rejected': 'Rejected',
  'itemStatus.edited': 'Edited',
  'itemStatus.deferred': 'Deferred',
  'itemStatus.invalidated': 'Invalidated',

  'risk.low': 'Low risk',
  'risk.medium': 'Medium risk',
  'risk.high': 'High risk',
  'risk.critical': 'Critical risk',

  'operation.create': 'Create',
  'operation.update': 'Update',
  'operation.delete': 'Delete',
  'operation.send': 'Send',
  'operation.invoke': 'Invoke',
  'operation.other': 'Change',

  'change.added': 'Added',
  'change.removed': 'Removed',
  'change.changed': 'Changed',
  'change.unchanged': 'Unchanged',

  'exec.not_started': 'Not started',
  'exec.queued': 'Queued',
  'exec.running': 'Running',
  'exec.succeeded': 'All items succeeded',
  'exec.partially_succeeded': 'Partially succeeded',
  'exec.failed': 'Failed',
  'exec.rolled_back': 'Rolled back',
  'exec.counts': '{succeeded} succeeded, {failed} failed, {skipped} skipped',
  'exec.hashMismatch':
    'The host reported parameters that do not match what you approved. ReviewKit refused this execution.',
  'exec.itemSucceeded': 'Succeeded',
  'exec.itemFailed': 'Failed',
  'exec.itemSkipped': 'Skipped',
  'exec.rollback': 'Rollback: {status}',

  'notice.editedVersion':
    'You are approving version {version} — the edited version. New content hash: {hash}.',
  'notice.sourceChanged':
    'The source data changed while this was in review. The diff was rebuilt and the old approval no longer applies.',
  'notice.expired': 'This proposal expired and can no longer be executed.',
  'notice.readOnly': 'This proposal is {status}: no further decisions are possible.',
  'notice.highRiskBlocked':
    '{count} high-risk item(s) cannot be approved in bulk. Open each one, or confirm you reviewed them.',
  'notice.nothingSelected': 'Select at least one item first.',
  'notice.rawParams': 'This is the exact payload the host will execute — not the agent summary.',
  'notice.noProposals': 'Nothing waiting for review.',
  'notice.noItems': 'This proposal has no items.',
  'notice.loading': 'Loading…',
  'notice.approved': 'Approved {count} item(s) as version {version}.',
  'notice.rejected': 'Rejected.',
  'notice.deferred': 'Deferred.',
  'notice.changesRequested': 'Changes requested.',

  'error.title': 'Something needs your attention',
  'error.hint': 'What to do',
  'error.details': 'Details',
  'error.invalidJson': 'This is not valid JSON: {message}',
  'error.noProvider':
    'useReviewKit() was called outside <ReviewKitProvider>. Wrap your app in <ReviewKitProvider>, or use <ActionReview> which creates its own session.',

  'keyboard.approve': 'A — approve',
  'keyboard.reject': 'R — reject',
  'keyboard.defer': 'D — defer',
  'keyboard.edit': 'E — edit the focused item',
  'keyboard.navigate': 'J / K or arrow keys — move between items',
  'keyboard.select': 'X or Space — select the focused item',
  'keyboard.raw': 'P — show raw parameters',

  'a11y.itemList': 'Items in this proposal',
  'a11y.proposalList': 'Proposals waiting for review',
  'a11y.diff': 'Before and after comparison',
  'a11y.status': 'Review status updates',
  'a11y.selectItem': 'Select item {id}',
  'a11y.riskBadge': 'Risk level: {risk}',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
export type MessageOverrides = Partial<Record<MessageKey, string>>;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Simplified Chinese, the second bundled locale (PRD 9.1). */
export const zhCN: Messages = {
  'action.approve': '批准',
  'action.approveSelected': '批准所选 {count} 项',
  'action.approveEdited': '批准修改后的版本',
  'action.reject': '拒绝',
  'action.rejectSelected': '拒绝所选 {count} 项',
  'action.defer': '延后',
  'action.requestChanges': '要求修改',
  'action.edit': '编辑',
  'action.save': '保存修改',
  'action.cancel': '取消',
  'action.execute': '交由宿主执行',
  'action.clearSelection': '清除选择',
  'action.selectAll': '全选',
  'action.showRaw': '查看原始参数',
  'action.hideRaw': '收起原始参数',
  'action.onlyChanges': '仅看变化字段',
  'action.allFields': '全部字段',
  'action.onlyHighRisk': '仅看高风险项',
  'action.onlyProblems': '仅看异常项',
  'action.acknowledgeHighRisk': '我已逐条查看高风险项',
  'action.refresh': '刷新源数据',
  'action.dismiss': '关闭',
  'action.retry': '重试',
  'action.open': '打开',

  'label.proposal': '提议',
  'label.summary': '将发生什么',
  'label.impact': '影响多少对象',
  'label.reason': 'Agent 理由',
  'label.evidence': '证据',
  'label.risk': '风险',
  'label.status': '状态',
  'label.items': '条目',
  'label.changes': '变更',
  'label.created': '创建时间',
  'label.expires': '过期时间',
  'label.version': '版本',
  'label.contentHash': '内容哈希',
  'label.target': '目标系统',
  'label.initiatedBy': '发起者',
  'label.before': '修改前',
  'label.after': '修改后',
  'label.field': '字段',
  'label.rawParams': '原始参数（实际执行载荷）',
  'label.diff': '变更对比',
  'label.decision': '审阅决定',
  'label.reviewer': '审阅者',
  'label.rejectReason': '拒绝理由',
  'label.deferUntil': '延后至',
  'label.note': '备注',
  'label.filters': '筛选',
  'label.search': '搜索',
  'label.rows': '记录',
  'label.columns': '列',
  'label.selected': '已选 {count} 项',
  'label.masked': '该条目有 {count} 个遮罩字段',
  'label.executionResult': '执行结果',
  'label.externalRef': '外部引用',
  'label.keyboard': '键盘快捷键',

  'rejectTag.wrong_scope': '范围不对',
  'rejectTag.wrong_data': '数据不对',
  'rejectTag.too_risky': '风险过高',
  'rejectTag.not_now': '暂不执行',
  'rejectTag.duplicate': '重复动作',
  'rejectTag.policy': '违反规定',
  'rejectTag.other': '其他',

  'status.draft': '草稿',
  'status.pending_review': '待审阅',
  'status.reviewing': '审阅中',
  'status.changes_requested': '待修改',
  'status.approved': '已批准',
  'status.rejected': '已拒绝',
  'status.expired': '已过期',
  'status.cancelled': '已取消',
  'status.superseded': '已被替代',
  'status.invalidated': '已失效',

  'itemStatus.pending': '待处理',
  'itemStatus.approved': '已批准',
  'itemStatus.rejected': '已拒绝',
  'itemStatus.edited': '已修改',
  'itemStatus.deferred': '已延后',
  'itemStatus.invalidated': '已失效',

  'risk.low': '低风险',
  'risk.medium': '中风险',
  'risk.high': '高风险',
  'risk.critical': '极高风险',

  'operation.create': '新建',
  'operation.update': '更新',
  'operation.delete': '删除',
  'operation.send': '发送',
  'operation.invoke': '调用',
  'operation.other': '变更',

  'change.added': '新增',
  'change.removed': '删除',
  'change.changed': '修改',
  'change.unchanged': '未变',

  'exec.not_started': '未开始',
  'exec.queued': '已排队',
  'exec.running': '执行中',
  'exec.succeeded': '全部成功',
  'exec.partially_succeeded': '部分成功',
  'exec.failed': '全部失败',
  'exec.rolled_back': '已回滚',
  'exec.counts': '成功 {succeeded} 项，失败 {failed} 项，跳过 {skipped} 项',
  'exec.hashMismatch': '宿主回传的执行参数与你批准的内容不一致，ReviewKit 已拒绝该次执行。',
  'exec.itemSucceeded': '成功',
  'exec.itemFailed': '失败',
  'exec.itemSkipped': '跳过',
  'exec.rollback': '回滚：{status}',

  'notice.editedVersion': '你批准的是修改后的版本 v{version}，新内容哈希 {hash}。',
  'notice.sourceChanged': '审阅期间源数据已变化，Diff 已重新生成，旧的批准不再有效。',
  'notice.expired': '该提议已过期，不能继续执行。',
  'notice.readOnly': '该提议当前为「{status}」，无法继续做出决定。',
  'notice.highRiskBlocked': '{count} 个高风险条目默认不能批量批准。请逐条打开，或确认你已逐条查看。',
  'notice.nothingSelected': '请先选择至少一个条目。',
  'notice.rawParams': '这是宿主将要执行的实际载荷，不是 Agent 的自然语言总结。',
  'notice.noProposals': '当前没有待审阅的提议。',
  'notice.noItems': '该提议没有条目。',
  'notice.loading': '加载中…',
  'notice.approved': '已批准 {count} 项，版本 v{version}。',
  'notice.rejected': '已拒绝。',
  'notice.deferred': '已延后。',
  'notice.changesRequested': '已要求修改。',

  'error.title': '需要你处理一个问题',
  'error.hint': '如何处理',
  'error.details': '详细信息',
  'error.invalidJson': 'JSON 无效：{message}',
  'error.noProvider': 'useReviewKit() 必须在 <ReviewKitProvider> 内使用，或直接使用自带 session 的 <ActionReview>。',

  'keyboard.approve': 'A —— 批准',
  'keyboard.reject': 'R —— 拒绝',
  'keyboard.defer': 'D —— 延后',
  'keyboard.edit': 'E —— 编辑当前条目',
  'keyboard.navigate': 'J / K 或方向键 —— 切换条目',
  'keyboard.select': 'X 或空格 —— 选择当前条目',
  'keyboard.raw': 'P —— 查看原始参数',

  'a11y.itemList': '该提议的条目列表',
  'a11y.proposalList': '待审阅提议列表',
  'a11y.diff': '修改前后对比',
  'a11y.status': '审阅状态更新',
  'a11y.selectItem': '选择条目 {id}',
  'a11y.riskBadge': '风险等级：{risk}',
};

export const LOCALES = { en, 'zh-CN': zhCN } as const;
export type Locale = keyof typeof LOCALES;

/** `zh`, `zh-Hans`, `zh-CN` all resolve to the bundled Chinese pack. */
export function resolveLocale(locale: string | undefined): Locale {
  if (!locale) return 'en';
  const lower = locale.toLowerCase();
  if (lower === 'zh-cn' || lower === 'zh' || lower.startsWith('zh-hans') || lower.startsWith('zh')) return 'zh-CN';
  return 'en';
}

export function resolveMessages(locale: string | undefined, overrides?: MessageOverrides): Messages {
  const base = LOCALES[resolveLocale(locale)];
  if (!overrides) return base;
  // English is the last resort for any key a host locale forgot.
  return { ...en, ...base, ...overrides };
}

/** `{count}` style interpolation. Unknown placeholders are left as-is, not blanked. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}

export function createTranslate(messages: Messages): Translate {
  return (key, params) => interpolate(messages[key] ?? en[key] ?? key, params);
}
