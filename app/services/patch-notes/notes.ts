import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '1.0.20181010-1d',
  title: '1.0.20181010-1d',
  notes: [
    '追加: 配信設定に警告を表示しつつ、ログイン中も編集無効で表示 (#114) by koizuka',
    '修正: 設定のキャッシュクリア・表示ボタンの位置を修正 (#101) by Makoto-Sasahara',
    '修正：録画側のffmpegに渡す引数としてrtmpプロトコルのURIが使えるように修正  (#117) by takayamaki',
    '',
    'Direct Commits:',
    '社内向けリリース用にs3バケット名を読む環境変数を変更 (cc1ccb70)',
    'S3のアップロード先パスが誤っていた点を修正 (4deb3d81)',
    'インストーラのダウンロード元を自前のs3に変更 (f87d2f2d)',
    'releaseスクリプト: 正式版になったので prereleaseフラグを落とす (28167219)',
    'v1.0.20181001-2 (8906ad4e)',
    'v1.0.20181001-1 (daad9034)',
    'v0.1.20181001-1 (1c9e3f50)'
  ]
};
