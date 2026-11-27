// The project word list lives in `.vscode/settings.json` (`cSpell.words`), so
// the VS Code extension and this CLI config share one list. The cspell CLI
// can't import a VS Code settings file directly, so read the words from it.
import vscodeSettings from './.vscode/settings.json' with { type: 'json' };

/** @type {import('cspell').CSpellUserSettings} */
export default {
  version: '0.2',
  language: 'en-GB,en',
  words: vscodeSettings['cSpell.words'],
  ignorePaths: ['node_modules/**', 'pnpm-lock.yaml', 'build/**', '.svelte-kit/**']
};
