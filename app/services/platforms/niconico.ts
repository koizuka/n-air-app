import { StatefulService, mutation } from './../stateful-service';
import { IPlatformService, IStreamingSetting } from '.';
import { HostsService } from '../hosts';
import { SettingsService } from '../settings';
import { Inject } from '../../util/injector';
import { handleErrors, requiresToken, authorizedHeaders } from '../../util/requests';
import { UserService } from '../user';
import { Builder, parseString } from 'xml2js';
import { StreamingService, EStreamingState } from '../streaming';
import { WindowsService } from 'services/windows';

interface INiconicoServiceState {
}
export type INiconicoProgramSelection = {
  info: LiveProgramInfo
  selectedId: string
}

function parseXml(xml: String): Promise<object> {
  return new Promise((resolve, reject) => {
    parseString(xml, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

type StreamInfo = {
  id?: string[];
  exclude?: string[];
  title?: string[];
  description?: string[];
};
type RtmpInfo = {
  url?: string[];
  stream?: string[];
  ticket?: string[];
  bitrate?: string[];
};
type ProgramInfo = {
  stream: StreamInfo[];
  rtmp: RtmpInfo[];
};
class UserInfo {
  nickname: string | undefined;
  isPremium: number;
  userId: string | undefined;
  NLE: number;

  constructor(obj: object) {
    this.nickname = obj['nickname'][0];
    this.isPremium = parseInt(obj['is_premium'][0], 10);
    this.userId = obj['user_id'][0];
    this.NLE = parseInt(obj['NLE'][0], 10);
  }
}

export type LiveProgramInfo = Dictionary<{
  title: string,
  description: string,
  bitrate: number | undefined,
  url: string,
  key: string
}>

class GetPublishStatusResult {
  attrib: object;
  items?: ProgramInfo[];
  user?: UserInfo;

  get status(): string {
    return this.attrib['status'];
  }
  get ok(): boolean {
    return this.status === 'ok';
  }
  get multi(): boolean {
    return this.attrib['multi'] === 'true';
  }

  constructor(obj: object) {
    console.log('getpublishstatus => ', JSON.stringify(obj)); // DEBUG
    console.log('getpublishstatus => ', obj); // DEBUG

    if (!('getpublishstatus' in obj)) {
      throw 'invalid response from getpublishstatus';
    }
    const getpublishstatus = obj['getpublishstatus'];
    this.attrib = getpublishstatus['$'];
    if (this.ok) {
      if (this.multi) {
        this.items = getpublishstatus['list'][0]['item'] as ProgramInfo[];
      } else {
        this.items = [getpublishstatus as ProgramInfo];
      }
      this.user = new UserInfo(getpublishstatus['user'][0]);

      // convert items[].stream[].description to XML string
      const xml = new Builder({rootName: 'root', headless: true});
      const removeRoot = (s: string): string => s.replace(/^<root>([\s\S]*)<\/root>$/, '$1');
      for (const p of this.items) {
        for (const s of p.stream) {
          if ('description' in s) {
            s.description = s.description.map(d => removeRoot(xml.buildObject(d)));
          }
        }
      }
    }
    console.log(this);
  }

  static fromXml(xmlString: string): Promise<GetPublishStatusResult> {
    return parseXml(xmlString).then(obj => new GetPublishStatusResult(obj));
  }
}

export class NiconicoService extends StatefulService<INiconicoServiceState> implements IPlatformService {

  @Inject() hostsService: HostsService;
  @Inject() settingsService: SettingsService;
  @Inject() userService: UserService;
  @Inject() streamingService: StreamingService;
  @Inject() windowsService: WindowsService;

  authWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 800,
  };

  static initialState: INiconicoServiceState = {
  };

  getUserKey(): Promise<string> {
    const url = `${this.hostsService.niconicoFlapi}/getuserkey`;
    const request = new Request(url, { credentials: 'same-origin' });

    return fetch(request)
      .then(handleErrors)
      .then(response => response.text())
      .then(text => {
        if (text.startsWith('userkey=')) {
          return text.substr('userkey='.length);
        }
        return '';
      });
  }
  isLoggedIn(): Promise<boolean> {
    return this.getUserKey().then(userkey => userkey !== '');
  }

  logout(): Promise<void> {
    const url = `${this.hostsService.niconicoAccount}/logout`;
    const request = new Request(url, { credentials: 'same-origin' });
    return fetch(request)
      .then(handleErrors)
      .then(() => { });
  }

  get authUrl() {
    const host = this.hostsService.nAirLogin;
    return host;
  }

  get userSession() {
    return this.userService.apiToken;
  }

  get oauthToken() {
    return this.userService.platform.token;
  }

  get niconicoUserId() {
    return this.userService.platform.id;
  }

  /** 配信中番組ID
   */
  get channelId() {
    return this.userService.channelId;
  }
  getUserPageURL(): string {
    return `http://www.nicovideo.jp/user/${this.niconicoUserId}`;
  }

  getHeaders(authorized = false): Headers {
    const headers = new Headers();
    return headers;
  }

  get streamingStatus() {
    return this.streamingService.state.streamingStatus;
  }

  init() {
    console.log('niconico.init');
    this.streamingService.streamingStatusChange.subscribe(() => {
      console.log('streamingService.streamingStatusChange! ', this.streamingStatus);
      if (this.streamingStatus === EStreamingState.Reconnecting) {
        console.log('reconnecting - checking stream key');
        this.fetchLiveProgramInfo(this.channelId).then(info => {
          let key = '';
          if (this.channelId && this.channelId in info) {
            key = info[this.channelId].key;
          }
          if (key === '') {
            console.log('niconico programas has ended! stopping streaming.');
            this.streamingService.stopStreaming();
          }
        });
      }
    });
  }

  /**
   * 有効な番組が選択されていれば、stream URL/key を設定し、その値を返す。
   * そうでなければ、ダイアログを出して選択を促すか、配信していない旨返す。
   * @param programId ユーザーが選択した番組ID(省略は未選択)
   */
  setupStreamSettings(programId: string = ''): Promise<IStreamingSetting> {
    return this.fetchLiveProgramInfo(programId).then(info => {
      console.log('fetchLiveProgramInfo: ' + JSON.stringify(info));

      const num = Object.keys(info).length;
      if (num > 1) {
        // show dialog and select
        this.windowsService.showWindow({
          componentName: 'NicoliveProgramSelector',
          queryParams: info,
          size: {
            width: 700,
            height: 400
          }
        });
        return { asking: true, url: '', key: '' }; // ダイアログでたから無視してね
      }
      if (num < 1) {
        return { asking: false, url: '', key: '' }; // 番組がない
      }
      const id = Object.keys(info)[0];
      const selected = info[id];
      const url = selected.url;
      const key = selected.key;
      this.userService.updatePlatformChannelId(id);

      const settings = this.settingsService.getSettingsFormData('Stream');
      settings.forEach(subCategory => {
        if (subCategory.nameSubCategory !== 'Untitled') return;
        subCategory.parameters.forEach(parameter => {
          switch (parameter.name) {
            case 'service':
              parameter.value = 'niconico ニコニコ生放送';
              break;
            case 'server':
              parameter.value = url;
              break;
            case 'key':
              parameter.value = key;
              break;
          }
        });
      });
      this.settingsService.setSettings('Stream', settings);

      return { asking: false, url, key }; // 有効な番組が選択されているので stream keyを返す
    });
  }

  // TODO ニコニコOAuthのtoken更新に使う
  fetchNewToken(): Promise<void> {
    const url = `${this.hostsService.niconicoOAuth}/token`;
    const headers = authorizedHeaders(this.userService.apiToken);
    const request = new Request(url, { headers });

    return fetch(request)
      .then(handleErrors)
      .then(response => response.json())
      .then(response =>
        this.userService.updatePlatformToken(response.access_token)
      );
  }

  private fetchGetPublishStatus(): Promise<string> {
    const headers = this.getHeaders(true);
    const request = new Request(
      `${this.hostsService.niconicolive}/api/getpublishstatus?accept-multi=1`,
      { headers, credentials: 'include' }
    );

    return fetch(request)
      .then(handleErrors)
      .then(response => response.text());
  }
  private fetchGetPublishStatus2(): Promise<string> {
    return Promise.resolve(
      `<getpublishstatus status="ok" time="1532077326" multi="true">
<list>
<item>
<stream>
<id>lv314544536</id>
<token>ad646fc7334c61a3aa39ea9e637d69101c7ade7a</token>
<exclude>1</exclude>
<provider_type>channel</provider_type>
<base_time>1532074560</base_time>
<open_time>1532074560</open_time>
<start_time>1532074560</start_time>
<end_time>1532086200</end_time>
<allow_vote>1</allow_vote>
<disable_adaptive_bitrate>1</disable_adaptive_bitrate>
<is_reserved>1</is_reserved>
<is_chtest>0</is_chtest>
<for_mobile>1</for_mobile>
<editstream_language>1</editstream_language>
<test_extend_enabled>1</test_extend_enabled>
<category>踊ってみた</category>
<title>ああああ</title>
<description>ああああ</description>
</stream>
<rtmp is_fms="1">
<url>
rtmp://nlpoca306.live.nicovideo.jp/origin/rt2_nicolive
</url>
<stream>
omitted1
</stream>
<ticket/>
<bitrate>2000</bitrate>
</rtmp>
</item>
<item>
<stream>
<id>lv314545134</id>
<token>4cd6239f5eee0d9aaac354188f67e290a5c8246c</token>
<exclude>1</exclude>
<provider_type>community</provider_type>
<base_time>1532077306</base_time>
<open_time>1532077306</open_time>
<start_time>1532079106</start_time>
<end_time>1532080906</end_time>
<allow_vote>0</allow_vote>
<disable_adaptive_bitrate>1</disable_adaptive_bitrate>
<is_reserved>0</is_reserved>
<is_chtest>0</is_chtest>
<for_mobile>1</for_mobile>
<editstream_language>1</editstream_language>
<category>一般(その他)</category>
<title>テスト</title>
<description>ynが生放送を配信します。<br />コメント募集中です！</description>
</stream>
<rtmp is_fms="1">
<url>
rtmp://nlpoca309.live.nicovideo.jp/origin/rt2_nicolive
</url>
<stream>
omitted2
</stream>
<ticket/>
<bitrate>2000</bitrate>
</rtmp>
</item>
</list>
<user>
<nickname>yn</nickname>
<is_premium>1</is_premium>
<user_id>67045656</user_id>
<NLE>1</NLE>
</user>
</getpublishstatus>`);
  }

  @requiresToken()
  fetchRawChannelInfo(): Promise<GetPublishStatusResult> {
    return this.fetchGetPublishStatus2()
      .then(xml => GetPublishStatusResult.fromXml(xml));
  }

  /**
   * 配信可能番組情報を取得する。
   * @param programId 与えた場合、一致する番組があればその情報だけを返す。
   *   無い場合と与えない場合、配信可能な全番組を返す。
   */
  fetchLiveProgramInfo(programId: string = ''): Promise<LiveProgramInfo> {
    return this.fetchRawChannelInfo().then(result => {
      const status = result.status;
      console.log('getpublishstatus status=' + status);
      let r: LiveProgramInfo = {};
      if (status === 'ok') {
        for (const item of result.items) {
          const rtmp = item.rtmp[0];
          const stream = item.stream[0];
          const id = stream.id[0];
          r[id] = {
            title: stream.title[0],
            description: stream.description[0],
            bitrate: rtmp.bitrate.length > 0 ? parseInt(rtmp.bitrate[0], 10) : undefined,
            url: rtmp.url[0],
            key: rtmp.stream[0]
          };
        };
        if (programId && programId in r) {
          r = { [programId]: r[programId] };
        }
      }
      return r;
    });
  }

  fetchBitrate(): Promise<number | undefined> {
    return this.fetchLiveProgramInfo(this.channelId).then(result => {
      const status = result.status;
      console.log('getpublishstatus status=' + status);
      if (Object.keys(result).length === 1) {
        return result[Object.keys(result)[0]].bitrate;
      }
      return undefined;
    });
  }

  /**
   * getplayerstatusを叩く
   * 将来的にAPIはN Air向けのものに移行する予定で、暫定的な実装
   */
  @requiresToken()
  private fetchPlayerStatus() {
    const headers = this.getHeaders(true);
    const request = new Request(
      `${this.hostsService.niconicolive}/api/getplayerstatus?v=${this.channelId}`,
      { headers, credentials: 'include' }
    );

    return fetch(request)
      .then(handleErrors)
      .then(response => response.text())
      .then(xml => parseXml(xml))
      .then(json => {
        console.log('getplayerstatus => ', JSON.stringify(json)); // DEBUG
        if (!('getplayerstatus' in json)) {
          throw 'invalid response from getplayerstatus';
        }
        const getplayerstatus = json['getplayerstatus'];
        return getplayerstatus;
      });
  }

  @requiresToken()
  fetchViewerCount(): Promise<number> {
    return this.fetchPlayerStatus()
      .then(o => o['stream'][0]['watch_count'][0]);
  }

  @requiresToken()
  fetchCommentCount(): Promise<number> {
    return this.fetchPlayerStatus()
      .then(o => o['stream'][0]['comment_count'][0]);
  }

  getChatUrl(mode: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.fetchRawChannelInfo()
        .then(json => {
          reject('not yet supported for chat');
        });
    });
  }
}

