import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { FileSchema } from "./schema";
import fg from "fast-glob";
import { debug } from "./utils/debug";

interface MergedSchema extends FileSchema {
  _configPath?: string; // Track where this schema came from
}

class FileSchemaValidator {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private configCache: Map<string, MergedSchema> = new Map();
  private lastValidatedTimes: Map<string, number> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("type-files");
    context.subscriptions.push(this.diagnosticCollection);
  }

  private async getEffectiveSchema(
    dirPath: string,
    workspaceRoot: string
  ): Promise<MergedSchema | null> {
    let currentDir = dirPath;
    const schemas: MergedSchema[] = [];

    // Walk up the directory tree until workspace root
    while (currentDir.startsWith(workspaceRoot)) {
      const configPath = path.join(currentDir, "tfconfig.json");

      if (fs.existsSync(configPath)) {
        const configStat = fs.statSync(configPath);
        const lastValidated = this.lastValidatedTimes.get(configPath);

        let schema: MergedSchema;
        if (
          this.configCache.has(configPath) &&
          lastValidated &&
          configStat.mtime.getTime() <= lastValidated
        ) {
          schema = this.configCache.get(configPath)!;
        } else {
          const configContent = fs.readFileSync(configPath, "utf8");
          schema = JSON.parse(configContent);
          schema._configPath = configPath;
          this.configCache.set(configPath, schema);
          this.lastValidatedTimes.set(configPath, Date.now());
        }

        schemas.unshift(schema); // Add to front so closest config takes precedence
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      } // Stop at root
      currentDir = parentDir;
    }

    if (schemas.length === 0) {
      return null;
    }

    // Merge schemas, with closer configs taking precedence
    return schemas.reduce((merged, current) => ({
      required: [
        ...new Set([...(merged.required || []), ...(current.required || [])]),
      ],
      patterns: [
        ...new Set([...(merged.patterns || []), ...(current.patterns || [])]),
      ],
      directories: {
        ...(merged.directories || {}),
        ...(current.directories || {}),
      },
      _configPath: current._configPath,
    }));
  }

  async validate(workspaceRoot: string) {
    this.diagnosticCollection.clear();
    const diagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [];

    try {
      // Find all directories that need validation
      const allDirs = await fg(["**"], {
        cwd: workspaceRoot,
        onlyDirectories: true,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
        absolute: true,
      });

      // Add workspace root
      allDirs.unshift(workspaceRoot);

      // Process all directories in parallel
      await Promise.all(
        allDirs.map(async (dirPath) => {
          const schema = await this.getEffectiveSchema(dirPath, workspaceRoot);
          if (!schema) {
            return;
          }

          const dirDiagnostics = await this.validateDirectory(dirPath, schema);
          if (dirDiagnostics.length > 0) {
            diagnostics.push([vscode.Uri.file(dirPath), dirDiagnostics]);
          }

          // Handle directory patterns from the schema
          if (schema.directories) {
            await Promise.all(
              Object.entries(schema.directories).map(
                async ([dirPattern, dirSchema]) => {
                  const fullPattern = path.join(dirPath, dirPattern);
                  const matchingDirs = await fg([fullPattern], {
                    onlyDirectories: true,
                    absolute: true,
                  });

                  await Promise.all(
                    matchingDirs.map(async (matchedDir) => {
                      // Merge parent schema with directory-specific schema
                      const mergedSchema: MergedSchema = {
                        required: [
                          ...new Set([
                            ...(schema.required || []),
                            ...(dirSchema.required || []),
                          ]),
                        ],
                        patterns: [
                          ...new Set([
                            ...(schema.patterns || []),
                            ...(dirSchema.patterns || []),
                          ]),
                        ],
                        directories: {
                          ...(schema.directories || {}),
                          ...(dirSchema.directories || {}),
                        },
                        _configPath: schema._configPath,
                      };

                      const subDirDiagnostics = await this.validateDirectory(
                        matchedDir,
                        mergedSchema
                      );
                      if (subDirDiagnostics.length > 0) {
                        diagnostics.push([
                          vscode.Uri.file(matchedDir),
                          subDirDiagnostics,
                        ]);
                      }
                    })
                  );
                }
              )
            );
          }
        })
      );
    } catch (error) {
      console.error("Error during validation:", error);
      vscode.window.showErrorMessage("Error validating file schema");
    }

    this.diagnosticCollection.set(diagnostics);
  }

  private async findConfigFiles(rootPath: string): Promise<string[]> {
    const configFiles: string[] = [];

    const search = async (dirPath: string) => {
      const entries = fs.readdirSync(dirPath);

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          await search(fullPath);
        } else if (entry === "tfconfig.json") {
          configFiles.push(fullPath);
        }
      }
    };

    await search(rootPath);
    return configFiles;
  }

  private async validateDirectory(
    dirPath: string,
    schema: FileSchema
  ): Promise<vscode.Diagnostic[]> {
    const diagnostics: vscode.Diagnostic[] = [];

    try {
      // Get all files in directory
      let files = await fg(["**/*"], {
        cwd: dirPath,
        onlyFiles: true,
        dot: true,
      });

      if (schema.exclude) {
        const excludeMatches = await fg(schema.exclude, {
          cwd: dirPath,
          onlyFiles: true,
          dot: true,
        });
        files = files.filter((file) => !excludeMatches.includes(file));
      }

      // Remove filed "tfconfig.json"
      files = files.filter((file) => file !== "tfconfig.json");

      // Check required files/patterns
      if (schema.required) {
        debug.log("schema.required", schema.required);
        for (const requiredPattern of schema.required) {
          debug.log("requiredPattern", requiredPattern);
          const matches = await fg([requiredPattern], {
            cwd: dirPath,
            onlyFiles: true,
            dot: true,
          });

          if (matches.length === 0) {
            diagnostics.push(
              new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                `Missing required file matching pattern: ${requiredPattern}`,
                vscode.DiagnosticSeverity.Error
              )
            );
          }
        }
      }

      // Check allowed patterns
      if (schema.patterns) {
        const allValidFiles = new Set<string>();

        await Promise.all(
          schema.patterns.map(async (pattern) => {
            const matches = await fg([pattern], {
              cwd: dirPath,
              onlyFiles: true,
              dot: true,
            });
            matches.forEach((match) => allValidFiles.add(match));
          })
        );

        // Get required file patterns for exclusion from pattern validation
        const requiredMatches = new Set<string>();
        if (schema.required) {
          await Promise.all(
            schema.required.map(async (pattern) => {
              const matches = await fg([pattern], {
                cwd: dirPath,
                onlyFiles: true,
                dot: true,
              });
              matches.forEach((match) => requiredMatches.add(match));
            })
          );
        }

        // Check files that don't match any pattern
        for (const file of files) {
          if (!requiredMatches.has(file) && !allValidFiles.has(file)) {
            diagnostics.push(
              new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                `File ${file} doesn't match required patterns`,
                vscode.DiagnosticSeverity.Warning
              )
            );
          }
        }
      }
    } catch (error) {
      console.error("Error validating directory:", dirPath, error);
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `Error accessing directory: ${dirPath}`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    return diagnostics;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const validator = new FileSchemaValidator(context);
  let validationTimeout: NodeJS.Timeout | undefined;

  // Register command
  let disposable = vscode.commands.registerCommand(
    "type-files.validate",
    async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      debug.log("workspaceRoot", workspaceRoot);
      if (!workspaceRoot) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
      }
      debug.log("workspaceRoot", workspaceRoot);

      try {
        await validator.validate(workspaceRoot);
      } catch (error) {
        console.error("Validation failed:", error);
        vscode.window.showErrorMessage(
          "Failed to validate files: " + (error as Error).message
        );
      }
    }
  );

  context.subscriptions.push(disposable);

  // Auto-validate on file changes with debouncing
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    "**/*",
    false,
    false,
    false
  );

  function debouncedValidation() {
    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }
    validationTimeout = setTimeout(validateIfEnabled, 1000); // 1 second debounce
  }

  fileWatcher.onDidCreate(() => debouncedValidation());
  fileWatcher.onDidDelete(() => debouncedValidation());
  fileWatcher.onDidChange(() => debouncedValidation());

  context.subscriptions.push(fileWatcher);

  async function validateIfEnabled() {
    const config = vscode.workspace.getConfiguration("fileSchemaValidator");
    const autoValidateEnabled = config.get<boolean>("autoValidate", true);

    if (!autoValidateEnabled) {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (workspaceRoot) {
      try {
        await validator.validate(workspaceRoot);
      } catch (error) {
        console.error("Auto-validation failed:", error);
      }
    }
  }

  // Initial validation
  validateIfEnabled();
}

export function deactivate() {}
