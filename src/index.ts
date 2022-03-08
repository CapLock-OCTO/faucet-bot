
import { loadConfig } from "./util/config";
import logger from "./util/logger";
import { Storage } from "./util/storage";
import { TaskQueue } from "./services/task-queue";
import api from "./channel/api";
import { Service } from "./services";
import { DiscordChannel } from "./channel/discord";
import { ethers, utils, Wallet } from "ethers";
import { strict as assert } from 'assert';
import { NonceManager } from '@ethersproject/experimental';

function createWallet(provider: ethers.providers.Provider, SEED: string) {
  const hdNode = utils.HDNode.fromMnemonic(SEED).derivePath("m/44'/60'/0'/0/0");
  return new Wallet(hdNode, provider);
}

async function run() {
  const config = loadConfig();

  assert(config.faucet.account.mnemonic, "mnemonic need");
  assert(config.faucet.endpoint, "endpoint need");

  const storage = new Storage(config.storage);
  const task = new TaskQueue(config.task);

  const provider = new ethers.providers.JsonRpcProvider(config.faucet.endpoint);

  let wallet

  if (provider){
    wallet = createWallet(provider, config.faucet.account.mnemonic); 
  } else {
    throw new Error('unable to connect to provider')
  }

  const nonceManager = new NonceManager(wallet);
 
  const service = new Service({
    nonceManager,
    wallet,
    config: config.faucet,
    template: config.template,
    storage,
    task,
  });

  await service.connect(config);

  logger.info(`✊ faucet is ready.`);

  api({ config: config.channel.api, service, storage }).then(() => {
    logger.info(`🚀 faucet api launched at port:${config.channel.api.port}.`);
  });

  if (config.channel.discord.enable) {
    const discord = new DiscordChannel({
      config: config.channel.discord,
      storage,
      service,
    });

    await discord.start().then(() => {
      logger.info(`🚀 discord channel launched success`);
    });
  }
}

run();
