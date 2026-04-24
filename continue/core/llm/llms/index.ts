// Stage 3: provider registry reduced to OpenAI only (plus Mock/Test
// retained for the test suite). The built plugin speaks to the internal
// gateway via OpenAI-compatible HTTP only.
import Handlebars from "handlebars";
import {
  BaseCompletionOptions,
  IdeSettings,
  ILLM,
  ILLMLogger,
  JSONModelDescription,
  LLMOptions,
} from "../..";
import { renderTemplatedString } from "../../util/handlebars/renderTemplatedString";
import { BaseLLM } from "../index";
import MockLLM from "./Mock";
import OpenAI from "./OpenAI";
import TestLLM from "./Test";

export const LLMClasses = [OpenAI, MockLLM, TestLLM];

export async function llmFromDescription(
  desc: JSONModelDescription,
  readFile: (filepath: string) => Promise<string>,
  getUriFromPath: (path: string) => Promise<string | undefined>,
  uniqueId: string,
  _ideSettings: IdeSettings,
  llmLogger: ILLMLogger,
  completionOptions?: BaseCompletionOptions,
): Promise<BaseLLM | undefined> {
  const cls = LLMClasses.find((llm) => llm.providerName === desc.provider);

  if (!cls) {
    return undefined;
  }

  const finalCompletionOptions = {
    ...completionOptions,
    ...desc.completionOptions,
  };

  let baseChatSystemMessage: string | undefined = undefined;
  if (desc.systemMessage !== undefined) {
    baseChatSystemMessage = await renderTemplatedString(
      Handlebars,
      desc.systemMessage,
      {},
      [],
      readFile,
      getUriFromPath,
    );
  }

  const options: LLMOptions = {
    ...desc,
    completionOptions: {
      ...finalCompletionOptions,
      model: (desc.model || cls.defaultOptions?.model) ?? "codellama-7b",
      maxTokens:
        finalCompletionOptions.maxTokens ??
        cls.defaultOptions?.completionOptions?.maxTokens,
    },
    baseChatSystemMessage,
    basePlanSystemMessage: baseChatSystemMessage,
    baseAgentSystemMessage: baseChatSystemMessage,
    logger: llmLogger,
    uniqueId,
  };

  return new cls(options);
}

export function llmFromProviderAndOptions(
  providerName: string,
  llmOptions: LLMOptions,
): ILLM {
  const cls = LLMClasses.find((llm) => llm.providerName === providerName);

  if (!cls) {
    throw new Error(`Unknown LLM provider type "${providerName}"`);
  }

  return new cls(llmOptions);
}
