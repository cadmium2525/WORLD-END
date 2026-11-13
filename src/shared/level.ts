// ステージデータの型定義
export type EntSpec =
  /** 歩く敵。x,y はタイル座標（y は立っている床の1つ上の行） */
  | { k: 'walker'; x: number; y: number; dir: -1 | 1 }
  /** 上下に往復する飛ぶ敵。y が最上段、range タイル分下まで動く */
  | { k: 'flyer'; x: number; y: number; range: number; speed: number; phase: number }
  /** 砲台。タイル (x,y) に置かれ、dir 方向へ弾を撃つ */
  | { k: 'turret'; x: number; y: number; dir: -1 | 1; period: number; phase: number; speed: number }
  /** 横移動床。x から右へ range タイル往復。y は床の上面の行 */
  | { k: 'platH'; x: number; y: number; w: number; range: number; speed: number; phase: number }
  /** 縦移動床。y（下端の位置）から上へ range タイル往復 */
  | { k: 'platV'; x: number; y: number; w: number; range: number; speed: number; phase: number }
  | { k: 'boss'; x: number; y: number }
  // ---- 101面以降 ----
  /** 圧殺ブロック。(x,y) が左上、幅 w タイル・高さ2タイル。真下に近づくと揺れてから落ち、ゆっくり戻る */
  | { k: 'crusher'; x: number; y: number; w: number }
  /**
   * レーザー。タイル (x,y) の発射口から (dx,dy) 方向へ len タイルの光線。
   * period フレーム周期で、最後の on フレームだけ光線が出る（その前の30フレームは予兆の点滅）
   */
  | { k: 'laser'; x: number; y: number; dx: -1 | 0 | 1; dy: -1 | 0 | 1; len: number; period: number; on: number; phase: number }
  /**
   * 回転ノコギリ。タイル (x,y) を左上の角とする 幅 tw × 高さ th タイルの長方形の軌道を回る。
   * tw か th が 0 なら直線を往復する
   */
  | { k: 'saw'; x: number; y: number; tw: number; th: number; speed: number; phase: number }
  /** 空中ジャンプ回復オーブ。空中で触れると、もう1回ジャンプできる（着地で消える） */
  | { k: 'orb'; x: number; y: number }
  /** 鍵。拾うと扉を1組開けられる */
  | { k: 'key'; x: number; y: number }
  /** 200面の真の最終ボス */
  | { k: 'fboss'; x: number; y: number };

/** 迫る壁・せり上がる溶岩（強制スクロール） */
export interface ChaseSpec {
  dir: 'right' | 'up';
  speed: number; // サブピクセル/フレーム
  delay: number; // 動き出すまでのフレーム数
}

export interface Level {
  stage: number;
  world: number; // 1..15
  w: number;
  h: number;
  tiles: Uint8Array;
  ents: EntSpec[];
  startX: number; // タイル
  startY: number; // タイル（足元の床の1つ上の行）
  boss: boolean;
  /** 暗闇（描画のみ。プレイヤーの周囲と光るものだけが見える） */
  dark?: boolean;
  /** 迫る壁・せり上がる溶岩 */
  chase?: ChaseSpec;
}
