# Roadmap

One milestone per week. Each milestone ends with everything committed, `npm test` green, and a short demo.

## M0. Foundation (done)

- Data-driven builders: fixed-wing, rotorcraft, tracked
- Viewer: selectable parts, explode, person for scale, deep links
- Four airliners measuring within 0.5% of published specs
- Painted fuselages, detailed engines, studio lighting

## M1. Original app design

- Own visual identity: name mark, color system, typography, light and dark themes
- Home screen: category cards and a model gallery with rendered thumbnails
- Model page: large viewer, spec sheet, part tree, clean toolbar
- Responsive layout down to phone width, keyboard navigation
- Military models added so both categories are live: F-16, UH-60, Leopard 2A6, M1A2

## M2. Realism, round two

- Better shapes: airliner nose droop, wing-root blend, raked tips, fighter blended body
- Control surfaces as their own parts: flaps, slats, ailerons, elevators, rudder
- Ground: soft contact shadows, ambient occlusion, tarmac or concrete floor
- Tank detail: angled armor, bustle racks, smoke launchers, track links

## M3. Compare

- Side by side or overlaid at true scale, any two to four models
- Spec table with differences highlighted
- Silhouette overlay (top, side, front) to see size at a glance
- "Line-up" view: a row of models on one apron, sorted by any spec

## M4. Deeper detail

- Part tree: system, assembly, part, with a data sheet per part
- Cutaway and x-ray modes to see inside (cabin, engine core, fuel tanks)
- Labels with leader lines, measure tool (click two points)
- Animations: gear retract, flaps, rotors spinning, turret and gun traverse

## M5. More categories

Each new kind of vehicle is one new builder plus its models.

- Naval: hull builder for ships and submarines
- Space: stack builder for rockets and spacecraft
- Automotive: body builder for cars and trucks
- Rail: locomotives and train sets
- Military: fighters, transports, armored vehicles

## M6. Data and authoring

- JSON Schema for model files, validated in CI
- Spec-match test: every model must measure within tolerance of its published size
- Model editor: sliders that reshape a model live and save the JSON
- Contribution guide and 30+ models

## M7. Share

- Export: PNG screenshot, glTF model
- Embeddable viewer for a single model
- Public gallery site and public repository (after approval)

## M8. Polish and release

- Performance: instancing, level of detail, lazy loading
- Accessibility pass, README with demos
- Release v0.1
