import arrayDiff from 'array-difference';
import fs from 'fs-extra';
import ignore from 'ignore';
import assignwith from 'lodash.assignwith';
import groupby from 'lodash.groupby';
import * as path from 'path';
import R from 'ramda';
import format from 'string-format';
import { Analytics } from '@teambit/legacy/dist/analytics/analytics';
import { BitId, BitIds } from '@teambit/legacy/dist/bit-id';
import { BitIdStr } from '@teambit/legacy/dist/bit-id/bit-id';
import { PACKAGE_JSON, VERSION_DELIMITER } from '@teambit/legacy/dist/constants';
import BitMap from '@teambit/legacy/dist/consumer/bit-map';
import Consumer from '@teambit/legacy/dist/consumer/consumer';
import GeneralError from '@teambit/legacy/dist/error/general-error';
import { NodeModuleLinker } from '@teambit/legacy/dist/links';
import logger from '@teambit/legacy/dist/logger/logger';
import { ModelComponent } from '@teambit/legacy/dist/scope/models';
import { calculateFileInfo, glob, isAutoGeneratedFile, isDir, pathNormalizeToLinux } from '@teambit/legacy/dist/utils';
import { PathLinux, PathLinuxRelative, PathOsBased } from '@teambit/legacy/dist/utils/path';
import ComponentMap, {
  ComponentMapFile,
  Config,
  getIgnoreListHarmony,
} from '@teambit/legacy/dist/consumer/bit-map/component-map';
import MissingMainFile from '@teambit/legacy/dist/consumer/bit-map/exceptions/missing-main-file';
import {
  DuplicateIds,
  EmptyDirectory,
  ExcludedMainFile,
  MainFileIsDir,
  NoFiles,
  PathsNotExist,
} from '@teambit/legacy/dist/consumer/component-ops/add-components/exceptions';
import { AddingIndividualFiles } from '@teambit/legacy/dist/consumer/component-ops/add-components/exceptions/adding-individual-files';
import MissingMainFileMultipleComponents from '@teambit/legacy/dist/consumer/component-ops/add-components/exceptions/missing-main-file-multiple-components';
import { ParentDirTracked } from '@teambit/legacy/dist/consumer/component-ops/add-components/exceptions/parent-dir-tracked';
import PathOutsideConsumer from '@teambit/legacy/dist/consumer/component-ops/add-components/exceptions/path-outside-consumer';
import VersionShouldBeRemoved from '@teambit/legacy/dist/consumer/component-ops/add-components/exceptions/version-should-be-removed';
import determineMainFile from './determine-main-file';

export type AddResult = { id: BitId; files: ComponentMapFile[] };
export type Warnings = {
  alreadyUsed: Record<string, any>;
  emptyDirectory: string[];
  existInScope: BitId[];
};
export type AddActionResults = { addedComponents: AddResult[]; warnings: Warnings };
export type PathOrDSL = PathOsBased | string; // can be a path or a DSL, e.g: tests/{PARENT}/{FILE_NAME}
// @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
// @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
type PathsStats = { [PathOsBased]: { isDir: boolean } };
export type AddedComponent = {
  componentId: BitId;
  files: ComponentMapFile[];
  mainFile?: PathOsBased | null | undefined;
  trackDir?: PathOsBased; // set only when one directory is added by author
  idFromPath:
    | {
        name: string;
        namespace: string;
      }
    | null
    | undefined;
  immediateDir?: string;
};
const REGEX_DSL_PATTERN = /{([^}]+)}/g;

export type AddProps = {
  componentPaths: PathOsBased[];
  id?: string;
  main?: PathOsBased;
  namespace?: string;
  override: boolean;
  trackDirFeature?: boolean;
  defaultScope?: string;
  config?: Config;
  shouldHandleOutOfSync?: boolean;
};
// This is the contxt of the add operation. By default, the add is executed in the same folder in which the consumer is located and it is the process.cwd().
// In that case , give the value false to overridenConsumer .
// There is a possibility to execute add when the process.cwd() is different from the project directory. In that case , when add is done on a folder wchih is
// Different from process.cwd(), transfer true.
// Required for determining if the paths are relative to consumer or to process.cwd().
export type AddContext = {
  consumer: Consumer;
  alternateCwd?: string;
};

