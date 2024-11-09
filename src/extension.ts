import * as vscode from "vscode";
import { FileSchemaValidator } from "./services/FileSchemaValidator";

export function activate(context: vscode.ExtensionContext) {
  const validator = new FileSchemaValidator(context);

  const disposable = vscode.commands.registerCommand(
    "type-files.validate",
    async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
      }

      try {
        await validator.validate(workspaceRoot);
      } catch (error) {
        console.error("Validation failed:", error);
        vscode.window.showErrorMessage(
          `Failed to validate files: ${(error as Error).message}`
        );
      }
    }
  );

  context.subscriptions.push(disposable);
  setupFileWatcher(context, validator);
  validateIfEnabled(validator);
}

function setupFileWatcher(
  context: vscode.ExtensionContext,
  validator: FileSchemaValidator
) {
  let validationTimeout: NodeJS.Timeout | undefined;
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    "**/*",
    false,
    false,
    false
  );

  const debouncedValidation = () => {
    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }
    validationTimeout = setTimeout(() => validateIfEnabled(validator), 1000);
  };

  fileWatcher.onDidCreate(debouncedValidation);
  fileWatcher.onDidDelete(debouncedValidation);
  fileWatcher.onDidChange(debouncedValidation);

  context.subscriptions.push(fileWatcher);
}

async function validateIfEnabled(validator: FileSchemaValidator) {
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

export function deactivate() {}
