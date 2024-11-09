import * as fs from "fs";
import * as path from "path";
import { MergedSchema } from "../types/schema";

export class ConfigService {
  private configCache: Map<string, MergedSchema> = new Map();
  private lastValidatedTimes: Map<string, number> = new Map();

  async getEffectiveSchema(
    dirPath: string,
    workspaceRoot: string
  ): Promise<MergedSchema | null> {
    const schemas = await this.collectSchemas(dirPath, workspaceRoot);
    if (schemas.length === 0) {
      return null;
    }

    return this.mergeSchemas(schemas);
  }

  private async collectSchemas(
    dirPath: string,
    workspaceRoot: string
  ): Promise<MergedSchema[]> {
    const schemas: MergedSchema[] = [];
    let currentDir = dirPath;

    while (currentDir.startsWith(workspaceRoot)) {
      const configPath = path.join(currentDir, "tfconfig.json");
      const schema = await this.loadSchemaFromPath(configPath);

      const replacePathRelativeWithCurrentDir = (path: string) => {
        if (path.startsWith("./")) {
          return path.replace("./", currentDir + "/");
        }
        return path;
      };

      if (schema) {
        // Make sure relative paths will work inside schema
        schema.required = schema?.required?.map(
          replacePathRelativeWithCurrentDir
        );

        schema.patterns = schema?.patterns?.map(
          replacePathRelativeWithCurrentDir
        );

        schema.matchRules = schema?.matchRules?.map(
          ({ schemaDirectory, targetDirectories }) => ({
            schemaDirectory: replacePathRelativeWithCurrentDir(schemaDirectory),
            targetDirectories:
              replacePathRelativeWithCurrentDir(targetDirectories),
          })
        );

        schemas.unshift(schema);
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    return schemas;
  }

  private async loadSchemaFromPath(
    configPath: string
  ): Promise<MergedSchema | null> {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const configStat = fs.statSync(configPath);
    const lastValidated = this.lastValidatedTimes.get(configPath);

    if (this.isCacheValid(configPath, lastValidated, configStat)) {
      return this.configCache.get(configPath)!;
    }

    const schema = this.parseConfigFile(configPath);
    this.updateCache(configPath, schema);
    return schema;
  }

  private isCacheValid(
    configPath: string,
    lastValidated: number | undefined,
    stat: fs.Stats
  ): boolean {
    return (
      this.configCache.has(configPath) &&
      lastValidated !== undefined &&
      stat.mtime.getTime() <= lastValidated
    );
  }

  private parseConfigFile(configPath: string): MergedSchema {
    const configContent = fs.readFileSync(configPath, "utf8");
    const schema: MergedSchema = JSON.parse(configContent);
    schema._configPath = configPath;
    return schema;
  }

  private updateCache(configPath: string, schema: MergedSchema): void {
    this.configCache.set(configPath, schema);
    this.lastValidatedTimes.set(configPath, Date.now());
  }

  private mergeSchemas(schemas: MergedSchema[]): MergedSchema {
    return schemas.reduce((merged, current) => ({
      required: [
        ...new Set([...(merged.required || []), ...(current.required || [])]),
      ],
      patterns: [
        ...new Set([...(merged.patterns || []), ...(current.patterns || [])]),
      ],
      matchRules: [
        ...new Set([
          ...(merged.matchRules || []),
          ...(current.matchRules || []),
        ]),
      ],
      _configPath: current._configPath,
    }));
  }
}
