import { Service } from 'services/core/service';
import electron from 'electron';
import { URL, URLSearchParams } from 'url';
import { Inject } from 'services/core/injector';
import { NavigationService } from 'services/navigation';
import { UserService } from './user';
import { SettingsService } from './settings';

function protocolHandler(base: string) {
  return (target: any, methodName: string, descriptor: PropertyDescriptor) => {
    target.handlers = target.handlers || {};
    target.handlers[base] = methodName;
    return descriptor;
  };
}

/**
 * Describes a protocol link that was clicked
 */
interface IProtocolLinkInfo {
  base: string;
  path: string;
  query: URLSearchParams;
}

export class ProtocolLinksService extends Service {
  @Inject() navigationService: NavigationService;
  @Inject() userService: UserService;
  @Inject() settingsService: SettingsService;

  // Maps base URL components to handler function names
  private handlers: Dictionary<string>;

  start(argv: string[]) {
    // Check if this instance was started with a protocol link
    argv.forEach(arg => {
      if (arg.match(/^n-air-app:\/\//)) this.handleLink(arg);
    });

    // Other instances started with a protocol link will receive this message
    electron.ipcRenderer.on('protocolLink', (event: Electron.Event, link: string) => {
      console.log('protocolLink (second instance): ', link); // DEBUG
      this.handleLink(link);
    },
    );
  }

  private handleLink(link: string) {
    const parsed = new URL(link);
    const info: IProtocolLinkInfo = {
      base: parsed.host,
      path: parsed.pathname,
      query: parsed.searchParams,
    };

    if (this.handlers[info.base]) {
      this[this.handlers[info.base]](info);
    }
  }

  @protocolHandler('login')
  private login(info: IProtocolLinkInfo) {
    this.userService.proceedLogin({
      service: info.query.get('service'),
      session: info.query.get('u'),
    });
  }

  @protocolHandler('settings')
  private openSettings(info: IProtocolLinkInfo) {
    const category = info.path.replace('/', '');

    this.settingsService.showSettings(category);
  }

}
