# Cessna 172P model

- **Source:** FlightGear c172p project, https://github.com/c172p-team/c172p
- **Authors:** the c172p team and contributors (see the project's contributor list)
- **Revision:** 63ba85273b7f44637eb4683dcdc8f97af7821653 (2026-10-05)
- **License:** GNU General Public License version 2 (see `LICENSE` in this folder)

## Files used

`c172-common.ac` (exterior model) and its textures and normal maps:
`fuselage`, `wing`, `tail`, `glass-alpha`, `interior`, `panel_parts`, `lights`, `prop`, `panel`,
and the `-normal` maps for fuselage, wing, tail and panel parts.

## Changes

None to the files themselves. Machina reads the model at runtime, hides FlightGear
interaction hotspots and alternate meshes, mirrors the side axis to match Machina's
coordinate convention, and groups the named objects into selectable parts.

These files are distributed under their own license (GPL-2.0), separately from
Machina's code, which is MIT licensed.
