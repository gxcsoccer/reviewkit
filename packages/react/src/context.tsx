/**
 * `ReviewKitProvider` — shared session, renderers, locale and theme.
 *
 * Optional by design: `<ActionReview proposal={…} />` creates its own in-memory
 * session, so the PRD 20 acceptance case ("first proposal rendered in a fresh React
 * app within 10 minutes") needs no provider at all. Use the provider when several
 * components must share one session, custom renderers or a locale.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createReviewSession,
  type Identity,
  type RedactionPolicy,
  type ReviewSession,
  type ReviewSessionOptions,
} from '@reviewkit/core';
import { createTranslate, en, resolveMessages, type MessageOverrides, type Messages, type Translate } from './i18n.js';
import { defaultRenderers, type DiffRenderer } from './renderers/index.js';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ReviewKitContextValue {
  session: ReviewSession;
  renderers: readonly DiffRenderer[];
  messages: Messages;
  t: Translate;
  locale: string;
  /** Identity recorded on decisions made through this provider. */
  reviewer: Identity | undefined;
  /** Default masking policy for proposals that carry none. */
  redaction: RedactionPolicy | undefined;
  theme: ThemeMode;
}

const ReviewKitContext = createContext<ReviewKitContextValue | null>(null);

export interface ReviewKitProviderProps {
  children: ReactNode;
  /** Bring your own session (host store, clock, policy). One is created if omitted. */
  session?: ReviewSession;
  /** Used only when `session` is omitted. */
  sessionOptions?: ReviewSessionOptions;
  /** Custom renderers, tried before the built-ins (PRD 20: no core changes needed). */
  renderers?: readonly DiffRenderer[];
  /** Set true to use only `renderers` and drop the built-in three. */
  replaceRenderers?: boolean;
  /** `en` or `zh-CN`; anything else falls back to `en`. */
  locale?: string;
  /** Per-key message overrides. Missing keys fall back to English. */
  messages?: MessageOverrides;
  reviewer?: Identity;
  redaction?: RedactionPolicy;
  /** Default `system` — follows `prefers-color-scheme`. */
  theme?: ThemeMode;
  /** Extra class on the wrapper element. */
  className?: string;
  /** Render children without the `.rk-root` wrapper (you provide the theme scope). */
  unstyled?: boolean;
}

export function ReviewKitProvider({
  children,
  session: providedSession,
  sessionOptions,
  renderers,
  replaceRenderers = false,
  locale = 'en',
  messages: overrides,
  reviewer,
  redaction,
  theme = 'system',
  className,
  unstyled = false,
}: ReviewKitProviderProps): React.ReactElement {
  // A provider-owned session must survive re-renders, or every render would lose
  // the in-memory store. `sessionOptions` is read once, on purpose.
  const session = useMemo(
    () =>
      providedSession ??
      createReviewSession({ ...(reviewer ? { defaultReviewer: reviewer } : {}), ...sessionOptions }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally created once
    [providedSession],
  );

  const value = useMemo<ReviewKitContextValue>(() => {
    const messages = resolveMessages(locale, overrides);
    const resolved = replaceRenderers
      ? [...(renderers ?? [])]
      : [...(renderers ?? []), ...defaultRenderers()];
    return {
      session,
      renderers: resolved,
      messages,
      t: createTranslate(messages),
      locale,
      reviewer,
      redaction,
      theme,
    };
  }, [session, locale, overrides, renderers, replaceRenderers, reviewer, redaction, theme]);

  const content = <ReviewKitContext.Provider value={value}>{children}</ReviewKitContext.Provider>;
  if (unstyled) return content;
  return (
    <div className={['rk-root', className].filter(Boolean).join(' ')} data-rk-theme={theme}>
      {content}
    </div>
  );
}

/** Throws a fix-it error when used outside a provider (PRD 9.1: actionable errors). */
export function useReviewKit(): ReviewKitContextValue {
  const value = useContext(ReviewKitContext);
  if (!value) throw new Error(en['error.noProvider']);
  return value;
}

/** Context value if there is one, `null` otherwise — for components that also work standalone. */
export function useOptionalReviewKit(): ReviewKitContextValue | null {
  return useContext(ReviewKitContext);
}

export function useReviewSession(): ReviewSession {
  return useReviewKit().session;
}

/** The translator for the current locale. Safe outside a provider (falls back to English). */
export function useTranslate(): Translate {
  const context = useOptionalReviewKit();
  return useMemo(() => context?.t ?? createTranslate(en), [context]);
}
