/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import type { LogLevel, Logger } from '@angular/compiler-cli/ngcc';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { Compiler } from 'webpack';
import { time, timeEnd } from './benchmark';
import { InputFileSystem } from './ivy/system';

// Extract Resolver type from Webpack types since it is not directly exported
type ResolverWithOptions = ReturnType<Compiler['resolverFactory']['get']>;

// We cannot create a plugin for this, because NGTSC requires addition type
// information which ngcc creates when processing a package which was compiled with NGC.

// Example of such errors:
// ERROR in node_modules/@angular/platform-browser/platform-browser.d.ts(42,22):
// error TS-996002: Appears in the NgModule.imports of AppModule,
// but could not be resolved to an NgModule class

// We now transform a package and it's typings when NGTSC is resolving a module.

export class NgccProcessor {
  private _processedModules = new Set<string>();
  private _logger: NgccLogger;
  private _nodeModulesDirectory: string | null;

  constructor(
    private readonly compilerNgcc: typeof import('@angular/compiler-cli/ngcc'),
    private readonly propertiesToConsider: string[],
    private readonly compilationWarnings: (Error | string)[],
    private readonly compilationErrors: (Error | string)[],
    private readonly basePath: string,
    private readonly tsConfigPath: string,
    private readonly inputFileSystem: InputFileSystem,
    private readonly resolver: ResolverWithOptions,
  ) {
    this._logger = new NgccLogger(
      this.compilationWarnings,
      this.compilationErrors,
      compilerNgcc.LogLevel.info,
    );
    this._nodeModulesDirectory = this.findNodeModulesDirectory(this.basePath);
  }

  /** Process the entire node modules tree. */
  process() {
    // Under Bazel when running in sandbox mode parts of the filesystem is read-only, or when using
    // Yarn PnP there may not be a node_modules directory. ngcc can't run in those cases, so the
    // processing is skipped.
    if (process.env.BAZEL_TARGET || !this._nodeModulesDirectory) {
      return;
    }

    // Skip if node_modules are read-only
    const corePackage = this.tryResolvePackage('@angular/core', this._nodeModulesDirectory);
    if (corePackage && isReadOnlyFile(corePackage)) {
      return;
    }

    // Perform a ngcc run check to determine if an initial execution is required.
    // If a run hash file exists that matches the current package manager lock file and the
    // project's tsconfig, then an initial ngcc run has already been performed.
    let skipProcessing = false;
    let runHashFilePath: string | undefined;
    const runHashBasePath = path.join(this._nodeModulesDirectory, '.cli-ngcc');
    const projectBasePath = path.join(this._nodeModulesDirectory, '..');
    try {
      let ngccConfigData;
      try {
        ngccConfigData = readFileSync(path.join(projectBasePath, 'ngcc.config.js'));
      } catch {
        ngccConfigData = '';
      }

      const relativeTsconfigPath = path.relative(projectBasePath, this.tsConfigPath);
      const tsconfigData = readFileSync(this.tsConfigPath);
      const { lockFileData, lockFilePath } = this.findPackageManagerLockFile(projectBasePath);

      // Generate a hash that represents the state of the package lock file and used tsconfig
      const runHash = createHash('sha256')
        .update(lockFileData)
        .update(lockFilePath)
        .update(ngccConfigData)
        .update(tsconfigData)
        .update(relativeTsconfigPath)
        .digest('hex');

      // The hash is used directly in the file name to mitigate potential read/write race
      // conditions as well as to only require a file existence check
      runHashFilePath = path.join(runHashBasePath, runHash + '.lock');

      // If the run hash lock file exists, then ngcc was already run against this project state
      if (existsSync(runHashFilePath)) {
        skipProcessing = true;
      }
    } catch {
      // Any error means an ngcc execution is needed
    }

    if (skipProcessing) {
      return;
    }

    const timeLabel = 'NgccProcessor.process';
    time(timeLabel);

    // We spawn instead of using the API because:
    // - NGCC Async uses clustering which is problematic when used via the API which means
    // that we cannot setup multiple cluster masters with different options.
    // - We will not be able to have concurrent builds otherwise Ex: App-Shell,
    // as NGCC will create a lock file for both builds and it will cause builds to fails.
    const originalProcessTitle = process.title;
    try {
      const { status, error } = spawnSync(
        process.execPath,
        [
          this.compilerNgcc.ngccMainFilePath,
          '--source' /** basePath */,
          this._nodeModulesDirectory,
          '--properties' /** propertiesToConsider */,
          ...this.propertiesToConsider,
          '--first-only' /** compileAllFormats */,
          '--create-ivy-entry-points' /** createNewEntryPointFormats */,
          '--async',
          '--tsconfig' /** tsConfigPath */,
          this.tsConfigPath,
          '--use-program-dependencies',
        ],
        {
          stdio: ['inherit', process.stderr, process.stderr],
        },
      );

      if (status !== 0) {
        const errorMessage = error?.message || '';
        throw new Error(errorMessage + `NGCC failed${errorMessage ? ', see above' : ''}.`);
      }
    } finally {
      process.title = originalProcessTitle;
    }

    timeEnd(timeLabel);

    // ngcc was successful so if a run hash was generated, write it for next time
    if (runHashFilePath) {
      try {
        if (!existsSync(runHashBasePath)) {
          mkdirSync(runHashBasePath, { recursive: true });
        }
        writeFileSync(runHashFilePath, '');
      } catch {
        // Errors are non-fatal
      }
    }
  }

