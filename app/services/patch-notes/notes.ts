import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '0.1.20180928-1d',
  title: '0.1.20180928-1d',
  notes: [
    '修正: アップデータで「更新内容」ラベルが二つでていたのを修正(アップデート後に反映)',
    '修正: リリースアップロード失敗時に手でSentryにデバッグシンボル情報を送信するときのスクリプト bin/upload-to-sentry.sh で SENTRY_PROJECT指定が効いてなかったのを修正'
  ]
};
