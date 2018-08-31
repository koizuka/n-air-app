import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '0.1.20180901-1d',
  title: '0.1.20180901-1d',
  notes: [
    'release でelectron-updater用に blockmap 追加してみた',
    'upgrade raven-js (sentry.io) to latest(3.26.4) (#68) by koizuka',
    '修正: シーンエディタ上で右クリックしたときに対象が未選択だった場合、対象単体が選択されるように変更 (#64) by koizuka',
    '修正: 設定変更時に存在しないデバイスをソースから取り除く (#67) by pocketberserker',
    '追加: ディスプレイキャプチャを画面上でクロップする (#58) by berlysia',
    '修正: ソースアイテムを削除したらそのプロジェクターウィンドウも閉じる (#66) by koizuka'
  ]
};
