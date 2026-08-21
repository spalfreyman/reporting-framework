# shared-node

Shared code that needs Node-only dependencies — principally the commercetools SDK.

It is separate from `shared/` because `shared/` is copied into the webpack-built Merchant
Center application, where a Node SDK dependency has no business being. `shared/` therefore
stays dependency-light and defines narrow *ports* (see `shared/src/ct/ports.ts`); this
folder provides the SDK-backed *adapters* for them.

Backend apps opt in with `node scripts/sync-shared.mjs --with-node`, which copies this tree
to `<app>/src/shared-node/` beside `<app>/src/shared/`.

Relative imports here are written for that copied layout, so this folder is not typechecked
on its own — each consuming app typechecks it after the copy.
