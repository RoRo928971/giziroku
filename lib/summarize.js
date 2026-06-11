/**
 * AIによる議事録の自動要約・整形
 *
 * 会議のメモ書きや文字起こしを受け取り、Claude を使って
 * 構造化された議事録（基本情報・議題・決定事項・ToDo など）に整形します。
 *
 * 必要な環境変数: ANTHROPIC_API_KEY
 */
const Anthropic = require("@anthropic-ai/sdk");

// フォームのデータ構造に対応した出力スキーマ（Structured Outputs）
const MINUTES_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "会議名。メモから推測できなければ空文字。" },
    date: { type: "string", description: "会議日。YYYY-MM-DD 形式。不明なら空文字。" },
    startTime: { type: "string", description: "開始時刻 HH:MM。不明なら空文字。" },
    endTime: { type: "string", description: "終了時刻 HH:MM。不明なら空文字。" },
    location: { type: "string", description: "開催場所。不明なら空文字。" },
    author: { type: "string", description: "議事録作成者。不明なら空文字。" },
    attendees: { type: "string", description: "出席者。カンマ区切りの氏名。不明なら空文字。" },
    absentees: { type: "string", description: "欠席者。カンマ区切りの氏名。不明なら空文字。" },
    agendas: {
      type: "array",
      description: "議題ごとの要点。議論された各トピックを1項目にまとめる。",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", description: "議題のタイトル（簡潔に）" },
          body: { type: "string", description: "議論の要点を簡潔にまとめた本文" },
        },
        required: ["topic", "body"],
        additionalProperties: false,
      },
    },
    decisions: {
      type: "string",
      description: "決定事項。1行につき1項目の箇条書き（改行区切り）。なければ空文字。",
    },
    actions: {
      type: "array",
      description: "アクションアイテム（ToDo）。担当者・期限が読み取れる場合は埋める。",
      items: {
        type: "object",
        properties: {
          task: { type: "string", description: "やるべきこと" },
          owner: { type: "string", description: "担当者。不明なら空文字。" },
          due: { type: "string", description: "期限。不明なら空文字。" },
        },
        required: ["task", "owner", "due"],
        additionalProperties: false,
      },
    },
    nextMeeting: { type: "string", description: "次回会議の予定。なければ空文字。" },
    notes: { type: "string", description: "その他の補足・備考。なければ空文字。" },
  },
  required: [
    "title",
    "date",
    "startTime",
    "endTime",
    "location",
    "author",
    "attendees",
    "absentees",
    "agendas",
    "decisions",
    "actions",
    "nextMeeting",
    "notes",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `あなたは社内会議の議事録作成を支援するアシスタントです。
ユーザーから渡される会議のメモ書き・走り書き・文字起こしを読み取り、
整理された正式な議事録の構成要素に変換してください。

ルール:
- 入力内容に忠実に。書かれていない事実を創作しないこと。情報がない項目は空文字または空配列にする。
- 議題(agendas)は、話し合われたトピックごとに分け、要点を簡潔な日本語でまとめる。冗長な口語は除き、敬体（です・ます）で整える。
- 決定事項(decisions)は「〜することに決定」「〜で合意」のように、確定した事項のみを1行1項目で抽出する。
- アクションアイテム(actions)は「誰が・何を・いつまでに」を意識して抽出する。担当者や期限が明示されていない場合はその欄を空文字にする。
- 日付・時刻は可能な範囲で正規化する（date は YYYY-MM-DD、時刻は HH:MM）。
- 出力は必ず指定されたスキーマに従う。`;

/**
 * 会議メモを整形済み議事録データに変換する。
 * @param {string} rawText ユーザーが入力した会議メモ／文字起こし
 * @param {object} [context] 既存のフォーム内容（日付など補助情報）
 * @returns {Promise<object>} MINUTES_SCHEMA に従ったオブジェクト
 */
async function summarizeMinutes(rawText, context = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error(
      "ANTHROPIC_API_KEY が設定されていません。サーバーの環境変数に API キーを設定してください。"
    );
    err.code = "NO_API_KEY";
    throw err;
  }

  const client = new Anthropic();

  const contextHint =
    context && (context.title || context.date)
      ? `\n\n参考情報（フォームに既に入力済み。矛盾しなければ活用してよい）:\n${JSON.stringify(
          context
        )}`
      : "";

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: MINUTES_SCHEMA,
      },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `以下の会議メモを議事録に整形してください。${contextHint}\n\n=== 会議メモ ===\n${rawText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("AIからの応答を取得できませんでした。");
  }
  return JSON.parse(textBlock.text);
}

module.exports = { summarizeMinutes };
