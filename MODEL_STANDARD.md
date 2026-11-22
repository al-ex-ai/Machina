# Model standard

Every model in the catalog meets all of these rules. A model that misses any of them stays in `data/index.json` "workshop" and is not listed.

## Source

1. Real mesh only, from an open source model (FlightGear or similar). Nothing generated from images or drawings, and no generated add-ons on a real mesh.
2. License allows redistribution. The package LICENSE sits in the asset folder, the author and source are in the model's `sources`, and the model is credited in CREDITS.md.

## Catalog data

3. Right category and class (helicopters in Helicopters, never with fixed-wing), plus `specs.country`, maker and first flight, so the Browse filters work.
4. Added to a collection when one fits (Warbirds, true-scale line-up, and so on).

## Geometry

5. Size matches published specs within the `verify` tolerance. Any gap is stated honestly in the verify note.
6. Not mirrored: left and right are the right way round.
7. Gear down with wheels on the ground. Taildraggers rest on the tail wheel (`restOnTail`). Gear stored retracted is baked down from the model's own animation.
8. Structure right: nose not blunted, engines identical, windshield present, no floating or sunken parts.
9. Extras hidden: bombs, rockets, drop tanks, prop-blur discs, alternative wingtips, ground equipment, remove-before-flight tags.

## Parts

10. Every meaningful part is named and in the right system (surfaces, controls, propulsion, gear, glazing and so on). Only the fuselage is the leftover fallback part.
11. Cockpit included when the package has one.

## Livery

12. Neutral: no national markings, roundels, flags, airline titles, registrations, squadron codes or author text. Painted out of the texture, never covered up.
13. Default look is never a bare white or grey skin. Plain-skinned models wear the Machina livery by default (`asset.machina`).
14. Working colour picker (`asset.machina` or `asset.recolor`). Each colour changes only the paint. Markings, glass, tyres, engine faces, cockpit and wood stay as they are.

## Visual checks

15. Screenshots looked at before the model is called done: side at eye level, each gear leg close up, nose, cockpit through the windshield, and the model in at least two colours.
16. X-ray view clean.
17. Default framing fits the whole model, with nothing clipped on long or wide aircraft.
18. Textures load correctly: no placeholder colours, no see-through skins.

## Generated files

19. Thumbnail and side profile are current (`npm run thumbs -- <id>` after any change to the model JSON).
20. Three-view drawing is current and matches the model (`npm run drawings`).

## Assets

21. Compact: textures in WebP, at most 2048 px, unused files removed (`npm run compact`, then check `npm run size`).

## Gate

22. `npm run validate` and `npm test` pass.
23. Only after rules 1 to 22 pass does the model move from "workshop" to "models".
