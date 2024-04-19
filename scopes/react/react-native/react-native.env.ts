import { AspectMain } from '@teambit/aspect';
import { Bundler, BundlerContext } from '@teambit/bundler';
import { Environment, DependenciesEnv, PreviewEnv } from '@teambit/envs';
import { WebpackConfigTransformer } from '@teambit/webpack';
import { reactNativeAlias } from './webpack/react-native-alias';

import { removeExposedReactNative, removeReactNativePeerEntry } from './webpack/webpack-template-transformers';

export const ReactNativeEnvType = 'react-native';

export class ReactNativeEnv implements Environment, DependenciesEnv, PreviewEnv {
  constructor(private aspect: AspectMain) {}

  getAdditionalHostDependencies(): string[] {
    return ['@teambit/mdx.ui.mdx-scope-context', '@mdx-js/react', 'react', 'react-native-web'];
  }

  async getTemplateBundler(context: BundlerContext, transformers: WebpackConfigTransformer[] = []): Promise<Bundler> {
    return this.createTemplateWebpackBundler(context, transformers);
  }

  async createTemplateWebpackBundler(
    context: BundlerContext,
    transformers: WebpackConfigTransformer[] = []
  ): Promise<Bundler> {
    return this.aspect.aspectEnv.createTemplateWebpackBundler(context, [
      removeExposedReactNative,
      removeReactNativePeerEntry,
      reactNativeAlias,
      ...transformers,
    ]);
  }

  getDependencies() {
    return {
      dependencies: {
        react: '-',
        'react-dom': '-',
        'react-native': '-',
      },
      devDependencies: {
        react: '-',
        'react-dom': '-',
        'react-native': '-',
        '@types/jest': '^26.0.0',
        '@types/react': '^17.0.8',
        '@types/react-dom': '^17.0.5',
        '@types/react-native': '^0.68.5',
        // This is added as dev dep since our jest file transformer uses babel plugins that require this to be installed
        '@babel/runtime': '7.23.2',
        '@types/testing-library__jest-dom': '5.9.5',
      },
      peerDependencies: {
        react: '^16.8.0 || ^17.0.0',
        'react-dom': '^16.8.0 || ^17.0.0',
        'react-native': '^0.68.0',
        'react-native-web': '^0.16.5',
      },
    };
  }

  async __getDescriptor() {
    return {
      type: ReactNativeEnvType,
    };
  }
}