export default class AddComponents {
  consumer: Consumer;
  bitMap: BitMap;
  componentPaths: PathOsBased[];
  id: string | null | undefined; // id entered by the user
  main: PathOsBased | null | undefined;
  namespace: string | null | undefined;
  override: boolean; // (default = false) replace the files array or only add files.
  trackDirFeature: boolean | null | undefined;
  warnings: Warnings;
  // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
  ignoreList: string[];
  gitIgnore: any;
  alternateCwd: string | null | undefined;
  addedComponents: AddResult[];
  defaultScope?: string; // helpful for out-of-sync
  config?: Config;
  shouldHandleOutOfSync?: boolean; // only bit-add (not bit-create/new) should handle out-of-sync scenario
  constructor(context: AddContext, addProps: AddProps) {
    this.alternateCwd = context.alternateCwd;
    this.consumer = context.consumer;
    this.bitMap = this.consumer.bitMap;
    this.componentPaths = this.joinConsumerPathIfNeeded(addProps.componentPaths);
    this.id = addProps.id;
    this.main = addProps.main;
    this.namespace = addProps.namespace;
    this.override = addProps.override;
    this.trackDirFeature = addProps.trackDirFeature;
    this.warnings = {
      alreadyUsed: {},
      emptyDirectory: [],
      existInScope: [],
    };
    this.addedComponents = [];
    this.defaultScope = addProps.defaultScope;
    this.config = addProps.config;
    this.shouldHandleOutOfSync = addProps.shouldHandleOutOfSync;
  }

  joinConsumerPathIfNeeded(paths: PathOrDSL[]): PathOrDSL[] {
    if (paths.length > 0) {
      if (this.alternateCwd !== undefined && this.alternateCwd !== null) {
        const alternate = this.alternateCwd;
        return paths.map((file) => path.join(alternate, file));
      }
      return paths;
    }
    return [];
  }

  /**
   * @param {string[]} files - array of file-paths from which it should search for the dsl patterns.
   * @param {*} filesWithPotentialDsl - array of file-path which may have DSL patterns
   *
   * @returns array of file-paths from 'files' parameter that match the patterns from 'filesWithPotentialDsl' parameter
   */
  async getFilesAccordingToDsl(files: PathLinux[], filesWithPotentialDsl: PathOrDSL[]): Promise<PathLinux[]> {
    const filesListAllMatches = filesWithPotentialDsl.map(async (dsl) => {
      const filesListMatch = files.map(async (file) => {
        const fileInfo = calculateFileInfo(file);
        const generatedFile = format(dsl, fileInfo);
        const matches = await glob(generatedFile);
        const matchesAfterGitIgnore = this.gitIgnore.filter(matches);
        return matchesAfterGitIgnore.filter((match) => fs.existsSync(match));
      });
      return Promise.all(filesListMatch);
    });

    const filesListFlatten = R.flatten(await Promise.all(filesListAllMatches));
    const filesListUnique = R.uniq(filesListFlatten);
    return filesListUnique.map((file) => {
      // when files array has the test file with different letter case, use the one from the file array
      const fileNormalized = pathNormalizeToLinux(file);
      const fileWithCorrectCase = files.find((f) => f.toLowerCase() === fileNormalized.toLowerCase()) || fileNormalized;
      const relativeToConsumer = this.consumer.getPathRelativeToConsumer(fileWithCorrectCase);
      return pathNormalizeToLinux(relativeToConsumer);
    });
  }

  /**
   * for imported component, the package.json in the root directory is a bit-generated file and as
   * such, it should be ignored
   */
  _isPackageJsonOnRootDir(pathRelativeToConsumerRoot: PathLinux, componentMap: ComponentMap) {
    if (!componentMap.rootDir) {
      throw new Error('_isPackageJsonOnRootDir should not get called on non imported components');
    }
    return path.join(componentMap.rootDir, PACKAGE_JSON) === path.normalize(pathRelativeToConsumerRoot);
  }

