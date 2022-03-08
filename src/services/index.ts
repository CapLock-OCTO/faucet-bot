import { template } from "lodash";

import { Config } from "../util/config";
import { Storage } from "../util/storage";
import { SendConfig, MessageHandler } from "../types";
import { TaskQueue, TaskData } from "./task-queue";
import logger from "../util/logger";
import { ethers } from "ethers";
import { SQToken, SQToken__factory } from '@subql/contract-sdk';
import { NonceManager } from "@ethersproject/experimental";

interface FaucetServiceConfig {
  nonceManager: NonceManager; 
  wallet: ethers.Wallet;
  template: Config["template"];
  config: Config["faucet"];
  storage: Storage;
  task: TaskQueue;
}

interface RequestFaucetParams {
  address: string;
  strategy: string;
  channel: {
    name: string;
    account: string;
  } & Record<string, string>;
}

export class Service {
  private nonceManager: NonceManager; 
  private wallet!: ethers.Wallet; 
  private token: SQToken | undefined;
  private template: Config["template"];
  private config: Config["faucet"];
  private storage: Storage;
  private task: TaskQueue;
  private sendMessageHandler!: Record<string, MessageHandler>;
  private killCountdown: number = 1000 * 60;
  private killTimer!: NodeJS.Timeout | null;

  constructor({
    nonceManager,
    wallet,
    config,
    template,
    storage,
    task,
  }: FaucetServiceConfig) {
    this.nonceManager = nonceManager;
    this.wallet = wallet;
    this.config = config;
    this.template = template;
    this.storage = storage;
    this.task = task;
    this.sendMessageHandler = {};

    this.onConnected = this.onConnected.bind(this);
    this.onDisconnected = this.onDisconnected.bind(this);
  }

  private onConnected() {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
  }

  private onDisconnected() {
    this.killTimer = setTimeout(() => {
      process.exit(1);
    }, this.killCountdown);
  }

  public async connect(config: Config) {
    this.token = SQToken__factory.connect(config.faucet.contractAddress, this.wallet);

    this.task.process(async (task: TaskData): Promise<void> => {
      const { address, channel, strategy, params } = task;
      const account = channel.account;
      const channelName = channel.name;
      const sendMessage = this.getMessageHandler(channelName);

      return this.sendTokens(params, task.strategy)
        .then((tx: any) => {

          logger.info(
            `send success, required from ${channelName}/${account} channel with address:${address} ${JSON.stringify(task.params)}`
          );

          if (!sendMessage) return;

          sendMessage(
            channel,
            params.token,
            tx
          );
        })
        .catch(async (e) => {
          logger.error(e);

          await this.storage.decrKeyCount(`service_${strategy}_${address}`);

          if (account) {
            await this.storage.decrKeyCount(`service_${strategy}_${channelName}_${account}`);
          }
        });
    });
  }

  public registerMessageHandler(channel: string, handler: MessageHandler) {
    this.sendMessageHandler[channel] = handler;
  }

  private getMessageHandler (channel: string) {
    return this.sendMessageHandler[channel];
  }
  
  public async sendTokens(config: SendConfig, strategy: string) { 
    if (strategy === 'sqt'){ 
      if(this.token){
        const tx = await this.token.transfer('0xB55924636Df4a8dE7f8F3D7858Ff306712109d19', ethers.utils.parseEther(config.balance));
        const res = await tx.wait();
        console.log(res.status);

        // if (res.status === 200) {
          //TODO: handle this
        // }
      } else {
        throw new Error("unable to transfer SQT tokens")
      }
      return
    } 
    
    if (strategy === 'fees'){
      await this.wallet.sendTransaction({
        to: config.dest,
        value: ethers.utils.parseEther(config.balance),
      })
      return
    }
  }

  public usage() {
    return this.template.usage;
  }

  async faucet({ strategy, address, channel }: RequestFaucetParams): Promise<any> {
    logger.info(
      `request faucet, ${JSON.stringify(
        strategy
      )}, ${address}, ${JSON.stringify(channel)}`
    );

    const strategyDetail = this.config.strategy[strategy];

    const account = channel?.account;
    const channelName = channel.name;

    try {
      await this.task.checkPendingTask();
    } catch (e) {
      throw new Error(this.getErrorMessage("PADDING_TASK_MAX"));
    }

    if (!strategyDetail) {
      throw new Error(this.getErrorMessage("NO_STRATEGY"));
    }

    //TODO: use nonce manager to prevent multiple drips to one address 
    const nonce = await this.nonceManager.getTransactionCount();
    console.log('nonce: ' + nonce);

    // check account limit
    let accountCount = 0;
    if (account && strategyDetail.checkAccount) {
      accountCount = await this.storage.getKeyCount(`service_${strategy}_${channelName}_${account}`);
    }

    if (strategyDetail.limit && accountCount >= strategyDetail.limit) {
      throw new Error(this.getErrorMessage("LIMIT", { account: channel.account || address }));
    }

    // check address limit
    let addressCount = 0;
    try {
      addressCount = await this.storage.getKeyCount(`service_${strategy}_${address}`);
    } catch (e) {
      throw new Error(this.getErrorMessage("CHECK_LIMIT_FAILED"));
    }

    if (strategyDetail.limit && addressCount >= strategyDetail.limit) {
      throw new Error(
        this.getErrorMessage("LIMIT", { account: channel.account || address })
      );
    }

    const params = {
      token: strategyDetail.amounts.asset,
      balance: strategyDetail.amounts.amount,
      dest: address,
    };

    // increase account & address limit count
    try {
      if (account && strategyDetail.checkAccount) {
        await this.storage.incrKeyCount(`service_${strategy}_${channelName}_${account}`, strategyDetail.frequency);
      }

      await this.storage.incrKeyCount(`service_${strategy}_${address}`, strategyDetail.frequency);
    } catch (e) {
      throw new Error(this.getErrorMessage("UPDATE_LIMIT_FAILED"));
    }

    try {
      const result = await this.task.insert({
        address,
        strategy,
        channel,
        params
      });

      return result;
    } catch (e) {
      logger.error(e);

      await this.storage.decrKeyCount(`service_${strategy}_${address}`);

      if (account) {
        await this.storage.decrKeyCount(`service_${strategy}_${channelName}_${account}`);
      }

      throw new Error(this.getErrorMessage("INSERT_TASK_FAILED"));
    }
  }

  getErrorMessage(code: string, params?: any) {
    return template(this.template.error[code] || "Faucet error.")(params);
  }

  getMessage(name: string, params?: any) {
    return template(this.template[name] || "Empty")(params);
  }
}
