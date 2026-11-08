# 1903 Wright Flyer model

- **Source:** FlightGear FGAddon, Aircraft/wrightFlyer1903, downloaded from the official FlightGear aircraft mirror (mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020)
- **Authors:** Jim Wilson (visual model), with help from Paul Beardsley; Michael Selig et al. (flight model, not used here)
- **License:** GPL, per the FlightGear aircraft catalog (see LICENSE) (see `LICENSE` in this folder)

## Files used

Models/WrightFlyer-pb-jw.ac and its four textures.

## Changes

The four SGI .rgb textures were converted to PNG (same pixels, new file format) so browsers can load them. Machina reads the files at runtime, hides optional, interior or alternate objects, places sub-models with FlightGear's own offsets, and groups the named objects into selectable parts.

These files are distributed under their own license, separately from Machina's code, which is MIT licensed.
