const Web3 = require('web3');
const Web3Adapter = require('@safe-global/safe-web3-lib').default;
const Safe = require('@safe-global/safe-core-sdk').default;
const SafeServiceClient = require('@safe-global/safe-service-client').default;
const VestingSchedulerAbi = require("./abis/VestingSchedulerAbi");
const Multicall3Abi = require("./abis/Multicall3Abi"); // tx batching
const sfMeta = require("@superfluid-finance/metadata");
const fs = require('fs');
const Papa = require('papaparse'); // CSV parser

if (process.argv.length < 3) {
    throw new Error("Usage: node batch-vesting.js <csv-file>");
}
const csvFileName = process.argv[2];

const rpcUrl = process.env.RPC;
if (rpcUrl === undefined) {
    throw new Error("RPC env var not set");
}

const safeAddr = process.env.SAFE;
if (safeAddr === undefined) {
    throw new Error("SAFE env var not set");
}

const privateKey = process.env.PRIVKEY;
if (privateKey === undefined) {
    throw new Error("PRIVKEY env var not set");
}

async function main() {
    const provider = new Web3.providers.HttpProvider(rpcUrl)
    const web3 = new Web3(provider)

    const chainId = await web3.eth.getChainId();
    const network = sfMeta.getNetworkByChainId(chainId);
    if (network === undefined) {
        throw new Error(`network with chainId ${chainId} not supported by Superfluid (or metadata package outdated)`);
    }
    console.log(`connected to ${network.name} with chainId ${network.chainId}`);

    if (network.contractsV1.vestingScheduler === undefined) {
        throw new Error(`no VestingScheduler available for network ${network.name} (or metadata package outdated)`);
    }

    // Add the private key to the web3 instance
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account); //TODO: check if this is needed
    web3.eth.defaultAccount = account.address;
    console.log(`account is ${account.address}`);
    const signerAddr = account.address;

    const vestingSchedules = getVestingSchedulesFromFile(web3, csvFileName);
    console.log(`nr of vesting schedules: ${vestingSchedules.length}`);

    if (vestingSchedules.length === 0) {
        throw new Error("nothing to be done");
    }

    const ethAdapterOwner1 = new Web3Adapter({
        web3,
        signerAddress: signerAddr
      });
      
      const vestingSchedulerAddr = network.contractsV1.vestingScheduler;//0xF9240F930d847F70ad900aBEE8949F25649Bf24a
      
      const vestingScheduler = new web3.eth.Contract(VestingSchedulerAbi, vestingSchedulerAddr);
      
      // see https://www.multicall3.com/deployments
      const multicall3Addr = process.env.MULTICALL3_ADDRESS || "0xcA11bde05977b3631167028862bE2a173976CA11";
      const multicall3 = new web3.eth.Contract(Multicall3Abi, multicall3Addr);
      
      const txData = getBatchedTxData(multicall3, vestingScheduler, vestingSchedules);

    const safeSdk = await Safe.create({ ethAdapter: ethAdapterOwner1, safeAddress: safeAddr });
    const safeService = new SafeServiceClient({
        txServiceUrl: getSafeTxServiceUrl(await network.chainId),
        ethAdapter: ethAdapterOwner1
    });

    // if leaving the default nonce, the nonce of a queued transaction would be reused
    // set SAFE_REPLACE_LAST_TX if that's what you want
    const nextNonce = await safeService.getNextNonce(safeAddr);
    const safeTransactionData = {
        to: multicall3Addr,
        value: 0,
        data: txData,
        operation: 1, // delegatecall
        nonce: process.env.SAFE_REPLACE_LAST_TX ? nextNonce-1 : nextNonce
    };
    const safeTransaction = await safeSdk.createTransaction({ safeTransactionData });
    console.log("tx:", safeTransaction);

    const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
    console.log("safeTxHash:", safeTxHash);
    const signature = await safeSdk.signTransactionHash(safeTxHash);
    console.log("signature:", signature);

    const transactionConfig = {
        safeAddress: safeAddr,
        safeTxHash,
        safeTransactionData: safeTransaction.data,
        senderAddress: signerAddr,
        senderSignature: signature.data,
        origin: "batch-vesting" // application name
    };

    const pendingTxsBefore = await safeService.getPendingTransactions(safeAddr);

    // according to the docs this should return the tx hash, but always returns undefined although succeeding
    const ret = await safeService.proposeTransaction(transactionConfig);
    console.log("returned:", ret);

    const pendingTxsAfter = await safeService.getPendingTransactions(safeAddr);
    console.log(`pending txs before ${pendingTxsBefore.count}, after ${pendingTxsAfter.count}`);

    // workaround for verifying that the proposal was added
    if (!pendingTxsAfter.count > pendingTxsBefore.count) {
        throw new Error("Safe pending transactions count didn't increase, propose may have failed!");
    }

    console.log(`Transaction was prosed and should soon become available in the Safe App for further signatures and execution:`);
    console.log(`https://app.safe.global/transactions/queue?safe=${getSafeChainPrefix(network.chainId)}:${safeAddr}`);
}

