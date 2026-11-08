# Tupolev Tu-154B-2 model

- **Source:** FlightGear aircraft, downloaded from the official mirror (mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020/tu154b.zip)
- **Authors:** Roman Skoryh (visual model, released under GPL), Yurik V. Nikiforoff and the Project Tupolev team
- **License:** GPL (see `LICENSE` in this folder)

## Changes

- Airline titles, registrations and flags are painted out of the exterior textures by `scripts/debrand.js`, so the model wears a neutral livery. Nothing else in the textures is changed.
- The cockpit and cabin sub-models were added unchanged by `scripts/import-fg-interior.js`.
- The landing gear is lowered by evaluating the model's own gear animations (`scripts/fg-pose.js`); the model file is unchanged.
