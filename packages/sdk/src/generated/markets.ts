/** GENERATED FILE - do not edit by hand.
 *  Produced by `pnpm calibrate` from real market tape.
 *  Generated: 2026-09-02T19:47:47.858Z
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

export const GENERATED_AT = "2026-09-02T19:47:47.858Z";
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
        sigma1e4: 5178n,
        minProb1e6: 328149n,
        maxMultiplierBps: 29255n,
        probTable: [308149n, 643466n, 715786n, 772339n, 824441n, 863510n, 896862n, 922646n, 940697n, 954614n, 964015n, 971582n, 977916n, 982549n, 986283n, 989016n, 991016n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 11800n,
        minProb1e6: 163457n,
        maxMultiplierBps: 58731n,
        probTable: [143457n, 417770n, 567261n, 688681n, 778096n, 840607n, 887915n, 919353n, 942690n, 957760n, 968695n, 977796n, 983697n, 987331n, 990098n, 991965n, 993866n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 22268n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [35131n, 286765n, 495915n, 640406n, 751984n, 832516n, 883754n, 920168n, 945145n, 961601n, 974790n, 981559n, 985644n, 988912n, 991597n, 994514n, 995682n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 40701n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [2087n, 259182n, 489566n, 641068n, 760851n, 836394n, 884808n, 924457n, 943656n, 959516n, 970785n, 978297n, 985810n, 988731n, 992905n, 995826n, 997078n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 74995n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1256n, 232412n, 453518n, 629397n, 738693n, 835427n, 886935n, 938442n, 962312n, 971106n, 981156n, 987437n, 989950n, 993719n, 993719n, 994975n, 994975n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 146912n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 212928n, 403042n, 528517n, 684411n, 802281n, 870722n, 920152n, 946768n, 973384n, 984791n, 996198n, 996198n, 1000000n, 1000000n, 1000000n, 1000000n],
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
        sigma1e4: 7586n,
        minProb1e6: 277046n,
        maxMultiplierBps: 34651n,
        probTable: [257046n, 554411n, 657900n, 739287n, 808574n, 858643n, 896095n, 923129n, 943030n, 956531n, 967398n, 975249n, 980799n, 984483n, 987449n, 989749n, 991633n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 16706n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [89615n, 355326n, 537156n, 678346n, 776329n, 842640n, 890182n, 919620n, 941390n, 956759n, 968261n, 977163n, 983231n, 987498n, 990698n, 992865n, 994399n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 29640n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [15873n, 279412n, 492880n, 648226n, 761788n, 840686n, 888772n, 924953n, 947829n, 966153n, 976190n, 982493n, 986461n, 989146n, 991947n, 993581n, 995448n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 53548n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1252n, 260017n, 478297n, 661102n, 778798n, 848080n, 894407n, 934474n, 951169n, 964107n, 972454n, 980384n, 984558n, 989149n, 991653n, 992487n, 994157n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 98203n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [3769n, 282663n, 482412n, 655779n, 771357n, 860553n, 905779n, 943467n, 964824n, 969849n, 981156n, 986181n, 988693n, 991206n, 991206n, 992462n, 994975n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 187318n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 212928n, 414449n, 604563n, 741445n, 828897n, 897338n, 935361n, 950570n, 969582n, 969582n, 980989n, 980989n, 984791n, 992395n, 996198n, 1000000n],
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
        sigma1e4: 18965n,
        minProb1e6: 277046n,
        maxMultiplierBps: 34651n,
        probTable: [257046n, 554411n, 657900n, 739287n, 808574n, 858643n, 896095n, 923129n, 943030n, 956531n, 967398n, 975249n, 980799n, 984483n, 987449n, 989749n, 991633n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 41765n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [89615n, 355326n, 537156n, 678346n, 776329n, 842640n, 890182n, 919620n, 941390n, 956759n, 968261n, 977163n, 983231n, 987498n, 990698n, 992865n, 994399n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 74100n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [15873n, 279412n, 492880n, 648226n, 761788n, 840686n, 888772n, 924953n, 947829n, 966153n, 976190n, 982493n, 986461n, 989146n, 991947n, 993581n, 995448n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 133870n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1252n, 260017n, 478297n, 661102n, 778798n, 848080n, 894407n, 934474n, 951169n, 964107n, 972454n, 980384n, 984558n, 989149n, 991653n, 992487n, 994157n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 245508n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [3769n, 282663n, 482412n, 655779n, 771357n, 860553n, 905779n, 943467n, 964824n, 969849n, 981156n, 986181n, 988693n, 991206n, 991206n, 992462n, 994975n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 468295n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 212928n, 414449n, 604563n, 741445n, 828897n, 897338n, 935361n, 950570n, 969582n, 969582n, 980989n, 980989n, 984791n, 992395n, 996198n, 1000000n],
      },
    ],
  },
];

export const marketByKey = (k: string) => CALIBRATED_MARKETS.find((m) => m.key === k);
