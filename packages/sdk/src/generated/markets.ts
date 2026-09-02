/** GENERATED FILE - do not edit by hand.
 *  Produced by `pnpm calibrate` from real market tape.
 *  Generated: 2026-09-02T22:37:41.733Z
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

export const GENERATED_AT = "2026-09-02T22:37:41.733Z";
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
        sigma1e4: 3715n,
        minProb1e6: 368409n,
        maxMultiplierBps: 26058n,
        probTable: [348409n, 706868n, 760469n, 800670n, 839196n, 869347n, 899497n, 921273n, 939698n, 953099n, 964824n, 973199n, 979899n, 983250n, 986600n, 989950n, 991625n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 11736n,
        minProb1e6: 199661n,
        maxMultiplierBps: 48081n,
        probTable: [179661n, 461017n, 576271n, 681356n, 766102n, 830508n, 881356n, 915254n, 942373n, 959322n, 972881n, 983051n, 989831n, 993220n, 996610n, 1000000n, 1000000n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 22339n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [36585n, 268293n, 463415n, 609756n, 719512n, 804878n, 865854n, 914634n, 951220n, 975610n, 987805n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 40419n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 416667n, 555556n, 694444n, 805556n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 81788n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 416667n, 527778n, 694444n, 805556n, 861111n, 916667n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 143923n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 166667n, 361111n, 555556n, 694444n, 805556n, 888889n, 916667n, 944444n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
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
        sigma1e4: 5513n,
        minProb1e6: 338258n,
        maxMultiplierBps: 28381n,
        probTable: [318258n, 634841n, 698492n, 757119n, 810720n, 854271n, 889447n, 919598n, 943049n, 958124n, 969849n, 978224n, 983250n, 986600n, 989950n, 993300n, 994975n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 16562n,
        minProb1e6: 138644n,
        maxMultiplierBps: 69242n,
        probTable: [118644n, 355932n, 522034n, 650847n, 749153n, 823729n, 877966n, 915254n, 945763n, 966102n, 976271n, 986441n, 993220n, 996610n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 29672n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [24390n, 243902n, 439024n, 585366n, 707317n, 804878n, 878049n, 914634n, 951220n, 975610n, 987805n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 52193n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 388889n, 555556n, 694444n, 805556n, 861111n, 916667n, 972222n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 95276n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 388889n, 555556n, 694444n, 805556n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 206584n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 250000n, 388889n, 611111n, 722222n, 777778n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
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
        sigma1e4: 13783n,
        minProb1e6: 338258n,
        maxMultiplierBps: 28381n,
        probTable: [318258n, 634841n, 698492n, 757119n, 810720n, 854271n, 889447n, 919598n, 943049n, 958124n, 969849n, 978224n, 983250n, 986600n, 989950n, 993300n, 994975n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 41405n,
        minProb1e6: 138644n,
        maxMultiplierBps: 69242n,
        probTable: [118644n, 355932n, 522034n, 650847n, 749153n, 823729n, 877966n, 915254n, 945763n, 966102n, 976271n, 986441n, 993220n, 996610n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 74180n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [24390n, 243902n, 439024n, 585366n, 707317n, 804878n, 878049n, 914634n, 951220n, 975610n, 987805n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 130483n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 388889n, 555556n, 694444n, 805556n, 861111n, 916667n, 972222n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 238190n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 388889n, 555556n, 694444n, 805556n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 516460n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 250000n, 388889n, 611111n, 722222n, 777778n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
    ],
  },
];

export const marketByKey = (k: string) => CALIBRATED_MARKETS.find((m) => m.key === k);
