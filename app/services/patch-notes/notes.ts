import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '1.0.20181104-1d',
  title: '1.0.20181104-1d',
  notes: [
    '変更: アップデートのダウンロード元を東京に変更し、ダウンロードの待ち時間を短縮 (#129) by takayamaki',
    '変更: 音声ミュート中であることが気づきやすいようにミュートボタンを強調する (#190) by yusukess',
    '修正: ストリームキーエラーのメッセージでニコニコログイン案内を追加する (#184) by koizuka',
    '修正: ニコニコ生放送最適化の設定書き込みを確実にするためにリトライする (#191) by koizuka',
    'SceneCollectionのmanifestファイル読み込み失敗を収集する (#189) by berlysia',
    'ログイン中に配信を開始して番組がないと返ってきたら1回だけリトライする (#115) by berlysia'
  ]
};
