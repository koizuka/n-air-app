import { Service } from './service';
import { Inject } from './core/injector';
import { UserService } from './user';
import { HostsService } from './hosts';
import fs from 'fs';
import path from 'path';
import electron from 'electron';
import { authorizedHeaders } from 'util/requests';

export type TUsageEvent =
  'stream_start' |
  'stream_end' |
  'app_start' |
  'app_close' |
  'crash';

export function track(event: TUsageEvent) {
  return (target: any, methodName: string, descriptor: PropertyDescriptor) => {

    return {
      ...descriptor,
      value(...args: any[]): any {
        UsageStatisticsService.instance.recordEvent(event);
        descriptor.value.apply(this, args);
      }
    };
  };
}


export class UsageStatisticsService extends Service {
  @Inject() userService: UserService;
  @Inject() hostsService: HostsService;

  installerId: string;
  version = electron.remote.process.env.NAIR_VERSION;

  init() {
    this.loadInstallerId();
  }

  loadInstallerId() {
    let installerId = localStorage.getItem('installerId');

    if (!installerId) {
      const exePath = electron.remote.app.getPath('exe');
      const installerNamePath = path.join(path.dirname(exePath), 'installername');

      if (fs.existsSync(installerNamePath)) {
        try {
          const installerName = fs.readFileSync(installerNamePath).toString();

          if (installerName) {
            const matches = installerName.match(/\-([A-Za-z0-9]+)\.exe/);
            if (matches) {
              installerId = matches[1];
              localStorage.setItem('installerId', installerId);
            }
          }
        } catch (e) {
          console.error('Error loading installer id', e);
        }
      }
    }

    this.installerId = installerId;
  }

  get isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * Record a usage event on our server.
   * @param event the event type to record
   * @param metadata arbitrary data to store with the event (must be serializable)
   */
  recordEvent(event: TUsageEvent, metadata: object = {}) {
    // TODO
    return;
  }

}
