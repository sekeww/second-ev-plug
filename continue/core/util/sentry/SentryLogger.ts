// Stubbed in Stage 2 POC: no external error reporting. All methods are no-ops.
// Public surface is preserved so callers compile unchanged.
import type { Extras } from "@sentry/core";
import os from "node:os";
import { IdeInfo } from "../../index.js";

type NoopClient = { close(): Promise<void> | void };
type NoopScope = {
  setExtras(extras: Record<string, any>): void;
  captureException(error: unknown): void;
  captureMessage(message: string, level?: string): void;
  setClient(client: NoopClient): void;
};

export class SentryLogger {
  static client: NoopClient | undefined = undefined;
  static scope: NoopScope | undefined = undefined;
  static uniqueId = "NOT_UNIQUE";
  static os: string | undefined = undefined;
  static ideInfo: IdeInfo | undefined = undefined;
  static allowTelemetry: boolean = false;

  static async setup(
    _allowAnonymousTelemetry: boolean,
    uniqueId: string,
    ideInfo: IdeInfo,
    _userEmail?: string,
  ) {
    SentryLogger.allowTelemetry = false;
    SentryLogger.uniqueId = uniqueId;
    SentryLogger.ideInfo = ideInfo;
    SentryLogger.os = os.platform();
    SentryLogger.client = undefined;
    SentryLogger.scope = undefined;
  }

  static get lazyClient(): NoopClient | undefined {
    return undefined;
  }

  static get lazyScope(): NoopScope | undefined {
    return undefined;
  }

  static shutdownSentryClient() {}
}

export function initializeSentry(): {
  client: NoopClient | undefined;
  scope: NoopScope | undefined;
} {
  return { client: undefined, scope: undefined };
}

export function createSpan<T>(
  _operation: string,
  _name: string,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return callback();
}

export function captureException(_error: Error, _context?: Record<string, any>) {}

export function captureLog(
  _message: string,
  _level?: string,
  _context?: Extras,
) {}
