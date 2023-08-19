# About

This is a small nodejs based cmdline application for batching the creation of many Superfluid Vesting Schedules from a (Gnosis) Safe into one transaction.  
Example transaction creating 200 vesting schedules: https://goerli.etherscan.io/tx/0x7abe16abb948137a7f2ede0e75694121dff77feca9a87b76118efef7b52277b3  
Note that the gas used here was slightly above 8M. That should give you a good idea for what batch size fits into a tx based on the block gas limit of the chain.

The application was tested with nodejs v18.  
Do `yarn install` in order to get dependencies installed.

Vesting schedules are loaded from a csv file. The file name must be provided as argument.  
The env arguments `RPC` (url), `SAFE` (address) and `PRIVKEY` (private key of one of the Safe signers) must be set.

Example invocation:
```
RPC=https://rpc.ankr.com/eth_goerli SAFE=0x18A6dBAA09317C352CAd15F03A13F1f38862d124 PRIVKEY=fd63bf5836257048dbdc0d28566cfbb7276c847225b3c16ffe9d04d88009e800 node batch-vesting.js batch.csv
```

This will batch the invocations to the VestingScheduler contract with [Multicall3](https://github.com/mds1/multicall) and propose it as Safe transaction.  
At the end of the scripts output you get an URL of the Safe App where to sign and execute the transaction.

In order to find out what `batch.csv` should contain, you can do:
```
node create-csv.js batch.csv 10
```
This will create a file `batch.csv` with 10 vesting schedules, using random receivers.  
In order to override the defaults for the other columns, you can set env vars. See the source for more details.  
If you want to execute such a test batch on another chain than goerli, you need to override the token address (you can find SuperToken addresses [here](https://console.superfluid.finance/matic/supertokens)).

Note that Safe transactions created this way may show a warning "Unexpected delegate call" in the Safe UI. That's because for batching with Multicall to work, the Safe must be instructed to do a delegatecall to the Multicall contract. Otherwise the msg.sender of the individual calls to the Vesting Scheduler would be the Multicall contract, not the Safe contract, and it would fail.