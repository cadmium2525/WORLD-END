// 進行ルール（セーブ地点・ノーセーブ区間）。クライアントと Worker で共通。
//
//   1〜79面        1面ごとにオートセーブ
//   80〜100面      ノーセーブ区間（100面は中ボス。撃破しても世界は終わらず101面へ）
//   101〜120面 / 121〜140面 / 141〜160面 / 161〜180面 / 181〜200面
//                  各20面のノーセーブ区間。区間の最初の面に到達した時点でセーブ
//   200面          真の最終ボス。サーバーが承認した最初の1人で世界が終わる

/** 最終面（この面のクリアだけが世界を終わらせる） */
export const FINAL_STAGE = 200;
/** 最初のノーセーブ区間の開始面 */
export const NOSAVE_START = 80;
/** 100面（ボス面だが、クリア後は101面へ進む） */
export const MID_BOSS_STAGE = 100;

/** ノーセーブ区間の開始面（サーバーのセッションはこの単位） */
export const SEGMENT_STARTS: readonly number[] = [80, 101, 121, 141, 161, 181];

/** セーブ地点の一覧（1〜80 の各面と、各区間の開始面） */
export const CHECKPOINTS: readonly number[] = [
  ...Array.from({ length: NOSAVE_START }, (_, i) => i + 1),
  ...SEGMENT_STARTS.slice(1),
];

export function isValidStage(stage: number): boolean {
  return Number.isInteger(stage) && stage >= 1 && stage <= FINAL_STAGE;
}

/** ノーセーブ区間に属する面か（80〜200） */
export function isNoSave(stage: number): boolean {
  return stage >= NOSAVE_START && stage <= FINAL_STAGE;
}

/** セーブ地点か（その面に到達した時点でセーブされる） */
export function isCheckpoint(stage: number): boolean {
  return Number.isInteger(stage) && (stage >= 1 && stage <= NOSAVE_START ? true : SEGMENT_STARTS.includes(stage));
}

/** 区間の番号（80〜100 → 0、101〜120 → 1 … 181〜200 → 5）。セーブ面（1〜79）は -1 */
export function segmentIndex(stage: number): number {
  if (!isNoSave(stage)) return -1;
  if (stage <= MID_BOSS_STAGE) return 0;
  return Math.floor((stage - MID_BOSS_STAGE - 1) / 20) + 1;
}

/** 区間の最初の面。死亡・やり直し・再読込でここへ戻る（1〜79面はその面自身） */
export function segmentStart(stage: number): number {
  const i = segmentIndex(stage);
  return i < 0 ? stage : SEGMENT_STARTS[i];
}

/** 区間の最後の面（1〜79面はその面自身） */
export function segmentEnd(stage: number): number {
  const i = segmentIndex(stage);
  if (i < 0) return stage;
  return i + 1 < SEGMENT_STARTS.length ? SEGMENT_STARTS[i + 1] - 1 : FINAL_STAGE;
}

/** 区間の面数（80〜100 は 21、以降は 20。1〜79面は 1） */
export function segmentLength(stage: number): number {
  return segmentEnd(stage) - segmentStart(stage) + 1;
}

/** 区間内で何面目か（1始まり） */
export function segmentPos(stage: number): number {
  return stage - segmentStart(stage) + 1;
}

/** 区間の開始にサーバー発行のチケットが必要か（101面以降の区間） */
export function needsTicket(segStart: number): boolean {
  return segStart > MID_BOSS_STAGE;
}

/** 任意の面番号を「そこから再開できるセーブ地点」に丸める（範囲外は 1〜181 に収める） */
export function toCheckpoint(stage: number): number {
  if (!Number.isFinite(stage)) return 1;
  const s = Math.max(1, Math.min(FINAL_STAGE, Math.floor(stage)));
  return segmentStart(s);
}
