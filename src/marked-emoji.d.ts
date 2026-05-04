declare module "marked-emoji" {
  import type { MarkedExtension } from "marked";

  export interface EmojiToken<T = string> {
    type: "emoji";
    raw: string;
    name: string;
    emoji: T;
  }

  export type MarkedEmojiOptions<T = string> =
    | { emojis: Record<string, string> }
    | {
        emojis: Record<string, T>;
        renderer(token: EmojiToken<T>): string;
      };

  export function markedEmoji<T>(options: MarkedEmojiOptions<T>): MarkedExtension;
}
