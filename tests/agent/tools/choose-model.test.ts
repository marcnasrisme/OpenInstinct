import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Settings from "@db/services/settings";
import { toolContextFor } from "@tests/helpers/tool-context";

const mocks = vi.hoisted(() => ({
  getModelId: vi.fn<typeof Settings.getModelId>(),
  selectModelId: vi.fn<typeof Settings.selectModelId>(),
}));

vi.mock("@db/services/settings", () => mocks);

import { chooseModel } from "@agent/tools/models";

const scope = { userId: "user-1", workspaceId: "workspace-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getModelId.mockResolvedValue("meta/muse-spark-1.3");
  mocks.selectModelId.mockResolvedValue(undefined);
});

describe("choose_model", () => {
  it("reports the current model and the options without changing anything", async () => {
    const result = await chooseModel.execute({ role: "browser" }, context());

    expect(mocks.selectModelId).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      current: { id: "meta/muse-spark-1.3", label: "Muse Spark 1.3" },
      options: [
        { id: "meta/muse-spark-1.3", label: "Muse Spark 1.3" },
        { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
        { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
      ],
    });
  });

  it("switches the workspace's browser model", async () => {
    mocks.getModelId.mockResolvedValue("anthropic/claude-haiku-5.5");

    const result = await chooseModel.execute(
      { modelId: "anthropic/claude-haiku-5.5", role: "browser" },
      context()
    );

    expect(mocks.selectModelId).toHaveBeenCalledExactlyOnceWith(
      scope,
      "browser",
      "anthropic/claude-haiku-5.5"
    );
    expect(result).toMatchObject({
      current: { label: "Claude Haiku 5.5" },
    });
  });

  it("refuses a model that can't run that role", async () => {
    await expect(
      chooseModel.execute(
        { modelId: "meta/muse-spark-1.3", role: "assistant" },
        context()
      )
    ).rejects.toThrow("can't run the assistant");
    expect(mocks.selectModelId).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    await expect(
      chooseModel.execute(
        { role: "browser" },
        toolContextFor({ sessionId: "session-1" })
      )
    ).rejects.toThrow("authenticated user");
  });
});

function context() {
  return toolContextFor({
    auth: {
      current: {
        attributes: { workspaceId: scope.workspaceId },
        authenticator: "authjs",
        principalId: scope.userId,
        principalType: "user",
      },
      initiator: null,
    },
    callId: "call-model",
    sessionId: "session-1",
    toolName: "choose_model",
  });
}
