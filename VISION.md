# Machina

An open, explorable reference of real machines. Start with aircraft, then space and other vehicles. Every part can be selected and named, every model is checked against its published specs, and every asset is legal to reuse.

## Who it is for

- **Learners and teachers**: point at a part and learn what it is and what it does. Compare a Wright Flyer with an A380 at true scale.
- **Aviation fans and writers**: accurate, well-lit models for explaining a design, with deep links to a part.
- **Developers**: a working pipeline that turns FlightGear's open aircraft into named, web-ready parts, and a viewer to embed.

## Principles

- **Real models, real data.** Geometry comes from open-licensed community models. Specs come from public sources listed in each model file.
- **Every part is a thing.** Raw meshes are mapped to named parts grouped by system, so they can be selected, exploded and described.
- **Verified, and honest about gaps.** Tests measure every model against its published size. Any difference is shown on the model page with a note.
- **Legal by default.** Only CC0, CC-BY or open-source licensed assets. Each one keeps its license and credits next to it, and the tests fail without them.
- **Minimal stack.** Static ES modules, vendored Three.js as the only dependency, no build step. Node built-ins for the dev server and tests.

## Structure

```
data/categories.json            categories and groups
data/models/<category>/*.json   one file per model: specs, sources, asset placement, part rules
data/index.json                 catalog of model files
assets/aircraft/<id>/           imported models with LICENSE and CREDITS.md
src/loaders/                    AC3D parser (worker) and builder
src/assets.js                   placement, part rules, splits, texture swaps
src/scene.js                    renderer, camera, selection, explode, X-ray
src/app.js                      router, catalog, model page
scripts/                        import, inspect, measure and check tools
```

## Where it is going

1. **Compare**: models side by side or overlaid at true scale, spec tables, silhouettes, a line-up on one apron.
2. **Deeper detail**: animations from the simulator data, labels, a measure tool, cutaways.
3. **More machines**: more aircraft, a space category from NASA's public-domain models, and other categories when there are good open models for them.
4. **Authoring**: a schema for model files and a click-to-map tool, so others can add aircraft without reading code.
5. **Share**: screenshots, glTF export and an embeddable single-model viewer.

The weekly plan is in [ROADMAP.md](ROADMAP.md).
