// The round director: buy phase, live round, the Spike plant and defuse, win checks,
// economy and match flow. It owns the combat instance and the bot stepping, and it is
// the only place phases change, so the HUD and the bots always agree on the game.
// Numbers: 12 s buy phase, 105 s rounds, 3.2 s plant channel, 35 s Spike fuse, 5 s
// defuse; first to 7 rounds wins, 13 at most. Economy: $800 start, $16,000 cap, kill
// +$300, plant +$800 team / +$300 planter, round win +$3,250, round loss +$1,900 rising
// $250 per consecutive loss to +$2,650. Loadouts persist between rounds.
import * as THREE from 'three';
import { PHASE, TEAM, MATCH, award } from './state.js';
import { SITE, SPAWNS } from './map.js';
import { stepBot } from './bots.js';
import { createCombat } from './combat.js';

const PLANT_SPOT = new THREE.Vector3(3.1, 0, -16.8);
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;

export function createRounds({ scene, map, state, player, loadout, squad, effects, audio, hud, getPlayerDir }) {
  const playerProxy = {
    isPlayer: true,
    team: TEAM.BREAKERS,
    name: 'YOU',
    position: player.body.position,
    velocity: player.body.velocity,
    mesh: null,
    armor: 0,
    lastHurtBy: null,
    lastHurtAt: -99,
    get hp() { return player.body.hp; },
    set hp(value) { player.body.hp = value; },
    get alive() { return player.body.alive; },
    set alive(value) { player.body.alive = value; },
    eyeHeight() { return player.body.eye; },
    headPos(out) { return out.set(this.position.x, this.position.y + player.body.eye + 0.1, this.position.z); },
    chestPos(out) { return out.set(this.position.x, this.position.y + player.body.eye - 0.32, this.position.z); },
  };
  const combatants = [playerProxy, ...squad.bots];
  state.noises = [];

  let plantingBot = null;
  let plantProgress = 0;
  let defusingBot = null;
  let defuseProgress = 0;
  let playerPlantProgress = 0;
  let nextBeepIn = 0;
  let uiActive = false;

  const combat = createCombat({
    colliders: map.colliders,
    effects,
    audio,
    state,
    onNoise(pos, team, radius) {
      state.noises.push({ pos: pos.clone(), at: state.time, team, radius });
      if (state.noises.length > 24) state.noises.shift();
    },
    onPlayerHit(dmg, attacker) {
      hud.hurt();
      audio.hurt();
      effects.shake(0.14);
      // point the HUD's damage arc at whoever landed the hit
      if (attacker && attacker.position && !attacker.isPlayer) {
        const f = getPlayerDir();
        const ax = attacker.position.x - player.body.position.x;
        const az = attacker.position.z - player.body.position.z;
        hud.hurtFrom(Math.atan2(f.x * az - f.z * ax, f.x * ax + f.z * az));
      }
    },
    onKill(victim, attacker, head) {
      const killerName = attacker ? (attacker.isPlayer ? 'YOU' : attacker.name) : '—';
      hud.feed(`${killerName}  ▸  ${victim.isPlayer ? 'YOU' : victim.name}${head ? '  (headshot)' : ''}`);
      if (attacker && attacker.isPlayer) {
        state.stats.kills += 1;
        award(state, 300);
        audio.kill();
      }
      if (victim.isPlayer) state.stats.deaths += 1;
      if (state.spike.carrier === 'player' && victim.isPlayer) dropSpike(player.body.position);
      else if (victim.id && state.spike.carrier === victim.id) dropSpike(victim.position);
    },
  });
  combat.setCombatants(combatants);

  effects.onGrenadeSettle = (grenade) => {
    const pos = grenade.mesh.position;
    if (grenade.type === 'shard') {
      effects.explosion(pos);
      audio.explosion();
      combat.explode(pos, 6.5, 95, grenade.actor);
    } else if (grenade.type === 'flare') {
      effects.burst(pos, 0xffffff, 16, 2, 0.3, 2);
      audio.flashPop();
      const blind = combat.flare(pos, player.body, getPlayerDir());
      if (blind > 0) hud.flash(Math.min(1, blind * 1.5));
    } else {
      effects.addSmoke(pos);
      audio.smokeHiss();
    }
  };

  function dropSpike(position) {
    state.spike.carrier = null;
    state.spike.position = new THREE.Vector3(position.x, 0, position.z);
    effects.setSpikeMode('dropped', state.spike.position);
    hud.feed('The Spike is down');
  }

  function doPlant(actor, position) {
    state.spike.planted = true;
    state.spike.carrier = null;
    state.spike.position = position.clone();
    state.phase = PHASE.PLANTED;
    state.phaseTime = MATCH.spikeFuseSeconds;
    nextBeepIn = 1;
    effects.setSpikeMode('planted', state.spike.position);
    audio.plantDone();
    award(state, 800);
    if (actor.isPlayer) {
      state.stats.plants += 1;
      award(state, 300);
    }
    hud.banner('SPIKE PLANTED', actor.isPlayer ? 'Defend the Crucible' : `${actor.name} planted — defend it`, 2.4, 'win');
    plantingBot = null;
    plantProgress = 0;
    playerPlantProgress = 0;
    hud.setChannel(null);
  }

  function roundWin(team, reason) {
    if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
    state.score[team] += 1;
    state.winner = team;
    state.winReason = reason;
    state.phase = PHASE.ROUND_END;
    state.phaseTime = MATCH.endSeconds;
    hud.showBuy(false);
    hud.setChannel(null);
    if (team === TEAM.BREAKERS) {
      state.lossStreak = 0;
      award(state, 3250);
      audio.roundWin();
    } else {
      state.lossStreak += 1;
      award(state, 1900 + Math.min(750, (state.lossStreak - 1) * 250));
      audio.roundLose();
    }
    hud.banner(team === TEAM.BREAKERS ? 'ROUND WON' : 'ROUND LOST',
      `${reason} · Breakers ${state.score.breakers} — ${state.score.wardens}`, 3.4,
      team === TEAM.BREAKERS ? 'win' : 'lose');
  }

  function resetRound() {
    state.phase = PHASE.BUY;
    state.phaseTime = MATCH.buySeconds;
    state.winner = null;
    state.spike.carrier = 'player';
    state.spike.planted = false;
    state.spike.position = null;
    plantingBot = null;
    defusingBot = null;
    plantProgress = 0;
    defuseProgress = 0;
    playerPlantProgress = 0;
    state.noises.length = 0;
    effects.setSpikeMode('carried');
    loadout.newRound();
    playerProxy.armor = loadout.armor;
    player.reset(new THREE.Vector3(0, 0, 27), 0);
    squad.reset(SPAWNS, null);
    if (uiActive) hud.showBuy(true);
    hud.banner(`ROUND ${state.round}`, 'Breakers attack — plant the Spike at the Crucible', 2.4, 'intro');
  }

  const botCtx = {
    time: 0,
    map,
    colliders: map.colliders,
    effects,
    noises: state.noises,
    combatants,
    spike: state.spike,
    fireBot(bot, target, dist) { combat.botFire(bot, target, dist); },
    plantRequest(bot) {
      if (state.phase !== PHASE.LIVE || state.spike.carrier !== bot.id || state.spike.planted) return false;
      if (bot.position.distanceTo(PLANT_SPOT) > 1.1) {
        bot.directPos = PLANT_SPOT;
        return false;
      }
      bot.state = 'planting';
      plantingBot = bot;
      plantProgress = 0;
      return true;
    },
    defuseRequest(bot) {
      if (state.phase !== PHASE.PLANTED || !state.spike.planted) return;
      bot.state = 'defusing';
      defusingBot = bot;
    },
  };

  function stepBots(dt) {
    botCtx.time = state.time;
    for (const bot of squad.bots) stepBot(bot, dt, botCtx);
  }

  function checkChannels(dt, keys) {
    // the player plants by holding E inside the Crucible ring
    const body = player.body;
    const inSite = Math.hypot(body.position.x - SITE.x, body.position.z - SITE.z) < SITE.radius;
    if (state.phase === PHASE.LIVE && state.spike.carrier === 'player' && body.alive && inSite &&
        keys.has('KeyE') && player.groundSpeed() < 1.2) {
      playerPlantProgress += dt;
      hud.setChannel('PLANTING THE SPIKE', playerPlantProgress / PLANT_TIME);
      if (playerPlantProgress >= PLANT_TIME) doPlant(playerProxy, new THREE.Vector3(body.position.x, 0, body.position.z));
    } else if (playerPlantProgress > 0) {
      playerPlantProgress = 0;
      if (!plantingBot) hud.setChannel(null);
    }
    // a bot carrier plants
    if (plantingBot) {
      if (!plantingBot.alive || plantingBot.state !== 'planting') {
        plantingBot = null;
        plantProgress = 0;
        hud.setChannel(null);
      } else {
        plantProgress += dt;
        if (plantProgress >= PLANT_TIME) doPlant(plantingBot, PLANT_SPOT.clone());
      }
    }
    // a Warden defuses
    if (defusingBot && state.spike.planted) {
      if (!defusingBot.alive || defusingBot.state !== 'defusing') {
        defusingBot = null;
        defuseProgress = 0;
      } else {
        defuseProgress += dt;
        if (defuseProgress >= DEFUSE_TIME) {
          state.spike.planted = false;
          effects.setSpikeMode('carried');
          audio.defuseDone();
          roundWin(TEAM.WARDENS, 'Spike defused');
        }
      }
    }
  }

  function checkSpikePickup() {
    if (state.spike.planted || state.spike.carrier !== null || !state.spike.position) return;
    const pos = state.spike.position;
    if (player.body.alive && player.body.position.distanceTo(pos) < 1.5) {
      state.spike.carrier = 'player';
      state.spike.position = null;
      effects.setSpikeMode('carried');
      hud.feed('You recovered the Spike');
      return;
    }
    for (const bot of squad.bots) {
      if (bot.alive && bot.team === TEAM.BREAKERS && bot.position.distanceTo(pos) < 1.5) {
        state.spike.carrier = bot.id;
        state.spike.position = null;
        bot.role = 'carrier';
        bot.state = 'advance';
        bot.goalNode = 9;
        bot.directPos = null;
        effects.setSpikeMode('carried');
        hud.feed(`${bot.name} recovered the Spike`);
        return;
      }
    }
  }

  function eliminations() {
    const breakersAlive = squad.alive(TEAM.BREAKERS).length + (player.body.alive ? 1 : 0);
    const wardensAlive = squad.alive(TEAM.WARDENS).length;
    if (state.phase === PHASE.LIVE) {
      if (wardensAlive === 0) roundWin(TEAM.BREAKERS, 'Wardens eliminated');
      else if (breakersAlive === 0) roundWin(TEAM.WARDENS, 'Breakers eliminated');
    } else if (state.phase === PHASE.PLANTED) {
      if (wardensAlive === 0) roundWin(TEAM.BREAKERS, 'Wardens eliminated');
    }
  }

  return {
    combat,
    playerProxy,
    combatants,
    setUiActive(value) { uiActive = value; },
    startMatch() {
      state.round = 1;
      state.score.breakers = 0;
      state.score.wardens = 0;
      state.playerMoney = MATCH.startMoney;
      state.lossStreak = 0;
      state.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, plants: 0 };
      state.matchWinner = null;
      loadout.armor = 0;
      resetRound();
    },
    update(dt, keys) {
      state.time += dt;
      while (state.noises.length && state.time - state.noises[0].at > 3) state.noises.shift();
      state.phaseTime -= dt;
      if (state.phase === PHASE.BUY) {
        if (state.phaseTime <= 0) {
          state.phase = PHASE.LIVE;
          state.phaseTime = MATCH.roundSeconds;
          hud.showBuy(false);
          audio.countGo();
          hud.banner(`ROUND ${state.round} — LIVE`, state.spike.carrier === 'player' ? 'Plant the Spike at the Crucible' : 'Escort the Spike', 2.0, 'intro');
        }
        return;
      }
      if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) {
        stepBots(dt);
        checkChannels(dt, keys);
        checkSpikePickup();
        eliminations();
        if (state.phase === PHASE.LIVE && state.phaseTime <= 0) {
          roundWin(TEAM.WARDENS, 'The clock ran out');
        } else if (state.phase === PHASE.PLANTED) {
          nextBeepIn -= dt;
          if (nextBeepIn <= 0) {
            nextBeepIn = state.phaseTime < 6 ? 0.35 : state.phaseTime < 15 ? 0.7 : 1.1;
            audio.beep(state.phaseTime < 5);
          }
          if (state.phaseTime <= 0) {
            const pos = state.spike.position.clone();
            effects.explosion(pos);
            audio.explosion();
            combat.explode(pos, 9, 130, playerProxy);
            roundWin(TEAM.BREAKERS, 'The Spike detonated');
          }
        }
        return;
      }
      if (state.phase === PHASE.ROUND_END) {
        if (state.phaseTime <= 0) {
          const breakersWon = state.score.breakers >= MATCH.roundsToWin;
          const wardensWon = state.score.wardens >= MATCH.roundsToWin;
          if (breakersWon || wardensWon || state.round >= MATCH.maxRounds) {
            state.matchWinner = breakersWon || state.score.breakers > state.score.wardens ? TEAM.BREAKERS : TEAM.WARDENS;
            state.phase = PHASE.MATCH_END;
            hud.showMenu('match-end', state.stats);
          } else {
            state.round += 1;
            resetRound();
          }
        }
      }
    },
  };
}