  /**
   * imported components might have wrapDir, when they do, files should not be added outside of
   * that wrapDir
   */
  _isOutsideOfWrapDir(pathRelativeToConsumerRoot: PathLinux, componentMap: ComponentMap) {
    if (!componentMap.rootDir) {
      throw new Error('_isOutsideOfWrapDir should not get called on non imported components');
    }
    if (!componentMap.wrapDir) return false;
    const wrapDirRelativeToConsumerRoot = path.join(componentMap.rootDir, componentMap.wrapDir);
    return !path.normalize(pathRelativeToConsumerRoot).startsWith(wrapDirRelativeToConsumerRoot);
  }

  /**
   * Add or update existing (imported and new) component according to bitmap
   * there are 3 options:
   * 1. a user is adding a new component. there is no record for this component in bit.map
   * 2. a user is updating an existing component. there is a record for this component in bit.map
   * 3. some or all the files of this component were previously added as another component-id.
   */
  async addOrUpdateComponentInBitMap(component: AddedComponent): Promise<AddResult | null | undefined> {
    const consumerPath = this.consumer.getPath();
    const parsedBitId = component.componentId;
    const componentFromScope = await this._getComponentFromScopeIfExist(parsedBitId);
    const files: ComponentMapFile[] = component.files;
    const foundComponentFromBitMap = this.bitMap.getComponentIfExist(component.componentId, {
      ignoreScopeAndVersion: true,
    });
    const componentFilesP = files.map(async (file: ComponentMapFile) => {
      // $FlowFixMe null is removed later on
      const filePath = path.join(consumerPath, file.relativePath);
      const isAutoGenerated = await isAutoGeneratedFile(filePath);
      if (isAutoGenerated) {
        return null;
      }
      const caseSensitive = false;
      const existingIdOfFile = this.bitMap.getComponentIdByPath(file.relativePath, caseSensitive);
      const idOfFileIsDifferent = existingIdOfFile && !existingIdOfFile.isEqual(parsedBitId);
      if (idOfFileIsDifferent) {
        // not imported component file but exists in bitmap
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        if (this.warnings.alreadyUsed[existingIdOfFile]) {
          // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
          this.warnings.alreadyUsed[existingIdOfFile].push(file.relativePath);
        } else {
          // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
          this.warnings.alreadyUsed[existingIdOfFile] = [file.relativePath];
        }
        return null;
      }
      if (!foundComponentFromBitMap && componentFromScope && this.shouldHandleOutOfSync) {
        const newId = componentFromScope.toBitIdWithLatestVersion();
        if (!this.defaultScope || this.defaultScope === newId.scope) {
          // otherwise, if defaultScope !== newId.scope, they're different components,
          // and no need to change the id.
          // for more details about this scenario, see https://github.com/teambit/bit/issues/1543, last case.
          component.componentId = newId;
          this.warnings.existInScope.push(newId);
        }
      }
      return file;
    });
    // @ts-ignore it can't be null due to the filter function
    const componentFiles: ComponentMapFile[] = (await Promise.all(componentFilesP)).filter((file) => file);
    if (!componentFiles.length) return { id: component.componentId, files: [] };
    if (foundComponentFromBitMap) {
      this._updateFilesAccordingToExistingRootDir(foundComponentFromBitMap, componentFiles, component);
    }
    if (this.trackDirFeature) {
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      if (this.bitMap._areFilesArraysEqual(foundComponentFromBitMap.files, componentFiles)) {
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        return foundComponentFromBitMap;
      }
    }
    if (!this.override && foundComponentFromBitMap) {
      this._updateFilesWithCurrentLetterCases(foundComponentFromBitMap, componentFiles);
      component.files = this._mergeFilesWithExistingComponentMapFiles(componentFiles, foundComponentFromBitMap.files);
    } else {
      component.files = componentFiles;
    }

    const { componentId, trackDir } = component;
    const mainFile = determineMainFile(component, foundComponentFromBitMap);
    const getRootDir = (): PathLinuxRelative | undefined => {
      if (this.trackDirFeature) throw new Error('track dir should not calculate the rootDir');
      if (foundComponentFromBitMap) return foundComponentFromBitMap.rootDir;
      if (!trackDir) throw new Error(`addOrUpdateComponentInBitMap expect to have trackDir for non-legacy workspace`);
      const fileNotInsideTrackDir = componentFiles.find(
        (file) => !pathNormalizeToLinux(file.relativePath).startsWith(`${pathNormalizeToLinux(trackDir)}/`)
      );
      if (fileNotInsideTrackDir) {
        // we check for this error before. however, it's possible that a user have one trackDir
        // and another dir for the tests.
        throw new AddingIndividualFiles(fileNotInsideTrackDir.relativePath);
      }
      return pathNormalizeToLinux(trackDir);
    };
    const getComponentMap = (): ComponentMap => {
      if (this.trackDirFeature) {
        return this.bitMap.addFilesToComponent({ componentId, files: component.files });
      }
      const rootDir = getRootDir();
      const componentMap = this.bitMap.addComponent({
        componentId,
        files: component.files,
        defaultScope: this.defaultScope,
        config: this.config,
        mainFile,
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        override: this.override,
      });
      if (rootDir) componentMap.changeRootDirAndUpdateFilesAccordingly(rootDir);
      return componentMap;
    };
    const componentMap = getComponentMap();
    return { id: componentId, files: componentMap.files };
  }