  /** Process a module and its dependencies. */
  processModule(
    moduleName: string,
    resolvedModule: ts.ResolvedModule | ts.ResolvedTypeReferenceDirective,
  ): void {
    const resolvedFileName = resolvedModule.resolvedFileName;
    if (
      !this._nodeModulesDirectory ||
      !resolvedFileName ||
      moduleName.startsWith('.') ||
      this._processedModules.has(resolvedFileName)
    ) {
      // Skip when module_modules directory is not present, module is unknown, relative or the
      // NGCC compiler is not found or already processed.
      return;
    }

    const packageJsonPath = this.tryResolvePackage(moduleName, resolvedFileName);
    // If the package.json is read only we should skip calling NGCC.
    // With Bazel when running under sandbox the filesystem is read-only.
    if (!packageJsonPath || isReadOnlyFile(packageJsonPath)) {
      // add it to processed so the second time round we skip this.
      this._processedModules.add(resolvedFileName);

      return;
    }

    const timeLabel = `NgccProcessor.processModule.ngcc.process+${moduleName}`;
    time(timeLabel);
    this.compilerNgcc.process({
      basePath: this._nodeModulesDirectory,
      targetEntryPointPath: path.dirname(packageJsonPath),
      propertiesToConsider: this.propertiesToConsider,
      compileAllFormats: false,
      createNewEntryPointFormats: true,
      logger: this._logger,
      tsConfigPath: this.tsConfigPath,
    });
    timeEnd(timeLabel);

    // Purge this file from cache, since NGCC add new mainFields. Ex: module_ivy_ngcc
    // which are unknown in the cached file.
    this.inputFileSystem.purge?.(packageJsonPath);

    this._processedModules.add(resolvedFileName);
  }

  invalidate(fileName: string) {
    this._processedModules.delete(fileName);
  }

  /**
   * Try resolve a package.json file from the resolved .d.ts file.
   */
  private tryResolvePackage(moduleName: string, resolvedFileName: string): string | undefined {
    try {
      const resolvedPath = this.resolver.resolveSync(
        {},
        resolvedFileName,
        `${moduleName}/package.json`,
      );

      return resolvedPath || undefined;
    } catch {
      // Ex: @angular/compiler/src/i18n/i18n_ast/package.json
      // or local libraries which don't reside in node_modules
      const packageJsonPath = path.resolve(resolvedFileName, '../package.json');

      return existsSync(packageJsonPath) ? packageJsonPath : undefined;
    }
  }

  private findNodeModulesDirectory(startPoint: string): string | null {
    let current = startPoint;
    while (path.dirname(current) !== current) {
      const nodePath = path.join(current, 'node_modules');
      if (existsSync(nodePath)) {
        return nodePath;
      }

      current = path.dirname(current);
    }

    return null;
  }

  private findPackageManagerLockFile(projectBasePath: string): {
    lockFilePath: string;
    lockFileData: Buffer;
  } {
    for (const lockFile of ['yarn.lock', 'pnpm-lock.yaml', 'package-lock.json']) {
      const lockFilePath = path.join(projectBasePath, lockFile);

      try {
        return {
          lockFilePath,
          lockFileData: readFileSync(lockFilePath),
        };
      } catch {}
    }

    throw new Error('Cannot locate a package manager lock file.');
  }
}

class NgccLogger implements Logger {
  constructor(
    private readonly compilationWarnings: (Error | string)[],
    private readonly compilationErrors: (Error | string)[],
    public level: LogLevel,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  debug() {}

  info(...args: string[]) {
    // Log to stderr because it's a progress-like info message.
    process.stderr.write(`\n${args.join(' ')}\n`);
  }

  warn(...args: string[]) {
    this.compilationWarnings.push(args.join(' '));
  }

  error(...args: string[]) {
    this.compilationErrors.push(new Error(args.join(' ')));
  }
}

function isReadOnlyFile(fileName: string): boolean {
  try {
    accessSync(fileName, constants.W_OK);

    return false;
  } catch {
    return true;
  }
}
