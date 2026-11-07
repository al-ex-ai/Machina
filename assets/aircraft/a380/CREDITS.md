# Airbus A380 model

- **Source:** FlightGear FGAddon, Aircraft/A380. A380-set.xml states: "The A380 Aircraft is released under GPL as part of the FlightGear.org project.", downloaded from the official FlightGear aircraft mirror (mirrors.ibiblio.org/flightgear/ftp/Aircraft-2020)
- **Authors:** Ampere K., I. Cunningham, F. Dalvi, S. Hamilton and contributors
- **License:** GPL-2.0-or-later (see `LICENSE` in this folder)

## Files used

Models/a380.ac, Models/Wings/wings.ac, Models/Wings/cowling.ac, and the House livery textures (A380.png, Tyre.png, cowling.png, BYPASS.png), copied next to the model files that use them.

## Changes

The House livery textures were copied from Textures/Livery/House into the model folders. The engine pylons (.3ds format) are not included, so the engines are placed by their cowling offsets without pylons. Machina reads the files at runtime, hides interior and optional objects, places sub-models with FlightGear's own offsets, and groups the named objects into selectable parts.

These files are distributed under their own license, separately from Machina's code, which is MIT licensed.
