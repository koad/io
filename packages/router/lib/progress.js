// Default progress options
Router.configure({
	progress: true,
	progressDebug: false,
	progressDelay: false,
	progressSpinner: true,
	progressTick: true
});

// Used to debug the package, if progressDebug is true
const debug = function() {
	if (Router.current().lookupOption('progressDebug')) {
		console.log.apply(console, arguments);
	}
};

Template.__IronRouterProgress__.created = function() {
	const self = this;

	this.ticker = false;
	this.delay = false;
	this.started = false;
	this.loading = new ReactiveVar(false);
	this.spinner = new ReactiveVar(false);
	this.done = new ReactiveVar(false);
	this.percent = new ReactiveVar(false);

	this.functions = {
		reset: function(element) {
			debug('Reset');

			self.functions.stop();

			// Reset our variables
			self.loading.set(false);
			self.done.set(false);
			self.percent.set(0);
			self.started = false;

			if (element) {
				element.offsetWidth = element.offsetWidth;
			}

			return self;
		},

		start: function(element) {
			debug('Start');

			// Reset our progress
			self.functions.reset(element);

			// Update the spinner status, if it changed
			self.spinner.set(Router.current().lookupOption('progressSpinner') || false);

			self.loading.set(true);

			// If we have a delay, wait with the progress
			const delay = Router.current().lookupOption('progressDelay');
			if (delay > 0) {
				debug('Delayed');
				self.delay = Meteor.setTimeout(function() {
					self.started = true;
					self.functions.progress();
					self.functions.tick();
				}, delay);
			} else {
				debug('Not delayed');
				self.started = true;
				self.functions.progress();
				self.functions.tick();
			}

			return self;
		},

		progress: function(progress) {
			if (progress === undefined) {
				progress = false;
			}
			debug('Progress');

			// XX We need a better random number generation here
			const percent = self.percent.get();
			const percentNew = percent + (progress ? progress : (100 - percent) * (Math.random() * 0.45 + 0.05) | 0);

			if (percentNew >= 100) {
				self.functions.done();
			} else {
				self.percent.set(percentNew);
				self.functions.tick();
			}

			return self;
		},

		tick: function() {
			debug('Tick');

			if (Router.current().lookupOption('progressTick')) {
				debug('starting new ticker');
				if (self.ticker) {
					Meteor.clearTimeout(self.ticker);
					self.ticker = false;
				}

				self.ticker = Meteor.setTimeout(function() {
					self.ticker = false;
					self.functions.progress();
				}, Math.random() * 750 + 750);
			} else {
				debug('Not starting ticker');
			}

			return self;
		},

		done: function() {
			debug('Done');

			self.functions.stop();

			if (!self.started) {
				self.functions.reset();
			} else {
				_.defer(function() {
					self.done.set(true);
				});
				self.loading.set(true);
				self.percent.set(100);
			}
			return self;
		},

		stop: function() {
			debug('Stop');

			// Clear the timers, if we have any
			if (self.ticker) {
				Meteor.clearTimeout(self.ticker);
				self.ticker = false;
			}
			if (self.delay) {
				Meteor.clearTimeout(self.delay);
				self.delay = false;
			}

			return self;
		}
	};

	Router.load(function() {
		debug('IR:load');
		const element = self.find('*');
		self.functions.start(element);

		this.next();
		return this;
	});

	Router.unload(function() {
		debug('IR:unload');
		self.functions.reset();
		return this;
	});

	Router.onRun(function() {
		debug('IR:run');
		self.loading.set(true);
		this.next();
		return this;
	});

	Router.onRerun(function() {
		debug('IR:re-run');
		this.next();
		return this;
	});

	Router.onBeforeAction(function() {
		debug('IR:before');
		if (this.ready()) {
			self.functions.done();
			self.functions.stop();
		} else {
			self.functions.progress();
		}
		this.next();
		return this;
	});

	Router.onAfterAction(function() {
		debug('IR:after');
		return this;
	});

	Router.onStop(function() {
		debug('IR:stop');
		self.functions.reset();
		return this;
	});
};

Template.__IronRouterProgress__.helpers({
	data: function() {
		return Template.instance();
	},
	template: function() {
		// If progress is disabled in general, don't show a template
		const router = Router.current();
		if (!(router && router.lookupOption('progress'))) {
			return null;
		}

		return Template.instance().loading.get() ? '__IronRouterProgressDefault__' : null;
	}
});

Template.__IronRouterProgressDefault__.rendered = function() {
	// Used for the CSS reset
	this.element = this.$('#iron-router-progress');
};

Template.__IronRouterProgressDefault__.helpers({
	cssClass: function() {
		const classes = [];

		if (this.loading.get()) {
			classes.push('loading');
		}
		if (this.spinner.get()) {
			classes.push('spinner');
		}
		if (this.done.get()) {
			classes.push('done');
		}

		return classes.join(' ');
	},
	cssStyle: function() {
		const styles = [];

		if (this.percent.get()) {
			styles.push(`width:${this.percent.get()}%`);
		}

		return styles.join(';');
	}
});

Template.__IronRouterProgressDefault__.events({
	'transitionend #iron-router-progress, webkitTransitionEnd #iron-router-progress, oTransitionEnd #iron-router-progress, otransitionend #iron-router-progress, MSTransitionEnd #iron-router-progress': function(e, template) {
		// Only reset, if this is the last transition, and that it's not a psuedo selector, such as `:before` and `:after`
		// Due to the open nature, of the CSS, I want people to be able to do whatever they like, and as such
		// simply expecting opacity to reach zero, or specific propertyName to execute won't suffice
		// A more elegant solution should be added, as not all browsers may support transition-property
		// witout their vendor prefixes

		const transitionProperty = template.element.css('transition-property').split(', ');
		if (e.originalEvent.pseudoElement === '' && e.originalEvent.propertyName === _.last(transitionProperty)) {
			debug('transitionend');
			const data = Template.currentData();
			data.done.set(false);
			data.loading.set(false);
			data.percent.set(false);
		}
	}
});

// Prepare our DOM-element
Meteor.startup(function() {
	const layout = new Iron.Layout({
		template: '__IronRouterProgress__'
	});
	layout.insert({
		el: document.body
	});
});
