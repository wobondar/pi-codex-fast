import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  streamOpenAICodexResponses,
  streamOpenAIResponses,
  streamSimpleOpenAICodexResponses,
  streamSimpleOpenAIResponses,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  createFastModeStream,
  describeFastMode,
  getFastCommandArgumentCompletions,
  getFastStatusFrame,
  getNextFastModeStyle,
  loadPiFastModeConfig,
  parseFastCommand,
  savePiFastModeConfig,
  shouldApplyFastMode,
  STATUS_KEY,
  type FastModeStreamers,
  type PiFastModeConfig,
  type SchedulerLike,
} from "./utils";

export * from "./utils";

export interface PiFastModeDeps {
  agentDir?: string;
  scheduler?: SchedulerLike;
  streamers?: Partial<FastModeStreamers>;
}

type SupportedModel = Pick<
  Model<Api>,
  "provider" | "id" | "api" | "maxTokens" | "reasoning" | "thinkingLevelMap"
>;
type StatusContext = Pick<ExtensionContext, "cwd" | "hasUI" | "model" | "ui">;
const DEFAULT_STREAMERS: FastModeStreamers = {
  streamOpenAIResponses,
  streamSimpleOpenAIResponses,
  streamOpenAICodexResponses,
  streamSimpleOpenAICodexResponses,
};

function mergeStreamers(overrides: Partial<FastModeStreamers> | undefined): FastModeStreamers {
  return {
    ...DEFAULT_STREAMERS,
    ...overrides,
  };
}

export function createPiFastModeExtension(pi: ExtensionAPI, deps: PiFastModeDeps = {}) {
  const agentDir = deps.agentDir ?? getAgentDir();
  const scheduler = deps.scheduler ?? {
    setInterval: (handler: () => void, timeout?: number) =>
      globalThis.setInterval(handler, timeout),
    clearInterval: (handle: unknown) =>
      globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  };
  const streamers = mergeStreamers(deps.streamers);

  let config: PiFastModeConfig = loadPiFastModeConfig(agentDir);
  let currentModel: SupportedModel | undefined;
  let statusCtx: StatusContext | undefined;
  let animationHandle: unknown;
  let frameIndex = 0;

  const stopAnimation = () => {
    if (animationHandle !== undefined) {
      scheduler.clearInterval(animationHandle);
      animationHandle = undefined;
    }
  };

  const renderStatus = () => {
    if (!statusCtx?.hasUI) return;
    statusCtx.ui.setStatus(STATUS_KEY, getFastStatusFrame(frameIndex, config.style));
    frameIndex += 1;
  };

  const refreshConfig = () => {
    config = loadPiFastModeConfig(agentDir);
    return config;
  };

  const syncStatus = (ctx?: StatusContext) => {
    if (ctx) {
      statusCtx = ctx;
      currentModel = (ctx.model as SupportedModel | undefined) ?? currentModel;
      refreshConfig();
    }
    if (!statusCtx?.hasUI || !shouldApplyFastMode(config, currentModel)) {
      stopAnimation();
      frameIndex = 0;
      statusCtx?.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (config.style === "glow" || config.style === "rainbow") {
      renderStatus();
      if (animationHandle === undefined) {
        animationHandle = scheduler.setInterval(renderStatus, 140);
      }
      return;
    }
    stopAnimation();
    frameIndex = 0;
    statusCtx.ui.setStatus(STATUS_KEY, getFastStatusFrame(0, config.style));
  };

  const notify = (
    ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
    message: string,
    kind: "info" | "warning" | "error",
  ) => {
    if (ctx.hasUI) ctx.ui.notify(message, kind);
  };

  const fastModeStream = createFastModeStream({
    streamers,
    getConfig: refreshConfig,
  });

  const streamSimple = (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    return fastModeStream(model, context, options);
  };

  // This registers wrappers for the OpenAI Responses APIs. Pi's API registry is keyed by API name,
  // so the wrapper deliberately falls through to the original simple streamers unless the provider
  // and model are explicitly configured for Fast Mode.
  pi.registerProvider("openai", {
    api: "openai-responses",
    streamSimple,
  });

  pi.registerProvider("openai-codex", {
    api: "openai-codex-responses",
    streamSimple,
  });

  pi.on("session_start", async (_event, ctx) => {
    currentModel = ctx.model as SupportedModel | undefined;
    syncStatus(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    currentModel = event.model as SupportedModel;
    syncStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopAnimation();
    statusCtx?.ui.setStatus(STATUS_KEY, undefined);
    statusCtx = undefined;
  });

  pi.registerCommand("fast", {
    description: "Toggle OpenAI/Codex Fast Mode and style.",
    getArgumentCompletions: getFastCommandArgumentCompletions,
    handler: async (args, ctx) => {
      currentModel = ctx.model as SupportedModel | undefined;
      refreshConfig();
      const action = parseFastCommand(args, config.enabled);

      if (action.type === "status") {
        notify(ctx, describeFastMode(config, currentModel), "info");
        syncStatus(ctx);
        return;
      }

      if (action.type === "cycle_style") {
        savePiFastModeConfig({ style: getNextFastModeStyle(config.style) }, agentDir);
        config = loadPiFastModeConfig(agentDir);
        frameIndex = 0;
        syncStatus(ctx);
        notify(ctx, `Fast Mode style: ${config.style}`, "info");
        return;
      }

      savePiFastModeConfig({ enabled: action.enabled }, agentDir);
      config = loadPiFastModeConfig(agentDir);
      frameIndex = 0;
      syncStatus(ctx);
      notify(ctx, describeFastMode(config, currentModel), config.enabled ? "warning" : "info");
    },
  });
}

export default function piFastModeExtension(pi: ExtensionAPI) {
  createPiFastModeExtension(pi);
}
