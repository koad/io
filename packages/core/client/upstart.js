koad = {
	...koad,
	upstart: new Date(),
    environment: Meteor.isProduction ? 'production' : 'development'
};
