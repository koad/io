const os = Npm.require('os');

koad.system = koad.system || {};

koad.system.health = function () {
  const cpus = os.cpus();
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  const loadavg = os.loadavg();

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    cores: cpus.length,
    loadavg: {
      '1m': loadavg[0],
      '5m': loadavg[1],
      '15m': loadavg[2],
    },
    memory: {
      total: totalmem,
      free: freemem,
      used: totalmem - freemem,
      percent: Math.round(((totalmem - freemem) / totalmem) * 100),
    },
  };
};

koad.system.loadavg = function () {
  const loadavg = os.loadavg();
  return {
    '1m': loadavg[0],
    '5m': loadavg[1],
    '15m': loadavg[2],
    cores: os.cpus().length,
  };
};

koad.system.memory = function () {
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  return {
    total: totalmem,
    free: freemem,
    used: totalmem - freemem,
    percent: Math.round(((totalmem - freemem) / totalmem) * 100),
  };
};

log.success('loaded koad-io-core/system-health');
