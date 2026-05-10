module.exports = {

  meta: {
    name: 'template',
    description: 'Utility template — copy and rename to create a new utility',
    disabled: true,
  },

  // Called once at load time with { Lighthouse, log, DEBUG }
  init(ctx) {
    this.ctx = ctx;
    ctx.log.info(`[${this.meta.name}] initialized`);
  },

  // Called when DDP connects to the daemon — { Lighthouse }
  connected({ Lighthouse }) {},

  // Called when DDP disconnects
  disconnected() {},

};