  /**
   * current componentFiles are relative to the workspace. we want them relative to the rootDir.
   */
  _updateFilesAccordingToExistingRootDir(
    foundComponentFromBitMap: ComponentMap,
    componentFiles: ComponentMapFile[],
    component: AddedComponent
  ) {
    const existingRootDir = foundComponentFromBitMap.rootDir;
    if (!existingRootDir) return; // nothing to do.
    const areFilesInsideExistingRootDir = componentFiles.every((file) =>
      pathNormalizeToLinux(file.relativePath).startsWith(`${existingRootDir}/`)
    );
    if (areFilesInsideExistingRootDir) {
      ComponentMap.changeFilesPathAccordingToItsRootDir(existingRootDir, componentFiles);
      return;
    }
    // some (or all) added files are outside the existing rootDir, the rootDir needs to be changed
    // if a directory was added and it's a parent of the existing rootDir, change the rootDir to
    // the currently added rootDir.
    const currentlyAddedDir = pathNormalizeToLinux(component.trackDir);
    const currentlyAddedDirParentOfRootDir = currentlyAddedDir && existingRootDir.startsWith(`${currentlyAddedDir}/`);
    if (currentlyAddedDirParentOfRootDir) {
      foundComponentFromBitMap.changeRootDirAndUpdateFilesAccordingly(currentlyAddedDir);
      ComponentMap.changeFilesPathAccordingToItsRootDir(currentlyAddedDir, componentFiles);
      return;
    }
    throw new GeneralError(`unable to add individual files outside the root dir (${existingRootDir}) of ${component.componentId}.
you can add the directory these files are located at and it'll change the root dir of the component accordingly`);
    // we might want to change the behavior here to not throw an error and only change the rootDir to "."
    // foundComponentFromBitMap.changeRootDirAndUpdateFilesAccordingly('.');
  }

  /**
   * the risk with merging the currently added files with the existing bitMap files is overriding
   * the `test` property. e.g. the component directory is re-added without adding the tests flag to
   * track new files in that directory. in this case, we want to preserve the `test` property.
   */
  _mergeFilesWithExistingComponentMapFiles(
    componentFiles: ComponentMapFile[],
    existingComponentMapFile: ComponentMapFile[]
  ) {
    return R.unionWith(R.eqBy(R.prop('relativePath')), existingComponentMapFile, componentFiles);
  }

  /**
   * if an existing file is for example uppercase and the new file is lowercase it has different
   * behavior according to the OS. some OS are case sensitive, some are not.
   * it's safer to avoid saving both files and instead, replacing the old file with the new one.
   * in case a file has replaced and it is also a mainFile, replace the mainFile as well
   */
  _updateFilesWithCurrentLetterCases(currentComponentMap: ComponentMap, newFiles: ComponentMapFile[]) {
    const currentFiles = currentComponentMap.files;
    currentFiles.forEach((currentFile) => {
      const sameFile = newFiles.find(
        (newFile) => newFile.relativePath.toLowerCase() === currentFile.relativePath.toLowerCase()
      );
      if (sameFile && currentFile.relativePath !== sameFile.relativePath) {
        if (currentComponentMap.mainFile === currentFile.relativePath) {
          currentComponentMap.mainFile = sameFile.relativePath;
        }
        currentFile.relativePath = sameFile.relativePath;
      }
    });
  }

