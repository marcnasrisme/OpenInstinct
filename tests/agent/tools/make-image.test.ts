/* oxlint-disable vitest/require-mock-type-parameters -- The fixtures implement only the storage surface exercised by the tool. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolContextFor } from "@tests/helpers/tool-context";

const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
const image = {
  byteSize: 1_000,
  filename: "1 French bee.png",
  id: artifactId,
  label: "#1 French bee $1,419",
  mediaType: "image/png" as const,
  url: `/artifacts/${artifactId}`,
};

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
  finalize: vi.fn(),
  put: vi.fn(),
  reserve: vi.fn(),
}));

vi.mock("@db/services/browser-images", () => ({
  finalizeBrowserImageArtifact: mocks.finalize,
  reserveBrowserImageArtifact: mocks.reserve,
}));
vi.mock("@vercel/blob", () => ({ del: mocks.del, put: mocks.put }));

import { makeImage } from "@agent/tools/visuals";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const reservation = {
  id: artifactId,
  storagePathname: `browser-images/workspace/${artifactId}`,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ reservation, status: "pending" });
  mocks.finalize.mockResolvedValue({ image, storagePathname: "stored/image" });
  mocks.put.mockResolvedValue({ pathname: "stored/image" });
  mocks.del.mockResolvedValue(undefined);
});

describe("make_image", () => {
  it("renders the HTML, stores it privately, and returns its reference", async () => {
    const result = await makeImage.execute(
      {
        images: [
          {
            html: '<div class="card"><div class="title">French bee</div></div>',
            label: image.label,
          },
        ],
      },
      context()
    );

    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(scope, {
      idempotencyKey: "rendered-image:session-1:call-image:0",
      label: image.label,
      rootSessionId: "session-1",
      sourceKind: "rendered",
      workerSessionId: "session-1",
    });
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(reservation.storagePathname),
      expect.any(Buffer),
      expect.objectContaining({ access: "private", contentType: "image/png" })
    );
    expect(mocks.finalize.mock.calls[0]?.[2]).toMatchObject({
      filename: "_1 French bee _1_419.png",
      mediaType: "image/png",
      sourceKind: "rendered",
    });
    expect(result).toEqual({ images: [image] });
    expect(makeImage.toModelOutput?.({ images: [image] })).toEqual({
      type: "json",
      value: {
        images: [`![${image.label}](${image.url})`],
        note: "Send these exact references, in order, in one send_message.",
      },
    });
  });

  it("returns a finished image again without redrawing it", async () => {
    mocks.reserve.mockResolvedValue({ image, status: "ready" });

    const result = await makeImage.execute(
      { images: [{ html: "<div>unused</div>", label: image.label }] },
      context()
    );

    expect(result).toEqual({ images: [image] });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("stores nothing when the HTML asks for a remote image", async () => {
    await expect(
      makeImage.execute(
        {
          images: [
            {
              html: '<div><img src="https://attacker.test/x.png" /></div>',
              label: "Leak",
            },
          ],
        },
        context()
      )
    ).rejects.toThrow("remote image URLs are not allowed");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    await expect(
      makeImage.execute(
        { images: [{ html: "<div>Hi</div>", label: "Hi" }] },
        toolContextFor({ sessionId: "session-1" })
      )
    ).rejects.toThrow("authenticated user");
    expect(mocks.reserve).not.toHaveBeenCalled();
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
    callId: "call-image",
    sessionId: "session-1",
    toolName: "make_image",
  });
}
