import { I18nService } from 'services/i18n';

// eslint-disable-next-line
window['eval'] = global.eval = () => {
  throw new Error('window.eval() is disabled for security');
};

import 'reflect-metadata';
import Vue from 'vue';

import { createStore } from './store';
import { WindowsService } from './services/windows';
import { AppService } from './services/app';
import Utils from './services/utils';
import electron from 'electron';
import * as Sentry from '@sentry/electron/renderer';
import { init as sentryVueInit } from '@sentry/vue';
import VTooltip from 'v-tooltip';
import Toasted from 'vue-toasted';
import VueI18n from 'vue-i18n';
import moment from 'moment';
import { setupGlobalContextMenuForEditableElement } from 'util/menus/GlobalMenu';
import VModal from 'vue-js-modal';
import VeeValidate from 'vee-validate';
import ChildWindow from 'components/windows/ChildWindow.vue';
import OneOffWindow from 'components/windows/OneOffWindow.vue';
import util from 'util';

const { ipcRenderer, remote } = electron;

const nAirVersion = remote.process.env.NAIR_VERSION;
const isProduction = process.env.NODE_ENV === 'production';

type SentryParams = {
  organization: string;
  key: string;
  project: string;
};
// Akihiko Koizuka n-air-dev
const sentryOrg = 'o159526';

function getSentryDsn(p: SentryParams): string {
  return `https://${p.key}@${p.organization}.ingest.sentry.io/${p.project}`;
}

function getSentryCrashReportUrl(p: SentryParams): string {
  return `https://${p.organization}.ingest.sentry.io/api/${p.project}/minidump/?sentry_key=${p.key}`;
}

// This is the development DSN
const sentryParam: SentryParams = {
  organization: sentryOrg,
  project: '1222027',
  key: '9264887647bb4b108355c6bef3a9bb5d',
};

if (isProduction) {
  electron.crashReporter.start({
    productName: 'n-air-app',
    companyName: 'n-air-app',
    submitURL: getSentryCrashReportUrl(sentryParam),
    extra: {
      version: nAirVersion,
      processType: 'renderer',
    },
  });
}

const windowId = Utils.getWindowId();

function wrapLogFn(fn: string) {
  const old: Function = console[fn];
  console[fn] = (...args: any[]) => {
    old.apply(console, args);

    const level = fn === 'log' ? 'info' : fn;

    sendLogMsg(level, ...args);
  };
}

function sendLogMsg(level: string, ...args: any[]) {
  const serialized = args
    .map(arg => {
      if (typeof arg === 'string') return arg;

      return util.inspect(arg);
    })
    .join(' ');

  ipcRenderer.send('logmsg', { level, sender: windowId, message: serialized });
}

['log', 'info', 'warn', 'error'].forEach(wrapLogFn);

window.addEventListener('error', e => {
  sendLogMsg('error', e.error);
});

window.addEventListener('unhandledrejection', e => {
  sendLogMsg('error', e.reason);
});

if ((isProduction || process.env.NAIR_REPORT_TO_SENTRY) && !electron.remote.process.env.NAIR_IPC) {
  const sentryDsn = getSentryDsn(sentryParam);
  console.log(`Sentry DSN: ${sentryDsn}`);
  Sentry.init({
    dsn: sentryDsn,
    release: nAirVersion,
    sampleRate: /* isPreview ? */ 1.0 /* : 0.1 */,
    Vue,
  }, sentryVueInit);

  const oldConsoleError = console.error;

  console.error = (msg: string, ...params: any[]) => {
    oldConsoleError(msg, ...params);

    Sentry.withScope(scope => {
      if (params[0] instanceof Error) {
        scope.setExtra('exception', params[0].stack);
      }

      scope.setExtra('console-args', JSON.stringify(params, null, 2));
      Sentry.captureMessage(msg, 'error');
    });
  };
}

require('./app.less');
require('./theme.less');

// Initiates tooltips and sets their parent wrapper
Vue.use(VTooltip);
VTooltip.options.defaultContainer = '#mainWrapper';
Vue.use(Toasted);
Vue.use(VeeValidate); // form validations
Vue.use(VModal);

// Disable chrome default drag/drop behavior
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragenter', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
document.addEventListener('auxclick', event => event.preventDefault());

document.addEventListener('DOMContentLoaded', () => {
  createStore().then(async store => {
    const windowsService: WindowsService = WindowsService.instance;

    if (Utils.isMainWindow()) {
      ipcRenderer.on('closeWindow', () => windowsService.closeMainWindow());
      AppService.instance.load();
    } else {
      if (Utils.isChildWindow()) {
        ipcRenderer.on('closeWindow', () => windowsService.closeChildWindow());
      }
    }

    // setup VueI18n plugin
    Vue.use(VueI18n);
    const i18nService: I18nService = I18nService.instance;
    await i18nService.load(); // load translations from a disk

    const i18n = new VueI18n({
      locale: i18nService.state.locale,
      fallbackLocale: i18nService.getFallbackLocale(),
      messages: i18nService.getLoadedDictionaries(),
      missing: ((locale: VueI18n.Locale, key: VueI18n.Path, vm: Vue, values: any[]): string => {
        if (values[0] && typeof values[0].fallback === 'string') {
          if (!isProduction) {
            // beware: enable following line only when investigating around i18n keys!
            // this adds huge amount of lines to console.

            // console.warn(`i18n missing key - ${key}: ${values[0].fallback}`);
            console.warn(`i18n missing key - ${key}: (フォールバックなし)`);
          }
          return values[0].fallback;
        }

        // 返すべきものがないときは何も返さずデフォルト動作に任せる
        // ref. https://github.com/kazupon/vue-i18n/blob/79e3bfe537d28b11a3119ff9ed0704e5dfa72cf3/src/index.js#L172-L188
      }) as any, // 型定義と実装が異なっているのでanyに飛ばす
      silentTranslationWarn: true,
    });

    I18nService.setVuei18nInstance(i18n);

    const momentLocale = i18nService.state.locale.split('-')[0];
    moment.locale(momentLocale);

    // create a root Vue component
    const windowId = Utils.getCurrentUrlParams().windowId;
    const vm = new Vue({
      el: '#app',
      i18n,
      store,
      render: h => {
        if (windowId === 'child') return h(ChildWindow);
        if (windowId === 'main') {
          const componentName = windowsService.state[windowId].componentName;
          return h(windowsService.components[componentName]);
        }
        return h(OneOffWindow);
      },
    });

    Sentry.configureScope(scope => {
      scope.setTag('windowId', windowId);
    });

    setupGlobalContextMenuForEditableElement();
  });
});

if (Utils.isDevMode()) {
  window.addEventListener('error', () => ipcRenderer.send('showErrorAlert'));
  window.addEventListener('keyup', ev => {
    if (ev.key === 'F12') electron.ipcRenderer.send('openDevTools');
  });
}
