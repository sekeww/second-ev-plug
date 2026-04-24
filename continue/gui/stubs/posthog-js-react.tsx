// Stage 2 POC stub for posthog-js/react: no network, no-op hook and passthrough provider.
import { PropsWithChildren, ReactElement } from "react";
import posthog from "./posthog-js";

export function usePostHog() {
  return posthog;
}

export function PostHogProvider({ children }: PropsWithChildren<{ client?: unknown }>): ReactElement {
  return <>{children}</>;
}
