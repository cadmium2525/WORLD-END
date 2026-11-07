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
  | { k: 'boss'; x: number; y: number };

export interface Level {
  stage: number;
  world: number; // 1..10
  w: number;
  h: number;
  tiles: Uint8Array;
  ents: EntSpec[];
  startX: number; // タイル
  startY: number; // タイル（足元の床の1つ上の行）
  boss: boolean;
}
