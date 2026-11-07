# Piper J-3 Cub model

- **Source:** FlightGear FGAddon, Aircraft/J3Cub, downloaded from the official FlightGear aircraft mirror (mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020)
- **Authors:** FlightGear J3Cub contributors
- **License:** GPL-3.0 (see `LICENSE` in this folder)

## Files used

Models/J3Cub.ac and the textures it references.

## Changes

Textures larger than 2048 px were downscaled to half size to save memory. Nothing else in the files was changed. Machina reads them at runtime, hides optional or interior variants, places sub-models with FlightGear's own offsets, and groups the named objects into selectable parts.

These files are distributed under their own license, separately from Machina's code, which is MIT licensed.
