# Eurocopter EC130 B4 model

- **Source:** FlightGear FGAddon, Aircraft/ec130, downloaded from the official FlightGear aircraft mirror (mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020)
- **Authors:** FlightGear EC130 contributors
- **License:** GPL-2.0 (see `LICENSE` in this folder)

## Files used

Models/ec130b4_t2.ac, Models/Rotor/rotor.ac, Models/TailRotor/tailrotor.ac and the textures they reference.

## Changes

None to the files themselves. Machina reads the files at runtime, hides optional, interior or alternate objects, places sub-models with FlightGear's own offsets, and groups the named objects into selectable parts.

These files are distributed under their own license, separately from Machina's code, which is MIT licensed.

## Interior files

The cockpit and cabin sub-models (interior, panel, instruments, seats, pilots) and their textures were added later by `scripts/import-fg-interior.js`, unchanged, from the same package. They carry the same license.
