# TypeFiles - TypeScript-like type validation for your file system

Have you ever wanted to validate a directory structure? Now it's easy ✌️

TypeFiles is a VSCode extension that allows you to validate a directory structure based on a schema. If the schema does not match, the file name in the explorer panel will be highlighted with an error color. A message will be shown in the vscode problems panel.

## Usage

Add a `tfconfig.json` file to any directory -> Now you have a type-like validation for your file system!

```json
{
  "patterns": ["**/icons/**/*.svg"], // Only allow svg files
  "required": ["**/icons/**/close.svg"], // Required file glob pattern
  "exclude": ["**/icons/temp/*"] // Exclude files from the validation
}
```

## Using a directory as a schema

If you want other directories to match an existing directory, you can use the `matchRules` property.

```json
{
  "matchRules": [
    {
      "schemaDirectory": "./icons/solid", // Take the `icons/solid` directory as a schema
      "targetDirectories": "./icons/*" // Any sibling directory should match this schema.
    }
  ]
}
```
