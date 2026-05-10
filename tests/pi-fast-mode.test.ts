import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Context, Model } from "@earendil-works/pi-ai";
import piFastModeExtension, { createPiFastModeExtension } from "../index";
import {
  DEFAULT_CONFIG,
  buildOpenAICodexResponsesFastOptions,
  buildOpenAIResponsesFastOptions,
  createFastModeStream,
  getFastCommandArgumentCompletions,
  getFastStatusFrame,
  getNextFastModeStyle,
  isConfiguredFastModel,
  loadPiFastModeConfig,
  mapReasoningEffort,
  mergeConfig,
  normalizeFastModels,
  parseFastCommand,
  savePiFastModeConfig,
  shouldApplyFastMode,
  type FastModeStreamers,
  type PiFastModeConfig,
} from "../utils";

test("extension entry exports default and factory", () => {
  expect(typeof piFastModeExtension).toBe("function");
  expect(typeof createPiFastModeExtension).toBe("function");
});

function model(partial: Partial<Model<any>>): Model<any> {
  return {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
    contextWindow: 128000,
    maxTokens: 128000,
    ...partial,
  } as Model<any>;
}

function makeStreamers(
  calls: Array<{ name: string; options: unknown; model: Model<any> }>,
): FastModeStreamers {
  const record = (name: string) => (m: Model<any>, _context: Context, options?: unknown) => {
    calls.push({ name, options, model: m });
    return { name, options } as any;
  };
  return {
    streamOpenAIResponses: record("streamOpenAIResponses") as any,
    streamSimpleOpenAIResponses: record("streamSimpleOpenAIResponses") as any,
    streamOpenAICodexResponses: record("streamOpenAICodexResponses") as any,
    streamSimpleOpenAICodexResponses: record("streamSimpleOpenAICodexResponses") as any,
  };
}

test("normalizes fast model refs", () => {
  expect(normalizeFastModels([" GPT-5.5 ", "gpt-5.5", "OPENAI/GPT-5.4", "", 123])).toEqual([
    "gpt-5.5",
    "openai/gpt-5.4",
  ]);
});

test("merges config with validation and fallbacks", () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    enabled: true,
    models: ["gpt-5.5"],
    style: "rainbow",
  });
  expect(merged.enabled).toBe(true);
  expect(merged.models).toEqual(["gpt-5.5"]);
  expect(merged.style).toBe("rainbow");

  const fallback = mergeConfig(merged, { enabled: "yes", style: "nope" });
  expect(fallback.enabled).toBe(true);
  expect(fallback.style).toBe("rainbow");
});

