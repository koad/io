
### Interface Skeleton (`~/.koad-io/skeletons/interface`)

The `interface` skeleton is a special PWA-focused skeleton designed for administration and management of devices, entities, and workers within your koad\:io ecosystem.

* When you run `alice generate interface`, it creates a folder like `~/.alice/interface` bound to the environment variable `KOAD_IO_ZEROTEIR_INTERFACE`.
* Inside this folder, the `commands` directory contains all the interface-specific commands that power the administrative UI and functionality.

#### Example

One key part of this skeleton is the navigation setup in `src/client/navigation.js`. This script runs on Meteor startup and initializes the UI menu structure via a reactive Session variable called `accordion`. It defines the hierarchical navigation for the PWA, including role-based access control on menus:

```js
Meteor.startup(function(){
  Session.set('accordion', [
    {
      title: "Home",
      url: "/",
      roles: null
    },
    {
      title: "Accounts",
      url: "/dashboard/accounts",
      roles: ['admin']
    },
    {
      title: "People",
      url: "/dashboard/people",
      roles: ['admin']
    },
    // ... more entries ...
    {
      title: "Errors",
      url: "/dashboard/errors",
      roles: ['admin']
    },
    {
      title: "Utilities",
      url: "/dashboard/utilities",
      roles: ['admin']
    }
  ]);
});
```

* Roles control visibility of menu items.
* Subcategories allow nested menus (commented out examples exist).
* This navigation controls access and structure of the administration PWA.

---

This skeleton enables a fully functional admin PWA bound to your entity, ready to be customized or extended as needed.

---

### Extendability

Since the interface skeleton is a full Meteor app connected to the entity’s MongoDB, users can freely extend it by adding their own dashboards, templates, and commands. This setup provides a flexible playground where you can prototype custom functionality, build specialized admin panels, or create personal utilities — all seamlessly integrated with your entity’s data and infrastructure.

