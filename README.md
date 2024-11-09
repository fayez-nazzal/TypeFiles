# TypeFiles - TypeScript-like validation for your file system

Add tfconfig.json to any directory with the following properties:

- required: A list of required files, glob patterns are supported.
- patters: A list of glob pattern to restrict the file names.
- exclude: A list of filenames or patterns to exclude from the validation.

Example:

```json
{
  "required": ["**/icons/**/close.svg"],
  "patterns": ["**/icons/**/*.svg"],
  "exclude": ["**/icons/temp/*"]
}
```

If the file system doesn't match the schema, the file name in the explorer will be highlighted in red. And a message will be shown in the vscode problems panel.
