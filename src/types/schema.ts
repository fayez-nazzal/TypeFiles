export interface FileSchema {
  required?: string[];
  patterns?: string[];
  directories?: Record<string, FileSchema>;
  exclude?: string[];
}

export interface MergedSchema extends FileSchema {
  _configPath?: string;
}

export const defaultSchema: FileSchema = {
  required: ["package.json", "README.md"],
  directories: {
    "flavors/*": {
      required: [
        "index.ts",
        "icons.ts",
        "package.json",
        "tsconfig.json",
        "README.md",
      ],
      patterns: ["^icon-.*\\.svg$"],
    },
  },
};