// returns the Safe Tx Service URL or throws if none available
// source: https://github.com/safe-global/safe-docs/blob/main/safe-core-api/available-services.md
// TODO: check if this in provided in a Safe lib
function getSafeTxServiceUrl(chainId) {
    const safeChainNames = {
        // mainnets
        1: "mainnet",
        10: "optimism",
        56: "bsc",
        100: "gnosis-chain",
        137: "polygon",
        8453: "base",
        42161: "arbitrum",
        43114: "avalanche",
        // testnets
        5: "goerli",
        84531: "base-testnet"
    };
    if (safeChainNames[chainId] === undefined) {
        throw new Error(`no Safe tx service url known for chainId ${chainId}`);
    }
    return `https://safe-transaction-${safeChainNames[chainId]}.safe.global`;
}

// determined by switching networks in the Safe App.
// TODO: check if this in provided in a Safe lib
function getSafeChainPrefix(chainId) {
    const safeChainPrefixes = {
        // mainnets
        1: "eth",
        10: "oeth",
        56: "bnb",
        100: "gno",
        137: "matic",
        8453: "base",
        42161: "arb1",
        43114: "avax",
        // testnets
        5: "gor",
        84531: "base-gor"
    };
    if (safeChainPrefixes[chainId] === undefined) {
        throw new Error(`no Safe tx prefix known for chainId ${chainId}`);
    }
    return safeChainPrefixes[chainId];
}

// returns [{receiver, flowRate, startTs, cliffTs, cliffAmount, endTs}, ...]
// TODO: more thorough validation of input data
function getVestingSchedulesFromFile(web3, fileName) {
    const csvFile = fs.readFileSync(fileName, 'utf8');

    const vestingSchedules = [];
    Papa.parse(csvFile, {
        header: true,
        dynamicTyping: true,
        complete: function(results) {
            results.data.forEach(row => {
                if (row.token === null) {
                    console.log("ignoring empty row");
                    return;
                }
                if (!web3.utils.isAddress(row.token)) {
                    throw new Error("invalid token: " + row.token);
                }
                if (!web3.utils.isAddress(row.receiver)) {
                    throw new Error("invalid receiver: " + row.receiver);
                }
                if (isNaN(row.flowRate)) {
                    throw new Error("invalid flowRate: " + row.flowRate);
                }
                if (isNaN(row.startTs)) {
                    throw new Error("invalid startTs: " + row.startTs);
                }
                if (isNaN(row.cliffTs)) {
                    throw new Error("invalid cliffTs: " + row.cliffTs + " (set to 0 if not used)");
                }
                if (isNaN(row.cliffAmount)) {
                    throw new Error("invalid cliffAmount: " + row.cliffAmount + " (set to 0 if not used)");
                }
                if (isNaN(row.endTs)) {
                    throw new Error("invalid endTs: " + row.endTs);
                }
                if (!row.endTs > row.startTs) {
                    throw new Error("endTs must be after startTs");
                }

                vestingSchedules.push({
                    token: row.token,
                    receiver: row.receiver,
                    flowRate: row.flowRate,
                    startTs: row.startTs,
                    cliffTs: row.cliffTs,
                    cliffAmount: row.cliffAmount,
                    endTs: row.endTs
                });
                //console.log("parsed " + JSON.stringify(vestingSchedules[vestingSchedules.length-1]));
            });
        }
    });
    return vestingSchedules;
}

function getBatchedTxData(multicall3, vestingScheduler, vestingSchedulesChunk) {
    const mc3Calls = [];
    vestingSchedulesChunk.forEach(vs => {
        console.log(`adding schedule ${JSON.stringify(vs)}`);
        mc3Calls.push({
            target: vestingScheduler.options.address,
            allowFailure: false,
            callData: vestingScheduler.methods.createVestingSchedule(
                vs.token,// superToken
                vs.receiver, //receiver,
                vs.startTs, //startDate,
                vs.cliffTs, //cliffDate,
                vs.flowRate, // flowRate,
                vs.cliffAmount, // cliffAmount,
                vs.endTs, // endDate,
                '0x'// ctx
            ).encodeABI()
        });
    });
  
    //console.log("multicalls: " + JSON.stringify(mc3Calls, null, 2));
    return multicall3.methods.aggregate3(mc3Calls).encodeABI();
}

main().catch((error) => {
    console.error("Error:", error);
});