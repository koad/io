# koad:io

koad:io helps with tasks that you perform on a regular basis.


> warning: this might be shit, it's too early to tell.


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
	3. `$CURRENT_DIRECTORY/commands/`
	4. `./$COMMAND_NAME.sh` - a command of the same name in the current directory.
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

/koad