export const HERO_BENEFITS = [
  "Spot meme-driven attention before price fully reacts",
  "See which coins actually map to the narrative",
  "Filter hype with live market validation",
] as const;

export const HERO_PROOF_STRIP = [
  "Tracks narratives across X, Reddit, Telegram, and market response",
  "Links rising themes to live memecoins in one workflow",
  "Built for narrative-first crypto research",
] as const;

export const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Detect narrative acceleration",
    detail:
      "Rank emerging narratives by attention velocity, post volume, and platform spread so fast-moving themes surface before a ticker-led workflow takes over.",
    chips: ["Attention velocity", "Post volume", "Platform spread"],
  },
  {
    step: "02",
    title: "Surface linked memecoins",
    detail:
      "Pull correlated memecoins into the same workspace with linked assets, confidence scoring, and liquidity context while the narrative is still active.",
    chips: ["Linked assets", "Liquidity", "Confidence"],
  },
  {
    step: "03",
    title: "Validate market response",
    detail:
      "Pressure-test the selected coin with chart context, transaction flow, and market-cap context before deciding whether the move deserves capital or continued monitoring.",
    chips: ["Chart context", "Transactions", "Market cap"],
  },
] as const;

export const PLATFORM_DETAILS = [
  {
    title: "Narratives ranked by acceleration",
    text: "The left panel ranks emerging narratives by attention, post volume, and platform spread so users can see internet momentum before price-led screeners flatten the story.",
  },
  {
    title: "Memecoins linked to the thesis",
    text: "The center board keeps linked memecoins in the same workflow with liquidity, momentum, and confidence context instead of forcing a second research tab.",
  },
  {
    title: "Validation beside the move",
    text: "The right panel validates the selected coin with chart context, market-cap context, transaction flow, and recent price response in the same view.",
  },
  {
    title: "Built for repeated monitoring",
    text: "The terminal is designed for repeated narrative scanning, linked-asset review, and follow-up validation rather than decorative dashboard browsing.",
  },
] as const;

export const DETAIL_PROOF_POINTS = [
  {
    title: "Narrative ranking",
    text: "Attention velocity, post volume, and platform spread stay visible while you review the linked move.",
    metrics: "Attention velocity / Post volume / Platform spread",
  },
  {
    title: "Linked memecoins",
    text: "The board keeps momentum, liquidity, and confidence in the same view instead of sending you into a second tab.",
    metrics: "Momentum / Liquidity / Confidence",
  },
  {
    title: "Validation context",
    text: "Chart preview, transactions, market cap, and recent response help pressure-test the asset before acting.",
    metrics: "Chart context / Transactions / Market cap",
  },
] as const;

export const FAQS = [
  {
    question: "What does the platform track?",
    answer:
      "It tracks internet narratives, ranks them by attention, and connects those narratives to linked memecoins and market validation data.",
  },
  {
    question: "Who is it for?",
    answer:
      "It is built for active crypto traders, narrative researchers, and operators who need to move from attention to asset quickly.",
  },
  {
    question: "What makes it different from a typical screener?",
    answer:
      "A normal screener starts with price and volume. This workflow starts with the narrative, then shows the assets and market context tied to it.",
  },
  {
    question: "Is this brokerage or execution software?",
    answer:
      "No. It is research software. It does not custody funds, route orders, or provide personal financial advice.",
  },
  {
    question: "How do I get access?",
    answer:
      "Create an account, start a membership, and the paid routes unlock once subscription access is active on the account.",
  },
] as const;

export const MOBILE_CREDIBILITY_CARDS = [
  {
    title: "Multi-source signal coverage",
    text: HERO_PROOF_STRIP[0],
  },
  {
    title: "Narrative-to-coin workflow",
    text: HERO_PROOF_STRIP[1],
  },
  {
    title: "Research-first product design",
    text: HERO_PROOF_STRIP[2],
  },
] as const;

export const MOBILE_WHY_IT_MATTERS = [
  {
    title: "Move before price-only dashboards catch up",
    text: "The workflow starts with attention acceleration, so you are not waiting for a screener to tell you the move already happened.",
  },
  {
    title: "Keep the thesis and asset in one view",
    text: "Narrative ranking, linked memecoins, and validation context stay together so conviction does not get lost across tabs.",
  },
  {
    title: "Pressure-test hype before risking capital",
    text: "Liquidity, market context, and transaction flow help separate a real move from noise while the theme is still active.",
  },
] as const;

export const MOBILE_SCREENSHOT_CARDS = [
  {
    eyebrow: "Narratives",
    title: "See which stories are accelerating right now",
    text: "Start with attention velocity, post volume, and platform spread instead of waiting for a price spike to tell you where the crowd already is.",
    routeLabel: "/trends",
    frameLabel: "Narrative Rankings",
    frameDescription: "Acceleration signals across the live research terminal",
    footerText: "Attention velocity, post volume, and platform spread stay visible.",
    imageClassName: "object-[18%_center]",
  },
  {
    eyebrow: "Linked Coins",
    title: "Check the memecoins tied to the thesis",
    text: "The middle board keeps correlated coins, liquidity context, and confidence signals in the same workflow while the narrative is still moving.",
    routeLabel: "/memecoins",
    frameLabel: "Linked Memecoin Board",
    frameDescription: "Correlated assets with liquidity and confidence context",
    footerText: "Momentum, liquidity, and confidence stay in one scan.",
    imageClassName: "object-[52%_center]",
  },
  {
    eyebrow: "Validation",
    title: "Validate the move before you chase it",
    text: "Use chart context, transactions, and market-cap context to decide whether the narrative deserves capital or more monitoring.",
    routeLabel: "/validate",
    frameLabel: "Validation Panel",
    frameDescription: "Market response beside the narrative and linked asset",
    footerText: "Chart context, transactions, and market cap sit beside the signal.",
    imageClassName: "object-[84%_center]",
  },
] as const;
