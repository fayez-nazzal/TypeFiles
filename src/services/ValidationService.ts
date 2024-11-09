import * as vscode from "vscode";
import fg from "fast-glob";
import { FileSchema } from "../types/schema";
import path from "path";
import { debug } from "../utils/debug";
export class ValidationService {
  async validateDirectory(
    dirPath: string,
    schema: FileSchema
  ): Promise<vscode.Diagnostic[]> {
    const diagnostics: vscode.Diagnostic[] = [];
    try {
      const files = await this.getFilteredFiles(dirPath, schema);

      await this.validateMatchDirectory(dirPath, schema, diagnostics);
      await this.validateRequiredFiles(dirPath, schema, diagnostics);
      await this.validatePatterns(dirPath, schema, files, diagnostics);
    } catch (error) {
      console.error("Error validating directory:", dirPath, error);
      diagnostics.push(
        this.createErrorDiagnostic(`Error accessing directory: ${dirPath}`)
      );
    }

    return diagnostics;
  }

  private async getFilteredFiles(
    dirPath: string,
    schema: FileSchema
  ): Promise<string[]> {
    let files = await fg(["**/*"], {
      cwd: dirPath,
      onlyFiles: true,
    });

    if (schema.exclude) {
      const excludeMatches = await fg(schema.exclude, {
        cwd: dirPath,
        onlyFiles: true,
      });
      files = files.filter((file) => !excludeMatches.includes(file));
    }

    return files.filter((file) => file !== "tfconfig.json");
  }

  private async validateMatchDirectory(
    dirPath: string,
    schema: FileSchema,
    diagnostics: vscode.Diagnostic[]
  ): Promise<void> {
    if (!schema.matchRules) {
      return;
    }

    for (const rules of schema.matchRules) {
      const { schemaDirectory, targetDirectories } = rules;
      if (
        !schemaDirectory ||
        !targetDirectories ||
        dirPath === schemaDirectory
      ) {
        continue;
      }

      const schemaDirectoryParentDir = path.dirname(schemaDirectory);
      const dirPathParentDir = path.dirname(dirPath);

      if (dirPathParentDir !== schemaDirectoryParentDir) {
        continue;
      }

      const targetDirectoriesMatches = (
        await fg([targetDirectories], {
          cwd: dirPath,
          onlyDirectories: true,
        })
      ).filter((dir) => dir !== schemaDirectory);

      if (targetDirectoriesMatches.length === 0) {
        continue;
      }

      const baseDierctoryPath = schemaDirectory;

      const baseDierctoryFiles = await fg([`${baseDierctoryPath}/**/*`], {
        cwd: baseDierctoryPath,
        onlyFiles: true,
      });

      const baseDirectoryFilenames = baseDierctoryFiles.map((file) =>
        path.basename(file)
      );

      if (baseDirectoryFilenames.length === 0) {
        diagnostics.push(
          this.createErrorDiagnostic(
            `matchDirectories base ${baseDierctoryPath} has no files`
          )
        );
      }

      for (const targetDirectory of targetDirectoriesMatches) {
        const targetDirectoryFiles = await fg([`${targetDirectory}/**/*`], {
          cwd: targetDirectory,

          onlyFiles: true,
        });

        const targetDirectoryFilenames = targetDirectoryFiles.map((file) =>
          path.basename(file)
        );

        const missingFiles = baseDirectoryFilenames.filter(
          (baseFilename) => !targetDirectoryFilenames.includes(baseFilename)
        );

        for (const missingFile of missingFiles) {
          diagnostics.push(
            this.createErrorDiagnostic(
              `Missing file: ${missingFile} in ${dirPath}`
            )
          );
        }
      }
    }
  }

  private async validateRequiredFiles(
    dirPath: string,
    schema: FileSchema,
    diagnostics: vscode.Diagnostic[]
  ): Promise<void> {
    if (!schema.required) {
      return;
    }

    for (const pattern of schema.required) {
      const matches = await fg([pattern], {
        cwd: dirPath,
        onlyFiles: true,
      });

      if (matches.length === 0) {
        diagnostics.push(
          this.createErrorDiagnostic(
            `Missing required file matching pattern: ${pattern}`
          )
        );
      }
    }
  }

  private async validatePatterns(
    dirPath: string,
    schema: FileSchema,
    files: string[],
    diagnostics: vscode.Diagnostic[]
  ): Promise<void> {
    if (!schema.patterns) {
      return;
    }

    const [allValidFiles, requiredMatches] = await Promise.all([
      this.getAllValidFiles(dirPath, schema.patterns),
      this.getRequiredMatches(dirPath, schema.required || []),
    ]);

    for (const file of files) {
      if (!requiredMatches.has(file) && !allValidFiles.has(file)) {
        diagnostics.push(
          this.createWarningDiagnostic(
            `File ${file} doesn't match required patterns`
          )
        );
      }
    }
  }

  private createErrorDiagnostic(message: string): vscode.Diagnostic {
    return new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      message,
      vscode.DiagnosticSeverity.Error
    );
  }

  private createWarningDiagnostic(message: string): vscode.Diagnostic {
    return new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      message,
      vscode.DiagnosticSeverity.Warning
    );
  }

  private async getAllValidFiles(
    dirPath: string,
    patterns: string[]
  ): Promise<Set<string>> {
    const allValidFiles = new Set<string>();
    await Promise.all(
      patterns.map(async (pattern) => {
        const matches = await fg([pattern], {
          cwd: dirPath,
          onlyFiles: true,
        });
        matches.forEach((match) => allValidFiles.add(match));
      })
    );
    return allValidFiles;
  }

  private async getRequiredMatches(
    dirPath: string,
    required: string[]
  ): Promise<Set<string>> {
    const requiredMatches = new Set<string>();
    await Promise.all(
      required.map(async (pattern) => {
        const matches = await fg([pattern], {
          cwd: dirPath,
          onlyFiles: true,
        });
        matches.forEach((match) => requiredMatches.add(match));
      })
    );
    return requiredMatches;
  }
}
