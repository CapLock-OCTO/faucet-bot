import * as Discord from "discord.js";
import { Storage } from "../util/storage";
import { Service } from "../services";
import { Config } from "../util/config";
import { ChannelBase } from "./base";

interface DiscordChannelConfig {
  config: Config["channel"]["discord"];
  storage: Storage;
  service: Service;
}

export class DiscordChannel extends ChannelBase {
  private client: Discord.Client;
  private service: Service;
  private config: Config["channel"]["discord"];

  constructor(config: DiscordChannelConfig) {
    super("discord", config.storage);

    this.config = config.config;
    this.service = config.service;

    this.client = new Discord.Client();

    this.sendSuccessMessage = this.sendSuccessMessage.bind(this);
  }

  async start() {
    await this.client.login(this.config.token);

    this.service.registerMessageHandler(this.channelName, this.sendSuccessMessage);
    this.client.on("message", (msg) => {
      this.messageHandler(msg);
    });
  }

  sendSuccessMessage(
    channelInfo: Record<string, string>,
    amount: string,
    token: string,
    address: string,
  ) {
    const channel = (this.client.channels.cache.get(
      channelInfo.channelId
    ) as unknown) as Discord.TextChannel;

    channel.send(
      this.service.getMessage("success", {
        account: channelInfo.accountName,
        amount: amount,
        token: token,
        address: address
      })
    );
  }

  async messageHandler(msg: Discord.Message) {
    const channelName = (msg.channel as any).name;
    const account = msg.author.id;
    const name = msg.author.username;

    if (!msg.content) return;

    const [command, param1] = this.getCommand(msg.content);

    if (channelName === this.config.activeChannelName) {
      if (command === "!faucet") {
        msg.reply(this.service.usage());
      }

      if (command === "!balance") {
        msg.reply(await this.service.queryBalance());
      }

      if (command === "!drip") {
        const address = param1;
        try {
          await this.service.faucet({
            strategy: "normal",
            address: address,
            channel: {
              channelId: msg.channel.id,
              name: this.channelName,
              account: account,
              accountName: name,
            },
          });
        } catch (e: any) {
          msg.reply(
            e.message
              ? e.message
              : this.service.getErrorMessage("COMMON_ERROR", { account })
          );
        }
      }
    }
  }  
}