test("creates, saves, and loads config under the pi agent extensions directory", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fast-mode-"));
  try {
    const configPath = join(agentDir, "extensions", "pi-codex-fast.json");
    expect(existsSync(configPath)).toBe(false);

    const loaded = loadPiFastModeConfig(agentDir);
    expect(loaded.enabled).toBe(false);
    expect(loaded.models).toEqual([
      "openai/gpt-5.4",
      "openai/gpt-5.5",
      "openai-codex/gpt-5.4",
      "openai-codex/gpt-5.5",
    ]);
    expect(loaded.style).toBe("static");

    const defaultRaw = JSON.parse(readFileSync(configPath, "utf8"));
    expect(Object.keys(defaultRaw)).toEqual(["enabled", "models"]);
    expect(defaultRaw.enabled).toBe(false);

    savePiFastModeConfig({ enabled: true }, agentDir);
    const enabledRaw = JSON.parse(readFileSync(configPath, "utf8"));
    expect(Object.keys(enabledRaw)).toEqual(["enabled", "models"]);
    expect(enabledRaw.enabled).toBe(true);

    const saved = savePiFastModeConfig(
      { enabled: true, models: ["openai-codex/gpt-5.5"], style: "glow" },
      agentDir,
    );
    expect(saved.enabled).toBe(true);
    expect(saved.models).toEqual(["openai-codex/gpt-5.5"]);
    expect(loadPiFastModeConfig(agentDir).style).toBe("glow");
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    expect(raw.style).toBe("glow");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("matches bare and provider-qualified configured models", () => {
  const config: PiFastModeConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    models: ["gpt-5.5", "openai/gpt-5.4"],
  };
  expect(isConfiguredFastModel(config, model({ provider: "openai-codex", id: "gpt-5.5" }))).toBe(
    true,
  );
  expect(isConfiguredFastModel(config, model({ provider: "openai", id: "gpt-5.4" }))).toBe(true);
  expect(isConfiguredFastModel(config, model({ provider: "openai-codex", id: "gpt-5.4" }))).toBe(
    false,
  );
  expect(
    shouldApplyFastMode(
      { ...config, enabled: false },
      model({ provider: "openai-codex", id: "gpt-5.5" }),
    ),
  ).toBe(false);
});

test("maps reasoning with Pi's clampThinkingLevel behavior", () => {
  expect(mapReasoningEffort(model({ reasoning: false }), "high")).toBeUndefined();
  expect(mapReasoningEffort(model({ id: "gpt-5.1" }), "xhigh")).toBe("high");
  expect(
    mapReasoningEffort(model({ id: "gpt-5.5", thinkingLevelMap: { xhigh: "xhigh" } }), "xhigh"),
  ).toBe("xhigh");
});

test("builds native OpenAI Responses options with service tier and reasoning clamp", () => {
  const opts = buildOpenAIResponsesFastOptions(
    model({ api: "openai-responses", provider: "openai", id: "gpt-5.1" }),
    { apiKey: "k", reasoning: "xhigh", maxRetries: 0, sessionId: "sid" },
    "priority",
  );
  expect(opts.serviceTier).toBe("priority");
  expect(opts.reasoningEffort).toBe("high");
  expect(opts.apiKey).toBe("k");
  expect(opts.maxRetries).toBe(0);
  expect(opts.sessionId).toBe("sid");
  expect(opts.maxTokens).toBe(32000);

  const codexOpts = buildOpenAICodexResponsesFastOptions(
    model({
      api: "openai-codex-responses",
      provider: "openai-codex",
      id: "gpt-5.5",
      thinkingLevelMap: { xhigh: "xhigh" },
    }),
    { reasoning: "xhigh" },
    "priority",
  );
  expect(codexOpts.reasoningEffort).toBe("xhigh");

  const noReasoningCodexOpts = buildOpenAICodexResponsesFastOptions(
    model({ api: "openai-codex-responses", provider: "openai-codex", reasoning: false }),
    { reasoning: "high" },
    "priority",
  );
  expect(noReasoningCodexOpts.reasoningEffort).toBeUndefined();
});

test("native stream is used only for configured OpenAI/Codex fast requests", () => {
  const calls: Array<{ name: string; options: unknown; model: Model<any> }> = [];
  const decisions: unknown[] = [];
  const config: PiFastModeConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    models: ["openai-codex/gpt-5.5"],
  };
  const stream = createFastModeStream({
    streamers: makeStreamers(calls),
    getConfig: () => config,
    onDecision: (decision) => decisions.push(decision),
  });

  stream(
    model({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5" }),
    { messages: [] },
    { reasoning: "high" },
  );
  expect(calls.at(-1)?.name).toBe("streamOpenAICodexResponses");
  expect((calls.at(-1)!.options as any).serviceTier).toBe("priority");

  stream(
    model({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4" }),
    { messages: [] },
    { reasoning: "high" },
  );
  expect(calls.at(-1)?.name).toBe("streamSimpleOpenAICodexResponses");

  stream(
    model({ provider: "github-copilot", api: "openai-responses", id: "gpt-5.5" }),
    { messages: [] },
    { reasoning: "high" },
  );
  expect(calls.at(-1)?.name).toBe("streamSimpleOpenAIResponses");
  expect((decisions.at(-1) as any).applied).toBe(false);
});

test("commands, completions, styles, and status frames", () => {
  expect(parseFastCommand("", false)).toEqual({ type: "toggle_enabled", enabled: true });
  expect(parseFastCommand("off", true)).toEqual({ type: "toggle_enabled", enabled: false });
  expect(parseFastCommand("style", true)).toEqual({ type: "cycle_style" });
  expect(() => parseFastCommand("wat", true)).toThrow(/Usage/);

  expect(getNextFastModeStyle("static")).toBe("rainbow");
  expect(getNextFastModeStyle("rainbow")).toBe("glow");
  expect(getNextFastModeStyle("glow")).toBe("static");
  expect(getFastStatusFrame(0, "static")).toMatch(/Fast/);
  expect(getFastCommandArgumentCompletions("st")?.some((item) => item.value === "status")).toBe(
    true,
  );
  expect(getFastCommandArgumentCompletions("status now")).toBe(null);
});
