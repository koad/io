Router.onRun(function() {
    var route = {
        'route': this.route.getName(),
        'path': Iron.Location.get().path,
        'params': this.params
    };
    Meteor.call('update.client.subscriptions', route);
    Session.set( 'route', route )
    this.next();
}, {
    except: ['hooks', 'fdns', 'notify', 'notify-sms', 'api']
});
