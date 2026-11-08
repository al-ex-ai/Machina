# Tupolev Tu-144D model

- **Source:** https://gitlab.com/fg_shfsn/tu-144d/Tu-144D (main branch)
- **Authors:** the Tu-144D for FlightGear team (ShFsn, femboywings, konsni and contributors)
- **License:** CC BY-SA 4.0 (see `LICENSE` in this folder)

## Changes

- The DDS textures were decoded to PNG at 2048 px (`scripts/dds-to-png.js`) and flipped to match the model's texture coordinates; the model file now names the PNG files.
- Airline titles, registrations and flags are painted out (`scripts/debrand.js`).
- The landing gear is lowered by evaluating the model's own gear animations (`scripts/fg-pose.js`).

These changes are shared under the same CC BY-SA 4.0 license.
