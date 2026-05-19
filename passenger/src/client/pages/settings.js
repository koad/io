import { Template } from 'meteor/templating';

Template.SettingsOptionUI.events({
    'change input[type="checkbox"]': function(event, template) {
        if (!this.key) return console.warn('key not specified in option');
        try {
            const isChecked = event.target.checked;
            console.log(`Setting key "${this.key}" to ${isChecked}`);

            koad.settings.set(this.key, {value: isChecked, asof: new Date() })

        } catch (error) {
            console.error('Error:', error.message);
            // You can handle the error as needed, such as displaying a message to the user.
        }
    },
    'change .input-settings-text': function(event, template) {
        if (!this.key) return console.warn('key not specified in option');
        try {
            const textValue = event.target.value;
            console.log(`Setting key "${this.key}" to "${textValue}"`);

            // Use the same settings update mechanism as for checkboxes
            koad.settings.set(this.key, {value: textValue, asof: new Date()})
        } catch (error) {
            console.error('Error:', error.message);
            // Handle the error as needed
        }
    }
});

Template.SettingsOptionUI.helpers({
    'checkedIfTrue': function() {
        const isChecked = koad.settings.get(this.key);
        // console.log({isChecked})
        if(isChecked?.value === true) return "checked" ;
    },
    'content': function() {
        return koad.settings.get(this.key)?.value;
    },
    'disabledIfDisabled': function() {
        if(this.disabled === true) return "disabled" ;
        if(this.roles?.includes('backstage')) return "disabled" ;
        if(this.roles?.includes('pro')) return "disabled" ;
    }
});

Template.Settings.helpers({
    Settings() {
        return [{
            name: "koad:io Daemon",
            description: "Configure the koad:io daemon to expand your flow.",
            notes: ["koad:io daemon required"],
            options: [{
                type: "string",
                option: "Daemon Host",
                description: "usually '127.0.0.1' or 'localhost' ",
                note: "usually '127.0.0.1' or 'localhost' ",
                key: 'settings.daemon.host'
            },{
                type: "string",
                option: "Daemon Port",
                description: "Usually 28282",
                note: "Usually 28282",
                key: 'settings.daemon.port'
            },{
                type: "boolean",
                option: "Lockdown Mode",
                description: "Use the daemon as a lighthouse, and not a secure zone.",
                note: "This is likely the option you want if you are not running your own koad:io zone",
                key: 'settings.daemon.lockdown'
            }]
        },{
            name: "eCoinCore Wallet",
            description: "Configure the koad:io daemon to expand your flow.",
            notes: ["eCoinCore daemon or desktop required"],
            options: [{
                type: "boolean",
                option: "Enabled Localstorage Wallet",
                description: "Your wallet will be generated client side and used",
                note: "It is up to you to backup your shit bro' ",
                key: 'settings.ecoincore.localstorage.enabled'
            }]
        },{
            name: "eCoinCore CacheBox",
            description: "Configure the eCoinCore CacheBox to make your secure your private queries.",
            notes: ["eCoinCore daemon or desktop required"],
            options: [{
                type: "string",
                option: "Cachebox Host",
                description: "usually '127.0.0.1' or 'localhost' ",
                note: "usually '127.0.0.1' or 'localhost' ",
                key: 'settings.ecoincore.host'
            },{
                type: "string",
                option: "Daemon Port",
                description: "Usually 20758",
                note: "Usually 20758",
                key: 'settings.ecoincore.port'
            },{
                type: "boolean",
                option: "Lockdown Mode",
                description: "Use the CacheBox as a lighthouse, and not a secure zone.",
                note: "This is likely the option you want if you are not running your own eCoinCore instance.",
                key: 'settings.ecoincore.lockdown'
            },{
                type: "boolean",
                option: "Auto-add Chainpacks",
                description: "Automatically add newly seen chainpacks to your CacheBox memory.",
                note: "This will add any chainpacks you come accross, but it will not enable auto enable anything; nor will it send the chainpack to your connected mobile experience.",
                key: 'settings.ecoincore.auto.add'
            },{
                type: "boolean",
                option: "Auto-update Chainpacks",
                description: "Automatically add newly seen updates to your chainpacks to your CacheBox memory.",
                note: "This will add any updates chainpack updates provided the updates came from the same source as your chainpack.  This will not change any services already deployed.",
                key: 'settings.ecoincore.auto.update'
            }]
        }]
    }
});



