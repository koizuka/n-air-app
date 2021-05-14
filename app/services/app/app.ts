import { StatefulService, mutation } from 'services/core/stateful-service';
import { OnboardingService } from 'services/onboarding';
import { HotkeysService } from 'services/hotkeys';
import { UserService } from 'services/user';
import { ShortcutsService } from 'services/shortcuts';
import { Inject } from 'services/core/injector';
import electron from 'electron';
import { TransitionsService } from 'services/transitions';
import { SourcesService } from 'services/sources';
import { ScenesService } from 'services/scenes';
import { VideoService } from 'services/video';
import { track } from 'services/usage-statistics';
import { IpcServerService } from 'services/ipc-server';
import { TcpServerService } from 'services/tcp-server';
import { PerformanceMonitorService } from 'services/performance-monitor';
import { SceneCollectionsService } from 'services/scene-collections';
import { FileManagerService } from 'services/file-manager';
import { PatchNotesService } from 'services/patch-notes';
import { ProtocolLinksService } from 'services/protocol-links';
import { WindowsService } from 'services/windows';
import { QuestionaireService } from 'services/questionaire';
import { InformationsService } from 'services/informations';
import { CrashReporterService } from 'services/crash-reporter';
import * as obs from '../../../obs-api';

interface IAppState {
  loading: boolean;
  argv: string[];
}

/**
 * Performs operations that happen once at startup and shutdown. This service
 * mainly calls into other services to do the heavy lifting.
 */
export class AppService extends StatefulService<IAppState> {
  @Inject() onboardingService: OnboardingService;
  @Inject() sceneCollectionsService: SceneCollectionsService;
  @Inject() hotkeysService: HotkeysService;
  @Inject() userService: UserService;
  @Inject() shortcutsService: ShortcutsService;
  @Inject() patchNotesService: PatchNotesService;
  @Inject() windowsService: WindowsService;

  static initialState: IAppState = {
    loading: true,
    argv: electron.remote.process.argv
  };

  private autosaveInterval: number;

  @Inject() transitionsService: TransitionsService;
  @Inject() sourcesService: SourcesService;
  @Inject() scenesService: ScenesService;
  @Inject() videoService: VideoService;
  @Inject() private ipcServerService: IpcServerService;
  @Inject() private tcpServerService: TcpServerService;
  @Inject() private performanceMonitorService: PerformanceMonitorService;
  @Inject() private fileManagerService: FileManagerService;
  @Inject() private protocolLinksService: ProtocolLinksService;
  @Inject() private questionaireService: QuestionaireService;
  @Inject() private informationsService: InformationsService;
  @Inject() private crashReporterService: CrashReporterService;

  @track('app_start')
  async load() {
    this.START_LOADING();

    // Initialize OBS
    obs.NodeObs.OBS_API_initAPI('en-US', electron.remote.process.env.NAIR_IPC_USERDATA);

    // We want to start this as early as possible so that any
    // exceptions raised while loading the configuration are
    // associated with the user in sentry.
    await this.userService;

    // Second, we want to start the crash reporter service.  We do this
    // after the user service because we want crashes to be associated
    // with a particular user if possible.
    this.crashReporterService.beginStartup();

    await this.sceneCollectionsService.initialize();
    const questionaireStarted = await this.questionaireService.startIfRequired()

    const onboarded = !questionaireStarted && this.onboardingService.startOnboardingIfRequired();

    electron.ipcRenderer.on('shutdown', () => {
      electron.ipcRenderer.send('acknowledgeShutdown');
      this.shutdownHandler();
    });

    this.shortcutsService;

    this.performanceMonitorService.start();

    this.ipcServerService.listen();
    this.tcpServerService.listen();

    this.patchNotesService.showPatchNotesIfRequired(onboarded);

    this.informationsService;

    this.crashReporterService.endStartup();

    this.FINISH_LOADING();
    this.protocolLinksService.start(this.state.argv);
  }

  @track('app_close')
  private shutdownHandler() {
    this.START_LOADING();

    this.crashReporterService.beginShutdown();

    this.ipcServerService.stopListening();
    this.tcpServerService.stopListening();

    window.setTimeout(async () => {
      await this.sceneCollectionsService.deinitialize();
      this.performanceMonitorService.stop();
      this.transitionsService.shutdown();
      this.windowsService.closeAllOneOffs();
      await this.fileManagerService.flushAll();
      this.crashReporterService.endShutdown();
      obs.NodeObs.OBS_service_removeCallback();
      obs.NodeObs.OBS_API_destroyOBS_API();
      electron.ipcRenderer.send('shutdownComplete');
    }, 300);
  }

  relaunch({ clearCacheDir }: { clearCacheDir?: boolean } = {}) {
    const originalArgs: string[] = electron.remote.process.argv.slice(1);

    // キャッシュクリアしたいときだけつくようにする
    const args = clearCacheDir
      ? originalArgs.concat('--clearCacheDir')
      : originalArgs.filter(x => x !== '--clearCacheDir');

    electron.remote.app.relaunch({ args });
    electron.remote.app.quit();
  }

  startLoading() {
    this.START_LOADING();
  }

  finishLoading() {
    this.FINISH_LOADING();
  }

  @mutation()
  private START_LOADING() {
    this.state.loading = true;
  }

  @mutation()
  private FINISH_LOADING() {
    this.state.loading = false;
  }

  @mutation()
  private SET_ARGV(argv: string[]) {
    this.state.argv = argv;
  }
}
