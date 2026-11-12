import { describe, expect, it } from "vitest";
import { z } from "zod";
import captureBrowserImage from "@agent/subagents/browser-agent/tools/capture_browser_image";
import computerAction from "@agent/subagents/browser-agent/tools/computer_action";
import fillFromLink from "@agent/subagents/browser-agent/tools/fill_from_link";
import fillFromVault from "@agent/subagents/browser-agent/tools/fill_from_vault";
import listVault from "@agent/subagents/browser-agent/tools/list_vault";
import manageBrowsers from "@agent/subagents/browser-agent/tools/manage_browsers";

// Claude models reject the whole request when any tool's input is not one
// plain object, such as a top-level union, so a browser worker on Claude
// fails before its first step.
describe("worker tool input schemas", () => {
  it.each([
    ["capture_browser_image", captureBrowserImage.inputSchema],
    ["computer_action", computerAction.inputSchema],
    ["fill_from_link", fillFromLink.inputSchema],
    ["fill_from_vault", fillFromVault.inputSchema],
    ["list_vault", listVault.inputSchema],
    ["manage_browsers", manageBrowsers.inputSchema],
  ])("%s takes one object", (_name, inputSchema) => {
    const schema =
      inputSchema instanceof z.ZodType
        ? z.toJSONSchema(inputSchema)
        : inputSchema;
    expect(schema).toMatchObject({ type: "object" });
  });
});
