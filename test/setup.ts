/**
 * Global test setup.
 *
 * ReviewKit's core is deterministic on purpose: no wall-clock reads and no random
 * ids unless the host injects them. The setup below only wires up jsdom niceties
 * for the React tests; core tests inject their own clock/id generator.
 */
import { afterEach } from 'vitest';

const hasDom = typeof document !== 'undefined';

afterEach(async () => {
  if (hasDom) {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    document.body.innerHTML = '';
    window.localStorage?.clear();
  }
});
