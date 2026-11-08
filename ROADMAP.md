# Roadmap

One milestone per week. Each milestone ends with everything committed, `npm test` green, and a short demo.

## M0. Foundation (done)

- Data-driven builders (fixed-wing, rotorcraft, tracked), selectable parts, explode, deep links
- Generated airliners measured against published specs

## M1. Original app design (done)

- "Hangar" design system: blueprint grid, mono data readouts, dark, light and Blueprint themes (`?theme=light`, `?theme=blueprint`)
- Home with live stats, category cards, gallery with 3D thumbnails, search and sort
- Category pages, model page with part tree, heads-up readout, tool dock, spec sheet, previous and next
- Keyboard: Esc, E explode, P person, R reset, S select, X x-ray
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

## M2.5 Parametric detail and drawings (done, ahead of plan)

- Three-view drawings as exact vectors: silhouettes, creases, open edges and part intersections, clipped with a depth buffer, laid out on A3 at a standard scale with sections, dimensions, centerlines and a title block
- Window and door outlines carried from the model data into the drawings, and dropped where they are seen edge-on
- Generated detail on parametric models, with no per-model tuning: panel seams and window recesses as height maps, framed windows, wing spar and rib lines, hinge gaps on movable surfaces, fan blades, rounded inlet lips and exhaust sleeves, tread, torque links and braces on the gear, antennas, beacons, pitot probes and the APU exhaust
- Smoother lofts: fuselage rings close up where the outline bends
- Livery presets for any parametric model: Machina, factory demonstrator, polished metal, factory primer, plain white

## M2.6 Mesh to parametric, and an accuracy benchmark (done, ahead of plan)

- `npm run convert`: a detailed mesh becomes a parametric model by slicing, with no per-model settings. Robust to the usual simulator mess: misnamed parts, a tail inside the wing part, tires mapped to the wrong gear, helper slivers, fin roots inside the fuselage mesh
- Builder: several main gear legs per side (body and wing gear), inner and outer engines, canted winglets
- `npm run benchmark`: silhouette overlap against an answer key, in three views
- Converted: A320neo, 787-8, 747-400, 707-320B. The A380 source has no horizontal tail and is left out

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
