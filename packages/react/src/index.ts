/**
 * @reviewkit/react — review UI for agent actions, on top of `@reviewkit/core`.
 *
 * The 10-minute path (PRD 20) is one component and one import of the stylesheet:
 *
 * ```tsx
 * import { ActionReview } from '@reviewkit/react';
 * import '@reviewkit/react/styles.css';
 *
 * <ActionReview
 *   proposal={{ type: 'crm.contact.update', before, after, risk: 'medium' }}
 *   onDecision={(decision) => console.log(decision.kind, decision.approvedContentHash)}
 *   onRequestExecution={(request) => applyInHostApplication(request.payload)}
 * />
 * ```
 *
 * Nothing here talks to a network by default: state lives in the session's store,
 * which is in memory unless the host swaps it (PRD 12.1).
 */

/* Components */
export * from './components/index.js';

/* Renderers and the custom-renderer contract */
export * from './renderers/index.js';

/* Provider and hooks */
export {
  ReviewKitProvider,
  useOptionalReviewKit,
  useReviewKit,
  useReviewSession,
  useTranslate,
  type ReviewKitContextValue,
  type ReviewKitProviderProps,
  type ThemeMode,
} from './context.js';
export {
  toUiError,
  useAnnouncer,
  useAudit,
  useProposal,
  useProposalList,
  useReviewActions,
  useReviewEvents,
  useRovingIndex,
  useSelection,
  useSubmittedProposal,
  type ApproveArgs,
  type AuditState,
  type ProposalListState,
  type ProposalState,
  type ReviewActionCallbacks,
  type ReviewActions,
  type Selection,
  type UiError,
} from './hooks.js';

/* i18n */
export {
  createTranslate,
  en,
  interpolate,
  LOCALES,
  resolveLocale,
  resolveMessages,
  zhCN,
  type Locale,
  type MessageKey,
  type MessageOverrides,
  type Messages,
  type Translate,
} from './i18n.js';
