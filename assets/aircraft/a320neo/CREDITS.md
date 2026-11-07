# Airbus A320neo model

- **Source:** FlightGear A320 family, https://github.com/legoboyvdlp/A320-family (FGAddon package A320-family), downloaded from the official FlightGear aircraft mirror (mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020)
- **Authors:** Josh Davidson (Octal450) and the A320 family contributors
- **License:** GPL-2.0 (see `LICENSE` in this folder)

## Files used

Fuselage, horizontal and vertical stabilizer, wings, sharklets, CFM LEAP-X nacelle, nose and main landing gear (.ac) and their textures.

## Changes

Textures larger than 2048 px were downscaled to half size to save memory. Nothing else in the files was changed. Machina reads them at runtime, hides optional or interior variants, places sub-models with FlightGear's own offsets, and groups the named objects into selectable parts.

These files are distributed under their own license, separately from Machina's code, which is MIT licensed.
