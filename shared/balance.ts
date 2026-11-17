// Todos os números de balanceamento ficam aqui para ajustar sem mexer na lógica.
export const BAL = {
  tick: 1 / 60,
  targetScore: 5,
  shotClock: 12,
  checkAutoStart: 6, // segundos até iniciar sozinho
  scoreDelay: 2.2,
  gravity: 9.81,

  move: {
    walk: 4.1,
    run: 6.8,
    accel: 34,
    staminaMax: 100,
    runDrain: 18,
    regen: 14,
    regenWalk: 24,
    runMinStamina: 18,
    contestSlow: 0.75,
    tooTired: 40, // abaixo disso há penalidade
    radius: 0.42,
  },

  shot: {
    idealMs: 550, // instante perfeito do medidor
    maxHoldMs: 950, // solta sozinho
    jumpApex: 0.45,
    green: { base: 20, perAttr: 36 }, // ms: ±(base + perAttr*n) — janela verde bem estreita
    goodMult: 2.6,
    badMult: 5,
    zoneWindow: { finishing: 1.45, media: 1.0, tres: 0.85 } as Record<string, number>,
    greenPull: { base: 0.6, perAttr: 0.35 }, // quanto aproxima de 98%
    maxChance: 0.98,
    goodMult2: 1.0,
    badChance: 0.55,
    awfulChance: 0.15,
    base: {
      finishing: [0.45, 0.8],
      media: [0.3, 0.6],
      tres: [0.22, 0.52],
    } as Record<string, [number, number]>,
    movingPenalty: 0.85,
    movingSpeed: 3.0,
    contestMax: 0.95,
    contestRange: 3.6,
    autoRange: 2.3, // só de estar perto já contesta (mão alta automática)
    handsDownFactor: 0.5,
    behindFactor: 0.6,
    defBase: 0.6, // contestação mínima mesmo com defesa baixa
    greenShrink: 0.8, // contestação encolhe a janela verde (perfeito continua entrando, mas fica mais difícil)
    finishingRange: 2.5,
    cooldown: 0.0,
  },

  block: {
    base: 0.22,
    perAttr: 0.65,
    shooterPenalty: 0.08,
    range: 2.1,
    jumpApexT: 0.39,
    timingWindow: 0.52,
    threeMult: 0.6,
    maxChance: 0.93,
  },

  jump: { vy: 3.8 },

  rebound: {
    window: 0.14,
    reach: 2.3,
    grabRadius: 0.9,
    wTiming: 0.45,
    wAttr: 0.35,
    wPos: 0.2,
    minScore: 0.18,
    heightBonus: { P: -0.08, M: 0, G: 0.08 } as Record<string, number>,
  },

  drible: {
    cooldown: 0.8,
    crossT: 0.28,
    crossSpeed: 6.2,
    spinT: 0.5,
    spinSpeed: 5.0,
    range: 1.8,
    base: 0.1,
    perDrible: 0.45,
    perDef: 0.35,
    ankleFrac: 0.5,
    stunT: 0.45,
    fallT: 1.3,
    failSlowT: 0.3,
  },

  pass: {
    speed: 13,
    perAttr: 3,
    laneRadius: 0.75,
    laneSlow: 0.7,
    delay: 0.28,
    chestSlack: 0.0,
  },

  defense: {
    speedBase: 1.03,
    speedPer: 0.15, // defesa aumenta velocidade em até +15%
    gap: 0.9,
    aiGap: 1.3,
  },

  dunk: {
    range: 4.6, // distância máxima da cesta para iniciar a enterrada
    T: 0.68, // duração total (s)
    apex: 1.05, // altura do pulo (m)
    releaseU: 0.62, // momento em que a bola é enterrada (fração de T)
    base: 0.5, perFin: 0.45, contest: 0.6, minChance: 0.12, maxChance: 0.97,
    // timing: segure X e solte quando o atleta chega no aro
    maxHoldMs: 900,
    green: { base: 26, perAttr: 40 },
    goodChance: 1.0, badChance: 0.45, awfulChance: 0.12,
    heightBonus: { P: -0.15, M: 0, G: 0.1 } as Record<string, number>,
    blockMult: 0.75,
    targetZ: 0.5,
  },

  layup: {
    drift: 2.4, // velocidade (m/s) em direção à cesta durante a bandeja
    minDist: 0.95,
    apex: 0.62, // pulo mais alto que o arremesso
  },

  height: { P: 0.93, M: 1.0, G: 1.07 } as Record<string, number>,
};
export type Balance = typeof BAL;
