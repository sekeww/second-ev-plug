// Stubbed in Stage 2 POC: no external telemetry. All methods are no-ops.
// Public surface is preserved so callers compile unchanged.
import os from "node:os";

import { IdeInfo } from "../index.js";

export enum PosthogFeatureFlag {
  AutocompleteTimeout = "autocomplete-timeout",
  RecentlyVisitedRangesNumSurroundingLines = "recently-visited-ranges-num-surrounding-lines",
}

export const EXPERIMENTS: {
  [key in PosthogFeatureFlag]: {
    [key: string]: { value: any };
  };
} = {
  [PosthogFeatureFlag.AutocompleteTimeout]: {
    control: { value: 150 },
    "250": { value: 250 },
    "350": { value: 350 },
    "450": { value: 450 },
  },
  [PosthogFeatureFlag.RecentlyVisitedRangesNumSurroundingLines]: {
    control: { value: null },
    "5": { value: 5 },
    "10": { value: 10 },
    "15": { value: 15 },
    "20": { value: 20 },
  },
};

export class Telemetry {
  static client: undefined = undefined;
  static uniqueId = "NOT_UNIQUE";
  static os: string | undefined = undefined;
  static ideInfo: IdeInfo | undefined = undefined;

  static async captureError(_errorName: string, _error: unknown) {}

  static async capture(
    _event: string,
    _properties: { [key: string]: any },
    _sendToTeam: boolean = false,
    _isExtensionActivationError: boolean = false,
  ) {}

  static shutdownPosthogClient() {}

  static async setup(_allow: boolean, uniqueId: string, ideInfo: IdeInfo) {
    Telemetry.uniqueId = uniqueId;
    Telemetry.os = os.platform();
    Telemetry.ideInfo = ideInfo;
  }

  static async getFeatureFlag(_flag: PosthogFeatureFlag) {
    return undefined;
  }

  static async getValueForFeatureFlag(_flag: PosthogFeatureFlag) {
    return undefined;
  }
}
