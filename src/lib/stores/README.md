# Stores

Svelte 5 rune state for the UI (DESIGN §7.3): session, catalogue, holiday
facts, the derived plan and "now". Writes go through `mutate()`. Stores may
call the API client and the engine; the engine must never import from here.
