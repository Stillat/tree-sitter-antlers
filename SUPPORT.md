# Support

This repository tracks problems in the Antlers parser and syntax tree. Before opening an issue, reduce the template to the smallest reproduction and inspect it with:

```bash
npx tree-sitter parse path/to/example.antlers.html
```

Use the parser bug template when the resulting tree is incorrect, contains unexpected errors, crashes, or performs poorly.

If the syntax tree is correct but highlighting, indentation, folding, navigation, formatting, completion, or another downstream feature behaves incorrectly, report the problem to the editor, language server, or integration that provides that feature.

For questions about Antlers itself, consult the [Statamic Antlers documentation](https://statamic.dev/antlers).
