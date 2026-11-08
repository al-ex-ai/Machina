# Cessna 337 Skymaster model

- **Source:** FlightGear FGAddon, Aircraft/Cessna337, downloaded from the official FlightGear aircraft mirror (mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020)
- **Authors:** FlightGear Cessna 337 contributors
- **License:** GPL-2.0 (see `LICENSE` in this folder)

## Files used

Models/Cessna337_Skymaster.ac, Models/Cessna337_seat.ac and the textures they reference.

## Changes

Textures larger than 2048 px, if any, were halved. Nothing else was changed. Machina reads the files at runtime, hides optional, interior or alternate objects, places sub-models with FlightGear's own offsets, and groups the named objects into selectable parts.

These files are distributed under their own license, separately from Machina's code, which is MIT licensed.

## Interior files

The cockpit and cabin sub-models (interior, panel, instruments, seats, pilots) and their textures were added later by `scripts/import-fg-interior.js`, unchanged, from the same package. They carry the same license.
