import Vue from 'vue';
import electron from 'electron';
import { Component, Watch } from 'vue-property-decorator';
import { Inject } from 'services/core/injector';
import { getComponents, IWindowOptions, WindowsService } from 'services/windows';
import TitleBar from '../TitleBar.vue';
import Utils from 'services/utils';

@Component({
  components: {
    TitleBar,
    ...getComponents(),
  },
})
export default class ChildWindow extends Vue {
  @Inject() private windowsService: WindowsService;

  components: { name: string; isShown: boolean; title: string }[] = [];
  private refreshingTimeout = 0;

  mounted() {
    this.onWindowUpdatedHandler(this.options);
    this.windowsService.windowUpdated.subscribe(windowInfo => {
      if (windowInfo.windowId !== 'child') return;
      this.onWindowUpdatedHandler(windowInfo.options);
    });
  }

  get options() {
    return this.windowsService.state.child;
  }

  get currentComponent() {
    return this.components[this.components.length - 1];
  }

  clearComponentStack() {
    this.components = [];
  }

  private setWindowTitle() {
    electron.remote.getCurrentWindow().setTitle(this.currentComponent.title);
  }

  private onWindowUpdatedHandler(options: IWindowOptions) {
    // TODO: windowSizeHandler 対応
    //    window.removeEventListener('resize', this.windowSizeHandler);
    // If the window was closed, just clear the stack
    if (!options.isShown) {
      this.clearComponentStack();
      return;
    }

    if (options.preservePrevWindow) {
      this.handlePreservePrevWindow(options);
      return;
    }

    if (options.isPreserved) {
      this.handleIsPreservedWindow();
      return;
    }

    this.clearComponentStack();

    // This is essentially a race condition, but make a best effort
    // at having a successful paint cycle before loading a component
    // that will do a bunch of synchronous IO.
    clearTimeout(this.refreshingTimeout);
    Utils.makeChildWindowVisible();
    this.refreshingTimeout = window.setTimeout(async () => {
      this.components.push({
        name: options.componentName,
        isShown: true,
        title: options.title,
        // TODO: hideStyleblockers 対応
        //        hideStyleBlockers: options.hideStyleBlockers,
      });
      this.setWindowTitle();
      // TODO: windowSizeHandler 対応
      //      window.addEventListener('resize', this.windowSizeHandler);
    }, 50);
  }

  private handlePreservePrevWindow(options: IWindowOptions) {
    this.currentComponent.isShown = false;
    this.components.push({
      name: options.componentName,
      isShown: true,
      title: options.title,
      // TODO: hideStyleblockers 対応
      //     hideStyleBlockers: options.hideStyleBlockers,
    });
    this.setWindowTitle();
    // TODO: windowSizeHandler 対応
    //   window.addEventListener('resize', this.windowSizeHandler);
  }

  private handleIsPreservedWindow() {
    this.components.pop();
    this.currentComponent.isShown = true;
    this.setWindowTitle();
    // TODO: windowSizeHandler 対応
    //    window.addEventListener('resize', this.windowSizeHandler);
  }
}
