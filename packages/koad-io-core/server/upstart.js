koad={
  ...koad,
  upstart: new Date(),
  environment: process.env.NODE_ENV,
	process: null,
	device: null,
  entity: process.env.ENTITY,
	mongo: {},
  error : function(code, message, stack) {
    let id = ApplicationErrors.insert({
      event: 'koad.error',
      code, message,
      created: new Date(),
      timestamp: koad.format.timestamp(new Date()),
      user: this.userId ? this.userId : 'anonymous',
      environment: koad.environment,
      source: process.env.KOAD_IO_SOURCE,
      asset: process.env.HOSTNAME,
      instance: koad.instance,
      device: koad.device,
      stack: stack,
      client: koad.process,
    });
    logger.warning(`Error ${code} [${id}]: ${message}`);
  }
};


if(!process.env.ENTITY || process.env.ENTITY === false) {
  log.warning('Application spawned without entity: no database is saved/stored/connected!');
  koad.entity = null;
  koad.mongo.connection = null;
};

if(!process.env.MONGO_URL || process.env.MONGO_URL === false){ 
  log.warning('Application spawned in-memory only: no database is saved/stored/connected!');
  koad.mongo.connection = null;
} 

log.success('spawning koad-io global object: koad');
