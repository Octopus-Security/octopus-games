# octopus-games

A browser arcade — six games — plus a reference wiki with crafting recipes,
per-account goals and remappable controls.

Node + Express, Sequelize over SQLite, single sign-on shared with the rest of
the estate.

## Layout

```
server/index.js      routes and SSO wiring
server/database.js   models and migrations
```

## Per-account, not global

Goals, control bindings and progress belong to an account: rows carry a
`username`. On `GameControls` that column is nullable, and **null means the
site-wide default** rather than "nobody's" — worth knowing before writing a
query that filters it out.

So "all rows" and "my rows" are different sets. Any query added here should be
able to answer: *whose data does this return when two different people call it?*

**Game servers are a different model, and answer differently.** They carry a
visibility of `private`, `public`, `members` or `whitelist`, and a viewer who is
not permitted gets **403**, not 404 (`server/index.js`). That is deliberate and
not the usual estate rule: a server's existence is already public in the
listing, so a 403 discloses nothing a 404 would have hidden. A genuinely
unknown id still returns 404.

Do not "correct" that 403 to a 404 without reading the listing endpoint first.

## Controls are remappable, so nothing may assume a key

Bindings are per account and stored, not hard-coded. Anything reading input
should go through the binding layer rather than checking a key directly —
otherwise a remapped control silently keeps the old behaviour for one path.

## Running it

```sh
npm start
npm test
```

`npm install` needs access to `@octopus-security/auth-client`, which is a
private package on GitHub Packages; without credentials it 404s and installs
nothing.

## Migrations

Additive only — `ALTER TABLE … ADD COLUMN`, nullable, and safe to run twice.
Never `sync({ force: true })`, and back the volume up before any
`sync({ alter: true })`. Save data is the one thing here that cannot be
regenerated.
