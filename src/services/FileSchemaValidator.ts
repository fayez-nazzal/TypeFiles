import * as vscode from "vscode";
import fg from "fast-glob";
import { ConfigService } from "./ConfigService";
import { ValidationService } from "./ValidationService";

export class FileSchemaValidator {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private configService: ConfigService;
  private validationService: ValidationService;

  constructor(context: vscode.ExtensionContext) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("type-files");
    this.configService = new ConfigService();
    this.validationService = new ValidationService();
    context.subscriptions.push(this.diagnosticCollection);
  }

  async validate(workspaceRoot: string): Promise<void> {
    this.diagnosticCollection.clear();
    const diagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [];

    try {
      const allDirs = await this.getAllDirectories(workspaceRoot);
      await this.validateDirectories(allDirs, workspaceRoot, diagnostics);
      this.diagnosticCollection.set(diagnostics);
    } catch (error) {
      console.error("Error during validation:", error);
      vscode.window.showErrorMessage("Error validating file schema");
    }
  }

  private async getAllDirectories(workspaceRoot: string): Promise<string[]> {
    const dirs = await fg(["**"], {
      cwd: workspaceRoot,
      onlyDirectories: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
      absolute: true,
    });
    return [workspaceRoot, ...dirs];
  }

  private async validateDirectories(
    dirs: string[],
    workspaceRoot: string,
    diagnostics: [vscode.Uri, vscode.Diagnostic[]][]
  ): Promise<void> {
    await Promise.all(
      dirs.map(async (dirPath) => {
        const schema = await this.configService.getEffectiveSchema(
          dirPath,
          workspaceRoot
        );
        if (!schema) {
          return;
        }

        const dirDiagnostics = await this.validationService.validateDirectory(
          dirPath,
          schema
        );
        if (dirDiagnostics.length > 0) {
          diagnostics.push([vscode.Uri.file(dirPath), dirDiagnostics]);
        }

        if (schema.directories) {
          await this.validateSubDirectories(dirPath, schema, diagnostics);
        }
      })
    );
  }

  private async validateSubDirectories(
    dirPath: string,
    parentSchema: any,
    diagnostics: [vscode.Uri, vscode.Diagnostic[]][]
  ): Promise<void> {
    await Promise.all(
      Object.entries(parentSchema.directories).map(
        async ([dirPattern, dirSchema]) => {
          const matchingDirs = await fg([dirPattern], {
            cwd: dirPath,
            onlyDirectories: true,
            absolute: true,
          });

          await Promise.all(
            matchingDirs.map(async (matchedDir) => {
              const mergedSchema = this.mergeWithParentSchema(
                parentSchema,
                dirSchema
              );
              const subDirDiagnostics =
                await this.validationService.validateDirectory(
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

  private mergeWithParentSchema(parentSchema: any, dirSchema: any) {
    return {
      required: [
        ...new Set([
          ...(parentSchema.required || []),
          ...(dirSchema.required || []),
        ]),
      ],
      patterns: [
        ...new Set([
          ...(parentSchema.patterns || []),
          ...(dirSchema.patterns || []),
        ]),
      ],
      directories: {
        ...(parentSchema.directories || {}),
        ...(dirSchema.directories || {}),
      },
      _configPath: parentSchema._configPath,
    };
  }
}
