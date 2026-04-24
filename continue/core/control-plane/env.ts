// Stubbed in Stage 2 POC: hub / control-plane is disabled.
// All URLs point at a guaranteed-unresolvable address (RFC 6761 reserved).
// Hub-enabled flags return false so callers short-circuit before any fetch.
import { IdeSettings } from "..";
import { AuthType, ControlPlaneEnv } from "./AuthTypes";

export const EXTENSION_NAME = "continue";

const DISABLED_URL = "http://disabled.invalid/";

// Note: AUTH_TYPE cannot be OnPrem — that path disables local config.yaml
// assistants (see ConfigHandler.getLocalProfiles). We keep the WorkOs branch
// so the local profile loader runs, while every URL is unresolvable.
const DISABLED_ENV: ControlPlaneEnv = {
  AUTH_TYPE: AuthType.WorkOsProd,
  DEFAULT_CONTROL_PLANE_PROXY_URL: DISABLED_URL,
  CONTROL_PLANE_URL: DISABLED_URL,
  WORKOS_CLIENT_ID: "",
  APP_URL: DISABLED_URL,
};

export async function enableHubContinueDev() {
  return false;
}

export async function getControlPlaneEnv(
  _ideSettingsPromise: Promise<IdeSettings>,
): Promise<ControlPlaneEnv> {
  return DISABLED_ENV;
}

export function getControlPlaneEnvSync(
  _ideTestEnvironment: IdeSettings["continueTestEnvironment"],
): ControlPlaneEnv {
  return DISABLED_ENV;
}

export async function useHub(
  _ideSettingsPromise: Promise<IdeSettings>,
): Promise<boolean> {
  return false;
}