  async _getComponentFromScopeIfExist(id: BitId): Promise<ModelComponent | null | undefined> {
    try {
      return await this.consumer.scope.getModelComponentIgnoreScope(id);
    } catch (err: any) {
      return null;
    }
  }

  /**
   * if the id is already saved in bitmap file, it might have more data (such as scope, version)
   * use that id instead.
   */
  _getIdAccordingToExistingComponent(currentId: BitIdStr): BitId {
    const existingComponentId = this.bitMap.getExistingBitId(currentId, false);
    if (currentId.includes(VERSION_DELIMITER)) {
      if (
        !existingComponentId || // this id is new, it shouldn't have a version
        !existingComponentId.hasVersion() || // this component is new, it shouldn't have a version
        // user shouldn't add files to a an existing component with different version
        // $FlowFixMe this function gets called only when this.id is set
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        existingComponentId.version !== BitId.getVersionOnlyFromString(this.id)
      ) {
        // $FlowFixMe this.id is defined here
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        throw new VersionShouldBeRemoved(this.id);
      }
    }
    return existingComponentId || BitId.parse(currentId, false);
  }

  _getIdAccordingToTrackDir(dir: PathOsBased): BitId | null | undefined {
    const dirNormalizedToLinux = pathNormalizeToLinux(dir);
    const trackDirs = this.bitMap.getAllTrackDirs();
    if (!trackDirs) return null;
    return trackDirs[dirNormalizedToLinux];
  }

  /**
   * used for updating main file if exists or doesn't exists
   */
  _addMainFileToFiles(files: ComponentMapFile[]): PathOsBased | null | undefined {
    let mainFile = this.main;
    if (mainFile && mainFile.match(REGEX_DSL_PATTERN)) {
      // it's a DSL
      files.forEach((file) => {
        const fileInfo = calculateFileInfo(file.relativePath);
        const generatedFile = format(mainFile, fileInfo);
        const foundFile = this._findMainFileInFiles(generatedFile, files);
        if (foundFile) {
          mainFile = foundFile.relativePath;
        }
        if (fs.existsSync(generatedFile) && !foundFile) {
          const shouldIgnore = this.gitIgnore.ignores(generatedFile);
          if (shouldIgnore) {
            // check if file is in exclude list
            throw new ExcludedMainFile(generatedFile);
          }
          files.push({
            relativePath: pathNormalizeToLinux(generatedFile),
            test: false,
            name: path.basename(generatedFile),
          });
          mainFile = generatedFile;
        }
      });
    }
    if (!mainFile) return undefined;
    if (this.alternateCwd) {
      mainFile = path.join(this.alternateCwd, mainFile);
    }
    const mainFileRelativeToConsumer = this.consumer.getPathRelativeToConsumer(mainFile);
    const mainPath = this.consumer.toAbsolutePath(mainFileRelativeToConsumer);
    if (fs.existsSync(mainPath)) {
      const shouldIgnore = this.gitIgnore.ignores(mainFileRelativeToConsumer);
      if (shouldIgnore) throw new ExcludedMainFile(mainFileRelativeToConsumer);
      if (isDir(mainPath)) {
        throw new MainFileIsDir(mainPath);
      }
      const foundFile = this._findMainFileInFiles(mainFileRelativeToConsumer, files);
      if (foundFile) {
        return foundFile.relativePath;
      }
      files.push({
        relativePath: pathNormalizeToLinux(mainFileRelativeToConsumer),
        test: false,
        name: path.basename(mainFileRelativeToConsumer),
      });
      return mainFileRelativeToConsumer;
    }
    return mainFile;
  }

  _findMainFileInFiles(mainFile: string, files: ComponentMapFile[]) {
    const normalizedMainFile = pathNormalizeToLinux(mainFile).toLowerCase();
    return files.find((file) => file.relativePath.toLowerCase() === normalizedMainFile);
  }

