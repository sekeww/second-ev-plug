// Stage 2 POC: telemetry disabled. No PostHog init, no Sentry init, just
// a passthrough component. The imports of @sentry/react, posthog-js, etc.
// are removed so the webview never instantiates telemetry clients.
import { PropsWithChildren } from "react";

const TelemetryProviders = ({ children }: PropsWithChildren) => <>{children}</>;

export default TelemetryProviders;
