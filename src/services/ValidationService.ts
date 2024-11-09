import * as vscode from "vscode";
import fg from "fast-glob";
import { FileSchema } from "../types/schema";

export class ValidationService {
  async validateDirectory(
    dirPath: string,
    schema: FileSchema
  ): Promise<vscode.Diagnostic[]> {
    const diagnostics: vscode.Diagnostic[] = [];
    try {
      const files = await this.getFilteredFiles(dirPath, schema);

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

    return files.filter((file) => file !== "tfconfig.json");
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
        dot: true,
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
          dot: true,
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
          dot: true,
        });
        matches.forEach((match) => requiredMatches.add(match));
      })
    );
    return requiredMatches;
  }
}