  /**
   * given the component paths, prepare the id, mainFile and files to be added later on to bitmap
   * the id of the component is either entered by the user or, if not entered, concluded by the path.
   * e.g. bar/foo.js, the id would be bar/foo.
   * in case bitmap has already the same id, the complete id is taken from bitmap (see _getIdAccordingToExistingComponent)
   */
  async addOneComponent(componentPathsStats: PathsStats): Promise<AddedComponent> {
    let finalBitId: BitId; // final id to use for bitmap file
    let idFromPath;
    if (this.id) {
      finalBitId = this._getIdAccordingToExistingComponent(this.id);
    }

    const componentsWithFilesP = Object.keys(componentPathsStats).map(async (componentPath: PathOsBased) => {
      if (componentPathsStats[componentPath].isDir) {
        const relativeComponentPath = this.consumer.getPathRelativeToConsumer(componentPath);
        this._throwForOutsideConsumer(relativeComponentPath);
        this.throwForExistingParentDir(relativeComponentPath);
        const matches = await glob(path.join(relativeComponentPath, '**'), {
          cwd: this.consumer.getPath(),
          nodir: true,
        });

        if (!matches.length) throw new EmptyDirectory(componentPath);

        const filteredMatches = this.gitIgnore.filter(matches);

        if (!filteredMatches.length) {
          throw new NoFiles(matches);
        }

        const filteredMatchedFiles = filteredMatches.map((match: PathOsBased) => {
          return { relativePath: pathNormalizeToLinux(match), test: false, name: path.basename(match) };
        });
        const resolvedMainFile = this._addMainFileToFiles(filteredMatchedFiles);

        const absoluteComponentPath = path.resolve(componentPath);
        const splitPath = absoluteComponentPath.split(path.sep);
        const lastDir = splitPath[splitPath.length - 1];
        if (!finalBitId) {
          const idOfTrackDir = this._getIdAccordingToTrackDir(componentPath);
          if (idOfTrackDir) {
            finalBitId = idOfTrackDir;
          } else {
            const nameSpaceOrDir = this.namespace || splitPath[splitPath.length - 2];
            if (!this.namespace) {
              idFromPath = { namespace: BitId.getValidIdChunk(nameSpaceOrDir), name: BitId.getValidIdChunk(lastDir) };
            }
            finalBitId = BitId.getValidBitId(nameSpaceOrDir, lastDir);
          }
        }

        const getTrackDir = () => {
          if (Object.keys(componentPathsStats).length === 1) {
            return relativeComponentPath;
          }
          return undefined;
        };
        const trackDir = getTrackDir();

        return {
          componentId: finalBitId,
          files: filteredMatchedFiles,
          mainFile: resolvedMainFile,
          trackDir,
          idFromPath,
          immediateDir: lastDir,
        };
      }
      // is file
      const absolutePath = path.resolve(componentPath);
      const pathParsed = path.parse(absolutePath);
      const relativeFilePath = this.consumer.getPathRelativeToConsumer(componentPath);
      this._throwForOutsideConsumer(relativeFilePath);
      if (!finalBitId) {
        let dirName = pathParsed.dir;
        if (!dirName) {
          dirName = path.dirname(absolutePath);
        }
        const nameSpaceOrLastDir = this.namespace || R.last(dirName.split(path.sep));
        if (!this.namespace) {
          idFromPath = {
            namespace: BitId.getValidIdChunk(nameSpaceOrLastDir),
            name: BitId.getValidIdChunk(pathParsed.name),
          };
        }
        finalBitId = BitId.getValidBitId(nameSpaceOrLastDir, pathParsed.name);
      }

      const files = [
        { relativePath: pathNormalizeToLinux(relativeFilePath), test: false, name: path.basename(relativeFilePath) },
      ];
      const resolvedMainFile = this._addMainFileToFiles(files);
      return { componentId: finalBitId, files, mainFile: resolvedMainFile, idFromPath };
    });

    let componentsWithFiles: AddedComponent[] = await Promise.all(componentsWithFilesP);

    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const componentId = finalBitId;
    componentsWithFiles = componentsWithFiles.filter((componentWithFiles) => componentWithFiles.files.length);

    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    if (componentsWithFiles.length === 0) return { componentId, files: [] };
    if (componentsWithFiles.length === 1) return componentsWithFiles[0];

    const files = componentsWithFiles.reduce((a, b) => {
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      return a.concat(b.files);
    }, []);
    const groupedComponents = groupby(files, 'relativePath');
    const uniqComponents = Object.keys(groupedComponents).map((key) =>
      assignwith({}, ...groupedComponents[key], (val1, val2) => val1 || val2)
    );
    return {
      componentId,
      files: uniqComponents,
      mainFile: R.head(componentsWithFiles).mainFile,
      trackDir: R.head(componentsWithFiles).trackDir,
      idFromPath,
    };
  }

