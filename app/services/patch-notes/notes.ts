import { IPatchNotes } from '.';

export const notes: IPatchNotes = {
  version: '1.0.20181019-1d',
  title: '1.0.20181019-1d',
  notes: [
    '修正:最適化スキップ時にEncoderがQSVだとその設定が初期値に戻ってしまう (#162) by koizuka',
    '修正:最適化項目にビットレート制御(CBR)を追加 / 最適化ウィンドウの高さ自動計算 (#170) by koizuka',
    '修正:最適化項目にフレームレートの指定方法も追加 (#169) by koizuka'
  ]
};
