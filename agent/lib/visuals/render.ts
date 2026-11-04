import { ImageResponse } from "@vercel/og";
import { createElement, type ReactNode } from "react";
import { html as parseHtml } from "satori-html";
import { z } from "zod";
import { maximumBrowserImageBytes } from "@shared/browser/artifact";
import {
  geistBold,
  geistRegular,
  geistSemiBold,
} from "@agent/lib/visuals/fonts/geist";

type Font = NonNullable<
  NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]
>[number];

// Cards are drawn at twice an iPhone's width so text stays sharp in Messages,
// which shows an image at about a third of this size: 40px reads as 14pt.
const imageWidth = 780;
const maximumImageHeight = 2400;

// Geist in three weights, so bold and semibold text is drawn as such instead
// of as the one regular face @vercel/og bundles.
const cardFonts = (
  [
    { data: geistRegular, weight: 400 },
    { data: geistSemiBold, weight: 600 },
    { data: geistBold, weight: 700 },
  ] as const
).map(({ data, weight }) => ({
  data: Buffer.from(data, "base64"),
  name: "Geist",
  style: "normal" as const,
  weight,
})) satisfies Font[];

// The house style. The model writes HTML with these classes; inline styles
// adjust layout or color. Sizes are for the 2x canvas.
export const visualStyleClasses = {
  accent: { color: "#2563eb" },
  badge: {
    alignItems: "center",
    background: "#111827",
    borderRadius: 16,
    color: "#ffffff",
    flexShrink: 0,
    fontSize: 32,
    fontWeight: 700,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  big: { fontSize: 60, fontWeight: 700, letterSpacing: -1 },
  card: {
    background: "#ffffff",
    borderRadius: 44,
    color: "#111827",
    flexDirection: "column",
    fontSize: 40,
    gap: 24,
    padding: 48,
    width: "100%",
  },
  divider: { background: "#e5e7eb", height: 2, width: "100%" },
  good: { color: "#15803d" },
  label: {
    color: "#6b7280",
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  line: {
    borderTop: "3px dashed #d1d5db",
    flexGrow: 1,
    height: 0,
    marginLeft: 16,
    marginRight: 16,
  },
  muted: { color: "#6b7280", fontSize: 34 },
  pill: {
    background: "#f3f4f6",
    borderRadius: 999,
    flexShrink: 0,
    fontSize: 30,
    paddingBottom: 8,
    paddingLeft: 22,
    paddingRight: 22,
    paddingTop: 8,
    whiteSpace: "nowrap",
  },
  price: {
    color: "#15803d",
    flexShrink: 0,
    fontSize: 52,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  row: { alignItems: "center", flexDirection: "row", gap: 20 },
  small: { fontSize: 30 },
  spread: {
    alignItems: "center",
    flexDirection: "row",
    gap: 20,
    justifyContent: "space-between",
  },
  stack: { flexDirection: "column", gap: 10 },
  strong: { fontWeight: 600 },
  title: { fontSize: 48, fontWeight: 700, letterSpacing: -0.5 },
  warn: { color: "#b45309" },
} as const satisfies Record<string, Record<string, number | string>>;

type StyleClass = keyof typeof visualStyleClasses;

const styleValueSchema = z.union([z.string(), z.number()]);

// satori-html nests arrays and leaves holes in children, so both are allowed.
const visualChildrenSchema: z.ZodType<ReactNode> = z.lazy(() =>
  z.union([z.undefined(), visualNodeSchema, z.array(visualChildrenSchema)])
);

// satori-html returns a { type, props } tree; parsing it here both checks its
// shape and rebuilds it as React elements in the house style.
const visualNodeSchema: z.ZodType<ReactNode> = z.lazy(() =>
  z.union([
    z.string(),
    z
      .object({
        props: z.object({
          children: visualChildrenSchema,
          class: z.string().optional(),
          height: styleValueSchema.optional(),
          src: z.string().optional(),
          style: z.record(z.string(), styleValueSchema).optional(),
          width: styleValueSchema.optional(),
        }),
        type: z.string(),
      })
      .transform(({ props, type }) => styledElement(type, props)),
  ])
);

// Renders the model's HTML into a PNG. Remote images are refused: fetching a
// URL chosen by the model would let injected text send data to any server.
export async function renderVisual(markup: string) {
  const content = visualNodeSchema.parse(parseHtml(markup));
  const response = new ImageResponse(
    createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          fontFamily: "Geist",
          width: imageWidth,
        },
      },
      content
    ),
    // Leaving height unset sizes the image to its content.
    { fonts: cardFonts, height: undefined, width: imageWidth }
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const height = pngHeight(bytes);
  if (height > maximumImageHeight) {
    throw new Error(
      `The image is ${String(height)}px tall; keep one card under ${String(maximumImageHeight)}px by showing less.`
    );
  }
  if (bytes.byteLength > maximumBrowserImageBytes) {
    throw new Error("The image is too large; simplify it.");
  }
  return bytes;
}

function styledElement(
  type: string,
  props: {
    readonly children?: ReactNode;
    readonly class?: string;
    readonly height?: number | string;
    readonly src?: string;
    readonly style?: Readonly<Record<string, number | string>>;
    readonly width?: number | string;
  }
) {
  if (type === "script" || type === "style") return null;
  if (type === "img" && !props.src?.startsWith("data:image/")) {
    throw new Error(
      "Images must be embedded data:image URIs; remote image URLs are not allowed."
    );
  }
  const classes = (props.class ?? "")
    .split(/\s+/u)
    .filter((name): name is StyleClass => name in visualStyleClasses);
  // Satori lays out only flex boxes, so every container defaults to one.
  const style = {
    ...(type === "img" ? undefined : { display: "flex" }),
    ...Object.fromEntries(
      classes.flatMap((name) => Object.entries(visualStyleClasses[name]))
    ),
    ...props.style,
  };
  return type === "img"
    ? createElement("img", {
        height: props.height,
        src: props.src,
        style,
        width: props.width,
      })
    : createElement(type, { style }, props.children);
}

function pngHeight(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(20);
}