  getIgnoreList(): string[] {
    const consumerPath = this.consumer.getPath();
    return getIgnoreListHarmony(consumerPath);
  }

  async add(): Promise<AddActionResults> {
    this.ignoreList = this.getIgnoreList();
    this.gitIgnore = ignore().add(this.ignoreList); // add ignore list

    let componentPathsStats: PathsStats = {};

    const resolvedComponentPathsWithoutGitIgnore = R.flatten(
      await Promise.all(this.componentPaths.map((componentPath) => glob(componentPath)))
    );
    this.gitIgnore = ignore().add(this.ignoreList); // add ignore list

    const resolvedComponentPathsWithGitIgnore = this.gitIgnore.filter(resolvedComponentPathsWithoutGitIgnore);
    // Run diff on both arrays to see what was filtered out because of the gitignore file
    const diff = arrayDiff(resolvedComponentPathsWithGitIgnore, resolvedComponentPathsWithoutGitIgnore);

    if (R.isEmpty(resolvedComponentPathsWithoutGitIgnore)) {
      throw new PathsNotExist(this.componentPaths);
    }
    if (!R.isEmpty(resolvedComponentPathsWithGitIgnore)) {
      componentPathsStats = validatePaths(resolvedComponentPathsWithGitIgnore);
    } else {
      throw new NoFiles(diff);
    }
    Object.keys(componentPathsStats).forEach((compPath) => {
      if (!componentPathsStats[compPath].isDir) {
        throw new AddingIndividualFiles(compPath);
      }
    });
    // if a user entered multiple paths and entered an id, he wants all these paths to be one component
    // conversely, if a user entered multiple paths without id, he wants each dir as an individual component
    const isMultipleComponents = Object.keys(componentPathsStats).length > 1 && !this.id;
    if (isMultipleComponents) {
      await this.addMultipleComponents(componentPathsStats);
    } else {
      logger.debugAndAddBreadCrumb('add-components', 'adding one component');
      // when a user enters more than one directory, he would like to keep the directories names
      // so then when a component is imported, it will write the files into the original directories
      const addedOne = await this.addOneComponent(componentPathsStats);
      this._removeNamespaceIfNotNeeded([addedOne]);
      if (!R.isEmpty(addedOne.files)) {
        const addedResult = await this.addOrUpdateComponentInBitMap(addedOne);
        if (addedResult) this.addedComponents.push(addedResult);
      }
    }
    await this.linkComponents(this.addedComponents.map((item) => item.id));
    Analytics.setExtraData('num_components', this.addedComponents.length);
    return { addedComponents: this.addedComponents, warnings: this.warnings };
  }

  async linkComponents(ids: BitId[]) {
    if (this.trackDirFeature) {
      // if trackDirFeature is set, it happens during the component-load and because we load the
      // components in the next line, it gets into an infinite loop.
      return;
    }
    const { components } = await this.consumer.loadComponents(BitIds.fromArray(ids));
    const nodeModuleLinker = new NodeModuleLinker(components, this.consumer, this.consumer.bitMap);
    await nodeModuleLinker.link();
  }

  async addMultipleComponents(componentPathsStats: PathsStats): Promise<void> {
    logger.debugAndAddBreadCrumb('add-components', 'adding multiple components');
    this._removeDirectoriesWhenTheirFilesAreAdded(componentPathsStats);
    const added = await this._tryAddingMultiple(componentPathsStats);
    validateNoDuplicateIds(added);
    this._removeNamespaceIfNotNeeded(added);
    await this._addMultipleToBitMap(added);
  }

  /**
   * some uses of wildcards might add directories and their files at the same time, in such cases
   * only the files are needed and the directories can be ignored.
   * @see https://github.com/teambit/bit/issues/1406 for more details
   */
  _removeDirectoriesWhenTheirFilesAreAdded(componentPathsStats: PathsStats) {
    const allPaths = Object.keys(componentPathsStats);
    allPaths.forEach((componentPath) => {
      const foundDir = allPaths.find((p) => p === path.dirname(componentPath));
      if (foundDir && componentPathsStats[foundDir]) {
        logger.debug(`add-components._removeDirectoriesWhenTheirFilesAreAdded, ignoring ${foundDir}`);
        delete componentPathsStats[foundDir];
      }
    });
  }

