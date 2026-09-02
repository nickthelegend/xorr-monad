/** GENERATED FILE - do not edit by hand.
 *  Produced by `pnpm calibrate` from real market tape.
 *  Generated: 2026-09-02T16:17:16.452Z
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

export const GENERATED_AT = "2026-09-02T16:17:16.452Z";
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
        sigma1e4: 6717n,
        minProb1e6: 329982n,
        maxMultiplierBps: 29092n,
        probTable: [309982n, 635065n, 709285n, 769255n, 821208n, 861610n, 896095n, 921313n, 940297n, 954198n, 964465n, 972032n, 978482n, 982899n, 986316n, 988833n, 990550n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 13533n,
        minProb1e6: 162290n,
        maxMultiplierBps: 59153n,
        probTable: [142290n, 407901n, 558760n, 683547n, 774429n, 839307n, 887215n, 920320n, 943624n, 958760n, 968528n, 977330n, 983397n, 987265n, 990298n, 992232n, 993866n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 23662n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [33147n, 281979n, 490546n, 641690n, 753852n, 832049n, 883170n, 918301n, 946195n, 962185n, 973389n, 980509n, 985994n, 989729n, 992880n, 994865n, 996148n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 44377n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1252n, 235392n, 463689n, 643155n, 756260n, 839316n, 892738n, 928214n, 949499n, 962437n, 973289n, 979549n, 984975n, 989149n, 991235n, 992905n, 996661n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 75264n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1256n, 243719n, 464824n, 623116n, 737437n, 816583n, 890704n, 935930n, 958543n, 979899n, 984925n, 987437n, 991206n, 991206n, 992462n, 996231n, 996231n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 145622n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 193916n, 384030n, 558935n, 684411n, 775665n, 878327n, 927757n, 946768n, 980989n, 988593n, 988593n, 992395n, 996198n, 1000000n, 1000000n, 1000000n],
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
        sigma1e4: 9437n,
        minProb1e6: 277896n,
        maxMultiplierBps: 34545n,
        probTable: [257896n, 550828n, 658116n, 741104n, 807590n, 858760n, 896912n, 924180n, 943564n, 957431n, 967915n, 975465n, 980699n, 984783n, 987733n, 989833n, 991816n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 18541n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [89615n, 361127n, 541024n, 680880n, 778563n, 845008n, 892115n, 920553n, 941590n, 956793n, 968061n, 976863n, 983431n, 987565n, 990732n, 992832n, 994432n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 31217n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [19024n, 271008n, 482493n, 648693n, 762722n, 841153n, 891223n, 924603n, 947246n, 962535n, 974556n, 981559n, 985994n, 989146n, 991363n, 994048n, 995215n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 55272n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1669n, 266694n, 495409n, 666110n, 784224n, 857679n, 901503n, 933222n, 953673n, 964524n, 972454n, 976628n, 984140n, 987479n, 991653n, 992487n, 994157n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 97200n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1256n, 275126n, 508794n, 675879n, 782663n, 859296n, 899497n, 929648n, 956030n, 974874n, 982412n, 986181n, 989950n, 991206n, 992462n, 992462n, 992462n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 170904n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 224335n, 410646n, 608365n, 745247n, 847909n, 885932n, 920152n, 935361n, 958175n, 961977n, 977186n, 984791n, 988593n, 1000000n, 1000000n, 1000000n],
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
        sigma1e4: 23593n,
        minProb1e6: 277896n,
        maxMultiplierBps: 34545n,
        probTable: [257896n, 550828n, 658116n, 741104n, 807590n, 858760n, 896912n, 924180n, 943564n, 957431n, 967915n, 975465n, 980699n, 984783n, 987733n, 989833n, 991816n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 46353n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [89615n, 361127n, 541024n, 680880n, 778563n, 845008n, 892115n, 920553n, 941590n, 956793n, 968061n, 976863n, 983431n, 987565n, 990732n, 992832n, 994432n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 78043n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [19024n, 271008n, 482493n, 648693n, 762722n, 841153n, 891223n, 924603n, 947246n, 962535n, 974556n, 981559n, 985994n, 989146n, 991363n, 994048n, 995215n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 138180n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1669n, 266694n, 495409n, 666110n, 784224n, 857679n, 901503n, 933222n, 953673n, 964524n, 972454n, 976628n, 984140n, 987479n, 991653n, 992487n, 994157n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 243000n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [1256n, 275126n, 508794n, 675879n, 782663n, 859296n, 899497n, 929648n, 956030n, 974874n, 982412n, 986181n, 989950n, 991206n, 992462n, 992462n, 992462n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 427260n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 224335n, 410646n, 608365n, 745247n, 847909n, 885932n, 920152n, 935361n, 958175n, 961977n, 977186n, 984791n, 988593n, 1000000n, 1000000n, 1000000n],
      },
    ],
  },
];

export const marketByKey = (k: string) => CALIBRATED_MARKETS.find((m) => m.key === k);
