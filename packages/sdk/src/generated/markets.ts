/** GENERATED FILE - do not edit by hand.
 *  Produced by `pnpm calibrate` from real market tape.
 *  Generated: 2026-09-02T20:27:10.295Z
 *
 *  Distributions are MEASURED per round length, not assumed normal.
 */

export interface CalibratedRound {
  blocks: number;
  seconds: number;
  sigma1e4: bigint;
  minProb1e6: bigint;
  maxMultiplierBps: bigint;
  probTable: readonly bigint[];
}

export interface CalibratedMarket {
  key: string;
  label: string;
  marketId: `0x${string}`;
  source: string;
  live: boolean;
  note?: string;
  rounds: CalibratedRound[];
}

export const GENERATED_AT = "2026-09-02T20:27:10.295Z";
export const HOUSE_EDGE_BPS = 400n;
export const ROUND_BLOCKS = [10, 33, 100, 333, 1000, 3000] as const;
export const ROUND_SECONDS = [3, 10, 30, 100, 300, 900] as const;

export const CALIBRATED_MARKETS: CalibratedMarket[] = [
  {
    key: "BTC",
    label: "BTC-USD",
    marketId: "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e",
    source: "binance:BTCUSDT 1s",
    live: true,
    rounds: [
      {
        blocks: 10,
        seconds: 3,
        sigma1e4: 2223n,
        minProb1e6: 326365n,
        maxMultiplierBps: 29415n,
        probTable: [306365n, 645116n, 716736n, 773755n, 825525n, 863860n, 896378n, 922279n, 940380n, 954314n, 963882n, 971465n, 977916n, 982832n, 986333n, 988899n, 990866n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 11925n,
        minProb1e6: 163257n,
        maxMultiplierBps: 58803n,
        probTable: [143257n, 419837n, 568828n, 688148n, 777663n, 840473n, 887748n, 919020n, 942457n, 957993n, 968428n, 977463n, 983464n, 987531n, 990332n, 991999n, 994066n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 22511n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [34547n, 288866n, 492880n, 649393n, 752451n, 830532n, 883987n, 922736n, 945728n, 962418n, 973389n, 981092n, 984944n, 989729n, 992414n, 994281n, 995331n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 41192n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [2922n, 249583n, 478715n, 651920n, 757513n, 835977n, 889399n, 926962n, 948664n, 961185n, 972871n, 979549n, 984975n, 988314n, 991653n, 994992n, 996661n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 72906n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 252513n, 464824n, 621859n, 748744n, 827889n, 889447n, 937186n, 957286n, 977387n, 984925n, 987437n, 991206n, 992462n, 994975n, 996231n, 996231n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 134023n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 178707n, 357414n, 555133n, 707224n, 798479n, 870722n, 927757n, 965779n, 980989n, 992395n, 992395n, 992395n, 992395n, 992395n, 992395n, 1000000n],
      },
    ],
  },
  {
    key: "ETH",
    label: "ETH-USD",
    marketId: "0x2430f68ea2e8d4151992bb7fc3a4c472087a6149bf7e0232704396162ab7c1f7",
    source: "binance:ETHUSDT 1s",
    live: true,
    rounds: [
      {
        blocks: 10,
        seconds: 3,
        sigma1e4: 3282n,
        minProb1e6: 278763n,
        maxMultiplierBps: 34438n,
        probTable: [258763n, 555828n, 654533n, 740504n, 806424n, 857993n, 895328n, 922729n, 942797n, 956414n, 967215n, 975265n, 981049n, 984883n, 987666n, 989933n, 991716n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 16634n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [90215n, 353359n, 538156n, 676846n, 775263n, 842174n, 889948n, 919953n, 942057n, 956759n, 968195n, 977163n, 983397n, 987498n, 990832n, 993066n, 994532n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 29919n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [16106n, 273226n, 482493n, 642857n, 758520n, 835784n, 886555n, 924486n, 947829n, 965336n, 973973n, 981793n, 987045n, 990079n, 992880n, 994048n, 995331n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 54411n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [2087n, 259182n, 484140n, 659850n, 771285n, 850167n, 898581n, 931553n, 956594n, 969950n, 975793n, 981636n, 985392n, 988731n, 992487n, 993322n, 993740n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 97397n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1256n, 261307n, 497487n, 662060n, 778894n, 859296n, 899497n, 924623n, 953518n, 971106n, 981156n, 984925n, 987437n, 991206n, 994975n, 994975n, 994975n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 190058n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [3802n, 209125n, 403042n, 574144n, 722433n, 802281n, 893536n, 931559n, 950570n, 958175n, 977186n, 980989n, 992395n, 992395n, 992395n, 1000000n, 1000000n],
      },
    ],
  },
  {
    key: "MON",
    label: "MON-USD",
    marketId: "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62",
    source: "kuru:MON-AUSD (mark only)",
    live: false,
    note: "PAPER ONLY. Kuru MON-AUSD is too thin to calibrate a distribution against (24h volume ~185, no public candle history). Shape borrowed from ETH with a 2.5x sigma; re-mark from real fills before enabling live money.",
    rounds: [
      {
        blocks: 10,
        seconds: 3,
        sigma1e4: 8205n,
        minProb1e6: 278763n,
        maxMultiplierBps: 34438n,
        probTable: [258763n, 555828n, 654533n, 740504n, 806424n, 857993n, 895328n, 922729n, 942797n, 956414n, 967215n, 975265n, 981049n, 984883n, 987666n, 989933n, 991716n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 41585n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [90215n, 353359n, 538156n, 676846n, 775263n, 842174n, 889948n, 919953n, 942057n, 956759n, 968195n, 977163n, 983397n, 987498n, 990832n, 993066n, 994532n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 74798n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [16106n, 273226n, 482493n, 642857n, 758520n, 835784n, 886555n, 924486n, 947829n, 965336n, 973973n, 981793n, 987045n, 990079n, 992880n, 994048n, 995331n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 136028n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [2087n, 259182n, 484140n, 659850n, 771285n, 850167n, 898581n, 931553n, 956594n, 969950n, 975793n, 981636n, 985392n, 988731n, 992487n, 993322n, 993740n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 243493n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1256n, 261307n, 497487n, 662060n, 778894n, 859296n, 899497n, 924623n, 953518n, 971106n, 981156n, 984925n, 987437n, 991206n, 994975n, 994975n, 994975n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 475145n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [3802n, 209125n, 403042n, 574144n, 722433n, 802281n, 893536n, 931559n, 950570n, 958175n, 977186n, 980989n, 992395n, 992395n, 992395n, 1000000n, 1000000n],
      },
    ],
  },
];

export const marketByKey = (k: string) => CALIBRATED_MARKETS.find((m) => m.key === k);
