import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import {
  persistImageArtifact,
  safeImageFilename,
} from "@agent/lib/image-artifacts/persist";
import { resolveModeValue } from "@agent/lib/mode";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { renderVisual, visualStyleClasses } from "@agent/lib/visuals/render";
import { reserveBrowserImageArtifact } from "@db/services/browser-images";
import { browserImageArtifactReferenceSchema } from "@shared/browser/artifact";

const outputSchema = z.object({
  images: z.array(browserImageArtifactReferenceSchema),
});

export const makeImage = defineTool({
  description: `Draw one to four images from HTML and get back private image artifacts to send with send_message. Use it to show structured results as cards, such as flight or hotel options, products, receipts, schedules, or confirmations. Load the card-design skill before your first make_image call in a conversation; you can load it while the browser worker runs. Write one root element per image in the house style: class names on elements, inline styles only to adjust layout or color. Classes: ${Object.keys(visualStyleClasses).join(", ")}. Every element is a flex box; there are no tables, grids, or external fonts. Images must be embedded data:image URIs; remote image URLs are refused. Only put facts you already have in the card.`,
  inputSchema: z.object({
    images: z
      .array(
        z.object({
          html: z.string().trim().min(1).max(20_000),
          label: z.string().trim().min(1).max(200),
        })
      )
      .min(1)
      .max(4),
  }),
  outputSchema,
  async execute(input, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (!caller)
      throw new Error("Drawing images requires an authenticated user.");
    const scope = scopeFromPrincipal(caller);

    const images = await Promise.all(
      input.images.map(async ({ html, label }, index) => {
        const reserved = await reserveBrowserImageArtifact(scope, {
          idempotencyKey: `rendered-image:${context.session.id}:${context.callId}:${String(index)}`,
          label,
          rootSessionId: context.session.id,
          sourceKind: "rendered",
          workerSessionId: context.session.id,
        });
        if (reserved.status === "ready") return reserved.image;
        const bytes = await renderVisual(html);
        return persistImageArtifact(
          scope,
          reserved.reservation,
          {
            bytes,
            filename: safeImageFilename(label, "image/png"),
            sourceKind: "rendered",
          },
          context.abortSignal
        );
      })
    );
    return outputSchema.parse({ images });
  },
  toModelOutput(output) {
    return toolOutput.json({
      images: output.images.map((image) => `![${image.label}](${image.url})`),
      note: "Send these exact references, in order, in one send_message.",
    });
  },
});

export default defineDynamic((context) =>
  resolveModeValue(context, {
    interactive: { make_image: makeImage },
    "scheduled-worker": { make_image: makeImage },
  })
);
