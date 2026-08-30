# tree-sitter-antlers

[![CI](https://github.com/Stillat/tree-sitter-antlers/actions/workflows/ci.yml/badge.svg)](https://github.com/Stillat/tree-sitter-antlers/actions/workflows/ci.yml)

A [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for [Statamic Antlers](https://statamic.dev/antlers) templates.

This repository provides an incremental concrete syntax tree for Antlers-aware editors, code-navigation tools, formatters, and other Tree-sitter consumers. It covers the template language itself; project-aware completion, diagnostics, formatting, and Statamic runtime semantics are outside the grammar's scope.

## Language coverage

The grammar recognizes the primary Antlers language surface, including:

- variables, tags, tag pairs, parameters, modifiers, and interpolation
- conditionals, expressions, operators, arrays, groups, assignments, and method chains
- comments, escaped regions, recursive references, component directives, and literal regions
- dynamic tag names, bracket access, named arguments, and legacy syntax forms
- YAML front matter and Antlers-delimited or native PHP regions
- incomplete templates commonly produced while editing

Supported filename conventions are:

- `*.antlers.html`
- `*.antlers.php`
- `*.antlers.xml`

## Using the grammar

Antlers templates contain both template syntax and a host language. The grammar represents non-Antlers content as `text`, allowing consumers to inject an HTML or other appropriate host-language grammar. Front matter and PHP content are also exposed as dedicated ranges suitable for language injection.

Generated C sources are checked into `src/`. Consumers compiling the grammar directly must include both `src/parser.c` and `src/scanner.c`. Public node and field definitions are available in `src/node-types.json`, and Tree-sitter discovery metadata is provided by `tree-sitter.json`.

Pin an immutable repository revision when embedding the grammar. Review changes to `src/node-types.json` when upgrading if your integration relies on syntax queries or specific tree shapes.

## Repository development

Install dependencies, regenerate the parser, and run the corpus with:

```bash
npm ci
npm run generate
npm test
```

Generated parser changes belong in the same commit as their `grammar.js` or scanner source changes. The corpus under `test/corpus/` documents the expected syntax trees.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development expectations and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Support

Parser and syntax-tree problems belong in this repository. If the produced syntax tree is correct but a downstream tool behaves incorrectly, report the problem to that integration's maintainers. See [SUPPORT.md](SUPPORT.md) for guidance.

## License

`tree-sitter-antlers` is open-source software licensed under the [MIT License](LICENSE).
