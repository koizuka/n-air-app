import { StatefulService, mutation } from 'services/stateful-service';
import { getPlatformService } from 'services/platforms';
import { UserService } from './user';
import { Inject } from 'util/injector';
import { StreamingService, EStreamingState } from '../services/streaming';
import { HostsService } from 'services/hosts';
import { NiconicoService } from './platforms/niconico';
import { CustomizationService } from './customization';


interface IStreamInfoServiceState {
  viewerCount: number;
  commentCount: number;
}

const PLATFORM_STATUS_UPDATE_INTERVAL = 60 * 1000;
const SENTRY_REPORTING_RATIO = 0.10;

/**
 * The stream info service is responsible for keeping
 * reliable, up-to-date information about the user's
 * channel and current stream in the Vuex store for
 * components to make use of.
 */
export class StreamInfoService extends StatefulService<IStreamInfoServiceState> {
  @Inject() userService: UserService;
  @Inject() streamingService: StreamingService;
  @Inject() hostsService: HostsService;
  @Inject() customizationService: CustomizationService;

  static initialState: IStreamInfoServiceState = {
    viewerCount: 0,
    commentCount: 0,
  };

  platformStatusInterval: number;

  get streamingStatus() {
    return this.streamingService.state.streamingStatus;
  }

  init() {
    this.platformStatusInterval = window.setInterval(() => {
      if (this.streamingService.isStreaming && this.userService.isLoggedIn()) {
        const platform = getPlatformService(this.userService.platform.type);

        platform.fetchViewerCount().then(viewers => {
          this.SET_VIEWER_COUNT(viewers);
        }, e => {
          // Sentryに送信する量を間引く
          if (Math.random() < SENTRY_REPORTING_RATIO) {
            console.error(e);
          }
        });

        if (platform instanceof NiconicoService) {
          platform.fetchCommentCount().then(comments => {
            this.SET_COMMENT_COUNT(comments);
          }, e => {
            // Sentryに送信する量を間引く
            if (Math.random() < SENTRY_REPORTING_RATIO) {
              console.error(e);
            }
          });
        }
      }
    }, PLATFORM_STATUS_UPDATE_INTERVAL);

    this.streamingService.streamingStatusChange.subscribe(() => {
      console.log('streamingService.streamingStatusChange! ', this.streamingStatus);
      if (this.streamingStatus === EStreamingState.Reconnecting) {
        if (this.customizationService.enableReconnetion) {
          if (this.userService.isLoggedIn()) {
            const platform = getPlatformService(this.userService.platform.type);
            if (platform.checkStillOnAir) {
              console.log('reconnecting - checking program status');
              platform.checkStillOnAir().then(live => {
                if (!live) {
                  console.log(`stop reconnection: ${this.userService.platform.type} programas has ended.`);
                  this.streamingService.stopStreaming();
                }
              }).catch(e => {
                console.error(`stop reconnection: ${this.userService.platform.type} checkStillOnAir() error: ${e}.`);
                this.streamingService.stopStreaming();
              });
            }
          }
        } else {
          console.log('stop reconnection: reconnection is disabled.');
          this.streamingService.stopStreaming();
        }
      }
    });
  }

  @mutation()
  SET_VIEWER_COUNT(viewers: number) {
    this.state.viewerCount = viewers;
  }

  @mutation()
  SET_COMMENT_COUNT(comments: number) {
    this.state.commentCount = comments;
  }
}
