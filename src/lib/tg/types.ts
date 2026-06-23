/**
 * Telegram Bot API 最小化 Update 类型
 *
 * 仅声明本项目消费的字段(图片消息 / 文本 / 内联回调),其余 Telegram 字段忽略。
 * TgButton 为本项目便捷形状({text,data}),发送时映射为 Telegram 的 {text,callback_data}。
 */

/** 一张图片的某个尺寸版本(Telegram 按尺寸升序返回数组,末尾最大)。 */
export interface TgPhotoSize {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

/** 会话(私聊/群组)。 */
export interface TgChat {
  id: number;
  type?: string;
}

/** 一条消息(可能携带图片数组与文字说明 caption,或纯文本 text)。 */
export interface TgMessage {
  message_id: number;
  chat: TgChat;
  caption?: string;
  photo?: TgPhotoSize[];
  text?: string;
}

/** 内联键盘按钮回调(用户点击内联按钮时产生)。 */
export interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: TgMessage;
  from?: { id: number };
}

/** 一次轮询/Webhook 推送的更新。 */
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** 本项目便捷按钮形状(发送时映射为 Telegram 的 {text, callback_data})。 */
export interface TgButton {
  text: string;
  data: string;
}
