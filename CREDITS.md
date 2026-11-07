# Credits and licenses

Machina's own code is MIT licensed (see `LICENSE`). Third-party files keep their own licenses and are kept in their own folders with a license file next to them.

| What | Where | Author | License |
|---|---|---|---|
| Three.js r170 and add-ons | `vendor/three/` | three.js authors | MIT |
| Studio HDRI "Studio Small 08" | `assets/hdri/studio_small_08.hdr` | Poly Haven (Sergej Majboroda) | CC0 |
| Sky HDRI "Kloofendal 48d Partly Cloudy (Pure Sky)" | `assets/hdri/kloofendal_48d_partly_cloudy_puresky.hdr` | Poly Haven (Greg Zaal) | CC0 |
| Cessna 172P model and textures | `assets/aircraft/c172p/` | FlightGear c172p team | GPL-2.0 |
| Airbus A320neo model and textures | `assets/aircraft/a320neo/` | Josh Davidson (Octal450) and contributors | GPL-2.0 |
| Boeing 747-8I model and textures | `assets/aircraft/747-8i/` | John Williams, Grupo FGBr | GPL-2.0 |
| Robin DR400 model and texture | `assets/aircraft/dr400/` | Emmanuel Baranger | GPL-2.0 |
| Piper J-3 Cub model and textures | `assets/aircraft/j3cub/` | FlightGear J3Cub contributors | GPL-3.0 |
| Boeing 737-800 model and texture | `assets/aircraft/737-800/` | FlightGear 737-800 contributors | GPL-2.0 |
| Boeing 787-8 model and textures | `assets/aircraft/787-8/` | Omega95, Redneck, Jentron and contributors | GPL-2.0 |
| Airbus A380 model and textures | `assets/aircraft/a380/` | Ampere K., I. Cunningham, F. Dalvi, S. Hamilton and contributors | GPL-2.0-or-later |
| Eurocopter EC135 model and textures | `assets/aircraft/ec135/` | Heiko Schulz and contributors | GPL-2.0 |

Rules for adding assets:

- Only public domain (CC0), CC-BY, or open-source licenses such as GPL. No non-commercial, no-derivatives, or ripped game assets.
- Each asset folder holds the original `LICENSE` and a `CREDITS.md` with source URL, revision, authors and any changes.
- The model file's `asset` block repeats author, license and source so the app can show them. `npm test` fails if any of these are missing.
