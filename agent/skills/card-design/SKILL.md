---
description: Use before drawing anything with make_image. How to design cards that look polished on a phone in Messages.
---

# Card design

A card replaces a paragraph. The user should get the answer at a glance on a
phone, then find the deciding details without reading.

## How it is seen

- The canvas is 780px wide. Messages shows it at about a third of that size, so
  divide by 2.8 for the size the user sees: 40px reads as 14pt.
- Body text is 34–40px. Nothing goes below 28px. Titles are 44–52px and the one
  number that decides, such as a price or a time, is 52–64px.
- Draw a comparison as one image: one `card` with a section per option, best
  first. Separate images pile up in Messages and shrink. Use one image per item
  only for a single detailed result, such as a booking confirmation.
- Show the few options worth choosing between, not everything the site listed;
  a long list on a small screen is a list nobody reads.

## Hierarchy

- One hero per option: the fact the choice turns on, large and bold.
- Bold what decides (`strong`, `title`), mute what only explains (`muted`).
  Fewer sizes read calmer; every size change should mean something.
- Put labels and caveats in `pill`s instead of sentences: "Nonstop",
  "Carry-on only", "Free cancellation".
- Leave the footnote out unless it changes the decision.
- Never repeat what the text message says, and never add a fact you did not
  verify.

## Layout

- Start from `<div class="card">`. Header row: `badge` number and `title` on
  the left, `price` on the right, inside a `spread`.
- Separate options with space (`gap`) or one `divider`, not boxes inside boxes.
  A soft tint (`background: "#f9fafb"`, `borderRadius: 28`, `padding: 28`) can
  mark the recommended option.
- Times read best as `big` start, a `line`, the duration in `small`, a `line`,
  then `big` end, with airports or places in a `muted` `spread` below.
- Align numbers on the right so they compare down the column.

## Color

- White card, near-black text, gray for secondary text.
- Green (`good`, `price`) means cheapest or best, amber (`warn`) a real
  drawback. Use `accent` blue at most once.
- No full-color backgrounds, gradients, or shadows unless the brand calls for
  it.

## What the renderer supports

- Every element is a flex box. There are no grids, tables, floats, `<style>`
  blocks, or external fonts. Inline `style` takes padding, margin, gap,
  border, borderRadius, background colors, letterSpacing, lineHeight,
  textTransform, opacity, and absolute positioning.
- Put text in its own element: a `div` that holds both text and other elements
  breaks the layout.
- Emoji and icon fonts do not render. Use characters such as `·`, `→`, `✓`,
  and `+1`.
- Images must be embedded `data:image` URIs; remote image URLs are refused.
- The font is Geist in weights 400, 600, and 700.

## Patterns

Flights, two options in one image:

```html
<div class="card">
  <div class="label">NYC → Paris · Dec 5–12</div>
  <div
    class="stack"
    style="background: #f9fafb; border-radius: 28px; padding: 28px; gap: 16px"
  >
    <div class="spread">
      <div class="row">
        <div class="badge">1</div>
        <div class="title">French bee</div>
      </div>
      <div class="price">$604</div>
    </div>
    <div class="spread">
      <div class="big">11:00p</div>
      <div class="line"></div>
      <div class="small">7h 10m</div>
      <div class="line"></div>
      <div class="big">12:10p</div>
    </div>
    <div class="spread muted">
      <div>EWR</div>
      <div>ORY · +1</div>
    </div>
    <div class="row">
      <div class="pill good">Nonstop</div>
      <div class="pill warn">Bag extra</div>
    </div>
  </div>
  <div class="stack" style="padding: 0 28px; gap: 16px">
    <div class="spread">
      <div class="row">
        <div class="badge">2</div>
        <div class="title">American</div>
      </div>
      <div class="price" style="color: #111827">$725</div>
    </div>
    <div class="spread">
      <div class="big">5:20p</div>
      <div class="line"></div>
      <div class="small">7h 15m</div>
      <div class="line"></div>
      <div class="big">6:35a</div>
    </div>
    <div class="spread muted">
      <div>JFK</div>
      <div>CDG · +1</div>
    </div>
    <div class="row">
      <div class="pill">Nonstop</div>
      <div class="pill warn">Basic economy</div>
    </div>
  </div>
</div>
```

Hotels, products, restaurants, and rentals follow the same shape: header row
with name and price, one hero line (rating, distance, or the key spec), then
two or three pills for what differs. A single confirmation shows a `label`
("Booked"), the `title`, the reference number in `big`, and the date and total
in a `spread`.

## Before you call make_image

- Can the user pick from the image alone, in two seconds?
- Is every number in it verified, and is the best option first?
- Would it still read clearly at a third of its size?
