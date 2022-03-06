import { Storage } from "../util/storage";

export class ChannelBase {
    constructor(
        protected channelName: string,
        protected storage: Storage
    ) {}

    getCommand (msg: string) {
        return msg.trim().split(" ");
    }
}