const fs = require('fs');

if (process.argv.length < 4) {
    throw new Error("Usage: node create-csv.js <csv-file> <nr-items>");
}

const fname = process.argv[2];
const nrItems = process.argv[3];

const token = process.env.TOKEN || "0x8ae68021f6170e5a766be613cea0d75236ecca9a"; // fUSDCx
const flowRate = process.env.FLOWRATE || 3805175038; // 0.01 tokens per month
const startTs = process.env.STARTTS || Math.floor(Date.now() / 1000) + 86400; //default: in 1 day
const cliffTs = process.env.CLIFFTS || 0;
const cliffAmount = process.env.CLIFFAMOUNT || 0;
const endTs = process.env.ENDTS || startTs + 3600*24*365; // 1 year after start

fs.writeFileSync(fname, "token,receiver,flowRate,startTs,cliffTs,cliffAmount,endTs\n");

for (let i = 0; i < nrItems; i++) {
    const randomAddr = "0x" + new Array(40).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    fs.appendFileSync(fname, `${token},${randomAddr},${flowRate},${startTs},${cliffTs},${cliffAmount},${endTs}\n`);
}

