import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '1.0.20190621-1d',
  title: '1.0.20190621-1d',
  notes: [
    'インフラの構成変更に伴いインストーラなどのS3へのアップロードパスを変更 (#320) by takayamaki',
    'リリーススクリプトの依存更新: update @octokit/rest to 16.28.1 (#319) by koizuka',
    '収納ボタンの見た目を修正 (#318) by yusukess',
    '非ログイン状態のときにUserExtraContextが正しく取得出来ていなかった問題を修正 (#317) by takayamaki'
  ]
};
