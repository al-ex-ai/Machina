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
13. Default look is never a bare white or grey skin. A model wears the Machina livery by default (`asset.machina`) only where it renders clean: no old cheatlines or titles showing through, belly and tail lines following the body. Where it does not, the default is the model's own neutral paint (debranded) with a colour picker.
14. Working colour picker (`asset.machina` or `asset.recolor`). Each colour changes only the paint. Markings, glass, tyres, engine faces, cockpit and wood stay as they are.

## Visual checks

15. Screenshots looked at before the model is called done: side at eye level, each gear leg close up, nose, cockpit through the windshield, and the model in at least two colours.
16. X-ray view clean, with seats inside: crew seats in every cockpit and passenger seats in every passenger cabin, the package's own or the shared FlightGear seats (`assets/aircraft/cabin`, `assets/aircraft/crew`) laid out from the fuselage's own sections, every seat inside the skin. Freighters keep their empty holds. Tested in test/xray.test.js.
17. Default framing fits the whole model, with nothing clipped on long or wide aircraft.
18. Textures load correctly: no placeholder colours, no see-through skins.

## Generated files

19. Thumbnail and side profile are current (`npm run thumbs -- <id>` after any change to the model JSON).
20. Three-view drawing is current and matches the model (`npm run drawings`).

## Assets

21. Compact: textures in WebP, at most 2048 px, unused files removed (`npm run compact`, then check `npm run size`).

## Takeoff

Fixed-wing models only. `npm run takeoff-check` prints the measurements and `npm test` enforces them (test/takeoff.test.js, src/takeoff-check.js).

22. A `takeoff` block with the published figures: rotation speed, ground roll, flaps, and `tailwheel` for taildraggers.
23. Nothing jumps when the takeoff starts: no animated mesh moves more than 3 cm from the studio pose. Oleos and control surfaces drawn away from their zero (the Concorde nose oleo, the Tu-144D rudder) start where they are drawn (`poseState`, written by `fg-pose.js`).
24. Every wheel on the ground at the start: each wheel part's lowest point is between 3 cm below and 5 cm above the ground the studio stands the model on (its lowest point outside the cabin, not the lowest wheel), and nothing is below it. Oleos stored extended are settled from the model's own compression animation (the 737 nose), or with `asset.compress` where it has none (the Tu-134 nose). A wheel that does not touch at rest on the real aircraft (Concorde tail bumper) is listed in `takeoff.offGround`.
25. Nothing goes through the runway at any moment of the takeoff: the test plays the scene's own simulation (src/takeoff-sim.js) frame by frame, wheels spinning, oleos unloading, nose rotating and gear folding, and every visible mesh stays above the runway. Rotation stops a degree short of the angle where the tail or tail bumper would touch.
26. Gear up closes: each retracting wheel part ends no more than 10 cm below the belly. Wheels the real aircraft leaves out (DC-3 and Spitfire tail wheels) are listed in `takeoff.exposed`.
27. Propellers turn into a faint disc when spun up, wheels spin while rolling, and nothing extra shows on them.
28. Takeoff screenshots looked at before the model is called done: follow camera at the start, rotation and liftoff, chase camera with the gear coming up, the wheels close up while rolling, and the cockpit camera at the start, rotation and climb. The cockpit camera sits at the captain's eyes (the captain figure hidden); nothing solid may sit within 43 cm in front of them (tested), and anything that blocks the view, like a head-up display or a raised visor, is hidden in it by `takeoff.cockpit`.
29. Pilots aboard: the package's own pilot figures where it has them, otherwise a FlightGear pilot from `assets/aircraft/crew` (airline, light-aircraft or WWII) with its head at the aircraft's captain eye point, a first officer mirrored where the type has two. Checked in close-ups: seated, nothing through the skin, visible through the windshield. A model with no fitting pilot states why in `asset.noCrew`.

## Gate

30. `npm run validate` and `npm test` pass.
31. Only after rules 1 to 30 pass does the model move from "workshop" to "models".
