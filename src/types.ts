export type LimitConfig = Map<string, number>;

export type SendConfig = {
  dest: string;
  token: string;
  balance: string;
};

export type MessageHandler = (channelInfo: Record<string, string>, amount: string, token: string, address: string) => void;