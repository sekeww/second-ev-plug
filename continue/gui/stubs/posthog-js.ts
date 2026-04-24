// Stage 2 POC stub for posthog-js: no network, no-op methods.
// Aliased in vite.config.ts so every `import posthog from "posthog-js"`
// resolves here at build time.

type PosthogNoop = {
  init: (...args: any[]) => void;
  identify: (...args: any[]) => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
  capture: (...args: any[]) => void;
  getFeatureFlag: (...args: any[]) => undefined;
  reset: () => void;
  reloadFeatureFlags: () => void;
  isFeatureEnabled: (...args: any[]) => boolean;
  onFeatureFlags: (...args: any[]) => void;
  register: (...args: any[]) => void;
  unregister: (...args: any[]) => void;
};

const noop = () => {};
const posthog: PosthogNoop = {
  init: noop,
  identify: noop,
  opt_in_capturing: noop,
  opt_out_capturing: noop,
  capture: noop,
  getFeatureFlag: () => undefined,
  reset: noop,
  reloadFeatureFlags: noop,
  isFeatureEnabled: () => false,
  onFeatureFlags: noop,
  register: noop,
  unregister: noop,
};

export default posthog;
