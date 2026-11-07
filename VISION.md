# Machina

Data-driven 3D models of aircraft and vehicles. Every model is built in the browser from a JSON file of real, published specs, and every part can be selected.

## Principles

- **Data, not meshes.** No downloaded 3D assets. A model is a JSON file: specs (length, span, weight, engines) plus the geometry numbers a builder needs. Change the numbers and the model changes.
- **Every part is a thing.** Wings, engines, turrets and tracks are separate named objects with their own data, so they can be selected, exploded and described.
- **Verified against the specs.** A test builds every model and checks that its measured size matches the published length, span and height. A model that drifts from its data fails CI.
- **Minimal stack.** Static ES modules, vendored Three.js as the only dependency, no build step. Node built-ins for the dev server and tests.

## Structure

```
data/categories.json         categories (aviation, military, ...)
data/models/<category>/*.json one file per model
data/index.json              catalog of model files
src/builders/*.js            one builder per vehicle kind (fixed-wing, rotorcraft, tracked)
src/parts/*.js               reusable geometry: fuselage, wing, nacelle, wheel, track
src/registry.js              builder registry
src/scene.js                 renderer, camera, selection, explode
src/app.js                   catalog UI and panels
```

## Extending

- **New model:** add `data/models/<category>/<id>.json` and list it in `data/index.json`. Run `npm test`.
- **New category:** add it to `data/categories.json`.
- **New kind of vehicle:** add a builder in `src/builders/`, register it in `src/builders/index.js`, and give its models `"builder": "<name>"`.

## Accuracy

Overall dimensions and headline specs come from public sources listed in each model file. Shapes are simplified, and part-level details (fan diameters, armor, materials) are approximate unless a source says otherwise.
