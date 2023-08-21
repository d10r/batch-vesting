const fs = require("fs");
const Papa = require('papaparse'); // CSV parser

// returns [{receiver, flowRate, startTs, cliffTs, cliffAmount, endTs}, ...]
// TODO: more thorough validation of input data
function getVestingSchedulesFromCSV(web3, fileName) {
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
                if (!(row.endTs > row.startTs)) {
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

module.exports = {
    getVestingSchedulesFromCSV
};
