const fs = require("fs");
const sfMeta = require("@superfluid-finance/metadata");
const csvParser = require("./lib/csv-parser");
const Web3 = require("web3");
const VestingSchedulerAbi = require("./abis/VestingSchedulerAbi.json");
const createVestingScheduleAbi = VestingSchedulerAbi.filter(e => e.type === "function" && e.name === "createVestingSchedule")[0];

if (process.argv.length < 3) {
    throw new Error("Usage: node create-txbuilder-batch.js <chainId> <csv-file>");
}
const chainId = Number(process.argv[2]);
if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Not a valid chainId: ${process.argv[2]}`);
}
const network = sfMeta.getNetworkByChainId(chainId);
if (network === undefined) {
    throw new Error(`network with chainId ${chainId} not supported by Superfluid (or metadata package outdated)`);
}
console.log(`creating batch for network ${network.name} with chainId ${chainId}`);

if (network.contractsV1.vestingScheduler === undefined) {
    throw new Error(`no VestingScheduler available for network ${network.name} with chainId ${chainId} (or metadata package outdated)`);
}
const vestingSchedulerAddr = network.contractsV1.vestingScheduler;

const inFileName = process.argv[3];
const outFileName = inFileName.replace(/\.csv$/, ".json");
if (fs.existsSync(outFileName)) {
    throw new Error(`output file ${outFileName} already exists. Remove if you want to replace it.`);
}

// no connected rpc needed
const web3 = new Web3("");

function main() {
    console.log(`loading vesting schedules from ${inFileName}...}`);

    const vsListIn = csvParser.getVestingSchedulesFromCSV(web3, inFileName);
    if (vsListIn === undefined || vsListIn.length < 1) {
        throw new Error("no valid vesting schedules found in file");
    }
    console.log(`loaded ${vsListIn.length} vesting schedules`);

    const vsListOut = [];
    vsListIn.forEach(vs => {
        const vsObj = getTxObj(vs, vestingSchedulerAddr);
        vsListOut.push(vsObj);
        //console.log(`pushed ${JSON.stringify(vsObj)}`);
    });
    //console.log(`vsListOut: ${JSON.stringify(vsListOut, null, 2)}`);

    // construct the full object including metadata and the tx list
    const fullObj = {
        version: "1.0",
        chainId: chainId.toString(),
        createdAt: Date.now().toString(),
        meta: {
            name: "Superfluid VestingScheduler Transactions Batch",
            description: "",
            txBuilderVersion: "1.16.1", // version we created the example json with
            createdFromSafeAddress: "", // needed or can we omit this?
            createdFromOwnerAddress: "",  //needed or can we omit this?
        },
        transactions: vsListOut
    };

    // add the checksum
    const checksum = calculateChecksum(fullObj);
    //console.log(`checksum: ${checksum}`);
    fullObj.meta.checksum = checksum;

    fs.writeFileSync(outFileName, JSON.stringify(fullObj, null, 2));
    console.log(`wrote resulting json file for Safe transaction builder to ${outFileName}`);
}

// returns an object with the format expected by the Safe transaction builder,
// representing a vesting schedule creation tx to be batched
function getTxObj(vs, vsAddr) {
    const createVSObj = {
        to: vsAddr,
        value: "0",
        data: null,
        contractMethod: createVestingScheduleAbi,
        contractInputsValues: {
            superToken: vs.token,
            receiver: vs.receiver,
            startDate: vs.startTs.toString(),
            cliffDate: vs.cliffTs.toString(),
            flowRate: vs.flowRate.toString(),
            cliffAmount: vs.cliffAmount.toString(),
            endDate: vs.endTs.toString(),
            ctx: "0x"
        }
    };
    return createVSObj;
}

// Helpers for checksum calculation
// Source: https://github.com/safe-global/safe-react-apps/blob/main/apps/tx-builder/src/lib/checksum.ts

const stringifyReplacer = (_, value) => (value === undefined ? null : value)

const serializeJSONObject = (json) => {
    if (Array.isArray(json)) {
        return `[${json.map(el => serializeJSONObject(el)).join(',')}]`;
    }

    if (typeof json === 'object' && json !== null) {
        let acc = '';
        const keys = Object.keys(json).sort();
        acc += `{${JSON.stringify(keys, stringifyReplacer)}`;

        for (let i = 0; i < keys.length; i++) {
            acc += `${serializeJSONObject(json[keys[i]])},`;
        }

        return `${acc}}`;
    }

    return `${JSON.stringify(json, stringifyReplacer)}`;
};
  
const calculateChecksum = (batchFile => {
    const serialized = serializeJSONObject({
        ...batchFile,
        meta: { ...batchFile.meta, name: null },
    });
    const sha = web3.utils.sha3(serialized);

    return sha || undefined;
});

main();