  async _addMultipleToBitMap(added: AddedComponent[]): Promise<void> {
    const missingMainFiles = [];
    await Promise.all(
      added.map(async (component) => {
        if (!R.isEmpty(component.files)) {
          try {
            const addedComponent = await this.addOrUpdateComponentInBitMap(component);
            if (addedComponent && addedComponent.files.length) this.addedComponents.push(addedComponent);
          } catch (err: any) {
            if (!(err instanceof MissingMainFile)) throw err;
            // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
            missingMainFiles.push(err);
          }
        }
      })
    );
    if (missingMainFiles.length) {
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      throw new MissingMainFileMultipleComponents(missingMainFiles.map((err) => err.componentId).sort());
    }
  }

  _removeNamespaceIfNotNeeded(addedComponents: AddedComponent[]): void {
    const allIds = this.bitMap.getAllBitIdsFromAllLanes();
    addedComponents.forEach((addedComponent) => {
      if (!addedComponent.idFromPath) return; // when the id was not generated from the path do nothing.
      const componentsWithSameName = addedComponents // $FlowFixMe
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        .filter((a) => a.idFromPath && a.idFromPath.name === addedComponent.idFromPath.name);
      const bitIdFromNameOnly = new BitId({ name: addedComponent.idFromPath.name });
      const existingComponentWithSameName = allIds.searchWithoutScopeAndVersion(bitIdFromNameOnly);
      if (componentsWithSameName.length === 1 && !existingComponentWithSameName) {
        addedComponent.componentId = bitIdFromNameOnly;
      }
    });
  }

  async _tryAddingMultiple(componentPathsStats: PathsStats): Promise<AddedComponent[]> {
    const addedP = Object.keys(componentPathsStats).map(async (onePath) => {
      const oneComponentPathStat = { [onePath]: componentPathsStats[onePath] };
      try {
        const addedComponent = await this.addOneComponent(oneComponentPathStat);
        return addedComponent;
      } catch (err: any) {
        if (!(err instanceof EmptyDirectory)) throw err;
        this.warnings.emptyDirectory.push(onePath);
        return null;
      }
    });
    const added = await Promise.all(addedP);
    return R.reject(R.isNil, added);
  }

  _throwForOutsideConsumer(relativeToConsumerPath: PathOsBased) {
    if (relativeToConsumerPath.startsWith('..')) {
      throw new PathOutsideConsumer(relativeToConsumerPath);
    }
  }

  private throwForExistingParentDir(relativeToConsumerPath: PathOsBased) {
    const isParentDir = (parent: string) => {
      const relative = path.relative(parent, relativeToConsumerPath);
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    };
    this.bitMap.components.forEach((componentMap) => {
      if (!componentMap.rootDir) return;
      if (isParentDir(componentMap.rootDir)) {
        throw new ParentDirTracked(
          componentMap.rootDir,
          componentMap.id.toStringWithoutVersion(),
          relativeToConsumerPath
        );
      }
    });
  }
}

/**
 * validatePaths - validate if paths entered by user exist and if not throw an error
 *
 * @param {string[]} fileArray - array of paths
 * @returns {PathsStats} componentPathsStats
 */
function validatePaths(fileArray: string[]): PathsStats {
  const componentPathsStats = {};
  fileArray.forEach((componentPath) => {
    if (!fs.existsSync(componentPath)) {
      throw new PathsNotExist([componentPath]);
    }
    componentPathsStats[componentPath] = {
      isDir: isDir(componentPath),
    };
  });
  return componentPathsStats;
}

/**
 * validate that no two files where added with the same id in the same bit add command
 */
function validateNoDuplicateIds(addComponents: Record<string, any>[]) {
  const duplicateIds = {};
  const newGroupedComponents = groupby(addComponents, 'componentId');
  Object.keys(newGroupedComponents).forEach((key) => {
    if (newGroupedComponents[key].length > 1) duplicateIds[key] = newGroupedComponents[key];
  });
  if (!R.isEmpty(duplicateIds) && !R.isNil(duplicateIds)) throw new DuplicateIds(duplicateIds);
}
