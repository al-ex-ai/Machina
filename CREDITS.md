# Credits and licenses

Machina's own code is MIT licensed (see `LICENSE`). Third-party files keep their own licenses and are kept in their own folders with a license file next to them.

| What | Where | Author | License |
|---|---|---|---|
| Three.js r170 and add-ons | `vendor/three/` | three.js authors | MIT |
| Studio HDRI "Studio Small 08" | `assets/hdri/studio_small_08.hdr` | Poly Haven (Sergej Majboroda) | CC0 |
| Sky HDRI "Kloofendal 48d Partly Cloudy (Pure Sky)" | `assets/hdri/kloofendal_48d_partly_cloudy_puresky.hdr` | Poly Haven (Greg Zaal) | CC0 |
| Cessna 172P model and textures | `assets/aircraft/c172p/` | FlightGear c172p team | GPL-2.0 |

Rules for adding assets:

- Only public domain (CC0), CC-BY, or open-source licenses such as GPL. No non-commercial, no-derivatives, or ripped game assets.
- Each asset folder holds the original `LICENSE` and a `CREDITS.md` with source URL, revision, authors and any changes.
- The model file's `asset` block repeats author, license and source so the app can show them. `npm test` fails if any of these are missing.
