import { expect, test, vi } from "vitest";

const PI_AI_MODULE = "@mariozechner/pi-ai";

test("uses clampThinkingLevel when supportsXhigh is not exported", async () => {
  vi.resetModules();
  vi.doMock(PI_AI_MODULE, async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const mocked = { ...actual };
    delete mocked.supportsXhigh;
    return {
      ...mocked,
      clampThinkingLevel: () => "high",
    };
  });

  try {
    const { mapReasoningEffort } = await import("../utils");
    expect(mapReasoningEffort({ id: "gpt-5.5", reasoning: true }, "xhigh")).toBe("high");
  } finally {
    vi.doUnmock(PI_AI_MODULE);
    vi.resetModules();
  }
});
