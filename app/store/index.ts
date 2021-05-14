import Vue from 'vue';
import Vuex, { Store } from 'vuex';
import _ from 'lodash';
import electron from 'electron';
import { getModule, StatefulService } from '../services/core/stateful-service';
import { ServicesManager } from '../services-manager';
import { IMutation } from 'services/jsonrpc';
import Util from 'services/utils';

Vue.use(Vuex);

const { ipcRenderer, remote } = electron;

const debug = process.env.NODE_ENV !== 'production';

const mutations = {
  BULK_LOAD_STATE(state: any, data: any) {
    _.each(data.state, (value, key) => {
      state[key] = value;
    });
  }
};

const actions = {
};

const plugins: any[] = [];

let makeStoreReady: Function;

const storeReady = new Promise<Store<any>>(resolve => {
  makeStoreReady = resolve;
});

// This plugin will keep all vuex stores in sync via
// IPC with the main process.
plugins.push((store: Store<any>) => {
  store.subscribe((mutation: Dictionary<any>) => {
    const servicesManager: ServicesManager = ServicesManager.instance;
    if (mutation.payload && !mutation.payload.__vuexSyncIgnore) {

      const mutationToSend: IMutation = {
        type: mutation.type,
        payload: mutation.payload
      };

      if (servicesManager.isMutationBufferingEnabled()) {
        servicesManager.addMutationToBuffer(mutationToSend);
      } else {
        ipcRenderer.send('vuex-mutation', mutationToSend);
      }
    }
  });

  // Only the main window should ever receive this
  ipcRenderer.on('vuex-sendState', (event: Electron.Event, windowId: number) => {
    const win = remote.BrowserWindow.fromId(windowId);
    win.webContents.send('vuex-loadState', store.state);
  });

  // Only child windows should ever receive this
  ipcRenderer.on('vuex-loadState', (event: Electron.Event, state: any) => {
    store.commit('BULK_LOAD_STATE', {
      state,
      __vuexSyncIgnore: true
    });
    makeStoreReady(store);
  });

  // All windows can receive this
  ipcRenderer.on('vuex-mutation', (event: Electron.Event, mutation: any) => {
    commitMutation(mutation);
  });

  ipcRenderer.send('vuex-register');
});


let store: Store<any> = null;

export function createStore(): Promise<Store<any>> {
  const statefulServiceModules = {};
  const servicesManager: ServicesManager = ServicesManager.instance;
  const statefulServices = servicesManager.getStatefulServicesAndMutators();
  Object.keys(statefulServices).forEach(serviceName => {
    statefulServiceModules[serviceName] = getModule(statefulServices[serviceName]);
  });

  store = new Vuex.Store({
    modules: {
      ...statefulServiceModules
    },
    plugins,
    mutations,
    actions,
    strict: debug
  });

  StatefulService.setupVuexStore(store);

  if (Util.isMainWindow()) makeStoreReady(store);

  return storeReady;
}

export function commitMutation(mutation: IMutation) {
  store.commit(mutation.type, Object.assign({}, mutation.payload, {
    __vuexSyncIgnore: true
  }));
}
