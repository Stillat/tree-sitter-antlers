# Contributing to tree-sitter-antlers

Bug reports, focused grammar improvements, documentation fixes, and corpus tests are welcome. For suspected security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Local setup

Install Node.js 20 or newer, npm, and Git, then run:

```bash
npm ci
npm run generate
npm test
```

Generated sources under `src/` are checked in so consumers can compile the grammar without running the generator. After changing `grammar.js` or `src/scanner.c`, regenerate the parser and include the resulting `src/` changes.

## Tests

Add a focused case to `test/corpus/tags.txt` for every syntax-tree or recovery change. Keep the input minimal and make the expected tree describe the public structure that consumers can safely query.

Before opening a pull request, run:

```bash
npm ci
npm audit
npm run generate
git diff --exit-code -- src
npm test
npm pack --dry-run
```

The `git diff` command should be clean after generated parser changes have been included.

## Design boundaries

This repository owns the Antlers syntax tree and its external scanner. Highlighting, indentation, injections, navigation, semantic analysis, and other downstream behavior belong to the tools that consume the grammar.

The grammar favors resilient incremental parsing while a template is being edited. Keep scanner lookahead bounded where practical, preserve exact nested tag matching, serialize all state needed after incremental reparses, and avoid turning incomplete constructs into unbounded error regions.

## Pull requests

Keep changes focused and explain any public node, field, recovery, or performance impact. By contributing, you agree that your contribution is licensed under the repository's MIT license.
