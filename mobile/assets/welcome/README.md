# Welcome journey — art direction

Three illustrations. They are the first thing anybody sees, and they carry the
whole argument that Danpa HQ is a rental *relationship* rather than a listings
app. Nothing else on those screens does any explaining.

## What to deliver

Six files, or three if you skip the foreground layers.

```
scene-1-back.webp     scene-1-fore.webp   (optional, transparent)
scene-2-back.webp     scene-2-fore.webp   (optional, transparent)
scene-3-back.webp     scene-3-fore.webp   (optional, transparent)
```

Also supply `@2x` and `@3x` variants — `scene-1-back@2x.webp`,
`scene-1-back@3x.webp`. React Native picks the right one per device; without
them the art is soft on every modern phone.

| | |
|---|---|
| **Canvas** | 430 × 420 pt (so `@3x` is 1290 × 1260 px) |
| **Format** | WebP, quality ~82. PNG-24 accepted for the foreground layers if alpha suffers |
| **Budget** | **≤ 180 KB per file at `@3x`.** All six together should stay under 1 MB — this ships inside the app, and the install size is paid by somebody on a metered connection |
| **Back layer** | Full-bleed, opaque, no transparency |
| **Fore layer** | Transparent, the nearest few elements only — the things that should slide fastest |

### The safe band

The illustration is cropped to fill and the bottom ~40% sits under a scrim with
the headline over it.

- **Keep every subject that matters inside the top 60%** of the canvas.
- Treat the bottom 40% as ground, sky-glow, road — texture, not content.
- Nothing important within 24 pt of the left or right edge; phones crop wider
  than you expect.

## The three scenes

They are **one street seen three times**, not three unrelated pictures. Same
buildings, same time of day, same light. Somebody swiping should feel the camera
moving through a place, not slides advancing.

Establish the street once and reuse it. If the second scene's building is not
recognisably one of the buildings from the first, the sequence has failed.

### 1 — "Property. Renting. Connected."

A Ghanaian residential street at dusk. A walled compound with a gate, a low
terracotta-roofed house, a two-storey block. Windows warmly lit. Two or three
people at ordinary distance — walking, standing at a gate — not posed, not
looking at the camera. The mood is *a place where people live*, and the wide
shot is the ecosystem.

*Foreground layer:* the nearest wall, a plant, a parked car.

### 2 — "Your home, in one place."

The **same two-storey block**, much closer — or inside one of its lit rooms. One
woman in her twenties or thirties, at home, relaxed, phone in hand. The room is
lived in: a sofa, a plant, a lamp, the light warm. She is not shopping for a
home. She is *in* hers.

This is the scene most likely to go wrong by looking like a stock illustration
of a person with a phone. What makes it right is the room — specific, Ghanaian,
somebody's.

*Foreground layer:* a plant or the near arm of the sofa.

### 3 — "Manage property without the chaos."

Pull back. The **same street**, now read as a portfolio: the three buildings from
scene one, seen slightly from above or along the road. A man working — at a
desk near a window, or standing looking over the compound — calm and in command,
not surrounded by charts.

Do not draw a dashboard. Do not draw floating cards, graphs, or UI. The
composition says "several properties, held together"; the headline says the
rest.

*Foreground layer:* the desk edge, or the nearest rooftop.

## Palette

Use Danpa HQ's own colours. These are the tokens the rest of the app is built
from, and art in a different palette will read as bought-in.

| | | |
|---|---|---|
| Kola green | `#0B5D4E` | foliage, deep shadow, the brand note |
| Laterite | `#A93B23` | terracotta roofs, clay walls — the Ghanaian signature |
| Harmattan gold | `#D9A31E` | lit windows, the dusk sun, warmth |
| Lagoon | `#2F5E8C` | upper sky, cool shadow |
| Field cream | `#F7F6F1` | the ground the app sits on; the art should settle into it at the bottom edge |
| Ink | `#101A17` | line and darkest shadow |

Warm and low-contrast overall. This is the last hour of daylight, not noon.

## What to avoid

- Flat corporate-memphis figures with no faces
- Floating feature icons, UI cards, charts, dashboards
- Heavy gradients and glow
- Isometric "startup city" illustration
- Anything that reads as generic global stock rather than Ghana
- Extreme detail that disappears at phone size — this is 430 pt wide

## Installing them

Drop the files in this folder, then enable each scene in
`mobile/src/components/welcome/scenes.ts` — the file has one commented line per
layer and says exactly what to uncomment. Nothing else needs to change: the
parallax, the scene transitions and the motion settings already work and are
waiting for the art.

Until then the journey renders a tonal wash per scene, which is deliberately
plain rather than a placeholder pretending to be artwork.
