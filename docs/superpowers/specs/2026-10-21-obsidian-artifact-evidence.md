# Reference artifact evidence — 2026-10-21

User-selected reference: Obsidian AppImage, located at `/home/gwhyyy/.local/bin/Obsidian.AppImage` (bounded filename search found none in Downloads).

REA `open_binary` identified ELF x86_64, SHA-256 `6362ddbeeeebb7bbccb48fae009572cf2284ef92f5c919c1332aba48de6ffeaa`.

REA artifact inspection parent Evidence: `ev_692b5cc8aee3fb079b5875f17a50b662e108caabf37bf728818df205d943ca54`; summary Evidence: `ev_c6741ad1ff2c578b2614052b359491496e87d87e0f1db03c9bafd39cf5ad7fd9`.

## Coverage boundary

The generic inspector returned one ELF node and no child-container entries. This is identification of the AppImage launcher, **not** inspection of the embedded Electron application or proof of its menus, version, settings, plugins, or behavior. Its inventory-completeness field applies only to that bounded view.

No proprietary executable was launched, no proprietary implementation/assets were copied into Lattice, and no user vault was opened. Feature comparisons must cite public documentation separately and distinguish documented reference behavior from Lattice source observations. No claim of complete parity is supported by this artifact result.

## Follow-up research boundary

Use a non-executing AppImage/SquashFS inventory reader if additional package metadata is needed; do not run the AppImage's extraction entry point. Runtime inspection requires a separately permitted behavioral reference workflow consistent with the repository contract. Implementation remains original and independently tested.
