# koad:io

koad:io helps with tasks that you perform on a regular basis.


> warning: I am an amateur > all of this might be shit, it's too early to tell.


[![Matrix](https://img.shields.io/matrix/io:koad.sh?label=io:koad.sh&logo=matrix&server_fqdn=matrix.koad.sh)](https://matrix.to/#/#io:koad.sh?via=koad.sh)


by saving a task as a command, and saving the environment variables used,

- I can remember how I did a thing
- I can replay the thing I did
- I can automate the thing I did
- I can go back and see if I was right
- I can keep my things together as simple files and folders
- I don't need to install or depend on complex tools and vendors


## customizable chain reactions

when calling a koad:io command, there is a chain-reaction of steps that happen; this is where you can create and customize each command to run specific to the entity and/or the `current working directory`. 

- you call an entity wrapper, ie: `alice start`
- `alice` loads some general environment details, then calls the koad:io cli wrapper
	1. `ENTITY=alice`   
- koad:io cli wrapper loads some more specific environment details
	1. `~/.koad-io/.env`   (if exists)  
	2. `~/.$ENTITY/.env`   (if exists)  
	3. `~/.$ENTITY/.credentials`   (if exists)  
- then, finds the most relevant regular command by searching in 4 locations and uses the results from the last location it scans.
- In each location, the deepest directory that contains a `command.sh` file or a `$COMMAND_NAME.sh` file will used.
	1. `~/.koad-io/commands/`  
	2. `~/.$ENTITY/commands/`  
- checks the CURRENT_DIRECTORY for commands,. if found will use and also load .env and .credentials CURRENT_DIRECTORY 
	1. `$CURRENT_DIRECTORY/commands/`  
	2. `./$COMMAND_NAME.sh` - a command of the same name in the current directory.  
- then calls the regular command with
	- environment details from the chain reaction
	- the remaining arguments passed into the entity cli wrapper


### examples

no1
```bash
alice probe domain koad.sh
```
wraps to the command 
```bash
~/.koad-io/commands/probe/domain/command.sh koad.sh
```

no2
```bash
alice probe electrum lenoir.ecoincore.com 50002 ssl
```
wraps to the command 
```bash
~/.koad-io/commands/probe/electrum.sh lenoir.ecoincore.com 50002 ssl
```


## install

clone this repo into your `~/.koad-io` folder
```bash
git clone https://github.com/koad/io.git ~/.koad-io
```

add the `~/.koad-io/bin` folder to your path (add this to your .bashrc)
```bash
[ -d ~/.koad-io/bin ] && export PATH=$PATH:$HOME/.koad-io/bin
```

## create

create your first koad:io entity!  sooo exciting!

```bash
koad-io init alice
```

once done, you can call upon alice using her name 
```bash
alice do something
```

alice will be created entirely in the .alice directory in your home directory
```bash
ls -la ~/.alice
```

> back this directory up NOW, and keep it somewhere suuuuuper safe.
> want to automated backups?  build a [raspberry pi powered concealment keyring that also pretends to be your front door bell](https://duckduckgo.com).

Your entity's directory will be a basic bare/blank koad:io skeleton filled with directories and keys that will be handy for you if you ever decide you want your entity to exist among multiple devices and locations.

```bash
cd ~/.alice && ls -la
```
```bash
```



You can ignore this for now and focus on populating your commands folder with whatever creative thing you desire.

## global commands

### create
inside ~/.koad-io/commands/
```bash
cd ~/.koad-io/commands
mkdir hello
touch hello/command.sh
chmod +x hello/command.sh
```

### run
```bash
alice hello world
alice hello awesome time machine
```


## entity specific commands

### create
inside ~/.alice/commands/
```bash
cd ~/.alice/commands
mkdir hello
echo "echo @" > hello/command.sh
chmod +x hello/command.sh
```

### run
```bash
alice hello world
alice hello awesome time machine
```


## project folder specific commands

### create
inside ~/Workbench/randomshit/
```bash
cd ~/Workbench/randomshit/
echo "this is a line" > hello.sh
chmod +x hello.sh
```

### run
```bash
cd ~/Workbench/randomshit/
alice hello world
alice hello awesome time machine
```



## 🤝 Support

As mentioned above, I am an amateur; 

I have been using computers for a long time, programming for a long time; but, I totally suck in a lot of ways.  

> I'd appreciate any feedback from any seasoned `bash` users out there!  

Contributions, issues, and feature requests are welcome!  

Give a ⭐️ if you like this project!


P.S.  somebody somewhere, sometime, will create a voice controller for this,. so keep that in mind when creating commands.  You have full control, imagine if you were able to teach siri over time (for yourself);  it would be amazing.  


/koad