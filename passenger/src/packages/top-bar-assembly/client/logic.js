

Template['__top_bar_assembly__'].onRendered(function () {
	setTimeout(()=>{
		$(".site-contained").css("padding-top", 70);
	}, 100)
});




Template['__top_bar_assembly__'].helpers({
	NavItems() {
		return Session.get('TopBarNavItems');
	},
	username() {
		return Meteor.user?.()?.username
	},
	isActiveRoute(route) {
		if(!Router || !Router.current() || !Router.current().route) return;
		const currentRoute = Router.current().route.getName();
		if (route == currentRoute) return 'active';
		return '';
	},
	isActivePath(path) {
		if(!Router || !Router.current() || !Router.current().route) return;
		const currentPath = Router.current().route.path(this);
		if (path == currentPath) return 'active';
		return '';
	},
	infobar(){
		// Check for sovereign profile first
		const sovereignProfile = Session.get('activeSovereignProfile');
		if(sovereignProfile) {
			return {
				text: `Sovereign: ${sovereignProfile.name}`,
				link: '/profiles.html',
				icon: 'key'
			};
		}
		
		// Check for Meteor user
		if(!Meteor.user?.()) {
			return {
				text: 'Observing Anonymously',
				link: '/profiles.html',
				icon: 'person'
			};
		}
		
		return {
			text: `Logged in as ${Meteor.user?.().username}`,
			link: '/profiles.html'
		}
	},
	isPopup(){
		if(Router.current()?.options?.route?.options?.popup) return true;
		return false;
	},
	homeButtonTarget(){
		let target = Session.get('ApplicationIconTarget')
		if(!target) return false;
		return target
	}
});

Meteor.startup(()=>{
	Session.set('ApplicationIconTarget', '/index.html')
})