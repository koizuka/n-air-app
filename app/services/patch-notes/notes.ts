import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '0.1.20180921-1d',
  title: '0.1.20180921-1d',
  notes: [
    'あと crop (画面キャプチャ範囲指定)修正の現状までを試しにマージ',
    '追加: NDIソースのプロパティに日本語訳を追加 (#93) by berlysia',
    '追加: アップデートが必須でない場合、スキップ可能にする (#69) by koizuka',
    '追加:blackmagicのソース選択にアイコンと文言を追加 (#83) by Makoto-Sasahara',
    '修正: NDIソースの説明文修正、及び既存ソース追加時の説明文修正 (#90) by yushinakatani',
    '修正: NDIソース追加時の説明文修正 (#89) by yushinakatani',
    '修正: i18nのfallbackが空文字列の場合を考慮 (#88) by berlysia',
    '修正: インターレース解除関連のstateが変化した際にエラーが発生する問題 (#79) by nullkal',
    '修正: キャッシュ消去時に削除対象から __installer.exe を除外する (#87) by koizuka',
    '修正: 出力/録画パスが短いとアプリが落ちる問題 (#72) by koizuka',
    '修正: 文言を「ディスプレイキャプチャ」から「画面キャプチャ」へ修正 (#81) by Makoto-Sasahara',
    '修正: 文言変更(標準→既定) (#91) by yushinakatani',
    '修正: 文言変更(標準→既定) その２ (#92) by yushinakatani',
    'i18nの文言が定義されていないときにログに出す (#97) by berlysia',
    'pre-commit hookでjsonファイルの構文と不整合チェック追加 (#95) by koizuka',
    'テストで使用する関数のタイムアウトを伸ばす (#96) by berlysia'
  ]
};
