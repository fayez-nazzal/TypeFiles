export interface FileSchema {
  required: string[];
  exclude?: string[];
  patterns?: string[];
  directories?: {
    [key: string]: FileSchema;
  };
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
