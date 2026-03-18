/**
 * Roles Publication
 * 
 * Publishes role assignments to authenticated users.
 * Uses the alanning:roles package for role-based access control.
 * 
 * Access Levels:
 * - super-admin, admin, sysop: See all roles and assignments
 * - Authenticated users: See only their own role assignments
 * - Unauthenticated: No access
 */

if (!Roles) {
	log.warning('[roles] Roles package not loaded - role-based access control disabled');
} else {
	/**
	 * Publish Roles
	 * 
	 * Auto-publish (null name) that sends role data to clients.
	 * Administrators see all roles, regular users see only their own.
	 */
	Meteor.publish(null, async function () {
		// Check if user is an administrator
		const isAdmin = await Roles.userIsInRoleAsync(
			this.userId,
			['sysop', 'admin', 'super-admin']
		);

		if (isAdmin) {
			// Admins see all roles and all role assignments
			return [
				Meteor.roles.find(),
				Meteor.roleAssignment.find()
			];
		} else if (this.userId) {
			// Regular authenticated users see only their own role assignments
			return Meteor.roleAssignment.find({ 'user._id': this.userId });
		} else {
			// Unauthenticated users get nothing
			this.ready();
		}
	});

	log.success('loaded koad-io-accounts-core/roles');
}
