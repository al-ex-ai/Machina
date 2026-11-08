# Roadmap

One milestone per week. Each milestone ends with everything committed, `npm test` green, and a short demo.

## M0. Foundation (done)

- Data-driven builders (fixed-wing, rotorcraft, tracked), selectable parts, explode, deep links
- Generated airliners measured against published specs

## M1. Original app design (done)

- "Hangar" design system: blueprint grid, mono data readouts, dark, light and Blueprint themes (`?theme=light`, `?theme=blueprint`)
- Home with live stats, category cards, gallery with 3D thumbnails, search and sort
- Category pages, model page with part tree, heads-up readout, tool dock, spec sheet, previous and next
- Keyboard: Esc, E explode, P person, R reset, X x-ray
- Phone layout: viewer first, scrolling navigation, compact dock
- Accessibility: readable contrast in both themes, skip link, labelled 3D region, announced part details and loading, expand state on the part tree, reduced-motion support

## M2. Real models (done, ahead of plan)

- Open-licensed FlightGear models loaded at runtime (AC3D loader, parsing in a Web Worker)
- Asset pipeline: `scripts/import-fg.js`, sub-model placement with FlightGear offsets, file-scoped part rules, split rules for repeated parts, rest-on-tailwheel, texture swaps for custom liveries
- Nine aircraft: A380, 747-400, 787-8, A320neo, 737-300 (Machina livery), Cessna 172 with cabin, Robin DR400, Piper J-3 Cub, EC135
- Second batch: Boeing 707, DHC-6 Twin Otter, Cessna 337 Skymaster, Ercoupe, EC130, 1903 Wright Flyer (new Historic group)
- Studio HDRI lighting, ambient occlusion, on-demand rendering, textures capped at 2048 px
- X-ray view, 1.8 m scale figure
- Verification: size against published specs with documented tolerances, left/right side check, license and credits required for every asset

## M3. Compare

- Two to four models side by side or overlaid at true scale
- Spec table with differences highlighted
- Top, side and front silhouettes
- A line-up of models on one apron, sorted by any spec

## M4. Deeper detail

- Animations from the FlightGear model data: flaps, slats, gear retraction, rotors and propellers
- Labels with leader lines and a measure tool (click two points)
- Cutaway view and richer part data sheets
- Machina livery for engines and any remaining plain models

## M5. More aircraft and categories

- Next FlightGear batch, each vetted for license, quality and size: 777, ATR 72, Concorde, Cessna Caravan, DC-3, more helicopters
- Space category from NASA's public-domain models: Space Shuttle, ISS, Hubble, Curiosity
- Military set stays parked until asked for

## M6. Data and authoring

- JSON Schema for model files, validated in CI
- Documented import workflow and contribution guide
- Live part-mapping tool: click a mesh, assign it to a part, save the rules

## M7. Share

- Export: PNG screenshot, glTF model
- Embeddable viewer for a single model
- Public gallery site and public repository (after approval)

## M8. Polish and release

- Compressed textures and a per-model size budget
- Performance pass on phones
- README with screenshots, release v0.1
