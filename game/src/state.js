// The one place match state lives: phases, the round clock, the Spike, both teams'
// round scores and the player's wallet and career stats. Everything else reads and
// writes through here, so the HUD, the round director and the bots never disagree.
export const PHASE = { BUY: 'buy', LIVE: 'live', PLANTED: 'planted', ROUND_END: 'round-end', MATCH_END: 'match-end' };
export const TEAM = { BREAKERS: 'breakers', WARDENS: 'wardens' };

export const MATCH = {
  roundsToWin: 7,
  maxRounds: 13,
  buySeconds: 12,
  roundSeconds: 105,
  spikeFuseSeconds: 35,
  endSeconds: 4.5,
  startMoney: 800,
  maxMoney: 16000,
};

export function createState() {
  return {
    phase: PHASE.BUY,
    phaseTime: MATCH.buySeconds,   // counts down within the current phase
    round: 1,
    score: { breakers: 0, wardens: 0 },
    winner: null,                  // team that won the current round
    winReason: '',
    matchWinner: null,
    spike: {
      carrier: 'player',           // 'player', a bot id, or null when planted/dropped
      planted: false,
      position: null,              // THREE.Vector3 once planted or dropped
      beepAt: 0,
    },
    plantChannel: null,            // { actor, time } while someone plants or defuses
    defuseChannel: null,
    playerMoney: MATCH.startMoney,
    grenadeSel: 'shard',           // grenade type G will throw
    noises: [],                    // recent gunfire { pos, at, team, radius } for bot hearing
    lossStreak: 0,
    stats: { kills: 0, deaths: 0, shots: 0, hits: 0, plants: 0 },
    feed: [],                      // kill feed entries { text, at }
    banner: null,                  // { title, sub, until } centre-screen message
    time: 0,                       // match clock, seconds of simulation
  };
}

export function award(state, amount) {
  state.playerMoney = Math.max(0, Math.min(MATCH.maxMoney, state.playerMoney + amount));
}

export function otherTeam(team) {
  return team === TEAM.BREAKERS ? TEAM.WARDENS : TEAM.BREAKERS;
}
