export type LimitConfig = Map<string, number>;

export type SendConfig = { token: string; balance: string; dest: string; }[]

export type MessageHandler = (channelInfo: Record<string, string>, amount: string, token: string, address: string) => void;