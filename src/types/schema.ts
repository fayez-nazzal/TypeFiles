export interface FileSchema {
  required?: string[];
  matchRules?: {
    schemaDirectory: string;
    targetDirectories: string;
  }[];
  patterns?: string[];
  exclude?: string[];
}

export interface MergedSchema extends FileSchema {
  _configPath?: string;
}
