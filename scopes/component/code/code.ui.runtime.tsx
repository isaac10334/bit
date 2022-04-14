import { ComponentAspect, ComponentUI } from '@teambit/component';
import { UIRuntime } from '@teambit/ui';
import React from 'react';
import { SlotRegistry, Slot } from '@teambit/harmony';
import type { FileIconMatch } from '@teambit/code.ui.utils.get-file-icon';
import { staticStorageUrl } from '@teambit/base-ui.constants.storage';
import { CodePage } from '@teambit/code.ui.code-tab-page';
import { CodeComparePage } from '@teambit/code.ui.code-compare-tab-page';
import { CodeAspect } from './code.aspect';
import { CodeSection } from './code.section';
import { CodeCompareSection } from './code-compare.section';

const isTsx = /\.tsx$/;

export type FileIconSlot = SlotRegistry<FileIconMatch[]>;

/**
 * Component code tab aspect. Presents the code tab page and allows to control the code tab and register specific icons for each file type.
 *  @example CodeUI.registerEnvFileIcon([(fileName) => (/your-regexp/.test(fileName) ? 'your.icon.url' : undefined)])
 */
export class CodeUI {
  constructor(
    /**
     * register an icon for a specific file type. pass icon and a match method/regexp
     */
    private fileIconSlot?: FileIconSlot
  ) {}
  getCodePage = () => {
    return <CodePage fileIconSlot={this.fileIconSlot} />;
  };
  getCodeComparePage = () => {
    return <CodeComparePage></CodeComparePage>;
  };
  registerEnvFileIcon(icons: FileIconMatch[]) {
    this.fileIconSlot?.register(icons);
    return this;
  }
  static dependencies = [ComponentAspect];

  static runtime = UIRuntime;

  static slots = [Slot.withType<string>()];

  static async provider([component]: [ComponentUI], config, [fileIconSlot]: [FileIconSlot]) {
    const ui = new CodeUI(fileIconSlot);
    const codeSection = new CodeSection(ui);
    const compareSection = new CodeCompareSection(ui);
    // overrides the default tsx react icon with the typescript icon
    ui.registerEnvFileIcon([
      (fileName) => (isTsx.test(fileName) ? `${staticStorageUrl}/file-icons/file_type_typescript.svg` : undefined),
    ]);
    component.registerRoute([codeSection.route, compareSection.route]);
    component.registerWidget(codeSection.navigationLink, codeSection.order);
    component.registerNavigation(compareSection.navigationLink, compareSection.order);

    return ui;
  }
}

CodeAspect.addRuntime(CodeUI);
