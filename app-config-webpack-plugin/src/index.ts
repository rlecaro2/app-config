import { join } from 'path';
import { Compiler } from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import type { ConfigLoadingOptions, SchemaLoadingOptions } from '@lcdev/app-config';
import { regex } from './loader';
import { loadConfig } from './compat';

// loader is the filepath, not the export
const loader = require.resolve('./loader');

export interface Options {
  headerInjection?: boolean;
  loading?: ConfigLoadingOptions;
  schemaLoading?: SchemaLoadingOptions;
}

export default class AppConfigPlugin {
  headerInjection: boolean;
  loadingOptions?: ConfigLoadingOptions;
  schemaLoadingOptions?: SchemaLoadingOptions;

  constructor({ headerInjection = false, loading, schemaLoading }: Options = {}) {
    this.headerInjection = headerInjection;
    this.loadingOptions = loading;
    this.schemaLoadingOptions = schemaLoading;
  }

  static loader = loader;
  static regex = regex;

  apply(compiler: Compiler) {
    if (this.headerInjection && !process.env.WEBPACK_DEV_SERVER) {
      this.injectHead(compiler);
    }

    this.interceptImports(compiler);
  }

  interceptImports(compiler: Compiler) {
    compiler.hooks.normalModuleFactory.tap('AppConfigPlugin', (factory) => {
      factory.hooks.beforeResolve.tapPromise(
        'AppConfigPlugin',
        async (resolve?: { request: string }) => {
          if (!resolve) return;

          if (resolve.request === '@lcdev/app-config' || resolve.request === 'app-config') {
            const { filePaths } = await loadConfig(this.loadingOptions, this.schemaLoadingOptions);

            if (filePaths?.length) {
              [resolve.request] = filePaths; // eslint-disable-line no-param-reassign
            } else {
              resolve.request = join(__dirname, '..', '.config-placeholder'); // eslint-disable-line no-param-reassign
            }
          }

          return resolve;
        },
      );
    });
  }

  injectHead(compiler: Compiler) {
    compiler.hooks.compilation.tap('AppConfigPlugin', (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).alterAssetTagGroups.tapPromise(
        'AppConfigPlugin',
        async ({ headTags, ...html }) => {
          const { fullConfig } = await loadConfig(this.loadingOptions, this.schemaLoadingOptions);

          // remove placeholder <script id="app-config"></script> if it exists
          const newTags = headTags.filter(({ attributes }) => attributes.id !== 'app-config');

          newTags.push({
            tagName: 'script',
            attributes: { id: 'app-config', type: 'text/javascript' },
            innerHTML: `window._appConfig = ${JSON.stringify(fullConfig)}`,
            voidTag: false,
          });

          return {
            ...html,
            headTags: newTags,
          };
        },
      );
    });
  }
}

export { regex, loader };
