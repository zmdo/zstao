# Server extension fixture

A loadable test plugin that exercises the public server extension contract. It is not part of the formal CES profile.

- Host entry registers a public `database` type, one detail panel, two settings sections (one observation-only, one execution-affecting), a read-only query and an inspection.
- Client entry registers the panel and settings components through `registerServerPanel()` / `registerSettingsSection()` from the public client entry.
- Build with `node ../../../../../scripts/build-plugin.mjs`.
- To try it in a local profile, add the package as a file dependency, add it to `dsh.profile.bundles`, symlink/build it into the profile, and restart `dsh web`. Do not add it to the shipped CES patch.
